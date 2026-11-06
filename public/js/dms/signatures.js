// Provera potpisa PDF dokumenata u zip fajlu (proveru radi server)
const SIG_MAX_BYTES = 140 * 1024 * 1024; // zip do 140 MB (server prima do 150 MB)



function sigSetStatus(text) {
    const el = document.getElementById('sigStatus');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'dms-status-badge' + (text ? ' is-busy' : ' dms-hidden');
}

// Dokumenti iz poslednje provere (zip je na serveru, pod sigJobId)
let sigDocs = [];

// Ručna potvrda skeniranog dokumenta kao elektronski potpisanog; pamti se na serveru za buduće skenove
async function sigSetConfirm(idx, on) {
    const doc = sigDocs[idx];
    if (!doc) return;
    try {
        await dmsApi('/api/dms/signatures/confirm', dmsJson({ name: doc.name, confirmed: on }));
        // Isti dokument u ovoj proveri dobija novu oznaku odmah
        sigDocs.forEach(d => { if (d.name === doc.name) d.confirmed = on; });
        sigRefresh();
        sigSetStatus('');
        dmsNotify(on ? 'Potvrda sačuvana.' : 'Potvrda poništena.', 'success');
    } catch (err) {
        sigSetStatus('');
        dmsNotify('Greška: ' + err.message, 'error');
    }
}

// Otvara PDF iz zipa u novom tabu (pregledač PDF-ova)
async function sigPreview(idx) {
    const doc = sigDocs[idx];
    if (!doc || !sigJobId) return dmsNotify('Ponovo izaberite zip za pregled.', 'error');
    sigSetStatus('Učitavanje PDF-a...');
    // Tab se otvara odmah (klik korisnika), da ga pregledač ne blokira posle asinhronog zahteva
    const win = window.open('', '_blank');
    try {
        const res = await fetch('/api/dms/signatures/pdf', dmsJson({ jobId: sigJobId, container: doc.container || '', name: doc.name }));
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'PDF nije dostupan');
        }
        const url = URL.createObjectURL(await res.blob());
        if (win) win.location.href = url;
        sigSetStatus('');
    } catch (err) {
        if (win) win.close();
        sigSetStatus('');
        dmsNotify('Greška: ' + err.message, 'error');
    }
}

// Fajl prevučen u prozor (ako nije izabran preko dugmeta)
let sigDropped = null;

function sigPickedFile() {
    return sigDropped || (document.getElementById('sigFile').files[0] || null);
}

function sigSetDropped(file) {
    sigDropped = file;
    const input = document.getElementById('sigFile');
    if (input) input.value = '';
    const hint = document.getElementById('sigDropHint');
    if (hint) hint.textContent = file ? `Izabrano: ${file.name}` : 'Ili prevucite zip fajl u ovo polje';
}




