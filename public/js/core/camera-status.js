/**
 * ==========================================================================
 * UNIPROMET - DOSTUPNOST KAMERA NA EKRANU (zajedničko za sve prikaze kamera)
 * Svaki prikaz (Mreža → Kamere, Video nadzor, Monitoring, zaseban prozor) prijavi
 * koje kamere trenutno prikazuje. Server ih odmah proveri, a dok je prikaz otvoren
 * upit se ponavlja na 30 s. Kad tab pregledača nije u prvom planu, provera staje,
 * a po povratku se odmah ponavlja. Nema stalne provere u pozadini.
 *
 * Offline kamera se prikazuje poslednjom sačuvanom slikom (mesečnom) sa natpisom
 * „OFFLINE · od 10:42 · slika od 03.11.“ umesto snimka uživo.
 * ==========================================================================
 */
(function () {
  'use strict';

  const POLL_MS = 30000;
  const watchers = new Map(); // ključ -> { getIds, onUpdate }
  const statuses = new Map(); // id kamere -> { online, since, checkedAt, snapshotAt, ip }
  let timer = null;
  let busy = false;
  let again = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  /** „10:42“ za danas, inače „03.11. 10:42“ */
  function fmtSince(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const now = new Date();
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return d.toDateString() === now.toDateString() ? time : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}. ${time}`;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? '' : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear() !== new Date().getFullYear() ? d.getFullYear() + '.' : ''}`;
  }

  function lastSnapshotUrl(ip, snapshotAt) {
    return `/api/cameras/${encodeURIComponent(ip)}/last-snapshot?v=${encodeURIComponent(snapshotAt || '')}`;
  }

  /** Natpis preko poslednje slike offline kamere */
  function offlineLabel(st) {
    const parts = ['OFFLINE'];
    if (st && st.since) parts.push(`od ${fmtSince(st.since)}`);
    parts.push(st && st.snapshotAt ? `slika od ${fmtDate(st.snapshotAt)}` : 'nema sačuvane slike');
    return parts.join(' · ');
  }

  /**
   * HTML sloja za offline kameru: poslednja slika (ako postoji) i natpis.
   * Stavlja se u kontejner prikaza (position: relative), preko videa.
   */
  function offlineLayerHtml(ip, st) {
    const img = st && st.snapshotAt
      ? `<img class="cam-off-img" src="${esc(lastSnapshotUrl(ip, st.snapshotAt))}" alt="" loading="lazy" draggable="false" onerror="this.remove()">`
      : '<div class="cam-off-empty"></div>';
    return `<div class="cam-off-layer">${img}<span class="cam-off-label"><span class="cam-off-dot"></span>${esc(offlineLabel(st))}</span></div>`;
  }

  function isVisible() {
    return document.visibilityState !== 'hidden';
  }

  async function tick() {
    if (busy) { again = true; return; }
    if (!watchers.size || !isVisible()) return;
    const ids = new Set();
    watchers.forEach(w => {
      try { (w.getIds() || []).forEach(id => { if (id) ids.add(String(id)); }); } catch (e) { /* ignorisano */ }
    });
    if (!ids.size) return;
    busy = true;
    try {
      const list = [...ids];
      // Server prima najviše 120 kamera po upitu
      for (let i = 0; i < list.length; i += 120) {
        const res = await fetch('/api/cameras/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ ids: list.slice(i, i + 120) })
        });
        if (!res.ok) continue;
        const data = await res.json();
        (data.statuses || []).forEach(s => statuses.set(String(s.id), s));
      }
      watchers.forEach(w => {
        try { w.onUpdate(statuses); } catch (e) { console.warn('CameraStatus onUpdate:', e); }
      });
    } catch (e) {
      // mreža/server privremeno nedostupni: sledeći krug pokušava ponovo
    } finally {
      busy = false;
      if (again) { again = false; tick(); }
    }
  }

  function ensureTimer() {
    if (watchers.size && !timer) timer = setInterval(tick, POLL_MS);
    if (!watchers.size && timer) { clearInterval(timer); timer = null; }
  }

  /**
   * Prijava prikaza: getIds() vraća id-jeve kamera na ekranu, onUpdate(statuses) dobija mapu id -> status.
   * Ponovna prijava pod istim ključem (npr. posle promene strane) odmah pokreće proveru.
   */
  function watch(key, getIds, onUpdate) {
    watchers.set(key, { getIds, onUpdate });
    ensureTimer();
    tick();
  }

  function unwatch(key) {
    watchers.delete(key);
    ensureTimer();
  }

  document.addEventListener('visibilitychange', () => { if (isVisible()) tick(); });

  window.CameraStatus = {
    watch,
    unwatch,
    refresh: tick,
    get: (id) => statuses.get(String(id)),
    fmtSince,
    fmtDate,
    offlineLabel,
    offlineLayerHtml,
    lastSnapshotUrl
  };
})();
