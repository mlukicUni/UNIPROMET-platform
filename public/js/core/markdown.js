/**
 * ==========================================================================
 * UNIPROMET IT ADMIN - MARKDOWN PRIKAZ
 * Bezbedan prikaz Markdown teksta: sve se prvo escape-uje, HTML iz teksta se
 * nikad ne izvršava. Podržano: naslovi, pasusi, liste, kontrolne liste
 * (- [ ] / - [x]), tabele, napomene (> ...), blokovi koda, linija (---),
 * podebljano, kurziv, `kod` i linkovi (samo http/https).
 * Koriste ga AI agent (odgovori) i NOLEKO dokumenti (AI razvojni plan).
 * ==========================================================================
 */
(function () {
  'use strict';

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const DIACRITICS = { č: 'c', ć: 'c', ž: 'z', š: 's', đ: 'dj' };

  function slug(text) {
    return String(text)
      .toLowerCase()
      .replace(/[čćžšđ]/g, ch => DIACRITICS[ch])
      .replace(/&[a-z#0-9]+;/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'odeljak';
  }

  /** Formatiranje u redu teksta (ulaz je već escape-ovan) */
  function inline(text) {
    // `kod` se izdvaja da bi se unutar njega izbeglo ostalo formatiranje
    const codes = [];
    let out = text.replace(/`([^`\n]+)`/g, (_, c) => {
      codes.push(c);
      return `\u0000${codes.length - 1}\u0000`;
    });
    out = out
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  }

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map(c => c.trim());
  }

  const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

  /**
   * @param {string} src Markdown tekst
   * @param {{ headingIds?: boolean }} [opts] headingIds: naslovi dobijaju id (za sadržaj dokumenta)
   * @returns {{ html: string, toc: { level: number, id: string, text: string }[] }}
   */
  function render(src, opts) {
    const options = opts || {};
    const lines = esc(src).replace(/\r\n/g, '\n').split('\n');
    const out = [];
    const toc = [];
    const usedIds = new Set();
    let para = [];
    let list = null; // { type: 'ul'|'ol', task: boolean, items: [] }
    let quote = null; // [] redova

    const flushPara = () => {
      if (para.length) out.push(`<p>${inline(para.join('<br>'))}</p>`);
      para = [];
    };
    const flushList = () => {
      if (list) {
        const cls = list.task ? ' class="md-tasks"' : '';
        out.push(`<${list.type}${cls}>${list.items.join('')}</${list.type}>`);
      }
      list = null;
    };
    const flushQuote = () => {
      if (quote) out.push(`<blockquote>${quote.map(q => `<p>${inline(q)}</p>`).join('')}</blockquote>`);
      quote = null;
    };
    const flushAll = () => { flushPara(); flushList(); flushQuote(); };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Blok koda
      if (/^\s*```/.test(line)) {
        flushAll();
        const code = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
        out.push(`<pre><code>${code.join('\n')}</code></pre>`);
        continue;
      }

      // Tabela: red sa | i ispod njega red sa ---
      if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
        flushAll();
        const head = splitRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
        i--;
        out.push(
          '<div class="md-table-wrap"><table class="md-table"><thead><tr>' +
          head.map(h => `<th>${inline(h)}</th>`).join('') +
          '</tr></thead><tbody>' +
          rows.map(r => '<tr>' + head.map((_, c) => `<td>${inline(r[c] || '')}</td>`).join('') + '</tr>').join('') +
          '</tbody></table></div>'
        );
        continue;
      }

      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        flushAll();
        const level = h[1].length;
        const content = inline(h[2].trim());
        if (options.headingIds) {
          let id = slug(h[2]);
          while (usedIds.has(id)) id += '-1';
          usedIds.add(id);
          toc.push({ level, id, text: h[2].replace(/\*\*|`/g, '').replace(/&amp;/g, '&') });
          out.push(`<h${level} id="${id}">${content}</h${level}>`);
        } else {
          out.push(`<h${level}>${content}</h${level}>`);
        }
        continue;
      }

      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
        flushAll();
        out.push('<hr>');
        continue;
      }

      const q = line.match(/^&gt;\s?(.*)$/);
      if (q) {
        flushPara(); flushList();
        if (!quote) quote = [];
        quote.push(q[1]);
        continue;
      }

      const task = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
      const ul = !task && line.match(/^\s*[-*]\s+(.*)$/);
      const ol = !task && line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (task || ul || ol) {
        flushPara(); flushQuote();
        const type = ol ? 'ol' : 'ul';
        const isTask = !!task;
        if (!list || list.type !== type || list.task !== isTask) { flushList(); list = { type, task: isTask, items: [] }; }
        if (task) {
          const done = task[1].toLowerCase() === 'x';
          list.items.push(`<li class="${done ? 'done' : ''}"><span class="md-check${done ? ' checked' : ''}"></span><span>${inline(task[2])}</span></li>`);
        } else {
          list.items.push(`<li>${inline((ul || ol)[1])}</li>`);
        }
        continue;
      }

      if (!line.trim()) {
        flushAll();
        continue;
      }

      flushList(); flushQuote();
      para.push(line);
    }
    flushAll();
    return { html: out.join(''), toc };
  }

  window.UniMarkdown = { render, esc };
})();
