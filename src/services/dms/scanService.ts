// @ts-nocheck
// Prenos algoritama iz samostalne DMS aplikacije (kolega) bez izmene logike: heuristike za PKCS#7 potpise i OCR
// su podešene na stvarnim dokumentima, pa su tipovi namerno izostavljeni da se ponašanje ne bi slučajno promenilo.
import zlib from 'zlib';
import path from 'path';
import jpeg from 'jpeg-js';
import * as signatureService from './signatureService';
import { kvLoadAll, kvSet } from '../../db/dmsDb';
import { createWorker } from 'tesseract.js';
const OCR_LANGS = 'srp_latn+eng';
// Mesta potpisa: reči koje označavaju stranu (potpis, davalac, primalac, direktor, INFORMACIJA...); tačan naziv nije uslov
const ROLE_RE = /(potpis|потпис|davalac|primalac|primaoc|davaoc|davao|primao|direk|informacij)/i;
// Potpisni blok je na dnu stranice; oznake u tekstu ugovora se ne računaju
const SIGN_BLOCK_FROM = 0.6;
// Tamni trag je tamniji od svetle pozadine skena za ovoliko (svetli hemijski potpis nije 110 nego oko 150)
const DARK_BELOW_BG = 60;
// Povećaj kad se promeni način analize: stari rezultati u kešu se tada ponovo računaju
export const ANALYSIS_VERSION = 12;

let workerPromise = null;

/**
 * Slike iz PDF-a, redom kako su u fajlu (skenirani PDF ima jednu sliku po stranici).
 * JPEG (DCTDecode) se čita direktno; FlateDecode se raspakuje i pretvara u sive piksele.
 */
export function listImages(buf) {
    const text = buf.toString('latin1');
    const images = [];
    const re = /\/Subtype\s*\/Image/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        const streamRe = /stream\r?\n/g;
        streamRe.lastIndex = m.index;
        const sm = streamRe.exec(text);
        if (!sm || sm.index - m.index > 2000) continue;

        // Rečnik samo ovog objekta: od zaglavlja "n 0 obj" do početka toka
        const dict = text.slice(Math.max(text.lastIndexOf('obj', m.index), 0), sm.index);
        const width = Number((dict.match(/\/Width\s+(\d+)/) || [])[1]);
        const height = Number((dict.match(/\/Height\s+(\d+)/) || [])[1]);
        const bpc = Number((dict.match(/\/BitsPerComponent\s+(\d+)/) || [])[1]);
        const filter = (dict.match(/\/Filter\s*\/(\w+)/) || [])[1];
        if (!width || !height) continue;

        const start = sm.index + sm[0].length;
        const end = text.indexOf('endstream', start);
        if (end < 0) continue;
        const data = buf.subarray(start, end);

        if (filter === 'DCTDecode') {
            images.push({ width, height, format: 'jpeg', data: trimToJpeg(data) });
        } else if (filter === 'FlateDecode' && bpc === 8) {
            const raw = inflateAny(data);
            if (!raw) continue;
            const comps = Math.round(raw.length / (width * height));
            if (comps !== 1 && comps !== 3) continue;
            images.push({ width, height, format: 'raw', comps, data: raw });
        }
    }
    return images;
}

// JPEG se završava sa FF D9; sve posle toga (npr. CRLF pre endstream) se odseca
export function trimToJpeg(data) {
    const eoi = data.lastIndexOf(Buffer.from([0xff, 0xd9]));
    return eoi > 0 ? data.subarray(0, eoi + 2) : data;
}

export function inflateAny(data) {
    try {
        return zlib.inflateSync(data);
    } catch (err) {
        try {
            return zlib.inflateRawSync(data);
        } catch (err2) {
            return null;
        }
    }
}

// Sivi pikseli stranice (osvetljenost 0–255), bez obzira na format slike
export function toGray(image) {
    if (image.format === 'jpeg') {
        // Veliki skenovi (npr. A3 ili 600 dpi) zahtevaju više memorije za dekodiranje
        const d = jpeg.decode(image.data, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 2048 });
        const gray = new Uint8Array(d.width * d.height);
        // Plavi pikseli (plavi pečat i plava olovka); crni tekst i crna ruka se ne računaju
        const blue = new Uint8Array(d.width * d.height);
        for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
            const r = d.data[p];
            const g = d.data[p + 1];
            const b = d.data[p + 2];
            gray[i] = r * 0.3 + g * 0.59 + b * 0.11;
            blue[i] = b - Math.max(r, g) > 15 ? 1 : 0;
        }
        return { width: d.width, height: d.height, gray, blue };
    }
    const { width, height, comps, data } = image;
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < gray.length; i++) {
        const p = i * comps;
        gray[i] = comps === 1 ? data[p] : data[p] * 0.3 + data[p + 1] * 0.59 + data[p + 2] * 0.11;
    }
    return { width, height, gray, blue: new Uint8Array(width * height) };
}

