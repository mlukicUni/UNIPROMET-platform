/**
 * Renderuje analizu za izabrani tab
 */
function renderMultiSheetAnalysis(sheetName) {
    const container = document.createElement('div');
    container.className = "dms-stack";

    if (sheetName === 'Podaci') {
        const infoBox = document.createElement('div');
        infoBox.className = "dms-panel dms-spread";
        infoBox.innerHTML = `
            <div>
                <h4 class="dms-title">${SHEET_TAB_LABELS[sheetName] || sheetName}</h4>
                <p class="dms-subtitle">Analiza podataka kroz <strong>${uploadedFiles.length}</strong> vremenskih tačaka</p>
            </div>
            <div class="dms-small dms-text-muted">
                Hronološko praćenje promene i zastoja u radu sa dokumentima
            </div>
        `;
        container.appendChild(infoBox);
        container.appendChild(renderAktivnostKorisnikaInterval());
        container.appendChild(analyzeMultiPodaciSheet());
    } else if (sheetName === 'Kreirani dokumenti po sektorima') {
        container.appendChild(renderSystemUserToggle());
        container.appendChild(renderKreiraniDokumentiPoSektorimaTab());
    } else if (sheetName === 'Nagle Oscilacije po Mesecima') {
        container.appendChild(renderSystemUserToggle());
        container.appendChild(renderNagleOscilacijeTab());
    } else if (sheetName === 'SEF statusi') {
        container.appendChild(renderSefOverview());
    } else if (sheetName === 'Vrste dokumenata') {
        container.appendChild(renderDocTypesOverview());
    } else if (sheetName === 'Zaposleni') {
        container.appendChild(renderSystemUserToggle());
        container.appendChild(renderEmployeesOverview());
    } else if (sheetName === 'Ispravnost dokumentacije') {
        // Poreklo se bira u podmeniju levog menija; prikazuje se samo jedan blok
        const slot = document.createElement('div');
        correctnessShow = origin => {
            correctnessOrigin = origin;
            slot.replaceChildren(renderCorrectnessOverview(origin));
            markCorrectnessOrigin();
        };
        container.appendChild(slot);
        correctnessShow(correctnessOrigin);
    } else {
        container.appendChild(renderMultiGenericOverview(sheetName));
    }

    return container;
}


/**
 * Pomoćna funkcija za pametno parsiranje redova i pronalaženje kolone sa imenom korisnika
 */
// aoa: sirovi 2D redovi lista (kad su dostupni); tada se radni list ne pravi
function parseSheetRowsWithSmartUser(sheet, aoa = null) {
    if (!sheet && !aoa) return { rows: [], userKey: 'Korisnik' };

    const raw2D = aoa || XLSX.utils.sheet_to_json(sheet, { header: 1 });
    let headerRowIdx = 0;
    let foundUserKey = null;

    for (let r = 0; r < Math.min(10, raw2D.length); r++) {
        const row = raw2D[r] || [];
        for (let c = 0; c < row.length; c++) {
            const cellVal = String(row[c] || '').trim();
            if (/korisnik|kreator|kreirao|vlasnik|zaposleni|radnik|operator|osoba|unio|uneo|ime/i.test(cellVal)) {
                headerRowIdx = r;
                foundUserKey = cellVal;
                break;
            }
        }
        if (foundUserKey) break;
    }

    const rows = aoa ? rowsFromAoa(aoa.slice(headerRowIdx)) : XLSX.utils.sheet_to_json(sheet, { range: headerRowIdx });
    
    if (!foundUserKey && rows.length > 0) {
        const sampleRow = rows[0] || {};
        foundUserKey = Object.keys(sampleRow).find(k => 
            /korisnik|kreator|kreirao|vlasnik|zaposleni|radnik|operator|osoba|unio|uneo/i.test(k)
        ) || Object.keys(sampleRow)[0] || 'Korisnik';
    }

    return { rows, userKey: foundUserKey || 'Korisnik' };
}

/**
 * Tab "Aktivnost korisnika" (ranije "Podaci"): samo poslednji interval i samo smanjenja zadataka po korisniku.
 * Zadatak je dokument dodeljen korisniku (status „Dodeljeno …“) ili zaključan kod njega („Zaključao/la …“).
 * Povećanja i korisnici bez promene se ne prikazuju.
 */
function renderAktivnostKorisnikaInterval() {
    const div = document.createElement('div');
    div.className = "dms-stack";

    if (uploadedFiles.length < 2) {
        div.innerHTML = `<div class="dms-notice dms-center">Za poslednji interval potrebna su najmanje dva izveštaja.</div>`;
        return div;
    }

    const prevFile = uploadedFiles[uploadedFiles.length - 2];
    const currFile = uploadedFiles[uploadedFiles.length - 1];

    const isTaskStatus = st => /^(Dodeljeno|Zaključao)/i.test(st);
    const assigneeOf = st => st.replace(/^(Dodeljeno|Zaključao\/la|Zaključao)\s*/i, '').trim() || 'Nepoznat';

    const countTasks = fileItem => {
        const perUser = {};
        getPodaciRows(fileItem.workbook).forEach(r => {
            const st = String(r.Status || '').trim();
            if (!isTaskStatus(st)) return;
            const u = assigneeOf(st);
            perUser[u] = (perUser[u] || 0) + 1;
        });
        return perUser;
    };
    const prevTasks = countTasks(prevFile);
    const currTasks = countTasks(currFile);

    // Samo smanjenja: korisnici čiji broj zadataka nije opao se ne prikazuju
    const users = new Set([...Object.keys(prevTasks), ...Object.keys(currTasks)]);
    const down = [];
    users.forEach(u => {
        const prev = prevTasks[u] || 0;
        const curr = currTasks[u] || 0;
        const diff = curr - prev;
        if (diff < 0) down.push({ user: u, prev, curr, diff, pct: prev ? -diff / prev : 0 });
    });
    down.sort((a, b) => a.diff - b.diff || a.user.localeCompare(b.user, 'sr'));

    const totalPrev = Object.values(prevTasks).reduce((a, b) => a + b, 0);
    const totalDown = down.reduce((a, b) => a + Math.abs(b.diff), 0);
    const pctTotal = totalPrev ? Math.round((totalDown / totalPrev) * 100) : 0;
    const doneCount = down.filter(r => r.curr === 0).length;
    const withTasksPrev = Object.keys(prevTasks).length;

    const statCard = (icon, label, value, sub) => `
        <div class="dms-stat dms-podaci-kpi is-success">
            <div class="dms-podaci-icon-box"><i data-lucide="${icon}"></i></div>
            <div class="dms-grow">
                <div class="dms-stat-label">${label}</div>
                <div class="dms-stat-value">${value}</div>
                <div class="dms-stat-sub">${sub}</div>
            </div>
        </div>`;

    const cardsHtml = `
        <div class="dms-grid cols-4">
            ${statCard('trending-down', 'Smanjenje zadataka', `−${totalDown.toLocaleString()}`, `${pctTotal}% od ${totalPrev.toLocaleString()} zadataka na ${prevFile.dateFormatted}`)}
            ${statCard('users', 'Korisnika sa smanjenjem', `${down.length}`, `od ${withTasksPrev} sa zadacima na ${prevFile.dateFormatted}`)}
            ${statCard('check-circle', 'Bez zadataka', `${doneCount}`, 'korisnika je završilo sve zadatke')}
            ${statCard('trophy', 'Najveće smanjenje', down.length ? dmsEscapeHtml(down[0].user) : 'Nema', down.length ? `−${Math.abs(down[0].diff)} zadataka` : 'u ovom intervalu')}
        </div>`;

    const rowsHtml = down.map(r => {
        const barPct = Math.round(Math.min(100, r.pct * 100));
        const done = r.curr === 0;
        return `<tr>
            <td class="dms-strong dms-nowrap">${dmsEscapeHtml(r.user)}</td>
            <td class="dms-num dms-mono dms-text-muted">${r.prev.toLocaleString()}</td>
            <td class="dms-num dms-mono dms-strong">${r.curr.toLocaleString()}</td>
            <td class="dms-num dms-nowrap"><span class="dms-badge is-success"><i data-lucide="arrow-down"></i>${Math.abs(r.diff)}</span></td>
            <td class="dms-podaci-progress">
                <div class="dms-bar dms-podaci-bar"><span style="width:${barPct}%"></span></div>
                <div class="dms-caption dms-strong dms-text-success">−${barPct}%</div>
            </td>
            <td class="dms-nowrap">${done
                ? '<span class="dms-badge is-pill is-solid-success">Bez zadataka</span>'
                : '<span class="dms-badge is-pill is-success">Smanjen, još ima</span>'}</td>
        </tr>`;
    }).join('');

    const tableHtml = down.length
        ? `<div class="dms-panel is-flush">
            <div class="dms-panel-head dms-podaci-head is-success">
                <span class="dms-podaci-head-title"><i data-lucide="trending-down"></i> Korisnici sa smanjenjem zadataka</span>
                <span class="dms-podaci-head-note">${down.length} korisnika</span>
            </div>
            <div class="dms-podaci-scroll">
                <table class="dms-table is-compact is-sticky">
                    <thead>
                        <tr class="dms-th-row">
                            <th class="dms-nowrap">Korisnik</th>
                            <th class="dms-num dms-nowrap">${prevFile.dateFormatted}</th>
                            <th class="dms-num dms-nowrap">${currFile.dateFormatted}</th>
                            <th class="dms-num dms-nowrap">Smanjenje</th>
                            <th class="dms-nowrap">Napredak</th>
                            <th class="dms-nowrap">Stanje</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
        </div>`
        : `<div class="dms-notice dms-center">U ovom intervalu nema smanjenja zadataka.</div>`;

    div.innerHTML = `
        <div class="dms-stack-sm">
            <h4 class="dms-label dms-row">
                <i data-lucide="history" class="dms-text-warning"></i> Aktivnost korisnika: smanjenje zadataka (od ${prevFile.dateFormatted} do ${currFile.dateFormatted})
            </h4>
            ${cardsHtml}
        </div>
        ${tableHtml}
        <p class="dms-caption">Zadatak je dokument dodeljen korisniku (status „Dodeljeno“) ili zaključan kod njega (status „Zaključao/la“). Prikazana su samo smanjenja; korisnici kod kojih je broj zadataka porastao ili ostao isti nisu u listi.</p>
    `;
    return div;
}


