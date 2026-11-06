/**
 * Vraća naziv meseca na srpskom jeziku
 */
function getSerbianMonthName(m) {
    const months = {
        1: 'Januar', 2: 'Februar', 3: 'Mart', 4: 'April',
        5: 'Maj', 6: 'Jun', 7: 'Jul', 8: 'Avgust',
        9: 'Septembar', 10: 'Oktobar', 11: 'Novembar', 12: 'Decembar'
    };
    if (typeof m === 'number') return months[m] || `Mesec ${m}`;
    return String(m);
}

function getSerbianMonthShortName(m) {
    const months = {
        1: 'JAN', 2: 'FEB', 3: 'MAR', 4: 'APR',
        5: 'MAJ', 6: 'JUN', 7: 'JUL', 8: 'AVG',
        9: 'SEP', 10: 'OKT', 11: 'NOV', 12: 'DEC'
    };
    if (typeof m === 'number') return months[m] || `M${m}`;
    return String(m).toUpperCase();
}

function getOscillationBadge(diff, pct, valPrev) {
    if (diff > 0) {
        if (pct >= 100 || (valPrev === 0 && diff >= 10)) {
            return `<span class="dms-badge is-solid-success"><i data-lucide="arrow-up-circle"></i> Nagli skok unosa novih dok. (+${pct}%)</span>`;
        } else {
            return `<span class="dms-badge is-success"><i data-lucide="arrow-up"></i> Blagi skok unosa novih dok. (+${pct}%)</span>`;
        }
    } else if (diff < 0) {
        const absPct = Math.abs(pct);
        if (absPct >= 60) {
            return `<span class="dms-badge is-solid-danger"><i data-lucide="arrow-down-circle"></i> Nagli pad unosa novih dok. (${pct}%)</span>`;
        } else {
            return `<span class="dms-badge is-danger"><i data-lucide="arrow-down"></i> Blagi pad unosa novih dok. (${pct}%)</span>`;
        }
    } else {
        return `<span class="dms-badge">Nepromenjeno (0%)</span>`;
    }
}

// Ton brojčane ćelije prema predznaku razlike (klase tabele: is-success / is-danger / is-muted)
function oscToneOf(diff) {
    return diff > 0 ? 'is-success' : (diff < 0 ? 'is-danger' : 'is-muted');
}

// Kategorija oscilacije po istim pravilima kao u oznaci i u legendi: nagli/blagi skok ili pad
function oscCategoryOf(diff, pct, valPrev) {
    if (diff > 0) return (pct >= 100 || (valPrev === 0 && diff >= 10)) ? 'bigUp' : 'smallUp';
    if (diff < 0) return Math.abs(pct) >= 60 ? 'bigDown' : 'smallDown';
    return 'none';
}

// Izabrane stavke legende (može više njih); bez izbora prikazuju se sve
const oscLegendSelected = new Set();
// Klasa stanja izabrane stavke legende (izgled je u dms-oscilacije.css)
const OSC_LEGEND_SELECTED = ' is-selected';

function oscLegendHides(cat) {
    return oscLegendSelected.size > 0 && !oscLegendSelected.has(cat);
}

// Klik na stavku legende dodaje ili uklanja filter i odmah osvežava obe tabele
function toggleOscLegend(cat) {
    if (oscLegendSelected.has(cat)) oscLegendSelected.delete(cat);
    else oscLegendSelected.add(cat);
    document.querySelectorAll('[data-osc-legend]').forEach(btn => {
        btn.classList.toggle('is-selected', oscLegendSelected.has(btn.dataset.oscLegend));
    });
    document.querySelectorAll('[data-osc-cat]').forEach(row => {
        row.classList.toggle('dms-hidden', oscLegendHides(row.dataset.oscCat));
    });
}

/**
 * Procentualna promena poslednjeg završenog meseca u odnosu na prosek (zeleno = skok, crveno = pad)
 */
function renderAvgChangeBadge(avg, curr) {
    const pct = avg > 0 ? Math.round(((curr - avg) / avg) * 100) : (curr > 0 ? 100 : 0);
    if (pct > 0) return `<span class="dms-osc-avg-change is-success">▲ +${pct}%</span>`;
    if (pct < 0) return `<span class="dms-osc-avg-change is-danger">▼ ${pct}%</span>`;
    return `<span class="dms-osc-avg-change">0%</span>`;
}

