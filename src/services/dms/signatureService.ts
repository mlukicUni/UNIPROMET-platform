// @ts-nocheck
// Prenos algoritama iz samostalne DMS aplikacije (kolega) bez izmene logike: heuristike za PKCS#7 potpise i OCR
// su podešene na stvarnim dokumentima, pa su tipovi namerno izostavljeni da se ponašanje ne bi slučajno promenilo.
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import forge from 'node-forge';
import { kvLoadAll, kvSet, kvDelete } from '../../db/dmsDb';

const MAX_ENTRIES = 500;
const MAX_NESTED_DEPTH = 1;
const ASN_UNIVERSAL = 0;
const ASN_CONTEXT = 128;
const ASN_SET = 17;
const ASN_OCTET_STRING = 4;
const ASN_UTC_TIME = 23;
const ASN_GENERALIZED_TIME = 24;

const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4';
const OID_SIGNING_TIME = '1.2.840.113549.1.9.5';

// Heš algoritmi iz PKCS#7 potpisa, u nazivima koje razume Node crypto
const HASH_BY_OID = {
    '1.3.14.3.2.26': 'sha1',
    '2.16.840.1.101.3.4.2.1': 'sha256',
    '2.16.840.1.101.3.4.2.2': 'sha384',
    '2.16.840.1.101.3.4.2.3': 'sha512'
};

/**
 * Izvlači potpisna polja iz PDF-a: ByteRange (delovi koji su potpisani) i /Contents (PKCS#7 potpis).
 * Radi nad binarnim sadržajem, bez raspakivanja na disk.
 */
export function findPdfSignatures(buf) {
    const text = buf.toString('latin1');
    const signatures = [];
    const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        // Rečnik potpisa je u okviru jednog objekta: od "obj" pre ByteRange do "endobj" posle njega
        const objStart = text.lastIndexOf(' obj', m.index);
        const objEnd = text.indexOf('endobj', m.index);
        const dict = text.slice(Math.max(objStart, 0), objEnd > 0 ? objEnd : undefined);
        const contents = dict.match(/\/Contents\s*<([0-9a-fA-F\s]+)>/);
        const [a, b, c, d] = [m[1], m[2], m[3], m[4]].map(Number);
        signatures.push({
            byteRange: [a, b, c, d],
            contentsHex: contents ? contents[1].replace(/\s+/g, '') : null,
            isTimestamp: /\/Type\s*\/DocTimeStamp/.test(dict)
        });
    }
    return signatures;
}

// Pod-čvor po tipu (npr. SET ili OCTET STRING) ili kontekstnoj oznaci [n]
export function findNode(node, { tagClass = ASN_UNIVERSAL, type }) {
    return (node.value || []).find(n => n.tagClass === tagClass && n.type === type) || null;
}

// Vrednost OID-a iz ASN.1 čvora (string u obliku 1.2.3)
export function oidOf(node) {
    return forge.asn1.derToOid(node.value);
}

export function parseTime(node) {
    if (node.type === ASN_UTC_TIME) return forge.asn1.utcTimeToDate(node.value);
    if (node.type === ASN_GENERALIZED_TIME) return forge.asn1.generalizedTimeToDate(node.value);
    return null;
}

// Tekst iz sertifikata dolazi kao niz bajtova (UTF-8), pa ćirilica i č/ć/š/đ inače postaju nečitljivi
export function fixText(value) {
    const decoded = Buffer.from(String(value), 'binary').toString('utf8');
    return decoded.includes('�') ? String(value) : decoded;
}

export function normalizeSerial(hex) {
    return hex.replace(/^0+/, '').toLowerCase();
}

/**
 * Proverava kriptografski jedan potpis (PKCS#7, odvojen od sadržaja) nad delovima PDF-a iz ByteRange.
 * Proverava: heš sadržaja (messageDigest), potpis nad potpisanim atributima i da je sertifikat potpisnika ispravan.
 * Ne proverava lanac poverenja izdavaoca (da li je izdavalac kvalifikovan).
 */
