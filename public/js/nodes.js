/**
 * ============================================================================
 * UNIPROMET IT ADMIN - MREŽNA ČVORIŠTA I RACK ORMANI MODULE (nodes.js)
 * ============================================================================
 * Manages network distribution nodes, rack cabinets, server rooms,
 * upstream-downstream trunk topology, connected hardware & lines,
 * and service maintenance history with real-time 2-way 121.20 sync.
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
    selectedCategory: '',
    selectedLocation: '',
    selectedBuilding: '',
    selectedStatus: '',
    sortBy: 'id',
    sortOrder: 'ASC',
    activeKpiFilter: null,
    stats: {
      total: 0,
      rackCabinets: 0,
      distributionNodes: 0,
      activeNodes: 0,
      totalConfiguredLines: 0
    },
    dictionaries: {
      locations: [],
      buildings: [],
      rooms: [],
      categories: [],
      statuses: []
    },
    allNodesList: [],
    isLoading: false,
    initialized: false,
    deleteTargetId: null,
    logsTargetNode: null,
    empSearchTimeout: null
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
   * Initializes the Nodes module
   */
  async function init() {
    if (!state.initialized) {
      bindEvents();
      state.initialized = true;
    }

    await Promise.all([
      loadDropdowns(),
      loadStats(),
      fetchNodes()
    ]);
  }

  /**
   * Fetches KPI summary statistics
   */
  async function loadStats() {
    try {
      const res = await fetch('/api/network-nodes/stats');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.success && json.data) {
        state.stats = json.data;
        renderStats();
      }
    } catch (err) {
      console.warn('[Nodes] Greška pri učitavanju statistike:', err);
    }
  }

  /**
   * Updates KPI Card numbers and Sidebar Badge
   */
  function renderStats() {
    const elTotal = document.getElementById('kpi-nodes-total');
    const elRacks = document.getElementById('kpi-nodes-racks');
    const elCvorovi = document.getElementById('kpi-nodes-cvorovi');
    const elActive = document.getElementById('kpi-nodes-active');
    const elLines = document.getElementById('kpi-nodes-lines');
    const elBadge = document.getElementById('badge-nav-nodes-total');

    if (elTotal) elTotal.textContent = state.stats.total ?? 0;
    if (elRacks) elRacks.textContent = state.stats.rackCabinets ?? 0;
    if (elCvorovi) elCvorovi.textContent = state.stats.distributionNodes ?? 0;
    if (elActive) elActive.textContent = state.stats.activeNodes ?? 0;
    if (elLines) elLines.textContent = state.stats.totalConfiguredLines ?? 0;
    if (elBadge) elBadge.textContent = state.stats.total ?? 0;
  }

  /**
   * Loads codebooks for locations, buildings, rooms, statuses, and parent nodes
   */
  async function loadDropdowns() {
    try {
      const res = await fetch('/api/network-nodes/dictionaries');
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          state.dictionaries = json.data;
          populateFilterDropdowns();
          populateModalDropdowns();
        }
      }

      // Load all nodes for parent/upstream dropdown
      const nodesRes = await fetch('/api/network-nodes?limit=500&sortBy=name&sortOrder=ASC');
      if (nodesRes.ok) {
        const json = await nodesRes.json();
        if (json.success && json.data) {
          state.allNodesList = json.data;
          populateParentNodesDropdown();
        }
      }
    } catch (err) {
      console.warn('[Nodes] Greška pri učitavanju šifarnika:', err);
    }
  }

  /**
   * Populates main filter toolbar select dropdowns
   */
  function populateFilterDropdowns() {
    // Location Filter
    const selLoc = document.getElementById('select-nodes-location');
    if (selLoc) {
      const cur = selLoc.value;
      selLoc.innerHTML = '<option value="">Sve Lokacije</option>';
      (state.dictionaries.locations || []).forEach(loc => {
        const opt = document.createElement('option');
        opt.value = loc.id;
        opt.textContent = loc.name;
        selLoc.appendChild(opt);
      });
      selLoc.value = cur;
    }

    // Building Filter
    const selBld = document.getElementById('select-nodes-building');
    if (selBld) {
      const cur = selBld.value;
      selBld.innerHTML = '<option value="">Svi Objekti</option>';
      (state.dictionaries.buildings || []).forEach(bld => {
        const opt = document.createElement('option');
        opt.value = bld.id;
        opt.textContent = bld.name;
        selBld.appendChild(opt);
      });
      selBld.value = cur;
    }

    // Status Filter
    const selSt = document.getElementById('select-nodes-status');
    if (selSt) {
      const cur = selSt.value;
      selSt.innerHTML = '<option value="">Svi Statusi</option>';
      (state.dictionaries.statuses || []).forEach(st => {
        const opt = document.createElement('option');
        opt.value = st.id;
        opt.textContent = st.name;
        selSt.appendChild(opt);
      });
      selSt.value = cur;
    }
  }

  /**
   * Populates Modal form dropdowns
   */
  function populateModalDropdowns() {
    const selLoc = document.getElementById('select-node-location');
    if (selLoc) {
      selLoc.innerHTML = '<option value="">-- Izaberite Lokaciju --</option>';
      (state.dictionaries.locations || []).forEach(loc => {
        const opt = document.createElement('option');
        opt.value = loc.id;
        opt.textContent = loc.name;
        selLoc.appendChild(opt);
      });
    }

    const selBld = document.getElementById('select-node-building');
    if (selBld) {
      selBld.innerHTML = '<option value="">-- Izaberite Objekat --</option>';
      (state.dictionaries.buildings || []).forEach(bld => {
        const opt = document.createElement('option');
        opt.value = bld.id;
        opt.textContent = bld.name;
        selBld.appendChild(opt);
      });
    }

    const selRoom = document.getElementById('select-node-room');
    if (selRoom) {
      selRoom.innerHTML = '<option value="">-- Izaberite Prostoriju --</option>';
      (state.dictionaries.rooms || []).forEach(rm => {
        const opt = document.createElement('option');
        opt.value = rm.id;
        opt.textContent = `${rm.name || 'Soba #' + rm.id} ${rm.floor ? '(' + rm.floor + ')' : ''}`;
        selRoom.appendChild(opt);
      });
    }

    const selStatus = document.getElementById('select-node-status');
    if (selStatus && state.dictionaries.statuses?.length > 0) {
      selStatus.innerHTML = '';
      state.dictionaries.statuses.forEach(st => {
        const opt = document.createElement('option');
        opt.value = st.id;
        opt.textContent = st.name;
        selStatus.appendChild(opt);
      });
      selStatus.value = '1';
    }
  }

  /**
   * Populates Parent / Upstream node dropdown in edit modal
   */
  function populateParentNodesDropdown(excludeId = null) {
    const selParent = document.getElementById('select-node-parent');
    if (!selParent) return;

    selParent.innerHTML = '<option value="">-- Glavno / Nema Nadređenog --</option>';
    (state.allNodesList || []).forEach(n => {
      if (excludeId && n.id === excludeId) return; // Prevent self-parenting
      const opt = document.createElement('option');
      opt.value = n.id;
      opt.textContent = `#${n.id} - ${n.name || 'Čvor #' + n.id} (${n.location_name || 'Lokacija b.b.'})`;
      selParent.appendChild(opt);
    });
  }

  /**
   * Fetches paginated & filtered list of network nodes
   */
  async function fetchNodes() {
    state.isLoading = true;
    renderTableLoading();

    try {
      const params = new URLSearchParams();
      params.set('page', state.currentPage);
      params.set('limit', state.pageSize);
      params.set('sortBy', state.sortBy);
      params.set('sortOrder', state.sortOrder);

      if (state.searchQuery.trim()) params.set('search', state.searchQuery.trim());
      if (state.selectedCategory) params.set('categoryId', state.selectedCategory);
      if (state.selectedLocation) params.set('locationId', state.selectedLocation);
      if (state.selectedBuilding) params.set('buildingId', state.selectedBuilding);
      if (state.selectedStatus) params.set('statusId', state.selectedStatus);

      // Handle KPI quick filter
      if (state.activeKpiFilter === 'racks') {
        params.set('categoryId', '33');
      } else if (state.activeKpiFilter === 'cvorovi') {
        params.set('categoryId', '16');
      } else if (state.activeKpiFilter === 'active') {
        params.set('statusId', '1');
      }

      const res = await fetch(`/api/network-nodes?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();
      if (json.success) {
        state.items = json.data || [];
        state.totalItems = json.pagination?.total || 0;
        state.totalPages = json.pagination?.totalPages || 1;
        renderTable();
        renderPagination();
      } else {
        renderTableError(json.error || 'Neuspešno učitavanje podataka.');
      }
    } catch (err) {
      console.error('[Nodes] Greška pri dohvatanju čvorišta:', err);
      renderTableError('Greška u komunikaciji sa serverom.');
    } finally {
      state.isLoading = false;
    }
  }

  /**
   * Renders table loading skeleton
   */
  function renderTableLoading() {
    const tbody = document.getElementById('tbody-nodes');
    if (!tbody) return;
    tbody.innerHTML = `
      <tr>
        <td colspan="11" style="text-align: center; padding: 40px; color: #94a3b8;">
          <div style="display: inline-flex; align-items: center; gap: 10px;">
            <i data-lucide="rotate-cw" class="spin" style="width: 20px; height: 20px; color: #a855f7;"></i>
            <span>Učitavanje mrežnih čvorišta i ormana...</span>
          </div>
        </td>
      </tr>
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  /**
   * Renders table error message
   */
  function renderTableError(msg) {
    const tbody = document.getElementById('tbody-nodes');
    if (!tbody) return;
    tbody.innerHTML = `
      <tr>
        <td colspan="11" style="text-align: center; padding: 36px; color: #f87171;">
          <i data-lucide="alert-triangle" style="width: 24px; height: 24px; margin-bottom: 8px;"></i>
          <div>${escapeHtml(msg)}</div>
          <button type="button" class="btn-dark-sm" onclick="window.nodesModule.refresh()" style="margin-top: 12px;">
            <i data-lucide="rotate-cw"></i>
            <span>Pokušaj ponovo</span>
          </button>
        </td>
      </tr>
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  /**
   * Renders main nodes table
   */
  function renderTable() {
    const tbody = document.getElementById('tbody-nodes');
    if (!tbody) return;

    if (state.items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="11" style="text-align: center; padding: 48px 20px; color: #94a3b8;">
            <div style="max-width: 420px; margin: 0 auto;">
              <i data-lucide="git-commit" style="width: 36px; height: 36px; color: #64748b; margin-bottom: 10px;"></i>
              <h5 style="color: #cbd5e1; font-size: 1.05rem; margin-bottom: 6px;">Nema pronađenih čvorišta</h5>
              <p class="text-dim text-xs" style="margin-bottom: 16px;">
                Nijedno čvorište ili rack orman ne odgovara zadatim parametrima pretrage i filtera.
              </p>
              <button type="button" class="btn-yellow-solid-sm" onclick="window.nodesModule.openCreateModal()">
                <i data-lucide="plus-circle"></i>
                <span>Dodaj Novo Čvorište</span>
              </button>
            </div>
          </td>
        </tr>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    let html = '';
    for (const item of state.items) {
      // Category Badge
      const isRack = item.category_id === 33 || (item.rack_dims && item.rack_dims.trim() !== '' && item.rack_dims.trim() !== 'NEMA');
      const catBadge = isRack
        ? `<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);"><i data-lucide="server" style="width: 12px; height: 12px;"></i> RACK ORMAN</span>`
        : `<span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3);"><i data-lucide="git-commit" style="width: 12px; height: 12px;"></i> ČVORIŠTE</span>`;

      // Status Badge
      let stBadge = `<span class="badge badge-success"><i data-lucide="check-circle-2" style="width: 11px; height: 11px;"></i> ${escapeHtml(item.status_name || 'ISPRAVNO')}</span>`;
      if (item.status_id === 2) {
        stBadge = `<span class="badge badge-info"><i data-lucide="clock" style="width: 11px; height: 11px;"></i> ${escapeHtml(item.status_name || 'REZERVA')}</span>`;
      } else if (item.status_id === 3) {
        stBadge = `<span class="badge badge-warning"><i data-lucide="wrench" style="width: 11px; height: 11px;"></i> ${escapeHtml(item.status_name || 'SERVIS')}</span>`;
      } else if (item.status_id === 4 || item.status_id === 5) {
        stBadge = `<span class="badge badge-danger"><i data-lucide="x-circle" style="width: 11px; height: 11px;"></i> ${escapeHtml(item.status_name || 'RASHOD')}</span>`;
      }

      // Location & Building
      const locText = item.location_name
        ? `<div style="display: flex; align-items: center; gap: 5px; font-weight: 500; color: #e2e8f0;"><i data-lucide="map-pin" style="width: 12px; height: 12px; color: #f59e0b;"></i> ${escapeHtml(item.location_name)}</div>`
        : '<span class="text-dim">-</span>';
      const bldText = item.building_name
        ? `<div class="text-dim text-xs" style="margin-top: 2px;">${escapeHtml(item.building_name)}</div>`
        : '';

      // Room
      const roomText = item.room_name
        ? `<div style="display: flex; align-items: center; gap: 5px; color: #cbd5e1;"><i data-lucide="door-open" style="width: 12px; height: 12px; color: #38bdf8;"></i> ${escapeHtml(item.room_name)} ${item.room_floor ? '<span class="text-dim text-xs">(' + escapeHtml(item.room_floor) + ')</span>' : ''}</div>`
        : '<span class="text-dim">-</span>';

      // Dimensions
      const rackDims = item.rack_dims && item.rack_dims.trim() && item.rack_dims.trim() !== 'NEMA'
        ? `<span class="badge" style="background: rgba(255, 255, 255, 0.06); color: #cbd5e1; border: 1px solid rgba(255, 255, 255, 0.12);"><i data-lucide="box" style="width: 11px; height: 11px; color: #fbbf24;"></i> ${escapeHtml(item.rack_dims)}</span>`
        : '<span class="text-dim">-</span>';

      // Lines count
      const linesBadge = item.lines_count || item.connected_lines_count
        ? `<span class="badge" style="background: rgba(251, 146, 60, 0.12); color: #fb923c; border: 1px solid rgba(251, 146, 60, 0.25);" title="${item.connected_lines_count || 0} vezanih linija u bazi"><i data-lucide="cable" style="width: 11px; height: 11px;"></i> ${item.lines_count || item.connected_lines_count} lin.</span>`
        : '<span class="text-dim text-xs">0 linija</span>';

      // Connected devices
      const devBadge = item.connected_devices_count && item.connected_devices_count > 0
        ? `<span class="badge" style="background: rgba(168, 85, 247, 0.14); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.28); font-weight: 600;"><i data-lucide="cpu" style="width: 11px; height: 11px;"></i> ${item.connected_devices_count} ur.</span>`
        : '<span class="text-dim text-xs">0 uređaja</span>';

      // Employee
      let empHtml = '<span class="text-dim">-</span>';
      if (item.employee_name) {
        empHtml = `
          <div style="display: flex; align-items: center; gap: 6px;">
            <div style="width: 22px; height: 22px; border-radius: 50%; background: rgba(59, 130, 246, 0.2); color: #60a5fa; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700;">
              ${escapeHtml(item.employee_name.charAt(0))}
            </div>
            <div>
              <div style="font-weight: 500; color: #e2e8f0; font-size: 0.85rem;">${escapeHtml(item.employee_name)}</div>
              ${item.employee_job ? `<div class="text-dim text-xs" style="font-size: 0.75rem;">${escapeHtml(item.employee_job)}</div>` : ''}
            </div>
          </div>
        `;
      } else if (item.employee_no) {
        empHtml = `<span class="badge" style="background: rgba(255, 255, 255, 0.05); color: #94a3b8;"><i data-lucide="user" style="width: 11px; height: 11px;"></i> ${escapeHtml(item.employee_no)}</span>`;
      }

      // Parent node uplink info
      const parentInfo = item.parent_node_name
        ? `<div class="text-dim text-xs" style="margin-top: 3px; display: flex; align-items: center; gap: 4px; color: #a78bfa;"><i data-lucide="corner-down-right" style="width: 11px; height: 11px;"></i> Uplink: ${escapeHtml(item.parent_node_name)}</div>`
        : '';

      html += `
        <tr data-id="${item.id}" class="node-table-row">
          <td style="font-weight: 700; color: #94a3b8; font-size: 0.85rem;">#${item.id}</td>
          <td style="text-align: center;">${catBadge}</td>
          <td>
            <div style="font-weight: 600; color: #f8fafc; font-size: 0.92rem;">
              ${escapeHtml(item.name || 'Čvor #' + item.id)}
            </div>
            ${item.inventory_no ? `<span class="text-dim text-xs" style="color: #cbd5e1;"><i data-lucide="tag" style="width: 10px; height: 10px; display: inline;"></i> ${escapeHtml(item.inventory_no)}</span>` : ''}
            ${parentInfo}
          </td>
          <td>
            ${locText}
            ${bldText}
          </td>
          <td>${roomText}</td>
          <td style="text-align: center;">${rackDims}</td>
          <td style="text-align: center;">${linesBadge}</td>
          <td style="text-align: center;">${devBadge}</td>
          <td>${empHtml}</td>
          <td style="text-align: center;">${stBadge}</td>
          <td style="text-align: right;">
            <div class="inv-actions-cell" style="justify-content: flex-end; gap: 4px;">
              <button type="button" class="btn-inv-action btn-web btn-view-node" data-id="${item.id}" title="Pregled detalja čvorišta i topologije">
                <i data-lucide="eye"></i>
              </button>
              <button type="button" class="btn-inv-action btn-edit-node" data-id="${item.id}" title="Izmeni čvorište">
                <i data-lucide="pencil"></i>
              </button>
              <button type="button" class="btn-inv-action btn-logs-node" data-id="${item.id}" title="Servisni logovi & održavanje" style="color: #38bdf8;">
                <i data-lucide="file-text"></i>
              </button>
              <button type="button" class="btn-inv-action btn-danger btn-inv-action-delete btn-delete-node" data-id="${item.id}" style="color: #f87171;" title="Obriši čvorište">
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
   * Renders pagination controls
   */
  function renderPagination() {
    const counter = document.getElementById('nodes-counter-text');
    const controls = document.getElementById('nodes-pagination-controls');
    if (!counter || !controls) return;

    const start = state.totalItems > 0 ? (state.currentPage - 1) * state.pageSize + 1 : 0;
    const end = Math.min(state.currentPage * state.pageSize, state.totalItems);
    counter.textContent = `Prikazano: ${start} - ${end} od ${state.totalItems} čvorišta`;

    if (state.totalPages <= 1) {
      controls.innerHTML = '';
      return;
    }

    let pBtns = '';
    pBtns += `
      <button type="button" class="btn-dark-sm ${state.currentPage === 1 ? 'disabled' : ''}" id="btn-nodes-prev" style="padding: 4px 10px;" ${state.currentPage === 1 ? 'disabled' : ''}>
        <i data-lucide="chevron-left"></i>
      </button>
    `;

    const maxVisible = 5;
    let startP = Math.max(1, state.currentPage - Math.floor(maxVisible / 2));
    let endP = Math.min(state.totalPages, startP + maxVisible - 1);
    if (endP - startP < maxVisible - 1) {
      startP = Math.max(1, endP - maxVisible + 1);
    }

    for (let p = startP; p <= endP; p++) {
      pBtns += `
        <button type="button" class="btn-dark-sm btn-node-page ${p === state.currentPage ? 'active' : ''}" data-page="${p}" style="min-width: 32px; padding: 4px 8px; ${p === state.currentPage ? 'background: #8b5cf6; border-color: #a855f7; color: #fff; font-weight: 700;' : ''}">
          ${p}
        </button>
      `;
    }

    pBtns += `
      <button type="button" class="btn-dark-sm ${state.currentPage === state.totalPages ? 'disabled' : ''}" id="btn-nodes-next" style="padding: 4px 10px;" ${state.currentPage === state.totalPages ? 'disabled' : ''}>
        <i data-lucide="chevron-right"></i>
      </button>
    `;

    controls.innerHTML = pBtns;
    if (window.lucide) window.lucide.createIcons();
  }

  /**
   * Binds all DOM event listeners
   */
  function bindEvents() {
    // Search input with debounce
    const searchInp = document.getElementById('search-nodes');
    const btnClearSearch = document.getElementById('btn-clear-search-nodes');

    if (searchInp) {
      let debounceTimer = null;
      searchInp.addEventListener('input', (e) => {
        const val = e.target.value;
        if (btnClearSearch) btnClearSearch.style.display = val ? 'block' : 'none';
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          state.searchQuery = val;
          state.currentPage = 1;
          updateResetButtonVisibility();
          fetchNodes();
        }, 300);
      });
    }

    if (btnClearSearch) {
      btnClearSearch.addEventListener('click', () => {
        if (searchInp) searchInp.value = '';
        btnClearSearch.style.display = 'none';
        state.searchQuery = '';
        state.currentPage = 1;
        updateResetButtonVisibility();
        fetchNodes();
      });
    }

    // Filter Dropdowns
    const selCat = document.getElementById('select-nodes-category');
    if (selCat) {
      selCat.addEventListener('change', (e) => {
        state.selectedCategory = e.target.value;
        state.activeKpiFilter = null;
        state.currentPage = 1;
        updateResetButtonVisibility();
        fetchNodes();
      });
    }

    const selLoc = document.getElementById('select-nodes-location');
    if (selLoc) {
      selLoc.addEventListener('change', (e) => {
        state.selectedLocation = e.target.value;
        state.currentPage = 1;
        updateResetButtonVisibility();
        fetchNodes();
      });
    }

    const selBld = document.getElementById('select-nodes-building');
    if (selBld) {
      selBld.addEventListener('change', (e) => {
        state.selectedBuilding = e.target.value;
        state.currentPage = 1;
        updateResetButtonVisibility();
        fetchNodes();
      });
    }

    const selSt = document.getElementById('select-nodes-status');
    if (selSt) {
      selSt.addEventListener('change', (e) => {
        state.selectedStatus = e.target.value;
        state.currentPage = 1;
        updateResetButtonVisibility();
        fetchNodes();
      });
    }

    // Reset Filters Button
    const btnReset = document.getElementById('btn-reset-nodes-filters');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        resetAllFilters();
      });
    }

    // KPI Cards interactive filters
    const kpiTotal = document.getElementById('kpi-card-nodes-total');
    if (kpiTotal) {
      kpiTotal.addEventListener('click', () => {
        resetAllFilters();
      });
    }

    const kpiRacks = document.getElementById('kpi-card-nodes-racks');
    if (kpiRacks) {
      kpiRacks.addEventListener('click', () => {
        state.activeKpiFilter = state.activeKpiFilter === 'racks' ? null : 'racks';
        state.selectedCategory = state.activeKpiFilter === 'racks' ? '33' : '';
        if (selCat) selCat.value = state.selectedCategory;
        state.currentPage = 1;
        updateResetButtonVisibility();
        fetchNodes();
      });
    }

    const kpiCvor = document.getElementById('kpi-card-nodes-cvorovi');
    if (kpiCvor) {
      kpiCvor.addEventListener('click', () => {
        state.activeKpiFilter = state.activeKpiFilter === 'cvorovi' ? null : 'cvorovi';
        state.selectedCategory = state.activeKpiFilter === 'cvorovi' ? '16' : '';
        if (selCat) selCat.value = state.selectedCategory;
        state.currentPage = 1;
        updateResetButtonVisibility();
        fetchNodes();
      });
    }

    const kpiActive = document.getElementById('kpi-card-nodes-active');
    if (kpiActive) {
      kpiActive.addEventListener('click', () => {
        state.activeKpiFilter = state.activeKpiFilter === 'active' ? null : 'active';
        state.selectedStatus = state.activeKpiFilter === 'active' ? '1' : '';
        if (selSt) selSt.value = state.selectedStatus;
        state.currentPage = 1;
        updateResetButtonVisibility();
        fetchNodes();
      });
    }

    const kpiLines = document.getElementById('kpi-card-nodes-lines');
    if (kpiLines) {
      kpiLines.addEventListener('click', () => {
        // Navigate to lines tab
        const linesTabBtn = document.getElementById('nav-btn-equipment-lines');
        if (linesTabBtn) linesTabBtn.click();
      });
    }

    // Table sorting header click delegation
    const thead = document.querySelector('#table-nodes thead');
    if (thead) {
      thead.addEventListener('click', (e) => {
        const th = e.target.closest('th');
        if (!th) return;
        const text = th.textContent.trim().toUpperCase();
        if (text.includes('ID')) toggleSort('id');
        else if (text.includes('NAZIV')) toggleSort('name');
        else if (text.includes('LOKACIJA')) toggleSort('location_name');
        else if (text.includes('PROSTORIJA')) toggleSort('room_name');
        else if (text.includes('LINIJE')) toggleSort('lines_count');
        else if (text.includes('STATUS')) toggleSort('status_id');
      });
    }

    // Pagination events delegation
    const pagContainer = document.getElementById('nodes-pagination-controls');
    if (pagContainer) {
      pagContainer.addEventListener('click', (e) => {
        const btnPrev = e.target.closest('#btn-nodes-prev');
        if (btnPrev && state.currentPage > 1) {
          state.currentPage--;
          fetchNodes();
          return;
        }

        const btnNext = e.target.closest('#btn-nodes-next');
        if (btnNext && state.currentPage < state.totalPages) {
          state.currentPage++;
          fetchNodes();
          return;
        }

        const btnPage = e.target.closest('.btn-node-page');
        if (btnPage) {
          const p = parseInt(btnPage.getAttribute('data-page'), 10);
          if (p && p !== state.currentPage) {
            state.currentPage = p;
            fetchNodes();
          }
        }
      });
    }

    // Table Actions Delegation
    const tbody = document.getElementById('tbody-nodes');
    if (tbody) {
      tbody.addEventListener('click', (e) => {
        const btnView = e.target.closest('.btn-view-node');
        if (btnView) {
          const id = parseInt(btnView.getAttribute('data-id'), 10);
          openDetailsModal(id);
          return;
        }

        const btnEdit = e.target.closest('.btn-edit-node');
        if (btnEdit) {
          const id = parseInt(btnEdit.getAttribute('data-id'), 10);
          openEditModal(id);
          return;
        }

        const btnLogs = e.target.closest('.btn-logs-node');
        if (btnLogs) {
          const id = parseInt(btnLogs.getAttribute('data-id'), 10);
          openLogsModal(id);
          return;
        }

        const btnDelete = e.target.closest('.btn-delete-node');
        if (btnDelete) {
          const id = parseInt(btnDelete.getAttribute('data-id'), 10);
          openDeleteModal(id);
          return;
        }
      });
    }

    // Top action buttons
    const btnAdd = document.getElementById('btn-add-node');
    if (btnAdd) {
      btnAdd.addEventListener('click', () => {
        openCreateModal();
      });
    }

    const btnSync = document.getElementById('btn-sync-nodes-status');
    if (btnSync) {
      btnSync.addEventListener('click', async () => {
        const icon = document.getElementById('icon-sync-nodes-spin');
        if (icon) icon.classList.add('spin');
        await Promise.all([loadStats(), fetchNodes()]);
        setTimeout(() => {
          if (icon) icon.classList.remove('spin');
          showToast('Podaci o čvorištima su ažurirani', 'success');
        }, 400);
      });
    }

    const btnExport = document.getElementById('btn-export-nodes-excel');
    if (btnExport) {
      btnExport.addEventListener('click', () => {
        exportExcel();
      });
    }

    // Modal close buttons
    bindModalEvents();

    // Navision HR Autocomplete
    bindNavisionAutocomplete();

    // Edit Form Submit
    const formEdit = document.getElementById('form-node-edit');
    if (formEdit) {
      formEdit.addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleFormSubmit();
      });
    }

    // Delete Confirmation Submit
    const btnConfirmDelete = document.getElementById('btn-confirm-node-delete');
    if (btnConfirmDelete) {
      btnConfirmDelete.addEventListener('click', async () => {
        await handleConfirmDelete();
      });
    }

    // Log Form Submit
    const formLog = document.getElementById('form-node-log-add');
    if (formLog) {
      formLog.addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleAddLog();
      });
    }

    // Realtime SSE Event Listener
    setupSSEListener();
  }

  /**
   * Helper to toggle table sorting
   */
  function toggleSort(col) {
    if (state.sortBy === col) {
      state.sortOrder = state.sortOrder === 'ASC' ? 'DESC' : 'ASC';
    } else {
      state.sortBy = col;
      state.sortOrder = 'ASC';
    }
    fetchNodes();
  }

  /**
   * Helper to reset all search queries and active filters
   */
  function resetAllFilters() {
    state.searchQuery = '';
    state.selectedCategory = '';
    state.selectedLocation = '';
    state.selectedBuilding = '';
    state.selectedStatus = '';
    state.activeKpiFilter = null;
    state.currentPage = 1;

    const searchInp = document.getElementById('search-nodes');
    const btnClearSearch = document.getElementById('btn-clear-search-nodes');
    const selCat = document.getElementById('select-nodes-category');
    const selLoc = document.getElementById('select-nodes-location');
    const selBld = document.getElementById('select-nodes-building');
    const selSt = document.getElementById('select-nodes-status');

    if (searchInp) searchInp.value = '';
    if (btnClearSearch) btnClearSearch.style.display = 'none';
    if (selCat) selCat.value = '';
    if (selLoc) selLoc.value = '';
    if (selBld) selBld.value = '';
    if (selSt) selSt.value = '';

    updateResetButtonVisibility();
    fetchNodes();
  }

  /**
   * Updates Reset button visibility
   */
  function updateResetButtonVisibility() {
    const btn = document.getElementById('btn-reset-nodes-filters');
    if (!btn) return;
    const hasFilter = !!(
      state.searchQuery.trim() ||
      state.selectedCategory ||
      state.selectedLocation ||
      state.selectedBuilding ||
      state.selectedStatus ||
      state.activeKpiFilter
    );
    btn.style.display = hasFilter ? 'inline-flex' : 'none';
  }

  /**
   * Binds close buttons for all node modals
   */
  function bindModalEvents() {
    // Edit Modal Close
    ['btn-close-node-modal', 'btn-cancel-node-edit'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener('click', () => {
          const m = document.getElementById('modal-node-edit');
          if (m) m.style.display = 'none';
        });
      }
    });

    // Details Modal Close
    ['btn-close-node-details-modal', 'btn-close-node-details-btn'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener('click', () => {
          const m = document.getElementById('modal-node-details');
          if (m) m.style.display = 'none';
        });
      }
    });

    // Logs Modal Close
    ['btn-close-node-logs-modal', 'btn-close-node-logs-btn'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener('click', () => {
          const m = document.getElementById('modal-node-logs');
          if (m) m.style.display = 'none';
        });
      }
    });

    // Delete Modal Close
    ['btn-close-node-delete-modal', 'btn-cancel-node-delete'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener('click', () => {
          const m = document.getElementById('modal-node-delete');
          if (m) m.style.display = 'none';
        });
      }
    });
  }

  /**
   * Binds Navision HR employee autocomplete in edit modal
   */
  function bindNavisionAutocomplete() {
    const searchInput = document.getElementById('input-node-employee-search');
    const employeeNoInput = document.getElementById('input-node-employee-no');
    const autoList = document.getElementById('node-employee-autocomplete-list');
    const selectedCard = document.getElementById('node-employee-selected-card');
    const btnClear = document.getElementById('btn-clear-node-employee');

    if (searchInput && autoList) {
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        clearTimeout(state.empSearchTimeout);

        if (query.length < 2) {
          autoList.style.display = 'none';
          autoList.innerHTML = '';
          return;
        }

        state.empSearchTimeout = setTimeout(async () => {
          try {
            const res = await fetch(`/api/equipment/employees/search?q=${encodeURIComponent(query)}`);
            if (!res.ok) return;
            const data = await res.json();
            const employees = data.employees || [];

            if (employees.length === 0) {
              autoList.innerHTML = `<div class="emp-auto-item text-dim text-xs" style="padding: 10px;">Nema rezultata za "${escapeHtml(query)}"</div>`;
              autoList.style.display = 'block';
              return;
            }

            let itemsHtml = '';
            employees.forEach(emp => {
              itemsHtml += `
                <div class="emp-auto-item" data-no="${escapeHtml(emp.no)}" data-name="${escapeHtml(emp.full_name)}" data-job="${escapeHtml(emp.job_title || '')}" style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid rgba(255, 255, 255, 0.05); display: flex; align-items: center; justify-content: space-between;">
                  <div>
                    <strong style="color: #f8fafc; font-size: 0.88rem;">${escapeHtml(emp.full_name)}</strong>
                    <div class="text-dim text-xs">${escapeHtml(emp.job_title || 'Nije specificirano')} &bull; ${escapeHtml(emp.department || '')}</div>
                  </div>
                  <span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; font-size: 0.75rem;">${escapeHtml(emp.no)}</span>
                </div>
              `;
            });

            autoList.innerHTML = itemsHtml;
            autoList.style.display = 'block';

            // Click delegation for suggestion items
            autoList.querySelectorAll('.emp-auto-item').forEach(itemEl => {
              itemEl.addEventListener('click', () => {
                const no = itemEl.getAttribute('data-no');
                const name = itemEl.getAttribute('data-name');
                const job = itemEl.getAttribute('data-job');
                selectEmployee(no, name, job);
              });
            });
          } catch (err) {
            console.warn('[Nodes] Autocomplete error:', err);
          }
        }, 250);
      });

      // Close autocomplete on outside click
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#modal-node-edit')) {
          autoList.style.display = 'none';
        }
      });
    }

    if (btnClear) {
      btnClear.addEventListener('click', () => {
        clearEmployeeSelection();
      });
    }
  }

  /**
   * Sets selected employee state in modal form
   */
  function selectEmployee(no, name, job) {
    const searchInput = document.getElementById('input-node-employee-search');
    const employeeNoInput = document.getElementById('input-node-employee-no');
    const autoList = document.getElementById('node-employee-autocomplete-list');
    const selectedCard = document.getElementById('node-employee-selected-card');
    const selectedName = document.getElementById('node-employee-selected-name');
    const selectedJob = document.getElementById('node-employee-selected-job');

    if (employeeNoInput) employeeNoInput.value = no || '';
    if (selectedName) selectedName.textContent = `${name || no} (${no})`;
    if (selectedJob) selectedJob.textContent = job ? `• ${job}` : '';
    if (selectedCard) selectedCard.style.display = 'flex';
    if (searchInput) searchInput.value = '';
    if (autoList) {
      autoList.style.display = 'none';
      autoList.innerHTML = '';
    }
  }

  /**
   * Clears selected employee in modal form
   */
  function clearEmployeeSelection() {
    const employeeNoInput = document.getElementById('input-node-employee-no');
    const selectedCard = document.getElementById('node-employee-selected-card');
    const searchInput = document.getElementById('input-node-employee-search');

    if (employeeNoInput) employeeNoInput.value = '';
    if (selectedCard) selectedCard.style.display = 'none';
    if (searchInput) searchInput.value = '';
  }

  /**
   * Opens modal to create a new node
   */
  function openCreateModal() {
    const modal = document.getElementById('modal-node-edit');
    if (!modal) return;

    document.getElementById('modal-node-title').textContent = 'Novo Mrežno Čvorište';
    document.getElementById('modal-node-subtitle').textContent = 'Unos rack ormana, optičkog čvorišta ili spratnog razdelnika';
    document.getElementById('input-node-id').value = '';

    // Reset Form
    document.getElementById('input-node-name').value = '';
    document.getElementById('select-node-category').value = '16';
    document.getElementById('select-node-status').value = '1';
    document.getElementById('select-node-location').value = '';
    document.getElementById('select-node-building').value = '';
    document.getElementById('select-node-room').value = '';
    document.getElementById('input-node-rack-dims').value = '';
    document.getElementById('input-node-lines-count').value = '';
    document.getElementById('input-node-inventory-no').value = '';
    document.getElementById('input-node-route-desc').value = '';
    document.getElementById('input-node-comment').value = '';
    document.getElementById('input-node-desc').value = '';
    document.getElementById('input-node-date-purchased').value = '';
    document.getElementById('input-node-date-arrived').value = '';

    populateParentNodesDropdown();
    clearEmployeeSelection();

    modal.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons();
    setTimeout(() => document.getElementById('input-node-name')?.focus(), 100);
  }

  /**
   * Opens modal to edit an existing node
   */
  async function openEditModal(id) {
    const modal = document.getElementById('modal-node-edit');
    if (!modal) return;

    try {
      const res = await fetch(`/api/network-nodes/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.success || !json.data) throw new Error(json.error || 'Podaci nisu pronađeni');

      const data = json.data;

      document.getElementById('modal-node-title').textContent = `Izmena Čvorišta #${data.id}`;
      document.getElementById('modal-node-subtitle').textContent = data.name || `Čvor #${data.id}`;
      document.getElementById('input-node-id').value = data.id;

      document.getElementById('input-node-name').value = data.name || '';
      document.getElementById('select-node-category').value = String(data.category_id || 16);
      document.getElementById('select-node-status').value = String(data.status_id || 1);
      document.getElementById('select-node-location').value = data.location_id ? String(data.location_id) : '';
      document.getElementById('select-node-building').value = data.building_id ? String(data.building_id) : '';
      document.getElementById('select-node-room').value = data.room_id ? String(data.room_id) : '';
      document.getElementById('input-node-rack-dims').value = data.rack_dims || '';
      document.getElementById('input-node-lines-count').value = data.lines_count !== null && data.lines_count !== undefined ? data.lines_count : '';
      document.getElementById('input-node-inventory-no').value = data.inventory_no || '';
      document.getElementById('input-node-route-desc').value = data.route_desc || '';
      document.getElementById('input-node-comment').value = data.comment || '';
      document.getElementById('input-node-desc').value = data.description || '';
      document.getElementById('input-node-date-purchased').value = data.date_purchased ? data.date_purchased.split('T')[0] : '';
      document.getElementById('input-node-date-arrived').value = data.date_arrived ? data.date_arrived.split('T')[0] : '';

      populateParentNodesDropdown(data.id);
      const selParent = document.getElementById('select-node-parent');
      if (selParent) selParent.value = data.custom_code ? String(data.custom_code) : '';

      if (data.employee_no) {
        selectEmployee(data.employee_no, data.employee_name || data.employee_no, data.employee_job || '');
      } else {
        clearEmployeeSelection();
      }

      modal.style.display = 'flex';
      if (window.lucide) window.lucide.createIcons();
    } catch (err) {
      showToast(`Greška pri otvaranju čvorišta: ${err.message}`, 'error');
    }
  }

  /**
   * Handles edit/create form submission with dual-write
   */
  async function handleFormSubmit() {
    const id = document.getElementById('input-node-id').value;
    const name = document.getElementById('input-node-name').value.trim();
    const category_id = parseInt(document.getElementById('select-node-category').value, 10);
    const status_id = parseInt(document.getElementById('select-node-status').value, 10);
    const location_id = document.getElementById('select-node-location').value ? parseInt(document.getElementById('select-node-location').value, 10) : null;
    const building_id = document.getElementById('select-node-building').value ? parseInt(document.getElementById('select-node-building').value, 10) : null;
    const room_id = document.getElementById('select-node-room').value ? parseInt(document.getElementById('select-node-room').value, 10) : null;
    const custom_code = document.getElementById('select-node-parent').value ? parseInt(document.getElementById('select-node-parent').value, 10) : null;
    const rack_dims = document.getElementById('input-node-rack-dims').value.trim() || null;
    const lines_count = document.getElementById('input-node-lines-count').value !== '' ? parseInt(document.getElementById('input-node-lines-count').value, 10) : null;
    const inventory_no = document.getElementById('input-node-inventory-no').value.trim() || null;
    const employee_no = document.getElementById('input-node-employee-no').value.trim() || null;
    const route_desc = document.getElementById('input-node-route-desc').value.trim() || null;
    const comment = document.getElementById('input-node-comment').value.trim() || null;
    const description = document.getElementById('input-node-desc').value.trim() || null;
    const date_purchased = document.getElementById('input-node-date-purchased').value || null;
    const date_arrived = document.getElementById('input-node-date-arrived').value || null;

    if (!name) {
      showToast('Naziv / Identifikator čvorišta je obavezan', 'error');
      return;
    }

    const payload = {
      name,
      category_id,
      status_id,
      location_id,
      building_id,
      room_id,
      custom_code,
      rack_dims,
      lines_count,
      inventory_no,
      employee_no,
      route_desc,
      comment,
      description,
      date_purchased,
      date_arrived
    };

    const isEdit = !!id;
    const url = isEdit ? `/api/network-nodes/${id}` : '/api/network-nodes';
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Čuvanje nije uspelo');

      showToast(isEdit ? 'Čvorište je uspešno ažurirano' : 'Novo čvorište je uspešno dodato', 'success');
      document.getElementById('modal-node-edit').style.display = 'none';

      await Promise.all([loadStats(), fetchNodes(), loadDropdowns()]);
    } catch (err) {
      showToast(`Greška pri čuvanju: ${err.message}`, 'error');
    }
  }

  /**
   * Opens Node Details modal with rack topology, connected devices and lines
   */
  async function openDetailsModal(id) {
    const modal = document.getElementById('modal-node-details');
    const container = document.getElementById('node-details-content');
    if (!modal || !container) return;

    container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #94a3b8;">
        <i data-lucide="rotate-cw" class="spin" style="width: 24px; height: 24px; color: #c084fc;"></i>
        <div style="margin-top: 10px;">Učitavanje detalja i topologije čvorišta...</div>
      </div>
    `;
    modal.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons();

    try {
      const res = await fetch(`/api/network-nodes/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.success || !json.data) throw new Error(json.error || 'Nije moguće učitati čvorište');

      const d = json.data;

      document.getElementById('node-details-title').textContent = d.name || `Čvorište #${d.id}`;
      document.getElementById('node-details-subtitle').textContent = `ID #${d.id} • ${d.category_name || 'ČVORIŠTE'} • ${d.location_name || 'Lokacija b.b.'}`;

      // Connected hardware list
      let devListHtml = '';
      if (d.connected_devices_list && d.connected_devices_list.length > 0) {
        devListHtml = d.connected_devices_list.map(dev => `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 6px; margin-bottom: 6px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <i data-lucide="cpu" style="width: 14px; height: 14px; color: #a78bfa;"></i>
              <strong style="color: #f1f5f9; font-size: 0.88rem;">${escapeHtml(dev.name)}</strong>
              <span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; font-size: 0.72rem;">${escapeHtml(dev.category_name || 'UREĐAJ')}</span>
            </div>
            <span class="badge badge-success" style="font-size: 0.72rem;">${escapeHtml(dev.status_name || 'ISPRAVNO')}</span>
          </div>
        `).join('');
      } else {
        devListHtml = `<div class="text-dim text-xs" style="padding: 10px; text-align: center;">Nema vezanih uređaja u ovom ormanu.</div>`;
      }

      // Connected lines list
      let linesListHtml = '';
      if (d.connected_lines_list && d.connected_lines_list.length > 0) {
        linesListHtml = d.connected_lines_list.map(l => `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 6px; margin-bottom: 6px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="badge" style="background: rgba(251, 146, 60, 0.15); color: #fb923c; font-weight: 700; font-size: 0.75rem;">Utičnica #${l.wall_socket_no || l.id}</span>
              ${l.patch_panel_code ? `<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-size: 0.75rem;">Patch: ${escapeHtml(l.patch_panel_code)}</span>` : ''}
              <span style="color: #cbd5e1; font-size: 0.85rem;">${escapeHtml(l.room_name || 'Kancelarija')} ${l.building_name ? '(' + escapeHtml(l.building_name) + ')' : ''}</span>
            </div>
            <span class="text-dim text-xs">ID #${l.id}</span>
          </div>
        `).join('');
      } else {
        linesListHtml = `<div class="text-dim text-xs" style="padding: 10px; text-align: center;">Nema definisanih linija vezanih za ovaj čvor.</div>`;
      }

      // Service History
      let historyHtml = '';
      if (d.history && d.history.length > 0) {
        historyHtml = d.history.map(h => `
          <div style="padding: 10px 12px; background: rgba(255, 255, 255, 0.02); border-left: 3px solid #38bdf8; border-radius: 0 6px 6px 0; margin-bottom: 8px;">
            <div style="display: flex; justify-content: space-between; color: #94a3b8; font-size: 0.78rem; margin-bottom: 4px;">
              <span><i data-lucide="calendar" style="width: 11px; height: 11px; display: inline;"></i> ${h.date ? new Date(h.date).toLocaleDateString('sr-RS') : '-'}</span>
              ${h.phone ? `<span><i data-lucide="phone" style="width: 11px; height: 11px; display: inline;"></i> ${escapeHtml(h.phone)}</span>` : ''}
            </div>
            <div style="color: #e2e8f0; font-size: 0.88rem; line-height: 1.4;">${escapeHtml(h.note)}</div>
          </div>
        `).join('');
      } else {
        historyHtml = `<div class="text-dim text-xs" style="padding: 10px; text-align: center;">Nema unetih servisnih zabeleški.</div>`;
      }

      container.innerHTML = `
        <!-- Top Metrics Cards -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px;">
          <div style="padding: 12px; background: rgba(168, 85, 247, 0.08); border: 1px solid rgba(168, 85, 247, 0.2); border-radius: 8px;">
            <span class="text-dim text-xs">KATEGORIJA</span>
            <div style="font-weight: 700; color: #c084fc; font-size: 1.05rem; margin-top: 4px;">${escapeHtml(d.category_name || 'ČVORIŠTE')}</div>
          </div>

          <div style="padding: 12px; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 8px;">
            <span class="text-dim text-xs">DIMENZIJE ORMANA</span>
            <div style="font-weight: 700; color: #38bdf8; font-size: 1.05rem; margin-top: 4px;">${escapeHtml(d.rack_dims || 'Nije specificirano')}</div>
          </div>

          <div style="padding: 12px; background: rgba(251, 146, 60, 0.08); border: 1px solid rgba(251, 146, 60, 0.2); border-radius: 8px;">
            <span class="text-dim text-xs">IZVEDENE LINIJE</span>
            <div style="font-weight: 700; color: #fb923c; font-size: 1.05rem; margin-top: 4px;">${d.lines_count || d.connected_lines_count || 0} linija</div>
          </div>

          <div style="padding: 12px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 8px;">
            <span class="text-dim text-xs">STATUS</span>
            <div style="font-weight: 700; color: #34d399; font-size: 1.05rem; margin-top: 4px;">${escapeHtml(d.status_name || 'ISPRAVNO')}</div>
          </div>
        </div>

        <!-- Location & Navision Employee Info -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 20px;">
          <!-- Lokacija Card -->
          <div style="padding: 14px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px;">
            <h5 style="color: #f59e0b; font-size: 0.9rem; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
              <i data-lucide="map-pin" style="width: 14px; height: 14px;"></i>
              Lokacija & Smeštaj
            </h5>
            <div style="display: flex; flex-direction: column; gap: 6px; font-size: 0.88rem;">
              <div><strong style="color: #94a3b8;">Lokacija:</strong> <span style="color: #e2e8f0;">${escapeHtml(d.location_name || '-')}</span></div>
              <div><strong style="color: #94a3b8;">Objekat / Hala:</strong> <span style="color: #e2e8f0;">${escapeHtml(d.building_name || '-')}</span></div>
              <div><strong style="color: #94a3b8;">Prostorija:</strong> <span style="color: #e2e8f0;">${escapeHtml(d.room_name || '-')} ${d.room_floor ? '(' + escapeHtml(d.room_floor) + ')' : ''}</span></div>
              ${d.parent_node_name ? `<div><strong style="color: #94a3b8;">Nadređeni Trunk:</strong> <span style="color: #a78bfa;">${escapeHtml(d.parent_node_name)}</span></div>` : ''}
            </div>
          </div>

          <!-- Navision HR Zaduženje Card -->
          <div style="padding: 14px; background: rgba(59, 130, 246, 0.04); border: 1px solid rgba(59, 130, 246, 0.18); border-radius: 8px;">
            <h5 style="color: #60a5fa; font-size: 0.9rem; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
              <i data-lucide="badge-check" style="width: 14px; height: 14px;"></i>
              Zaduženo Lice (Navision HR)
            </h5>
            ${d.employee_name ? `
              <div style="font-size: 0.88rem;">
                <div style="font-weight: 700; color: #93c5fd; font-size: 0.95rem;">${escapeHtml(d.employee_name)}</div>
                <div class="text-dim text-xs" style="margin-top: 2px;">${escapeHtml(d.employee_job || 'Radno mesto nije uneto')}</div>
                <div class="text-dim text-xs" style="margin-top: 2px;">Sektor: ${escapeHtml(d.employee_dept || '-')}</div>
                <div style="margin-top: 6px;"><span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #93c5fd;">Šifra: ${escapeHtml(d.employee_no || '')}</span></div>
              </div>
            ` : `<div class="text-dim text-xs">Nema zaduženog lica za ovaj orman.</div>`}
          </div>
        </div>

        <!-- Trasa Optike & Komentar -->
        ${(d.route_desc || d.comment || d.description) ? `
          <div style="margin-bottom: 20px; padding: 14px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px;">
            <h5 style="color: #cbd5e1; font-size: 0.9rem; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
              <i data-lucide="milestone" style="width: 14px; height: 14px; color: #fb923c;"></i>
              Opis Trase Optike i Infrastrukture
            </h5>
            ${d.route_desc ? `<div style="font-size: 0.88rem; color: #e2e8f0; margin-bottom: 6px; line-height: 1.4;">${escapeHtml(d.route_desc)}</div>` : ''}
            ${d.description ? `<div class="text-dim text-xs" style="margin-top: 6px;"><strong>Specifikacija:</strong> ${escapeHtml(d.description)}</div>` : ''}
            ${d.comment ? `<div class="text-dim text-xs" style="margin-top: 4px;"><strong>Napomena:</strong> ${escapeHtml(d.comment)}</div>` : ''}
          </div>
        ` : ''}

        <!-- Povezani Uređaji Accordion/List -->
        <div style="margin-bottom: 20px;">
          <h5 style="color: #c084fc; font-size: 0.9rem; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between;">
            <span style="display: flex; align-items: center; gap: 6px;"><i data-lucide="server" style="width: 14px; height: 14px;"></i> Povezani Svičevi i Mrežni Uređaji (${d.connected_devices_count || 0})</span>
          </h5>
          <div style="max-height: 180px; overflow-y: auto;">
            ${devListHtml}
          </div>
        </div>

        <!-- Vezane Zidne Linije -->
        <div style="margin-bottom: 20px;">
          <h5 style="color: #fb923c; font-size: 0.9rem; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between;">
            <span style="display: flex; align-items: center; gap: 6px;"><i data-lucide="cable" style="width: 14px; height: 14px;"></i> Izvedene Linije i Utičnice (${d.connected_lines_count || 0})</span>
          </h5>
          <div style="max-height: 180px; overflow-y: auto;">
            ${linesListHtml}
          </div>
        </div>

        <!-- Service History -->
        <div>
          <h5 style="color: #38bdf8; font-size: 0.9rem; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
            <i data-lucide="file-text" style="width: 14px; height: 14px;"></i>
            Istorijat Intervencija & Održavanja (${d.history_count || 0})
          </h5>
          ${historyHtml}
        </div>
      `;

      if (window.lucide) window.lucide.createIcons();
    } catch (err) {
      container.innerHTML = `
        <div style="text-align: center; padding: 30px; color: #f87171;">
          <i data-lucide="alert-triangle" style="width: 28px; height: 28px; margin-bottom: 8px;"></i>
          <div>Greška: ${escapeHtml(err.message)}</div>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
    }
  }

  /**
   * Opens Service Logs dialog
   */
  async function openLogsModal(id) {
    const modal = document.getElementById('modal-node-logs');
    const list = document.getElementById('node-logs-list');
    if (!modal || !list) return;

    state.logsTargetNode = id;
    list.innerHTML = `
      <div style="text-align: center; padding: 20px; color: #94a3b8;">
        <i data-lucide="rotate-cw" class="spin" style="width: 18px; height: 18px;"></i>
        <span>Učitavanje zabeleški...</span>
      </div>
    `;
    modal.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons();

    // Default current date
    const dateInput = document.getElementById('input-node-log-date');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

    await refreshLogsList(id);
  }

  /**
   * Refreshes logs list in logs modal
   */
  async function refreshLogsList(id) {
    const list = document.getElementById('node-logs-list');
    if (!list) return;

    try {
      const res = await fetch(`/api/network-nodes/${id}/history`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const logs = json.data || [];

      if (logs.length === 0) {
        list.innerHTML = `<div class="text-dim text-xs" style="text-align: center; padding: 16px;">Nema prethodnih zabeleški za ovo čvorište.</div>`;
        return;
      }

      let html = '';
      logs.forEach(log => {
        html += `
          <div style="display: flex; justify-content: space-between; align-items: flex-start; padding: 10px 12px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 6px; margin-bottom: 8px;">
            <div style="flex: 1;">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                <span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-size: 0.72rem;">${log.date ? new Date(log.date).toLocaleDateString('sr-RS') : '-'}</span>
                ${log.phone ? `<span class="text-dim text-xs"><i data-lucide="phone" style="width: 10px; height: 10px; display: inline;"></i> ${escapeHtml(log.phone)}</span>` : ''}
              </div>
              <div style="color: #e2e8f0; font-size: 0.88rem; line-height: 1.4;">${escapeHtml(log.note)}</div>
            </div>
            <button type="button" class="btn-inv-action btn-danger btn-del-log" data-id="${log.id}" style="color: #f87171; width: 24px; height: 24px;" title="Obriši zabelešku">
              <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>
            </button>
          </div>
        `;
      });

      list.innerHTML = html;
      if (window.lucide) window.lucide.createIcons();

      // Delete log buttons
      list.querySelectorAll('.btn-del-log').forEach(b => {
        b.addEventListener('click', async () => {
          const logId = b.getAttribute('data-id');
          if (!logId) return;
          try {
            const delRes = await fetch(`/api/network-nodes/history/${logId}`, { method: 'DELETE' });
            if (delRes.ok) {
              showToast('Zabeleška je obrisana', 'success');
              await refreshLogsList(id);
            }
          } catch (e) {
            showToast('Greška pri brisanju zabeleške', 'error');
          }
        });
      });
    } catch (err) {
      list.innerHTML = `<div style="color: #f87171; text-align: center; padding: 14px;">Greška: ${escapeHtml(err.message)}</div>`;
    }
  }

  /**
   * Handles adding a new log
   */
  async function handleAddLog() {
    if (!state.logsTargetNode) return;
    const textInput = document.getElementById('input-node-log-text');
    const phoneInput = document.getElementById('input-node-log-phone');
    const dateInput = document.getElementById('input-node-log-date');

    const note = textInput?.value.trim();
    if (!note) {
      showToast('Unesite tekst zabeleške', 'error');
      return;
    }

    try {
      const res = await fetch(`/api/network-nodes/${state.logsTargetNode}/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note,
          phone: phoneInput?.value.trim() || null,
          date: dateInput?.value || null
        })
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast('Zabeleška je uspešno dodata', 'success');

      if (textInput) textInput.value = '';
      if (phoneInput) phoneInput.value = '';

      await refreshLogsList(state.logsTargetNode);
    } catch (err) {
      showToast(`Greška pri dodavanju: ${err.message}`, 'error');
    }
  }

  /**
   * Opens delete confirmation modal
   */
  function openDeleteModal(id) {
    const modal = document.getElementById('modal-node-delete');
    if (!modal) return;

    state.deleteTargetId = id;
    const item = state.items.find(i => i.id === id);

    const nameEl = document.getElementById('node-delete-name');
    const metaEl = document.getElementById('node-delete-meta');

    if (nameEl) nameEl.textContent = item ? (item.name || `Čvor #${item.id}`) : `Čvor #${id}`;
    if (metaEl) metaEl.textContent = item ? `Lokacija: ${item.location_name || 'Lokacija b.b.'} • Kategorija: ${item.category_name || 'ČVORIŠTE'}` : `ID: #${id}`;

    modal.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons();
  }

  /**
   * Handles deletion of node
   */
  async function handleConfirmDelete() {
    if (!state.deleteTargetId) return;

    try {
      const res = await fetch(`/api/network-nodes/${state.deleteTargetId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Brisanje nije uspelo');

      showToast('Čvorište je uspešno obrisano', 'success');
      document.getElementById('modal-node-delete').style.display = 'none';

      await Promise.all([loadStats(), fetchNodes()]);
    } catch (err) {
      showToast(`Greška pri brisanju: ${err.message}`, 'error');
    } finally {
      state.deleteTargetId = null;
    }
  }

  /**
   * Exports nodes list to Excel
   */
  function exportExcel() {
    const params = new URLSearchParams();
    if (state.searchQuery.trim()) params.set('search', state.searchQuery.trim());
    if (state.selectedCategory) params.set('categoryId', state.selectedCategory);
    if (state.selectedLocation) params.set('locationId', state.selectedLocation);
    if (state.selectedBuilding) params.set('buildingId', state.selectedBuilding);
    if (state.selectedStatus) params.set('statusId', state.selectedStatus);

    window.location.href = `/api/network-nodes/export/excel?${params.toString()}`;
  }

  /**
   * Sets up SSE listeners for automatic live synchronization
   */
  function setupSSEListener() {
    if (window.EventSource) {
      try {
        const sse = new EventSource('/api/equipment/events');
        sse.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (['node_created', 'node_updated', 'node_deleted', 'history_added', 'history_deleted'].includes(data.event)) {
              loadStats();
              fetchNodes();
            }
          } catch (err) {}
        };
      } catch (err) {}
    }
  }

  // Export module to global scope
  window.nodesModule = {
    init,
    refresh: () => { loadStats(); fetchNodes(); },
    openCreateModal,
    openEditModal,
    openDetailsModal,
    openLogsModal,
    openDeleteModal
  };

})();