function openSectorEmailModal(encodedSector, prevKeyOrM, currKeyOrM) {
    const sectorName = decodeURIComponent(encodedSector);
    dmsEnsureEmailModal();
    const modal = document.getElementById('emailModal');
    if (!modal) return;

    // Pronađi sve korisnike koji pripadaju ovom sektoru
    const sectorUsers = Object.values(USERS).filter(u => 
        u.sector && u.sector.trim().toLowerCase() === sectorName.trim().toLowerCase()
    );

    const emailSet = new Set();
    sectorUsers.forEach(u => {
        if (u.email && u.email.trim()) {
            emailSet.add(u.email.trim());
        }
    });

    const recipientEmails = Array.from(emailSet).join('; ');
    document.getElementById('emailRecipientKey').value = 'SECTOR_' + sectorName;
    document.getElementById('emailRecipientAddress').value = recipientEmails;
    document.getElementById('emailModalTitle').innerText = `Slanje E-mail Obaveštenja Za Službu: ${sectorName}`;

    // Dobijanje statistike za sektor iz najnovijeg fajla po sektorima
    const latestFile = uploadedFiles[uploadedFiles.length - 1];
    const parsedData = getKreiraniParsed(latestFile.workbook);
    
    let val3MAvg = 0;
    let valCurr = 0;
    let diff = 0;
    let pct = 0;
    let histFormatted = '';
    let sum3M = 0;
    let prevName = '';
    let currName = '';

    if (parsedData && parsedData.sectorTree && parsedData.monthCols) {
        const { monthCols, sectorTree } = parsedData;
        const completenessInfo = getReportMonthCompleteness(latestFile, monthCols);
        const lastIncompleteKey = completenessInfo ? completenessInfo.lastIncompleteKey : null;

        const completedMonthCols = monthCols.filter(m => !lastIncompleteKey || m.key < lastIncompleteKey);
        
        let currCol = null;
        let prevCol = null;

        if (currKeyOrM) {
            currCol = monthCols.find(m => m.key === String(currKeyOrM) || m.month === Number(currKeyOrM));
        }
        if (!currCol && completedMonthCols.length > 0) {
            currCol = completedMonthCols[completedMonthCols.length - 1];
        }

        if (prevKeyOrM) {
            prevCol = monthCols.find(m => m.key === String(prevKeyOrM) || m.month === Number(prevKeyOrM));
        }
        if (!prevCol && completedMonthCols.length > 1) {
            prevCol = completedMonthCols[completedMonthCols.length - 2];
        }

        prevName = prevCol ? prevCol.label : 'Prethodni mesec';
        currName = currCol ? currCol.label : 'Tekući mesec';

        const sec = sectorTree.find(s => s.sector.trim().toLowerCase() === sectorName.trim().toLowerCase());
        if (sec && currCol) {
            // Istorija: 3 meseca pre currCol (ili svi raspoloživi kompletirani)
            const cIdx = completedMonthCols.findIndex(m => m.key === currCol.key);
            let histCols = [];
            if (cIdx > 0) {
                histCols = completedMonthCols.slice(0, cIdx).slice(-3);
            }
            if (histCols.length === 0 && prevCol) {
                histCols = [prevCol];
            }

            const hVals = histCols.map(h => sec.counts[h.key] || 0);
            sum3M = hVals.reduce((a, b) => a + b, 0);
            val3MAvg = histCols.length > 0 ? Math.round(sum3M / histCols.length) : 0;
            valCurr = sec.counts[currCol.key] || 0;
            diff = valCurr - val3MAvg;
            pct = val3MAvg > 0 ? Math.round((diff / val3MAvg) * 100) : (valCurr > 0 ? 100 : 0);
            histFormatted = histCols.map((h, i) => `${h.label} (${hVals[i].toLocaleString()} dok)`).join(', ');
        }
    }
    const diffSign = diff > 0 ? `+${diff.toLocaleString()}` : `${diff.toLocaleString()}`;
    const pctSign = pct > 0 ? `+${pct}%` : `${pct}%`;

    let oscillationType = 'neutral';
    let statusName = 'Nepromenjeno (0%)';
    if (diff > 0) {
        if (pct >= 100 || (val3MAvg === 0 && diff >= 10)) {
            statusName = 'Nagli skok u odnosu na prosek';
            oscillationType = 'nagli_skok';
        } else {
            statusName = 'Blagi skok u odnosu na prosek';
            oscillationType = 'blagi_skok';
        }
    } else if (diff < 0) {
        const absPct = Math.abs(pct);
        if (absPct >= 60) {
            statusName = 'Nagli pad u odnosu na prosek';
            oscillationType = 'nagli_pad';
        } else {
            statusName = 'Blagi pad u odnosu na prosek';
            oscillationType = 'blagi_pad';
        }
    }

    let subject = `[DMS Analitika] Obaveštenje o unosu dokumenata za službu - ${sectorName}`;
    let body = `Poštovani članovi službe ${sectorName},\n\nMolimo vas za proveru unosa dokumenata.\n\nSrdačan pozdrav,\n${dmsSignature()}`;

    if (oscillationType === 'nagli_skok') {
        subject = `[DMS Pohvala] Pohvala za rad i nagli skok unosa dokumenata - Služba ${sectorName}`;
        body = `Poštovani članovi službe ${sectorName},\n\n` +
               `Pohvaljuje se izuzetan rad Vaše službe i znatno povećanje u unosu novih dokumenata u mesecu ${currName} u odnosu na Vaš tromesečni prosek!\n\n` +
               `📊 STATISTIKA UNOSA DOKUMENATA ZA SLUŽBU (${sectorName}):\n` +
               `• Istorija unosa (3M): ${histFormatted}\n` +
               `• Zbir unosa (3M): ${sum3M.toLocaleString()} dokumenata\n` +
               `• Tromesečni prosek (Bazna vrednost): ${val3MAvg.toLocaleString()} dokumenata/mesečno\n` +
               `• Unos u mesecu ${currName}: ${valCurr.toLocaleString()} dokumenata\n` +
               `• Razlika i Skok: ${diffSign} dokumenata (${pctSign} u odnosu na tromesečni prosek)\n` +
               `• Procena aktivnosti službe: ${statusName}\n\n` +
               `Nastavite sa odličnim radom!\n\n` +
               `Srdačan pozdrav,\n${dmsSignature()}`;
    } else if (oscillationType === 'blagi_skok') {
        subject = `[DMS Pohvala] Pohvala za rad i blagi skok unosa dokumenata - Služba ${sectorName}`;
        body = `Poštovani članovi službe ${sectorName},\n\n` +
               `Pohvaljuje se rad Vaše službe i primećen blagi skok u unosu novih dokumenata u mesecu ${currName} u odnosu na Vaš tromesečni prosek.\n\n` +
               `📊 STATISTIKA UNOSA DOKUMENATA ZA SLUŽBU (${sectorName}):\n` +
               `• Istorija unosa (3M): ${histFormatted}\n` +
               `• Zbir unosa (3M): ${sum3M.toLocaleString()} dokumenata\n` +
               `• Tromesečni prosek (Bazna vrednost): ${val3MAvg.toLocaleString()} dokumenata/mesečno\n` +
               `• Unos u mesecu ${currName}: ${valCurr.toLocaleString()} dokumenata\n` +
               `• Razlika i Skok: ${diffSign} dokumenata (${pctSign} u odnosu na tromesečni prosek)\n` +
               `• Procena aktivnosti službe: ${statusName}\n\n` +
               `Nastavite sa dobrim radom!\n\n` +
               `Srdačan pozdrav,\n${dmsSignature()}`;
    } else if (oscillationType === 'blagi_pad') {
        subject = `[DMS Provera] Primećen blagi pad u unosu dokumenata - Služba ${sectorName}`;
        body = `Poštovani članovi službe ${sectorName},\n\n` +
               `Uvidom u analitiku DMS sistema primećen je blagi pad u unosu novih dokumenata u mesecu ${currName} u odnosu na Vaš tromesečni prosek.\n\n` +
               `📊 STATISTIKA UNOSA DOKUMENATA ZA SLUŽBU (${sectorName}):\n` +
               `• Istorija unosa (3M): ${histFormatted}\n` +
               `• Zbir unosa (3M): ${sum3M.toLocaleString()} dokumenata\n` +
               `• Tromesečni prosek (Bazna vrednost): ${val3MAvg.toLocaleString()} dokumenata/mesečno\n` +
               `• Unos u mesecu ${currName}: ${valCurr.toLocaleString()} dokumenata\n` +
               `• Razlika i Pad: ${diffSign} dokumenata (${pctSign} u odnosu na tromesečni prosek)\n` +
               `• Procena aktivnosti službe: ${statusName}\n\n` +
               `Molimo Vas za informaciju o trenutnom statusu unosa i održavanje kontinuiteta rada u narednom periodu.\n\n` +
               `Očekujem Vaš odgovor.\n\n` +
               `Srdačan pozdrav,\n${dmsSignature()}`;
    } else if (oscillationType === 'nagli_pad') {
        subject = `[DMS Upozorenje] Primećen nagli pad u unosu dokumenata - Služba ${sectorName}`;
        body = `Poštovani članovi službe ${sectorName},\n\n` +
               `Uvidom u analitiku DMS sistema primećen je nagli pad u unosu novih dokumenata u mesecu ${currName} u odnosu na Vaš tromesečni prosek.\n\n` +
               `📊 STATISTIKA UNOSA DOKUMENATA ZA SLUŽBU (${sectorName}):\n` +
               `• Istorija unosa (3M): ${histFormatted}\n` +
               `• Zbir unosa (3M): ${sum3M.toLocaleString()} dokumenata\n` +
               `• Tromesečni prosek (Bazna vrednost): ${val3MAvg.toLocaleString()} dokumenata/mesečno\n` +
               `• Unos u mesecu ${currName}: ${valCurr.toLocaleString()} dokumenata\n` +
               `• Razlika i Pad: ${diffSign} dokumenata (${pctSign} u odnosu na tromesečni prosek)\n` +
               `• Procena aktivnosti službe: ${statusName}\n\n` +
               `Molimo Vas za povratnu informaciju zašto je došlo do zastoja/pada u unosu i da li postoje određene tehničke ili organizacione prepreke kako bismo ih zajedno otklonili.\n\n` +
               `Očekujem Vaš odgovor.\n\n` +
               `Srdačan pozdrav,\n${dmsSignature()}`;
    }

    document.getElementById('emailSubject').value = subject;
    document.getElementById('emailBody').value = body;
    dmsShowEmailModal();
}

