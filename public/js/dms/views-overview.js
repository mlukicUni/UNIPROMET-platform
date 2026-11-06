/**
 * Parsira podatke o kreiranim dokumentima po sektorima, lokacijama i zaposlenima.
 * Uvek koristi sirove podatke iz lista 'Podaci' (ako postoje) kako bi se meseci i godine
 * precizno razdvojili i hronološki sortirali (npr. Dec '25, Jan '26... Okt '26),
 * sprečavajući da se decembar iz prethodne (2025.) godine pomeša sa tekućom 2026. godinom.
 */
// Rezultat parsiranja se kešira po radnoj knjizi: isti fajl se ne parsira ponovo za svaki tab i grafikon
const kreiraniParsedCache = new WeakMap();
// Automatski uvoz sa SEF-a vodi se pod sistemskim korisnikom; podrazumevano se isključuje iz statistika po službama
const SYSTEM_AUTHOR = 'DMS Admin';
let kreiraniIncludeSystem = false;
function getKreiraniParsed(wb) {
    const mode = kreiraniIncludeSystem ? 'all' : 'manual';
    if (!kreiraniParsedCache.has(wb)) kreiraniParsedCache.set(wb, {});
    const byMode = kreiraniParsedCache.get(wb);
    if (!byMode[mode]) byMode[mode] = parseKreiraniPoSektorimaFromWorkbook(wb, kreiraniIncludeSystem);
    return byMode[mode];
}

// Prekidač za sistemskog korisnika; menja podatke u tabovima po službama
function renderSystemUserToggle() {
    const label = document.createElement('label');
    // 'system-user-toggle' je samo oznaka za JS (querySelectorAll u setSystemUserMode)
    label.className = 'system-user-toggle dms-toggle dms-overview-toggle';
    label.innerHTML = `<input type="checkbox" ${kreiraniIncludeSystem ? 'checked' : ''}> <span>Uključi automatski unos sistemskog korisnika (<strong>${SYSTEM_AUTHOR}</strong>)</span>`;
    label.querySelector('input').addEventListener('change', (e) => {
        setSystemUserMode(e.target.checked);
    });
    return label;
}

// Ponovo iscrtava tabove koji zavise od filtera i već su otvoreni (Podaci, po sektorima, Nagle, Zaposleni)
function refreshSectorTabs() {
    [0, 1, 2, 5].forEach(i => {
        const el = document.getElementById(`sheetContent_${i}`);
        if (!el || el.childElementCount === 0) return;
        el.innerHTML = '';
        el.appendChild(renderMultiSheetAnalysis(SHEET_TABS_LIST[i]));
    });
}

// Jedan prekidač za ceo prikaz: menja KPI kartice, trend, tab "Podaci" i tabove po službama
function setSystemUserMode(checked) {
    kreiraniIncludeSystem = checked;
    document.querySelectorAll('.system-user-toggle input').forEach(cb => { cb.checked = checked; });
    buildMainKPIs();
    renderTrendChart();
    refreshSectorTabs();
}

// SEF pregled: statusi iz kolone "SEF status" u listu 'Podaci' (svi redovi, uključujući automatski unos)
const SEF_STATUS_ORDER = ['Odobreno', 'Poslato', 'Ponovo poslat', 'Storno', 'Odbijeno'];
const SEF_PROBLEM_STATUSES = ['Storno', 'Odbijeno', 'Ponovo poslat'];

function sefEsc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Datum može biti Date objekat, tekst ili Excel serijski broj
function sefDateOf(v) {
    if (v instanceof Date) return isNaN(v) ? null : v;
    // Excel serijski broj je lokalno (zidno) vreme, pa se pomera za offset da dan ostane isti
    if (typeof v === 'number') {
        const ms = Math.round((v - 25569) * 86400000);
        return new Date(ms + new Date(ms).getTimezoneOffset() * 60000);
    }
    const d = new Date(v);
    return isNaN(d) ? null : d;
}

