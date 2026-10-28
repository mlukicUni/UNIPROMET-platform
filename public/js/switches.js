/* ==========================================================================
   MODULE: MREŽNI SVIČEVI (SWITCHES TELEMETRY & PORT MATRIX)
   ========================================================================== */

let allSwitchesData = [];
let currentSwitchDetails = null;
let activePortFilter = 'all';

async function fetchSwitches(notify = false) {
  const refreshBtn = document.getElementById('btn-refresh-switches');
  const spinIcon = document.getElementById('icon-refresh-switches-spin');
  
  if (spinIcon) spinIcon.classList.add('spin-animation');

  try {
    const res = await fetch('/api/switches?force=true');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    
    allSwitchesData = data.switches || [];
    
    updateSwitchesKPIs(data);
    renderSwitchesTab();

    if (notify && typeof showToast === 'function') {
      showToast('SNMP telemetrija sviča je osvežena', 'info');
    }
  } catch (err) {
    console.error('Error fetching switches:', err);
    if (notify && typeof showToast === 'function') {
      showToast('Greška pri čitanju telemetrije sviča', 'error');
    }
  } finally {
    if (spinIcon) spinIcon.classList.remove('spin-animation');
  }
}

function updateSwitchesKPIs(data) {
  const kpiTotal = document.getElementById('kpi-switches-total');
  const kpiOnline = document.getElementById('kpi-switches-online');
  const kpiPortsUsage = document.getElementById('kpi-switches-ports-usage');
  const kpiModel = document.getElementById('kpi-switches-model');
  const navBadge = document.getElementById('badge-nav-switches');
  const onlineBadge = document.getElementById('badge-switches-online-count');

  const sw = (allSwitchesData && allSwitchesData.length > 0) ? allSwitchesData[0] : null;

  if (kpiTotal) kpiTotal.textContent = data.totalCount || 1;
  if (kpiOnline) kpiOnline.textContent = data.onlineCount || 1;
  if (kpiPortsUsage && sw) {
    kpiPortsUsage.textContent = `${sw.activePortsCount} / ${sw.physicalPortsCount}`;
  }
  if (kpiModel && sw) {
    kpiModel.textContent = sw.name || 'CA1-SW25';
  }
  if (navBadge) navBadge.textContent = data.onlineCount || 1;
  if (onlineBadge) onlineBadge.textContent = `${data.onlineCount || 1} Online`;
}

