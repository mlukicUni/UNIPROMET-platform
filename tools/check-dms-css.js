#!/usr/bin/env node
/**
 * Provera da DMS sekcija koristi isključivo platformski CSS.
 *
 *   node tools/check-dms-css.js                 (svi DMS fajlovi)
 *   node tools/check-dms-css.js views-podaci    (samo fajlovi čije ime sadrži ovaj tekst)
 *
 * 1) ZABRANJENO: pomoćne klase u Tailwind stilu (flex, gap-2, px-3, text-xs, bg-slate-100, ...) bilo gde u string-ovima.
 * 2) NEDEFINISANO: klase iz class="..." / className / classList koje ne postoje ni u jednom CSS fajlu platforme.
 *    Klase koje služe samo kao oznaka za JavaScript (querySelector) upisuju se u tools/dms-hooks/*.txt.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const filter = process.argv[2] || '';

/* ---------- Definisane klase ---------- */
const defined = new Set();
const walk = (dir, out) => {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, out);
    else if (f.name.endsWith('.css')) out.push(p);
  }
  return out;
};
for (const file of walk(path.join(ROOT, 'public', 'css'), [])) {
  const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) defined.add(m[1]);
}
// Klase koje služe samo kao oznaka za JavaScript ili postoje samo u HTML-u platforme: tools/dms-hooks/*.txt (jedna po liniji)
const hooksDir = path.join(__dirname, 'dms-hooks');
if (fs.existsSync(hooksDir)) {
  for (const f of fs.readdirSync(hooksDir)) {
    if (f.endsWith('.txt')) fs.readFileSync(path.join(hooksDir, f), 'utf8').split(/\s+/).filter(Boolean).forEach(t => defined.add(t));
  }
}

/* ---------- Zabranjeni obrasci (Tailwind) ---------- */
const COLORS = '(?:white|black|slate|gray|zinc|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|transparent|current)';
const FORBIDDEN = [
  /^-?(?:p|m)[xytrbl]?-(?:\d|px$|auto$|\[)/,
  /^(?:gap|gap-x|gap-y|space-x|space-y)-/,
  /^(?:w|h|min-w|min-h|max-w|max-h|top|left|right|bottom|inset|inset-x|inset-y|z)-(?:\d|px$|full$|screen$|auto$|fit$|min$|max$|\[|xs$|sm$|md$|lg$|xl$|\dxl$|none$|\d+\/\d+$)/,
  /^text-(?:xs|sm|base|lg|xl|\dxl|left|center|right|justify|\[)/,
  new RegExp('^(?:text|bg|border|ring|from|to|via|divide|accent|placeholder|shadow|fill|stroke|outline)-' + COLORS + '(?:-\\d+)?(?:/\\d+)?$'),
  /^border-(?:[trblxy]|\d)(?:-\d+)?$/,
  /^font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black|mono|sans)$/,
  /^(?:flex|inline-flex|grid|inline-grid|block|inline-block|inline|table|contents|flex-col|flex-row|flex-wrap|flex-nowrap|flex-1|flex-auto|flex-none|grow|grow-0|shrink|shrink-0)$/,
  /^(?:items|justify|self|content|place)-(?:start|center|end|between|around|evenly|stretch|baseline)$/,
  /^rounded(?:-(?:none|sm|md|lg|xl|2xl|3xl|full|[trbl]|[trbl]-\w+))?$/,
  /^shadow(?:-(?:2xs|xs|sm|md|lg|xl|2xl|none|inner))?$/,
  /^border$/,
  /^(?:uppercase|lowercase|capitalize|italic|not-italic|underline|no-underline|line-through|truncate|sr-only|select-none|select-all|outline-none|resize|resize-none|resize-y|visible|invisible|relative|absolute|fixed|sticky|static|hidden)$/,
  /^(?:whitespace|break|overflow|cursor|pointer-events|transition|duration|ease|opacity|tracking|leading|animate|list|order|align|backdrop|grid-cols|grid-rows|col-span|row-span|scroll-mt|object|divide|ring|decoration|underline-offset|table|border-collapse|border-separate|border-dashed|border-solid)(?:-[\w\[\]./%-]+)?$/,
  /^(?:hover|focus|active|disabled|group-hover|sm|md|lg|xl|print|placeholder|first|last|odd|even):/
];

const sources = [];
const addDir = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) sources.push(path.join(dir, f));
};
addDir(path.join(ROOT, 'public', 'js', 'dms'));
sources.push(path.join(ROOT, 'public', 'js', 'dmsModule.js'));
const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const dmsHtml = [...indexHtml.matchAll(/<!-- DMS-BEGIN[\s\S]*?<!-- DMS-END[^>]*-->/g)].map(m => m[0]).join('\n');

