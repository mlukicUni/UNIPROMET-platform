/**
 * DMS: stranica "Podsetnik za overu".
 * Pregled mejla (računi koji čekaju overu po službama i osobama), izbor primalaca i slanje.
 * Sadržaj mejla sastavlja server (/api/dms/reminders/preview), isti HTML se šalje primaocima.
 */
(function () {
    const ROOT_ID = 'dms-reminder-root';
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Izabrani primaoci (e-mail adrese, mala slova) i sve adrese koje se mogu izabrati
    let selected = [];
    let available = [];
    let query = '';
    let built = false;

    const $ = (id) => document.getElementById(id);
    const canSend = () => !window.UniAccess || window.UniAccess.has('dms.podsetnik:slanje');

    function build() {
        const root = $(ROOT_ID);
        if (!root || built) return;
        built = true;
        root.innerHTML = `
            <div class="panel-box-header">
                <div class="panel-title-with-icon">
                    <div class="yellow-icon-square"><i data-lucide="bell-ring"></i></div>
                    <div>
                        <h4>Podsetnik za overu računa</h4>
                        <p class="panel-desc">Računi sa statusom „Dodeljeno“ iz najnovijeg izveštaja, grupisani po službi i osobi</p>
                    </div>
                </div>
                <div class="panel-actions-group">
                    <span id="dmsReminderStatus" class="dms-status-badge"></span>
                    <button type="button" class="btn-dark-sm" id="dmsReminderRefresh"><i data-lucide="rotate-cw"></i><span>Osveži pregled</span></button>
                    <button type="button" class="btn-dark-sm" id="dmsReminderPrint"><i data-lucide="printer"></i><span>Štampaj</span></button>
                    <button type="button" class="btn-yellow-solid-sm" id="dmsReminderSend"><i data-lucide="send"></i><span>Pošalji</span></button>
                </div>
            </div>
            <div class="panel-box-body">
                <div class="dms-reminder-grid">
                    <div class="dms-card dms-reminder-recipients">
                        <div class="dms-card-head">
                            <h5><i data-lucide="users"></i> Primaoci</h5>
                            <span id="dmsReminderCount"></span>
                        </div>
                        <div class="dms-links-row">
                            <button type="button" class="dms-link-btn" id="dmsReminderAll">Označi sve</button>
                            <button type="button" class="dms-link-btn is-muted" id="dmsReminderNone">Poništi sve</button>
                        </div>
                        <input type="search" id="dmsReminderSearch" placeholder="Pretraži primaoce (ime, služba, e-mail)" class="dms-search-input">
                        <div id="dmsReminderList" class="dms-recipient-list custom-scrollbar"></div>
                        <div class="dms-add-row">
                            <input type="email" id="dmsReminderManual" placeholder="Ručno dodaj e-mail" class="dms-grow">
                            <button type="button" class="btn-dark-sm" id="dmsReminderAdd"><i data-lucide="plus"></i><span>Dodaj</span></button>
                        </div>
                    </div>
                    <div class="dms-card dms-reminder-preview">
                        <div class="dms-card-head">
                            <h5><i data-lucide="mail"></i> Pregled mejla</h5>
                            <span><b>Naslov:</b> <span id="dmsReminderSubject">-</span></span>
                        </div>
                        <div id="dmsReminderPaper" class="dms-paper"></div>
                    </div>
                </div>
            </div>`;

        $('dmsReminderRefresh').addEventListener('click', load);
        $('dmsReminderSend').addEventListener('click', send);
        $('dmsReminderPrint').addEventListener('click', printPaper);
        $('dmsReminderAll').addEventListener('click', () => setAll(true));
        $('dmsReminderNone').addEventListener('click', () => setAll(false));
        $('dmsReminderAdd').addEventListener('click', addManual);
        $('dmsReminderManual').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addManual(); } });
        $('dmsReminderSearch').addEventListener('input', e => { query = e.target.value || ''; renderRecipients(); });
        $('dmsReminderList').addEventListener('change', e => {
            const cb = e.target.closest('input[type="checkbox"][data-email]');
            if (!cb) return;
            const email = cb.dataset.email;
            selected = cb.checked ? [...new Set([...selected, email])] : selected.filter(x => x !== email);
            renderCount();
        });
    }

    // Štampa samo sadržaj mejla (u novom prozoru), ne celu platformu
    function printPaper() {
        const w = window.open('', '_blank');
        if (!w) { dmsNotify('Dozvolite iskačuće prozore za štampu.', 'error'); return; }
        w.document.write(`<html><head><title>Podsetnik za overu</title></head><body>${$('dmsReminderPaper').innerHTML}</body></html>`);
        w.document.close();
        w.focus();
        w.print();
    }

    function setStatus(text, cls) {
        const el = $('dmsReminderStatus');
        if (!el) return;
        el.className = 'dms-status-badge' + (cls ? ' ' + cls : '');
        el.textContent = text;
    }

    function renderCount() {
        const el = $('dmsReminderCount');
        if (el) el.textContent = `Izabrano: ${selected.length} od ${available.length}`;
    }

    function renderRecipients() {
        const list = $('dmsReminderList');
        if (!list) return;
        const q = query.trim().toLowerCase();
        const visible = available.filter(r => !q || r.label.toLowerCase().includes(q) || r.email.includes(q));
        list.innerHTML = visible.map(r => `
            <label class="dms-recipient">
                <input type="checkbox" data-email="${dmsEscapeHtml(r.email)}" ${selected.includes(r.email) ? 'checked' : ''}>
                <span>${dmsEscapeHtml(r.label)}</span>
            </label>`).join('') || '<div class="dms-empty">Nema primalaca za ovu pretragu.</div>';
        renderCount();
    }

    // Lista korisnika sa e-mail adresom iz baze (USERS) + ručno dodate adrese
    function buildAvailable(defaults) {
        const byEmail = new Map();
        Object.values(USERS || {}).forEach(u => {
            const email = String(u.email || '').trim().toLowerCase();
            if (email && !byEmail.has(email)) byEmail.set(email, { email, label: `${u.name}${u.sector ? ' – ' + u.sector : ''}` });
        });
        defaults.forEach(e => { if (!byEmail.has(e)) byEmail.set(e, { email: e, label: e }); });
        return [...byEmail.values()].sort((a, b) => a.label.localeCompare(b.label, 'sr'));
    }

    function setAll(on) {
        selected = on ? available.map(r => r.email) : [];
        renderRecipients();
    }

    function addManual() {
        const input = $('dmsReminderManual');
        const email = String(input.value || '').trim().toLowerCase();
        if (!EMAIL_RE.test(email)) { dmsNotify('Unesite ispravnu e-mail adresu.', 'error'); return; }
        if (!available.some(r => r.email === email)) available.push({ email, label: email });
        if (!selected.includes(email)) selected.push(email);
        input.value = '';
        renderRecipients();
    }

    async function load() {
        const paper = $('dmsReminderPaper');
        setStatus('Učitavanje pregleda...', 'is-busy');
        try {
            const data = await dmsApi('/api/dms/reminders/preview');
            // Podrazumevano: administratori, osobe koje imaju račune za overu i ključni korisnici službi iz tabele
            const personEmails = (data.peopleNames || [])
                .map(n => String((USERS[n] || {}).email || '').trim().toLowerCase())
                .filter(Boolean);
            const sectorNames = data.sectorNames || [];
            const keyUserEmails = Object.values(USERS || {})
                .filter(u => u.isKeyUser && sectorNames.includes(u.sector))
                .map(u => String(u.email || '').trim().toLowerCase())
                .filter(Boolean);
            const defaults = [...new Set([...data.recipients, ...personEmails, ...keyUserEmails].map(e => e.toLowerCase()))];
            selected = [...defaults];
            available = buildAvailable(defaults);
            renderRecipients();

            $('dmsReminderSubject').textContent = data.subject;
            paper.innerHTML = data.html;
            setStatus(`Ukupno za overu: ${data.total}`, 'is-ready');
        } catch (err) {
            paper.innerHTML = '';
            setStatus('Greška pri pregledu', '');
            dmsNotify('Pregled podsetnika nije dostupan: ' + err.message, 'error');
        }
    }

    // Slanje samo na klik; šalje se na primaoce izabrane u listi
    async function send() {
        if (!canSend()) { dmsNotify('Nemate dozvolu za slanje podsetnika.', 'error'); return; }
        if (selected.length === 0) { dmsNotify('Izaberite bar jednog primaoca.', 'error'); return; }
        if (!confirm(`Poslati podsetnik na ${selected.length} adresa?`)) return;
        const btn = $('dmsReminderSend');
        btn.disabled = true;
        setStatus('Slanje...', 'is-busy');
        try {
            const data = await dmsApi('/api/dms/reminders/send', dmsJson({ recipients: selected }));
            setStatus(`Poslato: ${data.recipients.length}`, 'is-ready');
            dmsNotify(`Podsetnik je poslat na ${data.recipients.length} adresa.`, 'success');
        } catch (err) {
            setStatus('Slanje nije uspelo', '');
            dmsNotify('Slanje nije uspelo: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    window.DmsReminderPage = {
        onTabActivated() {
            build();
            return load();
        }
    };
})();
