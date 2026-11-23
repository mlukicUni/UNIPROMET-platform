/**
 * ==========================================================================
 * UNIPROMET - ZAJEDNIČKO PRAVILO PRETRAGE (server)
 * Upit se deli na reči; zapis odgovara ako se SVAKA reč nalazi u bar jednom polju
 * (bilo kojim redom). Velika/mala slova i kvačice se ne razlikuju: č ć → c, š → s, ž → z, đ/dj → d.
 * Isto pravilo na ekranu: public/js/core/search-match.js (mora ostati usklađeno).
 * ==========================================================================
 */

/** Normalizovan tekst za poređenje (registrovan i u SQLite kao funkcija unorm()) */
export function normSearchText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .toLowerCase()
    .replace(/[đð]/g, 'd') // ð: u podacima ponekad „Ð“ (eth) umesto „Đ“
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/dj/g, 'd');
}

/** Reči upita (normalizovane, bez praznih) */
export function searchTokens(query: unknown): string[] {
  return normSearchText(query).split(/\s+/).filter(Boolean);
}

/** Da li zapis (sva polja zajedno) sadrži svaku reč upita; prazan upit = true */
export function matchesSearch(query: unknown, ...values: unknown[]): boolean {
  const words = searchTokens(query);
  if (words.length === 0) return true;
  const haystack = normSearchText(
    values.flat(Infinity as 1).filter(v => v !== null && v !== undefined && typeof v !== 'object').join(' \u0001 ')
  );
  return words.every(w => haystack.includes(w));
}

/**
 * SQL uslov za SQLite (better-sqlite3): svaka reč mora biti u bar jednoj koloni.
 *   const s = sqlSearch(['c.name', 'c.ip'], search);
 *   if (s) { conditions.push(s.where); Object.assign(params, s.params); }
 * Kolone se porede preko unorm() (registrovano u src/db/sqlite.ts), pa važe ista pravila kao gore.
 * Vraća null za prazan upit. `prefix` razlikuje parametre kad ih ima više u istom upitu.
 */
export function sqlSearch(columns: string[], query: unknown, prefix = 'srch'): { where: string; params: Record<string, string> } | null {
  const words = searchTokens(query);
  if (words.length === 0 || columns.length === 0) return null;
  const params: Record<string, string> = {};
  const parts = words.map((w, i) => {
    const name = `${prefix}${i}`;
    params[name] = `%${w.replace(/[\\%_]/g, ch => '\\' + ch)}%`;
    return '(' + columns.map(c => `unorm(${c}) LIKE @${name} ESCAPE '\\'`).join(' OR ') + ')';
  });
  return { where: '(' + parts.join(' AND ') + ')', params };
}
