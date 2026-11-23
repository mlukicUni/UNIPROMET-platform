/**
 * ==========================================================================
 * UNIPROMET - PRETRAGA KOJA UKLJUČUJE I SPOLJNE PODATKE (npr. zaposleni iz Navision-a)
 * Isto pravilo kao src/utils/searchMatch.ts: svaka reč upita mora biti u bar jednom polju.
 * Razlika: za svaku reč može se dodati i lista ključeva (npr. kadrovskih brojeva ili telefona)
 * koje je ta reč pogodila u spoljnom izvoru, pa reč važi i ako je zapis vezan za taj ključ.
 * Primer: "marko laptop" → "laptop" pogađa kategoriju, "marko" pogađa zaduženog zaposlenog.
 * ==========================================================================
 */
import { normSearchText } from './searchMatch';

export interface SearchWord {
  /** reč kako je korisnik uneo (za spoljne baze, npr. Navision MSSQL) */
  raw: string;
  /** normalizovana reč (za unorm() / matchesSearch) */
  norm: string;
}

/** Reči upita - originalni i normalizovani oblik, istim redom */
export function searchWords(query: unknown): SearchWord[] {
  if (query === null || query === undefined) return [];
  return String(query)
    .trim()
    .split(/\s+/)
    .map(raw => ({ raw, norm: normSearchText(raw) }))
    .filter(w => w.raw && w.norm);
}

/**
 * Za svaku reč upita poziva spoljnu pretragu, redom (greška ili prazno = nema ključeva za tu reč).
 * Redom, a ne paralelno, da se ne otvara više istovremenih upita / punjenja keša ka Navision-u.
 */
export async function keysPerSearchWord(
  query: unknown,
  lookup: (rawWord: string) => Promise<string[]>
): Promise<string[][]> {
  const result: string[][] = [];
  for (const w of searchWords(query)) {
    try {
      result.push(((await lookup(w.raw)) || []).filter(Boolean));
    } catch {
      result.push([]);
    }
  }
  return result;
}

/**
 * SQLite uslov: svaka reč mora biti u bar jednoj koloni (preko unorm()) ILI keyColumn mora biti
 * među ključevima koje je ta reč pogodila (keysPerWord[i], isti redosled kao searchWords()).
 * Vraća null za prazan upit.
 */
export function sqlSearchWithKeys(
  columns: string[],
  query: unknown,
  keyColumn: string,
  keysPerWord?: (string[] | null | undefined)[] | null,
  prefix = 'srch'
): { where: string; params: Record<string, string> } | null {
  const words = searchWords(query);
  if (words.length === 0 || columns.length === 0) return null;
  const params: Record<string, string> = {};
  const parts = words.map((w, i) => {
    const name = `${prefix}${i}`;
    params[name] = `%${w.norm.replace(/[\\%_]/g, ch => '\\' + ch)}%`;
    const textCond = columns.map(c => `unorm(${c}) LIKE @${name} ESCAPE '\\'`).join(' OR ');
    const keys = Array.from(new Set((keysPerWord?.[i] || []).filter(Boolean).map(k => String(k))));
    const keyCond = keys.length > 0
      ? ` OR ${keyColumn} IN (${keys.map(k => `'${k.replace(/'/g, "''")}'`).join(',')})`
      : '';
    return `(${textCond}${keyCond})`;
  });
  return { where: '(' + parts.join(' AND ') + ')', params };
}
