/**
 * ==========================================================================
 * UNIPROMET IT ADMIN - VIDEO NADZOR: MONITORING
 * Lični tabovi sa gridovima kamera (kao tabovi u pretraživaču), čarobnjak za
 * novi tab, dodela kamera, editor custom šablona, rotacija tabova, ceo ekran
 * i otvaranje taba u zasebnom prozoru.
 * ==========================================================================
 */
(function () {
  'use strict';

  const API = '/api/monitoring';
  const C = window.MonitoringCore;
  if (!C) return;
  const { esc } = C;

  const S = {
    visible: false,
    loaded: false,
    loading: false,
    tabs: [],
    sharedAll: [],
    canShare: false,
    templates: [],
    settings: { rotation: { enabled: false, intervalSec: 30, tabIds: [] }, lastTabId: '', fit: 'fill' },
    cameras: [],
    camById: new Map(),
    activeId: '',
    player: null,
    rotation: { timer: null },
    bannerTimer: null,
    dragTabId: '',
    timers: {}
  };

  /* ==========================================================================
     POMOĆNE FUNKCIJE
     ========================================================================== */
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

  function debounce(key, fn, ms) {
    clearTimeout(S.timers[key]);
    S.timers[key] = setTimeout(fn, ms);
  }

  function openModalEl(id) {
    const m = $(id);
    if (!m) return;
    m.classList.remove('modal-closing');
    m.style.display = 'flex';
    C.icons(m);
  }

  function closeModalEl(id) {
    const m = $(id);
    if (!m || m.style.display === 'none' || m.classList.contains('modal-closing')) return;
    m.classList.add('modal-closing');
    setTimeout(() => {
      m.style.display = 'none';
      m.classList.remove('modal-closing');
    }, 190);
  }

  function isModalOpen(id) {
    const m = $(id);
    return !!m && m.style.display !== 'none' && m.style.display !== '';
  }

  function anyModalOpen() {
    return Array.from(document.querySelectorAll('.modal-overlay')).some(m => m.style.display === 'flex');
  }

  function activeTab() {
    return S.tabs.find(t => t.id === S.activeId) || null;
  }

  function templateById(id) {
    return C.PRESETS.find(p => p.id === id) || S.templates.find(t => t.id === id) || null;
  }

  function tabWord(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'tab';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'taba';
    return 'tabova';
  }

  /* ==========================================================================
     UČITAVANJE
     ========================================================================== */
  async function load() {
    if (S.loading) return;
    S.loading = true;
    if (!S.loaded) $('mon-loading').style.display = '';
    try {
      const data = await api(`${API}/state`);
      // Vlastiti tabovi, pa tabovi koje su drugi podelili sa vašim rolama (samo za gledanje)
      S.sharedAll = data.sharedTabs || [];
      S.canShare = !!data.canShare;
      S.tabs = (data.tabs || []).concat(S.sharedAll.filter(t => !t.hidden));
      S.templates = data.templates || [];
      S.settings = data.settings || S.settings;
      S.cameras = data.cameras || [];
      S.camById = new Map(S.cameras.map(c => [c.id, c]));
      S.loaded = true;
      if (!S.tabs.some(t => t.id === S.activeId)) {
        const last = S.settings.lastTabId;
        S.activeId = S.tabs.some(t => t.id === last) ? last : (S.tabs[0] ? S.tabs[0].id : '');
      }
      renderAll();
      if (S.settings.rotation.enabled && S.visible) startRotation(false);
    } catch (err) {
      renderLoadError(err.message);
    } finally {
      S.loading = false;
      $('mon-loading').style.display = 'none';
    }
  }

  function renderLoadError(message) {
    const host = $('mon-grid-host');
    if (S.player) S.player.unmount();
    $('mon-empty').style.display = 'none';
    host.innerHTML = `
      <div class="mon-window-error" style="position: absolute;">
        <i data-lucide="alert-octagon" style="width: 28px; height: 28px; color: #ef4444;"></i>
        <h5>Monitoring nije učitan</h5>
        <p>${esc(message)}</p>
        <button type="button" class="btn-dark-outline-sm" id="mon-btn-retry"><i data-lucide="rotate-cw"></i><span>Pokušaj ponovo</span></button>
      </div>`;
    C.icons(host);
    $('mon-btn-retry').addEventListener('click', () => load());
  }

  /* ==========================================================================
     PRIKAZ: TRAKA TABOVA I GRID
     ========================================================================== */
  function renderAll() {
    renderTabs();
    renderStage();
    renderSummary();
  }

  function renderSummary() {
    const n = S.tabs.length;
    $('mon-summary').textContent = `${n} ${tabWord(n)} · ${S.cameras.length} ${C.cameraWord(S.cameras.length)} dostupno`;
  }

  function renderTabs() {
    const wrap = $('mon-tabs');
    wrap.innerHTML = S.tabs.map(t => {
      const filled = t.cameras.filter(Boolean).length;
      const sharedOut = !t.shared && t.sharedWith && t.sharedWith.length
        ? `<span class="mon-tab-shared-dot" title="Podeljeno sa: ${esc(t.sharedWith.map(s => s.roleName).join(', '))}"><i data-lucide="share-2"></i></span>`
        : '';
      const title = t.shared
        ? `${t.name} — deljeno od: ${t.ownerName || t.ownerEmail || ''} (samo gledanje), desni klik za opcije`
        : `${t.name} — dvoklik za preimenovanje, desni klik za opcije`;
      const closeBtn = t.shared
        ? `<button type="button" class="mon-tab-close" data-hide="${esc(t.id)}" title="Sakrij za mene"><i data-lucide="eye-off"></i></button>`
        : `<button type="button" class="mon-tab-close" data-close="${esc(t.id)}" title="Zatvori (obriši) tab"><i data-lucide="x"></i></button>`;
      return `
        <div class="mon-tab ${t.id === S.activeId ? 'is-active' : ''} ${t.shared ? 'is-shared' : ''}" data-id="${esc(t.id)}" draggable="${t.shared ? 'false' : 'true'}" role="tab"
             aria-selected="${t.id === S.activeId}" title="${esc(title)}">
          <i data-lucide="${t.shared ? 'share-2' : 'layout-grid'}"></i>
          <span class="mon-tab-label">${esc(t.name)}</span>
          ${sharedOut}
          <span class="mon-tab-count">${filled}/${t.layout.cells.length}</span>
          ${closeBtn}
        </div>`;
    }).join('');
    C.icons(wrap);

    const hasTabs = S.tabs.length > 0;
    ['mon-btn-edit', 'mon-btn-rotation', 'mon-btn-rotation-settings', 'mon-btn-fit', 'mon-btn-window', 'mon-btn-fullscreen'].forEach(id => {
      $(id).disabled = !hasTabs;
    });
    updateRotationButton();
    updateFitButton();
    updateSharedUi();

    const active = wrap.querySelector('.mon-tab.is-active');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** Oznaka deljenog taba, dugme za sakrivene deljene tabove i zabrana izmene tuđeg taba */
  function updateSharedUi() {
    const tab = activeTab();
    const shared = !!(tab && tab.shared);
    const edit = $('mon-btn-edit');
    edit.disabled = !tab || shared;
    edit.title = shared ? 'Deljeni tab se ne može menjati — napravite svoju kopiju (desni klik na tab)' : 'Izmeni tab (naziv, šablon, kamere)';

    // Dugme „Podeli“: samo uz pravo deljenja, i samo za vlastiti tab
    const shareBtn = $('mon-btn-share');
    shareBtn.style.display = S.canShare ? '' : 'none';
    shareBtn.disabled = !tab || shared;
    shareBtn.title = shared ? 'Tuđi deljeni tab ne možete dalje deliti' : 'Podeli tab sa rolama';
    shareBtn.classList.toggle('is-on', !!(tab && !shared && tab.sharedWith && tab.sharedWith.length));

    const badge = $('mon-shared-badge');
    badge.style.display = shared ? 'inline-flex' : 'none';
    if (shared) badge.querySelector('span').textContent = `Deljeno od: ${tab.ownerName || tab.ownerEmail || '—'} · samo gledanje`;

    const hiddenCount = S.sharedAll.filter(t => t.hidden).length;
    const hiddenBtn = $('mon-btn-hidden');
    hiddenBtn.style.display = hiddenCount ? '' : 'none';
    hiddenBtn.title = `Sakriveni deljeni tabovi (${hiddenCount})`;
  }

  function currentFit() {
    return C.FIT_MODES.includes(S.settings.fit) ? S.settings.fit : 'fill';
  }

  function updateFitButton() {
    const btn = $('mon-btn-fit');
    const icon = { fill: 'scaling', cover: 'crop', contain: 'rectangle-horizontal' }[currentFit()];
    btn.innerHTML = `<i data-lucide="${icon}"></i>`;
    btn.title = `Prikaz videa: ${C.FIT_LABELS[currentFit()]} (klik za promenu)`;
    C.icons(btn);
  }

  /** Popuni polje → Iseci višak → Ceo kadar */
  function cycleFit() {
    const modes = C.FIT_MODES;
    const next = modes[(modes.indexOf(currentFit()) + 1) % modes.length];
    S.settings.fit = next;
    if (S.player) S.player.setFit(next);
    updateFitButton();
    notify(`Prikaz videa: ${C.FIT_LABELS[next]}`, 'info');
    api(`${API}/settings`, 'PUT', { fit: next }).catch(() => {});
  }

  function renderStage() {
    const tab = activeTab();
    $('mon-empty').style.display = S.loaded && S.tabs.length === 0 ? 'flex' : 'none';
    updateStreamWarning(tab);
    if (S.player) S.player.setFit(currentFit());
    if (!S.player) {
      S.player = new C.GridPlayer($('mon-grid-host'), {
        fit: currentFit(),
        onOpenRecordings: (cam) => {
          if (C.isFullscreen()) C.toggleFullscreen($('mon-stage'));
          if (typeof window.openCameraLiveModal === 'function') {
            window.openCameraLiveModal(cam.ip, C.cameraLabel(cam), cam.recorder || '');
          }
        }
      });
    }
    if (!S.visible || !tab) {
      S.player.render(null);
      return;
    }
    S.player.render(tab, S.camById);
  }

  function updateStreamWarning(tab) {
    const el = $('mon-stream-warn');
    const n = tab ? C.countStreams(tab.cameras, S.camById) : 0;
    if (n > C.WARN_STREAMS) {
      el.style.display = 'inline-flex';
      el.querySelector('span').textContent = `${n} živih strimova`;
    } else {
      el.style.display = 'none';
    }
  }

  function setActive(id, opts) {
    if (!S.tabs.some(t => t.id === id)) return;
    const changed = S.activeId !== id;
    S.activeId = id;
    updateSharedUi();
    document.querySelectorAll('#mon-tabs .mon-tab').forEach(el => {
      const on = el.dataset.id === id;
      el.classList.toggle('is-active', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    if (changed || (opts && opts.force)) renderStage();
    if (opts && opts.banner) showBanner(activeTab().name);
    if (!(opts && opts.fromRotation) && S.rotation.timer) scheduleRotation();
    if (S.settings.lastTabId !== id) {
      S.settings.lastTabId = id;
      debounce('lastTab', () => api(`${API}/settings`, 'PUT', { lastTabId: id }).catch(() => {}), 800);
    }
  }

  function showBanner(text) {
    const el = $('mon-stage-banner');
    el.textContent = text;
    el.classList.add('is-visible');
    clearTimeout(S.bannerTimer);
    S.bannerTimer = setTimeout(() => el.classList.remove('is-visible'), 2500);
  }

  /* ==========================================================================
     TABOVI: KLIK, PREIMENOVANJE, PREVLAČENJE, KONTEKSTNI MENI
     ========================================================================== */
  function bindTabStrip() {
    const wrap = $('mon-tabs');

    wrap.addEventListener('click', (e) => {
      const close = e.target.closest('[data-close]');
      if (close) {
        e.stopPropagation();
        confirmDeleteTab(close.dataset.close);
        return;
      }
      const hide = e.target.closest('[data-hide]');
      if (hide) {
        e.stopPropagation();
        hideShared(hide.dataset.hide);
        return;
      }
      const tabEl = e.target.closest('.mon-tab');
      if (tabEl && !e.target.closest('.mon-tab-rename')) setActive(tabEl.dataset.id);
    });

    wrap.addEventListener('dblclick', (e) => {
      const tabEl = e.target.closest('.mon-tab');
      if (tabEl && !e.target.closest('[data-close], [data-hide]') && !isSharedTab(tabEl.dataset.id)) startRename(tabEl.dataset.id);
    });

    wrap.addEventListener('contextmenu', (e) => {
      const tabEl = e.target.closest('.mon-tab');
      if (!tabEl) return;
      e.preventDefault();
      openContextMenu(tabEl.dataset.id, e.clientX, e.clientY);
    });

    // Promena redosleda prevlačenjem
    wrap.addEventListener('dragstart', (e) => {
      const tabEl = e.target.closest('.mon-tab');
      if (!tabEl) return;
      if (isSharedTab(tabEl.dataset.id)) {
        e.preventDefault();
        return;
      }
      S.dragTabId = tabEl.dataset.id;
      tabEl.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', `tab:${S.dragTabId}`);
    });
    wrap.addEventListener('dragover', (e) => {
      if (!S.dragTabId) return;
      const tabEl = e.target.closest('.mon-tab');
      e.preventDefault();
      wrap.querySelectorAll('.mon-tab').forEach(el => el.classList.remove('is-drop-before', 'is-drop-after'));
      if (!tabEl || tabEl.dataset.id === S.dragTabId || isSharedTab(tabEl.dataset.id)) return;
      const r = tabEl.getBoundingClientRect();
      tabEl.classList.add(e.clientX < r.left + r.width / 2 ? 'is-drop-before' : 'is-drop-after');
    });
    wrap.addEventListener('drop', (e) => {
      if (!S.dragTabId) return;
      e.preventDefault();
      const tabEl = e.target.closest('.mon-tab');
      const dragId = S.dragTabId;
      S.dragTabId = '';
      if (!tabEl || tabEl.dataset.id === dragId || isSharedTab(tabEl.dataset.id)) return renderTabs();
      const before = tabEl.classList.contains('is-drop-before');
      const ids = S.tabs.filter(t => !t.shared).map(t => t.id).filter(id => id !== dragId);
      let idx = ids.indexOf(tabEl.dataset.id);
      if (!before) idx++;
      ids.splice(idx, 0, dragId);
      // Redosled se menja samo među vlastitim tabovima; deljeni ostaju na kraju
      S.tabs = ids.map(id => S.tabs.find(t => t.id === id)).concat(S.tabs.filter(t => t.shared));
      renderTabs();
      api(`${API}/tabs/order`, 'PUT', { ids }).catch(err => notify(`Redosled nije sačuvan: ${err.message}`, 'error'));
    });
    wrap.addEventListener('dragend', () => {
      S.dragTabId = '';
      wrap.querySelectorAll('.mon-tab').forEach(el => el.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after'));
    });
  }

  function isSharedTab(id) {
    const t = S.tabs.find(x => x.id === id);
    return !!(t && t.shared);
  }

  function startRename(id) {
    const tab = S.tabs.find(t => t.id === id);
    const tabEl = document.querySelector(`#mon-tabs .mon-tab[data-id="${CSS.escape(id)}"]`);
    if (!tab || !tabEl || tab.shared) return;
    const label = tabEl.querySelector('.mon-tab-label');
    const input = document.createElement('input');
    input.className = 'mon-tab-rename';
    input.maxLength = 60;
    input.value = tab.name;
    label.replaceWith(input);
    tabEl.draggable = false;
    input.focus();
    input.select();

    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (!save || !name || name === tab.name) return renderTabs();
      try {
        const data = await api(`${API}/tabs/${encodeURIComponent(id)}`, 'PUT', { name });
        replaceTab(data.tab);
        renderTabs();
      } catch (err) {
        notify(err.message, 'error');
        renderTabs();
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
      e.stopPropagation();
    });
    input.addEventListener('blur', () => finish(true));
  }

  function replaceTab(tab) {
    const i = S.tabs.findIndex(t => t.id === tab.id);
    if (i >= 0) {
      tab.sharedWith = S.tabs[i].sharedWith || [];
      S.tabs[i] = tab;
    } else {
      // Novi vlastiti tab ide ispred deljenih
      const firstShared = S.tabs.findIndex(t => t.shared);
      if (firstShared < 0) S.tabs.push(tab);
      else S.tabs.splice(firstShared, 0, tab);
    }
  }

  let ctxMenu = null;

  function closeContextMenu() {
    if (ctxMenu) ctxMenu.remove();
    ctxMenu = null;
  }

  function openContextMenu(id, x, y) {
    closeContextMenu();
    const tab = S.tabs.find(t => t.id === id);
    if (!tab) return;
    const common = [
      { act: 'window', icon: 'app-window', label: 'Otvori u novom prozoru' },
      { act: 'shortcut', icon: 'monitor-up', label: 'Prečica za radnu površinu…' },
      { sep: true }
    ];
    const items = tab.shared
      ? [
        { act: 'duplicate', icon: 'copy', label: 'Napravi moju kopiju' },
        { sep: true },
        ...common,
        { act: 'hide', icon: 'eye-off', label: 'Sakrij za mene' }
      ]
      : [
        { act: 'rename', icon: 'text-cursor-input', label: 'Preimenuj' },
        { act: 'edit', icon: 'pencil', label: 'Izmeni šablon i kamere' },
        { act: 'duplicate', icon: 'copy', label: 'Dupliraj' },
        ...(S.canShare ? [{ act: 'share', icon: 'share-2', label: 'Podeli sa rolama…' }] : []),
        { sep: true },
        ...common,
        { act: 'delete', icon: 'trash-2', label: 'Obriši tab', danger: true }
      ];
    ctxMenu = document.createElement('div');
    ctxMenu.className = 'mon-ctx-menu';
    ctxMenu.innerHTML = items.map(it => it.sep
      ? '<div class="mon-ctx-sep"></div>'
      : `<button type="button" class="mon-ctx-item ${it.danger ? 'is-danger' : ''}" data-act="${it.act}"><i data-lucide="${it.icon}"></i><span>${it.label}</span></button>`
    ).join('');
    document.body.appendChild(ctxMenu);
    C.icons(ctxMenu);

    const r = ctxMenu.getBoundingClientRect();
    ctxMenu.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
    ctxMenu.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;

    ctxMenu.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      closeContextMenu();
      runTabAction(btn.dataset.act, id);
    });
  }

  function runTabAction(act, id) {
    const tab = S.tabs.find(t => t.id === id);
    if (!tab) return;
    if (act === 'duplicate') duplicateTab(id);
    else if (act === 'window') openTabWindow(id);
    else if (act === 'shortcut') openShortcut(`/monitor?tab=${encodeURIComponent(id)}`, tab.name);
    else if (act === 'hide') hideShared(id);
    else if (tab.shared) return; // deljeni tab se ne preimenuje, ne menja i ne briše
    else if (act === 'rename') startRename(id);
    else if (act === 'edit') openWizard('edit', tab);
    else if (act === 'share') openShare(tab);
    else if (act === 'delete') confirmDeleteTab(id);
  }

  async function duplicateTab(id) {
    try {
      const data = await api(`${API}/tabs/${encodeURIComponent(id)}/duplicate`, 'POST');
      replaceTab(data.tab);
      renderTabs();
      setActive(data.tab.id, { force: true });
      renderSummary();
      notify(`Napravljena kopija „${data.tab.name}“`, 'success');
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  function confirmDeleteTab(id) {
    const tab = S.tabs.find(t => t.id === id);
    if (!tab || tab.shared) return;
    confirmAction({
      title: 'Obriši monitoring tab',
      text: `Tab „${tab.name}“ i njegov raspored kamera biće obrisani. Kamere i snimci se ne menjaju.`,
      ok: 'Obriši tab'
    }, async () => {
      try {
        await api(`${API}/tabs/${encodeURIComponent(id)}`, 'DELETE');
        const idx = S.tabs.findIndex(t => t.id === id);
        S.tabs.splice(idx, 1);
        if (S.activeId === id) {
          const next = S.tabs[idx] || S.tabs[idx - 1];
          S.activeId = next ? next.id : '';
        }
        if (S.tabs.length < 2) stopRotation(true);
        renderAll();
        notify('Tab je obrisan', 'success');
      } catch (err) {
        notify(err.message, 'error');
      }
    });
  }

  /* ==========================================================================
     DELJENI TABOVI: SAKRIVANJE
     ========================================================================== */
  async function saveHidden(ids) {
    const data = await api(`${API}/settings`, 'PUT', { hiddenShared: ids });
    S.settings.hiddenShared = data.settings.hiddenShared || ids;
  }

  async function hideShared(id) {
    const tab = S.sharedAll.find(t => t.id === id);
    if (!tab) return;
    const ids = S.sharedAll.filter(t => t.hidden).map(t => t.id).concat(id);
    try {
      await saveHidden(ids);
      tab.hidden = true;
      const idx = S.tabs.findIndex(t => t.id === id);
      if (idx >= 0) S.tabs.splice(idx, 1);
      if (S.activeId === id) {
        const next = S.tabs[idx] || S.tabs[idx - 1];
        S.activeId = next ? next.id : '';
      }
      if (S.tabs.length < 2) stopRotation(true);
      renderAll();
      notify(`Tab „${tab.name}“ je sakriven. Vraćate ga dugmetom sa precrtanim okom u traci.`, 'info');
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  async function unhideShared(id) {
    const tab = S.sharedAll.find(t => t.id === id);
    if (!tab) return;
    try {
      await saveHidden(S.sharedAll.filter(t => t.hidden && t.id !== id).map(t => t.id));
      tab.hidden = false;
      S.tabs.push(tab);
      renderTabs();
      setActive(id, { force: true });
      renderSummary();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  function openHiddenMenu() {
    closeContextMenu();
    const hidden = S.sharedAll.filter(t => t.hidden);
    if (!hidden.length) return;
    ctxMenu = document.createElement('div');
    ctxMenu.className = 'mon-ctx-menu';
    ctxMenu.innerHTML = hidden.map(t => `
      <button type="button" class="mon-ctx-item" data-unhide="${esc(t.id)}"><i data-lucide="eye"></i><span>Prikaži „${esc(t.name)}“ (${esc(t.ownerName || '')})</span></button>`).join('');
    document.body.appendChild(ctxMenu);
    C.icons(ctxMenu);
    const b = $('mon-btn-hidden').getBoundingClientRect();
    const r = ctxMenu.getBoundingClientRect();
    ctxMenu.style.left = `${Math.max(8, Math.min(b.right - r.width, window.innerWidth - r.width - 8))}px`;
    ctxMenu.style.top = `${b.bottom + 6}px`;
    ctxMenu.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-unhide]');
      if (!btn) return;
      closeContextMenu();
      unhideShared(btn.dataset.unhide);
    });
  }

  /* ==========================================================================
     DELJENJE TABA SA ROLAMA (vlasnik taba)
     ========================================================================== */
  const SH = { tabId: '', roles: [], cameraCount: 0 };

  async function openShare(tab) {
    SH.tabId = tab.id;
    SH.roles = [];
    $('mon-share-sub').textContent = `Tab „${tab.name}“`;
    $('mon-share-list').innerHTML = '<div class="mon-picker-empty">Učitavam role...</div>';
    $('mon-share-footer').textContent = '';
    $('mon-btn-share-save').disabled = true;
    openModalEl('modal-mon-share');
    try {
      const data = await api(`${API}/share-roles?tabId=${encodeURIComponent(tab.id)}`);
      SH.roles = data.roles || [];
      SH.cameraCount = data.cameraCount || 0;
      const chosen = new Set((tab.sharedWith || []).map(s => s.roleId));
      renderShareList(chosen);
    } catch (err) {
      closeModalEl('modal-mon-share');
      notify(err.message, 'error');
    }
  }

  function renderShareList(chosen) {
    const list = $('mon-share-list');
    if (!SH.roles.length) {
      list.innerHTML = '<div class="mon-picker-empty">Nema definisanih rola.</div>';
      return;
    }
    list.innerHTML = SH.roles.map(r => {
      const warn = r.missingCameras > 0;
      const right = warn
        ? `${r.missingCameras}/${SH.cameraCount} ${C.cameraWord(SH.cameraCount)} bez prava`
        : `${r.assignmentCount} dodela`;
      const tip = warn
        ? `Članovi ove role nemaju pravo da gledaju ${r.missingCameras} od ${SH.cameraCount} kamera iz ovog taba uživo; ta polja će im biti prikazana kao „Nema pristupa“.`
        : (r.description || '');
      return `
        <label class="mon-rot-item" title="${esc(tip)}">
          <input type="checkbox" value="${esc(r.id)}" ${chosen.has(r.id) ? 'checked' : ''}>
          <span>${esc(r.name)}</span>
          <span class="${warn ? 'mon-share-role-warn' : ''}">${esc(right)}</span>
        </label>`;
    }).join('');
    updateShareFooter();
  }

  function updateShareFooter() {
    const n = $('mon-share-list').querySelectorAll('input:checked').length;
    $('mon-share-footer').textContent = n ? `Izabrano rola: ${n}` : 'Tab nije podeljen ni sa jednom rolom';
    $('mon-btn-share-save').disabled = !SH.roles.length;
  }

  async function saveShare() {
    const roleIds = Array.from($('mon-share-list').querySelectorAll('input:checked')).map(i => i.value);
    const btn = $('mon-btn-share-save');
    btn.disabled = true;
    try {
      const data = await api(`${API}/tabs/${encodeURIComponent(SH.tabId)}/shares`, 'PUT', { roleIds });
      const tab = S.tabs.find(t => t.id === SH.tabId);
      if (tab) tab.sharedWith = data.sharedWith || [];
      closeModalEl('modal-mon-share');
      renderTabs();
      notify(roleIds.length ? `Tab je podeljen sa rolama: ${(data.sharedWith || []).map(s => s.roleName).join(', ')}` : 'Deljenje taba je uklonjeno', 'success');
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function bindSharing() {
    $('mon-btn-share-save').addEventListener('click', saveShare);
    $('mon-share-list').addEventListener('change', updateShareFooter);
    $('mon-btn-share').addEventListener('click', () => {
      const t = activeTab();
      if (t && !t.shared) openShare(t);
    });
    $('mon-btn-hidden').addEventListener('click', (e) => {
      e.stopPropagation();
      openHiddenMenu();
    });
  }

  /* ==========================================================================
     POTVRDA
     ========================================================================== */
  let confirmCb = null;

  function confirmAction(opts, cb) {
    $('mon-confirm-title').textContent = opts.title;
    $('mon-confirm-text').textContent = opts.text;
    $('mon-confirm-ok-label').textContent = opts.ok || 'Obriši';
    confirmCb = cb;
    openModalEl('modal-mon-confirm');
  }

  /* ==========================================================================
     NOVI PROZOR I PREČICA
     ========================================================================== */
  function openTabWindow(id) {
    const url = `/monitor?tab=${encodeURIComponent(id)}`;
    const w = window.open(url, `uni_mon_${id}`, 'popup=yes,width=1280,height=760,menubar=no,toolbar=no,location=no,status=no');
    if (!w) notify('Pretraživač je blokirao novi prozor. Dozvolite iskačuće prozore za ovu adresu.', 'error');
  }

  function openRotationWindow() {
    const w = window.open('/monitor?tour=1', 'uni_mon_tour', 'popup=yes,width=1280,height=760,menubar=no,toolbar=no,location=no,status=no');
    if (!w) notify('Pretraživač je blokirao novi prozor. Dozvolite iskačuće prozore za ovu adresu.', 'error');
  }

  /**
   * Prečica na radnoj površini. Čarobnjak „Create Shortcut“ traži punu putanju do programa.
   * Edge i Chrome imaju "app" režim (bez adresne trake i tabova); Firefox nema, pa ide ceo ekran (kiosk).
   */
  const SHORTCUT_BROWSERS = [
    { id: 'edge', label: 'Edge', exe: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', args: (u) => `--app="${u}"`, note: 'Prozor bez adresne trake i tabova.' },
    { id: 'chrome', label: 'Chrome', exe: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', args: (u) => `--app="${u}"`, note: 'Prozor bez adresne trake i tabova.' },
    { id: 'opera', label: 'Opera', exe: '%LOCALAPPDATA%\\Programs\\Opera\\opera.exe', args: (u) => `--new-window "${u}"`, note: 'Opera nema „app“ prozor: otvara se običan novi prozor sa adresnom trakom. Putanja koristi %LOCALAPPDATA% jer se Opera instalira po korisniku.' },
    { id: 'firefox', label: 'Firefox', exe: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe', args: (u) => `-kiosk "${u}"`, note: 'Firefox nema „app“ prozor: otvara se preko celog ekrana (kiosk), zatvara se sa Alt+F4.' }
  ];
  const SC = { path: '', browser: 'edge' };

  function shortcutCommand() {
    const b = SHORTCUT_BROWSERS.find(x => x.id === SC.browser) || SHORTCUT_BROWSERS[0];
    return `"${b.exe}" ${b.args(`${location.origin}${SC.path}`)}`;
  }

  function renderShortcut() {
    const b = SHORTCUT_BROWSERS.find(x => x.id === SC.browser) || SHORTCUT_BROWSERS[0];
    $('mon-sc-browsers').innerHTML = SHORTCUT_BROWSERS.map(x => `
      <label class="sw-radio-pill ${x.id === SC.browser ? 'active-yes' : ''}" data-sc-browser="${x.id}" style="cursor: pointer;"><span>${x.label}</span></label>`).join('');
    $('mon-sc-browser-note').textContent = b.note;
    $('mon-sc-cmd').value = shortcutCommand();
  }

  function openShortcut(path, name) {
    SC.path = path;
    try {
      const saved = localStorage.getItem('uni_mon_shortcut_browser');
      if (SHORTCUT_BROWSERS.some(x => x.id === saved)) SC.browser = saved;
    } catch (e) { /* localStorage nije dostupan */ }
    $('mon-sc-sub').textContent = name ? `Tab „${name}“ u zasebnom prozoru` : 'Rotacija tabova u zasebnom prozoru';
    renderShortcut();
    openModalEl('modal-mon-shortcut');
  }

  async function copyShortcut() {
    const cmd = shortcutCommand();
    try {
      await navigator.clipboard.writeText(cmd);
    } catch (e) {
      const ta = $('mon-sc-cmd');
      ta.select();
      try { document.execCommand('copy'); } catch (err) { /* ignorisano */ }
    }
    closeModalEl('modal-mon-shortcut');
    notify('Komanda je kopirana. Desni klik na radnu površinu → Novo → Prečica, pa je nalepite (Ctrl+V) kao lokaciju stavke.', 'success');
  }

  function bindShortcut() {
    $('mon-sc-browsers').addEventListener('click', (e) => {
      const pill = e.target.closest('[data-sc-browser]');
      if (!pill) return;
      SC.browser = pill.dataset.scBrowser;
      try { localStorage.setItem('uni_mon_shortcut_browser', SC.browser); } catch (err) { /* ignorisano */ }
      renderShortcut();
    });
    $('mon-sc-copy').addEventListener('click', copyShortcut);
  }

  /* ==========================================================================
     ROTACIJA TABOVA
     ========================================================================== */
  function rotationTabIds() {
    const chosen = (S.settings.rotation.tabIds || []).filter(id => S.tabs.some(t => t.id === id));
    return chosen.length >= 2 ? chosen : S.tabs.map(t => t.id);
  }

  function updateRotationButton() {
    const btn = $('mon-btn-rotation');
    const running = !!S.rotation.timer;
    btn.classList.toggle('is-on', running);
    btn.innerHTML = running
      ? '<i data-lucide="pause"></i><span>Rotacija</span>'
      : '<i data-lucide="repeat"></i><span>Rotacija</span>';
    btn.title = running ? `Zaustavi rotaciju (na svakih ${S.settings.rotation.intervalSec} s)` : 'Pokreni rotaciju tabova';
    C.icons(btn);
  }

  function scheduleRotation() {
    clearTimeout(S.rotation.timer);
    const sec = S.settings.rotation.intervalSec || 30;
    const bar = $('mon-rotation-bar');
    const fill = bar.querySelector('span');
    bar.classList.add('is-on');
    fill.style.transition = 'none';
    fill.style.width = '0';
    void fill.offsetWidth;
    fill.style.transition = `width ${sec}s linear`;
    fill.style.width = '100%';
    S.rotation.timer = setTimeout(rotateNext, sec * 1000);
  }

  function rotateNext() {
    // Ne menjaj tab dok je kamera uvećana ili je otvoren neki prozor (modal)
    if ((S.player && S.player.isMaximized()) || anyModalOpen()) return scheduleRotation();
    const ids = rotationTabIds();
    if (ids.length < 2) return stopRotation(true);
    const i = ids.indexOf(S.activeId);
    const next = ids[(i + 1) % ids.length];
    setActive(next, { banner: true, fromRotation: true });
    scheduleRotation();
  }

  function startRotation(persist) {
    if (rotationTabIds().length < 2) {
      if (persist) notify('Za rotaciju su potrebna bar 2 taba.', 'info');
      return;
    }
    if (!S.visible) return;
    scheduleRotation();
    updateRotationButton();
    if (persist) {
      S.settings.rotation.enabled = true;
      api(`${API}/settings`, 'PUT', { rotation: { enabled: true } }).catch(() => {});
      notify(`Rotacija pokrenuta: smena na svakih ${S.settings.rotation.intervalSec} s`, 'success');
    }
  }

  /** persist=true: korisnik je isključio rotaciju; false: samo pauza dok stranica nije otvorena */
  function stopRotation(persist) {
    clearTimeout(S.rotation.timer);
    S.rotation.timer = null;
    const bar = $('mon-rotation-bar');
    bar.classList.remove('is-on');
    bar.querySelector('span').style.width = '0';
    updateRotationButton();
    if (persist && S.settings.rotation.enabled) {
      S.settings.rotation.enabled = false;
      api(`${API}/settings`, 'PUT', { rotation: { enabled: false } }).catch(() => {});
    }
  }

  function openRotationSettings() {
    $('mon-rot-interval').value = String(S.settings.rotation.intervalSec || 30);
    if (!$('mon-rot-interval').value) $('mon-rot-interval').value = '30';
    const chosen = new Set(S.settings.rotation.tabIds || []);
    $('mon-rot-list').innerHTML = S.tabs.map(t => `
      <label class="mon-rot-item">
        <input type="checkbox" value="${esc(t.id)}" ${chosen.has(t.id) ? 'checked' : ''}>
        <span>${esc(t.name)}${t.shared ? ' · deljeno' : ''}</span>
        <span>${t.layout.cells.length} ${C.fieldWord(t.layout.cells.length)}</span>
      </label>`).join('') || '<div class="mon-picker-empty">Još nema tabova.</div>';
    openModalEl('modal-mon-rotation');
  }

  async function saveRotationSettings() {
    const intervalSec = Number($('mon-rot-interval').value) || 30;
    const tabIds = Array.from($('mon-rot-list').querySelectorAll('input:checked')).map(i => i.value);
    try {
      const data = await api(`${API}/settings`, 'PUT', { rotation: { intervalSec, tabIds } });
      S.settings = data.settings;
      closeModalEl('modal-mon-rotation');
      if (S.rotation.timer) scheduleRotation();
      updateRotationButton();
      notify('Podešavanja rotacije su sačuvana', 'success');
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  /* ==========================================================================
     ČAROBNJAK: NOVI TAB / IZMENA TABA
     ========================================================================== */
  const W = {
    mode: 'create',
    tabId: '',
    step: 1,
    templateId: '',
    layout: null,
    cameras: [],
    currentLayout: null,
    selectedSlot: -1,
    dragSlot: -1
  };

  function openWizard(mode, tab) {
    W.mode = mode;
    W.step = 1;
    W.selectedSlot = -1;
    if (mode === 'edit' && tab) {
      W.tabId = tab.id;
      W.templateId = '__current';
      W.currentLayout = C.cloneLayout(tab.layout);
      W.layout = C.cloneLayout(tab.layout);
      W.cameras = tab.cameras.slice();
      $('mon-tab-name').value = tab.name;
      $('mon-tab-modal-title').textContent = 'Izmena taba';
      $('mon-tab-modal-sub').textContent = 'Promenite naziv, raspored ili kamere u poljima';
    } else {
      W.tabId = '';
      W.templateId = 'preset-4';
      W.currentLayout = null;
      W.layout = C.cloneLayout(C.PRESETS[3].layout);
      W.cameras = new Array(W.layout.cells.length).fill(null);
      $('mon-tab-name').value = '';
      $('mon-tab-modal-title').textContent = 'Novi monitoring tab';
      $('mon-tab-modal-sub').textContent = 'Naziv i raspored, zatim dodela kamera poljima';
    }
    $('mon-remap-note').style.display = 'none';
    $('mon-picker-search').value = '';
    fillRecorderFilter();
    renderGallery();
    showStep(1);
    openModalEl('modal-mon-tab');
    setTimeout(() => $('mon-tab-name').focus(), 60);
  }

  function showStep(step) {
    W.step = step;
    $('mon-step-1').style.display = step === 1 ? '' : 'none';
    $('mon-step-2').style.display = step === 2 ? '' : 'none';
    document.querySelectorAll('#modal-mon-tab .mon-step').forEach(b => b.classList.toggle('is-active', Number(b.dataset.step) === step));
    $('mon-btn-step-back').style.display = step === 2 ? '' : 'none';
    $('mon-btn-step-next').style.display = step === 1 ? '' : 'none';
    // U izmeni se može sačuvati iz oba koraka
    $('mon-btn-tab-save').style.display = (step === 2 || W.mode === 'edit') ? '' : 'none';
    if (step === 2) {
      renderPicker();
      renderSlots();
    }
    updateWizardFooter();
  }

  function validateName() {
    const input = $('mon-tab-name');
    if (input.value.trim()) return true;
    notify('Unesite naziv taba.', 'error');
    showStep(1);
    input.focus();
    return false;
  }

  function updateWizardFooter() {
    const filled = W.cameras.filter(Boolean).length;
    const total = W.layout.cells.length;
    const tpl = W.templateId === '__current' ? { name: 'Trenutni raspored' } : templateById(W.templateId);
    $('mon-tab-footer-info').textContent = `${tpl ? tpl.name : 'Šablon'} · ${total} ${C.fieldWord(total)} · popunjeno ${filled}`;
  }

  function galleryCard(id, name, hint, layout, opts) {
    const selected = W.templateId === id;
    return `
      <div class="mon-tpl-card ${selected ? 'is-selected' : ''}" data-tpl="${esc(id)}" role="button" tabindex="0">
        ${opts && opts.custom ? `
          <div class="mon-tpl-card-actions">
            <button type="button" data-tpl-edit="${esc(id)}" title="Izmeni šablon"><i data-lucide="pencil"></i></button>
            <button type="button" class="is-danger" data-tpl-del="${esc(id)}" title="Obriši šablon"><i data-lucide="trash-2"></i></button>
          </div>` : ''}
        ${C.miniLayoutHtml(layout)}
        <div class="mon-tpl-card-name"><span>${esc(name)}</span><span class="mon-tpl-card-hint">${esc(hint)}</span></div>
      </div>`;
  }

  function renderGallery() {
    $('mon-gallery-presets').innerHTML = C.PRESETS.map(p => galleryCard(p.id, p.name, p.hint, p.layout)).join('');
    let custom = '';
    if (W.currentLayout) {
      custom += galleryCard('__current', 'Trenutni raspored', `${W.currentLayout.cells.length} ${C.fieldWord(W.currentLayout.cells.length)}`, W.currentLayout);
    }
    custom += S.templates.map(t => galleryCard(t.id, t.name, `${t.layout.cells.length} ${C.fieldWord(t.layout.cells.length)}`, t.layout, { custom: true })).join('');
    custom += `<button type="button" class="mon-tpl-card is-new" id="mon-btn-new-template"><i data-lucide="plus-circle"></i><span>Napravi novi šablon</span></button>`;
    $('mon-gallery-custom').innerHTML = custom;
    C.icons($('mon-gallery-presets'));
    C.icons($('mon-gallery-custom'));
  }

  function selectTemplate(id) {
    let layout;
    if (id === '__current') layout = W.currentLayout;
    else {
      const tpl = templateById(id);
      if (!tpl) return;
      layout = tpl.layout;
    }
    W.templateId = id;
    W.layout = C.cloneLayout(layout);
    const res = C.remapCameras(W.cameras, W.layout.cells.length);
    W.cameras = res.cameras;
    W.selectedSlot = -1;
    const note = $('mon-remap-note');
    if (res.dropped > 0) {
      note.textContent = `Novi šablon ima ${W.layout.cells.length} ${C.fieldWord(W.layout.cells.length)}: ${res.dropped} ${C.cameraWord(res.dropped)} iz prethodnog rasporeda ne staje i biće uklonjeno.`;
      note.style.display = '';
    } else {
      note.style.display = 'none';
    }
    document.querySelectorAll('#modal-mon-tab .mon-tpl-card[data-tpl]').forEach(el => el.classList.toggle('is-selected', el.dataset.tpl === id));
    updateWizardFooter();
  }

  function bindWizard() {
    const modal = $('modal-mon-tab');

    modal.addEventListener('click', (e) => {
      const edit = e.target.closest('[data-tpl-edit]');
      if (edit) {
        e.stopPropagation();
        const tpl = S.templates.find(t => t.id === edit.dataset.tplEdit);
        if (tpl) openTemplateEditor(tpl);
        return;
      }
      const del = e.target.closest('[data-tpl-del]');
      if (del) {
        e.stopPropagation();
        confirmDeleteTemplate(del.dataset.tplDel);
        return;
      }
      if (e.target.closest('#mon-btn-new-template')) {
        openTemplateEditor(null);
        return;
      }
      const card = e.target.closest('.mon-tpl-card[data-tpl]');
      if (card) selectTemplate(card.dataset.tpl);
    });
    modal.addEventListener('dblclick', (e) => {
      const card = e.target.closest('.mon-tpl-card[data-tpl]');
      if (card && W.step === 1 && validateName()) showStep(2);
    });

    modal.querySelectorAll('.mon-step').forEach(b => b.addEventListener('click', () => {
      const step = Number(b.dataset.step);
      if (step === 2 && !validateName()) return;
      showStep(step);
    }));
    $('mon-btn-step-next').addEventListener('click', () => { if (validateName()) showStep(2); });
    $('mon-btn-step-back').addEventListener('click', () => showStep(1));
    $('mon-btn-tab-save').addEventListener('click', saveWizard);
    $('mon-tab-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (W.mode === 'edit') saveWizard();
        else if (validateName()) showStep(2);
      }
    });

    // Korak 2: lista kamera
    $('mon-picker-search').addEventListener('input', () => debounce('picker', renderPicker, 150));
    $('mon-picker-recorder').addEventListener('change', renderPicker);
    $('mon-btn-autofill').addEventListener('click', autofill);
    $('mon-btn-clear-cams').addEventListener('click', () => {
      W.cameras = W.cameras.map(() => null);
      W.selectedSlot = -1;
      renderSlots();
      renderPicker();
    });

    const list = $('mon-picker-list');
    list.addEventListener('click', (e) => {
      const row = e.target.closest('.mon-picker-cam');
      if (row) assignCamera(row.dataset.cam);
    });
    list.addEventListener('dragstart', (e) => {
      const row = e.target.closest('.mon-picker-cam');
      if (!row) return;
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData('text/plain', `cam:${row.dataset.cam}`);
    });

    // Korak 2: polja grida
    const grid = $('mon-assign-grid');
    grid.addEventListener('click', (e) => {
      const rm = e.target.closest('.mon-slot-remove');
      const slot = e.target.closest('.mon-slot');
      if (!slot) return;
      const i = Number(slot.dataset.slot);
      if (rm) {
        e.stopPropagation();
        W.cameras[i] = null;
        renderSlots();
        renderPicker();
        return;
      }
      W.selectedSlot = W.selectedSlot === i ? -1 : i;
      renderSlots();
    });
    grid.addEventListener('dragstart', (e) => {
      const slot = e.target.closest('.mon-slot.is-filled');
      if (!slot) return;
      W.dragSlot = Number(slot.dataset.slot);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', `slot:${W.dragSlot}`);
    });
    grid.addEventListener('dragover', (e) => {
      const slot = e.target.closest('.mon-slot');
      if (!slot) return;
      e.preventDefault();
      grid.querySelectorAll('.mon-slot.is-drop').forEach(s => s !== slot && s.classList.remove('is-drop'));
      slot.classList.add('is-drop');
    });
    grid.addEventListener('dragleave', (e) => {
      const slot = e.target.closest('.mon-slot');
      if (slot && !slot.contains(e.relatedTarget)) slot.classList.remove('is-drop');
    });
    grid.addEventListener('drop', (e) => {
      const slot = e.target.closest('.mon-slot');
      if (!slot) return;
      e.preventDefault();
      const target = Number(slot.dataset.slot);
      const data = e.dataTransfer.getData('text/plain') || '';
      if (data.startsWith('cam:')) {
        assignCamera(data.slice(4), target);
      } else if (data.startsWith('slot:')) {
        const from = Number(data.slice(5));
        if (from !== target) {
          const tmp = W.cameras[target];
          W.cameras[target] = W.cameras[from];
          W.cameras[from] = tmp;
        }
        W.dragSlot = -1;
        renderSlots();
      }
    });
    grid.addEventListener('dragend', () => {
      W.dragSlot = -1;
      grid.querySelectorAll('.mon-slot.is-drop').forEach(s => s.classList.remove('is-drop'));
    });
  }

  function fillRecorderFilter() {
    const names = [...new Set(S.cameras.map(c => c.recorder).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sr'));
    const sel = $('mon-picker-recorder');
    const prev = sel.value;
    sel.innerHTML = `<option value="">Svi snimači (${S.cameras.length})</option>` +
      names.map(n => `<option value="${esc(n)}">${esc(n)} (${S.cameras.filter(c => c.recorder === n).length})</option>`).join('');
    if (names.includes(prev)) sel.value = prev;
  }

  function filteredCameras() {
    const q = $('mon-picker-search').value.trim().toLowerCase();
    const rec = $('mon-picker-recorder').value;
    return S.cameras.filter(c => {
      if (rec && c.recorder !== rec) return false;
      if (!q) return true;
      return [c.name, c.position, c.ip, c.recorder].some(v => String(v || '').toLowerCase().includes(q));
    });
  }

  function renderPicker() {
    const list = $('mon-picker-list');
    const cams = filteredCameras();
    if (!S.cameras.length) {
      list.innerHTML = '<div class="mon-picker-empty">Nemate pravo pregleda uživo ni za jednu kameru.<br>Obratite se administratoru za dodelu role.</div>';
      return;
    }
    if (!cams.length) {
      list.innerHTML = '<div class="mon-picker-empty">Nijedna kamera ne odgovara pretrazi.</div>';
      return;
    }
    const used = new Map();
    W.cameras.forEach((id, i) => { if (id) used.set(id, i + 1); });
    const groups = new Map();
    cams.forEach(c => {
      const key = c.recorder || 'Bez snimača';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    });
    let html = '';
    groups.forEach((items, name) => {
      html += `<div class="mon-picker-group"><span>${esc(name)}</span><span>${items.length}</span></div>`;
      html += items.map(c => `
        <div class="mon-picker-cam ${used.has(c.id) ? 'is-used' : ''} ${c.isOffline ? 'is-offline' : ''}" data-cam="${esc(c.id)}" draggable="true"
             title="${esc(C.cameraLabel(c))} · ${esc(c.ip)}${c.isOffline ? ' · offline' : ''}">
          <i data-lucide="${c.isOffline ? 'video-off' : 'video'}"></i>
          <span class="mon-picker-cam-name">${esc(C.cameraLabel(c))}</span>
          ${used.has(c.id) ? `<span class="mon-picker-cam-badge">#${used.get(c.id)}</span>` : `<span class="mon-picker-cam-ip">${esc(c.ip)}</span>`}
        </div>`).join('');
    });
    list.innerHTML = html;
    C.icons(list);
  }

  function renderSlots() {
    const grid = $('mon-assign-grid');
    grid.setAttribute('style', C.gridStyle(W.layout));
    grid.innerHTML = W.layout.cells.map((cell, i) => {
      const camId = W.cameras[i];
      const cam = camId ? S.camById.get(camId) : null;
      const selected = W.selectedSlot === i ? 'is-selected' : '';
      let inner;
      let cls = '';
      if (cam) {
        cls = 'is-filled';
        inner = `
          <img class="mon-slot-snap" src="${esc(C.snapshotUrl(cam))}" alt="" loading="lazy" onerror="this.remove()">
          <span class="mon-slot-label">${esc(C.cameraLabel(cam))}</span>
          <span class="mon-slot-sub">${esc(cam.recorder || cam.ip)}</span>
          <button type="button" class="mon-slot-remove" title="Ukloni kameru iz polja"><i data-lucide="x"></i></button>`;
      } else if (camId) {
        cls = 'is-filled is-denied';
        inner = `<i data-lucide="shield-off"></i><span class="mon-slot-label">Nema pristupa</span>
          <button type="button" class="mon-slot-remove" title="Ukloni iz polja"><i data-lucide="x"></i></button>`;
      } else {
        inner = `<i data-lucide="plus"></i><span class="mon-slot-label">${W.selectedSlot === i ? 'Izaberite kameru' : 'Prazno'}</span>`;
      }
      return `<div class="mon-slot ${cls} ${selected}" data-slot="${i}" style="${C.cellStyle(cell)}" ${cam || camId ? 'draggable="true"' : ''}>
        <span class="mon-slot-num">${i + 1}</span>${inner}</div>`;
    }).join('');
    C.icons(grid);

    const filled = W.cameras.filter(Boolean).length;
    const total = W.layout.cells.length;
    $('mon-assign-info').innerHTML = `Popunjeno <b>${filled}</b> od <b>${total}</b> ${C.fieldWord(total)}`;
    const live = C.countStreams(W.cameras, S.camById);
    const warn = $('mon-assign-warn');
    if (live > C.WARN_STREAMS) {
      warn.textContent = `Tab ima ${live} živih strimova. Svaki strim ide preko servera — više od ${C.WARN_STREAMS} može da uspori prikaz i mrežu.`;
      warn.style.display = '';
    } else {
      warn.style.display = 'none';
    }
    updateWizardFooter();
  }

  /** Dodela kamere polju: izabrano polje, zadato polje ili prvo prazno. Kamera se ne ponavlja - premešta se. */
  function assignCamera(camId, slotIndex) {
    if (!S.camById.has(camId)) return;
    let target = slotIndex !== undefined ? slotIndex : W.selectedSlot;
    if (target < 0) target = W.cameras.findIndex(v => !v);
    if (target < 0) {
      notify('Sva polja su popunjena. Izaberite polje koje želite da promenite.', 'info');
      return;
    }
    const prev = W.cameras.indexOf(camId);
    if (prev >= 0 && prev !== target) W.cameras[prev] = W.cameras[target] && slotIndex !== undefined ? W.cameras[target] : null;
    W.cameras[target] = camId;
    // Posle izbora preko kliknutog polja pređi na sledeće prazno
    if (slotIndex === undefined && W.selectedSlot >= 0) {
      const nextEmpty = W.cameras.findIndex((v, i) => !v && i > target);
      W.selectedSlot = nextEmpty;
    }
    renderSlots();
    renderPicker();
  }

  function autofill() {
    const used = new Set(W.cameras.filter(Boolean));
    const pool = filteredCameras().filter(c => !used.has(c.id));
    if (!pool.length) {
      notify('Nema slobodnih kamera u trenutnom filteru.', 'info');
      return;
    }
    let added = 0;
    for (let i = 0; i < W.cameras.length && pool.length; i++) {
      if (!W.cameras[i]) {
        W.cameras[i] = pool.shift().id;
        added++;
      }
    }
    if (!added) notify('Nema praznih polja za popunjavanje.', 'info');
    W.selectedSlot = -1;
    renderSlots();
    renderPicker();
  }

  async function saveWizard() {
    if (!validateName()) return;
    const body = {
      name: $('mon-tab-name').value.trim(),
      templateId: W.templateId === '__current' ? (activeTabById(W.tabId) || {}).templateId || '' : W.templateId,
      layout: W.layout,
      cameras: W.cameras
    };
    const btn = $('mon-btn-tab-save');
    btn.disabled = true;
    try {
      let data;
      if (W.mode === 'edit') {
        data = await api(`${API}/tabs/${encodeURIComponent(W.tabId)}`, 'PUT', body);
        replaceTab(data.tab);
        notify(`Tab „${data.tab.name}“ je sačuvan`, 'success');
      } else {
        data = await api(`${API}/tabs`, 'POST', body);
        S.tabs.push(data.tab);
        notify(`Napravljen tab „${data.tab.name}“`, 'success');
      }
      closeModalEl('modal-mon-tab');
      S.activeId = data.tab.id;
      renderTabs();
      setActive(data.tab.id, { force: true });
      renderSummary();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function activeTabById(id) {
    return S.tabs.find(t => t.id === id) || null;
  }

  function confirmDeleteTemplate(id) {
    const tpl = S.templates.find(t => t.id === id);
    if (!tpl) return;
    confirmAction({
      title: 'Obriši šablon',
      text: `Šablon „${tpl.name}“ biće obrisan. Tabovi koji ga koriste zadržavaju svoj raspored.`,
      ok: 'Obriši šablon'
    }, async () => {
      try {
        await api(`${API}/templates/${encodeURIComponent(id)}`, 'DELETE');
        S.templates = S.templates.filter(t => t.id !== id);
        if (W.templateId === id) W.templateId = '';
        renderGallery();
        updateWizardFooter();
        notify('Šablon je obrisan', 'success');
      } catch (err) {
        notify(err.message, 'error');
      }
    });
  }

  /* ==========================================================================
     EDITOR CUSTOM ŠABLONA
     ========================================================================== */
  const E = {
    id: null,
    cols: 4,
    rows: 4,
    cells: [],
    selected: new Set(),
    history: [],
    future: [],
    drag: null
  };

  function snapshot() {
    return JSON.stringify({ cols: E.cols, rows: E.rows, cells: E.cells });
  }

  function pushHistory() {
    E.history.push(snapshot());
    if (E.history.length > 100) E.history.shift();
    E.future = [];
  }

  function restoreSnap(s) {
    const o = JSON.parse(s);
    E.cols = o.cols;
    E.rows = o.rows;
    E.cells = o.cells;
    E.selected = new Set();
  }

  function openTemplateEditor(tpl) {
    E.id = tpl ? tpl.id : null;
    E.history = [];
    E.future = [];
    E.selected = new Set();
    if (tpl) {
      E.cols = tpl.layout.cols;
      E.rows = tpl.layout.rows;
      E.cells = tpl.layout.cells.map(c => ({ ...c }));
      $('mon-tpl-name').value = tpl.name;
      $('mon-tpl-title').textContent = 'Izmena šablona';
    } else {
      // Prazna mreža 4×4; gotov raspored se bira u "Kreni od šablona"
      E.cols = 4;
      E.rows = 4;
      E.cells = [];
      $('mon-tpl-name').value = '';
      $('mon-tpl-title').textContent = 'Novi šablon';
    }
    fillEditorSelects();
    renderEditor();
    openModalEl('modal-mon-template');
    setTimeout(() => $('mon-tpl-name').focus(), 60);
  }

  function fillEditorSelects() {
    const opts = (max) => Array.from({ length: max }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
    $('mon-tpl-cols').innerHTML = opts(C.MAX_GRID);
    $('mon-tpl-rows').innerHTML = opts(C.MAX_GRID);
    $('mon-tpl-cols').value = String(E.cols);
    $('mon-tpl-rows').value = String(E.rows);
    $('mon-tpl-base').innerHTML = '<option value="">— Izaberite polaznu osnovu —</option>' +
      '<optgroup label="Predefinisani">' + C.PRESETS.map(p => `<option value="${p.id}">${esc(p.name)} (${esc(p.hint)})</option>`).join('') + '</optgroup>' +
      (S.templates.length ? '<optgroup label="Moji šabloni">' + S.templates.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('') + '</optgroup>' : '');
  }

  function occupancy(exceptSet) {
    const map = new Map();
    E.cells.forEach((c, i) => {
      if (exceptSet && exceptSet.has(i)) return;
      for (let x = c.x; x < c.x + c.w; x++) for (let y = c.y; y < c.y + c.h; y++) map.set(`${x}:${y}`, i);
    });
    return map;
  }

  function fits(rect, exceptSet) {
    if (rect.x < 1 || rect.y < 1 || rect.w < 1 || rect.h < 1) return false;
    if (rect.x + rect.w - 1 > E.cols || rect.y + rect.h - 1 > E.rows) return false;
    const occ = occupancy(exceptSet);
    for (let x = rect.x; x < rect.x + rect.w; x++) for (let y = rect.y; y < rect.y + rect.h; y++) if (occ.has(`${x}:${y}`)) return false;
    return true;
  }

  function rectStyle(r) {
    const l = ((r.x - 1) / E.cols) * 100;
    const t = ((r.y - 1) / E.rows) * 100;
    const w = (r.w / E.cols) * 100;
    const h = (r.h / E.rows) * 100;
    return `left: calc(${l}% + 2px); top: calc(${t}% + 2px); width: calc(${w}% - 4px); height: calc(${h}% - 4px);`;
  }

  /** Redni broj polja po čitanju (red po red) - tim redom se dodeljuju kamere */
  function readingOrder() {
    const order = E.cells.map((c, i) => ({ c, i })).sort((a, b) => (a.c.y - b.c.y) || (a.c.x - b.c.x));
    const rank = new Map();
    order.forEach((o, n) => rank.set(o.i, n + 1));
    return rank;
  }

  function renderEditor() {
    const canvas = $('mon-tpl-canvas');
    const rank = readingOrder();
    const units = Array.from({ length: E.cols * E.rows }, () => '<span></span>').join('');
    const single = E.selected.size === 1 ? [...E.selected][0] : -1;
    canvas.style.setProperty('--r', String(C.layoutRatio(E)));
    canvas.innerHTML = `
      <div class="mon-tpl-units" style="grid-template-columns: repeat(${E.cols}, 1fr); grid-template-rows: repeat(${E.rows}, 1fr);">${units}</div>
      ${E.cells.map((c, i) => `
        <div class="mon-tpl-cell ${E.selected.has(i) ? 'is-selected' : ''}" data-cell="${i}" style="${rectStyle(c)}">
          ${rank.get(i)}<small>${c.w}×${c.h}</small>
          ${i === single ? ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'].map(h => `<span class="mon-tpl-handle" data-h="${h}"></span>`).join('') : ''}
        </div>`).join('')}
      <div class="mon-tpl-draft" id="mon-tpl-draft" style="display: none;"></div>`;

    // Pregled i statistika
    const sorted = C.sortCells(E.cells);
    $('mon-tpl-preview').innerHTML = sorted.length
      ? C.miniLayoutHtml({ cols: E.cols, rows: E.rows, cells: sorted })
      : '<div class="mon-mini" style="display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:0.72rem;">Nema polja</div>';
    const covered = E.cells.reduce((s, c) => s + c.w * c.h, 0);
    const empty = E.cols * E.rows - covered;
    const offRatio = E.cells.filter(c => c.w !== c.h).length;
    $('mon-tpl-stats').innerHTML = `
      <span>Polja: <b>${E.cells.length}</b> / ${C.MAX_CELLS}</span>
      <span>Mreža: <b>${E.cols}×${E.rows}</b> (svaka ćelija 16:9)</span>
      ${empty > 0 ? `<span class="is-warn">Prazne ćelije: ${empty} — ostaće crne</span>` : '<span>Ceo prostor je popunjen</span>'}
      ${offRatio > 0 ? `<span class="is-warn">${offRatio} ${C.fieldWord(offRatio)} nije u razmeri kamere (širina ≠ visina) — slika će biti razvučena ili isečena</span>` : '<span>Sva polja su u razmeri kamere</span>'}`;
    $('mon-tpl-footer-info').textContent = E.selected.size ? `Izabrano: ${E.selected.size}` : '';

    // Stanje alata
    const tools = document.querySelectorAll('#modal-mon-template [data-tool]');
    tools.forEach(b => {
      const t = b.dataset.tool;
      let enabled = true;
      if (['split-v', 'split-h', 'split-4', 'duplicate'].includes(t)) enabled = single >= 0;
      if (t === 'merge') enabled = E.selected.size >= 2;
      if (t === 'delete') enabled = E.selected.size > 0;
      if (t === 'undo') enabled = E.history.length > 0;
      if (t === 'redo') enabled = E.future.length > 0;
      if (t === 'clear') enabled = E.cells.length > 0;
      if (t === 'fill') enabled = empty > 0;
      b.disabled = !enabled;
    });
  }

  function unitAt(e) {
    const r = $('mon-tpl-canvas').getBoundingClientRect();
    const x = Math.min(E.cols, Math.max(1, Math.floor(((e.clientX - r.left) / r.width) * E.cols) + 1));
    const y = Math.min(E.rows, Math.max(1, Math.floor(((e.clientY - r.top) / r.height) * E.rows) + 1));
    return { x, y };
  }

  function bindEditor() {
    const canvas = $('mon-tpl-canvas');

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const handle = e.target.closest('.mon-tpl-handle');
      const cellEl = e.target.closest('.mon-tpl-cell');
      const u = unitAt(e);
      canvas.setPointerCapture(e.pointerId);

      if (handle && cellEl) {
        const i = Number(cellEl.dataset.cell);
        E.drag = { mode: 'resize', i, h: handle.dataset.h, orig: { ...E.cells[i] }, cand: null };
        return;
      }
      if (cellEl) {
        const i = Number(cellEl.dataset.cell);
        if (e.shiftKey) {
          if (E.selected.has(i)) E.selected.delete(i);
          else E.selected.add(i);
          renderEditor();
          E.drag = null;
          return;
        }
        if (!E.selected.has(i) || E.selected.size > 1) {
          E.selected = new Set([i]);
          renderEditor();
        }
        E.drag = { mode: 'move', i, start: u, orig: { ...E.cells[i] }, cand: null };
        return;
      }
      if (!e.shiftKey && E.selected.size) {
        E.selected = new Set();
        renderEditor();
      }
      E.drag = { mode: 'draw', start: u, cand: null };
    });

    canvas.addEventListener('pointermove', (e) => {
      const d = E.drag;
      if (!d) return;
      const u = unitAt(e);
      let cand;
      if (d.mode === 'draw') {
        cand = { x: Math.min(d.start.x, u.x), y: Math.min(d.start.y, u.y), w: Math.abs(u.x - d.start.x) + 1, h: Math.abs(u.y - d.start.y) + 1 };
        const ok = fits(cand) && E.cells.length < C.MAX_CELLS;
        const draft = $('mon-tpl-draft');
        draft.style.display = 'block';
        draft.setAttribute('style', `${rectStyle(cand)} display: block;`);
        draft.classList.toggle('is-invalid', !ok);
        d.cand = ok ? cand : null;
        return;
      }
      const o = d.orig;
      if (d.mode === 'move') {
        const nx = Math.min(E.cols - o.w + 1, Math.max(1, o.x + (u.x - d.start.x)));
        const ny = Math.min(E.rows - o.h + 1, Math.max(1, o.y + (u.y - d.start.y)));
        cand = { x: nx, y: ny, w: o.w, h: o.h };
      } else {
        let x1 = o.x;
        let y1 = o.y;
        let x2 = o.x + o.w - 1;
        let y2 = o.y + o.h - 1;
        if (d.h.includes('w')) x1 = Math.min(u.x, x2);
        if (d.h.includes('e')) x2 = Math.max(u.x, x1);
        if (d.h.includes('n')) y1 = Math.min(u.y, y2);
        if (d.h.includes('s')) y2 = Math.max(u.y, y1);
        cand = { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 };
      }
      const ok = fits(cand, new Set([d.i]));
      const el = canvas.querySelector(`.mon-tpl-cell[data-cell="${d.i}"]`);
      if (el) {
        el.style.left = '';
        el.setAttribute('style', rectStyle(cand));
        el.classList.toggle('is-invalid', !ok);
        const small = el.querySelector('small');
        if (small) small.textContent = `${cand.w}×${cand.h}`;
      }
      d.cand = ok ? cand : null;
    });

    const endDrag = () => {
      const d = E.drag;
      E.drag = null;
      if (!d) return;
      if (d.mode === 'draw') {
        if (d.cand) {
          pushHistory();
          E.cells.push(d.cand);
          E.selected = new Set([E.cells.length - 1]);
        } else if (E.cells.length >= C.MAX_CELLS) {
          notify(`Šablon može imati najviše ${C.MAX_CELLS} polja.`, 'info');
        }
      } else if (d.cand && (d.cand.x !== d.orig.x || d.cand.y !== d.orig.y || d.cand.w !== d.orig.w || d.cand.h !== d.orig.h)) {
        pushHistory();
        E.cells[d.i] = d.cand;
      }
      renderEditor();
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    document.querySelectorAll('#modal-mon-template [data-tool]').forEach(b => b.addEventListener('click', () => runTool(b.dataset.tool)));

    $('mon-tpl-cols').addEventListener('change', () => changeDensity(Number($('mon-tpl-cols').value), E.rows));
    $('mon-tpl-rows').addEventListener('change', () => changeDensity(E.cols, Number($('mon-tpl-rows').value)));
    $('mon-tpl-base').addEventListener('change', () => {
      const id = $('mon-tpl-base').value;
      const tpl = templateById(id);
      $('mon-tpl-base').value = '';
      if (!tpl) return;
      pushHistory();
      E.cols = tpl.layout.cols;
      E.rows = tpl.layout.rows;
      E.cells = tpl.layout.cells.map(c => ({ ...c }));
      E.selected = new Set();
      $('mon-tpl-cols').value = String(E.cols);
      $('mon-tpl-rows').value = String(E.rows);
      if (!$('mon-tpl-name').value.trim()) $('mon-tpl-name').value = `${tpl.name} – prilagođen`;
      renderEditor();
    });
    $('mon-btn-tpl-save').addEventListener('click', saveTemplate);

    document.addEventListener('keydown', (e) => {
      if (!isModalOpen('modal-mon-template')) return;
      const typing = /^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || '');
      if (!typing && (e.key === 'Delete' || e.key === 'Backspace') && E.selected.size) {
        e.preventDefault();
        runTool('delete');
      } else if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        runTool(e.shiftKey ? 'redo' : 'undo');
      } else if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        runTool('redo');
      }
    });
  }

  /** Promena gustine: umnožak postojeće mreže skalira polja, inače polja moraju da stanu */
  function changeDensity(cols, rows) {
    if (cols === E.cols && rows === E.rows) return;
    const fx = cols / E.cols;
    const fy = rows / E.rows;
    let next;
    if (Number.isInteger(fx) && Number.isInteger(fy)) {
      next = E.cells.map(c => ({ x: (c.x - 1) * fx + 1, y: (c.y - 1) * fy + 1, w: c.w * fx, h: c.h * fy }));
    } else if (E.cells.every(c => c.x + c.w - 1 <= cols && c.y + c.h - 1 <= rows)) {
      next = E.cells.map(c => ({ ...c }));
    } else {
      notify('Neka polja ne staju u manju mrežu. Smanjite ih ili obrišite pa pokušajte ponovo.', 'error');
      $('mon-tpl-cols').value = String(E.cols);
      $('mon-tpl-rows').value = String(E.rows);
      return;
    }
    pushHistory();
    E.cols = cols;
    E.rows = rows;
    E.cells = next;
    renderEditor();
  }

  /** Udvostruči gustinu po osi (za podelu polja širine/visine 1) */
  function refine(axis) {
    if (axis === 'x') {
      if (E.cols * 2 > C.MAX_GRID) return false;
      E.cells = E.cells.map(c => ({ ...c, x: (c.x - 1) * 2 + 1, w: c.w * 2 }));
      E.cols *= 2;
    } else {
      if (E.rows * 2 > C.MAX_GRID) return false;
      E.cells = E.cells.map(c => ({ ...c, y: (c.y - 1) * 2 + 1, h: c.h * 2 }));
      E.rows *= 2;
    }
    return true;
  }

  function splitCell(i, axis) {
    let c = E.cells[i];
    if ((axis === 'x' ? c.w : c.h) < 2) {
      if (!refine(axis)) return false;
      c = E.cells[i];
    }
    if (axis === 'x') {
      const w1 = Math.floor(c.w / 2);
      E.cells[i] = { ...c, w: w1 };
      E.cells.push({ x: c.x + w1, y: c.y, w: c.w - w1, h: c.h });
    } else {
      const h1 = Math.floor(c.h / 2);
      E.cells[i] = { ...c, h: h1 };
      E.cells.push({ x: c.x, y: c.y + h1, w: c.w, h: c.h - h1 });
    }
    return true;
  }

  function runTool(tool) {
    const single = E.selected.size === 1 ? [...E.selected][0] : -1;
    if (tool === 'undo') {
      if (!E.history.length) return;
      E.future.push(snapshot());
      restoreSnap(E.history.pop());
    } else if (tool === 'redo') {
      if (!E.future.length) return;
      E.history.push(snapshot());
      restoreSnap(E.future.pop());
    } else if (tool === 'split-v' || tool === 'split-h' || tool === 'split-4') {
      if (single < 0) return;
      const needed = tool === 'split-4' ? 3 : 1;
      if (E.cells.length + needed > C.MAX_CELLS) return notify(`Šablon može imati najviše ${C.MAX_CELLS} polja.`, 'info');
      const before = snapshot();
      let ok;
      if (tool === 'split-4') {
        const n = E.cells.length;
        ok = splitCell(single, 'x');
        if (ok) ok = splitCell(single, 'y') && splitCell(n, 'y');
      } else {
        ok = splitCell(single, tool === 'split-v' ? 'x' : 'y');
      }
      if (!ok) {
        restoreSnap(before);
        return notify(`Polje se ne može dalje deliti — mreža je već najfinija (${C.MAX_GRID} ćelija).`, 'info');
      }
      E.history.push(before);
      E.future = [];
      E.selected = new Set();
      $('mon-tpl-cols').value = String(E.cols);
      $('mon-tpl-rows').value = String(E.rows);
    } else if (tool === 'merge') {
      const sel = [...E.selected].map(i => E.cells[i]);
      const x1 = Math.min(...sel.map(c => c.x));
      const y1 = Math.min(...sel.map(c => c.y));
      const x2 = Math.max(...sel.map(c => c.x + c.w - 1));
      const y2 = Math.max(...sel.map(c => c.y + c.h - 1));
      const rect = { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 };
      if (!fits(rect, E.selected)) return notify('Izabrana polja se ne mogu spojiti: unutar pravougaonika je drugo polje.', 'error');
      pushHistory();
      E.cells = E.cells.filter((_, i) => !E.selected.has(i));
      E.cells.push(rect);
      E.selected = new Set([E.cells.length - 1]);
    } else if (tool === 'fill') {
      const occ = occupancy();
      const add = [];
      for (let y = 1; y <= E.rows; y++) for (let x = 1; x <= E.cols; x++) if (!occ.has(`${x}:${y}`)) add.push({ x, y, w: 1, h: 1 });
      const room = C.MAX_CELLS - E.cells.length;
      if (room <= 0) return notify(`Šablon već ima ${C.MAX_CELLS} polja.`, 'info');
      pushHistory();
      E.cells = E.cells.concat(add.slice(0, room));
      if (add.length > room) notify(`Dodato ${room} polja; dostignut je maksimum od ${C.MAX_CELLS}.`, 'info');
    } else if (tool === 'duplicate') {
      if (single < 0) return;
      if (E.cells.length >= C.MAX_CELLS) return notify(`Šablon može imati najviše ${C.MAX_CELLS} polja.`, 'info');
      const c = E.cells[single];
      let spot = null;
      for (let y = 1; y <= E.rows - c.h + 1 && !spot; y++) {
        for (let x = 1; x <= E.cols - c.w + 1 && !spot; x++) {
          if (fits({ x, y, w: c.w, h: c.h })) spot = { x, y, w: c.w, h: c.h };
        }
      }
      if (!spot) return notify('Nema slobodnog mesta iste veličine.', 'info');
      pushHistory();
      E.cells.push(spot);
      E.selected = new Set([E.cells.length - 1]);
    } else if (tool === 'delete') {
      if (!E.selected.size) return;
      pushHistory();
      E.cells = E.cells.filter((_, i) => !E.selected.has(i));
      E.selected = new Set();
    } else if (tool === 'clear') {
      if (!E.cells.length) return;
      pushHistory();
      E.cells = [];
      E.selected = new Set();
    }
    $('mon-tpl-cols').value = String(E.cols);
    $('mon-tpl-rows').value = String(E.rows);
    renderEditor();
  }

  async function saveTemplate() {
    const name = $('mon-tpl-name').value.trim();
    if (!name) {
      notify('Unesite naziv šablona.', 'error');
      $('mon-tpl-name').focus();
      return;
    }
    if (!E.cells.length) {
      notify('Nacrtajte bar jedno polje.', 'error');
      return;
    }
    const layout = { cols: E.cols, rows: E.rows, cells: C.sortCells(E.cells) };
    const btn = $('mon-btn-tpl-save');
    btn.disabled = true;
    try {
      let tpl;
      if (E.id) {
        tpl = (await api(`${API}/templates/${encodeURIComponent(E.id)}`, 'PUT', { name, layout })).template;
        S.templates = S.templates.map(t => t.id === tpl.id ? tpl : t);
      } else {
        tpl = (await api(`${API}/templates`, 'POST', { name, layout })).template;
        S.templates.push(tpl);
      }
      closeModalEl('modal-mon-template');
      notify(`Šablon „${tpl.name}“ je sačuvan`, 'success');
      if (isModalOpen('modal-mon-tab')) {
        renderGallery();
        selectTemplate(tpl.id);
      }
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  /* ==========================================================================
     INICIJALIZACIJA
     ========================================================================== */
  function bindModalClose(id) {
    const m = $(id);
    if (!m) return;
    m.querySelectorAll('.modal-close-icon, .btn-modal-cancel').forEach(b => b.addEventListener('click', (e) => {
      e.preventDefault();
      closeModalEl(id);
    }));
  }

  function init() {
    if (!$('tab-cctv_monitoring')) return;

    ['modal-mon-tab', 'modal-mon-template', 'modal-mon-rotation', 'modal-mon-confirm', 'modal-mon-share', 'modal-mon-shortcut'].forEach(bindModalClose);
    bindSharing();
    bindShortcut();

    bindTabStrip();
    bindWizard();
    bindEditor();

    $('mon-btn-new-tab').addEventListener('click', () => openWizard('create'));
    $('mon-btn-empty-new').addEventListener('click', () => openWizard('create'));
    $('mon-btn-edit').addEventListener('click', () => { const t = activeTab(); if (t && !t.shared) openWizard('edit', t); });
    $('mon-btn-rotation').addEventListener('click', () => {
      if (S.rotation.timer) {
        stopRotation(true);
        notify('Rotacija je zaustavljena', 'info');
      } else {
        startRotation(true);
      }
    });
    $('mon-btn-rotation-settings').addEventListener('click', openRotationSettings);
    $('mon-btn-rot-save').addEventListener('click', saveRotationSettings);
    $('mon-btn-rot-window').addEventListener('click', openRotationWindow);
    $('mon-btn-window').addEventListener('click', () => { if (S.activeId) openTabWindow(S.activeId); });
    $('mon-btn-fit').addEventListener('click', cycleFit);
    $('mon-btn-fullscreen').addEventListener('click', () => C.toggleFullscreen($('mon-stage')));
    $('mon-confirm-ok').addEventListener('click', () => {
      const cb = confirmCb;
      confirmCb = null;
      closeModalEl('modal-mon-confirm');
      if (cb) cb();
    });

    document.addEventListener('fullscreenchange', () => {
      const tab = activeTab();
      if (C.isFullscreen() && document.fullscreenElement === $('mon-stage') && tab) showBanner(tab.name);
    });

    document.addEventListener('click', (e) => {
      if (ctxMenu && !ctxMenu.contains(e.target)) closeContextMenu();
    });
    window.addEventListener('blur', closeContextMenu);
    window.addEventListener('resize', closeContextMenu);

    // Prečica: F = ceo ekran (dok je stranica otvorena i ne kuca se u polje)
    document.addEventListener('keydown', (e) => {
      if (!S.visible || anyModalOpen()) return;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || '')) return;
      if (e.key === 'Escape') closeContextMenu();
      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey && S.tabs.length) {
        C.toggleFullscreen($('mon-stage'));
      }
      // Strelice levo/desno: prethodni / sledeći tab (kružno)
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && S.tabs.length > 1) {
        e.preventDefault();
        closeContextMenu();
        const i = S.tabs.findIndex(t => t.id === S.activeId);
        const step = e.key === 'ArrowRight' ? 1 : -1;
        const next = S.tabs[(i + step + S.tabs.length) % S.tabs.length];
        setActive(next.id, { banner: true });
      }
    });
  }

  function onTabActivated() {
    S.visible = true;
    if (!S.player) renderStage();
    load();
  }

  function onTabDeactivated() {
    if (!S.visible) return;
    S.visible = false;
    closeContextMenu();
    if (S.player) S.player.unmount();
    stopRotation(false);
    if (C.isFullscreen() && document.fullscreenElement === $('mon-stage')) C.toggleFullscreen($('mon-stage'));
  }

  /** Spolja (npr. iz liste kamera): otvara Monitoring na zadatom tabu */
  function openTab(id) {
    S.activeId = id; // load() zadržava aktivni tab ako postoji
    if (S.visible) load();
    else if (typeof window.activateTab === 'function') window.activateTab('cctv_monitoring');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.MonitoringModule = { onTabActivated, onTabDeactivated, reload: load, openTab };
})();