export function verifyOne(buf, sig) {
    const [a, b, c, d] = sig.byteRange;
    const signedData = Buffer.concat([buf.subarray(a, a + b), buf.subarray(c, c + d)]);
    const coversWholeFile = c + d === buf.length;

    const result = {
        isTimestamp: sig.isTimestamp,
        coversWholeFile,
        // Bajtovi posle potpisanog dela: dodati su kasnije (npr. nova verzija u PDF-u)
        unsignedBytes: coversWholeFile ? 0 : buf.length - (c + d),
        valid: false,
        signer: null,
        issuer: null,
        signingTime: null,
        certValidTo: null,
        certExpired: null,
        error: null
    };

    if (!sig.contentsHex) {
        result.error = 'Potpis nema sadržaj (/Contents)';
        return result;
    }

    try {
        const der = forge.util.createBuffer(Buffer.from(sig.contentsHex, 'hex').toString('binary'));
        // Sadržaj /Contents je popunjen nulama do kraja; čitamo samo prvi ASN.1 objekat
        const root = forge.asn1.fromDer(der, { parseAllBytes: false });
        const p7 = forge.pkcs7.messageFromAsn1(root);

        // ContentInfo -> [0] SignedData -> poslednji član je SET potpisnika
        const signedDataNode = root.value[1].value[0];
        const signerInfos = signedDataNode.value[signedDataNode.value.length - 1];
        const si = signerInfos.value[0].value;

        const serialNode = si[1].value[1];
        const serial = normalizeSerial(forge.util.createBuffer(serialNode.value).toHex());
        const digestOid = oidOf(si[2].value[0]);
        const hashName = HASH_BY_OID[digestOid];
        if (!hashName) throw new Error(`Nepodržan heš algoritam ${digestOid}`);

        const cert = (p7.certificates || []).find(ct => normalizeSerial(ct.serialNumber) === serial);
        if (!cert) throw new Error('Sertifikat potpisnika nije u potpisu');

        const signatureNode = si.slice().reverse().find(n => n.tagClass === ASN_UNIVERSAL && n.type === ASN_OCTET_STRING);
        const signature = Buffer.from(signatureNode.value, 'binary');

        const authNode = findNode(signerInfos.value[0], { tagClass: ASN_CONTEXT, type: 0 });
        let dataToVerify;
        let digestOk = true;
        if (authNode) {
            const attrs = authNode.value.map(attr => ({
                oid: oidOf(attr.value[0]),
                values: attr.value[1].value
            }));
            const mdAttr = attrs.find(x => x.oid === OID_MESSAGE_DIGEST);
            const expected = mdAttr ? Buffer.from(mdAttr.values[0].value, 'binary') : null;
            const actual = crypto.createHash(hashName).update(signedData).digest();
            digestOk = !!expected && expected.equals(actual);

            // Potpisani atributi se heširaju kao SET (tag 0x31), a u potpisu su kodirani kao [0] (0xA0)
            const der2 = Buffer.from(forge.asn1.toDer(authNode).getBytes(), 'binary');
            der2[0] = 0x31;
            dataToVerify = der2;

            const st = attrs.find(x => x.oid === OID_SIGNING_TIME);
            result.signingTime = st ? parseTime(st.values[0]) : null;
        } else {
            dataToVerify = signedData;
        }

        const publicKeyPem = forge.pki.publicKeyToPem(cert.publicKey);
        const signatureOk = crypto.verify(hashName, dataToVerify, publicKeyPem, signature);
        result.valid = digestOk && signatureOk;
        if (!digestOk) result.error = 'Sadržaj dokumenta ne odgovara potpisu';
        else if (!signatureOk) result.error = 'Potpis nije ispravan';

        const cn = cert.subject.getField('CN');
        const issuerCn = cert.issuer.getField('CN');
        result.signer = cn ? fixText(cn.value) : cert.subject.attributes.map(x => fixText(x.value)).join(', ');
        result.issuer = issuerCn ? fixText(issuerCn.value) : null;
        result.certValidTo = cert.validity.notAfter;
        result.certExpired = cert.validity.notAfter < new Date();
    } catch (err) {
        result.error = 'Potpis nije moguće proveriti: ' + err.message;
    }
    return result;
}

