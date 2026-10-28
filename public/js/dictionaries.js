/**
 * ==========================================================================
 * UNIPROMET IT ADMIN - DICTIONARIES & CODEBOOKS (ŠIFARNICI) MODULE
 * Handles Rooms (kancelarije), Buildings (objekti), Locations (lokacije),
 * Categories (kategorije) & Statuses (statusi) with full CRUD operations.
 * ==========================================================================
 */

(function () {
  'use strict';

  // Module State
  const state = {
    activeSubTab: 'rooms', // 'rooms' | 'buildings' | 'locations' | 'categories' | 'statuses'
    searchQueries: {
      rooms: '',
      buildings: '',
      locations: '',
      categories: '',
      statuses: ''
    },
    filterRoomBuilding: 'all',
    data: {
      rooms: [],
      buildings: [],
      locations: [],
      categories: [],
      statuses: []
    },
    isLoading: false,
    hasInitialized: false
  };

  // Helper: Escape HTML
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Toast notification helper
  function notify(msg, type = 'info') {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type);
    } else {
      console.log(`[Toast] [${type}] ${msg}`);
    }
  }

  // Refresh all dictionary caches
  async function fetchAllDictionaries() {
    try {
      const [resRooms, resBuildings, resLocations, resCategories, resStatuses] = await Promise.all([
        fetch('/api/equipment/dictionaries/rooms').then(r => r.json()),
        fetch('/api/equipment/dictionaries/buildings').then(r => r.json()),
        fetch('/api/equipment/dictionaries/locations').then(r => r.json()),
        fetch('/api/equipment/dictionaries/categories').then(r => r.json()),
        fetch('/api/equipment/dictionaries/statuses').then(r => r.json())
      ]);

      if (resRooms.success) state.data.rooms = resRooms.data || [];
      if (resBuildings.success) state.data.buildings = resBuildings.data || [];
      if (resLocations.success) state.data.locations = resLocations.data || [];
      if (resCategories.success) state.data.categories = resCategories.data || [];
      if (resStatuses.success) state.data.statuses = resStatuses.data || [];

      updateSubTabBadges();
      populateRoomBuildingFilterDropdown();
      renderCurrentSubPanel();
    } catch (err) {
      console.error('[Dictionaries] Greška pri preuzimanju šifarnika:', err);
      notify('Greška pri učitavanju podataka šifarnika', 'error');
    }
  }

  // Update badge counters on tabs
  function updateSubTabBadges() {
    const badgeRooms = document.getElementById('badge-dict-rooms');
    const badgeBuildings = document.getElementById('badge-dict-buildings');
    const badgeLocations = document.getElementById('badge-dict-locations');
    const badgeCategories = document.getElementById('badge-dict-categories');
    const badgeStatuses = document.getElementById('badge-dict-statuses');

    if (badgeRooms) badgeRooms.textContent = state.data.rooms.length;
    if (badgeBuildings) badgeBuildings.textContent = state.data.buildings.length;
    if (badgeLocations) badgeLocations.textContent = state.data.locations.length;
    if (badgeCategories) badgeCategories.textContent = state.data.categories.length;
    if (badgeStatuses) badgeStatuses.textContent = state.data.statuses.length;
  }

  // Populate Building filter select inside Rooms subpanel
  function populateRoomBuildingFilterDropdown() {
    const select = document.getElementById('filter-dict-room-building');
    if (!select) return;

    const currentVal = select.value || 'all';
    let html = '<option value="all">Svi Objekti (Sve Kancelarije)</option>';
    state.data.buildings.forEach(b => {
      html += `<option value="${b.id}">${escapeHtml(b.name)} (#${b.id})</option>`;
    });
    select.innerHTML = html;
    select.value = currentVal;
  }

  // Switch Active Sub-tab
  // Switch Active Sub-tab
  function switchSubTab(subTabName) {
    state.activeSubTab = subTabName;

    // Toggle pill buttons
    document.querySelectorAll('.eq-pill-btn[data-dict-tab], .dict-tab-btn[data-dict-tab]').forEach(btn => {
      const match = btn.getAttribute('data-dict-tab') === subTabName;
      btn.classList.toggle('active', match);
    });

    // Toggle subpanel containers
    document.querySelectorAll('.dict-subpanel').forEach(panel => {
      const match = panel.id === `dict-panel-${subTabName}`;
      panel.classList.toggle('active', match);
    });

    renderCurrentSubPanel();
  }

  // Render the currently active subpanel
  function renderCurrentSubPanel() {
    switch (state.activeSubTab) {
      case 'rooms':
        renderRoomsTable();
        break;
      case 'buildings':
        renderBuildingsTable();
        break;
      case 'locations':
        renderLocationsTable();
        break;
      case 'categories':
        renderCategoriesTable();
        break;
      case 'statuses':
        renderStatusesTable();
        break;
    }
    if (window.lucide) window.lucide.createIcons();
  }

  // 1. Render Rooms Table (Kancelarije)
  function renderRoomsTable() {
    const tbody = document.getElementById('tbody-dict-rooms');
    const countEl = document.getElementById('count-dict-rooms');
    if (!tbody) return;

    let items = state.data.rooms;
    const q = state.searchQueries.rooms.toLowerCase().trim();
    const bId = state.filterRoomBuilding;

    if (bId !== 'all') {
      items = items.filter(r => String(r.building) === String(bId));
    }

    if (q) {
      items = items.filter(r => 
        (r.code && r.code.toLowerCase().includes(q)) ||
        (r.short_desc && r.short_desc.toLowerCase().includes(q)) ||
        (r.name && r.name.toLowerCase().includes(q)) ||
        (r.building_name && r.building_name.toLowerCase().includes(q)) ||
        (r.floor && r.floor.toLowerCase().includes(q))
      );
    }

    if (countEl) countEl.textContent = `Prikazano: ${items.length} od ${state.data.rooms.length} kancelarija`;

    if (items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 36px 16px; color: #94a3b8;">
            <div style="font-size: 1.5rem; margin-bottom: 6px;">🏢</div>
            <div>Nema pronađenih kancelarija za date filtere.</div>
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = items.map(r => {
      const buildingLabel = r.building_name 
        ? `<span class="dict-building-chip"><i data-lucide="building-2"></i> ${escapeHtml(r.building_name)}</span>`
        : `<span class="text-dim">—</span>`;
      
      const floorLabel = r.floor != null && String(r.floor).trim() !== ''
        ? `<span class="dict-floor-badge"><i data-lucide="layers"></i> Sprat ${escapeHtml(r.floor)}</span>`
        : `<span class="dict-floor-badge" style="opacity: 0.7;">Prizemlje</span>`;

      const usageBadge = `
        <span class="dict-usage-badge ${r.usage_count > 0 ? 'has-items' : 'is-empty'}">
          <i data-lucide="monitor"></i>
          <span>${r.usage_count || 0} opreme</span>
        </span>`;

      return `
        <tr>
          <td style="text-align: center;"><span class="dict-id-badge">#${r.id}</span></td>
          <td>
            <span class="dict-code-badge">${escapeHtml(r.code || '—')}</span>
          </td>
          <td>${buildingLabel}</td>
          <td>${floorLabel}</td>
          <td style="font-weight: 600; color: #ffffff;">${escapeHtml(r.short_desc || '—')}</td>
          <td style="color: #cbd5e1; font-size: 0.82rem; max-width: 300px;" class="truncate">${escapeHtml(r.name || '—')}</td>
          <td style="text-align: center;">${usageBadge}</td>
          <td style="text-align: center;">
            <div class="inv-actions-cell" style="justify-content: center;">
              <button class="btn-inv-action btn-edit" data-edit-dict="room" data-id="${r.id}" title="Izmeni kancelariju">
                <i data-lucide="pencil"></i>
              </button>
              <button class="btn-inv-action btn-danger btn-delete" data-delete-dict="room" data-id="${r.id}" data-name="${escapeHtml(r.short_desc || r.name || r.code || r.id)}" title="Obriši kancelariju">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  // 2. Render Buildings Table (Objekti)
  function renderBuildingsTable() {
    const tbody = document.getElementById('tbody-dict-buildings');
    const countEl = document.getElementById('count-dict-buildings');
    if (!tbody) return;

    let items = state.data.buildings;
    const q = state.searchQueries.buildings.toLowerCase().trim();

    if (q) {
      items = items.filter(b => 
        (b.name && b.name.toLowerCase().includes(q)) ||
        (b.code && b.code.toLowerCase().includes(q)) ||
        (b.description && b.description.toLowerCase().includes(q)) ||
        (b.location_name && b.location_name.toLowerCase().includes(q))
      );
    }

    if (countEl) countEl.textContent = `Prikazano: ${items.length} od ${state.data.buildings.length} objekata`;

    if (items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 36px 16px; color: #94a3b8;">
            <div style="font-size: 1.5rem; margin-bottom: 6px;">🏗️</div>
            <div>Nema pronađenih objekata.</div>
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = items.map(b => {
      const locLabel = b.location_name
        ? `<span class="dict-location-chip"><i data-lucide="map-pin"></i> ${escapeHtml(b.location_name)}</span>`
        : `<span class="text-dim">—</span>`;

      const roomsBadge = `
        <span class="dict-usage-badge ${b.rooms_count > 0 ? 'has-items' : 'is-empty'}">
          <i data-lucide="door-open"></i>
          <span>${b.rooms_count || 0} kanc.</span>
        </span>`;

      const usageBadge = `
        <span class="dict-usage-badge ${b.usage_count > 0 ? 'has-items' : 'is-empty'}">
          <i data-lucide="monitor"></i>
          <span>${b.usage_count || 0} opreme</span>
        </span>`;

      return `
        <tr>
          <td style="text-align: center;"><span class="dict-id-badge">#${b.id}</span></td>
          <td><span class="dict-code-badge">${escapeHtml(b.code || '—')}</span></td>
          <td>
            <div class="eq-name-cell">
              <div class="eq-avatar" style="background: rgba(56, 189, 248, 0.12); border-color: rgba(56, 189, 248, 0.28); color: #38bdf8;">
                <i data-lucide="building-2"></i>
              </div>
              <div class="eq-info-block">
                <span class="eq-name-title" style="font-size: 0.86rem;">${escapeHtml(b.name)}</span>
              </div>
            </div>
          </td>
          <td>${locLabel}</td>
          <td style="color: #cbd5e1; font-size: 0.82rem; max-width: 280px;" class="truncate">${escapeHtml(b.description || '—')}</td>
          <td style="text-align: center;">${roomsBadge}</td>
          <td style="text-align: center;">${usageBadge}</td>
          <td style="text-align: center;">
            <div class="inv-actions-cell" style="justify-content: center;">
              <button class="btn-inv-action btn-edit" data-edit-dict="building" data-id="${b.id}" title="Izmeni objekat">
                <i data-lucide="pencil"></i>
              </button>
              <button class="btn-inv-action btn-danger btn-delete" data-delete-dict="building" data-id="${b.id}" data-name="${escapeHtml(b.name)}" title="Obriši objekat">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  // 3. Render Locations Table (Lokacije)
  function renderLocationsTable() {
    const tbody = document.getElementById('tbody-dict-locations');
    const countEl = document.getElementById('count-dict-locations');
    if (!tbody) return;

    let items = state.data.locations;
    const q = state.searchQueries.locations.toLowerCase().trim();

    if (q) {
      items = items.filter(l => l.name && l.name.toLowerCase().includes(q));
    }

    if (countEl) countEl.textContent = `Prikazano: ${items.length} od ${state.data.locations.length} lokacija`;

    if (items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align: center; padding: 36px 16px; color: #94a3b8;">
            <div style="font-size: 1.5rem; margin-bottom: 6px;">📍</div>
            <div>Nema pronađenih lokacija.</div>
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = items.map(l => {
      const usageBadge = `
        <span class="dict-usage-badge ${l.usage_count > 0 ? 'has-items' : 'is-empty'}">
          <i data-lucide="monitor"></i>
          <span>${l.usage_count || 0} opreme</span>
        </span>`;

      return `
        <tr>
          <td style="text-align: center;"><span class="dict-id-badge">#${l.id}</span></td>
          <td>
            <div class="eq-name-cell">
              <div class="eq-avatar" style="background: rgba(168, 85, 247, 0.12); border-color: rgba(168, 85, 247, 0.28); color: #c084fc;">
                <i data-lucide="map-pin"></i>
              </div>
              <div class="eq-info-block">
                <span class="eq-name-title" style="font-size: 0.88rem;">${escapeHtml(l.name)}</span>
              </div>
            </div>
          </td>
          <td style="text-align: center;">${usageBadge}</td>
          <td style="text-align: center;">
            <div class="inv-actions-cell" style="justify-content: center;">
              <button class="btn-inv-action btn-edit" data-edit-dict="location" data-id="${l.id}" title="Izmeni lokaciju">
                <i data-lucide="pencil"></i>
              </button>
              <button class="btn-inv-action btn-danger btn-delete" data-delete-dict="location" data-id="${l.id}" data-name="${escapeHtml(l.name)}" title="Obriši lokaciju">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  // 4. Render Categories Table (Kategorije Opreme)
  function renderCategoriesTable() {
    const tbody = document.getElementById('tbody-dict-categories');
    const countEl = document.getElementById('count-dict-categories');
    if (!tbody) return;

    let items = state.data.categories;
    const q = state.searchQueries.categories.toLowerCase().trim();

    if (q) {
      items = items.filter(c => 
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.icon && c.icon.toLowerCase().includes(q))
      );
    }

    if (countEl) countEl.textContent = `Prikazano: ${items.length} od ${state.data.categories.length} kategorija`;

    if (items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 36px 16px; color: #94a3b8;">
            <div style="font-size: 1.5rem; margin-bottom: 6px;">🏷️</div>
            <div>Nema pronađenih kategorija opreme.</div>
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = items.map(c => {
      const isNetBadge = c.is_network === 1
        ? `<span class="badge-eq-status status-in-use" style="font-size: 0.72rem; padding: 2px 8px;"><span class="status-dot"></span> Mrežni uređaj</span>`
        : `<span class="badge-eq-status status-reserve" style="font-size: 0.72rem; padding: 2px 8px;"><span class="status-dot"></span> Standardna oprema</span>`;

      const usageBadge = `
        <span class="dict-usage-badge ${c.usage_count > 0 ? 'has-items' : 'is-empty'}">
          <i data-lucide="monitor"></i>
          <span>${c.usage_count || 0} opreme</span>
        </span>`;

      return `
        <tr>
          <td style="text-align: center;"><span class="dict-id-badge">#${c.id}</span></td>
          <td>
            <div class="eq-name-cell">
              <div class="eq-avatar" style="background: rgba(255, 184, 0, 0.12); border-color: rgba(255, 184, 0, 0.28); color: var(--yellow-primary);">
                <i data-lucide="${escapeHtml(c.icon || 'package')}"></i>
              </div>
              <div class="eq-info-block">
                <span class="eq-name-title" style="font-size: 0.86rem;">${escapeHtml(c.name)}</span>
              </div>
            </div>
          </td>
          <td><span class="dict-code-badge">${escapeHtml(c.icon || 'package')}</span></td>
          <td>${isNetBadge}</td>
          <td style="text-align: center;">${usageBadge}</td>
          <td style="text-align: center;">
            <div class="inv-actions-cell" style="justify-content: center;">
              <button class="btn-inv-action btn-edit" data-edit-dict="category" data-id="${c.id}" title="Izmeni kategoriju">
                <i data-lucide="pencil"></i>
              </button>
              <button class="btn-inv-action btn-danger btn-delete" data-delete-dict="category" data-id="${c.id}" data-name="${escapeHtml(c.name)}" title="Obriši kategoriju">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  // 5. Render Statuses Table (Statusi Opreme)
  function renderStatusesTable() {
    const tbody = document.getElementById('tbody-dict-statuses');
    const countEl = document.getElementById('count-dict-statuses');
    if (!tbody) return;

    let items = state.data.statuses;
    const q = state.searchQueries.statuses.toLowerCase().trim();

    if (q) {
      items = items.filter(s => 
        (s.name && s.name.toLowerCase().includes(q)) ||
        (s.color && s.color.toLowerCase().includes(q))
      );
    }

    if (countEl) countEl.textContent = `Prikazano: ${items.length} od ${state.data.statuses.length} statusa`;

    if (items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 36px 16px; color: #94a3b8;">
            <div style="font-size: 1.5rem; margin-bottom: 6px;">⚡</div>
            <div>Nema pronađenih statusa opreme.</div>
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = items.map(s => {
      const colorClass = `color-${s.color || 'gray'}`;
      const statusPill = `
        <span class="dict-status-color-pill ${colorClass}">
          <span class="status-color-dot"></span>
          ${escapeHtml(s.name)}
        </span>`;

      const usageBadge = `
        <span class="dict-usage-badge ${s.usage_count > 0 ? 'has-items' : 'is-empty'}">
          <i data-lucide="monitor"></i>
          <span>${s.usage_count || 0} opreme</span>
        </span>`;

      return `
        <tr>
          <td style="text-align: center;"><span class="dict-id-badge">#${s.id}</span></td>
          <td>${statusPill}</td>
          <td><span class="dict-code-badge">${escapeHtml(s.color || 'gray')}</span></td>
          <td style="text-align: center;">${usageBadge}</td>
          <td style="text-align: center;">
            <div class="inv-actions-cell" style="justify-content: center;">
              <button class="btn-inv-action btn-edit" data-edit-dict="status" data-id="${s.id}" title="Izmeni status">
                <i data-lucide="pencil"></i>
              </button>
              <button class="btn-inv-action btn-danger btn-delete" data-delete-dict="status" data-id="${s.id}" data-name="${escapeHtml(s.name)}" title="Obriši status">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  // =========================================================================
  // MODAL HANDLERS FOR CRUD OPERATIONS
  // =========================================================================

  // A. Room Modal (Kancelarija)
  function openRoomModal(room = null) {
    const modal = document.getElementById('modal-dict-room');
    const form = document.getElementById('form-dict-room');
    const title = document.getElementById('modal-dict-room-title');
    if (!modal || !form) return;

    form.reset();
    document.getElementById('dict-room-id').value = room ? room.id : '';
    title.textContent = room ? `Izmena Kancelarije (#${room.id})` : 'Nova Kancelarija / Prostorija';

    // Populate Building options
    const bSelect = document.getElementById('dict-room-building');
    if (bSelect) {
      let bHtml = '<option value="">— Izaberite objekat —</option>';
      state.data.buildings.forEach(b => {
        bHtml += `<option value="${b.id}" ${room && String(room.building) === String(b.id) ? 'selected' : ''}>${escapeHtml(b.name)} (#${b.id})</option>`;
      });
      bSelect.innerHTML = bHtml;
    }

    if (room) {
      document.getElementById('dict-room-code').value = room.code || '';
      document.getElementById('dict-room-floor').value = room.floor || '';
      document.getElementById('dict-room-short-desc').value = room.short_desc || '';
      document.getElementById('dict-room-name').value = room.name || '';
    }

    if (typeof window.openModal === 'function') window.openModal(modal);
    else modal.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons();
  }

  async function handleSaveRoom(e) {
    e.preventDefault();
    const id = document.getElementById('dict-room-id').value;
    const code = document.getElementById('dict-room-code').value;
    const building = document.getElementById('dict-room-building').value;
    const floor = document.getElementById('dict-room-floor').value;
    const short_desc = document.getElementById('dict-room-short-desc').value;
    const name = document.getElementById('dict-room-name').value;

    const payload = { code, building, floor, short_desc, name };
    const url = id ? `/api/equipment/dictionaries/rooms/${id}` : '/api/equipment/dictionaries/rooms';
    const method = id ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Greška pri čuvanju');

      notify(id ? 'Kancelarija je ažurirana' : 'Nova kancelarija je dodata', 'success');
      const modal = document.getElementById('modal-dict-room');
      if (typeof window.closeModal === 'function') window.closeModal(modal);
      else if (modal) modal.style.display = 'none';

      fetchAllDictionaries();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  // B. Building Modal (Objekat)
  function openBuildingModal(building = null) {
    const modal = document.getElementById('modal-dict-building');
    const form = document.getElementById('form-dict-building');
    const title = document.getElementById('modal-dict-building-title');
    if (!modal || !form) return;

    form.reset();
    document.getElementById('dict-building-id').value = building ? building.id : '';
    title.textContent = building ? `Izmena Objekta (#${building.id})` : 'Novi Objekat';

    // Populate Location options
    const locSelect = document.getElementById('dict-building-location');
    if (locSelect) {
      let lHtml = '<option value="">— Izaberite lokaciju —</option>';
      state.data.locations.forEach(l => {
        lHtml += `<option value="${l.id}" ${building && String(building.location_id) === String(l.id) ? 'selected' : ''}>${escapeHtml(l.name)} (#${l.id})</option>`;
      });
      locSelect.innerHTML = lHtml;
    }

    if (building) {
      document.getElementById('dict-building-name').value = building.name || '';
      document.getElementById('dict-building-code').value = building.code || '';
      document.getElementById('dict-building-desc').value = building.description || '';
    }

    if (typeof window.openModal === 'function') window.openModal(modal);
    else modal.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons();
  }

  async function handleSaveBuilding(e) {
    e.preventDefault();
    const id = document.getElementById('dict-building-id').value;
    const name = document.getElementById('dict-building-name').value;
    const code = document.getElementById('dict-building-code').value;
    const location_id = document.getElementById('dict-building-location').value;
    const description = document.getElementById('dict-building-desc').value;

    const payload = { name, code, location_id, description };
    const url = id ? `/api/equipment/dictionaries/buildings/${id}` : '/api/equipment/dictionaries/buildings';
    const method = id ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Greška pri čuvanju');

      notify(id ? 'Objekat je ažuriran' : 'Novi objekat je dodat', 'success');
      const modal = document.getElementById('modal-dict-building');
      if (typeof window.closeModal === 'function') window.closeModal(modal);
      else if (modal) modal.style.display = 'none';

      fetchAllDictionaries();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  // C. Location Modal (Lokacija)
  function openLocationModal(loc = null) {
    const modal = document.getElementById('modal-dict-location');
    const form = document.getElementById('form-dict-location');
    const title = document.getElementById('modal-dict-location-title');
    if (!modal || !form) return;

    form.reset();
    document.getElementById('dict-location-id').value = loc ? loc.id : '';
    title.textContent = loc ? `Izmena Lokacije (#${loc.id})` : 'Nova Lokacija';

    if (loc) {
      document.getElementById('dict-location-name').value = loc.name || '';
    }

    if (typeof window.openModal === 'function') window.openModal(modal);
    else modal.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons();
  }

  async function handleSaveLocation(e) {
    e.preventDefault();
    const id = document.getElementById('dict-location-id').value;
    const name = document.getElementById('dict-location-name').value;

    const payload = { name };
    const url = id ? `/api/equipment/dictionaries/locations/${id}` : '/api/equipment/dictionaries/locations';
    const method = id ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Greška pri čuvanju');

      notify(id ? 'Lokacija je ažurirana' : 'Nova lokacija je dodata', 'success');
      const modal = document.getElementById('modal-dict-location');
      if (typeof window.closeModal === 'function') window.closeModal(modal);
      else if (modal) modal.style.display = 'none';

      fetchAllDictionaries();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  // D. Category Modal (Kategorija Opreme)
  function openCategoryModal(cat = null) {
    const modal = document.getElementById('modal-dict-category');
    const form = document.getElementById('form-dict-category');
    const title = document.getElementById('modal-dict-category-title');
    if (!modal || !form) return;

    form.reset();
    document.getElementById('dict-category-id').value = cat ? cat.id : '';
    title.textContent = cat ? `Izmena Kategorije (#${cat.id})` : 'Nova Kategorija Opreme';

    if (cat) {
      document.getElementById('dict-category-name').value = cat.name || '';
      document.getElementById('dict-category-icon').value = cat.icon || 'package';
      document.getElementById('dict-category-is-network').checked = cat.is_network === 1;
    } else {
      document.getElementById('dict-category-icon').value = 'package';
      document.getElementById('dict-category-is-network').checked = false;
    }

    if (typeof window.openModal === 'function') window.openModal(modal);
    else modal.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons();
  }

  async function handleSaveCategory(e) {
    e.preventDefault();
    const id = document.getElementById('dict-category-id').value;
    const name = document.getElementById('dict-category-name').value;
    const icon = document.getElementById('dict-category-icon').value;
    const is_network = document.getElementById('dict-category-is-network').checked ? 1 : 0;

    const payload = { name, icon, is_network };
    const url = id ? `/api/equipment/dictionaries/categories/${id}` : '/api/equipment/dictionaries/categories';
    const method = id ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Greška pri čuvanju');

      notify(id ? 'Kategorija je ažurirana' : 'Nova kategorija je dodata', 'success');
      const modal = document.getElementById('modal-dict-category');
      if (typeof window.closeModal === 'function') window.closeModal(modal);
      else if (modal) modal.style.display = 'none';

      fetchAllDictionaries();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  // E. Status Modal (Status Opreme)
  function openStatusModal(status = null) {
    const modal = document.getElementById('modal-dict-status');
    const form = document.getElementById('form-dict-status');
    const title = document.getElementById('modal-dict-status-title');
    if (!modal || !form) return;

    form.reset();
    document.getElementById('dict-status-id').value = status ? status.id : '';
    title.textContent = status ? `Izmena Statusa (#${status.id})` : 'Novi Status Opreme';

    if (status) {
      document.getElementById('dict-status-name').value = status.name || '';
      document.getElementById('dict-status-color').value = status.color || 'gray';
    } else {
      document.getElementById('dict-status-color').value = 'gray';
    }

    if (typeof window.openModal === 'function') window.openModal(modal);
    else modal.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons();
  }

  async function handleSaveStatus(e) {
    e.preventDefault();
    const id = document.getElementById('dict-status-id').value;
    const name = document.getElementById('dict-status-name').value;
    const color = document.getElementById('dict-status-color').value;

    const payload = { name, color };
    const url = id ? `/api/equipment/dictionaries/statuses/${id}` : '/api/equipment/dictionaries/statuses';
    const method = id ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Greška pri čuvanju');

      notify(id ? 'Status je ažuriran' : 'Novi status je dodat', 'success');
      const modal = document.getElementById('modal-dict-status');
      if (typeof window.closeModal === 'function') window.closeModal(modal);
      else if (modal) modal.style.display = 'none';

      fetchAllDictionaries();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  // Universal Delete Handler
  async function handleDeleteDictionaryItem(dictType, id, itemName) {
    const typeLabels = {
      room: 'kancelariju',
      building: 'objekat',
      location: 'lokaciju',
      category: 'kategoriju',
      status: 'status'
    };

    const typeEndpoints = {
      room: 'rooms',
      building: 'buildings',
      location: 'locations',
      category: 'categories',
      status: 'statuses'
    };

    const label = typeLabels[dictType] || 'zapis';
    if (!confirm(`Da li ste sigurni da želite da obrišete ${label} "${itemName}" (#${id})?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/equipment/dictionaries/${typeEndpoints[dictType]}/${id}`, {
        method: 'DELETE'
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Nije moguće obrisati zapis');

      notify(`Zapis #${id} je uspešno obrisan`, 'success');
      fetchAllDictionaries();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  // =========================================================================
  // EVENT LISTENERS & INITIALIZATION
  // =========================================================================

  function initEventListeners() {
    // Sub-tab Navigation Clicks
    document.querySelectorAll('.eq-pill-btn[data-dict-tab], .dict-tab-btn[data-dict-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-dict-tab');
        if (targetTab) switchSubTab(targetTab);
      });
    });

    // Sub-panel Search Inputs & Clear Buttons
    const searchMap = {
      'search-dict-rooms': { type: 'rooms', clearBtn: 'btn-clear-search-dict-rooms' },
      'search-dict-buildings': { type: 'buildings', clearBtn: 'btn-clear-search-dict-buildings' },
      'search-dict-locations': { type: 'locations', clearBtn: 'btn-clear-search-dict-locations' },
      'search-dict-categories': { type: 'categories', clearBtn: 'btn-clear-search-dict-categories' },
      'search-dict-statuses': { type: 'statuses', clearBtn: 'btn-clear-search-dict-statuses' }
    };

    for (const [inputId, config] of Object.entries(searchMap)) {
      const input = document.getElementById(inputId);
      const clearBtn = document.getElementById(config.clearBtn);
      
      if (input) {
        input.addEventListener('input', (e) => {
          state.searchQueries[config.type] = e.target.value;
          if (clearBtn) clearBtn.style.display = e.target.value ? 'inline-flex' : 'none';
          renderCurrentSubPanel();
        });
      }

      if (clearBtn && input) {
        clearBtn.addEventListener('click', () => {
          input.value = '';
          state.searchQueries[config.type] = '';
          clearBtn.style.display = 'none';
          renderCurrentSubPanel();
        });
      }
    }

    // Room Building Filter
    const filterBuilding = document.getElementById('filter-dict-room-building');
    if (filterBuilding) {
      filterBuilding.addEventListener('change', (e) => {
        state.filterRoomBuilding = e.target.value;
        renderRoomsTable();
        if (window.lucide) window.lucide.createIcons();
      });
    }

    // Global "Refresh / Sync" Button in Header
    const btnSync = document.getElementById('btn-sync-dictionaries');
    if (btnSync) {
      btnSync.addEventListener('click', async () => {
        const icon = btnSync.querySelector('i, svg');
        if (icon) icon.classList.add('spin-animation');
        notify('Sinhronizacija šifarnika sa serverom 192.168.121.20...', 'info');
        try {
          const res = await fetch('/api/equipment/dictionaries/sync', { method: 'POST' });
          const json = await res.json();
          if (json.success) {
            notify(`Šifarnici su uspešno sinhronizovani (${json.durationMs}ms)`, 'success');
          } else {
            notify(json.error || 'Greška pri sinhronizaciji', 'error');
          }
        } catch (err) {
          notify('Greška pri komunikaciji sa serverom', 'error');
        } finally {
          await fetchAllDictionaries();
          if (icon) icon.classList.remove('spin-animation');
        }
      });
    }

    // "Add New" Buttons per sub-panel
    document.getElementById('btn-add-dict-room')?.addEventListener('click', () => openRoomModal());
    document.getElementById('btn-add-dict-building')?.addEventListener('click', () => openBuildingModal());
    document.getElementById('btn-add-dict-location')?.addEventListener('click', () => openLocationModal());
    document.getElementById('btn-add-dict-category')?.addEventListener('click', () => openCategoryModal());
    document.getElementById('btn-add-dict-status')?.addEventListener('click', () => openStatusModal());

    // Form Submissions
    document.getElementById('form-dict-room')?.addEventListener('submit', handleSaveRoom);
    document.getElementById('form-dict-building')?.addEventListener('submit', handleSaveBuilding);
    document.getElementById('form-dict-location')?.addEventListener('submit', handleSaveLocation);
    document.getElementById('form-dict-category')?.addEventListener('submit', handleSaveCategory);
    document.getElementById('form-dict-status')?.addEventListener('submit', handleSaveStatus);

    // Modal Close / Cancel Buttons
    const cancelModal = (modalId) => {
      const m = document.getElementById(modalId);
      if (typeof window.closeModal === 'function') window.closeModal(m);
      else if (m) m.style.display = 'none';
    };

    document.getElementById('btn-close-dict-room-modal')?.addEventListener('click', () => cancelModal('modal-dict-room'));
    document.getElementById('btn-cancel-dict-room-modal')?.addEventListener('click', () => cancelModal('modal-dict-room'));

    document.getElementById('btn-close-dict-building-modal')?.addEventListener('click', () => cancelModal('modal-dict-building'));
    document.getElementById('btn-cancel-dict-building-modal')?.addEventListener('click', () => cancelModal('modal-dict-building'));

    document.getElementById('btn-close-dict-location-modal')?.addEventListener('click', () => cancelModal('modal-dict-location'));
    document.getElementById('btn-cancel-dict-location-modal')?.addEventListener('click', () => cancelModal('modal-dict-location'));

    document.getElementById('btn-close-dict-category-modal')?.addEventListener('click', () => cancelModal('modal-dict-category'));
    document.getElementById('btn-cancel-dict-category-modal')?.addEventListener('click', () => cancelModal('modal-dict-category'));

    document.getElementById('btn-close-dict-status-modal')?.addEventListener('click', () => cancelModal('modal-dict-status'));
    document.getElementById('btn-cancel-dict-status-modal')?.addEventListener('click', () => cancelModal('modal-dict-status'));

    // Delegated Table Clicks for Edit & Delete Actions
    document.addEventListener('click', (e) => {
      const editBtn = e.target.closest('[data-edit-dict]');
      if (editBtn) {
        const type = editBtn.getAttribute('data-edit-dict');
        const id = parseInt(editBtn.getAttribute('data-id'), 10);
        if (type === 'room') {
          const room = state.data.rooms.find(r => r.id === id);
          if (room) openRoomModal(room);
        } else if (type === 'building') {
          const b = state.data.buildings.find(x => x.id === id);
          if (b) openBuildingModal(b);
        } else if (type === 'location') {
          const l = state.data.locations.find(x => x.id === id);
          if (l) openLocationModal(l);
        } else if (type === 'category') {
          const c = state.data.categories.find(x => x.id === id);
          if (c) openCategoryModal(c);
        } else if (type === 'status') {
          const s = state.data.statuses.find(x => x.id === id);
          if (s) openStatusModal(s);
        }
        return;
      }

      const deleteBtn = e.target.closest('[data-delete-dict]');
      if (deleteBtn) {
        const type = deleteBtn.getAttribute('data-delete-dict');
        const id = parseInt(deleteBtn.getAttribute('data-id'), 10);
        const name = deleteBtn.getAttribute('data-name') || id;
        handleDeleteDictionaryItem(type, id, name);
        return;
      }
    });
  }

  // Public Module Interface
  window.DictionariesModule = {
    init() {
      if (state.hasInitialized) return;
      state.hasInitialized = true;
      initEventListeners();
      fetchAllDictionaries();
    },
    refresh() {
      fetchAllDictionaries();
    },
    switchTab(subTabName) {
      switchSubTab(subTabName);
    }
  };

})();
