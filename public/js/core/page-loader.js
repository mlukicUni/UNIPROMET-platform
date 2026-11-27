/**
 * ==========================================================================
 * UNIPROMET - JEDINSTVEN LOADER STRANICE (važi za svaku stranicu platforme)
 *
 * Automatski: pri SVAKOJ promeni stranice (tabActivated, važi i za buduće stranice) loader se prikaže
 * odmah i ostane najmanje tabMinVisibleMs, a duže ako stranica još čeka podatke. Uz radnju korisnika
 * (klik, tastatura) prikazuje se i pri ponovnom učitavanju podataka (filter, strana u tabeli, osvežavanje),
 * ali tek ako traje duže od showDelayMs (bez treptanja). Prati GET zahteve ka /api/ (preko fetch-a) i
 * skriva se kad svi stignu. Pozadinsko osvežavanje (tajmeri) se ne prati.
 * Zahtev koji ne treba da prikaže loader: fetch(url, { noLoader: true }).
 *
 * Ručno (npr. DMS učitavanje izveštaja sa napretkom):
 *   UniPageLoader.show(tabId, { text, pct, cover })   // cover: sakrij ostatak stranice dok traje
 *   UniPageLoader.update(tabId, { text, pct })
 *   UniPageLoader.hide(tabId)
 * Pokretanje platforme: UniPageLoader.hideBoot() kad su prava i prva stranica spremni.
 * ==========================================================================
 */
