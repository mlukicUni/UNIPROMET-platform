/**
 * ==========================================================================
 * DMS ANALIZA PODATAKA - jezgro sekcije
 * Zajedničko stanje (učitani izveštaji, korisnici), API pomoćne funkcije, lenjo učitavanje biblioteka
 * (SheetJS, Chart.js), pretvaranje FontAwesome klasa u lucide ikone i aktivacija tabova.
 * Logika analitike je u public/js/dms/*.js (prenesena iz samostalne DMS aplikacije).
 * ==========================================================================
 */

// Zajedničko stanje (koriste ga svi dms/*.js fajlovi)
let uploadedFiles = [];
let USERS = {};
let trendChartInstance = null;

/* ---------- Pomoćne funkcije ---------- */
function dmsEscapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Zamena za alert(): poruka kao obaveštenje platforme */
function dmsAlert(message) {
  dmsNotify(String(message), 'info');
}

// Potpis u porukama: ime prijavljenog korisnika platforme
let dmsUserName = null;
function dmsSignature() {
  return dmsUserName || 'UNIPROMET IT služba';
}
async function dmsLoadCurrentUser() {
  if (dmsUserName) return;
  try {
    const res = await fetch('/auth/me', { cache: 'no-store' });
    const data = await res.json();
    if (data && data.user && data.user.name) dmsUserName = data.user.name;
  } catch (e) { /* potpis ostaje podrazumevan */ }
}

function dmsNotify(message, type = 'info') {
  if (typeof window.showToast === 'function') window.showToast(message, type);
  else console.log(`[DMS] ${message}`);
}

