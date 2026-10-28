/**
 * ==========================================================================
 * UNIPROMET IT ADMIN - KORISNICI I ROLE (Super admin)
 * Role, dozvole po sekcijama/podsekcijama, pristup kamerama (sve / grupa /
 * pojedinačno), dodele korisnicima i AD grupama, grupe kamera, provera
 * efektivnih prava i evidencija.
 * ==========================================================================
 */
(function () {
  'use strict';

  const API = '/api/access';

  const LEVEL_LABEL = { none: 'Nema', view: 'Pregled', edit: 'Izmena' };
  const LEVEL_RANK = { none: 0, view: 1, edit: 2 };

  const EVENT_LABELS = {
    'camera.live': 'Kamera uživo',
    'camera.playback': 'Snimci kamere',
    'camera.clip': 'Preuzimanje klipa',
    'role.create': 'Nova rola',
    'role.update': 'Izmena role',
    'role.delete': 'Brisanje role',
    'role.permissions': 'Dozvole role',
    'role.cameras': 'Kamere role',
    'role.assign': 'Dodela role',
    'role.unassign': 'Oduzimanje role',
    'cameragroup.create': 'Nova grupa kamera',
    'cameragroup.update': 'Izmena grupe kamera',
    'cameragroup.delete': 'Brisanje grupe kamera',
    'auth.login': 'Prijava',
    'auth.denied': 'Prijava odbijena',
    'access.denied': 'Odbijen pristup'
  };

  const S = {
    initialized: false,
    loading: false,
    catalog: [],
    roles: [],
    groups: [],
    tree: { recorders: [], unassigned: [], groups: [], totalCameras: 0 },
    camRec: new Map(),        // cameraId -> recorderId | null
    camInfo: new Map(),       // cameraId -> {id,name,ip,position}
    groupMembers: new Map(),  // groupId -> Set(cameraId)
    known: { users: [], groups: [] },
    mainTab: 'roles',
    rolesSearch: '',
    editor: {
      role: null,
      assignments: [],
      perms: new Map(),
      cam: null,
      editTab: 'perms',
      permsDirty: false,
      camDirty: false,
      camSearch: '',
      openRecorders: new Set()
    },
    audit: { items: [], total: 0, offset: 0, q: '', action: '' },
    groupModal: { id: null, members: new Set(), search: '', openRecorders: new Set() },
    assignMode: 'user',
    confirmCb: null,
    timers: {}
  };

  /* ==========================================================================
     HELPERS
     ========================================================================== */
  const $ = (id) => document.getElementById(id);

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function notify(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }

  function icons() {
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
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

  function fmtTime(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('sr-RS', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return iso; }
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
    icons();
  }

  function closeModalEl(id) {
    const m = $(id);
    if (!m) return;
    if (typeof window.closeModal === 'function') window.closeModal(m);
    else m.style.display = 'none';
  }

  function askConfirm({ title, text, okLabel, okIcon }) {
    return new Promise((resolve) => {
      $('ar-confirm-title').textContent = title || 'Potvrda';
      $('ar-confirm-text').textContent = text || '';
      $('ar-confirm-ok-label').textContent = okLabel || 'Potvrdi';
      const icon = $('ar-confirm-ok').querySelector('i, svg');
      if (icon && okIcon) icon.setAttribute('data-lucide', okIcon);
      S.confirmCb = () => resolve(true);
      openModalEl('modal-ar-confirm');
    });
  }

  const rank = (l) => LEVEL_RANK[l || 'none'] || 0;
  const maxLvl = (a, b) => (rank(a) >= rank(b) ? a : b);

  /* ==========================================================================
     UČITAVANJE
     ========================================================================== */
  async function loadAll() {
    if (S.loading) return;
    S.loading = true;
    try {
      const [cat, roles, tree, known] = await Promise.all([
        api(`${API}/catalog`),
        api(`${API}/roles`),
        api(`${API}/camera-tree`),
        api(`${API}/known`)
      ]);
      S.catalog = cat.sections || [];
      S.roles = roles.roles || [];
      applyTree(tree);
      S.known = { users: known.users || [], groups: known.groups || [] };
      renderRolesList();
      renderGroups();
      updateBadges();
      if (S.editor.role) {
        renderPerms();
        renderCamTree();
      }
    } catch (err) {
      console.error('[AccessRoles] Greška pri učitavanju:', err);
      notify(`Greška pri učitavanju: ${err.message}`, 'error');
    } finally {
      S.loading = false;
    }
  }

  function applyTree(tree) {
    S.tree = tree;
    S.groups = tree.groups || [];
    S.camRec = new Map();
    S.camInfo = new Map();
    (tree.recorders || []).forEach(r => r.cameras.forEach(c => {
      S.camRec.set(c.id, r.id);
      S.camInfo.set(c.id, c);
    }));
    (tree.unassigned || []).forEach(c => {
      S.camRec.set(c.id, null);
      S.camInfo.set(c.id, c);
    });
    S.groupMembers = new Map(S.groups.map(g => [g.id, new Set(g.members)]));
  }

  async function refreshRoles() {
    const roles = await api(`${API}/roles`);
    S.roles = roles.roles || [];
    renderRolesList();
    updateBadges();
  }

  async function refreshTree() {
    const tree = await api(`${API}/camera-tree`);
    applyTree(tree);
    renderGroups();
    updateBadges();
  }

  function updateBadges() {
    const br = $('ar-badge-roles');
    const bg = $('ar-badge-groups');
    if (br) br.textContent = S.roles.length;
    if (bg) bg.textContent = S.groups.length;
  }

  /* ==========================================================================
     NAVIGACIJA
     ========================================================================== */
  async function guardDirty() {
    const E = S.editor;
    if (!E.role || (!E.permsDirty && !E.camDirty)) return true;
    return await new Promise((resolve) => {
      askConfirm({
        title: 'Nesačuvane izmene',
        text: 'Imate nesačuvane izmene u roli. Da li želite da ih odbacite?',
        okLabel: 'Odbaci izmene',
        okIcon: 'x'
      });
      S.confirmCb = () => resolve(true);
      const modal = $('modal-ar-confirm');
      const obs = new MutationObserver(() => {
        if (modal.style.display === 'none') { obs.disconnect(); setTimeout(() => resolve(false), 0); }
      });
      obs.observe(modal, { attributes: true, attributeFilter: ['style'] });
    });
  }

  async function switchMain(tab) {
    if (tab !== 'roles' && !(await guardDirty())) return;
    S.mainTab = tab;
    document.querySelectorAll('#ar-main-pills [data-ar-tab]').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-ar-tab') === tab);
    });
    ['roles', 'groups', 'check', 'audit'].forEach(t => {
      const p = $(`ar-panel-${t}`);
      if (p) p.classList.toggle('active', t === tab);
    });
    if (tab === 'audit') loadAudit(true);
    if (tab === 'check') fillKnownDatalist();
    if (tab === 'groups') renderGroups();
    icons();
  }

  function switchEdit(tab) {
    S.editor.editTab = tab;
    document.querySelectorAll('#ar-editor-pills [data-ar-edit]').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-ar-edit') === tab);
    });
    ['perms', 'cameras', 'assign', 'basic'].forEach(t => {
      const p = $(`ar-edit-${t}`);
      if (p) p.classList.toggle('active', t === tab);
    });
    icons();
  }

  /* ==========================================================================
     LISTA ROLA
     ========================================================================== */
  function renderRolesList() {
    const tbody = $('ar-tbody-roles');
    const countEl = $('ar-count-roles');
    if (!tbody) return;
    const q = S.rolesSearch.trim().toLowerCase();
    const items = S.roles.filter(r => !q || r.name.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q));
    if (countEl) countEl.textContent = `Prikazano: ${items.length} od ${S.roles.length} rola`;

    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="ar-tree-empty">Nema rola za dati pojam.</div></td></tr>`;
      return;
    }

    tbody.innerHTML = items.map(r => {
      const perms = r.isSuperAdmin
        ? '<span class="ar-num-badge is-all">sve</span>'
        : `<span class="ar-num-badge ${r.permissionCount ? 'is-on' : ''}">${r.permissionCount}</span>`;
      const cams = r.isSuperAdmin
        ? '<span class="ar-num-badge is-all">sve</span>'
        : `<span class="ar-num-badge ${r.cameraRuleCount ? 'is-on' : ''}">${r.cameraRuleCount ? r.cameraRuleCount + ' pravila' : '0'}</span>`;
      const tag = r.isSuperAdmin ? '<span class="ar-tag">Super admin</span>' : (r.isSystem ? '<span class="ar-tag">Sistemska</span>' : '');
      return `
        <tr>
          <td>
            <div class="ar-role-name" data-open-role="${esc(r.id)}">
              <i data-lucide="${r.isSuperAdmin ? 'shield-check' : 'shield'}"></i>
              <span>${esc(r.name)}</span> ${tag}
            </div>
          </td>
          <td style="color:#cbd5e1; font-size:0.82rem;">${esc(r.description || '—')}</td>
          <td style="text-align:center;">${perms}</td>
          <td style="text-align:center;">${cams}</td>
          <td style="text-align:center;"><span class="ar-num-badge ${r.assignmentCount ? 'is-on' : ''}">${r.assignmentCount}</span></td>
          <td style="text-align:center;">
            <div class="inv-actions-cell" style="justify-content:center;">
              <button class="btn-inv-action btn-edit" data-open-role="${esc(r.id)}" title="Uredi rolu"><i data-lucide="pencil"></i></button>
              <button class="btn-inv-action" data-copy-role="${esc(r.id)}" title="Napravi kopiju role"><i data-lucide="copy"></i></button>
              ${r.isSystem ? '' : `<button class="btn-inv-action btn-danger btn-delete" data-delete-role="${esc(r.id)}" title="Obriši rolu"><i data-lucide="trash-2"></i></button>`}
            </div>
          </td>
        </tr>`;
    }).join('');
    icons();
  }

  function openNewRoleModal(copyFromId) {
    const sel = $('ar-role-copy');
    sel.innerHTML = '<option value="">— Prazna rola (bez dozvola) —</option>' +
      S.roles.filter(r => !r.isSuperAdmin).map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
    sel.value = copyFromId && S.roles.some(r => r.id === copyFromId && !r.isSuperAdmin) ? copyFromId : '';
    const src = S.roles.find(r => r.id === copyFromId);
    $('ar-role-name').value = src ? `${src.name} (kopija)` : '';
    $('ar-role-desc').value = src ? (src.description || '') : '';
    openModalEl('modal-ar-role');
    setTimeout(() => $('ar-role-name').focus(), 60);
  }

  async function submitNewRole(e) {
    e.preventDefault();
    const name = $('ar-role-name').value.trim();
    if (!name) return;
    try {
      const copyFrom = $('ar-role-copy').value || undefined;
      const res = await api(`${API}/roles`, 'POST', { name, description: $('ar-role-desc').value.trim(), copyFrom });
      closeModalEl('modal-ar-role');
      notify(`Rola „${res.role.name}“ je napravljena.`, 'success');
      await refreshRoles();
      await openEditor(res.role.id);
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  async function deleteRole(id) {
    const role = S.roles.find(r => r.id === id);
    if (!role) return;
    const ok = await askConfirm({
      title: 'Brisanje role',
      text: `Rola „${role.name}“ i sve njene dodele i pristupi kamerama biće obrisani.`,
      okLabel: 'Obriši rolu'
    });
    if (!ok) return;
    try {
      await api(`${API}/roles/${encodeURIComponent(id)}`, 'DELETE');
      notify('Rola je obrisana.', 'success');
      if (S.editor.role && S.editor.role.id === id) closeEditor(true);
      await refreshRoles();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  /* ==========================================================================
     EDITOR ROLE
     ========================================================================== */
  async function openEditor(id) {
    try {
      const d = await api(`${API}/roles/${encodeURIComponent(id)}`);
      const E = S.editor;
      E.role = d.role;
      E.assignments = d.assignments || [];
      E.perms = new Map((d.permissions || []).map(p => [p.key, { level: p.level, actions: new Set(p.actions || []) }]));
      E.cam = buildCamState(d.cameraAccess || []);
      E.permsDirty = false;
      E.camDirty = false;
      E.camSearch = '';
      E.openRecorders = new Set();
      $('ar-search-cam-tree').value = '';

      $('ar-roles-list-view').style.display = 'none';
      $('ar-role-editor').style.display = 'block';
      renderEditorHeader();
      renderPerms();
      renderCamTree();
      renderAssignments();
      renderBasic();
      switchEdit(E.role.isSuperAdmin ? 'assign' : 'perms');
      icons();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  async function closeEditor(force) {
    if (!force && !(await guardDirty())) return;
    S.editor.role = null;
    S.editor.permsDirty = false;
    S.editor.camDirty = false;
    $('ar-role-editor').style.display = 'none';
    $('ar-roles-list-view').style.display = 'block';
    await refreshRoles();
  }

  function renderEditorHeader() {
    const E = S.editor;
    $('ar-editor-name').textContent = E.role.name;
    $('ar-editor-sub').textContent = E.role.description || (E.role.isSuperAdmin ? 'Pun pristup svemu, upravljanje rolama' : 'Bez opisa');
    $('ar-badge-assign').textContent = E.assignments.length;
  }

  function markDirty(kind) {
    const E = S.editor;
    if (kind === 'perms') {
      E.permsDirty = true;
      $('ar-perm-dirty').style.display = 'inline';
    } else {
      E.camDirty = true;
      $('ar-cam-dirty').style.display = 'inline';
    }
  }

  /* ---------------------------- DOZVOLE ---------------------------- */
  function renderPerms() {
    const host = $('ar-perm-matrix');
    const E = S.editor;
    if (!host || !E.role) return;
    const saveBar = $('ar-perm-savebar');

    if (E.role.isSuperAdmin) {
      host.innerHTML = '<div class="ar-tree-empty">Super admin ima sve dozvole na svim sekcijama i stranicama — dozvole se ne podešavaju.</div>';
      saveBar.style.display = 'none';
      return;
    }
    saveBar.style.display = 'flex';
    $('ar-perm-dirty').style.display = E.permsDirty ? 'inline' : 'none';

    host.innerHTML = S.catalog.map(sec => {
      const secOwn = E.perms.get(sec.key);
      const secLvl = secOwn ? secOwn.level : 'none';

      const itemsHtml = sec.items.map(item => {
        const own = E.perms.get(item.key);
        const ownLvl = own ? own.level : 'none';
        const eff = maxLvl(ownLvl, secLvl);
        const inh = rank(secLvl) > rank(ownLvl) ? secLvl : null;

        const actionsHtml = item.actions.map(a => {
          const full = `${item.key}:${a.key}`;
          const on = !!own && own.actions.has(full);
          const disabled = eff === 'none';
          return `<button type="button" class="ar-chip ${on ? 'on' : ''} ${disabled ? 'disabled' : ''}" data-action-key="${esc(full)}" data-item-key="${esc(item.key)}" title="Posebna akcija: ${esc(a.label)}">${on ? '<i data-lucide="check"></i>' : ''}${esc(a.label)}</button>`;
        }).join('');

        return `
          <div class="ar-item">
            <div class="ar-item-label">
              <span>${esc(item.label)}</span>
              ${inh ? `<span class="ar-inh" title="Nivo nasleđen sa sekcije ${esc(sec.label)}">nasleđeno: ${LEVEL_LABEL[inh]}</span>` : ''}
            </div>
            ${segHtml(item.key, ownLvl)}
            <div class="ar-actions">${actionsHtml}</div>
          </div>`;
      }).join('');

      return `
        <div class="ar-sec">
          <div class="ar-sec-head">
            <div class="ar-sec-title">
              <i data-lucide="${esc(sec.icon || 'folder')}"></i>
              <span>${esc(sec.label)}</span>
              <span class="ar-sec-note">— nivo za celu sekciju</span>
            </div>
            ${segHtml(sec.key, secLvl)}
          </div>
          ${itemsHtml}
        </div>`;
    }).join('');
    icons();
  }

  function segHtml(key, current) {
    return `<div class="ar-seg" data-perm-key="${esc(key)}">
      ${['none', 'view', 'edit'].map(l => `<button type="button" class="ar-seg-btn lvl-${l} ${current === l ? 'active' : ''}" data-level="${l}">${LEVEL_LABEL[l]}</button>`).join('')}
    </div>`;
  }

  function setPermLevel(key, level) {
    const E = S.editor;
    if (level === 'none') {
      E.perms.delete(key);
    } else {
      const cur = E.perms.get(key) || { level, actions: new Set() };
      cur.level = level;
      E.perms.set(key, cur);
    }
    markDirty('perms');
    renderPerms();
  }

  function toggleAction(itemKey, fullKey) {
    const E = S.editor;
    let cur = E.perms.get(itemKey);
    if (!cur) {
      cur = { level: 'view', actions: new Set() };
      E.perms.set(itemKey, cur);
    }
    if (cur.actions.has(fullKey)) cur.actions.delete(fullKey);
    else cur.actions.add(fullKey);

    // Ako je preostao samo "slučajni" nivo Pregled bez akcija a sekcija ga već pokriva - ukloni
    const sectionKey = itemKey.split('.')[0];
    const secLvl = (E.perms.get(sectionKey) || {}).level || 'none';
    if (cur.actions.size === 0 && cur.level === 'view' && rank(secLvl) >= 1) E.perms.delete(itemKey);

    markDirty('perms');
    renderPerms();
  }

  async function savePerms() {
    const E = S.editor;
    const permissions = [...E.perms.entries()].map(([key, v]) => ({ key, level: v.level, actions: [...v.actions] }));
    try {
      await api(`${API}/roles/${encodeURIComponent(E.role.id)}/permissions`, 'PUT', { permissions });
      E.permsDirty = false;
      $('ar-perm-dirty').style.display = 'none';
      notify('Dozvole su sačuvane.', 'success');
      refreshRoles();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  /* ---------------------------- KAMERE (stablo) ---------------------------- */
  function buildCamState(rules) {
    const st = { all: { live: false, playback: false }, recorder: new Map(), group: new Map(), camera: new Map() };
    for (const r of rules) {
      const v = { live: !!r.canLive, playback: !!r.canPlayback };
      if (r.scope === 'all') st.all = v;
      else if (st[r.scope]) st[r.scope].set(r.targetId, v);
    }
    return st;
  }

  function camStateToRules(st) {
    const rules = [];
    if (st.all.live || st.all.playback) rules.push({ scope: 'all', targetId: '', canLive: st.all.live, canPlayback: st.all.playback });
    for (const scope of ['recorder', 'group', 'camera']) {
      for (const [id, v] of st[scope]) {
        if (v.live || v.playback) rules.push({ scope, targetId: id, canLive: v.live, canPlayback: v.playback });
      }
    }
    return rules;
  }

  function getFlag(scope, id) {
    const st = S.editor.cam;
    if (scope === 'all') return st.all;
    return st[scope].get(id) || { live: false, playback: false };
  }

  function setFlag(scope, id, kind, val) {
    const st = S.editor.cam;
    const cur = Object.assign({}, getFlag(scope, id));
    cur[kind] = val;
    if (scope === 'all') st.all = cur;
    else if (!cur.live && !cur.playback) st[scope].delete(id);
    else st[scope].set(id, cur);
  }

  /** Da li je kamera pokrivena "višim" pravilom (sve / snimač / grupa) za dati tip prava */
  function cameraCovered(camId, kind) {
    const st = S.editor.cam;
    if (st.all[kind]) return true;
    const rec = S.camRec.get(camId);
    if (rec && st.recorder.get(rec) && st.recorder.get(rec)[kind]) return true;
    for (const [gid, v] of st.group) {
      if (v[kind] && S.groupMembers.get(gid) && S.groupMembers.get(gid).has(camId)) return true;
    }
    return false;
  }

  function cameraEffective(camId, kind) {
    const st = S.editor.cam;
    if (cameraCovered(camId, kind)) return true;
    const own = st.camera.get(camId);
    return !!(own && own[kind]);
  }

  function togHtml(scope, id, kind, inheritedOn) {
    const own = getFlag(scope, id)[kind];
    const cls = own ? 'on' : (inheritedOn ? 'inh' : '');
    const label = kind === 'live' ? 'Uživo' : 'Snimci';
    const icon = kind === 'live' ? 'radio' : 'history';
    const title = inheritedOn && !own ? 'Pokriveno nadređenim pravilom (sve / snimač / grupa)' : (kind === 'live' ? 'Gledanje uživo' : 'Pregled snimaka i preuzimanje klipa');
    return `<button type="button" class="ar-tog ${cls}" data-scope="${scope}" data-id="${esc(id)}" data-kind="${kind}" title="${esc(title)}"><i data-lucide="${icon}"></i>${label}</button>`;
  }

  function camMatches(c, q) {
    return !q || (c.name || '').toLowerCase().includes(q) || (c.position || '').toLowerCase().includes(q) || (c.ip || '').includes(q);
  }

  function renderCamTree() {
    const host = $('ar-cam-tree');
    const E = S.editor;
    if (!host || !E.role) return;
    const saveBtn = $('ar-btn-save-cams');

    if (E.role.isSuperAdmin) {
      host.innerHTML = '<div class="ar-tree-empty">Super admin vidi sve kamere (uživo i snimke) — pristup se ne podešava.</div>';
      saveBtn.closest('.ar-savebar').style.display = 'none';
      $('ar-cam-summary').textContent = '';
      return;
    }
    saveBtn.closest('.ar-savebar').style.display = 'flex';
    $('ar-cam-dirty').style.display = E.camDirty ? 'inline' : 'none';

    const q = (E.camSearch || '').trim().toLowerCase();
    const st = E.cam;
    const total = S.tree.totalCameras || 0;
    let html = '';

    // Sve kamere
    html += `<div class="ar-row is-head">
      <div class="ar-row-main"><i data-lucide="globe"></i><span>Sve kamere</span><span class="ar-row-sub">(${total})</span></div>
      <div class="ar-togs">${togHtml('all', '', 'live', false)}${togHtml('all', '', 'playback', false)}</div>
    </div>`;

    // Snimači
    const recorders = S.tree.recorders || [];
    html += `<div class="ar-tree-title">Grupe po snimaču (automatske)</div>`;
    let shownRec = 0;
    for (const r of recorders) {
      const recMatch = !q || (r.name || '').toLowerCase().includes(q) || (r.location || '').toLowerCase().includes(q);
      const cams = r.cameras.filter(c => recMatch || camMatches(c, q));
      if (!recMatch && cams.length === 0) continue;
      shownRec++;
      const open = q ? true : E.openRecorders.has(r.id);
      const recCovered = st.all;
      html += `<div class="ar-row is-head">
        <div class="ar-row-main">
          <button type="button" class="ar-expander ${open ? 'open' : ''}" data-rec-toggle="${esc(r.id)}" title="Prikaži kamere"><i data-lucide="chevron-right"></i></button>
          <i data-lucide="hard-drive"></i>
          <span>${esc(r.name)}</span>
          <span class="ar-row-sub">${esc(r.location || '')} · ${r.cameras.length} kamera</span>
        </div>
        <div class="ar-togs">${togHtml('recorder', r.id, 'live', recCovered.live)}${togHtml('recorder', r.id, 'playback', recCovered.playback)}</div>
      </div>`;
      if (open) {
        html += cams.map(c => camRowHtml(c)).join('');
      }
    }
    if (recorders.length && shownRec === 0) html += `<div class="ar-tree-empty">Nijedan snimač ni kamera ne odgovara pretrazi.</div>`;

    // Ručne grupe
    const groups = S.groups.filter(g => !q || g.name.toLowerCase().includes(q));
    if (groups.length) {
      html += `<div class="ar-tree-title">Ručne grupe kamera</div>`;
      for (const g of groups) {
        html += `<div class="ar-row is-head">
          <div class="ar-row-main"><i data-lucide="layers"></i><span>${esc(g.name)}</span><span class="ar-row-sub">${g.members.length} kamera${g.description ? ' · ' + esc(g.description) : ''}</span></div>
          <div class="ar-togs">${togHtml('group', g.id, 'live', st.all.live)}${togHtml('group', g.id, 'playback', st.all.playback)}</div>
        </div>`;
      }
    }

    // Kamere bez snimača
    const unassigned = (S.tree.unassigned || []).filter(c => camMatches(c, q));
    if (unassigned.length) {
      html += `<div class="ar-tree-title">Kamere bez snimača</div>`;
      html += unassigned.map(c => camRowHtml(c)).join('');
    }

    host.innerHTML = html;
    icons();
    renderCamSummary();
  }

  function camRowHtml(c) {
    const liveCov = cameraCovered(c.id, 'live');
    const pbCov = cameraCovered(c.id, 'playback');
    return `<div class="ar-row ar-cam-row">
      <div class="ar-row-main"><i data-lucide="camera"></i><span>${esc(c.name)}</span><span class="ar-row-sub">${esc(c.position || '')} · ${esc(c.ip)}</span></div>
      <div class="ar-togs">${togHtml('camera', c.id, 'live', liveCov)}${togHtml('camera', c.id, 'playback', pbCov)}</div>
    </div>`;
  }

  function renderCamSummary() {
    let live = 0;
    let pb = 0;
    S.camInfo.forEach((_c, id) => {
      if (cameraEffective(id, 'live')) live++;
      if (cameraEffective(id, 'playback')) pb++;
    });
    const total = S.camInfo.size;
    $('ar-cam-summary').innerHTML = `Uživo: <b>${live}</b> / ${total} · Snimci: <b>${pb}</b> / ${total}`;
  }

  function onCamToggle(btn) {
    const scope = btn.getAttribute('data-scope');
    const id = btn.getAttribute('data-id');
    const kind = btn.getAttribute('data-kind');
    const own = getFlag(scope, id)[kind];
    if (btn.classList.contains('inh') && !own) return; // pokriveno nadređenim pravilom
    setFlag(scope, id, kind, !own);
    markDirty('cam');
    renderCamTree();
  }

  async function saveCams() {
    const E = S.editor;
    try {
      await api(`${API}/roles/${encodeURIComponent(E.role.id)}/cameras`, 'PUT', { rules: camStateToRules(E.cam) });
      E.camDirty = false;
      $('ar-cam-dirty').style.display = 'none';
      notify('Pristup kamerama je sačuvan.', 'success');
      refreshRoles();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  /* ---------------------------- DODELE ---------------------------- */
  function renderAssignments() {
    const E = S.editor;
    const tbody = $('ar-tbody-assign');
    if (!tbody || !E.role) return;
    $('ar-badge-assign').textContent = E.assignments.length;

    if (E.assignments.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="ar-tree-empty">Rola još nije dodeljena nikome. Dodajte korisnika ili AD grupu.${E.role.isSuperAdmin ? '<br><span class="text-dim">Napomena: članovi grupe ITadmin su Super admin po ugrađenom pravilu.</span>' : ''}</div></td></tr>`;
      return;
    }

    tbody.innerHTML = E.assignments.map(a => {
      const isUser = a.principalType === 'user';
      return `
        <tr>
          <td><span class="ar-pill ${isUser ? '' : 'is-role'}"><i data-lucide="${isUser ? 'user' : 'users-round'}" style="width:12px;height:12px;"></i> ${isUser ? 'Korisnik' : 'AD grupa'}</span></td>
          <td style="font-weight:600; color:#fff;">${esc(a.displayName || a.principalId)}</td>
          <td style="color:#94a3b8; font-size:0.78rem; max-width:360px;" class="truncate" title="${esc(isUser ? (a.email || a.principalId) : a.principalId)}">${esc(isUser ? (a.email || a.principalId) : a.principalId)}</td>
          <td style="font-size:0.76rem; color:#94a3b8;">${esc(fmtTime(a.createdAt))}<br>${esc(a.createdBy || '')}</td>
          <td style="text-align:center;">
            <div class="inv-actions-cell" style="justify-content:center;">
              <button class="btn-inv-action btn-danger btn-delete" data-remove-assign="${a.id}" title="Oduzmi rolu"><i data-lucide="user-minus"></i></button>
            </div>
          </td>
        </tr>`;
    }).join('');
    icons();
  }

  async function removeAssignment(aid) {
    const E = S.editor;
    const a = E.assignments.find(x => x.id === aid);
    if (!a) return;
    const ok = await askConfirm({
      title: 'Oduzimanje role',
      text: `Rola „${E.role.name}“ biće oduzeta: ${a.displayName || a.principalId}.`,
      okLabel: 'Oduzmi rolu',
      okIcon: 'user-minus'
    });
    if (!ok) return;
    try {
      await api(`${API}/roles/${encodeURIComponent(E.role.id)}/assignments/${aid}`, 'DELETE');
      E.assignments = E.assignments.filter(x => x.id !== aid);
      renderAssignments();
      renderEditorHeader();
      notify('Dodela je uklonjena.', 'success');
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  function openAssignPicker(mode) {
    S.assignMode = mode;
    const isUser = mode === 'user';
    $('ar-assign-title').textContent = isUser ? 'Dodaj korisnika' : 'Dodaj AD grupu';
    $('ar-assign-sub').textContent = isUser
      ? 'Pretražite Active Directory ili izaberite među prijavljenima'
      : 'Svi članovi izabrane AD grupe dobijaju ovu rolu';
    $('ar-assign-known-title').textContent = isUser ? 'Prijavljeni korisnici' : 'Grupe viđene pri prijavama';
    $('ar-assign-manual-wrap').style.display = isUser ? 'flex' : 'none';
    $('ar-assign-q').value = '';
    $('ar-assign-manual').value = '';
    $('ar-assign-ad-list').innerHTML = '<div class="ar-pick-empty">Unesite najmanje 2 slova za pretragu.</div>';
    $('ar-assign-ad-status').textContent = '';
    renderKnownPicker();
    openModalEl('modal-ar-assign');
    setTimeout(() => $('ar-assign-q').focus(), 60);
  }

  function isAssigned(type, id, name) {
    return S.editor.assignments.some(a =>
      a.principalType === type && (a.principalId.toLowerCase() === String(id).toLowerCase() ||
        (type === 'ad_group' && a.displayName && a.displayName.toLowerCase() === String(name || '').toLowerCase())));
  }

  function pickItemHtml(p) {
    const assigned = isAssigned(p.type, p.id, p.name);
    return `<button type="button" class="ar-pick-item" ${assigned ? 'disabled' : ''}
        data-pick-type="${p.type}" data-pick-id="${esc(p.id)}" data-pick-name="${esc(p.name)}" data-pick-email="${esc(p.email || '')}">
      <div><span class="ar-pick-name">${esc(p.name)}</span><span class="ar-pick-meta">${esc(p.email || p.description || p.id)}</span></div>
      ${assigned ? '<span class="ar-pill">već dodato</span>' : '<i data-lucide="plus-circle" style="width:16px;height:16px;color:var(--yellow-primary);"></i>'}
    </button>`;
  }

  function renderKnownPicker() {
    const q = $('ar-assign-q').value.trim().toLowerCase();
    const isUser = S.assignMode === 'user';
    const list = isUser
      ? S.known.users.map(u => ({ type: 'user', id: (u.email || u.id).toLowerCase(), name: u.name || u.email, email: u.email, description: '' }))
      : S.known.groups.map(g => ({ type: 'ad_group', id: g.id || g.name, name: g.name, email: '', description: g.id && g.id !== g.name ? g.id : '' }));
    const filtered = list.filter(p => !q || p.name.toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q));
    $('ar-assign-known-list').innerHTML = filtered.length
      ? filtered.map(pickItemHtml).join('')
      : '<div class="ar-pick-empty">Nema podataka. Korisnici i grupe se pojavljuju nakon prve prijave.</div>';
    icons();
  }

  async function searchAd() {
    const q = $('ar-assign-q').value.trim();
    const list = $('ar-assign-ad-list');
    const status = $('ar-assign-ad-status');
    if (q.length < 2) {
      list.innerHTML = '<div class="ar-pick-empty">Unesite najmanje 2 slova za pretragu.</div>';
      status.textContent = '';
      return;
    }
    status.textContent = '· pretraga...';
    try {
      const type = S.assignMode === 'user' ? 'user' : 'group';
      const res = await api(`${API}/ad/search?type=${type}&q=${encodeURIComponent(q)}`);
      if ($('ar-assign-q').value.trim() !== q) return; // zastarela pretraga
      if (res.success === false) {
        list.innerHTML = `<div class="ar-pick-empty">${esc(res.error || 'Pretraga nije uspela.')}</div>`;
        status.textContent = '';
        return;
      }
      status.textContent = `· ${res.results.length} rezultata`;
      list.innerHTML = res.results.length
        ? res.results.map(pickItemHtml).join('')
        : '<div class="ar-pick-empty">Nema rezultata u Active Directory-ju.</div>';
      icons();
    } catch (err) {
      list.innerHTML = `<div class="ar-pick-empty">${esc(err.message)}</div>`;
      status.textContent = '';
    }
  }

  async function addAssignment(type, id, name, email) {
    const E = S.editor;
    try {
      const res = await api(`${API}/roles/${encodeURIComponent(E.role.id)}/assignments`, 'POST', {
        principalType: type, principalId: id, displayName: name, email
      });
      E.assignments.push(res.assignment);
      renderAssignments();
      renderEditorHeader();
      renderKnownPicker();
      // osveži i rezultate AD pretrage (označi "već dodato")
      $('ar-assign-ad-list').querySelectorAll('.ar-pick-item').forEach(btn => {
        if (btn.getAttribute('data-pick-id') === id) btn.setAttribute('disabled', '');
      });
      notify(`Dodato: ${name || id}`, 'success');
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  /* ---------------------------- OSNOVNO ---------------------------- */
  function renderBasic() {
    const E = S.editor;
    if (!E.role) return;
    $('ar-basic-name').value = E.role.name;
    $('ar-basic-name').disabled = E.role.isSystem;
    $('ar-basic-desc').value = E.role.description || '';
    $('ar-btn-delete-role').style.display = E.role.isSystem ? 'none' : '';
    $('ar-btn-duplicate').style.display = E.role.isSuperAdmin ? 'none' : '';
  }

  async function saveBasic() {
    const E = S.editor;
    try {
      const res = await api(`${API}/roles/${encodeURIComponent(E.role.id)}`, 'PUT', {
        name: $('ar-basic-name').value, description: $('ar-basic-desc').value
      });
      E.role = res.role;
      renderEditorHeader();
      notify('Osnovni podaci su sačuvani.', 'success');
      refreshRoles();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  /* ==========================================================================
     GRUPE KAMERA
     ========================================================================== */
  function renderGroups() {
    const tbody = $('ar-tbody-groups');
    if (!tbody) return;
    if (S.groups.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4"><div class="ar-tree-empty">Nema ručnih grupa. Napravite grupu, npr. „Sve blagajne“.</div></td></tr>`;
    } else {
      tbody.innerHTML = S.groups.map(g => `
        <tr>
          <td style="font-weight:600; color:#fff;"><i data-lucide="layers" style="width:14px;height:14px;color:var(--yellow-primary);vertical-align:-2px;"></i> ${esc(g.name)}</td>
          <td style="color:#cbd5e1; font-size:0.82rem;">${esc(g.description || '—')}</td>
          <td style="text-align:center;"><span class="ar-num-badge ${g.members.length ? 'is-on' : ''}">${g.members.length}</span></td>
          <td style="text-align:center;">
            <div class="inv-actions-cell" style="justify-content:center;">
              <button class="btn-inv-action btn-edit" data-edit-group="${esc(g.id)}" title="Izmeni grupu"><i data-lucide="pencil"></i></button>
              <button class="btn-inv-action btn-danger btn-delete" data-delete-group="${esc(g.id)}" title="Obriši grupu"><i data-lucide="trash-2"></i></button>
            </div>
          </td>
        </tr>`).join('');
    }

    const auto = $('ar-auto-groups');
    const recs = S.tree.recorders || [];
    auto.innerHTML = `<div class="ar-auto-groups-title">Automatske grupe po snimaču (${recs.length})</div>
      <div class="ar-auto-chips">${recs.map(r => `<span class="ar-auto-chip"><i data-lucide="hard-drive" style="width:12px;height:12px;"></i>${esc(r.name)} <span>${r.cameras.length}</span></span>`).join('')}</div>`;
    icons();
  }

  function openGroupModal(id) {
    const G = S.groupModal;
    const g = id ? S.groups.find(x => x.id === id) : null;
    G.id = id || null;
    G.members = new Set(g ? g.members : []);
    G.search = '';
    G.openRecorders = new Set();
    $('ar-group-id').value = id || '';
    $('ar-group-title').textContent = g ? `Izmena grupe: ${g.name}` : 'Nova grupa kamera';
    $('ar-group-name').value = g ? g.name : '';
    $('ar-group-desc').value = g ? (g.description || '') : '';
    $('ar-group-search').value = '';
    renderGroupTree();
    openModalEl('modal-ar-group');
    setTimeout(() => $('ar-group-name').focus(), 60);
  }

  function renderGroupTree() {
    const G = S.groupModal;
    const q = (G.search || '').trim().toLowerCase();
    let html = '';

    const camRow = (c) => `<label class="ar-row ar-cam-row" style="cursor:pointer;">
      <div class="ar-row-main"><input type="checkbox" class="ar-check" data-gcam="${esc(c.id)}" ${G.members.has(c.id) ? 'checked' : ''}><span>${esc(c.name)}</span><span class="ar-row-sub">${esc(c.position || '')} · ${esc(c.ip)}</span></div>
    </label>`;

    for (const r of (S.tree.recorders || [])) {
      const recMatch = !q || (r.name || '').toLowerCase().includes(q);
      const cams = r.cameras.filter(c => recMatch || camMatches(c, q));
      if (!recMatch && cams.length === 0) continue;
      const open = q ? true : G.openRecorders.has(r.id);
      const selected = r.cameras.filter(c => G.members.has(c.id)).length;
      html += `<div class="ar-row is-head">
        <div class="ar-row-main">
          <button type="button" class="ar-expander ${open ? 'open' : ''}" data-grec-toggle="${esc(r.id)}"><i data-lucide="chevron-right"></i></button>
          <input type="checkbox" class="ar-check" data-grec-all="${esc(r.id)}" ${selected === r.cameras.length && r.cameras.length ? 'checked' : ''} title="Izaberi sve kamere snimača">
          <span>${esc(r.name)}</span>
          <span class="ar-row-sub">${esc(r.location || '')} · izabrano ${selected}/${r.cameras.length}</span>
        </div>
      </div>`;
      if (open) html += cams.map(camRow).join('');
    }

    const unassigned = (S.tree.unassigned || []).filter(c => camMatches(c, q));
    if (unassigned.length) {
      html += `<div class="ar-tree-title">Kamere bez snimača</div>` + unassigned.map(camRow).join('');
    }
    if (!html) html = '<div class="ar-tree-empty">Nema kamera za dati pojam.</div>';

    $('ar-group-tree').innerHTML = html;
    $('ar-group-count').innerHTML = `Izabrano: <b>${G.members.size}</b> kamera`;
    icons();
  }

  async function submitGroup(e) {
    e.preventDefault();
    const G = S.groupModal;
    const body = {
      name: $('ar-group-name').value.trim(),
      description: $('ar-group-desc').value.trim(),
      members: [...G.members]
    };
    if (!body.name) return;
    try {
      if (G.id) await api(`${API}/camera-groups/${encodeURIComponent(G.id)}`, 'PUT', body);
      else await api(`${API}/camera-groups`, 'POST', body);
      closeModalEl('modal-ar-group');
      notify('Grupa kamera je sačuvana.', 'success');
      await refreshTree();
      if (S.editor.role) renderCamTree();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  async function deleteGroup(id) {
    const g = S.groups.find(x => x.id === id);
    if (!g) return;
    const ok = await askConfirm({
      title: 'Brisanje grupe kamera',
      text: `Grupa „${g.name}“ biće obrisana i uklonjena iz svih rola koje je koriste. Same kamere ostaju.`,
      okLabel: 'Obriši grupu'
    });
    if (!ok) return;
    try {
      await api(`${API}/camera-groups/${encodeURIComponent(id)}`, 'DELETE');
      notify('Grupa je obrisana.', 'success');
      await refreshTree();
      await refreshRoles();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  /* ==========================================================================
     PROVERI KORISNIKA
     ========================================================================== */
  function fillKnownDatalist() {
    const dl = $('ar-check-known');
    if (!dl) return;
    dl.innerHTML = S.known.users.map(u => `<option value="${esc(u.email || u.name)}">${esc(u.name)}</option>`).join('');
  }

  function levelBadge(l) {
    return `<span class="ar-lvl lvl-${l}">${LEVEL_LABEL[l]}</span>`;
  }

  async function runCheck() {
    const input = $('ar-check-input').value.trim();
    const host = $('ar-check-result');
    if (!input) { notify('Unesite mejl ili ime korisnika.', 'info'); return; }
    host.innerHTML = '<div class="ar-tree-empty">Provera prava...</div>';
    try {
      const d = await api(`${API}/check-user?user=${encodeURIComponent(input)}`);
      const initials = (d.user.name || '?').split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();

      const rolesHtml = d.roles.length
        ? d.roles.map(r => `<span class="ar-pill is-role"><i data-lucide="shield" style="width:12px;height:12px;"></i>${esc(r.name)} <span style="color:#94a3b8;">· ${r.via === 'user' ? 'lično' : r.via === 'builtin' ? 'ugrađeno pravilo' : 'preko grupe ' + esc(r.viaName)}</span></span>`).join('')
        : '<span class="text-dim">Korisnik nema nijednu rolu — nema pristup platformi.</span>';

      const groupsHtml = d.groups.length
        ? d.groups.map(g => `<span class="ar-pill">${esc(g)}</span>`).join('')
        : '<span class="text-dim">Nema poznatih grupa.</span>';

      // Stranice po sekcijama
      const bySection = new Map();
      d.pages.forEach(p => {
        if (!bySection.has(p.sectionLabel)) bySection.set(p.sectionLabel, []);
        bySection.get(p.sectionLabel).push(p);
      });
      let pagesRows = '';
      bySection.forEach((pages, label) => {
        pagesRows += `<tr><td colspan="4" style="background:rgba(255,184,0,0.06); font-weight:700; letter-spacing:0.06em; color:var(--yellow-primary); font-size:0.72rem;">${esc(label)}</td></tr>`;
        pagesRows += pages.map(p => `<tr>
          <td style="font-weight:600; color:#fff;">${esc(p.label)}</td>
          <td style="width:110px;">${levelBadge(p.level)}</td>
          <td style="font-size:0.76rem;">${p.actions.map(a => `<span class="ar-pill" style="margin-right:4px;">${esc(a.split(':')[1])}</span>`).join('') || '<span class="text-dim">—</span>'}</td>
          <td style="font-size:0.76rem; color:#94a3b8;">${esc(p.sources.join(', ') || '—')}</td>
        </tr>`).join('');
      });

      // Kamere
      const live = d.cameras.filter(c => c.live).length;
      const pb = d.cameras.filter(c => c.playback).length;
      const camRows = d.cameras.map(c => `<tr>
        <td style="font-weight:600; color:#fff;">${esc(c.name)}</td>
        <td style="font-size:0.76rem; color:#94a3b8;">${esc(c.recorder)} · ${esc(c.position)}</td>
        <td style="font-family:var(--font-mono); font-size:0.74rem;">${esc(c.ip)}</td>
        <td><span class="ar-rights"><span class="ar-right-badge ${c.live ? 'on' : 'off'}">Uživo</span><span class="ar-right-badge ${c.playback ? 'on' : 'off'}">Snimci</span></span></td>
        <td style="font-size:0.74rem; color:#94a3b8;">${esc(c.sources.join(', '))}</td>
      </tr>`).join('');

      host.innerHTML = `
        <div class="ar-card">
          <div class="ar-card-user">
            <div class="ar-avatar">${esc(initials)}</div>
            <div>
              <div class="ar-user-name">${esc(d.user.name)}</div>
              <div class="ar-user-meta">${esc(d.user.email || '—')} · poslednja prijava: ${esc(fmtTime(d.user.lastLoginAt))} · grupe: ${esc(d.groupsSource)}</div>
            </div>
          </div>
        </div>
        <div class="ar-card"><h6>Role</h6><div class="ar-chip-row">${rolesHtml}</div></div>
        <div class="ar-card"><h6>Članstvo u grupama (${d.groups.length})</h6><div class="ar-chip-row">${groupsHtml}</div></div>
        <div class="ar-card">
          <h6>Pristup stranicama</h6>
          <div class="inv-table-wrapper"><table class="inv-camera-table">
            <thead><tr><th>STRANICA</th><th style="width:110px;">NIVO</th><th>POSEBNE AKCIJE</th><th>IZVOR</th></tr></thead>
            <tbody>${pagesRows}</tbody>
          </table></div>
        </div>
        <div class="ar-card">
          <h6>Pristup kamerama — vidi ${d.cameras.length} od ${d.totalCameras} (uživo: ${live}, snimci: ${pb})</h6>
          ${d.cameras.length ? `<div class="inv-table-wrapper ar-scroll-box"><table class="inv-camera-table">
            <thead><tr><th>KAMERA</th><th>SNIMAČ / POZICIJA</th><th>IP</th><th>PRAVA</th><th>IZVOR</th></tr></thead>
            <tbody>${camRows}</tbody></table></div>` : '<span class="text-dim">Nema pristup nijednoj kameri.</span>'}
        </div>`;
      icons();
    } catch (err) {
      host.innerHTML = `<div class="ar-card"><span style="color:#f87171;">${esc(err.message)}</span></div>`;
    }
  }

  /* ==========================================================================
     EVIDENCIJA
     ========================================================================== */
  async function loadAudit(reset) {
    const A = S.audit;
    if (reset) { A.items = []; A.offset = 0; A.total = 0; }
    try {
      const params = new URLSearchParams({ limit: '100', offset: String(A.offset) });
      if (A.q) params.set('q', A.q);
      if (A.action) params.set('action', A.action);
      const d = await api(`${API}/audit?${params.toString()}`);
      A.items = A.items.concat(d.items || []);
      A.total = d.total || 0;
      A.offset = A.items.length;
      renderAudit();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  function eventClass(action) {
    if (action === 'access.denied' || action === 'auth.denied') return 'ev-denied';
    if (action.startsWith('camera.')) return 'ev-camera';
    if (action.startsWith('role.') || action.startsWith('cameragroup.')) return 'ev-role';
    if (action.startsWith('auth.')) return 'ev-auth';
    return '';
  }

  function renderAudit() {
    const A = S.audit;
    const tbody = $('ar-tbody-audit');
    if (!tbody) return;
    tbody.innerHTML = A.items.length
      ? A.items.map(a => `<tr>
          <td style="font-size:0.76rem; color:#94a3b8; white-space:nowrap;">${esc(fmtTime(a.ts))}</td>
          <td><div style="font-weight:600; color:#fff;">${esc(a.userName || '—')}</div><div style="font-size:0.72rem; color:#94a3b8;">${esc(a.userEmail || '')}</div></td>
          <td><span class="ar-event ${eventClass(a.action)}">${esc(EVENT_LABELS[a.action] || a.action)}</span></td>
          <td style="font-size:0.8rem; color:#cbd5e1;">${esc(a.details || '')}${a.objectId ? `<div style="font-size:0.7rem; color:#64748b; font-family:var(--font-mono);">${esc(a.objectType)} · ${esc(a.objectId)}</div>` : ''}</td>
        </tr>`).join('')
      : `<tr><td colspan="4"><div class="ar-tree-empty">Nema zapisa u evidenciji.</div></td></tr>`;
    $('ar-count-audit').textContent = `Prikazano: ${A.items.length} od ${A.total} zapisa`;
    $('ar-btn-audit-more').style.display = A.items.length < A.total ? '' : 'none';
    icons();
  }

  /* ==========================================================================
     EVENTI
     ========================================================================== */
  function bindEvents() {
    // Glavna navigacija
    $('ar-main-pills').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ar-tab]');
      if (b) switchMain(b.getAttribute('data-ar-tab'));
    });
    $('ar-editor-pills').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ar-edit]');
      if (b) switchEdit(b.getAttribute('data-ar-edit'));
    });

    $('ar-btn-refresh').addEventListener('click', async () => {
      if (!(await guardDirty())) return;
      await loadAll();
      if (S.editor.role) await openEditor(S.editor.role.id);
      if (S.mainTab === 'audit') loadAudit(true);
      notify('Podaci su osveženi.', 'success');
    });

    // Lista rola
    $('ar-search-roles').addEventListener('input', (e) => { S.rolesSearch = e.target.value; renderRolesList(); });
    $('ar-btn-new-role').addEventListener('click', () => openNewRoleModal(null));
    $('ar-tbody-roles').addEventListener('click', (e) => {
      const open = e.target.closest('[data-open-role]');
      if (open) return openEditor(open.getAttribute('data-open-role'));
      const copy = e.target.closest('[data-copy-role]');
      if (copy) return openNewRoleModal(copy.getAttribute('data-copy-role'));
      const del = e.target.closest('[data-delete-role]');
      if (del) return deleteRole(del.getAttribute('data-delete-role'));
    });
    $('form-ar-role').addEventListener('submit', submitNewRole);

    // Editor
    $('ar-btn-back').addEventListener('click', () => closeEditor(false));
    $('ar-perm-matrix').addEventListener('click', (e) => {
      const seg = e.target.closest('.ar-seg-btn');
      if (seg) return setPermLevel(seg.closest('.ar-seg').getAttribute('data-perm-key'), seg.getAttribute('data-level'));
      const chip = e.target.closest('.ar-chip');
      if (chip && !chip.classList.contains('disabled')) return toggleAction(chip.getAttribute('data-item-key'), chip.getAttribute('data-action-key'));
    });
    $('ar-btn-save-perms').addEventListener('click', savePerms);

    $('ar-search-cam-tree').addEventListener('input', (e) => {
      S.editor.camSearch = e.target.value;
      debounce('camtree', renderCamTree, 150);
    });
    $('ar-cam-tree').addEventListener('click', (e) => {
      const tog = e.target.closest('.ar-tog');
      if (tog) return onCamToggle(tog);
      const ex = e.target.closest('[data-rec-toggle]');
      if (ex) {
        const id = ex.getAttribute('data-rec-toggle');
        const set = S.editor.openRecorders;
        if (set.has(id)) set.delete(id); else set.add(id);
        renderCamTree();
      }
    });
    $('ar-btn-save-cams').addEventListener('click', saveCams);

    // Dodele
    $('ar-btn-add-user').addEventListener('click', () => openAssignPicker('user'));
    $('ar-btn-add-group').addEventListener('click', () => openAssignPicker('ad_group'));
    $('ar-tbody-assign').addEventListener('click', (e) => {
      const rm = e.target.closest('[data-remove-assign]');
      if (rm) removeAssignment(parseInt(rm.getAttribute('data-remove-assign'), 10));
    });
    $('ar-assign-q').addEventListener('input', () => {
      renderKnownPicker();
      debounce('adsearch', searchAd, 350);
    });
    const pickHandler = (e) => {
      const b = e.target.closest('.ar-pick-item');
      if (!b || b.hasAttribute('disabled')) return;
      addAssignment(b.getAttribute('data-pick-type'), b.getAttribute('data-pick-id'), b.getAttribute('data-pick-name'), b.getAttribute('data-pick-email'));
    };
    $('ar-assign-ad-list').addEventListener('click', pickHandler);
    $('ar-assign-known-list').addEventListener('click', pickHandler);
    $('ar-assign-manual-btn').addEventListener('click', () => {
      const v = $('ar-assign-manual').value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { notify('Unesite ispravan mejl (UPN).', 'error'); return; }
      addAssignment('user', v, v, v);
      $('ar-assign-manual').value = '';
    });

    // Osnovno
    $('ar-btn-save-basic').addEventListener('click', saveBasic);
    $('ar-btn-duplicate').addEventListener('click', () => openNewRoleModal(S.editor.role.id));
    $('ar-btn-delete-role').addEventListener('click', () => deleteRole(S.editor.role.id));

    // Grupe kamera
    $('ar-btn-new-group').addEventListener('click', () => openGroupModal(null));
    $('ar-tbody-groups').addEventListener('click', (e) => {
      const ed = e.target.closest('[data-edit-group]');
      if (ed) return openGroupModal(ed.getAttribute('data-edit-group'));
      const del = e.target.closest('[data-delete-group]');
      if (del) return deleteGroup(del.getAttribute('data-delete-group'));
    });
    $('form-ar-group').addEventListener('submit', submitGroup);
    $('ar-group-search').addEventListener('input', (e) => {
      S.groupModal.search = e.target.value;
      debounce('grouptree', renderGroupTree, 150);
    });
    $('ar-group-tree').addEventListener('click', (e) => {
      const ex = e.target.closest('[data-grec-toggle]');
      if (ex) {
        const id = ex.getAttribute('data-grec-toggle');
        const set = S.groupModal.openRecorders;
        if (set.has(id)) set.delete(id); else set.add(id);
        renderGroupTree();
      }
    });
    $('ar-group-tree').addEventListener('change', (e) => {
      const G = S.groupModal;
      const one = e.target.closest('[data-gcam]');
      if (one) {
        const id = one.getAttribute('data-gcam');
        if (one.checked) G.members.add(id); else G.members.delete(id);
        renderGroupTree();
        return;
      }
      const all = e.target.closest('[data-grec-all]');
      if (all) {
        const rec = (S.tree.recorders || []).find(r => r.id === all.getAttribute('data-grec-all'));
        if (rec) rec.cameras.forEach(c => { if (all.checked) G.members.add(c.id); else G.members.delete(c.id); });
        renderGroupTree();
      }
    });

    // Provera korisnika
    $('ar-btn-check').addEventListener('click', runCheck);
    $('ar-check-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') runCheck(); });

    // Evidencija
    $('ar-audit-q').addEventListener('input', (e) => {
      S.audit.q = e.target.value.trim();
      debounce('audit', () => loadAudit(true), 300);
    });
    $('ar-audit-action').addEventListener('change', (e) => { S.audit.action = e.target.value; loadAudit(true); });
    $('ar-btn-audit-more').addEventListener('click', () => loadAudit(false));

    // Potvrda
    $('ar-confirm-ok').addEventListener('click', () => {
      const cb = S.confirmCb;
      S.confirmCb = null;
      closeModalEl('modal-ar-confirm');
      if (cb) cb();
    });

    // Upozorenje pri zatvaranju stranice sa nesačuvanim izmenama
    window.addEventListener('beforeunload', (e) => {
      if (S.editor.role && (S.editor.permsDirty || S.editor.camDirty)) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  /* ==========================================================================
     JAVNI INTERFEJS
     ========================================================================== */
  function onTabActivated() {
    if (!S.initialized) {
      S.initialized = true;
      bindEvents();
    }
    loadAll();
    icons();
  }

  window.AccessRolesModule = { onTabActivated, reload: loadAll };
})();