// Veličina dodatog sadržaja posle potpisa, u čitljivom obliku (KB ili MB)
function sigFormatBytes(bytes) {
    if (!bytes) return '0 KB';
    return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

// Jedan red po dokumentu: ispravan, izmenjen posle potpisa, neispravan ili nepotpisan
function sigDocStatus(doc) {
    if (doc.type !== 'pdf') return { tone: 'slate', text: 'Nije PDF (preskočen)' };
    // Bez elektronskog potpisa: sken (moguć fizički potpis) je svetlo zeleno, a bez slika nema potpis (crveno)
    if (!doc.signed) {
        if (doc.confirmed) return { tone: 'dark', text: 'Elektronski potpis: ručno potvrđen (sken)' };
        // Ručno označen dokument sa jednom ugovornom stranom: srednje zeleno, može da se izmeni
        if (doc.bilateralOverride === 'single') return { tone: 'mid', text: 'Ručno označeno: jedna ugovorna strana' };
        // Pečat je prepoznat automatski, ali ga korisnik nije potvrdio: srednje zeleno
        if (doc.analysis && doc.analysis.stamps >= 1) return { tone: 'mid', text: 'Elektronski potpis: vidljiv pečat na skenu' };
        return doc.hasImages
            ? { tone: 'light', text: 'Bez elektronskog potpisa: sken, moguć fizički potpis' }
            : { tone: 'rose', text: 'Bez potpisa' };
    }
    const bad = doc.signatures.find(s => !s.valid);
    if (bad) return { tone: 'amber', text: 'Potpis nije ispravan' };
    if (doc.signatures.some(s => !s.coversWholeFile)) return { tone: 'amber', text: 'Potpisan, ali je menjan posle potpisa' };
    // Tamno zeleno: ispravan elektronski potpis, bez skeniranih slika; svetlo zeleno: ispravan potpis, ali je dokument skeniran
    // Elektronski potpis je ispravan: tamno zeleno, bez obzira na sken (može biti i fizički potpis)
    return { tone: 'dark', text: doc.hasImages ? 'Elektronski potpis: ispravan (PDF), ima i sken' : 'Elektronski potpis: ispravan (PDF)' };
}

const SIG_TONE = {
    dark: 'dms-tone-dark',
    mid: 'dms-tone-mid',
    light: 'dms-tone-light',
    amber: 'dms-tone-amber',
    rose: 'dms-tone-rose',
    slate: 'dms-tone-slate'
};

function sigRenderDoc(doc) {
    const st = sigDocStatus(doc);
    const sigs = (doc.signatures || []).map(s => {
        const when = s.signingTime ? new Date(s.signingTime).toLocaleString('sr-RS', { dateStyle: 'short', timeStyle: 'short' }) : 'nije navedeno u potpisu';
        const valid = s.certValidTo ? new Date(s.certValidTo).toLocaleDateString('sr-RS') : '–';
        return `
        <div class="dms-sig-signer">
            <div>Potpisnik: <b>${dmsEscapeHtml(s.signer || '–')}</b>${s.issuer ? ` · izdavalac: ${dmsEscapeHtml(s.issuer)}` : ''}</div>
            <div>Vreme potpisa: ${dmsEscapeHtml(when)} · sertifikat važi do: ${dmsEscapeHtml(valid)}${s.certExpired ? ' <b class="dms-text-danger">(istekao)</b>' : ''}</div>
            ${s.coversWholeFile ? '' : `<div class="dms-sig-warning">
                <i  data-lucide="alert-triangle" class="dms-icon-gap"></i>Upozorenje: dokument je menjan posle potpisivanja.
                <span class="dms-sig-warning-note">Posle potpisanog dela dodato je ${dmsEscapeHtml(sigFormatBytes(s.unsignedBytes))} sadržaja. Pročitaj šta je promenjeno pre nego što ga prihvatiš.</span>
            </div>`}
            ${s.error ? `<div class="dms-text-danger">${dmsEscapeHtml(s.error)}</div>` : ''}
        </div>`;
    }).join('');
    return `
    <div class="dms-sig-doc ${SIG_TONE[st.tone]}">
        <div class="dms-sig-doc-head">
            <div class="dms-sig-doc-name">${dmsEscapeHtml(doc.name)} <span class="dms-sig-doc-status">· ${dmsEscapeHtml(st.text)}</span></div>
            <div class="dms-sig-doc-actions">
                ${doc.type === 'pdf' ? `<button type="button" onclick="sigPreview(${doc.idx})" class="dms-btn-xs"><i  data-lucide="eye" class="dms-icon-gap"></i>Prikaži</button>` : ''}
                ${doc.type === 'pdf' && !doc.signed && doc.hasImages ? `<button type="button" onclick="sigSetConfirm(${doc.idx}, ${!doc.confirmed})" class="dms-btn-xs">${doc.confirmed ? 'Poništi potvrdu' : 'Ispravno potpisan dokument'}</button>` : ''}
            </div>
        </div>
        ${sigs}
        ${doc.note ? `<div class="dms-sig-doc-note">${dmsEscapeHtml(doc.note)}</div>` : ''}
        ${doc.type === 'pdf' && (doc.hasImages || doc.signed) ? sigBilateralRow(doc, st.tone === 'dark' && doc.bilateral != null && (doc.bilateralOverride != null || doc.bilateralSure !== false)) : ''}
    </div>`;
}

// Potpisan dokument: Obostrano, Jedna strana ili Nije potpisan; zaključano za završene dokumente
function sigBilateralRow(doc, locked = false) {
    const manual = doc.bilateralOverride !== null && doc.bilateralOverride !== undefined;
    // Nesiguran automatski predlog: prikazuje se predlog i oznaka Nesigurno, a nijedno dugme nije označeno
    const unsure = !manual && doc.bilateralSure === false;
    const stateOf = v => (v === true ? 'obostrano' : (v === 'single' || v === false ? 'jedna' : (v === 'none' ? 'nije' : null)));
    const stateLabel = { obostrano: 'Obostrano', jedna: 'Jedna strana', nije: 'Nije potpisan' };
    const autoKey = stateOf(doc.bilateralAuto);
    const eff = manual || !unsure ? stateOf(doc.bilateral) : null;
    const source = manual ? 'Ručno' : (unsure ? `Predlog: ${stateLabel[autoKey] || 'nije poznat'}` : 'Automatski');
    const unsureTag = unsure ? '<span class="dms-badge is-warning">Nesigurno</span>' : '';
    // Klik na automatski izbor briše ručnu vrednost, pa ostaje automatska
    const stateBtn = (key, label) => `
        <button type="button" ${locked ? 'disabled' : ''} onclick="sigSetBilateral(${doc.idx}, '${key === autoKey ? 'auto' : key}')"
            class="dms-btn-xs ${eff === key ? 'is-active' : ''}">${label}</button>`;
    return `
    <div class="dms-sig-bilateral">
        <span class="dms-strong">Potpisan dokument:</span>
        ${stateBtn('obostrano', 'Obostrano')}
        ${stateBtn('jedna', 'Jedna strana')}
        ${stateBtn('nije', 'Nije potpisan')}
        ${unsureTag}
        <span class="dms-caption">${source}</span>
        <span class="dms-caption">${doc.analysis ? `OCR: ${doc.analysis.stamps}; potpis (sken): ${doc.analysis.labels}; plavih tragova u potpisnom delu: ${doc.analysis.inkMarks ?? '–'}` : ''}</span>
        ${doc.analysis && doc.analysis.skippedPages ? `<span class="dms-badge is-danger">Nije analizirano strana: ${doc.analysis.skippedPages}</span>` : ''}
    </div>`;
}
// Čuva izmenu korisnika (Obostrano / Jedna strana / Nije potpisan / Automatski) i osvežava prikaz
async function sigSetBilateral(idx, choice) {
    const doc = sigDocs[idx];
    if (!doc) return;
    const body = { name: doc.name };
    const overrides = { obostrano: true, jedna: 'single', nije: 'none', auto: null };
    if (choice !== undefined) body.override = choice in overrides ? overrides[choice] : null;
    try {
        const data = await dmsApi('/api/dms/signatures/bilateral', dmsJson(body));
        sigDocs.forEach(d => {
            if (d.name !== doc.name) return;
            d.bilateralOverride = data.override;
            const manual = data.override !== null && data.override !== undefined;
            d.bilateral = manual ? data.override : d.bilateralAuto;
        });
        sigRefresh();
    } catch (err) {
        dmsNotify('Greška: ' + err.message, 'error');
    }
}

// Boje u rezimeu (isti tonovi kao u redovima dokumenata)
const SUMMARY_TONES = [
    { tone: 'dark', label: 'tamno zeleno', swatch: 'dms-tone-dark', desc: 'Završeno: ispravan elektronski potpis u PDF-u ili sken koji si ručno potvrdio. Da/Ne se ne menja.' },
    { tone: 'mid', label: 'srednje zeleno', swatch: 'dms-tone-mid', desc: 'Program je na skenu prepoznao elektronski pečat ili si ručno označio jednu ugovornu stranu, ali nisi potvrdio elektronski potpis. Može da se izmeni.' },
    { tone: 'light', label: 'svetlo zeleno', swatch: 'dms-tone-light', desc: 'Sken bez elektronskog potpisa. Moguć je fizički potpis, proveri vizuelno.' },
    { tone: 'amber', label: 'žuto', swatch: 'dms-tone-amber', desc: 'Elektronski potpis nije ispravan ili je dokument menjan posle potpisivanja.' },
    { tone: 'rose', label: 'crveno', swatch: 'dms-tone-rose', desc: 'Nema potpisa: nema ni elektronskog potpisa ni slika (skena).' }
];

// Rezime po bojama, ažurira se pri svakoj promeni (potvrda, Da/Ne)
function sigRenderSummary() {
    const counts = {};
    let skipped = 0;
    sigDocs.forEach(d => {
        const tone = sigDocStatus(d).tone;
        if (tone === 'slate') skipped++;
        else counts[tone] = (counts[tone] || 0) + 1;
    });
    const chips = SUMMARY_TONES.map(s => `
        <div class="dms-sig-sum-row">
            <span class="dms-sig-swatch ${s.swatch}"></span>
            <div><b>${counts[s.tone] || 0}</b> · ${s.label}<div class="dms-caption">${s.desc}</div></div>
        </div>`).join('');
    document.getElementById('sigSummary').innerHTML = `
        <div>Dokumenata: ${sigDocs.length}${skipped ? ` · preskočeno (nije PDF): ${skipped}` : ''}</div>
        <div class="dms-sig-sum-list">${chips}</div>`;
}

// Osvežava listu dokumenata i rezime
function sigRefresh() {
    document.getElementById('sigResults').innerHTML = sigRenderGroups(sigDocs);
    sigRenderSummary();
}

// Dokumenti po zipu u kome se nalaze; unutar grupe svaki PDF ima svoj red
function sigRenderGroups(documents) {
    const groups = new Map();
    documents.forEach(d => {
        const key = d.container || '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(d);
    });

    return [...groups].map(([key, docs]) => {
        const pdfs = docs.filter(d => d.type === 'pdf');
        const signed = pdfs.filter(d => d.signed).length;
        const title = key || 'Dokumenti direktno u zipu';
        return `
        <div class="dms-panel is-flush">
            <div class="dms-panel-head">
                <span class="dms-break">${dmsEscapeHtml(title)}</span>
                <span class="dms-caption dms-nowrap">PDF: ${pdfs.length} · potpisanih: ${signed}</span>
            </div>
            <div class="dms-stack-sm dms-sig-group-body">${docs.map(sigRenderDoc).join('')}</div>
        </div>`;
    }).join('');
}

// Zip poslednje provere na serveru (za OCR po dokumentu)
let sigJobId = null;

function sigProgress(done, total) {
    const pct = total ? Math.round((done / total) * 100) : 100;
    return `Analiza skenova: ${done} od ${total} (${pct} %)`;
}

// Analiza skenova jedan po jedan, sa procentom u statusu; rezultat se odmah prikazuje u redu dokumenta
async function sigAnalyzePending(scan) {
    const total = scan.total;
    let done = scan.done;
    if (!scan.pending.length) {
        sigSetStatus('');
        return;
    }
    sigSetStatus(sigProgress(done, total));
    for (const p of scan.pending) {
        try {
            const data = await dmsApi('/api/dms/signatures/scan', dmsJson({ jobId: sigJobId, name: p.name, container: p.container }));
            sigDocs.forEach(d => { if (d.name === p.name && (d.container || '') === p.container) Object.assign(d, data.doc); });
        } catch (err) {
            // Sken koji ne uspe ostaje bez analize, a ostali se nastavljaju
        }
        done++;
        sigSetStatus(sigProgress(done, total));
        sigRefresh();
    }
    sigSetStatus('');
    dmsNotify('Analiza skenova je gotova.', 'success');
}

async function runSignatureCheck() {
    const btn = document.getElementById('sigBtnRun');
    const file = sigPickedFile();
    document.getElementById('sigSummary').innerHTML = '';
    document.getElementById('sigResults').innerHTML = '';

    if (!file) return dmsNotify('Izaberite zip fajl.', 'error');
    if (!/\.zip$/i.test(file.name)) return dmsNotify('Fajl mora biti .zip.', 'error');
    if (file.size > SIG_MAX_BYTES) return dmsNotify('Zip je prevelik (najviše 140 MB).', 'error');

    btn.disabled = true;
    sigSetStatus('Provera zipa u toku...');
    try {
        // Zip se šalje kao sirov sadržaj; server ga drži u memoriji za OCR i pregled PDF-ova
        const report = await dmsApi('/api/dms/signatures/check?name=' + encodeURIComponent(file.name), {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: file
        });
        report.documents.forEach((d, i) => { d.idx = i; });
        sigDocs = report.documents;
        sigJobId = report.jobId;
        sigRefresh();
        await sigAnalyzePending(report.scan);
    } catch (err) {
        sigSetStatus('');
        dmsNotify('Provera nije uspela: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}






/* ---------- Stranica "Provera potpisa" ---------- */
let sigPageBuilt = false;

function sigBuildPage() {
    const root = document.getElementById('dms-signatures-root');
    if (!root || sigPageBuilt) return;
    sigPageBuilt = true;
    root.innerHTML = `
        <div class="panel-box-header">
            <div class="panel-title-with-icon">
                <div class="yellow-icon-square"><i data-lucide="file-signature"></i></div>
                <div>
                    <h4>Provera potpisa</h4>
                    <p class="panel-desc">Zip sa PDF dokumentima: da li su potpisani, da li je potpis ispravan i da li je dokument menjan posle potpisivanja</p>
                </div>
            </div>
            <div class="panel-actions-group">
                <span id="sigStatus" class="dms-status-badge dms-hidden"></span>
            </div>
        </div>
        <div class="panel-box-body">
            <div class="dms-sig-grid">
                <aside class="dms-card dms-sig-side">
                    <div id="sigDrop" class="dms-dropzone" style="min-height:110px">
                        <div class="dms-dropzone-icon"><i data-lucide="archive"></i></div>
                        <input type="file" id="sigFile" accept=".zip" class="dms-sig-file">
                        <span id="sigDropHint">Ili prevucite zip fajl u ovo polje</span>
                    </div>
                    <button type="button" id="sigBtnRun" class="btn-yellow-solid-sm dms-sig-run"><i data-lucide="search"></i><span>Proveri</span></button>
                    <p class="dms-caption dms-note-block">Proverava se da li su PDF dokumenti digitalno potpisani, da li je potpis ispravan i da li je dokument menjan posle potpisivanja. Ne proverava se da li je izdavalac sertifikata pouzdan. Sken potpisa (slika) analizira se OCR-om, a rezultat je predlog koji možete ručno da izmenite.</p>
                    <div id="sigSummary" class="dms-note-block"></div>
                </aside>
                <section class="dms-sig-main">
                    <div id="sigResults" class="dms-stack-sm"></div>
                </section>
            </div>
        </div>`;

    const zone = document.getElementById('sigDrop');
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        sigSetDropped(e.dataTransfer.files[0] || null);
    });
    document.getElementById('sigFile').addEventListener('change', e => sigSetDropped(e.target.files[0] || null));
    document.getElementById('sigBtnRun').addEventListener('click', runSignatureCheck);
}

window.DmsSignaturesPage = {
    onTabActivated() { sigBuildPage(); }
};
