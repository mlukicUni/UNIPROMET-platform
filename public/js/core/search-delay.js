/**
 * ==========================================================================
 * UNIPROMET - ODLOŽENA PRETRAGA (važi za sva polja za pretragu na platformi)
 * Pretraga ne kreće na svaki otkucani znak, nego tek kad korisnik prestane da
 * kuca SEARCH_DELAY_MS. Enter pokreće pretragu odmah, a brisanje celog polja
 * odmah vraća pun spisak.
 *
 * Radi centralno: zadržava događaj `input` pre nego što stigne do postojećih
 * rukovalaca, pa ga ponovo pošalje posle pauze. Postojeći kod pretraga se ne
 * menja, a važi i za polja koja se naprave kasnije (DMS, modali).
 * Polje koje mora da reaguje odmah dobija atribut data-search-instant.
 * Isto ovde: polje za pretragu bez svog ✕ dobija ✕ za poništavanje (dole).
 * ==========================================================================
 */
(function () {
  const SEARCH_DELAY_MS = 800;

  /** Polja za pretragu: po tipu, klasi, ID-ju ili tekstu „Pretraži…“ */
  const SEARCH_SELECTOR = [
    'input[type="search"]',
    'input.printer-search-input',
    'input[class*="search-input"]',
    'input[class*="-search"]',
    'input[id*="search" i]',
    'input[id$="-q"]',
    'input[placeholder^="Pretra"]',
    'input[placeholder^="pretra"]'
  ].join(',');

  const timers = new WeakMap();

  function isSearchField(el) {
    if (!el || el.tagName !== 'INPUT' || el.hasAttribute('data-search-instant')) return false;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (type !== 'text' && type !== 'search') return false;
    return el.matches(SEARCH_SELECTOR);
  }

  function fire(el) {
    timers.delete(el);
    const ev = new Event('input', { bubbles: true });
    ev.__searchDelayed = true;
    el.dispatchEvent(ev);
  }

  function flush(el) {
    const t = timers.get(el);
    if (t === undefined) return;
    clearTimeout(t);
    fire(el);
  }

  // Capture na window-u: prvi u lancu, pre svih rukovalaca na polju i njegovim roditeljima
  window.addEventListener('input', (e) => {
    const el = e.target;
    if (e.__searchDelayed || !isSearchField(el)) return;
    e.stopImmediatePropagation();
    if (managed.has(el)) update(el); // ✕ se pojavi/nestane odmah, ne posle pauze

    const prev = timers.get(el);
    if (prev !== undefined) clearTimeout(prev);

    // Obrisano polje: pun spisak odmah
    if (el.value === '') {
      fire(el);
      return;
    }
    timers.set(el, setTimeout(() => fire(el), SEARCH_DELAY_MS));
  }, true);

  // Enter: pretraga odmah, bez čekanja
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && isSearchField(e.target)) flush(e.target);
  }, true);

  /* ------------------------------------------------------------------------
     ✕ ZA PONIŠTAVANJE: svako polje za pretragu koje nema svoje dugme dobija ga
     automatski. Ne menja raspored: dugme se postavlja preko desnog kraja polja
     i vidi se samo dok u polju ima teksta. Klik briše polje i odmah vraća spisak.
     ------------------------------------------------------------------------ */
  const OWN_CLEAR = '.btn-clear-search, .clear-search-btn';
  const managed = new Set();

  const style = document.createElement('style');
  style.textContent = `
    .uni-search-clear { position: absolute; transform: none; display: none; align-items: center; justify-content: center;
      width: 22px; height: 22px; padding: 0; border: none; border-radius: 50%; background: rgba(255,255,255,0.08);
      color: #94a3b8; font-size: 16px; line-height: 1; cursor: pointer; z-index: 5; }
    .uni-search-clear:hover { color: #ef4444; background: rgba(239,68,68,0.12); }
    input.uni-search-has-clear::-webkit-search-cancel-button { -webkit-appearance: none; display: none; }`;
  document.head.appendChild(style);

  function attachClear(el) {
    if (managed.has(el) || el.__uniClearChecked) return;
    el.__uniClearChecked = true;
    const parent = el.parentElement;
    if (!parent || [...parent.children].some(c => c.matches(OWN_CLEAR))) return; // već ima svoje ✕

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'uni-search-clear';
    btn.title = 'Poništi pretragu';
    btn.setAttribute('aria-label', 'Poništi pretragu');
    btn.innerHTML = '&times;';
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // fokus ostaje u polju
    btn.addEventListener('click', () => {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true })); // prazno polje: pretraga odmah
      el.focus();
      update(el);
    });
    el.insertAdjacentElement('afterend', btn);
    el.__uniClearBtn = btn;
    el.classList.add('uni-search-has-clear');
    // Mesto za ✕ da tekst ne ide ispod njega
    if (parseFloat(getComputedStyle(el).paddingRight) < 30) el.style.paddingRight = '30px';
    managed.add(el);
  }

  /** Prikazuje ✕ samo dok polje ima tekst i vidi se; postavlja ga uz desnu ivicu polja */
  function update(el) {
    const btn = el.__uniClearBtn;
    if (!btn) return;
    const show = el.value !== '' && el.offsetParent !== null && !el.disabled && !el.readOnly;
    if (!show) {
      btn.style.display = 'none';
      return;
    }
    btn.style.display = 'flex';
    const r = el.getBoundingClientRect();
    const size = Math.max(14, Math.min(22, r.height - 4));
    btn.style.width = btn.style.height = `${size}px`;
    // Koordinate u odnosu na blok po kome se dugme pozicionira (najbliži pozicionirani roditelj ili sama stranica)
    const cb = btn.offsetParent;
    let left = r.right - size - 6, top = r.top + (r.height - size) / 2;
    if (cb && getComputedStyle(cb).position !== 'static') {
      const c = cb.getBoundingClientRect();
      left += cb.scrollLeft - c.left - cb.clientLeft;
      top += cb.scrollTop - c.top - cb.clientTop;
    } else {
      left += window.scrollX;
      top += window.scrollY;
    }
    btn.style.left = `${left}px`;
    btn.style.top = `${top}px`;
    btn.style.right = 'auto';
  }

  // Polja se prave i kasnije (modali, DMS), a vrednost se menja i iz koda - kratka periodična provera
  function scan() {
    document.querySelectorAll('input').forEach(el => { if (isSearchField(el)) attachClear(el); });
    managed.forEach(el => {
      if (!el.isConnected) { managed.delete(el); return; }
      update(el);
    });
  }
  window.addEventListener('resize', () => managed.forEach(update));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan, { once: true });
  else scan();
  setInterval(scan, 500);

  window.UniSearchDelay = { SEARCH_DELAY_MS, isSearchField, flush };
})();
