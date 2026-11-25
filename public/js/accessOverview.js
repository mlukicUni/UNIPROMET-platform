/**
 * ==========================================================================
 * UNIPROMET IT ADMIN - PREGLEDI DOZVOLA ZA PRISTUP KAMERAMA
 * VIDEO NADZOR → Dozvole za pristup: pregled po rolama, po korisnicima i po kamerama,
 * svaki sa pretragom, filterima i izvozom u Excel (server računa i izvozi iste podatke).
 * Korisnici iz AD grupa navedeni su samo ako su se bar jednom prijavili na platformu.
 * ==========================================================================
 */
(function () {
  'use strict';

  const API = '/api/access';
  const STALE_MS = 60 * 1000;

  const D = { data: null, loadedAt: 0, loading: null, cam: new Map(), locations: [], recorders: [], types: [] };

  /** Stanje po pregledu: pretraga, filteri i otvoreni redovi */
  const V = {
    'ov-roles': { q: '', sel: [], sug: { items: [], active: -1, total: 0 }, f: { assign: '', right: '', loc: '' }, open: new Set(), shell: false },
    'ov-users': { q: '', sel: [], sug: { items: [], active: -1, total: 0 }, f: { role: '', source: '', right: '', loc: '', supers: true }, open: new Set(), shell: false },
    'ov-cams': { q: '', sel: [], sug: { items: [], active: -1, total: 0 }, f: { loc: '', rec: '', type: '', role: '', access: '' }, open: new Set(), shell: false }
  };
  const META = {
    'ov-roles': { view: 'roles', panel: 'ar-panel-ov-roles', title: 'dozvola', hint: 'Kucajte naziv dozvole i izaberite je iz liste (možete dodati više)...' },
    'ov-users': { view: 'users', panel: 'ar-panel-ov-users', title: 'korisnika', hint: 'Kucajte ime i prezime i izaberite osobu iz liste (možete dodati više)...' },
    'ov-cams': { view: 'cameras', panel: 'ar-panel-ov-cams', title: 'kamera', hint: 'Kucajte kameru, IP adresu ili lokaciju i izaberite iz liste (možete dodati više)...' }
  };
  const timers = {};
  let current = 'ov-roles';

  /* ------------------------------ pomoćne ------------------------------ */
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  const notify = (m, t) => { if (typeof window.showToast === 'function') window.showToast(m, t || 'info'); };
  const icons = () => { if (window.lucide && window.lucide.createIcons) window.lucide.createIcons(); };
  const norm = (s) => (window.UniSearch && window.UniSearch.norm ? window.UniSearch.norm(s) : String(s || '').toLowerCase());
  const tokens = (q) => (window.UniSearch && window.UniSearch.tokens ? window.UniSearch.tokens(q) : String(q || '').toLowerCase().split(/\s+/).filter(Boolean));
const matches = (blob, q) => { const t = tokens(q); return t.every(w => blob.includes(w)); };
  const camLabel = (c) => c ? (c.position || c.name || c.ip) : '?';
  const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many));

  async function fetchJson(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    let data = null;
    try { data = await res.json(); } catch (e) { /* nije JSON */ }
    if (!res.ok || (data && data.success === false)) throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
    return data;
  }

  /* ------------------------------ podaci ------------------------------ */
  function prepare(data) {
    D.data = data;
    D.cam = new Map(data.cameras.map(c => [c.id, c]));
    D.locations = [...new Set(data.cameras.map(c => c.location).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sr'));
    D.recorders = [...new Set(data.cameras.map(c => c.recorder).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sr'));
    D.types = [...new Set(data.cameras.map(c => c.type).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sr'));
    const camText = (id) => { const c = D.cam.get(id); return c ? `${c.name} ${c.position} ${c.ip} ${c.location} ${c.recorder}` : ''; };
    const locsOf = (ids) => new Set(ids.map(id => (D.cam.get(id) || {}).location).filter(Boolean));

    for (const r of data.roles) {
      r._locs = locsOf(r.cameras.map(c => c.id));
      r._blob = norm(r.name); // pretraga rola: samo naziv role
    }
    for (const u of data.users) {
      u._locs = u.allCameras ? new Set(D.locations) : locsOf(u.cameras.map(c => c.id));
      u._blob = norm(u.name); // pretraga korisnika: samo ime i prezime
    }
    for (const c of data.cameraRows) {
      c._blob = norm([c.name, c.position, c.ip, c.location, c.recorder, c.type, c.roles.map(r => r.name).join(' '),
        c.adGroups.join(' '), c.users.map(u => `${u.name} ${u.email}`).join(' ')].join(' '));
    }
  }

  async function load(force) {
    if (D.loading) return D.loading;
    if (!force && D.data && Date.now() - D.loadedAt < STALE_MS) return D.data;
    D.loading = fetchJson(`${API}/camera-overview`).then(data => {
      prepare(data);
      D.loadedAt = Date.now();
      return data;
    }).finally(() => { D.loading = null; });
    return D.loading;
  }

  /* ------------------------------ ljuska panela ------------------------------ */
  const select = (id, label, options) => `
    <div class="model-filter-dropdown-wrap" style="min-width: 170px;">
      <i data-lucide="filter" class="model-filter-icon"></i>
      <select id="${id}" class="model-filter-select" aria-label="${esc(label)}" data-ov-filter="${id.split('-').pop()}">
        ${options.map(o => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join('')}
      </select>
    </div>`;

  function shellHtml(tab) {
    const m = META[tab];
    const p = tab;
    let filters = '';
    if (tab === 'ov-roles') {
      filters = select(`${p}-assign`, 'Dodela', [['', 'Sve dodele'], ['users', 'Ima korisnike'], ['groups', 'Ima AD grupe'], ['none', 'Bez dodele']]) +
        select(`${p}-right`, 'Pravo', [['', 'Uživo i snimci'], ['playback', 'Ima snimke'], ['liveonly', 'Samo uživo']]) +
        select(`${p}-loc`, 'Lokacija', [['', 'Sve lokacije']]);
    } else if (tab === 'ov-users') {
      filters = select(`${p}-role`, 'Dozvola', [['', 'Sve dozvole']]) +
        select(`${p}-source`, 'Izvor', [['', 'Svi izvori'], ['direct', 'Direktno dodeljeni'], ['ad', 'Preko AD grupe'], ['super', 'Super admini']]) +
        select(`${p}-right`, 'Pravo', [['', 'Uživo i snimci'], ['playback', 'Ima snimke'], ['liveonly', 'Samo uživo']]) +
        select(`${p}-loc`, 'Lokacija', [['', 'Sve lokacije']]) +
        `<label class="ar-ov-check"><input type="checkbox" id="${p}-supers" checked> <span>Prikaži Super admine</span></label>`;
    } else {
      filters = select(`${p}-loc`, 'Lokacija', [['', 'Sve lokacije']]) +
        select(`${p}-rec`, 'Snimač', [['', 'Svi snimači']]) +
        select(`${p}-type`, 'Tip', [['', 'Svi tipovi']]) +
        select(`${p}-role`, 'Dozvola', [['', 'Sve dozvole']]) +
        select(`${p}-access`, 'Pristup', [['', 'Svi pristupi'], ['any', 'Ima kamernu dozvolu'], ['none', 'Bez kamerne dozvole (samo Super admini)'], ['multi', 'U više kamernih dozvola'], ['playback', 'Ima snimke (kamerne dozvole)'], ['liveonly', 'Samo uživo (kamerne dozvole)']]);
    }
    return `
      <div class="network-filters-toolbar" style="margin-top: 14px; flex-wrap: wrap;">
        <div class="ar-ov-search" id="${p}-box">
          <i data-lucide="search" class="ar-ov-search-icon"></i>
          <div class="ar-ov-chips" id="${p}-chips"></div>
          <input type="text" id="${p}-q" placeholder="${esc(m.hint)}" class="ar-ov-search-input" autocomplete="off" spellcheck="false">
          <div class="ar-ov-suggest" id="${p}-sug" style="display: none;"></div>
        </div>
        <button class="btn-dark-outline-sm" type="button" data-ov-reset="${p}" title="Ukloni izabrane stavke, pretragu i filtere"><i data-lucide="filter-x"></i><span>Poništi</span></button>
        <button class="btn-yellow-solid-sm" type="button" data-ov-export="${p}" title="Izvezi trenutni prikaz (pretragu i filtere) u Excel"><i data-lucide="file-spreadsheet"></i><span>Izvezi u Excel</span></button>
      </div>
      <div class="network-filters-toolbar ar-ov-filters" style="margin-top: 8px; flex-wrap: wrap;">${filters}</div>
      <div class="inv-table-wrapper" style="margin-top: 14px; min-height: 220px;">
        <table class="inv-camera-table ar-ov-table"><thead id="${p}-head"></thead><tbody id="${p}-body"></tbody></table>
      </div>
      <div class="table-pagination-footer" style="padding: 14px 4px; margin-top: 10px;">
        <span class="text-dim text-xs" id="${p}-count">Učitavanje...</span>
      </div>
      <div class="ar-hint" id="${p}-note" style="display:none; margin-top: 4px;"></div>`;
  }

  function ensureShell(tab) {
    const st = V[tab];
    const host = $(META[tab].panel);
    if (!host || st.shell) return;
    host.innerHTML = shellHtml(tab);
    st.shell = true;

    host.addEventListener('input', (e) => {
      if (e.target.id === `${tab}-q`) {
        st.q = e.target.value;
        clearTimeout(timers[tab]);
        timers[tab] = setTimeout(() => { suggest(tab); render(tab); }, 120);
      }
    });
    host.addEventListener('keydown', (e) => {
      if (e.target.id !== `${tab}-q`) return;
      const sug = st.sug;
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && sug.items.length) {
        e.preventDefault();
        sug.active = (sug.active + (e.key === 'ArrowDown' ? 1 : -1) + sug.items.length) % sug.items.length;
        drawSuggest(tab);
      } else if ((e.key === 'Enter' || e.key === ';' || e.key === ',') && st.q.trim() && sug.items.length) {
        e.preventDefault();
        pick(tab, Math.max(sug.active, 0));
      } else if (e.key === 'Escape') {
        closeSuggest(tab);
      } else if (e.key === 'Backspace' && !e.target.value && st.sel.length) {
        st.sel.pop();
        renderChips(tab);
        render(tab);
      }
    });
    host.addEventListener('mousedown', (e) => {
      const it = e.target.closest('[data-ov-pick]');
      if (it) { e.preventDefault(); pick(tab, parseInt(it.getAttribute('data-ov-pick'), 10)); }
    });
    host.addEventListener('focusout', (e) => {
      if (e.target.id === `${tab}-q`) setTimeout(() => closeSuggest(tab), 150);
    });
    host.addEventListener('focusin', (e) => {
      if (e.target.id === `${tab}-q` && st.q.trim()) suggest(tab);
    });
    host.addEventListener('change', (e) => {
      const sel = e.target.closest('[data-ov-filter]');
      if (sel) { st.f[sel.getAttribute('data-ov-filter')] = sel.value; render(tab); return; }
      if (e.target.id === `${tab}-supers`) { st.f.supers = e.target.checked; render(tab); }
    });
    host.addEventListener('click', (e) => {
      const tog = e.target.closest('[data-ov-toggle]');
      if (tog) {
        const key = tog.getAttribute('data-ov-toggle');
        if (st.open.has(key)) st.open.delete(key); else st.open.add(key);
        render(tab);
        return;
      }
      const chipX = e.target.closest('[data-ov-chip-x]');
      if (chipX) {
        const key = chipX.getAttribute('data-ov-chip-x');
        st.sel = st.sel.filter(s => s.key !== key);
        renderChips(tab);
        render(tab);
        return;
      }
      if (e.target.closest('[data-ov-reset]')) return resetFilters(tab);
      if (e.target.closest(`#${tab}-box`) && !e.target.closest('[data-ov-pick]')) { const q = $(`${tab}-q`); if (q) q.focus(); return; }
      const ex = e.target.closest('[data-ov-export]');
      if (ex) exportExcel(tab, ex);
    });
  }

  function fillSelect(id, options, keep) {
    const el = $(id);
    if (!el) return;
    const prev = keep !== undefined ? keep : el.value;
    el.innerHTML = options.map(o => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join('');
    el.value = options.some(o => o[0] === prev) ? prev : '';
  }

  function fillFilterOptions(tab) {
    const f = V[tab].f;
    const locs = [['', 'Sve lokacije'], ...D.locations.map(l => [l, l])];
    const roles = [['', 'Sve dozvole'], ...D.data.roles.map(r => [r.id, r.name])];
    if (tab === 'ov-roles') fillSelect(`${tab}-loc`, locs, f.loc);
    if (tab === 'ov-users') { fillSelect(`${tab}-role`, roles, f.role); fillSelect(`${tab}-loc`, locs, f.loc); }
    if (tab === 'ov-cams') {
      fillSelect(`${tab}-loc`, locs, f.loc);
      fillSelect(`${tab}-rec`, [['', 'Svi snimači'], ...D.recorders.map(r => [r, r])], f.rec);
      fillSelect(`${tab}-type`, [['', 'Svi tipovi'], ...D.types.map(r => [r, r])], f.type);
      fillSelect(`${tab}-role`, roles, f.role);
    }
  }

  /* ------------------------------ pilule i predlozi (kao u Outlook-u) ------------------------------ */
  const rowKey = (tab, r) => (tab === 'ov-users' ? r.key : r.id);

  function candidates(tab) {
    if (tab === 'ov-roles') {
      return D.data.roles.map(r => ({ key: r.id, label: r.name, icon: 'shield', blob: norm(r.name),
        sub: r.description || `${r.users.length} korisnika · ${r.groups.length} AD grupa` }));
    }
    if (tab === 'ov-users') {
      return D.data.users.map(u => ({ key: u.key, label: u.name, icon: 'user', blob: norm(u.name),
        sub: u.email + (u.superAdmin ? ' · Super admin' : '') }));
    }
    return D.data.cameraRows.map(c => ({ key: c.id, label: camLabel(c), icon: 'camera',
      blob: norm(`${c.name} ${c.position} ${c.ip} ${c.location} ${c.recorder}`),
      sub: `${c.ip} · ${c.location || '—'}${c.recorder ? ' · ' + c.recorder : ''}` }));
  }

  function suggest(tab) {
    const st = V[tab];
    const q = st.q.trim();
    if (!q || !D.data) { closeSuggest(tab); return; }
    const taken = new Set(st.sel.map(s => s.key));
    const t = tokens(q);
    const found = candidates(tab).filter(c => !taken.has(c.key) && t.every(w => c.blob.includes(w)));
    // one koje počinju upisanim tekstom idu ispred
    found.sort((a, b) => (b.blob.startsWith(t[0]) ? 1 : 0) - (a.blob.startsWith(t[0]) ? 1 : 0) || a.label.localeCompare(b.label, 'sr'));
    st.sug = { items: found.slice(0, 8), active: found.length ? 0 : -1, total: found.length };
    drawSuggest(tab);
  }

  function drawSuggest(tab) {
    const box = $(`${tab}-sug`);
    const sug = V[tab].sug;
    if (!box) return;
    if (!sug.items.length) {
      box.innerHTML = '<div class="ar-ov-sug-empty">Nema rezultata</div>';
    } else {
      box.innerHTML = sug.items.map((it, i) => `
        <div class="ar-ov-sug-item ${i === sug.active ? 'is-active' : ''}" data-ov-pick="${i}">
          <i data-lucide="${it.icon}"></i>
          <div class="ar-ov-sug-text"><b>${esc(it.label)}</b><span>${esc(it.sub)}</span></div>
        </div>`).join('') + (sug.total > sug.items.length ? `<div class="ar-ov-sug-empty">Još ${sug.total - sug.items.length} — nastavite da kucate da suzite izbor</div>` : '');
    }
    box.style.display = 'block';
    icons();
    const active = box.querySelector('.is-active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  function closeSuggest(tab) {
    const box = $(`${tab}-sug`);
    if (box) { box.style.display = 'none'; box.innerHTML = ''; }
    V[tab].sug = { items: [], active: -1, total: 0 };
  }

  function pick(tab, idx) {
    const st = V[tab];
    const it = st.sug.items[idx];
    if (!it) return;
    if (!st.sel.some(s => s.key === it.key)) st.sel.push({ key: it.key, label: it.label, icon: it.icon });
    st.q = '';
    const inp = $(`${tab}-q`);
    if (inp) { inp.value = ''; inp.focus(); }
    closeSuggest(tab);
    renderChips(tab);
    render(tab);
  }

  function renderChips(tab) {
    const st = V[tab];
    const host = $(`${tab}-chips`);
    if (!host) return;
    host.innerHTML = st.sel.map(s => `<span class="ar-ov-chip" title="${esc(s.label)}"><i data-lucide="${s.icon || 'user'}"></i><span>${esc(s.label)}</span><button type="button" data-ov-chip-x="${esc(s.key)}" title="Ukloni" aria-label="Ukloni ${esc(s.label)}">×</button></span>`).join('');
    const inp = $(`${tab}-q`);
    if (inp) inp.placeholder = st.sel.length ? 'Dodaj još...' : META[tab].hint;
    icons();
  }

  function resetFilters(tab) {
    const st = V[tab];
    st.q = '';
    st.sel = [];
    closeSuggest(tab);
    renderChips(tab);
    Object.keys(st.f).forEach(k => { st.f[k] = k === 'supers' ? true : ''; });
    const q = $(`${tab}-q`); if (q) q.value = '';
    Object.keys(st.f).forEach(k => {
      const el = $(`${tab}-${k}`);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = true; else el.value = '';
    });
    render(tab);
  }

  /* ------------------------------ filtriranje ------------------------------ */
  function filtered(tab) {
    const base = filteredBase(tab);
    const sel = V[tab].sel;
    if (!sel.length) return base;
    const keys = new Set(sel.map(s => s.key));
    return base.filter(r => keys.has(rowKey(tab, r)));
  }

  function filteredBase(tab) {
    const st = V[tab];
    const f = st.f;
    // Kad su izabrane stavke (pilule), tekst koji se kuca služi samo za predloge; bez pilula sužava listu
    const q = st.sel.length ? '' : st.q.trim();
    if (tab === 'ov-roles') {
      return D.data.roles.filter(r => {
        if (q && !matches(r._blob, q)) return false;
        if (f.assign === 'users' && r.users.length === 0) return false;
        if (f.assign === 'groups' && r.groups.length === 0) return false;
        if (f.assign === 'none' && (r.users.length || r.groups.length)) return false;
        if (f.right === 'playback' && r.playbackCount === 0) return false;
        if (f.right === 'liveonly' && !(r.liveCount > 0 && r.playbackCount === 0)) return false;
        if (f.loc && !r._locs.has(f.loc)) return false;
        return true;
      });
    }
    if (tab === 'ov-users') {
      return D.data.users.filter(u => {
        if (!f.supers && u.superAdmin) return false;
        if (q && !matches(u._blob, q)) return false;
        if (f.role && !u.roles.some(r => r.id === f.role)) return false;
        if (f.source === 'direct' && !u.roles.some(r => r.via.includes('direktno'))) return false;
        if (f.source === 'ad' && !u.roles.some(r => r.via.some(v => v.startsWith('AD grupa')))) return false;
        if (f.source === 'super' && !u.superAdmin) return false;
        if (f.right === 'playback' && u.playbackCount === 0) return false;
        if (f.right === 'liveonly' && !(u.liveCount > 0 && u.playbackCount === 0)) return false;
        if (f.loc && !u._locs.has(f.loc)) return false;
        return true;
      });
    }
    return D.data.cameraRows.filter(c => {
      if (q && !matches(c._blob, q)) return false;
      if (f.loc && c.location !== f.loc) return false;
      if (f.rec && c.recorder !== f.rec) return false;
      if (f.type && c.type !== f.type) return false;
      if (f.role && !c.roles.some(r => r.id === f.role)) return false;
      const real = c.roles.filter(r => !r.superAdmin); // kamerne role (bez ugrađenog Super admina)
      if (f.access === 'any' && real.length === 0) return false;
      if (f.access === 'none' && real.length > 0) return false;
      if (f.access === 'multi' && real.length < 2) return false;
      if (f.access === 'playback' && !real.some(r => r.playback)) return false;
      if (f.access === 'liveonly' && !(real.some(r => r.live) && !real.some(r => r.playback))) return false;
      return true;
    });
  }

  function filterDescriptions(tab) {
    const st = V[tab];
    const out = [];
    const label = (id, sel) => { const el = $(`${tab}-${id}`); return el && el.selectedOptions[0] ? el.selectedOptions[0].textContent : ''; };
    if (st.sel.length) out.push(`Izabrano: ${st.sel.map(s => s.label).join(', ')}`);
    if (!st.sel.length && st.q.trim()) out.push(`Pretraga: ${st.q.trim()}`);
    const names = { assign: 'Dodela', right: 'Pravo', loc: 'Lokacija', role: 'Dozvola', source: 'Izvor', rec: 'Snimač', type: 'Tip', access: 'Pristup' };
    Object.keys(st.f).forEach(k => {
      if (k === 'supers') { if (!st.f.supers) out.push('Bez Super admina'); return; }
      if (st.f[k]) out.push(`${names[k]}: ${label(k)}`);
    });
    return out;
  }

  /* ------------------------------ prikaz ------------------------------ */
  const chips = (arr, cls, max) => {
    if (!arr.length) return '<span class="text-dim text-xs">—</span>';
    const shown = arr.slice(0, max || 3);
    const more = arr.length - shown.length;
    return `<div class="ar-chip-row">${shown.map(t => `<span class="ar-pill ${cls || ''}" title="${esc(t.title || '')}">${esc(t.text !== undefined ? t.text : t)}</span>`).join('')}${more > 0 ? `<span class="ar-pill">+${more}</span>` : ''}</div>`;
  };
  const num = (n, total) => `<span class="ar-num-badge ${n ? 'is-on' : ''}">${n}${total ? ` / ${total}` : ''}</span>`;
  const flags = (c) => `<span class="ar-flag ${c.live ? 'on' : ''}" title="Uživo">U</span><span class="ar-flag ${c.playback ? 'on' : ''}" title="Snimci">S</span>`;

  /** Kamere grupisane po lokaciji (detalj reda); elementi imaju id kamere i prava */
  function camGroupsHtml(list, extra) {
    if (!list.length) return '<div class="ar-tree-empty">Nema kamera.</div>';
    const byLoc = new Map();
    for (const it of list) {
      const c = D.cam.get(it.id);
      const loc = (c && c.location) || 'Bez lokacije';
      if (!byLoc.has(loc)) byLoc.set(loc, []);
      byLoc.get(loc).push({ it, c });
    }
    return [...byLoc.entries()].sort((a, b) => a[0].localeCompare(b[0], 'sr')).map(([loc, items]) => `
      <div class="ar-ov-loc"><b>${esc(loc)}</b> <span class="text-dim">(${items.length})</span></div>
      <div class="ar-ov-cams">${items.map(({ it, c }) => `
        <span class="ar-ov-cam" title="${esc(c ? `${c.name} · ${c.ip} · ${c.recorder}` : it.id)}${extra ? esc(extra(it)) : ''}">
          <i data-lucide="camera"></i><span>${esc(camLabel(c))}</span>${flags(it)}
        </span>`).join('')}</div>`).join('');
  }

  function rowToggleCell(tab, key, inner) {
    const open = V[tab].open.has(key);
    return `<td><div class="ar-role-name" data-ov-toggle="${esc(key)}"><i data-lucide="${open ? 'chevron-down' : 'chevron-right'}"></i><span>${inner}</span></div></td>`;
  }

  function renderRoles(rows, tab) {
    const total = D.data.cameras.length;
    $(`${tab}-head`).innerHTML = `<tr><th style="min-width:230px;">DOZVOLA</th><th style="min-width:200px;">PRISTUP KAMERAMA</th><th style="min-width:180px;">KORISNICI</th><th style="min-width:160px;">AD GRUPE</th><th style="width:110px;text-align:center;">UŽIVO</th><th style="width:110px;text-align:center;">SNIMCI</th></tr>`;
    $(`${tab}-body`).innerHTML = rows.map(r => {
      const open = V[tab].open.has(r.id);
      const main = `<tr>
        ${rowToggleCell(tab, r.id, `${esc(r.name)}${r.description ? `<div class="ar-ov-sub">${esc(r.description)}</div>` : ''}`)}
        <td>${chips(r.scope, 'is-role', 3)}</td>
        <td>${chips(r.users.map(u => ({ text: u.name, title: u.email })), '', 3)}</td>
        <td>${chips(r.groups.map(g => g.name), '', 3)}</td>
        <td style="text-align:center;">${num(r.liveCount, total)}</td>
        <td style="text-align:center;">${num(r.playbackCount, total)}</td>
      </tr>`;
      if (!open) return main;
      const members = r.groupMembers.length
        ? `<div class="ar-ov-block"><h6>Poznati članovi AD grupa (${r.groupMembers.length})</h6>${chips(r.groupMembers.map(m => ({ text: m.name, title: `${m.email} · ${m.group}` })), '', 60)}</div>`
        : (r.groups.length ? '<div class="ar-ov-block"><h6>Članovi AD grupa</h6><span class="text-dim text-xs">Nijedan član grupe se još nije prijavio na platformu, pa se ne zna ko su.</span></div>' : '');
      const all = r.users.length ? `<div class="ar-ov-block"><h6>Korisnici dodeljeni direktno (${r.users.length})</h6>${chips(r.users.map(u => ({ text: u.name, title: u.email })), '', 60)}</div>` : '';
      return main + `<tr class="ar-ov-detail"><td colspan="6">${all}${members}<div class="ar-ov-block"><h6>Kamere (${r.cameras.length})</h6>${camGroupsHtml(r.cameras)}</div></td></tr>`;
    }).join('');
  }

  /** Nazivi kamera koje korisnik vidi (prvih nekoliko u redu, ostale posle klika na „+N“) */
  function userCamChips(u, total) {
    if (u.allCameras) return `<span class="ar-pill is-role" title="Super admin vidi sve kamere">Sve kamere (${total})</span>`;
    if (!u.cameras.length) return '<span class="text-dim text-xs">—</span>';
    const open = V['ov-users'].open.has(u.key);
    const sorted = u.cameras.slice().sort((a, b) => camLabel(D.cam.get(a.id)).localeCompare(camLabel(D.cam.get(b.id)), 'sr'));
    const shown = open ? [] : sorted.slice(0, 6);
    const more = open ? 0 : sorted.length - shown.length;
    const tip = (c) => { const cam = D.cam.get(c.id); return `${cam ? cam.location + ' · ' + cam.ip : ''} · ${c.live ? 'uživo' : ''}${c.live && c.playback ? ' i ' : ''}${c.playback ? 'snimci' : ''}`; };
    if (open) return `<span class="text-dim text-xs">Sve kamere su ispod (${sorted.length})</span>`;
    return `<div class="ar-chip-row">${shown.map(c => `<span class="ar-pill" title="${esc(tip(c))}">${esc(camLabel(D.cam.get(c.id)))}</span>`).join('')}${more > 0 ? `<span class="ar-pill is-more" data-ov-toggle="${esc(u.key)}" title="Prikaži sve kamere">+${more} više</span>` : ''}</div>`;
  }

  function renderUsers(rows, tab) {
    const total = D.data.cameras.length;
    $(`${tab}-head`).innerHTML = `<tr><th style="min-width:260px;">KORISNIK</th><th style="min-width:220px;">DOZVOLE</th><th style="min-width:340px;">KAMERE KOJE VIDI</th><th style="width:100px;text-align:center;">UŽIVO</th><th style="width:100px;text-align:center;">SNIMCI</th></tr>`;
    $(`${tab}-body`).innerHTML = rows.map(u => {
      const open = V[tab].open.has(u.key);
      const badges = (u.superAdmin ? ' <span class="ar-tag">Super admin</span>' : '') + (!u.loggedIn ? ' <span class="ar-tag ar-tag-dim" title="Još se nije prijavio na platformu">nije se prijavio</span>' : '');
      const roleChips = u.roles.length
        ? chips(u.roles.map(r => ({ text: r.name, title: r.via.join(', ') })), 'is-role', 4)
        : (u.superAdmin ? '<span class="text-dim text-xs">Super admin: sve kamere</span>' : '<span class="text-dim text-xs">—</span>');
      const main = `<tr>
        ${rowToggleCell(tab, u.key, `${esc(u.name)}${badges}<div class="ar-ov-sub">${esc(u.email)}</div>`)}
        <td>${roleChips}</td>
        <td>${userCamChips(u, total)}</td>
        <td style="text-align:center;">${num(u.liveCount, total)}</td>
        <td style="text-align:center;">${num(u.playbackCount, total)}</td>
      </tr>`;
      if (!open) return main;
      const roles = u.roles.map(r => `<div class="ar-ov-line"><span class="ar-pill is-role">${esc(r.name)}</span> <span class="text-dim text-xs">${esc(r.via.join(' · '))}</span></div>`).join('');
      const login = u.lastLoginAt ? `Poslednja prijava: ${new Date(u.lastLoginAt).toLocaleString('sr-RS')}` : '';
      const cams = u.allCameras
        ? '<div class="ar-tree-empty">Super admin vidi sve kamere (uživo i snimke).</div>'
        : camGroupsHtml(u.cameras, (it) => ` · preko: ${it.roles.join(', ')}`);
      return main + `<tr class="ar-ov-detail"><td colspan="5">
        <div class="ar-ov-block"><h6>Dozvole${login ? ` <span class="text-dim text-xs">· ${esc(login)}</span>` : ''}</h6>${roles || '<span class="text-dim text-xs">—</span>'}</div>
        <div class="ar-ov-block"><h6>Kamere (${u.allCameras ? total : u.cameras.length})</h6>${cams}</div></td></tr>`;
    }).join('');
  }

  function renderCams(rows, tab) {
    $(`${tab}-head`).innerHTML = `<tr><th style="min-width:240px;">KAMERA</th><th style="min-width:170px;">LOKACIJA / SNIMAČ</th><th style="min-width:200px;">DOZVOLE</th><th style="min-width:160px;">AD GRUPE</th><th style="min-width:200px;">KORISNICI</th></tr>`;
    $(`${tab}-body`).innerHTML = rows.map(c => {
      const open = V[tab].open.has(c.id);
      const noAccess = c.roles.every(r => r.superAdmin);
      const main = `<tr>
        ${rowToggleCell(tab, c.id, `${esc(camLabel(c))}<div class="ar-ov-sub">${esc(c.ip)}${c.type ? ' · ' + esc(c.type) : ''}</div>`)}
        <td>${esc(c.location || '—')}<div class="ar-ov-sub">${esc(c.recorder || '')}</div></td>
        <td>${noAccess ? '<span class="ar-tag ar-tag-warn">samo Super admini</span>' : chips(c.roles.map(r => ({ text: r.name, title: `${r.live ? 'uživo' : ''}${r.live && r.playback ? ' i ' : ''}${r.playback ? 'snimci' : ''}` })), 'is-role', 3)}</td>
        <td>${chips(c.adGroups, '', 3)}</td>
        <td>${chips(c.users.map(u => ({ text: u.name, title: u.email })), '', 3)}</td>
      </tr>`;
      if (!open) return main;
      const roleLines = c.roles.map(r => `<div class="ar-ov-line"><span class="ar-pill is-role">${esc(r.name)}</span> ${flags(r)}</div>`).join('');
      const userLines = c.users.map(u => `<span class="ar-ov-cam" title="${esc(u.email)}"><i data-lucide="user"></i><span>${esc(u.name)}</span>${flags(u)}</span>`).join('');
      return main + `<tr class="ar-ov-detail"><td colspan="5">
        <div class="ar-ov-block"><h6>Dozvole (${c.roles.length})</h6>${roleLines || '<span class="text-dim text-xs">Nijedna kamerna dozvola ne daje pristup ovoj kameri.</span>'}</div>
        <div class="ar-ov-block"><h6>Korisnici (${c.users.length})</h6>${userLines ? `<div class="ar-ov-cams">${userLines}</div>` : '<span class="text-dim text-xs">—</span>'}</div></td></tr>`;
    }).join('');
  }

  function render(tab) {
    const st = V[tab];
    if (!D.data || !st.shell) return;
    const rows = filtered(tab);
    const totalRows = tab === 'ov-roles' ? D.data.roles.length : tab === 'ov-users' ? D.data.users.length : D.data.cameraRows.length;
    if (tab === 'ov-roles') renderRoles(rows, tab);
    else if (tab === 'ov-users') renderUsers(rows, tab);
    else renderCams(rows, tab);

    const body = $(`${tab}-body`);
    if (rows.length === 0) {
      const cols = tab === 'ov-roles' ? 6 : tab === 'ov-users' ? 5 : 5;
      body.innerHTML = `<tr><td colspan="${cols}"><div class="ar-tree-empty">${totalRows === 0 ? 'Još nema podataka.' : 'Nema stavki za zadatu pretragu i filtere.'}</div></td></tr>`;
    }
    $(`${tab}-count`).textContent = `Prikazano: ${rows.length} od ${totalRows} ${META[tab].title}`;

    const note = $(`${tab}-note`);
    const supers = D.data.superAdmins.length;
    if (tab === 'ov-cams') {
      note.style.display = '';
      note.innerHTML = `<i data-lucide="info"></i><span>Super admini (${supers}) vide sve kamere i uračunati su kao ugrađena dozvola „Super admin“. Korisnici iz AD grupa navedeni su samo ako su se bar jednom prijavili na platformu.</span>`;
    } else if (tab === 'ov-roles') {
      note.style.display = '';
      note.innerHTML = '<i data-lucide="info"></i><span>Uz kamerne dozvole prikazana je i ugrađena dozvola „Super admin“ (sve kamere). Pretraga traži samo po nazivu dozvole. Članovi AD grupa navedeni su samo ako su se bar jednom prijavili na platformu.</span>';
    } else {
      note.style.display = '';
      note.innerHTML = '<i data-lucide="info"></i><span>Korisnici iz AD grupa navedeni su samo ako su se bar jednom prijavili na platformu; direktno dodeljeni se vide uvek.</span>';
    }
    icons();
  }

  /* ------------------------------ izvoz u Excel ------------------------------ */
  async function exportExcel(tab, btn) {
    if (!D.data) return;
    const rows = filtered(tab);
    if (rows.length === 0) { notify('Nema stavki za izvoz u trenutnom prikazu.', 'error'); return; }
    const keys = rows.map(r => (tab === 'ov-users' ? r.key : r.id));
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(`${API}/camera-overview/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view: META[tab].view, keys, filters: filterDescriptions(tab) })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Izvoz nije uspeo');
      }
      const blob = await res.blob();
      const disp = res.headers.get('Content-Disposition') || '';
      const name = (/filename="([^"]+)"/.exec(disp) || [])[1] || 'Unipromet_Pristup_kamerama.xlsx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify(`Izvezeno ${rows.length} ${plural(rows.length, 'stavka', 'stavke', 'stavki')} u Excel.`, 'success');
    } catch (err) {
      notify(`Izvoz nije uspeo: ${err.message}`, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* ------------------------------ javni interfejs ------------------------------ */
  async function show(tab, force) {
    if (!META[tab]) return;
    current = tab;
    ensureShell(tab);
    const count = $(`${tab}-count`);
    if (!D.data && count) count.textContent = 'Učitavanje...';
    try {
      await load(!!force);
      if (current !== tab) return;
      fillFilterOptions(tab);
      renderChips(tab);
      render(tab);
    } catch (err) {
      console.error('[AccessOverview] Greška pri učitavanju:', err);
      if (count) count.textContent = `Greška pri učitavanju: ${err.message}`;
      notify(`Greška pri učitavanju pregleda: ${err.message}`, 'error');
    }
  }

  function invalidate() { D.loadedAt = 0; }

  window.AccessOverviewModule = { show, invalidate };
})();