// dmsModule.js sadrži mapu naziva ikona (ne klase), pa se u njemu proverava samo ono što nije ta mapa
const picked = sources.filter(f => path.basename(f).includes(filter));
const units = picked.map(f => ({ name: path.relative(ROOT, f), text: fs.readFileSync(f, 'utf8') }));
if (!filter || 'index'.includes(filter) || 'html'.includes(filter)) units.push({ name: 'public/index.html (DMS delovi)', text: dmsHtml });

const isForbidden = (t) => FORBIDDEN.some(re => re.test(t));
let totalBad = 0, totalUndef = 0;

for (const u of units) {
  if (u.name.endsWith('dmsModule.js')) {
    const a = u.text.indexOf('const DMS_ICON_MAP');
    const b = u.text.indexOf('\n};', a);
    if (a >= 0 && b > a) u.text = u.text.slice(0, a) + u.text.slice(b + 3);
  }
  const forbidden = new Map();
  const undef = new Map();
  const note = (map, t, line) => { if (!map.has(t)) map.set(t, line); };
  const lineOf = (idx) => u.text.slice(0, idx).split('\n').length;

  // 1a) Klasni konteksti: class="..." / className = ... / classList.add|remove|toggle|contains('...')
  const re = /class(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)|classList\.(?:add|remove|toggle|contains)\(([^)]*)\)/g;
  for (const m of u.text.matchAll(re)) {
    let str = m[1] ?? m[2] ?? m[3];
    // classList argumenti: samo stringovi pod navodnicima (ne i promenljive)
    if (str === undefined) {
      // Samo vodeći argumenti koji su čisti stringovi (npr. toggle('x', uslov) -> samo 'x')
      const parts = [];
      for (const piece of m[4].split(',')) {
        const q = piece.trim().match(/^(['"`])([^'"`]*)\1$/);
        if (!q) break;
        parts.push(q[2]);
      }
      str = parts.join(' ');
    }
    str = str.replace(/\$\{[^}]*\}/g, ' ');
    for (const t of str.split(/[\s,'"`]+/)) {
      if (!t || !/^[a-z_!\-\[][^\s]*$/i.test(t)) continue;
      if (/^fa-/.test(t)) continue;
      if (isForbidden(t)) { note(forbidden, t, lineOf(m.index)); continue; }
      if (/^[a-z_][\w-]*$/i.test(t) && !defined.has(t)) note(undef, t, lineOf(m.index));
    }
  }
  // 1b) Ostali string literali koji izgledaju kao liste klasa (npr. const BASE = 'px-3 py-2 ...')
  for (const m of u.text.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*?)\1/g)) {
    const toks = m[2].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean);
    if (toks.length < 2 || !toks.every(t => /^[a-z0-9!:\[\]\/_.%-]+$/i.test(t))) continue;
    for (const t of toks) if (isForbidden(t)) note(forbidden, t, lineOf(m.index));
  }
  if (forbidden.size || undef.size) {
    console.log(`\n== ${u.name}`);
    if (forbidden.size) console.log(`  ZABRANJENO (${forbidden.size}): ` + [...forbidden].slice(0, 80).map(([t, l]) => `${t}@${l}`).join('  '));
    if (undef.size) console.log(`  NEDEFINISANO (${undef.size}): ` + [...undef].slice(0, 80).map(([t, l]) => `${t}@${l}`).join('  '));
  }
  totalBad += forbidden.size;
  totalUndef += undef.size;
}
console.log(`\nUkupno: zabranjenih klasa ${totalBad}, nedefinisanih ${totalUndef}`);
process.exit(totalBad || totalUndef ? 1 : 0);