// Okreće sliku za 90° (ccw: suprotno od kazaljke, cw: u smeru kazaljke)
export function rotateImage(img, turn) {
    const { width, height, gray, blue } = img;
    const outGray = new Uint8Array(width * height);
    const outBlue = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const nx = turn === 'ccw' ? y : height - 1 - y;
            const ny = turn === 'ccw' ? width - 1 - x : x;
            outGray[ny * height + nx] = gray[y * width + x];
            outBlue[ny * height + nx] = blue[y * width + x];
        }
    }
    return { width: height, height: width, gray: outGray, blue: outBlue };
}

// Prave reči: samo slova, bar 3 znaka i pouzdano prepoznate (šum sa skena daje mnogo lažnih "reči")
const realWordCount = words => words.filter(w => w.confidence >= 70 && /^\p{L}{3,}$/u.test(w.text)).length;

// Preveliki sken (npr. 600 dpi) se smanjuje na najviše 3600 px po širini: OCR i analiza su brži, a potpisi ostaju čitljivi
const MAX_SCAN_WIDTH = 2600;
const MAX_SCAN_PIXELS = 25e6;
export function downsampleImage(img, k) {
    const width = Math.floor(img.width / k);
    const height = Math.floor(img.height / k);
    const gray = new Uint8Array(width * height);
    const blue = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            gray[y * width + x] = img.gray[(y * k) * img.width + x * k];
            blue[y * width + x] = img.blue[(y * k) * img.width + x * k];
        }
    }
    return { width, height, gray, blue };
}

// Ugao nagiba skena: traži se ugao (±3°) pri kojem su tamni redovi najoštriji (najveći zbir kvadrata broja tamnih piksela po redu)
export function skewAngle(img, level) {
    const { width, height, gray } = img;
    const step = Math.max(1, Math.round(Math.max(width, height) / 900));
    const pts = [];
    for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) if (gray[y * width + x] < level) pts.push(x, y);
    const offset = Math.hypot(width, height);
    const sharpness = deg => {
        const rad = deg * Math.PI / 180;
        const c = Math.cos(rad), s = Math.sin(rad);
        const bins = new Float64Array(Math.ceil(2 * offset / step) + 2);
        for (let i = 0; i < pts.length; i += 2) {
            const r = pts[i + 1] * c - pts[i] * s;
            bins[Math.floor((r + offset) / step)]++;
        }
        let score = 0;
        for (const b of bins) score += b * b;
        return score;
    };
    let best = 0;
    let bestScore = -1;
    for (let deg = -3; deg <= 3.0001; deg += 0.2) {
        const score = sharpness(deg);
        if (score > bestScore) { bestScore = score; best = deg; }
    }
    for (let deg = best - 0.2; deg <= best + 0.2001; deg += 0.02) {
        const score = sharpness(deg);
        if (score > bestScore) { bestScore = score; best = deg; }
    }
    return best * Math.PI / 180;
}

// Ispravlja nagib skena: rotacija oko središta (najbliži piksel), belo za praznine
export function deskewImage(img, angle) {
    const { width, height, gray, blue } = img;
    const c = Math.cos(angle), s = Math.sin(angle);
    const cx = width / 2, cy = height / 2;
    const outGray = new Uint8Array(width * height).fill(255);
    const outBlue = new Uint8Array(width * height);
    for (let yo = 0; yo < height; yo++) {
        for (let xo = 0; xo < width; xo++) {
            const dx = xo - cx, dy = yo - cy;
            const xs = Math.round(dx * c - dy * s + cx);
            const ys = Math.round(dx * s + dy * c + cy);
            if (xs < 0 || ys < 0 || xs >= width || ys >= height) continue;
            outGray[yo * width + xo] = gray[ys * width + xs];
            outBlue[yo * width + xo] = blue[ys * width + xs];
        }
    }
    return { width, height, gray: outGray, blue: outBlue };
}

