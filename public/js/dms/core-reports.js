/**
 * Učitavanje izveštaja (drag & drop / izbor fajlova), vremenska linija, KPI kartice i trend.
 * Izveštaji se šalju na server kao sirov sadržaj (application/octet-stream), ime fajla je u ?filename=.
 */
function setupDragAndDrop() {
    const dropZone = document.getElementById('dropZoneMulti');
    const fileInput = document.getElementById('fileInputMulti');
    const btnBrowse = document.getElementById('btnBrowseFiles');

    if (!dropZone || !fileInput || dropZone.dataset.ready) return;
    dropZone.dataset.ready = '1';

    dropZone.addEventListener('click', () => fileInput.click());
    if (btnBrowse) btnBrowse.addEventListener('click', () => fileInput.click());

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('drag-over');
        }, false);
    });
    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('drag-over');
        }, false);
    });
    dropZone.addEventListener('drop', (e) => {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            processMultipleFiles(Array.from(e.dataTransfer.files));
        }
    }, false);

    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            processMultipleFiles(Array.from(e.target.files));
            fileInput.value = '';
        }
    });
}

// Učitavanje i brisanje izveštaja traži posebnu akciju u roli (server je ionako proverava)
function dmsCanUpload() {
    if (window.UniAccess && typeof window.UniAccess.has === 'function' && !window.UniAccess.has('dms.izvestaji:ucitavanje')) {
        dmsNotify('Nemate dozvolu za učitavanje izveštaja.', 'error');
        return false;
    }
    return true;
}

/**
 * Ekstrahuje i parsira datum iz naziva fajla ili datuma modifikacije
 */
function extractDateInfo(file) {
    const filename = file.name;
    let parsedDate = null;
    let dateFormatted = '';

    // Format 1: YYYYMMDD (npr. 20260715 ili DMS_20260715.xlsx)
    const matchYMD = filename.match(/\b(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/);
    // Format 2: DD.MM.YYYY ili DD-MM-YYYY ili YYYY-MM-DD
    const matchDots = filename.match(/\b(0[1-9]|[12]\d|3[01])[-.](0[1-9]|1[0-2])[-.](20\d{2})\b/);
    const matchISO = filename.match(/\b(20\d{2})[-.](0[1-9]|1[0-2])[-.](0[1-9]|[12]\d|3[01])\b/);

    if (matchYMD) {
        parsedDate = new Date(parseInt(matchYMD[1], 10), parseInt(matchYMD[2], 10) - 1, parseInt(matchYMD[3], 10));
        dateFormatted = `${matchYMD[3]}.${matchYMD[2]}.${matchYMD[1]}.`;
    } else if (matchDots) {
        parsedDate = new Date(parseInt(matchDots[3], 10), parseInt(matchDots[2], 10) - 1, parseInt(matchDots[1], 10));
        dateFormatted = `${matchDots[1]}.${matchDots[2]}.${matchDots[3]}.`;
    } else if (matchISO) {
        parsedDate = new Date(parseInt(matchISO[1], 10), parseInt(matchISO[2], 10) - 1, parseInt(matchISO[3], 10));
        dateFormatted = `${matchISO[3]}.${matchISO[2]}.${matchISO[1]}.`;
    } else {
        parsedDate = new Date(file.lastModified || Date.now());
        const d = String(parsedDate.getDate()).padStart(2, '0');
        const m = String(parsedDate.getMonth() + 1).padStart(2, '0');
        dateFormatted = `${d}.${m}.${parsedDate.getFullYear()}. (fajl)`;
    }

    return { parsedDate, dateFormatted };
}

function dmsSetStatus(html, cls) {
    const badge = document.getElementById('statusBadge');
    if (!badge) return;
    badge.className = 'dms-status-badge' + (cls ? ' ' + cls : '');
    badge.innerHTML = html;
}

/**
 * Obrada više izveštaja istovremeno + čuvanje/ažuriranje na serveru
 */
async function processMultipleFiles(files) {
    if (!dmsCanUpload()) return;
    const validFiles = files.filter(f => /\.xlsx?$/i.test(f.name));
    if (validFiles.length === 0) {
        dmsNotify('Izaberite ispravne Excel (.xlsx ili .xls) fajlove.', 'error');
        return;
    }

    await dmsEnsureLibs();
    for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i];
        dmsSetStatus(`<i data-lucide="loader" class="dms-spin"></i> Obrada ${i + 1}/${validFiles.length}: ${dmsEscapeHtml(file.name)}`, 'is-busy');
        try {
            const buffer = await file.arrayBuffer();
            const wb = XLSX.read(buffer, { type: 'array' });
            await syncUsersFromWorkbook(wb);
            const { parsedDate, dateFormatted } = extractDateInfo(file);

            // Čuvanje/ažuriranje na serveru; ako ne uspe, izveštaj ostaje samo u ovoj sesiji
            try {
                await dmsApi('/api/dms/reports/upload?filename=' + encodeURIComponent(file.name), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/octet-stream' },
                    body: file
                });
            } catch (serverErr) {
                console.warn('[DMS] Greška pri čuvanju na serveru:', serverErr);
                dmsNotify(`"${file.name}" nije sačuvan na serveru: ${serverErr.message}`, 'error');
            }

            const existingIdx = uploadedFiles.findIndex(item => item.name === file.name);
            const newFileObj = {
                id: existingIdx >= 0 ? uploadedFiles[existingIdx].id : Math.random().toString(36).substring(2, 9),
                name: file.name,
                parsedDate,
                dateFormatted,
                workbook: wb
            };
            if (existingIdx >= 0) uploadedFiles[existingIdx] = newFileObj;
            else uploadedFiles.push(newFileObj);
        } catch (err) {
            console.error('[DMS] Greška pri obradi fajla ' + file.name, err);
            dmsNotify(`Fajl "${file.name}" nije moguće pročitati. Proverite da li je oštećen.`, 'error');
        }
    }

    await loadUsersDatabase();
    sortAndRenderTimeline();
    if (uploadedFiles.length >= 1) executeComparison();
}