/**
 * Gruba procena potpisa na obe strane: na poslednjoj skeniranoj stranici, u donjoj trećini,
 * ima tamnog sadržaja i levo i desno (potpis davaoca i primaoca). Ne prepoznaje potpise, samo tragove mastila.
 * Vraća null ako slike nije moguće pročitati (npr. JPEG ili druga kompresija).
 */
export function estimateBilateral(buf) {
    const text = buf.toString('latin1');
    const pages = [];
    const re = /\/Subtype\s*\/Image/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        const streamRe = /stream\r?\n/g;
        streamRe.lastIndex = m.index;
        const sm = streamRe.exec(text);
        if (!sm || sm.index - m.index > 1500) continue;
        const dict = text.slice(Math.max(0, m.index - 300), sm.index);
        const w = dict.match(/\/Width\s+(\d+)/g);
        const h = dict.match(/\/Height\s+(\d+)/g);
        const filter = (dict.match(/\/Filter\s*\/(\w+)/) || [])[1];
        const bpc = (dict.match(/\/BitsPerComponent\s+(\d+)/) || [])[1];
        if (!w || !h || filter !== 'FlateDecode' || bpc !== '8') continue;
        const width = Number(w[w.length - 1].match(/\d+/)[0]);
        const height = Number(h[h.length - 1].match(/\d+/)[0]);
        const start = sm.index + sm[0].length;
        const end = text.indexOf('endstream', start);
        // Neki skeneri pišu sirovi deflate tok bez zlib zaglavlja
        const data = buf.subarray(start, end);
        let raw;
        try {
            raw = zlib.inflateSync(data);
        } catch (err) {
            try {
                raw = zlib.inflateRawSync(data);
            } catch (err2) {
                continue;
            }
        }
        // Broj kanala iz veličine podataka (ICC profil ili siva skala ne menjaju veličinu)
        const comps = Math.round(raw.length / (width * height));
        if (comps !== 1 && comps !== 3) continue;
        pages.push({ width, height, comps, raw });
    }
    if (pages.length === 0) return null;

    const last = pages[pages.length - 1];
    const { width, height, comps, raw } = last;
    const step = 4;
    const yStart = Math.floor(height * 0.7);
    const side = { left: { dark: 0, total: 0 }, right: { dark: 0, total: 0 } };
    for (let y = yStart; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
            const i = (y * width + x) * comps;
            const lum = comps === 1 ? raw[i] : raw[i] * 0.3 + raw[i + 1] * 0.59 + raw[i + 2] * 0.11;
            const s = x < width / 2 ? side.left : side.right;
            s.total++;
            if (lum < 110) s.dark++;
        }
    }
    const leftInk = side.left.dark / side.left.total;
    const rightInk = side.right.dark / side.right.total;
    // Mastilo je redak, a ne pun crni pravougaonik (ivica skenera)
    const hasInk = f => f > 0.002 && f < 0.25;
    return { auto: hasInk(leftInk) && hasInk(rightInk), leftInk, rightInk, pages: pages.length };
}

/**
 * Proverava jedan PDF: lista potpisa i napomene (sken potpisa, izmene posle potpisivanja)
 */
/**
 * Sken je slika koja pokriva celu stranu: obe stranice bar oko 1000 px i ukupno 1 Mpx ili više.
 * Mali logo, potpis i široki baner zaglavlja (npr. 2480x760) ne znače sken
 */
export function hasScanImage(text) {
    const re = /\/Subtype\s*\/Image/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        const streamAt = text.indexOf('stream', m.index);
        if (streamAt < 0) continue;
        // Rečnik samo ovog objekta: od "obj" do početka toka
        const dict = text.slice(Math.max(text.lastIndexOf('obj', m.index), 0), streamAt);
        const width = Number((dict.match(/\/Width\s+(\d+)/) || [])[1]);
        const height = Number((dict.match(/\/Height\s+(\d+)/) || [])[1]);
        if (Math.min(width, height) >= 1000 && width * height >= 1000000) return true;
    }
    return false;
}

