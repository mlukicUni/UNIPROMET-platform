/**
 * ==========================================================================
 * UNIPROMET IT ADMIN - NOLEKO AI: AI RAZVOJNI PLAN
 * Prikaz plana (Markdown iz baze) sa sadržajem odeljaka, uređivač sa
 * pregledom uživo, istorija verzija i vraćanje stare verzije.
 * ==========================================================================
 */
(function () {
  'use strict';

  const API = '/api/noleko/docs/razvojni_plan';
  const MD = window.UniMarkdown;
  if (!MD) return;

  const S = {
    initialized: false,
    doc: null,          // važeća verzija { version, content, editedBy, editedByName, editedAt, note }
    viewing: null,      // stara verzija koja se pregleda (ili null)
    versions: [],
    showHistory: false,
    editing: false,
    editBase: 0,
    editOriginal: '',
    saving: false,
    previewTimer: null,
    tocObserver: null
  };

  /* ==========================================================================
     POMOĆNE FUNKCIJE
     ========================================================================== */
  const $ = (id) => document.getElementById(id);
  const esc = MD.esc;

  function notify(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }

  async function api(url, method, body) {
    const res = await fetch(url, {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* nije JSON */ }
    if (!res.ok || (data && data.success === false)) {
      throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
    }
    return data || {};
  }

  function formatDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('sr-Latn-RS', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function who(v) {
    return v.editedByName || v.editedBy || 'nepoznat';
  }

  function canEdit() {
    return !window.UniAccess || window.UniAccess.canEdit('ai_dev_plan');
  }

  function isDirty() {
    return S.editing && $('plan-editor-input').value !== S.editOriginal;
  }

  /* ==========================================================================
     PRIKAZ
     ========================================================================== */
  function renderMeta() {
    const meta = $('plan-meta');
    if (!meta || !S.doc) return;
    meta.textContent = `Verzija ${S.doc.version} · poslednja izmena: ${who(S.doc)}, ${formatDate(S.doc.editedAt)}`;
  }

  function renderToc(toc) {
    const host = $('plan-toc');
    host.innerHTML = toc
      .filter(t => t.level === 2 || t.level === 3)
      .map(t => `<a href="#" data-target="${esc(t.id)}" class="lvl-${t.level}">${esc(t.text)}</a>`)
      .join('') || '<div class="ai-conv-empty">Dokument nema naslove odeljaka.</div>';
  }

  /** Označava odeljak koji se trenutno čita */
  function watchSections() {
    if (S.tocObserver) S.tocObserver.disconnect();
    const docEl = $('plan-doc');
    const heads = docEl.querySelectorAll('h2[id], h3[id]');
    if (!heads.length || !('IntersectionObserver' in window)) return;
    S.tocObserver = new IntersectionObserver((entries) => {
      const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!visible) return;
      document.querySelectorAll('#plan-toc a').forEach(a => {
        a.classList.toggle('active', a.getAttribute('data-target') === visible.target.id);
      });
    }, { root: docEl, rootMargin: '0px 0px -70% 0px' });
    heads.forEach(h => S.tocObserver.observe(h));
  }

  function renderDocument() {
    const shown = S.viewing || S.doc;
    const docEl = $('plan-doc');
    if (!shown) return;
    const { html, toc } = MD.render(shown.content, { headingIds: true });
    docEl.innerHTML = html;
    renderToc(toc);
    watchSections();

    const banner = $('plan-banner');
    if (S.viewing) {
      $('plan-banner-text').textContent =
        `Pregledate verziju ${S.viewing.version} od ${formatDate(S.viewing.editedAt)} (${who(S.viewing)}). Važeća je verzija ${S.doc.version}.`;
      banner.style.display = '';
      $('plan-btn-restore').style.display = canEdit() ? '' : 'none';
    } else {
      banner.style.display = 'none';
    }
  }

  function renderHistory() {
    const host = $('plan-history');
    const shownVersion = (S.viewing || S.doc || {}).version;
    host.innerHTML = S.versions.map(v => `
      <button type="button" class="plan-history-item${v.version === shownVersion ? ' active' : ''}" data-version="${v.version}">
        <span class="v">Verzija ${v.version}${S.doc && v.version === S.doc.version ? '<em>važeća</em>' : ''}</span>
        <span class="who">${esc(who(v))} · ${esc(formatDate(v.editedAt))}</span>
        ${v.note ? `<span class="note">${esc(v.note)}</span>` : ''}
      </button>`).join('');
  }

  function setSidePanel(history) {
    S.showHistory = history;
    $('plan-toc').style.display = history ? 'none' : '';
    $('plan-history').style.display = history ? '' : 'none';
    $('plan-side-title').textContent = history ? 'Istorija verzija' : 'Sadržaj';
    $('plan-btn-history').classList.toggle('active', history);
  }

  async function loadHistory() {
    try {
      const data = await api(`${API}/versions`);
      S.versions = data.versions || [];
      renderHistory();
    } catch (err) {
      $('plan-history').innerHTML = `<div class="ai-conv-empty">Greška: ${esc(err.message)}</div>`;
    }
  }

  function toggleHistory() {
    if (S.showHistory) {
      setSidePanel(false);
      return;
    }
    setSidePanel(true);
    $('plan-history').innerHTML = '<div class="ai-conv-empty">Učitavanje...</div>';
    loadHistory();
  }

  async function viewVersion(version) {
    if (S.doc && version === S.doc.version) {
      S.viewing = null;
    } else {
      try {
        const data = await api(`${API}/versions/${version}`);
        S.viewing = data.document;
      } catch (err) {
        notify(`Verzija nije učitana: ${err.message}`, 'error');
        return;
      }
    }
    renderDocument();
    renderHistory();
    $('plan-doc').scrollTop = 0;
  }

  async function load() {
    try {
      const data = await api(API);
      S.doc = data.document;
      renderMeta();
      renderDocument();
      if (S.showHistory) loadHistory();
    } catch (err) {
      $('plan-doc').innerHTML = `<div class="ai-conv-empty">Plan nije učitan: ${esc(err.message)}</div>`;
      $('plan-meta').textContent = 'Greška pri učitavanju';
    }
  }

  /* ==========================================================================
     IZMENA
     ========================================================================== */
  function setMode(editing) {
    S.editing = editing;
    $('plan-view').style.display = editing ? 'none' : '';
    $('plan-editor').style.display = editing ? '' : 'none';
    $('plan-tools-view').style.display = editing ? 'none' : '';
    $('plan-tools-edit').style.display = editing ? '' : 'none';
    if (editing) $('plan-banner').style.display = 'none';
    else renderDocument();
  }

  function renderPreview() {
    $('plan-editor-preview').innerHTML = MD.render($('plan-editor-input').value).html;
  }

  /** Izmena kreće od važeće verzije ili od stare verzije koja se vraća */
  function startEdit(fromVersion) {
    if (!S.doc || !canEdit()) return;
    const source = fromVersion || S.doc;
    S.editBase = S.doc.version;
    S.editOriginal = S.doc.content;
    const input = $('plan-editor-input');
    input.value = source.content;
    $('plan-note').value = fromVersion ? `Vraćena verzija ${fromVersion.version}` : '';
    S.viewing = null;
    setMode(true);
    renderPreview();
    input.focus();
    input.setSelectionRange(0, 0);
    input.scrollTop = 0;
  }

  function cancelEdit() {
    if (isDirty() && !window.confirm('Odbaciti nesačuvane izmene plana?')) return;
    setMode(false);
  }

  async function save() {
    if (S.saving || !S.editing) return;
    const content = $('plan-editor-input').value;
    if (content === S.editOriginal) {
      notify('Nema izmena za čuvanje.', 'info');
      return;
    }
    S.saving = true;
    $('plan-btn-save').disabled = true;
    try {
      const data = await api(API, 'PUT', { content, baseVersion: S.editBase, note: $('plan-note').value });
      S.doc = data.document;
      notify(`Plan je sačuvan (verzija ${S.doc.version}).`, 'success');
      renderMeta();
      setMode(false);
      if (S.showHistory) loadHistory();
    } catch (err) {
      notify(`Čuvanje nije uspelo: ${err.message}`, 'error');
    } finally {
      S.saving = false;
      $('plan-btn-save').disabled = false;
    }
  }

  /* ---- Traka za formatiranje ---- */
  function replaceSelection(input, before, after, placeholder) {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const selected = input.value.slice(start, end) || placeholder;
    input.setRangeText(before + selected + after, start, end, 'end');
    input.setSelectionRange(start + before.length, start + before.length + selected.length);
  }

  /** Dodaje prefiks na početak svakog izabranog reda */
  function prefixLines(input, prefix) {
    const value = input.value;
    const lineStart = value.lastIndexOf('\n', input.selectionStart - 1) + 1;
    let lineEnd = value.indexOf('\n', input.selectionEnd);
    if (lineEnd === -1) lineEnd = value.length;
    const block = value.slice(lineStart, lineEnd).split('\n').map(l => prefix + l.replace(/^(#{1,4}\s+|[-*]\s+(\[[ xX]\]\s+)?|&gt;\s?|>\s?)/, '')).join('\n');
    input.setRangeText(block, lineStart, lineEnd, 'end');
  }

  const TABLE_TEMPLATE = '\n| Kolona 1 | Kolona 2 | Kolona 3 |\n| --- | --- | --- |\n| Vrednost | Vrednost | Vrednost |\n';

  function applyFormat(kind) {
    const input = $('plan-editor-input');
    input.focus();
    if (kind === 'bold') replaceSelection(input, '**', '**', 'podebljan tekst');
    else if (kind === 'italic') replaceSelection(input, '*', '*', 'kurziv');
    else if (kind === 'h2') prefixLines(input, '## ');
    else if (kind === 'h3') prefixLines(input, '### ');
    else if (kind === 'ul') prefixLines(input, '- ');
    else if (kind === 'task') prefixLines(input, '- [ ] ');
    else if (kind === 'quote') prefixLines(input, '> ');
    else if (kind === 'table') input.setRangeText(TABLE_TEMPLATE, input.selectionEnd, input.selectionEnd, 'end');
    renderPreview();
  }

  /* ==========================================================================
     INICIJALIZACIJA
     ========================================================================== */
  function bind() {
    $('plan-btn-edit').addEventListener('click', () => startEdit(null));
    $('plan-btn-cancel').addEventListener('click', cancelEdit);
    $('plan-btn-save').addEventListener('click', save);
    $('plan-btn-history').addEventListener('click', toggleHistory);
    $('plan-btn-back').addEventListener('click', () => viewVersion(S.doc.version));
    $('plan-btn-restore').addEventListener('click', () => {
      if (S.viewing) startEdit(S.viewing);
    });

    $('plan-toc').addEventListener('click', (e) => {
      const a = e.target.closest('a[data-target]');
      if (!a) return;
      e.preventDefault();
      const target = document.getElementById(a.getAttribute('data-target'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    $('plan-history').addEventListener('click', (e) => {
      const item = e.target.closest('[data-version]');
      if (item) viewVersion(Number(item.getAttribute('data-version')));
    });

    $('plan-editor-toolbar').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-md]');
      if (btn) applyFormat(btn.getAttribute('data-md'));
    });

    const input = $('plan-editor-input');
    input.addEventListener('input', () => {
      clearTimeout(S.previewTimer);
      S.previewTimer = setTimeout(renderPreview, 200);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        input.setRangeText('  ', input.selectionStart, input.selectionEnd, 'end');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        applyFormat('bold');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        applyFormat('italic');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (S.editing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      }
    });

    window.addEventListener('beforeunload', (e) => {
      if (isDirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  function onTabActivated() {
    if (!S.initialized) {
      S.initialized = true;
      bind();
    }
    // Dok traje izmena, plan se ne učitava ponovo (da se ne izgube izmene)
    if (!S.editing) load();
  }

  window.NolekoPlanModule = { onTabActivated };
})();
