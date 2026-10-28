/**
 * Jedno pravilo za veličinu štampača (zaštita mrežnih kartica malih štampača).
 *
 * - Veliki Canon kopir aparati (imageRUNNER / C5235 / 2520 / "iR") imaju Deep Sleep,
 *   pa smeju da dobiju WOL i proveru porta 80.
 * - Sve ostalo (Canon LBP 6780x / 312x i svaki nepoznat model) tretira se kao mali štampač:
 *   samo ping i ARP, bez TCP konekcija i bez buđenja.
 */
export function isLargeCopier(p: { name?: string | null; model?: string | null } | null | undefined): boolean {
  if (!p) return false;
  const text = `${p.name || ''} ${p.model || ''}`;
  return /imagerunner|c5235|2520|\bir\b/i.test(text);
}
