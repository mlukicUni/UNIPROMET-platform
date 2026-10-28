/**
 * ==========================================================================
 * UNIPROMET IT ADMIN - MREŽNA OPREMA & ČVORIŠTA CLIENT MODULE
 * Manages switches, routers, rack cabinets, nodes (čvorišta), AP, antennas,
 * live Navision enrichment, logs timeline, Excel export, and 2-way legacy sync.
 * ==========================================================================
 */

(function () {
  // Module State
  const state = {
    searchQuery: '',
    currentCategory: '',
    currentLocation: '',
    currentBuilding: '',
    currentCvor: '',
    currentStatus: '',
    currentPage: 1,
    pageSize: 50,
    totalItems: 0,
    totalPages: 1,
    codebooks: null,
    cvorovi: [],
    isLoading: false,
    hasInitialized: false,
    searchDebounceTimer: null,
    currentEquipmentForLogs: null,
    deleteTargetId: null,
    deleteTargetName: null
  };

  // Helper: Safely escape HTML
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Toast Notification Helper
  function showToast(message, type = 'info') {
    const deck = document.getElementById('toast-deck');
    if (!deck) return;
    const toast = document.createElement('div');
    toast.className = `toast-item toast-${type}`;
    const iconName = type === 'success' ? 'check-circle' : type === 'error' ? 'alert-circle' : type === 'warning' ? 'alert-triangle' : 'info';
    toast.innerHTML = `
      <i data-lucide="${iconName}"></i>
      <span>${escapeHtml(message)}</span>
    `;
    deck.appendChild(toast);
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons({ root: toast });
    setTimeout(() => {
      toast.classList.add('toast-fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // ==========================================================================
  // DATA FETCHING & RENDERING
  // ==========================================================================

  async function fetchNetworkStats() {
    try {
      const res = await fetch('/api/network-equipment/stats');
      const json = await res.json();
      if (!json.success || !json.data) return;
      const s = json.data;

      const elTotal = document.getElementById('kpi-net-total');
      const elSwitches = document.getElementById('kpi-net-switches');
      const elRouters = document.getElementById('kpi-net-routers');
      const elCvorovi = document.getElementById('kpi-net-cvorovi');
      const elActive = document.getElementById('kpi-net-active');
      const elBadge = document.getElementById('badge-nav-network-equipment-total');

      if (elTotal) elTotal.textContent = s.total;
      if (elSwitches) elSwitches.textContent = s.switches;
      if (elRouters) elRouters.textContent = s.routersAndAp;
      if (elCvorovi) elCvorovi.textContent = s.cvoroviAndRack;
      if (elActive) elActive.textContent = s.active;
      if (elBadge) elBadge.textContent = s.total;
    } catch (e) {
      console.warn('[NetworkEquipment] Error fetching stats:', e);
    }
  }

  async function fetchCodebooks() {
    try {
      const res = await fetch('/api/network-equipment/dictionaries');
      const json = await res.json();
      if (!json.success || !json.data) return;
      state.codebooks = json.data;
      state.cvorovi = json.data.cvorovi || [];

      populateFilterDropdowns();
      populateModalDropdowns();
    } catch (e) {
      console.warn('[NetworkEquipment] Error fetching codebooks:', e);
    }
  }

  function populateFilterDropdowns() {
    if (!state.codebooks) return;

    // 1. Categories (Filtered to network categories)
    const selectCat = document.getElementById('select-net-category');
    if (selectCat) {
      const netCats = state.codebooks.categories.filter(c => 
        [6, 7, 8, 16, 21, 22, 28, 33, 34, 39, 40, 47].includes(c.id) || (c.is_network && ![1, 2, 4, 10].includes(c.id))
      );
      let opts = `<option value="">Sve Kategorije (${netCats.length})</option>`;
      for (const cat of netCats) {
        opts += `<option value="${cat.id}">${escapeHtml(cat.name)}</option>`;
      }
      selectCat.innerHTML = opts;
    }

    // 2. Locations
    const selectLoc = document.getElementById('select-net-location');
    if (selectLoc) {
      let opts = `<option value="">Sve Lokacije</option>`;
      for (const loc of state.codebooks.locations) {
        opts += `<option value="${loc.id}">${escapeHtml(loc.name)}</option>`;
      }
      selectLoc.innerHTML = opts;
    }

    // 3. Buildings
    const selectBld = document.getElementById('select-net-building');
    if (selectBld) {
      let opts = `<option value="">Svi Objekti</option>`;
      for (const bld of state.codebooks.buildings) {
        opts += `<option value="${bld.id}">${escapeHtml(bld.name)}</option>`;
      }
      selectBld.innerHTML = opts;
    }

    // 4. Čvorišta
    const selectCvor = document.getElementById('select-net-cvor');
    if (selectCvor) {
      let opts = `<option value="">Sva Čvorišta / Ormani</option>`;
      for (const cv of state.cvorovi) {
        opts += `<option value="${cv.id}">${escapeHtml(cv.label)}</option>`;
      }
      selectCvor.innerHTML = opts;
    }

    // 5. Statuses
    const selectStat = document.getElementById('select-net-status');
    if (selectStat) {
      let opts = `<option value="">Svi Statusi</option>`;
      for (const st of state.codebooks.statuses) {
        opts += `<option value="${st.id}">${escapeHtml(st.name)}</option>`;
      }
      selectStat.innerHTML = opts;
    }
  }

  function populateModalDropdowns() {
    if (!state.codebooks) return;

    // Categories in Modal
    const inCat = document.getElementById('net-input-category');
    if (inCat) {
      const netCats = state.codebooks.categories.filter(c => 
        [6, 7, 8, 16, 21, 22, 28, 33, 34, 39, 40, 47].includes(c.id) || (c.is_network && ![1, 2, 4, 10].includes(c.id))
      );
      inCat.innerHTML = netCats
        .map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
        .join('');
    }

    // Statuses in Modal
    const inStat = document.getElementById('net-input-status');
    if (inStat) {
      inStat.innerHTML = state.codebooks.statuses
        .map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`)
        .join('');
    }

    // Locations in Modal
    const inLoc = document.getElementById('net-input-location');
    if (inLoc) {
      let opts = `<option value="">— Izaberi lokaciju —</option>`;
      for (const loc of state.codebooks.locations) {
        opts += `<option value="${loc.id}">${escapeHtml(loc.name)}</option>`;
      }
      inLoc.innerHTML = opts;
    }

    // Buildings in Modal
    const inBld = document.getElementById('net-input-building');
    if (inBld) {
      let opts = `<option value="">— Izaberi objekat —</option>`;
      for (const bld of state.codebooks.buildings) {
        opts += `<option value="${bld.id}">${escapeHtml(bld.name)}</option>`;
      }
      inBld.innerHTML = opts;
    }

    // Rooms in Modal
    const inRoom = document.getElementById('net-input-room');
    if (inRoom) {
      let opts = `<option value="">— Izaberi prostoriju —</option>`;
      for (const rm of state.codebooks.rooms) {
        opts += `<option value="${rm.id}">${escapeHtml(rm.short_desc || rm.name)}</option>`;
      }
      inRoom.innerHTML = opts;
    }

    // Čvorišta in Modal
    const inCvor = document.getElementById('net-input-cvor');
    if (inCvor) {
      let opts = `<option value="">— Nije vezano za čvor —</option>`;
      for (const cv of state.cvorovi) {
        opts += `<option value="${cv.id}">${escapeHtml(cv.label)}</option>`;
      }
      inCvor.innerHTML = opts;
    }
  }

  async function fetchNetworkEquipment(page = 1) {
    if (state.isLoading) return;
    state.isLoading = true;
    state.currentPage = page;

    const tbody = document.getElementById('tbody-network-equipment');
    if (tbody && (!tbody.children.length || tbody.querySelector('.inv-empty-state'))) {
      tbody.innerHTML = `
        <tr>
          <td colspan="11" style="text-align: center; padding: 40px 20px;">
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: #94a3b8;">
              <i data-lucide="loader-2" class="spin" style="width: 28px; height: 28px; color: var(--yellow-primary);"></i>
              <span style="font-size: 0.9rem;">Učitavanje mrežne opreme...</span>
            </div>
          </td>
        </tr>
      `;
      if (window.lucide && window.lucide.createIcons) window.lucide.createIcons({ root: tbody });
    }

    try {
      const params = new URLSearchParams();
      if (state.searchQuery) params.set('search', state.searchQuery);
      if (state.currentCategory) params.set('categoryId', state.currentCategory);
      if (state.currentLocation) params.set('locationId', state.currentLocation);
      if (state.currentBuilding) params.set('buildingId', state.currentBuilding);
      if (state.currentCvor) params.set('cvorId', state.currentCvor);
      if (state.currentStatus) params.set('statusId', state.currentStatus);
      params.set('page', String(page));
      params.set('limit', String(state.pageSize));

      const res = await fetch(`/api/network-equipment?${params.toString()}`);
      const json = await res.json();

      if (!json.success) throw new Error(json.error || 'Neuspešno preuzimanje podataka');

      state.totalItems = json.pagination.total;
      state.totalPages = json.pagination.totalPages;

      renderNetworkTable(json.data);
      renderNetworkPagination();
      updateResetButtonVisibility();
    } catch (err) {
      console.error('[NetworkEquipment] Error loading items:', err);
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="11" style="text-align: center; padding: 40px 20px; color: #ef4444;">
              <i data-lucide="alert-circle" style="width: 28px; height: 28px; margin-bottom: 8px;"></i>
              <div>Greška pri učitavanju: ${escapeHtml(err.message)}</div>
            </td>
          </tr>
        `;
        if (window.lucide && window.lucide.createIcons) window.lucide.createIcons({ root: tbody });
      }
    } finally {
      state.isLoading = false;
    }
  }

  function renderNetworkTable(items) {
    const tbody = document.getElementById('tbody-network-equipment');
    if (!tbody) return;

    if (!items || items.length === 0) {
      tbody.innerHTML = `
        <tr class="inv-empty-state">
          <td colspan="11" style="text-align: center; padding: 48px 20px;">
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: #64748b;">
              <div style="width: 52px; height: 52px; border-radius: 50%; background: rgba(255,255,255,0.04); display: flex; align-items: center; justify-content: center;">
                <i data-lucide="network" style="width: 26px; height: 26px; color: #94a3b8;"></i>
              </div>
              <strong style="color: #cbd5e1; font-size: 1rem;">Nema pronađene mrežne opreme</strong>
              <p style="margin: 0; font-size: 0.85rem; max-width: 360px;">Pokušajte sa drugačijim terminom pretrage ili poništite filtere.</p>
            </div>
          </td>
        </tr>
      `;
      if (window.lucide && window.lucide.createIcons) window.lucide.createIcons({ root: tbody });
      return;
    }

    let html = '';
    for (const item of items) {
      // Status badge styling
      const statusName = item.status_name || 'ISPRAVNO';
      let statusClass = 'badge-cam-online';
      if (statusName.includes('ISPRAVNO U RC')) statusClass = 'badge-cam-recording';
      else if (statusName.includes('NEISPRAVNO') || statusName.includes('RASHOD')) statusClass = 'badge-cam-offline';
      else if (statusName.includes('SERVIS')) statusClass = 'badge-cam-unmonitored';

      // Category icon
      let catIcon = item.category_icon || 'network';
      if (item.category_id === 16 || item.category_id === 33) catIcon = 'git-commit';
      else if ([8, 39, 40].includes(item.category_id)) catIcon = 'router';
      else if ([6, 28, 47].includes(item.category_id)) catIcon = 'layers';

      // Location & Building format
      const locName = item.location_name || '—';
      const bldName = item.building_name ? ` &bull; ${escapeHtml(item.building_name)}` : '';
      const roomName = item.room_name ? `<div class="text-dim text-xs" style="margin-top: 2px;">${escapeHtml(item.room_name)}</div>` : '';

      // Parent Cvor info
      let cvorHtml = '—';
      if (item.category_id === 16 || item.category_id === 33) {
        cvorHtml = `<span class="badge-tag" style="background: rgba(192, 132, 252, 0.12); color: #c084fc; border: 1px solid rgba(192, 132, 252, 0.25); font-weight: 600;">Glavno Čvorište</span>`;
      } else if (item.parent_cvor) {
        cvorHtml = `<span class="font-mono text-xs" style="color: #e2e8f0;">${escapeHtml(item.parent_cvor)}</span>`;
      } else if (item.custom_code) {
        cvorHtml = `<span class="font-mono text-dim text-xs">Čvor #${item.custom_code}</span>`;
      }

      // Ports & Speed
      let portsHtml = '';
      if (item.lines_count) {
        portsHtml += `<strong style="color: #38bdf8; font-family: monospace;">${item.lines_count} portova</strong>`;
      }
      if (item.comment) {
        portsHtml += `<div class="text-dim text-xs" style="margin-top: 2px;">${escapeHtml(item.comment)}</div>`;
      }
      if (!portsHtml) portsHtml = '<span class="text-dim">—</span>';

      // Dimensions / Route for cabinets
      let dimRouteHtml = '';
      if (item.rack_dims) {
        dimRouteHtml += `<div style="color: #f59e0b; font-family: monospace; font-size: 0.8rem; font-weight: 600;">${escapeHtml(item.rack_dims)}</div>`;
      }
      if (item.route_desc) {
        const shortRoute = item.route_desc.length > 50 ? item.route_desc.slice(0, 50) + '...' : item.route_desc;
        dimRouteHtml += `<div class="text-dim text-xs" title="${escapeHtml(item.route_desc)}" style="margin-top: 2px;">${escapeHtml(shortRoute)}</div>`;
      }
      if (!dimRouteHtml) dimRouteHtml = '<span class="text-dim">—</span>';

      // Assigned Employee
      let empHtml = '';
      if (item.employee_name || item.employee_no) {
        const empName = item.employee_name || item.employee_no;
        const job = item.employee_job || item.employee_dept || '';
        empHtml = `
          <div class="table-emp-cell" style="display: flex; align-items: center; gap: 8px;">
            <div class="table-emp-avatar" style="width: 26px; height: 26px; border-radius: 50%; background: rgba(245, 158, 11, 0.15); color: #f59e0b; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700;">
              ${escapeHtml(empName.charAt(0).toUpperCase())}
            </div>
            <div>
              <div style="font-weight: 600; color: #f1f5f9; font-size: 0.86rem;">${escapeHtml(empName)}</div>
              ${job ? `<div class="text-dim text-xs">${escapeHtml(job)}</div>` : ''}
            </div>
          </div>
        `;
      } else {
        empHtml = `<span class="text-dim text-xs" style="font-style: italic;">Nije zaduženo</span>`;
      }

      const logsCount = item.history_count || 0;

      html += `
        <tr data-id="${item.id}">
          <td style="font-family: monospace; color: #94a3b8; font-weight: 600;">#${item.id}</td>
          <td style="text-align: center;">
            <span class="badge-tag" style="background: rgba(255,255,255,0.06); color: #e2e8f0; font-size: 0.76rem; display: inline-flex; align-items: center; gap: 5px;">
              <i data-lucide="${catIcon}" style="width: 12px; height: 12px; color: var(--yellow-primary);"></i>
              <span>${escapeHtml(item.category_name || 'Oprema')}</span>
            </span>
          </td>
          <td>
            <strong style="color: #f8fafc; font-size: 0.92rem;">${escapeHtml(item.name || '—')}</strong>
            ${item.description ? `<div class="text-dim text-xs" style="margin-top: 2px;">${escapeHtml(item.description)}</div>` : ''}
          </td>
          <td style="text-align: center;">
            <span class="badge-camera-status ${statusClass}" style="font-size: 0.75rem;">${escapeHtml(statusName)}</span>
          </td>
          <td>
            <div style="font-weight: 600; color: #e2e8f0; font-size: 0.85rem;">
              <i data-lucide="map-pin" style="width: 11px; height: 11px; color: #f59e0b; margin-right: 3px; display: inline;"></i>
              ${escapeHtml(locName)}${bldName}
            </div>
            ${roomName}
          </td>
          <td>${cvorHtml}</td>
          <td>${portsHtml}</td>
          <td>${dimRouteHtml}</td>
          <td>${empHtml}</td>
          <td style="text-align: center;">
            <button type="button" class="btn-inv-action btn-net-logs" data-id="${item.id}" data-name="${escapeHtml(item.name || '')}" title="Pregled istorijata i servisnih zabeleški" style="width: auto; min-width: 32px; padding: 0 8px; gap: 5px; font-size: 0.76rem; font-weight: 600; font-family: var(--font-mono, monospace);">
              <i data-lucide="message-square" style="width: 13px; height: 13px; color: #f59e0b;"></i>
              <span>${logsCount}</span>
            </button>
          </td>
          <td style="text-align: right;">
            <div class="inv-actions-cell" style="justify-content: flex-end; gap: 4px;">
              <button type="button" class="btn-inv-action btn-net-edit" data-id="${item.id}" title="Izmeni mrežnu opremu">
                <i data-lucide="pencil"></i>
              </button>
              <button type="button" class="btn-inv-action btn-danger btn-inv-action-delete btn-net-delete" data-id="${item.id}" data-name="${escapeHtml(item.name || '')}" data-cat="${escapeHtml(item.category_name || '')}" style="color: #f87171;" title="Obriši opremu">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }

    tbody.innerHTML = html;
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons({ root: tbody });
  }

  function renderNetworkPagination() {
    const counter = document.getElementById('net-counter-text');
    const container = document.getElementById('net-pagination-controls');
    if (!counter || !container) return;

    const start = (state.currentPage - 1) * state.pageSize + 1;
    const end = Math.min(state.currentPage * state.pageSize, state.totalItems);
    counter.textContent = state.totalItems > 0
      ? `Prikazano: ${start}-${end} od ukupno ${state.totalItems} mrežnih uređaja`
      : `Prikazano: 0 stavki`;

    if (state.totalPages <= 1) {
      container.innerHTML = '';
      return;
    }

    let html = '';
    const prevDisabled = state.currentPage === 1;
    html += `<button type="button" class="btn-dark-sm btn-net-page" style="padding: 4px 10px; height: 30px; ${prevDisabled ? 'opacity: 0.4; pointer-events: none;' : ''}" data-page="${state.currentPage - 1}"><i data-lucide="chevron-left" style="width: 14px; height: 14px;"></i></button>`;

    let pStart = Math.max(1, state.currentPage - 2);
    let pEnd = Math.min(state.totalPages, state.currentPage + 2);

    if (pStart > 1) {
      html += `<button type="button" class="btn-dark-sm btn-net-page" style="padding: 4px 10px; height: 30px;" data-page="1">1</button>`;
      if (pStart > 2) html += `<span style="color: #64748b; padding: 0 4px; display: flex; align-items: center;">...</span>`;
    }

    for (let p = pStart; p <= pEnd; p++) {
      const activeStyle = p === state.currentPage ? 'background: var(--yellow-primary); color: #000; font-weight: 700; border-color: var(--yellow-primary);' : '';
      html += `<button type="button" class="btn-dark-sm btn-net-page ${p === state.currentPage ? 'active' : ''}" style="padding: 4px 10px; height: 30px; ${activeStyle}" data-page="${p}">${p}</button>`;
    }

    if (pEnd < state.totalPages) {
      if (pEnd < state.totalPages - 1) html += `<span style="color: #64748b; padding: 0 4px; display: flex; align-items: center;">...</span>`;
      html += `<button type="button" class="btn-dark-sm btn-net-page" style="padding: 4px 10px; height: 30px;" data-page="${state.totalPages}">${state.totalPages}</button>`;
    }

    const nextDisabled = state.currentPage === state.totalPages;
    html += `<button type="button" class="btn-dark-sm btn-net-page" style="padding: 4px 10px; height: 30px; ${nextDisabled ? 'opacity: 0.4; pointer-events: none;' : ''}" data-page="${state.currentPage + 1}"><i data-lucide="chevron-right" style="width: 14px; height: 14px;"></i></button>`;

    container.innerHTML = html;
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons({ root: container });
  }

  function updateResetButtonVisibility() {
    const btnReset = document.getElementById('btn-reset-net-filters');
    const hasFilter = Boolean(state.searchQuery || state.currentCategory || state.currentLocation || state.currentBuilding || state.currentCvor || state.currentStatus);
    if (btnReset) btnReset.style.display = hasFilter ? 'inline-flex' : 'none';
  }

  // ==========================================================================
  // EMPLOYEE AUTOCOMPLETE & SELECTION (NAVISION HR)
  // ==========================================================================

  let empSearchTimer = null;

  function setNetSelectedEmployee(emp) {
    const hiddenEmpNo = document.getElementById('net-input-emp-no');
    const selectedBox = document.getElementById('net-selected-emp-box');
    const searchInput = document.getElementById('net-edit-emp-search');
    const list = document.getElementById('net-emp-autocomplete-list');

    if (list) list.style.display = 'none';

    if (emp && (emp.employee_no || emp.first_name || emp.full_name)) {
      if (hiddenEmpNo) hiddenEmpNo.value = emp.employee_no || '';
      if (searchInput) searchInput.value = '';

      const nameEl = document.getElementById('net-selected-emp-name');
      const statusEl = document.getElementById('net-selected-emp-status');
      const noEl = document.getElementById('net-selected-emp-no');
      const jobEl = document.getElementById('net-selected-emp-job');
      const deptEl = document.getElementById('net-selected-emp-dept');

      const fullName = emp.full_name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.employee_no;
      if (nameEl) nameEl.textContent = fullName;
      if (noEl) noEl.textContent = emp.employee_no ? `(${emp.employee_no})` : '';
      if (jobEl) jobEl.textContent = emp.job_title || '—';
      if (deptEl) deptEl.textContent = emp.department ? `${emp.department} (${emp.company || 'Unipromet'})` : (emp.company || 'Unipromet');

      if (statusEl) {
        const hrStatus = emp.hr_status || 'Aktivan';
        statusEl.textContent = hrStatus;
        let badgeClass = 'badge-hr-active';
        if (hrStatus.toLowerCase().includes('neaktivan')) badgeClass = 'badge-hr-inactive';
        else if (hrStatus.toLowerCase().includes('napustio')) badgeClass = 'badge-hr-left';
        statusEl.className = `badge-hr ${badgeClass}`;
      }

      if (selectedBox) selectedBox.style.display = 'block';
    } else {
      if (hiddenEmpNo) hiddenEmpNo.value = '';
      if (searchInput) searchInput.value = '';
      if (selectedBox) selectedBox.style.display = 'none';
    }

    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
  }

  function handleNetEmployeeSearch(query) {
    const spinner = document.getElementById('net-emp-search-spinner');
    const list = document.getElementById('net-emp-autocomplete-list');
    clearTimeout(empSearchTimer);

    if (!query || query.trim().length < 2) {
      if (list) list.style.display = 'none';
      if (spinner) spinner.style.display = 'none';
      return;
    }

    if (spinner) spinner.style.display = 'inline-block';

    empSearchTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/equipment/employees?q=${encodeURIComponent(query.trim())}`);
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          renderNetEmployeeAutocomplete(json.data);
        }
      } catch (err) {
        console.warn('[NetworkEquipment] Employee search error:', err);
      } finally {
        if (spinner) spinner.style.display = 'none';
      }
    }, 300);
  }

  function renderNetEmployeeAutocomplete(employees) {
    const list = document.getElementById('net-emp-autocomplete-list');
    if (!list) return;

    if (employees.length === 0) {
      list.innerHTML = `
        <div style="padding: 12px 14px; color: #94a3b8; font-size: 0.82rem; text-align: center;">
          Nema pronađenih radnika u Navision bazi.
        </div>
      `;
      list.style.display = 'block';
      return;
    }

    list.innerHTML = employees.map((emp, idx) => {
      let badgeClass = 'badge-hr-active';
      const hrStatus = emp.hr_status || 'Aktivan';
      if (hrStatus.toLowerCase().includes('neaktivan')) badgeClass = 'badge-hr-inactive';
      else if (hrStatus.toLowerCase().includes('napustio')) badgeClass = 'badge-hr-left';

      return `
        <div class="nav-autocomplete-item" data-emp-index="${idx}">
          <div>
            <div class="nav-autocomplete-name">
              ${escapeHtml(emp.first_name)} ${escapeHtml(emp.last_name)}
              <span class="font-mono text-dim" style="font-size: 0.75rem; margin-left: 6px;">(${escapeHtml(emp.employee_no)})</span>
            </div>
            <div class="nav-autocomplete-meta">
              ${escapeHtml(emp.job_title || '—')} &bull; ${escapeHtml(emp.department || emp.company || 'Unipromet')}
            </div>
          </div>
          <div>
            <span class="badge-hr ${badgeClass}">${escapeHtml(hrStatus)}</span>
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.nav-autocomplete-item').forEach(itemEl => {
      itemEl.addEventListener('click', () => {
        const idx = parseInt(itemEl.getAttribute('data-emp-index'), 10);
        const emp = employees[idx];
        if (emp) setNetSelectedEmployee(emp);
      });
    });

    list.style.display = 'block';
  }

  // ==========================================================================
  // MODALS & ACTIONS
  // ==========================================================================

  function openNetworkEditModal(item = null) {
    const modal = document.getElementById('modal-net-equipment-edit');
    const title = document.getElementById('modal-net-eq-title');
    const form = document.getElementById('form-net-equipment-edit');
    if (!modal || !form) return;

    form.reset();

    const inId = document.getElementById('net-input-id');
    const inName = document.getElementById('net-input-name');
    const inCat = document.getElementById('net-input-category');
    const inStat = document.getElementById('net-input-status');
    const inInv = document.getElementById('net-input-inv-no');
    const inLoc = document.getElementById('net-input-location');
    const inBld = document.getElementById('net-input-building');
    const inRoom = document.getElementById('net-input-room');
    const inCvor = document.getElementById('net-input-cvor');
    const inLines = document.getElementById('net-input-lines');
    const inComment = document.getElementById('net-input-comment');
    const inDateArr = document.getElementById('net-input-date-arrived');
    const inDatePurch = document.getElementById('net-input-date-purchased');
    const inRackDims = document.getElementById('net-input-rack-dims');
    const inRouteDesc = document.getElementById('net-input-route-desc');

    if (item) {
      if (title) title.textContent = `Izmena Mrežne Opreme #${item.id}`;
      if (inId) inId.value = item.id;
      if (inName) inName.value = item.name || '';
      if (inCat) inCat.value = item.category_id || 6;
      if (inStat) inStat.value = item.status_id || 1;
      if (inInv) inInv.value = item.inventory_no || '';
      if (inLoc) inLoc.value = item.location_id || '';
      if (inBld) inBld.value = item.building_id || '';
      if (inRoom) inRoom.value = item.room_id || '';
      if (inCvor) inCvor.value = item.custom_code || '';
      if (inLines) inLines.value = item.lines_count !== null && item.lines_count !== undefined ? item.lines_count : '';
      if (inComment) inComment.value = item.comment || '';
      if (inDateArr) inDateArr.value = item.date_arrived ? item.date_arrived.slice(0, 10) : '';
      if (inDatePurch) inDatePurch.value = item.date_purchased || '';
      if (inRackDims) inRackDims.value = item.rack_dims || '';
      if (inRouteDesc) inRouteDesc.value = item.route_desc || '';

      if (item.employee_no || item.employee_name) {
        setNetSelectedEmployee({
          employee_no: item.employee_no,
          first_name: item.employee_name,
          last_name: '',
          hr_status: item.employee_status || 'Aktivan',
          job_title: item.employee_job || '—',
          department: item.employee_dept || 'Unipromet'
        });
      } else {
        setNetSelectedEmployee(null);
      }
    } else {
      if (title) title.textContent = 'Evidentiraj Mrežnu Opremu';
      if (inId) inId.value = '';
      if (inCat) inCat.value = 6; // Default: SWITCH
      if (inStat) inStat.value = 1; // Default: ISPRAVNO
      setNetSelectedEmployee(null);
    }

    if (window.openModal) window.openModal(modal);
    else modal.style.display = 'flex';
  }

  async function handleNetworkSaveSubmit(e) {
    e.preventDefault();
    const inId = document.getElementById('net-input-id');
    const inName = document.getElementById('net-input-name');
    const inCat = document.getElementById('net-input-category');
    const inStat = document.getElementById('net-input-status');
    const inInv = document.getElementById('net-input-inv-no');
    const inLoc = document.getElementById('net-input-location');
    const inBld = document.getElementById('net-input-building');
    const inRoom = document.getElementById('net-input-room');
    const inCvor = document.getElementById('net-input-cvor');
    const inLines = document.getElementById('net-input-lines');
    const inComment = document.getElementById('net-input-comment');
    const inDateArr = document.getElementById('net-input-date-arrived');
    const inDatePurch = document.getElementById('net-input-date-purchased');
    const inRackDims = document.getElementById('net-input-rack-dims');
    const inRouteDesc = document.getElementById('net-input-route-desc');
    const inEmpNo = document.getElementById('net-input-emp-no');

    const id = inId?.value ? parseInt(inId.value, 10) : null;
    const name = inName?.value?.trim();
    if (!name) {
      showToast('Naziv / Model uređaja je obavezan', 'error');
      return;
    }

    const payload = {
      name,
      category_id: inCat?.value ? parseInt(inCat.value, 10) : 6,
      status_id: inStat?.value ? parseInt(inStat.value, 10) : 1,
      inventory_no: inInv?.value?.trim() || null,
      location_id: inLoc?.value ? parseInt(inLoc.value, 10) : null,
      building_id: inBld?.value ? parseInt(inBld.value, 10) : null,
      room_id: inRoom?.value ? parseInt(inRoom.value, 10) : null,
      custom_code: inCvor?.value ? parseInt(inCvor.value, 10) : null,
      lines_count: inLines?.value !== '' && inLines?.value !== null ? parseInt(inLines.value, 10) : null,
      comment: inComment?.value?.trim() || null,
      date_arrived: inDateArr?.value || null,
      date_purchased: inDatePurch?.value?.trim() || null,
      rack_dims: inRackDims?.value?.trim() || null,
      route_desc: inRouteDesc?.value?.trim() || null,
      employee_no: inEmpNo?.value?.trim() || null
    };

    const submitBtn = document.getElementById('btn-save-net-eq-submit');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Čuvanje...`;
      if (window.lucide && window.lucide.createIcons) window.lucide.createIcons({ root: submitBtn });
    }

    try {
      const url = id ? `/api/network-equipment/${id}` : '/api/network-equipment';
      const method = id ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Greška pri čuvanju');

      showToast(json.message || (id ? 'Mrežni uređaj je ažuriran' : 'Mrežni uređaj je dodat'), 'success');

      const modal = document.getElementById('modal-net-equipment-edit');
      if (window.closeModal) window.closeModal(modal);
      else if (modal) modal.style.display = 'none';

      await fetchNetworkStats();
      await fetchCodebooks();
      await fetchNetworkEquipment(state.currentPage);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<i data-lucide="save"></i> <span>Sačuvaj Opremu</span>`;
        if (window.lucide && window.lucide.createIcons) window.lucide.createIcons({ root: submitBtn });
      }
    }
  }

  // ==========================================================================
  // LOGS & TIMELINE
  // ==========================================================================

  async function openNetworkLogsModal(id, name) {
    state.currentEquipmentForLogs = id;
    const modal = document.getElementById('modal-net-equipment-logs');
    const title = document.getElementById('modal-net-logs-title');
    const subtitle = document.getElementById('modal-net-logs-subtitle');
    const timeline = document.getElementById('net-logs-timeline');
    const input = document.getElementById('input-net-new-log-text');
    if (!modal) return;

    if (title) title.textContent = `Servisne Zabeleške za #${id} ${name}`;
    if (subtitle) subtitle.textContent = `Hronologija servisnih intervencija i zabeleški sa servera 121.20`;
    if (input) input.value = '';

    if (timeline) {
      timeline.innerHTML = `<div style="text-align: center; padding: 20px; color: #94a3b8;"><i data-lucide="loader-2" class="spin"></i> Učitavanje zabeleški...</div>`;
      if (window.lucide && window.lucide.createIcons) window.lucide.createIcons({ root: timeline });
    }

    if (window.openModal) window.openModal(modal);
    else modal.style.display = 'flex';

    await loadNetworkLogs(id);
  }

  async function loadNetworkLogs(id) {
    const timeline = document.getElementById('net-logs-timeline');
    if (!timeline) return;

    try {
      const res = await fetch(`/api/network-equipment/${id}/history`);
      const json = await res.json();
      if (!json.success || !Array.isArray(json.data) || json.data.length === 0) {
        timeline.innerHTML = `
          <div style="text-align: center; padding: 24px; color: #94a3b8;">
            <i data-lucide="info" style="margin-bottom: 6px; width: 20px; height: 20px;"></i>
            <div>Nema unetih servisnih zabeleški za ovaj uređaj.</div>
          </div>
        `;
        if (window.lucide && window.lucide.createIcons) window.lucide.createIcons({ root: timeline });
        return;
      }

      let html = '';
      for (const log of json.data) {
        const dateStr = log.date ? new Date(log.date).toLocaleDateString('sr-RS') : 'Nema datuma';
        html += `
          <div class="eq-timeline-item" style="display: flex; gap: 12px; margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px solid rgba(255, 255, 255, 0.06);">
            <div class="eq-timeline-dot" style="width: 10px; height: 10px; border-radius: 50%; background: var(--yellow-primary); margin-top: 5px; flex-shrink: 0; box-shadow: 0 0 8px rgba(245, 158, 11, 0.4);"></div>
            <div style="flex: 1;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 0.78rem; font-weight: 600; color: #fbbf24;">${dateStr}</span>
                <button type="button" class="btn-inv-action btn-danger btn-delete-net-log" data-id="${log.id}" title="Obriši zabelešku" style="width: 24px; height: 24px; color: #f87171;">
                  <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i>
                </button>
              </div>
              <p style="margin: 4px 0 0 0; color: #f1f5f9; font-size: 0.88rem; line-height: 1.45; white-space: pre-wrap;">${escapeHtml(log.note)}</p>
            </div>
          </div>
        `;
      }

      timeline.innerHTML = html;
      if (window.lucide && window.lucide.createIcons) window.lucide.createIcons({ root: timeline });
    } catch (e) {
      timeline.innerHTML = `<div style="color: #ef4444; padding: 14px;">Greška pri učitavanju: ${escapeHtml(e.message)}</div>`;
    }
  }

  async function handleAddNetworkLogSubmit() {
    if (!state.currentEquipmentForLogs) return;
    const input = document.getElementById('input-net-new-log-text');
    const note = input?.value?.trim();
    if (!note) {
      showToast('Tekst zabeleške je obavezan', 'warning');
      return;
    }

    const btn = document.getElementById('btn-net-submit-log');
    if (btn) btn.disabled = true;

    try {
      const res = await fetch(`/api/network-equipment/${state.currentEquipmentForLogs}/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note, date: new Date().toISOString().split('T')[0] })
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Greška pri čuvanju zabeleške');

      if (input) input.value = '';
      showToast('Zabeleška je uspešno upisana', 'success');
      await loadNetworkLogs(state.currentEquipmentForLogs);
      fetchNetworkEquipment(state.currentPage);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function handleDeleteNetworkLog(logId) {
    if (!confirm('Da li ste sigurni da želite obrisati ovu zabelešku?')) return;
    try {
      const res = await fetch(`/api/network-equipment/history/${logId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Greška pri brisanju');
      showToast('Zabeleška je obrisana', 'info');
      if (state.currentEquipmentForLogs) await loadNetworkLogs(state.currentEquipmentForLogs);
      fetchNetworkEquipment(state.currentPage);
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  // ==========================================================================
  // DELETE & SYNC ACTIONS
  // ==========================================================================

  function openNetworkDeleteModal(id, name, cat) {
    state.deleteTargetId = id;
    state.deleteTargetName = name;

    const modal = document.getElementById('modal-net-equipment-delete');
    const nameEl = document.getElementById('net-delete-name');
    const metaEl = document.getElementById('net-delete-meta');
    if (!modal) return;

    if (nameEl) nameEl.textContent = name || `#${id}`;
    if (metaEl) metaEl.textContent = `ID: #${id} • Kategorija: ${cat || 'Mrežna Oprema'}`;

    if (window.openModal) window.openModal(modal);
    else modal.style.display = 'flex';
  }

  async function handleConfirmNetworkDelete() {
    if (!state.deleteTargetId) return;

    const btn = document.getElementById('btn-confirm-net-delete');
    if (btn) btn.disabled = true;

    try {
      const res = await fetch(`/api/network-equipment/${state.deleteTargetId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Greška pri brisanju');

      showToast(`Mrežni uređaj #${state.deleteTargetId} je obrisan`, 'success');

      const modal = document.getElementById('modal-net-equipment-delete');
      if (window.closeModal) window.closeModal(modal);
      else if (modal) modal.style.display = 'none';

      await fetchNetworkStats();
      await fetchNetworkEquipment(state.currentPage);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function triggerNetworkSync() {
    const spinIcon = document.getElementById('icon-sync-net-spin');
    if (spinIcon) spinIcon.classList.add('spin');

    try {
      const res = await fetch('/api/equipment/sync-check');
      const json = await res.json();

      if (json.changed) {
        showToast(`⚡ Sinhronizovane promene sa servera 121.20 (${json.durationMs}ms)`, 'success');
      } else {
        showToast(`Baza je u potpunosti sinhronizovana (${json.durationMs}ms)`, 'info');
      }

      await fetchNetworkStats();
      await fetchCodebooks();
      await fetchNetworkEquipment(state.currentPage);
    } catch (e) {
      showToast('Greška pri sinhronizaciji: ' + e.message, 'error');
    } finally {
      setTimeout(() => {
        if (spinIcon) spinIcon.classList.remove('spin');
      }, 500);
    }
  }

  function exportNetworkExcel() {
    const params = new URLSearchParams();
    if (state.searchQuery) params.set('search', state.searchQuery);
    if (state.currentCategory) params.set('categoryId', state.currentCategory);
    if (state.currentLocation) params.set('locationId', state.currentLocation);
    if (state.currentBuilding) params.set('buildingId', state.currentBuilding);
    if (state.currentCvor) params.set('cvorId', state.currentCvor);
    if (state.currentStatus) params.set('statusId', state.currentStatus);

    showToast('Generisanje Excel fajla u toku...', 'info');
    window.location.href = `/api/network-equipment/export/excel?${params.toString()}`;
  }

  // ==========================================================================
  // EVENT LISTENERS & BINDINGS
  // ==========================================================================

  function bindEvents() {
    // Search input debounce
    const searchInput = document.getElementById('search-network-equipment');
    const btnClearSearch = document.getElementById('btn-clear-search-net');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const val = searchInput.value;
        if (btnClearSearch) btnClearSearch.style.display = val ? 'block' : 'none';
        clearTimeout(state.searchDebounceTimer);
        state.searchDebounceTimer = setTimeout(() => {
          state.searchQuery = val.trim();
          fetchNetworkEquipment(1);
        }, 300);
      });
    }

    if (btnClearSearch) {
      btnClearSearch.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        btnClearSearch.style.display = 'none';
        state.searchQuery = '';
        fetchNetworkEquipment(1);
      });
    }

    // Category Select
    const selectCat = document.getElementById('select-net-category');
    if (selectCat) {
      selectCat.addEventListener('change', () => {
        state.currentCategory = selectCat.value;
        fetchNetworkEquipment(1);
      });
    }

    // Location Select
    const selectLoc = document.getElementById('select-net-location');
    if (selectLoc) {
      selectLoc.addEventListener('change', () => {
        state.currentLocation = selectLoc.value;
        fetchNetworkEquipment(1);
      });
    }

    // Building Select
    const selectBld = document.getElementById('select-net-building');
    if (selectBld) {
      selectBld.addEventListener('change', () => {
        state.currentBuilding = selectBld.value;
        fetchNetworkEquipment(1);
      });
    }

    // Cvor Select
    const selectCvor = document.getElementById('select-net-cvor');
    if (selectCvor) {
      selectCvor.addEventListener('change', () => {
        state.currentCvor = selectCvor.value;
        fetchNetworkEquipment(1);
      });
    }

    // Status Select
    const selectStat = document.getElementById('select-net-status');
    if (selectStat) {
      selectStat.addEventListener('change', () => {
        state.currentStatus = selectStat.value;
        fetchNetworkEquipment(1);
      });
    }

    // Reset Filters
    const btnReset = document.getElementById('btn-reset-net-filters');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        state.searchQuery = '';
        state.currentCategory = '';
        state.currentLocation = '';
        state.currentBuilding = '';
        state.currentCvor = '';
        state.currentStatus = '';

        if (searchInput) searchInput.value = '';
        if (btnClearSearch) btnClearSearch.style.display = 'none';
        if (selectCat) selectCat.value = '';
        if (selectLoc) selectLoc.value = '';
        if (selectBld) selectBld.value = '';
        if (selectCvor) selectCvor.value = '';
        if (selectStat) selectStat.value = '';

        fetchNetworkEquipment(1);
      });
    }

    // KPI Cards Quick Filter Clicks
    const kpiTotal = document.getElementById('kpi-card-net-total');
    if (kpiTotal) {
      kpiTotal.addEventListener('click', () => {
        state.currentCategory = '';
        state.currentStatus = '';
        if (selectCat) selectCat.value = '';
        if (selectStat) selectStat.value = '';
        fetchNetworkEquipment(1);
      });
    }

    const kpiSwitches = document.getElementById('kpi-card-net-switches');
    if (kpiSwitches) {
      kpiSwitches.addEventListener('click', () => {
        state.currentCategory = '6'; // SWITCH
        if (selectCat) selectCat.value = '6';
        fetchNetworkEquipment(1);
      });
    }

    const kpiRouters = document.getElementById('kpi-card-net-routers');
    if (kpiRouters) {
      kpiRouters.addEventListener('click', () => {
        state.currentCategory = '8'; // ROUTER
        if (selectCat) selectCat.value = '8';
        fetchNetworkEquipment(1);
      });
    }

    const kpiCvorovi = document.getElementById('kpi-card-net-cvorovi');
    if (kpiCvorovi) {
      kpiCvorovi.addEventListener('click', () => {
        state.currentCategory = '16'; // CVOR
        if (selectCat) selectCat.value = '16';
        fetchNetworkEquipment(1);
      });
    }

    const kpiActive = document.getElementById('kpi-card-net-active');
    if (kpiActive) {
      kpiActive.addEventListener('click', () => {
        state.currentStatus = '1'; // ISPRAVNO
        if (selectStat) selectStat.value = '1';
        fetchNetworkEquipment(1);
      });
    }

    // Top action buttons
    const btnAdd = document.getElementById('btn-add-net-equipment');
    if (btnAdd) btnAdd.addEventListener('click', () => openNetworkEditModal(null));

    const btnSync = document.getElementById('btn-sync-net-status');
    if (btnSync) btnSync.addEventListener('click', triggerNetworkSync);

    const btnExport = document.getElementById('btn-export-net-excel');
    if (btnExport) btnExport.addEventListener('click', exportNetworkExcel);

    // Employee search in modal
    const inEmpSearch = document.getElementById('net-edit-emp-search');
    if (inEmpSearch) {
      inEmpSearch.addEventListener('input', (e) => {
        handleNetEmployeeSearch(e.target.value);
      });
      inEmpSearch.addEventListener('focus', (e) => {
        if (e.target.value.trim().length >= 2) {
          handleNetEmployeeSearch(e.target.value);
        }
      });
    }

    const btnRemoveSelectedEmp = document.getElementById('btn-remove-net-selected-emp');
    if (btnRemoveSelectedEmp) {
      btnRemoveSelectedEmp.addEventListener('click', () => {
        setNetSelectedEmployee(null);
      });
    }

    // Close autocomplete on outside click
    document.addEventListener('click', (e) => {
      const list = document.getElementById('net-emp-autocomplete-list');
      const search = document.getElementById('net-edit-emp-search');
      if (list && list.style.display !== 'none') {
        if (!list.contains(e.target) && e.target !== search) {
          list.style.display = 'none';
        }
      }
    });

    // Form Edit Submit
    const formEdit = document.getElementById('form-net-equipment-edit');
    if (formEdit) formEdit.addEventListener('submit', handleNetworkSaveSubmit);

    // Modal Close Buttons
    const btnCloseModal = document.getElementById('btn-close-net-eq-modal');
    const btnCancelModal = document.getElementById('btn-cancel-net-eq-modal');
    if (btnCloseModal) btnCloseModal.addEventListener('click', () => window.closeModal?.(document.getElementById('modal-net-equipment-edit')));
    if (btnCancelModal) btnCancelModal.addEventListener('click', () => window.closeModal?.(document.getElementById('modal-net-equipment-edit')));

    // Logs modal close
    const btnCloseLogs = document.getElementById('btn-close-net-logs-modal');
    const btnCloseLogs2 = document.getElementById('btn-close-net-logs-btn');
    if (btnCloseLogs) btnCloseLogs.addEventListener('click', () => window.closeModal?.(document.getElementById('modal-net-equipment-logs')));
    if (btnCloseLogs2) btnCloseLogs2.addEventListener('click', () => window.closeModal?.(document.getElementById('modal-net-equipment-logs')));

    // Submit new log
    const btnSubmitLog = document.getElementById('btn-net-submit-log');
    if (btnSubmitLog) btnSubmitLog.addEventListener('click', handleAddNetworkLogSubmit);

    // Delete modal handlers
    const btnCloseDel = document.getElementById('btn-close-net-delete-modal');
    const btnCancelDel = document.getElementById('btn-cancel-net-delete');
    const btnConfirmDel = document.getElementById('btn-confirm-net-delete');
    if (btnCloseDel) btnCloseDel.addEventListener('click', () => window.closeModal?.(document.getElementById('modal-net-equipment-delete')));
    if (btnCancelDel) btnCancelDel.addEventListener('click', () => window.closeModal?.(document.getElementById('modal-net-equipment-delete')));
    if (btnConfirmDel) btnConfirmDel.addEventListener('click', handleConfirmNetworkDelete);

    // Table Row Actions Delegation
    const tbody = document.getElementById('tbody-network-equipment');
    if (tbody) {
      tbody.addEventListener('click', async (e) => {
        const btnEdit = e.target.closest('.btn-net-edit');
        if (btnEdit) {
          const id = parseInt(btnEdit.getAttribute('data-id'), 10);
          try {
            const res = await fetch(`/api/network-equipment/${id}`);
            const json = await res.json();
            if (json.success && json.data) openNetworkEditModal(json.data);
          } catch (err) {
            showToast('Greška pri učitavanju detalja: ' + err.message, 'error');
          }
          return;
        }

        const btnDel = e.target.closest('.btn-net-delete');
        if (btnDel) {
          const id = parseInt(btnDel.getAttribute('data-id'), 10);
          const name = btnDel.getAttribute('data-name');
          const cat = btnDel.getAttribute('data-cat');
          openNetworkDeleteModal(id, name, cat);
          return;
        }

        const btnLogs = e.target.closest('.btn-net-logs');
        if (btnLogs) {
          const id = parseInt(btnLogs.getAttribute('data-id'), 10);
          const name = btnLogs.getAttribute('data-name');
          openNetworkLogsModal(id, name);
          return;
        }
      });
    }

    // Timeline delete delegation
    const timeline = document.getElementById('net-logs-timeline');
    if (timeline) {
      timeline.addEventListener('click', (e) => {
        const btnDelLog = e.target.closest('.btn-delete-net-log');
        if (btnDelLog) {
          const id = parseInt(btnDelLog.getAttribute('data-id'), 10);
          handleDeleteNetworkLog(id);
        }
      });
    }

    // Pagination controls delegation
    const paginationContainer = document.getElementById('net-pagination-controls');
    if (paginationContainer) {
      paginationContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-net-page');
        if (!btn || btn.classList.contains('active')) return;
        const page = parseInt(btn.getAttribute('data-page'), 10);
        if (page > 0 && page <= state.totalPages) {
          fetchNetworkEquipment(page);
          const tableEl = document.getElementById('table-network-equipment') || document.getElementById('tab-network_equipment');
          if (tableEl) tableEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    }
  }

  function setupSseListener() {
    if (window.EventSource) {
      const evtSource = new EventSource('/api/equipment/events');
      evtSource.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (['equipment_created', 'equipment_updated', 'equipment_deleted', 'history_added', 'history_deleted', 'legacy_sync'].includes(data.type)) {
            const currentTab = document.querySelector('.nav-tab-btn.active')?.getAttribute('data-tab');
            if (currentTab === 'network_equipment') {
              fetchNetworkStats();
              fetchNetworkEquipment(state.currentPage);
            }
          }
        } catch (err) {
          // Ignore parse errors
        }
      };
    }
  }

  // Public module API
  window.networkEquipmentModule = {
    init: function () {
      if (state.hasInitialized) {
        fetchNetworkStats();
        fetchNetworkEquipment(state.currentPage);
        return;
      }
      state.hasInitialized = true;
      bindEvents();
      setupSseListener();
      fetchNetworkStats();
      fetchCodebooks();
      fetchNetworkEquipment(1);
    },
    refresh: function () {
      fetchNetworkStats();
      fetchNetworkEquipment(state.currentPage);
    }
  };

  // Preload badge on DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    fetchNetworkStats();
  });
})();