function renderSectorOscillationRows(sectors, histMonths = [], prevKey = '', currKey = '') {
    const colSpan = 6 + histMonths.length;
    if (sectors.length === 0) return `<tr><td colspan="${colSpan}" class="dms-center dms-text-dim dms-italic">Nema podataka za izabrane mesece.</td></tr>`;
    return sectors.map(s => {
        const diffText = s.diff > 0 ? `+${s.diff.toLocaleString()}` : s.diff.toLocaleString();
        const pctText = s.pct > 0 ? `+${s.pct}%` : `${s.pct}%`;
        const badgeHtml = getOscillationBadge(s.diff, s.pct, s.val3MAvg);
        const rowClass = Math.abs(s.diff) >= 20 ? (s.diff > 0 ? 'is-success' : 'is-danger') : '';
        const oscCat = oscCategoryOf(s.diff, s.pct, s.val3MAvg);
        const tone = oscToneOf(s.diff);

        const hCells = (s.hVals || []).map(v => `<td class="dms-num dms-mono dms-text-muted">${v > 0 ? v.toLocaleString() : '-'}</td>`).join('');
        const encodedSector = encodeURIComponent(s.sector);

        return `
            <tr class="${rowClass}${oscLegendHides(oscCat) ? ' dms-hidden' : ''}" data-osc-cat="${oscCat}">
                <td>
                    <div class="dms-spread">
                        <span class="dms-row dms-osc-sector-name">
                            <i data-lucide="building-2" class="dms-text-info"></i> ${s.sector}
                        </span>
                        <button onclick="openSectorEmailModal('${encodedSector}', '${prevKey}', '${currKey}')" class="dms-btn-xs dms-osc-mail-btn" title="Pošalji e-mail svim zaposlenima u službi ${s.sector}">
                            <i data-lucide="send"></i> Pošalji Mail
                        </button>
                    </div>
                </td>
                ${hCells}
                <td class="dms-num dms-mono dms-osc-col-avg" title="Prosek unosa u protekla ${histMonths.length} meseca (${s.val3MAvg.toLocaleString()} dok)">${s.val3MAvg.toLocaleString()}</td>
                <td class="dms-num dms-mono dms-osc-col-curr">${s.valCurr.toLocaleString()}</td>
                <td class="dms-num dms-mono ${tone}">${diffText}</td>
                <td class="dms-num dms-mono ${tone}">${pctText}</td>
                <td class="dms-center">
                    ${badgeHtml}
                </td>
            </tr>
        `;
    }).join('');
}