export function checkPdf(name, buf) {
    const sigs = findPdfSignatures(buf);
    const text = buf.toString('latin1');
    const hasImages = hasScanImage(text);
    const est = hasImages ? estimateBilateral(buf) : null;
    return {
        name,
        type: 'pdf',
        signed: sigs.length > 0,
        signatures: sigs.map(s => verifyOne(buf, s)),
        hasImages,
        bilateralAuto: est ? est.auto : null,
        note: sigs.length === 0
            ? (hasImages ? 'Proveri vizuelno potpis na skenu.' : 'Nema digitalni potpis.')
            : null
    };
}

/**
 * Proverava zip: svaki PDF unutra; ostali fajlovi se samo navode
 */
export function checkZipBuffer(zipBuffer, prefix = '', depth = 0) {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries().filter(e => !e.isDirectory);
    if (entries.length > MAX_ENTRIES) throw new Error(`Zip ima više od ${MAX_ENTRIES} fajlova`);

    // Zip u zipu se otvara do jednog nivoa (ugnježdeni dokumenti)
    // Svaki dokument zna zip u kome se nalazi (grupa), a naziv je samo ime fajla
    const container = prefix.replace(/ → $/, '');
    const documents = entries.flatMap(e => {
        const name = e.entryName;
        if (/\.zip$/i.test(name) && depth < MAX_NESTED_DEPTH) {
            return checkZipBuffer(e.getData(), `${name} → `, depth + 1).documents;
        }
        if (!/\.pdf$/i.test(name)) return [{ container, name, type: 'other', signed: null, note: 'Nije PDF, preskočen.' }];
        return [{ ...checkPdf(name, e.getData()), container }];
    });

    return {
        total: documents.length,
        pdfCount: documents.filter(d => d.type === 'pdf').length,
        signedCount: documents.filter(d => d.signed).length,
        documents
    };
}

/**
 * Vraća bajtove jednog PDF-a iz zipa: container je ugnježdeni zip (ili '' ako je PDF direktno u zipu)
 */
export function extractPdf(zipBuffer, container, name) {
    const zip = new AdmZip(zipBuffer);
    if (!container) {
        const entry = zip.getEntry(name);
        if (!entry || entry.isDirectory) throw new Error('PDF nije pronađen');
        return entry.getData();
    }
    const outer = zip.getEntry(container);
    if (!outer) throw new Error('Zip nije pronađen');
    const entry = new AdmZip(outer.getData()).getEntry(name);
    if (!entry || entry.isDirectory) throw new Error('PDF nije pronađen');
    return entry.getData();
}

/**
 * Ključ potvrde je ceo naziv fajla: svaki sken se potvrđuje posebno, jer isti naziv bez vremenskog prefiksa može biti više različitih skenova
 */
export function confirmKey(name) {
    return path.basename(String(name));
}

export function loadConfirmations() {
    return kvLoadAll('signature_confirmations');
}

export function setConfirmation(name, confirmed) {
    const key = confirmKey(name);
    if (confirmed) kvSet('signature_confirmations', key, { confirmedAt: new Date().toISOString() });
    else kvDelete('signature_confirmations', key);
    return { name: key, confirmed: !!confirmed };
}

export function isConfirmed(name, all) {
    return !!all[confirmKey(name)];
}

export function loadBilateral() {
    return kvLoadAll('signature_bilateral');
}

/**
 * Čuva izmenu korisnika za dokument: override (true/false/'single'/'none', ili null za automatsku naznaku) i checked (kvačica)
 */
export function setBilateral(name, patch) {
    const key = confirmKey(name);
    const current = loadBilateral()[key] || { override: null, checked: false };
    const next = { ...current, ...patch };
    kvSet('signature_bilateral', key, next);
    return next;
}