/**
 * Sortira fajlove hronološki i osvežava UI vremenske linije
 */
function sortAndRenderTimeline() {
    uploadedFiles.sort((a, b) => a.parsedDate - b.parsedDate);
    renderTimelineUI();
    checkReadyState();
}

async function removeFile(fileId) {
    if (!dmsCanUpload()) return;
    const targetFile = uploadedFiles.find(item => item.id === fileId);
    if (!targetFile) return;
    if (!confirm(`Da li ste sigurni da želite da obrišete izveštaj "${targetFile.name}" sa servera?`)) return;
    try {
        await dmsApi('/api/dms/reports/' + encodeURIComponent(targetFile.name), { method: 'DELETE' });
    } catch (err) {
        console.warn('[DMS] Greška pri brisanju sa servera:', err);
        if (!/nije pronađen/i.test(err.message)) {
            dmsNotify('Brisanje nije uspelo: ' + err.message, 'error');
            return;
        }
    }
    uploadedFiles = uploadedFiles.filter(item => item.id !== fileId);
    sortAndRenderTimeline();
    if (uploadedFiles.length >= 1) {
        executeComparison();
    } else {
        document.getElementById('resultsSection').classList.add('dms-hidden');
    }
}

async function clearAllFiles() {
    if (!dmsCanUpload()) return;
    if (uploadedFiles.length === 0) return;
    if (!confirm(`Obrisati svih ${uploadedFiles.length} učitanih izveštaja sa servera?`)) return;
    for (const f of [...uploadedFiles]) {
        try {
            await dmsApi('/api/dms/reports/' + encodeURIComponent(f.name), { method: 'DELETE' });
        } catch (err) {
            console.warn('[DMS] Greška pri brisanju sa servera:', err);
        }
    }
    uploadedFiles = [];
    sortAndRenderTimeline();
    document.getElementById('resultsSection').classList.add('dms-hidden');
}

