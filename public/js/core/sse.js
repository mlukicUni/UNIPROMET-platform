/**
 * ==========================================================================
 * UNIPROMET - JEDNA SSE VEZA ZA SVE MODULE
 *
 * Moduli Oprema, MTS, Mrežna oprema i Čvorišta slušaju iste događaje (/api/equipment/events).
 * Ranije je svaki otvarao svoju vezu, a pregledač sme samo 6 istovremenih veza ka serveru (HTTP/1.1):
 * posle obilaska ove četiri stranice ostajale su samo 2 veze za sve ostalo (podaci, slike, skripte).
 * Sada postoji jedna veza, a moduli se samo prijave:  UniSSE.subscribe((messageEvent) => { ... })
 * Veza se otvara pri prvoj prijavi i sama se obnavlja posle prekida (3 s).
 * ==========================================================================
 */
(function () {
  const RECONNECT_MS = 3000;
  const listeners = new Set();
  let source = null;
  let reconnectTimer = null;

  function connect() {
    if (source || !window.EventSource) return;
    try {
      source = new EventSource('/api/equipment/events');
      source.onmessage = (event) => {
        listeners.forEach((fn) => {
          try { fn(event); } catch (e) { /* greška jednog modula ne sme da zaustavi ostale */ }
        });
      };
      source.onerror = () => {
        try { source.close(); } catch (e) {}
        source = null;
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, RECONNECT_MS);
      };
    } catch (err) {
      source = null;
    }
  }

  window.UniSSE = {
    /** Prijava na događaje; vraća funkciju za odjavu */
    subscribe(fn) {
      listeners.add(fn);
      connect();
      return () => listeners.delete(fn);
    }
  };
})();
