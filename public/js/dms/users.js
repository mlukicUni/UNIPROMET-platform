/**
 * DMS: stranica "Korisnici i službe".
 * Evidencija zaposlenih (služba, lokacija, e-mail), označavanje ključnih korisnika i slanje mejlova
 * pojedincu ili grupi (prozor za slanje je u email.js).
 */
let currentUsersFilter = 'all';
let selectedUsersForEmail = new Set();

(function () {
    const ROOT_ID = 'dms-users-root';
    let built = false;
    let search = '';

    const $ = (id) => document.getElementById(id);
    const esc = dmsEscapeHtml;
    const canEdit = () => !window.UniAccess || window.UniAccess.canEdit('dms_users');
    const canMail = () => !window.UniAccess || window.UniAccess.has('dms.izvestaji:mejl');

    function build() {
        const root = $(ROOT_ID);
        if (!root || built) return;
        built = true;
        root.innerHTML = `
            <div class="panel-box-header">
                <div class="panel-title-with-icon">
                    <div class="yellow-icon-square"><i data-lucide="users"></i></div>
                    <div>
                        <h4>Korisnici i službe</h4>
                        <p class="panel-desc">Evidencija zaposlenih, označavanje ključnih korisnika i slanje e-mail obaveštenja</p>
                    </div>
                </div>
                <div class="panel-actions-group">
                    <button type="button" class="btn-dark-sm" id="dmsUsersMail" title="Šalje mejl izabranim korisnicima, a ako niko nije izabran svim ključnim korisnicima"><i data-lucide="send"></i><span>Pošalji mail (<b id="selectedUserCount">0</b>)</span></button>
                    <button type="button" class="btn-yellow-solid-sm" id="dmsUserNew"><i data-lucide="user-plus"></i><span>Novi korisnik</span></button>
                </div>
            </div>
            <div class="panel-box-body">
                <div class="dms-users-toolbar">
                    <div class="dms-subnav-group">
                        <button type="button" class="dms-pill is-active" id="btnFilterUserAll">Svi korisnici (<span id="countAllUsers">0</span>)</button>
                        <button type="button" class="dms-pill" id="btnFilterUserKey"><i data-lucide="star"></i> Ključni (<span id="countKeyUsers">0</span>)</button>
                    </div>
                    <input type="search" id="userSearchInput" placeholder="Pretraži po imenu, službi, e-mailu..." class="dms-users-search">
                    <span class="dms-caption">Prikazano: <b id="modalUserCount">0</b></span>
                </div>
                <div class="dms-table-wrap">
                    <table class="dms-table">
                        <thead>
                            <tr>
                                <th class="dms-center"><input type="checkbox" id="selectAllUsersCheckbox" title="Označi sve prikazane"></th>
                                <th>Ime i prezime</th>
                                <th class="dms-center">Ključan</th>
                                <th>Služba</th>
                                <th>E-mail</th>
                                <th>Lokacija</th>
                                <th class="dms-num">Akcije</th>
                            </tr>
                        </thead>
                        <tbody id="modalUsersTableBody"></tbody>
                    </table>
                </div>
            </div>`;

        $('btnFilterUserAll').addEventListener('click', () => setFilter('all'));
        $('btnFilterUserKey').addEventListener('click', () => setFilter('key'));
        $('userSearchInput').addEventListener('input', e => { search = (e.target.value || '').toLowerCase(); renderTable(); });
        $('dmsUserNew').addEventListener('click', () => openForm(null));
        $('dmsUsersMail').addEventListener('click', () => {
            if (!canMail()) { dmsNotify('Nemate dozvolu za slanje mejlova.', 'error'); return; }
            openGroupEmailModal();
        });
        $('selectAllUsersCheckbox').addEventListener('change', e => toggleSelectAllUsers(e.target));
        $('modalUsersTableBody').addEventListener('click', onRowClick);
        $('modalUsersTableBody').addEventListener('change', e => {
            const cb = e.target.closest('.user-select-cb');
            if (cb) toggleSelectUser(cb.dataset.userKey, cb);
        });
    }

    function setFilter(mode) {
        currentUsersFilter = mode;
        $('btnFilterUserAll').classList.toggle('is-active', mode !== 'key');
        $('btnFilterUserKey').classList.toggle('is-active', mode === 'key');
        renderTable();
    }

    function updateSelectedCount() {
        const el = $('selectedUserCount');
        if (el) el.textContent = selectedUsersForEmail.size;
    }

    function toggleSelectUser(encodedKey, checkbox) {
        const key = decodeURIComponent(encodedKey);
        if (checkbox.checked) selectedUsersForEmail.add(key);
        else selectedUsersForEmail.delete(key);
        updateSelectedCount();
        syncSelectAll();
    }

    function visibleCheckboxes() {
        return Array.from(document.querySelectorAll('#modalUsersTableBody .user-select-cb'));
    }

    function syncSelectAll() {
        const all = $('selectAllUsersCheckbox');
        const cbs = visibleCheckboxes();
        if (all) all.checked = cbs.length > 0 && cbs.every(cb => cb.checked);
    }

    function toggleSelectAllUsers(master) {
        visibleCheckboxes().forEach(cb => {
            cb.checked = master.checked;
            const key = decodeURIComponent(cb.dataset.userKey);
            if (master.checked) selectedUsersForEmail.add(key);
            else selectedUsersForEmail.delete(key);
        });
        updateSelectedCount();
    }

    function renderTable() {
        const tbody = $('modalUsersTableBody');
        if (!tbody) return;

        const allKeys = Object.keys(USERS).sort((a, b) => a.localeCompare(b, 'sr'));
        $('countAllUsers').textContent = allKeys.length;
        $('countKeyUsers').textContent = allKeys.filter(k => USERS[k]?.isKeyUser).length;

        let keys = currentUsersFilter === 'key' ? allKeys.filter(k => USERS[k]?.isKeyUser) : allKeys;
        if (search) {
            keys = keys.filter(k => {
                const u = USERS[k];
                return [u.name, u.sector, u.email, u.location].some(v => String(v || '').toLowerCase().includes(search));
            });
        }
        $('modalUserCount').textContent = keys.length;

        if (keys.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="dms-empty">Nema korisnika za prikaz.</td></tr>';
            syncSelectAll();
            return;
        }

        const editable = canEdit();
        const mailable = canMail();
        tbody.innerHTML = keys.map(key => {
            const u = USERS[key];
            const enc = encodeURIComponent(key);
            const isKey = Boolean(u.isKeyUser);
            return `
            <tr class="dms-tr ${isKey ? 'is-key' : ''}">
                <td class="dms-center"><input type="checkbox" class="user-select-cb" data-user-key="${enc}" ${selectedUsersForEmail.has(key) ? 'checked' : ''}></td>
                <td class="dms-strong"><i data-lucide="user" class="dms-text-dim"></i> ${esc(u.name || key)}</td>
                <td class="dms-center">${isKey ? '<span class="dms-chip dms-chip-amber"><i data-lucide="star"></i> Ključan</span>' : '<span class="dms-text-dim">Ne</span>'}</td>
                <td><span class="dms-chip"><i data-lucide="building-2"></i> ${esc(u.sector || 'Nepoznat Sektor')}</span></td>
                <td class="dms-text-muted">${esc(u.email || '-')}</td>
                <td class="dms-text-muted">${esc(u.location || '-')}</td>
                <td class="dms-num dms-nowrap">
                    ${mailable ? `<button type="button" class="dms-icon-btn" data-act="mail" data-key="${enc}" title="Pošalji mail"><i data-lucide="send"></i></button>` : ''}
                    ${editable ? `<button type="button" class="dms-icon-btn" data-act="edit" data-key="${enc}" title="Izmeni"><i data-lucide="edit"></i></button>
                    <button type="button" class="dms-icon-btn is-danger" data-act="delete" data-key="${enc}" title="Obriši"><i data-lucide="trash-2"></i></button>` : ''}
                </td>
            </tr>`;
        }).join('');
        updateSelectedCount();
        syncSelectAll();
    }

    function onRowClick(e) {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const key = btn.dataset.key;
        if (btn.dataset.act === 'mail') openEmailModal(key);
        if (btn.dataset.act === 'edit') openForm(decodeURIComponent(key));
        if (btn.dataset.act === 'delete') removeUser(decodeURIComponent(key));
    }

    /* ---------- Forma za dodavanje / izmenu ---------- */
    function ensureModal() {
        if ($('dmsUserModal')) return;
        const modal = document.createElement('div');
        modal.className = 'modal-overlay dms-modal';
        modal.id = 'dmsUserModal';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal-window">
                <div class="modal-top">
                    <div class="modal-title-wrap">
                        <div class="yellow-icon-square-sm"><i data-lucide="user-plus"></i></div>
                        <h5 id="userFormTitle">Novi korisnik</h5>
                    </div>
                    <button type="button" class="modal-close-icon" id="dmsUserClose"><i data-lucide="x"></i></button>
                </div>
                <form id="dmsUserForm">
                    <div class="modal-body-content">
                        <input type="hidden" id="editOriginalName">
                        <div class="form-field"><label for="userInputName">Ime i prezime *</label><input type="text" id="userInputName" required class="form-text-input" placeholder="npr. Petar Petrović"></div>
                        <div class="form-field"><label for="userInputSector">Služba / sektor *</label><input type="text" id="userInputSector" required class="form-text-input" placeholder="npr. Računovodstvo"></div>
                        <div class="form-field"><label for="userInputEmail">E-mail</label><input type="email" id="userInputEmail" class="form-text-input" placeholder="ime.prezime@unipromet.co.rs"></div>
                        <div class="form-field"><label for="userInputLocation">Lokacija</label><input type="text" id="userInputLocation" class="form-text-input" placeholder="npr. ČA / KV"></div>
                        <label class="dms-check"><input type="checkbox" id="userInputIsKey"> <span>Ključni korisnik (prioritetno praćenje, prima mejlove službe)</span></label>
                    </div>
                    <div class="modal-bottom-actions">
                        <button type="button" class="btn-dark-sm" id="dmsUserCancel"><span>Otkaži</span></button>
                        <button type="submit" class="btn-yellow-solid-sm" id="btnUserSubmit"><i data-lucide="save"></i><span>Sačuvaj</span></button>
                    </div>
                </form>
            </div>`;
        document.body.appendChild(modal);
        $('dmsUserClose').addEventListener('click', closeForm);
        $('dmsUserCancel').addEventListener('click', closeForm);
        $('dmsUserForm').addEventListener('submit', submitForm);
    }

    function openForm(key) {
        if (!canEdit()) { dmsNotify('Nemate dozvolu za izmenu korisnika.', 'error'); return; }
        ensureModal();
        const u = key ? USERS[key] : null;
        $('editOriginalName').value = key || '';
        $('userInputName').value = u ? (u.name || key) : '';
        $('userInputEmail').value = u ? (u.email || '') : '';
        $('userInputSector').value = u ? (u.sector || '') : '';
        $('userInputLocation').value = u ? (u.location || '') : '';
        $('userInputIsKey').checked = u ? Boolean(u.isKeyUser) : false;
        $('userFormTitle').textContent = u ? `Izmena korisnika: ${u.name || key}` : 'Novi korisnik';
        $('dmsUserModal').style.display = 'flex';
        $('userInputName').focus();
    }

    function closeForm() {
        const m = $('dmsUserModal');
        if (m) m.style.display = 'none';
    }

    async function submitForm(e) {
        e.preventDefault();
        const original = $('editOriginalName').value;
        const payload = {
            name: $('userInputName').value.trim(),
            email: $('userInputEmail').value.trim(),
            sector: $('userInputSector').value.trim(),
            location: $('userInputLocation').value.trim(),
            isKeyUser: $('userInputIsKey').checked
        };
        if (!payload.name || !payload.sector) { dmsNotify('Ime i služba su obavezna polja.', 'error'); return; }
        try {
            if (original) {
                await dmsApi('/api/dms/users/' + encodeURIComponent(original), { ...dmsJson(payload), method: 'PUT' });
            } else {
                await dmsApi('/api/dms/users', dmsJson(payload));
            }
            await loadUsersDatabase();
            closeForm();
            renderTable();
            dmsNotify('Korisnik je sačuvan.', 'success');
            // Analitika koristi iste podatke (značke službe i ključnih korisnika)
            if (uploadedFiles && uploadedFiles.length >= 1) executeComparison();
        } catch (err) {
            dmsNotify('Čuvanje nije uspelo: ' + err.message, 'error');
        }
    }

    async function removeUser(key) {
        if (!canEdit()) { dmsNotify('Nemate dozvolu za izmenu korisnika.', 'error'); return; }
        if (!confirm(`Da li ste sigurni da želite da obrišete korisnika "${key}" iz baze?`)) return;
        try {
            await dmsApi('/api/dms/users/' + encodeURIComponent(key), { method: 'DELETE' });
            selectedUsersForEmail.delete(key);
            await loadUsersDatabase();
            renderTable();
            if (uploadedFiles && uploadedFiles.length >= 1) executeComparison();
        } catch (err) {
            dmsNotify('Brisanje nije uspelo: ' + err.message, 'error');
        }
    }

    window.DmsUsersPage = {
        onTabActivated() {
            build();
            renderTable();
        }
    };
})();
