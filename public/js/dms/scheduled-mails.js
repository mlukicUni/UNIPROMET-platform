/**
 * DMS: stranica "Zakazani mailovi".
 * Korisnik sam podešava vreme, učestalost, naslov, sadržaj i primaoce; server šalje po rasporedu
 * (provera svakog minuta) kada je uključen automatski rad servisa (SCHEDULER_ENABLED).
 */
(function () {
    const ROOT_ID = 'dms-scheduled-root';
    const DAYS = ['Nedelja', 'Ponedeljak', 'Utorak', 'Sreda', 'Četvrtak', 'Petak', 'Subota'];
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    let items = [];
    let available = [];
    let selected = [];
    let query = '';
    let built = false;

    const $ = (id) => document.getElementById(id);
    const esc = dmsEscapeHtml;

    // Dani u mesecu (stari zapisi imaju samo `day`)
    const monthlyDays = (s) => s.days || [s.day];

    function describe(s) {
        if (s.type === 'once') return `jednom, ${s.date.split('-').reverse().join('.')}. u ${s.time}`;
        if (s.type === 'daily') return `svaki dan u ${s.time}`;
        if (s.type === 'weekly') return `svake nedelje (${DAYS[s.weekday]}) u ${s.time}`;
        return `svakog meseca, ${monthlyDays(s).map(d => d + '.').join(' ')} u ${s.time}`;
    }

    const formatDate = (iso) => (iso ? new Date(iso).toLocaleString('sr-RS', { dateStyle: 'short', timeStyle: 'short' }) : '–');

    function build() {
        const root = $(ROOT_ID);
        if (!root || built) return;
        built = true;
        root.innerHTML = `
            <div class="panel-box-header">
                <div class="panel-title-with-icon">
                    <div class="yellow-icon-square"><i data-lucide="calendar-clock"></i></div>
                    <div>
                        <h4>Zakazani mailovi</h4>
                        <p class="panel-desc">Mailovi koji se šalju automatski: jednom, svaki dan, nedeljno ili mesečno</p>
                    </div>
                </div>
                <div class="panel-actions-group">
                    <span id="dmsSmStatus" class="dms-status-badge dms-hidden"></span>
                    <button type="button" class="btn-dark-sm dms-hidden" id="dmsSmBack"><i data-lucide="arrow-left"></i><span>Nazad na listu</span></button>
                    <button type="button" class="btn-yellow-solid-sm dms-hidden" id="dmsSmSave"><i data-lucide="save"></i><span>Sačuvaj</span></button>
                    <button type="button" class="btn-yellow-solid-sm" id="dmsSmNew"><i data-lucide="plus-circle"></i><span>Novi zakazani mail</span></button>
                </div>
            </div>
            <div class="panel-box-body">
                <div id="dmsSmListView"><div id="dmsSmList" class="dms-sm-list"></div></div>
                <div id="dmsSmFormView" class="dms-hidden">
                    <input type="hidden" id="dmsSmId">
                    <div class="dms-sm-form">
                        <div class="dms-card">
                            <div class="dms-card-head"><h5><i data-lucide="clock"></i> Termin</h5></div>
                            <div class="form-field">
                                <label for="dmsSmType">Učestalost</label>
                                <select id="dmsSmType" class="form-select-input">
                                    <option value="once">Jednom</option>
                                    <option value="daily">Svaki dan</option>
                                    <option value="weekly">Jednom nedeljno</option>
                                    <option value="monthly">Jednom mesečno</option>
                                </select>
                            </div>
                            <div class="form-field" id="dmsSmDateWrap"><label for="dmsSmDate">Datum</label><input type="date" id="dmsSmDate" class="form-text-input"></div>
                            <div class="form-field dms-hidden" id="dmsSmWeekdayWrap">
                                <label for="dmsSmWeekday">Dan u nedelji</label>
                                <select id="dmsSmWeekday" class="form-select-input">
                                    ${[1, 2, 3, 4, 5, 6, 0].map(d => `<option value="${d}">${DAYS[d]}</option>`).join('')}
                                </select>
                            </div>
                            <div class="form-field dms-hidden" id="dmsSmDayWrap">
                                <label>Dani u mesecu <small class="dms-text-dim">(ako mesec nema taj dan, šalje se poslednjeg dana)</small></label>
                                <div id="dmsSmDays" class="dms-sm-days"></div>
                            </div>
                            <div class="form-field"><label for="dmsSmTime">Vreme</label><input type="time" id="dmsSmTime" class="form-text-input"></div>
                        </div>
                        <div class="dms-card">
                            <div class="dms-card-head"><h5><i data-lucide="mail"></i> Poruka</h5></div>
                            <div class="form-field"><label for="dmsSmSubject">Naslov</label><input type="text" id="dmsSmSubject" maxlength="200" class="form-text-input" placeholder="Naslov mejla"></div>
                            <div class="form-field"><label for="dmsSmBody">Sadržaj</label><textarea id="dmsSmBody" rows="9" maxlength="20000" class="form-text-input" placeholder="Tekst mejla"></textarea></div>
                        </div>
                        <div class="dms-card">
                            <div class="dms-card-head"><h5><i data-lucide="users"></i> Primaoci</h5><span id="dmsSmCount"></span></div>
                            <div class="dms-links-row">
                                <button type="button" class="dms-link-btn" data-sm="all">Označi sve</button>
                                <button type="button" class="dms-link-btn is-muted" data-sm="none">Poništi sve</button>
                            </div>
                            <input type="search" id="dmsSmSearch" placeholder="Pretraži primaoce (ime, služba, e-mail)" class="dms-search-input">
                            <div id="dmsSmUserList" class="dms-recipient-list custom-scrollbar"></div>
                            <div class="dms-add-row">
                                <input type="email" id="dmsSmManual" placeholder="Ručno dodaj e-mail" class="dms-grow">
                                <button type="button" class="btn-dark-sm" data-sm="add"><i data-lucide="plus"></i><span>Dodaj</span></button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;

        $('dmsSmNew').addEventListener('click', () => openForm(null));
        $('dmsSmBack').addEventListener('click', showList);
        $('dmsSmSave').addEventListener('click', save);
        $('dmsSmType').addEventListener('change', toggleSchedule);
        $('dmsSmSearch').addEventListener('input', e => { query = e.target.value || ''; renderRecipients(); });
        $('dmsSmManual').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addManual(); } });
        root.addEventListener('click', onClick);
        $('dmsSmUserList').addEventListener('change', e => {
            const cb = e.target.closest('input[type="checkbox"][data-email]');
            if (!cb) return;
            const email = cb.dataset.email;
            selected = cb.checked ? [...new Set([...selected, email])] : selected.filter(x => x !== email);
            renderCount();
        });
    }

    function onClick(e) {
        const sm = e.target.closest('[data-sm]');
        if (sm) {
            if (sm.dataset.sm === 'all') { selected = available.map(r => r.email); renderRecipients(); }
            if (sm.dataset.sm === 'none') { selected = []; renderRecipients(); }
            if (sm.dataset.sm === 'add') addManual();
            return;
        }
        const act = e.target.closest('[data-act]');
        if (!act) return;
        const id = act.dataset.id;
        if (act.dataset.act === 'toggle') toggleEnabled(id);
        if (act.dataset.act === 'edit') openForm(id);
        if (act.dataset.act === 'send') sendNow(id);
        if (act.dataset.act === 'remove') remove(id);
    }

    function setStatus(text, cls) {
        const el = $('dmsSmStatus');
        if (!el) return;
        el.textContent = text || '';
        el.className = 'dms-status-badge' + (cls ? ' ' + cls : '') + (text ? '' : ' dms-hidden');
    }

    function showList() {
        $('dmsSmListView').classList.remove('dms-hidden');
        $('dmsSmFormView').classList.add('dms-hidden');
        $('dmsSmBack').classList.add('dms-hidden');
        $('dmsSmSave').classList.add('dms-hidden');
        $('dmsSmNew').classList.remove('dms-hidden');
    }

    function showForm() {
        $('dmsSmListView').classList.add('dms-hidden');
        $('dmsSmFormView').classList.remove('dms-hidden');
        $('dmsSmBack').classList.remove('dms-hidden');
        $('dmsSmSave').classList.remove('dms-hidden');
        $('dmsSmNew').classList.add('dms-hidden');
    }

    async function loadList() {
        const box = $('dmsSmList');
        box.innerHTML = '<div class="dms-empty">Učitavanje...</div>';
        try {
            const data = await dmsApi('/api/dms/scheduled-mails');
            items = data.items || [];
            box.innerHTML = items.map(renderItem).join('') || '<div class="dms-empty">Još nema zakazanih mailova.</div>';
        } catch (err) {
            box.innerHTML = '';
            dmsNotify('Zakazani mailovi nisu učitani: ' + err.message, 'error');
        }
    }

    // Jedan red po zakazanom mailu: naziv, termin i primaoci
    function renderItem(item) {
        const next = item.enabled && item.nextRunAt
            ? `sledeće ${formatDate(item.nextRunAt)}`
            : (item.enabled ? 'nema sledećeg termina' : 'isključeno');
        const last = item.lastSentAt ? ` · poslednje ${formatDate(item.lastSentAt)}` : '';
        const recipients = item.recipients.join(', ');
        return `
        <div class="dms-sm-item ${item.enabled ? '' : 'is-off'}">
            <div class="dms-sm-main">
                <div class="dms-sm-title" title="${esc(item.name)}">${esc(item.name)}</div>
                <div class="dms-sm-meta">${esc(describe(item.schedule))} · ${esc(next)}${esc(last)}</div>
                <div class="dms-sm-rcpt" title="${esc(recipients)}">${item.recipients.length} prim.: ${esc(recipients)}</div>
            </div>
            <div class="dms-sm-actions">
                <button type="button" class="btn-dark-sm" data-act="toggle" data-id="${item.id}"><span>${item.enabled ? 'Isključi' : 'Uključi'}</span></button>
                <button type="button" class="btn-dark-sm" data-act="edit" data-id="${item.id}"><i data-lucide="edit"></i><span>Uredi</span></button>
                <button type="button" class="btn-yellow-solid-sm" data-act="send" data-id="${item.id}"><i data-lucide="send"></i><span>Pošalji</span></button>
                <button type="button" class="dms-icon-btn is-danger" data-act="remove" data-id="${item.id}" title="Obriši"><i data-lucide="trash-2"></i></button>
            </div>
        </div>`;
    }

    // Lista primalaca: korisnici sa e-mail adresom iz baze + ručno dodate adrese
    function buildAvailable(extra) {
        const byEmail = new Map();
        Object.values(USERS || {}).forEach(u => {
            const email = String(u.email || '').trim().toLowerCase();
            if (email && !byEmail.has(email)) byEmail.set(email, { email, label: `${u.name}${u.sector ? ' – ' + u.sector : ''}` });
        });
        extra.forEach(e => { if (!byEmail.has(e)) byEmail.set(e, { email: e, label: e }); });
        return [...byEmail.values()].sort((a, b) => a.label.localeCompare(b.label, 'sr'));
    }

    function renderCount() {
        const el = $('dmsSmCount');
        if (el) el.textContent = `Izabrano: ${selected.length}`;
    }

    function renderRecipients() {
        const q = query.trim().toLowerCase();
        const visible = available.filter(r => !q || r.label.toLowerCase().includes(q) || r.email.includes(q));
        $('dmsSmUserList').innerHTML = visible.map(r => `
            <label class="dms-recipient">
                <input type="checkbox" data-email="${esc(r.email)}" ${selected.includes(r.email) ? 'checked' : ''}>
                <span>${esc(r.label)}</span>
            </label>`).join('') || '<div class="dms-empty">Nema primalaca za ovu pretragu.</div>';
        renderCount();
    }

    function addManual() {
        const input = $('dmsSmManual');
        const email = String(input.value || '').trim().toLowerCase();
        if (!EMAIL_RE.test(email)) { dmsNotify('Unesite ispravnu e-mail adresu.', 'error'); return; }
        if (!available.some(r => r.email === email)) available.push({ email, label: email });
        if (!selected.includes(email)) selected.push(email);
        input.value = '';
        renderRecipients();
    }

    // Prikazuje samo polja koja važe za izabranu učestalost
    function toggleSchedule() {
        const type = $('dmsSmType').value;
        $('dmsSmDateWrap').classList.toggle('dms-hidden', type !== 'once');
        $('dmsSmWeekdayWrap').classList.toggle('dms-hidden', type !== 'weekly');
        $('dmsSmDayWrap').classList.toggle('dms-hidden', type !== 'monthly');
    }

    function renderDays(sel) {
        $('dmsSmDays').innerHTML = Array.from({ length: 31 }, (_, i) => i + 1).map(d => `
            <label class="dms-day"><input type="checkbox" value="${d}" ${sel.includes(d) ? 'checked' : ''}><span>${d}.</span></label>`).join('');
    }

    function openForm(id) {
        const item = id ? items.find(i => i.id === id) : null;
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const pad = n => String(n).padStart(2, '0');
        const tomorrowIso = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;

        $('dmsSmId').value = item ? item.id : '';
        $('dmsSmType').value = item ? item.schedule.type : 'once';
        $('dmsSmDate').value = item && item.schedule.date ? item.schedule.date : tomorrowIso;
        $('dmsSmTime').value = item ? item.schedule.time : '08:00';
        $('dmsSmWeekday').value = item && item.schedule.weekday !== undefined ? String(item.schedule.weekday) : '1';
        renderDays(item && item.schedule.type === 'monthly' ? monthlyDays(item.schedule) : [1]);
        $('dmsSmSubject').value = item ? item.subject : '';
        $('dmsSmBody').value = item ? item.body : '';
        $('dmsSmManual').value = '';
        $('dmsSmSearch').value = '';
        query = '';
        toggleSchedule();

        selected = item ? [...item.recipients] : [];
        available = buildAvailable(selected);
        renderRecipients();
        setStatus('');
        showForm();
    }

    function readForm() {
        const type = $('dmsSmType').value;
        const schedule = { type, time: $('dmsSmTime').value };
        if (type === 'once') schedule.date = $('dmsSmDate').value;
        if (type === 'weekly') schedule.weekday = Number($('dmsSmWeekday').value);
        if (type === 'monthly') schedule.days = [...document.querySelectorAll('#dmsSmDays input:checked')].map(i => Number(i.value));

        const id = $('dmsSmId').value;
        const existing = id ? items.find(i => i.id === id) : null;
        return {
            id: id || undefined,
            subject: $('dmsSmSubject').value,
            body: $('dmsSmBody').value,
            recipients: selected,
            schedule,
            enabled: existing ? existing.enabled : true
        };
    }

    const post = (payload) => dmsApi('/api/dms/scheduled-mails', dmsJson(payload));

    async function save() {
        try {
            await post(readForm());
            showList();
            await loadList();
            dmsNotify('Zakazani mail je sačuvan.', 'success');
        } catch (err) {
            dmsNotify('Čuvanje nije uspelo: ' + err.message, 'error');
        }
    }

    async function toggleEnabled(id) {
        const item = items.find(i => i.id === id);
        if (!item) return;
        try {
            await post({ ...item, enabled: !item.enabled });
            await loadList();
        } catch (err) {
            dmsNotify('Greška: ' + err.message, 'error');
        }
    }

    async function remove(id) {
        const item = items.find(i => i.id === id);
        if (!item || !confirm(`Obrisati zakazani mail "${item.name}"?`)) return;
        try {
            await dmsApi(`/api/dms/scheduled-mails/${id}`, { method: 'DELETE' });
            await loadList();
        } catch (err) {
            dmsNotify('Brisanje nije uspelo: ' + err.message, 'error');
        }
    }

    async function sendNow(id) {
        const item = items.find(i => i.id === id);
        if (!item || !confirm(`Poslati "${item.name}" odmah na ${item.recipients.length} primaoca?`)) return;
        setStatus('Slanje...', 'is-busy');
        try {
            const data = await dmsApi(`/api/dms/scheduled-mails/${id}/send`, { method: 'POST' });
            setStatus('');
            dmsNotify(`Poslato na: ${data.recipients.join(', ')}`, 'success');
            await loadList();
        } catch (err) {
            setStatus('');
            dmsNotify('Slanje nije uspelo: ' + err.message, 'error');
        }
    }

    window.DmsScheduledPage = {
        async onTabActivated() {
            build();
            showList();
            await loadUsersDatabase();
            await loadList();
        }
    };
})();