function renderSwitchesTab() {
  const container = document.getElementById('switches-cards-grid');
  if (!container) return;

  if (!allSwitchesData || allSwitchesData.length === 0) {
    container.innerHTML = `
      <div class="empty-state-card" style="grid-column: 1 / -1; padding: 48px 20px; text-align: center;">
        <div class="empty-icon-wrap"><i data-lucide="toggle-right"></i></div>
        <h3>Nema evidentiranih mrežnih svičeva</h3>
        <p>Proverite SNMP vezu sa svičem na adresi 192.168.120.25.</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  container.innerHTML = allSwitchesData.map(sw => {
    const isOnline = !!sw.isOnline;
    const activePorts = sw.activePortsCount || 0;
    const totalPorts = sw.physicalPortsCount || 28;
    const inactivePorts = sw.inactivePortsCount || (totalPorts - activePorts);
    const disabledPorts = sw.disabledPortsCount || 0;
    const usagePct = Math.round((activePorts / totalPorts) * 100);

    return `
      <div class="glass-card switch-card" style="grid-column: 1 / -1; background: rgba(17, 24, 39, 0.7); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 14px; padding: 22px;">
        <!-- Card Top Header -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px; margin-bottom: 20px;">
          <div style="display: flex; align-items: center; gap: 14px;">
            <div style="width: 48px; height: 48px; border-radius: 10px; background: rgba(255, 184, 0, 0.12); border: 1px solid rgba(255, 184, 0, 0.35); color: var(--primary-yellow); display: flex; align-items: center; justify-content: center; font-size: 1.4rem;">
              <i data-lucide="toggle-right"></i>
            </div>
            <div>
              <div style="display: flex; align-items: center; gap: 10px;">
                <h3 style="margin: 0; font-size: 1.25rem; font-weight: 900; color: #ffffff;">${escapeHtml(sw.name)}</h3>
                <span class="status-pill-glass ${isOnline ? 'pill-active' : 'pill-paused'}" style="font-size: 0.72rem; padding: 3px 10px; border-radius: 12px; display: inline-flex; align-items: center; gap: 6px;">
                  <span class="status-dot" style="width: 7px; height: 7px; border-radius: 50%; background: ${isOnline ? '#10b981' : '#ef4444'};"></span>
                  <span>${isOnline ? 'ONLINE (SNMP)' : 'OFFLINE'}</span>
                </span>
              </div>
              <div style="display: flex; align-items: center; gap: 12px; margin-top: 6px; flex-wrap: wrap;">
                <a href="https://${sw.ip}/" target="_blank" style="color: #FFB800; font-family: monospace; font-size: 0.9rem; font-weight: 700; text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">
                  <span>🌐 https://${escapeHtml(sw.ip)}/</span>
                  <i data-lucide="external-link" style="width: 12px; height: 12px;"></i>
                </a>
                <span style="color: #64748b;">&bull;</span>
                <span style="color: #cbd5e1; font-size: 0.85rem;"><i data-lucide="map-pin" style="width: 13px; height: 13px; display: inline; color: #94a3b8;"></i> ${escapeHtml(sw.sysLocation || 'IT Sektor')}</span>
                <span style="color: #64748b;">&bull;</span>
                <span style="color: #cbd5e1; font-size: 0.85rem;"><i data-lucide="clock" style="width: 13px; height: 13px; display: inline; color: #94a3b8;"></i> Uptime: <strong>${escapeHtml(sw.uptimeText || 'N/A')}</strong></span>
              </div>
            </div>
          </div>

          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <button type="button" class="btn-yellow-solid-sm" onclick="openSwitchDetailsModal('${sw.ip}')" style="padding: 8px 16px; font-weight: 800; display: inline-flex; align-items: center; gap: 8px;">
              <i data-lucide="sliders"></i>
              <span>Detalji i Portovi</span>
            </button>
            <a href="https://${sw.ip}/" target="_blank" class="btn-dark-sm" style="padding: 8px 14px; text-decoration: none; display: inline-flex; align-items: center; gap: 6px;">
              <i data-lucide="external-link"></i>
              <span>WebUI</span>
            </a>
          </div>
        </div>

        <!-- Description / Model Info -->
        <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 8px; padding: 12px 16px; margin-bottom: 20px;">
          <div style="font-size: 0.82rem; color: #94a3b8; font-weight: 700; text-transform: uppercase;">Sistemski opis i operativni sistem:</div>
          <div style="font-family: monospace; font-size: 0.88rem; color: #e2e8f0; margin-top: 4px;">${escapeHtml(sw.sysDescr || sw.model)}</div>
        </div>

        <!-- Key Metrics & Port Progress Bar -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 20px;">
          <!-- Active Ports Card -->
          <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 10px; padding: 14px; display: flex; align-items: center; gap: 12px;">
            <div style="width: 40px; height: 40px; border-radius: 8px; background: rgba(16, 185, 129, 0.2); color: #10b981; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 1.1rem;">
              ${activePorts}
            </div>
            <div>
              <div style="font-weight: 800; color: #ffffff; font-size: 0.95rem;">${activePorts} Aktivnih Portova (LINK UP)</div>
              <div style="font-size: 0.78rem; color: #4ade80;">Povezani klijenti / uređaji u funkciji</div>
            </div>
          </div>

          <!-- Inactive / Slobodni Ports Card -->
          <div style="background: rgba(148, 163, 184, 0.08); border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 10px; padding: 14px; display: flex; align-items: center; gap: 12px;">
            <div style="width: 40px; height: 40px; border-radius: 8px; background: rgba(148, 163, 184, 0.15); color: #94a3b8; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 1.1rem;">
              ${inactivePorts}
            </div>
            <div>
              <div style="font-weight: 800; color: #ffffff; font-size: 0.95rem;">${inactivePorts} Slobodnih Portova (LINK DOWN)</div>
              <div style="font-size: 0.78rem; color: #94a3b8;">Dostupne utičnice za priključivanje</div>
            </div>
          </div>

          <!-- Disabled Ports Card -->
          <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 10px; padding: 14px; display: flex; align-items: center; gap: 12px;">
            <div style="width: 40px; height: 40px; border-radius: 8px; background: rgba(239, 68, 68, 0.2); color: #ef4444; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 1.1rem;">
              ${disabledPorts}
            </div>
            <div>
              <div style="font-weight: 800; color: #ffffff; font-size: 0.95rem;">${disabledPorts} Onemogućenih Portova</div>
              <div style="font-size: 0.78rem; color: #f87171;">Admin Status: Shutdown / Disabled</div>
            </div>
          </div>
        </div>

        <!-- Port Usage Progress Bar -->
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-size: 0.82rem; font-weight: 800; color: #ffffff;">Popunjenost Kapaciteta Portova:</span>
            <span style="font-size: 0.85rem; font-weight: 900; color: #FFB800; font-family: monospace;">${activePorts} od ${totalPorts} portova (${usagePct}%)</span>
          </div>
          <div style="width: 100%; height: 10px; background: rgba(255, 255, 255, 0.08); border-radius: 5px; overflow: hidden; position: relative;">
            <div style="height: 100%; width: ${usagePct}%; background: linear-gradient(90deg, #10b981 0%, #FFB800 100%); border-radius: 5px; transition: width 0.4s ease;"></div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
}

async function openSwitchDetailsModal(ip = '192.168.120.25') {
  const modal = document.getElementById('modal-switch-details');
  if (!modal) return;

  const modalTitle = document.getElementById('modal-switch-title');
  const modalSubtitle = document.getElementById('modal-switch-subtitle');
  const modalStatus = document.getElementById('modal-switch-status');
  const modalUptime = document.getElementById('modal-switch-uptime');
  const modalPortsSummary = document.getElementById('modal-switch-ports-summary');
  const sysInfoContainer = document.getElementById('modal-switch-sys-info');

  if (modalTitle) modalTitle.textContent = `Učitavanje telemetrije... (${ip})`;
  modal.style.display = 'flex';

  try {
    const res = await fetch(`/api/switches/${encodeURIComponent(ip)}?force=true`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    currentSwitchDetails = data.switch;

    const sw = currentSwitchDetails;

    if (modalTitle) modalTitle.textContent = `${sw.name} (${sw.ip})`;
    if (modalSubtitle) modalSubtitle.textContent = `Detaljni mrežni nadzor, FDB MAC tabela i matrica svih ${sw.physicalPortsCount} portova`;
    if (modalStatus) {
      modalStatus.innerHTML = sw.isOnline 
        ? '<span style="color: #10b981;">🟢 ONLINE (SNMP v2c)</span>' 
        : '<span style="color: #ef4444;">🔴 OFFLINE</span>';
    }
    if (modalUptime) modalUptime.textContent = sw.uptimeText || 'N/A';
    if (modalPortsSummary) {
      modalPortsSummary.textContent = `${sw.activePortsCount} u funkciji / ${sw.inactivePortsCount} slobodno`;
    }

    if (sysInfoContainer) {
      sysInfoContainer.innerHTML = `
        <strong>System Name :</strong> ${escapeHtml(sw.name)}<br>
        <strong>IP Address  :</strong> ${escapeHtml(sw.ip)}<br>
        <strong>SysDescr    :</strong> ${escapeHtml(sw.sysDescr)}<br>
        <strong>sysLocation :</strong> ${escapeHtml(sw.sysLocation || 'N/A')}<br>
        <strong>sysContact  :</strong> ${escapeHtml(sw.sysContact || 'N/A')}<br>
        <strong>UpTime      :</strong> ${escapeHtml(sw.uptimeText)} (${sw.uptimeMinutes} min)<br>
        <strong>SNMP Community:</strong> ${escapeHtml(sw.community)} (Read-Only)<br>
        <strong>Interfejsi  :</strong> ${sw.physicalPortsCount} fizičkih ethernet portova (Ukupno u MIB-u: ${sw.totalInterfaces})
      `;
    }

    renderSwitchPortsMatrix(sw.ports);
    renderSwitchPortsTable(sw.ports);

  } catch (err) {
    console.error('Error opening switch modal:', err);
    if (typeof showToast === 'function') showToast('Greška pri učitavanju detalja sviča', 'error');
  }

  if (window.lucide) window.lucide.createIcons();
}

/**
 * Renders the 28-port Hardware Matrix with hover popover hints and on-click full modal opening
 */
function renderSwitchPortsMatrix(ports = []) {
  const matrixContainer = document.getElementById('modal-switch-ports-matrix');
  if (!matrixContainer) return;

  if (ports.length === 0) {
    matrixContainer.innerHTML = '<div style="color: #94a3b8; font-size: 0.8rem; grid-column: 1 / -1;">Nema dostupnih podataka o portovima</div>';
    return;
  }

  matrixContainer.innerHTML = ports.map((p) => {
    const portNum = p.portNumber || (ports.indexOf(p) + 1);
    const isUp = p.operStatus === 1;
    const isEnabled = p.adminStatus === 1;
    const isUplink = !!p.isUplink;

    let bg = '#334155'; // Default Link DOWN
    let border = 'rgba(255, 255, 255, 0.12)';
    let badgeText = isEnabled ? 'DOWN' : 'OFF';
    let iconHtml = '';

    if (!isEnabled) {
      bg = '#7f1d1d';
      border = '#ef4444';
      badgeText = 'DISABLED';
    } else if (isUp) {
      if (isUplink) {
        bg = 'linear-gradient(135deg, #059669 0%, #2563eb 100%)';
        border = '#60a5fa';
        badgeText = 'UPLINK';
        iconHtml = '<span style="font-size: 0.65rem;">🌐</span>';
      } else {
        bg = '#059669';
        border = '#10b981';
        badgeText = p.speedMbps >= 1000 ? '1G' : `${p.speedMbps}M`;
      }
    }

    return `
      <div class="switch-port-chip"
           data-port-num="${portNum}"
           style="background: ${bg}; border: 1.5px solid ${border}; border-radius: 6px; padding: 8px 3px; text-align: center; cursor: pointer; transition: transform 0.15s ease, box-shadow 0.15s ease; user-select: none; position: relative;"
           onmouseenter="showPortHoverHint(event, ${portNum})"
           onmousemove="movePortHoverHint(event)"
           onmouseleave="hidePortHoverHint()"
           onclick="openPortDetailsModal(${portNum})"
           title="">
        <div style="font-size: 0.72rem; font-weight: 900; color: #ffffff; font-family: monospace; letter-spacing: -0.5px;">
          P${portNum} ${iconHtml}
        </div>
        <div style="font-size: 0.58rem; font-weight: 700; color: rgba(255, 255, 255, 0.9); margin-top: 2px;">
          ${badgeText}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Floating Hover Popover Hint over a Port chip
 */
function showPortHoverHint(event, portNum) {
  const hintEl = document.getElementById('switch-port-hover-hint');
  if (!hintEl || !currentSwitchDetails) return;

  const port = currentSwitchDetails.ports.find(p => (p.portNumber === portNum || p.index === String(portNum)));
  if (!port) return;

  const isUp = port.operStatus === 1;
  const isEnabled = port.adminStatus === 1;
  const devs = port.devices || [];

  let statusBadge = isUp 
    ? '<span style="color: #10b981; font-weight: 800;">🟢 LINK UP</span>' 
    : (isEnabled ? '<span style="color: #94a3b8; font-weight: 700;">⚪ LINK DOWN</span>' : '<span style="color: #ef4444; font-weight: 800;">🔴 DISABLED</span>');

  let speedText = isUp 
    ? `${port.speedMbps >= 1000 ? port.speedMbps / 1000 + ' Gbps' : port.speedMbps + ' Mbps'}`
    : 'Nema veze (0 Mbps)';

  let deviceHtml = '';

  if (port.isUplink) {
    deviceHtml = `
      <div style="background: rgba(37, 99, 235, 0.15); border: 1px solid rgba(59, 130, 246, 0.35); border-radius: 6px; padding: 8px 10px; margin-top: 8px;">
        <div style="font-weight: 800; color: #60a5fa; font-size: 0.78rem; display: flex; align-items: center; gap: 6px;">
          <span>🌐</span> <span>Magistralni Uplink Port</span>
        </div>
        <div style="font-size: 0.72rem; color: #cbd5e1; margin-top: 3px;">
          Prepoznato <strong>${devs.length}</strong> MAC adresa (veza sa server salom / ruterom)
        </div>
      </div>
    `;
  } else if (devs.length > 0) {
    deviceHtml = devs.map(d => {
      const isKnownIp = !!d.ip;
      return `
        <div style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; padding: 7px 10px; margin-top: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.72rem; color: #94a3b8; font-weight: 700;">${escapeHtml(d.deviceType || 'Uređaj')}:</span>
            ${d.isLocalHost ? '<span style="font-size: 0.65rem; background: #FFB800; color: #000; padding: 1px 4px; border-radius: 3px; font-weight: 800;">LOKALNI HOST</span>' : ''}
          </div>
          <div style="font-size: 0.8rem; font-weight: 800; color: #ffffff; margin-top: 2px;">
            ${escapeHtml(d.hostname || d.vendor || 'Nepoznat uređaj')}
          </div>
          <div style="display: flex; justify-content: space-between; font-family: monospace; font-size: 0.75rem; margin-top: 4px;">
            <span style="color: #60a5fa;">MAC: ${escapeHtml(d.mac)}</span>
          </div>
          <div style="font-family: monospace; font-size: 0.75rem; margin-top: 2px;">
            <span style="color: ${isKnownIp ? '#10b981' : '#94a3b8'};">
              IP: ${isKnownIp ? escapeHtml(d.ip) : 'Nije u ARP tabeli'}
            </span>
          </div>
        </div>
      `;
    }).join('');
  } else {
    deviceHtml = `
      <div style="font-size: 0.74rem; color: #94a3b8; margin-top: 6px; font-style: italic;">
        Utičnica je slobodna (nema priključenog uređaja)
      </div>
    `;
  }

  hintEl.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.1); padding-bottom: 6px; margin-bottom: 6px;">
      <div style="font-weight: 900; color: #FFB800; font-size: 0.88rem;">
        Port ${portNum} <span style="font-size: 0.75rem; color: #ffffff; font-weight: 600;">(${escapeHtml(port.name)})</span>
      </div>
      <div>${statusBadge}</div>
    </div>
    <div style="font-size: 0.75rem; color: #cbd5e1;">
      Brzina: <strong style="color: #ffffff;">${speedText}</strong>
    </div>
    ${deviceHtml}
    <div style="margin-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 6px; font-size: 0.68rem; color: #FFB800; text-align: center; font-weight: 700;">
      👉 Kliknite za detaljnu dijagnostiku i telemetriju
    </div>
  `;

  hintEl.style.display = 'block';
  hintEl.style.opacity = '1';
  positionHint(event, hintEl);
}

function movePortHoverHint(event) {
  const hintEl = document.getElementById('switch-port-hover-hint');
  if (hintEl && hintEl.style.display !== 'none') {
    positionHint(event, hintEl);
  }
}

function hidePortHoverHint() {
  const hintEl = document.getElementById('switch-port-hover-hint');
  if (hintEl) {
    hintEl.style.opacity = '0';
    hintEl.style.display = 'none';
  }
}

function positionHint(event, hintEl) {
  const pad = 15;
  let x = event.clientX + pad;
  let y = event.clientY + pad;

  const rect = hintEl.getBoundingClientRect();
  const winW = window.innerWidth;
  const winH = window.innerHeight;

  if (x + rect.width > winW - 10) {
    x = event.clientX - rect.width - pad;
  }
  if (y + rect.height > winH - 10) {
    y = event.clientY - rect.height - pad;
  }

  hintEl.style.left = `${Math.max(10, x)}px`;
  hintEl.style.top = `${Math.max(10, y)}px`;
}

/**
 * Opens the Full Dedicated Modal for a single switch port
 */
function openPortDetailsModal(portNum) {
  hidePortHoverHint();

  if (!currentSwitchDetails || !currentSwitchDetails.ports) return;

  const port = currentSwitchDetails.ports.find(p => (p.portNumber === portNum || p.index === String(portNum)));
  if (!port) return;

  const modal = document.getElementById('modal-switch-port-detail');
  if (!modal) return;

  // Title & Header
  const titleEl = document.getElementById('port-detail-title');
  const subEl = document.getElementById('port-detail-subtitle');
  const statusPill = document.getElementById('port-detail-status-pill');
  const iconCircle = document.getElementById('port-detail-icon-circle');

  const isUp = port.operStatus === 1;
  const isEnabled = port.adminStatus === 1;
  const isUplink = !!port.isUplink;

  if (titleEl) titleEl.textContent = `Port ${port.portNumber || portNum} (${port.name})`;
  if (subEl) {
    subEl.textContent = port.alias 
      ? `Oznaka: ${port.alias} &bull; Tip: Ethernet RJ-45 &bull; Index: #${port.index}`
      : `SNMP Interfejs #${port.index} &bull; Svič: ${currentSwitchDetails.name} (${currentSwitchDetails.ip})`;
  }

  if (statusPill) {
    if (!isEnabled) {
      statusPill.className = 'status-pill-glass pill-paused';
      statusPill.textContent = '🔴 SHUTDOWN';
    } else if (isUp) {
      statusPill.className = 'status-pill-glass pill-active';
      statusPill.textContent = isUplink ? '🌐 UPLINK (LINK UP)' : '🟢 LINK UP';
    } else {
      statusPill.className = 'status-pill-glass';
      statusPill.style.background = 'rgba(100, 116, 139, 0.2)';
      statusPill.style.color = '#94a3b8';
      statusPill.textContent = '⚪ LINK DOWN';
    }
  }

  if (iconCircle) {
    iconCircle.style.color = isUp ? '#10b981' : '#94a3b8';
    iconCircle.style.borderColor = isUp ? 'rgba(16, 185, 129, 0.4)' : 'rgba(148, 163, 184, 0.2)';
    iconCircle.style.background = isUp ? 'rgba(16, 185, 129, 0.15)' : 'rgba(148, 163, 184, 0.1)';
  }

  // Top KPIs
  const speedEl = document.getElementById('port-detail-speed');
  const duplexEl = document.getElementById('port-detail-duplex');
  const adminEl = document.getElementById('port-detail-admin');
  const roleEl = document.getElementById('port-detail-role');
  const roleSubEl = document.getElementById('port-detail-role-sub');
  const cableEl = document.getElementById('port-detail-cable-status');
  const errorsEl = document.getElementById('port-detail-errors-count');

  if (speedEl) speedEl.textContent = isUp ? (port.speedMbps >= 1000 ? `${port.speedMbps / 1000} Gbps` : `${port.speedMbps} Mbps`) : '0 Mbps';
  if (duplexEl) duplexEl.textContent = isUp ? 'Full-Duplex' : 'Nema nosioca (No Link)';
  if (adminEl) adminEl.textContent = isEnabled ? 'Omogućen (Up)' : 'Ugašen (Down)';
  
  if (roleEl) {
    if (isUplink) roleEl.textContent = 'Uplink (Magistrala)';
    else if (port.devices && port.devices.length > 0) roleEl.textContent = 'Access (Klijent)';
    else roleEl.textContent = 'Slobodan Port';
  }

  if (roleSubEl) {
    const devCount = port.devices ? port.devices.length : 0;
    roleSubEl.textContent = isUplink ? `${devCount} naučenih MAC adresa` : `${devCount} priključen uređaj`;
  }

  const totalErrors = (port.inErrors || 0) + (port.outErrors || 0);
  if (cableEl) {
    cableEl.textContent = totalErrors === 0 ? 'Odlična linija' : 'Zabeležene greške';
    cableEl.style.color = totalErrors === 0 ? '#10b981' : '#f87171';
  }
  if (errorsEl) {
    errorsEl.textContent = totalErrors === 0 ? '0 CRC / In-Out grešaka' : `${totalErrors} grešaka na kablu!`;
  }

  // Connected Devices Container
  const devBadge = document.getElementById('port-detail-dev-count-badge');
  const devContainer = document.getElementById('port-detail-devices-container');
  const devs = port.devices || [];

  if (devBadge) {
    devBadge.textContent = isUplink ? `Uplink (${devs.length} MAC adresa)` : `${devs.length} uređaj`;
  }

  if (devContainer) {
    if (isUplink) {
      devContainer.innerHTML = `
        <div style="background: rgba(37, 99, 235, 0.1); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: 8px; padding: 12px 14px; margin-bottom: 14px;">
          <div style="font-weight: 800; color: #60a5fa; font-size: 0.85rem; display: flex; align-items: center; gap: 8px;">
            <span>🌐</span> <span>Magistralni trunk port (Uplink)</span>
          </div>
          <div style="font-size: 0.78rem; color: #cbd5e1; margin-top: 4px; line-height: 1.5;">
            Kroz ovaj port prolazi saobraćaj ka server sali, optičkim čvorištima i glavnom ruteru. Svič je kroz ovaj port naučio <strong>${devs.length}</strong> MAC adresa.
          </div>
        </div>
        <div style="max-height: 220px; overflow-y: auto; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px;">
          <table class="glass-table-compact" style="width: 100%; font-size: 0.78rem;">
            <thead>
              <tr>
                <th>Fizička MAC Adresa</th>
                <th>IP Adresa</th>
                <th>Naziv / Hostname</th>
                <th>Proizvođač (Vendor)</th>
              </tr>
            </thead>
            <tbody>
              ${devs.slice(0, 50).map(d => `
                <tr>
                  <td style="font-family: monospace; color: #60a5fa; font-weight: 700;">${escapeHtml(d.mac)}</td>
                  <td style="font-family: monospace; color: ${d.ip ? '#10b981' : '#94a3b8'};">${escapeHtml(d.ip || '—')}</td>
                  <td style="color: #ffffff; font-weight: 600;">${escapeHtml(d.hostname || '—')}</td>
                  <td style="color: #cbd5e1;">${escapeHtml(d.vendor || d.deviceType || '—')}</td>
                </tr>
              `).join('')}
              ${devs.length > 50 ? `
                <tr>
                  <td colspan="4" style="text-align: center; color: #FFB800; font-size: 0.75rem; padding: 8px;">
                    ... i još ${devs.length - 50} MAC adresa na ovoj magistrali
                  </td>
                </tr>
              ` : ''}
            </tbody>
          </table>
        </div>
      `;
    } else if (devs.length > 0) {
      devContainer.innerHTML = devs.map(d => `
        <div style="background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 14px; margin-bottom: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 38px; height: 38px; border-radius: 8px; background: rgba(255, 184, 0, 0.15); color: #FFB800; display: flex; align-items: center; justify-content: center; font-size: 1.1rem;">
                ${d.deviceType === 'Štampač' ? '🖨️' : (d.deviceType === 'VoIP Telefon' ? '☎️' : (d.deviceType === 'Kamera' ? '📹' : '💻'))}
              </div>
              <div>
                <div style="font-weight: 900; color: #ffffff; font-size: 0.95rem;">
                  ${escapeHtml(d.hostname || d.vendor || 'Priključeni Uređaj')}
                  ${d.isLocalHost ? '<span style="font-size: 0.65rem; background: #FFB800; color: #000; padding: 2px 6px; border-radius: 3px; font-weight: 800; margin-left: 6px;">LOKALNI HOST</span>' : ''}
                </div>
                <div style="font-size: 0.78rem; color: #94a3b8; margin-top: 2px;">
                  Tip: <strong>${escapeHtml(d.deviceType || 'Mrežni klijent')}</strong> &bull; Proizvođač: <strong>${escapeHtml(d.vendor || 'N/A')}</strong>
                </div>
              </div>
            </div>
            <div style="text-align: right;">
              <div style="font-family: monospace; font-size: 0.9rem; font-weight: 800; color: ${d.ip ? '#10b981' : '#94a3b8'};">
                ${d.ip ? `🌐 ${escapeHtml(d.ip)}` : 'IP: Nije u ARP tabeli'}
              </div>
              <div style="font-family: monospace; font-size: 0.78rem; color: #60a5fa; margin-top: 3px;">
                MAC: ${escapeHtml(d.mac)}
              </div>
            </div>
          </div>
        </div>
      `).join('');
    } else {
      devContainer.innerHTML = `
        <div style="text-align: center; padding: 24px; color: #94a3b8;">
          <div style="font-size: 1.5rem; margin-bottom: 6px;">🔌</div>
          <div style="font-weight: 700; color: #ffffff; font-size: 0.88rem;">Nema priključenih uređaja</div>
          <div style="font-size: 0.75rem; margin-top: 2px;">Utičnica je slobodna i spremna za priključivanje računara, štampača ili telefona.</div>
        </div>
      `;
    }
  }

  // Traffic Telemetry
  const inOctEl = document.getElementById('port-detail-in-octets');
  const inPktsEl = document.getElementById('port-detail-in-pkts');
  const outOctEl = document.getElementById('port-detail-out-octets');
  const outPktsEl = document.getElementById('port-detail-out-pkts');
  const inErrEl = document.getElementById('port-detail-in-errors');
  const outErrEl = document.getElementById('port-detail-out-errors');
  const discardsEl = document.getElementById('port-detail-discards');

  if (inOctEl) inOctEl.textContent = formatBytes(port.inOctets);
  if (inPktsEl) inPktsEl.textContent = `${(port.inUcastPkts || 0).toLocaleString()} paketa`;
  if (outOctEl) outOctEl.textContent = formatBytes(port.outOctets);
  if (outPktsEl) outPktsEl.textContent = `${(port.outUcastPkts || 0).toLocaleString()} paketa`;
  if (inErrEl) inErrEl.textContent = String(port.inErrors || 0);
  if (outErrEl) outErrEl.textContent = String(port.outErrors || 0);
  if (discardsEl) discardsEl.textContent = `${(port.inDiscards || 0) + (port.outDiscards || 0)} odbačeno`;

  // Technical Info Section
  const techEl = document.getElementById('port-detail-tech-info');
  if (techEl) {
    techEl.innerHTML = `
      <strong>SNMP IfIndex :</strong> ${escapeHtml(port.index)}<br>
      <strong>Internal Name:</strong> ${escapeHtml(port.name)}<br>
      <strong>Port Descr   :</strong> ${escapeHtml(port.descr || 'N/A')}<br>
      <strong>Port Alias   :</strong> ${escapeHtml(port.alias || 'Nema opisa')}<br>
      <strong>Port Type    :</strong> ethernetCsmacd (6) / 802.3 RJ-45 Bakarni Port
    `;
  }

  modal.style.display = 'flex';
  if (window.lucide) window.lucide.createIcons();
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function renderSwitchPortsTable(ports = []) {
  const tbody = document.getElementById('modal-switch-ports-tbody');
  if (!tbody) return;

  let filtered = ports;
  if (activePortFilter === 'active') {
    filtered = ports.filter(p => p.operStatus === 1);
  } else if (activePortFilter === 'disabled') {
    filtered = ports.filter(p => p.adminStatus !== 1);
  }

  const searchInput = document.getElementById('input-search-switch-ports');
  if (searchInput && searchInput.value.trim()) {
    const q = searchInput.value.trim().toLowerCase();
    filtered = filtered.filter(p => 
      p.name.toLowerCase().includes(q) ||
      p.descr.toLowerCase().includes(q) ||
      p.alias.toLowerCase().includes(q) ||
      (p.macAddresses && p.macAddresses.some(m => m.toLowerCase().includes(q))) ||
      (p.devices && p.devices.some(d => (d.ip && d.ip.includes(q)) || (d.hostname && d.hostname.toLowerCase().includes(q)) || (d.vendor && d.vendor.toLowerCase().includes(q))))
    );
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 24px; color: #94a3b8;">
          Nema portova koji odgovaraju izabranom filteru ili pretrazi.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map((p) => {
    const portNum = p.portNumber || (ports.indexOf(p) + 1);
    const isUp = p.operStatus === 1;
    const isEnabled = p.adminStatus === 1;
    const isUplink = !!p.isUplink;

    let devicePill = '';
    if (isUplink) {
      devicePill = `<span class="tech-chip" style="font-size: 0.72rem; padding: 3px 8px; background: rgba(37, 99, 235, 0.15); border: 1px solid rgba(59, 130, 246, 0.35); color: #60a5fa;">🌐 Uplink (${p.devices?.length || 0} MAC)</span>`;
    } else if (p.devices && p.devices.length > 0) {
      devicePill = p.devices.map(d => `
        <span class="tech-chip" style="font-size: 0.72rem; padding: 3px 8px; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.35); color: #4ade80; margin-right: 4px; display: inline-block;">
          ${d.hostname ? escapeHtml(d.hostname) + ' &bull; ' : ''}${d.ip ? escapeHtml(d.ip) : escapeHtml(d.mac)}
        </span>
      `).join('');
    } else {
      devicePill = '<span style="color: #64748b; font-size: 0.75rem;">Slobodan port</span>';
    }

    return `
      <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.05); cursor: pointer; ${isUp ? 'background: rgba(16, 185, 129, 0.03);' : ''}" 
          onclick="openPortDetailsModal(${portNum})"
          title="Kliknite za prikaz detalja porta ${portNum}">
        <td style="padding: 10px 12px; font-weight: 800; font-family: monospace; color: #FFB800;">#${portNum}</td>
        <td style="padding: 10px 12px;">
          <div style="font-weight: 800; color: #ffffff;">${escapeHtml(p.name)}</div>
          ${p.alias ? `<div style="font-size: 0.75rem; color: #94a3b8;">Oznaka: ${escapeHtml(p.alias)}</div>` : ''}
        </td>
        <td style="padding: 10px 12px;">
          ${isUp ? `
            <span style="display: inline-flex; align-items: center; gap: 5px; font-weight: 800; color: #10b981; font-size: 0.78rem;">
              <span style="width: 8px; height: 8px; border-radius: 50%; background: #10b981;"></span> LINK UP
            </span>
          ` : `
            <span style="display: inline-flex; align-items: center; gap: 5px; font-weight: 600; color: #94a3b8; font-size: 0.78rem;">
              <span style="width: 8px; height: 8px; border-radius: 50%; background: #64748b;"></span> LINK DOWN
            </span>
          `}
        </td>
        <td style="padding: 10px 12px;">
          ${isEnabled ? `
            <span style="color: #38bdf8; font-weight: 700; font-size: 0.78rem;">✓ Enabled</span>
          ` : `
            <span style="color: #ef4444; font-weight: 700; font-size: 0.78rem;">✗ Shutdown</span>
          `}
        </td>
        <td style="padding: 10px 12px; font-family: monospace; font-weight: 700; color: #ffffff;">
          ${isUp ? (p.speedMbps >= 1000 ? `${p.speedMbps / 1000} Gbps` : `${p.speedMbps} Mbps`) : '0 Mbps'}
        </td>
        <td style="padding: 10px 12px;">
          ${devicePill}
        </td>
      </tr>
    `;
  }).join('');
}

function filterSwitchPortsTable(filter) {
  activePortFilter = filter;
  
  document.getElementById('btn-switch-filter-all')?.classList.toggle('active', filter === 'all');
  document.getElementById('btn-switch-filter-active')?.classList.toggle('active', filter === 'active');
  document.getElementById('btn-switch-filter-disabled')?.classList.toggle('active', filter === 'disabled');

  if (currentSwitchDetails) {
    renderSwitchPortsTable(currentSwitchDetails.ports);
  }
}

function searchSwitchPortsTable() {
  if (currentSwitchDetails) {
    renderSwitchPortsTable(currentSwitchDetails.ports);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Event Listeners for Switch & Port Details Modals
document.addEventListener('DOMContentLoaded', () => {
  // Main Switch Modal Close
  const closeBtn = document.getElementById('btn-close-switch-modal');
  const closeFootBtn = document.getElementById('btn-close-switch-modal-foot');
  const switchModal = document.getElementById('modal-switch-details');

  const closeSwitchModal = () => {
    if (switchModal) switchModal.style.display = 'none';
    hidePortHoverHint();
  };

  if (closeBtn) closeBtn.addEventListener('click', closeSwitchModal);
  if (closeFootBtn) closeFootBtn.addEventListener('click', closeSwitchModal);

  // Single Port Modal Close
  const closePortBtn = document.getElementById('btn-close-port-detail-modal');
  const closePortFootBtn = document.getElementById('btn-close-port-detail-foot');
  const portModal = document.getElementById('modal-switch-port-detail');

  const closePortModal = () => {
    if (portModal) portModal.style.display = 'none';
  };

  if (closePortBtn) closePortBtn.addEventListener('click', closePortModal);
  if (closePortFootBtn) closePortFootBtn.addEventListener('click', closePortModal);

  // Escape key handler
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (portModal && portModal.style.display === 'flex') {
        closePortModal();
      } else if (switchModal && switchModal.style.display === 'flex') {
        closeSwitchModal();
      }
    }
  });

  // Clicking backdrop
  if (portModal) {
    portModal.addEventListener('click', (e) => {
      if (e.target === portModal) closePortModal();
    });
  }
});

window.fetchSwitches = fetchSwitches;
window.openSwitchDetailsModal = openSwitchDetailsModal;
window.openPortDetailsModal = openPortDetailsModal;
window.showPortHoverHint = showPortHoverHint;
window.movePortHoverHint = movePortHoverHint;
window.hidePortHoverHint = hidePortHoverHint;
window.filterSwitchPortsTable = filterSwitchPortsTable;
window.searchSwitchPortsTable = searchSwitchPortsTable;