/**
 * Prikaz vremenske linije učitanih izveštaja
 */
function renderTimelineUI() {
    const container = document.getElementById('timelineContainer');
    if (!container) return;

    if (uploadedFiles.length === 0) {
        container.innerHTML = `<div class="dms-empty">Nije učitan nijedan izveštaj. Prevucite ili izaberite Excel fajlove izveštaja iz različitih perioda.</div>`;
        return;
    }

    const items = uploadedFiles.map((fileItem, idx) => {
        let cls = '';
        let tag = '';
        if (uploadedFiles.length > 1 && idx === 0) { cls = ' is-oldest'; tag = '<span class="dms-tl-tag old">NAJSTARIJI</span>'; }
        else if (uploadedFiles.length > 1 && idx === uploadedFiles.length - 1) { cls = ' is-newest'; tag = '<span class="dms-tl-tag new">NAJNOVIJI</span>'; }
        const name = dmsEscapeHtml(fileItem.name);
        return `
            <div class="dms-tl-item${cls}">
                <div class="dms-tl-main">
                    <div class="dms-tl-icon"><i data-lucide="calendar"></i></div>
                    <div style="min-width:0">
                        <div><span class="dms-tl-date">${dmsEscapeHtml(fileItem.dateFormatted)}</span>${tag}</div>
                        <div class="dms-tl-name" title="${name}">${name}</div>
                    </div>
                </div>
                <div class="dms-tl-actions">
                    <a href="/api/dms/reports/${encodeURIComponent(fileItem.name)}" download="${name}" class="dms-icon-btn" title="Preuzmi fajl"><i data-lucide="download"></i></a>
                    <button type="button" onclick="removeFile('${fileItem.id}')" class="dms-icon-btn is-danger" title="Ukloni izveštaj sa servera"><i data-lucide="x"></i></button>
                </div>
            </div>`;
    }).join('');
    container.innerHTML = `<div class="dms-timeline">${items}</div>`;
}

function checkReadyState() {
    const btn = document.getElementById('btnCompare');
    if (btn) btn.disabled = uploadedFiles.length < 1;
    if (uploadedFiles.length >= 1) {
        dmsSetStatus(`<span class="dms-dot"></span> Učitano ${uploadedFiles.length} izveštaja`, 'is-ready');
    } else {
        dmsSetStatus('<span class="dms-dot"></span> Čekam učitavanje fajlova', '');
    }
}

// Radni listovi su uvek prikazani kad ima rezultata (podmeni je deo stranice)
function setSheetSidebarVisible(visible) {
    document.getElementById('sheetSidebarNav')?.classList.toggle('dms-hidden', !visible);
}

/**
 * Pokretanje višestruke komparativne analitike
 */
function executeComparison() {
    if (uploadedFiles.length < 1) return;

    document.getElementById('resultsSection').classList.remove('dms-hidden');
    setSheetSidebarVisible(true);

    // 1. KPI kartice
    buildMainKPIs();

    // 2. Grafikon trenda
    renderTrendChart();

    // 3. Tabovi se grade tek posle prvog iscrtavanja, da KPI kartice i grafikon ne čekaju na njih
    const tabsContent = document.getElementById('sheetTabContents');
    tabsContent.innerHTML = `<div class="dms-empty">Priprema analize...</div>`;
    setTimeout(buildSheetTabs, 0);
}

// Redovi lista 'Podaci' se parsiraju samo jednom po fajlu (koriste ih KPI, trend i tab "Podaci")
const podaciRowsCache = new WeakMap();
/**
 * Pretvara 2D redove lista u objekte (prvi red su zaglavlja), isto kao XLSX.utils.sheet_to_json,
 * ali bez pravljenja radnog lista: brzo za velike listove
 */
