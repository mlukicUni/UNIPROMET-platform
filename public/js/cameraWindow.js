/**
 * Samostalna stranica jedne kamere (/kamera/<ID>): samo video uživo i osnovne komande.
 * Ne učitava ostatak platforme, pa se kamera otvara brzo.
 */
(function () {
  'use strict';

  const C = window.__CAMERA__;
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const overlay = $('overlay');
  let quality = 'sub';
  let session = 0; // poništava zakasnele odgovore posle promene kvaliteta / ponovnog pokušaja

  function say(text, sub, opts) {
    const o = opts || {};
    overlay.classList.remove('hidden');
    overlay.classList.toggle('has-actions', !!o.actions);
    $('spinner').classList.toggle('hidden', !!o.noSpinner);
    $('msg').textContent = text;
    $('msg-sub').textContent = sub || '';
    $('actions').classList.toggle('hidden', !o.actions);
  }
  const hideMessage = () => overlay.classList.add('hidden');

  function stopStream() {
    const vs = stage.querySelector('video-stream');
    if (vs) vs.src = '';
    stage.innerHTML = '';
  }

  async function start(isAutoRetry) {
    const my = ++session;
    stopStream();
    say('Povezivanje sa kamerom...', quality === 'main' ? 'Glavni tok (HD)' : 'Brzi prikaz');
    let info;
    try {
      const res = await fetch(`/api/cameras/${encodeURIComponent(C.ip)}/live-info`, { headers: { Accept: 'application/json' } });
      if (res.status === 401) { location.href = `/kamera/${encodeURIComponent(C.id)}`; return; }
      if (!res.ok) throw new Error(res.status === 403 ? 'Nemate dozvolu da gledate ovu kameru.' : `Server je vratio grešku ${res.status}.`);
      info = await res.json();
    } catch (err) {
      if (my === session) say('Kamera trenutno nije dostupna.', err.message, { actions: true, noSpinner: true });
      return;
    }
    if (my !== session) return;
    // Modul video-stream.js se izvršava tek posle ove skripte: element mora da bude definisan pre nego što mu se zadaju svojstva,
    // inače se prvi pokušaj nikad ne povezuje (a ponovni pokušaj radi)
    try { await customElements.whenDefined('video-stream'); } catch (e) { /* nastavlja se */ }
    if (my !== session) return;
    const wsUrl = quality === 'main' ? info.streamWsMainUrl : info.streamWsSubUrl;
    if (!wsUrl) { say('Video tok nije dostupan.', 'Server nije vratio adresu video toka.', { actions: true, noSpinner: true }); return; }

    const vs = document.createElement('video-stream');
    vs.background = false;
    vs.mode = 'webrtc,mse,mp4,mjpeg';
    vs.addEventListener('stream-error', (e) => {
      if (my !== session) return;
      const m = e.detail && e.detail.message ? String(e.detail.message) : '';
      // Poruke tipa DESCRIBE / 453 se javljaju dok se tok još povezuje; prave greške se prikazuju
      if (m && !/DESCRIBE|453|400/.test(m)) say('Video tok nije moguće otvoriti.', m, { actions: true, noSpinner: true });
    });
    let playing = false;
    stage.appendChild(vs);
    vs.src = wsUrl;

    const tick = setInterval(() => {
      if (my !== session) { clearInterval(tick); return; }
      const v = vs.querySelector('video');
      if (!v) return;
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      const ready = () => { playing = true; hideMessage(); $('live-tag').classList.remove('hidden'); };
      v.addEventListener('playing', ready, { once: true });
      v.addEventListener('loadeddata', ready, { once: true });
      v.play().catch(() => {});
      clearInterval(tick);
    }, 40);
    // Ako se video ne pojavi, korisnik dobija poruku i dugme za ponovni pokušaj (umesto praznog crnog ekrana)
    setTimeout(() => {
      if (my !== session || playing) return;
      if (!isAutoRetry) { start(true); return; } // jedan tihi automatski ponovni pokušaj
      say('Povezivanje traje duže nego obično...', 'Ako se video ne pojavi, pokušajte ponovo ili izaberite „Brzo“.', { actions: true });
    }, isAutoRetry ? 8000 : 6000);
  }

  function setQuality(q) {
    if (q === quality) return;
    quality = q;
    $('btn-sd').classList.toggle('is-on', q === 'sub');
    $('btn-hd').classList.toggle('is-on', q === 'main');
    start();
  }

  function init() {
    if (!C) { say('Kamera nije dostupna.', '', { noSpinner: true }); return; }
    $('cam-name').textContent = C.name || C.ip || 'Kamera';
    $('cam-sub').textContent = [C.location, C.recorder && `snimač ${C.recorder}`, C.ip].filter(Boolean).join(' · ');
    if (C.id) $('btn-platform').href = `/?camera=${encodeURIComponent(C.id)}`;
    if (C.title) document.title = `${C.name || 'Kamera'} | UNIPROMET`;

    if (!C.ok) {
      say(C.message || 'Nemate dozvolu da gledate ovu kameru.', C.hint || '', { noSpinner: true });
      ['btn-sd', 'btn-hd', 'btn-full'].forEach(id => $(id).classList.add('hidden'));
      $('btn-platform').classList.add('hidden');
      return;
    }
    if (!C.live) {
      say('Imate pravo samo na snimke ove kamere.', 'Snimci se gledaju u platformi.', { noSpinner: true });
      ['btn-sd', 'btn-hd', 'btn-full'].forEach(id => $(id).classList.add('hidden'));
      return;
    }

    $('btn-sd').addEventListener('click', () => setQuality('sub'));
    $('btn-hd').addEventListener('click', () => setQuality('main'));
    $('btn-retry').addEventListener('click', () => start(false));
    const full = () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    };
    $('btn-full').addEventListener('click', full);
    document.addEventListener('keydown', (e) => { if (e.key === 'f' || e.key === 'F') full(); });

    // Traka nestaje kad se miš ne pomera
    let hideTimer = 0;
    const bar = $('bar');
    const showBar = () => { bar.classList.remove('is-hidden'); clearTimeout(hideTimer); hideTimer = setTimeout(() => bar.classList.add('is-hidden'), 4000); };
    document.addEventListener('mousemove', showBar);
    document.addEventListener('touchstart', showBar, { passive: true });
    showBar();

    start(false);
  }

  window.addEventListener('beforeunload', stopStream);
  init();
})();