function renderSefOverview() {
    const div = document.createElement('div');
    div.className = 'dms-stack';

    if (uploadedFiles.length === 0) {
        div.innerHTML = `<div class="dms-empty">Nema učitanih fajlova.</div>`;
        return div;
    }

    const latestFile = uploadedFiles[uploadedFiles.length - 1];
    const rows = getPodaciRowsAll(latestFile.workbook);
    const sefRows = rows.filter(r => String(r['SEF status'] || '').trim() !== '');
    const isAuto = r => String(r.Autor || '').trim() === SYSTEM_AUTHOR;

    if (sefRows.length === 0) {
        div.innerHTML = `<div class="dms-panel dms-center dms-text-muted">Nema dokumenata sa SEF statusom u poslednjem izveštaju.</div>`;
        return div;
    }

    // Statusi: prvo redom iz SEF_STATUS_ORDER, pa ostali (ako se pojave)
    const present = new Set(sefRows.map(r => String(r['SEF status']).trim()));
    const statuses = [...SEF_STATUS_ORDER.filter(s => present.has(s)), ...[...present].filter(s => !SEF_STATUS_ORDER.includes(s)).sort()];
    const countOf = (list, st) => list.filter(r => String(r['SEF status']).trim() === st).length;

    // Kartice: ukupno sa SEF statusom i po statusu
    const cards = statuses.map(st => {
        const n = countOf(sefRows, st);
        const share = sefRows.length ? ((n / sefRows.length) * 100).toFixed(1) : '0.0';
        const warn = SEF_PROBLEM_STATUSES.includes(st);
        return `<div class="dms-stat${warn ? ' is-danger' : ''}">
            <div class="dms-stat-label">${sefEsc(st)}</div>
            <div class="dms-stat-value">${n.toLocaleString('sr-RS')}</div>
            <div class="dms-stat-sub">${share} % od ${sefRows.length.toLocaleString('sr-RS')}</div>
        </div>`;
    }).join('');

    // Automatski unos (sistemski korisnik) naspram ručnog, po statusu
    const splitRows = statuses.map(st => {
        const list = sefRows.filter(r => String(r['SEF status']).trim() === st);
        const auto = list.filter(isAuto).length;
        return `<tr>
            <td class="dms-overview-key-cell">${sefEsc(st)}</td>
            <td class="dms-num">${auto.toLocaleString('sr-RS')}</td>
            <td class="dms-num">${(list.length - auto).toLocaleString('sr-RS')}</td>
            <td class="dms-num dms-strong">${list.length.toLocaleString('sr-RS')}</td>
        </tr>`;
    }).join('');

    // Mesečni pregled: redovi su meseci kreiranja (hronološki), kolone statusi
    const monthMap = new Map();
    sefRows.forEach(r => {
        const y = Number(r['Godina kreiranja']);
        const m = Number(r['Mesec kreiranja']);
        if (!y || !m) return;
        const key = `${y}-${String(m).padStart(2, '0')}`;
        if (!monthMap.has(key)) monthMap.set(key, { y, m, counts: {} });
        const st = String(r['SEF status']).trim();
        monthMap.get(key).counts[st] = (monthMap.get(key).counts[st] || 0) + 1;
    });
    const monthRows = [...monthMap.keys()].sort().map(key => {
        const mo = monthMap.get(key);
        const total = Object.values(mo.counts).reduce((a, b) => a + b, 0);
        const cells = statuses.map(st => {
            const n = mo.counts[st] || 0;
            const warn = SEF_PROBLEM_STATUSES.includes(st) && n > 0;
            return `<td class="dms-num${warn ? ' is-danger' : ''}">${n ? n.toLocaleString('sr-RS') : '–'}</td>`;
        }).join('');
        return `<tr><td class="dms-overview-key-cell">${mo.m}/${mo.y}</td>${cells}<td class="dms-num dms-strong">${total.toLocaleString('sr-RS')}</td></tr>`;
    }).join('');

    // Lista problematičnih dokumenata (storno, odbijeni, ponovo poslati), najnoviji prvi
    const problems = sefRows
        .filter(r => SEF_PROBLEM_STATUSES.includes(String(r['SEF status']).trim()))
        .map(r => ({ r, date: sefDateOf(r['Datum kreiranja']) }))
        .sort((a, b) => (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0));
    const LIST_LIMIT = 300;
    const problemRows = problems.slice(0, LIST_LIMIT).map(({ r, date }) => `<tr>
            <td class="dms-nowrap">${date ? date.toLocaleDateString('sr-RS') : '–'}</td>
            <td>${sefEsc(r['Naziv dokumenta'])}</td>
            <td>${sefEsc(r['Vrsta'])}</td>
            <td>${sefEsc(r['Naziv partnera/zaposlenog NAV'])}</td>
            <td class="is-danger">${sefEsc(r['SEF status'])}</td>
            <td>${sefEsc(r['Autor'])}</td>
            <td>${sefEsc(r['Služba'])}</td>
        </tr>`).join('');

    div.innerHTML = `
        <div>
            <h4 class="dms-title">SEF statusi (poslednji izveštaj: ${sefEsc(latestFile.dateFormatted)})</h4>
            <p class="dms-subtitle">Dokumenti sa popunjenim SEF statusom: <strong>${sefRows.length.toLocaleString('sr-RS')}</strong> od ${rows.length.toLocaleString('sr-RS')}. Uključen je i automatski unos.</p>
        </div>
        <div class="dms-grid cols-5">${cards}</div>
        <div class="dms-grid cols-2">
            <div class="dms-panel is-flush">
                <div class="dms-panel-head">Automatski unos (${sefEsc(SYSTEM_AUTHOR)}) naspram ručnog</div>
                <div class="dms-scroll-x">
                    <table class="dms-table">
                        <thead><tr><th>SEF status</th><th class="dms-num">Automatski</th><th class="dms-num">Ručno</th><th class="dms-num">Ukupno</th></tr></thead>
                        <tbody>${splitRows}</tbody>
                    </table>
                </div>
            </div>
            <div class="dms-panel is-flush">
                <div class="dms-panel-head">Po mesecu kreiranja</div>
                <div class="dms-scroll-x">
                    <table class="dms-table">
                        <thead><tr><th>Mesec</th>${statuses.map(st => `<th class="dms-num">${sefEsc(st)}</th>`).join('')}<th class="dms-num">Ukupno</th></tr></thead>
                        <tbody>${monthRows}</tbody>
                    </table>
                </div>
            </div>
        </div>
        <div class="dms-panel is-flush">
            <div class="dms-panel-head">Storno, odbijeni i ponovo poslati (${problems.length.toLocaleString('sr-RS')}${problems.length > LIST_LIMIT ? `, prikazano prvih ${LIST_LIMIT}` : ''})</div>
            <div class="dms-scroll-x">
                <table class="dms-table">
                    <thead><tr><th>Datum</th><th>Naziv dokumenta</th><th>Vrsta</th><th>Partner</th><th>SEF status</th><th>Autor</th><th>Služba</th></tr></thead>
                    <tbody>${problemRows || `<tr><td class="dms-text-muted" colspan="7">Nema storno, odbijenih ni ponovo poslatih dokumenata.</td></tr>`}</tbody>
                </table>
            </div>
        </div>
    `;
    return div;
}

// Sheet kao niz objekata (koristi sirove redove ako postoje, kao i ostali tabovi)
function sheetObjectsOf(wb, name) {
    if (wb.rawSheets) return wb.rawSheets[name] ? rowsFromAoa(wb.rawSheets[name]) : null;
    return wb.Sheets && wb.Sheets[name] ? XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null }) : null;
}

