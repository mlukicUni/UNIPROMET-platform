/**
 * ==========================================================================
 * UNIPROMET IT ADMIN - MTS BROJEVI & SIM KARTICE CLIENT MODULE
 * Manages MTS numbers, live Navision enrichment, logs timeline, Excel export,
 * and 2-way real-time legacy synchronization (192.168.121.20).
 * ==========================================================================
 */

(function () {
  // Module State
  const state = {
    searchQuery: '',
    currentCategory: '', // '' | 'Mobilni' | 'GPS'
    currentStatus: '',   // '' | 'Aktivan' | 'Ugašen'
    currentPackage: '',
    currentDodatak: '',
    currentPage: 1,
    pageSize: 50,
    totalItems: 0,
    totalPages: 1,
    packages: [],
    isLoading: false,
    hasInitialized: false,
    searchDebounceTimer: null,
    currentPhoneForLogs: null,
    deleteTargetId: null,
    deleteTargetPhone: null
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

  async function fetchMtsStats() {
    try {
      const res = await fetch('/api/mts/stats');
      const json = await res.json();
      if (!json.success || !json.data) return;
      const s = json.data;

      // Update KPI banner numbers
      const elTotal = document.getElementById('kpi-mts-total');
      const elMobile = document.getElementById('kpi-mts-mobile');
      const elGps = document.getElementById('kpi-mts-gps');
      const elAddons = document.getElementById('kpi-mts-addons');
      const elBadge = document.getElementById('badge-nav-mts-total');

      if (elTotal) elTotal.textContent = s.total;
      if (elMobile) elMobile.textContent = s.mobileActive;
      if (elGps) elGps.textContent = s.gpsTotal;
      if (elAddons) elAddons.textContent = s.withAddons;
      if (elBadge) elBadge.textContent = s.total;
    } catch (e) {
      console.warn('[MTS] Error fetching stats:', e);
    }
  }

  async function fetchMtsPackages() {
    try {
      const res = await fetch('/api/mts/packages');
      const json = await res.json();
      if (!json.success || !Array.isArray(json.data)) return;
      state.packages = json.data;

      // Populate datalist for modal input
      const datalist = document.getElementById('mts-packages-datalist');
      if (datalist) {
        datalist.innerHTML = state.packages
          .map(p => `<option value="${escapeHtml(p.opis)}">${escapeHtml(p.opis)} (${escapeHtml(p.tip)})</option>`)
          .join('');
      }

      // Populate package filter dropdown
      const selectPkg = document.getElementById('select-mts-package');
      if (selectPkg) {
        const uniquePkgNames = Array.from(new Set(state.packages.filter(p => p.tip === 'Paket').map(p => p.opis)));
        let opts = `<option value="">Svi Paketi</option>`;
        for (const name of uniquePkgNames) {
          opts += `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
        }
        selectPkg.innerHTML = opts;
      }
    } catch (e) {
      console.warn('[MTS] Error fetching packages:', e);
    }
  }

  async function fetchMtsNumbers(page = 1) {
    if (state.isLoading) return;
    state.isLoading = true;
    state.currentPage = page;

    const tbody = document.getElementById('tbody-mts');
    if (tbody && (!tbody.children.length || tbody.querySelector('.inv-empty-state'))) {
      tbody.innerHTML = `
        <tr>
          <td colspan="10" style="text-align: center; padding: 40px 20px;">
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: #94a3b8;">
              <i data-lucide="loader-2" class="spin" style="width: 28px; height: 28px; color: var(--yellow-primary);"></i>
              <span style="font-size: 0.9rem;">Učitavanje MTS brojeva...</span>
            </div>
          </td>
        </tr>
      `;
      if (window.lucide && window.lucide.createIcons) window.lucide.createIcons({ root: tbody });
    }

    try {
      const params = new URLSearchParams();
      if (state.searchQuery) params.set('search', state.searchQuery);
      if (state.currentCategory) params.set('category', state.currentCategory);
      if (state.currentStatus) params.set('status', state.currentStatus);
      if (state.currentPackage) params.set('package', state.currentPackage);
      if (state.currentDodatak) params.set('dodatak', state.currentDodatak);
      params.set('page', String(page));
      params.set('limit', String(state.pageSize));

      const res = await fetch(`/api/mts?${params.toString()}`);
      const json = await res.json();

      if (!json.success) throw new Error(json.error || 'Neuspešno preuzimanje podataka');

      state.totalItems = json.pagination.total;
      state.totalPages = json.pagination.totalPages;

      renderMtsTable(json.data);
      renderMtsPagination();
      updateResetButtonVisibility();
    } catch (err) {
      console.error('[MTS] Error loading numbers:', err);
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="10" style="text-align: center; padding: 30px; color: #ef4444;">
              <i data-lucide="alert-triangle" style="margin-bottom: 8px; width: 24px; height: 24px;"></i>
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

  function renderMtsTable(items) {
    const tbody = document.getElementById('tbody-mts');
    if (!tbody) return;

    if (!items || items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="10" style="text-align: center; padding: 48px 20px;">
            <div class="inv-empty-state" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;">
              <div class="inv-empty-icon" style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.2); width: 44px; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: var(--yellow-primary);">
                <i data-lucide="smartphone-off" style="width: 22px; height: 22px;"></i>
              </div>
              <strong style="color: #f8fafc; font-size: 0.95rem; margin-top: 4px;">Nema pronađenih MTS brojeva</strong>
              <p class="text-dim text-xs" style="margin: 0; max-width: 360px;">Nijedan broj ne odgovara izabranim filterima ili pretrazi.</p>
            </div>
          </td>
        </tr>
      `;
      if (window.lucide && window.lucide.createIcons) window.lucide.createIcons({ root: tbody });
      return;
    }

    let html = '';
    for (const item of items) {
      const isGps = (item.category || '').toUpperCase() === 'GPS';
      const isActive = (item.status || '').toUpperCase().includes('AKTIV');

      // Category Pill
      const catBadge = isGps
        ? `<span class="badge" style="background: rgba(2, 132, 199, 0.15); color: #38bdf8; border: 1px solid rgba(2, 132, 199, 0.3); font-weight: 600; font-size: 0.72rem; padding: 2px 7px;">GPS</span>`
        : `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); font-weight: 600; font-size: 0.72rem; padding: 2px 7px;">Mobilni</span>`;

      // Status Pill
      const statusBadge = isActive
        ? `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); font-weight: 600; font-size: 0.72rem; padding: 2px 7px;">Aktivan</span>`
        : `<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); font-weight: 600; font-size: 0.72rem; padding: 2px 7px;">Ugašen</span>`;

      // Package Badge
      const pkgBadge = item.package
        ? `<span class="mts-badge-pkg"><i data-lucide="package"></i>${escapeHtml(item.package)}</span>`
        : `<span class="text-dim text-xs">—</span>`;

      // Internet Badge
      const netBadge = item.dodatak_internet
        ? `<span class="mts-badge-net"><i data-lucide="wifi"></i>${escapeHtml(item.dodatak_internet)} GB</span>`
        : `<span class="text-dim text-xs">—</span>`;

      // Other Addons (dodatak1, dodatak2, dodatak3)
      const addons = [item.dodatak1, item.dodatak2, item.dodatak3].filter(Boolean);
      let addonsHtml = `<span class="text-dim text-xs">—</span>`;
      if (addons.length > 0) {
        addonsHtml = addons.map(a => `<span class="mts-badge-addon">${escapeHtml(a)}</span>`).join('');
      }

      // Employee Info (Navision)
      let employeeHtml = `<span class="text-dim text-xs" style="font-style: italic;">Nije zaduženo u Navisionu</span>`;
      if (item.employee_name) {
        const typeBadge = item.phone_type_badge
          ? `<span class="mts-phone-type-tag" title="Tip linije u Navisionu">${escapeHtml(item.phone_type_badge)}</span>`
          : '';
        const deptStr = item.employee_dept ? ` &bull; ${escapeHtml(item.employee_dept)}` : '';
        const jobStr = item.employee_job ? `<div class="text-dim text-xs" style="margin-top: 2px; max-width: 230px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(item.employee_job)}${deptStr}</div>` : '';

        employeeHtml = `
          <div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <strong style="color: #f1f5f9; font-size: 0.88rem;">${escapeHtml(item.employee_name)}</strong>
              ${typeBadge}
            </div>
            ${jobStr}
          </div>
        `;
      }

      // Logs count button
      const logsCount = item.logs_count || 0;
      const logsBtn = `
        <button type="button" class="btn-inv-action btn-mts-logs" data-phone="${escapeHtml(item.phone)}" data-id="${item.id}" title="Prikaži zabeleške i intervencije (${logsCount})" style="width: auto; min-width: 32px; padding: 0 8px; gap: 5px; font-size: 0.76rem; font-weight: 600; font-family: var(--font-mono, monospace);">
          <i data-lucide="message-square" style="width: 13px; height: 13px;"></i>
          <span>${logsCount}</span>
        </button>
      `;

      html += `
        <tr data-id="${item.id}" data-phone="${escapeHtml(item.phone)}">
          <td class="font-mono text-dim text-xs" style="text-align: center;">#${item.id}</td>
          <td>
            <div class="mts-phone-cell">
              <div class="eq-avatar ${isGps ? 'eq-type-network' : 'eq-type-pc'}">
                <i data-lucide="${isGps ? 'navigation' : 'smartphone'}"></i>
              </div>
              <div class="eq-info-block">
                <span class="mts-phone-num">${escapeHtml(item.phone)}</span>
                ${item.date_received ? `<span class="text-dim text-xs" style="font-size: 0.72rem;">Ugovor: ${escapeHtml(item.date_received)}</span>` : ''}
              </div>
            </div>
          </td>
          <td style="text-align: center;">${catBadge}</td>
          <td style="text-align: center;">${statusBadge}</td>
          <td>${pkgBadge}</td>
          <td>${netBadge}</td>
          <td>${addonsHtml}</td>
          <td>${employeeHtml}</td>
          <td style="text-align: center;">${logsBtn}</td>
          <td style="text-align: right;">
            <div class="inv-actions-cell" style="justify-content: flex-end; gap: 4px;">
              <button type="button" class="btn-inv-action btn-mts-edit" data-id="${item.id}" title="Izmeni MTS broj">
                <i data-lucide="pencil"></i>
              </button>
              <button type="button" class="btn-inv-action btn-danger btn-inv-action-delete btn-mts-delete" data-id="${item.id}" data-phone="${escapeHtml(item.phone)}" style="color: #f87171;" title="Obriši MTS broj">
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

  function renderMtsPagination() {
    const counter = document.getElementById('mts-counter-text');
    const container = document.getElementById('mts-pagination-controls');
    if (!container) return;

    const start = state.totalItems === 0 ? 0 : (state.currentPage - 1) * state.pageSize + 1;
    const end = Math.min(state.currentPage * state.pageSize, state.totalItems);
    if (counter) {
      counter.textContent = `Prikazano: ${state.totalItems > 0 ? start : 0}-${end} od ukupno ${state.totalItems.toLocaleString('sr-RS')} MTS brojeva`;
    }

    if (state.totalPages <= 1) {
      container.innerHTML = '';
      return;
    }

    let html = '';
    const prevDisabled = state.currentPage === 1;
    html += `<button type="button" class="btn-dark-sm btn-mts-page" style="padding: 4px 10px; height: 30px; ${prevDisabled ? 'opacity: 0.4; pointer-events: none;' : ''}" data-page="${state.currentPage - 1}"><i data-lucide="chevron-left" style="width: 14px; height: 14px;"></i></button>`;

    let startPage = Math.max(1, state.currentPage - 2);
    let endPage = Math.min(state.totalPages, startPage + 4);
    if (endPage - startPage < 4) {
      startPage = Math.max(1, endPage - 4);
    }

    for (let p = startPage; p <= endPage; p++) {
      const active = (p === state.currentPage);
      html += `<button type="button" class="${active ? 'btn-yellow-solid-sm' : 'btn-dark-sm'} btn-mts-page" style="padding: 2px 10px; height: 30px; min-width: 32px;" data-page="${p}">${p}</button>`;
    }

    const nextDisabled = state.currentPage === state.totalPages;
    html += `<button type="button" class="btn-dark-sm btn-mts-page" style="padding: 4px 10px; height: 30px; ${nextDisabled ? 'opacity: 0.4; pointer-events: none;' : ''}" data-page="${state.currentPage + 1}"><i data-lucide="chevron-right" style="width: 14px; height: 14px;"></i></button>`;

    container.innerHTML = html;
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons({ root: container });
  }

  function updateResetButtonVisibility() {
    const btnReset = document.getElementById('btn-reset-mts-filters');
    const hasFilter = Boolean(state.searchQuery || state.currentCategory || state.currentStatus || state.currentPackage || state.currentDodatak);
    if (btnReset) btnReset.style.display = hasFilter ? 'inline-flex' : 'none';
  }

  // ==========================================================================
  // EMPLOYEE AUTOCOMPLETE & SELECTION (NAVISION HR)
  // ==========================================================================

  let empSearchTimer = null;

  function setMtsSelectedEmployee(emp) {
    const hiddenEmpNo = document.getElementById('mts-input-emp-no');
    const selectedBox = document.getElementById('mts-selected-emp-box');
    const searchInput = document.getElementById('mts-edit-emp-search');
    const list = document.getElementById('mts-emp-autocomplete-list');

    if (list) list.style.display = 'none';

    if (emp && (emp.employee_no || emp.first_name || emp.full_name)) {
      if (hiddenEmpNo) hiddenEmpNo.value = emp.employee_no || '';
      if (searchInput) searchInput.value = '';

      const nameEl = document.getElementById('mts-selected-emp-name');
      const statusEl = document.getElementById('mts-selected-emp-status');
      const noEl = document.getElementById('mts-selected-emp-no');
      const jobEl = document.getElementById('mts-selected-emp-job');
      const deptEl = document.getElementById('mts-selected-emp-dept');

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

  function handleMtsEmployeeSearch(query) {
    const spinner = document.getElementById('mts-emp-search-spinner');
    const list = document.getElementById('mts-emp-autocomplete-list');
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
          renderMtsEmployeeAutocomplete(json.data);
        }
      } catch (err) {
        console.warn('[MTS] Employee search error:', err);
      } finally {
        if (spinner) spinner.style.display = 'none';
      }
    }, 300);
  }

  function renderMtsEmployeeAutocomplete(employees) {
    const list = document.getElementById('mts-emp-autocomplete-list');
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
        if (emp) setMtsSelectedEmployee(emp);
      });
    });

    list.style.display = 'block';
  }

  // ==========================================================================
  // MODALS & ACTIONS
  // ==========================================================================

  function openMtsEditModal(item = null) {
    const modal = document.getElementById('modal-mts-edit');
    const title = document.getElementById('modal-mts-title');
    const form = document.getElementById('form-mts-edit');
    if (!modal || !form) return;

    form.reset();

    const inId = document.getElementById('mts-input-id');
    const inPhone = document.getElementById('mts-input-phone');
    const inCat = document.getElementById('mts-input-category');
    const inStat = document.getElementById('mts-input-status');
    const inProv = document.getElementById('mts-input-provider');
    const inPkg = document.getElementById('mts-input-package');
    const inNet = document.getElementById('mts-input-internet');
    const inD1 = document.getElementById('mts-input-dodatak1');
    const inD2 = document.getElementById('mts-input-dodatak2');
    const inD3 = document.getElementById('mts-input-dodatak3');
    const inDate = document.getElementById('mts-input-date');

    if (item) {
      if (title) title.textContent = `Izmena MTS Broja #${item.id}`;
      if (inId) inId.value = item.id;
      if (inPhone) inPhone.value = item.phone || '';
      if (inCat) inCat.value = item.category || 'Mobilni';
      if (inStat) inStat.value = item.status || 'Aktivan';
      if (inProv) inProv.value = item.provider || 'MTS';
      if (inPkg) inPkg.value = item.package || '';
      if (inNet) inNet.value = item.dodatak_internet || '';
      if (inD1) inD1.value = item.dodatak1 || '';
      if (inD2) inD2.value = item.dodatak2 || '';
      if (inD3) inD3.value = item.dodatak3 || '';
      if (inDate) inDate.value = item.date_received || '';

      if (item.employee_no || item.employee_name) {
        setMtsSelectedEmployee({
          employee_no: item.employee_no,
          first_name: item.employee_name,
          last_name: '',
          hr_status: item.employee_status || 'Aktivan',
          job_title: item.employee_job || '—',
          department: item.employee_dept || 'Unipromet'
        });
      } else {
        setMtsSelectedEmployee(null);
      }
    } else {
      if (title) title.textContent = 'Evidentiraj Novi MTS Broj';
      if (inId) inId.value = '';
      if (inCat) inCat.value = 'Mobilni';
      if (inStat) inStat.value = 'Aktivan';
      if (inProv) inProv.value = 'MTS';
      if (inNet) inNet.value = '';
      setMtsSelectedEmployee(null);
    }

    if (window.openModal) window.openModal(modal);
    else modal.style.display = 'flex';
  }

  async function handleMtsSaveSubmit(e) {
    e.preventDefault();
    const inId = document.getElementById('mts-input-id');
    const inPhone = document.getElementById('mts-input-phone');
    const inCat = document.getElementById('mts-input-category');
    const inStat = document.getElementById('mts-input-status');
    const inProv = document.getElementById('mts-input-provider');
    const inPkg = document.getElementById('mts-input-package');
    const inNet = document.getElementById('mts-input-internet');
    const inD1 = document.getElementById('mts-input-dodatak1');
    const inD2 = document.getElementById('mts-input-dodatak2');
    const inD3 = document.getElementById('mts-input-dodatak3');
    const inDate = document.getElementById('mts-input-date');
    const inEmpNo = document.getElementById('mts-input-emp-no');

    const id = inId?.value ? parseInt(inId.value, 10) : null;
    const phone = inPhone?.value?.trim();
    if (!phone) {
      showToast('Broj telefona je obavezan', 'error');
      return;
    }

    const payload = {
      phone,
      category: inCat?.value || 'Mobilni',
      status: inStat?.value || 'Aktivan',
      provider: inProv?.value?.trim() || 'MTS',
      package: inPkg?.value?.trim() || null,
      dodatak_internet: inNet?.value || null,
      dodatak1: inD1?.value?.trim() || null,
      dodatak2: inD2?.value?.trim() || null,
      dodatak3: inD3?.value?.trim() || null,
      date_received: inDate?.value?.trim() || null,
      employee_no: inEmpNo?.value?.trim() || null
    };

    const submitBtn = document.getElementById('btn-save-mts-submit');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Čuvanje...`;
      if (window.lucide && window.lucide.createIcons) window.lucide.createIcons({ root: submitBtn });
    }

    try {
      const url = id ? `/api/mts/${id}` : '/api/mts';
      const method = id ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Greška pri čuvanju');

      showToast(json.message || (id ? 'MTS broj je ažuriran' : 'MTS broj je dodat'), 'success');

      const modal = document.getElementById('modal-mts-edit');
      if (window.closeModal) window.closeModal(modal);
      else if (modal) modal.style.display = 'none';

      await fetchMtsStats();
      await fetchMtsNumbers(state.currentPage);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<i data-lucide="save"></i> <span>Sačuvaj Broj</span>`;
        if (window.lucide && window.lucide.createIcons) window.lucide.createIcons({ root: submitBtn });
      }
    }
  }

  // Logs History Modal
  async function openMtsLogsModal(phone) {
    state.currentPhoneForLogs = phone;
    const modal = document.getElementById('modal-mts-logs');
    const title = document.getElementById('modal-mts-logs-title');
    const subtitle = document.getElementById('modal-mts-logs-subtitle');
    const timeline = document.getElementById('mts-logs-timeline');
    const input = document.getElementById('input-mts-new-log-text');
    if (!modal) return;

    if (title) title.textContent = `Zabeleške za ${phone}`;
    if (subtitle) subtitle.textContent = `Hronologija evidencija i napomena sa servera 121.20`;
    if (input) input.value = '';

    if (timeline) {
      timeline.innerHTML = `<div style="text-align: center; padding: 20px; color: #94a3b8;"><i data-lucide="loader-2" class="spin"></i> Učitavanje zabeleški...</div>`;
      if (window.lucide && window.lucide.createIcons) window.lucide.createIcons({ root: timeline });
    }

    if (window.openModal) window.openModal(modal);
    else modal.style.display = 'flex';

    await loadMtsLogs(phone);
  }

  async function loadMtsLogs(phone) {
    const timeline = document.getElementById('mts-logs-timeline');
    if (!timeline) return;

    try {
      const res = await fetch(`/api/mts/phone/${encodeURIComponent(phone)}/logs`);
      const json = await res.json();
      if (!json.success || !Array.isArray(json.data) || json.data.length === 0) {
        timeline.innerHTML = `
          <div style="text-align: center; padding: 24px; color: #94a3b8;">
            <i data-lucide="info" style="margin-bottom: 6px; width: 20px; height: 20px;"></i>
            <div>Nema unetih zabeleški za ovaj broj.</div>
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
                <button type="button" class="btn-inv-action btn-danger btn-delete-mts-log" data-id="${log.id}" title="Obriši zabelešku" style="width: 24px; height: 24px; color: #f87171;">
                  <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i>
                </button>
              </div>
              <p style="margin: 4px 0 0 0; color: #f1f5f9; font-size: 0.88rem; line-height: 1.45; white-space: pre-wrap;">${escapeHtml(log.text)}</p>
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

  async function handleAddMtsLogSubmit() {
    if (!state.currentPhoneForLogs) return;
    const input = document.getElementById('input-mts-new-log-text');
    const text = input?.value?.trim();
    if (!text) {
      showToast('Tekst zabeleške je obavezan', 'warning');
      return;
    }

    const btn = document.getElementById('btn-mts-submit-log');
    if (btn) btn.disabled = true;

    try {
      const res = await fetch(`/api/mts/phone/${encodeURIComponent(state.currentPhoneForLogs)}/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, date: new Date().toISOString().split('T')[0] })
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Greška pri čuvanju zabeleške');

      if (input) input.value = '';
      showToast('Zabeleška je uspešno upisana', 'success');
      await loadMtsLogs(state.currentPhoneForLogs);
      fetchMtsNumbers(state.currentPage);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function handleDeleteMtsLog(logId) {
    if (!confirm('Da li ste sigurni da želite obrisati ovu zabelešku?')) return;
    try {
      const res = await fetch(`/api/mts/logs/${logId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Greška pri brisanju');
      showToast('Zabeleška je obrisana', 'info');
      if (state.currentPhoneForLogs) await loadMtsLogs(state.currentPhoneForLogs);
      fetchMtsNumbers(state.currentPage);
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  // Delete MTS Number
  function openMtsDeleteModal(id, phone) {
    state.deleteTargetId = id;
    state.deleteTargetPhone = phone;

    const modal = document.getElementById('modal-mts-delete');
    const phoneEl = document.getElementById('mts-delete-phone');
    const metaEl = document.getElementById('mts-delete-meta');
    if (!modal) return;

    if (phoneEl) phoneEl.textContent = phone;
    if (metaEl) metaEl.textContent = `ID: #${id}`;

    if (window.openModal) window.openModal(modal);
    else modal.style.display = 'flex';
  }

  async function handleConfirmMtsDelete() {
    if (!state.deleteTargetId) return;

    const btn = document.getElementById('btn-confirm-mts-delete');
    if (btn) btn.disabled = true;

    try {
      const res = await fetch(`/api/mts/${state.deleteTargetId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Greška pri brisanju');

      showToast(`MTS broj ${state.deleteTargetPhone} je obrisan`, 'success');

      const modal = document.getElementById('modal-mts-delete');
      if (window.closeModal) window.closeModal(modal);
      else if (modal) modal.style.display = 'none';

      await fetchMtsStats();
      await fetchMtsNumbers(state.currentPage);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // Sync Action
  async function triggerMtsSync() {
    const spinIcon = document.getElementById('icon-sync-mts-spin');
    if (spinIcon) spinIcon.classList.add('spin');

    try {
      const res = await fetch('/api/equipment/sync-check');
      const json = await res.json();

      if (json.changed) {
        showToast(`⚡ Sinhronizovane promene sa servera 121.20 (${json.durationMs}ms)`, 'success');
      } else {
        showToast(`Baza je u potpunosti sinhronizovana (${json.durationMs}ms)`, 'info');
      }

      await fetchMtsStats();
      await fetchMtsNumbers(state.currentPage);
    } catch (e) {
      showToast('Greška pri sinhronizaciji: ' + e.message, 'error');
    } finally {
      setTimeout(() => {
        if (spinIcon) spinIcon.classList.remove('spin');
      }, 500);
    }
  }

  // Export to Excel
  function exportMtsExcel() {
    const params = new URLSearchParams();
    if (state.searchQuery) params.set('search', state.searchQuery);
    if (state.currentCategory) params.set('category', state.currentCategory);
    if (state.currentStatus) params.set('status', state.currentStatus);
    if (state.currentPackage) params.set('package', state.currentPackage);
    if (state.currentDodatak) params.set('dodatak', state.currentDodatak);

    showToast('Generisanje Excel fajla u toku...', 'info');
    window.location.href = `/api/mts/export/excel?${params.toString()}`;
  }

  // ==========================================================================
  // EVENT LISTENERS & INITIALIZATION
  // ==========================================================================

  function bindEvents() {
    // Search input debounce
    const searchInput = document.getElementById('search-mts');
    const btnClearSearch = document.getElementById('btn-clear-search-mts');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const val = searchInput.value;
        if (btnClearSearch) btnClearSearch.style.display = val ? 'block' : 'none';
        clearTimeout(state.searchDebounceTimer);
        state.searchDebounceTimer = setTimeout(() => {
          state.searchQuery = val.trim();
          fetchMtsNumbers(1);
        }, 300);
      });
    }

    if (btnClearSearch) {
      btnClearSearch.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        btnClearSearch.style.display = 'none';
        state.searchQuery = '';
        fetchMtsNumbers(1);
      });
    }

    // Category Select
    const selectCat = document.getElementById('select-mts-category');
    if (selectCat) {
      selectCat.addEventListener('change', () => {
        state.currentCategory = selectCat.value;
        fetchMtsNumbers(1);
      });
    }

    // Status Select
    const selectStat = document.getElementById('select-mts-status');
    if (selectStat) {
      selectStat.addEventListener('change', () => {
        state.currentStatus = selectStat.value;
        fetchMtsNumbers(1);
      });
    }

    // Package Select
    const selectPkg = document.getElementById('select-mts-package');
    if (selectPkg) {
      selectPkg.addEventListener('change', () => {
        state.currentPackage = selectPkg.value;
        fetchMtsNumbers(1);
      });
    }

    // Reset Filters
    const btnReset = document.getElementById('btn-reset-mts-filters');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        state.searchQuery = '';
        state.currentCategory = '';
        state.currentStatus = '';
        state.currentPackage = '';
        state.currentDodatak = '';

        if (searchInput) searchInput.value = '';
        if (btnClearSearch) btnClearSearch.style.display = 'none';
        if (selectCat) selectCat.value = '';
        if (selectStat) selectStat.value = '';
        if (selectPkg) selectPkg.value = '';

        fetchMtsNumbers(1);
      });
    }

    // KPI Card Click Handlers for Quick Filtering
    const kpiTotal = document.getElementById('kpi-card-mts-total');
    if (kpiTotal) {
      kpiTotal.addEventListener('click', () => {
        state.currentCategory = '';
        state.currentStatus = '';
        state.currentPackage = '';
        state.currentDodatak = '';
        if (selectCat) selectCat.value = '';
        if (selectStat) selectStat.value = '';
        if (selectPkg) selectPkg.value = '';
        fetchMtsNumbers(1);
      });
    }

    const kpiMobile = document.getElementById('kpi-card-mts-mobile');
    if (kpiMobile) {
      kpiMobile.addEventListener('click', () => {
        state.currentCategory = 'Mobilni';
        state.currentStatus = 'Aktivan';
        if (selectCat) selectCat.value = 'Mobilni';
        if (selectStat) selectStat.value = 'Aktivan';
        fetchMtsNumbers(1);
      });
    }

    const kpiGps = document.getElementById('kpi-card-mts-gps');
    if (kpiGps) {
      kpiGps.addEventListener('click', () => {
        state.currentCategory = 'GPS';
        state.currentStatus = '';
        if (selectCat) selectCat.value = 'GPS';
        if (selectStat) selectStat.value = '';
        fetchMtsNumbers(1);
      });
    }

    const kpiAddons = document.getElementById('kpi-card-mts-addons');
    if (kpiAddons) {
      kpiAddons.addEventListener('click', () => {
        state.currentDodatak = '1';
        fetchMtsNumbers(1);
      });
    }

    // Top action buttons
    const btnAdd = document.getElementById('btn-add-mts');
    if (btnAdd) btnAdd.addEventListener('click', () => openMtsEditModal(null));

    const btnSync = document.getElementById('btn-sync-mts-status');
    if (btnSync) btnSync.addEventListener('click', triggerMtsSync);

    const btnExport = document.getElementById('btn-export-mts-excel');
    if (btnExport) btnExport.addEventListener('click', exportMtsExcel);

    // Employee Autocomplete Search & Clear in Modal
    const inEmpSearch = document.getElementById('mts-edit-emp-search');
    if (inEmpSearch) {
      inEmpSearch.addEventListener('input', (e) => {
        handleMtsEmployeeSearch(e.target.value);
      });
      inEmpSearch.addEventListener('focus', (e) => {
        if (e.target.value.trim().length >= 2) {
          handleMtsEmployeeSearch(e.target.value);
        }
      });
    }

    const btnRemoveSelectedEmp = document.getElementById('btn-remove-mts-selected-emp');
    if (btnRemoveSelectedEmp) {
      btnRemoveSelectedEmp.addEventListener('click', () => {
        setMtsSelectedEmployee(null);
      });
    }

    // Close autocomplete dropdown on outside click
    document.addEventListener('click', (e) => {
      const list = document.getElementById('mts-emp-autocomplete-list');
      const search = document.getElementById('mts-edit-emp-search');
      if (list && list.style.display !== 'none') {
        if (!list.contains(e.target) && e.target !== search) {
          list.style.display = 'none';
        }
      }
    });

    // Form Edit Submit
    const formEdit = document.getElementById('form-mts-edit');
    if (formEdit) formEdit.addEventListener('submit', handleMtsSaveSubmit);

    // Close Modal Buttons
    const btnCloseModal = document.getElementById('btn-close-mts-modal');
    const btnCancelModal = document.getElementById('btn-cancel-mts-modal');
    if (btnCloseModal) btnCloseModal.addEventListener('click', () => window.closeModal?.(document.getElementById('modal-mts-edit')));
    if (btnCancelModal) btnCancelModal.addEventListener('click', () => window.closeModal?.(document.getElementById('modal-mts-edit')));

    // Logs modal close
    const btnCloseLogs = document.getElementById('btn-close-mts-logs-modal');
    const btnCloseLogs2 = document.getElementById('btn-close-mts-logs-btn');
    if (btnCloseLogs) btnCloseLogs.addEventListener('click', () => window.closeModal?.(document.getElementById('modal-mts-logs')));
    if (btnCloseLogs2) btnCloseLogs2.addEventListener('click', () => window.closeModal?.(document.getElementById('modal-mts-logs')));

    // Submit new log
    const btnSubmitLog = document.getElementById('btn-mts-submit-log');
    if (btnSubmitLog) btnSubmitLog.addEventListener('click', handleAddMtsLogSubmit);

    // Delete modal handlers
    const btnCloseDel = document.getElementById('btn-close-mts-delete-modal');
    const btnCancelDel = document.getElementById('btn-cancel-mts-delete');
    const btnConfirmDel = document.getElementById('btn-confirm-mts-delete');
    if (btnCloseDel) btnCloseDel.addEventListener('click', () => window.closeModal?.(document.getElementById('modal-mts-delete')));
    if (btnCancelDel) btnCancelDel.addEventListener('click', () => window.closeModal?.(document.getElementById('modal-mts-delete')));
    if (btnConfirmDel) btnConfirmDel.addEventListener('click', handleConfirmMtsDelete);

    // Event delegation on table body (Edit, Delete, Logs)
    const tbody = document.getElementById('tbody-mts');
    if (tbody) {
      tbody.addEventListener('click', async (e) => {
        const btnEdit = e.target.closest('.btn-mts-edit');
        if (btnEdit) {
          const id = parseInt(btnEdit.getAttribute('data-id'), 10);
          try {
            const res = await fetch(`/api/mts/${id}`);
            const json = await res.json();
            if (json.success && json.data) openMtsEditModal(json.data);
          } catch (err) {
            showToast('Greška pri učitavanju detalja: ' + err.message, 'error');
          }
          return;
        }

        const btnDel = e.target.closest('.btn-mts-delete');
        if (btnDel) {
          const id = parseInt(btnDel.getAttribute('data-id'), 10);
          const phone = btnDel.getAttribute('data-phone');
          openMtsDeleteModal(id, phone);
          return;
        }

        const btnLogs = e.target.closest('.btn-mts-logs');
        if (btnLogs) {
          const phone = btnLogs.getAttribute('data-phone');
          openMtsLogsModal(phone);
          return;
        }
      });
    }

    // Event delegation on timeline delete button
    const timeline = document.getElementById('mts-logs-timeline');
    if (timeline) {
      timeline.addEventListener('click', (e) => {
        const btnDelLog = e.target.closest('.btn-delete-mts-log');
        if (btnDelLog) {
          const id = parseInt(btnDelLog.getAttribute('data-id'), 10);
          handleDeleteMtsLog(id);
        }
      });
    }

    // Pagination controls delegation
    const paginationContainer = document.getElementById('mts-pagination-controls');
    if (paginationContainer) {
      paginationContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-mts-page');
        if (!btn || btn.classList.contains('active')) return;
        const page = parseInt(btn.getAttribute('data-page'), 10);
        if (page > 0 && page <= state.totalPages) {
          fetchMtsNumbers(page);
          const tableEl = document.getElementById('table-mts') || document.getElementById('tab-mts_numbers');
          if (tableEl) tableEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    }
  }

  // Hook into SSE events if broadcast
  function setupSseListener() {
    if (window.EventSource) {
      const evtSource = new EventSource('/api/equipment/events');
      evtSource.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (['mts_created', 'mts_updated', 'mts_deleted', 'mts_log_added', 'mts_log_deleted', 'legacy_sync'].includes(data.type)) {
            const currentTab = document.querySelector('.nav-tab-btn.active')?.getAttribute('data-tab');
            if (currentTab === 'mts_numbers') {
              fetchMtsStats();
              fetchMtsNumbers(state.currentPage);
            }
          }
        } catch (err) {
          // Ignore parse errors
        }
      };
    }
  }

  // Public module API
  window.mtsModule = {
    init: function () {
      if (state.hasInitialized) {
        fetchMtsStats();
        fetchMtsNumbers(state.currentPage);
        return;
      }
      state.hasInitialized = true;
      bindEvents();
      setupSseListener();
      fetchMtsStats();
      fetchMtsPackages();
      fetchMtsNumbers(1);
    },
    refresh: function () {
      fetchMtsStats();
      fetchMtsNumbers(state.currentPage);
    }
  };

  // Auto-init when tab is active on DOM load
  document.addEventListener('DOMContentLoaded', () => {
    fetchMtsStats(); // Preload badge count
  });
})();