/**
 * Tab "Podaci": Dve kolone promene na kraju tabele (Promena u poslednjem intervalu i Ukupna Promena od baznog do najnovijeg)
 */
function analyzeMultiPodaciSheet() {
    const div = document.createElement('div');
    div.className = "dms-stack";

    const oldestFile = uploadedFiles[0];
    const prevFile = uploadedFiles.length >= 2 ? uploadedFiles[uploadedFiles.length - 2] : uploadedFiles[0];
    const currFile = uploadedFiles[uploadedFiles.length - 1];

    const userMapPerFile = [];
    uploadedFiles.forEach(fileItem => {
        const podaciAoa = fileItem.workbook.rawSheets ? fileItem.workbook.rawSheets['Podaci'] : null;
        const parsed = podaciAoa
            ? parseSheetRowsWithSmartUser(null, podaciAoa)
            : parseSheetRowsWithSmartUser(fileItem.workbook.Sheets['Podaci']);
        const map = {};
        parsed.rows.forEach(r => {
            const user = String(r[parsed.userKey] || r['Korisnik'] || r['Zaposleni'] || 'Nepoznat Korisnik').trim();
            if (user && user !== 'undefined' && user !== 'null') {
                map[user] = (map[user] || 0) + 1;
            }
        });
        userMapPerFile.push(map);
    });

    const allUsersSet = new Set();
    userMapPerFile.forEach(map => Object.keys(map).forEach(u => allUsersSet.add(u)));

    const prevUserIdx = uploadedFiles.length >= 2 ? uploadedFiles.length - 2 : 0;
    const currUserIdx = uploadedFiles.length - 1;

    const userList = [];
    allUsersSet.forEach(user => {
        if (user === 'Nepoznat Korisnik' && allUsersSet.size > 1) return;
        const counts = userMapPerFile.map(map => map[user] || 0);
        const firstCount = counts[0];
        const prevCount = counts[prevUserIdx];
        const lastCount = counts[currUserIdx];

        userList.push({
            user: user,
            counts: counts,
            firstCount: firstCount,
            prevCount: prevCount,
            lastCount: lastCount,
            intervalDiff: lastCount - prevCount,
            overallDiff: lastCount - firstCount
        });
    });

    userList.sort((a, b) => b.intervalDiff - a.intervalDiff || b.overallDiff - a.overallDiff);

    const statusMapPerFile = [];
    const allStatusesSet = new Set();

    uploadedFiles.forEach(fileItem => {
        const rows = getPodaciRows(fileItem.workbook);
        const map = {};
        rows.forEach(r => {
            const st = r.Status || 'Nepoznat Status';
            map[st] = (map[st] || 0) + 1;
            allStatusesSet.add(st);
        });

        // 5 makro kategorija za ovaj period / izveštaj
        const total = rows.length;
        const arch = map['Arhivirano'] || 0;
        const del = map['Obrisano'] || 0;
        const dod = Object.entries(map).filter(([k]) => k.startsWith('Dodeljeno') || k.includes('Dodeljeno')).reduce((a, b) => a + b[1], 0);
        const zak = Object.entries(map).filter(([k]) => k.startsWith('Zaključao') || k.includes('Zaključao')).reduce((a, b) => a + b[1], 0);

        map['Ukupno dokumenata'] = total;
        map['Arhivirani dokumenti'] = arch;
        map['Dodeljeni dokumenti'] = dod;
        map['Zaključani dokumenti'] = zak;
        map['Obrisani dokumenti'] = del;
        map['obrisani dokumenti'] = del;

        statusMapPerFile.push(map);
    });

    const allStatuses = Array.from(allStatusesSet);
    const prevMapIdx = statusMapPerFile.length >= 2 ? statusMapPerFile.length - 2 : 0;
    const prevMap = statusMapPerFile[prevMapIdx];
    const lastMap = statusMapPerFile[statusMapPerFile.length - 1];

    // 1. Najveća promena u bilo kom periodu (poređenje svih parova datuma)
    let topBottleneckStatusPair = null;
    let topBottleneckValuePair = 0;
    let topBottleneckPairRange = '';

    let topReductionStatusPair = null;
    let topReductionValuePair = 0;
    let topReductionPairRange = '';

    // 2. Poslednji interval (od pretposlednjeg do najnovijeg)
    let topBottleneckStatusInterval = null;
    let topBottleneckValueInterval = -Infinity;
    let topReductionStatusInterval = null;
    let topReductionValueInterval = Infinity;

    allStatuses.forEach(st => {
        const prevVal = prevMap[st] || 0;
        const lastVal = lastMap[st] || 0;
        const diffInterval = lastVal - prevVal;

        const isBottleneckType = st.includes('Dodeljeno') || st.includes('Zaključao') || st.includes('Čeka') || st.includes('Nepovezan') || st.includes('Zastoj');
        
        if (isBottleneckType) {
            // Poređenje svih parova datuma
            for (let i = 0; i < uploadedFiles.length; i++) {
                for (let j = i + 1; j < uploadedFiles.length; j++) {
                    const valStart = statusMapPerFile[i][st] || 0;
                    const valEnd = statusMapPerFile[j][st] || 0;
                    const diff = valEnd - valStart;
                    const rangeLabel = `${uploadedFiles[i].dateFormatted} do ${uploadedFiles[j].dateFormatted}`;

                    if (diff > topBottleneckValuePair) {
                        topBottleneckValuePair = diff;
                        topBottleneckStatusPair = st;
                        topBottleneckPairRange = rangeLabel;
                    }
                    if (diff < topReductionValuePair) {
                        topReductionValuePair = diff;
                        topReductionStatusPair = st;
                        topReductionPairRange = rangeLabel;
                    }
                }
            }

            // Poslednji interval period
            if (diffInterval > topBottleneckValueInterval) {
                topBottleneckValueInterval = diffInterval;
                topBottleneckStatusInterval = st;
            }
            if (diffInterval < topReductionValueInterval) {
                topReductionValueInterval = diffInterval;
                topReductionStatusInterval = st;
            }
        }
    });

    const curReductionIntervalCount = topReductionStatusInterval ? (lastMap[topReductionStatusInterval] || 0) : 0;
    const curBottleneckIntervalCount = topBottleneckStatusInterval ? (lastMap[topBottleneckStatusInterval] || 0) : 0;
    const curReductionPairCount = topReductionStatusPair ? (lastMap[topReductionStatusPair] || 0) : 0;
    const curBottleneckPairCount = topBottleneckStatusPair ? (lastMap[topBottleneckStatusPair] || 0) : 0;

    let highlightHtml = `
        <div class="dms-grid cols-2">
            <div class="dms-panel is-success dms-podaci-highlight">
                <div class="dms-podaci-highlight-main">
                    <div class="dms-podaci-icon-box is-large">
                        <i data-lucide="zap"></i>
                    </div>
                    <div class="dms-stack-xs">
                        <span class="dms-label dms-text-success">Najveće smanjenje zastoja u poslednjem intervalu</span>
                        <h4 class="dms-podaci-highlight-title">${topReductionStatusInterval || 'Nema smanjenja zastoja'}</h4>
                        <p class="dms-small dms-text-muted">
                            Smanjenje zastoja (od ${prevFile.dateFormatted} do ${currFile.dateFormatted}): <strong class="dms-text-success">${topReductionValueInterval < 0 ? topReductionValueInterval.toLocaleString() : '0'} dokumenata</strong>
                        </p>
                        <p class="dms-row dms-small dms-strong">
                            <i data-lucide="file-check" class="dms-text-success"></i>
                            <span>Trenutno nezavršenih dokumenata: <strong class="dms-badge is-success">${curReductionIntervalCount.toLocaleString()}</strong></span>
                        </p>
                    </div>
                </div>
                <div class="dms-podaci-state">
                    <span class="dms-podaci-state-label">Trenutno stanje</span>
                    <span class="dms-podaci-state-value">${curReductionIntervalCount.toLocaleString()} <span class="dms-podaci-state-unit">dok.</span></span>
                </div>
            </div>
            <div class="dms-panel is-success dms-podaci-highlight">
                <div class="dms-podaci-highlight-main">
                    <div class="dms-podaci-icon-box is-large">
                        <i data-lucide="check-circle"></i>
                    </div>
                    <div class="dms-stack-xs">
                        <span class="dms-label dms-text-success">Najveće smanjenje zastoja (najbolji učinak)</span>
                        <h4 class="dms-podaci-highlight-title">${topReductionStatusPair || 'Nema smanjenja zastoja'}</h4>
                        <p class="dms-small dms-text-muted">
                            Smanjenje zastoja (${topReductionPairRange || oldestFile.dateFormatted + ' do ' + currFile.dateFormatted}): <strong class="dms-text-success">${topReductionValuePair < 0 ? topReductionValuePair.toLocaleString() : '0'} dokumenata</strong>
                        </p>
                        <p class="dms-row dms-small dms-strong">
                            <i data-lucide="file-check" class="dms-text-success"></i>
                            <span>Trenutno nezavršenih dokumenata: <strong class="dms-badge is-success">${curReductionPairCount.toLocaleString()}</strong></span>
                        </p>
                    </div>
                </div>
                <div class="dms-podaci-state">
                    <span class="dms-podaci-state-label">Trenutno stanje</span>
                    <span class="dms-podaci-state-value">${curReductionPairCount.toLocaleString()} <span class="dms-podaci-state-unit">dok.</span></span>
                </div>
            </div>
        </div>
    `;

    const growthStatuses = allStatuses.filter(st => st === 'Arhivirano' || st === 'Obrisano' || (!st.includes('Dodeljeno') && !st.includes('Zaključao') && !st.includes('Čeka') && !st.includes('Nepovezan') && !st.includes('Zastoj')));
    const bottleneckStatuses = allStatuses.filter(st => st !== 'Arhivirano' && st !== 'Obrisano' && (st.includes('Dodeljeno') || st.includes('Zaključao') || st.includes('Čeka') || st.includes('Nepovezan') || st.includes('Zastoj')));

    allStatuses.forEach(st => {
        if (!growthStatuses.includes(st) && !bottleneckStatuses.includes(st)) {
            bottleneckStatuses.push(st);
        }
    });

    function getMaxPairAbsChange(st) {
        let maxAbs = 0;
        for (let i = 0; i < uploadedFiles.length; i++) {
            for (let j = i + 1; j < uploadedFiles.length; j++) {
                const valStart = statusMapPerFile[i][st] || 0;
                const valEnd = statusMapPerFile[j][st] || 0;
                const absDiff = Math.abs(valEnd - valStart);
                if (absDiff > maxAbs) {
                    maxAbs = absDiff;
                }
            }
        }
        return maxAbs;
    }

    growthStatuses.sort((a, b) => {
        const maxA = getMaxPairAbsChange(a);
        const maxB = getMaxPairAbsChange(b);
        if (maxB !== maxA) return maxB - maxA;
        return (lastMap[b] || 0) - (lastMap[a] || 0);
    });

    bottleneckStatuses.sort((a, b) => {
        const maxA = getMaxPairAbsChange(a);
        const maxB = getMaxPairAbsChange(b);
        if (maxB !== maxA) return maxB - maxA;
        return (lastMap[b] || 0) - (lastMap[a] || 0);
    });

    // RENDER STATUS TABLE SA DVE ZASEBNE KOLONE PROMENE
    // headerTone: ton zaglavlja okvira (is-danger / is-success); iconName: naziv lucide ikone
    function renderStatusTable(title, iconName, headerTone, statuses, isBottleneckTable = false, isMacroTable = false) {
        const prevIdx = Math.max(0, uploadedFiles.length - 2);
        const prevDateStr = uploadedFiles[prevIdx].dateFormatted;
        const currDateStr = currFile.dateFormatted;
        const oldestDateStr = oldestFile.dateFormatted;

        let html = `
            <div class="dms-panel is-flush">
                <div class="dms-panel-head dms-podaci-head ${headerTone}">
                    <span class="dms-podaci-head-title"><i data-lucide="${iconName}"></i> ${title}</span>
                    <span class="dms-podaci-head-note">Ukupno: ${statuses.length}</span>
                </div>
                <div class="dms-podaci-scroll">
                    <table class="dms-table is-compact is-sticky">
                        <thead>
                            <tr class="dms-th-row">
                                <th class="dms-nowrap">${isMacroTable ? 'Kategorija Dokumenta' : 'Status Dokumenta'}</th>
        `;

        uploadedFiles.forEach(f => {
            html += `<th class="dms-num dms-nowrap">${f.dateFormatted}</th>`;
        });

        // Kolona "Promena od prethodnog do najnovijeg" - samo ako ima bar 2 fajla
        const showPrevToCurrCol = uploadedFiles.length >= 2;
        if (showPrevToCurrCol) {
            html += `<th class="dms-num dms-nowrap dms-podaci-col-change">Promena<span class="dms-podaci-th-sub">(${prevDateStr}➔${currDateStr})</span></th>`;
        }

        html += `
                                <th class="dms-nowrap dms-podaci-col-interval">Najveća Promena<span class="dms-podaci-th-sub">(svi periodi)</span></th>
                                <th class="dms-nowrap dms-podaci-col-stall">Zastoj<span class="dms-podaci-th-sub">(max interval)</span></th>
                                <th class="dms-nowrap dms-podaci-col-progress">Napredak<span class="dms-podaci-th-sub">(max interval)</span></th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        if (statuses.length === 0) {
            html += `<tr><td colspan="${uploadedFiles.length + (showPrevToCurrCol ? 6 : 5)}" class="dms-center dms-text-dim dms-italic">Nema podataka u ovoj tabeli.</td></tr>`;
        } else {
            // Prvi prolaz: Izračunavanje vrednosti za sve statuse kako bi se odredili Najbolji i Najgori učinak po koloni
            const rowDataList = statuses.map(st => {
                const firstVal = statusMapPerFile[0][st] || 0;
                const lastVal = lastMap[st] || 0;
                const overallDiff = lastVal - firstVal;

                const prevVal = showPrevToCurrCol ? (statusMapPerFile[prevIdx][st] || 0) : 0;
                const currVal = lastVal;
                const prevToCurrDiff = showPrevToCurrCol ? (currVal - prevVal) : 0;

                // Najveća promena u bilo kom periodu (najveći absDiff)
                let maxPairChange = null;
                for (let i = 0; i < uploadedFiles.length; i++) {
                    for (let j = i + 1; j < uploadedFiles.length; j++) {
                        const dStart = uploadedFiles[i].dateFormatted;
                        const dEnd = uploadedFiles[j].dateFormatted;
                        const valStart = statusMapPerFile[i][st] || 0;
                        const valEnd = statusMapPerFile[j][st] || 0;
                        const diff = valEnd - valStart;
                        const absDiff = Math.abs(diff);
                        const rangeLabel = `${dStart}➔${dEnd}`;
                        if (diff === 0) continue;
                        if (!maxPairChange || absDiff > maxPairChange.absDiff) {
                            maxPairChange = { diff, absDiff, rangeLabel };
                        }
                    }
                }

                // Zastoj i napredak po intervalima
                let maxBottleneckInv = null;
                let maxProgressInv = null;
                const isBottleneckRow = isBottleneckTable || (isMacroTable && (st === 'Dodeljeni dokumenti' || st === 'Zaključani dokumenti'));

                for (let k = 0; k < uploadedFiles.length - 1; k++) {
                    const dStart = uploadedFiles[k].dateFormatted;
                    const dEnd = uploadedFiles[k + 1].dateFormatted;
                    const valStart = statusMapPerFile[k][st] || 0;
                    const valEnd = statusMapPerFile[k + 1][st] || 0;
                    const diff = valEnd - valStart;
                    const rangeLabel = `${dStart}➔${dEnd}`;
                    if (diff === 0) continue;

                    if (isBottleneckRow) {
                        if (diff > 0) {
                            if (!maxBottleneckInv || diff > maxBottleneckInv.diff) maxBottleneckInv = { diff, rangeLabel };
                        } else if (diff < 0) {
                            if (!maxProgressInv || diff < maxProgressInv.diff) maxProgressInv = { diff, rangeLabel };
                        }
                    } else {
                        if (diff > 0) {
                            if (!maxProgressInv || diff > maxProgressInv.diff) maxProgressInv = { diff, rangeLabel };
                        } else if (diff < 0) {
                            if (!maxBottleneckInv || diff < maxBottleneckInv.diff) maxBottleneckInv = { diff, rangeLabel };
                        }
                    }
                }

                return {
                    st,
                    firstVal,
                    lastVal,
                    prevToCurrDiff,
                    overallDiff,
                    maxPairChange,
                    maxBottleneckInv,
                    maxProgressInv,
                    isBottleneckRow
                };
            });

            // Pronalaženje ekstremnih (Min i Max) vrednosti za svaku od 5 kolona
            let minPrevToCurr = Infinity, maxPrevToCurr = -Infinity;
            let minOverall = Infinity, maxOverall = -Infinity;
            let minMaxPairAbs = Infinity, maxMaxPairAbs = -Infinity;
            let minBottleneck = Infinity, maxBottleneck = -Infinity;
            let minProgressAbs = Infinity, maxProgressAbs = -Infinity;

            rowDataList.forEach(r => {
                if (showPrevToCurrCol) {
                    if (r.prevToCurrDiff < minPrevToCurr) minPrevToCurr = r.prevToCurrDiff;
                    if (r.prevToCurrDiff > maxPrevToCurr) maxPrevToCurr = r.prevToCurrDiff;
                }
                if (r.overallDiff < minOverall) minOverall = r.overallDiff;
                if (r.overallDiff > maxOverall) maxOverall = r.overallDiff;

                if (r.maxPairChange) {
                    if (r.maxPairChange.absDiff < minMaxPairAbs) minMaxPairAbs = r.maxPairChange.absDiff;
                    if (r.maxPairChange.absDiff > maxMaxPairAbs) maxMaxPairAbs = r.maxPairChange.absDiff;
                }

                if (r.maxBottleneckInv) {
                    const absB = Math.abs(r.maxBottleneckInv.diff);
                    if (absB < minBottleneck) minBottleneck = absB;
                    if (absB > maxBottleneck) maxBottleneck = absB;
                }

                if (r.maxProgressInv) {
                    const absP = Math.abs(r.maxProgressInv.diff);
                    if (absP < minProgressAbs) minProgressAbs = absP;
                    if (absP > maxProgressAbs) maxProgressAbs = absP;
                }
            });

            // Drugi prolaz: Generisanje HTML-a sa svetlim bojama za sve + tamnim bojama za ekstremne rezultate
            rowDataList.forEach(r => {
                const st = r.st;
                const overallDiff = r.overallDiff;
                const isBottleneckRow = r.isBottleneckRow;

                let titleHtml = st;
                if (isMacroTable) {
                    if (st === 'Ukupno dokumenata') {
                        titleHtml = `<span class="dms-podaci-label is-info"><i data-lucide="files"></i> Ukupno dokumenata</span>`;
                    } else if (st === 'Arhivirani dokumenti') {
                        titleHtml = `<span class="dms-podaci-label is-success"><i data-lucide="archive"></i> Arhivirani dokumenti</span>`;
                    } else if (st === 'Dodeljeni dokumenti') {
                        titleHtml = `<span class="dms-podaci-label is-warning"><i data-lucide="clock"></i> Dodeljeni dokumenti</span>`;
                    } else if (st === 'Zaključani dokumenti') {
                        titleHtml = `<span class="dms-podaci-label is-danger"><i data-lucide="lock"></i> Zaključani dokumenti</span>`;
                    } else if (st === 'Obrisani dokumenti' || st === 'obrisani dokumenti') {
                        titleHtml = `<span class="dms-podaci-label is-muted"><i data-lucide="trash-2"></i> Obrisani dokumenti</span>`;
                    }
                }

                html += `<tr>`;
                html += `<td class="dms-strong dms-nowrap" title="${st}">${titleHtml}</td>`;

                statusMapPerFile.forEach(map => {
                    const count = map[st] || 0;
                    html += `<td class="dms-num dms-mono dms-strong">${count.toLocaleString()}</td>`;
                });

                // 1. Kolona: Promena (prev do curr)
                let prevToCurrHtml = '';
                if (showPrevToCurrCol) {
                    const prevToCurrDiff = r.prevToCurrDiff;
                    const prevToCurrText = prevToCurrDiff > 0 ? `+${prevToCurrDiff.toLocaleString()}` : prevToCurrDiff.toLocaleString();
                    const prevToCurrIcon = prevToCurrDiff > 0 ? '<i data-lucide="arrow-up"></i>' : (prevToCurrDiff < 0 ? '<i data-lucide="arrow-down"></i>' : '');

                    const isMaxVal = (prevToCurrDiff === maxPrevToCurr && maxPrevToCurr !== minPrevToCurr);
                    const isMinVal = (prevToCurrDiff === minPrevToCurr && maxPrevToCurr !== minPrevToCurr);

                    // Ton ćelije: is-success (dobro), is-danger (loše); is-peak = ekstremna vrednost kolone
                    let bgStyle = '';
                    if (prevToCurrDiff !== 0) {
                        if (isBottleneckRow) {
                            // Zastoj: raste = loše, opada = dobro
                            if (prevToCurrDiff > 0) {
                                bgStyle = isMaxVal ? 'is-danger is-peak' : 'is-danger';
                            } else {
                                bgStyle = isMinVal ? 'is-success is-peak' : 'is-success';
                            }
                        } else {
                            // Napredak: raste = dobro, opada = loše
                            if (prevToCurrDiff > 0) {
                                bgStyle = isMaxVal ? 'is-success is-peak' : 'is-success';
                            } else {
                                bgStyle = isMinVal ? 'is-danger is-peak' : 'is-danger';
                            }
                        }
                    }

                    prevToCurrHtml = `<td class="dms-num dms-mono dms-nowrap dms-podaci-delta dms-podaci-col-change ${bgStyle}">${prevToCurrIcon}${prevToCurrText}</td>`;
                }

                // 2. Kolona: Najveća Promena u Bilo Kom Periodu
                let maxPairHtml = '<span class="dms-text-dim">-</span>';
                if (r.maxPairChange) {
                    const sign = r.maxPairChange.diff > 0 ? `+${r.maxPairChange.diff}` : r.maxPairChange.diff;
                    const isMaxAbs = (r.maxPairChange.absDiff === maxMaxPairAbs && maxMaxPairAbs !== minMaxPairAbs);

                    let bgBadge = '';
                    let icon = r.maxPairChange.diff > 0 ? 'arrow-up' : 'arrow-down';

                    if (isBottleneckRow) {
                        if (r.maxPairChange.diff > 0) {
                            bgBadge = isMaxAbs ? 'is-solid-danger' : 'is-danger';
                        } else {
                            bgBadge = isMaxAbs ? 'is-solid-success' : 'is-success';
                        }
                    } else {
                        if (r.maxPairChange.diff > 0) {
                            bgBadge = isMaxAbs ? 'is-solid-success' : 'is-success';
                        } else {
                            bgBadge = isMaxAbs ? 'is-solid-danger' : 'is-danger';
                        }
                    }

                    maxPairHtml = `<span class="dms-badge ${bgBadge}" title="Najveća promena (${r.maxPairChange.rangeLabel})"><i data-lucide="${icon}"></i> ${sign} <span class="dms-podaci-range">(${r.maxPairChange.rangeLabel})</span></span>`;
                }

                // 3. Kolona: Procena Zastoja (Maksimalni zastoj po intervalima)
                let procenaZastojaHtml = '<span class="dms-text-dim">-</span>';
                if (r.maxBottleneckInv) {
                    const sign = r.maxBottleneckInv.diff > 0 ? `+${r.maxBottleneckInv.diff}` : r.maxBottleneckInv.diff;
                    const absDiff = Math.abs(r.maxBottleneckInv.diff);
                    const isMaxB = (absDiff === maxBottleneck && maxBottleneck !== minBottleneck);

                    let bgBadge = isMaxB
                        ? 'is-solid-danger'
                        : 'is-danger';

                    procenaZastojaHtml = `<span class="dms-badge ${bgBadge}" title="Najveći zastoj (${r.maxBottleneckInv.rangeLabel})"><i data-lucide="alert-triangle"></i> ${sign} <span class="dms-podaci-range">(${r.maxBottleneckInv.rangeLabel})</span></span>`;
                }

                // 4. Kolona: Procena Napretka (Maksimalni boljitak po intervalima)
                let procenaNapretkaHtml = '<span class="dms-text-dim">-</span>';
                if (r.maxProgressInv) {
                    const sign = r.maxProgressInv.diff > 0 ? `+${r.maxProgressInv.diff}` : r.maxProgressInv.diff;
                    const absDiff = Math.abs(r.maxProgressInv.diff);
                    const isMaxP = (absDiff === maxProgressAbs && maxProgressAbs !== minProgressAbs);

                    let bgBadge = isMaxP
                        ? 'is-solid-success'
                        : 'is-success';
                    const icon = isBottleneckRow ? 'arrow-down' : 'arrow-up';

                    procenaNapretkaHtml = `<span class="dms-badge ${bgBadge}" title="Najveći napredak (${r.maxProgressInv.rangeLabel})"><i data-lucide="${icon}"></i> ${sign} <span class="dms-podaci-range">(${r.maxProgressInv.rangeLabel})</span></span>`;
                }

                html += `
                    ${prevToCurrHtml}
                    <td class="dms-nowrap dms-podaci-col-interval">${maxPairHtml}</td>
                    <td class="dms-nowrap dms-podaci-col-stall">${procenaZastojaHtml}</td>
                    <td class="dms-nowrap dms-podaci-col-progress">${procenaNapretkaHtml}</td>
                </tr>`;
            });
        }

        html += `</tbody></table></div></div>`;
        return html;
    }

    const growthMacroStatuses = [
        'Ukupno dokumenata',
        'Arhivirani dokumenti',
        'Dodeljeni dokumenti',
        'Zaključani dokumenti',
        'Obrisani dokumenti'
    ];

    const tableZastoji = renderStatusTable("1. TABELA STATUSI ZASTOJA I NEZAVRŠENIH DOKUMENATA (SORTIRANO PO NAJVEĆOJ PROMENI U BILO KOM PERIODU)", "alert-triangle", "is-danger", bottleneckStatuses, true, false);
    const tableNapredak = renderStatusTable("2. TABELA STATUSI RADA I NAPRETKA KORISNIKA (SORTIRANO PO NAJVEĆOJ PROMENI U BILO KOM PERIODU)", "line-chart", "is-success", growthMacroStatuses, false, true);

    div.innerHTML = highlightHtml + tableZastoji + tableNapredak;
    return div;
}

/**
 * Kompletno preformulisana i precizna analiza taba 'Zaključani i dodeljeni - zaposl'
 */
function parseZakljucaniSheetData(fileItem) {
    const sheet = fileItem.workbook.Sheets['Zaključani i dodeljeni - zaposl'];
    if (!sheet) return { totalLocked: 0, totalAssigned: 0, lockedMap: {}, assignedMap: {} };

    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    const lockedMap = {};
    const assignedMap = {};
    let totalLocked = 0;
    let totalAssigned = 0;

    rawRows.forEach(row => {
        if (!row || row.length === 0) return;

        // Leva strana (Zaključani)
        let leftLabel = '';
        let leftTotal = 0;
        for (let c = 0; c <= 2; c++) {
            const val = String(row[c] || '').trim();
            if (val.startsWith('Zaključao/la') || val === 'Grand Total') {
                leftLabel = val;
                break;
            }
        }
        if (leftLabel) {
            for (let c = 1; c <= 5; c++) {
                if (typeof row[c] === 'number') leftTotal = row[c];
            }
            if (leftLabel === 'Grand Total') {
                totalLocked = leftTotal;
            } else {
                const user = leftLabel.replace('Zaključao/la', '').trim();
                if (user) lockedMap[user] = leftTotal;
            }
        }

        // Desna strana (Dodeljeni)
        let rightLabel = '';
        let rightTotal = 0;
        for (let c = 6; c <= 8; c++) {
            const val = String(row[c] || '').trim();
            if (val.startsWith('Dodeljeno') || val === 'Grand Total') {
                rightLabel = val;
                break;
            }
        }
        if (rightLabel) {
            for (let c = 7; c <= 12; c++) {
                if (typeof row[c] === 'number') rightTotal = row[c];
            }
            if (rightLabel === 'Grand Total') {
                totalAssigned = rightTotal;
            } else {
                const assignee = rightLabel.replace('Dodeljeno', '').trim();
                if (assignee) assignedMap[assignee] = rightTotal;
            }
        }
    });

    if (totalLocked === 0) {
        totalLocked = Object.values(lockedMap).reduce((a, b) => a + b, 0);
    }
    if (totalAssigned === 0) {
        totalAssigned = Object.values(assignedMap).reduce((a, b) => a + b, 0);
    }

    return { totalLocked, totalAssigned, lockedMap, assignedMap };
}

function analyzeMultiZakljucaniSheet() {
    const div = document.createElement('div');
    div.className = "dms-stack";

    // 1. Parsiramo podatke za svaki učitani izveštaj
    const parsedPerFile = uploadedFiles.map(f => parseZakljucaniSheetData(f));

    const oldestFile = uploadedFiles[0];
    const prevFile = uploadedFiles.length >= 2 ? uploadedFiles[uploadedFiles.length - 2] : oldestFile;
    const currFile = uploadedFiles[uploadedFiles.length - 1];

    const prevIdx = uploadedFiles.length >= 2 ? uploadedFiles.length - 2 : 0;
    const currIdx = uploadedFiles.length - 1;

    // Sakupljamo sve jedinstvene zaposlene za Zaključane i Dodeljene
    const allLockedUsers = new Set();
    const allAssignedUsers = new Set();

    parsedPerFile.forEach(p => {
        Object.keys(p.lockedMap).forEach(u => allLockedUsers.add(u));
        Object.keys(p.assignedMap).forEach(u => allAssignedUsers.add(u));
    });

    // 2. OBJAŠNJENJE STATUSI (Header Banner)
    const infoBannerHtml = `
        <div class="dms-notice is-info dms-podaci-banner">
            <div class="dms-podaci-icon-box is-info is-large">
                <i data-lucide="info"></i>
            </div>
            <div class="dms-stack-xs">
                <h4 class="dms-heading">Pojašnjenje taba "Zaključani i dodeljeni - zaposl":</h4>
                <p>Excel izveštaj u ovom tabu sadrži dve zbirne Pivot tabele dokumenata u obradi:</p>
                <ul class="dms-podaci-list">
                    <li><strong class="dms-text-danger">Zaključani dokumenti (Preuzeti za rad)</strong>: Dokumenti koje su zaposleni konkretno preuzeli i zaključali (samo taj radnik trenutno vrši obradu nad njima).</li>
                    <li><strong class="dms-text-warning">Dodeljeni dokumenti (Ne preuzeti za rad)</strong>: Dokumenti prosleđeni korisniku ili radnoj grupi/službi koji još uvek **čekaju da budu preuzeti u rad**.</li>
                </ul>
            </div>
        </div>
    `;

    // 3. SUMARNI HRONOLOŠKI PREGLED DOKUMENATA PO PERIODIMA
    let summaryTableHtml = `
        <div class="dms-panel is-flush">
            <div class="dms-panel-head dms-podaci-head">
                <span class="dms-podaci-head-title"><i data-lucide="layers" class="dms-text-info"></i> HRONOLOŠKI PREGLED KATEGORIJA DOKUMENATA PO PERIODIMA</span>
                <span class="dms-podaci-head-note">Poređenje ukupnog broja kroz sve učitane izveštaje</span>
            </div>
            <div class="dms-scroll-x">
                <table class="dms-table">
                    <thead>
                        <tr class="dms-th-row">
                            <th>Kategorija Dokumenata</th>
    `;

    uploadedFiles.forEach(f => {
        summaryTableHtml += `<th class="dms-num">${f.dateFormatted}</th>`;
    });

    summaryTableHtml += `
                            <th class="dms-num dms-podaci-col-interval">Promena u intervalu<span class="dms-podaci-th-sub">(${prevFile.dateFormatted} ➔ ${currFile.dateFormatted})</span></th>
                            <th class="dms-num dms-podaci-col-overall">Ukupna Promena<span class="dms-podaci-th-sub">(od ${oldestFile.dateFormatted} do ${currFile.dateFormatted})</span></th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    // Red 1: Zaključani dokumenti
    summaryTableHtml += `<tr><td><span class="dms-podaci-label is-danger"><i data-lucide="lock"></i> Zaključani Dokumenti (Preuzeti za rad)</span></td>`;
    parsedPerFile.forEach(p => {
        summaryTableHtml += `<td class="dms-num dms-mono dms-strong dms-text-danger">${p.totalLocked.toLocaleString()}</td>`;
    });
    const lockedInterval = parsedPerFile[currIdx].totalLocked - parsedPerFile[prevIdx].totalLocked;
    const lockedOverall = parsedPerFile[currIdx].totalLocked - parsedPerFile[0].totalLocked;
    summaryTableHtml += `<td class="dms-num dms-mono dms-podaci-col-interval ${lockedInterval < 0 ? 'is-success' : (lockedInterval > 0 ? 'is-danger' : 'is-muted')}">${lockedInterval > 0 ? '+' + lockedInterval : lockedInterval}</td>`;
    summaryTableHtml += `<td class="dms-num dms-mono dms-podaci-col-overall ${lockedOverall < 0 ? 'is-success' : (lockedOverall > 0 ? 'is-danger' : 'is-muted')}">${lockedOverall > 0 ? '+' + lockedOverall : lockedOverall}</td></tr>`;

    // Red 2: Dodeljeni dokumenti
    summaryTableHtml += `<tr><td><span class="dms-podaci-label is-warning"><i data-lucide="clock"></i> Dodeljeni Dokumenti (Ne preuzeti za rad - Čekaju obradu)</span></td>`;
    parsedPerFile.forEach(p => {
        summaryTableHtml += `<td class="dms-num dms-mono dms-strong dms-text-warning">${p.totalAssigned.toLocaleString()}</td>`;
    });
    const assignedInterval = parsedPerFile[currIdx].totalAssigned - parsedPerFile[prevIdx].totalAssigned;
    const assignedOverall = parsedPerFile[currIdx].totalAssigned - parsedPerFile[0].totalAssigned;
    summaryTableHtml += `<td class="dms-num dms-mono dms-podaci-col-interval ${assignedInterval < 0 ? 'is-success' : (assignedInterval > 0 ? 'is-danger' : 'is-muted')}">${assignedInterval > 0 ? '+' + assignedInterval : assignedInterval}</td>`;
    summaryTableHtml += `<td class="dms-num dms-mono dms-podaci-col-overall ${assignedOverall < 0 ? 'is-success' : (assignedOverall > 0 ? 'is-danger' : 'is-muted')}">${assignedOverall > 0 ? '+' + assignedOverall : assignedOverall}</td></tr>`;

    summaryTableHtml += `</tbody></table></div></div>`;

    // 4. TABELA 1: ZAKLJUČANI DOKUMENTI PO ZAPOSLENIMA
    const lockedList = Array.from(allLockedUsers).map(user => {
        const counts = parsedPerFile.map(p => p.lockedMap[user] || 0);
        const lastCount = counts[currIdx];
        const prevCount = counts[prevIdx];
        const firstCount = counts[0];
        return {
            user,
            counts,
            lastCount,
            intervalDiff: lastCount - prevCount,
            overallDiff: lastCount - firstCount
        };
    }).sort((a, b) => b.lastCount - a.lastCount || b.overallDiff - a.overallDiff);

    let lockedTableHtml = `
        <div class="dms-panel is-flush">
            <div class="dms-panel-head dms-podaci-head is-danger">
                <span class="dms-podaci-head-title"><i data-lucide="lock"></i> ZAKLJUČANI DOKUMENTI PO ZAPOSLENIMA (SORTIRANO SILAZNO PO NAJNOVIJEM FAJLU)</span>
                <span class="dms-text-danger">Preuzeti u rad: ${parsedPerFile[currIdx].totalLocked} dokumenata</span>
            </div>
            <div class="dms-scroll-x">
                <table class="dms-table">
                    <thead>
                        <tr class="dms-th-row">
                            <th>Zaposleni koji je zaključao</th>
    `;

    uploadedFiles.forEach(f => {
        lockedTableHtml += `<th class="dms-num">${f.dateFormatted}</th>`;
    });

    lockedTableHtml += `
                            <th class="dms-num dms-podaci-col-interval">Promena u intervalu<span class="dms-podaci-th-sub">(${prevFile.dateFormatted} ➔ ${currFile.dateFormatted})</span></th>
                            <th class="dms-num dms-podaci-col-overall">Ukupna Promena<span class="dms-podaci-th-sub">(od ${oldestFile.dateFormatted} do ${currFile.dateFormatted})</span></th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    lockedList.forEach(item => {
        lockedTableHtml += `<tr><td><div class="dms-podaci-user">${item.user} ${getUserSectorBadgeHtml(item.user)}</div></td>`;
        item.counts.forEach(c => {
            lockedTableHtml += `<td class="dms-num dms-mono">${c.toLocaleString()}</td>`;
        });

        const intText = item.intervalDiff > 0 ? `+${item.intervalDiff}` : item.intervalDiff;
        const ovText = item.overallDiff > 0 ? `+${item.overallDiff}` : item.overallDiff;

        const intColor = item.intervalDiff < 0 ? 'is-success' : (item.intervalDiff > 0 ? 'is-danger' : 'is-muted');
        const ovColor = item.overallDiff < 0 ? 'is-success' : (item.overallDiff > 0 ? 'is-danger' : 'is-muted');

        lockedTableHtml += `<td class="dms-num dms-mono dms-podaci-col-interval ${intColor}">${intText}</td>`;
        lockedTableHtml += `<td class="dms-num dms-mono dms-podaci-col-overall ${ovColor}">${ovText}</td></tr>`;
    });

    lockedTableHtml += `</tbody></table></div></div>`;

    // 5. TABELA 2: DODELJENI DOKUMENTI PO KORISNICIMA I SLUŽBAMA
    const assignedList = Array.from(allAssignedUsers).map(user => {
        const counts = parsedPerFile.map(p => p.assignedMap[user] || 0);
        const lastCount = counts[currIdx];
        const prevCount = counts[prevIdx];
        const firstCount = counts[0];
        return {
            user,
            counts,
            lastCount,
            intervalDiff: lastCount - prevCount,
            overallDiff: lastCount - firstCount
        };
    }).sort((a, b) => b.lastCount - a.lastCount || b.overallDiff - a.overallDiff);

    let assignedTableHtml = `
        <div class="dms-panel is-flush">
            <div class="dms-panel-head dms-podaci-head is-warning">
                <span class="dms-podaci-head-title"><i data-lucide="users"></i> DODELJENI DOKUMENTI PO KORISNICIMA I SLUŽBAMA (NE PREUZETI ZA RAD - ČEKAJU OBRADU)</span>
                <span class="dms-text-warning">Čeka preuzimanje: ${parsedPerFile[currIdx].totalAssigned} dokumenata</span>
            </div>
            <div class="dms-scroll-x">
                <table class="dms-table">
                    <thead>
                        <tr class="dms-th-row">
                            <th>Korisnik ili Služba / Sektor</th>
    `;

    uploadedFiles.forEach(f => {
        assignedTableHtml += `<th class="dms-num">${f.dateFormatted}</th>`;
    });

    assignedTableHtml += `
                            <th class="dms-num dms-podaci-col-interval">Promena u intervalu<span class="dms-podaci-th-sub">(${prevFile.dateFormatted} ➔ ${currFile.dateFormatted})</span></th>
                            <th class="dms-num dms-podaci-col-overall">Ukupna Promena<span class="dms-podaci-th-sub">(od ${oldestFile.dateFormatted} do ${currFile.dateFormatted})</span></th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    assignedList.forEach(item => {
        assignedTableHtml += `<tr><td><div class="dms-podaci-user">${item.user} ${getUserSectorBadgeHtml(item.user)}</div></td>`;
        item.counts.forEach(c => {
            assignedTableHtml += `<td class="dms-num dms-mono">${c.toLocaleString()}</td>`;
        });

        const intText = item.intervalDiff > 0 ? `+${item.intervalDiff}` : item.intervalDiff;
        const ovText = item.overallDiff > 0 ? `+${item.overallDiff}` : item.overallDiff;

        const intColor = item.intervalDiff < 0 ? 'is-success' : (item.intervalDiff > 0 ? 'is-danger' : 'is-muted');
        const ovColor = item.overallDiff < 0 ? 'is-success' : (item.overallDiff > 0 ? 'is-danger' : 'is-muted');

        assignedTableHtml += `<td class="dms-num dms-mono dms-podaci-col-interval ${intColor}">${intText}</td>`;
        assignedTableHtml += `<td class="dms-num dms-mono dms-podaci-col-overall ${ovColor}">${ovText}</td></tr>`;
    });

    assignedTableHtml += `</tbody></table></div></div>`;

    div.innerHTML = infoBannerHtml + summaryTableHtml + lockedTableHtml + assignedTableHtml;
    return div;
}

/**
 * Parsira podatke iz taba 'Dokumenti koji NISU završeni' za jedan izveštaj
 */
function parseNisuZavrseniSheetData(fileItem) {
    const sheetName = fileItem.workbook.SheetNames.find(s => /nisu\s*zavr/i.test(s));
    if (!sheetName) return { userMap: {}, total: 0 };

    const sheet = fileItem.workbook.Sheets[sheetName];
    if (!sheet) return { userMap: {}, total: 0 };

    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    const userMap = {};

    rawRows.forEach(row => {
        if (!row || row.length === 0) return;

        row.forEach((cell, colIdx) => {
            if (typeof cell === 'string') {
                const str = cell.trim();
                if (str.startsWith('Zaključao/la') || str.startsWith('Dodeljeno')) {
                    const u = str.replace(/^Zaključao\/la\s*/i, '').replace(/^Dodeljeno\s*/i, '').trim();
                    let val = 0;
                    for (let c = colIdx + 1; c <= Math.min(colIdx + 5, row.length - 1); c++) {
                        if (typeof row[c] === 'number') {
                            val = row[c];
                        }
                    }
                    if (u && val > 0) {
                        userMap[u] = (userMap[u] || 0) + val;
                    }
                }
            }
        });
    });

    const total = Object.values(userMap).reduce((a, b) => a + b, 0);
    return { userMap, total };
}

/**
 * Kompletna analiza taba 'Dokumenti koji NISU završeni' u identičnom formatu kao i 'KREIRANI NOVI DOKUMENTI PO KORISNICIMA'
 */
function analyzeMultiNisuZavrseniSheet() {
    const div = document.createElement('div');
    div.className = "dms-stack";

    const parsedPerFile = uploadedFiles.map(f => parseNisuZavrseniSheetData(f));

    const oldestFile = uploadedFiles[0];
    const prevFile = uploadedFiles.length >= 2 ? uploadedFiles[uploadedFiles.length - 2] : oldestFile;
    const currFile = uploadedFiles[uploadedFiles.length - 1];

    const prevIdx = uploadedFiles.length >= 2 ? uploadedFiles.length - 2 : 0;
    const currIdx = uploadedFiles.length - 1;

    const allUsersSet = new Set();
    parsedPerFile.forEach(p => {
        Object.keys(p.userMap).forEach(u => allUsersSet.add(u));
    });

    const userList = Array.from(allUsersSet).map(user => {
        const counts = parsedPerFile.map(p => p.userMap[user] || 0);
        const lastCount = counts[currIdx];
        const prevCount = counts[prevIdx];
        const firstCount = counts[0];

        return {
            user,
            counts,
            lastCount,
            prevCount,
            firstCount,
            intervalDiff: lastCount - prevCount,
            overallDiff: lastCount - firstCount
        };
    });

    // Sortiramo silazno po broju neobrađenih dokumenata u najnovijem fajlu
    userList.sort((a, b) => b.lastCount - a.lastCount || b.overallDiff - a.overallDiff);

    // Sumarni proračun po kolonama
    const totalsPerFile = uploadedFiles.map((_, idx) => {
        return userList.reduce((sum, u) => sum + (u.counts[idx] || 0), 0);
    });
    const totalLast = totalsPerFile[currIdx];
    const totalPrev = totalsPerFile[prevIdx];
    const totalFirst = totalsPerFile[0];
    const totalIntervalDiff = totalLast - totalPrev;
    const totalOverallDiff = totalLast - totalFirst;

    // Header Banner sa sažetkom
    const infoBannerHtml = `
        <div class="dms-notice is-warning dms-podaci-banner">
            <div class="dms-podaci-icon-box is-warning is-large">
                <i data-lucide="history"></i>
            </div>
            <div class="dms-stack-xs">
                <h4 class="dms-heading">Dokumenti koji NISU završeni (Nezavršeni / Zaostali dokumenti po korisnicima):</h4>
                <p>Prikazuje ukupan broj dokumenata u radu koji još uvek nisu arhivirani ili završeni, prateći promenu po korisnicima i službama kroz sve učitane izveštaje.</p>
                <div class="dms-podaci-banner-stats">
                    <span>Trenutno nezavršeno (${currFile.dateFormatted}): <strong class="dms-text-warning">${totalLast.toLocaleString()}</strong></span>
                    <span>Promena u poslednjem intervalu (${prevFile.dateFormatted} ➔ ${currFile.dateFormatted}): <strong class="${totalIntervalDiff <= 0 ? 'dms-text-success' : 'dms-text-danger'}">${totalIntervalDiff > 0 ? '+' + totalIntervalDiff : totalIntervalDiff}</strong></span>
                    <span>Ukupna promena (od ${oldestFile.dateFormatted} do ${currFile.dateFormatted}): <strong class="${totalOverallDiff <= 0 ? 'dms-text-success' : 'dms-text-danger'}">${totalOverallDiff > 0 ? '+' + totalOverallDiff : totalOverallDiff}</strong></span>
                </div>
            </div>
        </div>
    `;

    // Tabela po istom formatu ako i KREIRANI NOVI DOKUMENTI PO KORISNICIMA
    let tableHtml = `
        <div class="dms-panel is-flush">
            <div class="dms-panel-head dms-podaci-head is-warning">
                <span class="dms-podaci-head-title"><i data-lucide="list-checks"></i> DOKUMENTI KOJI NISU ZAVRŠENI PO KORISNICIMA</span>
                <span class="dms-podaci-head-note">Sortirano silazno po najnovijem broju neobrađenih dokumenata</span>
            </div>
            <div class="dms-scroll-x">
                <table class="dms-table">
                    <thead>
                        <tr class="dms-th-row">
                            <th>Korisnik / Zaposleni / Služba</th>
    `;

    uploadedFiles.forEach(f => {
        tableHtml += `<th class="dms-num">${f.dateFormatted}</th>`;
    });

    tableHtml += `
                            <th class="dms-num dms-podaci-col-interval">Promena u poslednjem intervalu<span class="dms-podaci-th-sub">(${prevFile.dateFormatted} ➔ ${currFile.dateFormatted})</span></th>
                            <th class="dms-num dms-podaci-col-overall">Ukupna Promena<span class="dms-podaci-th-sub">(od ${oldestFile.dateFormatted} do ${currFile.dateFormatted})</span></th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    userList.forEach(u => {
        tableHtml += `<tr><td><div class="dms-podaci-user">${u.user} ${getUserSectorBadgeHtml(u.user)}</div></td>`;

        u.counts.forEach(c => {
            tableHtml += `<td class="dms-num dms-mono">${c.toLocaleString()}</td>`;
        });

        const intSign = u.intervalDiff > 0 ? `+${u.intervalDiff}` : u.intervalDiff;
        const ovSign = u.overallDiff > 0 ? `+${u.overallDiff}` : u.overallDiff;

        // Kod nezavršenih dokumenata: SMANJENJE (< 0) je uspeh (is-success), POVEĆANJE (> 0) je zastoj (is-danger)
        const intClass = u.intervalDiff < 0 ? 'is-success' : (u.intervalDiff > 0 ? 'is-danger' : 'is-muted');
        const ovClass = u.overallDiff < 0 ? 'is-success' : (u.overallDiff > 0 ? 'is-danger' : 'is-muted');

        tableHtml += `<td class="dms-num dms-mono dms-podaci-col-interval ${intClass}">${intSign}</td>`;
        tableHtml += `<td class="dms-num dms-mono dms-podaci-col-overall ${ovClass}">${ovSign}</td></tr>`;
    });

    // Zbirni red
    tableHtml += `
                    </tbody>
                    <tfoot>
                        <tr class="is-total dms-podaci-foot">
                            <td>UKUPNO NEZAVRŠENI DOKUMENTI</td>
    `;

    totalsPerFile.forEach(tot => {
        tableHtml += `<td class="dms-num dms-mono dms-text-warning">${tot.toLocaleString()}</td>`;
    });

    const totIntSign = totalIntervalDiff > 0 ? `+${totalIntervalDiff}` : totalIntervalDiff;
    const totOvSign = totalOverallDiff > 0 ? `+${totalOverallDiff}` : totalOverallDiff;

    const totIntClass = totalIntervalDiff < 0 ? 'is-success' : (totalIntervalDiff > 0 ? 'is-danger' : 'is-muted');
    const totOvClass = totalOverallDiff < 0 ? 'is-success' : (totalOverallDiff > 0 ? 'is-danger' : 'is-muted');

    tableHtml += `<td class="dms-num dms-mono dms-podaci-col-interval ${totIntClass}">${totIntSign}</td>`;
    tableHtml += `<td class="dms-num dms-mono dms-podaci-col-overall ${totOvClass}">${totOvSign}</td>`;

    tableHtml += `
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    `;

    div.innerHTML = infoBannerHtml + tableHtml;
    return div;
}

/**
 * Generički pregled po radnom listu za ostale tabove
 */
/**
 * Kompletno učitavanje i prikaz realnih podataka (red po red sa pretragom i filtriranjem)
 * za tabove kao što su "Korisnici", "Službe", i sve ostale radne listove.
 */
function renderMultiGenericOverview(sheetName) {
    const div = document.createElement('div');
    div.className = "dms-stack";

    // 1. Prikupljamo broj redova kroz sve izveštaje za sumarni hronološki pregled
    const oldestFile = uploadedFiles[0];
    const prevFile = uploadedFiles.length >= 2 ? uploadedFiles[uploadedFiles.length - 2] : oldestFile;
    const currFile = uploadedFiles[uploadedFiles.length - 1];

    const prevIdx = uploadedFiles.length >= 2 ? uploadedFiles.length - 2 : 0;
    const currIdx = uploadedFiles.length - 1;

    const rowCountsPerFile = uploadedFiles.map(f => {
        const sheet = f.workbook.Sheets[sheetName];
        const raw = sheet ? XLSX.utils.sheet_to_json(sheet, { header: 1 }) : [];
        return raw.length;
    });

    const lastVal = rowCountsPerFile[currIdx];
    const prevVal = rowCountsPerFile[prevIdx];
    const firstVal = rowCountsPerFile[0];

    const intervalDiff = lastVal - prevVal;
    const overallDiff = lastVal - firstVal;

    let summaryHtml = `
        <div class="dms-panel is-flush">
            <div class="dms-panel-head dms-podaci-head">
                <span class="dms-podaci-head-title"><i data-lucide="history" class="dms-text-info"></i> HRONOLOŠKO KRETANJE BROJA ZAPISA U TABU "${sheetName.toUpperCase()}"</span>
                <span class="dms-podaci-head-note">Učitano iz ${uploadedFiles.length} izveštaja</span>
            </div>
            <div class="dms-scroll-x">
                <table class="dms-table">
                    <thead>
                        <tr class="dms-th-row">
                            <th>Naziv Radnog Lista</th>
    `;

    uploadedFiles.forEach(f => {
        summaryHtml += `<th class="dms-num">${f.dateFormatted}</th>`;
    });

    summaryHtml += `
                            <th class="dms-num dms-podaci-col-interval">Promena u poslednjem intervalu<span class="dms-podaci-th-sub">(${prevFile.dateFormatted} ➔ ${currFile.dateFormatted})</span></th>
                            <th class="dms-num dms-podaci-col-overall">Ukupna Promena<span class="dms-podaci-th-sub">(od ${oldestFile.dateFormatted} do ${currFile.dateFormatted})</span></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="dms-strong">${sheetName}</td>
    `;

    rowCountsPerFile.forEach(cnt => {
        summaryHtml += `<td class="dms-num dms-mono dms-strong">${cnt.toLocaleString()}</td>`;
    });

    const intText = intervalDiff > 0 ? `+${intervalDiff}` : intervalDiff;
    const ovText = overallDiff > 0 ? `+${overallDiff}` : overallDiff;

    // Ovde povećanje nije "loše": porast broja zapisa je informativan (is-info), smanjenje je is-danger
    summaryHtml += `<td class="dms-num dms-mono dms-podaci-col-interval ${intervalDiff > 0 ? 'is-info' : (intervalDiff < 0 ? 'is-danger' : 'is-muted')}">${intText}</td>`;
    summaryHtml += `<td class="dms-num dms-mono dms-podaci-col-overall ${overallDiff > 0 ? 'is-info' : (overallDiff < 0 ? 'is-danger' : 'is-muted')}">${ovText}</td></tr>`;
    summaryHtml += `</tbody></table></div></div>`;

    // 2. Parsiramo detaljne podatke iz najnovijeg fajla koji sadrži ovaj tab
    let targetSheetFile = currFile;
    let targetSheet = targetSheetFile.workbook.Sheets[sheetName];

    if (!targetSheet) {
        for (let i = uploadedFiles.length - 1; i >= 0; i--) {
            if (uploadedFiles[i].workbook.Sheets[sheetName]) {
                targetSheetFile = uploadedFiles[i];
                targetSheet = targetSheetFile.workbook.Sheets[sheetName];
                break;
            }
        }
    }

    if (!targetSheet) {
        div.innerHTML = summaryHtml + `<div class="dms-notice dms-center dms-italic">Podaci za tab "${sheetName}" nisu pronađeni u izveštajima.</div>`;
        return div;
    }

    const raw2D = XLSX.utils.sheet_to_json(targetSheet, { header: 1 });
    if (raw2D.length === 0) {
        div.innerHTML = summaryHtml + `<div class="dms-notice dms-center dms-italic">Tab "${sheetName}" je prazan.</div>`;
        return div;
    }

    // Pronalazak zaglavlja
    let headerRowIdx = 0;
    for (let r = 0; r < Math.min(10, raw2D.length); r++) {
        const row = raw2D[r] || [];
        const hasHeaderKeywords = row.some(cell => {
            const s = String(cell || '').toLowerCase();
            return s.includes('korisnik') || s.includes('mail') || s.includes('služb') || s.includes('sektor') || s.includes('naziv') || s.includes('oc');
        });
        if (hasHeaderKeywords) {
            headerRowIdx = r;
            break;
        }
    }

    const headers = (raw2D[headerRowIdx] || []).map(h => String(h || '').trim()).filter(h => h.length > 0);
    const dataRows = raw2D.slice(headerRowIdx + 1).filter(r => r && r.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== ''));

    const searchInputId = 'search_' + Math.random().toString(36).substring(2, 9);
    const tableId = 'table_' + Math.random().toString(36).substring(2, 9);

    let detailHtml = `
        <div class="dms-panel is-flush">
            <!-- Header Tabe sa Pretragom -->
            <div class="dms-panel-head">
                <div>
                    <h4 class="dms-heading dms-row">
                        <i data-lucide="table" class="dms-text-info"></i> DETALJNI PRIKAZ PODATAKA – TAB "${sheetName.toUpperCase()}"
                    </h4>
                    <p class="dms-subtitle">Prikazano <strong>${dataRows.length}</strong> zapisa iz izveštaja od ${targetSheetFile.dateFormatted}</p>
                </div>

                <!-- PRETRAGA INPUT -->
                <div class="dms-podaci-search">
                    <div class="dms-podaci-search-icon">
                        <i data-lucide="search"></i>
                    </div>
                    <input type="text" id="${searchInputId}" onkeyup="filterTableRows('${searchInputId}', '${tableId}')" placeholder="Pretraži ${sheetName.toLowerCase()}..." class="dms-podaci-search-input">
                </div>
            </div>

            <!-- TABELA PODATAKA -->
            <div class="dms-podaci-scroll is-tall">
                <table id="${tableId}" class="dms-table is-sticky">
                    <thead>
                        <tr class="dms-th-row">
                            <th class="dms-center dms-podaci-index">#</th>
    `;

    headers.forEach(h => {
        detailHtml += `<th>${h}</th>`;
    });

    detailHtml += `
                        </tr>
                    </thead>
                    <tbody>
    `;

    dataRows.forEach((row, idx) => {
        detailHtml += `<tr>`;
        detailHtml += `<td class="dms-center dms-mono dms-text-dim">${idx + 1}</td>`;

        for (let colIdx = 0; colIdx < headers.length; colIdx++) {
            const cellVal = row[colIdx] !== null && row[colIdx] !== undefined ? String(row[colIdx]).trim() : '';
            
            // Formatiranje e-maila ili korisnika
            let formattedCell = cellVal;
            if (cellVal.includes('@')) {
                formattedCell = `<a href="mailto:${cellVal}" class="dms-podaci-link">${cellVal}</a>`;
            } else if (colIdx === 0 && (sheetName.toLowerCase().includes('korisnik') || sheetName.toLowerCase().includes('služb'))) {
                formattedCell = `<span class="dms-strong">${cellVal}</span> ${getUserSectorBadgeHtml(cellVal)}`;
            }

            detailHtml += `<td>${formattedCell}</td>`;
        }

        detailHtml += `</tr>`;
    });

    detailHtml += `
                    </tbody>
                </table>
            </div>
        </div>
    `;

    div.innerHTML = summaryHtml + detailHtml;
    return div;
}

/**
 * Dinamičko filtriranje redova u tabeli po unetom tekstu
 */
function filterTableRows(inputId, tableId) {
    const input = document.getElementById(inputId);
    const table = document.getElementById(tableId);
    if (!input || !table) return;

    const filter = input.value.toLowerCase();
    const rows = table.getElementsByTagName('tbody')[0].getElementsByTagName('tr');

    for (let i = 0; i < rows.length; i++) {
        const text = rows[i].innerText.toLowerCase();
        if (text.includes(filter)) {
            rows[i].style.display = "";
        } else {
            rows[i].style.display = "none";
        }
    }
}

