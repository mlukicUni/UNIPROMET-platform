/**
 * ==========================================================================
 * UNIPROMET IT ADMIN - MONITORING: ZASEBAN PROZOR
 * /monitor?tab=<id>  - jedan tab preko celog prozora (rotacija se može pokrenuti dugmetom)
 * /monitor?tour=1    - rotacija tabova po korisnikovim podešavanjima, odmah pokrenuta
 * Bez menija platforme; traka sa alatima se pojavljuje pri pomeranju miša.
 * ==========================================================================
 */
(function () {
  'use strict';

  const C = window.MonitoringCore;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const tabParam = params.get('tab') || '';
  const tourMode = params.get('tour') === '1';
  const REFRESH_MS = 10 * 60 * 1000;

  const S = {
    tabs: [],
    camById: new Map(),
    activeId: '',
    rotation: { intervalSec: 30, tabIds: [] },
    rotating: tourMode,
    rotTimer: null,
    player: null,
    barTimer: null,
    bannerTimer: null
  };

  async function api(url, method, body) {
    const opts = { method: method || 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { /* nije JSON */ }
    if (res.status === 401) throw new Error('Sesija je istekla. Prijavite se ponovo na platformu pa otvorite prozor iznova.');
    if (!res.ok || (data && data.success === false)) throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
    return data || {};
  }

  function showError(title, text) {
    if (S.player) S.player.unmount();
    $('mw-loading').style.display = 'none';
    $('mw-grid').innerHTML = `
      <div class="mon-window-error">
        <i data-lucide="alert-octagon" style="width: 30px; height: 30px; color: #ef4444;"></i>
        <h5>${C.esc(title)}</h5>
        <p>${C.esc(text)}</p>
        <a class="btn-dark-outline-sm" href="/#cctv_monitoring"><i data-lucide="arrow-left"></i><span>Otvori platformu</span></a>
      </div>`;
    C.icons();
  }

  function tabById(id) {
    return S.tabs.find(t => t.id === id) || null;
  }

  function rotationIds() {
    const chosen = (S.rotation.tabIds || []).filter(id => tabById(id));
    return chosen.length >= 2 ? chosen : S.tabs.map(t => t.id);
  }

  function show(id) {
    const tab = tabById(id);
    if (!tab) return;
    S.activeId = id;
    document.title = `${tab.name} | Monitoring`;
    $('mw-title').textContent = tab.name;
    updateSub();
    S.player.render(tab, S.camById);
    banner(tab.name);
  }

  function updateSub() {
    const tab = tabById(S.activeId);
    if (!tab) return;
    const n = C.countStreams(tab.cameras, S.camById);
    $('mw-sub').textContent = `${n} ${C.cameraWord(n)} uživo${S.rotating ? ` · rotacija na svakih ${S.rotation.intervalSec} s` : ''}`;
  }

  function banner(text) {
    const el = $('mw-banner');
    el.textContent = text;
    el.classList.add('is-visible');
    clearTimeout(S.bannerTimer);
    S.bannerTimer = setTimeout(() => el.classList.remove('is-visible'), 2500);
  }

  /* ---------- Rotacija ---------- */
  function schedule() {
    clearTimeout(S.rotTimer);
    const sec = S.rotation.intervalSec || 30;
    const fill = $('mw-rotation-bar').querySelector('span');
    $('mw-rotation-bar').classList.add('is-on');
    fill.style.transition = 'none';
    fill.style.width = '0';
    void fill.offsetWidth;
    fill.style.transition = `width ${sec}s linear`;
    fill.style.width = '100%';
    S.rotTimer = setTimeout(next, sec * 1000);
  }

  function next() {
    if (S.player.isMaximized() || modalOpen()) return schedule();
    const ids = rotationIds();
    if (ids.length < 1) return;
    const i = ids.indexOf(S.activeId);
    show(ids[(i + 1) % ids.length]);
    schedule();
  }

  function setRotating(on) {
    S.rotating = on && rotationIds().length >= 2;
    const btn = $('mw-btn-rotation');
    btn.classList.toggle('is-on', S.rotating);
    btn.innerHTML = S.rotating ? '<i data-lucide="pause"></i><span>Pauza</span>' : '<i data-lucide="repeat"></i><span>Rotacija</span>';
    btn.title = S.rotating ? `Zaustavi rotaciju (na svakih ${S.rotation.intervalSec} s)` : 'Pokreni rotaciju tabova (razmak)';
    C.icons(btn);
    if (S.rotating) schedule();
    else {
      clearTimeout(S.rotTimer);
      $('mw-rotation-bar').classList.remove('is-on');
    }
    updateSub();
  }

  /** Dugme rotacije ima smisla tek kad korisnik ima bar 2 taba */
  function applyRotationSettings(settings) {
    if (settings && settings.rotation) S.rotation = settings.rotation;
    const canRotate = S.tabs.length >= 2;
    $('mw-rotation-group').style.display = canRotate ? '' : 'none';
    if (S.rotating && rotationIds().length < 2) setRotating(false);
  }

  /* ---------- Podešavanja rotacije ---------- */
  function modalOpen() {
    return $('mw-modal-rotation').style.display === 'flex';
  }

  function openSettings() {
    const sel = $('mw-rot-interval');
    sel.value = String(S.rotation.intervalSec || 30);
    if (!sel.value) sel.value = '30';
    const chosen = new Set(S.rotation.tabIds || []);
    $('mw-rot-list').innerHTML = S.tabs.map(t => `
      <label class="mon-rot-item">
        <input type="checkbox" value="${C.esc(t.id)}" ${chosen.has(t.id) ? 'checked' : ''}>
        <span>${C.esc(t.name)}${t.shared ? ' · deljeno' : ''}</span>
        <span>${t.layout.cells.length} ${C.fieldWord(t.layout.cells.length)}</span>
      </label>`).join('');
    const m = $('mw-modal-rotation');
    m.classList.remove('modal-closing');
    m.style.display = 'flex';
    C.icons(m);
  }

  function closeSettings() {
    const m = $('mw-modal-rotation');
    if (!modalOpen() || m.classList.contains('modal-closing')) return;
    m.classList.add('modal-closing');
    setTimeout(() => {
      m.style.display = 'none';
      m.classList.remove('modal-closing');
    }, 190);
  }

  async function saveSettings() {
    const intervalSec = Number($('mw-rot-interval').value) || 30;
    const tabIds = Array.from($('mw-rot-list').querySelectorAll('input:checked')).map(i => i.value);
    const btn = $('mw-btn-rot-save');
    btn.disabled = true;
    try {
      const data = await api('/api/monitoring/settings', 'PUT', { rotation: { intervalSec, tabIds } });
      S.rotation = (data.settings && data.settings.rotation) || { intervalSec, tabIds };
      closeSettings();
      setRotating(true);
      if (!S.rotating) banner('Za rotaciju su potrebna bar 2 taba');
    } catch (err) {
      banner(err.message);
    } finally {
      btn.disabled = false;
    }
  }

  /** Vlastiti tabovi, pa tabovi koje su drugi podelili (osim sakrivenih; zadati tab se uvek otvara) */
  function mergeTabs(data) {
    const shared = (data.sharedTabs || []).filter(t => !t.hidden || t.id === tabParam);
    return (data.tabs || []).concat(shared);
  }

  /* ---------- Učitavanje ---------- */
  async function load() {
    try {
      if (tourMode) {
        const data = await api('/api/monitoring/state');
        S.tabs = mergeTabs(data);
        S.camById = new Map((data.cameras || []).map(c => [c.id, c]));
        if (data.settings && data.settings.fit) S.player.setFit(data.settings.fit);
        if (!S.tabs.length) return showError('Nema tabova', 'Napravite bar jedan monitoring tab na platformi.');
        applyRotationSettings(data.settings);
        const ids = rotationIds();
        const first = tabById(S.activeId) ? S.activeId : ids[0];
        $('mw-loading').style.display = 'none';
        show(first);
        if (S.rotating) setRotating(true);
      } else {
        if (!tabParam) return showError('Tab nije izabran', 'Otvorite tab iz stranice Monitoring na platformi.');
        // Učitavaju se svi tabovi korisnika da bi strelice mogle da menjaju tab; počinje se od zadatog
        const data = await api('/api/monitoring/state');
        const tabs = mergeTabs(data);
        if (!S.activeId && !tabs.some(t => t.id === tabParam)) return showError('Tab nije pronađen', 'Tab je obrisan ili ne pripada vašem nalogu.');
        // Pri osvežavanju ne prekidaj strimove ako se tabovi i dostupne kamere nisu promenili
        const key = JSON.stringify([tabs, (data.cameras || []).map(c => `${c.id}:${c.isOffline}`)]);
        if (key === S.lastKey) return;
        S.lastKey = key;
        if (data.settings && data.settings.fit) S.player.setFit(data.settings.fit);
        S.tabs = tabs;
        S.camById = new Map((data.cameras || []).map(c => [c.id, c]));
        $('mw-loading').style.display = 'none';
        if (!S.tabs.length) return showError('Nema tabova', 'Napravite bar jedan monitoring tab na platformi.');
        applyRotationSettings(data.settings);
        show(tabById(S.activeId) ? S.activeId : (tabById(tabParam) ? tabParam : S.tabs[0].id));
      }
    } catch (err) {
      showError('Monitoring nije učitan', err.message);
    }
  }

  /* ---------- Traka koja se sama sakriva ---------- */
  function revealBar() {
    $('mw-bar').classList.add('is-visible');
    document.body.style.cursor = '';
    clearTimeout(S.barTimer);
    S.barTimer = setTimeout(() => {
      if (modalOpen()) return;
      $('mw-bar').classList.remove('is-visible');
      document.body.style.cursor = 'none';
    }, 3000);
  }

  function init() {
    S.player = new C.GridPlayer($('mw-grid'), {});
    C.icons();

    $('mw-btn-fullscreen').addEventListener('click', () => C.toggleFullscreen(document.documentElement));
    $('mw-btn-close').addEventListener('click', () => window.close());
    $('mw-btn-rotation').addEventListener('click', () => setRotating(!S.rotating));
    $('mw-btn-rotation-settings').addEventListener('click', openSettings);
    $('mw-btn-rot-save').addEventListener('click', saveSettings);
    const modal = $('mw-modal-rotation');
    modal.querySelectorAll('.modal-close-icon, .btn-modal-cancel').forEach(b => b.addEventListener('click', closeSettings));
    modal.addEventListener('click', (e) => { if (e.target === modal) closeSettings(); });
    document.addEventListener('mousemove', revealBar);
    document.addEventListener('keydown', (e) => {
      if (modalOpen()) {
        if (e.key === 'Escape') closeSettings();
        return;
      }
      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) C.toggleFullscreen(document.documentElement);
      if (e.key === ' ' && S.tabs.length > 1) {
        e.preventDefault();
        setRotating(!S.rotating);
      }
      // Strelice levo/desno: prethodni / sledeći tab (kružno); u rotaciji kreće novo odbrojavanje
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.ctrlKey && !e.metaKey && !e.altKey && S.tabs.length > 1) {
        e.preventDefault();
        const ids = S.tabs.map(t => t.id);
        const i = ids.indexOf(S.activeId);
        const step = e.key === 'ArrowRight' ? 1 : -1;
        show(ids[(i + step + ids.length) % ids.length]);
        if (S.rotating) schedule();
      }
    });

    revealBar();
    load();
    // Povremeno osvežavanje (promene taba, prava i statusa kamera)
    setInterval(() => { if (!S.player.isMaximized()) load(); }, REFRESH_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