// Ležeća stranica: tekst može biti okrenut za 90°, pa se proba svaki smer i uzima onaj sa više pravih reči
export async function readPage(page) {
    let original = toGray(page);
    if (original.width > MAX_SCAN_WIDTH) original = downsampleImage(original, Math.ceil(original.width / MAX_SCAN_WIDTH));
    const turns = original.width > original.height ? [null, 'ccw', 'cw'] : [null];
    let best = null;
    for (const turn of turns) {
        const img = turn ? rotateImage(original, turn) : original;
        const ocr = await recognizeWords(grayToPng(img.width, img.height, img.gray));
        if (!best || realWordCount(ocr.words) > realWordCount(best.ocr.words)) best = { img, ocr, turn };
    }
    // Nagib skena meri se na uspravnoj stranici; ako ga ima (0,1° i više), stranica se ispravlja i čita ponovo
    const level = backgroundLevel(best.img.gray) - DARK_BELOW_BG;
    const skew = skewAngle(best.img, level);
    if (Math.abs(skew) >= 0.1 * Math.PI / 180) {
        const img = deskewImage(best.img, skew);
        const ocr = await recognizeWords(grayToPng(img.width, img.height, img.gray));
        return { ...img, words: ocr.words, lines: ocr.lines, lineBoxes: ocr.lineBoxes, orientation: best.turn || 'none', skewDeg: skew * 180 / Math.PI };
    }
    return { ...best.img, words: best.ocr.words, lines: best.ocr.lines, lineBoxes: best.ocr.lineBoxes, orientation: best.turn || 'none', skewDeg: 0 };
}

const CRC_TABLE = (() => {
    const table = [];
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

export function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

export function pngChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
}

// Sivi pikseli u PNG (za OCR)
export function grayToPng(width, height, gray) {
    const rows = Buffer.alloc((width + 1) * height);
    for (let y = 0; y < height; y++) {
        rows.set(gray.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // dubina boje
    ihdr[9] = 0; // siva skala
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', zlib.deflateSync(rows)),
        pngChunk('IEND', Buffer.alloc(0))
    ]);
}

export function ocrWorker() {
    if (!workerPromise) {
        // Jezički fajlovi su u repozitorijumu (resources/tessdata), pa OCR radi i bez interneta
        workerPromise = createWorker(OCR_LANGS, 1, {
            langPath: path.join(process.cwd(), 'resources', 'tessdata'),
            gzip: false,
            cacheMethod: 'none'
        });
    }
    return workerPromise;
}

// Sve reči sa pozicijama (piksel koordinate na slici) i tekst po redovima
export async function recognizeWords(png) {
    const worker = await ocrWorker();
    const { data } = await worker.recognize(png, {}, { blocks: true });
    const words = [];
    const lines = [];
    const lineBoxes = [];
    (data.blocks || []).forEach(block => block.paragraphs.forEach(par => par.lines.forEach(line => {
        const lineText = line.words.map(w => w.text).join(' ');
        lines.push(lineText);
        line.words.forEach(word => words.push({ text: word.text, bbox: word.bbox, confidence: word.confidence, lineLen: lineText.length }));
        if (line.words.length) {
            // Red teksta sa položajem: oznaka strane potpisnika (firma ili uloga) se vezuje za potpis iznad nje
            lineBoxes.push({
                text: lineText,
                bbox: {
                    x0: Math.min(...line.words.map(w => w.bbox.x0)),
                    y0: Math.min(...line.words.map(w => w.bbox.y0)),
                    x1: Math.max(...line.words.map(w => w.bbox.x1)),
                    y1: Math.max(...line.words.map(w => w.bbox.y1))
                }
            });
        }
    })));
    return { words, lines, lineBoxes };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Grupe reči koje čine jedno mesto potpisa: ista visina reda i blizu jedna drugoj (npr. "DAVALAC INFORMACIJA")
export function groupPlaces(roleWords) {
    const parent = roleWords.map((_, i) => i);
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < roleWords.length; i++) {
        for (let j = i + 1; j < roleWords.length; j++) {
            const a = roleWords[i].bbox;
            const b = roleWords[j].bbox;
            const h = Math.max(a.y1 - a.y0, b.y1 - b.y0);
            const dy = Math.abs((a.y0 + a.y1) - (b.y0 + b.y1)) / 2;
            const gap = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
            if (dy < h * 0.6 && gap < h * 3) parent[find(i)] = find(j);
        }
    }
    const groups = new Map();
    roleWords.forEach((w, i) => {
        const r = find(i);
        const g = groups.get(r) || { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, text: [] };
        g.x0 = Math.min(g.x0, w.bbox.x0);
        g.y0 = Math.min(g.y0, w.bbox.y0);
        g.x1 = Math.max(g.x1, w.bbox.x1);
        g.y1 = Math.max(g.y1, w.bbox.y1);
        g.text.push(w.text);
        groups.set(r, g);
    });
    return [...groups.values()];
}

// Pikseli koje pokriva otkucani tekst (OCR), da se ne mešaju sa ručnim potpisom
export function textMaskOf(words, width, height) {
    const mask = new Uint8Array(width * height);
    for (const w of words) {
        // Nepouzdano pročitane reči (npr. ručni potpis pročitan kao slova) ne maskiraju se, da bi trag ostao merljiv
        if (w.confidence !== undefined && w.confidence < 60) continue;
        const x0 = clamp(w.bbox.x0 - 3, 0, width);
        const x1 = clamp(w.bbox.x1 + 3, 0, width);
        const y0 = clamp(w.bbox.y0 - 3, 0, height);
        const y1 = clamp(w.bbox.y1 + 3, 0, height);
        for (let y = y0; y < y1; y++) mask.fill(1, y * width + x0, y * width + x1);
    }
    return mask;
}

// Svetla pozadina skena (90. percentil uzorka); tamni tragovi se mere u odnosu na nju
export function backgroundLevel(gray) {
    const sample = [];
    for (let i = 0; i < gray.length; i += 37) sample.push(gray[i]);
    sample.sort((a, b) => a - b);
    return sample[Math.floor(sample.length * 0.9)];
}

// Crni tragovi (ručni potpis) van otkucanog teksta; duge vodoravne linije (linija za potpis, ivice tabele) se ne broje
const LINE_RUN = 40;
const DARK_MIN = 0.003;
export function darkFraction(gray, textMask, width, box, level) {
    let dark = 0;
    for (let y = box.y0; y < box.y1; y++) {
        let run = 0;
        for (let x = box.x0; x <= box.x1; x++) {
            const i = y * width + x;
            if (x < box.x1 && gray[i] < level && !textMask[i]) {
                run++;
                continue;
            }
            if (run > 0 && run < LINE_RUN) dark += run;
            run = 0;
        }
    }
    const area = (box.x1 - box.x0) * (box.y1 - box.y0);
    return area ? dark / area : 0;
}

// Strana sa potpisom: levo ili desno od sredine, bez ivice skena
const SIDE_MARGIN = 0.05;

// Plavi i tamni (ručni) trag u kutiji: udeo plavih piksela i udeo tamnih piksela van otkucanog teksta
export function inkIn(box, { gray, blue, textMask, width, level }) {
    let blueCount = 0;
    if (blue) {
        for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) blueCount += blue[y * width + x];
    }
    const area = (box.x1 - box.x0) * (box.y1 - box.y0);
    const blueFraction = area && blue ? blueCount / area : 0;
    const darkShare = darkFraction(gray, textMask, width, box, level);
    // Plavi pečat ili potpis: više od 0,3 %; crni ručni potpis: više od 1 % van teksta
    const hasBlue = blueFraction > 0.003;
    const hasDark = darkShare >= DARK_MIN;
    return { blue: blueFraction, dark: darkShare, hasInk: hasBlue || hasDark };
}