function renderEmpOscillationRows(employees, histMonths = []) {
    const colSpan = 7 + histMonths.length;
    if (employees.length === 0) return `<tr><td colspan="${colSpan}" class="dms-center dms-text-dim dms-italic">Nema podataka za izabrane mesece.</td></tr>`;
    return employees.map((e, idx) => {
        const diffText = e.diff > 0 ? `+${e.diff.toLocaleString()}` : e.diff.toLocaleString();
        const pctText = e.pct > 0 ? `+${e.pct}%` : `${e.pct}%`;
        const badgeHtml = getOscillationBadge(e.diff, e.pct, e.val3MAvg);
        const oscCat = oscCategoryOf(e.diff, e.pct, e.val3MAvg);
        const tone = oscToneOf(e.diff);

        const hCells = (e.hVals || []).map(v => `<td class="dms-num dms-mono dms-text-muted">${v > 0 ? v.toLocaleString() : '-'}</td>`).join('');

        return `
            <tr${oscLegendHides(oscCat) ? ' class="dms-hidden"' : ''} data-osc-cat="${oscCat}">
                <td class="dms-center dms-mono dms-caption">${idx + 1}</td>
                <td class="dms-strong"><div class="dms-row-wrap">${e.name} ${getUserSectorBadgeHtml(e.name)}</div></td>
                <td class="dms-text-muted">${e.sector} <span class="dms-caption">(${e.location})</span></td>
                ${hCells}
                <td class="dms-num dms-mono dms-osc-col-avg" title="Prosek unosa u protekla ${histMonths.length} meseca (${e.val3MAvg.toLocaleString()} dok)">${e.val3MAvg.toLocaleString()}</td>
                <td class="dms-num dms-mono dms-osc-col-curr">${e.valCurr.toLocaleString()}</td>
                <td class="dms-num dms-mono ${tone}">${diffText}</td>
                <td class="dms-num dms-mono ${tone}">${pctText}</td>
                <td class="dms-center">${badgeHtml}</td>
            </tr>
        `;
    }).join('');
}