function rowsFromAoa(aoa) {
    if (!aoa || aoa.length === 0) return [];

    const header = aoa[0] || [];
    const keys = [];
    const seen = {};
    for (let c = 0; c < header.length; c++) {
        let key = (header[c] === undefined || header[c] === null || header[c] === '')
            ? '__EMPTY' + (c === 0 ? '' : '_' + c)
            : String(header[c]);
        if (seen[key]) {
            key = key + '_' + seen[key];
            seen[key] = (seen[key] || 1) + 1;
        } else {
            seen[key] = 1;
        }
        keys.push(key);
    }

    const out = [];
    for (let r = 1; r < aoa.length; r++) {
        const row = aoa[r];
        if (!row) continue;
        const obj = {};
        let hasValue = false;
        for (let c = 0; c < keys.length; c++) {
            const v = row[c];
            if (v === undefined || v === null) continue;
            obj[keys[c]] = v;
            hasValue = true;
        }
        if (hasValue) out.push(obj);
    }
    return out;
}

// Svi redovi lista 'Podaci' bez filtera (koristi ih SEF pregled)
function getPodaciRowsAll(workbook) {
    if (podaciRowsCache.has(workbook)) return podaciRowsCache.get(workbook);
    // Ako su sirovi redovi dostupni (učitavanje sa keša), koristimo brzu putanju
    const rows = workbook.rawSheets
        ? rowsFromAoa(workbook.rawSheets['Podaci'])
        : XLSX.utils.sheet_to_json(workbook.Sheets['Podaci'] || {});
    podaciRowsCache.set(workbook, rows);
    return rows;
}

// Redovi za KPI kartice, trend i tab "Podaci": bez sistemskog korisnika, osim ako je prekidač uključen
function getPodaciRows(workbook) {
    const all = getPodaciRowsAll(workbook);
    return kreiraniIncludeSystem ? all : all.filter(r => String(r.Autor || '').trim() !== SYSTEM_AUTHOR);
}

function buildMainKPIs() {
    const oldestWb = uploadedFiles[0].workbook;
    const newestWb = uploadedFiles[uploadedFiles.length - 1].workbook;

    const dataOld = getPodaciRows(oldestWb);
    const dataNew = getPodaciRows(newestWb);

    const totalOld = dataOld.length;
    const totalNew = dataNew.length;
    const diffTotal = totalNew - totalOld;

    const archOld = dataOld.filter(r => r.Status === 'Arhivirano').length;
    const archNew = dataNew.filter(r => r.Status === 'Arhivirano').length;
    const diffArch = archNew - archOld;

    const delOld = dataOld.filter(r => r.Status === 'Obrisano').length;
    const delNew = dataNew.filter(r => r.Status === 'Obrisano').length;

    const pendingOld = totalOld - archOld - delOld;
    const pendingNew = totalNew - archNew - delNew;
    const diffPending = pendingNew - pendingOld;

    const oldestDate = uploadedFiles[0].dateFormatted;

    const kpiContainer = document.getElementById('kpiCards');
    kpiContainer.innerHTML = `
        ${renderKpiCard("Ukupno Dokumenata", totalOld, totalNew, diffTotal, "fa-files", "blue", true, oldestDate)}
        ${renderKpiCard("Arhivirani Dokumenti", archOld, archNew, diffArch, "fa-box-archive", "emerald", true, oldestDate)}
        ${renderKpiCard("Nezavršeni / Zaostali", pendingOld, pendingNew, diffPending, "fa-clock", "amber", false, oldestDate)}
        ${renderKpiCard("Obrisani Dokumenti", delOld, delNew, delNew - delOld, "fa-trash-can", "slate", false, oldestDate)}
    `;

    // Isti prekidač iznad kartica, da se vidi da filter utiče i na njih
    const oldTopToggle = document.getElementById('systemUserToggleTop');
    if (oldTopToggle) oldTopToggle.remove();
    const topToggle = renderSystemUserToggle();
    topToggle.id = 'systemUserToggleTop';
    topToggle.classList.add('dms-toggle-top');
    kpiContainer.insertAdjacentElement('beforebegin', topToggle);
}

