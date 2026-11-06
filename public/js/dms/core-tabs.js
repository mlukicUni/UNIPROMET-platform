/**
 * Podmeni radnih listova analitike (horizontalni pilovi iznad sadržaja) i prebacivanje između listova.
 */
const SHEET_TABS_LIST = ['Podaci', 'Kreirani dokumenti po sektorima', 'Nagle Oscilacije po Mesecima', 'SEF statusi', 'Vrste dokumenata', 'Zaposleni', 'Ispravnost dokumentacije'];
// Ključevi ostaju nazivi listova; ovde je samo prikazani naziv taba
const SHEET_TAB_LABELS = { 'Podaci': 'Aktivnost korisnika' };

// Grupe u podmeniju (indeksi se odnose na SHEET_TABS_LIST)
const SHEET_TAB_GROUPS = [
    { title: 'Analiza', items: [0, 1, 2] },
    { title: 'SEF', items: [3] },
    { title: 'Evidencija', items: [4, 5] },
    { title: 'Kontrola', items: [6] }
];
const SHEET_TAB_ICONS = [
    'fa-user-clock',
    'fa-sitemap',
    'fa-bolt',
    'fa-file-invoice',
    'fa-tags',
    'fa-users',
    'fa-shield-halved'
];

/**
 * Izgradnja podmenija sa radnim listovima i praznih sadržaja tabova
 */
function buildSheetTabs() {
    const nav = document.getElementById('sheetSidebarNav');
    const tabsContent = document.getElementById('sheetTabContents');
    nav.innerHTML = '';
    tabsContent.innerHTML = '';

    const groups = SHEET_TAB_GROUPS.map(g => ({ title: g.title, items: g.items.filter(i => i < SHEET_TABS_LIST.length) }));
    const grouped = new Set(groups.flatMap(g => g.items));
    const rest = SHEET_TABS_LIST.map((_, i) => i).filter(i => !grouped.has(i));
    if (rest.length) groups.push({ title: 'Ostalo', items: rest });

    groups.forEach(g => {
        if (!g.items.length) return;
        const wrap = document.createElement('div');
        wrap.className = 'dms-subnav-group';

        const title = document.createElement('span');
        title.className = 'dms-subnav-title';
        title.textContent = g.title;
        wrap.appendChild(title);

        g.items.forEach(index => {
            const sheetName = SHEET_TABS_LIST[index];
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'dms-pill';
            btn.dataset.tabIndex = String(index);
            btn.innerHTML = `<i class="fa-solid ${SHEET_TAB_ICONS[index] || 'fa-folder'}"></i><span>${dmsEscapeHtml(SHEET_TAB_LABELS[sheetName] || sheetName)}</span>`;
            btn.onclick = () => switchTab(index);
            wrap.appendChild(btn);
        });
        nav.appendChild(wrap);
    });

    // Podmeni taba „Ispravnost dokumentacije“ (poreklo KUF / KIF / Delovodnik) u posebnom redu
    const sub = buildCorrectnessSubmenu(SHEET_TABS_LIST.indexOf('Ispravnost dokumentacije'));
    nav.appendChild(sub);

    SHEET_TABS_LIST.forEach((sheetName, index) => {
        const contentDiv = document.createElement('div');
        contentDiv.id = `sheetContent_${index}`;
        contentDiv.className = index === 0 ? '' : 'dms-hidden';
        // Ostali tabovi se renderuju tek kada se prvi put otvore (brže učitavanje)
        if (index === 0) {
            contentDiv.appendChild(renderMultiSheetAnalysis(sheetName));
        }
        tabsContent.appendChild(contentDiv);
    });

    markActiveTab(0);
}

// Istaknut pil u podmeniju
function markActiveTab(activeIndex) {
    document.querySelectorAll('#sheetSidebarNav [data-tab-index]').forEach(btn => {
        const on = Number(btn.dataset.tabIndex) === activeIndex;
        btn.classList.toggle('is-active', on);
        if (on) btn.setAttribute('aria-current', 'page');
        else btn.removeAttribute('aria-current');
    });
    // Podmeni ispod aktivnog taba
    document.querySelectorAll('#sheetSidebarNav [data-sub-of]').forEach(sub => {
        sub.classList.toggle('dms-hidden', Number(sub.dataset.subOf) !== activeIndex);
    });
    markCorrectnessOrigin();
}

// Poreklo u tabu „Ispravnost dokumentacije“ bira se u podmeniju
let correctnessShow = null;
const CORRECTNESS_ORIGINS = [['KUF', 'KUF · ulazni'], ['KIF', 'KIF · izlazni'], ['Delovodnik', 'Delovodnik · bez SEF-a']];

function buildCorrectnessSubmenu(parentIndex) {
    const sub = document.createElement('div');
    sub.dataset.subOf = String(parentIndex);
    sub.className = 'dms-subnav-sub dms-hidden';
    const label = document.createElement('span');
    label.className = 'dms-subnav-title';
    label.textContent = 'Poreklo';
    sub.appendChild(label);
    CORRECTNESS_ORIGINS.forEach(([key, text]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.originKey = key;
        b.className = 'dms-pill dms-pill-sm';
        b.textContent = text;
        b.onclick = () => { if (correctnessShow) correctnessShow(key); };
        sub.appendChild(b);
    });
    return sub;
}

function markCorrectnessOrigin() {
    document.querySelectorAll('#sheetSidebarNav [data-origin-key]').forEach(b => {
        b.classList.toggle('is-active', b.dataset.originKey === correctnessOrigin);
    });
}

function switchTab(activeIndex) {
    const tabsContent = document.getElementById('sheetTabContents').children;
    markActiveTab(activeIndex);

    for (let i = 0; i < tabsContent.length; i++) {
        if (i === activeIndex) {
            if (tabsContent[i].childElementCount === 0) {
                tabsContent[i].appendChild(renderMultiSheetAnalysis(SHEET_TABS_LIST[i]));
            }
            tabsContent[i].classList.remove('dms-hidden');
        } else {
            tabsContent[i].classList.add('dms-hidden');
        }
    }
}
