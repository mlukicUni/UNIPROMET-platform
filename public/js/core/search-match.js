/**
 * ==========================================================================
 * UNIPROMET - ZAJEDNIČKO PRAVILO PRETRAGE (ekran)
 * Upit se deli na reči; zapis odgovara ako se SVAKA reč nalazi negde u njemu
 * (u bilo kom polju, bilo kojim redom). „odrzavanje analog“ nalazi sve analogne
 * kamere na Održavanju.
 * Velika/mala slova i kvačice se ne razlikuju: č ć → c, š → s, ž → z, đ/dj → d.
 * Isto pravilo na serveru: src/utils/searchMatch.ts (mora ostati usklađeno).
 *
 *   UniSearch.match(upit, polje1, polje2, ...)  -> true/false (prazan upit = true)
 *   UniSearch.norm(tekst)                         -> normalizovan tekst
 *   UniSearch.tokens(upit)                        -> reči upita (normalizovane)
 * ==========================================================================
 */
(function () {
  function norm(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .toLowerCase()
      .replace(/[đð]/g, 'd') // ð: u podacima ponekad „Ð“ (eth) umesto „Đ“
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/dj/g, 'd');
  }

  function tokens(query) {
    return norm(query).split(/\s+/).filter(Boolean);
  }

  function flatten(values, out) {
    for (const v of values) {
      if (Array.isArray(v)) flatten(v, out);
      else if (v !== null && v !== undefined && typeof v !== 'object') out.push(String(v));
    }
    return out;
  }

  /** Da li zapis (sva prosleđena polja zajedno) sadrži svaku reč upita */
  function match(query, ...values) {
    const words = tokens(query);
    if (words.length === 0) return true;
    const haystack = norm(flatten(values, []).join(' \u0001 '));
    return words.every(w => haystack.includes(w));
  }

  window.UniSearch = { norm, tokens, match };
})();