function renderKpiCard(title, valOld, valNew, diff, icon, color, higherIsBetter, oldestDate) {
    const isGood = diff === 0 ? true : (higherIsBetter ? diff > 0 : diff < 0);
    const diffSign = diff > 0 ? `+${diff.toLocaleString('sr-RS')}` : diff.toLocaleString('sr-RS');
    const tones = {
        blue:    ['#38bdf8', 'rgba(56, 189, 248, 0.12)', 'rgba(56, 189, 248, 0.25)'],
        emerald: ['#10b981', 'rgba(16, 185, 129, 0.12)', 'rgba(16, 185, 129, 0.25)'],
        amber:   ['#FFB800', 'rgba(255, 184, 0, 0.12)', 'rgba(255, 184, 0, 0.3)'],
        slate:   ['#94a3b8', 'rgba(148, 163, 184, 0.10)', 'rgba(148, 163, 184, 0.25)']
    };
    const [fg, bg, br] = tones[color] || tones.slate;
    const deltaColor = isGood ? 'var(--status-success)' : 'var(--status-error)';
    return `
        <div class="net-kpi-card">
            <div class="kpi-icon-square" style="color:${fg};background:${bg};border:1px solid ${br};"><i class="${icon}"></i></div>
            <div class="kpi-text-block">
                <span class="kpi-label">${dmsEscapeHtml(title).toUpperCase()}</span>
                <strong class="kpi-val" style="color:${fg};">${valNew.toLocaleString('sr-RS')}</strong>
                <span class="kpi-sub">Promena od ${dmsEscapeHtml(oldestDate)}: <b style="color:${deltaColor}">${diffSign}</b></span>
            </div>
        </div>`;
}

/**
 * Prikaz vremenskog trenda kroz sve učitane periode (Chart.js)
 */
function renderTrendChart() {
    const ctx = document.getElementById('trendChart');
    if (!ctx) return;

    const labels = uploadedFiles.map(f => f.dateFormatted);

    const totalData = [];
    const archData = [];
    const pendingData = [];
    const delData = [];

    uploadedFiles.forEach(fileItem => {
        const rows = getPodaciRows(fileItem.workbook);
        const total = rows.length;
        const arch = rows.filter(r => r.Status === 'Arhivirano').length;
        const del = rows.filter(r => r.Status === 'Obrisano').length;
        const pending = total - arch - del;

        totalData.push(total);
        archData.push(arch);
        pendingData.push(pending);
        delData.push(del);
    });

    if (trendChartInstance) {
        trendChartInstance.destroy();
    }

    trendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Ukupno dokumenata',
                    data: totalData,
                    borderColor: '#2563eb',
                    backgroundColor: 'rgba(37, 99, 235, 0.08)',
                    tension: 0.3,
                    fill: true,
                    pointRadius: 5,
                    pointHoverRadius: 7
                },
                {
                    label: 'Arhivirani dokumenti',
                    data: archData,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.08)',
                    tension: 0.3,
                    fill: true,
                    pointRadius: 5,
                    pointHoverRadius: 7
                },
                {
                    label: 'Nezavršeni / Zaostali',
                    data: pendingData,
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.08)',
                    tension: 0.3,
                    fill: true,
                    pointRadius: 5,
                    pointHoverRadius: 7
                },
                {
                    label: 'Obrisani dokumenti',
                    data: delData,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.08)',
                    tension: 0.3,
                    fill: true,
                    pointRadius: 5,
                    pointHoverRadius: 7
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { font: { family: "'Segoe UI', sans-serif", size: 12, weight: 'bold' } }
                },
                tooltip: { mode: 'index', intersect: false }
            },
            scales: {
                x: {
                    grid: { display: false },
                    title: { display: true, text: 'Vremenski Periodi', font: { weight: 'bold' } }
                },
                y: {
                    beginAtZero: false,
                    grid: { color: 'rgba(148,163,184,0.12)' },
                    title: { display: true, text: 'Broj Dokumenata', font: { weight: 'bold' } }
                }
            }
        }
    });
}