// Potpis je u zoni oko mesta potpisa: malo levo, i iznad i ispod reda sa oznakom
export function placeInkOf(place, { gray, blue, textMask, width, height, level }) {
    const gw = place.x1 - place.x0;
    const gh = place.y1 - place.y0;
    const box = {
        x0: clamp(Math.round(place.x0 - gw * 0.2), 0, width),
        x1: clamp(Math.round(place.x0 + Math.max(gw * 1.6, width * 0.2)), 0, width),
        y0: clamp(Math.round(place.y0 - gh * 6), 0, height),
        y1: clamp(Math.round(place.y1 + gh * 2.5), 0, height)
    };
    return { text: place.text.join(' '), ...inkIn(box, { gray, blue, textMask, width, level }) };
}

// Potpisni deo se deli na mrežu ćelija; ćelija je plava ako je bar 5 % piksela plavo
const INK_CELLS_ACROSS = 120;
const INK_CELL_MIN = 0.05;
// Manje grupe ćelija su šum; ćelije na razdaljini do 2 pripadaju istom tragu (potpis ima prekide)
const INK_MIN_CELLS = 4;
const INK_GAP = 2;

/**
 * Broj odvojenih plavih tragova (potpisa i pečata) u donjem delu strane
 */
export function countInkMarks(blue, width, height) {
    if (!blue) return 0;
    const cell = Math.max(4, Math.round(width / INK_CELLS_ACROSS));
    const top = Math.floor(height * SIGN_BLOCK_FROM);
    const marked = [];
    for (let y0 = top; y0 < height; y0 += cell) {
        for (let x0 = 0; x0 < width; x0 += cell) {
            const y1 = Math.min(height, y0 + cell);
            const x1 = Math.min(width, x0 + cell);
            let hit = 0;
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hit += blue[y * width + x];
            if (hit / ((y1 - y0) * (x1 - x0)) >= INK_CELL_MIN) marked.push({ c: Math.floor(x0 / cell), r: Math.floor((y0 - top) / cell) });
        }
    }
    // Povezivanje ćelija (union-find po razdaljini), pa broj grupa dovoljne veličine
    const parent = marked.map((_, i) => i);
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < marked.length; i++) {
        for (let j = i + 1; j < marked.length; j++) {
            if (Math.abs(marked[i].c - marked[j].c) <= INK_GAP && Math.abs(marked[i].r - marked[j].r) <= INK_GAP) {
                parent[find(i)] = find(j);
            }
        }
    }
    const sizes = new Map();
    for (let i = 0; i < marked.length; i++) sizes.set(find(i), (sizes.get(find(i)) || 0) + 1);
    return [...sizes.values()].filter(n => n >= INK_MIN_CELLS).length;
}