// Vrste dokumenata: katalog iz lista 'Definisane vrste dokumenata' i broj dokumenata po vrsti iz 'Podaci'
function renderDocTypesOverview() {
    const div = document.createElement('div');
    div.className = 'dms-stack';

    if (uploadedFiles.length === 0) {
        div.innerHTML = `<div class="dms-empty">Nema učitanih fajlova.</div>`;
        return div;
    }

    const latestFile = uploadedFiles[uploadedFiles.length - 1];
    const catRows = sheetObjectsOf(latestFile.workbook, 'Definisane vrste dokumenata');
    if (!catRows) {
        div.innerHTML = `<div class="dms-panel dms-center dms-text-muted">U poslednjem izveštaju nema lista „Definisane vrste dokumenata“.</div>`;
        return div;
    }

    const catalog = new Map();
    catRows.forEach(r => {
        const name = String(r['Naziv'] || '').trim();
        if (!name || catalog.has(name)) return;
        catalog.set(name, {
            name,
            code: String(r['Oznaka delovodnog broja'] || '').trim(),
            active: String(r['Aktivan'] || '').trim() === 'Aktivno',
            sign: String(r['Digitalni potpis'] || '').trim() === 'Da',
            total: 0, auto: 0, lastDate: null
        });
    });

    // Vrste koje se pojavljuju u dokumentima, a nisu u katalogu
    const extra = new Map();
    const entryFor = name => {
        if (catalog.has(name)) return catalog.get(name);
        if (!extra.has(name)) extra.set(name, { name, code: '', active: null, sign: false, total: 0, auto: 0, lastDate: null });
        return extra.get(name);
    };

    getPodaciRowsAll(latestFile.workbook).forEach(r => {
        const name = String(r['Vrsta'] || '').trim();
        if (!name) return;
        const t = entryFor(name);
        t.total++;
        if (String(r.Autor || '').trim() === SYSTEM_AUTHOR) t.auto++;
        const d = sefDateOf(r['Datum kreiranja']);
        if (d && (!t.lastDate || d > t.lastDate)) t.lastDate = d;
    });

    const list = [...catalog.values(), ...extra.values()].sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name, 'sr'));
    const cat = [...catalog.values()];
    const fmt = n => n.toLocaleString('sr-RS');
    const activeCount = cat.filter(t => t.active).length;
    const signTypes = cat.filter(t => t.sign);
    const activeNoUse = cat.filter(t => t.active && t.total === 0).length;
    const signDocs = signTypes.reduce((s, t) => s + t.total, 0);
    const extraDocs = [...extra.values()].reduce((s, t) => s + t.total, 0);

    // Koje vrste se označavaju u tabeli kada se klikne odgovarajuća kartica
    const DOC_TYPE_MARKS = {
        active: t => t.active === true,
        inactive: t => t.active === false,
        sign: t => t.sign,
        idle: t => t.active === true && t.total === 0,
        signDocs: t => t.sign,
        extra: t => t.active === null
    };

    const cards = [
        ['active', 'Aktivne vrste', fmt(activeCount), false],
        ['inactive', 'Neaktivne vrste', fmt(cat.length - activeCount), false],
        ['sign', 'Sa digitalnim potpisom', fmt(signTypes.length), false],
        ['idle', 'Aktivne bez dokumenata', fmt(activeNoUse), activeNoUse > 0],
        ['signDocs', 'Dokumenata u vrstama sa potpisom', fmt(signDocs), false],
        ['extra', 'Dokumenata van kataloga', fmt(extraDocs), extraDocs > 0]
    ].map(([key, label, value, warn]) => `<div data-doc-mark="${key}" role="button" tabindex="0" title="Klik označava vrste u tabeli" class="dms-stat dms-overview-mark-card${warn ? ' is-warning' : ''}">
            <div class="dms-stat-label">${label}</div>
            <div class="dms-stat-value">${value}</div>
        </div>`).join('');

    const noteFor = t => {
        if (t.active === null) return '<span class="dms-overview-flag is-danger">Nije u katalogu</span>';
        if (!t.active && t.total > 0) return '<span class="dms-overview-flag is-warning">Neaktivna, a još se koristi</span>';
        if (t.active && t.total === 0) return '<span class="dms-overview-flag is-muted">Aktivna, nema dokumenata</span>';
        return '';
    };

    const tableRows = list.map((t, i) => `<tr data-doc-row="${i}" class="${t.active === false ? 'dms-overview-row-inactive' : ''}">
            <td class="dms-overview-key-cell">${sefEsc(typeLabel(t.name))}</td>
            <td>${sefEsc(t.code)}</td>
            <td>${t.active === null ? '–' : (t.active ? 'Da' : 'Ne')}</td>
            <td>${t.sign ? '<span class="dms-badge is-info">Da</span>' : 'Ne'}</td>
            <td class="dms-num dms-strong">${fmt(t.total)}</td>
            <td class="dms-num">${fmt(t.auto)}</td>
            <td class="dms-num">${fmt(t.total - t.auto)}</td>
            <td class="dms-nowrap">${t.lastDate ? t.lastDate.toLocaleDateString('sr-RS') : '–'}</td>
            <td>${noteFor(t)}</td>
        </tr>`).join('');

    div.innerHTML = `
        <div>
            <h4 class="dms-title">Vrste dokumenata (poslednji izveštaj: ${sefEsc(latestFile.dateFormatted)})</h4>
            <p class="dms-subtitle">Katalog ima ${cat.length} vrsta. Broj dokumenata je iz „Podaci“, uključujući automatski unos.</p>
        </div>
        <div class="dms-grid cols-3">${cards}</div>
        <p data-doc-hint class="dms-overview-hint"></p>
        <div class="dms-panel is-flush">
            <div class="dms-scroll-x">
                <table class="dms-table">
                    <thead><tr><th>Vrsta</th><th>Oznaka</th><th>Aktivna</th><th>Digitalni potpis</th><th class="dms-num">Dokumenata</th><th class="dms-num">Automatski</th><th class="dms-num">Ručno</th><th>Poslednji</th><th>Napomena</th></tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>
        </div>
        <p class="dms-caption dms-overview-note">Dokumenti u sistemu nisu povezani sa PDF fajlovima iz provere potpisa, pa se ovde ne proverava da li su potpisani. Ovaj pregled pokazuje samo koje vrste zahtevaju digitalni potpis i koliko ih ima.</p>
    `;

    // Klik na karticu označava odgovarajuće vrste u tabeli; ponovni klik na istu karticu poništava oznaku
    let markKey = null;
    const applyMark = () => {
        const hint = div.querySelector('[data-doc-hint]');
        let first = null;
        let count = 0;
        div.querySelectorAll('[data-doc-row]').forEach(tr => {
            const on = markKey !== null && DOC_TYPE_MARKS[markKey](list[Number(tr.dataset.docRow)]);
            if (on) {
                tr.classList.add('is-selected');
                count++;
                first = first || tr;
            } else {
                tr.classList.remove('is-selected');
            }
        });
        div.querySelectorAll('[data-doc-mark]').forEach(card => {
            if (card.dataset.docMark === markKey) card.classList.add('is-selected');
            else card.classList.remove('is-selected');
        });
        hint.textContent = markKey ? `Označeno ${fmt(count)} vrsta u tabeli. Klik na istu karticu poništava oznaku.` : '';
        if (first) first.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    div.addEventListener('click', e => {
        const card = e.target.closest('[data-doc-mark]');
        if (!card) return;
        markKey = markKey === card.dataset.docMark ? null : card.dataset.docMark;
        applyMark();
    });
    div.addEventListener('keydown', e => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-doc-mark]')) {
            e.preventDefault();
            e.target.click();
        }
    });
    return div;
}

// Zaposleni: broj dokumenata, poslednja aktivnost i SEF problemi po autoru (iz 'Podaci')
const EMP_IDLE_DAYS = 90;