/** fetch koji vraća JSON i baca grešku sa porukom servera (success:false ili HTTP greška) */
async function dmsApi(url, options = {}) {
  const res = await fetch(url, options);
  let data = null;
  try { data = await res.json(); } catch (e) { /* nije JSON */ }
  if (!res.ok || (data && data.success === false)) {
    const msg = (data && (data.error || data.message)) || `Greška ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function dmsJson(body) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/* ---------- Biblioteke (lenjo) ---------- */
const DMS_LIBS = {
  xlsx: { test: () => window.XLSX, src: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js' },
  chart: { test: () => window.Chart, src: 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js' }
};
const dmsLibPromises = {};

function dmsLoadScript(key) {
  const lib = DMS_LIBS[key];
  if (lib.test()) return Promise.resolve();
  if (!dmsLibPromises[key]) {
    dmsLibPromises[key] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = lib.src;
      s.onload = () => resolve();
      s.onerror = () => { delete dmsLibPromises[key]; reject(new Error('Biblioteka nije učitana: ' + lib.src)); };
      document.head.appendChild(s);
    });
  }
  return dmsLibPromises[key];
}

async function dmsEnsureLibs() {
  await Promise.all([dmsLoadScript('xlsx'), dmsLoadScript('chart')]);
  // Grafikoni u tamnoj temi platforme
  if (window.Chart && !Chart.defaults.__dmsThemed) {
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.borderColor = 'rgba(148,163,184,0.12)';
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.__dmsThemed = true;
  }
}

/* ---------- Ikone: FontAwesome nazivi iz prenetog koda -> lucide ---------- */
const DMS_ICON_MAP = {
  'triangle-exclamation': 'alert-triangle', 'xmark': 'x', 'paper-plane': 'send', 'building': 'building-2', 'arrow-down': 'arrow-down',
  'magnifying-glass': 'search', 'chart-line': 'line-chart', 'arrow-up': 'arrow-up', 'arrow-trend-down': 'trending-down', 'trash-can': 'trash-2',
  'star': 'star', 'floppy-disk': 'save', 'envelope': 'mail', 'clock-rotate-left': 'history', 'bolt': 'zap', 'users-gear': 'users', 'users': 'users',
  'user-plus': 'user-plus', 'user-lock': 'lock', 'user-clock': 'clock', 'sitemap': 'network', 'circle-check': 'check-circle',
  'calendar-check': 'calendar-check', 'arrow-trend-up': 'trending-up', 'user': 'user', 'tags': 'tags', 'table-cells': 'table', 'spinner': 'loader',
  'lock': 'lock', 'location-dot': 'map-pin', 'folder-open': 'folder-open', 'files': 'files', 'file-signature': 'file-signature',
  'file-circle-check': 'file-check', 'circle-up': 'arrow-up-circle', 'circle-info': 'info', 'circle-down': 'arrow-down-circle',
  'box-archive': 'archive', 'arrow-right': 'arrow-right', 'user-pen': 'user-cog', 'user-minus': 'user-minus', 'trophy': 'trophy',
  'timeline': 'activity', 'square-poll-vertical': 'bar-chart-3', 'shield-halved': 'shield', 'right-from-bracket': 'log-out', 'ranking-star': 'award',
  'print': 'printer', 'plus': 'plus', 'pen-to-square': 'edit', 'palette': 'palette', 'map-location-dot': 'map-pin', 'list-check': 'list-checks',
  'layer-group': 'layers', 'folder': 'folder', 'file-invoice': 'receipt', 'eye': 'eye', 'expand': 'maximize-2', 'envelope-open-text': 'mail-open',
  'download': 'download', 'compress': 'minimize-2', 'cloud-arrow-up': 'upload-cloud', 'clock': 'clock', 'chevron-down': 'chevron-down',
  'check': 'check', 'chart-column': 'bar-chart-3', 'calendar-day': 'calendar', 'calculator': 'calculator', 'building-user': 'building', 'bell': 'bell', 'ban': 'ban'
};

function dmsConvertFaIcons(root) {
  root.querySelectorAll('i[class*="fa-"]').forEach(el => {
    const toks = Array.from(el.classList);
    const fa = toks.find(t => t.startsWith('fa-') && !['fa-solid', 'fa-regular', 'fa-brands', 'fa-spin', 'fa-fw'].includes(t));
    const keep = toks.filter(t => !t.startsWith('fa-'));
    if (toks.includes('fa-spin')) keep.push('dms-spin');
    el.setAttribute('data-lucide', (fa && DMS_ICON_MAP[fa.slice(3)]) || 'circle');
    el.className = keep.join(' ');
  });
}

// Samo <i> elementi koji tek treba da postanu SVG ikone (ne i već nacrtane SVG ikone: one nose isti data-lucide atribut,
// pa bi ih posmatrač stalno iznova obrađivao i napravio beskonačnu petlju)
const DMS_PENDING_ICON = 'i[data-lucide], i[class*="fa-"]';

let dmsIconTimer = null;
function dmsScheduleIcons() {
  if (dmsIconTimer) return;
  dmsIconTimer = setTimeout(() => {
    dmsIconTimer = null;
    if (!window.lucide || typeof window.lucide.createIcons !== 'function') return;
    // Iscrtavaju se samo DMS delovi koji stvarno imaju ikone na čekanju, a ne ceo dokument
    document.querySelectorAll('.dms-root, .dms-modal').forEach(root => {
      if (!root.querySelector(DMS_PENDING_ICON)) return;
      dmsConvertFaIcons(root);
      window.lucide.createIcons({ root });
    });
  }, 30);
}

function dmsStartIconObserver() {
  if (window.__dmsIconObserver) return;
  window.__dmsIconObserver = new MutationObserver(muts => {
    for (const m of muts) {
      const target = m.target;
      if (!(target.nodeType === 1 && target.closest && target.closest('.dms-root, .dms-modal'))) continue;
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        // SVG koji je upravo nacrtan se preskače (inače se pravi petlja)
        if (n.namespaceURI === 'http://www.w3.org/2000/svg') continue;
        if ((n.matches && n.matches(DMS_PENDING_ICON)) || (n.querySelector && n.querySelector(DMS_PENDING_ICON))) {
          dmsScheduleIcons();
          return;
        }
      }
    }
  });
  window.__dmsIconObserver.observe(document.body, { childList: true, subtree: true });
}

/* ---------- Korisnici ---------- */
/** Učitava bazu korisnika (zaposleni -> služba) sa servera */
async function loadUsersDatabase() {
  try {
    const data = await dmsApi('/api/dms/users');
    if (data.users) USERS = data.users;
  } catch (err) {
    console.warn('[DMS] Nije moguće učitati bazu korisnika:', err);
  }
}

/** Korisnici i službe iz lista "Korisnici" u izveštaju (samo u memoriji; baza se menja isključivo na stranici Korisnici i službe) */
/**
 * Zaposleni iz lista "Korisnici" u izveštaju: [{ name, email, sector, location }].
 * Ne menja memoriju; šalje se u bazu (/api/dms/users/sync) pri učitavanju izveštaja.
 */
function extractUsersFromWorkbook(wb) {
  if (!wb || !wb.SheetNames) return [];
  const sheetName = wb.SheetNames.find(s => /korisnic|zaposlen/i.test(s.trim()));
  if (!sheetName) return [];

  const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
  if (rawRows.length < 2) return [];

  let colUser = -1, colMail = -1, colSector = -1, colLoc = -1;
  (rawRows[0] || []).forEach((cell, idx) => {
    const str = String(cell || '').toLowerCase();
    if (str.includes('korisnik') || str.includes('ime') || str.includes('zaposleni')) colUser = idx;
    if (str.includes('mail') || str.includes('email')) colMail = idx;
    if (str.includes('služb') || str.includes('sluzb') || str.includes('sektor') || str.includes('odeljenj')) colSector = idx;
    if (str.includes('oc') || str.includes('lokacij')) colLoc = idx;
  });
  if (colUser === -1) colUser = 8;
  if (colSector === -1) colSector = 10;
  if (colMail === -1) colMail = 9;
  if (colLoc === -1) colLoc = 11;

  const byName = new Map();
  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i] || [];
    const uName = String(row[colUser] || '').trim();
    const uMail = colMail >= 0 ? String(row[colMail] || '').trim() : '';
    const uSector = colSector >= 0 ? String(row[colSector] || '').trim() : 'Nepoznat Sektor';
    const uLoc = colLoc >= 0 ? String(row[colLoc] || '').trim() : '';
    if (!uName || uName === 'null' || uName === 'undefined') continue;
    // Preskoči službe / sektore umesto fizičkih korisnika (nemaju email i naziv im je jednak sektoru)
    if (!uMail && uName === uSector) continue;
    byName.set(uName, { name: uName, email: uMail, sector: uSector, location: uLoc });
  }
  return [...byName.values()];
}

/** Šalje listu zaposlenih iz izveštaja u bazu; greška ne zaustavlja učitavanje izveštaja */
async function syncUsersFromWorkbook(wb) {
  const list = extractUsersFromWorkbook(wb);
  if (list.length === 0) return;
  try {
    await dmsApi('/api/dms/users/sync', dmsJson({ users: list }));
  } catch (err) {
    console.warn('[DMS] Lista korisnika nije sačuvana u bazi:', err);
    dmsNotify('Lista korisnika iz izveštaja nije sačuvana: ' + err.message, 'error');
  }
}

/** Značke službe i ključnog korisnika uz ime korisnika u tabelama analitike */
function getUserSectorBadgeHtml(userName) {
  if (!userName) return '';
  const cleanName = String(userName).replace(/^Zaključao\/la\s*/i, '').replace(/^Dodeljeno\s*/i, '').trim();
  const userObj = USERS[cleanName] || USERS[userName];
  let html = '';
  if (userObj) {
    if (userObj.isKeyUser) {
      html += `<span class="dms-chip dms-chip-amber" title="Ključni korisnik (prioritetno praćenje)"><i data-lucide="star"></i> Ključan</span>`;
    }
    if (userObj.sector && userObj.sector !== 'Nepoznat Sektor') {
      html += `<span class="dms-chip" title="Služba u kompaniji"><i data-lucide="building-2"></i> ${dmsEscapeHtml(userObj.sector)}</span>`;
    }
    if (userObj.isKeyUser || userObj.email) {
      html += `<button type="button" onclick="openEmailModal('${encodeURIComponent(cleanName)}')" class="dms-chip dms-chip-action" title="Pošalji e-mail poruku ovom korisniku"><i data-lucide="mail"></i> Pošalji mail</button>`;
    }
  }
  return html;
}

/* ---------- Učitavanje sačuvanih izveštaja (server + keš u pregledaču) ---------- */
// Keš u pregledaču (IndexedDB) čuva parsirane redove, uz potpis fajlova sa servera: bez promene se ništa ne preuzima
const SAVED_FILES_DB_NAME = 'dms-analitika';
const SAVED_FILES_STORE = 'cache';
const SAVED_FILES_KEY = 'parsedRaw';

function openSavedFilesDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SAVED_FILES_DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(SAVED_FILES_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Greška u kešu ne sme da blokira učitavanje: tada se radi bez njega
async function readSavedFilesCache() {
  try {
    const db = await openSavedFilesDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(SAVED_FILES_STORE).objectStore(SAVED_FILES_STORE).get(SAVED_FILES_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    return null;
  }
}

function writeSavedFilesCache(value) {
  openSavedFilesDb().then(db => {
    db.transaction(SAVED_FILES_STORE, 'readwrite').objectStore(SAVED_FILES_STORE).put(value, SAVED_FILES_KEY);
  }).catch(err => console.warn('[DMS] Keš nije sačuvan:', err));
}

/** Pravi stavku liste učitanih izveštaja iz parsiranih redova sa servera */
function dmsBuildReportItem(f) {
  // SheetJS radna knjiga se rekonstruiše iz 2D redova; list se pretvara tek kad ga neko prvi put zatraži
  const wb = { SheetNames: f.sheetNames || [], Sheets: {} };
  Object.defineProperty(wb, 'rawSheets', { value: f.sheets || {} });
  for (const sName of wb.SheetNames) {
    let converted = null;
    Object.defineProperty(wb.Sheets, sName, {
      enumerable: true,
      get() {
        if (!converted) converted = XLSX.utils.aoa_to_sheet((f.sheets && f.sheets[sName]) || []);
        return converted;
      }
    });
  }
  const { parsedDate, dateFormatted } = extractDateInfo({ name: f.filename });
  return { id: Math.random().toString(36).substring(2, 9), name: f.filename, parsedDate, dateFormatted, workbook: wb };
}

/**
 * Loader stranice: dok traje učitavanje prikazuje se samo loader (sa tekstom i opcionim procentom),
 * a sadržaj stranice se otkriva tek kad je sve spremno. tabId je npr. 'dms_users'.
 */
function dmsSetLoading(tabId, on, text, pct) {
  const section = document.getElementById('tab-' + tabId);
  if (!section) return;
  let loader = section.querySelector(':scope > .dms-loader');
  if (!on) {
    section.classList.remove('dms-is-loading');
    if (loader) loader.remove();
    return;
  }
  if (!loader) {
    loader = document.createElement('div');
    loader.className = 'dms-loader';
    loader.innerHTML = '<div class="dms-loader-spinner"></div><div class="dms-loader-text"></div>' +
      '<div class="dms-loader-bar"><span></span></div>';
    section.appendChild(loader);
  }
  section.classList.add('dms-is-loading');
  loader.querySelector('.dms-loader-text').textContent = text || 'Učitavanje...';
  const bar = loader.querySelector('.dms-loader-bar');
  const fill = bar.querySelector('span');
  if (typeof pct === 'number') {
    bar.classList.remove('is-indeterminate');
    fill.style.width = Math.max(4, Math.min(100, pct)) + '%';
  } else {
    bar.classList.add('is-indeterminate');
    fill.style.width = '';
  }
}

// Čeka da pregledač izračuna raspored i iscrta stranicu pre nego što se loader ukloni
function dmsNextPaint() {
  return new Promise(resolve => setTimeout(() => requestAnimationFrame(() => resolve()), 0));
}

async function loadSavedFilesFromServer() {
  try {
    dmsSetLoading('dms_analytics', true, 'Provera sačuvanih izveštaja...');
    const list = await dmsApi('/api/dms/reports');
    if (!list.files || list.files.length === 0) {
      uploadedFiles = [];
      sortAndRenderTimeline();
      return;
    }
    const signature = list.files.map(f => `${f.filename}:${f.mtimeMs}:${f.size}`).join('|');
    const cached = await readSavedFilesCache();

    let rawFiles;
    if (cached && cached.signature === signature) {
      dmsSetLoading('dms_analytics', true, 'Čitanje izveštaja iz keša pregledača...', 60);
      rawFiles = cached.files;
    } else {
      // Izveštaji se preuzimaju paralelno; napredak se računa po broju preuzetih
      let done = 0;
      const total = list.files.length;
      dmsSetLoading('dms_analytics', true, `Preuzimanje izveštaja (0 od ${total}). Prvo učitavanje može da potraje.`, 5);
      const parsed = await Promise.all(list.files.map(f =>
        dmsApi(`/api/dms/reports/${encodeURIComponent(f.filename)}/parsed`).then(r => {
          done++;
          dmsSetLoading('dms_analytics', true, `Preuzimanje izveštaja (${done} od ${total}). Prvo učitavanje može da potraje.`, 5 + Math.round((done / total) * 75));
          return r;
        })
      ));
      rawFiles = parsed.map(p => p.file);
      writeSavedFilesCache({ signature, files: rawFiles });
    }

    dmsSetLoading('dms_analytics', true, 'Priprema podataka za analizu...', 85);
    await dmsNextPaint();
    uploadedFiles = [];
    for (const f of rawFiles) {
      try {
        uploadedFiles.push(dmsBuildReportItem(f));
      } catch (err) {
        console.error('[DMS] Greška pri učitavanju keširanog fajla ' + f.filename, err);
      }
    }
    sortAndRenderTimeline();
    if (uploadedFiles.length >= 1) {
      dmsSetLoading('dms_analytics', true, 'Iscrtavanje prikaza...', 95);
      await dmsNextPaint();
      executeComparison();
      // executeComparison gradi tabove u sledećem ciklusu: čekamo ga i iscrtavanje pre nego što loader nestane
      await dmsNextPaint();
      await dmsNextPaint();
    }
  } catch (err) {
    console.warn('[DMS] Nije moguće učitati izveštaje sa servera:', err);
    dmsNotify('Izveštaji nisu učitani: ' + err.message, 'error');
  }
}

/* ---------- Aktivacija tabova ---------- */
let dmsAnalyticsPromise = null;
let dmsUsersPromise = null;

function dmsInitAnalytics() {
  if (!dmsAnalyticsPromise) {
    dmsAnalyticsPromise = (async () => {
      dmsSetLoading('dms_analytics', true, 'Učitavanje biblioteka...');
      renderTimelineUI();
      checkReadyState();
      await dmsEnsureLibs();
      dmsSetLoading('dms_analytics', true, 'Učitavanje korisnika i službi...');
      await loadUsersDatabase();
      setupDragAndDrop();
      await loadSavedFilesFromServer();
    })().catch(err => {
      dmsAnalyticsPromise = null;
      console.error('[DMS] Greška pri pokretanju analitike:', err);
      dmsNotify('DMS analitika nije pokrenuta: ' + err.message, 'error');
    }).finally(() => dmsSetLoading('dms_analytics', false));
  }
  return dmsAnalyticsPromise;
}

function dmsInitUsers() {
  if (!dmsUsersPromise) dmsUsersPromise = loadUsersDatabase().finally(() => { dmsUsersPromise = null; });
  return dmsUsersPromise;
}

/**
 * Glatko pomeranje velikih tabela: dok traje skrolovanje, hover efekti i prelazi se privremeno gase
 * (miš stoji dok se redovi pomeraju ispod njega, pa bi se hover stanje preračunavalo na svakom frejmu).
 */
let dmsScrollGuardReady = false;
function dmsInitScrollGuard() {
  if (dmsScrollGuardReady) return;
  const scroller = document.querySelector('.content-scroll-container');
  if (!scroller) return;
  dmsScrollGuardReady = true;
  let timer = null;
  let active = false;
  scroller.addEventListener('scroll', () => {
    if (!active) {
      active = true;
      document.querySelectorAll('.dms-root').forEach(el => el.classList.add('dms-scrolling'));
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      active = false;
      document.querySelectorAll('.dms-root').forEach(el => el.classList.remove('dms-scrolling'));
    }, 140);
  }, { passive: true });
}

window.DmsModule = {
  onTabActivated(tabId) {
    dmsStartIconObserver();
    dmsInitScrollGuard();
    dmsLoadCurrentUser();
    switch (tabId) {
      case 'dms_analytics':
        dmsInitAnalytics();
        break;
      case 'dms_users':
        dmsSetLoading(tabId, true, 'Učitavanje korisnika...');
        dmsInitUsers()
          .then(() => window.DmsUsersPage?.onTabActivated?.())
          .finally(() => dmsNextPaint().then(() => dmsSetLoading(tabId, false)));
        break;
      case 'dms_reminder':
        dmsSetLoading(tabId, true, 'Priprema podsetnika za overu...');
        dmsInitUsers()
          .then(() => window.DmsReminderPage?.onTabActivated?.())
          .finally(() => dmsNextPaint().then(() => dmsSetLoading(tabId, false)));
        break;
      case 'dms_scheduled_mails':
        dmsSetLoading(tabId, true, 'Učitavanje zakazanih mailova...');
        Promise.resolve(window.DmsScheduledPage?.onTabActivated?.())
          .finally(() => dmsNextPaint().then(() => dmsSetLoading(tabId, false)));
        break;
      case 'dms_signatures':
        window.DmsSignaturesPage?.onTabActivated?.();
        break;
    }
    dmsScheduleIcons();
  }
};