// Uvećanje potpisnog dela za OCR (sitan tekst pečata se na 1× ne čita)
const SIGN_BLOCK_ZOOM = 3;

// OCR potpisnog dela uvećanog; reči se vraćaju na koordinate cele strane
export async function readSignBlockZoomed(gray, width, height) {
    const top = Math.floor(height * SIGN_BLOCK_FROM);
    const w = width * SIGN_BLOCK_ZOOM;
    const h = (height - top) * SIGN_BLOCK_ZOOM;
    const zoomed = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        const srcRow = (top + Math.floor(y / SIGN_BLOCK_ZOOM)) * width;
        for (let x = 0; x < w; x++) zoomed[y * w + x] = gray[srcRow + Math.floor(x / SIGN_BLOCK_ZOOM)];
    }
    const { words, lines } = await recognizeWords(grayToPng(w, h, zoomed));
    const back = v => v / SIGN_BLOCK_ZOOM;
    return {
        lines,
        words: words.map(w => ({
            text: w.text,
            confidence: w.confidence,
            lineLen: w.lineLen,
            bbox: { x0: back(w.bbox.x0), x1: back(w.bbox.x1), y0: back(w.bbox.y0) + top, y1: back(w.bbox.y1) + top }
        }))
    };
}

/**
 * Analiza jedne strane: oznake "potpis", mastilo iznad njih, plavi tragovi, pečati i strane sa potpisom
 */
// Duge prave linije (ivice tabele, linije za potpis, okviri) nisu rukopis: vodoravne i uspravne duže od LINE_RUN
export function lineMaskOf(gray, level, width, height) {
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        let start = -1;
        for (let x = 0; x <= width; x++) {
            const dark = x < width && gray[y * width + x] < level;
            if (dark && start < 0) start = x;
            if (!dark && start >= 0) {
                if (x - start >= LINE_RUN) mask.fill(1, y * width + start, y * width + x);
                start = -1;
            }
        }
    }
    for (let x = 0; x < width; x++) {
        let start = -1;
        for (let y = 0; y <= height; y++) {
            const dark = y < height && gray[y * width + x] < level;
            if (dark && start < 0) start = y;
            if (!dark && start >= 0) {
                if (y - start >= LINE_RUN) for (let k = start; k < y; k++) mask[k * width + x] = 1;
                start = -1;
            }
        }
    }
    return mask;
}

// Trag ručnog potpisa je povezana tamna mrlja dovoljno velika i visoka; tanke ivice (anti-aliasing tabele, šum) to nisu.
// Mere se u odnosu na širinu stranice, pa važe i za drugu rezoluciju skena
const BLOB_MIN_HEIGHT_RATIO = 0.005;
const BLOB_MIN_WIDTH_RATIO = 0.03;
const BLOB_MIN_PIXELS_RATIO = 0.35;
export function strongInkMask(gray, level, excluded, width, height) {
    const total = width * height;
    const raw = new Uint8Array(total);
    for (let i = 0; i < total; i++) raw[i] = !excluded[i] && gray[i] < level ? 1 : 0;
    // Povezuju se samo susedni tamni pikseli: proširenje (dilatacija) je spajalo štampani tekst i ivice tabele u lažne trage
    const near = raw;
    const mask = new Uint8Array(total);
    const seen = new Uint8Array(total);
    const minHeight = Math.round(width * BLOB_MIN_HEIGHT_RATIO);
    const minWidth = Math.round(width * BLOB_MIN_WIDTH_RATIO);
    const minPixels = Math.round(width * BLOB_MIN_PIXELS_RATIO);
    const stack = [];
    for (let start = 0; start < total; start++) {
        if (seen[start] || !near[start]) continue;
        seen[start] = 1;
        stack.push(start);
        const members = [];
        let minY = height, maxY = -1, minX = width, maxX = -1, dark = 0;
        while (stack.length) {
            const i = stack.pop();
            members.push(i);
            if (raw[i]) dark++;
            const y = Math.floor(i / width), x = i - y * width;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            for (let dy = -1; dy <= 1; dy++) {
                const ny = y + dy;
                if (ny < 0 || ny >= height) continue;
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    if (nx < 0 || nx >= width) continue;
                    const j = ny * width + nx;
                    if (!seen[j] && near[j]) {
                        seen[j] = 1;
                        stack.push(j);
                    }
                }
            }
        }
        const big = dark >= minPixels && maxY - minY + 1 >= minHeight && maxX - minX + 1 >= minWidth;
        if (big) for (const j of members) if (raw[j]) mask[j] = 1;
    }
    return mask;
}