/**
 * Renderuje novi tab "Nagle Oscilacije po Mesecima" (poređenje pretprošlog i prošlog meseca)
 */
function renderNagleOscilacijeTab() {
    const div = document.createElement('div');
    div.className = "dms-stack";

    if (uploadedFiles.length === 0) {
        div.innerHTML = `<div class="dms-panel dms-center dms-text-dim dms-italic">Nema učitanih fajlova.</div>`;
        return div;
    }

    const latestFile = uploadedFiles[uploadedFiles.length - 1];
    const parsedData = getKreiraniParsed(latestFile.workbook);

    if (!parsedData || !parsedData.sectorTree || parsedData.sectorTree.length === 0) {
        div.innerHTML = `
            <div class="dms-panel dms-osc-empty">
                <i data-lucide="alert-triangle" class="dms-text-warning dms-osc-empty-icon"></i>
                <h4 class="dms-heading">Podaci nisu pronađeni</h4>
                <p class="dms-subtitle">Podaci za kreirane dokumente po sektorima nisu pronađeni u najnovijem izveštaju od <strong>${latestFile.dateFormatted}</strong>.</p>
            </div>
        `;
        return div;
    }

    const { monthCols, sectorTree } = parsedData;
    const completenessInfo = getReportMonthCompleteness(latestFile, monthCols);
    const lastIncompleteKey = completenessInfo ? completenessInfo.lastIncompleteKey : null;

    // Isključujemo nekompletiran mesec iz izbora
    const validMonthCols = monthCols.filter(m => !lastIncompleteKey || m.key < lastIncompleteKey);

    if (validMonthCols.length < 2) {
        div.innerHTML = `<div class="dms-panel dms-center dms-text-dim dms-italic">Nema dovoljno završenih mesečnih kolona za poređenje naglih oscilacija.</div>`;
        return div;
    }

    // Podrazumevano: "Pretprošli mesec" je pretposlednji u listi (prosek 3M se računa do njega), a "Prošli mesec" je poslednji u listi
    let defaultPrev = validMonthCols[validMonthCols.length - 2].key;
    let defaultCurr = validMonthCols[validMonthCols.length - 1].key;

    const containerId = 'oscilacije_container_' + Math.random().toString(36).substring(2, 9);
    div.id = containerId;

    function renderContent(prevKey, currKey) {
        const prevCol = validMonthCols.find(m => m.key === prevKey) || validMonthCols[0];
        const currCol = validMonthCols.find(m => m.key === currKey) || validMonthCols[validMonthCols.length - 1];

        const prevName = prevCol.label;
        const currName = currCol.label;

        const pIdx = validMonthCols.findIndex(m => m.key === prevCol.key);
        let histCols = [];
        if (pIdx >= 0) {
            histCols = validMonthCols.slice(0, pIdx + 1).slice(-3);
        }
        if (histCols.length === 0) {
            histCols = [prevCol];
        }

        // 1. Obrada Sektora
        const sectorList = sectorTree.map(sec => {
            const hVals = histCols.map(col => sec.counts[col.key] || 0);
            const sum3M = hVals.reduce((a, b) => a + b, 0);
            const val3MAvg = Math.round(sum3M / histCols.length);
            const valCurr = sec.counts[currCol.key] || 0;
            const diff = valCurr - val3MAvg;
            const pct = val3MAvg > 0 ? Math.round((diff / val3MAvg) * 100) : (valCurr > 0 ? 100 : 0);
            return {
                sector: sec.sector,
                hVals,
                val3MAvg,
                valCurr,
                diff,
                pct,
                total: sec.total
            };
        });

        // 2. Obrada Zaposlenih
        const empList = [];
        sectorTree.forEach(sec => {
            sec.locations.forEach(loc => {
                loc.employees.forEach(emp => {
                    const hVals = histCols.map(col => emp.counts[col.key] || 0);
                    const sum3M = hVals.reduce((a, b) => a + b, 0);
                    const val3MAvg = Math.round(sum3M / histCols.length);
                    const valCurr = emp.counts[currCol.key] || 0;
                    const diff = valCurr - val3MAvg;
                    const pct = val3MAvg > 0 ? Math.round((diff / val3MAvg) * 100) : (valCurr > 0 ? 100 : 0);
                    empList.push({
                        name: emp.name,
                        sector: sec.sector,
                        location: loc.location,
                        hVals,
                        val3MAvg,
                        valCurr,
                        diff,
                        pct,
                        total: emp.total
                    });
                });
            });
        });

        // Sortiranje po proseku 3M (od najvećeg ka najmanjem); kod istog proseka prvo najveća oscilacija
        sectorList.sort((a, b) => (b.val3MAvg - a.val3MAvg) || (Math.abs(b.diff) - Math.abs(a.diff)));
        empList.sort((a, b) => (b.val3MAvg - a.val3MAvg) || (Math.abs(b.diff) - Math.abs(a.diff)));

        // Highlight podaci
        const topJumpSec = [...sectorList].sort((a, b) => b.diff - a.diff)[0];
        const topDropSec = [...sectorList].sort((a, b) => a.diff - b.diff)[0];
        const topJumpEmp = [...empList].sort((a, b) => b.diff - a.diff)[0];
        const topDropEmp = [...empList].sort((a, b) => a.diff - b.diff)[0];

        // Options za dropdown
        const prevOptionsHtml = validMonthCols.map(m => {
            const sel = m.key === prevCol.key ? 'selected' : '';
            return `<option value="${m.key}" ${sel}>${m.label}</option>`;
        }).join('');

        const currOptionsHtml = validMonthCols.map(m => {
            const sel = m.key === currCol.key ? 'selected' : '';
            return `<option value="${m.key}" ${sel}>${m.label}</option>`;
        }).join('');

        const histHeadersHtml = histCols.map(col => `<th class="dms-num">${col.label}</th>`).join('');

        // Kartica sa najvećom oscilacijom; ton je iz fiksnog skupa: success, danger, info, warning
        const renderHighlightCard = (tone, label, icon, titleText, shownText, valueText) => {
            const toneCls = 'is-' + tone;
            return `
                    <div class="dms-panel ${toneCls} dms-osc-card">
                        <div class="dms-osc-card-top">
                            <div class="dms-grow">
                                <span class="dms-osc-card-label ${toneCls}">${label}</span>
                                <h4 class="dms-osc-card-name dms-truncate" title="${titleText}">${shownText}</h4>
                            </div>
                            <div class="dms-osc-card-icon ${toneCls}">
                                <i data-lucide="${icon}"></i>
                            </div>
                        </div>
                        <div class="dms-osc-card-foot">
                            <span>Prosek 3M ➔ ${currName}:</span>
                            <span class="dms-badge is-pill ${toneCls}">${valueText}</span>
                        </div>
                    </div>`;
        };

        const jumpSecOk = topJumpSec && topJumpSec.diff > 0;
        const dropSecOk = topDropSec && topDropSec.diff < 0;
        const jumpEmpOk = topJumpEmp && topJumpEmp.diff > 0;
        const dropEmpOk = topDropEmp && topDropEmp.diff < 0;

        let html = `
            <div class="dms-stack">
                <!-- Info Banner sa Selekcijom Meseca -->
                <div class="dms-osc-banner">
                    <div class="dms-osc-banner-main">
                        <div class="dms-osc-banner-tag">
                            <i data-lucide="zap" class="dms-text-warning"></i> Poređenje sa Prosekom (3 Istorijska Meseca)
                        </div>
                        <h3 class="dms-osc-banner-title">Analiza Naglih Promena i Oscilacija Unosa</h3>
                        <p class="dms-osc-banner-text">
                            Poređenje proseka 3 istorijska meseca (zaključno sa <strong>${prevName}</strong>) u odnosu na <strong>${currName}</strong> (prošli završeni mesec).
                        </p>
                    </div>

                    <!-- Dropdown Kontrole -->
                    <div class="dms-osc-controls">
                        <div class="dms-osc-control">
                            <label class="dms-osc-control-label">Tromesečni prosek do izabranog meseca:</label>
                            <select id="osc_prev_select" class="dms-osc-select">
                                ${prevOptionsHtml}
                            </select>
                        </div>
                        <span class="dms-osc-arrow">➔</span>
                        <div class="dms-osc-control">
                            <label class="dms-osc-control-label">Mesec za poređenje sa tromesečnim prosekom:</label>
                            <select id="osc_curr_select" class="dms-osc-select">
                                ${currOptionsHtml}
                            </select>
                        </div>
                    </div>
                </div>

                <!-- HIGHLIGHT KARTICE -->
                <div class="dms-grid cols-4">
                    <!-- 1. Najveći Skok Sektora -->
                    ${renderHighlightCard('success', 'Najveći Skok Sektora', 'trending-up',
                        jumpSecOk ? topJumpSec.sector : '',
                        jumpSecOk ? topJumpSec.sector : 'Nema skoka',
                        jumpSecOk ? '+' + topJumpSec.diff.toLocaleString() + ' dok (+' + topJumpSec.pct + '%)' : '0')}

                    <!-- 2. Najveći Pad Sektora -->
                    ${renderHighlightCard('danger', 'Najveći Pad Sektora', 'trending-down',
                        dropSecOk ? topDropSec.sector : '',
                        dropSecOk ? topDropSec.sector : 'Nema pada',
                        dropSecOk ? topDropSec.diff.toLocaleString() + ' dok (' + topDropSec.pct + '%)' : '0')}

                    <!-- 3. Najveći Skok Zaposlenog -->
                    ${renderHighlightCard('info', 'Najveći Skok Zaposlenog', 'user-plus',
                        jumpEmpOk ? topJumpEmp.name : '',
                        jumpEmpOk ? topJumpEmp.name : 'Nema skoka',
                        jumpEmpOk ? '+' + topJumpEmp.diff.toLocaleString() + ' dok (+' + topJumpEmp.pct + '%)' : '0')}

                    <!-- 4. Najveći Pad Zaposlenog -->
                    ${renderHighlightCard('warning', 'Najveći Pad Zaposlenog', 'user-minus',
                        dropEmpOk ? topDropEmp.name : '',
                        dropEmpOk ? topDropEmp.name : 'Nema pada',
                        dropEmpOk ? topDropEmp.diff.toLocaleString() + ' dok (' + topDropEmp.pct + '%)' : '0')}
                </div>

                <!-- LEGENDA PROCENE OSCILACIJA -->
                <div class="dms-panel dms-spread">
                    <div class="dms-osc-legend-title">
                        <i data-lucide="tags" class="dms-text-info"></i> Legenda Procene Oscilacija:
                    </div>
                    <div class="dms-row-wrap">
                        <button type="button" data-osc-legend="bigUp" onclick="toggleOscLegend('bigUp')" title="Klik: prikaži samo ovu kategoriju (može više stavki)" class="dms-badge is-solid-success dms-osc-legend-btn${oscLegendSelected.has('bigUp') ? OSC_LEGEND_SELECTED : ''}">
                            <i data-lucide="arrow-up-circle"></i> Nagli skok u odnosu na prosek (≥ +100%)
                        </button>
                        <button type="button" data-osc-legend="smallUp" onclick="toggleOscLegend('smallUp')" title="Klik: prikaži samo ovu kategoriju (može više stavki)" class="dms-badge is-success dms-osc-legend-btn${oscLegendSelected.has('smallUp') ? OSC_LEGEND_SELECTED : ''}">
                            <i data-lucide="arrow-up"></i> Blagi skok u odnosu na prosek (&lt; +100%)
                        </button>
                        <button type="button" data-osc-legend="smallDown" onclick="toggleOscLegend('smallDown')" title="Klik: prikaži samo ovu kategoriju (može više stavki)" class="dms-badge is-danger dms-osc-legend-btn${oscLegendSelected.has('smallDown') ? OSC_LEGEND_SELECTED : ''}">
                            <i data-lucide="arrow-down"></i> Blagi pad u odnosu na prosek (&lt; 60%)
                        </button>
                        <button type="button" data-osc-legend="bigDown" onclick="toggleOscLegend('bigDown')" title="Klik: prikaži samo ovu kategoriju (može više stavki)" class="dms-badge is-solid-danger dms-osc-legend-btn${oscLegendSelected.has('bigDown') ? OSC_LEGEND_SELECTED : ''}">
                            <i data-lucide="arrow-down-circle"></i> Nagli pad u odnosu na prosek (≥ 60%)
                        </button>
                    </div>
                </div>

                <!-- TABELA 1: OSCILACIJE PO ZAPOSLENIMA SA PRETRAGOM -->
                <div class="dms-panel is-flush">
                    <div class="dms-panel-head">
                        <div>
                            <h4 class="dms-heading dms-row">
                                <i data-lucide="users" class="dms-text-info"></i> 1. DETALJNE OSCILACIJE PO ZAPOSLENIMA (${prevName} vs ${currName})
                            </h4>
                            <p class="dms-subtitle">Ukupno zaposlenih na listi: <strong class="dms-text-main">${empList.length}</strong> (Poređenje tromesečnog proseka sa mesecem ${currName})</p>
                        </div>
                        <div class="dms-osc-search">
                            <div class="dms-osc-search-icon">
                                <i data-lucide="search"></i>
                            </div>
                            <input type="text" id="osc_emp_search" onkeyup="filterTableRows('osc_emp_search', 'osc_emp_table')" placeholder="Pretraži zaposlenog ili sektor..." class="dms-osc-search-input">
                        </div>
                    </div>
                    <div class="dms-scroll custom-scrollbar dms-osc-scroll-emp">
                        <table id="osc_emp_table" class="dms-table is-sticky dms-osc-table">
                            <thead>
                                <tr>
                                    <th class="dms-center dms-osc-col-index">#</th>
                                    <th>Zaposleni / Korisnik</th>
                                    <th>Sektor / Služba</th>
                                    ${histHeadersHtml}
                                    <th class="dms-num dms-osc-col-avg" title="Prosek unosa u 3 istorijska meseca">PROSEK (${histCols.length}M)</th>
                                    <th class="dms-num dms-osc-col-curr">${currCol.label}</th>
                                    <th class="dms-num">Razlika</th>
                                    <th class="dms-num">Promena (%)</th>
                                    <th class="dms-center">Status Oscilacije</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${renderEmpOscillationRows(empList, histCols)}
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- TABELA 2: OSCILACIJE PO SEKTORIMA -->
                <div class="dms-panel is-flush">
                    <div class="dms-panel-head">
                        <span class="dms-row"><i data-lucide="network" class="dms-text-info"></i> 2. OSCILACIJE PO SEKTORIMA I SLUŽBAMA (${prevName} vs ${currName})</span>
                        <span class="dms-caption">Poređenje proseka 3M ➔ ${currName}</span>
                    </div>
                    <div class="dms-scroll custom-scrollbar dms-osc-scroll-sec">
                        <table class="dms-table dms-osc-table">
                            <thead>
                                <tr>
                                    <th>Sektor / Služba</th>
                                    ${histHeadersHtml}
                                    <th class="dms-num dms-osc-col-avg" title="Prosek unosa u 3 istorijska meseca">PROSEK (${histCols.length}M)</th>
                                    <th class="dms-num dms-osc-col-curr">${currCol.label}</th>
                                    <th class="dms-num">Razlika (Dokum.)</th>
                                    <th class="dms-num">Promena (%)</th>
                                    <th class="dms-center">Procena Oscilacije</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${renderSectorOscillationRows(sectorList, histCols, prevCol.key, currCol.key)}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;

        const targetDiv = document.getElementById(containerId);
        if (targetDiv) {
            targetDiv.innerHTML = html;

            const pSel = document.getElementById('osc_prev_select');
            const cSel = document.getElementById('osc_curr_select');
            if (pSel && cSel) {
                pSel.onchange = () => {
                    renderContent(pSel.value, cSel.value);
                };
                cSel.onchange = () => {
                    renderContent(pSel.value, cSel.value);
                };
            }
        }
    }

    setTimeout(() => {
        renderContent(defaultPrev, defaultCurr);
    }, 10);

    return div;
}


/**
 * Preklopnik za prikaz samo sektora sa oscilacijama
 */
function toggleOscillationFilter(onlyOscillations) {
    const btnAll = document.getElementById('btnFilterAllSektori');
    const btnOsc = document.getElementById('btnFilterOscSektori');

    // Aktivno dugme označava se klasom stanja is-active (izgled zavisi od klase dugmeta u views-sektori.js)
    if (btnAll) btnAll.classList.toggle('is-active', !onlyOscillations);
    if (btnOsc) btnOsc.classList.toggle('is-active', !!onlyOscillations);

    const rows = document.querySelectorAll('.sector-row');
    rows.forEach(r => {
        const hasOsc = r.getAttribute('data-has-osc') === 'true';
        if (onlyOscillations) {
            r.style.display = hasOsc ? '' : 'none';
        } else {
            r.style.display = '';
        }
    });
}

/**
 * Filtriranje po sektorima i zaposlenima u tabeli Kreirani dokumenti po sektorima
 */
function filterSektorRows() {
    const input = document.getElementById('searchSektorInput');
    if (!input) return;

    const filter = input.value.toLowerCase();
    ['sektoriTable', 'lokacijeTable'].forEach(tableId => {
        const table = document.getElementById(tableId);
        if (!table) return;
        const tbody = table.getElementsByTagName('tbody')[0];
        if (!tbody) return;
        const rows = tbody.getElementsByTagName('tr');

        for (let i = 0; i < rows.length; i++) {
            const text = rows[i].innerText.toLowerCase();
            if (text.includes(filter)) {
                rows[i].style.display = "";
            } else {
                rows[i].style.display = "none";
            }
        }
    });
}

/* ==========================================================================
   UPRAVLJANJE KORISNICIMA - MODAL I CRUD OPERACIJE (INSERT, UPDATE, DELETE)
   ========================================================================== */

