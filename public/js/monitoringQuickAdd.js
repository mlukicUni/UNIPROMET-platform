/**
 * ==========================================================================
 * UNIPROMET IT ADMIN - VIDEO NADZOR: DODAJ KAMERU U MONITORING
 * Iz liste kamera: kamera se dodaje u postojeći monitoring tab (izbor polja,
 * zamena ili proširenje rasporeda) ili u novi tab sa izabranim šablonom.
 * Čuva se preko postojećih /api/monitoring ruta (server proverava prava i limite).
 * ==========================================================================
 */
(function () {
  'use strict';

  const API = '/api/monitoring';
  const C = window.MonitoringCore;
  if (!C) return;
  const { esc } = C;

  const Q = {
    state: null,          // { tabs, templates, cameras, limits }
    camById: new Map(),
    allowedIds: null,     // Set id-jeva kamera sa pravom "uživo" (null = još nije učitano)
    cam: null,
    mode: 'existing',
    tabId: '',
    layout: null,         // radna kopija rasporeda izabranog taba
    cameras: [],          // radna kopija kamera po poljima
    templateId: '',       // promenjen samo kad se raspored proširi
    expanded: false,
    slot: -1,
    newTemplateId: 'preset-1',
    saving: false
  };

  const $ = (id) => document.getElementById(id);

  function notify(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }

  async function api(url, method, body) {
    const res = await fetch(url, {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* nije JSON */ }
    if (!res.ok || (data && data.success === false)) {
      throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
    }
    return data || {};
  }

  function canUseMonitoring() {
    return !window.UniAccess || window.UniAccess.canView('cctv_monitoring');
  }

  async function loadState() {
    const data = await api(`${API}/state`);
    Q.state = {
      tabs: data.tabs || [],
      templates: data.templates || [],
      cameras: data.cameras || [],
      limits: data.limits || { maxTabs: 30, maxCells: 25 }
    };
    Q.camById = new Map(Q.state.cameras.map(c => [c.id, c]));
    Q.allowedIds = new Set(Q.state.cameras.map(c => c.id));
  }

  /* ==========================================================================
     DUGMAD U LISTI KAMERA
     ========================================================================== */
  function buttonHtml(camId) {
    if (!camId || !canUseMonitoring()) return '';
    return `<button type="button" class="cctv-cam-btn mqa-add-btn" data-mqa-cam="${esc(camId)}" onclick="event.stopPropagation(); MonitoringQuickAdd.open('${esc(camId)}')" title="Dodaj u monitoring tab" aria-label="Dodaj u monitoring tab"><i data-lucide="grid-2x2-plus"></i></button>`;
  }

  /** Sivi dugmad za kamere bez prava "uživo" (stanje se učitava jednom, u pozadini) */
  async function decorate(root) {
    if (!canUseMonitoring()) return;
    if (!Q.allowedIds) {
      try { await loadState(); } catch (e) { return; }
    }
    (root || document).querySelectorAll('.mqa-add-btn').forEach(btn => {
      const ok = Q.allowedIds.has(btn.dataset.mqaCam);
      btn.classList.toggle('is-disabled', !ok);
      btn.title = ok ? 'Dodaj u monitoring tab' : 'Nemate pravo da gledate ovu kameru uživo';
    });
  }

  /* ==========================================================================
     PROZOR
     ========================================================================== */
  function openModal() {
    const m = $('modal-mon-quick-add');
    m.classList.remove('modal-closing');
    m.style.display = 'flex';
    C.icons(m);
  }

  function closeModal() {
    const m = $('modal-mon-quick-add');
    if (!m || m.style.display === 'none' || m.classList.contains('modal-closing')) return;
    m.classList.add('modal-closing');
    setTimeout(() => {
      m.style.display = 'none';
      m.classList.remove('modal-closing');
    }, 190);
  }

  async function open(camId) {
    try {
      await loadState();
    } catch (err) {
      notify(`Monitoring nije dostupan: ${err.message}`, 'error');
      return;
    }
    const cam = Q.camById.get(camId);
    if (!cam) {
      notify('Ovu kameru ne možete dodati u monitoring (nemate pravo da je gledate uživo).', 'error');
      decorate();
      return;
    }
    Q.cam = cam;
    Q.tabId = '';
    Q.slot = -1;
    Q.layout = null;
    Q.expanded = false;
    Q.newTemplateId = 'preset-1';
    $('mqa-camera-info').textContent = [C.cameraLabel(cam), cam.ip, cam.recorder].filter(Boolean).join(' · ');
    $('mqa-tab-name').value = C.cameraLabel(cam).slice(0, 60);

    const atLimit = Q.state.tabs.length >= Q.state.limits.maxTabs;
    const newPill = document.querySelector('#modal-mon-quick-add [data-mqa-mode="new"]');
    newPill.style.opacity = atLimit ? '0.45' : '';
    newPill.title = atLimit ? `Dostignut je maksimum od ${Q.state.limits.maxTabs} tabova` : '';

    setMode(Q.state.tabs.length ? 'existing' : 'new');
    openModal();
  }

  function setMode(mode) {
    if (mode === 'new' && Q.state.tabs.length >= Q.state.limits.maxTabs) {
      notify(`Možete imati najviše ${Q.state.limits.maxTabs} tabova. Dodajte kameru u postojeći tab.`, 'error');
      return;
    }
    Q.mode = mode;
    document.querySelectorAll('#modal-mon-quick-add [data-mqa-mode]').forEach(p => {
      p.classList.toggle('active-yes', p.dataset.mqaMode === mode);
    });
    $('mqa-existing').style.display = mode === 'existing' ? '' : 'none';
    $('mqa-new').style.display = mode === 'new' ? '' : 'none';
    if (mode === 'existing') renderTabs();
    else renderTemplates();
    updateFooter();
  }

  /* ---------- Postojeći tab ---------- */
  function presetNumber(templateId) {
    const m = /^preset-(\d+)$/.exec(templateId || '');
    return m ? Number(m[1]) : 0;
  }

  /** Sledeći veći predefinisani šablon (samo za tabove napravljene od šablona, do 10 kamera) */
  function nextPreset(tab) {
    const n = presetNumber(tab.templateId);
    if (!n || n >= C.PRESETS.length || tab.layout.cells.length !== n) return null;
    return C.PRESETS[n];
  }

  function renderTabs() {
    const tabs = Q.state.tabs;
    $('mqa-tabs-note').textContent = tabs.length ? 'Izaberite tab, pa polje za kameru' : 'Nemate još nijedan tab';
    $('mqa-tabs').innerHTML = tabs.length ? tabs.map(t => {
      const total = t.layout.cells.length;
      const filled = t.cameras.filter(Boolean).length;
      const already = t.cameras.includes(Q.cam.id);
      const hint = already ? 'Kamera je već u tabu' : `${filled}/${total} ${C.fieldWord(total)}${filled >= total ? ' · pun' : ''}`;
      return `
        <div class="mon-tpl-card ${Q.tabId === t.id ? 'is-selected' : ''}" data-mqa-tab="${esc(t.id)}" role="button" tabindex="0"
             style="${already ? 'opacity: 0.45; cursor: not-allowed;' : ''}">
          ${C.miniLayoutHtml(t.layout)}
          <div class="mon-tpl-card-name"><span>${esc(t.name)}</span><span class="mon-tpl-card-hint">${esc(hint)}</span></div>
        </div>`;
    }).join('') : '<p class="mon-gallery-note">Napravite novi tab izborom opcije „Novi tab“.</p>';
    C.icons($('mqa-tabs'));
    $('mqa-slots-wrap').style.display = Q.tabId ? '' : 'none';
    if (Q.tabId) renderSlots();
  }

  function selectTab(id) {
    const tab = Q.state.tabs.find(t => t.id === id);
    if (!tab) return;
    if (tab.cameras.includes(Q.cam.id)) {
      notify('Kamera je već u ovom tabu.', 'info');
      return;
    }
    Q.tabId = id;
    Q.layout = C.cloneLayout(tab.layout);
    Q.cameras = tab.cameras.slice();
    Q.templateId = tab.templateId;
    Q.expanded = false;
    Q.slot = Q.cameras.findIndex(c => !c);
    renderTabs();
    updateFooter();
  }

  function expandLayout() {
    const tab = Q.state.tabs.find(t => t.id === Q.tabId);
    if (!tab) return;
    if (Q.expanded) {
      // Vrati prvobitni raspored
      Q.layout = C.cloneLayout(tab.layout);
      Q.cameras = tab.cameras.slice();
      Q.templateId = tab.templateId;
      Q.expanded = false;
    } else {
      const next = nextPreset(tab);
      if (!next) return;
      Q.layout = C.cloneLayout(next.layout);
      Q.cameras = C.remapCameras(tab.cameras, Q.layout.cells.length).cameras;
      Q.templateId = next.id;
      Q.expanded = true;
    }
    Q.slot = Q.cameras.findIndex(c => !c);
    renderSlots();
    updateFooter();
  }

  function renderSlots() {
    const tab = Q.state.tabs.find(t => t.id === Q.tabId);
    const grid = $('mqa-grid');
    grid.setAttribute('style', C.gridStyle(Q.layout));
    grid.innerHTML = Q.layout.cells.map((cell, i) => {
      const isTarget = Q.slot === i;
      const camId = Q.cameras[i];
      const cam = camId ? Q.camById.get(camId) : null;
      let cls = '';
      let inner;
      if (isTarget) {
        cls = 'is-filled is-selected';
        inner = `
          <img class="mon-slot-snap" src="${esc(C.snapshotUrl(Q.cam))}" alt="" loading="lazy" onerror="this.remove()">
          <span class="mon-slot-label">${esc(C.cameraLabel(Q.cam))}</span>
          <span class="mon-slot-sub">${cam || camId ? 'menja: ' + esc(cam ? C.cameraLabel(cam) : 'kameru bez pristupa') : 'nova kamera'}</span>`;
      } else if (cam) {
        cls = 'is-filled';
        inner = `
          <img class="mon-slot-snap" src="${esc(C.snapshotUrl(cam))}" alt="" loading="lazy" onerror="this.remove()">
          <span class="mon-slot-label">${esc(C.cameraLabel(cam))}</span>
          <span class="mon-slot-sub">${esc(cam.recorder || cam.ip)}</span>`;
      } else if (camId) {
        cls = 'is-filled is-denied';
        inner = '<i data-lucide="shield-off"></i><span class="mon-slot-label">Nema pristupa</span>';
      } else {
        inner = '<i data-lucide="plus"></i><span class="mon-slot-label">Prazno</span>';
      }
      return `<div class="mon-slot ${cls}" data-mqa-slot="${i}" style="${C.cellStyle(cell)}">
        <span class="mon-slot-num">${i + 1}</span>${inner}</div>`;
    }).join('');
    C.icons(grid);

    const total = Q.layout.cells.length;
    const filled = Q.cameras.filter(Boolean).length;
    $('mqa-slots-info').innerHTML = `Popunjeno <b>${filled}</b> od <b>${total}</b> ${C.fieldWord(total)} · kliknite polje u koje ide kamera`;

    const next = tab ? nextPreset(tab) : null;
    const expandBtn = $('mqa-btn-expand');
    expandBtn.style.display = (next || Q.expanded) ? '' : 'none';
    $('mqa-btn-expand-text').textContent = Q.expanded ? 'Vrati raspored' : (next ? `Proširi na ${next.name}` : '');

    const note = $('mqa-note');
    const replaced = Q.slot >= 0 && Q.cameras[Q.slot];
    if (Q.slot < 0) {
      note.textContent = next
        ? 'Tab je pun. Proširite raspored na veći šablon ili kliknite polje čiju kameru želite da zamenite.'
        : 'Tab je pun. Kliknite polje čiju kameru želite da zamenite.';
      note.style.display = '';
    } else if (replaced) {
      note.textContent = `Kamera u polju ${Q.slot + 1} biće zamenjena (uklanja se iz taba).`;
      note.style.display = '';
    } else if (Q.expanded) {
      note.textContent = `Raspored se proširuje na ${total} ${C.fieldWord(total)}; postojeće kamere zadržavaju redosled polja.`;
      note.style.display = '';
    } else {
      note.style.display = 'none';
    }
  }

  /* ---------- Novi tab ---------- */
  function renderTemplates() {
    const card = (id, name, hint, layout) => `
      <div class="mon-tpl-card ${Q.newTemplateId === id ? 'is-selected' : ''}" data-mqa-tpl="${esc(id)}" role="button" tabindex="0">
        ${C.miniLayoutHtml(layout)}
        <div class="mon-tpl-card-name"><span>${esc(name)}</span><span class="mon-tpl-card-hint">${esc(hint)}</span></div>
      </div>`;
    $('mqa-templates').innerHTML =
      C.PRESETS.map(p => card(p.id, p.name, p.hint, p.layout)).join('') +
      Q.state.templates.map(t => card(t.id, t.name, `${t.layout.cells.length} ${C.fieldWord(t.layout.cells.length)}`, t.layout)).join('');
  }

  function templateLayout(id) {
    const tpl = C.PRESETS.find(p => p.id === id) || Q.state.templates.find(t => t.id === id);
    return tpl ? tpl.layout : null;
  }

  /* ---------- Dno i čuvanje ---------- */
  function updateFooter() {
    const info = $('mqa-footer-info');
    const save = $('mqa-btn-save');
    if (Q.mode === 'existing') {
      const tab = Q.state.tabs.find(t => t.id === Q.tabId);
      save.disabled = !tab || Q.slot < 0;
      info.textContent = tab ? (Q.slot >= 0 ? `Tab „${tab.name}“, polje ${Q.slot + 1}` : 'Izaberite polje') : 'Izaberite tab';
    } else {
      save.disabled = !templateLayout(Q.newTemplateId);
      info.textContent = 'Novi tab, kamera u polju 1';
    }
  }

  async function save() {
    if (Q.saving) return;
    Q.saving = true;
    $('mqa-btn-save').disabled = true;
    try {
      let tab;
      if (Q.mode === 'existing') {
        const cameras = Q.cameras.slice();
        cameras[Q.slot] = Q.cam.id;
        const body = { cameras };
        if (Q.expanded) {
          body.layout = Q.layout;
          body.templateId = Q.templateId;
        }
        tab = (await api(`${API}/tabs/${encodeURIComponent(Q.tabId)}`, 'PUT', body)).tab;
      } else {
        const name = $('mqa-tab-name').value.trim();
        if (!name) {
          notify('Unesite naziv taba.', 'error');
          $('mqa-tab-name').focus();
          return;
        }
        const layout = C.cloneLayout(templateLayout(Q.newTemplateId));
        const cameras = new Array(layout.cells.length).fill(null);
        cameras[0] = Q.cam.id;
        tab = (await api(`${API}/tabs`, 'POST', { name, templateId: Q.newTemplateId, layout, cameras })).tab;
      }
      closeModal();
      Q.state = null;
      Q.allowedIds = null;
      showDoneToast(tab);
    } catch (err) {
      notify(`Greška: ${err.message}`, 'error');
    } finally {
      Q.saving = false;
      if (Q.state) updateFooter();
    }
  }

  /** Poruka o uspehu sa dugmetom „Otvori tab“ */
  function showDoneToast(tab) {
    const deck = $('toast-deck');
    if (!deck || !tab) return;
    const toast = document.createElement('div');
    toast.className = 'unipromet-toast success';
    toast.innerHTML = `
      <i data-lucide="check-circle-2"></i>
      <span>Kamera „${esc(C.cameraLabel(Q.cam))}“ je dodata u tab „${esc(tab.name)}“.</span>
      <button type="button" class="btn-dark-outline-sm" style="margin-left: 10px; white-space: nowrap;"><i data-lucide="external-link"></i><span>Otvori tab</span></button>`;
    deck.appendChild(toast);
    C.icons(toast);
    const remove = () => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    };
    toast.querySelector('button').addEventListener('click', () => {
      remove();
      if (window.MonitoringModule && window.MonitoringModule.openTab) window.MonitoringModule.openTab(tab.id);
    });
    setTimeout(remove, 8000);
  }

  /* ==========================================================================
     INICIJALIZACIJA
     ========================================================================== */
  function init() {
    const m = $('modal-mon-quick-add');
    if (!m) return;
    m.querySelectorAll('.modal-close-icon, .btn-modal-cancel').forEach(b => b.addEventListener('click', (e) => {
      e.preventDefault();
      closeModal();
    }));
    m.querySelectorAll('[data-mqa-mode]').forEach(p => p.addEventListener('click', () => setMode(p.dataset.mqaMode)));

    $('mqa-tabs').addEventListener('click', (e) => {
      const card = e.target.closest('[data-mqa-tab]');
      if (card) selectTab(card.dataset.mqaTab);
    });
    $('mqa-grid').addEventListener('click', (e) => {
      const slot = e.target.closest('[data-mqa-slot]');
      if (!slot) return;
      Q.slot = Number(slot.dataset.mqaSlot);
      renderSlots();
      updateFooter();
    });
    $('mqa-btn-expand').addEventListener('click', expandLayout);
    $('mqa-templates').addEventListener('click', (e) => {
      const card = e.target.closest('[data-mqa-tpl]');
      if (!card) return;
      Q.newTemplateId = card.dataset.mqaTpl;
      renderTemplates();
      updateFooter();
    });
    $('mqa-btn-save').addEventListener('click', save);
    $('mqa-tab-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.MonitoringQuickAdd = { open, buttonHtml, decorate };
})();