// Pravilo po potpisnicima (firme ili uloge) je isključeno: na 46 označenih dokumenata dalo je 29 tačnih, a pravilo po stranama 36
const PARTY_RULE_ENABLED = false;

// Oznaka strane potpisnika: red teksta sa firmom ili ulogom (npr. "Potpisano za i u ime: UNIPROMET DOO", "Buyer / Kupac")
const LABEL_RE = /(d\.?\s?o\.?\s?o|\bdoo\b|gmbh|\bllc\b|\bltd\b|\bs\.\s?a\.|\ba\.\s?d\.|\be\.\s?v\.|\bsrl\b|potpis|потпис|davalac|primalac|primaoc|davaoc|kupac|buyer|seller|prodavac|preuzeo|izdao|primio|direktor|director|predsednik|za i u ime|isporu|robu)/i;
// Reči koje nisu deo imena firme (uloge, veznici, pravne oznake)
const PARTY_STOP = new Set(['POTPISANO', 'POTPIS', 'POTPISNICI', 'POTPISNIK', 'ZA', 'IME', 'PREZIME', 'NAZIV', 'DAVALAC', 'PRIMALAC', 'PRIMAOC', 'DAVAOC', 'KUPAC', 'BUYER', 'SELLER', 'PRODAVAC', 'PREUZEO', 'IZDAO', 'PRIMIO', 'PREDAO', 'FAKTURISAO', 'ISPORUCIO', 'DIREKTOR', 'DIRECTOR', 'PREDSEDNIK', 'INFORMACIJA', 'INFORMACIJU', 'ROBU', 'ISPORUCILAC', 'PRIJEM', 'DOO', 'GMBH', 'LLC', 'LTD', 'SRL', 'AD', 'SA', 'EV', 'AS', 'AT', 'THE', 'FOR', 'AND', 'OF', 'IN', 'SIGNATORIES', 'BOTTOM', 'KRAJU', 'KAO', 'NA', 'DATUM', 'MESTO', 'FIRMA']);

// Ključ strane: UNIPROMET se prepoznaje po imenu, ostale firme po prvim značajnim rečima, a uloga bez imena po ulozi
export function partyKeyOf(text) {
    if (/unipromet/i.test(text)) return 'UNIPROMET';
    const words = text.toUpperCase().replace(/[^A-ZČĆŠŽĐ0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !PARTY_STOP.has(w));
    if (words.length) return words.slice(0, 2).join(' ');
    const role = (text.match(/buyer|kupac|seller|prodavac|davalac|primalac|primaoc|preuzeo|izdao|primio|potpis/i) || ['potpis'])[0].toLowerCase();
    return 'ROLE:' + role;
}

// Oznake strana sa položajem (samo u donjem delu strane; gornji deo je zaglavlje firme ili primljeni pečat)
export function partyLabelsOf(lineBoxes, width, height) {
    const labels = lineBoxes
        .filter(l => l.bbox.y0 > height * 0.35 && l.text.length <= 70 && LABEL_RE.test(l.text))
        .map(l => ({ text: l.text, bbox: l.bbox, key: partyKeyOf(l.text) }));
    // Uloga bez imena (npr. "Buyer / Kupac") dobija ključ firme koja je u istom bloku ispod ili iznad nje
    for (const label of labels) {
        if (!label.key.startsWith('ROLE:')) continue;
        const near = labels.find(other => !other.key.startsWith('ROLE:')
            && Math.abs((other.bbox.y0 + other.bbox.y1) / 2 - (label.bbox.y0 + label.bbox.y1) / 2) <= height * 0.08
            && other.bbox.x0 <= label.bbox.x1 + width * 0.1 && other.bbox.x1 >= label.bbox.x0 - width * 0.1);
        if (near) label.key = near.key;
    }
    return labels;
}

// Povezane mrlje maske (ručni potpis, pečat): pravougaonik i broj piksela
export function componentBoxes(mask, width, height) {
    const total = width * height;
    const seen = new Uint8Array(total);
    const boxes = [];
    const stack = [];
    for (let start = 0; start < total; start++) {
        if (seen[start] || !mask[start]) continue;
        seen[start] = 1;
        stack.push(start);
        let x0 = width, y0 = height, x1 = -1, y1 = -1, n = 0;
        while (stack.length) {
            const i = stack.pop();
            n++;
            const y = Math.floor(i / width), x = i - y * width;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
            for (let dy = -1; dy <= 1; dy++) {
                const ny = y + dy;
                if (ny < 0 || ny >= height) continue;
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    if (nx < 0 || nx >= width) continue;
                    const j = ny * width + nx;
                    if (!seen[j] && mask[j]) {
                        seen[j] = 1;
                        stack.push(j);
                    }
                }
            }
        }
        boxes.push({ x0, y0, x1, y1, n });
    }
    return boxes;
}

