/**
 * ==========================================================================
 * UNIPROMET IT ADMIN - NOLEKO AI: AGENT PROTOTIP
 * Chat sa AI agentom: lista ličnih razgovora, poruke, odgovor koji se
 * ispisuje dok nastaje (tok događaja sa /api/ai-agent/chat) i dugme Stop.
 * ==========================================================================
 */
(function () {
  'use strict';

  const API = '/api/ai-agent';

  const S = {
    initialized: false,
    conversations: [],
    activeId: '',
    messages: [],
    maxLength: 4000,
    status: null,
    model: '',
    effort: '',
    sending: false,
    controller: null
  };

  /* ==========================================================================
     POMOĆNE FUNKCIJE
     ========================================================================== */
  const $ = (id) => document.getElementById(id);

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function notify(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }

  /**
   * Ikonice chata kao gotov SVG. lucide.createIcons() se ovde ne poziva jer ponovo
   * obrađuje sve ikonice cele platforme i pri čestom osvežavanju blokira pregledač.
   */
  const ICON_PATHS = {
    bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>'
  };

  function svg(name) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
  }

  async function api(url, method) {
    const res = await fetch(url, { method: method || 'GET', headers: { Accept: 'application/json' } });
    let data = null;
    try { data = await res.json(); } catch (e) { /* nije JSON */ }
    if (!res.ok || (data && data.success === false)) {
      throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
    }
    return data || {};
  }

  /** "claude-opus-5-5" -> "Opus 5.5" */
  function modelName(id) {
    const m = String(id || '').match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?/i);
    if (!m) return id || '';
    return `${m[1].charAt(0).toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? '.' + m[3] : ''}`;
  }

  /** Izbori u zaglavlju: model i nivo truda (pamte se u pregledaču) */
  const PICKERS = {
    model: { selectId: 'ai-model', listKey: 'models', defaultKey: 'defaultModel', storageKey: 'unipromet_ai_agent_model', title: 'Model za sledeću poruku' },
    effort: { selectId: 'ai-effort', listKey: 'efforts', defaultKey: 'defaultEffort', storageKey: 'unipromet_ai_agent_effort', title: 'Nivo truda za sledeću poruku' }
  };

  function effortLabel(id) {
    const e = ((S.status && S.status.efforts) || []).find(x => x.id === id);
    return e ? e.label : id;
  }

  function renderPicker(name) {
    const p = PICKERS[name];
    const sel = $(p.selectId);
    const items = (S.status && S.status[p.listKey]) || [];
    if (!sel || !items.length) return;
    if (!S[name]) {
      let saved = '';
      try { saved = localStorage.getItem(p.storageKey) || ''; } catch (e) { /* bez localStorage */ }
      S[name] = items.some(i => i.id === saved) ? saved : S.status[p.defaultKey];
    }
    sel.innerHTML = items.map(i =>
      `<option value="${esc(i.id)}" title="${esc(i.description)}"${i.id === S[name] ? ' selected' : ''}>${esc(i.label)}</option>`
    ).join('');
    const current = items.find(i => i.id === S[name]);
    if (current) sel.parentElement.title = `${p.title}: ${current.label} - ${current.description}`;
  }

  function renderModelPicker() {
    renderPicker('model');
    renderPicker('effort');
  }

  function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('sr-Latn-RS', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  /* ==========================================================================
     MARKDOWN (zajednički bezbedan prikaz iz core/markdown.js)
     ========================================================================== */
  function renderMarkdown(src) {
    return window.UniMarkdown ? window.UniMarkdown.render(src).html : esc(src).replace(/\n/g, '<br>');
  }

  /* ==========================================================================
     STATUS AGENTA
     ========================================================================== */
  function setStatus(state, text) {
    const el = $('ai-status');
    if (!el) return;
    el.setAttribute('data-state', state);
    $('ai-status-text').textContent = text;
  }

  function showReadyStatus() {
    const st = S.status;
    if (!st) return;
    if (st.ready) setStatus('ready', `Spreman${st.cliVersion ? ' · CLI ' + st.cliVersion : ''}`);
    else setStatus('error', st.message);
    renderModelPicker();
    updateComposer();
  }

  async function loadStatus() {
    setStatus('loading', 'Provera agenta...');
    try {
      const data = await api(`${API}/status`);
      S.status = data.status;
      S.maxLength = data.maxPromptLength || S.maxLength;
    } catch (err) {
      S.status = { ready: false, message: `Status nije dostupan: ${err.message}` };
    }
    showReadyStatus();
  }

  /* ==========================================================================
     RAZGOVORI
     ========================================================================== */
  function renderConversations() {
    const host = $('ai-conv-list');
    if (!host) return;
    if (!S.conversations.length) {
      host.innerHTML = '<div class="ai-conv-empty">Još nemate razgovora.</div>';
      return;
    }
    host.innerHTML = S.conversations.map(c => `
      <div class="ai-conv${c.id === S.activeId ? ' active' : ''}" data-id="${esc(c.id)}" title="${esc(c.title)} · ${esc(formatTime(c.updatedAt))}">
        <span class="ai-conv-title">${esc(c.title)}</span>
        <button type="button" class="ai-conv-del" data-del="${esc(c.id)}" title="Obriši razgovor">${svg('trash')}</button>
      </div>`).join('');
  }

  async function loadConversations() {
    try {
      const data = await api(`${API}/conversations`);
      S.conversations = data.conversations || [];
    } catch (err) {
      notify(`Razgovori nisu učitani: ${err.message}`, 'error');
    }
    renderConversations();
  }

  async function openConversation(id) {
    if (S.sending) return;
    S.activeId = id;
    renderConversations();
    try {
      const data = await api(`${API}/conversations/${encodeURIComponent(id)}`);
      S.messages = data.messages || [];
    } catch (err) {
      S.messages = [];
      notify(`Razgovor nije učitan: ${err.message}`, 'error');
    }
    renderMessages();
    $('ai-input')?.focus();
  }

  function newConversation() {
    if (S.sending) return;
    S.activeId = '';
    S.messages = [];
    renderConversations();
    renderMessages();
    $('ai-input')?.focus();
  }

  async function removeConversation(id) {
    if (S.sending) return;
    const conv = S.conversations.find(c => c.id === id);
    if (!window.confirm(`Obrisati razgovor „${conv ? conv.title : ''}“?`)) return;
    try {
      await api(`${API}/conversations/${encodeURIComponent(id)}`, 'DELETE');
      S.conversations = S.conversations.filter(c => c.id !== id);
      if (S.activeId === id) newConversation();
      else renderConversations();
    } catch (err) {
      notify(`Brisanje nije uspelo: ${err.message}`, 'error');
    }
  }

  /* ==========================================================================
     PORUKE
     ========================================================================== */
  function messageHtml(m) {
    const isUser = m.role === 'user';
    const isError = m.status === 'error';
    let body;
    if (isUser) body = esc(m.content);
    else if (m.pending) body = '<span class="ai-typing"><span></span><span></span><span></span></span>';
    else body = renderMarkdown(m.content || '');

    let meta = '';
    if (!isUser && !m.pending) {
      const parts = [];
      if (m.createdAt) parts.push(formatTime(m.createdAt));
      if (m.model) parts.push(modelName(m.model) + (m.effort ? ` (${effortLabel(m.effort)})` : ''));
      if (m.durationMs) parts.push(`${(m.durationMs / 1000).toFixed(1)} s`);
      if (m.status === 'stopped') parts.push('zaustavljeno');
      if (isError) parts.push(m.error ? `greška: ${m.error}` : 'greška');
      meta = `<span class="ai-meta${isError ? ' err' : ''}">${esc(parts.join(' · '))}</span>`;
    }
    if (isError && !m.content) body = 'Agent nije uspeo da odgovori.';

    return `
      <div class="ai-msg ${isUser ? 'user' : 'agent'}${isError ? ' error' : ''}">
        <div class="ai-avatar">${svg(isUser ? 'user' : 'bot')}</div>
        <div class="ai-bubble-wrap">
          <div class="ai-bubble">${body}</div>
          ${meta}
        </div>
      </div>`;
  }

  function scrollToBottom() {
    const host = $('ai-messages');
    if (host) host.scrollTop = host.scrollHeight;
  }

  function renderMessages() {
    const host = $('ai-messages');
    if (!host) return;
    if (!S.messages.length) {
      host.innerHTML = `
        <div class="ai-welcome" id="ai-welcome">
          <div class="ai-welcome-icon">${svg('bot')}</div>
          <h5>Kako mogu da pomognem?</h5>
          <p>Postavite pitanje agentu. Ovo je prototip: agent nema pristup podacima platforme, serverima ni fajlovima.</p>
        </div>`;
    } else {
      host.innerHTML = S.messages.map(messageHtml).join('');
    }
    scrollToBottom();
    renderContext();
  }

  /** Osvežava samo poslednju poruku (odgovor agenta kad stigne ceo) */
  function renderLastMessage() {
    const host = $('ai-messages');
    const last = S.messages[S.messages.length - 1];
    const el = host && host.lastElementChild;
    if (!last || !el || !el.classList.contains('ai-msg')) return renderMessages();
    el.outerHTML = messageHtml(last);
    scrollToBottom();
    renderContext();
  }

  /* ==========================================================================
     POPUNJENOST KONTEKSTA (posle poslednjeg odgovora koji ima podatak)
     ========================================================================== */
  function formatTokens(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
    if (n >= 100_000) return `${Math.round(n / 1000)}k`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  }

  function renderContext() {
    const box = $('ai-context');
    if (!box) return;
    const last = [...S.messages].reverse().find(m => m.role === 'agent' && m.contextTokens && m.contextWindow);
    const fill = $('ai-context-fill');
    const text = $('ai-context-text');
    if (!last) {
      box.setAttribute('data-level', 'none');
      fill.style.width = '0';
      text.textContent = S.messages.length ? 'nema podatka' : '—';
      return;
    }
    const pct = Math.min(100, (last.contextTokens / last.contextWindow) * 100);
    box.setAttribute('data-level', pct >= 85 ? 'high' : pct >= 60 ? 'warn' : 'ok');
    fill.style.width = `${Math.max(pct, 0.5)}%`;
    const pctText = pct < 1 ? pct.toFixed(1) : Math.round(pct);
    text.textContent = `${formatTokens(last.contextTokens)} / ${formatTokens(last.contextWindow)} tokena (${pctText}%) · ${modelName(last.model)}`;
    box.title = pct >= 85
      ? 'Kontekst je skoro pun: agent će uskoro sažimati stariji deo razgovora. Za novu temu otvorite novi razgovor.'
      : 'Koliko je popunjen kontekst (memorija) razgovora posle poslednjeg odgovora';
  }

  /* ==========================================================================
     SLANJE PORUKE (tok događaja)
     ========================================================================== */
  function updateComposer() {
    const input = $('ai-input');
    const len = input ? input.value.trim().length : 0;
    const counter = $('ai-counter');
    if (counter) {
      counter.textContent = `${len} / ${S.maxLength}`;
      counter.classList.toggle('over', len > S.maxLength);
    }
    const ready = !!(S.status && S.status.ready);
    const send = $('ai-btn-send');
    if (send) {
      send.disabled = S.sending || !ready || !len || len > S.maxLength;
      send.style.display = S.sending ? 'none' : '';
    }
    const stop = $('ai-btn-stop');
    if (stop) stop.style.display = S.sending ? '' : 'none';
    if (input) input.disabled = S.sending;
    ['ai-model', 'ai-effort'].forEach(id => {
      const sel = $(id);
      if (sel) sel.disabled = S.sending || !ready;
    });
  }

  function autoGrow() {
    const input = $('ai-input');
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
  }

  function handleEvent(event, data, reply) {
    if (event === 'conversation') {
      if (!S.activeId) {
        S.activeId = data.id;
        S.conversations.unshift({ id: data.id, title: data.title, updatedAt: new Date().toISOString() });
        renderConversations();
      }
    } else if (event === 'model') {
      reply.model = data.model;
      if (S.status) setStatus('busy', `Odgovara... · ${modelName(data.model)}`);
    } else if (event === 'delta') {
      // Loader ostaje do kraja; delovi se samo pamte (za prikaz posle Stop-a)
      reply.content += data.text;
    } else if (event === 'done') {
      reply.content = data.text || reply.content;
      reply.pending = false;
      reply.durationMs = data.durationMs;
      if (data.model) reply.model = data.model;
      if (data.effort) reply.effort = data.effort;
      if (data.context) {
        reply.contextTokens = data.context.tokens;
        reply.contextWindow = data.context.window;
      }
      reply.status = data.stopped ? 'stopped' : 'ok';
      reply.createdAt = new Date().toISOString();
      renderLastMessage();
    } else if (event === 'error') {
      reply.content = data.text || reply.content;
      reply.pending = false;
      reply.status = 'error';
      reply.error = data.error;
      reply.createdAt = new Date().toISOString();
      renderLastMessage();
    }
  }

  async function sendMessage() {
    const input = $('ai-input');
    const prompt = input ? input.value.trim() : '';
    if (!prompt || S.sending || !(S.status && S.status.ready) || prompt.length > S.maxLength) return;

    const reply = { role: 'agent', content: '', pending: true };
    S.messages.push({ role: 'user', content: prompt, createdAt: new Date().toISOString() }, reply);
    renderMessages();
    input.value = '';
    autoGrow();
    S.sending = true;
    S.controller = new AbortController();
    updateComposer();
    setStatus('busy', 'Odgovara...');

    try {
      const res = await fetch(`${API}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          conversationId: S.activeId || undefined,
          prompt,
          model: S.model || undefined,
          effort: S.effort || undefined
        }),
        signal: S.controller.signal
      });
      if (!res.ok || !res.body) {
        let msg = `HTTP ${res.status}`;
        try { const d = await res.json(); msg = d.error || msg; } catch (e) { /* nije JSON */ }
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          let event = 'message';
          let dataStr = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) event = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataStr += line.slice(6);
          }
          let data = {};
          try { data = JSON.parse(dataStr || '{}'); } catch (e) { /* oštećen događaj */ }
          handleEvent(event, data, reply);
        }
      }
      if (reply.pending) handleEvent('error', { error: 'Veza je prekinuta pre kraja odgovora.' }, reply);
    } catch (err) {
      if (err.name === 'AbortError') {
        handleEvent('done', { text: reply.content, stopped: true }, reply);
      } else {
        handleEvent('error', { error: err.message }, reply);
        notify(`AI agent: ${err.message}`, 'error');
      }
    } finally {
      S.sending = false;
      S.controller = null;
      showReadyStatus();
      updateComposer();
      // Naslov/redosled razgovora sa servera
      loadConversations();
      $('ai-input')?.focus();
    }
  }

  function stopReply() {
    if (S.controller) S.controller.abort();
  }

  /* ==========================================================================
     INICIJALIZACIJA
     ========================================================================== */
  function bind() {
    $('ai-btn-new')?.addEventListener('click', newConversation);
    $('ai-btn-stop')?.addEventListener('click', stopReply);
    Object.entries(PICKERS).forEach(([name, p]) => {
      $(p.selectId)?.addEventListener('change', (e) => {
        S[name] = e.target.value;
        try { localStorage.setItem(p.storageKey, S[name]); } catch (err) { /* bez localStorage */ }
        renderPicker(name);
      });
    });
    $('ai-composer')?.addEventListener('submit', (e) => {
      e.preventDefault();
      sendMessage();
    });
    const input = $('ai-input');
    if (input) {
      input.addEventListener('input', () => { autoGrow(); updateComposer(); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          sendMessage();
        }
      });
    }
    $('ai-conv-list')?.addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]');
      if (del) {
        e.stopPropagation();
        removeConversation(del.getAttribute('data-del'));
        return;
      }
      const row = e.target.closest('.ai-conv[data-id]');
      if (row) openConversation(row.getAttribute('data-id'));
    });
  }

  function onTabActivated() {
    if (!S.initialized) {
      S.initialized = true;
      bind();
      renderMessages();
      loadConversations();
    }
    if (!S.sending) loadStatus();
    updateComposer();
  }

  window.AiAgentModule = { onTabActivated };
})();
