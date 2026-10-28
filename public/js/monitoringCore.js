/**
 * ==========================================================================
 * UNIPROMET IT ADMIN - MONITORING: ZAJEDNIČKO JEZGRO
 * Predefinisani šabloni, pomoćne funkcije rasporeda i GridPlayer koji
 * prikazuje grid kamera sa živim strimovima (go2rtc preko /api/video-gateway).
 * Koristi ga stranica Monitoring (monitoring.js) i zaseban prozor (monitor.html).
 * ==========================================================================
 */
(function () {
  'use strict';

  const MAX_CELLS = 25;
  const MAX_GRID = 8;
  const WARN_STREAMS = 16;

  const c = (x, y, w, h) => ({ x, y, w, h });

  /** 10 predefinisanih šablona za 1-10 kamera */
  const PRESETS = [
    { id: 'preset-1', name: '1 kamera', hint: '1×1', layout: { cols: 1, rows: 1, cells: [c(1, 1, 1, 1)] } },
    { id: 'preset-2', name: '2 kamere', hint: '1 + 1', layout: { cols: 2, rows: 1, cells: [c(1, 1, 1, 1), c(2, 1, 1, 1)] } },
    { id: 'preset-3', name: '3 kamere', hint: '1 velika + 2', layout: { cols: 3, rows: 2, cells: [c(1, 1, 2, 2), c(3, 1, 1, 1), c(3, 2, 1, 1)] } },
    { id: 'preset-4', name: '4 kamere', hint: '2×2', layout: { cols: 2, rows: 2, cells: [c(1, 1, 1, 1), c(2, 1, 1, 1), c(1, 2, 1, 1), c(2, 2, 1, 1)] } },
    {
      id: 'preset-5', name: '5 kamera', hint: '2 + 3',
      layout: { cols: 6, rows: 5, cells: [c(1, 1, 3, 3), c(4, 1, 3, 3), c(1, 4, 2, 2), c(3, 4, 2, 2), c(5, 4, 2, 2)] }
    },
    {
      id: 'preset-6', name: '6 kamera', hint: '1 velika + 5',
      layout: { cols: 3, rows: 3, cells: [c(1, 1, 2, 2), c(3, 1, 1, 1), c(3, 2, 1, 1), c(1, 3, 1, 1), c(2, 3, 1, 1), c(3, 3, 1, 1)] }
    },
    {
      id: 'preset-7', name: '7 kamera', hint: '3 velike + 4',
      layout: { cols: 4, rows: 4, cells: [c(1, 1, 2, 2), c(3, 1, 2, 2), c(1, 3, 2, 2), c(3, 3, 1, 1), c(4, 3, 1, 1), c(3, 4, 1, 1), c(4, 4, 1, 1)] }
    },
    {
      id: 'preset-8', name: '8 kamera', hint: '1 velika + 7',
      layout: {
        cols: 4, rows: 4,
        cells: [c(1, 1, 3, 3), c(4, 1, 1, 1), c(4, 2, 1, 1), c(4, 3, 1, 1), c(1, 4, 1, 1), c(2, 4, 1, 1), c(3, 4, 1, 1), c(4, 4, 1, 1)]
      }
    },
    {
      id: 'preset-9', name: '9 kamera', hint: '3×3',
      layout: {
        cols: 3, rows: 3,
        cells: [c(1, 1, 1, 1), c(2, 1, 1, 1), c(3, 1, 1, 1), c(1, 2, 1, 1), c(2, 2, 1, 1), c(3, 2, 1, 1), c(1, 3, 1, 1), c(2, 3, 1, 1), c(3, 3, 1, 1)]
      }
    },
    {
      id: 'preset-10', name: '10 kamera', hint: '2 velike + 8',
      layout: {
        cols: 4, rows: 4,
        cells: [c(1, 1, 2, 2), c(3, 1, 2, 2), c(1, 3, 1, 1), c(2, 3, 1, 1), c(3, 3, 1, 1), c(4, 3, 1, 1), c(1, 4, 1, 1), c(2, 4, 1, 1), c(3, 4, 1, 1), c(4, 4, 1, 1)]
      }
    }
  ];

  /* ==========================================================================
     POMOĆNE FUNKCIJE
     ========================================================================== */
  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function icons(root) {
    const L = window.lucide;
    if (!L || !L.createIcons) return;
    try {
      if (root && L.icons) L.createIcons({ icons: L.icons, root });
      else L.createIcons();
    } catch (e) {
      try { L.createIcons(); } catch (err) { /* ikonice nisu ključne */ }
    }
  }

  function cloneLayout(layout) {
    return { cols: layout.cols, rows: layout.rows, cells: layout.cells.map(x => ({ x: x.x, y: x.y, w: x.w, h: x.h })) };
  }

  /** Polja sortirana čitanjem: red po red, s leva na desno */
  function sortCells(cells) {
    return cells.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
  }

  function cellStyle(cell) {
    return `grid-column: ${cell.x} / span ${cell.w}; grid-row: ${cell.y} / span ${cell.h};`;
  }

  /**
   * Razmera celog grida: svaka osnovna ćelija je 16:9 (kao kadar kamere), pa su
   * polja N×N iste razmere kao video i pločice stoje jedna uz drugu bez crnih traka.
   */
  function layoutRatio(layout) {
    return (layout.cols * 16) / (layout.rows * 9);
  }

  function gridStyle(layout) {
    return `grid-template-columns: repeat(${layout.cols}, minmax(0, 1fr)); grid-template-rows: repeat(${layout.rows}, minmax(0, 1fr)); --r: ${layoutRatio(layout).toFixed(5)};`;
  }

  /** Mini prikaz rasporeda (galerija šablona, kartice) - grid u pravoj razmeri, centriran u okviru 16:9 */
  function miniLayoutHtml(layout, opts) {
    const numbered = !opts || opts.numbers !== false;
    return `<div class="mon-mini-box"><div class="mon-mini" style="${gridStyle(layout)}">${layout.cells
      .map((cell, i) => `<span style="${cellStyle(cell)}">${numbered ? i + 1 : ''}</span>`)
      .join('')}</div></div>`;
  }

  const FIT_MODES = ['fill', 'cover', 'contain'];
  const FIT_LABELS = { fill: 'Popuni polje', cover: 'Iseci višak', contain: 'Ceo kadar' };

  function cameraLabel(cam) {
    if (!cam) return '';
    return cam.position || cam.name || cam.ip || '';
  }

  function streamUrl(cam, quality) {
    const key = String(cam.ip || '').trim().replace(/\./g, '_');
    return `/api/video-gateway/ws?src=cam_${key}_${quality === 'main' ? 'main' : 'sub'}`;
  }

  function snapshotUrl(cam) {
    return `/api/cameras/${encodeURIComponent(cam.ip)}/snapshot?t=${Date.now()}`;
  }

  /** Dodela kamera kada se promeni šablon: zadržava redosled, višak ispada */
  function remapCameras(cameras, newCount) {
    const kept = (cameras || []).filter(Boolean);
    const out = [];
    for (let i = 0; i < newCount; i++) out.push(kept[i] || null);
    return { cameras: out, dropped: Math.max(0, kept.length - newCount) };
  }

  function countStreams(cameraIds, camerasById) {
    return (cameraIds || []).filter(id => id && camerasById.has(id)).length;
  }

  function cameraWord(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'kamera';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'kamere';
    return 'kamera';
  }

  function fieldWord(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'polje';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'polja';
    return 'polja';
  }

  /* ==========================================================================
     GRID PLAYER - prikaz taba sa živim strimovima
     ========================================================================== */
  /**
   * @param {HTMLElement} container
   * @param {object} opts
   *   onOpenRecordings(cam) - otvara modal kamere sa snimcima (samo glavna stranica)
   */
  function GridPlayer(container, opts) {
    this.container = container;
    this.opts = opts || {};
    this.tab = null;
    this.camerasById = new Map();
    this.timers = [];
    this.maxIndex = -1;
    this.fit = FIT_MODES.includes(this.opts.fit) ? this.opts.fit : 'fill';
    this.onKey = this.onKey.bind(this);
    document.addEventListener('keydown', this.onKey);
  }

  GridPlayer.prototype.clearTimers = function () {
    this.timers.forEach(t => { clearTimeout(t); clearInterval(t); });
    this.timers = [];
  };

  function destroyStream(vs) {
    try {
      if (typeof vs.destroy === 'function') vs.destroy();
      else if (typeof vs.ondisconnect === 'function') vs.ondisconnect();
    } catch (e) { /* ignorisano */ }
    vs.remove();
  }

  /** Gasi sve strimove u gridu (pri promeni taba, odlasku sa stranice) */
  GridPlayer.prototype.unmount = function () {
    this.clearTimers();
    this.container.querySelectorAll('video-stream').forEach(destroyStream);
  };

  GridPlayer.prototype.destroy = function () {
    this.unmount();
    document.removeEventListener('keydown', this.onKey);
    this.container.innerHTML = '';
  };

  GridPlayer.prototype.render = function (tab, camerasById) {
    this.unmount();
    this.tab = tab;
    this.camerasById = camerasById || new Map();
    this.maxIndex = -1;

    if (!tab) {
      this.container.innerHTML = '';
      return;
    }

    const layout = tab.layout;
    const html = layout.cells.map((cell, i) => {
      const camId = tab.cameras[i];
      const cam = camId ? this.camerasById.get(camId) : null;
      let inner;
      if (!camId) {
        inner = `<div class="mon-cell-empty"><i data-lucide="video-off"></i><span>Prazno polje</span></div>`;
      } else if (!cam) {
        inner = `<div class="mon-cell-empty is-denied"><i data-lucide="shield-off"></i><span>Nema pristupa kameri</span></div>`;
      } else {
        inner = `
          <img class="mon-cell-snap" src="${esc(snapshotUrl(cam))}" alt="" loading="lazy" onerror="this.style.display='none'">
          <div class="mon-cell-video"></div>
          <div class="mon-cell-osd">
            <span class="mon-cell-name" title="${esc(cameraLabel(cam))}">${esc(cameraLabel(cam))}</span>
            <span class="mon-cell-state ${cam.isOffline ? 'is-offline' : ''}">
              ${cam.isOffline
                ? '<i data-lucide="wifi-off"></i><span>Offline</span>'
                : '<span class="live-dot-pulse"></span><span class="mon-state-text">Povezivanje</span>'}
            </span>
          </div>
          <div class="mon-cell-actions">
            ${cam.canPlayback && this.opts.onOpenRecordings ? `<button type="button" class="mon-cell-btn" data-act="recordings" title="Snimci i detalji kamere"><i data-lucide="history"></i></button>` : ''}
            <button type="button" class="mon-cell-btn" data-act="maximize" title="Uvećaj (dvoklik)"><i data-lucide="maximize-2"></i></button>
          </div>`;
      }
      return `<div class="mon-cell ${cam ? 'has-camera' : ''}" data-index="${i}" style="${cellStyle(cell)}">${inner}</div>`;
    }).join('');

    this.container.innerHTML = `<div class="mon-grid fit-${this.fit}" style="${gridStyle(layout)}">${html}</div>`;
    icons(this.container);

    const grid = this.container.querySelector('.mon-grid');
    grid.addEventListener('dblclick', (e) => {
      const cellEl = e.target.closest('.mon-cell.has-camera');
      if (!cellEl) return;
      this.toggleMaximize(Number(cellEl.dataset.index));
    });
    grid.addEventListener('click', (e) => {
      const btn = e.target.closest('.mon-cell-btn');
      if (!btn) return;
      e.stopPropagation();
      const idx = Number(btn.closest('.mon-cell').dataset.index);
      if (btn.dataset.act === 'maximize') this.toggleMaximize(idx);
      else if (btn.dataset.act === 'recordings') {
        const cam = this.camerasById.get(this.tab.cameras[idx]);
        if (cam && this.opts.onOpenRecordings) this.opts.onOpenRecordings(cam);
      }
    });

    this.mountAll();
  };

  /** Postepeno pokretanje strimova (100 ms razmaka) da se gateway ne zaguši */
  GridPlayer.prototype.mountAll = function () {
    if (!this.tab) return;
    let n = 0;
    this.tab.cameras.forEach((camId, i) => {
      const cam = camId ? this.camerasById.get(camId) : null;
      if (!cam) return;
      const t = setTimeout(() => this.mountCell(i, 'sub'), n * 100);
      this.timers.push(t);
      n++;
    });
  };

  GridPlayer.prototype.mountCell = function (index, quality) {
    const cellEl = this.container.querySelector(`.mon-cell[data-index="${index}"]`);
    if (!cellEl || !this.tab) return;
    const cam = this.camerasById.get(this.tab.cameras[index]);
    const holder = cellEl.querySelector('.mon-cell-video');
    if (!cam || !holder) return;

    holder.querySelectorAll('video-stream').forEach(destroyStream);
    cellEl.classList.remove('is-playing');
    this.setState(cellEl, cam.isOffline ? 'offline' : 'connecting');

    const vs = document.createElement('video-stream');
    vs.mode = 'webrtc,mse,mp4,mjpeg';
    vs.background = false;
    holder.appendChild(vs);
    vs.src = streamUrl(cam, quality);
    cellEl.dataset.quality = quality;
    // Grid je nadzorni prikaz: bez kontrola plejera (pauza, traka, zvuk)
    const vidEl = vs.querySelector('video');
    if (vidEl) {
      vidEl.controls = false;
      vidEl.muted = true;
    }

    // Kada video krene: sakrij statični frejm i označi uživo; ako stane, vrati "Povezivanje"
    const watch = setInterval(() => {
      const vid = vs.querySelector('video');
      if (!vs.isConnected) { clearInterval(watch); return; }
      const playing = !!vid && vid.readyState >= 2 && !vid.paused;
      if (playing && !cellEl.classList.contains('is-playing')) {
        cellEl.classList.add('is-playing');
        this.setState(cellEl, quality === 'main' ? 'main' : 'live');
      } else if (!playing && cellEl.classList.contains('is-playing')) {
        cellEl.classList.remove('is-playing');
        this.setState(cellEl, 'connecting');
      }
    }, 700);
    this.timers.push(watch);
  };

  GridPlayer.prototype.setState = function (cellEl, state) {
    const el = cellEl.querySelector('.mon-cell-state');
    if (!el) return;
    el.classList.toggle('is-offline', state === 'offline');
    el.classList.toggle('is-live', state === 'live' || state === 'main');
    const text = el.querySelector('.mon-state-text');
    if (!text) return;
    text.textContent = state === 'main' ? 'Uživo HD' : state === 'live' ? 'Uživo' : state === 'offline' ? 'Offline' : 'Povezivanje';
  };

  /** Dvoklik: kamera preko celog grida u main streamu; ponovni dvoklik ili Esc vraća grid */
  GridPlayer.prototype.toggleMaximize = function (index) {
    if (this.maxIndex === index) return this.restore();
    if (this.maxIndex >= 0) this.restore();
    const grid = this.container.querySelector('.mon-grid');
    const cellEl = this.container.querySelector(`.mon-cell[data-index="${index}"]`);
    if (!grid || !cellEl) return;
    this.maxIndex = index;
    grid.classList.add('has-max');
    cellEl.classList.add('is-max');
    this.mountCell(index, 'main');
  };

  GridPlayer.prototype.restore = function () {
    if (this.maxIndex < 0) return;
    const index = this.maxIndex;
    this.maxIndex = -1;
    const grid = this.container.querySelector('.mon-grid');
    const cellEl = this.container.querySelector(`.mon-cell[data-index="${index}"]`);
    if (grid) grid.classList.remove('has-max');
    if (cellEl) {
      cellEl.classList.remove('is-max');
      this.mountCell(index, 'sub');
    }
  };

  /** Kako video popunjava polje: rastegnut (fill), isečen (cover) ili ceo kadar (contain) */
  GridPlayer.prototype.setFit = function (mode) {
    if (!FIT_MODES.includes(mode)) return;
    const grid = this.container.querySelector('.mon-grid');
    if (grid) grid.classList.replace(`fit-${this.fit}`, `fit-${mode}`);
    this.fit = mode;
  };

  GridPlayer.prototype.isMaximized = function () {
    return this.maxIndex >= 0;
  };

  GridPlayer.prototype.onKey = function (e) {
    if (e.key === 'Escape' && this.maxIndex >= 0 && this.container.isConnected && this.container.offsetParent !== null) {
      this.restore();
    }
  };

  /* ==========================================================================
     CEO EKRAN
     ========================================================================== */
  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function toggleFullscreen(el) {
    if (isFullscreen()) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      return;
    }
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) return;
    const p = req.call(el);
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  window.MonitoringCore = {
    MAX_CELLS,
    MAX_GRID,
    WARN_STREAMS,
    PRESETS,
    esc,
    icons,
    cloneLayout,
    sortCells,
    cellStyle,
    gridStyle,
    layoutRatio,
    FIT_MODES,
    FIT_LABELS,
    miniLayoutHtml,
    cameraLabel,
    snapshotUrl,
    remapCameras,
    countStreams,
    cameraWord,
    fieldWord,
    isFullscreen,
    toggleFullscreen,
    GridPlayer
  };
})();