// Mrlja pripada oznaci koja je najbliža po visini i horizontalno joj odgovara (potpis je iznad imena ili tik ispod njega)
export function nearestLabel(box, labels, width, height) {
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    let best = -1, bestDist = Infinity;
    labels.forEach((label, i) => {
        if (cx < label.bbox.x0 - width * 0.06 || cx > label.bbox.x1 + width * 0.06) return;
        if (cy < label.bbox.y0 - height * 0.12 || cy > label.bbox.y1 + height * 0.06) return;
        // Udaljenost po obe ose: blok sa potpisom je u istoj koloni (horizontalno) kao i oznaka
        const lx = (label.bbox.x0 + label.bbox.x1) / 2, ly = (label.bbox.y0 + label.bbox.y1) / 2;
        const dist = Math.hypot((cx - lx) / width, (cy - ly) / height);
        if (dist < bestDist) { bestDist = dist; best = i; }
    });
    return best;
}

/**
 * Analiza jedne strane: oznake mesta potpisa (bilo gde na strani), mastilo oko njih, i strane sa potpisom
 * po donjem delu (samo ako na strani nema oznaka). Tabele i linije se ne računaju kao mastilo
 */
export async function analyzePage(page) {
    const { width, height, gray, blue, words, lines, lineBoxes, orientation } = await readPage(page);
    // Oznake mesta potpisa mogu biti prekrivene (pečat, logo): čitaju se i iz uvećanog donjeg dela
    const zoom = await readSignBlockZoomed(gray, width, height);
    const all = [...words, ...zoom.words];
    const places = groupPlaces(all.filter(w => ROLE_RE.test(w.text) && w.bbox.y0 > height * SIGN_BLOCK_FROM));
    const textMask = textMaskOf(all, width, height);
    const level = backgroundLevel(gray) - DARK_BELOW_BG;
    const lineMask = lineMaskOf(gray, level, width, height);
    for (let i = 0; i < textMask.length; i++) textMask[i] |= lineMask[i];
    // Tamni pikseli se broje samo ako pripadaju mrlji veličine potpisa; sve ostalo se izuzima
    const strong = strongInkMask(gray, level, textMask, width, height);
    // Mrlje za dodelu stranama: ručni potpis (tamni) i plavi pečat ili olovka, bez otkucanog teksta
    const inkMask = new Uint8Array(width * height);
    for (let i = 0; i < inkMask.length; i++) inkMask[i] = strong[i] || (blue && blue[i] && !textMask[i]) ? 1 : 0;
    const partyLabels = PARTY_RULE_ENABLED ? partyLabelsOf(lineBoxes || [], width, height) : [];
    const labelHasInk = partyLabels.map(() => false);
    if (PARTY_RULE_ENABLED) {
        for (const box of componentBoxes(inkMask, width, height)) {
            if (box.n < Math.round(width * BLOB_MIN_PIXELS_RATIO)) continue;
            const idx = nearestLabel(box, partyLabels, width, height);
            if (idx >= 0) labelHasInk[idx] = true;
        }
    }
    for (let i = 0; i < textMask.length; i++) if (!strong[i]) textMask[i] = 1;
    const details = places.map(p => placeInkOf(p, { gray, blue, textMask, width, height, level }));
    const mid = Math.floor(width / 2);
    const bottom = Math.floor(height * SIGN_BLOCK_FROM);
    // Podnožje (tačkice i kontakt) počinje oko 88% visine i nije potpis, pa se donja granica stavlja iznad njega
    const bottomEnd = Math.floor(height * 0.87);
    const ctx = { gray, blue, textMask, width, level };
    const placeSides = new Set();
    details.forEach((d, i) => { if (d.hasInk) placeSides.add((places[i].x0 + places[i].x1) / 2 < mid ? 'left' : 'right'); });
    const halfSides = new Set();
    if (inkIn({ x0: Math.floor(width * SIDE_MARGIN), x1: mid, y0: bottom, y1: bottomEnd }, ctx).hasInk) halfSides.add('left');
    if (inkIn({ x0: mid, x1: Math.floor(width * (1 - SIDE_MARGIN)), y0: bottom, y1: bottomEnd }, ctx).hasInk) halfSides.add('right');
    // Vidljivi elektronski potpis (pečat "Digitally signed by ... Date ...") se vidi kao tekst na slici
    // Tekst pečata je sitan: ako ga cela strana ne pokaže, čita se potpisni deo uvećan 3 puta
    const stamps = lines.filter(l => /digit/i.test(l)).length || zoom.lines.filter(l => /digit/i.test(l)).length;
    return {
        orientation,
        places: details,
        withInk: details.filter(d => d.hasInk).length,
        labels: places.length,
        inkMarks: countInkMarks(blue, width, height),
        stamps,
        placeSides: [...placeSides],
        halfSides: [...halfSides],
        labelKeys: partyLabels.map(l => l.key),
        labelSigned: partyLabels.filter((_, i) => labelHasInk[i]).map(l => l.key)
    };
}

