/**
 * ==========================================================================
 * UNIPROMET IT ADMIN - KLIJENTSKA PRAVA (ROLE)
 * Učitava efektivna prava sa /auth/me i prilagođava interfejs:
 * sakriva sekcije/tabove bez prava, dugmad za izmenu kod nivoa "Pregled"
 * i posebne akcije koje rola ne dozvoljava.
 * Merodavna provera je uvek na serveru - ovo je samo prikaz.
 * ==========================================================================
 */
(function () {
  'use strict';

  /** Tab u interfejsu -> ključ podsekcije iz kataloga dozvola */
  const TAB_ITEM = {
    computers: 'mreza.racunari',
    servers: 'mreza.serveri',
    other_devices: 'mreza.ostali',
    printers: 'mreza.stampaci',
    inventory_cameras: 'mreza.kamere',
    inventory_recorders: 'mreza.snimaci',
    rf_readers: 'mreza.rf_citaci',
    wifi_aps: 'mreza.wifi',
    switches: 'mreza.svicevi',
    equipment: 'evidencija.oprema',
    network_equipment: 'evidencija.mrezna_oprema',
    equipment_nodes: 'evidencija.cvorista',
    equipment_lines: 'evidencija.linije',
    mts_numbers: 'evidencija.mts',
    equipment_software: 'evidencija.software',
    equipment_dictionaries: 'evidencija.sifarnici',
    cctv_cameras: 'video.lista',
    cctv_monitoring: 'video.monitoring',
    cameras: 'video.lista',
    ai_agent_prototype: 'noleko.agent_prototip',
    ai_dev_plan: 'noleko.razvojni_plan',
    ai_phased_dev: 'noleko.fazni_razvoj',
    dashboard: 'server.pregled',
    scheduled_services: 'server.servisi',
    logs: 'server.logovi',
    settings: 'server.podesavanja'
  };

  /** data-section atribut u meniju -> ključ sekcije u katalogu */
  const NAV_SECTION = { mreza: 'mreza', evidencija: 'evidencija', video_nadzor: 'video', noleko_ai: 'noleko', server: 'server' };

  /** Tabovi samo za Super admina */
  const SUPER_ONLY_TABS = new Set(['access_roles']);

  /** Lične stranice: nivo "Pregled" je dovoljan i za izmenu sopstvenih podešavanja (bez oznake "samo pregled") */
  const PERSONAL_TABS = new Set(['cctv_monitoring', 'ai_agent_prototype']);

  /** Elementi čije prikazivanje zavisi od posebne akcije ili nivoa izmene */
  const GATED_ELEMENTS = {
    'btn-scan-unrecorded-cameras': { action: 'mreza.kamere:skeniranje' },
    'btn-add-camera-by-ip': { edit: 'inventory_cameras' },
    'btn-sync-wifi-aps': { action: 'mreza.wifi:sinhronizacija' },
    'btn-playback-sync-nvrs': { action: 'mreza.snimaci:sinhronizacija' },
    'btn-open-generate-report': { action: 'mreza.stampaci:izvestaji' },
    'btn-email-single-printer': { action: 'mreza.stampaci:mejl' },
    'btn-email-low-toners': { action: 'mreza.stampaci:mejl' },
    'btn-email-offline-cameras': { edit: 'inventory_cameras' },
    'btn-scan-printers': { edit: 'printers' },
    'btn-export-equipment-excel': { action: 'evidencija.oprema:izvoz' },
    'btn-export-net-excel': { action: 'evidencija.mrezna_oprema:izvoz' },
    'btn-export-nodes-excel': { action: 'evidencija.cvorista:izvoz' },
    'btn-export-lines-excel': { action: 'evidencija.linije:izvoz' },
    'btn-export-mts-excel': { action: 'evidencija.mts:izvoz' },
    'plan-btn-edit': { edit: 'ai_dev_plan' },
    'plan-btn-restore': { edit: 'ai_dev_plan' }
  };

  const EMPTY_ACCESS = {
    isSuperAdmin: false,
    roles: [],
    items: {},
    sections: {},
    actions: [],
    canManageRoles: false,
    cameras: { all: { live: false, playback: false }, byId: {}, byIp: {} }
  };

  let access = null; // null = još nije učitano (bez ograničenja u prikazu)
  let authenticated = false;

  function level(tab) {
    if (!access) return 'edit';
    if (SUPER_ONLY_TABS.has(tab)) return access.isSuperAdmin ? 'edit' : 'none';
    if (access.isSuperAdmin) return 'edit';
    const key = TAB_ITEM[tab];
    if (!key) return 'none';
    return access.items[key] || 'none';
  }

  const api = {
    ready: null,
    get loaded() { return access !== null; },
    get isSuper() { return !access || access.isSuperAdmin; },
    get roles() { return access ? access.roles : []; },
    level,
    canView(tab) { return level(tab) !== 'none'; },
    canEdit(tab) { return level(tab) === 'edit'; },
    has(actionKey) {
      if (!access || access.isSuperAdmin) return true;
      return access.actions.includes(actionKey);
    },
    hasSection(sectionKey) {
      if (!access || access.isSuperAdmin) return true;
      return !!access.sections[sectionKey];
    },
    cameraRightsByIp(ip) {
      if (!access || access.isSuperAdmin) return { live: true, playback: true };
      const r = access.cameras.byIp[ip];
      if (r) return r;
      return access.cameras.all;
    },
    cameraRightsById(id) {
      if (!access || access.isSuperAdmin) return { live: true, playback: true };
      return access.cameras.byId[id] || access.cameras.all;
    },
    /** Da li korisnik uopšte sme da traži podatke o kamerama (video stranice ili inventar) */
    canUseCameraData() {
      if (!access || access.isSuperAdmin) return true;
      const anyCam = access.cameras.all.live || access.cameras.all.playback || Object.keys(access.cameras.byId).length > 0;
      return anyCam || level('cctv_cameras') !== 'none' || level('cctv_monitoring') !== 'none' || level('inventory_cameras') !== 'none';
    },
    canOpenTab(tab) {
      return level(tab) !== 'none';
    },
    firstAllowedTab() {
      const btn = Array.from(document.querySelectorAll('.nav-tab-btn[data-tab]'))
        .find(b => level(b.getAttribute('data-tab')) !== 'none');
      return btn ? btn.getAttribute('data-tab') : 'dashboard';
    },
    /** Poziva se pri svakoj promeni taba: označava da li je aktivna stranica samo za pregled */
    onTabActivated(tab) {
      if (!document.body) return;
      if (access && level(tab) === 'view' && !PERSONAL_TABS.has(tab)) document.body.setAttribute('data-ro-tab', 'true');
      else document.body.removeAttribute('data-ro-tab');
    },
    apply,
    reload
  };

  async function loadAccess() {
    try {
      const res = await fetch('/auth/me', { cache: 'no-store' });
      const data = await res.json();
      authenticated = !!data.isAuthenticated;
      access = data.access || (data.isAuthenticated ? EMPTY_ACCESS : null);
    } catch (err) {
      console.warn('[Access] Prava nisu učitana:', err);
      access = null;
    }
  }

  function hide(el, hidden) {
    el.classList.toggle('access-hidden', hidden);
  }

  function apply() {
    document.body.classList.add('access-ready');
    if (!access) return;

    // 1. Meni: tabovi (desktop + mobilni)
    document.querySelectorAll('.nav-tab-btn[data-tab], .m-nav-item[data-tab]').forEach(btn => {
      hide(btn, level(btn.getAttribute('data-tab')) === 'none');
    });

    // 2. Meni: cele sekcije bez ijednog dozvoljenog taba
    document.querySelectorAll('.nav-section-group').forEach(group => {
      const hasVisible = Array.from(group.querySelectorAll('.nav-tab-btn[data-tab]'))
        .some(b => !b.classList.contains('access-hidden'));
      hide(group, !hasVisible);
    });

    // 3. Samo-pregled: tab dobija data-readonly (CSS sakriva dugmad za izmenu)
    document.querySelectorAll('section.tab-view[id^="tab-"]').forEach(section => {
      const tab = section.id.replace(/^tab-/, '');
      const lvl = level(tab);
      if (lvl === 'view' && !PERSONAL_TABS.has(tab)) section.setAttribute('data-readonly', 'true');
      else section.removeAttribute('data-readonly');
    });

    // 4. Posebne akcije i pojedinačna dugmad
    Object.entries(GATED_ELEMENTS).forEach(([id, rule]) => {
      const el = document.getElementById(id);
      if (!el) return;
      let allowed = true;
      if (rule.action) allowed = api.has(rule.action);
      else if (rule.edit) allowed = api.canEdit(rule.edit);
      hide(el, !allowed);
    });

    // 5. Elementi samo za Super admina
    document.querySelectorAll('[data-super-only]').forEach(el => hide(el, !api.isSuper));
  }

  async function reload() {
    await loadAccess();
    apply();
    return access;
  }

  /* ----------------------------------------------------------------------
     403 poruke za izmene (GET zahtevi se ne prijavljuju - pozadinsko učitavanje)
     ---------------------------------------------------------------------- */
  let lastForbiddenToast = 0;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const response = await nativeFetch(input, init);
    try {
      if (response.status === 403) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        if (method !== 'GET' && url.includes('/api/') && Date.now() - lastForbiddenToast > 3000) {
          const body = await response.clone().json().catch(() => null);
          if (body && body.forbidden) {
            lastForbiddenToast = Date.now();
            if (typeof window.showToast === 'function') {
              window.showToast('Nemate dozvolu za ovu akciju.', 'error');
            }
          }
        }
      }
    } catch (e) { /* ignorisano */ }
    return response;
  };

  // Postojeći kod poziva initUserProfile() posle osvežavanja grupa - ponovo učitaj prava i profil
  window.initUserProfile = function () {
    return reload().then(() => {
      if (typeof window.initAuthWidget === 'function') return window.initAuthWidget();
    });
  };

  api.ready = loadAccess().then(() => {
    // DOM možda još nije spreman - primeni čim bude
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', apply, { once: true });
    } else {
      apply();
    }
  }).catch(() => { document.body && document.body.classList.add('access-ready'); });

  // Ako učitavanje potraje, ne ostavljaj meni skrivenim
  setTimeout(() => { if (document.body) document.body.classList.add('access-ready'); }, 4000);

  window.UniAccess = api;
})();