(function () {
  const CFG = {
    tabMinVisibleMs: 100,    // promena stranice: loader se uvek vidi bar ovoliko (i kad su podaci već tu); bilo 450 ms
    showDelayMs: 150,        // osvežavanje: loader se vidi tek ako traje duže (nema treperenja)
    minVisibleMs: 350,       // osvežavanje: kad se već pokaže, ostaje najmanje ovoliko (bez bljeska)
    quietMs: 150,            // posle poslednjeg odgovora čeka da se vidi da nema novog zahteva (lanac)
    noFetchGraceMs: 350,     // stranica koja ne traži podatke: zatvara se bez prikaza
    maxTabMs: 30000,         // najduže zadržavanje loadera pri promeni stranice
    maxRefreshMs: 8000,      // najduže zadržavanje pri osvežavanju (ne blokira duge radnje)
    userActionWindowMs: 1500,// zahtev posle radnje korisnika računa se kao osvežavanje
    slowHintMs: 8000         // posle ovoliko dodaje napomenu da server sporo odgovara
  };

  /** Pozadinski i tehnički zahtevi koji nisu učitavanje stranice */
  const IGNORE = [
    /^\/api\/(status|stats|ping)(\/|$)/,
    /^\/api\/scheduler\/status/,
    /^\/api\/equipment\/(events|sync-check)/,
    /^\/api\/[a-z-]+\/(events|sync-check)/,
    /\/(scan|export|sync|download|playback|stream|snapshot|live-info|live-stream|gateway|video-gateway)(\/|$|\?)/,
    /^\/api\/video-gateway/
  ];
  const IGNORE_QUERY = /(^|&)(force|refresh|deep)=(true|1)(&|$)/;

  /** Podaci koje app.js predučitava pri pokretanju (fetchInitialData), po stranici kojoj pripadaju */
  const OWN_PREFETCH = {
    printers: /^\/api\/printers/,
    logs: /^\/api\/logs/,
    computers: /^\/api\/network\/devices/,
    servers: /^\/api\/network\/devices/,
    other_devices: /^\/api\/network\/devices/,
    cameras: /^\/api\/cameras/,
    inventory_cameras: /^\/api\/inventory\/cameras/,
    inventory_recorders: /^\/api\/inventory\/recorders/,
    cctv_cameras: /^\/api\/(cameras|inventory\/(cameras|recorders))/,
    rf_readers: /^\/api\/inventory\/rf-readers/,
    wifi_aps: /^\/api\/inventory\/wifi-aps/,
    scheduled_services: /^\/api\/scheduler\/services/
  };

  const windows = new Map(); // tabId -> stanje učitavanja
  let activeTab = null;
  let lastUserAction = -Infinity; // do prve radnje korisnika nema „osvežavanja“
  let retryHandler = null;
  let untrackedDepth = 0; // > 0: zahtevi se ne prate (npr. pozadinsko učitavanje podataka drugih stranica)
  const now = () => performance.now();

  /* ---------------------------- Tekst i DOM ---------------------------- */
  function tabLabel(tabId) {
    const el = document.querySelector(`.nav-tab-btn[data-tab="${tabId}"] .nav-label`);
    return el ? el.textContent.trim() : '';
  }

  function section(tabId) {
    return document.getElementById('tab-' + tabId);
  }

  function buildBox(text) {
    return `<div class="page-loader-box">
      <div class="page-loader-spinner"></div>
      <div class="page-loader-text"></div>
      <div class="page-loader-bar is-indeterminate"><span></span></div>
    </div>`;
  }

  function render(w) {
    const sec = section(w.tabId);
    if (!sec || w.el) return;
    const el = document.createElement('div');
    el.className = 'page-loader';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = buildBox();
    sec.classList.add('has-page-loader');
    if (w.cover) sec.classList.add('page-loader-covering');
    sec.appendChild(el);
    w.el = el;
    fit(w);
    w.fitTimer = setInterval(() => fit(w), 250); // sadržaj može da naraste dok se učitava
    w.shownAt = now();
    paint(w);
    w.slowTimer = setTimeout(() => {
      if (!w.el || w.done) return;
      const hint = document.createElement('div');
      hint.className = 'page-loader-hint';
      hint.textContent = 'Još traje, server sporo odgovara…';
      w.el.querySelector('.page-loader-box').appendChild(hint);
    }, CFG.slowHintMs);
  }

  function paint(w) {
    if (!w.el) return;
    const label = tabLabel(w.tabId);
    const text = w.text || (label ? `Učitavanje: ${label}…` : 'Učitavanje…');
    w.el.querySelector('.page-loader-text').textContent = text;
    const bar = w.el.querySelector('.page-loader-bar');
    const fill = bar.querySelector('span');
    if (typeof w.pct === 'number') {
      bar.classList.remove('is-indeterminate');
      fill.style.width = Math.max(4, Math.min(100, w.pct)) + '%';
    } else {
      bar.classList.add('is-indeterminate');
      fill.style.width = '';
    }
  }

  /** Loader pokriva celu stranicu, i kad je sadržaj viši od okvira stranice */
  function fit(w) {
    const sec = section(w.tabId);
    if (!sec || !w.el) return;
    const top = sec.getBoundingClientRect().top;
    let bottom = sec.clientHeight;
    for (const c of sec.children) {
      if (c !== w.el) bottom = Math.max(bottom, c.getBoundingClientRect().bottom - top);
    }
    w.el.style.bottom = 'auto';
    w.el.style.height = Math.ceil(bottom) + 'px';
  }

  function removeEl(w) {
    clearTimeout(w.slowTimer);
    clearInterval(w.fitTimer);
    const el = w.el;
    w.el = null;
    const sec = section(w.tabId);
    if (sec) sec.classList.remove('page-loader-covering');
    if (!el) return;
    el.classList.add('is-leaving');
    setTimeout(() => {
      el.remove();
      const s = section(w.tabId);
      if (s && !s.querySelector(':scope > .page-loader')) s.classList.remove('has-page-loader');
    }, 170);
  }

  function showError(w) {
    const sec = section(w.tabId);
    if (!sec || sec.querySelector(':scope > .page-loader-error')) return;
    const bar = document.createElement('div');
    bar.className = 'page-loader-error';
    bar.innerHTML = '<span>Neki podaci nisu učitani (server nije odgovorio).</span>' +
      '<button type="button" data-retry>Pokušaj ponovo</button>' +
      '<button type="button" data-close aria-label="Zatvori">×</button>';
    bar.querySelector('[data-retry]').addEventListener('click', () => {
      bar.remove();
      if (retryHandler) retryHandler(w.tabId);
    });
    bar.querySelector('[data-close]').addEventListener('click', () => bar.remove());
    sec.insertBefore(bar, sec.firstChild);
  }

  /* ---------------------------- Tok učitavanja ---------------------------- */
  function open(tabId, mode) {
    const prev = windows.get(tabId);
    if (prev && !prev.done) return prev;
    const w = {
      tabId, mode, pending: 0, started: false, failed: false, manual: false, done: false,
      openedAt: now(), shownAt: 0, el: null, text: '', pct: undefined, cover: false,
      showTimer: 0, quietTimer: 0, graceTimer: 0, maxTimer: 0, slowTimer: 0
    };
    windows.set(tabId, w);
    w.graceTimer = setTimeout(() => check(w), CFG.noFetchGraceMs);
    w.maxTimer = setTimeout(() => finish(w), mode === 'tab' ? CFG.maxTabMs : CFG.maxRefreshMs);
    // Promena stranice: loader odmah, na svakoj stranici (brzi odgovori servera ga inače nikad ne bi pokazali)
    if (mode === 'tab') render(w);
    return w;
  }

  function scheduleShow(w) {
    if (w.el || w.showTimer || w.done) return;
    const wait = Math.max(0, CFG.showDelayMs - (now() - w.openedAt));
    w.showTimer = setTimeout(() => {
      w.showTimer = 0;
      if (!w.done && (w.pending > 0 || w.manual)) render(w);
    }, wait);
  }

  function check(w) {
    if (w.done || w.manual) return;
    if (w.pending > 0) return;
    if (!w.started) {
      // Nijedan zahtev: posle pauze čekanja zatvori (promena stranice ipak ostaje vidljiva tabMinVisibleMs)
      if (now() - w.openedAt >= CFG.noFetchGraceMs - 5) finish(w);
      return;
    }
    clearTimeout(w.quietTimer);
    w.quietTimer = setTimeout(() => { if (!w.done && !w.manual && w.pending === 0) finish(w); }, CFG.quietMs);
  }

  function finish(w) {
    if (w.done) return;
    w.done = true;
    [w.showTimer, w.quietTimer, w.graceTimer, w.maxTimer].forEach(clearTimeout);
    const close = () => {
      // Dva kadra da se podaci iscrtaju pre nego što loader nestane
      requestAnimationFrame(() => requestAnimationFrame(() => {
        removeEl(w);
        if (w.failed) showError(w);
      }));
    };
    if (w.el) {
      const min = w.mode === 'tab' ? CFG.tabMinVisibleMs : CFG.minVisibleMs;
      const left = Math.max(0, min - (now() - w.shownAt));
      setTimeout(close, left);
    } else {
      close();
    }
    if (windows.get(w.tabId) === w) windows.delete(w.tabId);
  }

  /* ---------------------------- Praćenje zahteva ---------------------------- */
  function classify(input, init) {
    if (init && init.noLoader) return null;
    let url, method = 'GET';
    try {
      if (typeof input === 'string' || input instanceof URL) url = new URL(String(input), location.origin);
      else if (input && input.url) { url = new URL(input.url, location.origin); method = input.method || 'GET'; }
      else return null;
    } catch (e) { return null; }
    if (init && init.method) method = init.method;
    if (String(method).toUpperCase() !== 'GET') return null;
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return null;
    // Predučitavanje za sve stranice (untracked): drži loader samo zahtev koji pripada aktivnoj stranici
    if (untrackedDepth > 0) {
      const own = OWN_PREFETCH[activeTab];
      if (!own || !own.test(url.pathname)) return null;
    }
    if (IGNORE.some(rx => rx.test(url.pathname) || rx.test(url.pathname + url.search))) return null;
    // Izričito osvežavanje/skeniranje (force=true) je radnja korisnika, ne učitavanje stranice: vidi windowFor
    url.isForced = IGNORE_QUERY.test(url.search.replace(/^\?/, ''));
    return url;
  }

  function windowFor(forced) {
    if (!activeTab) return null;
    const w = windows.get(activeTab);
    if (w && !w.done) return w;
    // Izričito skeniranje (force=true) pokrenuto dugmetom nije učitavanje stranice: ne otvara novi loader
    if (forced) return null;
    // Bez otvorenog učitavanja: zahtev odmah posle radnje korisnika je osvežavanje stranice
    if (now() - lastUserAction <= CFG.userActionWindowMs && section(activeTab)) return open(activeTab, 'refresh');
    return null;
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = classify(input, init);
    const w = url ? windowFor(url.isForced) : null;
    // Skeniranje tokom osvežavanja (ne tokom promene stranice) ne drži loader
    if (w && url.isForced && w.mode !== 'tab') return nativeFetch(input, init);
    if (!w) return nativeFetch(input, init);

    w.pending++;
    w.started = true;
    clearTimeout(w.quietTimer);
    scheduleShow(w);
    const p = nativeFetch(input, init);
    p.then(
      (res) => { if (res && res.status >= 500) w.failed = true; },
      () => { w.failed = true; }
    ).then(() => {
      w.pending = Math.max(0, w.pending - 1);
      check(w);
    });
    return p;
  };

  ['pointerdown', 'keydown', 'change', 'input'].forEach(type => {
    window.addEventListener(type, () => { lastUserAction = now(); }, true);
  });

  /* ---------------------------- Javni interfejs ---------------------------- */
  window.UniPageLoader = {
    CFG,
    /** Za proveru: stanje otvorenih učitavanja */
    _state() { return [...windows.values()].map(w => ({ tab: w.tabId, mode: w.mode, pending: w.pending, started: w.started, manual: w.manual, shown: !!w.el, done: w.done })); },
    /** Poziva se pri svakoj promeni stranice */
    tabActivated(tabId) {
      // Učitavanje prethodne stranice se prekida (njen loader nestaje odmah)
      windows.forEach((w) => { if (w.tabId !== tabId && !w.manual) { w.done = true; [w.showTimer, w.quietTimer, w.graceTimer, w.maxTimer].forEach(clearTimeout); removeEl(w); } });
      windows.forEach((w, k) => { if (w.done) windows.delete(k); });
      activeTab = tabId;
      const old = windows.get(tabId);
      if (old && !old.done) return;
      open(tabId, 'tab');
    },
    show(tabId, opts = {}) {
      const w = windows.get(tabId) && !windows.get(tabId).done ? windows.get(tabId) : open(tabId, 'tab');
      w.manual = true;
      w.cover = !!opts.cover;
      if (opts.text !== undefined) w.text = opts.text;
      if (opts.pct !== undefined) w.pct = opts.pct;
      clearTimeout(w.maxTimer);
      clearTimeout(w.graceTimer);
      w.maxTimer = setTimeout(() => finish(w), 120000); // ručno učitavanje: sigurnosni rok
      if (w.el) {
        paint(w);
        if (w.cover) section(tabId).classList.add('page-loader-covering');
      } else render(w);
    },
    update(tabId, opts = {}) {
      const w = windows.get(tabId);
      if (!w || w.done) return;
      if (opts.text !== undefined) w.text = opts.text;
      if (opts.pct !== undefined) w.pct = opts.pct;
      paint(w);
    },
    hide(tabId) {
      const w = windows.get(tabId);
      if (!w || w.done) return;
      w.manual = false;
      w.started = true; // ručno učitavanje je završeno: zatvori posle kratke pauze
      check(w);
    },
    /** Izvršava fn tako da zahtevi koje pokrene (u istom koraku) ne drže loader, npr. predučitavanje za druge stranice */
    untracked(fn) {
      untrackedDepth++;
      try { return fn(); } finally { untrackedDepth--; }
    },
    /** Funkcija koja ponovo učitava stranicu kad korisnik klikne „Pokušaj ponovo“ */
    onRetry(fn) { retryHandler = fn; },
    /** Skida loader pokretanja platforme (index.html: #app-boot-loader) */
    hideBoot() {
      const el = document.getElementById('app-boot-loader');
      if (!el || el.classList.contains('is-leaving')) return;
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 300);
    }
  };

  // Sigurnosna mreža: loader pokretanja ne sme da ostane zauvek
  setTimeout(() => window.UniPageLoader.hideBoot(), 8000);
})();
