/**
 * Stranicenje tabela u DMS sekciji.
 * Svaka tabela u DMS sekciji dobija platformski izgled (inv-table-wrapper / inv-camera-table) i traku
 * sa stranicama ispod. Redovi van trenutne strane dobijaju atribut hidden, pa pregledač ne iscrtava
 * stotine redova odjednom (glavni uzrok laga pri skrolovanju).
 * Filter pretrage (filterTableRows) koristi style.display; stranicenje ga poštuje i računa samo vidljive redove.
 */
(function () {
    const PAGE_SIZES = [25, 50, 100];
    const DEFAULT_SIZE = 50;

    const tableState = new WeakMap(); // table -> { page, size }
    const observedBodies = new WeakSet();
    const pendingTables = new Set();
    let scheduled = false;

    const isInDms = (el) => !!(el && el.closest && el.closest('.dms-root, .dms-modal'));

    // Red sa podacima (ne prazna poruka sa colspan) i nije sakriven filterom pretrage
    function isDataRow(row) {
        const cells = row.cells;
        if (cells.length === 0) return false;
        if (cells.length === 1 && Number(cells[0].colSpan) > 1) return false;
        return true;
    }

    function passesFilter(row) {
        return row.style.display !== 'none';
    }

    function tbodyOf(table) {
        return table.tBodies[0] || null;
    }

    // Omotač: tabela dobija platformski izgled, a stranicenje ide odmah posle omotača
    function ensureWrapper(table) {
        table.classList.add('inv-camera-table');
        if (table.parentNode && table.parentNode.classList && table.parentNode.classList.contains('inv-table-wrapper')) return table.parentNode;
        const wrap = document.createElement('div');
        wrap.className = 'inv-table-wrapper dms-table-frame';
        table.parentNode.insertBefore(wrap, table);
        wrap.appendChild(table);
        return wrap;
    }

    // Blok koji se skroluje oko tabele (npr. .dms-podaci-scroll ili omotač tabele)
    const SCROLL_CLASSES = /(^| )(dms-podaci-scroll|dms-table-wrap|inv-table-wrapper|ar-scroll-box|dms-scroll)( |$)/;
    function isScrollBox(el) {
        if (SCROLL_CLASSES.test(el.className || '')) return true;
        if (el.classList.contains('dms-panel')) return false;
        const cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
        return !!cs && /auto|scroll|hidden/.test(cs.overflowY);
    }
    // Najspoljniji blok koji se skroluje u kome je tabela (do korena DMS sekcije)
    function outerScrollHost(el) {
        let host = el;
        let p = el.parentElement;
        while (p && !p.classList.contains('dms-root') && !p.classList.contains('dms-modal') && p.tagName !== 'BODY') {
            if (isScrollBox(p)) host = p;
            p = p.parentElement;
        }
        return host;
    }

    // Traka sa stranicama je IZNAD svih skrolujućih blokova oko tabele, pa je uvek na dohvat bez skrolovanja
    function pagerFor(wrap) {
        const host = outerScrollHost(wrap);
        let prev = host.previousElementSibling;
        if (prev && prev.classList.contains('dms-pager')) return prev;
        const pager = document.createElement('div');
        pager.className = 'dms-pager dms-row-wrap';
        pager.innerHTML =
            '<span class="dms-pager-info"></span>' +
            '<span class="dms-grow"></span>' +
            '<label class="dms-pager-size">Po strani ' +
            '<select>' + PAGE_SIZES.map(n => `<option value="${n}">${n}</option>`).join('') + '</select></label>' +
            '<button type="button" class="dms-btn-xs" data-pg="prev">&lsaquo; Prethodna</button>' +
            '<span class="dms-pager-page"></span>' +
            '<button type="button" class="dms-btn-xs" data-pg="next">Sledeća &rsaquo;</button>';
        host.parentNode.insertBefore(pager, host);
        return pager;
    }

    function paginate(table) {
        const tbody = tbodyOf(table);
        if (!tbody) return;
        const wrap = ensureWrapper(table);
        const pager = pagerFor(wrap);
        const st = tableState.get(table) || { page: 1, size: DEFAULT_SIZE };
        tableState.set(table, st);

        const rows = Array.from(tbody.rows);
        const data = rows.filter(r => isDataRow(r) && passesFilter(r));
        const total = data.length;
        const pages = Math.max(1, Math.ceil(total / st.size));
        if (st.page > pages) st.page = pages;
        if (st.page < 1) st.page = 1;
        const start = (st.page - 1) * st.size;
        const end = start + st.size;

        // Redovi van stranice se sakrivaju; prazne poruke i redovi filtera ostaju kako jesu
        let index = 0;
        for (const r of rows) {
            if (!isDataRow(r)) { r.hidden = false; continue; }
            if (!passesFilter(r)) { r.hidden = false; continue; }
            r.hidden = !(index >= start && index < end);
            index++;
        }

        const info = pager.querySelector('.dms-pager-info');
        const pageLabel = pager.querySelector('.dms-pager-page');
        const prev = pager.querySelector('[data-pg="prev"]');
        const nextBtn = pager.querySelector('[data-pg="next"]');
        const sizeSel = pager.querySelector('select');
        pager.dataset.table = '1';
        pager.hidden = total <= PAGE_SIZES[0];
        if (!pager.hidden) {
            const from = total ? start + 1 : 0;
            const to = Math.min(end, total);
            info.textContent = `Prikaz ${from}–${to} od ${total}`;
            pageLabel.textContent = `Strana ${st.page} / ${pages}`;
            prev.disabled = st.page <= 1;
            nextBtn.disabled = st.page >= pages;
            sizeSel.value = String(st.size);
        }
        pager._pgTable = table;
    }

    function observeBody(table) {
        const tbody = tbodyOf(table);
        if (!tbody || observedBodies.has(tbody)) return;
        observedBodies.add(tbody);
        // Novi redovi (renderer je zamenio sadržaj) i promena filtera pretrage (style na redu)
        new MutationObserver(() => queue(table)).observe(tbody, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    }

    function enhance(table) {
        if (!isInDms(table)) return;
        ensureWrapper(table);
        observeBody(table);
        paginate(table);
    }

    function flush() {
        scheduled = false;
        const list = Array.from(pendingTables);
        pendingTables.clear();
        list.forEach(t => { if (t.isConnected) enhance(t); });
    }

    function queue(table) {
        pendingTables.add(table);
        if (!scheduled) {
            scheduled = true;
            requestAnimationFrame(flush);
        }
    }

    // Klik na strelice i promena veličine strane
    document.addEventListener('click', (e) => {
        const btn = e.target.closest && e.target.closest('.dms-pager [data-pg]');
        if (!btn) return;
        const pager = btn.closest('.dms-pager');
        const table = pager && pager._pgTable;
        if (!table) return;
        const st = tableState.get(table);
        st.page += btn.dataset.pg === 'next' ? 1 : -1;
        paginate(table);
    });
    document.addEventListener('change', (e) => {
        const sel = e.target.closest && e.target.closest('.dms-pager select');
        if (!sel) return;
        const pager = sel.closest('.dms-pager');
        const table = pager && pager._pgTable;
        if (!table) return;
        const st = tableState.get(table);
        st.size = Number(sel.value) || DEFAULT_SIZE;
        st.page = 1;
        paginate(table);
    });

    // Novi prikazi se dodaju u DOM (tabovi, pretraga, učitavanje izveštaja): pratimo tabele u DMS sekciji
    new MutationObserver((mutations) => {
        for (const m of mutations) {
            const target = m.target;
            if (target.nodeType === 1 && target.closest && target.closest('.dms-pager')) continue;
            // Promene van DMS sekcije (ostatak platforme ima svoje česte promene) se ne proveravaju
            const targetInDms = target.nodeType === 1 && isInDms(target);
            if (!targetInDms) continue;
            for (const n of m.addedNodes) {
                if (n.nodeType !== 1) continue;
                if (n.tagName === 'TABLE') { if (isInDms(n)) queue(n); }
                else if (n.querySelectorAll) n.querySelectorAll('table').forEach(t => { if (isInDms(t)) queue(t); });
            }
            if (target.nodeType === 1 && (target.tagName === 'TBODY' || target.tagName === 'TR')) {
                const table = target.closest('table');
                if (table && isInDms(table)) queue(table);
            }
        }
    }).observe(document.body, { childList: true, subtree: true });

    window.dmsEnhanceTables = (root) => {
        (root || document).querySelectorAll('table').forEach(t => { if (isInDms(t)) queue(t); });
    };
})();