function renderEmployeesOverview() {
    const div = document.createElement('div');
    div.className = 'dms-stack';

    if (uploadedFiles.length === 0) {
        div.innerHTML = `<div class="dms-empty">Nema učitanih fajlova.</div>`;
        return div;
    }

    const latestFile = uploadedFiles[uploadedFiles.length - 1];
    const rows = getPodaciRows(latestFile.workbook);
    if (rows.length === 0) {
        div.innerHTML = `<div class="dms-panel dms-center dms-text-muted">Nema dokumenata u poslednjem izveštaju.</div>`;
        return div;
    }

    const fmt = n => n.toLocaleString('sr-RS');

    // Referentni datum je poslednji datum kreiranja u izveštaju, ne današnji datum
    let refTime = 0;
    rows.forEach(r => {
        const d = sefDateOf(r['Datum kreiranja']);
        if (d && d.getTime() > refTime) refTime = d.getTime();
    });

    const emps = new Map();
    const monthSet = new Set();
    rows.forEach(r => {
        const name = String(r.Autor || '').trim() || 'Nepoznat autor';
        if (!emps.has(name)) emps.set(name, { name, total: 0, sectors: {}, months: {}, last: 0, problems: 0, deleted: 0 });
        const e = emps.get(name);
        e.total++;

        const sluzba = String(r['Služba'] || '').trim();
        if (sluzba) e.sectors[sluzba] = (e.sectors[sluzba] || 0) + 1;

        const y = Number(r['Godina kreiranja']);
        const m = Number(r['Mesec kreiranja']);
        if (y && m) {
            const key = `${y}-${String(m).padStart(2, '0')}`;
            monthSet.add(key);
            e.months[key] = (e.months[key] || 0) + 1;
        }

        const d = sefDateOf(r['Datum kreiranja']);
        if (d && d.getTime() > e.last) e.last = d.getTime();
        if (SEF_PROBLEM_STATUSES.includes(String(r['SEF status'] || '').trim())) e.problems++;
        if (r.Status === 'Obrisano') e.deleted++;
    });

    const months = [...monthSet].sort();
    const list = [...emps.values()].map(e => {
        const top = Object.entries(e.sectors).sort((a, b) => b[1] - a[1])[0];
        return {
            ...e,
            sector: top ? top[0] : '–',
            activeMonths: Object.keys(e.months).length,
            idleDays: e.last && refTime ? Math.floor((refTime - e.last) / 86400000) : null
        };
    }).sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name, 'sr'));

    const totalDocs = rows.length;
    const idleList = list.filter(e => e.idleDays !== null && e.idleDays > EMP_IDLE_DAYS);
    const problemEmps = list.filter(e => e.problems > 0);
    const problemTotal = list.reduce((s, e) => s + e.problems, 0);
    const deletedTotal = list.reduce((s, e) => s + e.deleted, 0);

    const cards = [
        ['Zaposleni sa dokumentima', fmt(list.length), '', false],
        [`Bez aktivnosti preko ${EMP_IDLE_DAYS} dana`, fmt(idleList.length), '', idleList.length > 0],
        ['Sa storno, odbijenim ili ponovo poslatim', fmt(problemEmps.length), '', problemEmps.length > 0],
        ['Storno, odbijeni i ponovo poslati', fmt(problemTotal), `${(problemTotal / totalDocs * 100).toFixed(1)} % od ${fmt(totalDocs)}`, problemTotal > 0],
        ['Obrisani dokumenti', fmt(deletedTotal), '', false]
    ].map(([label, value, sub, warn]) => `<div class="dms-stat${warn ? ' is-warning' : ''}">
            <div class="dms-stat-label">${label}</div>
            <div class="dms-stat-value">${value}</div>
            ${sub ? `<div class="dms-stat-sub">${sub}</div>` : ''}
        </div>`).join('');

    const tableRows = list.map(e => {
        const idle = e.idleDays !== null && e.idleDays > EMP_IDLE_DAYS;
        const share = e.total ? (e.problems / e.total * 100).toFixed(1) : '0.0';
        return `<tr class="${idle ? 'is-warning' : ''}">
            <td class="dms-overview-key-cell">${sefEsc(e.name)}</td>
            <td>${sefEsc(e.sector)}</td>
            <td class="dms-num dms-strong">${fmt(e.total)}</td>
            <td class="dms-num">${e.activeMonths}</td>
            <td class="dms-nowrap">${e.last ? new Date(e.last).toLocaleDateString('sr-RS') : '–'}</td>
            <td class="dms-num dms-nowrap${idle ? ' is-warning' : ''}">${e.idleDays === null ? '–' : `${e.idleDays} dana`}</td>
            <td class="dms-num${e.problems ? ' is-danger' : ''}">${fmt(e.problems)}</td>
            <td class="dms-num">${share} %</td>
            <td class="dms-num">${fmt(e.deleted)}</td>
        </tr>`;
    }).join('');

    const monthHead = months.map(k => `<th class="dms-num">${Number(k.split('-')[1])}/${k.split('-')[0]}</th>`).join('');
    const monthRows = list.map(e => `<tr>
            <td class="dms-overview-key-cell dms-nowrap">${sefEsc(e.name)}</td>
            ${months.map(k => `<td class="dms-num">${e.months[k] ? fmt(e.months[k]) : '–'}</td>`).join('')}
        </tr>`).join('');

    div.innerHTML = `
        <div>
            <h4 class="dms-title">Zaposleni (poslednji izveštaj: ${sefEsc(latestFile.dateFormatted)})</h4>
            <p class="dms-subtitle">Dokumenata: <strong>${fmt(totalDocs)}</strong>. Automatski unos je ${kreiraniIncludeSystem ? 'uključen' : 'isključen'}.</p>
        </div>
        <div class="dms-grid cols-5">${cards}</div>
        <div class="dms-panel is-flush">
            <div class="dms-scroll-x">
                <table class="dms-table">
                    <thead><tr><th>Zaposleni</th><th>Služba</th><th class="dms-num">Dokumenata</th><th class="dms-num">Aktivnih meseci</th><th>Poslednji dokument</th><th class="dms-num">Bez aktivnosti</th><th class="dms-num">Storno / odbijeni / ponovo</th><th class="dms-num">Udeo</th><th class="dms-num">Obrisani</th></tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>
        </div>
        <div class="dms-panel is-flush">
            <div class="dms-panel-head">Dokumenata po mesecu kreiranja</div>
            <div class="dms-scroll-x">
                <table class="dms-table">
                    <thead><tr><th>Zaposleni</th>${monthHead}</tr></thead>
                    <tbody>${monthRows}</tbody>
                </table>
            </div>
        </div>
        <p class="dms-caption dms-overview-note">Zaposleni je autor dokumenta u „Podaci“. Neaktivnost se računa u odnosu na poslednji datum kreiranja u izveštaju (${new Date(refTime).toLocaleDateString('sr-RS')}). Storno, odbijeni i ponovo poslati su SEF problemi. Obrisani su dokumenti sa statusom „Obrisano“.</p>
    `;
    return div;
}

// Ispravnost dokumentacije: provere nad svim dokumentima, uključujući automatski unos (prekidač ovde ne važi)
// SEF po pravilu posle 20 dana bez prihvatanja račun dobija status Odbijeno
const SEF_STALE_DAYS = 20;
// Lista dokumenata se prikazuje samo ako ima najviše ovoliko redova
const CORRECTNESS_DETAIL_LIMIT = 300;
// Vrste preimenovane u katalogu: stari naziv je neaktivan, a dokumenti su nastali pod njim (nije greška)
const RENAMED_TYPES = new Map([
    ['Odluka o nabavci osnovnog sredstva', 'Zahtev/Odluka o nabavci osnovnog sredstva (Svi)']
]);
// Naziv vrste, uz novi naziv u zagradi ako je vrsta preimenovana (stari naziv ostaje)
const typeLabel = name => RENAMED_TYPES.has(name) ? `${name} (${RENAMED_TYPES.get(name)})` : name;

