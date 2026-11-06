/**
 * Dugme "Raširi" na svakoj tabeli DMS sekcije: tabela se prikazuje preko celog ekrana.
 * Tabela se premešta u overlay (bez kloniranja, pa svi event listeneri i filteri rade),
 * a pri zatvaranju se vraća na isto mesto. Zatvara se dugmetom ili tasterom Esc.
 */
(function () {
    let overlay = null;
    let active = null; // { table, marker }

    function ensureOverlay() {
        if (overlay) return overlay;

        overlay = document.createElement('div');
        overlay.className = 'dms-modal dms-fs-overlay dms-hidden';
        overlay.innerHTML = `
            <div class="dms-fs-head">
                <span class="dms-fs-title"><i data-lucide="table"></i> Pregled tabele</span>
                <button type="button" data-fs-close class="btn-dark-sm"><i data-lucide="minimize-2"></i><span>Zatvori (Esc)</span></button>
            </div>
            <div class="dms-fs-body"></div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('[data-fs-close]').addEventListener('click', close);
        return overlay;
    }

    function open(table) {
        if (active) close();

        const ov = ensureOverlay();
        const marker = document.createComment('fs-marker');
        table.parentNode.insertBefore(marker, table);
        ov.querySelector('.dms-fs-body').appendChild(table);

        ov.classList.remove('dms-hidden');
        document.body.classList.add('dms-no-scroll');
        active = { table, marker };
    }

    function close() {
        if (!active) return;

        active.marker.parentNode.insertBefore(active.table, active.marker);
        active.marker.remove();

        overlay.classList.add('dms-hidden');
        document.body.classList.remove('dms-no-scroll');
        active = null;
    }

    // Traži naslovnu traku (red sa naslovom levo i kontrolama desno) iznad wrapper-a tabele.
    // Preskače međusobne redove (npr. legendu) i staje na prvom elementu koji sadrži tabelu.
    function findHeaderRow(wrapper) {
        let sib = wrapper.previousElementSibling;
        for (let i = 0; sib && i < 3; i++, sib = sib.previousElementSibling) {
            if (sib.querySelector('table')) break;
            // Naslovna traka je red (flex) sa razmakom između naslova i kontrola; klase se razlikuju po prikazu
            const cs = getComputedStyle(sib);
            if (cs.display === 'flex' && cs.justifyContent === 'space-between' && sib.children.length >= 1) return sib;
        }
        return null;
    }

    function addButton(table) {
        if (table.dataset.fsReady || !table.parentNode) return;
        // Samo tabele DMS sekcije (ne ostatak platforme); pregled podsetnika je za štampu pa ostaje bez dugmeta
        if (!table.closest('.dms-root') || table.closest('.dms-paper')) return;
        table.dataset.fsReady = '1';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dms-btn-xs dms-fs-open';
        btn.innerHTML = '<i data-lucide="maximize-2"></i> Raširi';
        btn.addEventListener('click', () => open(table));

        // Ako tabela ima naslovnu traku iznad wrapper-a, desni deo trake (npr. "Ukupno") i dugme
        // idu u zajednički blok skroz desno, pa naslov ostaje odvojen od njih
        const header = findHeaderRow(table.parentNode);
        if (header) {
            const group = document.createElement('div');
            group.className = 'dms-row dms-fs-group';
            Array.from(header.children).slice(1).forEach(child => group.appendChild(child));
            group.appendChild(btn);
            header.appendChild(group);
        } else {
            btn.classList.add('dms-fs-open-solo');
            table.parentNode.insertBefore(btn, table);
        }
    }

    function scan(root) {
        root.querySelectorAll('table').forEach(addButton);
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close();
    });

    // Tabele se dinamički renderuju (tabovi, pretraga, učitavanje fajlova), pa pratimo nove čvorove
    new MutationObserver((mutations) => {
        mutations.forEach((m) => {
            // Samo promene unutar DMS sekcije (ostatak platforme se često menja i ne sme da plaća ovu proveru)
            const t = m.target;
            if (!(t.nodeType === 1 && t.closest && t.closest('.dms-root, .dms-modal'))) return;
            m.addedNodes.forEach((n) => {
                if (n.nodeType !== 1) return;
                if (n.tagName === 'TABLE') addButton(n);
                else scan(n);
            });
        });
    }).observe(document.body, { childList: true, subtree: true });

    scan(document);
})();
