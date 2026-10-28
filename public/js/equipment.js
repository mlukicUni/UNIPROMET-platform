/**
 * ==========================================================================
 * UNIPROMET IT ADMIN - EVIDENCIJA OPREME CLIENT MODULE
 * Handles Dynamic Sidebar (Option B), Luxury Glass Table,
 * Live Navision 2016 Employee Enrichment, KPI Cards & Pagination.
 * ==========================================================================
 */

(function () {
  // Universal Modal Helpers
  if (!window.openModal) {
    window.openModal = function(modalOrId) {
      const m = typeof modalOrId === 'string' ? document.getElementById(modalOrId) : modalOrId;
      if (!m) return;
      m.classList.remove('modal-closing');
      m.style.display = 'flex';
      if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
    };
  }

  if (!window.closeModal) {
    window.closeModal = function(modalOrId, callback) {
      const m = typeof modalOrId === 'string' ? document.getElementById(modalOrId) : modalOrId;
      if (!m || m.style.display === 'none') return;
      if (m.classList.contains('modal-closing')) return;
      m.classList.add('modal-closing');
      setTimeout(() => {
        m.style.display = 'none';
        m.classList.remove('modal-closing');
        if (typeof callback === 'function') callback();
      }, 275);
    };
  }

  // Module State
  const state = {
    currentCategoryId: null, // null means "Sva oprema"
    currentCategoryName: 'Sva IT Oprema',
    currentStatusId: null,
    currentStatusGroup: null, // 'service' | 'in_use' | 'in_reserve' | null
    currentLocationId: null,
    searchQuery: '',
    currentPage: 1,
    pageSize: 50,
    totalItems: 0,
    totalPages: 1,
    categories: [],
    statuses: [],
    locations: [],
    rooms: [],
    isLoading: false,
    hasInitialized: false,
    searchDebounceTimer: null,
    syncDebounceTimer: null
  };

  // Helper: Safely escape HTML to prevent XSS
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Helper: Format category icon
  function getCategoryIcon(catId, catName, defaultIcon) {
    if (defaultIcon) return defaultIcon;
    const n = (catName || '').toLowerCase();
    if (n.includes('racunar') || n.includes('računar')) return 'monitor';
    if (n.includes('laptop')) return 'laptop';
    if (n.includes('stampac') || n.includes('štampač') || n.includes('multifunk')) return 'printer';
    if (n.includes('skener')) return 'scan';
    if (n.includes('monitor')) return 'tv';
    if (n.includes('server')) return 'server';
    if (n.includes('ups')) return 'battery-charging';
    if (n.includes('switch') || n.includes('svič')) return 'network';
    if (n.includes('ruter') || n.includes('router') || n.includes('wifi') || n.includes('ap')) return 'wifi';
    if (n.includes('kamera')) return 'camera';
    if (n.includes('snimac') || n.includes('snimač')) return 'hard-drive';
    if (n.includes('telefon') || n.includes('voip')) return 'phone';
    if (n.includes('tablet')) return 'tablet';
    return 'box';
  }

  // Helper: Category avatar CSS class
  function getCategoryAvatarClass(catId) {
    if (catId === 1 || catId === 2) return 'eq-type-pc';
    if (catId === 3 || catId === 4) return 'eq-type-printer';
    if ([6, 7, 8, 16, 21, 22].includes(catId)) return 'eq-type-network';
    return '';
  }

  // ==========================================================================
  // 1. SIDEBAR & KPI INITIALIZATION
  // ==========================================================================

  // Helper: Format category title for sidebar (Title Case, capitalized first letter, preserving acronyms like UPS, DVR, NAS, MFP)
  function formatCategoryTitle(str) {
    if (!str) return '';
    const acronyms = new Set(['UPS', 'DVR', 'NAS', 'MFP', 'IP', 'KVM', 'NVR', 'AP', 'RF', 'IT']);
    const customMap = {
      'RACUNAR': 'Računari',
      'LAPTOP': 'Laptopovi',
      'MONITOR': 'Monitori',
      'STAMPAC': 'Štampači',
      'ŠTAMPAC': 'Štampači',
      'SWITCH': 'Switch',
      'SVIC': 'Svič',
      'ROUTER': 'Ruteri',
      'BARKOD CITAC': 'Barkod Čitači',
      'BARKOD ŠTAMPAC': 'Barkod Štampači',
      'CVOR': 'Čvorovi',
      'SKENER': 'Skeneri',
      'SERVER': 'Serveri',
      'TELEFON': 'Telefoni',
      'TABLET': 'Tableti'
    };

    const upper = str.toUpperCase().trim();
    if (customMap[upper]) return customMap[upper];

    return str.split(/\s+/).map(word => {
      const wUpper = word.toUpperCase();
      if (acronyms.has(wUpper)) return wUpper;
      const lower = word.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    }).join(' ');
  }

  /**
   * Fetches categories from /api/equipment/categories and populates the category dropdown & filter pills.
   */
  async function refreshSidebarCategories() {
    try {
      const res = await fetch('/api/equipment/categories');
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Neuspešan odgovor');

      state.categories = data.categories || [];
      const totalAll = state.categories.reduce((sum, c) => sum + (c.count || 0), 0);

      // 1. Update sidebar total badge (Računarska oprema)
      const badgeTotal = document.getElementById('badge-nav-equipment-total');
      if (badgeTotal) badgeTotal.textContent = totalAll.toLocaleString('sr-RS');

      // 2. Populate Category dropdown next to search input
      const selectCat = document.getElementById('select-equipment-category');
      if (selectCat) {
        let optionsHtml = `<option value="">Sve Kategorije (${totalAll})</option>`;
        state.categories.forEach(cat => {
          const formattedTitle = formatCategoryTitle(cat.name);
          optionsHtml += `<option value="${cat.id}">${escapeHtml(formattedTitle)} (${cat.count || 0})</option>`;
        });
        selectCat.innerHTML = optionsHtml;
        selectCat.value = state.currentCategoryId !== null ? String(state.currentCategoryId) : '';
      }

      // 3. Populate Category Filter Pills container
      renderCategoryPills(totalAll);

    } catch (err) {
      console.warn('[EquipmentModule] Greška pri učitavanju kategorija:', err);
    }
  }

  /**
   * Renders interactive category filter pills matching MREŽA -> KAMERE style.
   */
  function renderCategoryPills(totalAll) {
    const pillsContainer = document.getElementById('equipment-category-pills');
    if (!pillsContainer) return;

    const totalCount = totalAll !== undefined ? totalAll : state.categories.reduce((sum, c) => sum + (c.count || 0), 0);
    const isAllActive = state.currentCategoryId === null;

    let html = `
      <button type="button" class="inv-quick-pill ${isAllActive ? 'active' : ''}" data-category-id="" title="Prikaži svu opremu">
        <i data-lucide="layers" style="width: 13px; height: 13px;"></i>
        <span>Sve Kategorije</span>
        <span class="inv-quick-pill-count">(${totalCount})</span>
      </button>
    `;

    state.categories.forEach(cat => {
      const isActive = state.currentCategoryId === cat.id;
      const icon = getCategoryIcon(cat.id, cat.name, cat.icon);
      const formattedTitle = formatCategoryTitle(cat.name);
      html += `
        <button type="button" class="inv-quick-pill ${isActive ? 'active' : ''}" data-category-id="${cat.id}" title="${escapeHtml(formattedTitle)} (${cat.count || 0})">
          <i data-lucide="${icon}" style="width: 13px; height: 13px;"></i>
          <span>${escapeHtml(formattedTitle)}</span>
          <span class="inv-quick-pill-count">(${cat.count || 0})</span>
        </button>
      `;
    });

    pillsContainer.innerHTML = html;
    if (window.lucide) window.lucide.createIcons();

    // Attach click listeners to pill buttons
    pillsContainer.querySelectorAll('.inv-quick-pill').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const catId = btn.getAttribute('data-category-id');
        selectCategory(catId);
      });
    });
  }

  /**
   * Fetches KPI summary stats for the active category and updates the 4 KPI cards.
   */
  async function refreshKPIStats() {
    try {
      const url = state.currentCategoryId
        ? `/api/equipment/stats?category_id=${state.currentCategoryId}`
        : '/api/equipment/stats';

      const res = await fetch(url);
      const data = await res.json();
      if (!data.success) return;

      const s = data.stats;
      const elTotal = document.getElementById('kpi-eq-total');
      const elTotalLabel = document.getElementById('kpi-eq-total-label');
      const elTotalSub = document.getElementById('kpi-eq-total-sub');
      const elInUse = document.getElementById('kpi-eq-inuse');
      const elReserve = document.getElementById('kpi-eq-reserve');
      const elService = document.getElementById('kpi-eq-service');

      if (elTotal) elTotal.textContent = (s.total || 0).toLocaleString('sr-RS');
      if (elTotalLabel) elTotalLabel.textContent = state.currentCategoryId !== null ? 'UKUPNO U KATEGORIJI' : 'UKUPNO OPREME';
      if (elTotalSub) elTotalSub.textContent = state.currentCategoryId !== null ? state.currentCategoryName : 'Sve kategorije';
      if (elInUse) elInUse.textContent = (s.inUse || 0).toLocaleString('sr-RS');
      if (elReserve) elReserve.textContent = (s.inReserve || 0).toLocaleString('sr-RS');
      if (elService) elService.textContent = (s.inService || 0).toLocaleString('sr-RS');
    } catch (err) {
      console.warn('[EquipmentModule] Greška pri preuzimanju statistike:', err);
    }
  }

  /**
   * Updates page header title, subtitle, and icon for current category.
   */
  function updateHeaderInfo() {
    const titleEl = document.getElementById('equipment-header-title');
    const subtitleEl = document.getElementById('equipment-header-subtitle');
    const iconEl = document.getElementById('equipment-header-icon');

    if (titleEl) {
      if (state.currentCategoryId !== null) {
        titleEl.textContent = `Računarska Oprema: ${state.currentCategoryName}`;
      } else {
        titleEl.textContent = 'Računarska Oprema';
      }
    }

    if (subtitleEl) {
      if (state.currentCategoryId !== null) {
        subtitleEl.textContent = `Filtriran pregled za kategoriju ${state.currentCategoryName} sa Navision 2016 podacima`;
      } else {
        subtitleEl.textContent = 'Kompletna evidencija IT opreme sa Navision 2016 podacima o zaduženju';
      }
    }

    if (iconEl) {
      const icon = state.currentCategoryId !== null
        ? getCategoryIcon(state.currentCategoryId, state.currentCategoryName)
        : 'monitor';
      iconEl.innerHTML = `<i data-lucide="${icon}"></i>`;
      if (window.lucide) window.lucide.createIcons();
    }
  }

  /**
   * Fetches codebooks (statuses, locations, rooms) for select dropdowns.
   */
  async function loadCodebooks() {
    try {
      const res = await fetch('/api/equipment/codebooks');
      const json = await res.json();
      if (!json.success || !json.data) return;

      state.statuses = json.data.statuses || [];
      state.locations = json.data.locations || [];
      state.rooms = json.data.rooms || [];

      // Populate Status filter
      const selectStatus = document.getElementById('select-equipment-status');
      if (selectStatus) {
        selectStatus.innerHTML = '<option value="">Svi Statusi</option>' +
          state.statuses.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
      }

      // Populate Location filter
      const selectLoc = document.getElementById('select-equipment-location');
      if (selectLoc) {
        selectLoc.innerHTML = '<option value="">Sve Lokacije</option>' +
          state.locations.map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('');
      }
    } catch (err) {
      console.warn('[EquipmentModule] Greška pri preuzimanju šifarnika:', err);
    }
  }

  // ==========================================================================
  // 2. CATEGORY SELECTION & FILTERING
  // ==========================================================================

  /**
   * Switches active category filter (from dropdown or pills).
   */
  function selectCategory(catId) {
    if (catId === '' || catId === null || catId === undefined) {
      state.currentCategoryId = null;
      state.currentCategoryName = 'Sva oprema';
    } else {
      state.currentCategoryId = parseInt(catId, 10);
      const found = state.categories.find(c => c.id === state.currentCategoryId);
      state.currentCategoryName = found ? formatCategoryTitle(found.name) : `Kategorija #${state.currentCategoryId}`;
    }

    state.currentPage = 1;

    // Sync Category dropdown value
    const selectCat = document.getElementById('select-equipment-category');
    if (selectCat) {
      selectCat.value = state.currentCategoryId !== null ? String(state.currentCategoryId) : '';
    }

    // Sync Category pills active states
    const pillsContainer = document.getElementById('equipment-category-pills');
    if (pillsContainer) {
      pillsContainer.querySelectorAll('.inv-quick-pill').forEach(btn => {
        const id = btn.getAttribute('data-category-id');
        const isMatch = (state.currentCategoryId === null && id === '') ||
                        (state.currentCategoryId !== null && id === String(state.currentCategoryId));
        if (isMatch) btn.classList.add('active');
        else btn.classList.remove('active');
      });
    }

    updateHeaderInfo();
    updateResetButtonVisibility();
    refreshKPIStats();
    loadEquipmentTable();
    triggerSyncCheck();
  }

  /**
   * Shows or hides the reset button depending on whether any filter is active.
   */
  function updateResetButtonVisibility() {
    const btnReset = document.getElementById('btn-reset-equipment-filters');
    if (!btnReset) return;

    const hasFilters = state.currentCategoryId !== null ||
                       state.currentStatusId !== null ||
                       state.currentStatusGroup !== null ||
                       state.currentLocationId !== null ||
                       (state.searchQuery && state.searchQuery.trim().length > 0);

    btnReset.style.display = hasFilters ? 'inline-flex' : 'none';
  }


  // ==========================================================================
  // 3. TABLE RENDERING & PAGINATION
  // ==========================================================================

  /**
   * Fetches paginated equipment and renders luxury glass table rows.
   */
  async function loadEquipmentTable() {
    const tbody = document.getElementById('tbody-equipment');
    if (!tbody) return;

    state.isLoading = true;

    // Render Luxury Loading Skeleton
    tbody.innerHTML = Array(5).fill(0).map(() => `
      <tr>
        <td><div class="eq-skeleton-bar" style="width: 35px;"></div></td>
        <td>
          <div style="display: flex; gap: 10px; align-items: center;">
            <div class="eq-skeleton-bar" style="width: 36px; height: 36px; border-radius: 8px;"></div>
            <div style="flex: 1;">
              <div class="eq-skeleton-bar" style="width: 140px; margin-bottom: 6px;"></div>
              <div class="eq-skeleton-bar" style="width: 80px; height: 10px;"></div>
            </div>
          </div>
        </td>
        <td><div class="eq-skeleton-bar" style="width: 90px;"></div></td>
        <td>
          <div class="eq-skeleton-bar" style="width: 130px; margin-bottom: 4px;"></div>
          <div class="eq-skeleton-bar" style="width: 70px; height: 10px;"></div>
        </td>
        <td><div class="eq-skeleton-bar" style="width: 110px;"></div></td>
        <td><div class="eq-skeleton-bar" style="width: 80px; border-radius: 12px;"></div></td>
        <td><div class="eq-skeleton-bar" style="width: 100px;"></div></td>
        <td style="text-align: right;"><div class="eq-skeleton-bar" style="width: 60px; margin-left: auto;"></div></td>
      </tr>
    `).join('');

    try {
      const params = new URLSearchParams({
        page: String(state.currentPage),
        pageSize: String(state.pageSize)
      });

      if (state.currentCategoryId !== null) {
        params.append('category_id', String(state.currentCategoryId));
      }
      if (state.currentStatusId !== null) {
        params.append('status_id', String(state.currentStatusId));
      } else if (state.currentStatusGroup !== null) {
        params.append('status_group', state.currentStatusGroup);
      }
      if (state.currentLocationId !== null) {
        params.append('location_id', String(state.currentLocationId));
      }
      if (state.searchQuery && state.searchQuery.trim().length > 0) {
        params.append('search', state.searchQuery.trim());
      }

      const res = await fetch(`/api/equipment?${params.toString()}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Greška pri učitavanju opreme');

      state.totalItems = json.total || 0;
      state.totalPages = json.totalPages || 1;
      state.currentPage = json.page || 1;

      renderTableRows(json.items || []);
      renderEquipmentPagination(state.totalPages);

    } catch (err) {
      console.error('[EquipmentModule] Greška pri popunjavanju tabele opreme:', err);
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 40px 10px; color: #f87171;">
            <div style="font-size: 1.1rem; font-weight: 600; margin-bottom: 6px;">Greška pri učitavanju podataka</div>
            <div style="font-size: 0.85rem; color: #94a3b8;">${escapeHtml(err.message)}</div>
            <button class="btn-yellow-solid-sm" onclick="window.EquipmentModule.reload()" style="margin-top: 14px;">
              <i data-lucide="rotate-cw"></i>
              <span>Pokušaj ponovo</span>
            </button>
          </td>
        </tr>
      `;
      if (window.lucide) window.lucide.createIcons();
    } finally {
      state.isLoading = false;
    }
  }

  /**
   * Renders equipment items into the table body.
   */
  function renderTableRows(items) {
    const tbody = document.getElementById('tbody-equipment');
    if (!tbody) return;

    if (items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="10" style="text-align: center; padding: 50px 20px; color: #94a3b8;">
            <div style="width: 48px; height: 48px; border-radius: 12px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: center; margin: 0 auto 12px auto; color: #64748b;">
              <i data-lucide="box" style="width: 24px; height: 24px;"></i>
            </div>
            <div style="font-weight: 700; color: #e2e8f0; font-size: 1rem; margin-bottom: 4px;">Nema pronađene opreme</div>
            <div style="font-size: 0.82rem; color: #64748b; max-width: 320px; margin: 0 auto;">Nijedna stavka ne odgovara izabranim filterima ili unetom pojmu pretrage.</div>
          </td>
        </tr>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    const rowsHtml = items.map(item => {
      const catIcon = getCategoryIcon(item.category_id, item.category_name, item.category_icon);
      const avatarClass = getCategoryAvatarClass(item.category_id);

      // Status badge styling
      let statusClass = 'status-in-use';
      const sName = (item.status_name || '').toUpperCase();
      if (sName.includes('SERVIS') || sName.includes('NEISPRAVNO') || sName.includes('KVAR')) {
        statusClass = 'status-service';
      } else if (sName.includes('REZERVA') || sName.includes('MAGACIN') || sName.includes('SLOBODNO')) {
        statusClass = 'status-reserve';
      } else if (sName.includes('RASHOD') || sName.includes('OTPIS')) {
        statusClass = 'status-scrapped';
      }

      // Navision Employee formatting (If missing or 'BEZ', leave cell empty/blank as requested)
      let employeeHtml = '';
      const isUnassigned = !item.employee_no || item.employee_no.trim().toUpperCase() === 'BEZ';
      if (!isUnassigned) {
        let hrBadgeClass = 'badge-hr-active';
        const hrStatus = item.employee_status || 'Aktivan';
        if (hrStatus.toLowerCase().includes('neaktivan')) hrBadgeClass = 'badge-hr-inactive';
        else if (hrStatus.toLowerCase().includes('napustio')) hrBadgeClass = 'badge-hr-left';

        employeeHtml = `
          <div class="eq-emp-cell">
            <div class="eq-emp-name-row">
              <span class="eq-emp-name">${escapeHtml(item.employee_name || item.employee_no)}</span>
            </div>
            <div class="eq-emp-sub-row" style="display: flex; align-items: center; gap: 6px; margin-top: 3px;">
              <span class="eq-emp-no" title="Kadrovski broj u Navision HR bazi">${escapeHtml(item.employee_no)}</span>
              <span class="badge-hr ${hrBadgeClass}" title="Status u Navision HR bazi">${escapeHtml(hrStatus)}</span>
            </div>
          </div>
        `;
      }

      // Location & Room
      const locName = item.location_name ? escapeHtml(item.location_name) : '—';
      const roomName = item.room_name ? escapeHtml(item.room_name) : '';

      // SI / OS column logic: OS name, IP address, inventory_no, or custom_code
      let siOsText = '—';
      if (item.os) {
        siOsText = escapeHtml(item.os);
      } else if (item.ip_address) {
        siOsText = escapeHtml(item.ip_address);
      } else if (item.inventory_no) {
        siOsText = `Inv: ${escapeHtml(item.inventory_no)}`;
      } else if (item.custom_code) {
        siOsText = `Šifra: ${escapeHtml(item.custom_code)}`;
      }

      return `
        <tr data-equipment-id="${item.id}">
          <!-- 1. ID -->
          <td style="font-family: var(--font-mono, monospace); font-weight: 700; color: #cbd5e1; font-size: 0.74rem;">
            #${item.id}
          </td>

          <!-- 2. KORISNIK (Ako je vrednost BEZ ostavi prazno polje) -->
          <td>
            ${employeeHtml}
          </td>

          <!-- 3. KATEGORIJA (prikazi samo ikonicu) -->
          <td style="text-align: center;">
            <div class="eq-avatar ${avatarClass}" style="margin: 0 auto;" title="${escapeHtml(item.category_name || 'Oprema')}">
              <i data-lucide="${catIcon}"></i>
            </div>
          </td>

          <!-- 4. STATUS -->
          <td>
            <span class="badge-eq-status ${statusClass}">
              <span class="status-dot"></span>
              ${escapeHtml(item.status_name || 'U upotrebi')}
            </span>
          </td>

          <!-- 5. LOKACIJA -->
          <td>
            <div class="eq-location-box">
              <span class="eq-location-name">
                <i data-lucide="map-pin" style="width: 11px; height: 11px; color: var(--yellow-primary);"></i>
                ${locName}
              </span>
              ${roomName ? `<span class="eq-room-name">${roomName}</span>` : ''}
            </div>
          </td>

          <!-- 6. KOMENTAR -->
          <td style="max-width: 160px; font-size: 0.74rem; color: #cbd5e1; white-space: normal; word-break: break-word; line-height: 1.3;">
            ${item.comment ? escapeHtml(item.comment) : '<span style="color: #475569;">—</span>'}
          </td>

          <!-- 7. OPIS -->
          <td style="max-width: 160px; font-size: 0.74rem; color: #cbd5e1; white-space: normal; word-break: break-word; line-height: 1.3;">
            ${item.description ? escapeHtml(item.description) : '<span style="color: #475569;">—</span>'}
          </td>

          <!-- 8. IME -->
          <td style="font-weight: 600; color: #f8fafc; font-size: 0.78rem;">
            ${escapeHtml(item.name || '—')}
          </td>

          <!-- 9. SI/OS -->
          <td style="font-size: 0.73rem; font-family: var(--font-mono, monospace); color: #94a3b8;">
            ${siOsText}
          </td>

          <!-- 10. AKCIJE -->
          <td style="text-align: right;">
            <div class="inv-actions-cell" style="justify-content: flex-end; gap: 4px;">
              <button type="button" class="btn-inv-action" title="Karton i detalji opreme" onclick="window.EquipmentModule.viewCard(${item.id})">
                <i data-lucide="file-text"></i>
              </button>
              <button type="button" class="btn-inv-action" title="Izmeni opremu" onclick="window.EquipmentModule.openEditModal(${item.id})">
                <i data-lucide="pencil"></i>
              </button>
              <button type="button" class="btn-inv-action" title="Dodaj servisnu napomenu" onclick="window.EquipmentModule.openHistoryModal(${item.id})">
                <i data-lucide="clipboard-plus"></i>
              </button>
              <button type="button" class="btn-inv-action btn-inv-action-delete" style="color: #f87171;" title="Obriši opremu" onclick="window.EquipmentModule.openDeleteModal(${item.id})">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.innerHTML = rowsHtml;
    if (window.lucide) window.lucide.createIcons();
  }

  /**
   * Renders pagination buttons and results counter text matching MREŽA -> KAMERE style.
   */
  function renderEquipmentPagination(totalPages) {
    const container = document.getElementById('equipment-pagination-controls');
    const counterEl = document.getElementById('equipment-counter-text');
    if (!container) return;

    const start = state.totalItems === 0 ? 0 : (state.currentPage - 1) * state.pageSize + 1;
    const end = Math.min(state.currentPage * state.pageSize, state.totalItems);
    if (counterEl) {
      const catLabel = state.currentCategoryName ? state.currentCategoryName.toLowerCase() : 'stavki';
      counterEl.textContent = `Prikazano: ${state.totalItems > 0 ? start : 0}-${end} od ukupno ${state.totalItems.toLocaleString('sr-RS')} ${catLabel}`;
    }

    if (totalPages <= 1) {
      container.innerHTML = '';
      return;
    }

    let html = '';
    const prevDisabled = state.currentPage === 1;
    html += `<button class="btn-dark-sm" style="padding: 4px 10px; height: 30px; ${prevDisabled ? 'opacity: 0.4; pointer-events: none;' : ''}" onclick="window.EquipmentModule.goToPage(${state.currentPage - 1})"><i data-lucide="chevron-left" style="width: 14px; height: 14px;"></i></button>`;

    let startPage = Math.max(1, state.currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    if (endPage - startPage < 4) {
      startPage = Math.max(1, endPage - 4);
    }

    for (let p = startPage; p <= endPage; p++) {
      const active = (p === state.currentPage);
      html += `<button class="${active ? 'btn-yellow-solid-sm' : 'btn-dark-sm'}" style="padding: 2px 10px; height: 30px; min-width: 32px;" onclick="window.EquipmentModule.goToPage(${p})">${p}</button>`;
    }

    const nextDisabled = state.currentPage === totalPages;
    html += `<button class="btn-dark-sm" style="padding: 4px 10px; height: 30px; ${nextDisabled ? 'opacity: 0.4; pointer-events: none;' : ''}" onclick="window.EquipmentModule.goToPage(${state.currentPage + 1})"><i data-lucide="chevron-right" style="width: 14px; height: 14px;"></i></button>`;

    container.innerHTML = html;
    if (window.lucide) window.lucide.createIcons();
  }

  function goToPage(page) {
    if (page < 1 || page > state.totalPages) return;
    state.currentPage = page;
    loadEquipmentTable();
    const tableEl = document.getElementById('table-equipment') || document.getElementById('tab-equipment');
    if (tableEl) tableEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function changePageSize(size) {
    state.pageSize = parseInt(size, 10) || 50;
    state.currentPage = 1;
    loadEquipmentTable();
  }

  // ==========================================================================
  // 4. FAST SYNC CHECK HOOK & REAL-TIME SSE (Server-Sent Events)
  // ==========================================================================

  let sseSource = null;
  let sseReconnectTimer = null;
  let liveRefreshThrottle = null;

  /**
   * Triggers background silent refresh when real-time updates arrive.
   */
  function scheduleLiveRefresh(reason) {
    if (liveRefreshThrottle) return;
    liveRefreshThrottle = setTimeout(() => {
      liveRefreshThrottle = null;
      if (document.visibilityState === 'visible') {
        const tabEquipment = document.getElementById('tab-equipment');
        const isEquipmentVisible = tabEquipment && (tabEquipment.classList.contains('active') || tabEquipment.style.display !== 'none');
        if (isEquipmentVisible || window.location.hash === '#equipment') {
          console.log('[EquipmentModule] ⚡ Auto-refreshing table from live event:', reason || 'sse');
          loadEquipmentTable();
        }
        refreshKPIStats();
        refreshSidebarCategories();
        if (window.DictionariesModule && typeof window.DictionariesModule.refresh === 'function') {
          window.DictionariesModule.refresh();
        }
        if (window.SoftwareLicensesModule && typeof window.SoftwareLicensesModule.refresh === 'function') {
          window.SoftwareLicensesModule.refresh();
        }
      } else {
        state.hasPendingLiveUpdate = true;
      }
    }, 250);
  }

  /**
   * Sets up real-time SSE listener for live table auto-refresh without page reload.
   */
  function setupLiveSSE() {
    if (sseSource) {
      try { sseSource.close(); } catch(e) {}
    }

    try {
      sseSource = new EventSource('/api/equipment/events');

      sseSource.onopen = () => {
        console.log('[EquipmentModule] 🟢 SSE Live Stream povezan uspešno.');
      };

      sseSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && data.type !== 'connected') {
            console.log('[EquipmentModule] 📥 Primljen live signal sa servera:', data.type);
            scheduleLiveRefresh(data.type);
          }
        } catch (e) {
          scheduleLiveRefresh('raw');
        }
      };

      sseSource.onerror = () => {
        try { sseSource.close(); } catch(e) {}
        sseSource = null;
        clearTimeout(sseReconnectTimer);
        // Auto-reconnect after 3 seconds
        sseReconnectTimer = setTimeout(setupLiveSSE, 3000);
      };
    } catch (err) {
      console.warn('[EquipmentModule] SSE setup notice:', err);
    }
  }

  /**
   * Triggers the fast background sync check (17ms Checksum Query).
   */
  async function triggerSyncCheck() {
    const icon = document.getElementById('icon-sync-equipment-spin');
    if (icon) icon.classList.add('spin-animation');

    clearTimeout(state.syncDebounceTimer);
    state.syncDebounceTimer = setTimeout(async () => {
      try {
        const res = await fetch('/api/equipment/sync-check');
        const json = await res.json();
        if (json.success && json.changed) {
          loadEquipmentTable();
        }
        await Promise.all([
          refreshSidebarCategories(),
          refreshKPIStats()
        ]);
      } catch (err) {
        console.warn('[EquipmentModule] Sync check notice:', err);
      } finally {
        if (icon) {
          setTimeout(() => icon.classList.remove('spin-animation'), 400);
        }
      }
    }, 150);
  }

  // Page Visibility handler (0% CPU & network when tab is minimized / inactive)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (state.hasPendingLiveUpdate) {
        state.hasPendingLiveUpdate = false;
        loadEquipmentTable();
        refreshKPIStats();
        refreshSidebarCategories();
      }
      triggerSyncCheck();
    }
  });

  // ==========================================================================
  // 4.5. EXCEL EXPORT (ALL FILTERED PAGES)
  // ==========================================================================

  /**
   * Exports currently filtered equipment list across ALL pages into a luxury styled Microsoft Excel (.xlsx) file.
   */
  async function exportEquipmentToExcel() {
    const btnExport = document.getElementById('btn-export-equipment-excel');
    const originalContent = btnExport ? btnExport.innerHTML : '';

    try {
      if (btnExport) {
        btnExport.disabled = true;
        btnExport.innerHTML = `<i data-lucide="loader-2" class="spin-animation" style="animation: spin 1s linear infinite;"></i> <span>Izvoz...</span>`;
        if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
      }

      if (typeof showToast === 'function') {
        showToast('Generisanje stilizovane Excel (.xlsx) tabele sa svim podacima i filterima...', 'info');
      }

      const params = new URLSearchParams();

      if (state.currentCategoryId !== null) {
        params.append('category_id', String(state.currentCategoryId));
      }
      if (state.currentStatusId !== null) {
        params.append('status_id', String(state.currentStatusId));
      } else if (state.currentStatusGroup !== null) {
        params.append('status_group', state.currentStatusGroup);
      }
      if (state.currentLocationId !== null) {
        params.append('location_id', String(state.currentLocationId));
      }
      if (state.searchQuery && state.searchQuery.trim().length > 0) {
        params.append('search', state.searchQuery.trim());
      }

      const res = await fetch(`/api/equipment/export/excel?${params.toString()}`);
      if (!res.ok) {
        let errMsg = 'Greška pri generisanju Excel tabele';
        try {
          const errJson = await res.json();
          if (errJson && errJson.error) errMsg = errJson.error;
        } catch (_) {}
        throw new Error(errMsg);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateStr = new Date().toISOString().slice(0, 10);
      a.download = `Unipromet_Racunarska_Oprema_${dateStr}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      if (typeof showToast === 'function') {
        showToast('Excel (.xlsx) tabela je uspešno preuzeta sa stilizovanim kolonama i bojama!', 'success');
      }
    } catch (err) {
      console.error('[EquipmentModule] Greška pri izvozu u Excel:', err);
      if (typeof showToast === 'function') {
        showToast('Greška pri izvozu u Excel: ' + (err.message || 'Nepoznata greška'), 'error');
      }
    } finally {
      if (btnExport) {
        btnExport.disabled = false;
        btnExport.innerHTML = originalContent;
        if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
      }
    }
  }

  // ==========================================================================
  // 5. EVENT BINDING & INITIALIZATION
  // ==========================================================================

  function bindEvents() {
    // Search input with debounce
    const searchInput = document.getElementById('search-equipment');
    const btnClearSearch = document.getElementById('btn-clear-search-equipment');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const val = e.target.value;
        state.searchQuery = val;
        if (btnClearSearch) btnClearSearch.style.display = val ? 'flex' : 'none';

        clearTimeout(state.searchDebounceTimer);
        state.searchDebounceTimer = setTimeout(() => {
          state.currentPage = 1;
          updateResetButtonVisibility();
          loadEquipmentTable();
        }, 300);
      });
    }

    if (btnClearSearch) {
      btnClearSearch.addEventListener('click', () => {
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
        state.searchQuery = '';
        btnClearSearch.style.display = 'none';
        state.currentPage = 1;
        updateResetButtonVisibility();
        loadEquipmentTable();
      });
    }

    // Category filter select (next to search bar)
    const selectCategoryEl = document.getElementById('select-equipment-category');
    if (selectCategoryEl) {
      selectCategoryEl.addEventListener('change', (e) => {
        selectCategory(e.target.value);
      });
    }

    // Helper to update active visual style on KPI cards
    function updateKpiCardsVisualState() {
      const cardTotal = document.getElementById('kpi-card-eq-total');
      const cardInUse = document.getElementById('kpi-card-eq-inuse');
      const cardReserve = document.getElementById('kpi-card-eq-reserve');
      const cardService = document.getElementById('kpi-card-eq-service');

      [cardTotal, cardInUse, cardReserve, cardService].forEach(c => {
        if (c) {
          c.style.border = '';
          c.style.boxShadow = '';
        }
      });

      if (state.currentStatusGroup === 'service' && cardService) {
        cardService.style.border = '1px solid rgba(239, 68, 68, 0.7)';
        cardService.style.boxShadow = '0 0 16px rgba(239, 68, 68, 0.25)';
      } else if (state.currentStatusGroup === 'in_use' && cardInUse) {
        cardInUse.style.border = '1px solid rgba(16, 185, 129, 0.7)';
        cardInUse.style.boxShadow = '0 0 16px rgba(16, 185, 129, 0.25)';
      } else if (state.currentStatusGroup === 'in_reserve' && cardReserve) {
        cardReserve.style.border = '1px solid rgba(56, 189, 248, 0.7)';
        cardReserve.style.boxShadow = '0 0 16px rgba(56, 189, 248, 0.25)';
      }
    }

    // Status filter select
    const selectStatus = document.getElementById('select-equipment-status');
    if (selectStatus) {
      selectStatus.addEventListener('change', (e) => {
        const val = e.target.value;
        state.currentStatusId = val ? parseInt(val, 10) : null;
        state.currentStatusGroup = null;
        state.currentPage = 1;
        updateKpiCardsVisualState();
        updateResetButtonVisibility();
        loadEquipmentTable();
      });
    }

    // Location filter select
    const selectLoc = document.getElementById('select-equipment-location');
    if (selectLoc) {
      selectLoc.addEventListener('change', (e) => {
        const val = e.target.value;
        state.currentLocationId = val ? parseInt(val, 10) : null;
        state.currentPage = 1;
        updateResetButtonVisibility();
        loadEquipmentTable();
      });
    }

    // Reset filters button
    const btnReset = document.getElementById('btn-reset-equipment-filters');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        state.currentCategoryId = null;
        state.currentCategoryName = 'Sva oprema';
        state.currentStatusId = null;
        state.currentStatusGroup = null;
        state.currentLocationId = null;
        state.searchQuery = '';
        state.currentPage = 1;

        if (searchInput) searchInput.value = '';
        if (btnClearSearch) btnClearSearch.style.display = 'none';
        if (selectCategoryEl) selectCategoryEl.value = '';
        if (selectStatus) selectStatus.value = '';
        if (selectLoc) selectLoc.value = '';

        // Reset pill active states
        const pillsContainer = document.getElementById('equipment-category-pills');
        if (pillsContainer) {
          pillsContainer.querySelectorAll('.inv-quick-pill').forEach(btn => {
            if (btn.getAttribute('data-category-id') === '') btn.classList.add('active');
            else btn.classList.remove('active');
          });
        }

        updateKpiCardsVisualState();
        updateHeaderInfo();
        updateResetButtonVisibility();
        refreshKPIStats();
        loadEquipmentTable();
      });
    }

    // Pagination controls
    const btnPrev = document.getElementById('btn-equipment-prev-page');
    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        if (state.currentPage > 1) {
          state.currentPage--;
          loadEquipmentTable();
        }
      });
    }

    const btnNext = document.getElementById('btn-equipment-next-page');
    if (btnNext) {
      btnNext.addEventListener('click', () => {
        if (state.currentPage < state.totalPages) {
          state.currentPage++;
          loadEquipmentTable();
        }
      });
    }

    const selectPageSize = document.getElementById('select-equipment-pagesize');
    if (selectPageSize) {
      selectPageSize.addEventListener('change', (e) => {
        state.pageSize = parseInt(e.target.value, 10) || 25;
        state.currentPage = 1;
        loadEquipmentTable();
      });
    }

    // Excel Export button
    const btnExport = document.getElementById('btn-export-equipment-excel');
    if (btnExport) {
      btnExport.addEventListener('click', () => {
        exportEquipmentToExcel();
      });
    }

    // Sync button
    const btnSync = document.getElementById('btn-sync-equipment-status');
    if (btnSync) {
      btnSync.addEventListener('click', () => {
        triggerSyncCheck();
        loadEquipmentTable();
      });
    }

    // KPI Cards click to filter
    const cardTotal = document.getElementById('kpi-card-eq-total');
    if (cardTotal) {
      cardTotal.addEventListener('click', () => {
        state.currentStatusGroup = null;
        state.currentStatusId = null;
        if (selectStatus) selectStatus.value = '';
        updateKpiCardsVisualState();
        selectCategory('');
      });
    }

    const cardInUse = document.getElementById('kpi-card-eq-inuse');
    if (cardInUse) {
      cardInUse.addEventListener('click', () => {
        if (state.currentStatusGroup === 'in_use') {
          state.currentStatusGroup = null;
        } else {
          state.currentStatusGroup = 'in_use';
          state.currentStatusId = null;
          if (selectStatus) selectStatus.value = '';
        }
        state.currentPage = 1;
        updateKpiCardsVisualState();
        updateResetButtonVisibility();
        loadEquipmentTable();
      });
    }

    const cardReserve = document.getElementById('kpi-card-eq-reserve');
    if (cardReserve) {
      cardReserve.addEventListener('click', () => {
        if (state.currentStatusGroup === 'in_reserve') {
          state.currentStatusGroup = null;
        } else {
          state.currentStatusGroup = 'in_reserve';
          state.currentStatusId = null;
          if (selectStatus) selectStatus.value = '';
        }
        state.currentPage = 1;
        updateKpiCardsVisualState();
        updateResetButtonVisibility();
        loadEquipmentTable();
      });
    }

    const cardService = document.getElementById('kpi-card-eq-service');
    if (cardService) {
      cardService.addEventListener('click', () => {
        if (state.currentStatusGroup === 'service') {
          state.currentStatusGroup = null;
        } else {
          state.currentStatusGroup = 'service';
          state.currentStatusId = null;
          if (selectStatus) selectStatus.value = '';
        }
        state.currentPage = 1;
        updateKpiCardsVisualState();
        updateResetButtonVisibility();
        loadEquipmentTable();
      });
    }

    // Accordion toggle click: when EVIDENCIJA header is clicked, refresh categories & sync
    const toggleEvidencija = document.getElementById('btn-toggle-sec-evidencija');
    if (toggleEvidencija) {
      toggleEvidencija.addEventListener('click', () => {
        triggerSyncCheck();
      });
    }

    // Add New Equipment button
    const btnAdd = document.getElementById('btn-add-equipment');
    if (btnAdd) {
      btnAdd.addEventListener('click', () => {
        openAddModal();
      });
    }

    // Modal Edit / Add Event Bindings
    const formEdit = document.getElementById('form-equipment-edit');
    if (formEdit) {
      formEdit.addEventListener('submit', handleFormSubmit);
    }

    const selectModalCat = document.getElementById('eq-edit-category');
    if (selectModalCat) {
      selectModalCat.addEventListener('change', (e) => {
        const catId = e.target.value ? parseInt(e.target.value, 10) : null;
        toggleHardwareSpecs(catId);
      });
    }

    const btnCloseEditModal = document.getElementById('btn-close-equipment-edit-modal');
    const btnCancelEditModal = document.getElementById('btn-cancel-equipment-edit');
    [btnCloseEditModal, btnCancelEditModal].forEach(btn => {
      if (btn) {
        btn.addEventListener('click', () => {
          const modal = document.getElementById('modal-equipment-edit');
          if (modal) window.closeModal(modal);
        });
      }
    });

    // Navision Employee Autocomplete Search with Debounce
    const inputEmpSearch = document.getElementById('eq-edit-emp-search');
    if (inputEmpSearch) {
      inputEmpSearch.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (state.empSearchDebounceTimer) clearTimeout(state.empSearchDebounceTimer);

        if (query.length < 2) {
          const list = document.getElementById('eq-emp-autocomplete-list');
          if (list) list.style.display = 'none';
          return;
        }

        const spinner = document.getElementById('eq-emp-search-spinner');
        if (spinner) spinner.style.display = 'inline-block';

        state.empSearchDebounceTimer = setTimeout(async () => {
          try {
            const res = await fetch(`/api/equipment/nav-employees?q=${encodeURIComponent(query)}`);
            const json = await res.json();
            renderEmployeeAutocomplete(json.employees || []);
          } catch (err) {
            console.warn('[EquipmentModule] Greška pri pretrazi radnika:', err);
          } finally {
            if (spinner) spinner.style.display = 'none';
          }
        }, 600);
      });
    }

    // Remove Selected Employee Button
    const btnRemoveEmp = document.getElementById('btn-remove-selected-emp');
    if (btnRemoveEmp) {
      btnRemoveEmp.addEventListener('click', () => {
        setSelectedEmployee(null);
      });
    }

    const btnAddSoftRow = document.getElementById('btn-add-eq-software-row');
    if (btnAddSoftRow) {
      btnAddSoftRow.addEventListener('click', () => {
        addSoftwareEditRow();
      });
    }

    const btnAddHistRow = document.getElementById('btn-add-eq-history-row');
    if (btnAddHistRow) {
      btnAddHistRow.addEventListener('click', () => {
        const list = document.getElementById('eq-edit-history-list');
        if (list && list.children.length === 1 && !list.querySelector('.eq-hist-edit-row')) {
          list.innerHTML = '';
        }
        addHistoryEditRow();
      });
    }

    // Modal Delete Event Bindings
    const btnCloseDeleteModal = document.getElementById('btn-close-equipment-delete-modal');
    const btnCancelDeleteModal = document.getElementById('btn-cancel-equipment-delete');
    const btnConfirmDelete = document.getElementById('btn-confirm-equipment-delete');

    [btnCloseDeleteModal, btnCancelDeleteModal].forEach(btn => {
      if (btn) {
        btn.addEventListener('click', () => {
          const modal = document.getElementById('modal-equipment-delete');
          if (modal) window.closeModal(modal);
        });
      }
    });

    if (btnConfirmDelete) {
      btnConfirmDelete.addEventListener('click', handleDeleteConfirm);
    }

    // Card Modal "Izmeni Opremu" trigger button
    const btnCardEdit = document.getElementById('btn-card-edit-trigger');
    if (btnCardEdit) {
      btnCardEdit.addEventListener('click', () => {
        const cardModal = document.getElementById('modal-equipment-card');
        const activeId = btnCardEdit.getAttribute('data-id');
        if (cardModal) window.closeModal(cardModal);
        if (activeId) openEditModal(parseInt(activeId, 10));
      });
    }

    const btnCardClose = document.getElementById('btn-card-close-btn');
    const btnCardCloseIcon = document.getElementById('btn-close-equipment-card-modal');
    [btnCardClose, btnCardCloseIcon].forEach(btn => {
      if (btn) {
        btn.addEventListener('click', () => {
          const cardModal = document.getElementById('modal-equipment-card');
          if (cardModal) window.closeModal(cardModal);
        });
      }
    });

    // Row click: Clicking any row in equipment table opens the details card modal
    const tbodyEq = document.getElementById('tbody-equipment');
    if (tbodyEq) {
      tbodyEq.addEventListener('click', (e) => {
        // Ignore clicks on action buttons, links, or inputs
        if (e.target.closest('.inv-actions-cell') || e.target.closest('button') || e.target.closest('a') || e.target.closest('input') || e.target.closest('select')) {
          return;
        }
        const row = e.target.closest('tr[data-equipment-id]');
        if (row) {
          const eqId = parseInt(row.getAttribute('data-equipment-id'), 10);
          if (eqId) {
            viewCard(eqId);
          }
        }
      });
    }

    // Close autocomplete on click outside
    document.addEventListener('click', (e) => {
      const list = document.getElementById('eq-emp-autocomplete-list');
      const searchWrap = document.getElementById('eq-edit-emp-search');
      if (list && searchWrap && !searchWrap.contains(e.target) && !list.contains(e.target)) {
        list.style.display = 'none';
      }
    });
  }

  // ==========================================================================
  // 4. PHASE 4 CRUD MODALS & NAVISION AUTOCOMPLETE
  // ==========================================================================

  /**
   * Helper: Populates Category, Status, Location, Room dropdowns in the edit/add modal.
   */
  function populateModalDropdowns(selectedCatId, selectedStatusId, selectedLocId, selectedRoomId) {
    const selectCat = document.getElementById('eq-edit-category');
    if (selectCat) {
      selectCat.innerHTML = '<option value="">— Izaberite kategoriju —</option>' +
        state.categories.map(c => `<option value="${c.id}" ${c.id === selectedCatId ? 'selected' : ''}>${escapeHtml(formatCategoryTitle(c.name))}</option>`).join('');
    }

    const selectStatus = document.getElementById('eq-edit-status');
    if (selectStatus) {
      selectStatus.innerHTML = state.statuses.map(s =>
        `<option value="${s.id}" ${s.id === selectedStatusId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
      ).join('');
    }

    const selectLoc = document.getElementById('eq-edit-location');
    if (selectLoc) {
      selectLoc.innerHTML = '<option value="">— Izaberite objekat —</option>' +
        state.locations.map(l => `<option value="${l.id}" ${l.id === selectedLocId ? 'selected' : ''}>${escapeHtml(l.name)}</option>`).join('');
    }

    const selectRoom = document.getElementById('eq-edit-room');
    if (selectRoom) {
      selectRoom.innerHTML = '<option value="">— Izaberite sobu/kancelariju —</option>' +
        state.rooms.map(r => `<option value="${r.id}" ${r.id === selectedRoomId ? 'selected' : ''}>${escapeHtml(r.name || r.short_desc || `Soba #${r.id}`)}</option>`).join('');
    }
  }

  /**
   * Helper: Toggles visibility of Hardware Specs container based on selected category.
   * Only displays for Laptop (ID: 2) and PC / Računar (ID: 1).
   */
  function toggleHardwareSpecs(catId) {
    const hwContainer = document.getElementById('eq-hardware-specs-container');
    if (!hwContainer) return;

    const cat = state.categories.find(c => c.id === catId);
    const catName = (cat?.name || '').toLowerCase();
    const isPcOrLaptop = catId === 1 || catId === 2 || catName.includes('laptop') || catName.includes('računar') || catName.includes('racunar');
    hwContainer.style.display = isPcOrLaptop ? 'block' : 'none';
    if (window.lucide) window.lucide.createIcons();
  }

  /**
   * Helper: Sets or clears selected Navision employee in the modal form.
   */
  function setSelectedEmployee(emp) {
    const hiddenEmpNo = document.getElementById('eq-edit-emp-no');
    const selectedBox = document.getElementById('eq-selected-emp-box');
    const searchInput = document.getElementById('eq-edit-emp-search');
    const list = document.getElementById('eq-emp-autocomplete-list');

    if (list) list.style.display = 'none';

    if (emp && emp.employee_no) {
      if (hiddenEmpNo) hiddenEmpNo.value = emp.employee_no;
      if (searchInput) searchInput.value = '';

      const nameEl = document.getElementById('eq-selected-emp-name');
      const statusEl = document.getElementById('eq-selected-emp-status');
      const noEl = document.getElementById('eq-selected-emp-no');
      const jobEl = document.getElementById('eq-selected-emp-job');
      const deptEl = document.getElementById('eq-selected-emp-dept');

      if (nameEl) nameEl.textContent = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.employee_no;
      if (noEl) noEl.textContent = emp.employee_no;
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
      if (selectedBox) selectedBox.style.display = 'none';
    }

    if (window.lucide) window.lucide.createIcons();
  }

  /**
   * Renders autocomplete dropdown results for Navision live employee search.
   */
  function renderEmployeeAutocomplete(employees) {
    const list = document.getElementById('eq-emp-autocomplete-list');
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
        if (emp) setSelectedEmployee(emp);
      });
    });

    list.style.display = 'block';
  }

  /**
   * Helper: Adds an editable software row to the modal form.
   */
  function addSoftwareEditRow(initialData = {}) {
    const list = document.getElementById('eq-edit-software-list');
    if (!list) return;

    const row = document.createElement('div');
    row.className = 'eq-soft-edit-row';
    row.style.cssText = 'display: grid; grid-template-columns: 1fr 1.3fr 105px 1.2fr 1fr 34px; gap: 8px; align-items: center; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); padding: 8px 10px; border-radius: 8px;';

    row.innerHTML = `
      <div>
        <input type="text" class="glass-input eq-soft-vendor" placeholder="Proizvođač (npr. Microsoft)" value="${escapeHtml(initialData.vendor || '')}" style="height: 32px; font-size: 0.82rem;">
      </div>
      <div>
        <input type="text" class="glass-input eq-soft-name" placeholder="Naziv softvera (npr. Windows 11 Pro)" value="${escapeHtml(initialData.name || '')}" style="height: 32px; font-size: 0.82rem;" required>
      </div>
      <div>
        <select class="glass-input eq-soft-licensed" style="height: 32px; font-size: 0.82rem; padding: 0 6px;">
          <option value="1" ${initialData.is_licensed !== 0 ? 'selected' : ''}>Licenciran</option>
          <option value="0" ${initialData.is_licensed === 0 ? 'selected' : ''}>Nelicenciran</option>
        </select>
      </div>
      <div>
        <input type="text" class="glass-input font-mono eq-soft-key" placeholder="Serijski ključ / licenca" value="${escapeHtml(initialData.license_key || '')}" style="height: 32px; font-size: 0.8rem;">
      </div>
      <div>
        <input type="text" class="glass-input eq-soft-note" placeholder="Napomena" value="${escapeHtml(initialData.note || '')}" style="height: 32px; font-size: 0.82rem;">
      </div>
      <div>
        <button type="button" class="btn-inv-action btn-remove-soft-row" style="color: #f87171; height: 32px; width: 32px; display: flex; align-items: center; justify-content: center;" title="Ukloni ovaj softver">
          <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
        </button>
      </div>
    `;

    const removeBtn = row.querySelector('.btn-remove-soft-row');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => row.remove());
    }

    list.appendChild(row);
    if (window.lucide) window.lucide.createIcons();
  }

  /**
   * Renders software rows in the edit/add modal.
   */
  function renderEditSoftwareRows(softwareList) {
    const list = document.getElementById('eq-edit-software-list');
    if (!list) return;
    list.innerHTML = '';
    if (Array.isArray(softwareList) && softwareList.length > 0) {
      softwareList.forEach(s => addSoftwareEditRow(s));
    }
  }

  /**
   * Gathers all software items from the edit modal.
   */
  function collectEditSoftwareRows() {
    const list = document.getElementById('eq-edit-software-list');
    if (!list) return [];
    const rows = list.querySelectorAll('.eq-soft-edit-row');
    const result = [];
    rows.forEach(r => {
      const name = (r.querySelector('.eq-soft-name')?.value || '').trim();
      if (name) {
        result.push({
          vendor: (r.querySelector('.eq-soft-vendor')?.value || '').trim() || null,
          name,
          is_licensed: r.querySelector('.eq-soft-licensed')?.value === '1' ? 1 : 0,
          license_key: (r.querySelector('.eq-soft-key')?.value || '').trim() || null,
          note: (r.querySelector('.eq-soft-note')?.value || '').trim() || null
        });
      }
    });
    return result;
  }

  /**
   * Helper: Adds an editable history / service note row to the modal form.
   */
  function addHistoryEditRow(initialData = {}) {
    const list = document.getElementById('eq-edit-history-list');
    if (!list) return;

    // Clear empty state message if present
    if (list.children.length === 1 && !list.querySelector('.eq-hist-edit-row')) {
      list.innerHTML = '';
    }

    const row = document.createElement('div');
    row.className = 'eq-hist-edit-row';
    row.style.cssText = 'display: grid; grid-template-columns: 140px 1fr 130px 34px; gap: 8px; align-items: start; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); padding: 8px 10px; border-radius: 8px;';

    const rawDate = initialData.date || initialData.created_at || '';
    let formattedDate = '';
    if (rawDate) {
      formattedDate = rawDate.includes('T') ? rawDate.split('T')[0] : (rawDate.split(' ')[0] || rawDate);
    } else {
      formattedDate = new Date().toISOString().split('T')[0];
    }

    row.innerHTML = `
      <input type="hidden" class="eq-hist-id" value="${initialData.id ? escapeHtml(initialData.id) : ''}">
      <div>
        <label style="font-size: 0.7rem; color: #64748b; text-transform: uppercase; font-weight: 600; display: block; margin-bottom: 2px;">Datum</label>
        <input type="date" class="glass-input eq-hist-date" value="${escapeHtml(formattedDate)}" style="height: 32px; font-size: 0.8rem; padding: 0 8px;">
      </div>
      <div>
        <label style="font-size: 0.7rem; color: #64748b; text-transform: uppercase; font-weight: 600; display: block; margin-bottom: 2px;">Opis zabeleške / Servisa <span class="text-danger">*</span></label>
        <textarea class="glass-input eq-hist-note" rows="2" placeholder="Opis intervencije, promene stanja ili zaduženja..." style="font-size: 0.82rem; padding: 6px 8px; min-height: 52px; resize: vertical;" required>${escapeHtml(initialData.note || initialData.description || '')}</textarea>
      </div>
      <div>
        <label style="font-size: 0.7rem; color: #64748b; text-transform: uppercase; font-weight: 600; display: block; margin-bottom: 2px;">Telefon / Lice</label>
        <input type="text" class="glass-input eq-hist-phone" placeholder="Opciono" value="${escapeHtml(initialData.phone || '')}" style="height: 32px; font-size: 0.8rem; padding: 0 8px;">
      </div>
      <div style="display: flex; align-items: center; justify-content: center; height: 100%; padding-top: 16px;">
        <button type="button" class="btn-inv-action btn-remove-hist-row" style="color: #f87171; height: 32px; width: 32px; display: flex; align-items: center; justify-content: center;" title="Obriši ovu zabelešku">
          <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
        </button>
      </div>
    `;

    const removeBtn = row.querySelector('.btn-remove-hist-row');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        row.remove();
        if (list.children.length === 0) {
          renderEditHistoryRows([]);
        }
      });
    }

    list.appendChild(row);
    if (window.lucide) window.lucide.createIcons();
  }

  /**
   * Renders history notes rows in the edit/add modal.
   */
  function renderEditHistoryRows(historyList) {
    const list = document.getElementById('eq-edit-history-list');
    if (!list) return;
    list.innerHTML = '';
    if (Array.isArray(historyList) && historyList.length > 0) {
      historyList.forEach(h => addHistoryEditRow(h));
    } else {
      list.innerHTML = `
        <div style="padding: 10px 14px; border-radius: 8px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.06); color: #64748b; font-size: 0.82rem; display: flex; align-items: center; justify-content: space-between;">
          <span>Nema upisanih servisnih zabeleški. Kliknite na "Dodaj Zabelešku" za unos.</span>
        </div>
      `;
    }
  }

  /**
   * Gathers all history notes items from the edit modal.
   */
  function collectEditHistoryRows() {
    const list = document.getElementById('eq-edit-history-list');
    if (!list) return [];
    const rows = list.querySelectorAll('.eq-hist-edit-row');
    const result = [];
    rows.forEach(r => {
      const idVal = r.querySelector('.eq-hist-id')?.value;
      const note = (r.querySelector('.eq-hist-note')?.value || '').trim();
      const date = (r.querySelector('.eq-hist-date')?.value || '').trim();
      const phone = (r.querySelector('.eq-hist-phone')?.value || '').trim();
      if (note) {
        result.push({
          id: idVal ? parseInt(idVal, 10) : undefined,
          note,
          date: date || new Date().toISOString().split('T')[0],
          phone: phone || null
        });
      }
    });
    return result;
  }

  /**
   * Opens modal to create new equipment item.
   */
  function openAddModal() {
    const modal = document.getElementById('modal-equipment-edit');
    const form = document.getElementById('form-equipment-edit');
    const win = document.getElementById('modal-equipment-edit-window');
    const loader = document.getElementById('eq-edit-loading-state');
    const content = document.getElementById('eq-edit-form-content');
    if (!modal || !form) return;

    if (win) win.classList.remove('modal-window-loading');
    if (loader) loader.style.display = 'none';
    if (content) {
      content.style.display = 'block';
      content.classList.remove('eq-fade-in');
    }

    form.reset();
    document.getElementById('eq-edit-id').value = '';
    setSelectedEmployee(null);

    const defaultCatId = state.currentCategoryId || (state.categories.length > 0 ? state.categories[0].id : 1);
    const defaultStatusId = 1; // "ISPRAVNO"

    populateModalDropdowns(defaultCatId, defaultStatusId, null, null);
    toggleHardwareSpecs(defaultCatId);
    renderEditSoftwareRows([]);
    renderEditHistoryRows([]);

    const titleEl = document.getElementById('modal-equipment-edit-title');
    const submitTextEl = document.getElementById('text-submit-equipment-edit');
    if (titleEl) titleEl.textContent = 'Evidentiraj Novu Opremu';
    if (submitTextEl) submitTextEl.textContent = 'Sačuvaj Opremu';

    modal.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons();
    setTimeout(() => {
      const nameInput = document.getElementById('eq-edit-name');
      if (nameInput) nameInput.focus();
    }, 100);
  }

  /**
   * Helper: Safely sets value for input/select/textarea if element exists.
   */
  function safeSetVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val !== undefined && val !== null ? String(val) : '';
  }

  /**
   * Helper: Safely gets trimmed value for input/select/textarea if element exists.
   */
  function safeGetVal(id) {
    const el = document.getElementById(id);
    return el ? (el.value || '').trim() : '';
  }

  /**
   * Opens modal to edit an existing equipment item.
   */
  async function openEditModal(id) {
    const modal = document.getElementById('modal-equipment-edit');
    const form = document.getElementById('form-equipment-edit');
    const win = document.getElementById('modal-equipment-edit-window');
    const loader = document.getElementById('eq-edit-loading-state');
    const content = document.getElementById('eq-edit-form-content');
    if (!modal || !form) return;

    form.reset();
    safeSetVal('eq-edit-id', id);

    const titleEl = document.getElementById('modal-equipment-edit-title');
    const submitTextEl = document.getElementById('text-submit-equipment-edit');
    if (titleEl) titleEl.textContent = `Izmena Podataka o Opremi (#${id})`;
    if (submitTextEl) submitTextEl.textContent = 'Sačuvaj Promene';

    // Show compact loader first
    if (win) win.classList.add('modal-window-loading');
    if (loader) loader.style.display = 'block';
    if (content) {
      content.style.display = 'none';
      content.classList.remove('eq-fade-in');
    }

    modal.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons();

    try {
      const [res] = await Promise.all([
        fetch(`/api/equipment/${id}`),
        new Promise(resolve => setTimeout(resolve, 260))
      ]);
      const json = await res.json();
      if (!json.success || !json.data) {
        if (typeof showToast === 'function') showToast('Nije moguće preuzeti detalje opreme', 'error');
        modal.style.display = 'none';
        return;
      }

      const item = json.data;

      safeSetVal('eq-edit-id', item.id);
      safeSetVal('eq-edit-name', item.name);
      safeSetVal('eq-edit-inv-no', item.inventory_no);
      safeSetVal('eq-edit-custom-code', item.custom_code);
      safeSetVal('eq-edit-comment', item.comment);
      safeSetVal('eq-edit-description', item.description);
      safeSetVal('eq-edit-date-purchased', item.date_purchased);
      safeSetVal('eq-edit-date-arrived', item.date_arrived);

      populateModalDropdowns(item.category_id, item.status_id, item.location_id, item.room_id);
      toggleHardwareSpecs(item.category_id);
      renderEditSoftwareRows(item.software || []);
      renderEditHistoryRows(item.history || []);

      // Populate Hardware Specs if applicable
      const d = item.details || {};
      safeSetVal('eq-spec-cpu', d.processor);
      safeSetVal('eq-spec-ram', d.ram);
      safeSetVal('eq-spec-disk-type', d.disk_type || 'SSD');
      safeSetVal('eq-spec-disk-cap', d.disk_capacity);
      safeSetVal('eq-spec-gpu', d.gpu);
      safeSetVal('eq-spec-mobo', d.motherboard);
      safeSetVal('eq-spec-os', d.os);
      safeSetVal('eq-spec-ip', d.ip_address);
      safeSetVal('eq-spec-mac', d.mac_address);
      safeSetVal('eq-spec-gw', d.gateway);

      // Populate Navision employee
      if (item.employee_no && item.employee_no.trim().toUpperCase() !== 'BEZ') {
        setSelectedEmployee({
          employee_no: item.employee_no,
          first_name: item.employee_name ? item.employee_name.split(' ')[0] : '',
          last_name: item.employee_name ? item.employee_name.split(' ').slice(1).join(' ') : '',
          hr_status: item.employee_status || 'Aktivan',
          job_title: item.employee_job || '',
          department: item.employee_dept || '',
          company: 'Unipromet'
        });
      } else {
        setSelectedEmployee(null);
      }

      // Smoothly expand modal and fade in content
      if (win) win.classList.remove('modal-window-loading');
      if (loader) loader.style.display = 'none';
      if (content) {
        content.style.display = 'block';
        content.classList.add('eq-fade-in');
      }

      if (window.lucide) window.lucide.createIcons();

    } catch (err) {
      console.error('[EquipmentModule] Greška pri otvaranju modala za izmenu:', err);
      if (win) win.classList.remove('modal-window-loading');
      if (loader) loader.style.display = 'none';
      if (content) content.style.display = 'block';
    }
  }

  /**
   * Handles form submission for both CREATE and UPDATE.
   */
  async function handleFormSubmit(e) {
    e.preventDefault();
    const idVal = safeGetVal('eq-edit-id');
    const isEdit = Boolean(idVal);

    const name = safeGetVal('eq-edit-name') || '';

    const catVal = safeGetVal('eq-edit-category');
    const statusVal = safeGetVal('eq-edit-status');
    const locVal = safeGetVal('eq-edit-location');
    const roomVal = safeGetVal('eq-edit-room');
    const empNoVal = safeGetVal('eq-edit-emp-no');
    const invNoVal = safeGetVal('eq-edit-inv-no');
    const customCodeVal = safeGetVal('eq-edit-custom-code');
    const commentVal = safeGetVal('eq-edit-comment');
    const descVal = safeGetVal('eq-edit-description');
    const datePurchasedVal = safeGetVal('eq-edit-date-purchased');
    const dateArrivedVal = safeGetVal('eq-edit-date-arrived');

    const payload = {
      name,
      category_id: catVal ? parseInt(catVal, 10) : null,
      status_id: statusVal ? parseInt(statusVal, 10) : 1,
      location_id: locVal ? parseInt(locVal, 10) : null,
      room_id: roomVal ? parseInt(roomVal, 10) : null,
      employee_no: empNoVal || null,
      inventory_no: invNoVal || null,
      custom_code: customCodeVal ? parseInt(customCodeVal, 10) : null,
      comment: commentVal || null,
      description: descVal || null,
      date_purchased: datePurchasedVal || null,
      date_arrived: dateArrivedVal || null,
      history: collectEditHistoryRows()
    };

    const catId = payload.category_id;
    if (catId === 1 || catId === 2) {
      payload.details = {
        processor: safeGetVal('eq-spec-cpu') || null,
        ram: safeGetVal('eq-spec-ram') || null,
        disk_type: safeGetVal('eq-spec-disk-type') || null,
        disk_capacity: safeGetVal('eq-spec-disk-cap') || null,
        gpu: safeGetVal('eq-spec-gpu') || null,
        motherboard: safeGetVal('eq-spec-mobo') || null,
        os: safeGetVal('eq-spec-os') || null,
        ip_address: safeGetVal('eq-spec-ip') || null,
        mac_address: safeGetVal('eq-spec-mac') || null,
        gateway: safeGetVal('eq-spec-gw') || null
      };
      payload.software = collectEditSoftwareRows();
    }

    const submitBtn = document.getElementById('btn-submit-equipment-edit');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const url = isEdit ? `/api/equipment/${idVal}` : '/api/equipment';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Greška pri čuvanju opreme');

      // Close modal
      const modal = document.getElementById('modal-equipment-edit');
      if (modal) window.closeModal(modal);

      if (typeof showToast === 'function') {
        showToast(json.message || (isEdit ? 'Podaci o opremi uspešno ažurirani!' : 'Nova oprema uspešno sačuvana!'), 'success');
      }

      // Refresh data
      loadEquipmentTable();
      refreshKPIStats();
      refreshSidebarCategories();

    } catch (err) {
      alert('Greška: ' + err.message);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  /**
   * Opens delete confirmation modal for equipment.
   */
  async function openDeleteModal(id) {
    const modal = document.getElementById('modal-equipment-delete');
    const nameEl = document.getElementById('eq-delete-name');
    const metaEl = document.getElementById('eq-delete-meta');
    const btnConfirm = document.getElementById('btn-confirm-equipment-delete');
    if (!modal) return;

    try {
      const res = await fetch(`/api/equipment/${id}`);
      const json = await res.json();
      if (json.success && json.data) {
        const item = json.data;
        if (nameEl) nameEl.textContent = item.name || `Oprema #${item.id}`;
        if (metaEl) {
          const invStr = item.inventory_no ? ` • Inv: ${item.inventory_no}` : '';
          const catStr = item.category_name ? ` • ${item.category_name}` : '';
          metaEl.textContent = `ID: #${item.id}${catStr}${invStr}`;
        }
      }
    } catch (e) {
      if (nameEl) nameEl.textContent = `Oprema #${id}`;
      if (metaEl) metaEl.textContent = `ID: #${id}`;
    }

    if (btnConfirm) btnConfirm.setAttribute('data-id', String(id));
    modal.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons();
  }

  /**
   * Handles deletion of equipment after confirmation.
   */
  async function handleDeleteConfirm() {
    const btnConfirm = document.getElementById('btn-confirm-equipment-delete');
    const id = btnConfirm ? btnConfirm.getAttribute('data-id') : null;
    if (!id) return;

    btnConfirm.disabled = true;
    try {
      const res = await fetch(`/api/equipment/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Greška pri brisanju opreme');

      const modal = document.getElementById('modal-equipment-delete');
      if (modal) window.closeModal(modal);

      if (typeof showToast === 'function') {
        showToast(json.message || `Oprema #${id} je uspešno obrisana!`, 'success');
      }

      loadEquipmentTable();
      refreshKPIStats();
      refreshSidebarCategories();

    } catch (err) {
      alert('Greška: ' + err.message);
    } finally {
      if (btnConfirm) btnConfirm.disabled = false;
    }
  }

  /**
   * Opens history modal (calls viewCard and focuses note textarea).
   */
  function openHistoryModal(id) {
    viewCard(id);
    setTimeout(() => {
      const noteInput = document.getElementById('input-card-new-note');
      if (noteInput) {
        noteInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        noteInput.focus();
      }
    }, 250);
  }

  /**
   * Views full card & history timeline for an equipment item.
   */
  async function viewCard(id) {
    const modal = document.getElementById('modal-equipment-card');
    const win = document.getElementById('modal-equipment-card-window');
    const loader = document.getElementById('card-eq-loading-state');
    const content = document.getElementById('card-eq-content');
    if (!modal) return;

    const editTriggerBtn = document.getElementById('btn-card-edit-trigger');
    if (editTriggerBtn) editTriggerBtn.setAttribute('data-id', String(id));

    // Show compact loader first
    const nameEl = document.getElementById('card-eq-name');
    if (nameEl) nameEl.textContent = `Učitavanje stavke #${id}...`;
    const metaEl = document.getElementById('card-eq-meta');
    if (metaEl) metaEl.innerHTML = `ID: #${id}`;

    if (win) win.classList.add('modal-window-loading');
    if (loader) loader.style.display = 'block';
    if (content) {
      content.style.display = 'none';
      content.classList.remove('eq-fade-in');
    }

    modal.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons();

    try {
      const [res] = await Promise.all([
        fetch(`/api/equipment/${id}`),
        new Promise(resolve => setTimeout(resolve, 260))
      ]);
      const data = await res.json();
      if (!data.success || !data.data) {
        alert('Nije moguće učitati karton opreme.');
        window.closeModal(modal);
        return;
      }

      const item = data.data;
      const catIcon = getCategoryIcon(item.category_id, item.category_name, item.category_icon);
      const avatarClass = getCategoryAvatarClass(item.category_id);

      // Status badge class
      let statusClass = 'status-in-use';
      const sName = (item.status_name || '').toUpperCase();
      if (sName.includes('SERVIS') || sName.includes('NEISPRAVNO') || sName.includes('KVAR')) {
        statusClass = 'status-service';
      } else if (sName.includes('REZERVA') || sName.includes('MAGACIN') || sName.includes('SLOBODNO')) {
        statusClass = 'status-reserve';
      } else if (sName.includes('RASHOD') || sName.includes('OTPIS')) {
        statusClass = 'status-scrapped';
      }

      // Header title & status
      const nameEl = document.getElementById('card-eq-name');
      if (nameEl) nameEl.textContent = item.name || 'Oprema bez naziva';

      const statusEl = document.getElementById('card-eq-status');
      if (statusEl) {
        statusEl.className = `badge-eq-status ${statusClass}`;
        statusEl.innerHTML = `<span class="status-dot"></span> ${escapeHtml(item.status_name || 'U upotrebi')}`;
      }

      const metaEl = document.getElementById('card-eq-meta');
      if (metaEl) {
        const invStr = item.inventory_no ? ` &bull; Inv: ${escapeHtml(item.inventory_no)}` : '';
        const catStr = item.category_name ? ` &bull; Kategorija: ${escapeHtml(item.category_name)}` : '';
        metaEl.innerHTML = `ID: #${item.id}${invStr}${catStr}`;
      }

      const avatarEl = document.getElementById('card-header-avatar');
      if (avatarEl) {
        avatarEl.className = `modal-icon-circle ${avatarClass}`;
        avatarEl.innerHTML = `<i data-lucide="${catIcon}"></i>`;
      }

      // Opis Opreme (Na vrhu kartona)
      const descTopEl = document.getElementById('card-description-top');
      if (descTopEl) {
        if (item.description && item.description.trim()) {
          descTopEl.style.display = 'block';
          descTopEl.innerHTML = `
            <div style="padding: 12px 16px; border-radius: 10px; background: rgba(255, 184, 0, 0.06); border: 1px solid rgba(255, 184, 0, 0.22); display: flex; align-items: flex-start; gap: 12px;">
              <div style="color: var(--yellow-primary); padding-top: 2px;">
                <i data-lucide="info" style="width: 18px; height: 18px;"></i>
              </div>
              <div style="flex: 1;">
                <div style="font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--yellow-primary); font-weight: 700;">Opis / Namena Opreme</div>
                <div style="font-size: 0.92rem; color: #f8fafc; font-weight: 500; margin-top: 2px; line-height: 1.4;">${escapeHtml(item.description)}</div>
              </div>
            </div>
          `;
        } else {
          descTopEl.innerHTML = '';
          descTopEl.style.display = 'none';
        }
      }

      // Zaduženo Lice Card (Navision HR)
      const empSection = document.getElementById('card-emp-section');
      if (empSection) {
        const isUnassigned = !item.employee_no || item.employee_no.trim().toUpperCase() === 'BEZ';
        if (!isUnassigned) {
          let hrBadgeClass = 'badge-hr-active';
          const hrStatus = item.employee_status || 'Aktivan';
          if (hrStatus.toLowerCase().includes('neaktivan')) hrBadgeClass = 'badge-hr-inactive';
          else if (hrStatus.toLowerCase().includes('napustio')) hrBadgeClass = 'badge-hr-left';

          empSection.innerHTML = `
            <div style="padding: 16px; border-radius: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--yellow-primary); font-weight: 700; margin-bottom: 4px;">
                  <i data-lucide="user" style="width: 14px; height: 14px; vertical-align: middle; margin-right: 4px;"></i> ZADUŽENO LICE (NAVISION HR)
                </div>
                <div style="font-size: 1.1rem; font-weight: 700; color: #f8fafc;">${escapeHtml(item.employee_name || item.employee_no)}</div>
                <div style="font-size: 0.85rem; color: #94a3b8; margin-top: 2px;">
                  ${item.employee_job ? escapeHtml(item.employee_job) : '—'} ${item.employee_dept ? ` &bull; ${escapeHtml(item.employee_dept)}` : ''}
                </div>
              </div>
              <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                <span class="eq-emp-no" style="font-size: 0.8rem; padding: 3px 8px;" title="Kadrovski broj">${escapeHtml(item.employee_no)}</span>
                <span class="badge-hr ${hrBadgeClass}">${escapeHtml(hrStatus)}</span>
              </div>
            </div>
          `;
        } else {
          empSection.innerHTML = `
            <div style="padding: 14px 16px; border-radius: 12px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.08); color: #94a3b8; font-size: 0.88rem; display: flex; align-items: center; gap: 8px;">
              <i data-lucide="user-x" style="width: 18px; height: 18px; color: #64748b;"></i>
              <span>Oprema trenutno <strong>nema zaduženo lice</strong> (Neraspoređeno / BEZ).</span>
            </div>
          `;
        }
      }

      // Hardware Specs & Equipment Details Section
      const hwSection = document.getElementById('card-hardware-section');
      if (hwSection) {
        const details = item.details || {};
        hwSection.innerHTML = `
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
            <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); padding: 12px; border-radius: 10px;">
              <div style="font-size: 0.72rem; color: #64748b; text-transform: uppercase; font-weight: 600;">Lokacija & Soba</div>
              <div style="font-size: 0.9rem; font-weight: 600; color: #e2e8f0; margin-top: 2px;">
                ${escapeHtml(item.location_name || '—')} ${item.room_name ? `(${escapeHtml(item.room_name)})` : ''}
              </div>
            </div>

            <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); padding: 12px; border-radius: 10px;">
              <div style="font-size: 0.72rem; color: #64748b; text-transform: uppercase; font-weight: 600;">Gde je kupljeno (Dobavljač)</div>
              <div style="font-size: 0.9rem; font-weight: 600; color: var(--yellow-primary); margin-top: 2px; display: flex; align-items: center; gap: 6px;">
                <i data-lucide="shopping-bag" style="width: 14px; height: 14px;"></i>
                ${escapeHtml(item.date_purchased || '—')}
              </div>
            </div>

            <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); padding: 12px; border-radius: 10px;">
              <div style="font-size: 0.72rem; color: #64748b; text-transform: uppercase; font-weight: 600;">Operativni sistem / IP</div>
              <div style="font-size: 0.9rem; font-weight: 600; color: #e2e8f0; margin-top: 2px;">
                ${details.os ? escapeHtml(details.os) : (details.ip_address ? escapeHtml(details.ip_address) : '—')}
              </div>
            </div>

            <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); padding: 12px; border-radius: 10px;">
              <div style="font-size: 0.72rem; color: #64748b; text-transform: uppercase; font-weight: 600;">Procesor / RAM</div>
              <div style="font-size: 0.9rem; font-weight: 600; color: #e2e8f0; margin-top: 2px;">
                ${details.processor || '—'} ${details.ram ? `(${details.ram})` : ''}
              </div>
            </div>

            <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); padding: 12px; border-radius: 10px;">
              <div style="font-size: 0.72rem; color: #64748b; text-transform: uppercase; font-weight: 600;">Disk / Matična</div>
              <div style="font-size: 0.9rem; font-weight: 600; color: #e2e8f0; margin-top: 2px;">
                ${details.disk_capacity ? `${details.disk_type || ''} ${details.disk_capacity}` : (details.motherboard || '—')}
              </div>
            </div>

            <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); padding: 12px; border-radius: 10px;">
              <div style="font-size: 0.72rem; color: #64748b; text-transform: uppercase; font-weight: 600;">Datum Nabavke / Prispeća</div>
              <div style="font-size: 0.9rem; font-weight: 600; color: #e2e8f0; margin-top: 2px; display: flex; align-items: center; gap: 6px;">
                <i data-lucide="calendar" style="width: 14px; height: 14px; color: #94a3b8;"></i>
                ${item.date_arrived ? escapeHtml(item.date_arrived.includes('T') ? item.date_arrived.split('T')[0] : item.date_arrived) : '—'}
              </div>
            </div>
          </div>

          ${item.comment ? `
            <div style="margin-top: 12px; background: rgba(255,184,0,0.04); border: 1px solid rgba(255,184,0,0.15); padding: 12px; border-radius: 10px; font-size: 0.85rem; color: #cbd5e1;">
              <strong style="color: var(--yellow-primary);">Komentar:</strong> ${escapeHtml(item.comment)}
            </div>
          ` : ''}
        `;
      }

      // Software & Licenses Section
      const softSection = document.getElementById('card-software-section');
      if (softSection) {
        const softList = item.software || [];
        const isComputer = item.category_id === 1 || item.category_id === 2 || (item.category_name && (item.category_name.toLowerCase().includes('laptop') || item.category_name.toLowerCase().includes('računar') || item.category_name.toLowerCase().includes('racunar')));

        if (softList.length > 0 || isComputer) {
          softSection.style.display = 'block';
          if (softList.length === 0) {
            softSection.innerHTML = `
              <div class="modal-section-badge" style="color: #38bdf8; background: rgba(56, 189, 248, 0.12); border-color: rgba(56, 189, 248, 0.25); margin-bottom: 10px;">
                <i data-lucide="shield-check"></i>
                <span>Instalirani Softver i Licence (0)</span>
              </div>
              <div style="padding: 12px 14px; border-radius: 10px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.08); color: #94a3b8; font-size: 0.84rem; display: flex; align-items: center; gap: 8px;">
                <i data-lucide="info" style="width: 16px; height: 16px; color: #64748b;"></i>
                <span>Nema evidentiranih softverskih licenci ili instaliranih programa za ovaj računar.</span>
              </div>
            `;
          } else {
            softSection.innerHTML = `
              <div class="modal-section-badge" style="color: #38bdf8; background: rgba(56, 189, 248, 0.12); border-color: rgba(56, 189, 248, 0.25); margin-bottom: 10px;">
                <i data-lucide="shield-check"></i>
                <span>Instalirani Softver i Licence (${softList.length})</span>
              </div>
              <div style="display: flex; flex-direction: column; gap: 8px;">
                ${softList.map(s => `
                  <div style="padding: 10px 14px; border-radius: 10px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                    <div style="min-width: 0; flex: 1;">
                      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span style="font-weight: 600; font-size: 0.88rem; color: #f1f5f9;">${escapeHtml(s.name || 'Softver')}</span>
                        ${s.vendor ? `<span style="font-size: 0.75rem; color: #94a3b8; background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px;">${escapeHtml(s.vendor)}</span>` : ''}
                        <span class="badge-hr ${s.is_licensed !== 0 ? 'badge-hr-active' : 'badge-hr-inactive'}" style="font-size: 0.7rem; padding: 2px 6px;">
                          ${s.is_licensed !== 0 ? 'Licenciran' : 'Nelicenciran'}
                        </span>
                      </div>
                      ${s.license_key ? `
                        <div style="font-family: var(--font-mono, monospace); font-size: 0.78rem; color: var(--yellow-primary); margin-top: 4px; display: flex; align-items: center; gap: 4px;">
                          <i data-lucide="key" style="width: 12px; height: 12px;"></i>
                          <span>${escapeHtml(s.license_key)}</span>
                        </div>
                      ` : ''}
                      ${s.note ? `
                        <div style="font-size: 0.78rem; color: #94a3b8; margin-top: 3px;">
                          ${escapeHtml(s.note)}
                        </div>
                      ` : ''}
                    </div>
                  </div>
                `).join('')}
              </div>
            `;
          }
        } else {
          softSection.style.display = 'none';
          softSection.innerHTML = '';
        }
      }

      // History timeline list
      const historyTimeline = document.getElementById('card-history-timeline');
      if (historyTimeline) {
        const historyList = item.history || [];
        if (historyList.length === 0) {
          historyTimeline.innerHTML = `
            <div style="text-align: center; padding: 20px; color: #64748b; font-size: 0.85rem;">
              Nema upisanih servisnih intervencija ili zabeleški za ovu opremu.
            </div>
          `;
        } else {
          historyTimeline.innerHTML = historyList.map(h => `
            <div class="eq-timeline-item" data-history-id="${h.id}">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <span style="font-size: 0.78rem; font-weight: 700; color: #94a3b8;">${escapeHtml(h.date || h.created_at || 'Danas')} ${h.phone ? `&bull; Tel: ${escapeHtml(h.phone)}` : ''}</span>
                ${h.id ? `
                  <button type="button" class="btn-inv-action btn-card-delete-note" data-history-id="${h.id}" title="Obriši ovu zabelešku" style="width: 24px; height: 24px; padding: 0; color: #f87171; display: inline-flex; align-items: center; justify-content: center; background: transparent; border: none; cursor: pointer;">
                    <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i>
                  </button>
                ` : ''}
              </div>
              <div style="font-size: 0.88rem; color: #e2e8f0; line-height: 1.45;">${escapeHtml(h.note || h.description || '')}</div>
            </div>
          `).join('');

          // Bind delete note buttons in card timeline
          historyTimeline.querySelectorAll('.btn-card-delete-note').forEach(btn => {
            btn.addEventListener('click', async (e) => {
              e.stopPropagation();
              const hId = btn.getAttribute('data-history-id');
              if (!hId) return;
              if (!confirm('Da li ste sigurni da želite da obrišete ovu zabelešku iz istorijata?')) return;

              try {
                const delRes = await fetch(`/api/equipment/history/${hId}`, { method: 'DELETE' });
                const delJson = await delRes.json();
                if (delJson.success) {
                  viewCard(id);
                  if (typeof showToast === 'function') showToast('Zabeleška je obrisana', 'success');
                } else {
                  alert('Greška: ' + (delJson.error || 'Nije uspelo brisanje zabeleške'));
                }
              } catch (err) {
                alert('Greška: ' + err.message);
              }
            });
          });
        }
      }

      // Bind submission note button
      const submitBtn = document.getElementById('btn-card-submit-note');
      if (submitBtn) {
        submitBtn.onclick = async () => {
          const input = document.getElementById('input-card-new-note');
          if (!input || !input.value.trim()) return;
          const noteText = input.value.trim();
          submitBtn.disabled = true;
          try {
            const hRes = await fetch(`/api/equipment/${id}/history`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ note: noteText })
            });
            const hData = await hRes.json();
            if (hData.success) {
              input.value = '';
              viewCard(id);
              if (typeof showToast === 'function') showToast('Zabeleška je uspešno sačuvana!', 'success');
            } else {
              alert('Greška: ' + (hData.error || 'Nije uspelo spremanje napomene.'));
            }
          } catch (e) {
            console.error('Error saving history note:', e);
          } finally {
            submitBtn.disabled = false;
          }
        };
      }

      // Smoothly expand modal and fade in card content
      if (win) win.classList.remove('modal-window-loading');
      if (loader) loader.style.display = 'none';
      if (content) {
        content.style.display = 'block';
        content.classList.add('eq-fade-in');
      }

      if (window.lucide) window.lucide.createIcons();

    } catch (err) {
      console.error('[EquipmentModule] Error opening card modal:', err);
      if (win) win.classList.remove('modal-window-loading');
      if (loader) loader.style.display = 'none';
      if (content) content.style.display = 'block';
    }
  }

  // ==========================================================================
  // 5. LIFECYCLE & EXPORTS
  // ==========================================================================

  /**
   * Initializes the entire Equipment module.
   */
  async function init() {
    if (state.hasInitialized) return;
    state.hasInitialized = true;

    bindEvents();
    setupLiveSSE();

    await Promise.all([
      refreshSidebarCategories(),
      refreshKPIStats(),
      loadCodebooks()
    ]);

    // Check if initial hash or URL points to equipment
    if (window.location.hash === '#equipment') {
      loadEquipmentTable();
    }
  }

  // Lifecycle hook called when Tab 'equipment' is activated
  function onTabActivated(targetCategory) {
    if (!state.hasInitialized) {
      init().then(() => {
        if (targetCategory) selectCategory(targetCategory);
        else loadEquipmentTable();
      });
    } else {
      if (targetCategory) selectCategory(targetCategory);
      else loadEquipmentTable();
    }
    triggerSyncCheck();
  }

  // Export public API to window
  window.EquipmentModule = {
    init,
    onTabActivated,
    selectCategory,
    reload: loadEquipmentTable,
    refreshSidebarCategories,
    refreshKPIStats,
    triggerSyncCheck,
    exportToExcel: exportEquipmentToExcel,
    goToPage,
    changePageSize,
    viewCard,
    openAddModal,
    openEditModal,
    openDeleteModal,
    openHistoryModal,
    getState: () => ({ ...state })
  };

  // Auto-init on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