// origin: 'KUF' (ulazni sa SEF-a), 'KIF' (izlazni sa SEF-a) ili 'Delovodnik' (bez SEF-a)
function renderCorrectnessOverview(origin) {
    const div = document.createElement('div');
    div.className = 'dms-stack';

    if (uploadedFiles.length === 0) {
        div.innerHTML = `<div class="dms-empty">Nema učitanih fajlova.</div>`;
        return div;
    }

    const latestFile = uploadedFiles[uploadedFiles.length - 1];
    const wb = latestFile.workbook;
    const rows = getPodaciRowsAll(wb).filter(r => String(r['Poreklo'] ?? '').trim() === origin);
    if (rows.length === 0) {
        div.innerHTML = `<div class="dms-panel dms-center dms-text-muted">Nema dokumenata u poslednjem izveštaju.</div>`;
        return div;
    }

    const fmt = n => n.toLocaleString('sr-RS');
    const txt = (r, k) => String(r[k] === null || r[k] === undefined ? '' : r[k]).trim();
    const sef = r => txt(r, 'SEF status');
    const timeOf = r => { const d = sefDateOf(r['Datum kreiranja']); return d ? d.getTime() : 0; };
    // Naziv sa reči „test“ (npr. „test1“, „TESTIRANJE“), ne npr. „testere“
    const TEST_NAME_RE = /(^|[^a-zčćšđž])test(iranje)?([^a-zčćšđž]|$)/i;
    const dateText = r => { const d = sefDateOf(r['Datum kreiranja']); return d ? d.toLocaleDateString('sr-RS') : '–'; };

    // Referentni datum: poslednji datum kreiranja u izveštaju
    let refTime = 0;
    rows.forEach(r => { const t = timeOf(r); if (t > refTime) refTime = t; });

    // Katalog vrsta; bez lista 'Definisane vrste dokumenata' provere nad katalogom se ne prikazuju
    const cat = sheetObjectsOf(wb, 'Definisane vrste dokumenata');
    const catalog = new Map();
    (cat || []).forEach(r => {
        const name = txt(r, 'Naziv');
        if (name && !catalog.has(name)) catalog.set(name, { active: txt(r, 'Aktivan') === 'Aktivno', sign: txt(r, 'Digitalni potpis') === 'Da' });
    });

    // SEF status po vrsti: koliko neobrisanih dokumenata vrste ima status, a koliko nema
    const sefByType = new Map();
    rows.forEach(r => {
        if (r.Status === 'Obrisano') return;
        const v = txt(r, 'Vrsta');
        if (!sefByType.has(v)) sefByType.set(v, { filled: 0, empty: 0 });
        const s = sefByType.get(v);
        if (sef(r) !== '') s.filled++; else s.empty++;
    });

    // Objašnjenja provera za korisnike, prikazuju se uz listu dokumenata
    const CHECK_WHY = {
        'Vrsta nije u katalogu': 'Vrsta nema pravila u listi „Definisane vrste dokumenata“. Proveriti da li je vrsta preimenovana ili je treba dodati u katalog.',
        'Obrisan dokument sa SEF statusom Odobreno ili Storno': 'Dokument je već obrisan u DMS-u, a SEF ga je odobrio ili stornirao. Ne preuzimati ponovo sa SEF-a bez provere, jer bi mogla da se proknjiži neispravna faktura. Proveriti razlog brisanja.',
        [`Poslato u SEF-u bez odgovora preko ${SEF_STALE_DAYS} dana`]: 'SEF odbija račun koji nije prihvaćen u roku od 20 dana, pa status „Poslato“ duže od 20 dana nije u skladu sa pravilom. Proveriti u DMS-u ili SEF-u da li je račun prihvaćen ili treba da bude odbijen.',
        'Neprihvaćeni na SEF-u (Odbijeno, Ponovo poslat)': 'Odbijeno: SEF automatski odbija račun posle 20 dana bez prihvatanja. Ponovo poslat: SEF šalje podsetnik posle 15 dana bez prihvatanja.',
        'Testni dokument u sistemu': 'Naziv sadrži reč „test“, a dokument nije obrisan. Verovatno je probni unos koji je ostao u radnom sistemu.',
        'Dodeljeno sistemskom korisniku': 'Dokument je dodeljen DMS Admin, pa ga niko od zaposlenih ne obrađuje. Treba ga dodeliti stvarnom zaposlenom.',
        'Bez službe': 'Dokument nema službu, pa nije u izveštajima po službama. Obično je reč o novom zaposlenom kome služba još nije dodeljena u DMS-u.',
        'Datum ne odgovara godini i mesecu': 'Datum kreiranja se ne slaže sa kolonama „Godina kreiranja“ i „Mesec kreiranja“, ili datum nije važeći.'
    };

    // Mogući dvostruki unosi: isti naziv, partner i vrsta, a bar dva neobrisana dokumenta.
    // Dokumenti koji se razlikuju po partneru ili vrsti nisu u listi.
    const dupKey = r => [txt(r, 'Naziv dokumenta'), txt(r, 'Naziv partnera/zaposlenog NAV'), txt(r, 'Vrsta')].join('|');
    const dupGroups = new Map();
    rows.forEach(r => {
        if (r.Status === 'Obrisano') return;
        const k = dupKey(r);
        if (!dupGroups.has(k)) dupGroups.set(k, []);
        dupGroups.get(k).push(r);
    });
    const possibleDup = new Set();
    dupGroups.forEach(g => { if (g.length > 1) g.forEach(r => possibleDup.add(r)); });
    // Grupe u kojima bar jedan dokument nije arhiviran (nije završen)
    const openKeys = new Set();
    dupGroups.forEach((g, k) => { if (g.length > 1 && g.some(r => r.Status !== 'Arhivirano')) openKeys.add(k); });
    // Redosled i boje: 0 = nije arhiviran (plavo), 1 = arhiviran, a u grupi ima nearhiviranog (svetlije plavo), 2 = bez oznake
    const dupRank = r => {
        if (r.Status !== 'Arhivirano') return 0;
        if (openKeys.has(dupKey(r))) return 1;
        return 2;
    };
    const DUP_CLASSES = ['dms-overview-dup-open', 'dms-overview-dup-related', ''];
    const dupClass = r => DUP_CLASSES[dupRank(r)];
    const dupMarkText = hit => {
        const n = [0, 0, 0];
        hit.forEach(r => { n[dupRank(r)]++; });
        return `plavo: ${fmt(n[0])} · svetlije plavo: ${fmt(n[1])} · bez oznake: ${fmt(n[2])}`;
    };

    // Predračun i račun: naziv dokumenta pokazuje koja je stvarna vrsta (predračun ili faktura/račun)
    const LETTERS = 'a-zčćšđž';
    const INVOICE_NAME_RE = new RegExp(`(^|[^${LETTERS}])(ra[čc]un[${LETTERS}]*|faktur[${LETTERS}]*|invoice|rechnung)`, 'i');
    const PROFORMA_NAME_RE = new RegExp(`(^|[^${LETTERS}])(predra[čc]un[${LETTERS}]*|pro-?forma)`, 'i');

    const checks = [
        {
            label: 'Vrsta nije u katalogu', needsCatalog: true, info: false,
            desc: 'Vrsta dokumenta ne postoji u listi „Definisane vrste dokumenata“.',
            test: r => !catalog.has(txt(r, 'Vrsta'))
        },
        {
            label: 'Neaktivna vrsta, dokument nije obrisan ni arhiviran', needsCatalog: true, info: false,
            desc: 'Vrsta je u katalogu sada neaktivna (blokirana), a dokument iz nje nije ni obrisan ni arhiviran, pa je još aktivan. Označeni su dokumenti čiji naziv ne sadrži „test“.',
            test: r => catalog.has(txt(r, 'Vrsta')) && !catalog.get(txt(r, 'Vrsta')).active && r.Status !== 'Obrisano' && r.Status !== 'Arhivirano',
            mark: r => r.Status !== 'Obrisano' && !TEST_NAME_RE.test(txt(r, 'Naziv dokumenta'))
        },
        {
            label: 'Obrisan dokument sa SEF statusom Odobreno ili Storno', info: false, archive: true,
            desc: 'Status je „Obrisano“, a SEF status je „Odobreno“ ili „Storno“.',
            test: r => r.Status === 'Obrisano' && ['Odobreno', 'Storno'].includes(sef(r))
        },
        {
            label: `Poslato u SEF-u bez odgovora preko ${SEF_STALE_DAYS} dana`, info: false, archive: true,
            desc: `SEF status je „Poslato“, a dokument je stariji od ${SEF_STALE_DAYS} dana u odnosu na poslednji datum u izveštaju. Po pravilu SEF u tom roku odbija neprihvaćen račun, pa ovakav status nije u skladu sa pravilom.`,
            test: r => sef(r) === 'Poslato' && refTime - timeOf(r) > SEF_STALE_DAYS * 86400000
        },
        {
            label: 'Neprihvaćeni na SEF-u (Odbijeno, Ponovo poslat)', info: false, archive: true,
            desc: 'Odbijeno: SEF ga automatski odbija posle 20 dana bez prihvatanja. Ponovo poslat: SEF šalje podsetnik posle 15 dana bez prihvatanja. Izvoz nema istoriju, pa se ne vidi da li je kasnije prihvaćen.',
            test: r => ['Odbijeno', 'Ponovo poslat'].includes(sef(r))
        },
        {
            label: 'Odbijeno, a arhivirano (samo informacija)', info: true,
            desc: 'Dokument je odbijen na SEF-u, a u DMS-u je arhiviran. Ovo nije greška, razlog može biti dupliranje, nesaglasnost sa kupcem ili nešto drugo. Ne brisati bez provere: brisanje će prouzrokovati ponovno preuzimanje sa SEF-a.',
            test: r => sef(r) === 'Odbijeno' && r.Status === 'Arhivirano'
        },
        {
            label: 'Testni dokument u sistemu', info: false,
            desc: 'Naziv sadrži reč „test“ i dokument nije obrisan. Verovatno je probni unos koji ne bi trebalo da ostane u sistemu.',
            test: r => r.Status !== 'Obrisano' && TEST_NAME_RE.test(txt(r, 'Naziv dokumenta'))
        },
        {
            label: 'Dokument bez SEF statusa u vrsti u kojoj ostali imaju status', info: false,
            test: r => {
                if (r.Status === 'Obrisano') return false;
                const s = sefByType.get(txt(r, 'Vrsta'));
                if (!s || s.filled === 0 || s.empty === 0) return false;
                if (s.filled === s.empty) return true;
                return (sef(r) !== '') === (s.filled < s.empty);
            }
        },
        {
            label: 'Dodeljeno sistemskom korisniku', info: false,
            desc: `Status je „Dodeljeno“, a dodeljen je sistemskom korisniku (${SYSTEM_AUTHOR}), pa dokument ne obrađuje nijedan zaposleni.`,
            test: r => txt(r, 'Status').startsWith('Dodeljeno') && txt(r, 'Status').includes(SYSTEM_AUTHOR)
        },
        {
            label: 'Račun unet kao predračun', info: false,
            desc: 'Vrsta je „Predračun (Svi)“, a naziv dokumenta liči na račun ili fakturu, i dokument nije obrisan. Predračun se plaća pre konačne fakture, a faktura se unosi kroz „Ulazni račun Papir (Finansije)“ i prosleđuje računovodstvu. Proveriti da li je vrsta tačna.',
            test: r => /^predra[čc]un/i.test(txt(r, 'Vrsta')) && r.Status !== 'Obrisano'
                && INVOICE_NAME_RE.test(txt(r, 'Naziv dokumenta')) && !PROFORMA_NAME_RE.test(txt(r, 'Naziv dokumenta'))
        },
        {
            label: 'Predračun unet kao ulazni račun', info: false,
            desc: 'Vrsta je ulazni račun, a naziv dokumenta sadrži „predračun“ ili „proforma“, i dokument nije obrisan. Predračun se unosi kroz vrstu „Predračun (Svi)“ i dodeljuje službi finansija radi plaćanja. Proveriti da li je vrsta tačna.',
            test: r => /^ulazni ra[čc]un/i.test(txt(r, 'Vrsta')) && r.Status !== 'Obrisano'
                && PROFORMA_NAME_RE.test(txt(r, 'Naziv dokumenta'))
        },
        {
            label: 'Moguć dvostruki unos', info: false, sortByName: true,
            desc: 'Isti naziv, partner i vrsta kod bar dva neobrisana dokumenta. Prvo su plavi dokumenti koji nisu arhivirani, odmah iza njih svetlije plavi arhivirani dokumenti iz iste grupe, a na kraju neobojeni. Može biti dvostruki unos, ali može biti i dva različita dokumenta. Proveriti pre brisanja.',
            test: r => possibleDup.has(r),
            markClass: dupClass, markText: dupMarkText, rankOf: dupRank, noLimit: true
        },
        {
            label: 'Bez službe', info: false,
            desc: 'Dokument nema popunjenu službu.',
            test: r => txt(r, 'Služba') === ''
        },
        {
            label: 'Datum ne odgovara godini i mesecu', info: false,
            desc: 'Datum kreiranja se ne slaže sa kolonama „Godina kreiranja“ i „Mesec kreiranja“, ili datum nije važeći.',
            test: r => { const d = sefDateOf(r['Datum kreiranja']); return !d || d.getFullYear() !== Number(r['Godina kreiranja']) || d.getMonth() + 1 !== Number(r['Mesec kreiranja']); }
        }
    ];

    const results = checks
        .filter(c => !c.needsCatalog || cat)
        .map(c => {
            const hit = rows.filter(c.test);
            const auto = hit.filter(r => txt(r, 'Autor') === SYSTEM_AUTHOR).length;
            return { ...c, hit, auto };
        });

    const sectionId = `ispravnost-${origin}`;
    const warnChecks = results.filter(c => !c.info && c.hit.length > 0);
    const infoChecks = results.filter(c => c.info && c.hit.length > 0);
    const okChecks = results.filter(c => c.hit.length === 0);

    // Kartica provere: is-attention = za pregled, bez oznake = samo informacija
    const cardHtml = (c, warn) => `<button type="button" data-jump="${sectionId}-chk-${results.indexOf(c)}" class="dms-stat dms-overview-check-card${warn ? ' is-attention' : ''}">
            <div class="dms-stat-label">${sefEsc(c.label)}</div>
            <div class="dms-stat-value">${fmt(c.hit.length)}</div>
            <div class="dms-stat-sub">automatski: ${fmt(c.auto)} · ručno: ${fmt(c.hit.length - c.auto)}</div>
        </button>`;
    const warnCards = warnChecks.map(c => cardHtml(c, true)).join('');
    const infoCards = infoChecks.map(c => cardHtml(c, false)).join('');
    const okChips = okChecks.map(c => `<span class="dms-badge is-success is-pill"><i data-lucide="check"></i>${sefEsc(c.label)}</span>`).join('');

    // Obrisan dokument koji je ponovo uvučen: isti naziv i partner, jedna kopija obrisana, druga neobrisana
    const reentryGroups = new Map();
    rows.forEach(r => {
        if (!txt(r, 'Naziv partnera/zaposlenog NAV')) return;
        const k = [txt(r, 'Naziv dokumenta'), txt(r, 'Naziv partnera/zaposlenog NAV'), txt(r, 'Vrsta')].join('|');
        if (!reentryGroups.has(k)) reentryGroups.set(k, { deleted: [], live: [] });
        reentryGroups.get(k)[r.Status === 'Obrisano' ? 'deleted' : 'live'].push(r);
    });
    const reentry = [];
    // Ponovo unet je kreiran posle obrisane kopije
    // Za KUF dokumente sa SEF statusom, obrisan + arhiviran par je regularno stanje, pa se ne prikazuje
    const regularPair = l => origin === 'KUF' && sef(l) !== '' && l.Status === 'Arhivirano';
    reentryGroups.forEach(g => g.deleted.forEach(d => g.live.forEach(l => { if (timeOf(l) >= timeOf(d) && !regularPair(l)) reentry.push({ d, l }); })));
    reentry.sort((a, b) => timeOf(b.l) - timeOf(a.l));
    const reentryId = `${sectionId}-reentry`;
    const reentryCard = reentry.length ? `<button type="button" data-jump="${reentryId}" class="dms-stat dms-overview-check-card">
            <div class="dms-stat-label">Obrisan pa ponovo unet (samo informacija)</div>
            <div class="dms-stat-value">${fmt(reentry.length)}</div>
            <div class="dms-stat-sub">isti naziv, partner i vrsta; ponovo unet posle brisanja</div>
        </button>` : '';

    const detailHead = `<tr><th>#</th><th>Datum</th><th>Naziv dokumenta</th><th>Partner</th><th>Vrsta</th><th>Autor</th><th>Status</th><th>SEF status</th><th>eDelovodni broj</th></tr>`;
    // Arhiva po nazivu i partneru: neobrisani dokumenti sa statusom Arhivirano (iz svih vrsta i porekla)
    const archiveKey = r => [txt(r, 'Naziv dokumenta'), txt(r, 'Naziv partnera/zaposlenog NAV')].join('|');
    const archiveByName = new Map();
    getPodaciRowsAll(wb).forEach(r => {
        if (r.Status !== 'Arhivirano') return;
        const k = archiveKey(r);
        if (!archiveByName.has(k)) archiveByName.set(k, []);
        archiveByName.get(k).push(r);
    });
    const archiveCell = r => {
        const found = archiveByName.get(archiveKey(r)) || [];
        if (!found.length) return '<td class="is-danger dms-nowrap">Nije u arhivi</td>';
        return `<td class="is-success dms-nowrap"><div>U arhivi (${fmt(found.length)})</div><div class="dms-overview-archive-sub">${sefEsc(found[0]['eDelovodni broj'])} · ${dateText(found[0])}</div></td>`;
    };

    // Redovi liste dokumenata, isti izgled za sve provere (classFn vraća klasu reda: oznaka tona)
    const docRows = (list, classFn, extraFn) => list.map((r, k) => `<tr class="${classFn ? classFn(r) : ''}">
                <td class="dms-text-dim">${k + 1}</td>
                <td class="dms-nowrap">${dateText(r)}</td>
                <td>${sefEsc(r['Naziv dokumenta'])}</td>
                <td>${sefEsc(r['Naziv partnera/zaposlenog NAV'])}</td>
                <td>${sefEsc(typeLabel(txt(r, 'Vrsta')))}</td>
                <td>${sefEsc(r['Autor'])}</td>
                <td>${sefEsc(r['Status'])}</td>
                <td>${sefEsc(r['SEF status'])}</td>
                <td>${sefEsc(r['eDelovodni broj'])}</td>
                ${extraFn ? extraFn(r) : ''}
            </tr>`).join('');
    // Obrisan pa ponovo unet: oba dokumenta para u istoj tabeli, obrisani označen
    const reentryAccordion = reentry.length ? `<details id="${reentryId}" class="dms-overview-check">
            <summary class="dms-overview-check-summary">
                <span class="dms-overview-check-title">Obrisan pa ponovo unet (samo informacija)</span>
                <span class="dms-badge is-pill">${fmt(reentry.length)} parova</span>
            </summary>
            <div class="dms-overview-check-body">
                <p class="dms-small dms-text-muted">Isti naziv, partner i vrsta: jedna kopija je obrisana, a druga je ponovo uneta posle brisanja i nije obrisana.</p>
                <p class="dms-notice">Može biti dupliranje, pa pre akcije proveriti. Ne brisati bez provere: brisanje će prouzrokovati ponovno preuzimanje sa SEF-a.</p>
            </div>
            <div class="dms-overview-detail-scroll"><table class="dms-table is-sticky"><thead>${detailHead}</thead><tbody>${docRows(reentry.flatMap(({ d, l }) => [d, l]), r => r.Status === 'Obrisano' ? 'is-danger' : '')}</tbody></table></div>
        </details>` : '';
    // Najpre liste za pregled, a informativne na kraju
    const withHits = results.filter(c => c.hit.length > 0);
    const accordions = [...withHits.filter(c => !c.info), ...withHits.filter(c => c.info)].map(c => {
        const i = results.indexOf(c);
        const tooMany = !c.noLimit && c.hit.length > CORRECTNESS_DETAIL_LIMIT;
        const byName = (a, b) => txt(a, 'Naziv dokumenta').localeCompare(txt(b, 'Naziv dokumenta'), 'sr') || timeOf(b) - timeOf(a);
        // Plavi (nearhivirani) i svetlije plavi (arhivirani srodnici) su u jednom bloku po nazivu, nearhivirani prvi
        const dupBlock = r => { const k = c.rankOf(r); return k <= 1 ? 0 : k; };
        const sorted = c.rankOf
            ? c.hit.slice().sort((a, b) => dupBlock(a) - dupBlock(b)
                || dupKey(a).localeCompare(dupKey(b), 'sr')
                || c.rankOf(a) - c.rankOf(b)
                || timeOf(b) - timeOf(a))
            : c.sortByName
                ? c.hit.slice().sort(byName)
                : c.hit.slice().sort((a, b) => timeOf(b) - timeOf(a));
        const rowClass = c.markClass || (r => c.mark && c.mark(r) ? 'dms-overview-row-marked' : '');
        const body = docRows(sorted, rowClass, c.archive ? archiveCell : null);
        const head = c.archive ? detailHead.replace('</tr>', `<th>U arhivi (po nazivu i partneru)</th></tr>`) : detailHead;
        const archived = c.archive ? c.hit.filter(r => (archiveByName.get(archiveKey(r)) || []).length > 0).length : 0;
        const archiveBadge = c.archive ? `<span class="dms-badge is-success is-pill">u arhivi: ${fmt(archived)} · nije: ${fmt(c.hit.length - archived)}</span>` : '';
        const markBadge = c.markClass
            ? `<span class="dms-badge is-violet is-pill">${sefEsc(c.markText(c.hit))}</span>`
            : c.mark ? `<span class="dms-badge is-violet is-pill">označeno: ${fmt(c.hit.filter(c.mark).length)}</span>` : '';
        const why = CHECK_WHY[c.label] || '';
        const listBody = tooMany
            ? `<div class="dms-overview-detail-note">Ima ${fmt(c.hit.length)} dokumenata, pa lista nije prikazana (prikazuje se do ${CORRECTNESS_DETAIL_LIMIT}).</div>`
            : `<div class="dms-overview-detail-scroll"><table class="dms-table is-sticky"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
        return `<details id="${sectionId}-chk-${i}" class="dms-overview-check${c.info ? '' : ' is-attention'}">
            <summary class="dms-overview-check-summary">
                <span class="dms-overview-check-title">${sefEsc(c.label)}</span>
                <span class="dms-badge is-pill">${fmt(c.hit.length)}</span>
                ${markBadge}
                ${archiveBadge}
            </summary>
            <div class="dms-overview-check-body">
                ${c.desc ? `<p class="dms-small dms-text-muted">${sefEsc(c.desc)}</p>` : ''}
                ${why ? `<p class="dms-notice">${sefEsc(why)}</p>` : ''}
            </div>
            ${listBody}
        </details>`;
    }).join('');

    const originTitle = { KUF: 'KUF · ulazni dokumenti sa SEF-a', KIF: 'KIF · izlazni dokumenti sa SEF-a', Delovodnik: 'Delovodnik · dokumenti bez SEF-a' }[origin] || origin;
    const sectionTitle = text => `<h5 class="dms-label dms-overview-section-title">${text}</h5>`;
    const gridCls = 'dms-grid cols-4';

    div.id = sectionId;
    div.className = 'dms-stack dms-overview-correctness';
    div.innerHTML = `
        <div class="dms-spread dms-overview-banner">
            <div>
                <div class="dms-label">${sefEsc(originTitle)}</div>
                <div class="dms-overview-banner-value">${fmt(rows.length)} dokumenata</div>
            </div>
            <div class="dms-caption dms-overview-banner-meta">
                <div>${warnChecks.length} za pregled · ${infoChecks.length + (reentry.length ? 1 : 0)} informativno · ${okChecks.length} bez problema</div>
                <div>Poslednji izveštaj: ${sefEsc(latestFile.dateFormatted)}</div>
            </div>
        </div>
        <p class="dms-small dms-text-muted dms-overview-note">Vrednosti su „za proveru“, a nisu dokaz greške. Automatski unos (${sefEsc(SYSTEM_AUTHOR)}) je uključen.</p>
        ${warnCards ? `<div>${sectionTitle('Za pregled')}<div class="${gridCls}">${warnCards}</div></div>` : ''}
        ${infoCards || reentryCard ? `<div>${sectionTitle('Informativno')}<div class="${gridCls}">${infoCards}${reentryCard}</div></div>` : ''}
        ${okChips ? `<div>${sectionTitle('Bez problema')}<div class="dms-row-wrap">${okChips}</div></div>` : ''}
        <div>${sectionTitle('Lista dokumenata')}<div class="dms-stack-sm">${accordions}${reentryAccordion}${!accordions && !reentryAccordion ? '<div class="dms-panel dms-center dms-text-muted">Nema dokumenata koji ne prolaze proveru.</div>' : ''}</div></div>
    `;

    // Samo jedna lista dokumenata otvorena u isto vreme: kad se otvori jedna, ostale se zatvaraju
    // (toggle ne ide kroz mehurićenje, pa se hvata u fazi hvatanja)
    div.addEventListener('toggle', e => {
        const opened = e.target;
        if (!(opened instanceof HTMLDetailsElement) || !opened.open) return;
        div.querySelectorAll('details[open]').forEach(d => { if (d !== opened) d.open = false; });
    }, true);

    // Klik na karticu otvara odgovarajuću listu i skroluje do nje
    div.addEventListener('click', e => {
        // Ako korisnik označava tekst naslova, ne otvaraj/zatvaraj listu
        if (e.target.closest('summary') && window.getSelection().toString()) {
            e.preventDefault();
            return;
        }
        const jump = e.target.closest('[data-jump]');
        if (!jump) return;
        const target = document.getElementById(jump.dataset.jump);
        if (!target) return;
        target.open = true;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return div;
}

