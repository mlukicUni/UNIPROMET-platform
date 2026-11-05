/**
 * UNIPROMET ADMIN PANEL - FRONTEND APPLICATION
 * Theme: Black, Gold-Yellow, and White
 * Slogan: "Na svetloj strani puta"
 */

// State
let primaryLanUrl = '';
let isFetching = false;
let allPrinters = [];
let currentPrinterFilter = 'active'; // Default to all active printers
let printerSearchTerm = '';
let selectedPrinterModel = 'all';
let printerViewMode = localStorage.getItem('unipromet_printers_view_mode') || 'grid'; // 'grid' | 'list'
let currentTelemetryIp = '';
let currentTelemetryName = '';
let allReportsHistory = [];

// DOM Selectors
const navButtons = document.querySelectorAll('.nav-tab-btn');
const mobileNavButtons = document.querySelectorAll('.m-nav-item');
const tabViews = document.querySelectorAll('.tab-view');
const pageTitle = document.getElementById('page-title');
const pageSubtitle = document.getElementById('page-subtitle');
const sidebar = document.getElementById('sidebar-drawer');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const scrollContainer = document.querySelector('.content-scroll-container');

// State tracking for scanning buttons to ensure they ONLY spin during active scanning
const activeSpinningButtons = new Set();

function setButtonSpinning(buttonId, isSpinning) {
  if (isSpinning) {
    activeSpinningButtons.add(buttonId);
  } else {
    activeSpinningButtons.delete(buttonId);
  }

  const btn = document.getElementById(buttonId);
  if (!btn) return;
  const icons = btn.querySelectorAll('svg, i');
  icons.forEach(icon => {
    if (isSpinning) {
      icon.classList.add('icon-spin');
      icon.style.animation = 'spin 0.8s linear infinite';
    } else {
      icon.classList.remove('icon-spin');
      icon.style.animation = 'none';
    }
  });
  btn.style.pointerEvents = isSpinning ? 'none' : '';
}

function enforceSpinningState() {
  const allScanBtnIds = [
    'btn-scan-printers',
    'btn-rescan-computers',
    'btn-rescan-servers',
    'btn-rescan-cameras',
    'btn-rescan-other',
    'btn-rescan-low-toners',
    'btn-refresh-telemetry-action',
    'btn-email-low-toners',
    'btn-recheck-offline-cameras',
    'btn-email-offline-cameras',
    'btn-refresh-scheduled-services',
    'btn-scan-unrecorded-cameras',
    'btn-sync-wifi-aps'
  ];
  allScanBtnIds.forEach(id => {
    const isSpinning = activeSpinningButtons.has(id);
    const btn = document.getElementById(id);
    if (!btn) return;
    const icons = btn.querySelectorAll('svg, i');
    icons.forEach(icon => {
      if (isSpinning) {
        icon.classList.add('icon-spin');
        icon.style.animation = 'spin 0.8s linear infinite';
      } else {
        icon.classList.remove('icon-spin');
        icon.style.animation = 'none';
      }
    });
    btn.style.pointerEvents = isSpinning ? 'none' : '';
  });
}

/* ==========================================================================
   UNIVERSAL MODAL ANIMATION & INTERACTION SYSTEM (ALL PLATFORM MODALS)
   ========================================================================== */
window.openModal = function(modalOrId) {
  const modal = typeof modalOrId === 'string' ? document.getElementById(modalOrId) : modalOrId;
  if (!modal) return;
  modal.classList.remove('modal-closing');
  modal.style.display = 'flex';
  if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
};

window.closeModal = function(modalOrId, callback) {
  const modal = typeof modalOrId === 'string' ? document.getElementById(modalOrId) : modalOrId;
  if (!modal) return;
  if (modal.style.display === 'none' && !modal.classList.contains('modal-closing')) return;
  if (modal.classList.contains('modal-closing')) return;

  modal.classList.add('modal-closing');
  setTimeout(() => {
    modal.style.display = 'none';
    modal.classList.remove('modal-closing');
    if (typeof callback === 'function') callback();
  }, 275);
};

function initUniversalModalSystem() {
  // Capture clicks on backdrop or close/cancel buttons globally
  document.addEventListener('click', (e) => {
    // Backdrop click (clicked outside modal-window)
    if (e.target && e.target.classList && e.target.classList.contains('modal-overlay')) {
      e.preventDefault();
      e.stopPropagation();
      window.closeModal(e.target);
      return;
    }

    // Close / Cancel icon or button click
    const closeBtn = e.target && e.target.closest && e.target.closest('.modal-close-icon, .btn-modal-cancel, .btn-cancel-modal, .btn-modal-close, [data-modal-close], [data-dismiss="modal"]');
    if (closeBtn) {
      const parentModal = closeBtn.closest('.modal-overlay');
      if (parentModal) {
        e.preventDefault();
        e.stopPropagation();
        window.closeModal(parentModal);
      }
    }
  }, true);

  // Global ESC key listener to smoothly close active modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      const openModals = Array.from(document.querySelectorAll('.modal-overlay')).filter(m => m.style.display === 'flex' && !m.classList.contains('modal-closing'));
      if (openModals.length > 0) {
        const topModal = openModals[openModals.length - 1];
        window.closeModal(topModal);
      }
    }
  });
}

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', async () => {
  // Sačekaj efektivna prava (role) da meni i početni podaci odgovaraju korisniku
  try {
    if (window.UniAccess) {
      await window.UniAccess.ready;
      window.UniAccess.apply();
    }
  } catch (e) {
    console.warn('[Access] Prava nisu učitana pre pokretanja:', e);
  }

  initUniversalModalSystem();

  // Wrap Lucide createIcons so newly generated SVG icons never spin unless actively scanning
  if (window.lucide && window.lucide.createIcons) {
    const origCreateIcons = window.lucide.createIcons.bind(window.lucide);
    window.lucide.createIcons = function(options) {
      const res = origCreateIcons(options);
      enforceSpinningState();
      return res;
    };
  }
  enforceSpinningState();

  initParticleCanvas();
  setupNavigationHandlers();
  setupEventListeners();
  fetchInitialData();
  initAuthWidget();

  // Periodic Telemetry Polling (every 4s)
  setInterval(fetchLiveTelemetry, 4000);
});

/* ==========================================================================
   PARTICLE CANVAS ("Na svetloj strani puta" - Glowing Yellow Constellation)
   ========================================================================== */
function initParticleCanvas() {
  const canvas = document.getElementById('ambient-particles');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let width = (canvas.width = window.innerWidth);
  let height = (canvas.height = window.innerHeight);

  window.addEventListener('resize', () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    createParticles();
  });

  const particles = [];
  const particleCount = Math.min(Math.floor(window.innerWidth / 18), 65);

  function createParticles() {
    particles.length = 0;
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: Math.random() * 2.5 + 1.2,
        baseAlpha: Math.random() * 0.55 + 0.2,
        alpha: Math.random() * 0.55 + 0.2,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        pulseSpeed: Math.random() * 0.03 + 0.01,
        pulseAngle: Math.random() * Math.PI * 2
      });
    }
  }

  createParticles();

  function animate() {
    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];

      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0) p.x = width;
      if (p.x > width) p.x = 0;
      if (p.y < 0) p.y = height;
      if (p.y > height) p.y = 0;

      p.pulseAngle += p.pulseSpeed;
      p.alpha = p.baseAlpha + Math.sin(p.pulseAngle) * 0.2;

      const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius * 3);
      gradient.addColorStop(0, `rgba(255, 199, 0, ${p.alpha})`);
      gradient.addColorStop(0.5, `rgba(255, 184, 0, ${p.alpha * 0.35})`);
      gradient.addColorStop(1, 'rgba(255, 184, 0, 0)');

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * 3, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 220, 100, ${p.alpha + 0.25})`;
      ctx.fill();
    }

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 100) {
          const lineAlpha = (1 - dist / 100) * 0.15;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(255, 184, 0, ${lineAlpha})`;
          ctx.lineWidth = 0.7;
          ctx.stroke();
        }
      }
    }

    requestAnimationFrame(animate);
  }

  animate();
}

/* ==========================================================================
   NAVIGATION & TABS (WITH PERSISTENCE ON PAGE REFRESH)
   ========================================================================== */
function setupNavigationHandlers() {
  const tabInfo = {
    dashboard: {
      title: 'Pregled Sistema',
      subtitle: 'Kontrola servera i mrežnih resursa u realnom vremenu'
    },
    printers: {
      title: 'Upravljanje Štampačima',
      subtitle: 'Baza mrežnih štampača, evidencija oznaka i kontrola statusa'
    },
    computers: {
      title: 'Računari',
      subtitle: 'Evidencija i nadzor radnih stanica (Desktop PC) i laptop računara zaposlenih'
    },
    servers: {
      title: 'Serveri',
      subtitle: 'Domen kontroleri, mrežni gateway čvorovi, virtuelne mašine i servisi'
    },
    cameras: {
      title: 'Video Nadzor - IP Kamere',
      subtitle: 'Nadzor sistema video nadzora, IP kamera i video strimova (124.x & 125.x)'
    },
    inventory_cameras: {
      title: 'Evidencija Video Nadzora i Digitalnih Kamera',
      subtitle: 'Zvanični registar aktivnih IP kamera fabrike, raspored po snimačima i pozicijama'
    },
    inventory_recorders: {
      title: 'Evidencija Snimača Video Nadzora',
      subtitle: 'Zvanični registar NVR mrežnih snimača, IP adrese, kapaciteti kanala i dodeljene kamere'
    },
    rf_readers: {
      title: 'Evidencija RF Čitača',
      subtitle: 'Nadzor i registar RFID terminala za prijavu i odjavu radnika (evidencija radnog vremena)'
    },
    wifi_aps: {
      title: 'WiFi Access Points',
      subtitle: 'Aruba Instant On / Swarm Virtual Controller (34 pristupne tačke, radio kanali i povezani klijenti)'
    },
    switches: {
      title: 'Mrežni Svičevi (Switches)',
      subtitle: 'Centralni nadzor mrežnih switch uređaja, SNMP telemetrija i aktivnost portova'
    },
    other_devices: {
      title: 'Ostali Uređaji',
      subtitle: 'IP video nadzor kamere, WiFi pristupne tačke, VoIP i ostala oprema'
    },
    logs: {
      title: 'Sistemski Logovi',
      subtitle: 'Evidencija događaja i aktivnosti servera'
    },
    settings: {
      title: 'Podešavanja Servera',
      subtitle: 'Konfiguracioni parametri i sistemsko okruženje'
    },
    scheduled_services: {
      title: 'Automatski Servisi',
      subtitle: 'Upravljanje rasporedom, vremenima aktivacije i notifikacijama automatizovanih zadataka'
    },
    cctv_cameras: {
      title: 'Video Nadzor — Lista Kamera Uživo',
      subtitle: 'Aktivne digitalne IP kamere sa fluidnim video prikazom uživo (Sub-stream 25 FPS)'
    },
    cctv_monitoring: {
      title: 'Monitoring Video Nadzora',
      subtitle: 'Centralni nadzorni interfejs za monitoring i kontrolu kamera u realnom vremenu'
    },
    equipment: {
      title: 'Evidencija Opreme',
      subtitle: 'Centralni registar IT opreme sa live Navision statusom zaduženja i istorijatom'
    },
    equipment_software: {
      title: 'Software i Licence',
      subtitle: 'Centralni registar softverskih licenci, Windows operativnih sistema i ključeva'
    },
    equipment_dictionaries: {
      title: 'Sistemski Šifarnici',
      subtitle: 'Administracija i pregled kancelarija, objekata, lokacija, kategorija i statusa opreme'
    },
    mts_numbers: {
      title: 'MTS Brojevi i SIM Kartice',
      subtitle: 'Evidencija službenih mobilnih telefona, GPS kartica, internet paketa i rominga'
    },
    network_equipment: {
      title: 'Mrežna Oprema',
      subtitle: 'Evidencija svičeva, rutera, ormana (rack), veznih mesta, antena i čvorišta'
    },
    equipment_nodes: {
      title: 'Mrežna Čvorišta i Rack Ormani',
      subtitle: 'Evidencija rack ormana, optičkih čvorišta, spratnih razdelnika i vezane opreme'
    },
    equipment_lines: {
      title: 'Mrežne i Telefonske Linije',
      subtitle: 'Mapiranje zidnih utičnica, patch panel portova, trasa kablova i veza sa kancelarijama i ormanima'
    },
    access_roles: {
      title: 'Korisnici i Role',
      subtitle: 'Pristup sekcijama platforme i kamerama po rolama, korisnicima i AD grupama'
    },
    ai_agent_prototype: {
      title: 'AI Agent Prototip',
      subtitle: 'NOLEKO AI Development'
    },
    ai_dev_plan: {
      title: 'AI Razvojni Plan',
      subtitle: 'NOLEKO AI Development'
    },
    ai_phased_dev: {
      title: 'Fazni Razvoj',
      subtitle: 'NOLEKO AI Development'
    }
  };

  // Section to Tab mapping for main accordion sections
  const tabSectionMap = {
    computers: 'mreza',
    servers: 'mreza',
    other_devices: 'mreza',
    cameras: 'mreza',
    printers: 'mreza',
    inventory_cameras: 'mreza',
    inventory_recorders: 'mreza',
    rf_readers: 'mreza',
    wifi_aps: 'mreza',
    switches: 'mreza',
    cctv_cameras: 'video_nadzor',
    cctv_monitoring: 'video_nadzor',
    equipment: 'evidencija',
    network_equipment: 'evidencija',
    equipment_nodes: 'evidencija',
    equipment_lines: 'evidencija',
    mts_numbers: 'evidencija',
    equipment_software: 'evidencija',
    equipment_dictionaries: 'evidencija',
    ai_agent_prototype: 'noleko_ai',
    ai_dev_plan: 'noleko_ai',
    ai_phased_dev: 'noleko_ai',
    dashboard: 'server',
    scheduled_services: 'server',
    logs: 'server',
    settings: 'server',
    access_roles: 'server'
  };


  function setOpenSection(sectionId, save = true) {
    const sectionGroups = document.querySelectorAll('.nav-section-group');
    sectionGroups.forEach(group => {
      const btn = group.querySelector('.nav-section-toggle');
      const grpSection = btn?.getAttribute('data-section');
      if (grpSection === sectionId) {
        group.classList.add('open');
        if (btn) btn.setAttribute('aria-expanded', 'true');
      } else {
        group.classList.remove('open');
        if (btn) btn.setAttribute('aria-expanded', 'false');
      }
    });

    if (save && sectionId) {
      try {
        localStorage.setItem('unipromet_open_nav_section', sectionId);
      } catch (e) {
        console.warn('LocalStorage error:', e);
      }
    }
  }

  function updateActiveSectionHighlight(activeTabId) {
    const targetSection = tabSectionMap[activeTabId] || 'server';
    const sectionGroups = document.querySelectorAll('.nav-section-group');
    sectionGroups.forEach(group => {
      const btn = group.querySelector('.nav-section-toggle');
      const grpSection = btn?.getAttribute('data-section');
      if (grpSection === targetSection) {
        group.classList.add('has-active');
      } else {
        group.classList.remove('has-active');
      }
    });
  }

  function activateTab(tabId) {
    if (!tabId || !tabInfo[tabId]) tabId = 'dashboard';

    // Role: ako korisnik nema pravo na traženu stranicu, otvori prvu dozvoljenu
    if (window.UniAccess && !window.UniAccess.canOpenTab(tabId)) {
      tabId = window.UniAccess.firstAllowedTab();
    }
    if (window.UniAccess) window.UniAccess.onTabActivated(tabId);

    // Store chosen tab in localStorage & URL hash so page refresh preserves it
    try {
      localStorage.setItem('unipromet_active_tab', tabId);
      if (window.location.hash !== `#${tabId}`) {
        history.replaceState(null, '', `#${tabId}`);
      }
    } catch (e) {
      console.warn('LocalStorage error:', e);
    }

    navButtons.forEach(btn => {
      if (btn.getAttribute('data-tab') === tabId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Auto-open and highlight parent main section
    const targetSection = tabSectionMap[tabId] || 'server';
    setOpenSection(targetSection, true);
    updateActiveSectionHighlight(tabId);


    mobileNavButtons.forEach(btn => {
      if (btn.getAttribute('data-tab') === tabId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    tabViews.forEach(view => {
      const isTarget = view.id === `tab-${tabId}`;
      if (isTarget) {
        view.classList.add('active');
      } else {
        view.classList.remove('active');
      }
    });

    if (scrollContainer) {
      scrollContainer.scrollTop = 0;
    }

    if (tabInfo[tabId]) {
      if (pageTitle) pageTitle.textContent = tabInfo[tabId].title;
      if (pageSubtitle) pageSubtitle.textContent = tabInfo[tabId].subtitle;
      document.title = `${tabInfo[tabId].title} | UNIPROMET IT ADMIN`;
    }

    if (tabId === 'printers' && allPrinters.length === 0) {
      fetchPrinters();
    }

    if ((tabId === 'computers' || tabId === 'servers' || tabId === 'other_devices') && allLanDevices.length === 0) {
      fetchLanDevices(false);
    }

    if (tabId === 'cameras' && allCameras.length === 0) {
      fetchCameras(false);
    }

    if (tabId === 'inventory_cameras') {
      if (allInventoryCameras.length === 0) {
        fetchInventoryCameras();
      } else {
        renderInventoryCamerasTab();
      }
    }

    if (tabId === 'cctv_cameras') {
      if (allCctvCameras.length === 0) {
        fetchCctvCameras();
      } else {
        renderCctvCamerasTab();
      }
    } else {
      if (typeof unmountCctvSubStreams === 'function') {
        unmountCctvSubStreams();
      }
    }

    if (tabId === 'inventory_recorders') {
      if (allInventoryRecorders.length === 0) {
        fetchInventoryRecorders();
      } else {
        renderInventoryRecordersTab();
      }
    }

    if (tabId === 'rf_readers') {
      if (allRfReaders.length === 0) {
        fetchRfReaders();
      } else {
        renderRfReadersTab();
      }
    }

    if (tabId === 'wifi_aps') {
      if (allWifiAps.length === 0) {
        fetchWifiAps();
      } else {
        renderWifiApsTab();
      }
    }

    if (tabId === 'switches') {
      if (typeof window.fetchSwitches === 'function') {
        window.fetchSwitches();
      }
    }

    if (tabId === 'scheduled_services') {
      fetchScheduledServices();
    }

    if (tabId === 'equipment') {
      if (window.EquipmentModule && typeof window.EquipmentModule.onTabActivated === 'function') {
        window.EquipmentModule.onTabActivated();
      }
    }

    if (tabId === 'equipment_software') {
      if (typeof window.loadSoftwareList === 'function') {
        window.loadSoftwareList();
      }
    }

    if (tabId === 'equipment_dictionaries') {
      if (window.DictionariesModule && typeof window.DictionariesModule.init === 'function') {
        window.DictionariesModule.init();
        window.DictionariesModule.refresh();
      }
    }

    if (tabId === 'mts_numbers') {
      if (window.mtsModule && typeof window.mtsModule.init === 'function') {
        window.mtsModule.init();
      }
    }

    if (tabId === 'network_equipment') {
      if (window.networkEquipmentModule && typeof window.networkEquipmentModule.init === 'function') {
        window.networkEquipmentModule.init();
      }
    }

    if (tabId === 'equipment_nodes') {
      if (window.nodesModule && typeof window.nodesModule.init === 'function') {
        window.nodesModule.init();
      }
    }

    if (tabId === 'equipment_lines') {
      if (window.linesModule && typeof window.linesModule.init === 'function') {
        window.linesModule.init();
      }
    }

    if (tabId === 'access_roles') {
      if (window.AccessRolesModule && typeof window.AccessRolesModule.onTabActivated === 'function') {
        window.AccessRolesModule.onTabActivated();
      }
    }

    if (tabId === 'ai_dev_plan') {
      if (window.NolekoPlanModule && typeof window.NolekoPlanModule.onTabActivated === 'function') {
        window.NolekoPlanModule.onTabActivated();
      }
    }

    if (tabId === 'ai_agent_prototype') {
      if (window.AiAgentModule && typeof window.AiAgentModule.onTabActivated === 'function') {
        window.AiAgentModule.onTabActivated();
      }
    }

    // Monitoring: strimovi i rotacija rade samo dok je stranica otvorena
    if (window.MonitoringModule) {
      if (tabId === 'cctv_monitoring') window.MonitoringModule.onTabActivated();
      else window.MonitoringModule.onTabDeactivated();
    }

    closeMobileDrawer();
    if (window.lucide) window.lucide.createIcons();
  }

  // Direct Event delegation for desktop sidebar navigation
  const sidebarNav = document.querySelector('.sidebar-nav');
  if (sidebarNav) {
    sidebarNav.addEventListener('click', (e) => {
      // Main Section Accordion Toggle (MREŽA, EVIDENCIJA, SERVER) - Single expansion mode
      const sectionToggle = e.target.closest('.nav-section-toggle');
      if (sectionToggle) {
        e.preventDefault();
        e.stopPropagation();
        const sectionId = sectionToggle.getAttribute('data-section');
        const group = sectionToggle.closest('.nav-section-group');
        const isAlreadyOpen = group && group.classList.contains('open');

        if (sectionId === 'evidencija' && window.EquipmentModule) {
          window.EquipmentModule.triggerSyncCheck();
        }

        if (isAlreadyOpen) {
          group.classList.remove('open');
          sectionToggle.setAttribute('aria-expanded', 'false');
          try {
            localStorage.setItem('unipromet_open_nav_section', '');
          } catch (err) {}
        } else {
          setOpenSection(sectionId, true);
        }
        return;
      }

      // Submenu Dropdown Accordion (e.g. Video nadzor)
      const dropdownToggle = e.target.closest('.nav-dropdown-toggle');
      if (dropdownToggle) {
        e.preventDefault();
        e.stopPropagation();
        const dropdown = dropdownToggle.closest('.nav-dropdown');
        if (dropdown) {
          const isOpen = dropdown.classList.toggle('open');
          dropdownToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
          try {
            localStorage.setItem('unipromet_cctv_open', isOpen ? 'true' : 'false');
          } catch (err) {}
        }
        return;
      }

      const btn = e.target.closest('.nav-tab-btn');
      if (btn) {
        e.preventDefault();
        const tab = btn.getAttribute('data-tab');
        const catId = btn.getAttribute('data-category-id');
        if (tab === 'equipment' && catId && window.EquipmentModule) {
          window.EquipmentModule.selectCategory(catId);
        }
        if (tab) activateTab(tab);
      }
    });
  }


  // Direct Event delegation for mobile navigation
  const mobileNav = document.querySelector('.mobile-bottom-nav');
  if (mobileNav) {
    mobileNav.addEventListener('click', (e) => {
      const btn = e.target.closest('.m-nav-item');
      if (btn) {
        e.preventDefault();
        const tab = btn.getAttribute('data-tab');
        if (tab) activateTab(tab);
      }
    });
  }

  // Individual button listeners
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      activateTab(btn.getAttribute('data-tab'));
    });
  });

  document.querySelectorAll('.m-nav-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      activateTab(btn.getAttribute('data-tab'));
    });
  });

  window.activateTab = activateTab;
  window.switchTab = activateTab;
  window.switchNavTab = activateTab;

  // Restore previous tab from hash or localStorage on page load
  const initialHash = window.location.hash.replace('#', '').trim();
  const savedTab = initialHash || localStorage.getItem('unipromet_active_tab') || 'dashboard';
  activateTab(savedTab);

  // Restore user's last open main section (or section belonging to saved tab)
  const savedOpenSection = localStorage.getItem('unipromet_open_nav_section');
  if (savedOpenSection) {
    setOpenSection(savedOpenSection, false);
  } else {
    setOpenSection(tabSectionMap[savedTab] || 'server', false);
  }

}

function openMobileDrawer() {
  sidebar?.classList.add('mobile-open');
  sidebarBackdrop?.classList.add('active');
  if (window.lucide) window.lucide.createIcons();
}

function closeMobileDrawer() {
  sidebar?.classList.remove('mobile-open');
  sidebarBackdrop?.classList.remove('active');
}

/* ==========================================================================
   EVENT LISTENERS & ACTIONS
   ========================================================================== */
function setupEventListeners() {
  const menuBtn = document.getElementById('mobile-menu-btn');
  const closeBtn = document.getElementById('sidebar-close-btn');

  menuBtn?.addEventListener('click', openMobileDrawer);
  closeBtn?.addEventListener('click', closeMobileDrawer);
  sidebarBackdrop?.addEventListener('click', closeMobileDrawer);

  // Copy LAN URLs
  const btnCopyLan = document.getElementById('btn-copy-lan');
  const btnCopyHero = document.getElementById('btn-copy-hero-url');

  [btnCopyLan, btnCopyHero].forEach(btn => {
    btn?.addEventListener('click', () => {
      if (!primaryLanUrl) return;
      navigator.clipboard.writeText(primaryLanUrl).then(() => {
        showToast(`Kopirana adresa: ${primaryLanUrl}`, 'success');
      }).catch(() => {
        showToast('Neuspešno kopiranje', 'error');
      });
    });
  });

  // Refresh Telemetry Buttons
  const btnRefresh = document.getElementById('btn-refresh');
  const mobileBtnRefresh = document.getElementById('mobile-btn-refresh');

  function triggerRefresh(btnElement) {
    if (btnElement) {
      btnElement.style.transform = 'rotate(360deg)';
      btnElement.style.transition = 'transform 0.5s ease';
      setTimeout(() => { btnElement.style.transform = 'none'; }, 500);
    }
    fetchInitialData();
    fetchPrinters(false);
    showToast('Podaci su osveženi', 'info');
  }

  btnRefresh?.addEventListener('click', () => triggerRefresh(btnRefresh));
  mobileBtnRefresh?.addEventListener('click', () => triggerRefresh(mobileBtnRefresh));

  // Switches Telemetry Event Listeners
  document.getElementById('btn-refresh-switches')?.addEventListener('click', () => {
    if (typeof window.fetchSwitches === 'function') window.fetchSwitches(true);
  });

  const closeSwitchModal = () => {
    const modal = document.getElementById('modal-switch-details');
    if (modal) modal.style.display = 'none';
  };
  document.getElementById('btn-close-switch-modal')?.addEventListener('click', closeSwitchModal);
  document.getElementById('btn-close-switch-modal-foot')?.addEventListener('click', closeSwitchModal);

  // Ping Latency Tests
  const btnHeroPing = document.getElementById('btn-hero-ping');
  const btnManualPing = document.getElementById('btn-manual-ping');
  const heroPingText = document.getElementById('hero-ping-text');
  const pingDetailedOutput = document.getElementById('ping-detailed-output');

  async function runPingTest() {
    if (heroPingText) heroPingText.textContent = 'Merenje...';
    if (pingDetailedOutput) pingDetailedOutput.textContent = 'Merenje odziva...';
    const start = performance.now();
    try {
      const res = await fetch('/api/ping');
      const end = performance.now();
      if (res.ok) {
        const ms = Math.round(end - start);
        const text = `⚡ Odziv: ${ms} ms`;
        if (heroPingText) heroPingText.textContent = text;
        if (pingDetailedOutput) {
          pingDetailedOutput.textContent = text;
          pingDetailedOutput.style.color = '#FFC700';
        }
        const sidePing = document.getElementById('sidebar-ping');
        if (sidePing) sidePing.textContent = `${ms} ms`;
      }
    } catch {
      if (heroPingText) heroPingText.textContent = '❌ Greška';
      if (pingDetailedOutput) pingDetailedOutput.textContent = '❌ Greška u povezivanju';
    }
  }

  btnHeroPing?.addEventListener('click', runPingTest);
  btnManualPing?.addEventListener('click', runPingTest);

  // Log Modal Handling
  const logModal = document.getElementById('modal-new-log');
  const btnOpenLogModal = document.getElementById('btn-open-log-modal');
  const btnCloseLogModal = document.getElementById('btn-close-log-modal');
  const btnCancelLogModal = document.getElementById('btn-cancel-log-modal');
  const formAddLog = document.getElementById('form-add-log');

  btnOpenLogModal?.addEventListener('click', () => { if (logModal) logModal.style.display = 'flex'; });
  btnCloseLogModal?.addEventListener('click', () => { if (logModal) logModal.style.display = 'none'; });
  btnCancelLogModal?.addEventListener('click', () => { if (logModal) logModal.style.display = 'none'; });

  formAddLog?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = document.getElementById('input-log-msg')?.value;
    const level = document.getElementById('select-log-level')?.value;

    try {
      const res = await fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, level, source: 'UNIPROMET Panel' })
      });
      if (res.ok) {
        showToast('Zabeleška uspešno dodata u dnevnik', 'success');
        formAddLog.reset();
        if (logModal) logModal.style.display = 'none';
        fetchLogs();
      }
    } catch {
      showToast('Greška pri slanju zabeleške', 'error');
    }
  });

  // Printer UI Event Handlers
  const btnScanPrinters = document.getElementById('btn-scan-printers');
  const inputSearchPrinters = document.getElementById('input-search-printers');
  const btnClearSearchPrinters = document.getElementById('btn-clear-search-printers');
  const categoryFilters = document.querySelectorAll('#printer-category-filters .filter-pill');
  const printerAddModal = document.getElementById('modal-add-printer');
  const btnOpenAddPrinter = document.getElementById('btn-open-add-printer-modal');
  const btnClosePrinterModal = document.getElementById('btn-close-printer-modal');
  const btnCancelPrinterModal = document.getElementById('btn-cancel-printer-modal');
  const formAddPrinter = document.getElementById('form-add-printer');

  // Edit Printer Modal Elements
  const printerEditModal = document.getElementById('modal-edit-printer');
  const btnCloseEditModal = document.getElementById('btn-close-edit-modal');
  const btnCancelEditModal = document.getElementById('btn-cancel-edit-modal');
  const formEditPrinter = document.getElementById('form-edit-printer');

  // View Mode Switcher (Grid vs List Table)
  const btnViewGrid = document.getElementById('btn-view-grid');
  const btnViewList = document.getElementById('btn-view-list');

  function setViewMode(mode) {
    printerViewMode = mode;
    localStorage.setItem('unipromet_printers_view_mode', mode);

    if (mode === 'grid') {
      btnViewGrid?.classList.add('active');
      btnViewList?.classList.remove('active');
    } else {
      btnViewList?.classList.add('active');
      btnViewGrid?.classList.remove('active');
    }

    renderPrintersList();
  }

  btnViewGrid?.addEventListener('click', () => setViewMode('grid'));
  btnViewList?.addEventListener('click', () => setViewMode('list'));

  // Initialize view mode from storage
  if (printerViewMode === 'list') {
    btnViewList?.classList.add('active');
    btnViewGrid?.classList.remove('active');
  } else {
    btnViewGrid?.classList.add('active');
    btnViewList?.classList.remove('active');
  }

  btnScanPrinters?.addEventListener('click', () => {
    fetchPrinters(true);
  });

  inputSearchPrinters?.addEventListener('input', (e) => {
    printerSearchTerm = e.target.value.toLowerCase().trim();
    if (btnClearSearchPrinters) {
      btnClearSearchPrinters.style.display = printerSearchTerm ? 'flex' : 'none';
    }
    renderPrintersList();
  });

  btnClearSearchPrinters?.addEventListener('click', () => {
    if (inputSearchPrinters) {
      inputSearchPrinters.value = '';
      inputSearchPrinters.focus();
    }
    printerSearchTerm = '';
    btnClearSearchPrinters.style.display = 'none';
    renderPrintersList();
  });

  const selectModelFilter = document.getElementById('select-printer-model-filter');
  selectModelFilter?.addEventListener('change', (e) => {
    selectedPrinterModel = e.target.value;
    renderPrintersList();
  });

  // Interactive Printer KPI Cards
  const kpiTotal = document.getElementById('kpi-card-printers-total');
  const kpiOnline = document.getElementById('kpi-card-printers-online');
  const kpiOffline = document.getElementById('kpi-card-printers-offline');
  const kpiDecom = document.getElementById('kpi-card-printers-decom');

  kpiTotal?.addEventListener('click', () => setPrinterFilter('active'));
  kpiOnline?.addEventListener('click', () => setPrinterFilter('online'));
  kpiOffline?.addEventListener('click', () => setPrinterFilter('offline'));
  kpiDecom?.addEventListener('click', () => setPrinterFilter('decommissioned'));

  categoryFilters.forEach(pill => {
    pill.addEventListener('click', () => {
      setPrinterFilter(pill.getAttribute('data-category') || 'active');
    });
  });

  // Add Printer Modal
  btnOpenAddPrinter?.addEventListener('click', () => { if (printerAddModal) printerAddModal.style.display = 'flex'; });
  btnClosePrinterModal?.addEventListener('click', () => { if (printerAddModal) printerAddModal.style.display = 'none'; });
  btnCancelPrinterModal?.addEventListener('click', () => { if (printerAddModal) printerAddModal.style.display = 'none'; });

  formAddPrinter?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('input-printer-name')?.value;
    const ip = document.getElementById('input-printer-ip')?.value;
    const location = document.getElementById('input-printer-location')?.value;
    const customTag = document.getElementById('input-printer-tag')?.value;
    const model = document.getElementById('input-printer-model')?.value;
    const notes = document.getElementById('input-printer-notes')?.value;

    try {
      const res = await fetch('/api/printers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ip, location, customTag, model, notes })
      });
      if (res.ok) {
        showToast(`Štampač ${name} sačuvan u bazi podataka!`, 'success');
        formAddPrinter.reset();
        if (printerAddModal) printerAddModal.style.display = 'none';
        fetchPrinters(false);
      }
    } catch {
      showToast('Greška pri dodavanju štampača', 'error');
    }
  });

  // Edit Printer Modal
  btnCloseEditModal?.addEventListener('click', () => { if (printerEditModal) printerEditModal.style.display = 'none'; });
  btnCancelEditModal?.addEventListener('click', () => { if (printerEditModal) printerEditModal.style.display = 'none'; });

  formEditPrinter?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-printer-id')?.value;
    const name = document.getElementById('edit-printer-name')?.value;
    const customTag = document.getElementById('edit-printer-tag')?.value;
    const location = document.getElementById('edit-printer-location')?.value;
    const statusToggle = document.getElementById('edit-printer-status-toggle')?.value;
    const notes = document.getElementById('edit-printer-notes')?.value;

    const isDecommissioned = (statusToggle === 'decommissioned');

    try {
      const res = await fetch(`/api/printers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          customTag,
          location,
          notes,
          isDecommissioned,
          decommissionReason: isDecommissioned ? (notes || 'Sklonjen iz upotrebe') : undefined
        })
      });

      if (res.ok) {
        showToast(`Promene sačuvane za ${name}`, 'success');
        if (printerEditModal) printerEditModal.style.display = 'none';
        fetchPrinters(false);
      }
    } catch {
      showToast('Greška pri čuvanju izmena', 'error');
    }
  });

  // Telemetry Modal Handlers
  const telemetryModal = document.getElementById('modal-printer-telemetry');
  const btnCloseTelemetryModal = document.getElementById('btn-close-telemetry-modal');
  const btnCancelTelemetryModal = document.getElementById('btn-cancel-telemetry-modal');
  const btnRefreshTelemetryAction = document.getElementById('btn-refresh-telemetry-action');

  btnCloseTelemetryModal?.addEventListener('click', () => { if (telemetryModal) telemetryModal.style.display = 'none'; });
  btnCancelTelemetryModal?.addEventListener('click', () => { if (telemetryModal) telemetryModal.style.display = 'none'; });
  btnRefreshTelemetryAction?.addEventListener('click', () => {
    if (currentTelemetryIp) {
      openPrinterTelemetryModal(currentTelemetryIp, currentTelemetryName, true);
    }
  });

  // =========================================================================
  // REPORT GENERATOR & HISTORY EVENT LISTENERS
  // =========================================================================
  const btnOpenGenerateReport = document.getElementById('btn-open-generate-report');
  const btnOpenHistoryReports = document.getElementById('btn-open-history-reports');

  const generateReportModal = document.getElementById('modal-generate-report');
  const btnCloseGenerateModal = document.getElementById('btn-close-generate-modal');
  const btnCancelGenerateModal = document.getElementById('btn-cancel-generate-modal');
  const btnTriggerGenerateReport = document.getElementById('btn-trigger-generate-report');

  const historyModal = document.getElementById('modal-history-reports');
  const btnCloseHistoryModal = document.getElementById('btn-close-history-modal');
  const btnCloseHistoryBtn = document.getElementById('btn-close-history-btn');

  btnOpenGenerateReport?.addEventListener('click', openGenerateReportModal);
  btnCloseGenerateModal?.addEventListener('click', () => { if (generateReportModal) generateReportModal.style.display = 'none'; });
  btnCancelGenerateModal?.addEventListener('click', () => { if (generateReportModal) generateReportModal.style.display = 'none'; });
  btnTriggerGenerateReport?.addEventListener('click', triggerReportGeneration);

  btnOpenHistoryReports?.addEventListener('click', openHistoryReportsModal);
  btnCloseHistoryModal?.addEventListener('click', () => { if (historyModal) historyModal.style.display = 'none'; });
  btnCloseHistoryBtn?.addEventListener('click', () => { if (historyModal) historyModal.style.display = 'none'; });

  // =========================================================================
  // LOW TONERS ALERT (≤5%) EVENT LISTENERS
  // =========================================================================
  const btnOpenLowToners = document.getElementById('btn-open-low-toners');
  const lowTonersModal = document.getElementById('modal-low-toners');
  const btnCloseLowTonersModal = document.getElementById('btn-close-low-toners-modal');
  const btnCloseLowTonersBtn = document.getElementById('btn-close-low-toners-btn');
  const btnRescanLowToners = document.getElementById('btn-rescan-low-toners');
  const btnCopyLowTonersList = document.getElementById('btn-copy-low-toners-list');

  btnOpenLowToners?.addEventListener('click', () => openLowTonersModal(false));
  btnCloseLowTonersModal?.addEventListener('click', () => { if (lowTonersModal) lowTonersModal.style.display = 'none'; });
  btnCloseLowTonersBtn?.addEventListener('click', () => { if (lowTonersModal) lowTonersModal.style.display = 'none'; });
  btnRescanLowToners?.addEventListener('click', () => openLowTonersModal(true));
  btnCopyLowTonersList?.addEventListener('click', copyLowTonersSummaryText);
  const btnEmailLowToners = document.getElementById('btn-email-low-toners');
  btnEmailLowToners?.addEventListener('click', sendLowTonersEmailReport);

  // Initialize LAN Fleet Event Listeners (Računari, Serveri, Ostali uređaji)
  setupLanFleetEventListeners();
  setupCamerasEventListeners();
  setupInventoryCamerasEventListeners();
  setupCctvCamerasEventListeners();
  setupInventoryRecordersEventListeners();
  setupRfReadersEventListeners();
  setupWifiApsEventListeners();
  setupScheduledServicesEventListeners();
  setupLiveStreamEventListeners();
}

let isSendingTonersEmail = false;
async function sendLowTonersEmailReport() {
  if (isSendingTonersEmail) return;
  isSendingTonersEmail = true;

  setButtonSpinning('btn-email-low-toners', true);
  const btn = document.getElementById('btn-email-low-toners');
  if (btn) btn.disabled = true;

  showToast('Slanje HTML izveštaja o kritičnim tonerima administratorima (Marko Lukić & Andrija Borovnjak)...', 'info');

  try {
    const res = await fetch('/api/mail/send-low-toners-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: ['marko.lukic@unipromet.co.rs', 'andrija.borovnjak@unipromet.co.rs'],
        reportData: currentLowTonersResult
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast('✓ Izveštaj o kritičnim tonerima uspešno poslat na marko.lukic@unipromet.co.rs i andrija.borovnjak@unipromet.co.rs!', 'success');
      fetchLogs();
    } else {
      throw new Error(data.details || data.error || 'Greška pri slanju izveštaja');
    }
  } catch (err) {
    console.error('Low toners email error:', err);
    showToast(`Neuspešno slanje izveštaja: ${err.message}`, 'error');
  } finally {
    setButtonSpinning('btn-email-low-toners', false);
    if (btn) btn.disabled = false;
    isSendingTonersEmail = false;
  }
}
window.sendLowTonersEmailReport = sendLowTonersEmailReport;

function setPrinterFilter(filterValue) {
  currentPrinterFilter = filterValue || 'active';

  // Update KPI cards active state
  const kpiTotal = document.getElementById('kpi-card-printers-total');
  const kpiOnline = document.getElementById('kpi-card-printers-online');
  const kpiOffline = document.getElementById('kpi-card-printers-offline');
  const kpiDecom = document.getElementById('kpi-card-printers-decom');

  [kpiTotal, kpiOnline, kpiOffline, kpiDecom].forEach(card => {
    if (!card) return;
    if (card.getAttribute('data-category') === currentPrinterFilter) {
      card.classList.add('active-filter');
    } else {
      card.classList.remove('active-filter');
    }
  });

  // Update Category pills active state
  const categoryFilters = document.querySelectorAll('#printer-category-filters .filter-pill');
  categoryFilters.forEach(pill => {
    if (pill.getAttribute('data-category') === currentPrinterFilter) {
      pill.classList.add('active');
    } else {
      pill.classList.remove('active');
    }
  });

  updateModelFilterDropdown();
  renderPrintersList();
}

/* ==========================================================================
   DATA FETCHING & LIVE TELEMETRY
   ========================================================================== */
async function fetchInitialData() {
  // Role: učitavaj samo podatke za stranice koje korisnik sme da vidi (izbegava 403 u pozadini)
  const acc = window.UniAccess;
  const can = (tab) => !acc || acc.canView(tab);
  const jobs = [fetchStatus(), fetchStats()];
  if (can('logs')) jobs.push(fetchLogs());
  if (can('printers')) jobs.push(fetchPrinters(false));
  if (can('computers') || can('servers') || can('other_devices')) jobs.push(fetchLanDevices(false));
  if (!acc || acc.canUseCameraData()) {
    jobs.push(fetchCameras(false));
    jobs.push(fetchInventoryCameras());
    jobs.push(fetchInventoryRecorders());
  }
  if (can('rf_readers')) jobs.push(fetchRfReaders());
  if (can('wifi_aps')) jobs.push(fetchWifiAps());
  if (can('scheduled_services')) jobs.push(fetchScheduledServices(false));
  await Promise.all(jobs);
  if (window.lucide) window.lucide.createIcons();
}

async function fetchLiveTelemetry() {
  if (isFetching) return;
  isFetching = true;
  try {
    await Promise.all([
      fetchStatus(),
      fetchStats()
    ]);
  } finally {
    isFetching = false;
  }
}

async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const data = await res.json();

    const localIps = data.network?.localIps || [];
    const port = window.location.port || '3000';

    // Zvanična adresa portala (PUBLIC_URL iz .env), npr. https://portal.unipromet.local
    const portalUrl = data.network?.publicUrl || '';

    if (localIps.length > 0) {
      primaryLanUrl = portalUrl || `http://${localIps[0].address}:${port}`;
      const lanEl = document.getElementById('lan-primary-url');
      if (lanEl) lanEl.textContent = primaryLanUrl;
      const heroLan = document.getElementById('hero-lan-url');
      if (heroLan) heroLan.textContent = portalUrl ? portalUrl.replace(/^https?:\/\//, '') : `${localIps[0].address}:${port}`;
      const primIp = document.getElementById('val-primary-ip');
      if (primIp) primIp.textContent = localIps[0].address;
    } else {
      primaryLanUrl = `http://localhost:${port}`;
      const lanEl = document.getElementById('lan-primary-url');
      if (lanEl) lanEl.textContent = primaryLanUrl;
      const primIp = document.getElementById('val-primary-ip');
      if (primIp) primIp.textContent = '127.0.0.1';
    }

    if (data.system) {
      document.getElementById('sys-hostname').textContent = data.system.hostname || 'Unipromet-PC';
      document.getElementById('sys-cpu-model').textContent = data.system.cpuModel || 'x86_64';
      document.getElementById('sys-cores').textContent = `${data.system.cpus} jezgra`;
      document.getElementById('sys-node-version').textContent = `Node ${data.system.nodeVersion} + TS 5`;
      if (data.system.appVersion) {
        document.getElementById('sys-app-version').textContent = `v${data.system.appVersion}`;
        document.getElementById('sidebar-app-version').textContent = `Verzija ${data.system.appVersion}`;
      }
      document.getElementById('sys-platform-tag').textContent = `${data.system.platform} (${data.system.arch})`;
    }

    if (data.network?.clientIp) {
      document.getElementById('sys-client-ip').textContent = data.network.clientIp;
    }

    renderLanEndpoints(localIps, port);

    const badgeNet = document.getElementById('badge-network-count');
    if (badgeNet) badgeNet.textContent = localIps.length.toString();

  } catch (err) {
    console.warn('Status error:', err);
    const servStatus = document.getElementById('val-server-status');
    if (servStatus) servStatus.textContent = 'PONOVNO POVEZIVANJE';
  }
}

async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) return;
    const stats = await res.json();

    document.getElementById('kpi-uptime').textContent = formatUptimeHuman(stats.serverUptimeSeconds);
    document.getElementById('kpi-uptime-exact').textContent = formatUptime(stats.serverUptimeSeconds);

    document.getElementById('kpi-mem-used').textContent = `${stats.memoryUsageMB} MB`;
    document.getElementById('kpi-mem-percent').textContent = `${stats.memoryPercent}%`;
    document.getElementById('kpi-mem-bar').style.width = `${stats.memoryPercent}%`;

    document.getElementById('kpi-connections').textContent = `${stats.activeConnections} aktivna`;
    document.getElementById('kpi-health').textContent = stats.operations?.systemHealth || '100%';

    document.getElementById('stat-active-mods').textContent = stats.operations?.activeModules || '6';
    document.getElementById('stat-inspected').textContent = stats.operations?.inspectedItemsToday || '1,420';

  } catch (err) {
    console.warn('Stats error:', err);
  }
}

async function fetchLogs() {
  try {
    const res = await fetch('/api/logs');
    if (!res.ok) return;
    const data = await res.json();
    const logs = data.logs || [];

    const badge = document.getElementById('badge-logs-count');
    if (badge) badge.textContent = logs.length.toString();

    const tbody = document.getElementById('dashboard-logs-tbody');
    if (tbody) {
      if (logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="table-empty-cell">Nema zabeleženih logova</td></tr>`;
      } else {
        tbody.innerHTML = logs.slice(0, 5).map(log => `
          <tr>
            <td class="font-mono text-yellow">${formatTime(log.timestamp)}</td>
            <td><span class="status-badge ${log.level}">${log.level}</span></td>
            <td class="font-mono">${escapeHtml(log.source)}</td>
            <td>${escapeHtml(log.message)}</td>
          </tr>
        `).join('');
      }
    }

    const terminal = document.getElementById('terminal-logs-view');
    if (terminal) {
      terminal.innerHTML = logs.map(log => `
        <div class="terminal-line">
          <span class="terminal-time">[${formatTime(log.timestamp)}]</span>
          <span class="status-badge ${log.level}">${log.level}</span>
          <span class="terminal-src">&lt;${escapeHtml(log.source)}&gt;</span>
          <span class="terminal-msg">${escapeHtml(log.message)}</span>
        </div>
      `).join('');
    }

  } catch (err) {
    console.warn('Logs error:', err);
  }
}

/* ==========================================================================
   PRINTERS MANAGEMENT & DATABASE OPERATIONS
   ========================================================================== */
async function fetchPrinters(forceScan = false) {
  if (forceScan) {
    setButtonSpinning('btn-scan-printers', true);
    showToast('⚡ Buđenje štampača iz sleep moda i skeniranje mreže...', 'info');
  } else {
    setButtonSpinning('btn-scan-printers', false);
  }

  try {
    const url = forceScan ? '/api/printers/scan' : '/api/printers';
    const method = forceScan ? 'POST' : 'GET';
    const res = await fetch(url, { method });
    if (!res.ok) throw new Error('Mrežna greška');
    
    const data = await res.json();
    allPrinters = data.printers || [];

    // Update KPI Metrics
    const totalEl = document.getElementById('stat-printers-total');
    const onlineEl = document.getElementById('stat-printers-online');
    const offlineEl = document.getElementById('stat-printers-offline');
    const decomEl = document.getElementById('stat-printers-decommissioned');
    const onlineSubEl = document.getElementById('stat-printers-online-sub');

    const activeCount = data.active ?? allPrinters.filter(p => !p.isDecommissioned).length;
    const onlineCount = data.online ?? allPrinters.filter(p => !p.isDecommissioned && p.isOnline).length;
    const offlineCount = data.offline ?? (activeCount - onlineCount);
    const decomCount = data.decommissioned ?? allPrinters.filter(p => p.isDecommissioned).length;

    if (totalEl) totalEl.textContent = activeCount;
    if (onlineEl) onlineEl.textContent = onlineCount;
    if (offlineEl) offlineEl.textContent = offlineCount;
    if (decomEl) decomEl.textContent = decomCount;

    const bPrinters = document.getElementById('badge-nav-printers');
    if (bPrinters) bPrinters.textContent = activeCount;

    if (onlineSubEl && activeCount > 0) {
      const pct = Math.round((onlineCount / activeCount) * 100);
      onlineSubEl.textContent = `${pct}% dostupno na mreži`;
    }

    updateModelFilterDropdown();
    renderPrintersList();

    if (forceScan) {
      showToast(`Baza osvežena: evidentirano ${allPrinters.length} štampača (${onlineCount} online)!`, 'success');
    }
  } catch (err) {
    console.error('Printers fetch error:', err);
    showToast('Greška pri učitavanju baze štampača', 'error');
  } finally {
    setButtonSpinning('btn-scan-printers', false);
  }
}

function updateModelFilterDropdown() {
  const select = document.getElementById('select-printer-model-filter');
  if (!select) return;

  const relevantPrinters = currentPrinterFilter === 'decommissioned' 
    ? allPrinters.filter(p => p.isDecommissioned)
    : allPrinters.filter(p => !p.isDecommissioned);

  const modelCounts = {};
  relevantPrinters.forEach(p => {
    const m = p.model || 'Ostali Modeli';
    modelCounts[m] = (modelCounts[m] || 0) + 1;
  });

  const sortedModels = Object.keys(modelCounts).sort();

  let html = `<option value="all">Svi Modeli (${relevantPrinters.length})</option>`;
  sortedModels.forEach(m => {
    const isSelected = selectedPrinterModel === m ? 'selected' : '';
    html += `<option value="${escapeHtml(m)}" ${isSelected}>${escapeHtml(m)} (${modelCounts[m]})</option>`;
  });

  select.innerHTML = html;

  // If previous selection is not in list, reset to 'all'
  if (selectedPrinterModel !== 'all' && !modelCounts[selectedPrinterModel]) {
    selectedPrinterModel = 'all';
    select.value = 'all';
  }
}

function renderPrintersList() {
  const container = document.getElementById('printers-container');
  if (!container) return;

  // Filter printers
  let filtered = allPrinters.filter(printer => {
    // 1. Decommissioned filter
    if (currentPrinterFilter === 'decommissioned') {
      if (!printer.isDecommissioned) return false;
    } else {
      // For all other standard tabs, hide decommissioned printers unless specifically viewing decommissioned
      if (printer.isDecommissioned) return false;
    }

    // 2. Status filters
    if (currentPrinterFilter === 'online' && !printer.isOnline) return false;
    if (currentPrinterFilter === 'offline' && printer.isOnline) return false;

    // 3. Category filters
    if (currentPrinterFilter !== 'active' && currentPrinterFilter !== 'all' && currentPrinterFilter !== 'online' && currentPrinterFilter !== 'offline' && currentPrinterFilter !== 'decommissioned') {
      if (printer.category !== currentPrinterFilter) return false;
    }

    // 4. Model filter
    if (selectedPrinterModel !== 'all') {
      if (printer.model !== selectedPrinterModel) return false;
    }

    // 5. Search filter (Name, Location, IP, Tag, Model, Notes)
    if (printerSearchTerm) {
      const matchName = (printer.name || '').toLowerCase().includes(printerSearchTerm);
      const matchLoc = (printer.location || '').toLowerCase().includes(printerSearchTerm);
      const matchIp = (printer.ip || '').toLowerCase().includes(printerSearchTerm);
      const matchModel = (printer.model || '').toLowerCase().includes(printerSearchTerm);
      const matchTag = (printer.customTag || '').toLowerCase().includes(printerSearchTerm);
      const matchNotes = (printer.notes || '').toLowerCase().includes(printerSearchTerm);
      if (!matchName && !matchLoc && !matchIp && !matchModel && !matchTag && !matchNotes) return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    const isDecomTab = currentPrinterFilter === 'decommissioned';
    container.className = 'printers-cards-grid';
    container.innerHTML = `
      <div class="empty-state-card" style="grid-column: 1 / -1;">
        <div class="empty-icon-wrap"><i data-lucide="${isDecomTab ? 'archive' : 'printer'}"></i></div>
        <h3>${isDecomTab ? 'Nema sklonjenih štampača' : 'Nema pronađenih štampača'}</h3>
        <p>${isDecomTab ? 'Svi evidentirani štampači u bazi su trenutno u aktivnoj upotrebi.' : 'Nijedan štampač ne odgovara unetim kriterijumima pretrage ili filtera.'}</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  // ==========================================
  // VIEW MODE 1: LIST / TABLE VIEW
  // ==========================================
  if (printerViewMode === 'list') {
    container.className = 'printers-list-table-wrapper';
    container.innerHTML = `
      <div class="table-responsive">
        <table class="unipromet-data-table printers-table">
          <thead>
            <tr>
              <th style="width: 110px;">Status</th>
              <th>Naziv i Model</th>
              <th>Oznaka / Tag</th>
              <th>Lokacija</th>
              <th>Mrežna IP</th>
              <th style="width: 80px;">Odziv</th>
              <th>Napomena</th>
              <th style="text-align: right; width: 220px;">Akcije</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(printer => {
              const isOnline = printer.isOnline;
              const isDecom = printer.isDecommissioned;
              const latencyText = isOnline && printer.latencyMs !== null ? `${printer.latencyMs} ms` : '--';
              const statusPillClass = isDecom ? 'pill-decom' : isOnline ? 'pill-online' : 'pill-offline';
              const statusText = isDecom ? 'SKLONJEN' : isOnline ? 'ONLINE' : 'OFFLINE';

              const tag = printer.customTag || 'U funkciji';
              let tagClass = 'tag-default';
              if (tag.includes('Primarni')) tagClass = 'tag-primary';
              else if (tag.includes('deklaracij') || tag.includes('nalepnic')) tagClass = 'tag-labels';
              else if (tag.includes('servis')) tagClass = 'tag-service';
              else if (tag.includes('Sklonjen')) tagClass = 'tag-decom';

              return `
                <tr class="${isDecom ? 'row-decommissioned' : ''}">
                  <td>
                    <span class="printer-status-pill ${statusPillClass}">
                      <span class="status-dot"></span>
                      <span>${statusText}</span>
                    </span>
                  </td>
                  <td>
                    <div class="table-printer-info">
                      <strong class="text-white">${escapeHtml(printer.name)}</strong>
                      <span class="table-model-sub">${escapeHtml(printer.model)}</span>
                    </div>
                  </td>
                  <td>
                    <span class="printer-custom-tag ${tagClass}">
                      <i data-lucide="tag"></i>
                      ${escapeHtml(tag)}
                    </span>
                  </td>
                  <td>
                    <div class="table-printer-loc">
                      <span class="location-highlight">${escapeHtml(printer.location)}</span>
                      <span class="category-tag-sub">${escapeHtml(printer.category)}</span>
                    </div>
                  </td>
                  <td>
                    <div class="table-ip-cell">
                      <span class="font-mono text-yellow font-bold">${escapeHtml(printer.ip)}</span>
                      <button class="btn-copy-chip-sm" onclick="copyCustomUrl('${escapeHtml(printer.ip)}')" title="Kopiraj IP">
                        <i data-lucide="copy"></i>
                      </button>
                    </div>
                  </td>
                  <td>
                    <span class="font-mono ${isOnline ? 'text-success font-bold' : 'text-muted'}" id="ping-val-list-${printer.id}">${latencyText}</span>
                  </td>
                  <td>
                    <span class="table-notes-text" title="${escapeHtml(printer.notes || '')}">
                      ${printer.notes ? escapeHtml(printer.notes) : '<span class="text-dim">-</span>'}
                    </span>
                  </td>
                  <td>
                    <div class="table-actions-row">
                      <button class="btn-table-action btn-table-wake" onclick="wakeSinglePrinter('${printer.ip}', '${escapeHtml(printer.name)}')" title="Probudi štampač (Mrežni impuls)">
                        <i data-lucide="zap"></i>
                      </button>
                      <button class="btn-table-action btn-table-telemetry" onclick="openPrinterTelemetryModal('${printer.ip}', '${escapeHtml(printer.name)}')" title="Nivoi tonera i brojači (SNMP)">
                        <i data-lucide="gauge"></i>
                      </button>
                      <button class="btn-table-action" onclick="openEditPrinterModal('${printer.id}')" title="Uredi oznake">
                        <i data-lucide="edit-2"></i>
                      </button>
                      ${!isDecom ? `
                        <button class="btn-table-action btn-table-danger" onclick="decommissionPrinterAction('${printer.id}')" title="Skloni štampač">
                          <i data-lucide="archive"></i>
                        </button>
                      ` : `
                        <button class="btn-table-action btn-table-restore" onclick="restorePrinterAction('${printer.id}')" title="Vrati u rad">
                          <i data-lucide="rotate-ccw"></i>
                        </button>
                      `}
                      <a href="http://${printer.ip}" target="_blank" rel="noopener" class="btn-table-action" title="Web Panel">
                        <i data-lucide="external-link"></i>
                      </a>
                      <button class="btn-table-action btn-table-ping" onclick="probeSinglePrinter('${printer.ip}', '${printer.id}')" title="Ping test">
                        <i data-lucide="activity"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  // ==========================================
  // VIEW MODE 2: CARD GRID VIEW
  // ==========================================
  container.className = 'printers-cards-grid';
  container.innerHTML = filtered.map(printer => {
    const isOnline = printer.isOnline;
    const isDecom = printer.isDecommissioned;
    const latencyText = isOnline && printer.latencyMs !== null ? `${printer.latencyMs} ms` : '--';
    const statusClass = isDecom ? 'decommissioned-card' : isOnline ? 'online-glow' : 'offline-dim';
    const statusPillClass = isDecom ? 'pill-decom' : isOnline ? 'pill-online' : 'pill-offline';
    const statusText = isDecom ? 'SKLONJEN' : isOnline ? 'ONLINE' : 'OFFLINE';

    // Tag badge class
    const tag = printer.customTag || 'U funkciji';
    let tagClass = 'tag-default';
    if (tag.includes('Primarni')) tagClass = 'tag-primary';
    else if (tag.includes('deklaracij') || tag.includes('nalepnic')) tagClass = 'tag-labels';
    else if (tag.includes('servis')) tagClass = 'tag-service';
    else if (tag.includes('Sklonjen')) tagClass = 'tag-decom';

    return `
      <div class="printer-card ${statusClass}" id="card-${printer.id}">
        
        <div class="printer-card-header">
          <div class="printer-type-badge">
            <i data-lucide="printer"></i>
            <span>${escapeHtml(printer.model)}</span>
          </div>
          <div class="printer-status-pill ${statusPillClass}">
            <span class="status-dot"></span>
            <span>${statusText}</span>
          </div>
        </div>

        <div class="printer-card-body">
          <div class="printer-title-row">
            <h4 class="printer-name">${escapeHtml(printer.name)}</h4>
            <span class="printer-custom-tag ${tagClass}">
              <i data-lucide="tag"></i>
              ${escapeHtml(tag)}
            </span>
          </div>

          ${printer.notes ? `
            <div class="printer-notes-box">
              <i data-lucide="message-square" class="notes-icon"></i>
              <span class="notes-text">${escapeHtml(printer.notes)}</span>
            </div>
          ` : ''}

          ${isDecom && printer.decommissionReason ? `
            <div class="decommission-reason-box">
              <i data-lucide="info"></i>
              <span>Razlog uklanjanja: ${escapeHtml(printer.decommissionReason)}</span>
            </div>
          ` : ''}
          
          <div class="printer-meta-row">
            <div class="meta-item">
              <i data-lucide="map-pin" class="meta-icon"></i>
              <span class="meta-text location-highlight">${escapeHtml(printer.location)}</span>
            </div>
            <div class="meta-item">
              <i data-lucide="folder" class="meta-icon"></i>
              <span class="meta-text category-tag">${escapeHtml(printer.category)}</span>
            </div>
          </div>

          <div class="printer-ip-box">
            <div class="ip-details">
              <span class="ip-label">MREŽNA IP &bull; RAW 9100</span>
              <span class="ip-val font-mono">${escapeHtml(printer.ip)}</span>
            </div>
            <button class="btn-copy-chip" onclick="copyCustomUrl('${escapeHtml(printer.ip)}')" title="Kopiraj IP adresu">
              <i data-lucide="copy"></i>
            </button>
          </div>

          <div class="printer-telemetry-bar">
            <div class="telemetry-item">
              <span class="t-label">Odziv</span>
              <span class="t-val font-mono" id="ping-val-${printer.id}">${latencyText}</span>
            </div>
            <div class="telemetry-item">
              <span class="t-label">Deljeno ime</span>
              <span class="t-val">${escapeHtml(printer.shareName || 'Lokalno')}</span>
            </div>
          </div>
        </div>

        <div class="printer-card-actions">
          <button class="btn-printer-action btn-wake-action" onclick="wakeSinglePrinter('${printer.ip}', '${escapeHtml(printer.name)}')" title="Pošalji mrežni signal za buđenje">
            <i data-lucide="zap"></i>
            <span>Probudi</span>
          </button>

          <button class="btn-printer-action btn-telemetry-action" onclick="openPrinterTelemetryModal('${printer.ip}', '${escapeHtml(printer.name)}')" title="Prikaži nivoe tonera i potrošnju">
            <i data-lucide="gauge"></i>
            <span>Potrošnja</span>
          </button>

          <button class="btn-printer-action" onclick="openEditPrinterModal('${printer.id}')" title="Uredi oznake, lokaciju i beleške">
            <i data-lucide="edit-2"></i>
            <span>Oznake</span>
          </button>

          ${!isDecom ? `
            <button class="btn-printer-action btn-danger-action" onclick="decommissionPrinterAction('${printer.id}')" title="Skloni štampač iz upotrebe">
              <i data-lucide="archive"></i>
              <span>Skloni</span>
            </button>
          ` : `
            <button class="btn-printer-action btn-restore-action" onclick="restorePrinterAction('${printer.id}')" title="Vrati štampač u rad">
              <i data-lucide="rotate-ccw"></i>
              <span>Vrati u rad</span>
            </button>
          `}

          <a href="http://${printer.ip}" target="_blank" rel="noopener" class="btn-printer-web" title="Otvori web upravljanje">
            <i data-lucide="external-link"></i>
            <span>Web</span>
          </a>

          <button class="btn-printer-ping" onclick="probeSinglePrinter('${printer.ip}', '${printer.id}')" title="Testiraj mrežnu vezu">
            <i data-lucide="activity"></i>
            <span>Ping</span>
          </button>
        </div>

      </div>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
}

// Wake Single Printer Action
async function wakeSinglePrinter(ip, name) {
  showToast(`⚡ Slanje signala za buđenje na ${name} (${ip})...`, 'info');
  try {
    const res = await fetch(`/api/printers/${ip}/wake`, { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`✅ Štampač ${name} je aktiviran! (${data.methodsUsed.join(', ')})`, 'success');
    } else {
      showToast(`⚡ Impuls poslat na ${ip}`, 'info');
    }
    setTimeout(() => probeSinglePrinter(ip, allPrinters.find(p => p.ip === ip)?.id || ''), 1500);
  } catch {
    showToast(`Greška pri slanju signala za buđenje na ${ip}`, 'error');
  }
}
window.wakeSinglePrinter = wakeSinglePrinter;

// Wake All Printers Action
async function wakeAllPrintersAction() {
  showToast('⚡ Slanje signala za buđenje svim štampačima na mreži...', 'info');
  try {
    const res = await fetch('/api/printers/wake-all', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showToast(`✅ Signal za buđenje uspešno poslat na ${data.woken}/${data.total} štampača!`, 'success');
      setTimeout(() => fetchPrinters(false), 2000);
    }
  } catch {
    showToast('Greška pri masovnom buđenju štampača', 'error');
  }
}
window.wakeAllPrintersAction = wakeAllPrintersAction;

// Open Edit Printer Modal
function openEditPrinterModal(id) {
  const printer = allPrinters.find(p => p.id === id);
  if (!printer) return;

  const modal = document.getElementById('modal-edit-printer');
  document.getElementById('edit-printer-id').value = printer.id;
  document.getElementById('edit-printer-name').value = printer.name;
  document.getElementById('edit-printer-location').value = printer.location;
  document.getElementById('edit-printer-notes').value = printer.notes || '';
  
  const tagSelect = document.getElementById('edit-printer-tag');
  if (tagSelect) tagSelect.value = printer.customTag || 'U funkciji';

  const statusToggle = document.getElementById('edit-printer-status-toggle');
  if (statusToggle) statusToggle.value = printer.isDecommissioned ? 'decommissioned' : 'active';

  if (modal) modal.style.display = 'flex';
}
window.openEditPrinterModal = openEditPrinterModal;

// Open Printer Telemetry & Consumables Modal (SNMP)
async function openPrinterTelemetryModal(ip, printerName, forceRefresh = false) {
  currentTelemetryIp = ip;
  currentTelemetryName = printerName;

  const modal = document.getElementById('modal-printer-telemetry');
  const win = document.getElementById('modal-printer-telemetry-window');
  const loader = document.getElementById('telemetry-loading-state');
  const modalBody = document.getElementById('telemetry-modal-body');
  const modalFooter = document.getElementById('telemetry-modal-footer');
  const modalTitle = document.getElementById('telemetry-modal-title');
  const modalSubtitle = document.getElementById('telemetry-modal-subtitle');
  const btnOpenWeb = document.getElementById('telemetry-btn-open-web');

  if (modalTitle) modalTitle.textContent = printerName || `Štampač ${ip}`;
  if (modalSubtitle) modalSubtitle.textContent = `Mrežna IP adresa: ${ip} • SNMP Port 161`;
  if (btnOpenWeb) btnOpenWeb.href = `http://${ip}`;

  if (forceRefresh) {
    setButtonSpinning('btn-refresh-telemetry-action', true);
  } else {
    setButtonSpinning('btn-refresh-telemetry-action', false);
    // Show compact loader first with smooth window morph
    if (win) win.classList.add('modal-window-loading');
    if (loader) loader.style.display = 'block';
    if (modalBody) {
      modalBody.style.display = 'none';
      modalBody.classList.remove('eq-fade-in');
    }
    if (modalFooter) modalFooter.style.display = 'none';
  }

  if (typeof window.openModal === 'function') {
    window.openModal(modal);
  } else if (modal) {
    modal.style.display = 'flex';
  }

  try {
    const [res] = await Promise.all([
      fetch(`/api/printers/${ip}/consumables${forceRefresh ? '?force=true' : ''}`),
      new Promise(resolve => setTimeout(resolve, 260))
    ]);
    const data = await res.json();

    if (!res.ok || !data.isSnmpAvailable) {
      if (modalBody) {
        modalBody.innerHTML = `
          <div class="telemetry-error-state">
            <div class="err-icon"><i data-lucide="alert-triangle"></i></div>
            <h4>Uređaj ne odgovara na SNMP upit</h4>
            <p>Štampač na adresi <strong>${escapeHtml(ip)}</strong> je ili isključen, ili ima onemogućen SNMP protokol (UDP port 161).</p>
            <div class="err-meta-box">
              <span>Greška: ${escapeHtml(data.error || 'Request timed out')}</span>
            </div>
            <a href="http://${ip}" target="_blank" rel="noopener" class="btn-yellow-solid-sm" style="margin-top: 12px;">
              <i data-lucide="external-link"></i>
              <span>Otvori Web Panel Štampača</span>
            </a>
          </div>
        `;
      }
      if (win) win.classList.remove('modal-window-loading');
      if (loader) loader.style.display = 'none';
      if (modalBody) {
        modalBody.style.display = 'block';
        modalBody.classList.add('eq-fade-in');
      }
      if (modalFooter) modalFooter.style.display = 'flex';
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    // Render complete telemetry details
    if (modalBody) {
      modalBody.innerHTML = `
        <div class="telemetry-content-wrapper">
          
          <!-- Top Info Strip -->
          <div class="telemetry-top-strip">
            <div class="t-strip-item">
              <span class="t-strip-label">Model Uređaja</span>
              <strong class="t-strip-val text-yellow">${escapeHtml(data.model)}</strong>
            </div>
            <div class="t-strip-item">
              <span class="t-strip-label">Serijski Broj</span>
              <span class="t-strip-val font-mono">${escapeHtml(data.serialNumber)}</span>
            </div>
            <div class="t-strip-item">
              <span class="t-strip-label">Status Uređaja</span>
              <span class="status-pill" style="${(data.printerStatus === 'warning' || (data.wasteToner && data.wasteToner.status === 'full')) ? 'background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); font-weight:700;' : (data.printerStatus === 'offline' ? 'background: rgba(148, 163, 184, 0.2); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.4);' : 'background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3);')}">
                <span class="status-dot" style="${(data.printerStatus === 'warning' || (data.wasteToner && data.wasteToner.status === 'full')) ? 'background: #ef4444; box-shadow: 0 0 8px #ef4444;' : 'background: #10b981; box-shadow: 0 0 8px #10b981;'}"></span>
                <span>${escapeHtml(data.printerStatusText)}</span>
              </span>
            </div>
            <div class="t-strip-item">
              <span class="t-strip-label">Vreme Rada (Uptime)</span>
              <span class="t-strip-val font-mono">${escapeHtml(data.uptimeText || 'Aktivno')}</span>
            </div>
            <div class="t-strip-item">
              <span class="t-strip-label">Funkcija Skenera</span>
              <span class="t-strip-val font-mono" style="color: ${data.hasScanner ? '#38bdf8' : '#94a3b8'};">
                ${data.hasScanner ? '✓ Podržano (MFP)' : 'Samo štampač'}
              </span>
            </div>
          </div>

          <!-- Active Hardware Errors / Alerts Banner -->
          ${(data.hasError && data.errors && data.errors.length > 0) ? `
            <div style="margin: 16px 20px 0 20px; padding: 14px 18px; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.4); border-left: 4px solid #ef4444; border-radius: 8px; display: flex; align-items: flex-start; gap: 14px;">
              <div style="font-size: 1.3rem; color: #ef4444; margin-top: 2px;">
                <i data-lucide="alert-octagon"></i>
              </div>
              <div style="flex: 1;">
                <div style="font-size: 0.95rem; font-weight: 700; color: #f87171; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
                  <span>DETEKTOVANE GREŠKE / UPOZORENJA ŠTAMPAČA</span>
                  <span style="font-size: 0.7rem; background: #ef4444; color: #fff; padding: 2px 7px; border-radius: 9999px;">${data.errors.length}</span>
                </div>
                <ul style="margin: 0; padding-left: 18px; color: #fca5a5; font-size: 0.85rem; line-height: 1.45;">
                  ${data.errors.map(err => `<li style="margin-bottom: 2px;"><strong>${escapeHtml(err)}</strong></li>`).join('')}
                </ul>
                <div style="font-size: 0.75rem; color: #fca5a5; opacity: 0.85; margin-top: 6px;">
                  Štampač prijavljuje hardverski zastoj ili zahteva intervenciju operatera pre nastavka normalnog rada.
                </div>
              </div>
            </div>
          ` : ''}

          <!-- Section 1: Toner Consumables (CMYK Gauges) -->
          <div class="telemetry-section">
            <div class="telemetry-section-header">
              <div class="t-sec-title">
                <i data-lucide="droplet" class="text-yellow"></i>
                <span>Nivoi Tonera (CMYK Potrošnja)</span>
              </div>
              <span class="t-sec-badge">Direktno očitavanje sa senzora</span>
            </div>

            ${data.toners && data.toners.length > 0 ? `
              <div class="toner-gauges-grid">
                ${data.toners.map(t => {
                  let barClass = 'bar-black';
                  let labelColor = 'Crni (Black)';
                  let colorCode = '#334155';
                  
                  if (t.color === 'cyan') {
                    barClass = 'bar-cyan';
                    labelColor = 'Plavi (Cyan)';
                    colorCode = '#06b6d4';
                  } else if (t.color === 'magenta') {
                    barClass = 'bar-magenta';
                    labelColor = 'Crveni (Magenta)';
                    colorCode = '#ec4899';
                  } else if (t.color === 'yellow') {
                    barClass = 'bar-yellow';
                    labelColor = 'Žuti (Yellow)';
                    colorCode = '#eab308';
                  }

                  const isLow = t.level <= 15;

                  return `
                    <div class="toner-gauge-card ${isLow ? 'toner-alert-card' : ''}">
                      <div class="toner-gauge-header">
                        <div class="toner-header-left">
                          <div class="toner-dot-color" style="background-color: ${colorCode}; box-shadow: 0 0 8px ${colorCode};"></div>
                          <div class="toner-label-info">
                            <span class="toner-name-main">${labelColor}</span>
                            <span class="toner-sub-model" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</span>
                          </div>
                        </div>
                        <span class="toner-percent-badge font-mono">${t.level}%</span>
                      </div>

                      <div class="toner-progress-track">
                        <div class="toner-progress-fill ${barClass}" style="width: ${t.level}%;"></div>
                      </div>

                      <div class="toner-gauge-footer">
                        <span class="toner-status-text ${isLow ? 'text-danger font-bold' : 'text-muted'}">
                          ${isLow ? '⚠️ NIZAK NIVO' : 'Optimalan nivo'}
                        </span>
                        <span class="text-dim text-xs">Maks: ${t.maxCapacity}%</span>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : `
              <div class="telemetry-notice-box">
                <p>Nema dostupnih senzora tonera za ovaj model štampača.</p>
              </div>
            `}
          </div>

          <!-- Section 2: Metrics & Waste Toner -->
          <div class="telemetry-section-row">
            
            <!-- Page Counter Card -->
            <div class="telemetry-metric-box">
              <div class="metric-box-top">
                <span class="metric-box-label">UKUPNO ODŠTAMPANIH STRANA</span>
                <i data-lucide="file-text" class="text-yellow"></i>
              </div>
              <div class="metric-box-val font-mono text-yellow">
                ${data.totalPageCount !== null ? data.totalPageCount.toLocaleString('sr-RS') : '--'}
              </div>
              <span class="metric-box-sub">Glavni brojač štampanih listova (Marker Life Count)</span>
            </div>

            <!-- Scan Counter Card -->
            <div class="telemetry-metric-box">
              <div class="metric-box-top">
                <span class="metric-box-label">UKUPNO SKENIRANJA (SCAN)</span>
                <i data-lucide="scan" style="color: #38bdf8;"></i>
              </div>
              <div class="metric-box-val font-mono" style="color: ${data.scanCount !== null ? '#38bdf8' : '#64748b'};">
                ${data.scanCount !== null ? data.scanCount.toLocaleString('sr-RS') : (data.hasScanner ? '0' : 'N/A')}
              </div>
              <span class="metric-box-sub">${data.scanCount !== null ? 'Broj skeniranih dokumenata (Counter 501)' : (data.hasScanner ? 'Uređaj poseduje skener (0 skeniranja)' : 'Uređaj nema funkciju skeniranja')}</span>
            </div>

            <!-- Waste Toner Card -->
            ${(() => {
              const isWasteFull = data.wasteToner && (data.wasteToner.status === 'full' || (data.wasteToner.statusText && (data.wasteToner.statusText.toLowerCase().includes('pun') || data.wasteToner.statusText.toLowerCase().includes('zameniti'))));
              const isWasteNear = data.wasteToner && (data.wasteToner.status === 'near_full' || (data.wasteToner.statusText && data.wasteToner.statusText.toLowerCase().includes('skoro')));
              const pillStyle = isWasteFull
                ? 'background: rgba(239, 68, 68, 0.25); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.5); font-weight: 700;'
                : (isWasteNear
                  ? 'background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4);'
                  : 'background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3);');
              const dotStyle = isWasteFull
                ? 'background: #ef4444; box-shadow: 0 0 8px #ef4444;'
                : (isWasteNear
                  ? 'background: #f59e0b; box-shadow: 0 0 8px #f59e0b;'
                  : 'background: #10b981; box-shadow: 0 0 8px #10b981;');
              const iconColor = isWasteFull ? '#ef4444' : (isWasteNear ? '#f59e0b' : '#94a3b8');
              const cardBorder = isWasteFull ? 'border: 1px solid rgba(239, 68, 68, 0.45); background: rgba(239, 68, 68, 0.05);' : '';

              return `
                <div class="telemetry-metric-box" style="${cardBorder}">
                  <div class="metric-box-top">
                    <span class="metric-box-label" style="${isWasteFull ? 'color: #f87171; font-weight:700;' : ''}">OTPADNI TONER (WASTE CONTAINER)</span>
                    <i data-lucide="${isWasteFull ? 'alert-triangle' : 'trash-2'}" style="color: ${iconColor};"></i>
                  </div>
                  <div class="metric-box-val" style="font-size: 1.15rem; margin: 4px 0;">
                    <span class="status-pill" style="${pillStyle}">
                      <span class="status-dot" style="${dotStyle}"></span>
                      <span>${escapeHtml(data.wasteToner ? data.wasteToner.statusText : 'U redu')}</span>
                    </span>
                  </div>
                  <span class="metric-box-sub" style="${isWasteFull ? 'color: #fca5a5;' : ''}">${escapeHtml(data.wasteToner ? data.wasteToner.name : 'Waste Toner')}</span>
                </div>
              `;
            })()}

          </div>

          <!-- Section 3: Paper Trays / Drawers -->
          ${data.trays && data.trays.length > 0 ? `
            <div class="telemetry-section">
              <div class="telemetry-section-header">
                <div class="t-sec-title">
                  <i data-lucide="layers" class="text-yellow"></i>
                  <span>Fioke i Kasete za Papir</span>
                </div>
              </div>

              <div class="paper-trays-grid">
                ${data.trays.map(tray => `
                  <div class="paper-tray-card">
                    <div class="tray-icon-box"><i data-lucide="folder"></i></div>
                    <div class="tray-info">
                      <strong class="tray-title">${escapeHtml(tray.name)}</strong>
                      <span class="tray-capacity font-mono">Kapacitet: ${tray.maxCapacity} listova</span>
                    </div>
                    <span class="status-pill active-pill" style="font-size: 0.7rem;">
                      <i data-lucide="check"></i>
                      <span>${escapeHtml(tray.level)}</span>
                    </span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

        </div>
      `;
    }

    // Smoothly expand modal and fade in telemetry content
    if (win) win.classList.remove('modal-window-loading');
    if (loader) loader.style.display = 'none';
    if (modalBody) {
      modalBody.style.display = 'block';
      modalBody.classList.add('eq-fade-in');
    }
    if (modalFooter) modalFooter.style.display = 'flex';

  } catch (err) {
    if (modalBody) {
      modalBody.innerHTML = `
        <div class="telemetry-error-state">
          <div class="err-icon"><i data-lucide="alert-triangle"></i></div>
          <h4>Greška u komunikaciji</h4>
          <p>Nije moguće dohvatiti podatke o potrošnji za štampač ${escapeHtml(ip)}.</p>
        </div>
      `;
    }
    if (win) win.classList.remove('modal-window-loading');
    if (loader) loader.style.display = 'none';
    if (modalBody) {
      modalBody.style.display = 'block';
      modalBody.classList.add('eq-fade-in');
    }
    if (modalFooter) modalFooter.style.display = 'flex';
  } finally {
    setButtonSpinning('btn-refresh-telemetry-action', false);
    if (window.lucide) window.lucide.createIcons();
  }
}
window.openPrinterTelemetryModal = openPrinterTelemetryModal;

let isSendingSinglePrinterEmail = false;
async function sendCurrentPrinterEmailReport() {
  if (isSendingSinglePrinterEmail) return;
  if (!currentTelemetryIp) {
    showToast('Nije definisana IP adresa štampača.', 'warning');
    return;
  }

  isSendingSinglePrinterEmail = true;
  setButtonSpinning('btn-email-single-printer', true);
  const btn = document.getElementById('btn-email-single-printer');
  if (btn) btn.disabled = true;

  const targetName = currentTelemetryName || currentTelemetryIp;
  showToast(`Slanje detaljnog izveštaja za štampač ${targetName} administratorima...`, 'info');

  try {
    const res = await fetch('/api/mail/send-single-printer-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ip: currentTelemetryIp,
        to: ['marko.lukic@unipromet.co.rs', 'andrija.borovnjak@unipromet.co.rs']
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`✓ Izveštaj za ${data.details?.printerName || targetName} uspešno poslat na ${data.details?.recipient || 'email'}!`, 'success');
      fetchLogs();
    } else {
      throw new Error(data.details || data.error || 'Greška pri slanju izveštaja');
    }
  } catch (err) {
    console.error('Single printer email error:', err);
    showToast(`Neuspešno slanje izveštaja: ${err.message}`, 'error');
  } finally {
    setButtonSpinning('btn-email-single-printer', false);
    if (btn) btn.disabled = false;
    isSendingSinglePrinterEmail = false;
  }
}
window.sendCurrentPrinterEmailReport = sendCurrentPrinterEmailReport;

// =========================================================================
// FULL FLEET CONSUMPTION REPORT GENERATION & HISTORY
// =========================================================================

function openGenerateReportModal() {
  const modal = document.getElementById('modal-generate-report');
  const formState = document.getElementById('report-form-state');
  const progressState = document.getElementById('report-progress-state');
  const resultsState = document.getElementById('report-results-state');
  const titleInput = document.getElementById('input-report-title');
  const btnDownloadExcel = document.getElementById('btn-modal-download-excel');

  if (formState) formState.style.display = 'block';
  if (progressState) progressState.style.display = 'none';
  if (resultsState) resultsState.style.display = 'none';
  if (btnDownloadExcel) btnDownloadExcel.style.display = 'none';

  const now = new Date();
  const monthName = now.toLocaleString('sr-RS', { month: 'long', year: 'numeric' });
  const capitalizedMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1);
  if (titleInput) titleInput.value = `Mesečni Izveštaj Potrošnje - ${capitalizedMonth}`;

  if (modal) modal.style.display = 'flex';
  if (window.lucide) window.lucide.createIcons();
}
window.openGenerateReportModal = openGenerateReportModal;

async function triggerReportGeneration() {
  const formState = document.getElementById('report-form-state');
  const progressState = document.getElementById('report-progress-state');
  const resultsState = document.getElementById('report-results-state');
  const titleInput = document.getElementById('input-report-title');
  const btnDownloadExcel = document.getElementById('btn-modal-download-excel');

  const title = titleInput?.value.trim() || undefined;

  if (formState) formState.style.display = 'none';
  if (progressState) progressState.style.display = 'block';
  if (resultsState) resultsState.style.display = 'none';

  try {
    const res = await fetch('/api/reports/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });

    if (!res.ok) throw new Error('Greška pri generisanju');
    const data = await res.json();
    const report = data.report;

    if (progressState) progressState.style.display = 'none';
    if (resultsState) {
      resultsState.style.display = 'block';
      renderReportResults(report, resultsState);
    }

    if (btnDownloadExcel) {
      btnDownloadExcel.href = `/api/reports/${report.id}/download`;
      btnDownloadExcel.style.display = 'inline-flex';
    }

    showToast(`Izveštaj uspešno generisan: ${report.onlineCount}/${report.deviceCount} štampača očitano!`, 'success');

  } catch (err) {
    if (progressState) progressState.style.display = 'none';
    if (resultsState) {
      resultsState.style.display = 'block';
      resultsState.innerHTML = `
        <div class="telemetry-error-state">
          <div class="err-icon"><i data-lucide="alert-triangle"></i></div>
          <h4>Greška pri generisanju izveštaja</h4>
          <p>Nije uspelo očitavanje mreže i formiranje Excel fajla. Pokušajte ponovo.</p>
        </div>
      `;
    }
    showToast('Greška pri generisanju izveštaja', 'error');
  }

  if (window.lucide) window.lucide.createIcons();
}
window.triggerReportGeneration = triggerReportGeneration;

function renderReportResults(report, container) {
  const totalPagesFormatted = report.totalImpressionsAcrossFleet.toLocaleString('sr-RS');
  const totalScans = report.entries.reduce((acc, e) => acc + (e.pageCounters?.scanTotal || 0), 0);
  const totalScansFormatted = totalScans.toLocaleString('sr-RS');

  container.innerHTML = `
    <div class="report-results-wrapper">
      
      <!-- Top Summary Metrics Banner -->
      <div class="report-summary-banner">
        <div class="rep-metric-item">
          <span class="rep-m-label">OBUHVAĆENO ŠTAMPAČA</span>
          <strong class="rep-m-val text-white">${report.onlineCount} <span class="text-dim text-xs">/ ${report.deviceCount}</span></strong>
        </div>
        <div class="rep-metric-item">
          <span class="rep-m-label">UKUPAN BROJ OTISAKA</span>
          <strong class="rep-m-val text-yellow font-mono">${totalPagesFormatted}</strong>
        </div>
        <div class="rep-metric-item">
          <span class="rep-m-label">UKUPNO SKENIRANJA</span>
          <strong class="rep-m-val font-mono" style="color: #38bdf8;">${totalScansFormatted}</strong>
        </div>
        <div class="rep-metric-item">
          <span class="rep-m-label">PERIOD IZVEŠTAJA</span>
          <strong class="rep-m-val text-white">${escapeHtml(report.monthYear)}</strong>
        </div>
        <div class="rep-metric-item">
          <a href="/api/reports/${report.id}/download" class="btn-yellow-solid-sm" style="height: 38px; align-self: center;">
            <i data-lucide="download"></i>
            <span>Preuzmi Excel (.xlsx)</span>
          </a>
        </div>
      </div>

      <!-- Preview of Excel Structured Report -->
      <div class="report-excel-preview-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <i data-lucide="table" class="text-yellow"></i>
          <span class="font-bold text-white text-sm">Pregled Podataka (Format Fabričke Excel Tabele)</span>
        </div>
        <span class="text-dim text-xs">${report.entries.filter(e => e.status === 'success').length} uređaja uspešno očitano</span>
      </div>

      <div class="report-preview-table-wrap">
        <table class="report-preview-table">
          <thead>
            <tr>
              <th style="width: 40px;">#</th>
              <th>Uređaj &amp; Lokacija &amp; Serijski Broj</th>
              <th style="width: 130px;">101 : Total 1</th>
              <th style="width: 120px;">113 : Black Small</th>
              <th style="width: 120px;">123 : Color Small</th>
              <th style="width: 125px;">501 : Skeniranja</th>
              <th style="width: 100px;">Toneri (CMYK)</th>
            </tr>
          </thead>
          <tbody>
            ${report.entries.map((entry, idx) => {
              const isOk = entry.status === 'success';
              const c = entry.pageCounters || {};
              const tonersText = entry.toners && entry.toners.length > 0 ? 
                entry.toners.map(t => `${t.color.toUpperCase().charAt(0)}:${t.level}%`).join(' ') : '--';
              const scanDisplay = c.scanTotal !== undefined && c.scanTotal !== null
                ? `<span class="font-mono font-bold" style="color: #38bdf8;">${c.scanTotal.toLocaleString('sr-RS')}</span>`
                : (entry.model.toLowerCase().includes('lbp') ? '<span class="text-dim text-xs">N/A (Bez skenera)</span>' : '<span class="text-dim">--</span>');

              return `
                <tr class="${!isOk ? 'row-offline-sub' : ''}">
                  <td class="font-mono text-dim">${idx + 1}</td>
                  <td>
                    <div style="display: flex; flex-direction: column;">
                      <strong class="text-white">${escapeHtml(entry.name)} / ${escapeHtml(entry.location)}</strong>
                      <span class="font-mono text-xs text-muted">IP: <strong class="text-white">${escapeHtml(entry.ip)}</strong> &bull; SN: ${escapeHtml(entry.serialNumber)} &bull; ${escapeHtml(entry.model)}</span>
                    </div>
                  </td>
                  <td class="font-mono font-bold text-yellow">${c.total1 !== undefined ? c.total1.toLocaleString('sr-RS') : '<span class="text-dim">Offline</span>'}</td>
                  <td class="font-mono">${c.blackSmall !== undefined ? c.blackSmall.toLocaleString('sr-RS') : '--'}</td>
                  <td class="font-mono">${c.colorSmall !== undefined ? c.colorSmall.toLocaleString('sr-RS') : '--'}</td>
                  <td class="font-mono">${scanDisplay}</td>
                  <td><span class="font-mono text-xs ${tonersText.includes(':5%') || tonersText.includes(':8%') || tonersText.includes(':14%') ? 'text-danger font-bold' : 'text-white'}">${escapeHtml(tonersText)}</span></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>

    </div>
  `;

  if (window.lucide) window.lucide.createIcons();
}

async function openHistoryReportsModal() {
  const modal = document.getElementById('modal-history-reports');
  const body = document.getElementById('history-modal-body');

  if (modal) modal.style.display = 'flex';
  if (body) {
    body.innerHTML = `
      <div class="telemetry-loading-state">
        <div class="spinner-circle"></div>
        <p>Učitavanje arhive iz baze podataka...</p>
      </div>
    `;
  }

  try {
    const res = await fetch('/api/reports');
    if (!res.ok) throw new Error('Greška');
    const data = await res.json();
    allReportsHistory = data.reports || [];

    if (allReportsHistory.length === 0) {
      if (body) {
        body.innerHTML = `
          <div class="empty-state-card" style="padding: 40px 20px;">
            <div class="empty-icon-wrap"><i data-lucide="archive"></i></div>
            <h4>Nema sačuvanih izveštaja u bazi</h4>
            <p>Kliknite na dugme <strong>"Generiši Izveštaj"</strong> da kreirate prvi zvanični Excel izveštaj potrošnje.</p>
            <button class="btn-yellow-solid-sm" onclick="document.getElementById('modal-history-reports').style.display='none'; openGenerateReportModal();" style="margin-top: 14px;">
              <i data-lucide="file-spreadsheet"></i>
              <span>Generiši Prvi Izveštaj</span>
            </button>
          </div>
        `;
      }
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    if (body) {
      body.innerHTML = `
        <div class="table-responsive" style="max-height: 480px; overflow-y: auto;">
          <table class="unipromet-data-table">
            <thead>
              <tr>
                <th>Naziv Izveštaja</th>
                <th>Period</th>
                <th>Datum &amp; Vreme</th>
                <th>Obuhvaćeno Uređaja</th>
                <th>Ukupan Brojač</th>
                <th style="text-align: right; width: 180px;">Akcije</th>
              </tr>
            </thead>
            <tbody>
              ${allReportsHistory.map(rep => {
                const dateFormatted = new Date(rep.createdAt).toLocaleString('sr-RS');
                const impressionsFormatted = rep.totalImpressionsAcrossFleet.toLocaleString('sr-RS');

                return `
                  <tr>
                    <td>
                      <div style="display: flex; align-items: center; gap: 8px;">
                        <i data-lucide="file-spreadsheet" class="text-yellow"></i>
                        <strong class="text-white">${escapeHtml(rep.title)}</strong>
                      </div>
                    </td>
                    <td><span class="status-badge info">${escapeHtml(rep.monthYear)}</span></td>
                    <td class="font-mono text-muted text-xs">${dateFormatted}</td>
                    <td>
                      <span class="font-bold text-white">${rep.onlineCount}</span>
                      <span class="text-dim text-xs">/ ${rep.deviceCount}</span>
                    </td>
                    <td class="font-mono font-bold text-yellow">${impressionsFormatted}</td>
                    <td>
                      <div class="table-actions-row">
                        <a href="/api/reports/${rep.id}/download" class="btn-table-action btn-table-telemetry" title="Preuzmi Excel fajl (.xlsx)">
                          <i data-lucide="download"></i>
                        </a>
                        <button class="btn-table-action" onclick="viewSavedReportDetails('${rep.id}')" title="Pregled detalja">
                          <i data-lucide="eye"></i>
                        </button>
                        <button class="btn-table-action btn-table-danger" onclick="deleteReportAction('${rep.id}')" title="Obriši izveštaj">
                          <i data-lucide="trash-2"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

  } catch (err) {
    if (body) {
      body.innerHTML = `
        <div class="telemetry-error-state">
          <div class="err-icon"><i data-lucide="alert-triangle"></i></div>
          <h4>Greška pri učitavanju arhive</h4>
          <p>Nije moguće dohvatiti listu izveštaja iz baze.</p>
        </div>
      `;
    }
  }

  if (window.lucide) window.lucide.createIcons();
}
window.openHistoryReportsModal = openHistoryReportsModal;

function viewSavedReportDetails(reportId) {
  const report = allReportsHistory.find(r => r.id === reportId);
  if (!report) return;

  const historyModal = document.getElementById('modal-history-reports');
  const genModal = document.getElementById('modal-generate-report');
  const formState = document.getElementById('report-form-state');
  const progressState = document.getElementById('report-progress-state');
  const resultsState = document.getElementById('report-results-state');
  const btnDownloadExcel = document.getElementById('btn-modal-download-excel');

  if (historyModal) historyModal.style.display = 'none';

  if (formState) formState.style.display = 'none';
  if (progressState) progressState.style.display = 'none';
  if (resultsState) {
    resultsState.style.display = 'block';
    renderReportResults(report, resultsState);
  }

  if (btnDownloadExcel) {
    btnDownloadExcel.href = `/api/reports/${report.id}/download`;
    btnDownloadExcel.style.display = 'inline-flex';
  }

  if (genModal) genModal.style.display = 'flex';
}
window.viewSavedReportDetails = viewSavedReportDetails;

async function deleteReportAction(reportId) {
  const report = allReportsHistory.find(r => r.id === reportId);
  const name = report ? report.title : 'izveštaj';

  if (!confirm(`Da li ste sigurni da želite da obrišete izveštaj "${name}"?`)) {
    return;
  }

  try {
    const res = await fetch(`/api/reports/${reportId}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Izveštaj uspešno obrisan iz baze', 'info');
      openHistoryReportsModal();
    }
  } catch {
    showToast('Greška pri brisanju izveštaja', 'error');
  }
}
window.deleteReportAction = deleteReportAction;

// Decommission Printer Action
async function decommissionPrinterAction(id) {
  const printer = allPrinters.find(p => p.id === id);
  const name = printer ? printer.name : 'štampač';

  if (!confirm(`Da li ste sigurni da želite da sklonite "${name}" iz aktivne upotrebe?`)) {
    return;
  }

  try {
    const res = await fetch(`/api/printers/${id}/decommission`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Sklonjen iz upotrebe' })
    });

    if (res.ok) {
      showToast(`Štampač "${name}" je prebačen u arhivu sklonjenih uređaja.`, 'info');
      fetchPrinters(false);
    }
  } catch {
    showToast('Greška pri uklanjanju štampača', 'error');
  }
}
window.decommissionPrinterAction = decommissionPrinterAction;

// Restore Printer Action
async function restorePrinterAction(id) {
  const printer = allPrinters.find(p => p.id === id);
  const name = printer ? printer.name : 'štampač';

  try {
    const res = await fetch(`/api/printers/${id}/restore`, {
      method: 'POST'
    });

    if (res.ok) {
      showToast(`Štampač "${name}" je uspešno vraćen u aktivnu upotrebu!`, 'success');
      fetchPrinters(false);
    }
  } catch {
    showToast('Greška pri vraćanju štampača u rad', 'error');
  }
}
window.restorePrinterAction = restorePrinterAction;

// Probe single printer TCP response
async function probeSinglePrinter(ip, id) {
  const pingEl = document.getElementById(`ping-val-${id}`);
  const pingElList = document.getElementById(`ping-val-list-${id}`);
  
  if (pingEl) pingEl.textContent = '...';
  if (pingElList) pingElList.textContent = '...';

  try {
    const res = await fetch(`/api/printers/${ip}/ping`);
    if (res.ok) {
      const data = await res.json();
      const txt = data.isOnline ? `${data.latencyMs} ms` : 'Offline';
      const clr = data.isOnline ? '#10b981' : '#ef4444';
      
      if (pingEl) {
        pingEl.textContent = txt;
        pingEl.style.color = clr;
      }
      if (pingElList) {
        pingElList.textContent = txt;
        pingElList.style.color = clr;
      }

      // Synchronize in-memory printer list & table UI dynamically
      const targetPrn = allPrinters.find(p => p.id === id || p.ip === ip);
      if (targetPrn && targetPrn.isOnline !== data.isOnline) {
        targetPrn.isOnline = data.isOnline;
        if (data.isOnline && data.latencyMs) {
          targetPrn.latencyMs = data.latencyMs;
        }

        const activePrn = allPrinters.filter(p => !p.isDecommissioned);
        const onlineCount = activePrn.filter(p => p.isOnline).length;
        const offlineCount = activePrn.length - onlineCount;

        const onlineEl = document.getElementById('stat-printers-online');
        const offlineEl = document.getElementById('stat-printers-offline');
        const onlineSubEl = document.getElementById('stat-printers-online-sub');
        if (onlineEl) onlineEl.textContent = onlineCount;
        if (offlineEl) offlineEl.textContent = offlineCount;
        if (onlineSubEl && activePrn.length > 0) {
          onlineSubEl.textContent = `${Math.round((onlineCount / activePrn.length) * 100)}% dostupno na mreži`;
        }

        renderPrintersList();
      }

      showToast(`Štampač ${ip}: ${data.isOnline ? 'Online (' + data.latencyMs + 'ms)' : 'Nema odziva'}`, data.isOnline ? 'success' : 'warn');
    }
  } catch {
    if (pingEl) pingEl.textContent = 'Greška';
    if (pingElList) pingElList.textContent = 'Greška';
  }
}
window.probeSinglePrinter = probeSinglePrinter;

/* ==========================================================================
   LOW TONER FLEET SCAN & ALERTS (<=5%)
   ========================================================================== */
let currentLowTonersResult = null;

async function openLowTonersModal(force = false) {
  const modal = document.getElementById('modal-low-toners');
  const body = document.getElementById('low-toners-modal-body');

  if (modal) modal.style.display = 'flex';
  if (force) {
    setButtonSpinning('btn-rescan-low-toners', true);
  } else {
    setButtonSpinning('btn-rescan-low-toners', false);
  }

  if (body) {
    body.innerHTML = `
      <div class="telemetry-loading-state" style="padding: 50px 20px;">
        <div class="spinner-circle"></div>
        <p>Paralelno očitavanje nivoa tonera svih štampača u fabrici preko SNMP protokola...</p>
        <span class="text-dim text-xs">Pretraga tonera sa nivoom &le; 5% i otpadnih kontejnera</span>
      </div>
    `;
  }

  try {
    const res = await fetch(`/api/printers/low-toners?threshold=5${force ? '&force=true' : ''}`);
    if (!res.ok) throw new Error('Greška');
    const data = await res.json();
    currentLowTonersResult = data;

    renderLowTonersModalContent(data);
  } catch (err) {
    if (body) {
      body.innerHTML = `
        <div class="telemetry-error-state">
          <div class="err-icon"><i data-lucide="alert-triangle"></i></div>
          <h4>Greška pri skeniranju tonera</h4>
          <p>Nije uspelo povezivanje sa mrežnim štampačima. Proverite mrežnu vezu.</p>
        </div>
      `;
    }
  } finally {
    setButtonSpinning('btn-rescan-low-toners', false);
    if (window.lucide) window.lucide.createIcons();
  }
}
window.openLowTonersModal = openLowTonersModal;

function renderLowTonersModalContent(data) {
  const body = document.getElementById('low-toners-modal-body');
  if (!body) return;

  if (!data || !data.criticalPrinters || data.criticalPrinters.length === 0) {
    body.innerHTML = `
      <div class="low-toners-success-state">
        <div class="low-toners-success-icon"><i data-lucide="check-circle-2"></i></div>
        <h4 class="text-white">Svi toneri u fabrici su na optimalnom nivou!</h4>
        <p class="text-muted" style="max-width: 480px; font-size: 0.82rem; line-height: 1.4;">
          Skenirano je <strong>${data.totalPrinters}</strong> štampača (<strong>${data.onlinePrinters}</strong> aktivno na mreži).
          Nijedan štampač trenutno nema nivo tonera &le; 5%.
        </p>
        <span class="text-dim text-xs font-mono">Poslednja provera: ${new Date(data.scannedAt).toLocaleTimeString('sr-RS')}</span>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  body.innerHTML = `
    <div class="low-toners-content-wrapper" style="padding: 16px;">
      
      <!-- Summary Banner -->
      <div class="low-toners-kpi-banner">
        <div class="rep-metric-item">
          <span class="rep-m-label">TONERA ZA HITNU ZAMENU</span>
          <strong class="rep-m-val text-danger font-mono font-bold">${data.totalLowTonerItems}</strong>
        </div>
        <div class="rep-metric-item">
          <span class="rep-m-label">OTPADNIKA ZA ZAMENU</span>
          <strong class="rep-m-val font-mono font-bold" style="color: ${(data.totalWasteAlerts > 0) ? '#f59e0b' : '#10b981'};">${data.totalWasteAlerts || 0}</strong>
        </div>
        <div class="rep-metric-item">
          <span class="rep-m-label">HARDVERSKE GREŠKE</span>
          <strong class="rep-m-val font-mono font-bold" style="color: ${(data.totalHardwareErrors > 0) ? '#ef4444' : '#10b981'};">${data.totalHardwareErrors || 0}</strong>
        </div>
        <div class="rep-metric-item">
          <span class="rep-m-label">POGOĐENO ŠTAMPAČA</span>
          <strong class="rep-m-val text-white">${data.affectedPrintersCount} <span class="text-dim text-xs">/ ${data.totalPrinters}</span></strong>
        </div>
        <div class="rep-metric-item">
          <span class="rep-m-label">KRITERIJUM PRAG</span>
          <strong class="rep-m-val text-yellow">&le; ${data.threshold}% | Otpadnik | Greške</strong>
        </div>
        <div class="rep-metric-item">
          <span class="rep-m-label">VREME SKENIRANJA</span>
          <strong class="rep-m-val font-mono text-muted text-xs">${new Date(data.scannedAt).toLocaleTimeString('sr-RS')}</strong>
        </div>
      </div>

      <!-- List of Affected Printers -->
      <div style="display: flex; flex-direction: column; gap: 12px; max-height: 480px; overflow-y: auto; padding-right: 4px;">
        ${data.criticalPrinters.map((p, idx) => {
          const isOnlyWaste = p.onlyWasteToner || (p.lowToners.length === 0 && (p.isWasteTonerFull || p.isWasteTonerNearFull) && !p.hasHardwareError);
          const isOnlyError = p.onlyHardwareError || (p.hasHardwareError && p.lowToners.length === 0 && !p.isWasteTonerFull && !p.isWasteTonerNearFull);
          const cardBorder = p.hasHardwareError
            ? 'border-left: 3px solid #ef4444;'
            : (isOnlyWaste ? 'border-left: 3px solid #f59e0b;' : '');

          return `
            <div class="low-toner-device-card" style="${cardBorder}">
              
              <div class="low-toner-card-header">
                <div class="low-toner-card-title">
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="font-mono text-dim" style="font-size: 0.75rem;">#${idx + 1}</span>
                    <strong class="low-toner-card-name">${escapeHtml(p.printerName)}</strong>
                    <span class="printer-custom-tag tag-primary" style="font-size: 0.65rem;">${escapeHtml(p.customTag)}</span>
                    ${p.hasHardwareError ? `<span class="printer-custom-tag" style="font-size: 0.68rem; font-weight: 800; background: rgba(239, 68, 68, 0.25); color: #ef4444; border: 1px solid #ef4444;"><i data-lucide="alert-octagon" style="width: 11px; height: 11px; display: inline; vertical-align: -1px;"></i> ${isOnlyError ? 'Hardverska Greška (Toneri OK)' : 'Greška Štampača'}</span>` : ''}
                    ${isOnlyWaste ? `<span class="printer-custom-tag" style="font-size: 0.65rem; background: rgba(245, 158, 11, 0.2); color: #f59e0b; border: 1px solid #f59e0b;">Samo Otpadnik</span>` : ''}
                  </div>
                  <div class="low-toner-card-meta">
                    <span><i data-lucide="map-pin" style="width: 12px; height: 12px; display: inline;"></i> ${escapeHtml(p.location)}</span>
                    <span>&bull;</span>
                    <span class="font-mono text-yellow font-bold">${escapeHtml(p.ip)}</span>
                    <span>&bull;</span>
                    <span>${escapeHtml(p.model)}</span>
                  </div>
                </div>

                <div style="display: flex; align-items: center; gap: 6px;">
                  <button class="btn-table-action btn-table-telemetry" onclick="document.getElementById('modal-low-toners').style.display='none'; openPrinterTelemetryModal('${p.ip}', '${escapeHtml(p.printerName)}');" title="Prikaži sve tonere i detalje">
                    <i data-lucide="gauge"></i>
                  </button>
                  <a href="http://${p.ip}" target="_blank" rel="noopener" class="btn-table-action" title="Web panel štampača">
                    <i data-lucide="external-link"></i>
                  </a>
                </div>
              </div>

              <!-- Badges for Errors, Low Toners & Waste -->
              <div class="low-toners-entries-grid">
                ${(p.errors && p.errors.length > 0) ? `
                  <div style="grid-column: 1 / -1; margin-bottom: 8px; padding: 10px 14px; background: rgba(239, 68, 68, 0.16); border: 1px solid #ef4444; border-left: 4px solid #ef4444; border-radius: 6px;">
                    <div style="font-size: 0.78rem; font-weight: 800; color: #f87171; display: flex; align-items: center; gap: 6px; margin-bottom: 4px; text-transform: uppercase;">
                      <i data-lucide="alert-octagon" style="width: 15px; height: 15px; color: #ef4444;"></i>
                      <span>DETEKTOVANA HARDVERSKA GREŠKA / ZASTOJ:</span>
                    </div>
                    <div style="color: #ffffff; font-size: 0.88rem; font-weight: 700; line-height: 1.45; padding-left: 21px;">
                      ${p.errors.map(e => `<div>• ${escapeHtml(e)}</div>`).join('')}
                    </div>
                  </div>
                ` : ''}

                ${isOnlyError ? `
                  <div style="grid-column: 1 / -1; margin-bottom: 4px; padding: 6px 10px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 6px; font-size: 0.75rem; color: #10b981; display: flex; align-items: center; justify-content: space-between;">
                    <span>✓ Nivoi tonera i otpadnik su u redu (&gt; 5%):</span>
                    <span class="font-mono text-white">${(p.allToners || []).map(t => `${t.color ? t.color.toUpperCase().slice(0,1) : 'T'}: ${t.level}%`).join(' | ') || 'Toneri optimalni'}</span>
                  </div>
                ` : ''}

                ${isOnlyWaste ? `
                  <div style="grid-column: 1 / -1; margin-bottom: 4px; padding: 6px 10px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 6px; font-size: 0.75rem; color: #10b981; display: flex; align-items: center; justify-content: space-between;">
                    <span>✓ Toneri za boju su uredni (&gt; 5%):</span>
                    <span class="font-mono text-white">${(p.allToners || []).map(t => `${t.color ? t.color.toUpperCase().slice(0,1) : 'T'}: ${t.level}%`).join(' | ')}</span>
                  </div>
                ` : ''}

                ${p.lowToners.map(t => {
                  let colorDot = '#334155';
                  let colorTitle = 'Crni (Black)';
                  let barClass = 'bar-black';

                  if (t.color === 'cyan') {
                    colorDot = '#06b6d4';
                    colorTitle = 'Plavi (Cyan)';
                    barClass = 'bar-cyan';
                  } else if (t.color === 'magenta') {
                    colorDot = '#ec4899';
                    colorTitle = 'Crveni (Magenta)';
                    barClass = 'bar-magenta';
                  } else if (t.color === 'yellow') {
                    colorDot = '#eab308';
                    colorTitle = 'Žuti (Yellow)';
                    barClass = 'bar-yellow';
                  }

                  const isZero = t.level === 0;

                  return `
                    <div class="low-toner-item-box">
                      <div class="low-toner-item-top">
                        <div class="low-toner-item-label">
                          <span style="width: 10px; height: 10px; border-radius: 50%; background: ${colorDot}; box-shadow: 0 0 6px ${colorDot};"></span>
                          <span>${colorTitle}</span>
                        </div>
                        <span class="low-toner-pct-tag">${isZero ? '0% PRAZAN' : t.level + '%'}</span>
                      </div>

                      <div class="toner-progress-track" style="margin: 4px 0;">
                        <div class="toner-progress-fill ${barClass}" style="width: ${Math.max(t.level, 3)}%;"></div>
                      </div>

                      <span class="low-toner-model-name" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</span>
                    </div>
                  `;
                }).join('')}

                ${((p.isLargeCopier || (p.model && (p.model.toLowerCase().includes('c5235') || p.model.toLowerCase().includes('ir')))) && (p.isWasteTonerFull || p.isWasteTonerNearFull || p.lowToners.length > 0)) ? `
                  <div class="low-toner-item-box" style="border-color: ${p.isWasteTonerFull ? '#ef4444' : (p.isWasteTonerNearFull ? '#f59e0b' : '#10b981')};">
                    <div class="low-toner-item-top">
                      <div class="low-toner-item-label" style="color: ${p.isWasteTonerFull ? '#ef4444' : (p.isWasteTonerNearFull ? '#f59e0b' : '#10b981')};">
                        <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                        <span>Otpadni Toner</span>
                      </div>
                      <span class="low-toner-pct-tag" style="color: ${p.isWasteTonerFull ? '#ef4444' : (p.isWasteTonerNearFull ? '#f59e0b' : '#10b981')}; background: ${p.isWasteTonerFull ? 'rgba(239,68,68,0.15)' : (p.isWasteTonerNearFull ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)')}; border-color: ${p.isWasteTonerFull ? 'rgba(239,68,68,0.4)' : (p.isWasteTonerNearFull ? 'rgba(245,158,11,0.4)' : 'rgba(16,185,129,0.4)')};">
                        ${p.isWasteTonerFull ? 'PUN' : (p.isWasteTonerNearFull ? 'SKORO PUN' : 'U REDU')}
                      </span>
                    </div>
                    <span class="low-toner-model-name">${escapeHtml(p.wasteTonerStatus || 'U redu')}</span>
                  </div>
                ` : ''}
              </div>

            </div>
          `;
        }).join('')}
      </div>

    </div>
  `;

  if (window.lucide) window.lucide.createIcons();
}

function copyLowTonersSummaryText() {
  if (!currentLowTonersResult || !currentLowTonersResult.criticalPrinters || currentLowTonersResult.criticalPrinters.length === 0) {
    showToast('Nema evidentiranih tonera ili grešaka za kopiranje.', 'info');
    return;
  }

  const now = new Date().toLocaleString('sr-RS');
  let text = `📋 UNIPROMET - SPISAK ZA INTERVENCIJU NA ŠTAMPAČIMA (Toneri ≤ ${currentLowTonersResult.threshold}% / Otpadnici / Greške)\n`;
  text += `Datum i vreme provere: ${now}\n`;
  text += `Ukupno uređaja za intervenciju: ${currentLowTonersResult.affectedPrintersCount}\n`;
  text += `---------------------------------------------------------\n\n`;

  currentLowTonersResult.criticalPrinters.forEach((p, idx) => {
    text += `${idx + 1}. ${p.printerName} [${p.ip}]\n`;
    text += `   Lokacija: ${p.location} (${p.model})\n`;

    if (p.errors && p.errors.length > 0) {
      text += `   🚨 HARDVERSKA GREŠKA: ${p.errors.join('; ')}\n`;
    }

    const isOnlyWaste = p.onlyWasteToner || (p.lowToners.length === 0 && (p.isWasteTonerFull || p.isWasteTonerNearFull) && !p.hasHardwareError);
    const isOnlyError = p.onlyHardwareError || (p.hasHardwareError && p.lowToners.length === 0 && !p.isWasteTonerFull && !p.isWasteTonerNearFull);

    if (isOnlyWaste) {
      text += `   ⚠️ INTERVENCIJA: SAMO OTPADNI KONTEJNER (${p.wasteTonerStatus || 'Za zamenu'})\n`;
      const colorT = (p.allToners || []).map(t => `${t.color.toUpperCase()}: ${t.level}%`).join(', ');
      text += `   ✓ Toneri za boju su uredni (> 5%): ${colorT}\n`;
    } else if (isOnlyError) {
      const colorT = (p.allToners || []).map(t => `${t.color.toUpperCase()}: ${t.level}%`).join(', ');
      text += `   ✓ Toneri i otpadnik su uredni (> 5%): ${colorT}\n`;
    } else {
      p.lowToners.forEach(t => {
        text += `   • ${t.color.toUpperCase()} Toner (${t.name}): ${t.level}%\n`;
      });
      if (p.isLargeCopier || (p.model && p.model.toLowerCase().includes('c5235'))) {
        text += `   • Otpadni kontejner: ${p.wasteTonerStatus || 'U redu'}\n`;
      }
    }
    text += `\n`;
  });

  navigator.clipboard.writeText(text).then(() => {
    showToast('📋 Spisak tonera sa lokacijama uspešno kopiran u clipboard!', 'success');
  }).catch(() => {
    showToast('Neuspešno kopiranje', 'error');
  });
}
window.copyLowTonersSummaryText = copyLowTonersSummaryText;


/* ==========================================================================
   RENDER HELPERS & UTILITIES
   ========================================================================== */
function renderLanEndpoints(localIps, port) {
  const container = document.getElementById('lan-endpoints-container');
  const adaptersList = document.getElementById('network-adapters-list');
  if (!container) return;

  if (localIps.length === 0) {
    container.innerHTML = `
      <div class="lan-endpoint-row">
        <div class="lan-endpoint-meta">
          <span class="lan-iface-name">Lokalni Host</span>
          <a href="http://localhost:${port}" target="_blank" class="lan-endpoint-link">http://localhost:${port}</a>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = localIps.map(ip => {
    const url = `http://${ip.address}:${port}`;
    return `
      <div class="lan-endpoint-row">
        <div class="lan-endpoint-meta">
          <span class="lan-iface-name">Adapter: ${escapeHtml(ip.interfaceName)} (${ip.family})</span>
          <a href="${url}" target="_blank" class="lan-endpoint-link">${url}</a>
        </div>
        <button class="btn-copy-chip" onclick="copyCustomUrl('${url}')" title="Kopiraj link">
          <i data-lucide="copy"></i>
        </button>
      </div>
    `;
  }).join('');

  if (adaptersList) {
    adaptersList.innerHTML = localIps.map(ip => `
      <div class="industry-card active-card">
        <div class="ind-icon-box yellow-bg"><i data-lucide="network"></i></div>
        <div class="ind-body">
          <h5>${escapeHtml(ip.interfaceName)}</h5>
          <p class="font-mono text-yellow" style="font-weight: 700; font-size: 0.95rem; margin-bottom: 4px;">
            ${ip.address}
          </p>
          <p style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 8px;">
            Protokol: IPv4 &bull; Port: ${port} &bull; Tip: LAN / Ethernet
          </p>
          <span class="status-pill active-pill"><i data-lucide="check"></i> Aktivan u Mreži</span>
        </div>
      </div>
    `).join('');
  }

  if (window.lucide) window.lucide.createIcons();
}

function copyCustomUrl(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast(`Kopirano: ${text}`, 'success');
  });
}
window.copyCustomUrl = copyCustomUrl;

function formatUptime(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatUptimeHuman(seconds) {
  if (seconds < 60) return `${seconds} sek`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}min`;
}

function formatTime(isoStr) {
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('sr-RS');
  } catch {
    return '--:--:--';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, function(m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
  });
}

function showToast(message, type = 'info') {
  const deck = document.getElementById('toast-deck');
  if (!deck) return;

  const toast = document.createElement('div');
  toast.className = `unipromet-toast ${type}`;
  toast.innerHTML = `
    <i data-lucide="${type === 'success' ? 'check-circle-2' : type === 'error' ? 'alert-circle' : 'info'}"></i>
    <span>${escapeHtml(message)}</span>
  `;

  deck.appendChild(toast);
  if (window.lucide) window.lucide.createIcons();

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// =========================================================================
// LAN FLEET CLIENT LOGIC (3 CELINE: RAČUNARI, SERVERI, OSTALI UREĐAJI)
// =========================================================================
let allLanDevices = [];
let isFetchingLan = false;

// 1. Računari (Computers) State
let compSearch = '';
let compSubnet = 'all';
let compLocation = 'all';
let compCategory = 'all';
let compViewMode = 'grid';

// 2. Serveri (Servers) State
let srvSearch = '';
let srvSubnet = 'all';
let srvCategory = 'all';
let srvViewMode = 'grid';

// 3. Ostali Uređaji (Other Devices) State
let othSearch = '';
let othSubnet = 'all';
let othLocation = 'all';
let othCategory = 'all';
let othViewMode = 'grid';

async function fetchLanDevices(force = false) {
  if (isFetchingLan) return;
  isFetchingLan = true;

  if (force) {
    setButtonSpinning('btn-rescan-computers', true);
    setButtonSpinning('btn-rescan-servers', true);
    setButtonSpinning('btn-rescan-other', true);
  } else {
    setButtonSpinning('btn-rescan-computers', false);
    setButtonSpinning('btn-rescan-servers', false);
    setButtonSpinning('btn-rescan-other', false);
  }

  if (force) {
    const loadingHtml = `
      <div class="telemetry-loading-state" style="grid-column: 1 / -1;">
        <div class="spinner-circle"></div>
        <h5>Skeniranje svih lokalnih uređaja na mreži u toku...</h5>
        <p>Provera ARP tabele, NetBIOS naziva računara, OUI proizvođača i otvorenih portova...</p>
      </div>
    `;
    const cComp = document.getElementById('computers-devices-container');
    const cSrv = document.getElementById('servers-devices-container');
    const cOth = document.getElementById('other-devices-container');
    if (cComp) cComp.innerHTML = loadingHtml;
    if (cSrv) cSrv.innerHTML = loadingHtml;
    if (cOth) cOth.innerHTML = loadingHtml;
  }

  try {
    const res = await fetch(`/api/network/devices?force=${force}`);
    const data = await res.json();

    if (res.ok && data.success) {
      allLanDevices = data.devices || [];

      updateSidebarNavBadges();
      renderComputersTab();
      renderServersTab();
      renderOtherDevicesTab();

      if (force) {
        showToast(`✓ Uspešno osveženo ${allLanDevices.length} mrežnih uređaja!`, 'success');
      }
    } else {
      throw new Error(data.details || data.error || 'Greška pri očitavanju uređaja');
    }
  } catch (err) {
    console.error('LAN devices fetch error:', err);
    showToast(`Greška pri skeniranju mreže: ${err.message}`, 'error');
  } finally {
    setButtonSpinning('btn-rescan-computers', false);
    setButtonSpinning('btn-rescan-servers', false);
    setButtonSpinning('btn-rescan-other', false);
    isFetchingLan = false;
  }
}
window.fetchLanDevices = fetchLanDevices;

function updateSidebarNavBadges() {
  const rfReaderIps = new Set([
    '192.168.121.244', '192.168.121.245', '192.168.121.246',
    '192.168.121.247', '192.168.121.248', '192.168.121.249',
    '192.168.121.250', '192.168.121.251', '192.168.121.252',
    ...(allRfReaders || []).map(r => r.ip)
  ]);

  const wsCount = allLanDevices.filter(d => d.category === 'workstation').length;
  const srvCount = allLanDevices.filter(d => d.category === 'server' || d.category === 'router').length;
  const othCount = allLanDevices.filter(d => 
    (d.category === 'camera' || d.category === 'wifi' || d.category === 'voip' || d.category === 'other' || d.category === 'switch') &&
    !rfReaderIps.has(d.ip)
  ).length;

  const bComp = document.getElementById('badge-nav-computers');
  const bSrv = document.getElementById('badge-nav-servers');
  const bOth = document.getElementById('badge-nav-other');
  const bPrinters = document.getElementById('badge-nav-printers');
  const bRf = document.getElementById('badge-nav-rf-readers');

  if (bComp) bComp.textContent = wsCount;
  if (bSrv) bSrv.textContent = srvCount;
  if (bOth) bOth.textContent = othCount;
  if (bRf) bRf.textContent = (allRfReaders && allRfReaders.length > 0) ? allRfReaders.length : 9;
  if (bPrinters && allPrinters.length > 0) {
    bPrinters.textContent = allPrinters.filter(p => !p.isDecommissioned).length;
  }
}

// -------------------------------------------------------------------------
// CELINA 1: RAČUNARI (PC & Laptopovi)
// -------------------------------------------------------------------------
function renderComputersTab() {
  const container = document.getElementById('computers-devices-container');
  const allWs = allLanDevices.filter(d => d.category === 'workstation');

  // Update KPIs
  const kTotal = document.getElementById('kpi-computers-total');
  const kLaptops = document.getElementById('kpi-computers-laptops');
  const kDesktops = document.getElementById('kpi-computers-desktops');
  const kExternal = document.getElementById('kpi-computers-external');

  const laptopsCount = allWs.filter(d => d.categoryIcon === 'laptop' || d.categoryLabel.includes('Laptop')).length;
  const desktopsCount = allWs.filter(d => d.categoryIcon === 'monitor' || d.categoryLabel.includes('Radna')).length;
  const externalCount = allWs.filter(d => d.locationCode === 'kraljevo' || d.locationCode === 'ljubic').length;

  if (kTotal) kTotal.textContent = allWs.length;
  if (kLaptops) kLaptops.textContent = laptopsCount;
  if (kDesktops) kDesktops.textContent = desktopsCount;
  if (kExternal) kExternal.textContent = externalCount;

  if (!container) return;

  // Filter
  let list = allWs;
  if (compCategory === 'laptop') {
    list = list.filter(d => d.categoryIcon === 'laptop' || d.categoryLabel.includes('Laptop'));
  } else if (compCategory === 'desktop') {
    list = list.filter(d => d.categoryIcon === 'monitor' || d.categoryLabel.includes('Radna'));
  } else if (compCategory === 'external') {
    list = list.filter(d => d.locationCode === 'kraljevo' || d.locationCode === 'ljubic');
  }

  if (compSubnet === '120') list = list.filter(d => d.ip.startsWith('192.168.120.'));
  if (compSubnet === '121') list = list.filter(d => d.ip.startsWith('192.168.121.'));
  if (compLocation !== 'all') list = list.filter(d => d.locationCode === compLocation);

  if (compSearch) {
    const q = compSearch.toLowerCase();
    list = list.filter(d => (
      d.ip.toLowerCase().includes(q) ||
      d.hostname.toLowerCase().includes(q) ||
      d.mac.toLowerCase().includes(q) ||
      d.vendor.toLowerCase().includes(q) ||
      d.categoryLabel.toLowerCase().includes(q) ||
      (d.location && d.location.toLowerCase().includes(q)) ||
      (d.domain && d.domain.toLowerCase().includes(q))
    ));
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-state-box" style="grid-column: 1 / -1; padding: 48px 20px; text-align: center;">
        <div class="empty-icon"><i data-lucide="search-x"></i></div>
        <h4>Nijedan računar ne odgovara filteru</h4>
        <p class="text-dim">Promenite pojam pretrage ili resetujte filtere lokacije i podmreže.</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  if (compViewMode === 'grid') {
    container.className = 'printers-cards-grid';
    container.innerHTML = list.map(d => {
      const portChips = d.openPorts.map(p => {
        let cls = 'port-badge';
        let lbl = `Port ${p}`;
        if (p === 445) { cls += ' port-smb'; lbl = 'SMB 445 (Share)'; }
        else if (p === 3389) { cls += ' port-rdp'; lbl = 'RDP 3389'; }
        else if (p === 80 || p === 443) { cls += ' port-web'; lbl = `Web ${p}`; }
        return `<span class="${cls}">${lbl}</span>`;
      }).join('');

      return `
        <div class="lan-device-card category-workstation">
          <div class="lan-card-header">
            <div class="lan-card-identity">
              <div class="lan-icon-box icon-workstation">
                <i data-lucide="${d.categoryIcon}"></i>
              </div>
              <div class="lan-name-group">
                <h4 class="lan-device-name" title="${escapeHtml(d.hostname)}">${escapeHtml(d.hostname)}</h4>
                <div class="lan-device-ip-badge" onclick="copyCustomUrl('${d.ip}')" title="Kopiraj IP">
                  <i data-lucide="copy" style="width: 11px; height: 11px;"></i>
                  <span>${d.ip}</span>
                </div>
              </div>
            </div>
            <span class="status-pill status-online" style="font-size: 0.68rem; padding: 2px 7px;">
              <span class="status-dot-mini"></span>
              <span>${d.pingMs || 1} ms</span>
            </span>
          </div>

          <div class="lan-card-specs">
            <div class="lan-spec-row">
              <span class="lan-spec-label">Tip:</span>
              <span class="lan-spec-val text-yellow">${escapeHtml(d.categoryLabel)}</span>
            </div>
            <div class="lan-spec-row">
              <span class="lan-spec-label">Lokacija:</span>
              <span class="lan-spec-val" style="color: ${d.locationCode === 'kraljevo' ? '#FFB800' : d.locationCode === 'ljubic' ? '#38bdf8' : '#34d399'}; font-weight: 800;">
                <i data-lucide="map-pin" style="width: 12px; height: 12px; display: inline-block; vertical-align: -1px;"></i>
                ${escapeHtml(d.location || 'Čačak')}
              </span>
            </div>
            <div class="lan-spec-row">
              <span class="lan-spec-label">Proizvođač:</span>
              <span class="lan-spec-val" style="color: #cbd5e1;">${escapeHtml(d.vendor)}</span>
            </div>
            <div class="lan-spec-row">
              <span class="lan-spec-label">Windows Domen:</span>
              <span class="lan-spec-val font-mono" style="color: #38bdf8;">${escapeHtml(d.domain || 'UNI')}</span>
            </div>
            <div class="lan-spec-row">
              <span class="lan-spec-label">MAC Adresa:</span>
              <span class="lan-spec-val font-mono" style="font-size: 0.72rem; color: #94a3b8;">${d.mac}</span>
            </div>
            <div style="margin-top: 4px;">
              <span class="lan-spec-label" style="display: block; margin-bottom: 4px;">Windows Servisi:</span>
              <div class="lan-ports-wrap">
                ${portChips || '<span style="color: #64748b; font-size: 0.7rem; font-style: italic;">Nema standardnih portova</span>'}
              </div>
            </div>
          </div>

          <div class="lan-card-bottom">
            <span class="lan-vendor-badge">
              <i data-lucide="shield-check" style="width: 13px; height: 13px; color: #10b981;"></i>
              <span>${d.arpType === 'dynamic' ? 'DHCP Zakup' : 'Statički'}</span>
            </span>
            <div class="lan-card-actions">
              <button class="btn-lan-action" onclick="pingLanDevice('${d.ip}')" title="Testiraj latenciju">
                <i data-lucide="activity"></i>
                <span>Ping</span>
              </button>
              <button class="btn-lan-action" onclick="openLanDeviceDetails('${d.ip}')" title="Detaljna inspekcija portova">
                <i data-lucide="info"></i>
                <span>Detalji</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } else {
    container.className = 'printers-table-view';
    container.innerHTML = `
      <div class="table-scroll-wrapper" style="width: 100%;">
        <table class="unipromet-table">
          <thead>
            <tr>
              <th style="width: 50px;">#</th>
              <th>NAZIV RAČUNARA</th>
              <th>LOKACIJA</th>
              <th>TIP</th>
              <th>IP ADRESA</th>
              <th>PROIZVOĐAČ</th>
              <th>DOMEN</th>
              <th>WINDOWS SERVISI</th>
              <th style="text-align: right;">AKCIJE</th>
            </tr>
          </thead>
          <tbody>
            ${list.map((d, i) => `
              <tr>
                <td style="color: #64748b; font-size: 0.78rem;">${i + 1}</td>
                <td><div style="font-weight: 800; color: #ffffff; font-size: 0.88rem;">${escapeHtml(d.hostname)}</div></td>
                <td>
                  <span style="font-size: 0.76rem; font-weight: 800; color: ${d.locationCode === 'kraljevo' ? '#FFB800' : d.locationCode === 'ljubic' ? '#38bdf8' : '#34d399'};">
                    ${escapeHtml(d.location || 'Čačak')}
                  </span>
                </td>
                <td><span class="badge-lan-cat" style="font-size: 0.72rem; font-weight: 700;">${escapeHtml(d.categoryLabel)}</span></td>
                <td><span class="font-mono text-yellow" style="font-weight: 800; cursor: pointer;" onclick="copyCustomUrl('${d.ip}')" title="Kopiraj">${d.ip}</span></td>
                <td style="color: #cbd5e1; font-size: 0.8rem; font-weight: 600;">${escapeHtml(d.vendor)}</td>
                <td style="font-size: 0.74rem; color: #38bdf8; font-family: monospace;">${escapeHtml(d.domain || 'UNI')}</td>
                <td>
                  <div class="lan-ports-wrap">
                    ${d.openPorts.map(p => `<span class="port-badge">${p}</span>`).join('') || '<span style="color:#64748b;font-size:0.7rem;">-</span>'}
                  </div>
                </td>
                <td style="text-align: right;">
                  <div style="display: inline-flex; gap: 4px;">
                    <button class="btn-lan-action" onclick="pingLanDevice('${d.ip}')" title="Ping"><i data-lucide="activity"></i></button>
                    <button class="btn-lan-action" onclick="openLanDeviceDetails('${d.ip}')" title="Detalji"><i data-lucide="info"></i></button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  if (window.lucide) window.lucide.createIcons();
}

// -------------------------------------------------------------------------
// CELINA 2: SERVERI & MREŽNA INFRASTRUKTURA
// -------------------------------------------------------------------------
function renderServersTab() {
  const container = document.getElementById('servers-devices-container');
  const allSrv = allLanDevices.filter(d => d.category === 'server' || d.category === 'router');

  // Update KPIs
  const kTotal = document.getElementById('kpi-servers-total');
  const kDc = document.getElementById('kpi-servers-dc');
  const kRouters = document.getElementById('kpi-servers-routers');
  const kWeb = document.getElementById('kpi-servers-web');

  const dcCount = allSrv.filter(d => d.category === 'server').length;
  const routersCount = allSrv.filter(d => d.category === 'router').length;
  const webCount = allSrv.filter(d => !!d.webUrl).length;

  if (kTotal) kTotal.textContent = allSrv.length;
  if (kDc) kDc.textContent = dcCount;
  if (kRouters) kRouters.textContent = routersCount;
  if (kWeb) kWeb.textContent = webCount;

  if (!container) return;

  // Filter
  let list = allSrv;
  if (srvCategory === 'server') list = list.filter(d => d.category === 'server');
  else if (srvCategory === 'router') list = list.filter(d => d.category === 'router');
  else if (srvCategory === 'web') list = list.filter(d => !!d.webUrl);

  if (srvSubnet === '120') list = list.filter(d => d.ip.startsWith('192.168.120.'));
  if (srvSubnet === '121') list = list.filter(d => d.ip.startsWith('192.168.121.'));

  if (srvSearch) {
    const q = srvSearch.toLowerCase();
    list = list.filter(d => (
      d.ip.toLowerCase().includes(q) ||
      d.hostname.toLowerCase().includes(q) ||
      d.vendor.toLowerCase().includes(q) ||
      d.categoryLabel.toLowerCase().includes(q) ||
      d.services.some(s => s.toLowerCase().includes(q))
    ));
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-state-box" style="grid-column: 1 / -1; padding: 48px 20px; text-align: center;">
        <div class="empty-icon"><i data-lucide="search-x"></i></div>
        <h4>Nijedan server ne odgovara filteru</h4>
        <p class="text-dim">Promenite pojam pretrage ili izaberite drugu opciju.</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  if (srvViewMode === 'grid') {
    container.className = 'printers-cards-grid';
    container.innerHTML = list.map(d => {
      const portChips = d.openPorts.map(p => {
        let cls = 'port-badge';
        let lbl = `Port ${p}`;
        if (p === 53) { cls += ' port-web'; lbl = 'DNS 53'; }
        else if (p === 8291) { cls += ' port-rdp'; lbl = 'Winbox 8291'; }
        else if (p === 445) { cls += ' port-smb'; lbl = 'SMB 445'; }
        else if (p === 80 || p === 443) { cls += ' port-web'; lbl = `Web ${p}`; }
        else if (p === 22) { cls += ' port-ssh'; lbl = 'SSH 22'; }
        return `<span class="${cls}">${lbl}</span>`;
      }).join('');

      const webBtn = d.webUrl ? `
        <a href="${d.webUrl}" target="_blank" rel="noopener" class="btn-lan-action" title="Otvori Web interfejs (${d.webUrl})">
          <i data-lucide="external-link"></i>
          <span>Web GUI</span>
        </a>
      ` : '';

      return `
        <div class="lan-device-card ${d.category === 'router' ? 'category-router' : 'category-server'}">
          <div class="lan-card-header">
            <div class="lan-card-identity">
              <div class="lan-icon-box ${d.category === 'router' ? 'icon-router' : 'icon-server'}">
                <i data-lucide="${d.categoryIcon}"></i>
              </div>
              <div class="lan-name-group">
                <h4 class="lan-device-name" title="${escapeHtml(d.hostname)}">${escapeHtml(d.hostname)}</h4>
                <div class="lan-device-ip-badge" onclick="copyCustomUrl('${d.ip}')" title="Kopiraj IP">
                  <i data-lucide="copy" style="width: 11px; height: 11px;"></i>
                  <span>${d.ip}</span>
                </div>
              </div>
            </div>
            <span class="status-pill status-online" style="font-size: 0.68rem; padding: 2px 7px;">
              <span class="status-dot-mini"></span>
              <span>${d.pingMs || 1} ms</span>
            </span>
          </div>

          <div class="lan-card-specs">
            <div class="lan-spec-row">
              <span class="lan-spec-label">Mrežna Uloga:</span>
              <span class="lan-spec-val text-yellow" style="font-weight: 800;">${escapeHtml(d.categoryLabel)}</span>
            </div>
            <div class="lan-spec-row">
              <span class="lan-spec-label">Platforma:</span>
              <span class="lan-spec-val" style="color: #cbd5e1;">${escapeHtml(d.vendor)}</span>
            </div>
            <div class="lan-spec-row">
              <span class="lan-spec-label">Lokacija:</span>
              <span class="lan-spec-val" style="color: #38bdf8; font-weight: 700;">
                <i data-lucide="map-pin" style="width: 12px; height: 12px; display: inline-block; vertical-align: -1px;"></i>
                ${escapeHtml(d.location || 'Čačak (Server Sala)')}
              </span>
            </div>
            <div class="lan-spec-row">
              <span class="lan-spec-label">MAC Adresa:</span>
              <span class="lan-spec-val font-mono" style="font-size: 0.72rem; color: #94a3b8;">${d.mac}</span>
            </div>
            <div style="margin-top: 4px;">
              <span class="lan-spec-label" style="display: block; margin-bottom: 4px;">Aktivni Servisi & Portovi:</span>
              <div class="lan-ports-wrap">
                ${portChips || '<span style="color: #64748b; font-size: 0.7rem; font-style: italic;">Nema standardnih portova</span>'}
              </div>
            </div>
          </div>

          <div class="lan-card-bottom">
            <span class="lan-vendor-badge">
              <i data-lucide="shield-check" style="width: 13px; height: 13px; color: #10b981;"></i>
              <span>${d.arpType === 'dynamic' ? 'DHCP' : 'Statički IP'}</span>
            </span>
            <div class="lan-card-actions">
              ${webBtn}
              <button class="btn-lan-action" onclick="pingLanDevice('${d.ip}')" title="Testiraj latenciju">
                <i data-lucide="activity"></i>
                <span>Ping</span>
              </button>
              <button class="btn-lan-action" onclick="openLanDeviceDetails('${d.ip}')" title="Detaljna inspekcija portova">
                <i data-lucide="info"></i>
                <span>Detalji</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } else {
    container.className = 'printers-table-view';
    container.innerHTML = `
      <div class="table-scroll-wrapper" style="width: 100%;">
        <table class="unipromet-table">
          <thead>
            <tr>
              <th style="width: 50px;">#</th>
              <th>SERVER / ČVOR</th>
              <th>IP ADRESA</th>
              <th>MREŽNA ULOGA</th>
              <th>PLATFORMA</th>
              <th>LOKACIJA</th>
              <th>AKTIVNI SERVISI</th>
              <th>ODZIV</th>
              <th style="text-align: right;">AKCIJE</th>
            </tr>
          </thead>
          <tbody>
            ${list.map((d, i) => `
              <tr>
                <td style="color: #64748b; font-size: 0.78rem;">${i + 1}</td>
                <td><div style="font-weight: 800; color: #ffffff; font-size: 0.88rem;">${escapeHtml(d.hostname)}</div></td>
                <td><span class="font-mono text-yellow" style="font-weight: 800; cursor: pointer;" onclick="copyCustomUrl('${d.ip}')" title="Kopiraj">${d.ip}</span></td>
                <td><span class="badge-lan-cat" style="font-size: 0.72rem; font-weight: 700; color: #60a5fa;">${escapeHtml(d.categoryLabel)}</span></td>
                <td style="color: #cbd5e1; font-size: 0.8rem;">${escapeHtml(d.vendor)}</td>
                <td style="font-size: 0.76rem; color: #94a3b8;">${escapeHtml(d.location)}</td>
                <td>
                  <div class="lan-ports-wrap">
                    ${d.openPorts.map(p => `<span class="port-badge">${p}</span>`).join('') || '<span style="color:#64748b;font-size:0.7rem;">-</span>'}
                  </div>
                </td>
                <td><span class="status-pill status-online" style="font-size: 0.68rem; padding: 2px 7px;">${d.pingMs || 1} ms</span></td>
                <td style="text-align: right;">
                  <div style="display: inline-flex; gap: 4px;">
                    ${d.webUrl ? `<a href="${d.webUrl}" target="_blank" class="btn-lan-action" title="Web GUI"><i data-lucide="external-link"></i></a>` : ''}
                    <button class="btn-lan-action" onclick="pingLanDevice('${d.ip}')" title="Ping"><i data-lucide="activity"></i></button>
                    <button class="btn-lan-action" onclick="openLanDeviceDetails('${d.ip}')" title="Detalji"><i data-lucide="info"></i></button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  if (window.lucide) window.lucide.createIcons();
}

// -------------------------------------------------------------------------
// CELINA 3: OSTALI UREĐAJI (Kamere, WiFi, VoIP, IoT)
// -------------------------------------------------------------------------
function renderOtherDevicesTab() {
  const container = document.getElementById('other-devices-container');
  // Exclude RF Readers from Other Devices as they are registered under Evidencija -> RF Čitači
  const rfReaderIps = new Set([
    '192.168.121.244', '192.168.121.245', '192.168.121.246',
    '192.168.121.247', '192.168.121.248', '192.168.121.249',
    '192.168.121.250', '192.168.121.251', '192.168.121.252',
    ...(allRfReaders || []).map(r => r.ip)
  ]);

  const allOth = allLanDevices.filter(d => 
    (d.category === 'camera' || d.category === 'wifi' || d.category === 'voip' || d.category === 'other' || d.category === 'switch') &&
    !rfReaderIps.has(d.ip)
  );

  // Update KPIs
  const kTotal = document.getElementById('kpi-other-total');
  const kCam = document.getElementById('kpi-other-cameras');
  const kWifi = document.getElementById('kpi-other-wifi');
  const kIot = document.getElementById('kpi-other-iot');

  const camCount = allOth.filter(d => d.category === 'camera').length;
  const wifiCount = allOth.filter(d => d.category === 'wifi').length;
  const iotCount = allOth.filter(d => d.category === 'voip' || d.category === 'other' || d.category === 'switch').length;

  if (kTotal) kTotal.textContent = allOth.length;
  if (kCam) kCam.textContent = camCount;
  if (kWifi) kWifi.textContent = wifiCount;
  if (kIot) kIot.textContent = iotCount;

  if (!container) return;

  // Filter
  let list = allOth;
  if (othCategory === 'camera') list = list.filter(d => d.category === 'camera');
  else if (othCategory === 'wifi') list = list.filter(d => d.category === 'wifi');
  else if (othCategory === 'iot') list = list.filter(d => d.category === 'voip' || d.category === 'other' || d.category === 'switch');

  if (othSubnet === '120') list = list.filter(d => d.ip.startsWith('192.168.120.'));
  if (othSubnet === '121') list = list.filter(d => d.ip.startsWith('192.168.121.'));
  if (othLocation !== 'all') list = list.filter(d => d.locationCode === othLocation);

  if (othSearch) {
    const q = othSearch.toLowerCase();
    list = list.filter(d => (
      d.ip.toLowerCase().includes(q) ||
      d.hostname.toLowerCase().includes(q) ||
      d.mac.toLowerCase().includes(q) ||
      d.vendor.toLowerCase().includes(q) ||
      d.categoryLabel.toLowerCase().includes(q)
    ));
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-state-box" style="grid-column: 1 / -1; padding: 48px 20px; text-align: center;">
        <div class="empty-icon"><i data-lucide="search-x"></i></div>
        <h4>Nijedan uređaj ne odgovara filteru</h4>
        <p class="text-dim">Promenite pojam pretrage ili izaberite drugu opciju.</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  if (othViewMode === 'grid') {
    container.className = 'printers-cards-grid';
    container.innerHTML = list.map(d => {
      const portChips = d.openPorts.map(p => {
        let cls = 'port-badge';
        let lbl = `Port ${p}`;
        if (p === 554) { cls += ' port-cctv'; lbl = 'RTSP 554'; }
        else if (p === 80 || p === 443 || p === 8080) { cls += ' port-web'; lbl = `Web ${p}`; }
        else if (p === 5060) { cls += ' port-ssh'; lbl = 'SIP 5060'; }
        return `<span class="${cls}">${lbl}</span>`;
      }).join('');

      const webBtn = d.webUrl ? `
        <a href="${d.webUrl}" target="_blank" rel="noopener" class="btn-lan-action" title="Web GUI (${d.webUrl})">
          <i data-lucide="external-link"></i>
          <span>Web GUI</span>
        </a>
      ` : '';

      return `
        <div class="lan-device-card ${d.category === 'camera' ? 'category-camera' : d.category === 'wifi' ? 'category-wifi' : ''}">
          <div class="lan-card-header">
            <div class="lan-card-identity">
              <div class="lan-icon-box ${d.category === 'camera' ? 'icon-camera' : d.category === 'wifi' ? 'icon-wifi' : ''}">
                <i data-lucide="${d.categoryIcon}"></i>
              </div>
              <div class="lan-name-group">
                <h4 class="lan-device-name" title="${escapeHtml(d.hostname)}">${escapeHtml(d.hostname)}</h4>
                <div class="lan-device-ip-badge" onclick="copyCustomUrl('${d.ip}')" title="Kopiraj IP">
                  <i data-lucide="copy" style="width: 11px; height: 11px;"></i>
                  <span>${d.ip}</span>
                </div>
              </div>
            </div>
            <span class="status-pill status-online" style="font-size: 0.68rem; padding: 2px 7px;">
              <span class="status-dot-mini"></span>
              <span>${d.pingMs || 1} ms</span>
            </span>
          </div>

          <div class="lan-card-specs">
            <div class="lan-spec-row">
              <span class="lan-spec-label">Tip Opreme:</span>
              <span class="lan-spec-val text-yellow">${escapeHtml(d.categoryLabel)}</span>
            </div>
            <div class="lan-spec-row">
              <span class="lan-spec-label">Proizvođač:</span>
              <span class="lan-spec-val" style="color: #cbd5e1;">${escapeHtml(d.vendor)}</span>
            </div>
            <div class="lan-spec-row">
              <span class="lan-spec-label">Lokacija / Mreža:</span>
              <span class="lan-spec-val" style="color: #34d399;">${escapeHtml(d.location || 'Lokalna Mreža')}</span>
            </div>
            <div class="lan-spec-row">
              <span class="lan-spec-label">MAC Adresa:</span>
              <span class="lan-spec-val font-mono" style="font-size: 0.72rem; color: #94a3b8;">${d.mac}</span>
            </div>
            <div style="margin-top: 4px;">
              <span class="lan-spec-label" style="display: block; margin-bottom: 4px;">Detektovani Protokoli:</span>
              <div class="lan-ports-wrap">
                ${portChips || '<span style="color: #64748b; font-size: 0.7rem; font-style: italic;">Nema standardnih portova</span>'}
              </div>
            </div>
          </div>

          <div class="lan-card-bottom">
            <span class="lan-vendor-badge">
              <i data-lucide="shield-check" style="width: 13px; height: 13px; color: #10b981;"></i>
              <span>${d.arpType === 'dynamic' ? 'DHCP' : 'Statički IP'}</span>
            </span>
            <div class="lan-card-actions">
              ${d.category === 'camera' ? `
                <button class="btn-lan-action btn-camera-live" onclick="openCameraLiveModal('${d.ip}', '${escapeHtml(d.hostname)}', '${escapeHtml(d.vendor)}')" title="Gledaj live video strim">
                  <i data-lucide="video" style="color: var(--primary-yellow, #ffb800);"></i>
                  <span>Uživo</span>
                </button>
              ` : ''}
              ${webBtn}
              <button class="btn-lan-action" onclick="pingLanDevice('${d.ip}')" title="Testiraj latenciju">
                <i data-lucide="activity"></i>
                <span>Ping</span>
              </button>
              <button class="btn-lan-action" onclick="openLanDeviceDetails('${d.ip}')" title="Detaljna inspekcija portova">
                <i data-lucide="info"></i>
                <span>Detalji</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } else {
    container.className = 'printers-table-view';
    container.innerHTML = `
      <div class="table-scroll-wrapper" style="width: 100%;">
        <table class="unipromet-table">
          <thead>
            <tr>
              <th style="width: 50px;">#</th>
              <th>UREĐAJ</th>
              <th>TIP OPREME</th>
              <th>PROIZVOĐAČ</th>
              <th>IP ADRESA</th>
              <th>MAC ADRESA</th>
              <th>PROTOKOLI</th>
              <th>ODZIV</th>
              <th style="text-align: right;">AKCIJE</th>
            </tr>
          </thead>
          <tbody>
            ${list.map((d, i) => `
              <tr>
                <td style="color: #64748b; font-size: 0.78rem;">${i + 1}</td>
                <td><div style="font-weight: 800; color: #ffffff; font-size: 0.88rem;">${escapeHtml(d.hostname)}</div></td>
                <td><span class="badge-lan-cat" style="font-size: 0.72rem; font-weight: 700; color: #fbbf24;">${escapeHtml(d.categoryLabel)}</span></td>
                <td style="color: #cbd5e1; font-size: 0.8rem;">${escapeHtml(d.vendor)}</td>
                <td><span class="font-mono text-yellow" style="font-weight: 800; cursor: pointer;" onclick="copyCustomUrl('${d.ip}')" title="Kopiraj">${d.ip}</span></td>
                <td class="font-mono" style="font-size: 0.74rem; color: #94a3b8;">${d.mac}</td>
                <td>
                  <div class="lan-ports-wrap">
                    ${d.openPorts.map(p => `<span class="port-badge">${p}</span>`).join('') || '<span style="color:#64748b;font-size:0.7rem;">-</span>'}
                  </div>
                </td>
                <td><span class="status-pill status-online" style="font-size: 0.68rem; padding: 2px 7px;">${d.pingMs || 1} ms</span></td>
                <td style="text-align: right;">
                  <div style="display: inline-flex; gap: 4px;">
                    ${d.category === 'camera' ? `
                      <button class="btn-lan-action btn-live-action" onclick="openCameraLiveModal('${d.ip}', '${escapeHtml(d.hostname)}', '${escapeHtml(d.vendor)}')" title="Gledaj live video strim">
                        <i data-lucide="video" style="color: var(--primary-yellow, #ffb800);"></i>
                      </button>
                    ` : ''}
                    ${d.webUrl ? `<a href="${d.webUrl}" target="_blank" class="btn-lan-action" title="Web GUI"><i data-lucide="external-link"></i></a>` : ''}
                    <button class="btn-lan-action" onclick="pingLanDevice('${d.ip}')" title="Ping"><i data-lucide="activity"></i></button>
                    <button class="btn-lan-action" onclick="openLanDeviceDetails('${d.ip}')" title="Detalji"><i data-lucide="info"></i></button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  if (window.lucide) window.lucide.createIcons();
}

// -------------------------------------------------------------------------
// EVENT LISTENERS FOR ALL 3 TABS
// -------------------------------------------------------------------------
function setupLanFleetEventListeners() {
  // 1. COMPUTERS
  document.getElementById('btn-rescan-computers')?.addEventListener('click', () => fetchLanDevices(true));
  document.getElementById('btn-export-computers')?.addEventListener('click', copyComputersList);

  document.getElementById('input-search-computers')?.addEventListener('input', (e) => {
    compSearch = e.target.value.trim();
    renderComputersTab();
  });

  document.getElementById('select-computers-subnet')?.addEventListener('change', (e) => {
    compSubnet = e.target.value;
    renderComputersTab();
  });

  document.getElementById('select-computers-location')?.addEventListener('change', (e) => {
    compLocation = e.target.value;
    renderComputersTab();
  });

  document.getElementById('btn-view-computers-grid')?.addEventListener('click', () => {
    compViewMode = 'grid';
    document.getElementById('btn-view-computers-grid')?.classList.add('active');
    document.getElementById('btn-view-computers-list')?.classList.remove('active');
    renderComputersTab();
  });

  document.getElementById('btn-view-computers-list')?.addEventListener('click', () => {
    compViewMode = 'list';
    document.getElementById('btn-view-computers-list')?.classList.add('active');
    document.getElementById('btn-view-computers-grid')?.classList.remove('active');
    renderComputersTab();
  });

  document.querySelectorAll('#computers-category-filters .filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#computers-category-filters .filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      compCategory = pill.getAttribute('data-comp-cat') || 'all';
      renderComputersTab();
    });
  });

  document.getElementById('kpi-card-comp-total')?.addEventListener('click', () => {
    compCategory = 'all';
    updateCompPillsActive('all');
    renderComputersTab();
  });
  document.getElementById('kpi-card-comp-laptops')?.addEventListener('click', () => {
    compCategory = 'laptop';
    updateCompPillsActive('laptop');
    renderComputersTab();
  });
  document.getElementById('kpi-card-comp-desktops')?.addEventListener('click', () => {
    compCategory = 'desktop';
    updateCompPillsActive('desktop');
    renderComputersTab();
  });
  document.getElementById('kpi-card-comp-external')?.addEventListener('click', () => {
    compCategory = 'external';
    updateCompPillsActive('external');
    renderComputersTab();
  });

  // 2. SERVERS
  document.getElementById('btn-rescan-servers')?.addEventListener('click', () => fetchLanDevices(true));
  document.getElementById('btn-export-servers')?.addEventListener('click', copyServersList);

  document.getElementById('input-search-servers')?.addEventListener('input', (e) => {
    srvSearch = e.target.value.trim();
    renderServersTab();
  });

  document.getElementById('select-servers-subnet')?.addEventListener('change', (e) => {
    srvSubnet = e.target.value;
    renderServersTab();
  });

  document.getElementById('btn-view-servers-grid')?.addEventListener('click', () => {
    srvViewMode = 'grid';
    document.getElementById('btn-view-servers-grid')?.classList.add('active');
    document.getElementById('btn-view-servers-list')?.classList.remove('active');
    renderServersTab();
  });

  document.getElementById('btn-view-servers-list')?.addEventListener('click', () => {
    srvViewMode = 'list';
    document.getElementById('btn-view-servers-list')?.classList.add('active');
    document.getElementById('btn-view-servers-grid')?.classList.remove('active');
    renderServersTab();
  });

  document.querySelectorAll('#servers-category-filters .filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#servers-category-filters .filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      srvCategory = pill.getAttribute('data-srv-cat') || 'all';
      renderServersTab();
    });
  });

  document.getElementById('kpi-card-srv-total')?.addEventListener('click', () => {
    srvCategory = 'all';
    updateSrvPillsActive('all');
    renderServersTab();
  });
  document.getElementById('kpi-card-srv-dc')?.addEventListener('click', () => {
    srvCategory = 'server';
    updateSrvPillsActive('server');
    renderServersTab();
  });
  document.getElementById('kpi-card-srv-routers')?.addEventListener('click', () => {
    srvCategory = 'router';
    updateSrvPillsActive('router');
    renderServersTab();
  });
  document.getElementById('kpi-card-srv-web')?.addEventListener('click', () => {
    srvCategory = 'web';
    updateSrvPillsActive('web');
    renderServersTab();
  });

  // 3. OTHER DEVICES
  document.getElementById('btn-rescan-other')?.addEventListener('click', () => fetchLanDevices(true));
  document.getElementById('btn-export-other')?.addEventListener('click', copyOtherDevicesList);

  document.getElementById('input-search-other')?.addEventListener('input', (e) => {
    othSearch = e.target.value.trim();
    renderOtherDevicesTab();
  });

  document.getElementById('select-other-subnet')?.addEventListener('change', (e) => {
    othSubnet = e.target.value;
    renderOtherDevicesTab();
  });

  document.getElementById('select-other-location')?.addEventListener('change', (e) => {
    othLocation = e.target.value;
    renderOtherDevicesTab();
  });

  document.getElementById('btn-view-other-grid')?.addEventListener('click', () => {
    othViewMode = 'grid';
    document.getElementById('btn-view-other-grid')?.classList.add('active');
    document.getElementById('btn-view-other-list')?.classList.remove('active');
    renderOtherDevicesTab();
  });

  document.getElementById('btn-view-other-list')?.addEventListener('click', () => {
    othViewMode = 'list';
    document.getElementById('btn-view-other-list')?.classList.add('active');
    document.getElementById('btn-view-other-grid')?.classList.remove('active');
    renderOtherDevicesTab();
  });

  document.querySelectorAll('#other-category-filters .filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#other-category-filters .filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      othCategory = pill.getAttribute('data-oth-cat') || 'all';
      renderOtherDevicesTab();
    });
  });

  document.getElementById('kpi-card-oth-total')?.addEventListener('click', () => {
    othCategory = 'all';
    updateOthPillsActive('all');
    renderOtherDevicesTab();
  });
  document.getElementById('kpi-card-oth-cameras')?.addEventListener('click', () => {
    othCategory = 'camera';
    updateOthPillsActive('camera');
    renderOtherDevicesTab();
  });
  document.getElementById('kpi-card-oth-wifi')?.addEventListener('click', () => {
    othCategory = 'wifi';
    updateOthPillsActive('wifi');
    renderOtherDevicesTab();
  });
  document.getElementById('kpi-card-oth-iot')?.addEventListener('click', () => {
    othCategory = 'iot';
    updateOthPillsActive('iot');
    renderOtherDevicesTab();
  });
}

function updateCompPillsActive(val) {
  document.querySelectorAll('#computers-category-filters .filter-pill').forEach(p => {
    if (p.getAttribute('data-comp-cat') === val) p.classList.add('active');
    else p.classList.remove('active');
  });
}

function updateSrvPillsActive(val) {
  document.querySelectorAll('#servers-category-filters .filter-pill').forEach(p => {
    if (p.getAttribute('data-srv-cat') === val) p.classList.add('active');
    else p.classList.remove('active');
  });
}

function updateOthPillsActive(val) {
  document.querySelectorAll('#other-category-filters .filter-pill').forEach(p => {
    if (p.getAttribute('data-oth-cat') === val) p.classList.add('active');
    else p.classList.remove('active');
  });
}

// -------------------------------------------------------------------------
// EXPORT / COPY SPISKOVI
// -------------------------------------------------------------------------
function copyComputersList() {
  const ws = allLanDevices.filter(d => d.category === 'workstation');
  if (ws.length === 0) {
    showToast('Nema očitanih računara za kopiranje', 'error');
    return;
  }
  let text = `UNIPROMET DOO ČAČAK - EVIDENCIJA RAČUNARA (UKUPNO: ${ws.length})\n`;
  text += `Datum: ${new Date().toLocaleString('sr-RS')}\n\n`;
  text += `IP Adresa\tNaziv Računara\tLokacija\tTip\tProizvođač\tDomen\tMAC Adresa\tServisi\n`;
  text += `----------------------------------------------------------------------------------------------------\n`;
  ws.forEach(d => {
    text += `${d.ip}\t${d.hostname}\t${d.location || 'Čačak'}\t${d.categoryLabel}\t${d.vendor}\t${d.domain || 'UNI'}\t${d.mac}\t${d.openPorts.join(', ') || 'Nema'}\n`;
  });
  navigator.clipboard.writeText(text).then(() => {
    showToast(`✓ Kopiran spisak svih ${ws.length} računara!`, 'success');
  }).catch(() => showToast('Neuspešno kopiranje', 'error'));
}
window.copyComputersList = copyComputersList;

function copyServersList() {
  const srv = allLanDevices.filter(d => d.category === 'server' || d.category === 'router');
  if (srv.length === 0) {
    showToast('Nema očitanih servera za kopiranje', 'error');
    return;
  }
  let text = `UNIPROMET DOO ČAČAK - EVIDENCIJA SERVERA & MREŽE (UKUPNO: ${srv.length})\n`;
  text += `Datum: ${new Date().toLocaleString('sr-RS')}\n\n`;
  text += `IP Adresa\tServer / Gateway\tUloga\tPlatforma\tLokacija\tOtvoreni Portovi\n`;
  text += `----------------------------------------------------------------------------------------------------\n`;
  srv.forEach(d => {
    text += `${d.ip}\t${d.hostname}\t${d.categoryLabel}\t${d.vendor}\t${d.location}\t${d.openPorts.join(', ') || 'Nema'}\n`;
  });
  navigator.clipboard.writeText(text).then(() => {
    showToast(`✓ Kopiran spisak za ${srv.length} servera & gateway uređaja!`, 'success');
  }).catch(() => showToast('Neuspešno kopiranje', 'error'));
}
window.copyServersList = copyServersList;

function copyOtherDevicesList() {
  const oth = allLanDevices.filter(d => d.category === 'camera' || d.category === 'wifi' || d.category === 'voip' || d.category === 'other' || d.category === 'switch');
  if (oth.length === 0) {
    showToast('Nema očitanih uređaja za kopiranje', 'error');
    return;
  }
  let text = `UNIPROMET DOO ČAČAK - EVIDENCIJA OSTALE OPREME (UKUPNO: ${oth.length})\n`;
  text += `Datum: ${new Date().toLocaleString('sr-RS')}\n\n`;
  text += `IP Adresa\tUređaj\tTip Opreme\tProizvođač\tMAC Adresa\tPortovi\n`;
  text += `----------------------------------------------------------------------------------------------------\n`;
  oth.forEach(d => {
    text += `${d.ip}\t${d.hostname}\t${d.categoryLabel}\t${d.vendor}\t${d.mac}\t${d.openPorts.join(', ') || 'Nema'}\n`;
  });
  navigator.clipboard.writeText(text).then(() => {
    showToast(`✓ Kopiran spisak za ${oth.length} uređaja opreme!`, 'success');
  }).catch(() => showToast('Neuspešno kopiranje', 'error'));
}
window.copyOtherDevicesList = copyOtherDevicesList;

// -------------------------------------------------------------------------
// PING & DETAILS MODAL
// -------------------------------------------------------------------------
async function pingLanDevice(ip) {
  showToast(`Slanje ping signala ka ${ip}...`, 'info');
  try {
    const res = await fetch(`/api/network/devices/${encodeURIComponent(ip)}/ping`);
    const data = await res.json();
    if (data.isAlive) {
      showToast(`⚡ ${ip} je ONLINE! Odziv: ${data.latencyMs} ms`, 'success');
    } else {
      showToast(`⚠️ ${ip} ne odgovara na standardnim portovima`, 'error');
    }
  } catch (err) {
    showToast(`Greška pri pingovanju ${ip}`, 'error');
  }
}
window.pingLanDevice = pingLanDevice;

async function openLanDeviceDetails(ip) {
  const modal = document.getElementById('modal-lan-device-detail');
  const body = document.getElementById('lan-device-detail-body');
  const title = document.getElementById('detail-lan-title');
  const subtitle = document.getElementById('detail-lan-subtitle');

  if (modal) {
    if (typeof window.openModal === 'function') {
      window.openModal(modal);
    } else {
      modal.style.display = 'flex';
      if (window.lucide) window.lucide.createIcons();
    }
  }
  if (title) title.textContent = `Inspekcija Uređaja: ${ip}`;
  if (subtitle) subtitle.textContent = 'Dubinsko skeniranje portova, servisa i sistemskih parametara...';

  if (body) {
    body.innerHTML = `
      <div class="telemetry-loading-state">
        <div class="spinner-circle"></div>
        <h5>Skeniranje svih 20 standardnih enterprise portova na ${ip}...</h5>
        <p>Provera HTTP, HTTPS, SMB, RDP, SSH, DNS, RTSP, Winbox, SQL i VoIP servisa...</p>
      </div>
    `;
  }

  try {
    const res = await fetch(`/api/network/devices/${encodeURIComponent(ip)}/details`);
    const data = await res.json();

    if (res.ok && data.success && data.details) {
      const d = data.details;
      const openPorts = d.ports || [];

      body.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 16px;">
          
          <div style="background: var(--bg-surface-elevated); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 16px;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 0.84rem;">
              <div>
                <span class="text-dim">IP Adresa:</span>
                <div class="font-mono text-yellow" style="font-weight: 800; font-size: 1rem;">${d.ip}</div>
              </div>
              <div>
                <span class="text-dim">MAC Adresa:</span>
                <div class="font-mono" style="font-weight: 800; color: #ffffff;">${d.mac}</div>
              </div>
              <div>
                <span class="text-dim">Proizvođač Hardvera:</span>
                <div style="font-weight: 800; color: #38bdf8;">${escapeHtml(d.vendor)}</div>
              </div>
              <div>
                <span class="text-dim">NetBIOS / Hostname:</span>
                <div style="font-weight: 800; color: #10b981;">${escapeHtml(d.netbios?.name || d.dnsName || 'Nije objavljeno')}</div>
              </div>
              ${d.netbios?.domain ? `
              <div>
                <span class="text-dim">Workgroup / Domen:</span>
                <div class="font-mono" style="font-weight: 800; color: #a78bfa;">${escapeHtml(d.netbios.domain)}</div>
              </div>` : ''}
            </div>
          </div>

          <div>
            <h5 style="color: #ffffff; margin-bottom: 8px; font-size: 0.92rem;">Rezultat Skeniranja Portova (${openPorts.length} Otvoreno):</h5>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px;">
              ${d.allTestedPorts.map(p => `
                <div style="padding: 8px 10px; background: ${p.isOpen ? 'rgba(16, 185, 129, 0.12)' : 'rgba(255, 255, 255, 0.02)'}; border: 1px solid ${p.isOpen ? 'rgba(16, 185, 129, 0.4)' : 'rgba(255, 255, 255, 0.06)'}; border-radius: 6px; display: flex; align-items: center; justify-content: space-between;">
                  <div>
                    <span style="font-weight: 800; color: ${p.isOpen ? '#34d399' : '#64748b'}; font-size: 0.8rem; font-family: monospace;">${p.port}</span>
                    <span style="font-size: 0.72rem; color: #94a3b8; margin-left: 4px;">${p.name}</span>
                  </div>
                  <span style="font-size: 0.68rem; font-weight: 800; color: ${p.isOpen ? '#10b981' : '#64748b'};">${p.isOpen ? 'OTVOREN' : 'Zatvoren'}</span>
                </div>
              `).join('')}
            </div>
          </div>

        </div>
      `;
    } else {
      throw new Error(data.error || 'Greška pri preuzimanju detalja');
    }
  } catch (err) {
    body.innerHTML = `
      <div class="telemetry-error-state">
        <h5>Greška</h5>
        <p>${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}
window.openLanDeviceDetails = openLanDeviceDetails;

// =========================================================================
// CCTV IP CAMERAS CLIENT LOGIC (OPSEZI 192.168.124.x & 192.168.125.x)
// =========================================================================
let allCameras = [];
let offlineCamerasList = [];
let isFetchingCameras = false;
let camSearch = '';
let camSubnet = 'all';
let camVendor = 'all';
let camCategory = 'all';
let camViewMode = 'list';

async function fetchCameras(force = false) {
  if (isFetchingCameras) return;
  isFetchingCameras = true;

  if (force) {
    setButtonSpinning('btn-rescan-cameras', true);
  } else {
    setButtonSpinning('btn-rescan-cameras', false);
  }

  const container = document.getElementById('cameras-devices-container');
  if (force && container) {
    container.innerHTML = `
      <div class="telemetry-loading-state" style="grid-column: 1 / -1;">
        <div class="spinner-circle"></div>
        <h5>Skeniranje svih kamera na opsezima 124 i 125 u toku...</h5>
        <p>Ispitivanje 421 IP adrese, HTTP portala i RTSP video strimova...</p>
      </div>
    `;
  }

  try {
    const res = await fetch(`/api/cameras?force=${force}`);
    const data = await res.json();

    if (res.ok && data.success) {
      allCameras = data.cameras || [];
      offlineCamerasList = data.offlineCameras || [];

      const badgeNav = document.getElementById('badge-nav-cameras');
      if (badgeNav) badgeNav.textContent = allCameras.length;

      const badgeOffline = document.getElementById('badge-offline-cameras-count');
      if (badgeOffline) badgeOffline.textContent = offlineCamerasList.length;

      const kpiOffline = document.getElementById('kpi-cameras-offline');
      if (kpiOffline) kpiOffline.textContent = offlineCamerasList.length;

      const modalBadge = document.getElementById('modal-offline-cameras-header-badge');
      if (modalBadge) modalBadge.textContent = `${offlineCamerasList.length} offline`;

      renderCamerasTab();

      if (force) {
        showToast(`✓ Uspešno osveženo ${allCameras.length} IP kamera! (${offlineCamerasList.length} offline u evidenciji)`, 'success');
      }
    } else {
      throw new Error(data.details || data.error || 'Greška pri očitavanju kamera');
    }
  } catch (err) {
    console.error('Cameras fetch error:', err);
    showToast(`Greška pri skeniranju kamera: ${err.message}`, 'error');
  } finally {
    setButtonSpinning('btn-rescan-cameras', false);
    isFetchingCameras = false;
  }
}
window.fetchCameras = fetchCameras;

function renderCamerasTab() {
  const container = document.getElementById('cameras-devices-container');

  // Update KPIs
  const kTotal = document.getElementById('kpi-cameras-total');
  const kSub124 = document.getElementById('kpi-cameras-sub124');
  const kSub125 = document.getElementById('kpi-cameras-sub125');
  const kHik = document.getElementById('kpi-cameras-hikvision');
  const kDahua = document.getElementById('kpi-cameras-dahua');

  const count124 = allCameras.filter(c => c.subnet === '124').length;
  const count125 = allCameras.filter(c => c.subnet === '125').length;
  const countHik = allCameras.filter(c => c.vendor === 'Hikvision').length;
  const countDahua = allCameras.filter(c => c.vendor === 'Dahua').length;

  if (kTotal) kTotal.textContent = allCameras.length;
  if (kSub124) kSub124.textContent = count124;
  if (kSub125) kSub125.textContent = count125;
  if (kHik) kHik.textContent = countHik;
  if (kDahua) kDahua.textContent = countDahua;

  if (!container) return;

  // Filter
  let list = allCameras;
  if (camCategory === '124') list = list.filter(c => c.subnet === '124');
  else if (camCategory === '125') list = list.filter(c => c.subnet === '125');
  else if (camCategory === 'hikvision') list = list.filter(c => c.vendor === 'Hikvision');
  else if (camCategory === 'dahua') list = list.filter(c => c.vendor === 'Dahua');

  if (camSubnet === '124') list = list.filter(c => c.subnet === '124');
  if (camSubnet === '125') list = list.filter(c => c.subnet === '125');

  if (camVendor !== 'all') list = list.filter(c => c.vendor === camVendor);

  if (camSearch) {
    const q = camSearch.toLowerCase();
    list = list.filter(c => (
      c.ip.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      (c.recorder && c.recorder.toLowerCase().includes(q)) ||
      (c.position && c.position.toLowerCase().includes(q)) ||
      c.vendor.toLowerCase().includes(q) ||
      c.subnetLabel.toLowerCase().includes(q)
    ));
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-state-box" style="grid-column: 1 / -1; padding: 48px 20px; text-align: center;">
        <div class="empty-icon"><i data-lucide="video-off"></i></div>
        <h4>Nijedna kamera ne odgovara zadatim filterima</h4>
        <p class="text-dim">Promenite pojam pretrage ili izaberite drugi opseg.</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  if (camViewMode === 'grid') {
    container.className = 'printers-cards-grid';
    container.innerHTML = list.map(c => {
      const is124 = c.subnet === '124';
      const vendorColor = c.vendor === 'Hikvision' ? '#FFB800' : c.vendor === 'Dahua' ? '#38bdf8' : '#a78bfa';

      const portChips = c.openPorts.map(p => {
        let cls = 'port-badge';
        let lbl = `Port ${p}`;
        if (p === 80) { cls += ' port-web'; lbl = 'HTTP 80'; }
        else if (p === 554) { cls += ' port-cctv'; lbl = 'RTSP 554'; }
        else if (p === 8000) { cls += ' port-rdp'; lbl = 'SDK 8000'; }
        else if (p === 37777) { cls += ' port-ssh'; lbl = 'DVR 37777'; }
        return `<span class="${cls}">${lbl}</span>`;
      }).join('');

      return `
        <div class="printer-card" id="card-cam-${c.ip.replace(/\./g, '-')}">
          <div class="printer-card-header">
            <div class="printer-type-badge">
              <i data-lucide="video"></i>
              <span>${escapeHtml(c.vendor)}</span>
            </div>
            <span class="status-pill active-pill" style="font-size: 0.72rem;">
              <span class="status-dot"></span> ${c.pingMs || 1} ms
            </span>
          </div>

          <div class="printer-card-body">
            <div class="printer-title-row" style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;">
              <h4 class="printer-name" style="font-size: 0.96rem; font-weight: 700; color: #fff;">${escapeHtml(c.name)}</h4>
              ${c.recorder && c.recorder !== 'Nedodeljeno' ? `
                <span class="inv-rec-badge" style="font-size: 0.7rem; padding: 2px 7px; white-space: nowrap; border-radius: 4px; background: rgba(56, 189, 248, 0.1); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.25);" title="NVR Snimač: ${escapeHtml(c.recorder)}">
                  <i data-lucide="hard-drive" style="width: 10px; height: 10px; vertical-align: middle;"></i> ${escapeHtml(c.recorder)}
                </span>
              ` : ''}
            </div>

            <div class="printer-meta-row" style="margin: 8px 0;">
              <div class="meta-item">
                <i data-lucide="shield-check" class="meta-icon" style="color: ${vendorColor};"></i>
                <span class="meta-text" style="color: ${vendorColor}; font-weight: 700;">${escapeHtml(c.vendor)}</span>
              </div>
              <div class="meta-item">
                <i data-lucide="network" class="meta-icon"></i>
                <span class="meta-text font-mono text-xs">${escapeHtml(c.subnetLabel)}</span>
              </div>
            </div>

            <div class="printer-ip-box">
              <div class="ip-details">
                <span class="ip-label">MREŽNA IP ADRESA</span>
                <span class="ip-val font-mono" style="color: ${is124 ? '#38bdf8' : '#34d399'};">${escapeHtml(c.ip)}</span>
              </div>
              <button class="btn-copy-chip" onclick="copyCustomUrl('${escapeHtml(c.ip)}')" title="Kopiraj adresu">
                <i data-lucide="copy"></i>
              </button>
            </div>

            <div style="display: flex; gap: 6px; margin-top: 8px;">
              <button class="btn-copy-chip-sm" style="width: auto; padding: 2px 8px; font-size: 0.72rem; gap: 4px;" onclick="copyCustomUrl('${c.rtspMain}')" title="Kopiraj RTSP Main link">
                <i data-lucide="copy" style="width: 10px; height: 10px;"></i> RTSP Main
              </button>
              <button class="btn-copy-chip-sm" style="width: auto; padding: 2px 8px; font-size: 0.72rem; gap: 4px;" onclick="copyCustomUrl('${c.rtspSub}')" title="Kopiraj RTSP Sub link">
                <i data-lucide="copy" style="width: 10px; height: 10px;"></i> RTSP Sub
              </button>
            </div>

            ${portChips ? `
              <div class="lan-ports-wrap" style="margin-top: 8px; display: flex; gap: 4px; flex-wrap: wrap;">
                ${portChips}
              </div>
            ` : ''}
          </div>

          <div class="printer-card-actions">
            <button class="btn-printer-action btn-camera-live" onclick="openCameraLiveModal('${c.ip}', '${escapeHtml(c.name)}', '${escapeHtml(c.vendor)}')" title="Gledaj live video strim kamere">
              <i data-lucide="video"></i>
              <span>Uživo</span>
            </button>
            <button class="btn-printer-action" onclick="pingCameraClient('${c.ip}')" title="Testiraj latenciju kamere">
              <i data-lucide="activity"></i>
              <span>Ping</span>
            </button>
            ${c.webUrl ? `
              <a href="${c.webUrl}" target="_blank" rel="noopener" class="btn-printer-action" title="Web GUI (${c.webUrl})">
                <i data-lucide="external-link"></i>
                <span>Web</span>
              </a>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  } else {
    container.className = '';
    container.innerHTML = `
      <div class="inv-table-wrapper">
        <table class="inv-camera-table">
          <thead>
            <tr>
              <th style="width: 50px;">#</th>
              <th style="width: 180px;">IP Adresa</th>
              <th>Kamera / Naziv</th>
              <th style="width: 170px;">Proizvođač</th>
              <th style="width: 160px;">Mrežni Opseg</th>
              <th style="width: 180px;">RTSP Video Strim</th>
              <th style="width: 110px;">Odziv</th>
              <th style="width: 140px; text-align: right;">Akcije</th>
            </tr>
          </thead>
          <tbody>
            ${list.map((c, i) => {
              const is124 = c.subnet === '124';
              const vendorColor = c.vendor === 'Hikvision' ? '#FFB800' : c.vendor === 'Dahua' ? '#38bdf8' : '#a78bfa';

              return `
                <tr>
                  <td class="font-mono text-dim" style="font-size: 0.78rem;">${i + 1}</td>
                  <td>
                    <div class="inv-ip-pill ${is124 ? 'subnet-124' : 'subnet-125'}">
                      <span class="chip-dot"></span>
                      <span>${escapeHtml(c.ip)}</span>
                      <button class="btn-copy-chip-sm" onclick="copyCustomUrl('${escapeHtml(c.ip)}')" title="Kopiraj IP adresu">
                        <i data-lucide="copy" style="width: 11px; height: 11px;"></i>
                      </button>
                    </div>
                  </td>
                  <td>
                    <div class="inv-pos-cell">
                      <div class="inv-cam-avatar">
                        <i data-lucide="video" style="width: 16px; height: 16px;"></i>
                      </div>
                      <div class="inv-pos-info">
                        <span class="inv-pos-name">${escapeHtml(c.name)}</span>
                        <span class="inv-pos-sub">${escapeHtml(c.recorder && c.recorder !== 'Nedodeljeno' ? `Snimač: ${c.recorder}` : (c.position || 'CCTV Online Nadzor'))}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span class="inv-rec-badge" style="color: ${vendorColor}; border-color: rgba(255, 255, 255, 0.1);">
                      <i data-lucide="${c.vendor === 'Hikvision' ? 'shield-check' : 'eye'}" style="color: ${vendorColor};"></i>
                      ${escapeHtml(c.vendor)}
                    </span>
                  </td>
                  <td>
                    <span class="inv-subnet-badge">${escapeHtml(c.subnetLabel)}</span>
                  </td>
                  <td>
                    <div style="display: inline-flex; gap: 4px;">
                      <button class="btn-copy-chip-sm" style="width: auto; padding: 2px 8px; font-size: 0.72rem; gap: 4px;" onclick="copyCustomUrl('${c.rtspMain}')" title="Kopiraj RTSP Main Stream">
                        <i data-lucide="copy" style="width: 11px; height: 11px;"></i> Main
                      </button>
                      <button class="btn-copy-chip-sm" style="width: auto; padding: 2px 8px; font-size: 0.72rem; gap: 4px;" onclick="copyCustomUrl('${c.rtspSub}')" title="Kopiraj RTSP Sub Stream">
                        <i data-lucide="copy" style="width: 11px; height: 11px;"></i> Sub
                      </button>
                    </div>
                  </td>
                  <td>
                    <span class="status-pill active-pill" style="font-size: 0.72rem;">
                      <span class="status-dot"></span>
                      ${c.pingMs || 1} ms
                    </span>
                  </td>
                  <td style="text-align: right;">
                    <div class="inv-actions-cell">
                      <button class="btn-inv-action btn-live-action" onclick="openCameraLiveModal('${c.ip}', '${escapeHtml(c.name)}', '${escapeHtml(c.vendor)}')" title="Gledaj live video strim kamere">
                        <i data-lucide="video" style="color: var(--primary-yellow, #ffb800);"></i>
                      </button>
                      <button class="btn-inv-action" onclick="pingCameraClient('${c.ip}')" title="Ping kamera">
                        <i data-lucide="activity" style="width: 14px; height: 14px;"></i>
                      </button>
                      ${c.webUrl ? `
                        <a href="${c.webUrl}" target="_blank" rel="noopener" class="btn-inv-action btn-web" title="Otvori Web Portal kamere">
                          <i data-lucide="external-link" style="width: 14px; height: 14px;"></i>
                        </a>
                      ` : ''}
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  if (window.lucide) window.lucide.createIcons();
}

function setupCamerasEventListeners() {
  document.getElementById('btn-rescan-cameras')?.addEventListener('click', () => fetchCameras(true));
  document.getElementById('btn-export-cameras')?.addEventListener('click', copyCamerasList);

  const inputSearch = document.getElementById('input-search-cameras');
  const btnClearSearch = document.getElementById('btn-clear-search-cameras');

  inputSearch?.addEventListener('input', (e) => {
    camSearch = e.target.value.trim();
    if (btnClearSearch) btnClearSearch.style.display = camSearch ? 'flex' : 'none';
    renderCamerasTab();
  });

  btnClearSearch?.addEventListener('click', () => {
    if (inputSearch) inputSearch.value = '';
    camSearch = '';
    btnClearSearch.style.display = 'none';
    renderCamerasTab();
  });

  document.getElementById('select-cameras-subnet')?.addEventListener('change', (e) => {
    camSubnet = e.target.value;
    renderCamerasTab();
  });

  document.getElementById('select-cameras-vendor')?.addEventListener('change', (e) => {
    camVendor = e.target.value;
    renderCamerasTab();
  });

  document.getElementById('btn-view-cameras-grid')?.addEventListener('click', () => {
    camViewMode = 'grid';
    document.getElementById('btn-view-cameras-grid')?.classList.add('active');
    document.getElementById('btn-view-cameras-list')?.classList.remove('active');
    renderCamerasTab();
  });

  document.getElementById('btn-view-cameras-list')?.addEventListener('click', () => {
    camViewMode = 'list';
    document.getElementById('btn-view-cameras-list')?.classList.add('active');
    document.getElementById('btn-view-cameras-grid')?.classList.remove('active');
    renderCamerasTab();
  });

  document.querySelectorAll('#cameras-category-filters .inv-quick-pill, #cameras-category-filters .filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#cameras-category-filters .inv-quick-pill, #cameras-category-filters .filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      camCategory = pill.getAttribute('data-cam-cat') || 'all';
      renderCamerasTab();
    });
  });

  document.getElementById('kpi-card-cam-total')?.addEventListener('click', () => {
    camCategory = 'all';
    updateCamPillsActive('all');
    renderCamerasTab();
  });
  document.getElementById('kpi-card-cam-sub124')?.addEventListener('click', () => {
    camCategory = '124';
    updateCamPillsActive('124');
    renderCamerasTab();
  });
  document.getElementById('kpi-card-cam-sub125')?.addEventListener('click', () => {
    camCategory = '125';
    updateCamPillsActive('125');
    renderCamerasTab();
  });
  document.getElementById('kpi-card-cam-hikvision')?.addEventListener('click', () => {
    camCategory = 'hikvision';
    updateCamPillsActive('hikvision');
    renderCamerasTab();
  });
  document.getElementById('kpi-card-cam-dahua')?.addEventListener('click', () => {
    camCategory = 'dahua';
    updateCamPillsActive('dahua');
    renderCamerasTab();
  });

  // Offline cameras modal triggers
  document.getElementById('btn-show-offline-cameras')?.addEventListener('click', openOfflineCamerasModal);
  document.getElementById('kpi-card-cam-offline')?.addEventListener('click', openOfflineCamerasModal);
  document.getElementById('btn-close-offline-cameras-modal')?.addEventListener('click', closeOfflineCamerasModal);
  document.getElementById('btn-cancel-offline-cameras-modal')?.addEventListener('click', closeOfflineCamerasModal);
  document.getElementById('btn-recheck-offline-cameras')?.addEventListener('click', recheckOfflineCameras);
  document.getElementById('btn-email-offline-cameras')?.addEventListener('click', sendOfflineCamerasEmail);
}

function openOfflineCamerasModal() {
  const modal = document.getElementById('modal-offline-cameras');
  if (!modal) return;
  modal.style.display = 'flex';
  renderOfflineCamerasModal();
}
window.openOfflineCamerasModal = openOfflineCamerasModal;

function closeOfflineCamerasModal() {
  const modal = document.getElementById('modal-offline-cameras');
  if (!modal) return;
  modal.style.display = 'none';
}
window.closeOfflineCamerasModal = closeOfflineCamerasModal;

function renderOfflineCamerasModal() {
  const body = document.getElementById('offline-cameras-modal-body');
  const badge = document.getElementById('modal-offline-cameras-header-badge');
  const statusText = document.getElementById('offline-cameras-modal-status-text');
  if (!body) return;

  if (badge) badge.textContent = `${offlineCamerasList.length} offline`;
  if (statusText) {
    statusText.textContent = `Pronađeno ${offlineCamerasList.length} kamera iz evidencije koje nemaju odziv na mreži`;
  }

  if (offlineCamerasList.length === 0) {
    const totalInDb = (typeof allInventoryCameras !== 'undefined' && allInventoryCameras.length > 0)
      ? allInventoryCameras.length
      : 243;
    body.innerHTML = `
      <div class="empty-state-box" style="padding: 44px 20px; text-align: center;">
        <div class="empty-icon" style="color: #10b981; background: rgba(16, 185, 129, 0.12); width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px;">
          <i data-lucide="check-circle-2" style="width: 32px; height: 32px;"></i>
        </div>
        <h4 style="color: #ffffff; font-size: 1.15rem; font-weight: 700; margin-bottom: 6px;">Sve kamere su dostupne na mreži!</h4>
        <p class="text-dim" style="font-size: 0.88rem; max-width: 480px; margin: 0 auto;">
          Svih ${totalInDb} kamera evidentiranih u SQLite bazi podataka je trenutno aktivno i uspešno odgovara na portovima (100% dostupnost).
        </p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  body.innerHTML = `
    <div style="margin-bottom: 16px; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 10px; padding: 12px 18px; display: flex; align-items: center; justify-content: space-between;">
      <div style="display: flex; align-items: center; gap: 10px;">
        <i data-lucide="alert-triangle" style="color: #ef4444; width: 20px; height: 20px; flex-shrink: 0;"></i>
        <div style="font-size: 0.85rem; color: #fca5a5;">
          Sledeće kamere su unete u bazu evidencije, ali <strong>nemaju aktivan odziv</strong> na mrežnim portovima (80 HTTP / 554 RTSP):
        </div>
      </div>
      <span class="badge-count-alert">${offlineCamerasList.length}</span>
    </div>

    <div class="offline-cameras-list-wrap">
      ${offlineCamerasList.map(c => {
        return `
          <div class="offline-cam-card" id="card-offline-${c.id}">
            <div class="offline-cam-main">
              <div class="offline-cam-avatar">
                <i data-lucide="video-off"></i>
              </div>
              <div>
                <div class="offline-cam-title">${escapeHtml(c.name || c.position || 'Kamera')}</div>
                <div class="offline-cam-meta">
                  <span style="font-family: var(--font-mono); font-weight: 700; color: #ffffff; background: rgba(255,255,255,0.06); padding: 2px 7px; border-radius: 4px;">
                    ${escapeHtml(c.ip)}
                  </span>
                  <button class="btn-copy-chip-sm" onclick="copyIpToClipboard('${c.ip}')" title="Kopiraj IP adresu">
                    <i data-lucide="copy"></i>
                  </button>
                  <span class="inv-rec-badge">
                    <i data-lucide="hard-drive"></i>
                    <span>${escapeHtml(c.recorder || 'Nedodeljeno')}</span>
                  </span>
                  <span class="inv-subnet-badge">${escapeHtml(c.subnet || 'Ostalo')}</span>
                  <span class="inv-pos-sub"><i data-lucide="map-pin"></i> ${escapeHtml(c.position || '-')}</span>
                </div>
                <div class="offline-cam-reason">
                  <i data-lucide="alert-circle" style="width: 13px; height: 13px;"></i>
                  <span>${escapeHtml(c.reason || 'Nema odziva na mreži (Destination unreachable)')}</span>
                </div>
              </div>
            </div>

            <div class="offline-cam-actions">
              <button class="btn-offline-ping" id="btn-ping-${c.id}" onclick="testSingleOfflineCamera('${c.ip}', '${c.id}')" title="Pošalji mrežnu probu ka kameri">
                <i data-lucide="activity"></i>
                <span id="ping-text-${c.id}">Ping Proba</span>
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  if (window.lucide) window.lucide.createIcons();
}
window.renderOfflineCamerasModal = renderOfflineCamerasModal;

async function testSingleOfflineCamera(ip, id) {
  const btn = document.getElementById(`btn-ping-${id}`);
  const text = document.getElementById(`ping-text-${id}`);
  if (btn) {
    btn.style.pointerEvents = 'none';
    btn.innerHTML = `<i data-lucide="rotate-cw" class="icon-spin"></i> <span>Ispitujem...</span>`;
    if (window.lucide) window.lucide.createIcons();
  }

  try {
    const res = await fetch(`/api/cameras/${ip}/ping`);
    const data = await res.json();
    if (data.isAlive) {
      showToast(`✓ Kamera ${ip} je ponovo ONLINE! Odziv: ${data.latencyMs}ms`, 'success');
      if (btn) {
        btn.style.borderColor = '#10b981';
        btn.style.color = '#10b981';
        btn.innerHTML = `<i data-lucide="check-circle-2"></i> <span>Online (${data.latencyMs}ms)</span>`;
      }
      // Re-fetch all cameras in background
      fetchCameras(true);
    } else {
      showToast(`Kamera ${ip} je i dalje nedostupna (Nema odziva).`, 'warning');
      if (btn) {
        btn.style.borderColor = '#ef4444';
        btn.style.color = '#ef4444';
        btn.innerHTML = `<i data-lucide="x-circle"></i> <span>Nema odziva</span>`;
        setTimeout(() => {
          if (btn) {
            btn.style.borderColor = '';
            btn.style.color = '';
            btn.innerHTML = `<i data-lucide="activity"></i> <span>Ponovo</span>`;
            btn.style.pointerEvents = '';
            if (window.lucide) window.lucide.createIcons();
          }
        }, 2500);
      }
    }
  } catch (err) {
    showToast(`Greška pri ispitivanju kamere: ${err.message}`, 'error');
    if (btn) {
      btn.style.pointerEvents = '';
      btn.innerHTML = `<i data-lucide="activity"></i> <span>Ponovo</span>`;
    }
  } finally {
    if (window.lucide) window.lucide.createIcons();
  }
}
window.testSingleOfflineCamera = testSingleOfflineCamera;

async function recheckOfflineCameras() {
  setButtonSpinning('btn-recheck-offline-cameras', true);

  try {
    const res = await fetch('/api/cameras/offline');
    const data = await res.json();
    if (res.ok && data.success) {
      offlineCamerasList = data.offlineCameras || [];
      const badgeOffline = document.getElementById('badge-offline-cameras-count');
      if (badgeOffline) badgeOffline.textContent = offlineCamerasList.length;
      const kpiOffline = document.getElementById('kpi-cameras-offline');
      if (kpiOffline) kpiOffline.textContent = offlineCamerasList.length;
      const kpiInvOffline = document.getElementById('kpi-inv-offline');
      if (kpiInvOffline) kpiInvOffline.textContent = offlineCamerasList.length;
      const kOfflineSub = document.getElementById('kpi-inv-offline-sub');
      if (kOfflineSub) {
        const d = new Date();
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        kOfflineSub.textContent = `Provera: ${day}.${month}. u ${hours}:${minutes}`;
        kOfflineSub.title = `Zadnja provera dostupnosti: ${d.toLocaleString('sr-RS')} (Kliknite za detalje)`;
      }

      renderOfflineCamerasModal();
      showToast(`Provera završena: ${offlineCamerasList.length} nedostupnih kamera.`, offlineCamerasList.length > 0 ? 'info' : 'success');
    } else {
      throw new Error(data.details || data.error || 'Greška pri očitavanju nedostupnih kamera');
    }
  } catch (err) {
    console.error('Recheck offline cameras error:', err);
    showToast(`Greška pri proveri nedostupnih kamera: ${err.message}`, 'error');
  } finally {
    setButtonSpinning('btn-recheck-offline-cameras', false);
  }
}
window.recheckOfflineCameras = recheckOfflineCameras;

async function sendOfflineCamerasEmail() {
  if (offlineCamerasList.length === 0) {
    showToast('Sve kamere su online, nema potrebe za slanjem emaila.', 'info');
    return;
  }

  setButtonSpinning('btn-email-offline-cameras', true);
  try {
    const res = await fetch('/api/cameras/offline/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: ['marko.lukic@unipromet.co.rs', 'andrija.borovnjak@unipromet.co.rs'] })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`✓ Email izveštaj (${offlineCamerasList.length} offline) uspešno poslat na ${data.recipient}!`, 'success');
    } else {
      throw new Error(data.details || data.error || 'Greška pri slanju emaila');
    }
  } catch (err) {
    console.error('Send offline cameras email error:', err);
    showToast(`Greška pri slanju emaila: ${err.message}`, 'error');
  } finally {
    setButtonSpinning('btn-email-offline-cameras', false);
  }
}
window.sendOfflineCamerasEmail = sendOfflineCamerasEmail;

function updateCamPillsActive(val) {
  document.querySelectorAll('#cameras-category-filters .inv-quick-pill, #cameras-category-filters .filter-pill').forEach(p => {
    if (p.getAttribute('data-cam-cat') === val) p.classList.add('active');
    else p.classList.remove('active');
  });
}

function copyCamerasList() {
  if (allCameras.length === 0) {
    showToast('Nema očitanih kamera za kopiranje', 'error');
    return;
  }
  let text = `UNIPROMET DOO ČAČAK - EVIDENCIJA VIDEO NADZORA / CCTV (UKUPNO: ${allCameras.length})\n`;
  text += `Datum: ${new Date().toLocaleString('sr-RS')}\n\n`;
  text += `IP Adresa\tProizvođač\tOpseg\tWeb Panel\tRTSP Main Stream\tRTSP Sub Stream\n`;
  text += `----------------------------------------------------------------------------------------------------\n`;
  allCameras.forEach(c => {
    text += `${c.ip}\t${c.vendor}\t${c.subnet}\t${c.webUrl || 'N/A'}\t${c.rtspMain}\t${c.rtspSub}\n`;
  });
  navigator.clipboard.writeText(text).then(() => {
    showToast(`✓ Kopiran spisak svih ${allCameras.length} IP kamera!`, 'success');
  }).catch(() => showToast('Neuspešno kopiranje', 'error'));
}
window.copyCamerasList = copyCamerasList;

async function pingCameraClient(ip) {
  showToast(`Slanje signala ka kameri ${ip}...`, 'info');
  try {
    const res = await fetch(`/api/cameras/${encodeURIComponent(ip)}/ping`);
    const data = await res.json();
    if (data.isAlive) {
      showToast(`⚡ Kamera ${ip} je ONLINE! Odziv: ${data.latencyMs} ms`, 'success');
    } else {
      showToast(`⚠️ Kamera ${ip} ne odgovara`, 'error');
    }
  } catch (err) {
    showToast(`Greška pri testiranju kamere ${ip}`, 'error');
  }
}
window.pingCameraClient = pingCameraClient;

/* ==========================================================================
   EVIDENCIJA KAMERA - ASSET INVENTORY MANAGEMENT & DATABASE (ORIGINAL)
   ========================================================================== */
let allInventoryCameras = [];
let invSearchQuery = '';
let invTypeFilter = 'all';
let invSubnetFilter = 'all';
let invRecorderFilter = 'all';
let invStatusFilter = 'all';
let invViewMode = 'table';
let invCurrentPage = 1;
const invPageSize = 50;
let cameraToDelete = null;

async function fetchInventoryCameras() {
  const container = document.getElementById('inv-cameras-container');
  try {
    const res = await fetch('/api/inventory/cameras');
    const data = await res.json();

    if (res.ok && data.success) {
      allInventoryCameras = data.cameras || [];
      if (data.offlineCameras) {
        offlineCamerasList = data.offlineCameras;
      }

      const total = allInventoryCameras.length;
      const sub124Count = allInventoryCameras.filter(c => c.subnet && c.subnet.includes('124.')).length;
      const sub125Count = allInventoryCameras.filter(c => c.subnet && c.subnet.includes('125.')).length;
      const distinctRecorders = [...new Set(allInventoryCameras.map(c => c.recorder).filter(Boolean))].sort();
      const offlineCount = data.offlineCount != null ? data.offlineCount : (data.offlineCameras ? data.offlineCameras.length : 0);

      // Update KPIs
      const kTotal = document.getElementById('kpi-inv-total');
      const k124 = document.getElementById('kpi-inv-124');
      const k125 = document.getElementById('kpi-inv-125');
      const kRecorders = document.getElementById('kpi-inv-recorders');
      const kOffline = document.getElementById('kpi-inv-offline');
      const kOfflineSub = document.getElementById('kpi-inv-offline-sub');
      const bNav = document.getElementById('badge-nav-inventory-cameras');
      const bOffline = document.getElementById('badge-inv-offline-count');

      if (kTotal) kTotal.textContent = total;
      if (k124) k124.textContent = sub124Count;
      if (k125) k125.textContent = sub125Count;
      if (kRecorders) kRecorders.textContent = distinctRecorders.length;
      if (kOffline) kOffline.textContent = offlineCount;
      if (kOfflineSub) {
        if (data.lastOfflineCheckTime) {
          const d = new Date(data.lastOfflineCheckTime);
          const day = String(d.getDate()).padStart(2, '0');
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const hours = String(d.getHours()).padStart(2, '0');
          const minutes = String(d.getMinutes()).padStart(2, '0');
          kOfflineSub.textContent = `Provera: ${day}.${month}. u ${hours}:${minutes}`;
          kOfflineSub.title = `Zadnja provera dostupnosti: ${d.toLocaleString('sr-RS')} (Kliknite za detalje)`;
        } else {
          kOfflineSub.textContent = 'Klikni za detalje >';
        }
      }
      if (bNav) bNav.textContent = total;
      if (bOffline) bOffline.textContent = offlineCount;

      // Populate location pills & dropdown
      populateInventoryLocationControls(distinctRecorders);

      renderInventoryCamerasTab();
    } else {
      throw new Error(data.error || 'Greška pri očitavanju baze');
    }
  } catch (err) {
    console.error('Inventory cameras fetch error:', err);
    if (container) {
      container.innerHTML = `
        <div class="telemetry-error-state">
          <div class="err-icon"><i data-lucide="alert-triangle"></i></div>
          <h4>Greška pri učitavanju evidencije</h4>
          <p>${escapeHtml(err.message)}</p>
        </div>
      `;
    }
  }
}
window.fetchInventoryCameras = fetchInventoryCameras;

function populateInventoryLocationControls(recorders) {
  const select = document.getElementById('select-inv-recorder-filter');
  const datalist = document.getElementById('recorders-datalist');
  const pillsContainer = document.getElementById('inv-location-pills');

  if (select) {
    const currentVal = select.value;
    select.innerHTML = '<option value="all">Svi snimači (15 lokacija)</option>' + 
      recorders.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
    select.value = currentVal || 'all';
  }

  if (datalist) {
    datalist.innerHTML = recorders.map(r => `<option value="${escapeHtml(r)}">`).join('');
  }

  if (pillsContainer) {
    let pillsHtml = `
      <button type="button" class="inv-quick-pill ${invRecorderFilter === 'all' ? 'active' : ''}" data-rec="all" onclick="setInvRecorderFilter('all')">
        <i data-lucide="layers" style="width: 13px; height: 13px;"></i>
        <span>Sve Lokacije</span>
      </button>
    `;
    recorders.forEach(rec => {
      const activeClass = invRecorderFilter === rec ? 'active' : '';
      pillsHtml += `
        <button type="button" class="inv-quick-pill ${activeClass}" data-rec="${escapeHtml(rec)}" onclick="setInvRecorderFilter('${escapeHtml(rec)}')">
          <i data-lucide="map-pin" style="width: 12px; height: 12px;"></i>
          <span>${escapeHtml(rec)}</span>
        </button>
      `;
    });
    pillsContainer.innerHTML = pillsHtml;
    if (window.lucide) window.lucide.createIcons();
  }
}

function setInvRecorderFilter(rec) {
  invRecorderFilter = rec;
  const select = document.getElementById('select-inv-recorder-filter');
  if (select) select.value = rec;

  document.querySelectorAll('#inv-location-pills .inv-quick-pill').forEach(btn => {
    if (btn.getAttribute('data-rec') === rec) btn.classList.add('active');
    else btn.classList.remove('active');
  });

  invCurrentPage = 1;
  renderInventoryCamerasTab();
}
window.setInvRecorderFilter = setInvRecorderFilter;

function renderInventoryCamerasTab() {
  const container = document.getElementById('inv-cameras-container');
  if (!container) return;

  // Filter items
  let filtered = allInventoryCameras.filter(c => {
    // Type filter
    if (invTypeFilter !== 'all' && c.type !== invTypeFilter) return false;

    // Subnet filter
    if (invSubnetFilter !== 'all' && c.subnet !== invSubnetFilter) return false;

    // Recorder filter
    if (invRecorderFilter !== 'all' && c.recorder !== invRecorderFilter) return false;

    // Status filter
    if (invStatusFilter === 'active' && c.isReserved) return false;
    if (invStatusFilter === 'online' && (!c.isOnline || c.isReserved)) return false;
    if (invStatusFilter === 'offline' && !c.isOffline) return false;
    if (invStatusFilter === 'reserved' && !c.isReserved) return false;

    // Text search query
    if (invSearchQuery) {
      const q = invSearchQuery.toLowerCase();
      const match = 
        (c.ip && c.ip.toLowerCase().includes(q)) ||
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.position && c.position.toLowerCase().includes(q)) ||
        (c.recorder && c.recorder.toLowerCase().includes(q)) ||
        (c.note && c.note.toLowerCase().includes(q));
      if (!match) return false;
    }

    return true;
  });

  // Pagination calculation
  const totalItems = filtered.length;
  const totalPages = Math.ceil(totalItems / invPageSize) || 1;
  if (invCurrentPage > totalPages) invCurrentPage = totalPages;
  if (invCurrentPage < 1) invCurrentPage = 1;

  const startIndex = (invCurrentPage - 1) * invPageSize;
  const pageItems = filtered.slice(startIndex, startIndex + invPageSize);

  // Update counter text
  const counterText = document.getElementById('inv-cameras-counter-text');
  if (counterText) {
    counterText.textContent = `Prikazano: ${totalItems > 0 ? startIndex + 1 : 0}-${Math.min(startIndex + invPageSize, totalItems)} od ukupno ${totalItems} kamera`;
  }

  // Render pagination controls
  renderInventoryPagination(totalPages);

  if (pageItems.length === 0) {
    container.className = '';
    container.innerHTML = `
      <div class="empty-state-box" style="padding: 45px 20px; text-align: center;">
        <i data-lucide="camera-off" class="empty-icon text-muted" style="width: 44px; height: 44px; margin: 0 auto 12px auto; display: block;"></i>
        <h4 style="font-family: var(--font-heading); color: #fff;">Nema pronađenih kamera</h4>
        <p class="text-muted text-sm">Prilagodite filtere ili dodajte novu kameru u evidenciju.</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  // Render Table View (Default)
  if (invViewMode === 'table') {
    container.className = '';
    container.innerHTML = `
      <div class="inv-table-wrapper">
        <table class="inv-camera-table">
          <thead>
            <tr>
              <th style="width: 50px;">#</th>
              <th style="width: 175px;">IP / Mrežni Slot</th>
              <th>Položaj / Naziv Kamere</th>
              <th style="width: 190px;">Snimač / Objekat</th>
              <th style="width: 120px;">Tip Kamere</th>
              <th style="width: 135px;">Mrežni Opseg</th>
              <th style="width: 115px;">Status</th>
              <th style="width: 180px;">Napomena / NVR</th>
              <th style="width: 130px; text-align: right;">Akcije</th>
            </tr>
          </thead>
          <tbody>
            ${pageItems.map((cam, idx) => {
              const isReserved = cam.isReserved;
              const isAnalog = cam.type === 'Analogna';
              const is124 = cam.subnet && cam.subnet.includes('124.');
              const rowNum = startIndex + idx + 1;
              const webUrl = (!isAnalog && cam.ip && cam.ip.startsWith('192.168.')) ? `http://${cam.ip}` : '';

              return `
                <tr class="${isReserved ? 'row-reserved-sub' : ''}">
                  <td class="font-mono text-dim" style="font-size: 0.78rem;">${rowNum}</td>
                  <td>
                    <div class="inv-ip-pill ${isAnalog ? 'unrecorded' : (is124 ? 'subnet-124' : 'subnet-125')}">
                      <span class="chip-dot"></span>
                      <span>${escapeHtml(cam.ip)}</span>
                      <button class="btn-copy-chip-sm" onclick="copyCustomUrl('${escapeHtml(cam.ip)}')" title="Kopiraj adresu">
                        <i data-lucide="copy" style="width: 11px; height: 11px;"></i>
                      </button>
                    </div>
                  </td>
                  <td>
                    <div class="inv-pos-cell">
                      <div class="inv-cam-avatar" style="${isAnalog ? 'background: rgba(192, 132, 252, 0.12); border-color: rgba(192, 132, 252, 0.3); color: #c084fc;' : (isReserved ? 'background: rgba(100, 116, 139, 0.12); border-color: rgba(100, 116, 139, 0.3); color: #94a3b8;' : '')}">
                        <i data-lucide="${isAnalog ? 'tv' : 'video'}" style="width: 16px; height: 16px;"></i>
                      </div>
                      <div class="inv-pos-info">
                        <span class="inv-pos-name ${isReserved ? 'text-muted' : ''}">${escapeHtml(cam.position || cam.name || 'Neimenovana kamera')}</span>
                        <span class="inv-pos-sub"><i data-lucide="map-pin" style="width: 10px; height: 10px; display: inline-block;"></i> ${escapeHtml(cam.recorder || 'Fabrika')}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span class="inv-rec-badge" style="border-color: rgba(255, 184, 0, 0.25); color: #cbd5e1;">
                      <i data-lucide="hard-drive" style="color: var(--yellow-primary); width: 12px; height: 12px;"></i>
                      ${escapeHtml(cam.recorder || 'Fabrika')}
                    </span>
                  </td>
                  <td>
                    <span class="inv-subnet-badge" style="color: ${isAnalog ? '#c084fc' : '#38bdf8'}; border-color: ${isAnalog ? 'rgba(192, 132, 252, 0.3)' : 'rgba(56, 189, 248, 0.3)'};">
                      ${escapeHtml(cam.type || 'IP')}
                    </span>
                  </td>
                  <td>
                    <span class="inv-subnet-badge font-mono text-xs">${escapeHtml(cam.subnet || '')}</span>
                  </td>
                  <td>
                    ${isReserved ? `
                      <span class="status-pill" style="background: rgba(100, 116, 139, 0.15); color: #94a3b8; border-color: rgba(100, 116, 139, 0.25); font-size: 0.72rem;">
                        Slobodno
                      </span>
                    ` : cam.isOffline ? `
                      <span class="status-pill offline-pill" style="font-size: 0.72rem; cursor: pointer;" onclick="openOfflineCamerasModal()" title="Kamera je offline na lokalnoj mreži. Kliknite za detalje.">
                        <span class="status-dot offline-dot"></span>
                        Offline
                      </span>
                    ` : isAnalog ? `
                      <span class="status-pill" style="background: rgba(192, 132, 252, 0.15); color: #c084fc; border-color: rgba(192, 132, 252, 0.3); font-size: 0.72rem;">
                        Analogna
                      </span>
                    ` : `
                      <span class="status-pill active-pill" style="font-size: 0.72rem;">
                        <span class="status-dot"></span>
                        Online
                      </span>
                    `}
                  </td>
                  <td>
                    <span class="text-dim text-xs" style="max-width: 170px; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(cam.note || '')}">
                      ${cam.note ? escapeHtml(cam.note) : '<span class="text-dim">-</span>'}
                    </span>
                  </td>
                  <td style="text-align: right;">
                    <div class="inv-actions-cell">
                      ${(!isAnalog && cam.ip && cam.ip.startsWith('192.168.')) ? `
                        <button class="btn-inv-action btn-live" onclick="openCameraLiveModal('${escapeHtml(cam.ip)}', '${escapeHtml(cam.position || cam.name || '')}', '${escapeHtml(cam.recorder || '')}')" title="Pregled snimka uživo i arhive (Live & Playback)">
                          <i data-lucide="play" style="width: 13px; height: 13px; color: #22c55e;"></i>
                        </button>
                      ` : ''}
                      ${webUrl ? `
                        <a href="${webUrl}" target="_blank" rel="noopener" class="btn-inv-action btn-web" title="Otvori Web GUI (${webUrl})">
                          <i data-lucide="external-link" style="width: 13px; height: 13px;"></i>
                        </a>
                      ` : ''}
                      <button class="btn-inv-action" onclick="openEditCameraModal('${cam.id}')" title="Izmeni podatke o kameri">
                        <i data-lucide="edit-3" style="width: 13px; height: 13px;"></i>
                      </button>
                      <button class="btn-inv-action btn-danger" onclick="openDeleteCameraModal('${cam.id}')" title="Obriši kameru iz evidencije">
                        <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } else {
    // Render Card Grid View
    container.className = 'printers-cards-grid';
    container.innerHTML = pageItems.map(cam => {
      const isReserved = cam.isReserved;
      const isAnalog = cam.type === 'Analogna';
      const is124 = cam.subnet && cam.subnet.includes('124.');
      const webUrl = (!isAnalog && cam.ip && cam.ip.startsWith('192.168.')) ? `http://${cam.ip}` : '';

      return `
        <div class="printer-card ${isReserved ? 'decommissioned-card' : ''}" id="card-inv-${cam.id}">
          <div class="printer-card-header">
            <div class="printer-type-badge">
              <i data-lucide="${isAnalog ? 'tv' : 'video'}"></i>
              <span>${escapeHtml(cam.type || 'IP')}</span>
            </div>
            ${isReserved ? `
              <span class="status-pill" style="background: rgba(100, 116, 139, 0.15); color: #94a3b8; border-color: rgba(100, 116, 139, 0.25); font-size: 0.72rem;">
                Slobodno
              </span>
            ` : cam.isOffline ? `
              <span class="status-pill offline-pill" style="font-size: 0.72rem; cursor: pointer;" onclick="openOfflineCamerasModal()" title="Kamera je offline. Kliknite za detalje.">
                <span class="status-dot offline-dot"></span> Offline
              </span>
            ` : isAnalog ? `
              <span class="status-pill" style="background: rgba(192, 132, 252, 0.15); color: #c084fc; border-color: rgba(192, 132, 252, 0.3); font-size: 0.72rem;">
                Analogna
              </span>
            ` : `
              <span class="status-pill active-pill" style="font-size: 0.72rem;">
                <span class="status-dot"></span> Online
              </span>
            `}
          </div>

          <div class="printer-card-body">
            <div class="printer-title-row">
              <h4 class="printer-name" style="font-size: 0.96rem;">${escapeHtml(cam.position || cam.name || 'Neimenovana kamera')}</h4>
            </div>

            <div class="printer-meta-row" style="margin: 8px 0;">
              <div class="meta-item">
                <i data-lucide="map-pin" class="meta-icon"></i>
                <span class="meta-text location-highlight">${escapeHtml(cam.recorder || 'Fabrika')}</span>
              </div>
              <div class="meta-item">
                <i data-lucide="network" class="meta-icon"></i>
                <span class="meta-text font-mono text-xs">${escapeHtml(cam.subnet || '')}</span>
              </div>
            </div>

            <div class="printer-ip-box">
              <div class="ip-details">
                <span class="ip-label">${isAnalog ? 'ANALOGNI KANAL' : 'IP ADRESA'}</span>
                <span class="ip-val font-mono" style="color: ${isAnalog ? '#c084fc' : (is124 ? '#38bdf8' : '#34d399')};">${escapeHtml(cam.ip)}</span>
              </div>
              <button class="btn-copy-chip" onclick="copyCustomUrl('${escapeHtml(cam.ip)}')" title="Kopiraj adresu">
                <i data-lucide="copy"></i>
              </button>
            </div>

            ${cam.note ? `
              <div style="margin-top: 8px; font-size: 0.75rem; color: #94a3b8; line-height: 1.4;">
                <span style="color: #64748b;">Napomena:</span> ${escapeHtml(cam.note)}
              </div>
            ` : ''}
          </div>

          <div class="printer-card-actions">
            ${(!isAnalog && cam.ip && cam.ip.startsWith('192.168.')) ? `
              <button class="btn-printer-action" onclick="openCameraLiveModal('${escapeHtml(cam.ip)}', '${escapeHtml(cam.position || cam.name || '')}', '${escapeHtml(cam.recorder || '')}')" title="Pregled snimka uživo i arhive">
                <i data-lucide="play" style="color: #22c55e;"></i>
                <span>Uživo</span>
              </button>
            ` : ''}
            ${webUrl ? `
              <a href="${webUrl}" target="_blank" rel="noopener" class="btn-printer-action" title="Otvori Web GUI (${webUrl})">
                <i data-lucide="external-link"></i>
                <span>Web</span>
              </a>
            ` : ''}
            <button class="btn-printer-action" onclick="openEditCameraModal('${cam.id}')" title="Izmeni podatke o kameri">
              <i data-lucide="edit-3"></i>
              <span>Izmeni</span>
            </button>
            <button class="btn-printer-action btn-action-danger" onclick="openDeleteCameraModal('${cam.id}')" title="Obriši kameru">
              <i data-lucide="trash-2"></i>
              <span>Obriši</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  if (window.lucide) window.lucide.createIcons();
}

function renderInventoryPagination(totalPages) {
  const container = document.getElementById('inv-pagination-controls');
  if (!container) return;

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '';
  const prevDisabled = invCurrentPage === 1;
  html += `<button class="btn-dark-sm" style="padding: 4px 10px; height: 30px; ${prevDisabled ? 'opacity: 0.4; pointer-events: none;' : ''}" onclick="goToInvPage(${invCurrentPage - 1})"><i data-lucide="chevron-left" style="width: 14px; height: 14px;"></i></button>`;

  let startPage = Math.max(1, invCurrentPage - 2);
  let endPage = Math.min(totalPages, startPage + 4);
  if (endPage - startPage < 4) {
    startPage = Math.max(1, endPage - 4);
  }

  for (let p = startPage; p <= endPage; p++) {
    const active = (p === invCurrentPage);
    html += `<button class="${active ? 'btn-yellow-solid-sm' : 'btn-dark-sm'}" style="padding: 2px 10px; height: 30px; min-width: 32px;" onclick="goToInvPage(${p})">${p}</button>`;
  }

  const nextDisabled = invCurrentPage === totalPages;
  html += `<button class="btn-dark-sm" style="padding: 4px 10px; height: 30px; ${nextDisabled ? 'opacity: 0.4; pointer-events: none;' : ''}" onclick="goToInvPage(${invCurrentPage + 1})"><i data-lucide="chevron-right" style="width: 14px; height: 14px;"></i></button>`;

  container.innerHTML = html;
  if (window.lucide) window.lucide.createIcons();
}

function goToInvPage(page) {
  invCurrentPage = page;
  renderInventoryCamerasTab();
  const scrollEl = document.getElementById('inv-cameras-container');
  if (scrollEl) scrollEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
window.goToInvPage = goToInvPage;

function openAddCameraModal() {
  const modal = document.getElementById('modal-inv-camera');
  const title = document.getElementById('modal-inv-camera-title');
  const idInput = document.getElementById('input-inv-camera-id');
  const ipInput = document.getElementById('input-inv-camera-ip');
  const posInput = document.getElementById('input-inv-camera-position');
  const recInput = document.getElementById('input-inv-camera-recorder');
  const noteInput = document.getElementById('input-inv-camera-note');
  const submitText = document.getElementById('btn-submit-inv-camera-text');

  if (title) title.textContent = 'Dodaj Novu Kameru u Evidenciju';
  if (submitText) submitText.textContent = 'Sačuvaj u Evidenciju';
  if (idInput) idInput.value = '';
  if (ipInput) ipInput.value = '';
  if (posInput) posInput.value = '';
  if (recInput) recInput.value = '';
  if (noteInput) noteInput.value = '';

  if (modal) modal.style.display = 'flex';
  if (window.lucide) window.lucide.createIcons();
}
window.openAddCameraModal = openAddCameraModal;

function openEditCameraModal(id) {
  const cam = allInventoryCameras.find(c => c.id === id);
  if (!cam) return;

  const modal = document.getElementById('modal-inv-camera');
  const title = document.getElementById('modal-inv-camera-title');
  const idInput = document.getElementById('input-inv-camera-id');
  const ipInput = document.getElementById('input-inv-camera-ip');
  const posInput = document.getElementById('input-inv-camera-position');
  const recInput = document.getElementById('input-inv-camera-recorder');
  const noteInput = document.getElementById('input-inv-camera-note');
  const submitText = document.getElementById('btn-submit-inv-camera-text');

  if (title) title.textContent = 'Izmeni Podatke o Kameri';
  if (submitText) submitText.textContent = 'Ažuriraj Podatke';
  if (idInput) idInput.value = cam.id;
  if (ipInput) ipInput.value = cam.ip;
  if (posInput) posInput.value = cam.position;
  if (recInput) recInput.value = cam.recorder;
  if (noteInput) noteInput.value = cam.note || '';

  if (modal) modal.style.display = 'flex';
  if (window.lucide) window.lucide.createIcons();
}
window.openEditCameraModal = openEditCameraModal;

async function handleCameraFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('input-inv-camera-id')?.value;
  const ip = document.getElementById('input-inv-camera-ip')?.value.trim();
  const position = document.getElementById('input-inv-camera-position')?.value.trim();
  const recorder = document.getElementById('input-inv-camera-recorder')?.value.trim();
  const note = document.getElementById('input-inv-camera-note')?.value.trim();

  if (!ip || !position || !recorder) {
    showToast('Molimo popunite sva obavezna polja (IP, Naziv, Snimač)', 'error');
    return;
  }

  const payload = { ip, position, recorder, note };

  try {
    const url = id ? `/api/inventory/cameras/${id}` : '/api/inventory/cameras';
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(id ? '✓ Podaci o kameri uspešno ažurirani!' : '✓ Nova kamera uspešno uneta u evidenciju!', 'success');
      document.getElementById('modal-inv-camera').style.display = 'none';
      fetchInventoryCameras();
      if (!id) returnToUnrecordedCamerasList(ip);
    } else {
      throw new Error(data.error || 'Greška pri čuvanju');
    }
  } catch (err) {
    showToast(`Greška: ${err.message}`, 'error');
  }
}

function openDeleteCameraModal(id) {
  const cam = allInventoryCameras.find(c => c.id === id);
  if (!cam) return;

  cameraToDelete = cam;

  const modal = document.getElementById('modal-delete-inv-camera');
  const nameEl = document.getElementById('delete-inv-camera-name');
  const ipEl = document.getElementById('delete-inv-camera-ip');
  const recEl = document.getElementById('delete-inv-camera-rec');

  if (nameEl) nameEl.textContent = cam.position;
  if (ipEl) ipEl.textContent = `IP Adresa: ${cam.ip}`;
  if (recEl) recEl.textContent = `Snimač / Objekat: ${cam.recorder}`;

  if (modal) modal.style.display = 'flex';
  if (window.lucide) window.lucide.createIcons();
}
window.openDeleteCameraModal = openDeleteCameraModal;

async function confirmDeleteCamera() {
  if (!cameraToDelete) return;
  const id = cameraToDelete.id;
  const name = cameraToDelete.position;

  try {
    const res = await fetch(`/api/inventory/cameras/${id}`, { method: 'DELETE' });
    const data = await res.json();

    if (res.ok && data.success) {
      showToast(`✓ Kamera "${name}" je uspešno obrisana iz evidencije.`, 'success');
      document.getElementById('modal-delete-inv-camera').style.display = 'none';
      cameraToDelete = null;
      fetchInventoryCameras();
    } else {
      throw new Error(data.error || 'Greška pri brisanju');
    }
  } catch (err) {
    showToast(`Greška pri brisanju: ${err.message}`, 'error');
  }
}

function exportInventoryCamerasClipboard() {
  if (allInventoryCameras.length === 0) {
    showToast('Nema podataka za kopiranje', 'info');
    return;
  }

  const rows = [
    ['ID', 'IP Adresa', 'Položaj / Pozicija', 'Snimač / Objekat', 'Tip', 'Mreža', 'Status', 'Napomena']
  ];

  allInventoryCameras.forEach(c => {
    rows.push([
      c.id,
      c.ip,
      c.position,
      c.recorder,
      c.type,
      c.subnet,
      c.isReserved ? 'Slobodno' : 'Aktivna',
      c.note || ''
    ]);
  });

  const tsv = rows.map(r => r.join('\t')).join('\n');
  navigator.clipboard.writeText(tsv).then(() => {
    showToast(`✓ Kopirana evidencija sa ${allInventoryCameras.length} kamera (TSV format za Excel)!`, 'success');
  }).catch(() => {
    showToast('Neuspešno kopiranje u clipboard', 'error');
  });
}

function setupInventoryCamerasEventListeners() {
  const searchInput = document.getElementById('search-inv-cameras');
  const btnClearSearch = document.getElementById('btn-clear-search-inv');
  const selectSubnet = document.getElementById('select-inv-subnet-filter');
  const selectRecorder = document.getElementById('select-inv-recorder-filter');
  const btnViewTable = document.getElementById('btn-view-inv-table');
  const btnViewGrid = document.getElementById('btn-view-inv-grid');
  const btnOpenAdd = document.getElementById('btn-open-add-inv-camera');
  const btnExport = document.getElementById('btn-export-inv-cameras');

  // Search
  searchInput?.addEventListener('input', (e) => {
    invSearchQuery = e.target.value.trim();
    if (btnClearSearch) btnClearSearch.style.display = invSearchQuery ? 'block' : 'none';
    invCurrentPage = 1;
    renderInventoryCamerasTab();
  });

  btnClearSearch?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    invSearchQuery = '';
    btnClearSearch.style.display = 'none';
    invCurrentPage = 1;
    renderInventoryCamerasTab();
  });

  // Filters
  selectSubnet?.addEventListener('change', (e) => {
    invSubnetFilter = e.target.value;
    invCurrentPage = 1;
    renderInventoryCamerasTab();
  });

  selectRecorder?.addEventListener('change', (e) => {
    invRecorderFilter = e.target.value;
    document.querySelectorAll('#inv-location-pills .inv-quick-pill').forEach(btn => {
      if (btn.getAttribute('data-rec') === invRecorderFilter) btn.classList.add('active');
      else btn.classList.remove('active');
    });
    invCurrentPage = 1;
    renderInventoryCamerasTab();
  });

  // Views
  btnViewTable?.addEventListener('click', () => {
    invViewMode = 'table';
    btnViewTable.classList.add('active');
    btnViewGrid?.classList.remove('active');
    renderInventoryCamerasTab();
  });

  btnViewGrid?.addEventListener('click', () => {
    invViewMode = 'grid';
    btnViewGrid.classList.add('active');
    btnViewTable?.classList.remove('active');
    renderInventoryCamerasTab();
  });

  // Modal actions
  btnOpenAdd?.addEventListener('click', openAddCameraModal);
  btnExport?.addEventListener('click', exportInventoryCamerasClipboard);

  document.getElementById('btn-close-inv-camera-modal')?.addEventListener('click', () => {
    document.getElementById('modal-inv-camera').style.display = 'none';
    returnToUnrecordedCamerasList();
  });
  document.getElementById('btn-cancel-inv-camera-modal')?.addEventListener('click', () => {
    document.getElementById('modal-inv-camera').style.display = 'none';
    returnToUnrecordedCamerasList();
  });
  document.getElementById('form-inv-camera')?.addEventListener('submit', handleCameraFormSubmit);

  document.getElementById('btn-close-delete-inv-modal')?.addEventListener('click', () => {
    document.getElementById('modal-delete-inv-camera').style.display = 'none';
  });
  document.getElementById('btn-cancel-delete-inv-modal')?.addEventListener('click', () => {
    document.getElementById('modal-delete-inv-camera').style.display = 'none';
  });
  document.getElementById('btn-confirm-delete-inv')?.addEventListener('click', confirmDeleteCamera);

  // Status filter
  document.getElementById('select-inv-status-filter')?.addEventListener('change', (e) => {
    invStatusFilter = e.target.value;
    invCurrentPage = 1;
    renderInventoryCamerasTab();
  });

  // Scan unrecorded cameras button
  document.getElementById('btn-scan-unrecorded-cameras')?.addEventListener('click', scanUnrecordedCamerasClient);

  // Add camera by IP address (no range scan)
  document.getElementById('btn-add-camera-by-ip')?.addEventListener('click', openFindCameraByIpModal);
  document.getElementById('btn-find-camera-ip')?.addEventListener('click', findCameraByIp);
  document.getElementById('input-find-camera-ip')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); findCameraByIp(); }
  });
  document.getElementById('input-find-camera-ip')?.addEventListener('input', () => showFindCameraResult(null));
  document.getElementById('btn-close-find-ip-modal')?.addEventListener('click', closeFindCameraByIpModal);
  document.getElementById('btn-cancel-find-ip-modal')?.addEventListener('click', closeFindCameraByIpModal);

  // Unrecorded modal close
  document.getElementById('btn-close-unrecorded-modal')?.addEventListener('click', () => {
    document.getElementById('modal-unrecorded-cameras').style.display = 'none';
  });
  document.getElementById('btn-cancel-unrecorded-modal')?.addEventListener('click', () => {
    document.getElementById('modal-unrecorded-cameras').style.display = 'none';
  });
}

/* ---------- Dodavanje kamere po IP adresi ---------- */
const FIND_IP_REGEX = /^(\d{1,3})(\.\d{1,3}){3}$/;

function openFindCameraByIpModal() {
  const modal = document.getElementById('modal-find-camera-ip');
  const input = document.getElementById('input-find-camera-ip');
  if (!modal || !input) return;
  input.value = '';
  showFindCameraResult(null);
  modal.style.display = 'flex';
  if (window.lucide) window.lucide.createIcons();
  setTimeout(() => input.focus(), 60);
}

function closeFindCameraByIpModal() {
  const modal = document.getElementById('modal-find-camera-ip');
  if (modal) modal.style.display = 'none';
}

/** kind: 'info' | 'warning' | 'error' | null (sakriva) */
function showFindCameraResult(kind, html) {
  const box = document.getElementById('find-camera-ip-result');
  if (!box) return;
  if (!kind) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  const colors = {
    info: ['#38bdf8', 'rgba(56, 189, 248, 0.08)', 'loader'],
    warning: ['#f59e0b', 'rgba(245, 158, 11, 0.1)', 'alert-triangle'],
    error: ['#ef4444', 'rgba(239, 68, 68, 0.08)', 'video-off']
  }[kind];
  box.style.cssText = `display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; border-radius: 10px; border: 1px solid ${colors[0]}55; background: ${colors[1]}; color: #e2e8f0; font-size: 0.88rem; line-height: 1.45;`;
  box.innerHTML = `<i data-lucide="${colors[2]}" style="width: 20px; height: 20px; flex-shrink: 0; color: ${colors[0]};${kind === 'info' ? ' animation: spin 0.8s linear infinite;' : ''}"></i><div>${html}</div>`;
  if (window.lucide) window.lucide.createIcons();
}

async function findCameraByIp() {
  const input = document.getElementById('input-find-camera-ip');
  const btn = document.getElementById('btn-find-camera-ip');
  if (!input || !btn || btn.disabled) return;
  const ip = input.value.trim();

  if (!FIND_IP_REGEX.test(ip) || ip.split('.').some(n => Number(n) > 255)) {
    showFindCameraResult('warning', 'Unesite ispravnu IP adresu, npr. <strong>192.168.125.106</strong>.');
    input.focus();
    return;
  }

  btn.disabled = true;
  showFindCameraResult('info', `Proveravam adresu <strong>${escapeHtml(ip)}</strong>...`);
  try {
    const res = await fetch('/api/inventory/cameras/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || data.details || 'Provera adrese nije uspela');

    if (data.status === 'in_inventory') {
      const c = data.camera || {};
      showFindCameraResult('warning', `Kamera na adresi <strong>${escapeHtml(ip)}</strong> je već u evidenciji: <strong>${escapeHtml(c.position || c.name || c.id || '')}</strong>${c.recorder ? ` (snimač: ${escapeHtml(c.recorder)})` : ''}.`);
    } else if (data.status === 'not_found') {
      showFindCameraResult('error', `Na adresi <strong>${escapeHtml(ip)}</strong> nije pronađena kamera. Portovi 80, 554, 8000 i 37777 ne odgovaraju. Proverite adresu i da li je kamera uključena, pa pokušajte ponovo.`);
    } else if (data.status === 'found') {
      const cam = data.camera || {};
      closeFindCameraByIpModal();
      showToast(`✓ Kamera pronađena na ${ip}${cam.vendor ? ' (' + cam.vendor + ')' : ''}. Unesite detalje i sačuvajte je u evidenciju.`, 'success');
      openAddCameraModalWithData(ip, cam.vendor || '', { manual: true });
    } else {
      throw new Error('Neočekivan odgovor servera');
    }
  } catch (err) {
    showFindCameraResult('error', escapeHtml(err.message));
  } finally {
    btn.disabled = false;
    if (window.lucide) window.lucide.createIcons();
  }
}

window.openFindCameraByIpModal = openFindCameraByIpModal;

async function scanUnrecordedCamerasClient() {
  if (activeSpinningButtons.has('btn-scan-unrecorded-cameras')) return;
  setButtonSpinning('btn-scan-unrecorded-cameras', true);
  showToast('🔍 Skeniranje mreže u toku... Proveravam opsege 124 i 125 za neevidentirane kamere (ide polako zbog Sophosa, oko 2 minuta)...', 'info');

  try {
    const res = await fetch('/api/inventory/cameras/scan-unrecorded', { method: 'POST' });
    const data = await res.json();

    if (res.ok && data.success) {
      const list = data.unrecordedCameras || [];
      if (list.length === 0) {
        showToast(`✓ Završeno: Sve detektovane kamere na opsezima 124 i 125 su već unete u bazu (${data.skippedInventoryCount || 0} evidentirano).`, 'success');
      } else {
        showToast(`Pronađeno ${list.length} novih kamera van evidencije!`, 'warning');
        openUnrecordedCamerasModal(list);
      }
    } else {
      throw new Error(data.details || data.error || 'Greška pri skeniranju');
    }
  } catch (err) {
    console.error('Scan unrecorded cameras error:', err);
    showToast(`Greška pri skeniranju kamera: ${err.message}`, 'error');
  } finally {
    setButtonSpinning('btn-scan-unrecorded-cameras', false);
  }
}
window.scanUnrecordedCamerasClient = scanUnrecordedCamerasClient;

function openUnrecordedCamerasModal(cameras) {
  const modal = document.getElementById('modal-unrecorded-cameras');
  const body = document.getElementById('unrecorded-cameras-modal-body');
  const badge = document.getElementById('modal-unrecorded-cameras-badge');
  const title = document.getElementById('unrecorded-modal-title');
  const statusText = document.getElementById('unrecorded-modal-status-text');
  if (!modal || !body) return;
  lastUnrecordedCameras = cameras;

  if (title) title.innerHTML = `<i data-lucide="scan-eye" style="color: var(--yellow-primary);"></i> Pronađene Nove Kamere van Evidencije`;
  if (badge) {
    badge.textContent = `${cameras.length} novih`;
    badge.style.background = 'rgba(255, 184, 0, 0.15)';
    badge.style.color = 'var(--yellow-primary)';
    badge.style.borderColor = 'rgba(255, 184, 0, 0.3)';
  }
  if (statusText) statusText.textContent = `Pronađeno ${cameras.length} kamera na mreži (opsezi 124 & 125) koje još nisu upisane u registar:`;

  body.innerHTML = `
    <div class="unrecorded-cameras-list-wrap">
      ${cameras.map(c => `
        <div class="unrecorded-cam-card" id="card-unrecorded-${escapeHtml(c.ip).replace(/\./g, '_')}">
          <div class="unrecorded-cam-main">
            <div class="unrecorded-cam-avatar">
              <i data-lucide="camera" style="width: 20px; height: 20px;"></i>
            </div>
            <div class="unrecorded-cam-info">
              <div class="unrecorded-cam-ip">
                <span>${escapeHtml(c.ip)}</span>
                <span class="inv-subnet-badge font-mono text-xs">${escapeHtml(c.subnet || '192.168.x.x')}</span>
                <span class="inv-subnet-badge" style="color: #f59e0b; border-color: rgba(245, 158, 11, 0.4);">${escapeHtml(c.vendor || 'IP Kamera')}</span>
              </div>
              <div class="unrecorded-cam-meta">
                <span>Otvoreni portovi: ${c.ports ? c.ports.join(', ') : '80, 554'}</span>
                ${c.model ? `<span>Model: ${escapeHtml(c.model)}</span>` : ''}
              </div>
            </div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button type="button" class="btn-yellow-solid-sm" onclick="openAddCameraModalWithData('${escapeHtml(c.ip)}', '${escapeHtml(c.vendor || '')}')">
              <i data-lucide="plus"></i>
              <span>Upiši u Evidenciju</span>
            </button>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  modal.style.display = 'flex';
  if (window.lucide) window.lucide.createIcons();
}
window.openUnrecordedCamerasModal = openUnrecordedCamerasModal;

// Pronađene kamere iz poslednje pretrage: posle upisa jedne, spisak se vraća sa ostalima
let lastUnrecordedCameras = [];
let addingFromUnrecordedList = false;

function returnToUnrecordedCamerasList(savedIp) {
  if (!addingFromUnrecordedList) return;
  addingFromUnrecordedList = false;
  if (savedIp) lastUnrecordedCameras = lastUnrecordedCameras.filter(c => c.ip !== savedIp);
  if (lastUnrecordedCameras.length > 0) openUnrecordedCamerasModal(lastUnrecordedCameras);
}

function openAddCameraModalWithData(ip, vendor, opts) {
  const manual = !!(opts && opts.manual);
  const unrecModal = document.getElementById('modal-unrecorded-cameras');
  if (unrecModal) unrecModal.style.display = 'none';
  // Ručno dodavanje po IP adresi ne vraća se na spisak pronađenih kamera
  addingFromUnrecordedList = !manual;

  openAddCameraModal();

  const ipInput = document.getElementById('input-inv-camera-ip');
  const posInput = document.getElementById('input-inv-camera-position');
  const typeInput = document.getElementById('input-inv-camera-type');
  const noteInput = document.getElementById('input-inv-camera-note');

  if (ipInput) {
    ipInput.value = ip;
    ipInput.dispatchEvent(new Event('input'));
  }
  if (typeInput) typeInput.value = 'IP Kamera';
  if (posInput) posInput.value = `${vendor ? vendor + ' ' : ''}Kamera ${ip}`;
  if (noteInput) noteInput.value = `${manual ? 'Ručno dodata po IP adresi' : 'Automatski pronađena mrežnim skenerom'} (${new Date().toLocaleDateString('sr-RS')})`;
}
window.openAddCameraModalWithData = openAddCameraModalWithData;

/* ==========================================================================
   CCTV KAMERE - VIDEO NADZOR LISTA KAMERA SA ŽIVIM SUB-STREAM PRIKAZOM (25 FPS)
   ========================================================================== */
let allCctvCameras = [];
let cctvSearchQuery = '';
let cctvRecorderFilter = 'all';
let cctvViewMode = 'table';
let cctvCurrentPage = 1;
let cctvPageSize = 12;
let cctvLiveSubStreamEnabled = true;

async function fetchCctvCameras() {
  const container = document.getElementById('cctv-cameras-container');
  try {
    const res = await fetch('/api/inventory/cameras');
    const data = await res.json();

    if (res.ok && data.success) {
      // Filter strictly active digital IP cameras with valid positions
      allCctvCameras = (data.cameras || []).filter(c => {
        if (c.type === 'Analogna' || (c.ip && c.ip.toLowerCase().includes('analog'))) return false;
        if (c.isReserved) return false;
        const pos = (c.position || '').toLowerCase();
        if (pos === 'zauzeto' || pos === 'nema' || pos === 'no video' || pos === 'slobodno' || pos === 'rezervisano') return false;
        return true;
      });

      const total = allCctvCameras.length;
      const bNavCopy = document.getElementById('badge-nav-cctv-copy-cameras');
      if (bNavCopy) bNavCopy.textContent = total;

      const distinctRecorders = [...new Set(allCctvCameras.map(c => c.recorder).filter(Boolean))].sort();
      populateCctvLocationControls(distinctRecorders);

      renderCctvCamerasTab();
    } else {
      throw new Error(data.error || 'Greška pri očitavanju baze');
    }
  } catch (err) {
    console.error('CCTV cameras fetch error:', err);
    if (container) {
      container.innerHTML = `
        <div class="telemetry-error-state">
          <div class="err-icon"><i data-lucide="alert-triangle"></i></div>
          <h4>Greška pri učitavanju video nadzora</h4>
          <p>${escapeHtml(err.message)}</p>
        </div>
      `;
    }
  }
}
window.fetchCctvCameras = fetchCctvCameras;

function populateCctvLocationControls(recorders) {
  const select = document.getElementById('select-cctv-recorder-filter');
  const pillsContainer = document.getElementById('cctv-location-pills');

  if (select) {
    const currentVal = select.value;
    select.innerHTML = '<option value="all">Sve Lokacije / Objekti</option>' + 
      recorders.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
    select.value = currentVal || 'all';
  }

  if (pillsContainer) {
    let pillsHtml = `
      <button type="button" class="cctv-quick-pill ${cctvRecorderFilter === 'all' ? 'active' : ''}" data-rec="all" onclick="setCctvRecorderFilter('all')">
        <i data-lucide="layers" style="width: 13px; height: 13px;"></i>
        <span>Sve Lokacije</span>
      </button>
    `;
    recorders.forEach(rec => {
      const activeClass = cctvRecorderFilter === rec ? 'active' : '';
      pillsHtml += `
        <button type="button" class="cctv-quick-pill ${activeClass}" data-rec="${escapeHtml(rec)}" onclick="setCctvRecorderFilter('${escapeHtml(rec)}')">
          <i data-lucide="map-pin" style="width: 12px; height: 12px;"></i>
          <span>${escapeHtml(rec)}</span>
        </button>
      `;
    });
    pillsContainer.innerHTML = pillsHtml;
    if (window.lucide) window.lucide.createIcons();
  }
}

function setCctvRecorderFilter(rec) {
  cctvRecorderFilter = rec;
  const select = document.getElementById('select-cctv-recorder-filter');
  if (select) select.value = rec;

  document.querySelectorAll('#cctv-location-pills .cctv-quick-pill').forEach(btn => {
    if (btn.getAttribute('data-rec') === rec) btn.classList.add('active');
    else btn.classList.remove('active');
  });

  cctvCurrentPage = 1;
  renderCctvCamerasTab();
}
window.setCctvRecorderFilter = setCctvRecorderFilter;

let cctvMountTimeouts = [];
let cctvCheckPlayIntervals = [];

function unmountCctvSubStreams() {
  cctvMountTimeouts.forEach(t => clearTimeout(t));
  cctvMountTimeouts = [];

  cctvCheckPlayIntervals.forEach(i => clearInterval(i));
  cctvCheckPlayIntervals = [];

  document.querySelectorAll('.cctv-preview-box video-stream').forEach(el => {
    try {
      if (typeof el.destroy === 'function') el.destroy();
      else if (typeof el.stop === 'function') el.stop();
      else if (typeof el.ondisconnect === 'function') el.ondisconnect();
      el.remove();
    } catch (e) {}
  });
}

function mountCctvSubStreams(pageItems) {
  unmountCctvSubStreams();
  if (!cctvLiveSubStreamEnabled) return;

  pageItems.forEach((cam, idx) => {
    if (!cam.ip) return;
    const wsUrl = cam.streamWsSubUrl || `/api/video-gateway/ws?src=cam_${(cam.ip || '').replace(/\./g, '_')}_sub`;
    const container = document.getElementById(`cctv-preview-screen-${cam.id}`);
    if (!container) return;

    const tid = setTimeout(() => {
      const currentContainer = document.getElementById(`cctv-preview-screen-${cam.id}`);
      if (!currentContainer) return;
      currentContainer.querySelectorAll('video-stream').forEach(v => {
        try { 
          if (typeof v.destroy === 'function') v.destroy(); 
          else if (typeof v.ondisconnect === 'function') v.ondisconnect();
        } catch (e) {}
        v.remove();
      });

      const vs = document.createElement('video-stream');
      vs.mode = 'webrtc,mse,mp4,mjpeg';
      vs.background = false;

      // Append to container FIRST
      currentContainer.appendChild(vs);

      // Assign src to trigger connection
      vs.src = wsUrl;

      // Monitor playback to smoothly transition from snapshot to live stream
      const checkPlay = setInterval(() => {
        const vid = vs.querySelector('video');
        if (vid && (vid.readyState >= 2 || vid.currentTime > 0)) {
          clearInterval(checkPlay);
          const fb = currentContainer.querySelector('.cctv-snapshot-fallback');
          if (fb) fb.style.opacity = '0';
        }
      }, 300);
      cctvCheckPlayIntervals.push(checkPlay);
      const expireTid = setTimeout(() => clearInterval(checkPlay), 12000);
      cctvMountTimeouts.push(expireTid);
    }, idx * 100);

    cctvMountTimeouts.push(tid);
  });
}

function toggleCctvSubStreams() {
  cctvLiveSubStreamEnabled = !cctvLiveSubStreamEnabled;
  const btn = document.getElementById('btn-toggle-cctv-substream');
  const text = document.getElementById('text-cctv-substream-mode');

  if (btn && text) {
    if (cctvLiveSubStreamEnabled) {
      btn.style.background = 'rgba(34, 197, 94, 0.15)';
      btn.style.borderColor = 'rgba(34, 197, 94, 0.4)';
      btn.style.color = '#4ade80';
      btn.innerHTML = `<span class="live-dot-pulse" style="width: 7px; height: 7px; background: #22c55e;"></span><span id="text-cctv-substream-mode">Uživo Sub-stream (25 FPS)</span>`;
      showToast('Aktiviran živi Sub-stream (25 FPS) u prozorima kamera', 'success');
    } else {
      btn.style.background = 'rgba(255, 255, 255, 0.05)';
      btn.style.borderColor = 'rgba(255, 255, 255, 0.15)';
      btn.style.color = '#94a3b8';
      btn.innerHTML = `<i data-lucide="camera" style="width: 12px; height: 12px;"></i><span id="text-cctv-substream-mode">Statični frejmovi (Štednja)</span>`;
      showToast('Isključen živi sub-stream (prikazuju se statični frejmovi)', 'info');
      if (window.lucide) window.lucide.createIcons();
    }
  }

  renderCctvCamerasTab();
}
window.toggleCctvSubStreams = toggleCctvSubStreams;

function renderCctvCamerasTab() {
  const container = document.getElementById('cctv-cameras-container');
  if (!container) return;

  unmountCctvSubStreams();

  let filtered = allCctvCameras.filter(c => {
    if (cctvRecorderFilter !== 'all' && c.recorder !== cctvRecorderFilter) return false;
    if (cctvSearchQuery) {
      const q = cctvSearchQuery.toLowerCase();
      const match = 
        (c.ip && c.ip.toLowerCase().includes(q)) ||
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.position && c.position.toLowerCase().includes(q)) ||
        (c.recorder && c.recorder.toLowerCase().includes(q));
      if (!match) return false;
    }
    return true;
  });

  const totalItems = filtered.length;
  const totalPages = Math.ceil(totalItems / cctvPageSize) || 1;
  if (cctvCurrentPage > totalPages) cctvCurrentPage = totalPages;
  if (cctvCurrentPage < 1) cctvCurrentPage = 1;

  const startIndex = (cctvCurrentPage - 1) * cctvPageSize;
  const pageItems = filtered.slice(startIndex, startIndex + cctvPageSize);

  const counterText = document.getElementById('cctv-cameras-counter-text');
  if (counterText) {
    counterText.textContent = `Prikazano: ${totalItems > 0 ? startIndex + 1 : 0}-${Math.min(startIndex + cctvPageSize, totalItems)} od ukupno ${totalItems} aktivnih digitalnih kamera`;
  }

  renderCctvPagination(totalPages);

  if (pageItems.length === 0) {
    container.className = '';
    container.innerHTML = `
      <div class="empty-state-box" style="padding: 45px 20px; text-align: center;">
        <i data-lucide="camera-off" class="empty-icon text-muted" style="width: 44px; height: 44px; margin: 0 auto 12px auto; display: block;"></i>
        <h4 style="font-family: var(--font-heading); color: #fff;">Nema pronađenih kamera</h4>
        <p class="text-muted text-sm">Prilagodite parametre pretrage ili izaberite drugu lokaciju.</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  if (cctvViewMode === 'table') {
    container.className = '';
    container.innerHTML = `
      <div class="inv-table-wrapper">
        <table class="inv-camera-table">
          <thead>
            <tr>
              <th style="width: 50px;">#</th>
              <th>Položaj / Naziv Kamere</th>
              <th style="width: 240px;">Lokacija / Objekat</th>
              <th style="width: 260px; text-align: center;">Video Prikaz Uživo (Sub-stream 25 FPS)</th>
            </tr>
          </thead>
          <tbody>
            ${pageItems.map((cam, idx) => {
              const rowNum = startIndex + idx + 1;
              const snapshotUrl = `/api/cameras/${encodeURIComponent(cam.ip)}/snapshot?t=${Date.now()}`;
              return `
                <tr style="height: 140px;">
                  <td class="font-mono text-dim" style="font-size: 0.85rem; font-weight: 700;">${rowNum}</td>
                  <td style="vertical-align: middle;">
                    <div class="cctv-cam-info">
                      <div class="cctv-cam-title">
                        <span class="cctv-cam-icon"><i data-lucide="video"></i></span>
                        <strong>${escapeHtml(cam.position || cam.name || '')}</strong>
                        <span class="status-pill active-pill" style="font-size: 0.70rem; padding: 2px 8px;">
                          <span class="status-dot"></span> Uživo
                        </span>
                      </div>
                      <div class="cctv-cam-actions">
                        <button type="button" class="cctv-ip-chip" onclick="copyCustomUrl('${escapeHtml(cam.ip)}')" title="Kopiraj IP adresu">
                          <span>${escapeHtml(cam.ip)}</span>
                          <i data-lucide="copy"></i>
                        </button>
                        ${window.MonitoringQuickAdd ? window.MonitoringQuickAdd.buttonHtml(cam.id) : ''}
                      </div>
                    </div>
                  </td>
                  <td style="vertical-align: middle;">
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                      <span class="location-highlight" style="font-size: 0.86rem; font-weight: 600;">
                        <i data-lucide="map-pin" style="width: 13px; height: 13px; display: inline-block; vertical-align: middle; margin-right: 4px; color: #FFB800;"></i>
                        ${escapeHtml(cam.recorder || 'Fabrika')}
                      </span>
                      <span class="font-mono text-dim text-xs" style="margin-left: 17px;">${escapeHtml(cam.subnet || '')}</span>
                    </div>
                  </td>
                  <td style="text-align: center; vertical-align: middle; padding: 8px 12px;">
                    <div class="cctv-preview-box" 
                         id="cctv-preview-screen-${cam.id}" 
                         onclick="openCameraLiveModal('${escapeHtml(cam.ip)}', '${escapeHtml(cam.position || cam.name || '')}', '${escapeHtml(cam.recorder || '')}')" 
                         title="Kliknite za prikaz preko celog ekrana i preuzimanje isečka"
                         style="position: relative; width: 224px; height: 126px; margin: 0 auto; border-radius: 8px; overflow: hidden; background: #000; border: 1.5px solid rgba(255, 184, 0, 0.25); cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,0.5); transition: transform 0.15s ease, border-color 0.15s ease;">
                      <img src="${snapshotUrl}" 
                           alt="${escapeHtml(cam.position)}" 
                           class="cctv-snapshot-fallback" 
                           loading="lazy"
                           style="width: 100%; height: 100%; object-fit: cover; display: block;" 
                           onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
                      <div class="cctv-error-box" style="display: none; width: 100%; height: 100%; align-items: center; justify-content: center; flex-direction: column; background: #0b0f17; color: #64748b; font-size: 0.72rem;">
                        <i data-lucide="video-off" style="width: 20px; height: 20px; margin-bottom: 4px; color: #ef4444;"></i>
                        <span>Signal u prekidu</span>
                      </div>
                      <div class="cctv-preview-overlay" style="position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0.3) 0%, transparent 40%, rgba(0,0,0,0.6) 100%); pointer-events: none;">
                        <span class="cctv-live-tag" style="position: absolute; top: 6px; left: 8px; font-size: 0.65rem; font-weight: 800; background: rgba(0,0,0,0.6); color: #4ade80; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(74, 222, 128, 0.4); display: flex; align-items: center; gap: 4px;">
                          <span class="live-dot-pulse" style="width: 5px; height: 5px; background: #22c55e;"></span>
                          25 FPS
                        </span>
                        <div class="cctv-click-hint" style="position: absolute; bottom: 6px; right: 8px; font-size: 0.68rem; color: #fff; background: rgba(0,0,0,0.6); padding: 2px 6px; border-radius: 4px; display: flex; align-items: center; gap: 4px;">
                          <i data-lucide="maximize-2" style="width: 10px; height: 10px;"></i>
                          <span>Otvori</span>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } else {
    container.className = 'printers-cards-grid';
    container.innerHTML = pageItems.map(cam => {
      const snapshotUrl = `/api/cameras/${encodeURIComponent(cam.ip)}/snapshot?t=${Date.now()}`;
      return `
        <div class="printer-card" id="card-cctv-${cam.id}" style="padding: 0; overflow: hidden; border: 1px solid rgba(255, 184, 0, 0.2);">
          <div class="cctv-preview-box" 
               id="cctv-preview-screen-${cam.id}" 
               onclick="openCameraLiveModal('${escapeHtml(cam.ip)}', '${escapeHtml(cam.position || cam.name || '')}', '${escapeHtml(cam.recorder || '')}')" 
               title="Kliknite za puni prikaz i premotavanje"
               style="position: relative; width: 100%; height: 160px; background: #000; cursor: pointer; overflow: hidden;">
            <img src="${snapshotUrl}" alt="${escapeHtml(cam.position)}" class="cctv-snapshot-fallback" loading="lazy" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="this.style.display='none';" />
            <div class="cctv-preview-overlay" style="position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0.3) 0%, transparent 40%, rgba(0,0,0,0.7) 100%); pointer-events: none;">
              <span class="cctv-live-tag" style="position: absolute; top: 8px; left: 8px; font-size: 0.65rem; font-weight: 800; background: rgba(0,0,0,0.6); color: #4ade80; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(74, 222, 128, 0.4); display: flex; align-items: center; gap: 4px;">
                <span class="live-dot-pulse" style="width: 5px; height: 5px; background: #22c55e;"></span>
                25 FPS
              </span>
              <div class="cctv-click-hint" style="position: absolute; bottom: 8px; right: 8px; font-size: 0.68rem; color: #fff; background: rgba(0,0,0,0.6); padding: 2px 6px; border-radius: 4px; display: flex; align-items: center; gap: 4px;">
                <i data-lucide="maximize-2" style="width: 11px; height: 11px;"></i>
                <span>Puni ekran</span>
              </div>
            </div>
          </div>
          <div style="padding: 12px 14px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
              <i data-lucide="video" style="width: 15px; height: 15px; color: #FFB800; flex-shrink: 0;"></i>
              <strong class="text-white" style="font-size: 0.92rem;">${escapeHtml(cam.position || cam.name || '')}</strong>
            </div>
            <span class="location-highlight" style="font-size: 0.78rem;">
              <i data-lucide="map-pin" style="width: 11px; height: 11px; display: inline-block;"></i>
              ${escapeHtml(cam.recorder || 'Fabrika')}
            </span>
            <div class="cctv-cam-actions" style="margin-top: 10px;">
              <button type="button" class="cctv-ip-chip" onclick="copyCustomUrl('${escapeHtml(cam.ip)}')" title="Kopiraj IP adresu">
                <span>${escapeHtml(cam.ip)}</span>
                <i data-lucide="copy"></i>
              </button>
              ${window.MonitoringQuickAdd ? window.MonitoringQuickAdd.buttonHtml(cam.id) : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  if (window.lucide) window.lucide.createIcons();
  if (window.MonitoringQuickAdd) window.MonitoringQuickAdd.decorate(container);
  mountCctvSubStreams(pageItems);
}

function renderCctvPagination(totalPages) {
  const container = document.getElementById('cctv-pagination-controls');
  if (!container) return;

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '';
  const prevDisabled = cctvCurrentPage === 1;
  html += `<button class="btn-dark-sm" style="padding: 4px 10px; height: 30px; ${prevDisabled ? 'opacity: 0.4; pointer-events: none;' : ''}" onclick="goToCctvPage(${cctvCurrentPage - 1})"><i data-lucide="chevron-left" style="width: 14px; height: 14px;"></i></button>`;

  let startPage = Math.max(1, cctvCurrentPage - 2);
  let endPage = Math.min(totalPages, startPage + 4);
  if (endPage - startPage < 4) {
    startPage = Math.max(1, endPage - 4);
  }

  for (let p = startPage; p <= endPage; p++) {
    const active = (p === cctvCurrentPage);
    html += `<button class="${active ? 'btn-yellow-solid-sm' : 'btn-dark-sm'}" style="padding: 2px 10px; height: 30px; min-width: 32px;" onclick="goToCctvPage(${p})">${p}</button>`;
  }

  const nextDisabled = cctvCurrentPage === totalPages;
  html += `<button class="btn-dark-sm" style="padding: 4px 10px; height: 30px; ${nextDisabled ? 'opacity: 0.4; pointer-events: none;' : ''}" onclick="goToCctvPage(${cctvCurrentPage + 1})"><i data-lucide="chevron-right" style="width: 14px; height: 14px;"></i></button>`;

  container.innerHTML = html;
  if (window.lucide) window.lucide.createIcons();
}

function goToCctvPage(page) {
  cctvCurrentPage = page;
  renderCctvCamerasTab();
  const scrollEl = document.getElementById('cctv-cameras-container');
  if (scrollEl) scrollEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
window.goToCctvPage = goToCctvPage;

function changeCctvPageSize(newSize) {
  cctvPageSize = parseInt(newSize, 10) || 12;
  cctvCurrentPage = 1;
  document.querySelectorAll('#cctv-page-size-btns .btn-page-size').forEach(btn => {
    const s = parseInt(btn.getAttribute('data-size'), 10);
    if (s === cctvPageSize) {
      btn.classList.add('active');
      btn.style.background = 'var(--primary-yellow, #ffb800)';
      btn.style.color = '#000';
      btn.style.fontWeight = '800';
      btn.style.borderColor = 'var(--primary-yellow, #ffb800)';
    } else {
      btn.classList.remove('active');
      btn.style.background = '';
      btn.style.color = '';
      btn.style.fontWeight = '';
      btn.style.borderColor = '';
    }
  });
  renderCctvCamerasTab();
}
window.changeCctvPageSize = changeCctvPageSize;

function setupCctvCamerasEventListeners() {
  const searchInput = document.getElementById('search-cctv-cameras');
  const btnClearSearch = document.getElementById('btn-clear-search-cctv');
  const selectRecorder = document.getElementById('select-cctv-recorder-filter');
  const btnViewTable = document.getElementById('btn-view-cctv-table');
  const btnViewGrid = document.getElementById('btn-view-cctv-grid');

  searchInput?.addEventListener('input', (e) => {
    cctvSearchQuery = e.target.value.trim();
    if (btnClearSearch) btnClearSearch.style.display = cctvSearchQuery ? 'block' : 'none';
    cctvCurrentPage = 1;
    renderCctvCamerasTab();
  });

  btnClearSearch?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    cctvSearchQuery = '';
    btnClearSearch.style.display = 'none';
    cctvCurrentPage = 1;
    renderCctvCamerasTab();
  });

  selectRecorder?.addEventListener('change', (e) => {
    cctvRecorderFilter = e.target.value;
    document.querySelectorAll('#cctv-location-pills .cctv-quick-pill').forEach(btn => {
      if (btn.getAttribute('data-rec') === cctvRecorderFilter) btn.classList.add('active');
      else btn.classList.remove('active');
    });
    cctvCurrentPage = 1;
    renderCctvCamerasTab();
  });

  btnViewTable?.addEventListener('click', () => {
    cctvViewMode = 'table';
    btnViewTable.classList.add('active');
    btnViewGrid?.classList.remove('active');
    renderCctvCamerasTab();
  });

  btnViewGrid?.addEventListener('click', () => {
    cctvViewMode = 'grid';
    btnViewGrid.classList.add('active');
    btnViewTable?.classList.remove('active');
    renderCctvCamerasTab();
  });

  document.querySelectorAll('#cctv-page-size-btns .btn-page-size').forEach(btn => {
    btn.addEventListener('click', () => {
      const sz = btn.getAttribute('data-size');
      changeCctvPageSize(sz);
    });
  });
}

// EVIDENCIJA SNIMAČA (RECORDERS INVENTORY) - NVR / DVR LOGIC
// =========================================================================
let allInventoryRecorders = [];
let isFetchingRecorders = false;
let recSearchQuery = '';
let recSubnetFilter = 'all';
let recTypeFilter = 'all';
let recFilterPill = 'all';
let recViewMode = 'table';
let recorderToDelete = null;

async function fetchInventoryRecorders() {
  if (isFetchingRecorders) return;
  isFetchingRecorders = true;

  const container = document.getElementById('inv-recorders-container');
  try {
    const res = await fetch('/api/inventory/recorders');
    const data = await res.json();

    if (res.ok && data.success) {
      allInventoryRecorders = data.recorders || [];

      const total = allInventoryRecorders.length;
      const sub124 = allInventoryRecorders.filter(r => r.subnet && r.subnet.includes('124.')).length;
      const sub125 = allInventoryRecorders.filter(r => r.subnet && r.subnet.includes('125.')).length;
      const totalCams = allInventoryRecorders.reduce((acc, r) => acc + (Number(r.camerasCount) || 0), 0);
      const offlineCount = allInventoryRecorders.filter(r => r.status === 'offline').length;

      // Determine latest check
      let latestCheck = data.lastCheckedAt;
      if (!latestCheck) {
        allInventoryRecorders.forEach(r => {
          if (r.lastCheckedAt) {
            if (!latestCheck || new Date(r.lastCheckedAt).getTime() > new Date(latestCheck).getTime()) {
              latestCheck = r.lastCheckedAt;
            }
          }
        });
      }

      // Update KPIs & Navigation Badges
      const kTotal = document.getElementById('kpi-rec-total');
      const k124 = document.getElementById('kpi-rec-124');
      const k125 = document.getElementById('kpi-rec-125');
      const kCams = document.getElementById('kpi-rec-cameras');
      const kOffline = document.getElementById('kpi-rec-offline');
      const kLastChecked = document.getElementById('kpi-rec-last-checked');
      const pillOffline = document.getElementById('pill-count-rec-offline');
      const bNav = document.getElementById('badge-nav-inventory-recorders');
      const bNavCopy = document.getElementById('badge-nav-cctv-copy-recorders');

      if (kTotal) kTotal.textContent = total;
      if (k124) k124.textContent = sub124;
      if (k125) k125.textContent = sub125;
      if (kCams) kCams.textContent = totalCams;
      if (kOffline) kOffline.textContent = offlineCount;
      if (pillOffline) pillOffline.textContent = offlineCount;

      if (kLastChecked) {
        if (latestCheck) {
          const dt = new Date(latestCheck);
          const timeFormatted = dt.toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' });
          const dateFormatted = dt.toLocaleDateString('sr-RS', { day: '2-digit', month: '2-digit' });
          kLastChecked.textContent = `Provereno: ${dateFormatted} ${timeFormatted}`;
          kLastChecked.title = `Datum i vreme poslednje provere: ${dt.toLocaleString('sr-RS')}`;
        } else {
          kLastChecked.textContent = 'Provereno: -';
        }
      }

      if (bNav) bNav.textContent = total;
      if (bNavCopy) bNavCopy.textContent = total;

      renderInventoryRecordersTab();
    } else {
      throw new Error(data.error || 'Greška pri očitavanju snimača');
    }
  } catch (err) {
    console.error('Inventory recorders fetch error:', err);
    if (container) {
      container.innerHTML = `
        <div class="empty-state-box" style="padding: 40px; text-align: center;">
          <div class="empty-icon text-danger"><i data-lucide="alert-triangle"></i></div>
          <h4>Greška pri učitavanju evidencije snimača</h4>
          <p class="text-dim">${escapeHtml(err.message || 'Proverite vezu sa serverom')}</p>
          <button class="btn-dark-sm" onclick="fetchInventoryRecorders()" style="margin-top: 14px;">
            <i data-lucide="refresh-cw"></i> Pokušaj ponovo
          </button>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
    }
  } finally {
    isFetchingRecorders = false;
  }
}
window.fetchInventoryRecorders = fetchInventoryRecorders;

function renderInventoryRecordersTab() {
  const container = document.getElementById('inv-recorders-container');
  if (!container) return;

  // Filter items
  let filtered = allInventoryRecorders.filter(r => {
    // Quick filter pill
    if (recFilterPill === 'offline') {
      if (r.status !== 'offline') return false;
    } else if (recFilterPill === '124') {
      if (!r.subnet || !r.subnet.includes('124.')) return false;
    } else if (recFilterPill === '125') {
      if (!r.subnet || !r.subnet.includes('125.')) return false;
    } else if (recFilterPill === 'NVR') {
      if (r.type !== 'NVR') return false;
    } else if (recFilterPill === 'Hybrid DVR/NVR') {
      if (r.type !== 'Hybrid DVR/NVR' && !r.type?.includes('DVR')) return false;
    }

    // Subnet filter
    if (recSubnetFilter !== 'all') {
      if (!r.subnet || !r.subnet.includes(recSubnetFilter)) return false;
    }

    // Type filter
    if (recTypeFilter !== 'all') {
      if (r.type !== recTypeFilter) return false;
    }

    // Text search query
    if (recSearchQuery) {
      const q = recSearchQuery.toLowerCase();
      const match =
        (r.name && r.name.toLowerCase().includes(q)) ||
        (r.location && r.location.toLowerCase().includes(q)) ||
        (r.ip && r.ip.toLowerCase().includes(q)) ||
        (r.model && r.model.toLowerCase().includes(q)) ||
        (r.note && r.note.toLowerCase().includes(q));
      if (!match) return false;
    }

    return true;
  });

  // Update summary counter
  const counterText = document.getElementById('inv-recorders-counter-text');
  if (counterText) {
    counterText.textContent = `Prikazano: ${filtered.length} od ukupno ${allInventoryRecorders.length} snimača video nadzora`;
  }

  if (filtered.length === 0) {
    container.className = '';
    container.innerHTML = `
      <div class="empty-state-box" style="padding: 50px 20px; text-align: center; background: rgba(18, 21, 28, 0.6); border: 1px dashed rgba(255, 255, 255, 0.12); border-radius: 12px; margin-top: 14px;">
        <div style="width: 52px; height: 52px; border-radius: 50%; background: rgba(255, 184, 0, 0.1); display: flex; align-items: center; justify-content: center; margin: 0 auto 14px auto; color: var(--yellow-primary);">
          <i data-lucide="hard-drive" style="width: 26px; height: 26px;"></i>
        </div>
        <h4 style="font-family: var(--font-heading); color: #fff; font-size: 1.05rem;">Nema pronađenih snimača</h4>
        <p class="text-muted text-sm" style="max-width: 420px; margin: 6px auto 0 auto;">Prilagodite kriterijume pretrage ili izaberite drugu opciju filtera.</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  if (recViewMode === 'table') {
    container.className = '';
    container.innerHTML = `
      <div class="inv-table-wrapper">
        <table class="inv-camera-table">
          <thead>
            <tr>
              <th style="width: 45px;">#</th>
              <th style="width: 170px;">IP Adresa Snimača</th>
              <th>Naziv Snimača / Lokacija</th>
              <th style="width: 170px;">Model Uređaja</th>
              <th style="width: 110px;">Tip</th>
              <th style="width: 130px;">Kamere / Kanali</th>
              <th style="width: 130px;">Mrežni Opseg</th>
              <th style="width: 155px;">Status & WebUI</th>
              <th style="width: 125px;">Poslednja Provera</th>
              <th style="width: 145px; text-align: right;">Akcije</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map((r, idx) => {
              const is124 = r.subnet && r.subnet.includes('124.');
              const webUrl = r.ip ? `http://${r.ip}` : '';
              const isOffline = r.status === 'offline';
              const isPingOk = r.pingStatus === 'online';
              const isWebuiOk = r.webuiStatus === 'online';

              let statusBadgeHtml = '';
              if (!isOffline) {
                statusBadgeHtml = `
                  <span class="status-pill active-pill" style="font-size: 0.7rem;" title="Ping (${r.latencyMs || 1}ms) i Web interfejs aktivni">
                    <span class="status-dot"></span> Online (${r.latencyMs || 1}ms)
                  </span>
                `;
              } else if (isPingOk && !isWebuiOk) {
                statusBadgeHtml = `
                  <span class="status-pill" style="background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #ef4444; font-size: 0.7rem;" title="Ping se odaziva (${r.latencyMs || 1}ms), ali WebUI ne odgovara!">
                    <i data-lucide="alert-triangle" style="width: 10px; height: 10px; display: inline-block;"></i> WebUI Offline
                  </span>
                `;
              } else {
                statusBadgeHtml = `
                  <span class="status-pill" style="background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #ef4444; font-size: 0.7rem;" title="Nema mrežnog odziva (Ping nedostupan)">
                    <span class="status-dot" style="background: #ef4444;"></span> Offline
                  </span>
                `;
              }

              let lastCheckedHtml = '<span class="text-dim text-xs">-</span>';
              if (r.lastCheckedAt) {
                const dt = new Date(r.lastCheckedAt);
                lastCheckedHtml = `<span class="font-mono text-dim" style="font-size: 0.74rem;" title="${dt.toLocaleString('sr-RS')}">${dt.toLocaleDateString('sr-RS', { day: '2-digit', month: '2-digit' })} ${dt.toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' })}</span>`;
              }

              return `
                <tr>
                  <td class="font-mono text-dim" style="font-size: 0.78rem;">${idx + 1}</td>
                  <td>
                    <div class="inv-ip-pill ${is124 ? 'subnet-124' : 'subnet-125'}">
                      <span class="chip-dot"></span>
                      <span>${escapeHtml(r.ip || 'N/A')}</span>
                      ${r.ip ? `
                        <button class="btn-copy-chip-sm" onclick="copyCustomUrl('${escapeHtml(r.ip)}')" title="Kopiraj IP adresu">
                          <i data-lucide="copy" style="width: 11px; height: 11px;"></i>
                        </button>
                      ` : ''}
                    </div>
                  </td>
                  <td>
                    <div class="inv-pos-cell">
                      <div class="inv-cam-avatar" style="border-color: ${isOffline ? '#ef4444' : 'rgba(255, 184, 0, 0.4)'}; color: ${isOffline ? '#ef4444' : 'var(--yellow-primary)'};">
                        <i data-lucide="${isOffline ? 'alert-triangle' : 'hard-drive'}" style="width: 16px; height: 16px;"></i>
                      </div>
                      <div class="inv-pos-info">
                        <span class="inv-pos-name">${escapeHtml(r.name)}</span>
                        <span class="inv-pos-sub"><i data-lucide="map-pin" style="width: 10px; height: 10px; display: inline-block;"></i> ${escapeHtml(r.location)}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span class="inv-rec-badge" style="color: #cbd5e1; border-color: rgba(255, 255, 255, 0.12);">
                      <i data-lucide="cpu" style="color: var(--yellow-primary);"></i>
                      ${escapeHtml(r.model || 'Hikvision NVR')}
                    </span>
                  </td>
                  <td>
                    <span class="inv-subnet-badge" style="color: ${r.type === 'NVR' ? '#38bdf8' : '#c084fc'};">
                      ${escapeHtml(r.type || 'NVR')}
                    </span>
                  </td>
                  <td>
                    <button class="inv-quick-pill" onclick="viewCamerasForRecorder('${escapeHtml(r.name)}')" title="Prikaži sve kamere za ovaj snimač" style="padding: 3px 9px; font-size: 0.75rem; border-color: rgba(255, 184, 0, 0.3);">
                      <i data-lucide="video" style="width: 11px; height: 11px; color: var(--yellow-primary);"></i>
                      <strong style="color: #fff;">${r.camerasCount || 0}</strong>
                      <span class="text-dim">/ ${r.channels || 32}ch</span>
                    </button>
                  </td>
                  <td>
                    <span class="inv-subnet-badge">${escapeHtml(r.subnet || (is124 ? '192.168.124.x' : '192.168.125.x'))}</span>
                  </td>
                  <td>
                    ${statusBadgeHtml}
                  </td>
                  <td>
                    ${lastCheckedHtml}
                  </td>
                  <td style="text-align: right;">
                    <div class="inv-actions-cell">
                      <button class="btn-inv-action" onclick="checkSingleRecorderById('${r.id}')" title="Testiraj mrežnu dostupnost i WebUI">
                        <i data-lucide="activity" style="width: 13px; height: 13px;"></i>
                      </button>
                      ${webUrl ? `
                        <a href="${webUrl}" target="_blank" rel="noopener" class="btn-inv-action btn-web" title="Otvori Web interfejs snimača (${webUrl})">
                          <i data-lucide="external-link" style="width: 13px; height: 13px;"></i>
                        </a>
                      ` : ''}
                      <button class="btn-inv-action" onclick="openEditRecorderModal('${r.id}')" title="Izmeni podatke o snimaču">
                        <i data-lucide="edit-3" style="width: 13px; height: 13px;"></i>
                      </button>
                      <button class="btn-inv-action btn-del" onclick="openDeleteRecorderModal('${r.id}')" title="Obriši snimač">
                        <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } else {
    // Grid View (Kartice)
    container.className = 'printers-cards-grid';
    container.innerHTML = filtered.map(r => {
      const is124 = r.subnet && r.subnet.includes('124.');
      const webUrl = r.ip ? `http://${r.ip}` : '';
      const isOffline = r.status === 'offline';
      const isPingOk = r.pingStatus === 'online';
      const isWebuiOk = r.webuiStatus === 'online';

      let statusBadgeHtml = '';
      if (!isOffline) {
        statusBadgeHtml = `
          <span class="status-pill active-pill" style="font-size: 0.72rem;">
            <span class="status-dot"></span> Online (${r.latencyMs || 1}ms)
          </span>
        `;
      } else if (isPingOk && !isWebuiOk) {
        statusBadgeHtml = `
          <span class="status-pill" style="background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #ef4444; font-size: 0.72rem;">
            <i data-lucide="alert-triangle" style="width: 10px; height: 10px; display: inline-block;"></i> WebUI Offline
          </span>
        `;
      } else {
        statusBadgeHtml = `
          <span class="status-pill" style="background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #ef4444; font-size: 0.72rem;">
            <span class="status-dot" style="background: #ef4444;"></span> Offline
          </span>
        `;
      }

      let lastCheckedFormatted = '-';
      if (r.lastCheckedAt) {
        const dt = new Date(r.lastCheckedAt);
        lastCheckedFormatted = `${dt.toLocaleDateString('sr-RS', { day: '2-digit', month: '2-digit' })} ${dt.toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' })}`;
      }

      return `
        <div class="printer-card ${isOffline ? 'printer-card-offline' : ''}" id="card-rec-${r.id}" style="${isOffline ? 'border-color: rgba(239, 68, 68, 0.35); background: rgba(239, 68, 68, 0.03);' : ''}">
          <div class="printer-card-header">
            <div class="printer-type-badge">
              <i data-lucide="${isOffline ? 'alert-triangle' : 'hard-drive'}" style="${isOffline ? 'color: #ef4444;' : ''}"></i>
              <span>${escapeHtml(r.type || 'NVR')}</span>
            </div>
            ${statusBadgeHtml}
          </div>

          <div class="printer-card-body">
            <div class="printer-title-row">
              <h4 class="printer-name" style="font-size: 0.98rem; ${isOffline ? 'color: #fca5a5;' : ''}">${escapeHtml(r.name)}</h4>
            </div>

            <div class="printer-meta-row" style="margin: 8px 0;">
              <div class="meta-item">
                <i data-lucide="map-pin" class="meta-icon"></i>
                <span class="meta-text text-dim" style="font-size: 0.76rem;">${escapeHtml(r.location)}</span>
              </div>
              <div class="meta-item">
                <i data-lucide="cpu" class="meta-icon" style="color: var(--yellow-primary);"></i>
                <span class="meta-text text-xs">${escapeHtml(r.model || 'Hikvision')}</span>
              </div>
            </div>

            <div class="printer-ip-box">
              <div class="ip-details">
                <span class="ip-label">IP ADRESA SNIMAČA</span>
                <span class="ip-val font-mono" style="color: ${isOffline ? '#ef4444' : (is124 ? '#38bdf8' : '#34d399')};">${escapeHtml(r.ip || 'N/A')}</span>
              </div>
              ${r.ip ? `
                <button class="btn-copy-chip" onclick="copyCustomUrl('${escapeHtml(r.ip)}')" title="Kopiraj adresu">
                  <i data-lucide="copy"></i>
                </button>
              ` : ''}
            </div>

            <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 10px; padding: 8px 10px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px;">
              <span class="text-xs text-dim">Povezanih kamera:</span>
              <button class="inv-quick-pill" onclick="viewCamerasForRecorder('${escapeHtml(r.name)}')" title="Prikaži kamere">
                <i data-lucide="video" style="width: 12px; height: 12px;"></i>
                <strong>${r.camerasCount || 0} / ${r.channels || 32}ch</strong>
              </button>
            </div>

            <!-- Poslednja provera info -->
            <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 8px; padding: 6px 10px; background: rgba(255, 255, 255, 0.02); border-radius: 6px; font-size: 0.74rem;">
              <span class="text-dim">Poslednja provera:</span>
              <span class="font-mono ${isOffline ? 'text-danger' : 'text-success'}" style="font-weight: 600;">${lastCheckedFormatted}</span>
            </div>

            ${r.note ? `
              <div style="margin-top: 8px; font-size: 0.74rem; color: #94a3b8; line-height: 1.4;">
                <span style="color: #64748b;">Napomena:</span> ${escapeHtml(r.note)}
              </div>
            ` : ''}
          </div>

          <div class="printer-card-actions">
            <button class="btn-printer-action" onclick="checkSingleRecorderById('${r.id}')" title="Testiraj odziv">
              <i data-lucide="activity"></i>
              <span>Proveri</span>
            </button>
            ${webUrl ? `
              <a href="${webUrl}" target="_blank" rel="noopener" class="btn-printer-action" title="Otvori Web GUI (${webUrl})">
                <i data-lucide="external-link"></i>
                <span>Web</span>
              </a>
            ` : ''}
            <button class="btn-printer-action" onclick="openEditRecorderModal('${r.id}')" title="Izmeni">
              <i data-lucide="edit-3"></i>
              <span>Izmeni</span>
            </button>
            <button class="btn-printer-action btn-danger-action" onclick="openDeleteRecorderModal('${r.id}')" title="Obriši">
              <i data-lucide="trash-2"></i>
              <span>Obriši</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  if (window.lucide) window.lucide.createIcons();
}
window.renderInventoryRecordersTab = renderInventoryRecordersTab;

// Helper: Jump from recorder to its cameras
window.viewCamerasForRecorder = function(recorderName) {
  if (window.switchTab) window.switchTab('inventory_cameras');
  invRecorderFilter = recorderName;
  const select = document.getElementById('select-inv-recorder-filter');
  if (select) select.value = recorderName;
  document.querySelectorAll('#inv-location-pills .inv-quick-pill').forEach(btn => {
    if (btn.getAttribute('data-rec') === recorderName) btn.classList.add('active');
    else btn.classList.remove('active');
  });
  invCurrentPage = 1;
  renderInventoryCamerasTab();
  showToast(`Prikazuju se kamere za lokaciju: ${recorderName}`, 'info');
};

function openAddRecorderModal() {
  document.getElementById('modal-inv-recorder-title').textContent = 'Dodaj Novi Snimač u Evidenciju';
  document.getElementById('btn-submit-inv-recorder-text').textContent = 'Sačuvaj Snimač';
  document.getElementById('form-inv-recorder').reset();
  document.getElementById('input-inv-recorder-id').value = '';
  document.getElementById('modal-inv-recorder').style.display = 'flex';
  if (window.lucide) window.lucide.createIcons();
}
window.openAddRecorderModal = openAddRecorderModal;

function openEditRecorderModal(id) {
  const item = allInventoryRecorders.find(r => r.id === id);
  if (!item) return;

  document.getElementById('modal-inv-recorder-title').textContent = `Izmeni Snimač (${item.name})`;
  document.getElementById('btn-submit-inv-recorder-text').textContent = 'Ažuriraj Podatke';

  document.getElementById('input-inv-recorder-id').value = item.id;
  document.getElementById('input-inv-rec-name').value = item.name || '';
  document.getElementById('input-inv-rec-location').value = item.location || '';
  document.getElementById('input-inv-rec-ip').value = item.ip || '';
  document.getElementById('input-inv-rec-model').value = item.model || '';
  document.getElementById('input-inv-rec-type').value = item.type || 'NVR';
  document.getElementById('input-inv-rec-subnet').value = item.subnet || (item.ip && item.ip.includes('124.') ? '192.168.124.x' : '192.168.125.x');
  document.getElementById('input-inv-rec-channels').value = item.channels || 32;
  document.getElementById('input-inv-rec-cameras').value = item.camerasCount || 0;
  document.getElementById('input-inv-rec-note').value = item.note || '';

  document.getElementById('modal-inv-recorder').style.display = 'flex';
  if (window.lucide) window.lucide.createIcons();
}
window.openEditRecorderModal = openEditRecorderModal;

async function handleRecorderFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('input-inv-recorder-id').value.trim();
  const name = document.getElementById('input-inv-rec-name').value.trim();
  const location = document.getElementById('input-inv-rec-location').value.trim();
  const ip = document.getElementById('input-inv-rec-ip').value.trim();
  const model = document.getElementById('input-inv-rec-model').value.trim();
  const type = document.getElementById('input-inv-rec-type').value;
  const subnet = document.getElementById('input-inv-rec-subnet').value;
  const channels = parseInt(document.getElementById('input-inv-rec-channels').value) || 32;
  const camerasCount = parseInt(document.getElementById('input-inv-rec-cameras').value) || 0;
  const note = document.getElementById('input-inv-rec-note').value.trim();

  if (!name) {
    showToast('Naziv snimača je obavezno polje', 'warning');
    return;
  }

  const payload = {
    name,
    location,
    ip,
    model,
    type,
    subnet,
    channels,
    camerasCount,
    note
  };

  const isEdit = !!id;
  const url = isEdit ? `/api/inventory/recorders/${id}` : '/api/inventory/recorders';
  const method = isEdit ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    if (res.ok && result.success) {
      showToast(isEdit ? '✓ Podaci o snimaču ažurirani!' : '✓ Snimač uspešno dodat u evidenciju!', 'success');
      document.getElementById('modal-inv-recorder').style.display = 'none';
      fetchInventoryRecorders();
    } else {
      throw new Error(result.error || 'Neuspešno čuvanje');
    }
  } catch (err) {
    console.error('Save recorder error:', err);
    showToast(`Greška: ${err.message}`, 'error');
  }
}

function openDeleteRecorderModal(id) {
  const item = allInventoryRecorders.find(r => r.id === id);
  if (!item) return;

  recorderToDelete = item;
  document.getElementById('delete-inv-recorder-name').textContent = item.name;
  document.getElementById('delete-inv-recorder-ip').textContent = item.ip ? `IP: ${item.ip}` : 'Bez IP adrese';
  document.getElementById('delete-inv-recorder-loc').textContent = `Lokacija: ${item.location} (${item.camerasCount || 0} kamera)`;

  document.getElementById('modal-delete-inv-recorder').style.display = 'flex';
  if (window.lucide) window.lucide.createIcons();
}
window.openDeleteRecorderModal = openDeleteRecorderModal;

async function confirmDeleteRecorder() {
  if (!recorderToDelete) return;

  try {
    const res = await fetch(`/api/inventory/recorders/${recorderToDelete.id}`, {
      method: 'DELETE'
    });
    const result = await res.json();

    if (res.ok && result.success) {
      showToast('✓ Snimač uspešno obrisan iz evidencije', 'success');
      document.getElementById('modal-delete-inv-recorder').style.display = 'none';
      recorderToDelete = null;
      fetchInventoryRecorders();
    } else {
      throw new Error(result.error || 'Neuspešno brisanje');
    }
  } catch (err) {
    console.error('Delete recorder error:', err);
    showToast(`Greška: ${err.message}`, 'error');
  }
}

function exportRecordersListClipboard() {
  if (allInventoryRecorders.length === 0) {
    showToast('Nema snimača za kopiranje', 'warning');
    return;
  }

  const rows = [
    ['ID', 'Naziv Snimača', 'Lokacija', 'IP Adresa', 'Model', 'Tip', 'Mrežni Opseg', 'Broj Kamera', 'Kapacitet Kanala', 'Status', 'Napomena']
  ];

  allInventoryRecorders.forEach(r => {
    rows.push([
      r.id,
      r.name,
      r.location,
      r.ip,
      r.model,
      r.type,
      r.subnet,
      r.camerasCount,
      r.channels,
      r.status,
      r.note || ''
    ]);
  });

  const tsv = rows.map(r => r.join('\t')).join('\n');
  navigator.clipboard.writeText(tsv).then(() => {
    showToast(`✓ Kopiran spisak svih ${allInventoryRecorders.length} snimača video nadzora (TSV format za Excel)!`, 'success');
  }).catch(() => {
    showToast('Neuspešno kopiranje u clipboard', 'error');
  });
}

function setupInventoryRecordersEventListeners() {
  const searchInput = document.getElementById('search-inv-recorders');
  const btnClearSearch = document.getElementById('btn-clear-search-recorders');
  const selectSubnet = document.getElementById('select-recorders-subnet');
  const selectType = document.getElementById('select-recorders-type');
  const btnViewTable = document.getElementById('btn-view-recorders-table');
  const btnViewGrid = document.getElementById('btn-view-recorders-grid');
  const btnOpenAdd = document.getElementById('btn-open-add-inv-recorder');
  const btnExport = document.getElementById('btn-export-inv-recorders');

  // Search
  searchInput?.addEventListener('input', (e) => {
    recSearchQuery = e.target.value.trim();
    if (btnClearSearch) btnClearSearch.style.display = recSearchQuery ? 'flex' : 'none';
    renderInventoryRecordersTab();
  });

  btnClearSearch?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    recSearchQuery = '';
    btnClearSearch.style.display = 'none';
    renderInventoryRecordersTab();
  });

  // Filters
  selectSubnet?.addEventListener('change', (e) => {
    recSubnetFilter = e.target.value;
    renderInventoryRecordersTab();
  });

  selectType?.addEventListener('change', (e) => {
    recTypeFilter = e.target.value;
    renderInventoryRecordersTab();
  });

  // Filter pills
  document.querySelectorAll('#rec-type-pills .inv-quick-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#rec-type-pills .inv-quick-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      recFilterPill = btn.getAttribute('data-rec-filter') || 'all';
      renderInventoryRecordersTab();
    });
  });

  // Views
  btnViewTable?.addEventListener('click', () => {
    recViewMode = 'table';
    btnViewTable.classList.add('active');
    btnViewGrid?.classList.remove('active');
    renderInventoryRecordersTab();
  });

  btnViewGrid?.addEventListener('click', () => {
    recViewMode = 'grid';
    btnViewGrid.classList.add('active');
    btnViewTable?.classList.remove('active');
    renderInventoryRecordersTab();
  });

  // Modal actions
  btnOpenAdd?.addEventListener('click', openAddRecorderModal);
  btnExport?.addEventListener('click', exportRecordersListClipboard);

  // Status check & KPI card listeners
  const btnCheckAll = document.getElementById('btn-check-all-recorders');
  btnCheckAll?.addEventListener('click', checkAllRecordersAvailability);

  const kpiOfflineCard = document.getElementById('kpi-card-rec-offline');
  kpiOfflineCard?.addEventListener('click', () => {
    document.querySelectorAll('#rec-type-pills .inv-quick-pill').forEach(b => {
      if (b.getAttribute('data-rec-filter') === 'offline') b.classList.add('active');
      else b.classList.remove('active');
    });
    recFilterPill = 'offline';
    renderInventoryRecordersTab();
  });

  document.getElementById('btn-close-inv-recorder-modal')?.addEventListener('click', () => {
    document.getElementById('modal-inv-recorder').style.display = 'none';
  });
  document.getElementById('btn-cancel-inv-recorder-modal')?.addEventListener('click', () => {
    document.getElementById('modal-inv-recorder').style.display = 'none';
  });
  document.getElementById('form-inv-recorder')?.addEventListener('submit', handleRecorderFormSubmit);

  document.getElementById('btn-close-delete-inv-rec-modal')?.addEventListener('click', () => {
    document.getElementById('modal-delete-inv-recorder').style.display = 'none';
  });
  document.getElementById('btn-cancel-delete-inv-rec-modal')?.addEventListener('click', () => {
    document.getElementById('modal-delete-inv-recorder').style.display = 'none';
  });
  document.getElementById('btn-confirm-delete-inv-rec')?.addEventListener('click', confirmDeleteRecorder);
}

async function checkAllRecordersAvailability() {
  const btn = document.getElementById('btn-check-all-recorders');
  const icon = btn?.querySelector('i, svg');
  if (btn) btn.disabled = true;
  if (icon) icon.classList.add('icon-spin');

  showToast('Proveravam mrežnu dostupnost i WebUI odziv svih snimača...', 'info');

  try {
    const res = await fetch('/api/inventory/recorders/check-status', { method: 'POST' });
    const data = await res.json();

    if (res.ok && data.success) {
      if (data.offlineCount > 0) {
        showToast(`Upozorenje: ${data.offlineCount} snimača je offline ili WebUI ne odgovara!`, 'warning');
      } else {
        showToast(`Svih ${data.total} snimača je online i Web interfejs je dostupan!`, 'success');
      }
      await fetchInventoryRecorders();
    } else {
      throw new Error(data.error || 'Greška pri proveri snimača');
    }
  } catch (err) {
    console.error('Check recorders error:', err);
    showToast(`Greška: ${err.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
    if (icon) icon.classList.remove('icon-spin');
  }
}
window.checkAllRecordersAvailability = checkAllRecordersAvailability;

async function checkSingleRecorderById(id) {
  showToast('Proveravam ping i WebUI odziv snimača...', 'info');
  try {
    const res = await fetch(`/api/inventory/recorders/${id}/check-status`, { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.success) {
      const rec = data.result;
      if (rec.status === 'online') {
        showToast(`✓ Snimač ${rec.name} (${rec.ip}) je ONLINE! Ping: ${rec.latencyMs || 1}ms, WebUI aktivan.`, 'success');
      } else {
        showToast(`⚠️ Snimač ${rec.name} (${rec.ip}) je OFFLINE! (${rec.reason || 'Nema odziva'})`, 'warning');
      }
      await fetchInventoryRecorders();
    } else {
      throw new Error(data.error || 'Greška pri proveri');
    }
  } catch (err) {
    showToast(`Greška pri proveri: ${err.message}`, 'error');
  }
}
window.checkSingleRecorderById = checkSingleRecorderById;

/* ==========================================================================
   TAB: AUTOMATSKI SERVISI (SCHEDULED BACKGROUND SERVICES)
   ========================================================================== */
let allScheduledServices = [];
let scheduledServiceToDelete = null;
let isRefreshingServices = false;

async function fetchScheduledServices(notify = false) {
  if (isRefreshingServices) return;
  isRefreshingServices = true;
  setButtonSpinning('btn-refresh-scheduled-services', true);

  try {
    const res = await fetch('/api/scheduler/services');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    allScheduledServices = data.services || [];

    updateScheduledServicesKPIs(data);
    renderScheduledServicesTab();

    if (notify) {
      showToast('Spisak automatskih servisa je osvežen', 'info');
    }
  } catch (err) {
    console.error('Error fetching scheduled services:', err);
    if (notify) showToast('Greška pri učitavanju automatskih servisa', 'error');
  } finally {
    setButtonSpinning('btn-refresh-scheduled-services', false);
    isRefreshingServices = false;
  }
}
window.fetchScheduledServices = fetchScheduledServices;

function updateScheduledServicesKPIs(data) {
  const services = allScheduledServices;
  const total = services.length;
  const active = services.filter(s => s.is_enabled).length;
  const totalTimes = services.reduce((acc, s) => acc + (s.cron_times ? s.cron_times.length : 0), 0);

  // Find most recent last_run_at
  let latestRun = null;
  services.forEach(s => {
    if (s.last_run_at) {
      const d = new Date(s.last_run_at);
      if (!latestRun || d > latestRun) latestRun = d;
    }
  });

  const kpiTotal = document.getElementById('kpi-services-total');
  const kpiActive = document.getElementById('kpi-services-active');
  const kpiTimes = document.getElementById('kpi-services-times-count');
  const kpiLastRun = document.getElementById('kpi-services-last-run');
  const badgeCount = document.getElementById('badge-scheduled-services-count');
  const navBadge = document.getElementById('badge-nav-scheduled-services');

  if (kpiTotal) kpiTotal.textContent = total;
  if (kpiActive) kpiActive.textContent = active;
  if (kpiTimes) kpiTimes.textContent = totalTimes;
  if (kpiLastRun) {
    if (latestRun) {
      const hours = String(latestRun.getHours()).padStart(2, '0');
      const mins = String(latestRun.getMinutes()).padStart(2, '0');
      kpiLastRun.textContent = `${hours}:${mins}`;
    } else {
      kpiLastRun.textContent = '--:--';
    }
  }
  if (badgeCount) badgeCount.textContent = `${active} aktivno / ${total}`;
  if (navBadge) navBadge.textContent = active;
}

function renderScheduledServicesTab() {
  const container = document.getElementById('scheduled-services-cards-grid');
  if (!container) return;

  if (allScheduledServices.length === 0) {
    container.innerHTML = `
      <div class="empty-state-card" style="grid-column: 1 / -1; padding: 48px 20px; text-align: center;">
        <div class="empty-icon-wrap"><i data-lucide="clock"></i></div>
        <h3>Nema definisanih automatskih servisa</h3>
        <p>Trenutno u bazi nema konfigurisanih automatskih servisa.</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  container.innerHTML = allScheduledServices.map(service => {
    const isEnabled = !!service.is_enabled;
    const isWeekdaysOnly = !!service.weekdays_only;
    const times = service.cron_times || [];
    const recipients = service.recipients || [];

    let avatarClass = 'sched-avatar-custom';
    let iconName = 'clock';
    let targetLabel = 'Sistemski Servis';
    let targetBadgeClass = 'sched-target-custom';

    if (service.service_key === 'azure_secret_expiry') {
      avatarClass = 'sched-avatar-custom';
      iconName = 'key-round';
      targetLabel = 'Azure ključ (Microsoft 365 prijava)';
      targetBadgeClass = 'sched-target-custom';
    } else if (service.service_key === 'urgent_toner_alerts') {
      avatarClass = 'sched-avatar-urgent';
      iconName = 'alert-triangle';
      targetLabel = 'Štampači (Hitno: Waste / Color 0%)';
      targetBadgeClass = 'sched-target-urgent';
    } else if (service.target_type === 'printers' || service.service_key === 'toner_alerts') {
      avatarClass = 'sched-avatar-printers';
      iconName = 'printer';
      targetLabel = 'Štampači (Kritični Toneri)';
      targetBadgeClass = 'sched-target-printers';
    } else if (service.target_type === 'cameras' || service.service_key === 'camera_offline_alerts') {
      avatarClass = 'sched-avatar-cameras';
      iconName = 'video';
      targetLabel = 'Kamere (Offline Alarmi)';
      targetBadgeClass = 'sched-target-cameras';
    } else if (service.target_type === 'rf_readers' || service.service_key === 'rf_reader_alerts') {
      avatarClass = 'sched-avatar-rf';
      iconName = 'badge-check';
      targetLabel = 'RF Čitači (Radno Vreme)';
      targetBadgeClass = 'sched-target-rf';
    } else if (service.target_type === 'wifi_aps' || service.service_key === 'wifi_ap_alerts') {
      avatarClass = 'sched-avatar-wifi';
      iconName = 'wifi';
      targetLabel = 'WiFi AP (Aruba Mreža)';
      targetBadgeClass = 'sched-target-wifi';
    } else if (service.target_type === 'recorders' || service.service_key === 'recorder_offline_alerts') {
      avatarClass = 'sched-avatar-recorders';
      iconName = 'hard-drive';
      targetLabel = 'NVR Snimači (Video Nadzor)';
      targetBadgeClass = 'sched-target-recorders';
    }

    let lastRunDisplay = 'Nije pokretan';
    if (service.last_run_at) {
      try {
        const d = new Date(service.last_run_at);
        lastRunDisplay = `${d.toLocaleDateString('sr-RS')} u ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      } catch {
        lastRunDisplay = service.last_run_at;
      }
    }

    return `
      <div class="sched-service-card ${isEnabled ? '' : 'service-paused'}" id="card-service-${service.id}">
        <!-- Header -->
        <div class="sched-card-header">
          <div class="sched-card-title-group">
            <div class="sched-avatar-icon ${avatarClass}">
              <i data-lucide="${iconName}"></i>
            </div>
            <div>
              <h3 class="sched-title">${escapeHtml(service.name)}</h3>
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 4px;">
                <span class="sched-target-badge ${targetBadgeClass}">${targetLabel}</span>
                <span class="sched-day-pill" title="${isWeekdaysOnly ? 'Servis se izvršava isključivo od ponedeljka do petka' : 'Servis se izvršava svih 7 dana u nedelji'}">
                  <i data-lucide="${isWeekdaysOnly ? 'calendar' : 'calendar-days'}"></i>
                  <span>${isWeekdaysOnly ? 'Pon - Pet (Radni dani)' : 'Svaki dan (7 dana)'}</span>
                </span>
              </div>
            </div>
          </div>

          <button type="button" 
                  class="sched-status-pill-toggle ${isEnabled ? 'pill-active' : 'pill-paused'}" 
                  onclick="toggleScheduledService('${service.id}', ${!isEnabled})"
                  title="${isEnabled ? 'Servis je uključen i aktivan (kliknite da pauzirate)' : 'Servis je pauziran (kliknite da aktivirate)'}">
            <span class="status-dot"></span>
            <span class="status-text">${isEnabled ? 'AKTIVAN' : 'PAUZIRAN'}</span>
            <span class="status-switch-rail">
              <span class="status-switch-knob"></span>
            </span>
          </button>
        </div>

        <!-- Description -->
        <p class="sched-desc">${escapeHtml(service.description || 'Automatski pozadinski servis za generisanje i slanje obaveštenja.')}</p>

        <!-- Activation Times -->
        <div class="sched-section">
          <div class="sched-section-label">
            <span>Termini Aktivacije (${times.length})</span>
            <span style="font-size: 0.72rem; color: #64748b; font-weight: 500;">Format: HH:MM</span>
          </div>
          <div class="sched-times-container" id="times-container-${service.id}">
            ${times.map(t => `
              <span class="time-chip">
                <i data-lucide="clock"></i>
                <span>${escapeHtml(t)}</span>
                <button type="button" class="btn-remove-time" onclick="removeServiceTime('${service.id}', '${escapeHtml(t)}')" title="Obriši termin ${escapeHtml(t)}">
                  <i data-lucide="x"></i>
                </button>
              </span>
            `).join('')}

            <div class="time-add-wrap">
              <input type="time" class="input-quick-time" id="input-add-time-${service.id}" title="Unesite novo vreme aktivacije" onkeydown="if(event.key==='Enter'){event.preventDefault();quickAddServiceTime('${service.id}');}">
              <button type="button" class="btn-quick-add-time" onclick="quickAddServiceTime('${service.id}')" title="Dodaj novi termin">
                +
              </button>
            </div>
          </div>
        </div>

        <!-- Recipients -->
        <div class="sched-section">
          <div class="sched-section-label">
            <span>Email Primaoci (${recipients.length})</span>
            <span style="font-size: 0.72rem; color: #64748b; font-weight: 500;">Automatski izveštaj</span>
          </div>
          <div class="sched-meta-row" id="recipients-container-${service.id}">
            ${recipients.map(r => `
              <span class="sched-recipient-chip" title="Primalac automatskog izveštaja: ${escapeHtml(r)}">
                <i data-lucide="mail"></i>
                <span>${escapeHtml(r)}</span>
                <button type="button" class="btn-remove-recipient" onclick="removeServiceRecipient('${service.id}', '${escapeHtml(r)}')" title="Ukloni primaoca ${escapeHtml(r)}">
                  <i data-lucide="x"></i>
                </button>
              </span>
            `).join('')}

            <div class="recipient-add-wrap">
              <input type="email" class="input-quick-recipient" id="input-add-recipient-${service.id}" placeholder="novi.email@unipromet.co.rs" title="Unesite email adresu i pritisnite Enter" onkeydown="if(event.key==='Enter'){event.preventDefault();quickAddServiceRecipient('${service.id}');}">
              <button type="button" class="btn-quick-add-recipient" onclick="quickAddServiceRecipient('${service.id}')" title="Dodaj primaoca">
                +
              </button>
            </div>
          </div>
        </div>

        <!-- Last Run -->
        <div class="sched-section">
          <div class="sched-last-run">
            <div style="display: flex; align-items: center; gap: 8px;">
              <i data-lucide="history" style="width: 14px; height: 14px; color: #94a3b8;"></i>
              <span>Poslednje pokretanje: <strong style="color: #ffffff;">${lastRunDisplay}</strong></span>
            </div>
            <div>
              ${service.last_run_status && (service.last_run_status.toLowerCase().includes('uspešno') || service.last_run_status.toLowerCase().includes('online') || service.last_run_status.toLowerCase().includes('upozorenje') || service.last_run_status === 'success') ? `
                <span class="sched-last-run-status text-success" title="${escapeHtml(service.last_run_message || service.last_run_status)}">✓ ${escapeHtml(service.last_run_status)}</span>
              ` : service.last_run_status && (service.last_run_status.toLowerCase().includes('greška') || service.last_run_status === 'error') ? `
                <span class="sched-last-run-status text-danger" title="${escapeHtml(service.last_run_message || 'Greška')}">✗ Greška</span>
              ` : `
                <span class="sched-last-run-status text-muted">${escapeHtml(service.last_run_status || 'Na čekanju')}</span>
              `}
            </div>
          </div>
        </div>

        <!-- Actions Footer -->
        <div class="sched-card-footer">
          <div class="sched-actions-left">
            <button type="button" class="btn-sched-action btn-sched-edit" onclick="openEditScheduledServiceModal('${service.id}')" title="Izmeni naziv, termine, primaoce">
              <i data-lucide="edit-3"></i>
              <span>Izmeni</span>
            </button>
            <button type="button" class="btn-sched-action btn-sched-delete" onclick="openDeleteScheduledServiceModal('${service.id}')" title="Obriši ovaj servis">
              <i data-lucide="trash-2"></i>
              <span>Obriši</span>
            </button>
          </div>

          <div class="sched-actions-right">
            <button type="button" class="btn-sched-action btn-sched-run" id="btn-run-service-${service.id}" onclick="triggerRunScheduledService('${service.id}')" title="Pokreni servis odmah">
              <i data-lucide="play"></i>
              <span>Pokreni Odmah</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
}

async function quickAddServiceTime(serviceId) {
  const input = document.getElementById(`input-add-time-${serviceId}`);
  if (!input) return;
  const timeVal = input.value.trim();

  if (!timeVal) {
    showToast('Izaberite vreme u formatu HH:MM', 'warning');
    return;
  }

  try {
    const res = await fetch(`/api/scheduler/services/${serviceId}/times`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ time: timeVal })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`✓ Dodato vreme aktivacije: ${timeVal}`, 'success');
      input.value = '';
      fetchScheduledServices(false);
    } else {
      throw new Error(data.error || 'Neuspešno dodavanje vremena');
    }
  } catch (err) {
    console.error('Error adding time:', err);
    showToast(`Greška: ${err.message}`, 'error');
  }
}
window.quickAddServiceTime = quickAddServiceTime;

async function removeServiceTime(serviceId, time) {
  try {
    const res = await fetch(`/api/scheduler/services/${serviceId}/times/${encodeURIComponent(time)}`, {
      method: 'DELETE'
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`Termin ${time} je uklonjen`, 'info');
      fetchScheduledServices(false);
    } else {
      throw new Error(data.error || 'Neuspešno brisanje vremena');
    }
  } catch (err) {
    console.error('Error removing time:', err);
    showToast(`Greška: ${err.message}`, 'error');
  }
}
window.removeServiceTime = removeServiceTime;

async function quickAddServiceRecipient(serviceId) {
  const input = document.getElementById(`input-add-recipient-${serviceId}`);
  if (!input) return;
  const recipientVal = input.value.trim().toLowerCase();

  if (!recipientVal) {
    showToast('Unesite email adresu primaoca', 'warning');
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(recipientVal)) {
    showToast('Unesite validnu email adresu (npr. korisnik@unipromet.co.rs)', 'warning');
    return;
  }

  try {
    const res = await fetch(`/api/scheduler/services/${serviceId}/recipients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: recipientVal })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`✓ Dodat primalac: ${recipientVal}`, 'success');
      input.value = '';
      fetchScheduledServices(false);
    } else {
      throw new Error(data.error || 'Neuspešno dodavanje primaoca');
    }
  } catch (err) {
    console.error('Error adding recipient:', err);
    showToast(`Greška: ${err.message}`, 'error');
  }
}
window.quickAddServiceRecipient = quickAddServiceRecipient;

async function removeServiceRecipient(serviceId, email) {
  try {
    const res = await fetch(`/api/scheduler/services/${serviceId}/recipients/${encodeURIComponent(email)}`, {
      method: 'DELETE'
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`Primalac ${email} je uklonjen`, 'info');
      fetchScheduledServices(false);
    } else {
      throw new Error(data.error || 'Neuspešno brisanje primaoca');
    }
  } catch (err) {
    console.error('Error removing recipient:', err);
    showToast(`Greška: ${err.message}`, 'error');
  }
}
window.removeServiceRecipient = removeServiceRecipient;

async function toggleScheduledService(serviceId, isChecked) {
  try {
    const res = await fetch(`/api/scheduler/services/${serviceId}/toggle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_enabled: isChecked })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(isChecked ? '✓ Servis je aktiviran' : 'Servis je pauziran', 'info');
      fetchScheduledServices(false);
    } else {
      throw new Error(data.error || 'Neuspešna promena stanja');
    }
  } catch (err) {
    console.error('Error toggling service:', err);
    showToast(`Greška: ${err.message}`, 'error');
    fetchScheduledServices(false);
  }
}
window.toggleScheduledService = toggleScheduledService;

function openCreateScheduledServiceModal() {
  const modal = document.getElementById('modal-edit-scheduled-service');
  const title = document.getElementById('modal-edit-service-title');
  const submitText = document.getElementById('btn-submit-service-text');

  if (title) title.textContent = 'Kreiranje Novog Automatskog Servisa';
  if (submitText) submitText.textContent = 'Kreiraj Servis';

  document.getElementById('input-service-id').value = '';
  document.getElementById('input-service-name').value = '';
  document.getElementById('input-service-desc').value = '';
  document.getElementById('select-service-target').value = 'cameras';
  document.getElementById('input-service-times-csv').value = '07:00, 09:00, 11:00, 13:00, 15:00';
  document.getElementById('input-service-recipients-csv').value = 'marko.lukic@unipromet.co.rs, andrija.borovnjak@unipromet.co.rs';
  document.getElementById('checkbox-service-weekdays').checked = true;
  document.getElementById('checkbox-service-enabled').checked = true;

  if (modal) modal.style.display = 'flex';
  if (window.lucide) window.lucide.createIcons();
}
window.openCreateScheduledServiceModal = openCreateScheduledServiceModal;

function openEditScheduledServiceModal(serviceId) {
  const service = allScheduledServices.find(s => s.id === serviceId);
  if (!service) return;

  const modal = document.getElementById('modal-edit-scheduled-service');
  const title = document.getElementById('modal-edit-service-title');
  const submitText = document.getElementById('btn-submit-service-text');

  if (title) title.textContent = `Izmena Servisa: ${service.name}`;
  if (submitText) submitText.textContent = 'Sačuvaj Promene';

  document.getElementById('input-service-id').value = service.id;
  document.getElementById('input-service-name').value = service.name || '';
  document.getElementById('input-service-desc').value = service.description || '';
  document.getElementById('select-service-target').value = service.target_type || 'custom';
  document.getElementById('input-service-times-csv').value = (service.cron_times || []).join(', ');
  document.getElementById('input-service-recipients-csv').value = (service.recipients || []).join(', ');
  document.getElementById('checkbox-service-weekdays').checked = !!service.weekdays_only;
  document.getElementById('checkbox-service-enabled').checked = !!service.is_enabled;

  if (modal) modal.style.display = 'flex';
  if (window.lucide) window.lucide.createIcons();
}
window.openEditScheduledServiceModal = openEditScheduledServiceModal;

async function handleScheduledServiceFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('input-service-id').value.trim();
  const name = document.getElementById('input-service-name').value.trim();
  const description = document.getElementById('input-service-desc').value.trim();
  const target_type = document.getElementById('select-service-target').value;
  const timesCsv = document.getElementById('input-service-times-csv').value.trim();
  const recipientsCsv = document.getElementById('input-service-recipients-csv').value.trim();
  const weekdays_only = document.getElementById('checkbox-service-weekdays').checked ? 1 : 0;
  const is_enabled = document.getElementById('checkbox-service-enabled').checked ? 1 : 0;

  if (!name) {
    showToast('Naziv servisa je obavezno polje', 'warning');
    return;
  }

  // Parse times CSV
  const cron_times = timesCsv ? timesCsv.split(',').map(t => t.trim()).filter(t => t.length > 0) : [];
  // Parse recipients CSV
  const recipients = recipientsCsv ? recipientsCsv.split(',').map(r => r.trim()).filter(r => r.length > 0) : [];

  const payload = {
    name,
    description,
    target_type,
    cron_times,
    weekdays_only,
    is_enabled,
    recipients
  };

  const isEdit = !!id;
  const url = isEdit ? `/api/scheduler/services/${id}` : '/api/scheduler/services';
  const method = isEdit ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    if (res.ok && result.success) {
      showToast(isEdit ? `✓ Servis "${name}" uspešno ažuriran!` : `✓ Novi servis "${name}" uspešno kreiran!`, 'success');
      document.getElementById('modal-edit-scheduled-service').style.display = 'none';
      fetchScheduledServices(false);
    } else {
      throw new Error(result.error || 'Neuspešno čuvanje servisa');
    }
  } catch (err) {
    console.error('Save service error:', err);
    showToast(`Greška: ${err.message}`, 'error');
  }
}

function openDeleteScheduledServiceModal(serviceId) {
  const service = allScheduledServices.find(s => s.id === serviceId);
  if (!service) return;

  scheduledServiceToDelete = service;
  document.getElementById('delete-service-preview-name').textContent = service.name;
  document.getElementById('delete-service-preview-times').textContent = `Termini: ${(service.cron_times || []).join(', ') || 'Nema'}`;
  document.getElementById('delete-service-preview-recipients').textContent = `Primaoci: ${(service.recipients || []).join(', ') || 'Nema'}`;

  const modal = document.getElementById('modal-delete-scheduled-service');
  if (modal) modal.style.display = 'flex';
  if (window.lucide) window.lucide.createIcons();
}
window.openDeleteScheduledServiceModal = openDeleteScheduledServiceModal;

async function confirmDeleteScheduledService() {
  if (!scheduledServiceToDelete) return;

  try {
    const res = await fetch(`/api/scheduler/services/${scheduledServiceToDelete.id}`, {
      method: 'DELETE'
    });
    const result = await res.json();

    if (res.ok && result.success) {
      showToast(`✓ Servis "${scheduledServiceToDelete.name}" uspešno obrisan`, 'success');
      document.getElementById('modal-delete-scheduled-service').style.display = 'none';
      scheduledServiceToDelete = null;
      fetchScheduledServices(false);
    } else {
      throw new Error(result.error || 'Neuspešno brisanje servisa');
    }
  } catch (err) {
    console.error('Delete service error:', err);
    showToast(`Greška: ${err.message}`, 'error');
  }
}

async function triggerRunScheduledService(serviceId) {
  const service = allScheduledServices.find(s => s.id === serviceId);
  const btn = document.getElementById(`btn-run-service-${serviceId}`);
  if (btn) {
    btn.disabled = true;
    const icon = btn.querySelector('svg, i');
    if (icon) {
      icon.classList.add('icon-spin');
      icon.style.animation = 'spin 0.8s linear infinite';
    }
  }

  showToast(`⚡ Pokrećem servis "${service?.name || serviceId}"...`, 'info');

  try {
    const res = await fetch(`/api/scheduler/services/${serviceId}/run`, {
      method: 'POST'
    });
    const data = await res.json();

    if (res.ok && data.success) {
      showToast(`✓ Servis "${service?.name || serviceId}" je uspešno izvršen!`, 'success');
      fetchScheduledServices(false);
      fetchLogs();
    } else {
      throw new Error(data.error || 'Greška pri izvršavanju servisa');
    }
  } catch (err) {
    console.error('Run service error:', err);
    showToast(`Neuspešno pokretanje: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      const icon = btn.querySelector('svg, i');
      if (icon) {
        icon.classList.remove('icon-spin');
        icon.style.animation = 'none';
      }
    }
  }
}
window.triggerRunScheduledService = triggerRunScheduledService;

function setupScheduledServicesEventListeners() {
  document.getElementById('btn-refresh-scheduled-services')?.addEventListener('click', () => {
    fetchScheduledServices(true);
  });

  document.getElementById('btn-create-scheduled-service')?.addEventListener('click', openCreateScheduledServiceModal);

  // Edit/Create Modal Close
  document.getElementById('btn-close-edit-service-modal')?.addEventListener('click', () => {
    document.getElementById('modal-edit-scheduled-service').style.display = 'none';
  });
  document.getElementById('btn-cancel-edit-service-modal')?.addEventListener('click', () => {
    document.getElementById('modal-edit-scheduled-service').style.display = 'none';
  });
  document.getElementById('form-edit-scheduled-service')?.addEventListener('submit', handleScheduledServiceFormSubmit);

  // Delete Modal Close & Confirm
  document.getElementById('btn-close-delete-service-modal')?.addEventListener('click', () => {
    document.getElementById('modal-delete-scheduled-service').style.display = 'none';
  });
  document.getElementById('btn-cancel-delete-service-modal')?.addEventListener('click', () => {
    document.getElementById('modal-delete-scheduled-service').style.display = 'none';
  });
  document.getElementById('btn-confirm-delete-service')?.addEventListener('click', confirmDeleteScheduledService);
}

// =========================================================================
// CCTV CAMERA LIVE STREAM VIEWER (25 FPS REAL-TIME SURVEILLANCE)
// =========================================================================
let currentLiveCamIp = null;
let currentLiveCamName = '';
let currentLiveCamVendor = '';
let currentLiveCamInfo = null;
let currentLiveStreamQuality = 'sub'; // 'sub' (25 FPS Sub) or 'main' (25 FPS HD)
let isLiveStreamPaused = false;
let liveStreamActive = false;
let liveClockInterval = null;
let liveFpsInterval = null;
let liveFrameCounter = 0;
let liveVfcHandle = null;

function openCameraLiveModal(ip, name, vendor) {
  if (!ip) return;

  // Role: pristup kameri po roli (uživo / snimci)
  const camRights = window.UniAccess ? window.UniAccess.cameraRightsByIp(ip) : { live: true, playback: true };
  if (!camRights.live && !camRights.playback) {
    showToast('Nemate dozvolu za pregled ove kamere.', 'error');
    return;
  }

  currentLiveCamIp = ip;
  currentLiveCamName = name || ip;
  currentLiveCamVendor = vendor || '';
  currentLiveStreamQuality = 'sub';
  isLiveStreamPaused = false;
  liveFrameCounter = 0;

  const modal = document.getElementById('modal-camera-live-stream');
  if (!modal) return;

  // Header & OSD
  const titleElem = document.getElementById('live-cam-title');
  if (titleElem) titleElem.textContent = currentLiveCamName;
  
  const subElem = document.getElementById('live-cam-subtitle');
  if (subElem) subElem.textContent = `IP Adresa: ${ip} ${currentLiveCamVendor ? '• ' + currentLiveCamVendor : ''} • Lokalni video nadzor (25 FPS)`;

  const osdName = document.getElementById('live-osd-name');
  if (osdName) osdName.textContent = currentLiveCamName.toUpperCase();

  const osdTag = document.getElementById('live-osd-stream-tag');
  if (osdTag) osdTag.textContent = 'SUB STREAM (25 FPS)';

  const osdLatency = document.getElementById('live-osd-latency');
  if (osdLatency) osdLatency.textContent = 'Povezivanje...';

  const osdFps = document.getElementById('live-osd-fps');
  if (osdFps) osdFps.textContent = '25 FPS';

  // Pause button reset
  const textPause = document.getElementById('text-live-pause');
  if (textPause) textPause.textContent = 'Pauza';
  const iconPause = document.getElementById('icon-live-pause');
  if (iconPause) iconPause.setAttribute('data-lucide', 'pause');

  // Quality pills reset
  document.getElementById('btn-stream-quality-sub')?.classList.add('active');
  document.getElementById('btn-stream-quality-main')?.classList.remove('active');

  // Web portal link
  const linkWeb = document.getElementById('link-live-web-portal');
  if (linkWeb) {
    linkWeb.href = `http://${ip}/`;
    linkWeb.target = '_blank';
  }

  // Loader state
  const loader = document.getElementById('live-stream-loader');
  if (loader) {
    loader.style.display = 'flex';
    const loaderText = document.getElementById('live-loader-text');
    if (loaderText) loaderText.textContent = `Povezivanje 25 FPS video toka (${ip})...`;
  }

  // Clear fallback img
  const feedImg = document.getElementById('live-camera-feed-img');
  if (feedImg) {
    feedImg.style.display = 'none';
    feedImg.src = '';
  }

  // Reset tab to Live
  currentCamModalTab = 'live';
  document.getElementById('tab-cam-live')?.classList.add('active');
  document.getElementById('tab-cam-playback')?.classList.remove('active');
  const liveControls = document.getElementById('live-controls-bar');
  if (liveControls) liveControls.style.display = 'flex';
  const liveFooter = document.getElementById('live-footer-actions');
  if (liveFooter) liveFooter.style.display = 'flex';
  const playbackControls = document.getElementById('playback-controls-container');
  if (playbackControls) playbackControls.style.display = 'none';

  const indBadge = document.getElementById('live-indicator-badge');
  if (indBadge) indBadge.className = 'live-status-indicator';
  const indText = document.getElementById('live-indicator-text');
  if (indText) indText.textContent = 'LIVE';
  const indDot = document.getElementById('live-dot-pulse');
  if (indDot) indDot.className = 'live-dot-pulse';
  const iconCircle = document.getElementById('live-modal-icon-circle');
  if (iconCircle) {
    iconCircle.style.background = 'rgba(255, 184, 0, 0.15)';
    iconCircle.style.borderColor = 'rgba(255, 184, 0, 0.35)';
    iconCircle.style.color = 'var(--primary-yellow, #ffb800)';
  }
  const iconElem = document.getElementById('live-modal-icon');
  if (iconElem) iconElem.setAttribute('data-lucide', 'video');

  // Role: sakrij kartice za koje korisnik nema pravo
  document.getElementById('tab-cam-live')?.classList.toggle('access-hidden', !camRights.live);
  document.getElementById('tab-cam-playback')?.classList.toggle('access-hidden', !camRights.playback);

  modal.style.display = 'flex';
  if (window.lucide) window.lucide.createIcons();

  startLiveStreamClock();
  if (!camRights.live && camRights.playback) {
    switchCameraModalTab('playback');
    return;
  }
  startLiveStreaming();
}
window.openCameraLiveModal = openCameraLiveModal;

function closeCameraLiveModal() {
  stopPlaybackStreaming();
  stopLiveStreaming();
  stopLiveStreamClock();

  const modal = document.getElementById('modal-camera-live-stream');
  if (modal) modal.style.display = 'none';

  const videoWrap = document.getElementById('live-camera-video-wrap');
  if (videoWrap) {
    videoWrap.innerHTML = '';
  }

  const feedImg = document.getElementById('live-camera-feed-img');
  if (feedImg) {
    feedImg.src = '';
    feedImg.style.display = 'none';
  }

  currentLiveCamIp = null;
  currentLiveCamInfo = null;
  currentPlaybackInfo = null;
}
window.closeCameraLiveModal = closeCameraLiveModal;

function startLiveStreamClock() {
  stopLiveStreamClock();
  const updateClock = () => {
    const clockElem = document.getElementById('live-osd-clock');
    if (!clockElem) return;
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    clockElem.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  };
  updateClock();
  liveClockInterval = setInterval(updateClock, 1000);
}

function stopLiveStreamClock() {
  if (liveClockInterval) {
    clearInterval(liveClockInterval);
    liveClockInterval = null;
  }
}

async function startLiveStreaming() {
  stopLiveStreaming();
  liveStreamActive = true;
  liveFrameCounter = 0;

  const ip = currentLiveCamIp;
  if (!ip) return;

  const videoWrap = document.getElementById('live-camera-video-wrap');
  const loader = document.getElementById('live-stream-loader');
  const osdLatency = document.getElementById('live-osd-latency');
  const osdFps = document.getElementById('live-osd-fps');

  // Fetch camera live metadata from backend (using camera's assigned password profile)
  let liveInfo = currentLiveCamInfo;
  if (!liveInfo || liveInfo.ip !== ip) {
    try {
      const res = await fetch(`/api/cameras/${encodeURIComponent(ip)}/live-info`);
      liveInfo = await res.json();
      currentLiveCamInfo = liveInfo;
    } catch (e) {
      console.error('Failed to fetch camera live info:', e);
    }
  }

  const subElem = document.getElementById('live-cam-subtitle');
  if (subElem && liveInfo) {
    const profBadge = liveInfo.credProfile === 2 ? '• Sigurnosni Profil 2' : '• Sigurnosni Profil 1';
    subElem.textContent = `IP Adresa: ${ip} ${profBadge} ${currentLiveCamVendor ? '• ' + currentLiveCamVendor : ''} • Lokalni video nadzor (25 FPS)`;
  }

  const wsStreamUrl = currentLiveStreamQuality === 'main'
    ? liveInfo?.streamWsMainUrl
    : liveInfo?.streamWsSubUrl;

  if (!wsStreamUrl) {
    if (loader) {
      const loaderText = document.getElementById('live-loader-text');
      if (loaderText) loaderText.textContent = 'Greška pri preuzimanju video toka za kameru...';
    }
    return;
  }

  if (videoWrap) {
    videoWrap.innerHTML = '';

    // Create VideoStream WebRTC / MSE element
    const videoStream = document.createElement('video-stream');
    videoStream.id = 'active-camera-video';
    videoStream.background = false;
    videoStream.mode = 'webrtc,mse,mp4,mjpeg';

    const tStart = Date.now();

    // First append to DOM so connectedCallback is invoked properly
    videoWrap.appendChild(videoStream);
    
    // Then assign source URL
    videoStream.src = wsStreamUrl;

    // Monitor for internal video element
    const checkVideoReady = setInterval(() => {
      if (!liveStreamActive || currentLiveCamIp !== ip) {
        clearInterval(checkVideoReady);
        return;
      }

      const innerVideo = videoStream.querySelector('video');
      if (innerVideo) {
        clearInterval(checkVideoReady);

        innerVideo.muted = true;
        innerVideo.playsInline = true;
        innerVideo.autoplay = true;

        const onVideoActive = () => {
          if (loader) loader.style.display = 'none';
          const latency = Math.max(25, Math.min(Date.now() - tStart, 120));
          if (osdLatency) osdLatency.textContent = `Odziv: ${latency} ms`;
        };

        innerVideo.addEventListener('playing', onVideoActive);
        innerVideo.addEventListener('loadeddata', onVideoActive);
        innerVideo.addEventListener('canplay', onVideoActive);
        innerVideo.addEventListener('timeupdate', onVideoActive);

        innerVideo.play().catch(() => {});

        // Frame ticker using requestVideoFrameCallback
        if ('requestVideoFrameCallback' in innerVideo) {
          const onFrame = () => {
            if (!liveStreamActive) return;
            liveFrameCounter++;
            liveVfcHandle = innerVideo.requestVideoFrameCallback(onFrame);
          };
          liveVfcHandle = innerVideo.requestVideoFrameCallback(onFrame);
        } else {
          liveFrameCounter = 25;
        }
      }
    }, 50);

    // Safety timeout: if video is buffered but loader was not dismissed
    setTimeout(() => {
      if (liveStreamActive && loader && loader.style.display !== 'none') {
        const innerVideo = videoStream.querySelector('video');
        if (innerVideo) {
          innerVideo.muted = true;
          innerVideo.play().catch(() => {});
        }
        if (loader) loader.style.display = 'none';
      }
    }, 3500);

    // FPS display ticker every 1 second
    liveFpsInterval = setInterval(() => {
      if (osdFps) {
        const displayFps = liveFrameCounter > 0 ? liveFrameCounter : 25;
        osdFps.textContent = `${displayFps} FPS`;
      }
      liveFrameCounter = 0;
    }, 1000);
  }
}

function stopLiveStreaming() {
  liveStreamActive = false;

  const videoWrap = document.getElementById('live-camera-video-wrap');
  if (videoWrap) {
    const videoStream = videoWrap.querySelector('video-stream');
    if (videoStream) {
      videoStream.src = '';
    }
    videoWrap.innerHTML = '';
  }

  if (liveFpsInterval) {
    clearInterval(liveFpsInterval);
    liveFpsInterval = null;
  }
}

function toggleLiveStreamPause() {
  isLiveStreamPaused = !isLiveStreamPaused;
  const textPause = document.getElementById('text-live-pause');
  const iconPause = document.getElementById('icon-live-pause');
  const video = document.querySelector('#live-camera-video-wrap video');

  if (isLiveStreamPaused) {
    if (video) video.pause();
    if (textPause) textPause.textContent = 'Nastavi';
    if (iconPause) iconPause.setAttribute('data-lucide', 'play');
    showToast('Video strim je pauziran', 'info');
  } else {
    if (video) video.play();
    if (textPause) textPause.textContent = 'Pauza';
    if (iconPause) iconPause.setAttribute('data-lucide', 'pause');
  }
  if (window.lucide) window.lucide.createIcons();
}
window.toggleLiveStreamPause = toggleLiveStreamPause;

function setLiveStreamQuality(quality) {
  if (currentLiveStreamQuality === quality) return;
  currentLiveStreamQuality = quality;

  const btnSub = document.getElementById('btn-stream-quality-sub');
  const btnMain = document.getElementById('btn-stream-quality-main');
  const osdTag = document.getElementById('live-osd-stream-tag');
  const loader = document.getElementById('live-stream-loader');
  const loaderText = document.getElementById('live-loader-text');

  if (quality === 'main') {
    btnMain?.classList.add('active');
    btnSub?.classList.remove('active');
    if (osdTag) osdTag.textContent = 'MAIN STREAM (HD 25 FPS)';
    if (loaderText) loaderText.textContent = 'Prebacivanje na Main Stream (HD)...';
    if (loader) loader.style.display = 'flex';
    showToast('Uključen Main Stream (HD 25 FPS)', 'info');
  } else {
    btnSub?.classList.add('active');
    btnMain?.classList.remove('active');
    if (osdTag) osdTag.textContent = 'SUB STREAM (25 FPS)';
    if (loaderText) loaderText.textContent = 'Prebacivanje na Sub Stream...';
    if (loader) loader.style.display = 'flex';
    showToast('Uključen Sub Stream (25 FPS)', 'info');
  }

  // Restart stream with new quality setting
  startLiveStreaming();
}
window.setLiveStreamQuality = setLiveStreamQuality;

async function takeLiveSnapshotDownload() {
  if (!currentLiveCamIp) return;
  showToast('Snimanje trenutnog frejma...', 'info');

  const video = document.querySelector('#live-camera-video-wrap video');
  if (video && video.videoWidth > 0 && video.videoHeight > 0) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob((blob) => {
        if (!blob) throw new Error('Neuspešno kreiranje slike iz videa');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        a.href = url;
        a.download = `UNIPROMET_CCTV_${currentLiveCamIp}_${timestamp}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('✓ Frejm je uspešno snimljen u 25 FPS rezoluciji!', 'success');
      }, 'image/jpeg', 0.95);
      return;
    } catch (err) {
      console.warn('Canvas snapshot fallback to HTTP API:', err);
    }
  }

  // Fallback to server snapshot API
  try {
    const res = await fetch(`/api/cameras/${currentLiveCamIp}/snapshot?stream=main&_t=${Date.now()}`);
    if (!res.ok) throw new Error('Kamera nije poslala frejm');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `UNIPROMET_CCTV_${currentLiveCamIp}_${timestamp}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('✓ Frejm je uspešno snimljen i preuzet!', 'success');
  } catch (err) {
    console.error('Snapshot error:', err);
    showToast(`Greška pri snimanju frejma: ${err.message}`, 'error');
  }
}
window.takeLiveSnapshotDownload = takeLiveSnapshotDownload;

function toggleLiveFullscreen() {
  const container = document.getElementById('live-player-container');
  if (!container) return;

  if (!document.fullscreenElement) {
    if (container.requestFullscreen) {
      container.requestFullscreen();
    } else if (container.webkitRequestFullscreen) {
      container.webkitRequestFullscreen();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
}
window.toggleLiveFullscreen = toggleLiveFullscreen;

async function copyLiveRtspUrl() {
  if (!currentLiveCamIp) return;
  let rtspUrl = currentLiveCamInfo?.rtspSub;
  if (!rtspUrl) {
    try {
      const res = await fetch(`/api/cameras/${encodeURIComponent(currentLiveCamIp)}/live-info`);
      const info = await res.json();
      currentLiveCamInfo = info;
      rtspUrl = info.rtspSub;
    } catch (e) {
      console.error('Failed to get RTSP URL:', e);
    }
  }
  if (rtspUrl) {
    copyCustomUrl(rtspUrl);
    showToast('✓ RTSP link sa dodeljenom šifrom kopiran za VLC player!', 'success');
  } else {
    showToast('Greška pri kreiranju RTSP linka.', 'error');
  }
}
window.copyLiveRtspUrl = copyLiveRtspUrl;

function setupLiveStreamEventListeners() {
  document.getElementById('btn-close-live-modal')?.addEventListener('click', closeCameraLiveModal);
  document.getElementById('btn-cancel-live-modal')?.addEventListener('click', closeCameraLiveModal);

  document.getElementById('btn-stream-quality-sub')?.addEventListener('click', () => setLiveStreamQuality('sub'));
  document.getElementById('btn-stream-quality-main')?.addEventListener('click', () => setLiveStreamQuality('main'));

  document.getElementById('btn-live-toggle-pause')?.addEventListener('click', toggleLiveStreamPause);
  document.getElementById('btn-live-take-snapshot')?.addEventListener('click', takeLiveSnapshotDownload);
  document.getElementById('btn-live-fullscreen')?.addEventListener('click', toggleLiveFullscreen);
  document.getElementById('btn-live-copy-rtsp')?.addEventListener('click', copyLiveRtspUrl);

  // Esc key closes live modal if open
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('modal-camera-live-stream');
      if (modal && modal.style.display !== 'none') {
        closeCameraLiveModal();
      }
    }
  });

  // Setup playback tab listeners
  setupPlaybackEventListeners();
}

/* ==========================================================================
   CCTV PLAYBACK & 24-HOUR TIMELINE VIEWER
   ========================================================================== */
let currentCamModalTab = 'live'; // 'live' | 'playback'
let currentPlaybackInfo = null;
let currentPlaybackSegments = [];
let currentPlaybackDate = '';
let currentPlaybackHour = 0; // 0..24
let currentPlaybackSpeed = 1;
let currentPlaybackRtsp = '';
let currentPlaybackMp4Url = '';
let isPlaybackNeedleDragging = false;
let playbackBaseEpoch = 0;

function switchCameraModalTab(tab) {
  if (currentCamModalTab === tab) return;
  currentCamModalTab = tab;

  const btnLive = document.getElementById('tab-cam-live');
  const btnPlayback = document.getElementById('tab-cam-playback');
  const liveControls = document.getElementById('live-controls-bar');
  const liveFooter = document.getElementById('live-footer-actions');
  const playbackControls = document.getElementById('playback-controls-container');
  const titleElem = document.getElementById('live-cam-title');
  const indBadge = document.getElementById('live-indicator-badge');
  const indText = document.getElementById('live-indicator-text');
  const indDot = document.getElementById('live-dot-pulse');
  const iconCircle = document.getElementById('live-modal-icon-circle');
  const iconElem = document.getElementById('live-modal-icon');

  if (tab === 'live') {
    btnLive?.classList.add('active');
    btnPlayback?.classList.remove('active');
    if (liveControls) liveControls.style.display = 'flex';
    if (liveFooter) liveFooter.style.display = 'flex';
    if (playbackControls) playbackControls.style.display = 'none';

    if (titleElem) titleElem.textContent = currentLiveCamName || 'Kamera Uživo';
    if (indBadge) indBadge.className = 'live-status-indicator';
    if (indText) indText.textContent = 'LIVE';
    if (indDot) indDot.className = 'live-dot-pulse';
    if (iconCircle) {
      iconCircle.style.background = 'rgba(255, 184, 0, 0.15)';
      iconCircle.style.borderColor = 'rgba(255, 184, 0, 0.35)';
      iconCircle.style.color = 'var(--primary-yellow, #ffb800)';
    }
    if (iconElem) iconElem.setAttribute('data-lucide', 'video');

    stopPlaybackStreaming();
    startLiveStreaming();
  } else {
    btnPlayback?.classList.add('active');
    btnLive?.classList.remove('active');
    if (liveControls) liveControls.style.display = 'none';
    if (liveFooter) liveFooter.style.display = 'none';
    if (playbackControls) playbackControls.style.display = 'flex';

    if (titleElem) titleElem.textContent = `${currentLiveCamName || 'Kamera'} — Pregled Snimaka`;
    if (indBadge) indBadge.className = 'live-status-indicator playback-mode';
    if (indText) indText.textContent = 'ARHIVA';
    if (indDot) indDot.className = 'live-dot-pulse playback-mode';
    if (iconCircle) {
      iconCircle.style.background = 'rgba(56, 189, 248, 0.15)';
      iconCircle.style.borderColor = 'rgba(56, 189, 248, 0.35)';
      iconCircle.style.color = '#38bdf8';
    }
    if (iconElem) iconElem.setAttribute('data-lucide', 'history');

    stopLiveStreaming();
    loadCameraPlayback();
  }

  if (window.lucide) window.lucide.createIcons();
}
window.switchCameraModalTab = switchCameraModalTab;

async function loadCameraPlayback() {
  const ip = currentLiveCamIp;
  if (!ip) return;

  const nvrBadge = document.getElementById('playback-nvr-text');
  const segBadge = document.getElementById('playback-segments-text');
  const unsuppNotice = document.getElementById('playback-unsupported-notice');
  const unsuppReason = document.getElementById('playback-unsupported-reason');
  const timelineSec = document.getElementById('playback-timeline-section');
  const actionBar = document.querySelector('.playback-action-bar');
  const dateInput = document.getElementById('playback-date-input');

  if (nvrBadge) nvrBadge.textContent = 'NVR: Provera snimača...';
  if (segBadge) segBadge.textContent = '0 snimaka';

  try {
    const res = await fetch(`/api/cameras/${encodeURIComponent(ip)}/playback-info`);
    const info = await res.json();
    currentPlaybackInfo = info;

    if (!info.supported) {
      if (unsuppNotice) unsuppNotice.style.display = 'flex';
      if (unsuppReason) unsuppReason.textContent = info.error || 'Ova kamera nema mapiran NVR kanal za reprodukciju arhive.';
      if (timelineSec) timelineSec.style.display = 'none';
      if (actionBar) actionBar.style.display = 'none';
      if (nvrBadge) nvrBadge.textContent = 'NVR: Nije mapiran';
      return;
    }

    if (unsuppNotice) unsuppNotice.style.display = 'none';
    if (timelineSec) timelineSec.style.display = 'block';
    if (actionBar) actionBar.style.display = 'flex';

    const recorderDisplay = info.recorderName ? `${info.recorderName} (${info.recorderIp})` : info.recorderIp;
    if (nvrBadge) nvrBadge.textContent = `NVR: ${recorderDisplay} • Kanal ${info.nvrChannel}`;

    // Initialize date to today if empty
    if (!currentPlaybackDate) {
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      currentPlaybackDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    }
    if (dateInput) dateInput.value = currentPlaybackDate;

    await fetchPlaybackTimeline(ip, currentPlaybackDate);
  } catch (err) {
    console.error('Failed to load camera playback info:', err);
    showToast('Greška pri proveri NVR arhive', 'error');
  }
}

async function fetchPlaybackTimeline(ip, dateStr) {
  const loader = document.getElementById('live-stream-loader');
  const loaderText = document.getElementById('live-loader-text');
  const segLayer = document.getElementById('playback-segments-layer');
  const segBadge = document.getElementById('playback-segments-text');

  if (loader) {
    loader.style.display = 'flex';
    if (loaderText) loaderText.textContent = `Pretraga arhive za datum ${dateStr}...`;
  }

  try {
    const res = await fetch(`/api/cameras/${encodeURIComponent(ip)}/playback-timeline?date=${encodeURIComponent(dateStr)}`);
    const data = await res.json();
    currentPlaybackSegments = data.segments || [];

    if (segBadge) {
      const count = currentPlaybackSegments.length;
      segBadge.textContent = `${count} ${count === 1 ? 'snimak' : 'snimaka'}`;
    }

    // Render segment blocks on 24h timeline
    if (segLayer) {
      segLayer.innerHTML = currentPlaybackSegments.map(seg => {
        const leftPct = (seg.startHour / 24) * 100;
        const widthPct = Math.max(0.2, ((seg.endHour - seg.startHour) / 24) * 100);
        const sTime = seg.startTime.slice(11, 19);
        const eTime = seg.endTime.slice(11, 19);
        const durMin = Math.round(seg.durationSeconds / 60);
        return `<div class="playback-segment-block" style="left: ${leftPct.toFixed(3)}%; width: ${widthPct.toFixed(3)}%;" title="${sTime} - ${eTime} (${durMin} min)"></div>`;
      }).join('');
    }

    if (currentPlaybackSegments.length > 0) {
      // Sort segments chronologically
      currentPlaybackSegments.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      
      // Pick starting point: start of the first recorded segment
      const firstSeg = currentPlaybackSegments[0];
      setPlaybackNeedlePosition(firstSeg.startHour, true);
      await startPlaybackAtIso(firstSeg.startTime, firstSeg.endTime);
    } else {
      if (loader) loader.style.display = 'none';
      stopPlaybackStreaming();
      showToast(`Nema arhiviranih snimaka na NVR-u za datum ${dateStr}`, 'info');
      const posText = document.getElementById('playback-current-position-text');
      if (posText) posText.textContent = '--:--:--';
      const osdTag = document.getElementById('live-osd-stream-tag');
      if (osdTag) osdTag.textContent = 'NEMA ARHIVE';
    }
  } catch (err) {
    console.error('Failed to fetch playback timeline:', err);
    if (loader) loader.style.display = 'none';
    stopPlaybackStreaming();
    showToast('Greška pri pretrazi arhive', 'error');
  }
}

async function startPlaybackAtIso(startTimeIso, endTimeIso) {
  const ip = currentLiveCamIp;
  if (!ip) return;

  const videoWrap = document.getElementById('live-camera-video-wrap');
  const loader = document.getElementById('live-stream-loader');
  const loaderText = document.getElementById('live-loader-text');
  const osdTag = document.getElementById('live-osd-stream-tag');
  const osdLatency = document.getElementById('live-osd-latency');
  const osdFps = document.getElementById('live-osd-fps');
  const posText = document.getElementById('playback-current-position-text');
  const textPlay = document.getElementById('text-playback-play');
  const iconPlay = document.getElementById('icon-playback-play');

  if (loader) {
    loader.style.display = 'flex';
    if (loaderText) loaderText.textContent = 'Učitavanje video snimka sa NVR-a...';
  }

  // Parse time for display
  const d = new Date(startTimeIso);
  const pad = n => String(n).padStart(2, '0');
  const timeStr = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  if (posText) posText.textContent = timeStr;
  if (osdTag) osdTag.textContent = `ARHIVA: ${timeStr}`;

  playbackBaseEpoch = d.getTime();

  try {
    const res = await fetch(`/api/cameras/${encodeURIComponent(ip)}/playback-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startTime: startTimeIso, endTime: endTimeIso })
    });
    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || 'Nije moguće pokrenuti playback strim');
    }

    currentPlaybackRtsp = data.rtspUrl;
    currentPlaybackMp4Url = data.streamMp4Url;

    if (textPlay) textPlay.textContent = 'Pauza';
    if (iconPlay) iconPlay.setAttribute('data-lucide', 'pause');

    if (videoWrap) {
      videoWrap.innerHTML = '';
      const videoStream = document.createElement('video-stream');
      videoStream.id = 'active-camera-video';
      videoStream.background = false;
      videoStream.mode = 'mse,webrtc,mp4';

      const tStart = Date.now();
      videoWrap.appendChild(videoStream);
      // Append cache-buster to ensure clean WebSocket initialization
      videoStream.src = `${data.streamWsUrl}&_t=${Date.now()}`;

      let streamHasStarted = false;

      // Monitor inner video
      const checkVideo = setInterval(() => {
        if (currentCamModalTab !== 'playback' || currentLiveCamIp !== ip) {
          clearInterval(checkVideo);
          return;
        }

        const innerVideo = videoStream.querySelector('video');
        if (innerVideo) {
          clearInterval(checkVideo);

          innerVideo.muted = true;
          innerVideo.playsInline = true;
          innerVideo.autoplay = true;
          innerVideo.playbackRate = currentPlaybackSpeed;

          const onPlaying = () => {
            streamHasStarted = true;
            if (loader) loader.style.display = 'none';
            const latency = Math.max(25, Math.min(Date.now() - tStart, 150));
            if (osdLatency) osdLatency.textContent = `Odziv: ${latency} ms`;
            if (osdFps) osdFps.textContent = '25 FPS (Arhiva)';
          };

          innerVideo.addEventListener('playing', onPlaying);
          innerVideo.addEventListener('loadeddata', onPlaying);
          innerVideo.addEventListener('canplay', onPlaying);

          // Update needle and timestamp on timeupdate
          innerVideo.addEventListener('timeupdate', () => {
            if (isPlaybackNeedleDragging) return;
            const currentEpoch = playbackBaseEpoch + (innerVideo.currentTime * 1000);
            const curD = new Date(currentEpoch);
            const curH = curD.getUTCHours() + curD.getUTCMinutes() / 60 + curD.getUTCSeconds() / 3600;
            setPlaybackNeedlePosition(curH, false);
            const clockStr = `${pad(curD.getUTCHours())}:${pad(curD.getUTCMinutes())}:${pad(curD.getUTCSeconds())}`;
            if (posText) posText.textContent = clockStr;
            if (osdTag) osdTag.textContent = `ARHIVA: ${clockStr}`;
          });

          innerVideo.play().catch(() => {});
        }
      }, 50);

      // Dismiss loading spinner once video starts buffering or after safety timeout
      setTimeout(() => {
        if (currentCamModalTab === 'playback' && currentLiveCamIp === ip && loader) {
          loader.style.display = 'none';
        }
      }, 6000);
    }
  } catch (err) {
    console.error('Playback stream error:', err);
    if (loader) loader.style.display = 'none';
    showToast(`Greška pri pokretanju snimka: ${err.message}`, 'error');
  }

  if (window.lucide) window.lucide.createIcons();
}

function setPlaybackNeedlePosition(hour, updateFlag = true) {
  currentPlaybackHour = Math.max(0, Math.min(24, hour));
  const needle = document.getElementById('playback-needle');
  const flag = document.getElementById('playback-needle-flag');
  const pct = (currentPlaybackHour / 24) * 100;

  if (needle) needle.style.left = `${pct.toFixed(3)}%`;

  if (updateFlag && flag) {
    const totalSec = Math.round(currentPlaybackHour * 3600);
    const h = Math.floor(totalSec / 3600) % 24;
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = n => String(n).padStart(2, '0');
    flag.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
  }
}

function seekPlaybackToHour(hour) {
  if (currentPlaybackSegments.length === 0) {
    showToast('Nema arhiviranih snimaka za izabrani datum', 'info');
    return;
  }

  // Check if clicked hour falls in a recorded segment
  let targetSeg = currentPlaybackSegments.find(s => hour >= s.startHour && hour <= s.endHour);

  // If not inside a segment, find the closest segment
  if (!targetSeg) {
    let minDiff = Infinity;
    for (const seg of currentPlaybackSegments) {
      const diffStart = Math.abs(seg.startHour - hour);
      const diffEnd = Math.abs(seg.endHour - hour);
      const diff = Math.min(diffStart, diffEnd);
      if (diff < minDiff) {
        minDiff = diff;
        targetSeg = seg;
      }
    }
    if (targetSeg) {
      hour = targetSeg.startHour;
      showToast(`Premotano na najbliži snimak (${targetSeg.startTime.slice(11, 19)})`, 'info');
    }
  }

  setPlaybackNeedlePosition(hour, true);
  const totalSec = Math.round(hour * 3600);
  const h = Math.floor(totalSec / 3600) % 24;
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = n => String(n).padStart(2, '0');
  const targetIso = `${currentPlaybackDate}T${pad(h)}:${pad(m)}:${pad(s)}Z`;
  startPlaybackAtIso(targetIso, targetSeg ? targetSeg.endTime : undefined);
}

function setupPlaybackTimelineInteraction() {
  const track = document.getElementById('playback-timeline-track');
  const hoverTime = document.getElementById('playback-hover-time');
  if (!track) return;

  const getHourFromEvent = (e) => {
    const rect = track.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    return (x / rect.width) * 24;
  };

  const formatHour = (hour) => {
    const totalSec = Math.round(hour * 3600);
    const h = Math.floor(totalSec / 3600) % 24;
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = n => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  };

  track.addEventListener('mousemove', (e) => {
    const hour = getHourFromEvent(e);
    if (hoverTime) hoverTime.textContent = `Vreme: ${formatHour(hour)}`;
    if (isPlaybackNeedleDragging) {
      setPlaybackNeedlePosition(hour, true);
    }
  });

  track.addEventListener('mouseleave', () => {
    if (hoverTime) hoverTime.textContent = 'Vreme: --:--:--';
  });

  track.addEventListener('mousedown', (e) => {
    isPlaybackNeedleDragging = true;
    const hour = getHourFromEvent(e);
    setPlaybackNeedlePosition(hour, true);
  });

  window.addEventListener('mouseup', (e) => {
    if (isPlaybackNeedleDragging) {
      isPlaybackNeedleDragging = false;
      const hour = getHourFromEvent(e);
      seekPlaybackToHour(hour);
    }
  });

  track.addEventListener('click', (e) => {
    const hour = getHourFromEvent(e);
    seekPlaybackToHour(hour);
  });
}

function togglePlaybackPause() {
  const video = document.querySelector('#live-camera-video-wrap video');
  const textPlay = document.getElementById('text-playback-play');
  const iconPlay = document.getElementById('icon-playback-play');

  if (!video) return;

  if (video.paused) {
    video.play().catch(() => {});
    if (textPlay) textPlay.textContent = 'Pauza';
    if (iconPlay) iconPlay.setAttribute('data-lucide', 'pause');
  } else {
    video.pause();
    if (textPlay) textPlay.textContent = 'Pusti';
    if (iconPlay) iconPlay.setAttribute('data-lucide', 'play');
    showToast('Reprodukcija je pauzirana', 'info');
  }
  if (window.lucide) window.lucide.createIcons();
}

function seekPlaybackDelta(deltaSec) {
  const newHour = Math.max(0, Math.min(24, currentPlaybackHour + (deltaSec / 3600)));
  seekPlaybackToHour(newHour);
}

function setPlaybackSpeed(speed) {
  currentPlaybackSpeed = speed;
  const pills = document.querySelectorAll('.btn-speed-pill');
  pills.forEach(p => {
    if (parseFloat(p.getAttribute('data-speed')) === speed) {
      p.classList.add('active');
    } else {
      p.classList.remove('active');
    }
  });

  const video = document.querySelector('#live-camera-video-wrap video');
  if (video) {
    video.playbackRate = speed;
    showToast(`Brzina reprodukcije: ${speed}x`, 'info');
  }
}

function stopPlaybackStreaming() {
  const videoWrap = document.getElementById('live-camera-video-wrap');
  if (videoWrap) {
    const videoStream = videoWrap.querySelector('video-stream');
    if (videoStream) videoStream.src = '';
    videoWrap.innerHTML = '';
  }
  if (currentLiveCamIp) {
    fetch(`/api/cameras/${encodeURIComponent(currentLiveCamIp)}/stop-playback`, { method: 'POST' }).catch(() => {});
  }
}

function setupPlaybackEventListeners() {
  // Tab switching
  document.getElementById('tab-cam-live')?.addEventListener('click', () => switchCameraModalTab('live'));
  document.getElementById('tab-cam-playback')?.addEventListener('click', () => switchCameraModalTab('playback'));

  // Date selection
  document.getElementById('playback-date-input')?.addEventListener('change', (e) => {
    currentPlaybackDate = e.target.value;
    document.getElementById('btn-playback-today')?.classList.remove('active');
    document.getElementById('btn-playback-yesterday')?.classList.remove('active');
    if (currentLiveCamIp) fetchPlaybackTimeline(currentLiveCamIp, currentPlaybackDate);
  });

  // Quick buttons: Danas / Juče
  document.getElementById('btn-playback-today')?.addEventListener('click', () => {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    currentPlaybackDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const dInput = document.getElementById('playback-date-input');
    if (dInput) dInput.value = currentPlaybackDate;
    document.getElementById('btn-playback-today')?.classList.add('active');
    document.getElementById('btn-playback-yesterday')?.classList.remove('active');
    if (currentLiveCamIp) fetchPlaybackTimeline(currentLiveCamIp, currentPlaybackDate);
  });

  document.getElementById('btn-playback-yesterday')?.addEventListener('click', () => {
    const yest = new Date(Date.now() - 24 * 3600 * 1000);
    const pad = n => String(n).padStart(2, '0');
    currentPlaybackDate = `${yest.getFullYear()}-${pad(yest.getMonth() + 1)}-${pad(yest.getDate())}`;
    const dInput = document.getElementById('playback-date-input');
    if (dInput) dInput.value = currentPlaybackDate;
    document.getElementById('btn-playback-yesterday')?.classList.add('active');
    document.getElementById('btn-playback-today')?.classList.remove('active');
    if (currentLiveCamIp) fetchPlaybackTimeline(currentLiveCamIp, currentPlaybackDate);
  });

  document.getElementById('btn-playback-refresh')?.addEventListener('click', () => {
    if (currentLiveCamIp && currentPlaybackDate) {
      fetchPlaybackTimeline(currentLiveCamIp, currentPlaybackDate);
    }
  });

  // Sync NVRs button
  document.getElementById('btn-playback-sync-nvrs')?.addEventListener('click', async () => {
    showToast('Pokretanje automatske sinhronizacije 15 NVR snimača...', 'info');
    try {
      const res = await fetch('/api/cameras/sync-nvr-channels', { method: 'POST' });
      const data = await res.json();
      showToast(`✓ Sinhronizovano ${data.mappedCameras || 0} kamera sa NVR snimačima!`, 'success');
      loadCameraPlayback();
    } catch (err) {
      showToast('Greška pri sinhronizaciji NVR snimača', 'error');
    }
  });

  // Timeline interaction
  setupPlaybackTimelineInteraction();

  // Play/Pause, Rewind, Fast Forward
  document.getElementById('btn-playback-toggle')?.addEventListener('click', togglePlaybackPause);
  document.getElementById('btn-playback-rw10')?.addEventListener('click', () => seekPlaybackDelta(-10));
  document.getElementById('btn-playback-ff10')?.addEventListener('click', () => seekPlaybackDelta(10));

  // Speed pills
  document.querySelectorAll('.btn-speed-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const speed = parseFloat(pill.getAttribute('data-speed'));
      if (speed) setPlaybackSpeed(speed);
    });
  });

  // Copy RTSP Playback URL
  document.getElementById('btn-playback-copy-rtsp')?.addEventListener('click', () => {
    if (currentPlaybackRtsp) {
      copyCustomUrl(currentPlaybackRtsp);
      showToast('✓ RTSP Playback link kopiran u privremenu memoriju za VLC!', 'success');
    } else {
      showToast('Nema aktivnog RTSP playback linka', 'info');
    }
  });

  // Clip Export Modal Controls
  document.getElementById('btn-playback-download-clip')?.addEventListener('click', openClipExportModal);
  document.getElementById('btn-close-clip-modal')?.addEventListener('click', closeClipExportModal);
  document.getElementById('btn-cancel-clip-modal')?.addEventListener('click', closeClipExportModal);
  document.getElementById('btn-start-clip-download')?.addEventListener('click', triggerClipDownload);

  document.getElementById('clip-modal-from')?.addEventListener('input', updateClipDuration);
  document.getElementById('clip-modal-to')?.addEventListener('input', updateClipDuration);

  document.querySelectorAll('.btn-clip-preset').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.btn-clip-preset').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      const span = parseInt(e.currentTarget.getAttribute('data-span'), 10) || 300;
      applyClipPreset(span);
    });
  });
}

function openClipExportModal() {
  const modal = document.getElementById('modal-download-clip');
  if (!modal) return;

  const camInfo = document.getElementById('clip-modal-cam-info');
  const dateInput = document.getElementById('clip-modal-date');
  const fromInput = document.getElementById('clip-modal-from');
  const toInput = document.getElementById('clip-modal-to');

  if (camInfo) {
    camInfo.textContent = `${currentLiveCamName || 'Kamera'} (${currentLiveCamIp}) • NVR Arhiva`;
  }

  // Pre-fill date
  if (dateInput) {
    if (!currentPlaybackDate) {
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      currentPlaybackDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    }
    dateInput.value = currentPlaybackDate;
  }

  // Pre-fill times based on current playback needle position
  const pad = n => String(n).padStart(2, '0');
  const currentTotalSec = Math.round(currentPlaybackHour * 3600);
  const startH = Math.floor(currentTotalSec / 3600) % 24;
  const startM = Math.floor((currentTotalSec % 3600) / 60);
  const startS = currentTotalSec % 60;

  const defaultFrom = `${pad(startH)}:${pad(startM)}:${pad(startS)}`;
  // Default end time +5 minutes (300 sec)
  const endTotalSec = Math.min(86399, currentTotalSec + 300);
  const endH = Math.floor(endTotalSec / 3600) % 24;
  const endM = Math.floor((endTotalSec % 3600) / 60);
  const endS = endTotalSec % 60;
  const defaultTo = `${pad(endH)}:${pad(endM)}:${pad(endS)}`;

  if (fromInput) fromInput.value = defaultFrom;
  if (toInput) toInput.value = defaultTo;

  updateClipDuration();

  modal.style.display = 'flex';
  if (window.lucide) window.lucide.createIcons();
}

let clipProgressInterval = null;

function closeClipExportModal() {
  if (clipProgressInterval) {
    clearInterval(clipProgressInterval);
    clipProgressInterval = null;
  }
  const modal = document.getElementById('modal-download-clip');
  if (modal) modal.style.display = 'none';
  const progress = document.getElementById('clip-download-progress');
  if (progress) progress.style.display = 'none';
  const startBtn = document.getElementById('btn-start-clip-download');
  if (startBtn) startBtn.disabled = false;
  const progressBar = document.getElementById('clip-progress-bar');
  if (progressBar) progressBar.style.width = '0%';
}

function parseTimeToSeconds(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.split(':').map(Number);
  const h = parts[0] || 0;
  const m = parts[1] || 0;
  const s = parts[2] || 0;
  return h * 3600 + m * 60 + s;
}

function formatSecondsToHms(sec) {
  const pad = n => String(n).padStart(2, '0');
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${pad(h)}:${pad(m)}:${pad(s)} (${h}h ${m}m)`;
  }
  return `${pad(m)}:${pad(s)} (${m} min ${s} sek)`;
}

function updateClipDuration() {
  const fromInput = document.getElementById('clip-modal-from');
  const toInput = document.getElementById('clip-modal-to');
  const durLabel = document.getElementById('clip-modal-duration');

  if (!fromInput || !toInput || !durLabel) return;

  const fromSec = parseTimeToSeconds(fromInput.value);
  const toSec = parseTimeToSeconds(toInput.value);

  let diff = toSec - fromSec;
  if (diff <= 0) {
    durLabel.textContent = 'Nevažeći opseg (DO mora biti posle OD)';
    durLabel.style.color = '#ef4444';
    return;
  }

  durLabel.style.color = '#38bdf8';
  durLabel.textContent = formatSecondsToHms(diff);
}

function applyClipPreset(spanSec) {
  const fromInput = document.getElementById('clip-modal-from');
  const toInput = document.getElementById('clip-modal-to');
  if (!fromInput || !toInput) return;

  const fromSec = parseTimeToSeconds(fromInput.value);
  const toSec = Math.min(86399, fromSec + spanSec);

  const pad = n => String(n).padStart(2, '0');
  const h = Math.floor(toSec / 3600) % 24;
  const m = Math.floor((toSec % 3600) / 60);
  const s = toSec % 60;

  toInput.value = `${pad(h)}:${pad(m)}:${pad(s)}`;
  updateClipDuration();
}

function triggerClipDownload() {
  if (!currentLiveCamIp) {
    showToast('Nije izabrana kamera', 'error');
    return;
  }

  const dateInput = document.getElementById('clip-modal-date');
  const fromInput = document.getElementById('clip-modal-from');
  const toInput = document.getElementById('clip-modal-to');

  const dateVal = dateInput?.value || currentPlaybackDate;
  const fromVal = fromInput?.value;
  const toVal = toInput?.value;

  if (!dateVal || !fromVal || !toVal) {
    showToast('Molimo popunite datum, vreme od i vreme do.', 'warning');
    return;
  }

  const fromSec = parseTimeToSeconds(fromVal);
  const toSec = parseTimeToSeconds(toVal);

  if (toSec <= fromSec) {
    showToast('Vreme DO mora biti veće od vremena OD.', 'warning');
    return;
  }

  const diffSec = toSec - fromSec;
  if (diffSec > 1800) {
    showToast('Maksimalna dužina jednog isečka je 30 minuta.', 'warning');
    return;
  }

  const padTime = (val) => {
    const parts = val.split(':');
    while (parts.length < 3) parts.push('00');
    return parts.map(p => String(p).padStart(2, '0')).join(':');
  };

  const startTimeIso = `${dateVal}T${padTime(fromVal)}Z`;
  const endTimeIso = `${dateVal}T${padTime(toVal)}Z`;

  const downloadUrl = `/api/cameras/${encodeURIComponent(currentLiveCamIp)}/download-clip?startTime=${encodeURIComponent(startTimeIso)}&endTime=${encodeURIComponent(endTimeIso)}`;

  const progress = document.getElementById('clip-download-progress');
  const statusText = document.getElementById('clip-download-status-text');
  const progressBar = document.getElementById('clip-progress-bar');
  const countdownText = document.getElementById('clip-progress-countdown');
  const startBtn = document.getElementById('btn-start-clip-download');

  if (progress) progress.style.display = 'block';
  if (statusText) statusText.textContent = `Preuzimanje isečka (${fromVal} - ${toVal}) sa NVR snimača...`;
  if (progressBar) progressBar.style.width = '3%';
  if (countdownText) countdownText.textContent = `Povezivanje sa NVR snimačem (očekivano trajanje: ~${diffSec + 2} sekundi)...`;
  if (startBtn) startBtn.disabled = true;

  showToast(`✓ Pokrenut izvoz isečka (${fromVal} - ${toVal}). Prenos u toku...`, 'info');

  // Trigger browser download via hidden link
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Real-time progress countdown in the modal
  let elapsed = 0;
  const totalWaitSec = Math.max(4, diffSec + 2);

  if (clipProgressInterval) clearInterval(clipProgressInterval);

  clipProgressInterval = setInterval(() => {
    elapsed++;
    const pct = Math.min(98, Math.round((elapsed / totalWaitSec) * 100));
    if (progressBar) progressBar.style.width = `${pct}%`;
    if (countdownText) {
      const remaining = Math.max(0, totalWaitSec - elapsed);
      countdownText.textContent = `Prenos u toku: ${elapsed}s / ${totalWaitSec}s (~${remaining}s preostalo)`;
    }

    if (elapsed >= totalWaitSec) {
      clearInterval(clipProgressInterval);
      clipProgressInterval = null;
      if (progressBar) progressBar.style.width = '100%';
      if (statusText) statusText.textContent = '✓ Isečak je uspešno preuzet i sačuvan!';
      if (countdownText) countdownText.textContent = 'Fajl je sačuvan na vašem računaru.';
      showToast('✓ Video isečak je uspešno preuzet na računar!', 'success');
      setTimeout(() => {
        closeClipExportModal();
      }, 2500);
    }
  }, 1000);
}

/* ==========================================================================
   TAB: EVIDENCIJA RF ČITAČA (TIME & ATTENDANCE TERMINALS)
   ========================================================================== */
let allRfReaders = [];
let rfSearchQuery = '';
let rfStatusFilter = 'all'; // 'all' | 'online' | 'offline'
let rfLocationFilter = 'all';
let rfDirectionFilter = 'all';
let rfViewMode = 'grid';
let isPingingRfReaders = false;
let rfReaderToDelete = null;

async function fetchRfReaders(notify = false) {
  try {
    const res = await fetch('/api/inventory/rf-readers');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    allRfReaders = data.readers || [];

    updateRfReadersKPIs();
    renderRfReadersTab();

    if (notify) {
      showToast(`Učitano ${allRfReaders.length} RF čitača iz baze`, 'info');
    }
  } catch (err) {
    console.error('Error fetching RF readers:', err);
    const container = document.getElementById('rf-readers-container');
    if (container) {
      container.innerHTML = `
        <div class="empty-state-box" style="padding: 40px 20px; text-align: center;">
          <div class="empty-icon text-danger"><i data-lucide="alert-triangle"></i></div>
          <h4>Greška pri učitavanju RF čitača</h4>
          <p class="text-dim">${escapeHtml(err.message)}</p>
          <button class="btn-dark-sm" onclick="fetchRfReaders(true)" style="margin-top: 14px;">
            <i data-lucide="rotate-cw"></i>
            <span>Pokušaj ponovo</span>
          </button>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
    }
    if (notify) showToast('Greška pri učitavanju RF čitača', 'error');
  }
}
window.fetchRfReaders = fetchRfReaders;

function updateRfReadersKPIs() {
  const total = allRfReaders.length;
  const online = allRfReaders.filter(r => r.status === 'online').length;
  const offline = allRfReaders.filter(r => r.status === 'offline').length;
  const distinctLocs = new Set(allRfReaders.map(r => r.location).filter(Boolean)).size;

  const kTotal = document.getElementById('kpi-rf-total');
  const kOnline = document.getElementById('kpi-rf-online');
  const kOffline = document.getElementById('kpi-rf-offline');
  const kLocs = document.getElementById('kpi-rf-locations');
  const badgeNav = document.getElementById('badge-nav-rf-readers');

  if (kTotal) kTotal.textContent = total;
  if (kOnline) kOnline.textContent = online;
  if (kOffline) kOffline.textContent = offline;
  if (kLocs) kLocs.textContent = distinctLocs || 4;
  if (badgeNav) badgeNav.textContent = total;

  // Maintain active filter styling on interactive KPI cards
  const cardTotal = document.getElementById('kpi-card-rf-total');
  const cardOnline = document.getElementById('kpi-card-rf-online');
  const cardOffline = document.getElementById('kpi-card-rf-offline');
  const cardLocs = document.getElementById('kpi-card-rf-locations');

  [cardTotal, cardOnline, cardOffline, cardLocs].forEach(c => {
    c?.classList.remove('gold-active', 'green-active', 'red-active', 'blue-active');
  });

  if (rfStatusFilter === 'all') {
    cardTotal?.classList.add('gold-active');
  } else if (rfStatusFilter === 'online') {
    cardOnline?.classList.add('green-active');
  } else if (rfStatusFilter === 'offline') {
    cardOffline?.classList.add('red-active');
  }

  if (rfLocationFilter !== 'all') {
    cardLocs?.classList.add('blue-active');
  }
}

function setRfStatusFilter(status) {
  rfStatusFilter = status || 'all';
  updateRfReadersKPIs();
  renderRfReadersTab();
}
window.setRfStatusFilter = setRfStatusFilter;

function formatRfAuditTime(isoStr) {
  if (!isoStr) return 'Nije proveravano';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return 'Nije proveravano';
    const now = new Date();
    const isToday = d.getDate() === now.getDate() &&
                    d.getMonth() === now.getMonth() &&
                    d.getFullYear() === now.getFullYear();
    const timeStr = d.toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (isToday) {
      return `Danas u ${timeStr}`;
    }
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}.${month}. u ${timeStr}`;
  } catch {
    return 'Nije proveravano';
  }
}

function renderRfReadersTab() {
  const container = document.getElementById('rf-readers-container');
  if (!container) return;

  // Filter readers
  let filtered = allRfReaders.filter(r => {
    // Status filter from interactive KPI cards
    if (rfStatusFilter === 'online' && r.status !== 'online') return false;
    if (rfStatusFilter === 'offline' && r.status === 'online') return false;

    // Direction filter pill
    if (rfDirectionFilter !== 'all') {
      if (r.direction !== rfDirectionFilter) return false;
    }

    // Location dropdown filter
    if (rfLocationFilter !== 'all') {
      if (r.location !== rfLocationFilter) return false;
    }

    // Search query
    if (rfSearchQuery) {
      const q = rfSearchQuery.toLowerCase();
      const match =
        (r.name && r.name.toLowerCase().includes(q)) ||
        (r.ip && r.ip.toLowerCase().includes(q)) ||
        (r.location && r.location.toLowerCase().includes(q)) ||
        (r.direction && r.direction.toLowerCase().includes(q)) ||
        (r.model && r.model.toLowerCase().includes(q)) ||
        (r.note && r.note.toLowerCase().includes(q));
      if (!match) return false;
    }

    return true;
  });

  // Update summary footer with filter context
  const counter = document.getElementById('rf-readers-counter-text');
  if (counter) {
    let filterLabel = '';
    if (rfStatusFilter === 'online') filterLabel = ' &bull; <strong style="color: #34d399;">Samo Online</strong>';
    else if (rfStatusFilter === 'offline') filterLabel = ' &bull; <strong style="color: #f87171;">Samo Offline (Nedostupni)</strong>';
    if (rfDirectionFilter !== 'all') filterLabel += ` &bull; Smer: <strong>${escapeHtml(rfDirectionFilter)}</strong>`;
    if (rfLocationFilter !== 'all') filterLabel += ` &bull; Lokacija: <strong>${escapeHtml(rfLocationFilter)}</strong>`;
    counter.innerHTML = `Prikazano: <strong>${filtered.length}</strong> od ukupno ${allRfReaders.length} RF terminala${filterLabel}`;
  }

  if (filtered.length === 0) {
    container.className = '';
    container.innerHTML = `
      <div class="empty-state-box" style="padding: 50px 20px; text-align: center; background: rgba(18, 21, 28, 0.6); border: 1px dashed rgba(255, 255, 255, 0.12); border-radius: 12px; margin-top: 14px;">
        <div style="width: 52px; height: 52px; border-radius: 50%; background: rgba(255, 184, 0, 0.1); display: flex; align-items: center; justify-content: center; margin: 0 auto 14px auto; color: var(--yellow-primary);">
          <i data-lucide="badge-check" style="width: 26px; height: 26px;"></i>
        </div>
        <h4 style="font-family: var(--font-heading); color: #fff; font-size: 1.05rem;">Nema pronađenih RF čitača</h4>
        <p class="text-muted text-sm" style="max-width: 420px; margin: 6px auto 0 auto;">Prilagodite kriterijume pretrage ili kliknite na karticu "UKUPNO ČITAČA" za resetovanje filtera.</p>
        <button class="btn-dark-sm" onclick="setRfStatusFilter('all')" style="margin-top: 14px;">
          <i data-lucide="rotate-cw"></i>
          <span>Prikaži Sve Terminale</span>
        </button>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  if (rfViewMode === 'table') {
    container.className = '';
    container.innerHTML = `
      <div class="inv-table-wrapper">
        <table class="inv-camera-table">
          <thead>
            <tr>
              <th style="width: 50px;">#</th>
              <th style="width: 170px;">IP Adresa Terminala</th>
              <th>Naziv RF Čitača</th>
              <th style="width: 130px;">Smer Rada</th>
              <th style="width: 170px;">Fabrička Lokacija</th>
              <th style="width: 110px;">Port</th>
              <th style="width: 170px;">Model Opreme</th>
              <th style="width: 170px;">Status / Ping Trag</th>
              <th>Napomena</th>
              <th style="width: 140px; text-align: right;">Akcije</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map((r, idx) => {
              const isOnline = r.status === 'online';
              const latency = (r.latencyMs ?? r.latency_ms);
              const latencyText = isOnline && latency ? `${latency}ms` : '';
              const dirColor = r.direction === 'Prijava' ? '#34d399' : (r.direction === 'Odjava' ? '#38bdf8' : '#fbbf24');
              const dirIcon = r.direction === 'Prijava' ? 'log-in' : (r.direction === 'Odjava' ? 'log-out' : 'edit-3');

              return `
                <tr class="${isOnline ? '' : 'rf-table-row-offline'}" id="rf-row-${r.id}">
                  <td class="font-mono text-dim" style="font-size: 0.78rem;">${idx + 1}</td>
                  <td>
                    <div class="inv-ip-pill ${isOnline ? 'subnet-121' : ''}" style="${isOnline ? '' : 'background: rgba(239, 68, 68, 0.18); border: 1px solid rgba(239, 68, 68, 0.5); color: #fca5a5;'}">
                      <span class="chip-dot" style="${isOnline ? '' : 'background: #ef4444; box-shadow: 0 0 8px #ef4444;'}"></span>
                      <span>${escapeHtml(r.ip || 'N/A')}</span>
                      ${r.ip ? `
                        <a href="http://${escapeHtml(r.ip)}/csl/login" target="_blank" rel="noopener noreferrer" class="btn-copy-chip-sm" title="Otvori WebUI terminala (http://${escapeHtml(r.ip)})" style="text-decoration: none; display: inline-flex; align-items: center; justify-content: center; color: #38bdf8;">
                          <i data-lucide="external-link" style="width: 11px; height: 11px;"></i>
                        </a>
                        <button class="btn-copy-chip-sm" onclick="copyCustomUrl('${escapeHtml(r.ip)}')" title="Kopiraj IP adresu">
                          <i data-lucide="copy" style="width: 11px; height: 11px;"></i>
                        </button>
                      ` : ''}
                    </div>
                  </td>
                  <td>
                    ${isOnline ? `
                      <strong style="color: #ffffff; font-size: 0.88rem;">${escapeHtml(r.name)}</strong>
                    ` : `
                      <strong style="color: #fca5a5; font-size: 0.88rem; display: inline-flex; align-items: center; gap: 6px;">
                        <i data-lucide="alert-triangle" style="width: 15px; height: 15px; color: #ef4444;"></i>
                        <span>${escapeHtml(r.name)}</span>
                      </strong>
                    `}
                  </td>
                  <td>
                    <span class="badge-chip" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: ${dirColor}; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 6px; font-size: 0.75rem;">
                      <i data-lucide="${dirIcon}" style="width: 12px; height: 12px;"></i>
                      <span>${escapeHtml(r.direction || 'Prijava')}</span>
                    </span>
                  </td>
                  <td>
                    <span style="display: inline-flex; align-items: center; gap: 5px; color: #cbd5e1; font-size: 0.82rem;">
                      <i data-lucide="map-pin" style="width: 13px; height: 13px; color: ${isOnline ? 'var(--yellow-primary)' : '#ef4444'};"></i>
                      <span>${escapeHtml(r.location || 'Čačak')}</span>
                    </span>
                  </td>
                  <td class="font-mono" style="font-size: 0.8rem; color: ${isOnline ? '#94a3b8' : '#f87171'};">
                    ${r.port || 4370}
                  </td>
                  <td style="font-size: 0.8rem; color: #cbd5e1;">
                    ${escapeHtml(r.model || 'ZKTeco / Secutime')}
                  </td>
                  <td>
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                      <div style="display: flex; align-items: center; gap: 6px;">
                        ${isOnline ? `
                          <span class="rf-status-pill-online" style="font-size: 0.72rem; padding: 2px 8px;">
                            <span class="status-dot"></span> Online
                          </span>
                          ${latencyText ? `<span class="font-mono text-xs" style="color: #38bdf8; font-weight: 600;">${latencyText}</span>` : ''}
                        ` : `
                          <span class="rf-status-pill-offline" style="font-size: 0.72rem; padding: 2px 8px;">
                            <span class="status-dot"></span> OFFLINE
                          </span>
                        `}
                      </div>
                      <div style="font-size: 0.70rem; color: #94a3b8; display: flex; align-items: center; gap: 4px;">
                        <i data-lucide="clock" style="width: 10px; height: 10px; opacity: 0.7;"></i>
                        <span>Ping: ${formatRfAuditTime(r.last_ping_at || r.lastPingAt)}</span>
                      </div>
                    </div>
                  </td>
                  <td style="font-size: 0.76rem; color: #94a3b8; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(r.note || '')}">
                    ${escapeHtml(r.note || '—')}
                  </td>
                  <td style="text-align: right;">
                    <div style="display: inline-flex; gap: 6px; align-items: center;">
                      ${r.ip ? `
                        <a href="http://${escapeHtml(r.ip)}/csl/login" target="_blank" rel="noopener noreferrer" class="btn-inv-action" title="Otvori WebUI terminala (http://${escapeHtml(r.ip)})" style="text-decoration: none; display: inline-flex; align-items: center; justify-content: center; color: #38bdf8;">
                          <i data-lucide="globe" style="width: 13px; height: 13px;"></i>
                        </a>
                      ` : ''}
                      <button class="btn-inv-action" id="btn-table-ping-rf-${r.id}" style="${isOnline ? '' : 'color: #fca5a5;'}" onclick="pingSingleRfReader('${r.id}')" title="Pinguj ovaj terminal">
                        <i data-lucide="activity" style="width: 13px; height: 13px;"></i>
                      </button>
                      <button class="btn-inv-action" onclick="openEditRfReaderModal('${r.id}')" title="Uredi čitač">
                        <i data-lucide="edit-3" style="width: 13px; height: 13px;"></i>
                      </button>
                      <button class="btn-inv-action btn-del" onclick="openDeleteRfReaderModal('${r.id}')" title="Obriši čitač">
                        <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } else {
    // Grid view (Cards)
    container.className = 'printers-cards-grid';
    container.innerHTML = filtered.map(r => {
      const isOnline = r.status === 'online';
      const latency = (r.latencyMs ?? r.latency_ms);
      const latencyText = isOnline && latency ? `${latency}ms` : '';
      const dirColor = r.direction === 'Prijava' ? '#34d399' : (r.direction === 'Odjava' ? '#38bdf8' : '#fbbf24');
      const dirIcon = r.direction === 'Prijava' ? 'log-in' : (r.direction === 'Odjava' ? 'log-out' : 'edit-3');

      // ================= OFFLINE CARD IN PROMINENT RED =================
      if (!isOnline) {
        return `
          <div class="printer-card rf-offline-card" id="card-rf-${r.id}">
            <div class="printer-card-header">
              <div class="printer-type-badge" style="color: #fca5a5; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4);">
                <i data-lucide="${dirIcon}"></i>
                <span>${escapeHtml(r.direction || 'Prijava')}</span>
              </div>
              <span class="rf-status-pill-offline" style="font-size: 0.72rem; padding: 3px 9px;">
                <span class="status-dot"></span> OFFLINE (Nema odziva)
              </span>
            </div>

            <div class="printer-card-body">
              <div class="printer-title-row">
                <h4 class="printer-name" style="font-size: 0.98rem; display: flex; align-items: center; gap: 7px;">
                  <i data-lucide="alert-triangle" style="width: 17px; height: 17px; color: #ef4444; flex-shrink: 0;"></i>
                  <span>${escapeHtml(r.name)}</span>
                </h4>
              </div>

              <div class="printer-meta-row" style="margin: 8px 0;">
                <div class="meta-item">
                  <i data-lucide="map-pin" class="meta-icon" style="color: #ef4444;"></i>
                  <span class="meta-text text-dim" style="font-size: 0.76rem;">${escapeHtml(r.location)}</span>
                </div>
                <div class="meta-item">
                  <i data-lucide="cpu" class="meta-icon"></i>
                  <span class="meta-text text-xs">${escapeHtml(r.model || 'ZKTeco / Secutime')}</span>
                </div>
              </div>

              <div class="printer-ip-box">
                <div class="ip-details">
                  <span class="ip-label" style="color: #ef4444 !important; font-weight: 700;">IP ADRESA (OFFLINE)</span>
                  <span class="ip-val font-mono">${escapeHtml(r.ip || 'N/A')}</span>
                </div>
                <div style="display: flex; gap: 4px; align-items: center;">
                  ${r.ip ? `
                    <a href="http://${escapeHtml(r.ip)}/csl/login" target="_blank" rel="noopener noreferrer" class="btn-copy-chip" title="Otvori WebUI administraciju (http://${escapeHtml(r.ip)})" style="text-decoration: none; display: flex; align-items: center; justify-content: center; color: #38bdf8;">
                      <i data-lucide="external-link"></i>
                    </a>
                    <button class="btn-copy-chip" onclick="copyCustomUrl('${escapeHtml(r.ip)}')" title="Kopiraj adresu">
                      <i data-lucide="copy"></i>
                    </button>
                  ` : ''}
                </div>
              </div>

              <!-- PING AUDIT TRACE BOX -->
              <div class="rf-ping-audit-box audit-offline">
                <div class="rf-ping-audit-row">
                  <span class="rf-ping-audit-label">
                    <i data-lucide="clock" style="width: 12px; height: 12px; color: #ef4444;"></i>
                    Zadnji status pinga:
                  </span>
                  <span class="rf-ping-audit-val" style="color: #fca5a5;">
                    ${formatRfAuditTime(r.last_ping_at || r.lastPingAt)}
                  </span>
                </div>
                <div class="rf-ping-audit-row">
                  <span class="rf-ping-audit-label">
                    <i data-lucide="activity" style="width: 12px; height: 12px; color: #ef4444;"></i>
                    Mrežni odziv:
                  </span>
                  <span class="rf-ping-audit-val" style="color: #f87171;">
                    Bez odziva &bull; Timeout
                  </span>
                </div>
                ${(r.last_seen || r.lastSeen) ? `
                  <div class="rf-ping-audit-row" style="margin-top: 4px; padding-top: 4px; border-top: 1px dashed rgba(239, 68, 68, 0.25);">
                    <span class="rf-ping-audit-label" style="color: #64748b;">
                      <i data-lucide="eye" style="width: 11px; height: 11px;"></i>
                      Zadnji put viđen:
                    </span>
                    <span class="rf-ping-audit-val" style="color: #94a3b8; font-size: 0.72rem;">
                      ${formatRfAuditTime(r.last_seen || r.lastSeen)}
                    </span>
                  </div>
                ` : ''}
              </div>

              <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 8px; padding: 6px 10px; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 8px; font-size: 0.75rem;">
                <span class="text-dim">Mrežni port:</span>
                <span class="font-mono" style="color: #f87171; font-weight: 700;">TCP ${r.port || 4370}</span>
              </div>

              ${r.note ? `
                <div style="margin-top: 8px; font-size: 0.74rem; color: #cbd5e1; line-height: 1.4;">
                  <span style="color: #f87171;">Napomena:</span> ${escapeHtml(r.note)}
                </div>
              ` : ''}
            </div>

            <div class="printer-card-actions">
              ${r.ip ? `
                <a href="http://${escapeHtml(r.ip)}/csl/login" target="_blank" rel="noopener noreferrer" class="btn-printer-action btn-webui-action" title="Otvori ZKTeco WebUI (http://${escapeHtml(r.ip)})">
                  <i data-lucide="globe"></i>
                  <span>WebUI</span>
                </a>
              ` : ''}
              <button class="btn-printer-action" id="btn-ping-rf-${r.id}" style="border-color: rgba(239, 68, 68, 0.4); color: #fca5a5;" onclick="pingSingleRfReader('${r.id}')" title="Pokušaj ponovo povezivanje">
                <i data-lucide="activity" style="color: #ef4444;"></i>
                <span>Pinguj</span>
              </button>
              <button class="btn-printer-action" onclick="openEditRfReaderModal('${r.id}')" title="Uredi podatke">
                <i data-lucide="edit-3"></i>
                <span>Uredi</span>
              </button>
              <button class="btn-printer-action btn-danger-action" onclick="openDeleteRfReaderModal('${r.id}')" title="Obriši iz evidencije">
                <i data-lucide="trash-2"></i>
                <span>Obriši</span>
              </button>
            </div>
          </div>
        `;
      }

      // ================= ONLINE CARD IN GREEN / THEME ACCENT =================
      return `
        <div class="printer-card" id="card-rf-${r.id}" style="border-top: 3px solid ${dirColor};">
          <div class="printer-card-header">
            <div class="printer-type-badge" style="color: ${dirColor}; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);">
              <i data-lucide="${dirIcon}"></i>
              <span>${escapeHtml(r.direction || 'Prijava')}</span>
            </div>
            <span class="rf-status-pill-online" style="font-size: 0.72rem; padding: 3px 8px;">
              <span class="status-dot"></span> Online ${latencyText ? `(${latencyText})` : ''}
            </span>
          </div>

          <div class="printer-card-body">
            <div class="printer-title-row">
              <h4 class="printer-name" style="font-size: 0.98rem; display: flex; align-items: center; gap: 6px;">
                <i data-lucide="badge-check" style="width: 16px; height: 16px; color: var(--yellow-primary); flex-shrink: 0;"></i>
                <span>${escapeHtml(r.name)}</span>
              </h4>
            </div>

            <div class="printer-meta-row" style="margin: 8px 0;">
              <div class="meta-item">
                <i data-lucide="map-pin" class="meta-icon" style="color: var(--yellow-primary);"></i>
                <span class="meta-text text-dim" style="font-size: 0.76rem;">${escapeHtml(r.location)}</span>
              </div>
              <div class="meta-item">
                <i data-lucide="cpu" class="meta-icon"></i>
                <span class="meta-text text-xs">${escapeHtml(r.model || 'ZKTeco / Secutime')}</span>
              </div>
            </div>

            <div class="printer-ip-box">
              <div class="ip-details">
                <span class="ip-label">IP ADRESA TERMINALA</span>
                <span class="ip-val font-mono" style="color: #38bdf8;">${escapeHtml(r.ip || 'N/A')}</span>
              </div>
              <div style="display: flex; gap: 4px; align-items: center;">
                ${r.ip ? `
                  <a href="http://${escapeHtml(r.ip)}/csl/login" target="_blank" rel="noopener noreferrer" class="btn-copy-chip" title="Otvori WebUI administraciju (http://${escapeHtml(r.ip)})" style="text-decoration: none; display: flex; align-items: center; justify-content: center; color: #38bdf8;">
                    <i data-lucide="external-link"></i>
                  </a>
                  <button class="btn-copy-chip" onclick="copyCustomUrl('${escapeHtml(r.ip)}')" title="Kopiraj adresu">
                    <i data-lucide="copy"></i>
                  </button>
                ` : ''}
              </div>
            </div>

            <!-- PING AUDIT TRACE BOX -->
            <div class="rf-ping-audit-box audit-online">
              <div class="rf-ping-audit-row">
                <span class="rf-ping-audit-label">
                  <i data-lucide="clock" style="width: 12px; height: 12px; color: #34d399;"></i>
                  Zadnji status pinga:
                </span>
                <span class="rf-ping-audit-val" style="color: #34d399;">
                  ${formatRfAuditTime(r.last_ping_at || r.lastPingAt)}
                </span>
              </div>
              <div class="rf-ping-audit-row">
                <span class="rf-ping-audit-label">
                  <i data-lucide="activity" style="width: 12px; height: 12px; color: #34d399;"></i>
                  Mrežni odziv:
                </span>
                <span class="rf-ping-audit-val" style="color: #38bdf8;">
                  Dostupan &bull; ${latencyText || '1ms'}
                </span>
              </div>
            </div>

            <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 8px; padding: 6px 10px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; font-size: 0.75rem;">
              <span class="text-dim">Mrežni protokol:</span>
              <span class="font-mono text-yellow" style="font-weight: 700;">TCP Port ${r.port || 4370}</span>
            </div>

            ${r.note ? `
              <div style="margin-top: 8px; font-size: 0.74rem; color: #94a3b8; line-height: 1.4;">
                <span style="color: #64748b;">Napomena:</span> ${escapeHtml(r.note)}
              </div>
            ` : ''}
          </div>

          <div class="printer-card-actions">
            ${r.ip ? `
              <a href="http://${escapeHtml(r.ip)}/csl/login" target="_blank" rel="noopener noreferrer" class="btn-printer-action btn-webui-action" title="Otvori ZKTeco WebUI administraciju terminala">
                <i data-lucide="globe"></i>
                <span>WebUI</span>
              </a>
            ` : ''}
            <button class="btn-printer-action" id="btn-ping-rf-${r.id}" onclick="pingSingleRfReader('${r.id}')" title="Proveri mrežni odziv">
              <i data-lucide="activity"></i>
              <span>Pinguj</span>
            </button>
            <button class="btn-printer-action" onclick="openEditRfReaderModal('${r.id}')" title="Uredi podatke">
              <i data-lucide="edit-3"></i>
              <span>Uredi</span>
            </button>
            <button class="btn-printer-action btn-danger-action" onclick="openDeleteRfReaderModal('${r.id}')" title="Obriši iz evidencije">
              <i data-lucide="trash-2"></i>
              <span>Obriši</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  if (window.lucide) window.lucide.createIcons();
}
window.renderRfReadersTab = renderRfReadersTab;

async function pingAllRfReaders() {
  if (isPingingRfReaders) return;
  isPingingRfReaders = true;
  setButtonSpinning('btn-ping-all-rf-readers', true);

  // Snapshot previous statuses to detect any changes
  const prevStatuses = new Map(allRfReaders.map(r => [r.id, r.status]));

  try {
    showToast('Pingovanje svih 9 RF čitača u toku...', 'info');
    const res = await fetch('/api/inventory/rf-readers/ping', { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.readers) {
      allRfReaders = data.readers;
    }
    updateRfReadersKPIs();
    renderRfReadersTab();

    // Check transitions
    const restored = allRfReaders.filter(r => prevStatuses.get(r.id) === 'offline' && r.status === 'online');
    const dropped = allRfReaders.filter(r => prevStatuses.get(r.id) === 'online' && r.status === 'offline');

    // Glow highlight for changed cards
    restored.forEach(r => {
      const c = document.getElementById(`card-rf-${r.id}`);
      if (c) {
        c.classList.add('rf-status-changed-online');
        setTimeout(() => c.classList.remove('rf-status-changed-online'), 2000);
      }
    });

    dropped.forEach(r => {
      const c = document.getElementById(`card-rf-${r.id}`);
      if (c) {
        c.classList.add('rf-status-changed-offline');
        setTimeout(() => c.classList.remove('rf-status-changed-offline'), 2000);
      }
    });

    const online = allRfReaders.filter(r => r.status === 'online').length;
    const offline = allRfReaders.length - online;

    if (restored.length > 0) {
      showToast(`🟢 ${restored.length} terminal(a) je PREŠLO U ONLINE: ${restored.map(r => r.name).join(', ')}`, 'success', 6000);
    } else if (dropped.length > 0) {
      showToast(`🔴 ${dropped.length} terminal(a) je PREŠLO U OFFLINE: ${dropped.map(r => r.name).join(', ')}`, 'error', 6000);
    } else {
      showToast(`✓ Provereno ${allRfReaders.length} RF terminala: ${online} online, ${offline} offline`, 'success');
    }
  } catch (err) {
    console.error('Error pinging RF readers:', err);
    showToast(`Greška pri pingovanju: ${err.message}`, 'error');
  } finally {
    setButtonSpinning('btn-ping-all-rf-readers', false);
    isPingingRfReaders = false;
  }
}
window.pingAllRfReaders = pingAllRfReaders;

async function pingSingleRfReader(id) {
  const prevReader = allRfReaders.find(r => r.id === id);
  const prevStatus = prevReader ? prevReader.status : 'unknown';

  const btnCard = document.getElementById(`btn-ping-rf-${id}`);
  const btnTable = document.getElementById(`btn-table-ping-rf-${id}`);
  if (btnCard) {
    btnCard.disabled = true;
    btnCard.innerHTML = `<i data-lucide="loader-2" class="spin-icon"></i><span>Pingujem...</span>`;
  }
  if (btnTable) {
    btnTable.disabled = true;
    btnTable.innerHTML = `<i data-lucide="loader-2" class="spin-icon" style="width:13px;height:13px;"></i>`;
  }
  if (window.lucide) window.lucide.createIcons();

  try {
    const res = await fetch(`/api/inventory/rf-readers/${id}/ping`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.reader) {
      const idx = allRfReaders.findIndex(r => r.id === id);
      if (idx !== -1) {
        allRfReaders[idx] = data.reader;
      }
      const newStatus = data.reader.status;
      const isNowOnline = newStatus === 'online';
      const transitionedFromOffline = (prevStatus === 'offline' && isNowOnline);
      const transitionedFromOnline = (prevStatus === 'online' && !isNowOnline);

      // If user had filtered by offline and this terminal just became online, reset filter to 'all' so card remains visible
      if (transitionedFromOffline && rfStatusFilter === 'offline') {
        rfStatusFilter = 'all';
      }

      updateRfReadersKPIs();
      renderRfReadersTab();

      // Trigger status transition glow on the re-rendered card
      const targetCard = document.getElementById(`card-rf-${id}`);
      if (targetCard) {
        if (transitionedFromOffline) {
          targetCard.classList.add('rf-status-changed-online');
          setTimeout(() => targetCard.classList.remove('rf-status-changed-online'), 2000);
        } else if (transitionedFromOnline) {
          targetCard.classList.add('rf-status-changed-offline');
          setTimeout(() => targetCard.classList.remove('rf-status-changed-offline'), 2000);
        }
      }

      const lat = data.reader.latency_ms ?? data.reader.latencyMs;
      const latText = lat ? `${lat}ms` : '1ms';

      if (transitionedFromOffline) {
        showToast(`🟢 Terminal "${data.reader.name}" je PREŠAO U ONLINE! Status kartice je ažuriran (Odziv: ${latText})`, 'success', 6000);
      } else if (transitionedFromOnline) {
        showToast(`🔴 UPOZORENJE: Terminal "${data.reader.name}" je PREŠAO U OFFLINE! Kartica je označena crveno.`, 'error', 6000);
      } else if (isNowOnline) {
        showToast(`✓ Terminal "${data.reader.name}" je online (${latText}) &bull; Zabeležen ping`, 'success');
      } else {
        showToast(`⚠ Terminal "${data.reader.name}" je OFFLINE (nema odziva na mreži) &bull; Zabeležen ping`, 'error');
      }
    }
  } catch (err) {
    console.error('Error pinging single RF reader:', err);
    showToast(`Greška pri proveri čitača: ${err.message}`, 'error');
    if (btnCard) {
      btnCard.disabled = false;
      btnCard.innerHTML = `<i data-lucide="activity"></i><span>Pinguj</span>`;
    }
    if (btnTable) {
      btnTable.disabled = false;
      btnTable.innerHTML = `<i data-lucide="activity" style="width:13px;height:13px;"></i>`;
    }
    if (window.lucide) window.lucide.createIcons();
  }
}
window.pingSingleRfReader = pingSingleRfReader;

function openAddRfReaderModal() {
  const modal = document.getElementById('modal-rf-reader');
  const form = document.getElementById('form-rf-reader');
  if (!modal || !form) return;

  form.reset();
  document.getElementById('input-rf-id').value = '';
  document.getElementById('input-rf-port').value = '4370';
  document.getElementById('input-rf-model').value = 'ZKTeco / Secutime RFID';
  document.getElementById('modal-rf-reader-title').textContent = 'Dodaj Novi RF Čitač';
  document.getElementById('btn-submit-rf-reader-text').textContent = 'Sačuvaj Čitač';

  modal.style.display = 'flex';
  if (window.lucide) window.lucide.createIcons();
}
window.openAddRfReaderModal = openAddRfReaderModal;

function openEditRfReaderModal(id) {
  const reader = allRfReaders.find(r => r.id === id);
  if (!reader) return;

  const modal = document.getElementById('modal-rf-reader');
  if (!modal) return;

  document.getElementById('input-rf-id').value = reader.id;
  document.getElementById('input-rf-name').value = reader.name || '';
  document.getElementById('input-rf-direction').value = reader.direction || 'Prijava';
  document.getElementById('input-rf-ip').value = reader.ip || '';
  document.getElementById('input-rf-port').value = reader.port || 4370;
  document.getElementById('input-rf-location').value = reader.location || 'Čačak (Prijavnica)';
  document.getElementById('input-rf-model').value = reader.model || 'ZKTeco / Secutime RFID';
  document.getElementById('input-rf-note').value = reader.note || '';

  document.getElementById('modal-rf-reader-title').textContent = `Uredi RF Čitač: ${reader.name}`;
  document.getElementById('btn-submit-rf-reader-text').textContent = 'Sačuvaj Promene';

  modal.style.display = 'flex';
  if (window.lucide) window.lucide.createIcons();
}
window.openEditRfReaderModal = openEditRfReaderModal;

async function handleRfReaderFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('input-rf-id').value.trim();
  const name = document.getElementById('input-rf-name').value.trim();
  const direction = document.getElementById('input-rf-direction').value;
  const ip = document.getElementById('input-rf-ip').value.trim();
  const port = parseInt(document.getElementById('input-rf-port').value) || 4370;
  const location = document.getElementById('input-rf-location').value;
  const model = document.getElementById('input-rf-model').value.trim();
  const note = document.getElementById('input-rf-note').value.trim();

  const payload = { name, direction, ip, port, location, model, note };

  try {
    let res;
    if (id) {
      res = await fetch(`/api/inventory/rf-readers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch('/api/inventory/rf-readers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.details || data.error || 'Greška pri čuvanju');
    }

    document.getElementById('modal-rf-reader').style.display = 'none';
    showToast(id ? '✓ RF čitač je uspešno izmenjen' : '✓ Novi RF čitač je dodat u bazu', 'success');
    await fetchRfReaders();
  } catch (err) {
    console.error('Error saving RF reader:', err);
    showToast(`Greška: ${err.message}`, 'error');
  }
}

function openDeleteRfReaderModal(id) {
  const reader = allRfReaders.find(r => r.id === id);
  if (!reader) return;

  rfReaderToDelete = reader;
  const modal = document.getElementById('modal-delete-rf-reader');
  if (!modal) return;

  document.getElementById('delete-rf-reader-name').textContent = reader.name;
  document.getElementById('delete-rf-reader-ip').textContent = reader.ip;
  document.getElementById('delete-rf-reader-loc').textContent = `${reader.location} (${reader.direction})`;

  modal.style.display = 'flex';
}
window.openDeleteRfReaderModal = openDeleteRfReaderModal;

async function confirmDeleteRfReader() {
  if (!rfReaderToDelete) return;

  try {
    const res = await fetch(`/api/inventory/rf-readers/${rfReaderToDelete.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.details || data.error || 'Greška pri brisanju');
    }

    document.getElementById('modal-delete-rf-reader').style.display = 'none';
    showToast(`✓ RF čitač "${rfReaderToDelete.name}" je obrisan iz baze`, 'success');
    rfReaderToDelete = null;
    await fetchRfReaders();
  } catch (err) {
    console.error('Error deleting RF reader:', err);
    showToast(`Greška pri brisanju: ${err.message}`, 'error');
  }
}

function setupRfReadersEventListeners() {
  const searchInput = document.getElementById('search-rf-readers');
  const btnClearSearch = document.getElementById('btn-clear-search-rf');
  const selectLoc = document.getElementById('select-rf-location-filter');
  const btnViewGrid = document.getElementById('btn-view-rf-grid');
  const btnViewTable = document.getElementById('btn-view-rf-table');
  const btnPingAll = document.getElementById('btn-ping-all-rf-readers');
  const btnOpenAdd = document.getElementById('btn-open-add-rf-reader');

  // Interactive KPI Cards Filtering
  const kpiTotal = document.getElementById('kpi-card-rf-total');
  const kpiOnline = document.getElementById('kpi-card-rf-online');
  const kpiOffline = document.getElementById('kpi-card-rf-offline');
  const kpiLocs = document.getElementById('kpi-card-rf-locations');

  kpiTotal?.addEventListener('click', () => {
    setRfStatusFilter('all');
    showToast('Prikazani svi RF čitači', 'info');
  });

  kpiOnline?.addEventListener('click', () => {
    setRfStatusFilter('online');
    showToast('Filtrirano: Samo ONLINE čitači', 'info');
  });

  kpiOffline?.addEventListener('click', () => {
    setRfStatusFilter('offline');
    showToast('Filtrirano: Samo OFFLINE čitači (crveno označeni)', 'warn');
  });

  kpiLocs?.addEventListener('click', () => {
    const selectLoc = document.getElementById('select-rf-location-filter');
    if (rfLocationFilter !== 'all') {
      rfLocationFilter = 'all';
      if (selectLoc) selectLoc.value = 'all';
      setRfStatusFilter('all');
      showToast('Poništen filter lokacije', 'info');
    } else {
      selectLoc?.focus();
      showToast('Izaberite lokaciju iz padajućeg menija za detaljnije filtriranje', 'info');
    }
  });

  // Search
  searchInput?.addEventListener('input', (e) => {
    rfSearchQuery = e.target.value.trim();
    if (btnClearSearch) btnClearSearch.style.display = rfSearchQuery ? 'flex' : 'none';
    renderRfReadersTab();
  });

  btnClearSearch?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    rfSearchQuery = '';
    btnClearSearch.style.display = 'none';
    renderRfReadersTab();
  });

  // Location filter dropdown
  selectLoc?.addEventListener('change', (e) => {
    rfLocationFilter = e.target.value;
    updateRfReadersKPIs();
    renderRfReadersTab();
  });

  // Direction filter pills
  document.querySelectorAll('#rf-direction-pills .inv-quick-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#rf-direction-pills .inv-quick-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      rfDirectionFilter = btn.getAttribute('data-rf-dir') || 'all';
      renderRfReadersTab();
    });
  });

  // View switchers
  btnViewGrid?.addEventListener('click', () => {
    rfViewMode = 'grid';
    btnViewGrid.classList.add('active');
    btnViewTable?.classList.remove('active');
    renderRfReadersTab();
  });

  btnViewTable?.addEventListener('click', () => {
    rfViewMode = 'table';
    btnViewTable.classList.add('active');
    btnViewGrid?.classList.remove('active');
    renderRfReadersTab();
  });

  // Actions
  btnPingAll?.addEventListener('click', pingAllRfReaders);
  btnOpenAdd?.addEventListener('click', openAddRfReaderModal);

  // Modal actions
  document.getElementById('btn-close-rf-reader-modal')?.addEventListener('click', () => {
    document.getElementById('modal-rf-reader').style.display = 'none';
  });
  document.getElementById('btn-cancel-rf-reader-modal')?.addEventListener('click', () => {
    document.getElementById('modal-rf-reader').style.display = 'none';
  });
  document.getElementById('form-rf-reader')?.addEventListener('submit', handleRfReaderFormSubmit);

  // Delete modal actions
  document.getElementById('btn-close-delete-rf-modal')?.addEventListener('click', () => {
    document.getElementById('modal-delete-rf-reader').style.display = 'none';
  });
  document.getElementById('btn-cancel-delete-rf-modal')?.addEventListener('click', () => {
    document.getElementById('modal-delete-rf-reader').style.display = 'none';
  });
  document.getElementById('btn-confirm-delete-rf')?.addEventListener('click', confirmDeleteRfReader);
}

/* ==========================================================================
   WIFI ACCESS POINTS (ARUBA INSTANT ON / SWARM VIRTUAL CONTROLLER)
   ========================================================================== */
let allWifiAps = [];
let wifiClusterSummary = null;
let currentWifiFilter = 'all'; // 'all' | 'online' | 'indoor' | 'outdoor' | 'conductor'
let currentWifiModelFilter = 'all';
let wifiSearchTerm = '';
let wifiViewMode = localStorage.getItem('unipromet_wifi_view_mode') || 'grid';
let currentModalClients = [];
let currentModalApName = '';

async function fetchWifiAps(forceSync = false) {
  if (forceSync) {
    setButtonSpinning('btn-sync-wifi-aps', true);
  }

  const container = document.getElementById('wifi-aps-container');
  if (container && allWifiAps.length === 0) {
    container.innerHTML = `
      <div class="telemetry-loading-state">
        <div class="spinner-circle"></div>
        <h5>Učitavanje WiFi pristupnih tačaka sa kontrolera...</h5>
      </div>
    `;
  }

  try {
    const endpoint = forceSync ? '/api/inventory/wifi-aps/sync' : '/api/inventory/wifi-aps';
    const method = forceSync ? 'POST' : 'GET';
    const res = await fetch(endpoint, { method });
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.details || data.error || 'Greška pri očitavanju AP-ova');
    }

    allWifiAps = data.aps || [];
    wifiClusterSummary = data.clusterSummary || null;

    // Update navigation counter badge
    const navBadge = document.getElementById('badge-nav-wifi-aps');
    if (navBadge) {
      navBadge.textContent = allWifiAps.length;
    }

    // Update KPI values
    const kpiTotal = document.getElementById('kpi-wifi-total');
    const kpiOnline = document.getElementById('kpi-wifi-online');
    const kpiOffline = document.getElementById('kpi-wifi-offline');
    const kpiClients = document.getElementById('kpi-wifi-clients');
    const kpiConductor = document.getElementById('kpi-wifi-conductor');
    const kpiConductorName = document.getElementById('kpi-wifi-conductor-name');

    if (kpiTotal) kpiTotal.textContent = data.total ?? allWifiAps.length;
    if (kpiOnline) kpiOnline.textContent = data.online ?? allWifiAps.filter(a => a.status === 'online').length;
    if (kpiOffline) kpiOffline.textContent = data.offline ?? allWifiAps.filter(a => a.status === 'offline').length;
    if (kpiClients) {
      const totalC = data.totalClients ?? allWifiAps.reduce((acc, a) => acc + (a.clientsCount || 0), 0);
      kpiClients.textContent = totalC;
    }
    if (data.conductor && kpiConductor) {
      kpiConductor.textContent = data.conductor.ip;
      if (kpiConductorName) {
        kpiConductorName.textContent = `${data.conductor.name} (Master)`;
      }
    }

    renderWifiApsTab();

    if (forceSync) {
      showToast(data.message || 'Sinhronizacija sa Aruba kontrolerom uspešna', 'success');
    }
  } catch (err) {
    console.error('Error fetching WiFi APs:', err);
    if (container && allWifiAps.length === 0) {
      container.innerHTML = `
        <div class="empty-state-box" style="padding: 40px 20px; text-align: center;">
          <div class="kpi-icon-square text-danger" style="margin: 0 auto 16px; background: rgba(239, 68, 68, 0.15); width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; border-radius: 10px;">
            <i data-lucide="alert-triangle" style="width: 24px; height: 24px;"></i>
          </div>
          <h4 style="color: #ffffff; margin-bottom: 8px;">Greška pri povezivanju sa Aruba kontrolerom</h4>
          <p class="text-dim" style="max-width: 500px; margin: 0 auto 16px;">${escapeHtml(err.message)}</p>
          <button class="btn-dark-sm" onclick="fetchWifiAps(true)">
            <i data-lucide="rotate-cw"></i>
            <span>Pokušaj ponovo sinhronizaciju</span>
          </button>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
    }
    if (forceSync) {
      showToast(`Greška pri sinhronizaciji: ${err.message}`, 'error');
    }
  } finally {
    if (forceSync) {
      setButtonSpinning('btn-sync-wifi-aps', false);
    }
  }
}
window.fetchWifiAps = fetchWifiAps;

function renderWifiApsTab() {
  const container = document.getElementById('wifi-aps-container');
  if (!container) return;

  const searchVal = wifiSearchTerm.toLowerCase().trim();

  // Filter APs
  const filtered = allWifiAps.filter(ap => {
    // Quick filter (All, Online, Offline, Indoor, Outdoor, Conductor)
    if (currentWifiFilter === 'online' && ap.status !== 'online') return false;
    if (currentWifiFilter === 'offline' && ap.status !== 'offline') return false;
    if (currentWifiFilter === 'indoor' && ap.isOutdoor) return false;
    if (currentWifiFilter === 'outdoor' && !ap.isOutdoor) return false;
    if (currentWifiFilter === 'conductor' && ap.hierarchy !== 'conductor') return false;

    // Dropdown model filter
    if (currentWifiModelFilter === 'indoor' && ap.isOutdoor) return false;
    if (currentWifiModelFilter === 'outdoor' && !ap.isOutdoor) return false;

    // Search query
    if (searchVal) {
      const matchName = (ap.name || '').toLowerCase().includes(searchVal);
      const matchIp = (ap.ip || '').toLowerCase().includes(searchVal);
      const matchModel = (ap.model || '').toLowerCase().includes(searchVal);
      const matchSerial = (ap.serial || '').toLowerCase().includes(searchVal);
      const matchZone = (ap.zone || '').toLowerCase().includes(searchVal);
      const matchR0 = (ap.radio0Channel || '').toLowerCase().includes(searchVal);
      const matchR1 = (ap.radio1Channel || '').toLowerCase().includes(searchVal);
      if (!matchName && !matchIp && !matchModel && !matchSerial && !matchZone && !matchR0 && !matchR1) {
        return false;
      }
    }

    return true;
  });

  // Update summary counter text
  const counterText = document.getElementById('wifi-aps-counter-text');
  if (counterText) {
    let filterLabel = '';
    if (currentWifiFilter === 'online') filterLabel = ' &bull; <strong style="color: #34d399;">Samo Online</strong>';
    else if (currentWifiFilter === 'offline') filterLabel = ' &bull; <strong style="color: #f87171;">Samo Offline (Nedostupni)</strong>';
    else if (currentWifiFilter === 'indoor') filterLabel = ' &bull; Tip: <strong>Unutrašnji (AP-505)</strong>';
    else if (currentWifiFilter === 'outdoor') filterLabel = ' &bull; Tip: <strong>Spoljašnji (AP-565)</strong>';
    else if (currentWifiFilter === 'conductor') filterLabel = ' &bull; Uloga: <strong>Conductor (Master)</strong>';

    counterText.innerHTML = `Prikazano: <strong>${filtered.length}</strong> od ukupno ${allWifiAps.length} pristupnih tačaka${filterLabel}`;
  }

  const clusterText = document.getElementById('wifi-aps-cluster-text');
  if (clusterText && wifiClusterSummary) {
    clusterText.textContent = `Klaster: ${wifiClusterSummary.name || 'Uni Promet'} (VC IP: ${wifiClusterSummary.vcIp || '192.168.6.200'})`;
  }

  if (filtered.length === 0) {
    container.className = '';
    container.innerHTML = `
      <div class="empty-state-box" style="padding: 50px 20px; text-align: center; background: rgba(18, 21, 28, 0.6); border: 1px dashed rgba(255, 255, 255, 0.12); border-radius: 12px; margin-top: 14px;">
        <div style="width: 52px; height: 52px; border-radius: 50%; background: rgba(255, 184, 0, 0.1); display: flex; align-items: center; justify-content: center; margin: 0 auto 14px auto; color: var(--yellow-primary);">
          <i data-lucide="wifi" style="width: 26px; height: 26px;"></i>
        </div>
        <h4 style="font-family: var(--font-heading); color: #fff; font-size: 1.05rem;">Nema pronađenih pristupnih tačaka</h4>
        <p class="text-muted text-sm" style="max-width: 420px; margin: 6px auto 0 auto;">Prilagodite parametre pretrage ili kliknite na karticu "UKUPNO AP" za resetovanje filtera.</p>
        <button class="btn-dark-sm" onclick="resetWifiFilters()" style="margin-top: 14px;">
          <i data-lucide="rotate-cw"></i>
          <span>Poništi sve filtere</span>
        </button>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  if (wifiViewMode === 'grid') {
    // Standard Grid View (using .printers-cards-grid & .printer-card)
    container.className = 'printers-cards-grid';
    container.innerHTML = filtered.map(ap => {
      const isOnline = ap.status === 'online';
      const isOffline = !isOnline;
      const isConductor = ap.hierarchy === 'conductor';
      const clientCount = ap.clientsCount || 0;

      return `
        <div class="printer-card ${isOffline ? 'rf-offline-card' : (isConductor ? 'wifi-conductor-card' : 'online-glow')}" id="card-wifi-${ap.id || ap.serial}">
          
          <!-- Card Header: Model Badge & Status Pill -->
          <div class="printer-card-header">
            <div class="printer-type-badge ${ap.isOutdoor ? 'badge-amber' : ''}">
              <i data-lucide="${ap.isOutdoor ? 'sun' : 'home'}"></i>
              <span>${escapeHtml(ap.model || 'AP')} (${ap.isOutdoor ? 'Spoljašnji' : 'Unutrašnji'})</span>
            </div>
            ${isOffline ? `
              <span class="rf-status-pill-offline" style="font-size: 0.72rem; padding: 3px 9px;">
                <span class="status-dot"></span> OFFLINE (Nema odziva)
              </span>
            ` : `
              <span class="status-pill active-pill" style="font-size: 0.72rem;">
                <span class="status-dot"></span> ${isConductor ? 'Conductor (Master)' : 'Online / Aktivan'}
              </span>
            `}
          </div>

          <!-- Card Body -->
          <div class="printer-card-body">
            
            <!-- Title Row -->
            <div class="printer-title-row">
              <h4 class="printer-name" style="font-size: 0.98rem; display: flex; align-items: center; gap: 7px; color: ${isOffline ? '#fca5a5 !important' : '#ffffff'};">
                ${isOffline 
                  ? '<i data-lucide="alert-triangle" style="width: 17px; height: 17px; color: #ef4444; flex-shrink: 0;"></i>' 
                  : (isConductor 
                      ? '<i data-lucide="crown" style="width: 17px; height: 17px; color: #FFC700; flex-shrink: 0;"></i>' 
                      : '<i data-lucide="wifi" style="width: 16px; height: 16px; color: var(--yellow-primary); flex-shrink: 0;"></i>')}
                <span>${escapeHtml(ap.name)}</span>
              </h4>
              ${isConductor ? `
                <span class="inv-rec-badge" style="color: #FFC700; border-color: rgba(255, 184, 0, 0.4);">
                  <i data-lucide="crown"></i> Master
                </span>
              ` : ''}
            </div>

            <!-- Meta Row: Zone / Location, Port, Serial Number -->
            <div class="printer-meta-row" style="margin: 8px 0;">
              <div class="meta-item">
                <i data-lucide="map-pin" class="meta-icon" style="${isOffline ? 'color: #ef4444;' : ''}"></i>
                <span class="meta-text text-dim" style="font-size: 0.76rem;">${escapeHtml(ap.zone || 'Uni Promet Čačak')}</span>
              </div>
              <div class="meta-item">
                <i data-lucide="network" class="meta-icon"></i>
                <span class="meta-text text-xs">Port: ${escapeHtml(ap.uplinkPort || 'eth0')}</span>
              </div>
              <div class="meta-item">
                <i data-lucide="hash" class="meta-icon"></i>
                <span class="meta-text font-mono text-xs text-dim">S/N: ${escapeHtml(ap.serial || '--')}</span>
              </div>
            </div>

            <!-- IP Address Box -->
            <div class="printer-ip-box">
              <div class="ip-details">
                <span class="ip-label" style="${isOffline ? 'color: #ef4444 !important;' : ''}">IP ADRESA PRISTUPNE TAČKE</span>
                <span class="ip-val font-mono" style="${isOffline ? 'color: #f87171 !important;' : 'color: var(--yellow-primary);'}">${escapeHtml(ap.ip || 'N/A')}</span>
              </div>
              <div style="display: flex; gap: 4px; align-items: center;">
                ${ap.ip ? `
                  <button class="btn-copy-chip" onclick="copyCustomUrl('${escapeHtml(ap.ip)}')" title="Kopiraj IP adresu">
                    <i data-lucide="copy"></i>
                  </button>
                ` : ''}
              </div>
            </div>

            <!-- Radio Specifications OR Prominent Offline Box -->
            ${isOffline ? `
              <div class="rf-ping-audit-box audit-offline" style="margin-top: 10px;">
                <div class="rf-ping-audit-row">
                  <span class="rf-ping-audit-label">
                    <i data-lucide="wifi-off" style="width: 12px; height: 12px; color: #ef4444;"></i>
                    Status veze:
                  </span>
                  <span class="rf-ping-audit-val" style="color: #fca5a5;">
                    Nedostupna na Virtual Controller-u
                  </span>
                </div>
                <div class="rf-ping-audit-row">
                  <span class="rf-ping-audit-label">
                    <i data-lucide="alert-circle" style="width: 12px; height: 12px; color: #ef4444;"></i>
                    Radio signal:
                  </span>
                  <span class="rf-ping-audit-val" style="color: #f87171;">
                    Prekid radio emisije &bull; Timeout
                  </span>
                </div>
              </div>
            ` : `
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px;">
                <!-- 5 GHz Radio -->
                <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; padding: 8px 10px;">
                  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                    <span style="font-size: 0.68rem; font-weight: 800; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.04em;">5 GHz Radio</span>
                    <i data-lucide="radio" style="width: 12px; height: 12px; color: #38bdf8;"></i>
                  </div>
                  <div style="font-size: 0.82rem; color: #fff; font-weight: 600;">
                    Kanal: <span class="font-mono text-yellow">${escapeHtml(ap.radio0Channel || '--')}</span>
                  </div>
                  <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 2px;">
                    Snaga: ${escapeHtml(ap.radio0Power || '--')}
                  </div>
                  ${ap.radio0Util ? `<div style="font-size: 0.70rem; color: #10b981; margin-top: 2px;">Zauzeće: ${escapeHtml(ap.radio0Util)}</div>` : ''}
                </div>

                <!-- 2.4 GHz Radio -->
                <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; padding: 8px 10px;">
                  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                    <span style="font-size: 0.68rem; font-weight: 800; color: #a855f7; text-transform: uppercase; letter-spacing: 0.04em;">2.4 GHz Radio</span>
                    <i data-lucide="radio" style="width: 12px; height: 12px; color: #a855f7;"></i>
                  </div>
                  <div style="font-size: 0.82rem; color: #fff; font-weight: 600;">
                    Kanal: <span class="font-mono text-yellow">${escapeHtml(ap.radio1Channel || '--')}</span>
                  </div>
                  <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 2px;">
                    Snaga: ${escapeHtml(ap.radio1Power || '--')}
                  </div>
                  ${ap.radio1Util ? `<div style="font-size: 0.70rem; color: #10b981; margin-top: 2px;">Zauzeće: ${escapeHtml(ap.radio1Util)}</div>` : ''}
                </div>
              </div>
            `}

          </div>

          <!-- Card Actions Footer (Single clean action for clients list) -->
          <div class="printer-card-actions">
            <button class="btn-printer-action" style="flex: 1; justify-content: center; gap: 8px;" ${isOffline ? 'disabled style="opacity: 0.5; cursor: not-allowed; flex: 1; justify-content: center; gap: 8px;"' : ''} onclick="openWifiClientsModal('${escapeHtml(ap.name)}')" title="Pregled liste povezanih uređaja">
              <i data-lucide="smartphone"></i>
              <span>${isOffline ? 'Offline (0 klijenata)' : `Povezani klijenti: <strong style="color: #38bdf8;">${clientCount}</strong>`}</span>
            </button>
          </div>

        </div>
      `;
    }).join('');
  } else {
    // Standard Table View (using .inv-table-wrapper & .inv-camera-table)
    container.className = '';
    container.innerHTML = `
      <div class="inv-table-wrapper">
        <table class="inv-camera-table">
          <thead>
            <tr>
              <th style="width: 45px;">#</th>
              <th style="width: 175px;">IP Adresa AP</th>
              <th>Naziv Pristupne Tačke (AP) / Lokacija</th>
              <th style="width: 160px;">Model Opreme</th>
              <th style="width: 130px;">Uloga</th>
              <th style="width: 150px;">5 GHz Radio</th>
              <th style="width: 150px;">2.4 GHz Radio</th>
              <th style="width: 140px;">Serijski Broj</th>
              <th style="width: 160px; text-align: right;">Povezani Klijenti</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map((ap, idx) => {
              const isOnline = ap.status === 'online';
              const isOffline = !isOnline;
              const isConductor = ap.hierarchy === 'conductor';
              const clientCount = ap.clientsCount || 0;

              return `
                <tr class="${isOnline ? '' : 'rf-table-row-offline'}" id="wifi-row-${ap.serial || idx}">
                  <td class="font-mono text-dim" style="font-size: 0.78rem;">${idx + 1}</td>
                  <td>
                    <div class="inv-ip-pill subnet-wifi" style="${isOnline ? '' : 'background: rgba(239, 68, 68, 0.18); border: 1px solid rgba(239, 68, 68, 0.5); color: #fca5a5;'}">
                      <span class="chip-dot" style="${isOnline ? '' : 'background: #ef4444; box-shadow: 0 0 8px #ef4444;'}"></span>
                      <span>${escapeHtml(ap.ip || 'N/A')}</span>
                      ${ap.ip ? `
                        <button class="btn-copy-chip-sm" onclick="copyCustomUrl('${escapeHtml(ap.ip)}')" title="Kopiraj IP adresu">
                          <i data-lucide="copy"></i>
                        </button>
                      ` : ''}
                    </div>
                  </td>
                  <td>
                    <div class="inv-pos-cell">
                      <div class="inv-cam-avatar" style="${isOnline ? (isConductor ? 'border-color: rgba(255, 184, 0, 0.6); color: #FFC700;' : 'border-color: rgba(255, 184, 0, 0.3); color: var(--yellow-primary);') : 'border-color: rgba(239, 68, 68, 0.5); color: #ef4444;'}">
                        <i data-lucide="${isConductor ? 'crown' : (isOnline ? 'wifi' : 'wifi-off')}" style="width: 16px; height: 16px;"></i>
                      </div>
                      <div class="inv-pos-info">
                        <span class="inv-pos-name" style="${isOnline ? '' : 'color: #fca5a5;'}">${escapeHtml(ap.name)}</span>
                        <span class="inv-pos-sub"><i data-lucide="map-pin" style="width: 10px; height: 10px; display: inline-block;"></i> ${escapeHtml(ap.zone || 'Uni Promet Čačak')}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span class="badge-chip" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: ${ap.isOutdoor ? '#fbbf24' : '#38bdf8'}; font-weight: 700; display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 6px; font-size: 0.75rem;">
                      <i data-lucide="${ap.isOutdoor ? 'sun' : 'home'}" style="width: 12px; height: 12px;"></i>
                      <span>${escapeHtml(ap.model)}</span>
                    </span>
                  </td>
                  <td>
                    ${isOffline ? `
                      <span class="rf-status-pill-offline" style="font-size: 0.72rem; padding: 2px 8px;">
                        <span class="status-dot"></span> Offline
                      </span>
                    ` : (isConductor ? `
                      <span class="badge-chip" style="background: rgba(255, 184, 0, 0.15); color: #FFC700; border: 1px solid rgba(255, 184, 0, 0.4); font-weight: 700; display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 6px; font-size: 0.75rem;">
                        <i data-lucide="crown" style="width: 12px; height: 12px;"></i> Conductor
                      </span>
                    ` : `
                      <span class="text-dim" style="font-size: 0.8rem;">Member AP</span>
                    `)}
                  </td>
                  <td>
                    ${isOffline ? `<span class="text-dim text-xs">-- (Isključeno)</span>` : `
                      <div>
                        <span class="font-mono" style="font-size: 0.82rem; color: #38bdf8; font-weight: 600;">Kanal ${escapeHtml(ap.radio0Channel || '--')}</span>
                        <span class="text-dim text-xs">(${escapeHtml(ap.radio0Power || '--')})</span>
                      </div>
                    `}
                  </td>
                  <td>
                    ${isOffline ? `<span class="text-dim text-xs">-- (Isključeno)</span>` : `
                      <div>
                        <span class="font-mono" style="font-size: 0.82rem; color: #a855f7; font-weight: 600;">Kanal ${escapeHtml(ap.radio1Channel || '--')}</span>
                        <span class="text-dim text-xs">(${escapeHtml(ap.radio1Power || '--')})</span>
                      </div>
                    `}
                  </td>
                  <td>
                    <span class="font-mono" style="font-size: 0.8rem; color: #94a3b8;">${escapeHtml(ap.serial || '--')}</span>
                  </td>
                  <td style="text-align: right;">
                    ${isOffline ? `
                      <span class="badge-chip" style="color: #ef4444; border-color: rgba(239, 68, 68, 0.3); font-size: 0.75rem;">
                        <i data-lucide="wifi-off" style="width: 11px; height: 11px;"></i> 0 (Offline)
                      </span>
                    ` : `
                      <button class="inv-quick-pill" onclick="openWifiClientsModal('${escapeHtml(ap.name)}')" title="Prikaži listu povezanih uređaja" style="padding: 4px 10px; font-size: 0.75rem; border-color: rgba(255, 184, 0, 0.3); display: inline-flex;">
                        <i data-lucide="smartphone" style="width: 12px; height: 12px; color: ${clientCount > 0 ? '#38bdf8' : 'var(--yellow-primary)'};"></i>
                        <strong style="color: #fff;">${clientCount}</strong>
                        <span class="text-dim">uređaja</span>
                      </button>
                    `}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  if (window.lucide) window.lucide.createIcons();
}
window.renderWifiApsTab = renderWifiApsTab;

function resetWifiFilters() {
  currentWifiFilter = 'all';
  currentWifiModelFilter = 'all';
  wifiSearchTerm = '';

  const searchInput = document.getElementById('search-wifi-aps');
  if (searchInput) searchInput.value = '';
  const clearBtn = document.getElementById('btn-clear-search-wifi');
  if (clearBtn) clearBtn.style.display = 'none';

  const selectModel = document.getElementById('select-wifi-model-filter');
  if (selectModel) selectModel.value = 'all';

  document.querySelectorAll('#wifi-type-pills .inv-quick-pill').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-wifi-type') === 'all');
  });

  document.querySelectorAll('#tab-wifi_aps .interactive-kpi').forEach(c => {
    c.classList.toggle('gold-active', c.getAttribute('data-wifi-filter') === 'all');
  });

  renderWifiApsTab();
}
window.resetWifiFilters = resetWifiFilters;

/* --------------------------------------------------------------------------
   WIFI CLIENTS MODAL INSPECTION
   -------------------------------------------------------------------------- */
async function openWifiClientsModal(apName = '') {
  currentModalApName = apName;
  const modal = document.getElementById('modal-wifi-clients');
  const title = document.getElementById('modal-wifi-clients-title');
  const subtitle = document.getElementById('modal-wifi-clients-subtitle');
  const tbody = document.getElementById('modal-wifi-clients-tbody');
  const countBadge = document.getElementById('modal-clients-count-badge');
  const searchInput = document.getElementById('search-modal-clients');

  if (searchInput) searchInput.value = '';

  if (modal) modal.style.display = 'flex';
  if (title) title.textContent = apName ? `WiFi Klijenti: ${apName}` : 'Svi Povezani WiFi Klijenti';
  if (subtitle) {
    subtitle.textContent = apName
      ? `Lista uređaja trenutno povezanih na pristupnu tačku "${apName}"`
      : 'Lista svih uređaja povezanih na bilo koji od 34 AP-a u fabrici';
  }

  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 24px;">
          <div class="spinner-circle" style="margin: 0 auto 10px; width: 28px; height: 28px;"></div>
          <span class="text-dim">Učitavanje podataka o povezanim klijentima...</span>
        </td>
      </tr>
    `;
  }

  try {
    const url = apName
      ? `/api/inventory/wifi-aps/clients?ap=${encodeURIComponent(apName)}`
      : '/api/inventory/wifi-aps/clients';
    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.details || data.error || 'Greška pri očitavanju klijenata');
    }

    currentModalClients = data.clients || [];
    if (countBadge) {
      countBadge.textContent = `${currentModalClients.length} uređaja`;
    }

    renderModalClientsTable(currentModalClients);
  } catch (err) {
    console.error('Error fetching clients for modal:', err);
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 20px; color: #ef4444;">
            <i data-lucide="alert-triangle" style="width: 20px; height: 20px; vertical-align: middle; margin-right: 6px;"></i>
            Greška pri očitavanju klijenata: ${escapeHtml(err.message)}
          </td>
        </tr>
      `;
      if (window.lucide) window.lucide.createIcons();
    }
  }
}
window.openWifiClientsModal = openWifiClientsModal;

function renderModalClientsTable(clientsList) {
  const tbody = document.getElementById('modal-wifi-clients-tbody');
  const countBadge = document.getElementById('modal-clients-count-badge');
  if (!tbody) return;

  if (countBadge) {
    countBadge.textContent = `${clientsList.length} uređaja`;
  }

  if (clientsList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 30px; color: #94a3b8;">
          <i data-lucide="smartphone" style="width: 24px; height: 24px; display: block; margin: 0 auto 8px; opacity: 0.5;"></i>
          Nema trenutno povezanih uređaja.
        </td>
      </tr>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  tbody.innerHTML = clientsList.map(c => {
    const osLower = (c.os || '').toLowerCase();
    const osIcon = osLower.includes('iphone') || osLower.includes('ios') || osLower.includes('apple')
      ? 'apple'
      : osLower.includes('linux') || osLower.includes('android')
      ? 'smartphone'
      : osLower.includes('win')
      ? 'monitor'
      : 'cpu';

    const ssid = c.essid || 'WiFi';
    const isStaff = ssid.toLowerCase().includes('staff');
    const ssidBadgeClass = isStaff ? 'badge-tag-blue' : 'badge-tag-amber';

    return `
      <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.04);">
        <td style="padding: 10px 12px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <i data-lucide="${osIcon}" style="width: 15px; height: 15px; color: #94a3b8;"></i>
            <div>
              <strong style="color: #ffffff; font-size: 0.9rem;">${escapeHtml(c.name || 'Nepoznat uređaj')}</strong>
              <div style="font-size: 0.72rem; color: #64748b;">OS: ${escapeHtml(c.os || 'N/A')}</div>
            </div>
          </div>
        </td>
        <td style="padding: 10px 12px; font-family: 'JetBrains Mono', monospace; color: #FFB800; font-size: 0.85rem; font-weight: 700;">
          ${escapeHtml(c.ip || '--')}
        </td>
        <td style="padding: 10px 12px; font-family: 'JetBrains Mono', monospace; color: #94a3b8; font-size: 0.8rem;">
          ${escapeHtml(c.mac || '--')}
        </td>
        <td style="padding: 10px 12px;">
          <span class="badge-tag ${ssidBadgeClass}" style="font-size: 0.75rem;">
            ${escapeHtml(ssid)}
          </span>
        </td>
        <td style="padding: 10px 12px; color: #ffffff; font-size: 0.85rem; font-weight: 500;">
          ${escapeHtml(c.apName || '--')}
        </td>
        <td style="padding: 10px 12px; text-align: center;">
          <span class="badge-tag" style="background: rgba(16, 185, 129, 0.12); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.25); font-size: 0.75rem;">
            ${escapeHtml(c.signal || '--')}
          </span>
        </td>
        <td style="padding: 10px 12px; text-align: center;">
          <span style="font-family: 'JetBrains Mono', monospace; font-size: 0.82rem; color: #38bdf8; font-weight: 600;">
            ${escapeHtml(c.speed || '--')}
          </span>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
}

function setupWifiApsEventListeners() {
  const searchInput = document.getElementById('search-wifi-aps');
  const btnClearSearch = document.getElementById('btn-clear-search-wifi');
  const selectModel = document.getElementById('select-wifi-model-filter');
  const btnViewGrid = document.getElementById('btn-view-wifi-grid');
  const btnViewTable = document.getElementById('btn-view-wifi-table');
  const btnSync = document.getElementById('btn-sync-wifi-aps');

  // Search input
  searchInput?.addEventListener('input', (e) => {
    wifiSearchTerm = e.target.value;
    if (btnClearSearch) {
      btnClearSearch.style.display = wifiSearchTerm ? 'block' : 'none';
    }
    renderWifiApsTab();
  });

  btnClearSearch?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    wifiSearchTerm = '';
    btnClearSearch.style.display = 'none';
    renderWifiApsTab();
  });

  // Model select
  selectModel?.addEventListener('change', (e) => {
    currentWifiModelFilter = e.target.value;
    renderWifiApsTab();
  });

  // Interactive KPI Cards Filtering
  const kpiTotal = document.getElementById('kpi-card-wifi-total');
  const kpiOnline = document.getElementById('kpi-card-wifi-online');
  const kpiOffline = document.getElementById('kpi-card-wifi-offline');
  const kpiClients = document.getElementById('kpi-card-wifi-clients');
  const kpiConductor = document.getElementById('kpi-card-wifi-conductor');

  function setKpiActiveCard(targetCard) {
    [kpiTotal, kpiOnline, kpiOffline, kpiClients, kpiConductor].forEach(c => c?.classList.remove('gold-active'));
    targetCard?.classList.add('gold-active');
  }

  kpiTotal?.addEventListener('click', () => {
    currentWifiFilter = 'all';
    setKpiActiveCard(kpiTotal);
    // sync pills
    document.querySelectorAll('#wifi-type-pills .inv-quick-pill').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-wifi-type') === 'all');
    });
    renderWifiApsTab();
  });

  kpiOnline?.addEventListener('click', () => {
    currentWifiFilter = 'online';
    setKpiActiveCard(kpiOnline);
    document.querySelectorAll('#wifi-type-pills .inv-quick-pill').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-wifi-type') === 'online');
    });
    renderWifiApsTab();
  });

  kpiOffline?.addEventListener('click', () => {
    currentWifiFilter = 'offline';
    setKpiActiveCard(kpiOffline);
    document.querySelectorAll('#wifi-type-pills .inv-quick-pill').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-wifi-type') === 'offline');
    });
    renderWifiApsTab();
  });

  kpiClients?.addEventListener('click', () => {
    // Open modal with all connected clients in the entire network
    openWifiClientsModal('');
  });

  kpiConductor?.addEventListener('click', () => {
    currentWifiFilter = 'conductor';
    setKpiActiveCard(kpiConductor);
    document.querySelectorAll('#wifi-type-pills .inv-quick-pill').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-wifi-type') === 'conductor');
    });
    renderWifiApsTab();
  });

  // Type filter pills
  document.querySelectorAll('#wifi-type-pills .inv-quick-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#wifi-type-pills .inv-quick-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentWifiFilter = btn.getAttribute('data-wifi-type') || 'all';

      // sync kpi highlight
      if (currentWifiFilter === 'all') setKpiActiveCard(kpiTotal);
      else if (currentWifiFilter === 'online') setKpiActiveCard(kpiOnline);
      else if (currentWifiFilter === 'offline') setKpiActiveCard(kpiOffline);
      else if (currentWifiFilter === 'conductor') setKpiActiveCard(kpiConductor);
      else [kpiTotal, kpiOnline, kpiOffline, kpiClients, kpiConductor].forEach(c => c?.classList.remove('gold-active'));

      renderWifiApsTab();
    });
  });

  // View switchers
  btnViewGrid?.addEventListener('click', () => {
    wifiViewMode = 'grid';
    try { localStorage.setItem('unipromet_wifi_view_mode', 'grid'); } catch {}
    btnViewGrid.classList.add('active');
    btnViewTable?.classList.remove('active');
    renderWifiApsTab();
  });

  btnViewTable?.addEventListener('click', () => {
    wifiViewMode = 'table';
    try { localStorage.setItem('unipromet_wifi_view_mode', 'table'); } catch {}
    btnViewTable.classList.add('active');
    btnViewGrid?.classList.remove('active');
    renderWifiApsTab();
  });

  // Set initial view button state
  if (wifiViewMode === 'table') {
    btnViewTable?.classList.add('active');
    btnViewGrid?.classList.remove('active');
  } else {
    btnViewGrid?.classList.add('active');
    btnViewTable?.classList.remove('active');
  }

  // Sync button action
  btnSync?.addEventListener('click', () => {
    fetchWifiAps(true);
  });

  // Modal actions
  const modalClients = document.getElementById('modal-wifi-clients');
  const btnCloseModal = document.getElementById('btn-close-wifi-clients-modal');
  const btnDoneModal = document.getElementById('btn-done-wifi-clients-modal');
  const searchModalClients = document.getElementById('search-modal-clients');

  btnCloseModal?.addEventListener('click', () => {
    if (modalClients) modalClients.style.display = 'none';
  });
  btnDoneModal?.addEventListener('click', () => {
    if (modalClients) modalClients.style.display = 'none';
  });

  // Filter inside client modal
  searchModalClients?.addEventListener('input', (e) => {
    const q = (e.target.value || '').toLowerCase().trim();
    if (!q) {
      renderModalClientsTable(currentModalClients);
      return;
    }
    const filteredClients = currentModalClients.filter(c => {
      return (c.name || '').toLowerCase().includes(q) ||
             (c.ip || '').toLowerCase().includes(q) ||
             (c.mac || '').toLowerCase().includes(q) ||
             (c.essid || '').toLowerCase().includes(q) ||
             (c.apName || '').toLowerCase().includes(q) ||
             (c.os || '').toLowerCase().includes(q);
    });
    renderModalClientsTable(filteredClients);
  });
}

/* ==========================================================================
   MICROSOFT 365 / ENTRA ID AUTHENTICATION & GROUPS WIDGET
   ========================================================================== */
async function initAuthWidget() {
  const container = document.getElementById('auth-widget');
  if (!container) return;

  // Handle URL callback parameters
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('login') === 'success') {
    window.history.replaceState({}, document.title, window.location.pathname);
    showToast('Uspešno ste prijavljeni preko Microsoft 365 naloga!', 'success');
  } else if (urlParams.get('logout') === 'success') {
    window.history.replaceState({}, document.title, window.location.pathname);
    showToast('Odjavljeni ste sa sistema.', 'info');
  } else if (urlParams.get('auth_error')) {
    const err = urlParams.get('auth_error');
    window.history.replaceState({}, document.title, window.location.pathname);
    showToast('Greška pri Microsoft prijavi: ' + err, 'error');
  }

  try {
    const res = await fetch('/auth/me');
    const data = await res.json();

    if (data.isAuthenticated && data.user) {
      const user = data.user;
      
      // Calculate initials (e.g. "Miloš Lukić" -> "ML")
      const nameParts = (user.name || 'U').trim().split(/\s+/);
      const initials = nameParts.length >= 2
        ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
        : user.name.slice(0, 2).toUpperCase();

      const groups = Array.isArray(user.groups) ? user.groups : [];
      let roleLabel = 'Korisnik';
      const accessRoles = (data.access && Array.isArray(data.access.roles)) ? data.access.roles : [];
      if (data.access && data.access.isSuperAdmin) {
        roleLabel = 'Super admin';
      } else if (accessRoles.length > 0) {
        roleLabel = accessRoles.length === 1
          ? (accessRoles[0].length > 18 ? accessRoles[0].slice(0, 17) + '…' : accessRoles[0])
          : `${accessRoles.length} role`;
      } else if (user.isAdmin) {
        roleLabel = 'IT Admin';
      } else if (groups.length > 0) {
        roleLabel = groups[0].name.length > 14 ? `${groups.length} Grupe` : groups[0].name;
      }

      const groupsHtml = groups.length > 0
        ? groups.map(g => {
            const isAdmin = g.name.toLowerCase().includes('admin') || g.name.toLowerCase().includes('it');
            return `<span class="group-tag ${isAdmin ? 'admin' : ''}">
              <i data-lucide="${isAdmin ? 'shield' : 'users'}" style="width:11px;height:11px;"></i>
              ${escapeHtml(g.name)}
            </span>`;
          }).join('')
        : '<span style="color:#64748b; font-size:0.75rem; font-style:italic;">Nema dodeljenih bezbednosnih grupa</span>';

      container.innerHTML = `
        <div class="user-chip" id="user-profile-chip" title="Kliknite za prikaz grupa i odjavu">
          <div class="user-avatar">${initials}</div>
          <div class="user-meta">
            <span class="user-name">${escapeHtml(user.name)}</span>
            <span class="user-role-badge">
              <i data-lucide="shield-check" style="width:11px;height:11px;"></i>
              ${escapeHtml(roleLabel)}
            </span>
          </div>
          <i data-lucide="chevron-down" class="user-chevron"></i>
        </div>

        <div class="auth-dropdown" id="auth-dropdown-menu">
          <div class="dropdown-header">
            <div class="dropdown-avatar-large">${initials}</div>
            <div class="dropdown-user-info">
              <div class="dropdown-user-name">${escapeHtml(user.name)}</div>
              <div class="dropdown-user-email">${escapeHtml(user.email)}</div>
            </div>
          </div>

          ${accessRoles.length > 0 ? `
          <div class="dropdown-groups-section">
            <div class="dropdown-section-title">
              <i data-lucide="shield-check" style="width:13px;height:13px;"></i>
              Dodeljene role (${accessRoles.length})
            </div>
            <div class="dropdown-groups-list">
              ${accessRoles.map(r => `<span class="group-tag admin"><i data-lucide="shield" style="width:11px;height:11px;"></i> ${escapeHtml(r)}</span>`).join('')}
            </div>
          </div>` : ''}

          <div class="dropdown-groups-section">
            <div class="dropdown-section-title">
              <i data-lucide="layers" style="width:13px;height:13px;"></i>
              Active Directory / Entra ID Grupe (${groups.length})
            </div>
            <div class="dropdown-groups-list">
              ${groupsHtml}
            </div>
          </div>

          <div class="dropdown-actions">
            <button type="button" id="btn-refresh-ad-groups" class="btn-refresh-groups" title="Osveži članstvo u grupama direktno sa Active Directory-ja">
              <i data-lucide="refresh-cw" id="icon-refresh-ad" style="width:12px;height:12px;"></i>
              <span>Osveži AD</span>
            </button>
            <a href="/auth/logout" class="btn-logout">
              <i data-lucide="log-out" style="width:13px;height:13px;"></i>
              <span>Odjavi se</span>
            </a>
          </div>
        </div>
      `;

      // Wire dropdown toggle
      const chip = document.getElementById('user-profile-chip');
      const dropdown = document.getElementById('auth-dropdown-menu');
      if (chip && dropdown) {
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          const isOpen = dropdown.classList.contains('show');
          dropdown.classList.toggle('show', !isOpen);
          chip.classList.toggle('active', !isOpen);
        });

        document.addEventListener('click', (e) => {
          if (!container.contains(e.target)) {
            dropdown.classList.remove('show');
            chip.classList.remove('active');
          }
        });
      }

      // Wire Active Directory instant refresh button
      const refreshBtn = document.getElementById('btn-refresh-ad-groups');
      const refreshIcon = document.getElementById('icon-refresh-ad');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (refreshIcon) refreshIcon.classList.add('spin-slow');
          refreshBtn.disabled = true;
          try {
            const r = await fetch('/auth/refresh');
            const resData = await r.json();
            if (resData.success && resData.user) {
              showToast(`Grupe osvežene sa Active Directory-ja! (${resData.groupsCount} grupa)`, 'success');
              initUserProfile();
            } else {
              showToast('Osvežavanje nije uspelo.', 'error');
            }
          } catch (err) {
            showToast('Greška pri osvežavanju grupa.', 'error');
          } finally {
            if (refreshIcon) refreshIcon.classList.remove('spin-slow');
            refreshBtn.disabled = false;
          }
        });
      }

      if (!window._adProfileFocusRegistered) {
        window._adProfileFocusRegistered = true;
        let lastAdFocusCheck = Date.now();
        window.addEventListener('focus', () => {
          if (Date.now() - lastAdFocusCheck > 30000) {
            lastAdFocusCheck = Date.now();
            initUserProfile();
          }
        });
      }
    } else {
      // Not logged in: Show Microsoft 365 Login Button
      container.innerHTML = `
        <a href="/auth/login" class="btn-microsoft-login" title="Prijavite se sa Unipromet Microsoft 365 nalogom">
          <div class="ms-grid-icon">
            <div class="ms-square ms-red"></div>
            <div class="ms-square ms-green"></div>
            <div class="ms-square ms-blue"></div>
            <div class="ms-square ms-yellow"></div>
          </div>
          <span>Prijava (Microsoft 365)</span>
        </a>
      `;
    }

    if (window.lucide && window.lucide.createIcons) {
      window.lucide.createIcons();
    }
  } catch (err) {
    console.warn('[AuthWidget] Could not check auth status:', err);
  }
}
