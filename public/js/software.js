/**
 * ==========================================================================
 * UNIPROMET IT ADMIN - SOFTWARE & LICENSES CLIENT MODULE
 * Manages Windows Product Keys, Software Licenses, Navision Assignments,
 * Vendor Filters, Clipboard Copying, KPI Cards, and Real-Time SSE Sync.
 * ==========================================================================
 */

(function () {
  'use strict';

  // Module State
  const state = {
    searchQuery: '',
    currentVendor: 'ALL',
    currentLicensed: 'all', // 'all' | '1' | '0'
    currentPage: 1,
    pageSize: 50,
    totalItems: 0,
    totalPages: 1,
    sortBy: 'id',
    sortOrder: 'DESC',
    vendors: [],
    equipmentCache: [],
    isLoading: false,
    hasInitialized: false,
    searchDebounceTimer: null
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

  // Toast notification helper
  function notify(msg, type = 'info') {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type);
    } else {
      console.log(`[Toast] [${type}] ${msg}`);
    }
  }

  // Copy to clipboard helper with button visual feedback
  async function copyKeyToClipboard(key, btnEl) {
    if (!key) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(key);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = key;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }

      notify(`Kopiran licencni ključ: ${key}`, 'success');

      if (btnEl) {
        const originalHtml = btnEl.innerHTML;
        btnEl.innerHTML = '<i data-lucide="check" style="width: 13px; height: 13px; color: #10b981;"></i>';
        if (window.lucide) window.lucide.createIcons();
        setTimeout(() => {
          btnEl.innerHTML = originalHtml;
          if (window.lucide) window.lucide.createIcons();
        }, 1800);
      }
    } catch (err) {
      console.error('Greška pri kopiranju u clipboard:', err);
      notify('Nije moguće kopirati ključ', 'error');
    }
  }

  // Fetch Software Stats for KPI Cards and Sidebar Badge
  async function fetchSoftwareStats() {
    try {
      const res = await fetch('/api/equipment/software-stats');
      const json = await res.json();
      if (!json.success || !json.data) return;

      const d = json.data;
      const elTotal = document.getElementById('kpi-sw-total');
      const elLicensed = document.getElementById('kpi-sw-licensed');
      const elUnlicensed = document.getElementById('kpi-sw-unlicensed');
      const elEquipment = document.getElementById('kpi-sw-equipment');
      const badgeNav = document.getElementById('badge-nav-software-total');

      if (elTotal) elTotal.textContent = d.total.toLocaleString();
      if (elLicensed) elLicensed.textContent = d.licensed.toLocaleString();
      if (elUnlicensed) elUnlicensed.textContent = d.unlicensed.toLocaleString();
      if (elEquipment) elEquipment.textContent = d.unique_equipment.toLocaleString();
      if (badgeNav) badgeNav.textContent = d.total.toLocaleString();
    } catch (err) {
      console.warn('[SoftwareModule] Greška pri preuzimanju statistike licenci:', err);
    }
  }

  // Fetch Software Vendors for Quick Filter Pills
  async function fetchSoftwareVendors() {
    try {
      const res = await fetch('/api/equipment/software-vendors');
      const json = await res.json();
      if (!json.success || !json.data) return;

      state.vendors = json.data;
      renderVendorFilterPills();
    } catch (err) {
      console.warn('[SoftwareModule] Greška pri preuzimanju vendora:', err);
    }
  }

  // Render Vendor Filter Pills matching equipment module style
  function renderVendorFilterPills() {
    const container = document.getElementById('software-vendor-pills');
    if (!container) return;

    let totalCount = 0;
    state.vendors.forEach(v => { totalCount += v.count; });

    let html = `
      <button type="button" class="eq-pill-btn ${state.currentVendor === 'ALL' ? 'active' : ''}" data-vendor="ALL">
        <i data-lucide="layers"></i>
        <span>Svi Proizvođači</span>
        <span class="eq-pill-count">${totalCount}</span>
      </button>
    `;

    state.vendors.forEach(v => {
      const isSelected = state.currentVendor === v.vendor;
      let icon = 'box';
      const upper = v.vendor.toUpperCase();
      if (upper.includes('MS') || upper.includes('MICROSOFT') || upper.includes('WIN')) icon = 'monitor';
      else if (upper.includes('AUTODESK') || upper.includes('CAD')) icon = 'compass';
      else if (upper.includes('ADOBE')) icon = 'palette';
      else if (upper.includes('COREL')) icon = 'pen-tool';
      else if (upper.includes('ESET')) icon = 'shield';
      else if (upper.includes('LINUX') || upper.includes('UNIX')) icon = 'terminal';
      else if (upper.includes('SIEMENS')) icon = 'cpu';
      else if (upper.includes('APPLE')) icon = 'apple';

      html += `
        <button type="button" class="eq-pill-btn ${isSelected ? 'active' : ''}" data-vendor="${escapeHtml(v.vendor)}">
          <i data-lucide="${icon}"></i>
          <span>${escapeHtml(v.vendor)}</span>
          <span class="eq-pill-count">${v.count}</span>
        </button>
      `;
    });

    container.innerHTML = html;
    if (window.lucide) window.lucide.createIcons();

    // Attach pill click listeners
    container.querySelectorAll('.eq-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.getAttribute('data-vendor') || 'ALL';
        state.currentVendor = v;
        state.currentPage = 1;
        renderVendorFilterPills();
        loadSoftwareList();
      });
    });
  }

  // Load Main Software Table Data
  async function loadSoftwareList() {
    const tbody = document.getElementById('tbody-software');
    const spinIcon = document.getElementById('icon-sync-software-spin');
    if (spinIcon) spinIcon.classList.add('spin-animate');

    if (tbody && state.isLoading) return;
    state.isLoading = true;

    if (tbody && state.currentPage === 1) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; padding: 48px 16px;">
            <div class="eq-modal-loader-spinner" style="margin: 0 auto 12px auto;"></div>
            <div class="text-dim" style="font-size: 0.9rem;">Učitavanje softverskih licenci i Windows ključeva...</div>
          </td>
        </tr>
      `;
    }

    try {
      const params = new URLSearchParams({
        page: state.currentPage,
        pageSize: state.pageSize,
        sortBy: state.sortBy,
        sortOrder: state.sortOrder
      });

      if (state.searchQuery) params.append('search', state.searchQuery);
      if (state.currentVendor && state.currentVendor !== 'ALL') params.append('vendor', state.currentVendor);
      if (state.currentLicensed !== 'all') params.append('is_licensed', state.currentLicensed);

      const res = await fetch(`/api/equipment/software-licenses?${params.toString()}`);
      const json = await res.json();

      if (!json.success) {
        throw new Error(json.error || 'Neuspešan upit');
      }

      state.totalItems = json.total || 0;
      state.totalPages = json.totalPages || 1;

      renderSoftwareTable(json.data || []);
      renderPaginationFooter();
      fetchSoftwareStats();

    } catch (err) {
      console.error('[SoftwareModule] Greška pri učitavanju tabele licenci:', err);
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="9" style="text-align: center; padding: 36px 16px; color: #ef4444;">
              <i data-lucide="alert-triangle" style="width: 28px; height: 28px; margin: 0 auto 8px auto; display: block;"></i>
              <div style="font-weight: 600; margin-bottom: 4px;">Greška pri učitavanju softverskih licenci.</div>
              <div class="text-xs" style="color: #94a3b8; margin-bottom: 12px;">${escapeHtml(err.message || '')}</div>
              <button class="btn-dark-sm" onclick="window.loadSoftwareList()">
                <i data-lucide="rotate-cw"></i>
                <span>Pokušaj ponovo</span>
              </button>
            </td>
          </tr>
        `;
        if (window.lucide) window.lucide.createIcons();
      }
    } finally {
      state.isLoading = false;
      if (spinIcon) spinIcon.classList.remove('spin-animate');
    }
  }

  // Render Table Rows with High-End Luxury Components
  function renderSoftwareTable(items) {
    const tbody = document.getElementById('tbody-software');
    if (!tbody) return;

    if (!items || items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; padding: 56px 16px; color: #94a3b8;">
            <div class="sw-app-avatar" style="width: 48px; height: 48px; margin: 0 auto 12px auto; background: rgba(255, 184, 0, 0.05); border-color: rgba(255, 184, 0, 0.15);">
              <i data-lucide="key-round" style="width: 24px; height: 24px;"></i>
            </div>
            <div style="font-weight: 700; font-size: 1.05rem; color: #f1f5f9;">Nema pronađenih licenci</div>
            <div class="text-xs" style="margin-top: 4px; color: #64748b;">Pokušajte sa drugačijim parametrima pretrage ili kliknite na "Nova Licenca".</div>
          </td>
        </tr>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    let html = '';
    items.forEach(item => {
      const isLicensed = item.is_licensed === 1;
      const key = item.license_key ? item.license_key.trim() : '';
      const vendorName = item.vendor ? item.vendor.trim() : 'N/A';
      const softName = item.name ? item.name.trim() : 'Softver';
      const upperSoft = softName.toUpperCase();
      
      // Determine software icon & category
      const isOS = upperSoft.includes('WIN') || upperSoft.includes('WINDOWS') || upperSoft.includes('LINUX') || upperSoft.includes('UNIX') || upperSoft.includes('SERVER');
      const isCad = upperSoft.includes('CAD') || upperSoft.includes('AUTOCAD') || upperSoft.includes('PROGECAD') || upperSoft.includes('INVENTOR');
      const isOffice = upperSoft.includes('OFFICE') || upperSoft.includes('WORD') || upperSoft.includes('EXCEL') || upperSoft.includes('OUTLOOK');
      const isAdobe = upperSoft.includes('PHOTOSHOP') || upperSoft.includes('ACROBAT') || upperSoft.includes('ILLUSTRATOR') || upperSoft.includes('ADOBE');
      const isSecurity = upperSoft.includes('ESET') || upperSoft.includes('ANTIVIRUS') || upperSoft.includes('SECURITY') || upperSoft.includes('NOD');

      let softIcon = 'package';
      let softCat = 'Aplikativni Softver';
      let avatarColorStyle = '';

      if (isOS) {
        softIcon = 'monitor';
        softCat = 'Operativni Sistem (OS)';
        avatarColorStyle = 'background: rgba(56, 189, 248, 0.12); border-color: rgba(56, 189, 248, 0.3); color: #38bdf8;';
      } else if (isCad) {
        softIcon = 'compass';
        softCat = 'CAD / Inženjering';
        avatarColorStyle = 'background: rgba(249, 115, 22, 0.12); border-color: rgba(249, 115, 22, 0.3); color: #fb923c;';
      } else if (isOffice) {
        softIcon = 'file-text';
        softCat = 'Kancelarijski Paket';
        avatarColorStyle = 'background: rgba(234, 88, 12, 0.12); border-color: rgba(234, 88, 12, 0.3); color: #f97316;';
      } else if (isAdobe) {
        softIcon = 'palette';
        softCat = 'Dizajn & Grafika';
        avatarColorStyle = 'background: rgba(239, 68, 68, 0.12); border-color: rgba(239, 68, 68, 0.3); color: #f87171;';
      } else if (isSecurity) {
        softIcon = 'shield-check';
        softCat = 'Zaštita & Antivirus';
        avatarColorStyle = 'background: rgba(168, 85, 247, 0.12); border-color: rgba(168, 85, 247, 0.3); color: #c084fc;';
      }

      // Vendor tag styling
      let vendorClass = 'vendor-tag-default';
      let vIcon = 'box';
      const uv = vendorName.toUpperCase();
      if (uv.includes('MS') || uv.includes('MICROSOFT')) { vendorClass = 'vendor-tag-ms'; vIcon = 'monitor'; }
      else if (uv.includes('AUTODESK')) { vendorClass = 'vendor-tag-autodesk'; vIcon = 'compass'; }
      else if (uv.includes('ADOBE')) { vendorClass = 'vendor-tag-adobe'; vIcon = 'palette'; }
      else if (uv.includes('COREL')) { vendorClass = 'vendor-tag-corel'; vIcon = 'pen-tool'; }
      else if (uv.includes('ESET')) { vendorClass = 'vendor-tag-eset'; vIcon = 'shield'; }

      // Employee info badge
      const isUnassigned = !item.employee_name || item.employee_name.toUpperCase() === 'BEZ';
      let empHtml = '<span class="badge-unassigned"><i data-lucide="user-x"></i> Nije zaduženo</span>';
      if (!isUnassigned) {
        let hrBadgeClass = 'badge-hr-active';
        const hrStatus = item.employee_status || 'Aktivan';
        if (hrStatus.toLowerCase().includes('neaktivan')) hrBadgeClass = 'badge-hr-inactive';
        else if (hrStatus.toLowerCase().includes('napustio')) hrBadgeClass = 'badge-hr-left';

        empHtml = `
          <div class="eq-emp-cell">
            <div class="eq-emp-name-row">
              <span class="eq-emp-name">${escapeHtml(item.employee_name)}</span>
            </div>
            <div class="eq-emp-sub-row" style="display: flex; align-items: center; gap: 6px; margin-top: 3px;">
              ${item.equipment_employee_no ? `<span class="eq-emp-no" title="Kadrovski broj">${escapeHtml(item.equipment_employee_no)}</span>` : ''}
              <span class="badge-hr ${hrBadgeClass}" title="Status u Navision HR bazi">${escapeHtml(hrStatus)}</span>
              ${item.employee_dept ? `<span class="text-dim text-xs" style="margin-left: 2px;">• ${escapeHtml(item.employee_dept)}</span>` : ''}
            </div>
          </div>
        `;
      }

      // Equipment name cell
      let eqHtml = '<span class="text-dim text-xs" style="color: #64748b;">— Nije povezano —</span>';
      if (item.equipment_id) {
        eqHtml = `
          <div class="sw-equipment-cell">
            <div class="eq-avatar eq-type-pc" style="cursor: pointer;" onclick="window.EquipmentModule && window.EquipmentModule.viewCard ? window.EquipmentModule.viewCard(${item.equipment_id}) : (window.openEquipmentCardModal && window.openEquipmentCardModal(${item.equipment_id}))" title="Otvori karton računara #${item.equipment_id}">
              <i data-lucide="monitor"></i>
            </div>
            <div class="eq-info-block">
              <a href="#" class="software-eq-link eq-name-title" data-eq-id="${item.equipment_id}" title="Prikaži detalje računara">
                ${escapeHtml(item.equipment_name || `Računar #${item.equipment_id}`)}
              </a>
              <div class="eq-name-sub">
                ${item.equipment_inv_no ? `<span class="sw-equipment-inv-badge">Inv: ${escapeHtml(item.equipment_inv_no)}</span>` : ''}
                ${item.equipment_ip ? `<span style="color: #38bdf8; display: inline-flex; align-items: center; gap: 3px;"><i data-lucide="network" style="width: 11px; height: 11px;"></i> ${escapeHtml(item.equipment_ip)}</span>` : ''}
              </div>
            </div>
          </div>
        `;
      }

      // Product Key Display with 1-click copy
      let keyHtml = '<span style="color: #475569; font-size: 0.78rem; font-style: italic;">Bez serijskog ključa</span>';
      if (key) {
        keyHtml = `
          <div class="sw-key-chip" title="Kliknite na ikonicu za kopiranje">
            <i data-lucide="key" style="width: 13px; height: 13px; color: var(--yellow-primary); flex-shrink: 0;"></i>
            <span class="sw-key-mono-text">${escapeHtml(key)}</span>
            <button type="button" class="btn-copy-sw-key" data-key="${escapeHtml(key)}" title="Kopiraj licencni ključ u clipboard">
              <i data-lucide="copy"></i>
            </button>
          </div>
        `;
      }

      html += `
        <tr class="software-row" data-id="${item.id}">
          <!-- 1. ID -->
          <td class="sw-id-cell">#${item.id}</td>

          <!-- 2. RAČUNAR / OPREMA -->
          <td>${eqHtml}</td>

          <!-- 3. ZADUŽENI RADNIK -->
          <td>${empHtml}</td>

          <!-- 4. VENDOR -->
          <td>
            <span class="software-vendor-badge ${vendorClass}">
              <i data-lucide="${vIcon}" style="width: 12px; height: 12px;"></i>
              <span>${escapeHtml(vendorName)}</span>
            </span>
          </td>

          <!-- 5. NAZIV SOFTVERA -->
          <td>
            <div class="sw-name-block">
              <div class="sw-app-avatar" style="${avatarColorStyle}">
                <i data-lucide="${softIcon}"></i>
              </div>
              <div>
                <div class="sw-name-title">${escapeHtml(softName)}</div>
                <div class="sw-name-subtitle">${softCat}</div>
              </div>
            </div>
          </td>

          <!-- 6. LICENCIRAN -->
          <td style="text-align: center;">
            <span class="badge-sw-licensed ${isLicensed ? 'is-yes' : 'is-no'}">
              <span class="sw-status-dot"></span>
              <span>${isLicensed ? 'DA' : 'NE'}</span>
            </span>
          </td>

          <!-- 7. LICENCNI KLJUČ -->
          <td>${keyHtml}</td>

          <!-- 8. NAPOMENA -->
          <td>
            <span class="text-dim text-xs" style="max-width: 180px; display: inline-block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.3;" title="${escapeHtml(item.note || '')}">
              ${escapeHtml(item.note || '—')}
            </span>
          </td>

          <!-- 9. AKCIJE -->
          <td style="text-align: right;">
            <div class="inv-actions-cell" style="justify-content: flex-end; gap: 4px;">
              ${item.equipment_id ? `
                <button type="button" class="btn-inv-action" title="Karton računara" onclick="window.EquipmentModule && window.EquipmentModule.viewCard ? window.EquipmentModule.viewCard(${item.equipment_id}) : (window.openEquipmentCardModal && window.openEquipmentCardModal(${item.equipment_id}))">
                  <i data-lucide="file-text"></i>
                </button>
              ` : ''}
              <button type="button" class="btn-inv-action btn-edit-software" data-id="${item.id}" title="Izmeni licencu">
                <i data-lucide="pencil"></i>
              </button>
              <button type="button" class="btn-inv-action btn-inv-action-delete btn-delete-software" data-id="${item.id}" title="Obriši licencu" style="color: #f87171;">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
    if (window.lucide) window.lucide.createIcons();

    // Attach Row Event Listeners
    tbody.querySelectorAll('.software-eq-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const eqId = link.getAttribute('data-eq-id');
        if (eqId) {
          if (window.EquipmentModule && window.EquipmentModule.viewCard) {
            window.EquipmentModule.viewCard(parseInt(eqId, 10));
          } else if (typeof window.openEquipmentCardModal === 'function') {
            window.openEquipmentCardModal(parseInt(eqId, 10));
          } else if (typeof window.openEditEquipmentModal === 'function') {
            window.openEditEquipmentModal(parseInt(eqId, 10));
          }
        }
      });
    });

    tbody.querySelectorAll('.btn-copy-sw-key').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.getAttribute('data-key');
        copyKeyToClipboard(key, btn);
      });
    });

    tbody.querySelectorAll('.btn-edit-software').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        if (id) openEditSoftwareModal(parseInt(id, 10));
      });
    });

    tbody.querySelectorAll('.btn-delete-software').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        if (id) deleteSoftwareLicense(parseInt(id, 10));
      });
    });
  }

  // Render Pagination Footer matching equipment inventory style
  function renderPaginationFooter() {
    const counterEl = document.getElementById('software-counter-text');
    const controlsEl = document.getElementById('software-pagination-controls');
    if (!counterEl || !controlsEl) return;

    const start = state.totalItems === 0 ? 0 : (state.currentPage - 1) * state.pageSize + 1;
    const end = Math.min(state.currentPage * state.pageSize, state.totalItems);
    counterEl.textContent = `Prikazano: ${state.totalItems > 0 ? start : 0}-${end} od ukupno ${state.totalItems.toLocaleString('sr-RS')} licenci`;

    if (state.totalPages <= 1) {
      controlsEl.innerHTML = '';
      return;
    }

    let html = `
      <button class="btn-dark-sm" style="padding: 4px 10px; height: 30px; ${state.currentPage <= 1 ? 'opacity: 0.4; pointer-events: none;' : ''}" id="sw-pg-prev">
        <i data-lucide="chevron-left" style="width: 14px; height: 14px;"></i>
      </button>
    `;

    // Max 5 visible page numbers
    let startPage = Math.max(1, state.currentPage - 2);
    let endPage = Math.min(state.totalPages, startPage + 4);
    if (endPage - startPage < 4) {
      startPage = Math.max(1, endPage - 4);
    }

    for (let p = startPage; p <= endPage; p++) {
      const active = (p === state.currentPage);
      html += `
        <button class="btn-dark-sm sw-pg-num ${active ? 'btn-yellow-solid-sm' : ''}" data-page="${p}" style="padding: 4px 10px; height: 30px; font-weight: ${active ? '700' : '500'};">
          ${p}
        </button>
      `;
    }

    html += `
      <button class="btn-dark-sm" style="padding: 4px 10px; height: 30px; ${state.currentPage >= state.totalPages ? 'opacity: 0.4; pointer-events: none;' : ''}" id="sw-pg-next">
        <i data-lucide="chevron-right" style="width: 14px; height: 14px;"></i>
      </button>
    `;

    controlsEl.innerHTML = html;
    if (window.lucide) window.lucide.createIcons();

    const btnPrev = document.getElementById('sw-pg-prev');
    const btnNext = document.getElementById('sw-pg-next');
    if (btnPrev) btnPrev.addEventListener('click', () => { if (state.currentPage > 1) { state.currentPage--; loadSoftwareList(); } });
    if (btnNext) btnNext.addEventListener('click', () => { if (state.currentPage < state.totalPages) { state.currentPage++; loadSoftwareList(); } });

    controlsEl.querySelectorAll('.sw-pg-num').forEach(b => {
      b.addEventListener('click', () => {
        const p = parseInt(b.getAttribute('data-page'), 10);
        if (p && p !== state.currentPage) {
          state.currentPage = p;
          loadSoftwareList();
        }
      });
    });
  }

  // Load Equipment List for Modal Select
  async function loadEquipmentOptions(selectedId = null) {
    const select = document.getElementById('sw-edit-equipment-id');
    if (!select) return;

    if (state.equipmentCache.length === 0) {
      try {
        const res = await fetch('/api/equipment?pageSize=1000');
        const json = await res.json();
        if (json.success && json.items) {
          state.equipmentCache = json.items;
        } else if (json.success && json.data) {
          state.equipmentCache = json.data;
        }
      } catch (err) {
        console.warn('Greška pri dohvatanju opreme za selektor:', err);
      }
    }

    let html = '<option value="">Izaberite računar / opremu sa liste...</option>';
    state.equipmentCache.forEach(eq => {
      const isSel = selectedId && Number(selectedId) === Number(eq.id);
      const empLabel = eq.employee_name && eq.employee_name.toUpperCase() !== 'BEZ' ? ` • ${eq.employee_name}` : '';
      const invLabel = eq.inventory_no ? ` [Inv: ${eq.inventory_no}]` : '';
      html += `<option value="${eq.id}" ${isSel ? 'selected' : ''}>#${eq.id} - ${escapeHtml(eq.name)}${invLabel}${escapeHtml(empLabel)}</option>`;
    });

    select.innerHTML = html;
  }

  // Update Modal Radio Pill Visuals
  function updateModalRadioPills(value) {
    const pillYes = document.getElementById('sw-pill-licensed-yes');
    const pillNo = document.getElementById('sw-pill-licensed-no');
    if (value === 1 || value === '1') {
      if (pillYes) pillYes.className = 'sw-radio-pill active-yes';
      if (pillNo) pillNo.className = 'sw-radio-pill';
    } else {
      if (pillYes) pillYes.className = 'sw-radio-pill';
      if (pillNo) pillNo.className = 'sw-radio-pill active-no';
    }
  }

  // Open Modal for Creating Software License
  async function openCreateSoftwareModal() {
    const modal = document.getElementById('modal-software-edit');
    const form = document.getElementById('form-software-edit');
    const titleEl = document.getElementById('modal-software-edit-title');
    const submitText = document.getElementById('text-submit-software-modal');

    if (form) form.reset();
    const idInput = document.getElementById('sw-edit-id');
    if (idInput) idInput.value = '';

    if (titleEl) titleEl.textContent = 'Nova Softverska Licenca';
    if (submitText) submitText.textContent = 'Evidentiraj Licencu';

    updateModalRadioPills(1);
    await loadEquipmentOptions();

    if (typeof window.openModal === 'function') {
      window.openModal(modal);
    } else if (modal) {
      modal.style.display = 'flex';
    }
    if (window.lucide) window.lucide.createIcons();
  }

  // Open Modal for Editing Software License
  async function openEditSoftwareModal(id) {
    const modal = document.getElementById('modal-software-edit');
    const form = document.getElementById('form-software-edit');
    const titleEl = document.getElementById('modal-software-edit-title');
    const submitText = document.getElementById('text-submit-software-modal');

    if (titleEl) titleEl.textContent = `Izmena Licence (#${id})`;
    if (submitText) submitText.textContent = 'Sačuvaj Promene';

    try {
      const res = await fetch(`/api/equipment/software-licenses/${id}`);
      const json = await res.json();
      if (!json.success || !json.data) {
        notify('Nije moguće dohvatiti detalje licence', 'error');
        return;
      }

      const item = json.data;
      const idInput = document.getElementById('sw-edit-id');
      const vendorInput = document.getElementById('sw-edit-vendor');
      const nameInput = document.getElementById('sw-edit-name');
      const keyInput = document.getElementById('sw-edit-key');
      const noteInput = document.getElementById('sw-edit-note');

      if (idInput) idInput.value = item.id;
      if (vendorInput) vendorInput.value = item.vendor || '';
      if (nameInput) nameInput.value = item.name || '';
      if (keyInput) keyInput.value = item.license_key || '';
      if (noteInput) noteInput.value = item.note || '';

      // Radio licensed
      const radios = document.querySelectorAll('input[name="sw_licensed_radio"]');
      radios.forEach(r => {
        r.checked = (r.value === '1' && item.is_licensed === 1) || (r.value === '0' && item.is_licensed === 0);
      });
      updateModalRadioPills(item.is_licensed);

      await loadEquipmentOptions(item.equipment_id);

      if (typeof window.openModal === 'function') {
        window.openModal(modal);
      } else if (modal) {
        modal.style.display = 'flex';
      }
      if (window.lucide) window.lucide.createIcons();

    } catch (err) {
      console.error('Greška pri otvaranju modala za izmenu:', err);
      notify('Greška u komunikaciji sa serverom', 'error');
    }
  }

  // Save Software Modal Form Handler
  async function handleSaveSoftwareModal(e) {
    e.preventDefault();
    const id = document.getElementById('sw-edit-id')?.value;
    const eqId = document.getElementById('sw-edit-equipment-id')?.value;
    const vendor = document.getElementById('sw-edit-vendor')?.value;
    const name = document.getElementById('sw-edit-name')?.value;
    const key = document.getElementById('sw-edit-key')?.value;
    const note = document.getElementById('sw-edit-note')?.value;

    let isLicensed = 1;
    const selectedRadio = document.querySelector('input[name="sw_licensed_radio"]:checked');
    if (selectedRadio) isLicensed = parseInt(selectedRadio.value, 10);

    if (!eqId) {
      notify('Morate odabrati računar / opremu', 'warning');
      return;
    }
    if (!name || !name.trim()) {
      notify('Naziv softvera je obavezan', 'warning');
      return;
    }

    const payload = {
      equipment_id: parseInt(eqId, 10),
      vendor: vendor ? vendor.trim() : null,
      name: name.trim(),
      is_licensed: isLicensed,
      license_key: key ? key.trim() : null,
      note: note ? note.trim() : null
    };

    const isEdit = Boolean(id);
    const url = isEdit ? `/api/equipment/software-licenses/${id}` : '/api/equipment/software-licenses';
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();

      if (!json.success) {
        notify(json.error || 'Greška pri čuvanju licence', 'error');
        return;
      }

      notify(isEdit ? 'Softverska licenca je uspešno ažurirana' : 'Nova licenca je uspešno evidentirana', 'success');

      const modal = document.getElementById('modal-software-edit');
      if (typeof window.closeModal === 'function') {
        window.closeModal(modal);
      } else if (modal) {
        modal.style.display = 'none';
      }

      loadSoftwareList();
      fetchSoftwareVendors();
      fetchSoftwareStats();

    } catch (err) {
      console.error('Greška pri čuvanju softverske licence:', err);
      notify('Greška u komunikaciji sa serverom', 'error');
    }
  }

  // Delete Software License
  async function deleteSoftwareLicense(id) {
    if (!confirm(`Da li ste sigurni da želite da obrišete licencu #${id}?`)) return;

    try {
      const res = await fetch(`/api/equipment/software-licenses/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) {
        notify(json.error || 'Nije moguće obrisati licencu', 'error');
        return;
      }

      notify('Softverska licenca je uspešno obrisana', 'success');
      loadSoftwareList();
      fetchSoftwareVendors();
      fetchSoftwareStats();

    } catch (err) {
      console.error('Greška pri brisanju licence:', err);
      notify('Greška u komunikaciji sa serverom', 'error');
    }
  }

  // Export to Excel CSV
  function exportSoftwareToExcel() {
    notify('Priprema izvoza softverskih licenci...', 'info');
    const params = new URLSearchParams({
      pageSize: 5000,
      sortBy: state.sortBy,
      sortOrder: state.sortOrder
    });
    if (state.searchQuery) params.append('search', state.searchQuery);
    if (state.currentVendor && state.currentVendor !== 'ALL') params.append('vendor', state.currentVendor);
    if (state.currentLicensed !== 'all') params.append('is_licensed', state.currentLicensed);

    fetch(`/api/equipment/software-licenses?${params.toString()}`)
      .then(r => r.json())
      .then(json => {
        if (!json.success || !json.data) throw new Error('Nema podataka za izvoz');
        const rows = json.data;
        const headers = ['ID', 'Računar', 'Inventarski Broj', 'Zaduženi Radnik', 'Odeljenje', 'Vendor', 'Naziv Softvera / OS', 'Licenciran', 'Licencni Ključ', 'Napomena'];
        const csvRows = [headers.join(';')];

        rows.forEach(r => {
          const row = [
            r.id,
            `"${(r.equipment_name || '').replace(/"/g, '""')}"`,
            `"${(r.equipment_inv_no || '').replace(/"/g, '""')}"`,
            `"${(r.employee_name || '').replace(/"/g, '""')}"`,
            `"${(r.employee_dept || '').replace(/"/g, '""')}"`,
            `"${(r.vendor || '').replace(/"/g, '""')}"`,
            `"${(r.name || '').replace(/"/g, '""')}"`,
            r.is_licensed === 1 ? 'DA' : 'NE',
            `"${(r.license_key || '').replace(/"/g, '""')}"`,
            `"${(r.note || '').replace(/"/g, '""')}"`
          ];
          csvRows.push(row.join(';'));
        });

        const csvContent = '\uFEFF' + csvRows.join('\r\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Unipromet_Software_Licence_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        notify('Izvoz softverskih licenci je završen', 'success');
      })
      .catch(err => {
        console.error('Greška pri izvozu u Excel:', err);
        notify('Neuspešan izvoz u Excel', 'error');
      });
  }

  // Initialize Module
  function initSoftwareModule() {
    if (state.hasInitialized) return;
    state.hasInitialized = true;

    // Search Input
    const searchInput = document.getElementById('search-software');
    const clearSearchBtn = document.getElementById('btn-clear-search-software');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const val = e.target.value;
        if (clearSearchBtn) clearSearchBtn.style.display = val ? 'block' : 'none';

        clearTimeout(state.searchDebounceTimer);
        state.searchDebounceTimer = setTimeout(() => {
          state.searchQuery = val;
          state.currentPage = 1;
          loadSoftwareList();
        }, 280);
      });
    }

    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        clearSearchBtn.style.display = 'none';
        state.searchQuery = '';
        state.currentPage = 1;
        loadSoftwareList();
      });
    }

    // License Status Select
    const filterLicensed = document.getElementById('filter-software-licensed');
    if (filterLicensed) {
      filterLicensed.addEventListener('change', (e) => {
        state.currentLicensed = e.target.value;
        state.currentPage = 1;
        loadSoftwareList();
      });
    }

    // Page Size Select
    const selectPageSize = document.getElementById('software-page-size');
    if (selectPageSize) {
      selectPageSize.addEventListener('change', (e) => {
        state.pageSize = parseInt(e.target.value, 10) || 50;
        state.currentPage = 1;
        loadSoftwareList();
      });
    }

    // Modal Radio Status Pills Event Listeners
    const pillYes = document.getElementById('sw-pill-licensed-yes');
    const pillNo = document.getElementById('sw-pill-licensed-no');
    if (pillYes) {
      pillYes.addEventListener('click', () => {
        const radio = pillYes.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
        updateModalRadioPills(1);
      });
    }
    if (pillNo) {
      pillNo.addEventListener('click', () => {
        const radio = pillNo.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
        updateModalRadioPills(0);
      });
    }

    // Buttons
    const btnSync = document.getElementById('btn-sync-software');
    if (btnSync) btnSync.addEventListener('click', () => { loadSoftwareList(); fetchSoftwareVendors(); fetchSoftwareStats(); });

    const btnAdd = document.getElementById('btn-add-software');
    if (btnAdd) btnAdd.addEventListener('click', () => openCreateSoftwareModal());

    const btnExport = document.getElementById('btn-export-software-excel');
    if (btnExport) btnExport.addEventListener('click', () => exportSoftwareToExcel());

    // Form Submit
    const form = document.getElementById('form-software-edit');
    if (form) form.addEventListener('submit', handleSaveSoftwareModal);

    // KPI Card Click Filters
    const kpiTotal = document.getElementById('kpi-card-sw-total');
    if (kpiTotal) {
      kpiTotal.addEventListener('click', () => {
        state.currentVendor = 'ALL';
        state.currentLicensed = 'all';
        if (filterLicensed) filterLicensed.value = 'all';
        state.currentPage = 1;
        renderVendorFilterPills();
        loadSoftwareList();
      });
    }

    const kpiLicensed = document.getElementById('kpi-card-sw-licensed');
    if (kpiLicensed) {
      kpiLicensed.addEventListener('click', () => {
        state.currentLicensed = '1';
        if (filterLicensed) filterLicensed.value = '1';
        state.currentPage = 1;
        loadSoftwareList();
      });
    }

    const kpiUnlicensed = document.getElementById('kpi-card-sw-unlicensed');
    if (kpiUnlicensed) {
      kpiUnlicensed.addEventListener('click', () => {
        state.currentLicensed = '0';
        if (filterLicensed) filterLicensed.value = '0';
        state.currentPage = 1;
        loadSoftwareList();
      });
    }

    // Initial Data Fetch
    fetchSoftwareStats();
    fetchSoftwareVendors();
    loadSoftwareList();
  }

  // Listen for DOMContentLoaded or tab activation
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSoftwareModule);
  } else {
    initSoftwareModule();
  }

  // SSE Live updates hook
  window.addEventListener('equipment-sse-event', (e) => {
    const type = e.detail?.type;
    if (type && type.includes('software')) {
      loadSoftwareList();
      fetchSoftwareVendors();
      fetchSoftwareStats();
    }
  });

  // Global Exports
  window.loadSoftwareList = loadSoftwareList;
  window.openCreateSoftwareModal = openCreateSoftwareModal;
  window.openEditSoftwareModal = openEditSoftwareModal;
  window.deleteSoftwareLicense = deleteSoftwareLicense;

})();
