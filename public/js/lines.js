/**
 * ============================================================================
 * UNIPROMET IT ADMIN - MREŽNE I TELEFONSKE LINIJE MODULE (lines.js)
 * ============================================================================
 * Manages network lines, wall sockets, patch panel mappings, cable routes,
 * related offices and rack cabinet node relationships with 2-way 121.20 sync.
 * ============================================================================
 */

(function () {
  'use strict';

  const state = {
    items: [],
    totalItems: 0,
    currentPage: 1,
    pageSize: 50,
    totalPages: 1,
    searchQuery: '',
    selectedCvor: '',
    selectedRoom: '',
    sortBy: 'id',
    sortOrder: 'ASC',
    activeKpiFilter: null,
    stats: {
      total: 0,
      uniqueCvorovi: 0,
      coveredRooms: 0,
      withPatchCode: 0,
      withRouteDesc: 0
    },
    cvoroviList: [],
    roomsList: [],
    isLoading: false,
    initialized: false,
    deleteTargetId: null
  };

  /**
   * Escape HTML utility to prevent XSS
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Toast notification helper
   */
  function showToast(message, type = 'info') {
    const deck = document.getElementById('toast-deck');
    if (!deck) return;

    const toast = document.createElement('div');
    toast.className = `toast-msg toast-${type}`;
    const iconName = type === 'success' ? 'check-circle' : type === 'error' ? 'alert-circle' : 'info';
    toast.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <i data-lucide="${iconName}" style="width: 16px; height: 16px;"></i>
        <span>${escapeHtml(message)}</span>
      </div>
    `;

    deck.appendChild(toast);
    if (window.lucide) window.lucide.createIcons();

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  /**
   * Initializes the Lines module
   */
  async function init() {
    if (!state.initialized) {
      bindEvents();
      state.initialized = true;
    }

    await Promise.all([
      loadDropdowns(),
      loadStats(),
      fetchLines()
    ]);
  }

  /**
   * Fetches KPI summary statistics
   */
  async function loadStats() {
    try {
      const res = await fetch('/api/lines/stats');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.success && json.data) {
        state.stats = json.data;
        renderStats();
      }
    } catch (err) {
      console.warn('[Lines] Greška pri učitavanju statistike:', err);
    }
  }

  /**
   * Updates KPI Card numbers and Sidebar Badge
   */
  function renderStats() {
    const elTotal = document.getElementById('kpi-lines-total');
    const elCvorovi = document.getElementById('kpi-lines-cvorovi');
    const elRooms = document.getElementById('kpi-lines-rooms');
    const elPatch = document.getElementById('kpi-lines-patch');
    const elRoutes = document.getElementById('kpi-lines-routes');
    const badgeNav = document.getElementById('badge-nav-lines-total');

    if (elTotal) elTotal.textContent = state.stats.total || 0;
    if (elCvorovi) elCvorovi.textContent = state.stats.uniqueCvorovi || 0;
    if (elRooms) elRooms.textContent = state.stats.coveredRooms || 0;
    if (elPatch) elPatch.textContent = state.stats.withPatchCode || 0;
    if (elRoutes) elRoutes.textContent = state.stats.withRouteDesc || 0;
    if (badgeNav) badgeNav.textContent = state.stats.total || 0;
  }

  /**
   * Loads helper dropdowns for filter and modal
   */
  async function loadDropdowns() {
    try {
      const [cvorRes, roomRes] = await Promise.all([
        fetch('/api/lines/cvorovi'),
        fetch('/api/lines/rooms')
      ]);

      if (cvorRes.ok) {
        const cJson = await cvorRes.json();
        if (cJson.success) {
          state.cvoroviList = cJson.data || [];
          populateCvorSelects();
        }
      }

      if (roomRes.ok) {
        const rJson = await roomRes.json();
        if (rJson.success) {
          state.roomsList = rJson.data || [];
          populateRoomSelects();
        }
      }
    } catch (err) {
      console.warn('[Lines] Greška pri učitavanju dropdown šifarnika:', err);
    }
  }

  function populateCvorSelects() {
    const filterSelect = document.getElementById('select-lines-cvor');
    const modalSelect = document.getElementById('select-line-cvor');

    let filterHtml = '<option value="">Sva Čvorišta / Ormani</option>';
    let modalHtml = '<option value="">-- Izaberite Čvorište / Orman --</option>';

    for (const c of state.cvoroviList) {
      const locStr = [c.location_name, c.building_name].filter(Boolean).join(' - ');
      const label = `#${c.id} ${escapeHtml(c.name)}${locStr ? ` (${escapeHtml(locStr)})` : ''}`;
      filterHtml += `<option value="${c.id}">${label}</option>`;
      modalHtml += `<option value="${c.id}">${label}</option>`;
    }

    if (filterSelect) filterSelect.innerHTML = filterHtml;
    if (modalSelect) modalSelect.innerHTML = modalHtml;
  }

  function populateRoomSelects() {
    const filterSelect = document.getElementById('select-lines-room');
    const modalSelect = document.getElementById('select-line-room');

    let filterHtml = '<option value="">Sve Kancelarije</option>';
    let modalHtml = '<option value="">-- Izaberite Kancelariju --</option>';

    for (const r of state.roomsList) {
      const bldStr = [r.location_name, r.building_name].filter(Boolean).join(' - ');
      const label = `${escapeHtml(r.name)}${r.floor !== null && r.floor !== undefined ? ` [Sprat ${r.floor}]` : ''}${bldStr ? ` (${escapeHtml(bldStr)})` : ''}`;
      filterHtml += `<option value="${r.id}">${label}</option>`;
      modalHtml += `<option value="${r.id}">${label}</option>`;
    }

    if (filterSelect) filterSelect.innerHTML = filterHtml;
    if (modalSelect) modalSelect.innerHTML = modalHtml;
  }

  /**
   * Fetches paginated lines with filtering
   */
  async function fetchLines(page = 1) {
    state.currentPage = page;
    state.isLoading = true;
    renderTableLoading();

    try {
      const params = new URLSearchParams({
        page: String(state.currentPage),
        limit: String(state.pageSize),
        sortBy: state.sortBy,
        sortOrder: state.sortOrder
      });

      if (state.searchQuery) params.set('search', state.searchQuery);
      if (state.selectedCvor) params.set('cvorId', state.selectedCvor);
      if (state.selectedRoom) params.set('roomId', state.selectedRoom);

      const res = await fetch(`/api/lines?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();
      state.items = json.data || [];
      state.totalItems = json.pagination?.total || 0;
      state.totalPages = json.pagination?.totalPages || 1;

      renderTable();
      renderPagination();
      updateResetButtonVisibility();
    } catch (err) {
      console.error('[Lines] Greška pri dohvatanju linija:', err);
      renderTableError(err.message);
    } finally {
      state.isLoading = false;
    }
  }

  /**
   * Renders loading skeletons in table
   */
  function renderTableLoading() {
    const tbody = document.getElementById('tbody-lines');
    if (!tbody) return;

    let rows = '';
    for (let i = 0; i < 5; i++) {
      rows += `
        <tr class="skeleton-row">
          <td colspan="9" style="padding: 16px; text-align: center;">
            <div class="skeleton-line" style="height: 20px; width: 90%; margin: 0 auto; background: rgba(255,255,255,0.06); border-radius: 4px;"></div>
          </td>
        </tr>
      `;
    }
    tbody.innerHTML = rows;
  }

  /**
   * Renders error state in table
   */
  function renderTableError(msg) {
    const tbody = document.getElementById('tbody-lines');
    if (!tbody) return;

    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; padding: 36px 20px;">
          <div style="color: #ef4444; margin-bottom: 8px;"><i data-lucide="alert-triangle" style="width: 32px; height: 32px;"></i></div>
          <p style="color: #f87171; font-weight: 600;">Greška pri učitavanju linija</p>
          <p class="text-dim text-xs">${escapeHtml(msg)}</p>
          <button class="btn-dark-sm" onclick="window.linesModule.fetchLines()" style="margin-top: 12px;">Pokušaj ponovo</button>
        </td>
      </tr>
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  /**
   * Main table renderer
   */
  function renderTable() {
    const tbody = document.getElementById('tbody-lines');
    if (!tbody) return;

    if (!state.items || state.items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; padding: 48px 20px;">
            <div style="color: #64748b; margin-bottom: 8px;"><i data-lucide="cable" style="width: 36px; height: 36px;"></i></div>
            <p style="color: #94a3b8; font-weight: 600; font-size: 1rem;">Nema pronađenih linija</p>
            <p class="text-dim text-xs" style="margin-top: 4px;">Pokušajte sa promenom kriterijuma pretrage ili filtera čvorišta/kancelarije.</p>
          </td>
        </tr>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    let html = '';
    for (const item of state.items) {
      const socketBadge = item.wall_socket_no 
        ? `<span class="badge-status-neutral" style="font-size: 0.92rem; font-weight: 800; padding: 3px 9px; background: rgba(245, 158, 11, 0.12); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 6px;">#${item.wall_socket_no}</span>`
        : `<span class="text-dim text-xs">-</span>`;

      const patchBadge = item.patch_panel_code 
        ? `<span style="font-family: monospace; font-size: 0.92rem; font-weight: 800; padding: 3px 9px; background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.28); border-radius: 6px;">PORT ${escapeHtml(item.patch_panel_code)}</span>`
        : `<span class="text-dim text-xs" style="font-style: italic;">Nije označeno</span>`;

      const roomName = item.room_name || (item.room_code ? `Kanc ${escapeHtml(item.room_code)}` : 'Nedefinisana soba');
      const roomFloor = (item.room_floor !== null && item.room_floor !== undefined && String(item.room_floor).trim() !== '') 
        ? `<span class="text-dim text-xs" style="margin-left: 6px; background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px;">Sprat ${escapeHtml(item.room_floor)}</span>` 
        : '';

      const roomEquipmentBadge = item.room_equipment_count > 0
        ? `<span style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.75rem; color: #10b981; background: rgba(16, 185, 129, 0.1); padding: 2px 6px; border-radius: 4px; margin-top: 4px; border: 1px solid rgba(16, 185, 129, 0.2);">
            <i data-lucide="monitor" style="width: 12px; height: 12px;"></i> ${item.room_equipment_count} uređaja u sobi
           </span>`
        : '';

      const cvorName = item.cvor_name || (item.cvor_id ? `Čvor #${item.cvor_id}` : 'Nema čvora');
      const rackDims = item.cvor_rack_dims ? `<div class="text-dim text-xs" style="margin-top: 3px;"><i data-lucide="box" style="width: 11px; height: 11px; display: inline; vertical-align: middle;"></i> ${escapeHtml(item.cvor_rack_dims)}</div>` : '';

      const bldLoc = [item.location_name, item.building_name].filter(Boolean).join(' &bull; ');

      const routeDesc = item.route_description 
        ? `<div style="max-width: 240px; font-size: 0.82rem; color: #cbd5e1; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;" title="${escapeHtml(item.route_description)}">
            ${escapeHtml(item.route_description)}
           </div>`
        : `<span class="text-dim text-xs">-</span>`;

      const desc = item.description 
        ? `<div style="max-width: 200px; font-size: 0.82rem; color: #94a3b8; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;" title="${escapeHtml(item.description)}">
            ${escapeHtml(item.description)}
           </div>`
        : `<span class="text-dim text-xs">-</span>`;

      html += `
        <tr data-line-id="${item.id}">
          <td style="font-weight: 700; color: #94a3b8;">#${item.id}</td>
          <td style="text-align: center;">${socketBadge}</td>
          <td style="text-align: center;">${patchBadge}</td>
          <td>
            <div style="font-weight: 600; color: #f1f5f9; display: flex; align-items: center;">
              <span>${escapeHtml(roomName)}</span>
              ${roomFloor}
            </div>
            ${roomEquipmentBadge}
          </td>
          <td>
            <div style="font-size: 0.85rem; color: #cbd5e1;">${bldLoc ? escapeHtml(bldLoc) : '<span class="text-dim text-xs">-</span>'}</div>
          </td>
          <td>
            <div style="font-weight: 600; color: #c084fc; display: flex; align-items: center; gap: 5px;">
              <i data-lucide="git-commit" style="width: 14px; height: 14px; color: #a855f7;"></i>
              <span>${escapeHtml(cvorName)}</span>
            </div>
            ${rackDims}
          </td>
          <td>${routeDesc}</td>
          <td>${desc}</td>
          <td style="text-align: right;">
            <div class="inv-actions-cell" style="justify-content: flex-end; gap: 4px;">
              <button type="button" class="btn-inv-action btn-web btn-view-line" data-id="${item.id}" title="Prikaži detalje veze i opreme u sobi">
                <i data-lucide="eye"></i>
              </button>
              <button type="button" class="btn-inv-action btn-edit-line" data-id="${item.id}" title="Izmeni mrežnu liniju">
                <i data-lucide="pencil"></i>
              </button>
              <button type="button" class="btn-inv-action btn-danger btn-inv-action-delete btn-delete-line" data-id="${item.id}" style="color: #f87171;" title="Obriši mrežnu liniju">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }

    tbody.innerHTML = html;
    if (window.lucide) window.lucide.createIcons();
  }

  /**
   * Renders pagination buttons & counters
   */
  function renderPagination() {
    const counterText = document.getElementById('lines-counter-text');
    const controls = document.getElementById('lines-pagination-controls');

    if (counterText) {
      const from = state.totalItems === 0 ? 0 : (state.currentPage - 1) * state.pageSize + 1;
      const to = Math.min(state.currentPage * state.pageSize, state.totalItems);
      counterText.textContent = `Prikazano: ${from}-${to} od ukupno ${state.totalItems} linija`;
    }

    if (!controls) return;
    if (state.totalPages <= 1) {
      controls.innerHTML = '';
      return;
    }

    let buttonsHtml = '';
    const current = state.currentPage;
    const total = state.totalPages;

    // Prev button
    buttonsHtml += `
      <button class="pagination-btn ${current === 1 ? 'disabled' : ''}" data-page="${current - 1}" ${current === 1 ? 'disabled' : ''} title="Prethodna">
        <i data-lucide="chevron-left"></i>
      </button>
    `;

    // Pages
    for (let p = 1; p <= total; p++) {
      if (p === 1 || p === total || (p >= current - 2 && p <= current + 2)) {
        buttonsHtml += `
          <button class="pagination-btn ${p === current ? 'active' : ''}" data-page="${p}">
            ${p}
          </button>
        `;
      } else if (p === current - 3 || p === current + 3) {
        buttonsHtml += `<span class="pagination-ellipsis">...</span>`;
      }
    }

    // Next button
    buttonsHtml += `
      <button class="pagination-btn ${current === total ? 'disabled' : ''}" data-page="${current + 1}" ${current === total ? 'disabled' : ''} title="Sledeća">
        <i data-lucide="chevron-right"></i>
      </button>
    `;

    controls.innerHTML = buttonsHtml;
    if (window.lucide) window.lucide.createIcons();
  }

  function updateResetButtonVisibility() {
    const btnReset = document.getElementById('btn-reset-lines-filters');
    const hasFilters = Boolean(state.searchQuery || state.selectedCvor || state.selectedRoom);
    if (btnReset) btnReset.style.display = hasFilters ? 'inline-flex' : 'none';
  }

  /**
   * Opens Edit/Add Modal
   */
  async function openEditModal(id = null) {
    const modal = document.getElementById('modal-line-edit');
    const title = document.getElementById('modal-line-title');
    const sub = document.getElementById('modal-line-subtitle');
    const inputId = document.getElementById('input-line-id');
    const inputWall = document.getElementById('input-line-wall-socket');
    const inputPatch = document.getElementById('input-line-patch-panel');
    const selectCvor = document.getElementById('select-line-cvor');
    const selectRoom = document.getElementById('select-line-room');
    const inputRoute = document.getElementById('input-line-route-desc');
    const inputDesc = document.getElementById('input-line-desc');

    if (!modal) return;

    if (id) {
      if (title) title.textContent = `Izmena Linije #${id}`;
      if (sub) sub.textContent = 'Ažuriranje parametara utičnice, porta i trase';
      if (inputId) inputId.value = id;

      try {
        const res = await fetch(`/api/lines/${id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const item = json.data;

        if (inputWall) inputWall.value = item.wall_socket_no !== null && item.wall_socket_no !== undefined ? item.wall_socket_no : '';
        if (inputPatch) inputPatch.value = item.patch_panel_code || '';
        if (selectCvor) selectCvor.value = item.cvor_id || '';
        if (selectRoom) selectRoom.value = item.room_id || '';
        if (inputRoute) inputRoute.value = item.route_description || '';
        if (inputDesc) inputDesc.value = item.description || '';
      } catch (err) {
        showToast(`Greška pri učitavanju linije #${id}: ${err.message}`, 'error');
        return;
      }
    } else {
      if (title) title.textContent = 'Nova Mrežna / Telefonska Linija';
      if (sub) sub.textContent = 'Unos nove zidne utičnice, patch panel porta i trase kablova';
      if (inputId) inputId.value = '';
      if (inputWall) inputWall.value = '';
      if (inputPatch) inputPatch.value = '';
      if (selectCvor) selectCvor.value = state.selectedCvor || '';
      if (selectRoom) selectRoom.value = state.selectedRoom || '';
      if (inputRoute) inputRoute.value = '';
      if (inputDesc) inputDesc.value = '';
    }

    modal.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons();
    if (inputWall) inputWall.focus();
  }

  function closeEditModal() {
    const modal = document.getElementById('modal-line-edit');
    if (modal) modal.style.display = 'none';
  }

  /**
   * Saves Line (Create or Update)
   */
  async function handleSaveLine(e) {
    e.preventDefault();

    const inputId = document.getElementById('input-line-id');
    const id = inputId?.value ? parseInt(inputId.value, 10) : null;

    const wallSocket = document.getElementById('input-line-wall-socket')?.value;
    const patchPanel = document.getElementById('input-line-patch-panel')?.value;
    const cvorId = document.getElementById('select-line-cvor')?.value;
    const roomId = document.getElementById('select-line-room')?.value;
    const routeDesc = document.getElementById('input-line-route-desc')?.value;
    const desc = document.getElementById('input-line-desc')?.value;

    const payload = {
      wall_socket_no: wallSocket ? parseInt(wallSocket, 10) : null,
      patch_panel_code: patchPanel ? patchPanel.trim() : null,
      cvor_id: cvorId ? parseInt(cvorId, 10) : null,
      room_id: roomId ? parseInt(roomId, 10) : null,
      route_description: routeDesc ? routeDesc.trim() : null,
      description: desc ? desc.trim() : null
    };

    const isEdit = Boolean(id);
    const url = isEdit ? `/api/lines/${id}` : '/api/lines';
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Greška pri čuvanju');

      showToast(json.message || (isEdit ? 'Linija uspešno izmenjena' : 'Nova linija uspešno dodata'), 'success');
      closeEditModal();
      await Promise.all([loadStats(), fetchLines(state.currentPage)]);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  /**
   * Opens Details Modal (Interactive route + Room equipment & Employees)
   */
  async function openDetailsModal(id) {
    const modal = document.getElementById('modal-line-details');
    const content = document.getElementById('line-details-content');
    if (!modal || !content) return;

    content.innerHTML = `
      <div style="text-align: center; padding: 40px;">
        <div class="spinner" style="margin: 0 auto 12px auto;"></div>
        <p class="text-dim text-xs">Učitavanje detalja veze i prostorije...</p>
      </div>
    `;
    modal.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons();

    try {
      const res = await fetch(`/api/lines/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const item = json.data;

      const roomName = item.room_name || (item.room_code ? `Kanc ${item.room_code}` : 'Nedefinisana prostorija');
      const cvorName = item.cvor_name || (item.cvor_id ? `Čvor #${item.cvor_id}` : 'Nedefinisan čvor');

      let eqHtml = '';
      if (item.room_equipment_list && item.room_equipment_list.length > 0) {
        eqHtml = `
          <div style="margin-top: 20px;">
            <h5 style="color: #f8fafc; font-size: 0.95rem; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
              <i data-lucide="monitor" style="width: 16px; height: 16px; color: #10b981;"></i>
              IT Oprema u ovoj prostoriji (${item.room_equipment_list.length})
            </h5>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px;">
              ${item.room_equipment_list.map(eq => `
                <div style="padding: 10px 12px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px;">
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <strong style="color: #e2e8f0; font-size: 0.88rem;">#${eq.id} ${escapeHtml(eq.name)}</strong>
                    <span class="text-dim text-xs" style="background: rgba(255,255,255,0.08); padding: 1px 6px; border-radius: 4px;">${escapeHtml(eq.category_name)}</span>
                  </div>
                  ${eq.employee_name ? `
                    <div style="font-size: 0.8rem; color: #93c5fd; margin-top: 4px; display: flex; align-items: center; gap: 4px;">
                      <i data-lucide="user" style="width: 12px; height: 12px;"></i> ${escapeHtml(eq.employee_name)}
                    </div>
                  ` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        `;
      } else {
        eqHtml = `
          <div style="margin-top: 20px; padding: 14px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.08); border-radius: 8px; text-align: center;">
            <span class="text-dim text-xs">U bazi trenutno nema evidentiranih računara ili štampača dodeljenih direktno ovoj kancelariji.</span>
          </div>
        `;
      }

      content.innerHTML = `
        <!-- Visual Connection Path Card -->
        <div style="padding: 18px; background: linear-gradient(135deg, rgba(15, 23, 42, 0.8), rgba(30, 41, 59, 0.8)); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 12px;">
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px;">
            
            <!-- Left End: Room / Wall Socket -->
            <div style="flex: 1; min-width: 220px; padding: 14px; background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 10px;">
              <div style="display: flex; align-items: center; gap: 8px; color: #fbbf24; font-weight: 700; margin-bottom: 6px;">
                <i data-lucide="door-open" style="width: 18px; height: 18px;"></i>
                <span>ZIDNA UTIČNICA #${item.wall_socket_no || '-'}</span>
              </div>
              <strong style="color: #f1f5f9; font-size: 1rem; display: block;">${escapeHtml(roomName)}</strong>
              <div class="text-dim text-xs" style="margin-top: 4px;">${escapeHtml([item.location_name, item.building_name].filter(Boolean).join(' &bull; '))}${item.room_floor !== null && item.room_floor !== undefined ? ` &bull; Sprat ${item.room_floor}` : ''}</div>
            </div>

            <!-- Middle Cable Bridge -->
            <div style="text-align: center; padding: 0 10px;">
              <div style="color: #38bdf8; font-size: 1.2rem; display: flex; align-items: center; gap: 6px;">
                <i data-lucide="arrow-left" style="width: 14px; height: 14px;"></i>
                <i data-lucide="cable" style="width: 20px; height: 20px;"></i>
                <i data-lucide="arrow-right" style="width: 14px; height: 14px;"></i>
              </div>
              <span class="text-dim text-xs" style="display: block; margin-top: 4px;">Kablovska Trasa</span>
            </div>

            <!-- Right End: Rack / Patch Panel -->
            <div style="flex: 1; min-width: 220px; padding: 14px; background: rgba(168, 85, 247, 0.08); border: 1px solid rgba(168, 85, 247, 0.28); border-radius: 10px;">
              <div style="display: flex; align-items: center; gap: 8px; color: #c084fc; font-weight: 700; margin-bottom: 6px;">
                <i data-lucide="layout-grid" style="width: 18px; height: 18px;"></i>
                <span>PATCH PORT: ${item.patch_panel_code ? escapeHtml(item.patch_panel_code) : '-'}</span>
              </div>
              <strong style="color: #f1f5f9; font-size: 1rem; display: block;">${escapeHtml(cvorName)}</strong>
              <div class="text-dim text-xs" style="margin-top: 4px;">${item.cvor_rack_dims ? `Orman: ${escapeHtml(item.cvor_rack_dims)}` : 'Rack orman / čvorište'}</div>
            </div>

          </div>

          <!-- Cable Route Description Detailed -->
          ${item.route_description ? `
            <div style="margin-top: 14px; padding: 12px; background: rgba(0,0,0,0.25); border-radius: 8px; border-left: 3px solid #38bdf8;">
              <span style="font-size: 0.78rem; text-transform: uppercase; color: #38bdf8; font-weight: 700; display: block; margin-bottom: 2px;">Trasa kabla</span>
              <p style="color: #e2e8f0; font-size: 0.88rem; line-height: 1.5; margin: 0;">${escapeHtml(item.route_description)}</p>
            </div>
          ` : ''}

          <!-- Line Position / Additional Notes -->
          ${item.description ? `
            <div style="margin-top: 8px; padding: 12px; background: rgba(0,0,0,0.2); border-radius: 8px; border-left: 3px solid #f59e0b;">
              <span style="font-size: 0.78rem; text-transform: uppercase; color: #fbbf24; font-weight: 700; display: block; margin-bottom: 2px;">Pozicija utičnice</span>
              <p style="color: #e2e8f0; font-size: 0.88rem; line-height: 1.5; margin: 0;">${escapeHtml(item.description)}</p>
            </div>
          ` : ''}
        </div>

        ${eqHtml}
      `;

      if (window.lucide) window.lucide.createIcons();
    } catch (err) {
      content.innerHTML = `
        <div style="text-align: center; padding: 30px; color: #ef4444;">
          <p>Greška pri dohvatanju detalja: ${escapeHtml(err.message)}</p>
        </div>
      `;
    }
  }

  function closeDetailsModal() {
    const modal = document.getElementById('modal-line-details');
    if (modal) modal.style.display = 'none';
  }

  /**
   * Opens Delete Confirmation Modal
   */
  function openDeleteModal(id) {
    const modal = document.getElementById('modal-line-delete');
    const nameEl = document.getElementById('line-delete-name');
    const metaEl = document.getElementById('line-delete-meta');

    if (!modal) return;

    state.deleteTargetId = id;
    const item = state.items.find(x => x.id === id);

    if (nameEl) nameEl.textContent = `Linija #${id}`;
    if (metaEl) {
      const socketStr = item?.wall_socket_no ? `Zidna utičnica #${item.wall_socket_no}` : 'Bez broja utičnice';
      const roomStr = item?.room_name || 'Nedefinisana soba';
      metaEl.textContent = `${socketStr} • ${roomStr}`;
    }

    modal.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons();
  }

  function closeDeleteModal() {
    const modal = document.getElementById('modal-line-delete');
    if (modal) modal.style.display = 'none';
    state.deleteTargetId = null;
  }

  /**
   * Confirms Deletion
   */
  async function handleConfirmDelete() {
    const id = state.deleteTargetId;
    if (!id) return;

    try {
      const res = await fetch(`/api/lines/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Greška pri brisanju');

      showToast(json.message || `Linija #${id} je uspešno obrisana`, 'success');
      closeDeleteModal();
      await Promise.all([loadStats(), fetchLines(state.currentPage)]);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  /**
   * Exports lines to Excel
   */
  function exportExcel() {
    const params = new URLSearchParams();
    if (state.searchQuery) params.set('search', state.searchQuery);
    if (state.selectedCvor) params.set('cvorId', state.selectedCvor);
    if (state.selectedRoom) params.set('roomId', state.selectedRoom);

    window.open(`/api/lines/export/excel?${params.toString()}`, '_blank');
  }

  /**
   * Fast sync trigger
   */
  async function triggerSyncCheck() {
    const icon = document.getElementById('icon-sync-lines-spin');
    if (icon) icon.classList.add('spin-animation');

    try {
      const res = await fetch('/api/equipment/sync-check');
      const json = await res.json();
      if (json.changed) {
        showToast('Uočene su promene na bazi - podaci su osveženi!', 'info');
        await Promise.all([loadStats(), fetchLines(state.currentPage)]);
      } else {
        showToast('Baza linija je u potpunosti usaglašena sa serverom 121.20', 'success');
      }
    } catch (err) {
      console.warn('[Lines] Sync error:', err);
    } finally {
      if (icon) icon.classList.remove('spin-animation');
    }
  }

  /**
   * Event Binding
   */
  function bindEvents() {
    // Search input with debounce
    let searchTimer = null;
    const searchInput = document.getElementById('search-lines');
    const clearSearchBtn = document.getElementById('btn-clear-search-lines');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const val = e.target.value;
        if (clearSearchBtn) clearSearchBtn.style.display = val ? 'block' : 'none';

        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          state.searchQuery = val.trim();
          fetchLines(1);
        }, 300);
      });
    }

    if (clearSearchBtn && searchInput) {
      clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearSearchBtn.style.display = 'none';
        state.searchQuery = '';
        fetchLines(1);
      });
    }

    // Filter Dropdowns
    const selectCvor = document.getElementById('select-lines-cvor');
    if (selectCvor) {
      selectCvor.addEventListener('change', (e) => {
        state.selectedCvor = e.target.value;
        fetchLines(1);
      });
    }

    const selectRoom = document.getElementById('select-lines-room');
    if (selectRoom) {
      selectRoom.addEventListener('change', (e) => {
        state.selectedRoom = e.target.value;
        fetchLines(1);
      });
    }

    // Reset Filters Button
    const btnReset = document.getElementById('btn-reset-lines-filters');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        if (clearSearchBtn) clearSearchBtn.style.display = 'none';
        if (selectCvor) selectCvor.value = '';
        if (selectRoom) selectRoom.value = '';

        state.searchQuery = '';
        state.selectedCvor = '';
        state.selectedRoom = '';
        state.activeKpiFilter = null;

        fetchLines(1);
      });
    }

    // Header buttons
    const btnAdd = document.getElementById('btn-add-line');
    if (btnAdd) btnAdd.addEventListener('click', () => openEditModal());

    const btnExport = document.getElementById('btn-export-lines-excel');
    if (btnExport) btnExport.addEventListener('click', exportExcel);

    const btnSync = document.getElementById('btn-sync-lines-status');
    if (btnSync) btnSync.addEventListener('click', triggerSyncCheck);

    // KPI Cards Click to Reset
    const cardTotal = document.getElementById('kpi-card-lines-total');
    if (cardTotal) {
      cardTotal.addEventListener('click', () => {
        if (btnReset) btnReset.click();
      });
    }

    // Edit Modal Buttons
    const formEdit = document.getElementById('form-line-edit');
    if (formEdit) formEdit.addEventListener('submit', handleSaveLine);

    const btnCloseModal = document.getElementById('btn-close-line-modal');
    if (btnCloseModal) btnCloseModal.addEventListener('click', closeEditModal);

    const btnCancelEdit = document.getElementById('btn-cancel-line-edit');
    if (btnCancelEdit) btnCancelEdit.addEventListener('click', closeEditModal);

    // Details Modal Buttons
    const btnCloseDetails = document.getElementById('btn-close-line-details-modal');
    if (btnCloseDetails) btnCloseDetails.addEventListener('click', closeDetailsModal);

    const btnCloseDetailsBottom = document.getElementById('btn-close-line-details-btn');
    if (btnCloseDetailsBottom) btnCloseDetailsBottom.addEventListener('click', closeDetailsModal);

    // Delete Modal Buttons
    const btnCloseDelete = document.getElementById('btn-close-line-delete-modal');
    if (btnCloseDelete) btnCloseDelete.addEventListener('click', closeDeleteModal);

    const btnCancelDelete = document.getElementById('btn-cancel-line-delete');
    if (btnCancelDelete) btnCancelDelete.addEventListener('click', closeDeleteModal);

    const btnConfirmDelete = document.getElementById('btn-confirm-line-delete');
    if (btnConfirmDelete) btnConfirmDelete.addEventListener('click', handleConfirmDelete);

    // Table Actions Delegation
    const tbody = document.getElementById('tbody-lines');
    if (tbody) {
      tbody.addEventListener('click', (e) => {
        const btnView = e.target.closest('.btn-view-line');
        if (btnView) {
          const id = parseInt(btnView.getAttribute('data-id'), 10);
          openDetailsModal(id);
          return;
        }

        const btnEdit = e.target.closest('.btn-edit-line');
        if (btnEdit) {
          const id = parseInt(btnEdit.getAttribute('data-id'), 10);
          openEditModal(id);
          return;
        }

        const btnDel = e.target.closest('.btn-delete-line');
        if (btnDel) {
          const id = parseInt(btnDel.getAttribute('data-id'), 10);
          openDeleteModal(id);
          return;
        }
      });
    }

    // Pagination Delegation
    const paginationControls = document.getElementById('lines-pagination-controls');
    if (paginationControls) {
      paginationControls.addEventListener('click', (e) => {
        const btn = e.target.closest('.pagination-btn');
        if (btn && !btn.classList.contains('disabled') && !btn.classList.contains('active')) {
          const page = parseInt(btn.getAttribute('data-page'), 10);
          if (page) fetchLines(page);
        }
      });
    }

    // Listen for SSE Events
    window.addEventListener('equipment-sse-event', (e) => {
      const eventType = e.detail?.type;
      if (['line_created', 'line_updated', 'line_deleted', 'legacy_sync'].includes(eventType)) {
        loadStats();
        fetchLines(state.currentPage);
      }
    });
  }

  // Export module globally
  window.linesModule = {
    init,
    fetchLines,
    loadStats,
    openEditModal,
    openDetailsModal,
    openDeleteModal,
    triggerSyncCheck
  };

})();