/**
 * Analiza svih strana skena: oznake, pečati i tragovi se sabiraju, a strane sa potpisom se broje kao skup
 * (leva / desna) preko svih strana, pa parafa na svakoj strani jedne osobe ne znači dve strane.
 * Potpis na obe strane = bar dve oznake ili pečata ili dve strane sa mastilom.
 */
export async function analyzeScan(pdfBuffer) {
    const images = listImages(pdfBuffer);
    if (images.length === 0) return { ok: false, error: 'U PDF-u nema slika (nije sken)' };

    // Strana koja se ne može dekodovati (prevelika slika) preskače se, a broj preskočenih se vraća
    const pages = [];
    let skippedPages = 0;
    for (const page of images) {
        // Stranica preko 25 Mpx (npr. 600 dpi A4) bi trajala predugo; ostaje nerazmotrena i prijavljuje se
        if (page.width * page.height > MAX_SCAN_PIXELS) {
            skippedPages++;
            continue;
        }
        try {
            pages.push(await analyzePage(page));
        } catch (err) {
            skippedPages++;
        }
    }
    const labels = pages.reduce((n, p) => n + p.labels, 0);
    const legacySides = new Set(pages.flatMap(p => [...p.placeSides, ...p.halfSides]));
    const stamps = pages.reduce((n, p) => n + p.stamps, 0);
    // Strane po potpisnicima: ako su bar dve različite firme / uloge na dokumentu, broje se firme čija je oznaka potpisana
    const partyKeys = new Set(pages.flatMap(p => p.labelKeys));
    const signedParties = new Set(pages.flatMap(p => p.labelSigned));
    const labelBased = partyKeys.size >= 2;
    const signedSides = labelBased ? signedParties.size : legacySides.size;
    const bilateral = labelBased
        ? (signedParties.size >= 2 ? true : (signedParties.size === 1 ? false : null))
        : decideBilateral({ labels, stamps, sides: legacySides.size });
    return {
        ok: true,
        pages: images.length,
        skippedPages,
        orientation: pages.map(p => p.orientation),
        labels,
        withInk: pages.reduce((n, p) => n + p.withInk, 0),
        inkMarks: pages.reduce((n, p) => n + p.inkMarks, 0),
        stamps,
        places: pages.flatMap(p => p.places),
        labelBased,
        partyKeys: [...partyKeys],
        signedParties: [...signedParties],
        signedSides,
        bilateral
    };
}

/**
 * Automatski potpis na obe strane: dva pečata, ili više od jedne oznake "potpis" (bez obzira na mastilo)
 */
export function decideBilateral({ labels, stamps, sides }) {
    if (stamps >= 2 || sides >= 2) return true;
    if (stamps === 1) return false;
    return labels === 0 && sides === 0 ? null : false;
}

export function loadAnalysis() {
    return kvLoadAll('scan_analysis');
}

export function saveAnalysis(name, result) {
    const key = signatureService.confirmKey(name);
    const value = { ...result, version: ANALYSIS_VERSION, analyzedAt: new Date().toISOString() };
    kvSet('scan_analysis', key, value);
    return value;
}
