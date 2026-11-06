// Izabrano poreklo u tabu „Ispravnost dokumentacije“ (prikazuje se samo jedan blok)
let correctnessOrigin = 'KUF';

function parseKreiraniPoSektorimaFromWorkbook(wb, includeSystem = false) {
    if (!wb || !wb.SheetNames) return null;

    const monthNamesMapShort = {
        '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'Maj', '06': 'Jun',
        '07': 'Jul', '08': 'Avg', '09': 'Sep', '10': 'Okt', '11': 'Nov', '12': 'Dec'
    };

    // 1. PRIMARNI IZVOR: Radni list 'Podaci' sa sirovim zapisima
    const podaciSheetName = wb.SheetNames.find(s => /^podaci$/i.test(s.trim()));
    if (podaciSheetName && wb.Sheets[podaciSheetName]) {
        const raw = XLSX.utils.sheet_to_json(wb.Sheets[podaciSheetName], { header: 1 });
        if (raw && raw.length > 1) {
            const header = raw[0] || [];
            const idxAutor = header.indexOf('Autor');
            const idxSluzba = header.indexOf('Služba');
            const idxOC = header.indexOf('OC');
            const idxY = header.indexOf('Godina kreiranja');
            const idxM = header.indexOf('Mesec kreiranja');

            if (idxAutor !== -1 && idxSluzba !== -1 && idxY !== -1 && idxM !== -1) {
                const ymSet = new Set();
                const sectors = {};

                for (let i = 1; i < raw.length; i++) {
                    const row = raw[i];
                    if (!row || row.length === 0) continue;

                    const autor = String(row[idxAutor] || '').trim();
                    if (!includeSystem && autor === SYSTEM_AUTHOR) continue;
                    const sluzba = String(row[idxSluzba] || 'Nepoznat Sektor').trim();
                    const oc = idxOC !== -1 ? (String(row[idxOC] || 'ČA').trim() || 'ČA') : 'ČA';
                    const y = row[idxY];
                    const m = row[idxM];
                    if (!y || !m || isNaN(y) || isNaN(m)) continue;

                    const key = `${y}-${String(m).padStart(2, '0')}`;
                    ymSet.add(key);

                    if (!sectors[sluzba]) {
                        sectors[sluzba] = { sector: sluzba, total: 0, counts: {}, locationsMap: {} };
                    }
                    sectors[sluzba].total++;
                    sectors[sluzba].counts[key] = (sectors[sluzba].counts[key] || 0) + 1;

                    if (!sectors[sluzba].locationsMap[oc]) {
                        sectors[sluzba].locationsMap[oc] = { location: oc, total: 0, counts: {}, employeesMap: {} };
                    }
                    sectors[sluzba].locationsMap[oc].total++;
                    sectors[sluzba].locationsMap[oc].counts[key] = (sectors[sluzba].locationsMap[oc].counts[key] || 0) + 1;

                    const empKey = autor || 'Nepoznat Autor';
                    if (!sectors[sluzba].locationsMap[oc].employeesMap[empKey]) {
                        sectors[sluzba].locationsMap[oc].employeesMap[empKey] = { name: empKey, total: 0, counts: {} };
                    }
                    sectors[sluzba].locationsMap[oc].employeesMap[empKey].total++;
                    sectors[sluzba].locationsMap[oc].employeesMap[empKey].counts[key] = (sectors[sluzba].locationsMap[oc].employeesMap[empKey].counts[key] || 0) + 1;
                }

                // Hronološko sortiranje kolona: prvo godina pa mesec (npr. 2025-12, 2026-01... 2026-10)
                const sortedYM = Array.from(ymSet).sort();
                const monthCols = sortedYM.map(ym => {
                    const [y, mStr] = ym.split('-');
                    return {
                        key: ym,
                        year: parseInt(y, 10),
                        month: parseInt(mStr, 10),
                        label: `${monthNamesMapShort[mStr] || mStr} '${y.slice(2)}`
                    };
                });

                const sectorTree = Object.values(sectors);
                sectorTree.sort((a, b) => b.total - a.total);
                sectorTree.forEach(sec => {
                    const locArr = Object.values(sec.locationsMap);
                    locArr.forEach(loc => {
                        const empArr = Object.values(loc.employeesMap);
                        empArr.sort((a, b) => b.total - a.total);
                        loc.employees = empArr;
                        delete loc.employeesMap;
                    });
                    sec.locations = locArr;
                    delete sec.locationsMap;
                });

                return { monthCols, sectorTree };
            }
        }
    }

    // 2. REZERVNI IZVOR: Ako nema lista 'Podaci', čitamo tab 'Kreirani dokumenti po sektorima'
    const sheetName = wb.SheetNames.find(s => /kreirani\s*dok.*sektor/i.test(s) || /sektor/i.test(s));
    if (!sheetName) return null;

    const sheet = wb.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    if (raw.length < 4) return null;

    const monthCols = [];
    const headerRow = raw[3] || [];
    for (let c = 1; c < headerRow.length; c++) {
        const val = headerRow[c];
        if (typeof val === 'number') {
            const mStr = String(val).padStart(2, '0');
            monthCols.push({
                key: String(val),
                colIdx: c,
                month: val,
                year: 2026,
                label: monthNamesMapShort[mStr] || `M${val}`
            });
        }
    }

    const sectorTree = [];
    let currentSector = null;
    let currentLocation = null;
    const locationsList = ['ČA', 'KV', '-'];

    const knownSectors = [
        'Docloop', 'Nabavka', 'Opšti / Pravni poslovi', 'Računovodstvo', 'Finansije',
        'Back office', 'Carina', 'Prodaja', 'Transport', 'Investiciona gradnja',
        'Sektor IT', 'Kontrola', 'Planiranje', 'Razvoj', 'Marketing', 'BZR',
        'Proizvodnja', 'HR', 'Vozači', 'CEO', 'Rukovodilac službe obezbeđenja i protivpožarne zaštite',
        'WCM', 'Održavanje', 'Kuhinja', 'Kontrola životne sredine'
    ];

    for (let r = 4; r < raw.length; r++) {
        const row = raw[r];
        if (!row || row.length === 0) continue;

        const label = String(row[0] || '').trim();
        if (!label || label === 'Grand Total' || label === 'Row Labels' || label === 'Count of Naziv dokumenta') continue;

        const counts = {};
        monthCols.forEach(m => {
            counts[m.key] = typeof row[m.colIdx] === 'number' ? row[m.colIdx] : 0;
        });
        const total = counts['Grand Total'] || Object.values(counts).reduce((a, b) => a + b, 0);

        if (locationsList.includes(label)) {
            currentLocation = { location: label, counts, total, employees: [] };
            if (currentSector) {
                currentSector.locations.push(currentLocation);
            }
        } else if (knownSectors.includes(label)) {
            currentSector = { sector: label, counts, total, locations: [] };
            sectorTree.push(currentSector);
            currentLocation = null;
        } else {
            const empObj = { name: label, counts, total };
            if (currentLocation) {
                currentLocation.employees.push(empObj);
            } else if (currentSector) {
                if (currentSector.locations.length === 0) {
                    currentSector.locations.push({ location: 'ČA', counts, total, employees: [] });
                }
                currentSector.locations[currentSector.locations.length - 1].employees.push(empObj);
            }
        }
    }

    sectorTree.sort((a, b) => b.total - a.total);
    sectorTree.forEach(sec => {
        sec.locations.forEach(loc => {
            loc.employees.sort((a, b) => b.total - a.total);
        });
    });

    return { monthCols, sectorTree };
}

/**
 * Računa mesec-na-mesec progres/oscilaciju zaposlenog za dati mesec
 * sa pravilima bojenja:
 * 1. Manje od 5 dokumenata (< 5 dok u obja meseca) -> Bez bojenja!
 * 2. Skok >= 300% (sa >= 5 dok) -> Tamno zeleno
 * 3. Skok >= 100% (sa >= 5 dok) -> Svetlo zeleno
 * 4. Pad >= 60% (sa >= 5 dok) -> Svetlo crveno
 * 5. Pad >= 80% / veći padovi (sa >= 5 dok) -> Tamno crveno
 */
/**
 * Računa mesec-na-mesec progres/oscilaciju zaposlenog za dati indeks kolone meseca
 * sa pravilima bojenja:
 * 1. Manje od 5 dokumenata (< 5 dok u oba meseca) -> Bez bojenja!
 * 2. Skok >= 300% (sa >= 5 dok) -> Tamno zeleno (ako je currVal >= 10), inače svetlo zeleno
 * 3. Skok >= 100% (sa >= 5 dok) -> Svetlo zeleno
 * 4. Pad >= 60% (sa >= 5 dok) -> Svetlo crveno
 * 5. Pad >= 90% (sa >= 10 dok) -> Tamno crveno
 */
function getEmployeeMonthProgress(empCounts, colIdx, monthCols, lastIncompleteKey = null) {
    if (!monthCols || colIdx <= 0 || colIdx >= monthCols.length) return null;

    const currCol = monthCols[colIdx];
    const prevCol = monthCols[colIdx - 1];
    const currKey = currCol.key;
    const prevKey = prevCol.key;

    // Za nepotpun mesec i sve mesece nakon njega podaci se ne porede sa prethodnim mesecom
    if (lastIncompleteKey && currKey >= lastIncompleteKey) {
        return {
            prevKey, currKey, mPrevName: prevCol.label, mCurrName: currCol.label,
            prevVal: 0, currVal: empCounts[currKey] || 0, diff: 0,
            pctText: ``, pctVal: 0, type: 'incomplete', isMinVolume: false,
            badgeHtml: ``
        };
    }

    const prevVal = empCounts[prevKey] || 0;
    const currVal = empCounts[currKey] || 0;

    if (prevVal === 0 && currVal === 0) return null;

    const diff = currVal - prevVal;
    const mPrevName = prevCol.label;
    const mCurrName = currCol.label;

    const isSpecialIncomplete = (currKey === lastIncompleteKey);
    const isMinVolume = (prevVal >= 5 || currVal >= 5);

    if (prevVal === 0 && currVal > 0) {
        if (!isMinVolume) {
            return {
                prevKey, currKey, mPrevName, mCurrName, prevVal, currVal, diff,
                pctText: `+100%`, pctVal: 100, type: 'none', isMinVolume: false,
                badgeHtml: `<span class="dms-sektori-pct is-flat">+100%</span>`
            };
        }
        return {
            prevKey, currKey, mPrevName, mCurrName, prevVal, currVal, diff,
            pctText: `+100%`, pctVal: 100, type: 'light_green', isMinVolume: true,
            badgeHtml: `<span class="dms-badge is-success dms-sektori-pct">▲ +100%</span>`
        };
    }

    if (prevVal > 0) {
        const pct = Math.round((diff / prevVal) * 100);

        if (!isMinVolume) {
            return {
                prevKey, currKey, mPrevName, mCurrName, prevVal, currVal, diff,
                pctText: `${pct > 0 ? '+' : ''}${pct}%`, pctVal: pct, type: 'none', isMinVolume: false,
                badgeHtml: `<span class="dms-sektori-pct is-flat">${pct > 0 ? '+' : ''}${pct}%</span>`
            };
        }

        if (pct >= 300) {
            if (currVal >= 10) {
                return {
                    prevKey, currKey, mPrevName, mCurrName, prevVal, currVal, diff,
                    pctText: `+${pct}%`, pctVal: pct, type: 'dark_green', isMinVolume: true,
                    badgeHtml: `<span class="dms-badge is-solid-success dms-sektori-pct">▲ +${pct}%</span>`
                };
            } else {
                return {
                    prevKey, currKey, mPrevName, mCurrName, prevVal, currVal, diff,
                    pctText: `+${pct}%`, pctVal: pct, type: 'light_green', isMinVolume: true,
                    badgeHtml: `<span class="dms-badge is-success dms-sektori-pct">▲ +${pct}%</span>`
                };
            }
        } else if (pct >= 100) {
            return {
                prevKey, currKey, mPrevName, mCurrName, prevVal, currVal, diff,
                pctText: `+${pct}%`, pctVal: pct, type: 'light_green', isMinVolume: true,
                badgeHtml: `<span class="dms-badge is-success dms-sektori-pct">▲ +${pct}%</span>`
            };
        } else if (pct > 0) {
            return {
                prevKey, currKey, mPrevName, mCurrName, prevVal, currVal, diff,
                pctText: `+${pct}%`, pctVal: pct, type: 'up_normal', isMinVolume: true,
                badgeHtml: `<span class="dms-sektori-pct is-up">▲ +${pct}%</span>`
            };
        } else if (pct <= -90) {
            if (isSpecialIncomplete) {
                return {
                    prevKey, currKey, mPrevName, mCurrName, prevVal, currVal, diff,
                    pctText: `${pct}%`, pctVal: pct, type: 'incomplete', isMinVolume: true,
                    badgeHtml: `<span class="dms-sektori-pct is-warn">${pct}%*</span>`
                };
            }
            if (prevVal >= 10) {
                // Tamno crveno (Pad >= -90% na 10 ili više dokumenata)
                return {
                    prevKey, currKey, mPrevName, mCurrName, prevVal, currVal, diff,
                    pctText: `${pct}%`, pctVal: pct, type: 'dark_red', isMinVolume: true,
                    badgeHtml: `<span class="dms-badge is-solid-danger dms-sektori-pct">▼ ${pct}%</span>`
                };
            } else {
                // Svetlo crveno (Pad >= -90% na manje od 10 dokumenata)
                return {
                    prevKey, currKey, mPrevName, mCurrName, prevVal, currVal, diff,
                    pctText: `${pct}%`, pctVal: pct, type: 'light_red', isMinVolume: true,
                    badgeHtml: `<span class="dms-badge is-danger dms-sektori-pct">▼ ${pct}%</span>`
                };
            }
        } else if (pct <= -60) {
            if (isSpecialIncomplete) {
                return {
                    prevKey, currKey, mPrevName, mCurrName, prevVal, currVal, diff,
                    pctText: `${pct}%`, pctVal: pct, type: 'incomplete', isMinVolume: true,
                    badgeHtml: `<span class="dms-sektori-pct is-warn">${pct}%*</span>`
                };
            }
            return {
                prevKey, currKey, mPrevName, mCurrName, prevVal, currVal, diff,
                pctText: `${pct}%`, pctVal: pct, type: 'light_red', isMinVolume: true,
                badgeHtml: `<span class="dms-badge is-danger dms-sektori-pct">▼ ${pct}%</span>`
            };
        } else if (pct < 0) {
            return {
                prevKey, currKey, mPrevName, mCurrName, prevVal, currVal, diff,
                pctText: `${pct}%`, pctVal: pct, type: 'down_normal', isMinVolume: true,
                badgeHtml: `<span class="dms-sektori-pct is-down">▼ ${pct}%</span>`
            };
        } else {
            return {
                prevKey, currKey, mPrevName, mCurrName, prevVal, currVal, diff: 0,
                pctText: `0%`, pctVal: 0, type: 'equal', isMinVolume: true,
                badgeHtml: `<span class="dms-sektori-pct is-flat">0%</span>`
            };
        }
    }
    return null;
}

/**
 * Određuje automatski da li je izveštaj sačinjen sa kompletnim mesecima ili je u toku nepotpun mesec.
 * Pravilo:
 * Ako je datum u toku meseca (npr. 16.10.2026 ima 16 dana < 31 dan), taj mesec (Oktobar 2026) je NEPOTPUN (u toku).
 * Nepotpun mesec se NE POREDI i automatski se isključuje iz analize naglih oscilacija i anomalija.
 * Ako je izveštaj sačinjen na poslednji dan meseca (npr. 31.10.2026), mesec se smatra 100% KOMPLETIRANIM.
 */
function getReportMonthCompleteness(fileItem, monthCols = []) {
    const monthNamesMap = { 
        1: 'Januar', 2: 'Februar', 3: 'Mart', 4: 'April', 5: 'Maj', 6: 'Jun', 
        7: 'Jul', 8: 'Avgust', 9: 'Septembar', 10: 'Oktobar', 11: 'Novembar', 12: 'Decembar' 
    };

    if (!fileItem || !fileItem.parsedDate) {
        return { lastIncompleteKey: null, lastIncompleteMonthNum: null, incompleteMonthName: '', incompleteDateStr: '', isAllComplete: true };
    }

    const d = new Date(fileItem.parsedDate);
    if (isNaN(d.getTime())) {
        return { lastIncompleteKey: null, lastIncompleteMonthNum: null, incompleteMonthName: '', incompleteDateStr: '', isAllComplete: true };
    }

    const reportYear = d.getFullYear();
    const reportMonth = d.getMonth() + 1; // 1 - 12 (npr. 10 za Oktobar)
    const reportDay = d.getDate(); // 1 - 31 (npr. 16)
    const daysInMonth = new Date(reportYear, reportMonth, 0).getDate(); // 31 za oktobar
    const expectedKey = `${reportYear}-${String(reportMonth).padStart(2, '0')}`;

    // Proveravamo da li trenutni mesec izveštaja uopšte postoji u kolonama
    const hasReportMonth = (monthCols || []).some(m => m.key === expectedKey || m.key === String(reportMonth) || m.month === reportMonth);

    // Ako je dan u mesecu manji od ukupnog broja dana u tom mesecu (npr. 16 < 31), mesec je NEPOTPUN
    const isIncomplete = (reportDay < daysInMonth) && hasReportMonth;

    if (isIncomplete) {
        return {
            lastIncompleteKey: expectedKey,
            lastIncompleteMonthNum: reportMonth,
            incompleteMonthName: monthNamesMap[reportMonth] || `Mesec ${reportMonth}`,
            incompleteDateStr: fileItem.dateFormatted || `${reportDay}.${reportMonth}.${reportYear}.`,
            isAllComplete: false
        };
    }

    return {
        lastIncompleteKey: null,
        lastIncompleteMonthNum: null,
        incompleteMonthName: '',
        incompleteDateStr: fileItem.dateFormatted || '',
        isAllComplete: true
    };
}

/**
 * Detektuje nagle oscilacije u mesečnom unosu (skokove ili padove) za sektore sa obimom PREKO 5 dokumenata (> 5 dok)
 * Hronološki poređani meseci se prate kroz `monthCols` (npr. Dec '25 ➔ Jan '26 ➔ Feb '26...)
 * lastIncompleteKey: mesec koji još uvek nije završen do kraja (npr. '2026-10').
 * Za nekompletiran trenutni mesec i sve mesece nakon njega NE POREDE SE PODACI i ne prikazuju anomalije.
 */
function detectMonthOscillations(countsObj, lastIncompleteKey = null, minVolume = 5, monthCols = []) {
    const anomalies = [];
    if (!monthCols || monthCols.length < 2) return anomalies;

    for (let i = 1; i < monthCols.length; i++) {
        const prevCol = monthCols[i - 1];
        const currCol = monthCols[i];
        const prevKey = prevCol.key;
        const currKey = currCol.key;

        // Za trenutni mesec koji nije kompletiran (i sve mesece nakon njega) NE POREDE SE PODACI
        if (lastIncompleteKey && (currKey >= lastIncompleteKey || prevKey >= lastIncompleteKey)) {
            continue;
        }

        const prevVal = countsObj[prevKey] || 0;
        const currVal = countsObj[currKey] || 0;
        const diff = currVal - prevVal;

        // Kriterijum: obim mora biti veći od 5 dokumenata (>= 5 dok / > 5 dok)
        if (prevVal >= minVolume || currVal >= minVolume) {
            if (prevVal === 0 && currVal >= minVolume) {
                anomalies.push({
                    mPrev: prevCol.label,
                    mCurr: currCol.label,
                    currKey,
                    prevVal,
                    currVal,
                    diff,
                    pctText: '+100%',
                    type: 'jump'
                });
            } else if (prevVal >= minVolume) {
                const pct = Math.round((diff / prevVal) * 100);
                if (pct >= 100) {
                    anomalies.push({
                        mPrev: prevCol.label,
                        mCurr: currCol.label,
                        currKey,
                        prevVal,
                        currVal,
                        diff,
                        pctText: `+${pct}%`,
                        type: 'jump'
                    });
                } else if (pct <= -60) {
                    anomalies.push({
                        mPrev: prevCol.label,
                        mCurr: currCol.label,
                        currKey,
                        prevVal,
                        currVal,
                        diff,
                        pctText: `${pct}%`,
                        type: 'drop'
                    });
                }
            }
        }
    }
    return anomalies;
}

/**
 * Izgrađuje stablo grupisano po 1. Lokaciji (ČA, KV) -> 2. Službi -> 3. Zaposlenima
 */
function buildLocationTree(sectorTree) {
    if (!sectorTree) return [];
    const locMap = {};

    sectorTree.forEach(sec => {
        sec.locations.forEach(loc => {
            const locKey = loc.location || 'ČA';
            if (!locMap[locKey]) {
                locMap[locKey] = {
                    location: locKey,
                    total: 0,
                    counts: {},
                    sectors: []
                };
            }

            let secInLoc = locMap[locKey].sectors.find(s => s.sector === sec.sector);
            if (!secInLoc) {
                secInLoc = {
                    sector: sec.sector,
                    total: 0,
                    counts: {},
                    employees: []
                };
                locMap[locKey].sectors.push(secInLoc);
            }

            loc.employees.forEach(emp => {
                secInLoc.employees.push(emp);
                secInLoc.total += emp.total;
                locMap[locKey].total += emp.total;

                Object.keys(emp.counts).forEach(mKey => {
                    const val = emp.counts[mKey] || 0;
                    secInLoc.counts[mKey] = (secInLoc.counts[mKey] || 0) + val;
                    locMap[locKey].counts[mKey] = (locMap[locKey].counts[mKey] || 0) + val;
                });
            });
        });
    });

    const locationTree = Object.values(locMap);
    locationTree.sort((a, b) => b.total - a.total);

    locationTree.forEach(l => {
        l.sectors.sort((a, b) => b.total - a.total);
        l.sectors.forEach(s => {
            s.employees.sort((a, b) => b.total - a.total);
        });
    });

    return locationTree;
}

/**
 * Prikaz taba 'Kreirani dokumenti po sektorima' (podaci se UVEK gledaju iz POSLEDNJEG dodatog fajla)
 */
// Lokacije u tabeli: prvo Čačak (ČA), pa Kraljevo (KV), ostale posle njih
function sortLocationsChaKv(locations) {
    const rank = loc => (loc === 'ČA' ? 0 : (loc === 'KV' ? 1 : 2));
    return [...locations].sort((a, b) => rank(a.location) - rank(b.location));
}

function renderKreiraniDokumentiPoSektorimaTab() {
    const div = document.createElement('div');
    div.className = "dms-stack";

    if (uploadedFiles.length === 0) {
        div.innerHTML = `<div class="dms-empty">Nema učitanih fajlova.</div>`;
        return div;
    }

    // Uvek uzimamo najnoviji / poslednji dodati izveštaj po datumu
    const latestFile = uploadedFiles[uploadedFiles.length - 1];

    // Parsiramo podatke iz najnovijeg fajla
    const parsedData = getKreiraniParsed(latestFile.workbook);

    if (!parsedData || !parsedData.sectorTree || parsedData.sectorTree.length === 0) {
        div.innerHTML = `
            <div class="dms-panel dms-stack-sm dms-center">
                <i data-lucide="alert-triangle" class="dms-text-warning dms-sektori-empty-icon"></i>
                <h4 class="dms-heading">Radni list nije pronađen</h4>
                <p class="dms-caption">Podaci za tab "Kreirani dokumenti po sektorima" nisu pronađeni u poslednjem učitanom izveštaju od <strong>${latestFile.dateFormatted}</strong>.</p>
            </div>
        `;
        return div;
    }

    const { monthCols, sectorTree } = parsedData;

    const completenessInfo = getReportMonthCompleteness(latestFile, monthCols);
    const lastIncompleteKey = completenessInfo.lastIncompleteKey;

    // Detekcija oscilacija po sektorima (skokovi >= 100% ili padovi >= 60%), isključujući nepotpun mesec
    // Posmatraju se samo podaci od 1.1.2026. (meseci iz 2025. se ne uzimaju u obzir)
    // Mesec koji je završen za tabele (izveštaj od 30. ili 31.) ulazi u oscilacije, inače se nepotpun mesec isključuje
    const reportDateObj = latestFile && latestFile.parsedDate ? new Date(latestFile.parsedDate) : null;
    const reportLastDay = reportDateObj ? new Date(reportDateObj.getFullYear(), reportDateObj.getMonth() + 1, 0).getDate() : 0;
    const monthClosedForTables = !!reportDateObj && reportDateObj.getDate() >= Math.min(30, reportLastDay);
    const oscKey = monthClosedForTables ? null : lastIncompleteKey;
    const oscMonthCols = monthCols.filter(m => m.year >= 2026);
    const sectorsWithAnomalies = sectorTree.map(sec => ({
        sec,
        osc: detectMonthOscillations(sec.counts, oscKey, 5, oscMonthCols)
    })).filter(item => item.osc.length > 0);

    // Izračunavanje ukupnih zbirova
    const grandTotalDocs = sectorTree.reduce((sum, s) => sum + s.total, 0);
    const incMonthDocs = lastIncompleteKey ? sectorTree.reduce((sum, s) => sum + (s.counts[lastIncompleteKey] || 0), 0) : 0;

    // Proračun bilansa oscilacija (Podvučena crta)
    let totalJumpVolume = 0;
    let totalDropVolume = 0;
    let jumpCount = 0;
    let dropCount = 0;

    sectorsWithAnomalies.forEach(item => {
        item.osc.forEach(o => {
            if (o.type === 'jump') {
                totalJumpVolume += o.diff;
                jumpCount++;
            } else if (o.type === 'drop') {
                totalDropVolume += Math.abs(o.diff);
                dropCount++;
            }
        });
    });

    const netBalance = totalJumpVolume - totalDropVolume;
    const isNetPositive = netBalance >= 0;

    // Procentualna promena u odnosu na prethodni mesec (mala oznaka ispod broja u ćeliji)
    const monthDeltaHtml = (val, prevVal) => {
        if (prevVal > 0) {
            const pct = Math.round(((val - prevVal) / prevVal) * 100);
            if (pct > 0) return `<span class="dms-sektori-delta is-up">▲ +${pct}%</span>`;
            if (pct < 0) return `<span class="dms-sektori-delta is-down">▼ ${pct}%</span>`;
            return `<span class="dms-sektori-delta is-flat">0%</span>`;
        }
        if (prevVal === 0 && val > 0) return `<span class="dms-sektori-delta is-up">▲ +100%</span>`;
        return '';
    };

    const infoBannerHtml = `
        <div class="dms-sektori-banner dms-spread">
            <div class="dms-stack-xs dms-grow">
                <div class="dms-row-wrap">
                    <span class="dms-badge is-info">
                        <i data-lucide="history"></i> Poslednji Izveštaj: ${latestFile.dateFormatted}
                    </span>
                    <span class="dms-caption dms-truncate">(${latestFile.name})</span>
                </div>
                <h3 class="dms-title dms-row">
                    <i data-lucide="network" class="dms-text-info"></i> KREIRANI DOKUMENTI PO SEKTORIMA
                </h3>
                <p class="dms-subtitle">Podaci o kreiranim dokumentima po sektorima, lokacijama (ČA, KV) i zaposlenima iz poslednje učitanog izveštaja sa automatskom detekcijom oscilacija unosa.</p>
            </div>

            <div class="dms-row dms-fixed">
                <div class="dms-sektori-kpi">
                    <span class="dms-sektori-kpi-label">Ukupno Kreirano</span>
                    <div class="dms-sektori-kpi-value">${grandTotalDocs.toLocaleString()}</div>
                </div>
                <div class="dms-sektori-kpi">
                    <span class="dms-sektori-kpi-label">Broj Sektora</span>
                    <div class="dms-sektori-kpi-value">${sectorTree.length}</div>
                </div>
                <div class="dms-sektori-kpi is-warning">
                    <span class="dms-sektori-kpi-label">Nagle Oscilacije</span>
                    <div class="dms-sektori-kpi-value">${sectorsWithAnomalies.length} Sektora</div>
                </div>
            </div>
        </div>
    `;

    // 1. KONTROLNI PANEL DETEKOVANIH OSCILACIJA SA PODVUČENOM CRTOM I SALDOM
    let oscDashboardHtml = '';
    if (sectorsWithAnomalies.length > 0) {
        oscDashboardHtml = `
            <div class="dms-panel is-warning dms-stack">
                <div class="dms-sektori-osc-head">
                    <div class="dms-row-wrap">
                        <h4 class="dms-heading dms-row">
                            <i data-lucide="alert-triangle" class="dms-text-warning"></i> UVID U NAGLE OSCILACIJE I ANOMALIJE UNOSA (${sectorsWithAnomalies.length} SEKTORA)
                        </h4>
                        <span class="dms-badge is-info">
                            <i data-lucide="calendar-check"></i> Isključivo kompletirani meseci
                        </span>
                        <span class="dms-badge is-warning">
                            <i data-lucide="ban"></i> Nema podataka za ${completenessInfo.incompleteMonthName || 'tekući mesec'} (mesec u toku)
                        </span>
                    </div>
                    <p class="dms-subtitle">U ovom pregledu su obuhvaćeni <strong>svi prethodni kompletirani meseci</strong>. Nekompletirani tekući mesec (${completenessInfo.incompleteMonthName || 'Oktobar'}) je izuzet kako ne bi došlo do lažnih prikaza padova. (Kriterijum: isključivo za obim preko 5 dokumenata / &gt; 5 dok, skok ≥ +100% ili pad ≥ -60%).</p>
                </div>

                <div class="dms-grid cols-3">
        `;

        sectorsWithAnomalies.forEach(item => {
            const secName = item.sec.sector;
            const totalDocs = item.sec.total;
            const eventsHtml = item.osc.map(o => {
                const isJump = o.type === 'jump';
                const badgeTone = isJump ? 'is-success' : 'is-danger';
                const icon = isJump ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down';
                const diffSign = o.diff > 0 ? `+${o.diff}` : o.diff;

                return `
                    <div class="dms-sektori-event">
                        <span class="dms-strong">${o.mPrev} ➔ ${o.mCurr}</span>
                        <span class="dms-badge ${badgeTone}">
                            <i data-lucide="circle" class="${icon}"></i> ${o.pctText} (${diffSign} dok)
                        </span>
                    </div>
                `;
            }).join('');

            oscDashboardHtml += `
                <div class="dms-panel dms-stack-sm">
                    <div class="dms-spread">
                        <span class="dms-strong dms-row">
                            <i data-lucide="building-2" class="dms-text-warning"></i> ${secName}
                        </span>
                        <span class="dms-badge is-warning dms-mono">Ukupno: <strong>${totalDocs.toLocaleString()}</strong> dokumenata</span>
                    </div>
                    <div class="dms-stack-xs dms-sektori-events">
                        ${eventsHtml}
                    </div>
                </div>
            `;
        });

        oscDashboardHtml += `
                </div>

                <!-- PODVUČENA CRTA: BILANS SKOKOVA VS PADOVA -->
                <div class="dms-panel dms-spread">
                    <div class="dms-row-wrap">
                        <span class="dms-label dms-row">
                            <i data-lucide="calculator" class="dms-text-warning"></i> BILANS OSCILACIJA (PODVUČENA CRTA):
                        </span>
                        <span class="dms-badge is-success">
                            <i data-lucide="trending-up"></i> Nagli skokovi (${jumpCount}): +${totalJumpVolume.toLocaleString()} dok
                        </span>
                        <span class="dms-badge is-danger">
                            <i data-lucide="trending-down"></i> Nagli padovi (${dropCount}): -${totalDropVolume.toLocaleString()} dok
                        </span>
                    </div>

                    <div class="dms-row">
                        <span class="dms-strong dms-small">Neto Saldo Oscilacija:</span>
                        <span class="dms-badge ${isNetPositive ? 'is-solid-success' : 'is-solid-danger'} dms-sektori-net">
                            ${isNetPositive ? '+' + netBalance.toLocaleString() : netBalance.toLocaleString()} dokumenata (${isNetPositive ? 'DOMINIRAJU SKOKOVI UNOSA' : 'DOMINIRAJU PADOVI UNOSA'})
                        </span>
                    </div>
                </div>

                <!-- INFORMACIJA O NEPOTPUNOM / KOMPLETNOM MESECU -->
                ${completenessInfo.isAllComplete ? `
                <div class="dms-notice is-success dms-row">
                    <i data-lucide="check-circle"></i>
                    <span><strong>Status izveštaja:</strong> Izveštaj od <strong>${latestFile.dateFormatted}</strong> obuhvata u potpunosti kompletirane mesece. Svi padovi i skokovi unosa se vrednuju u potpunosti.</span>
                </div>
                ` : `
                <div class="dms-notice is-warning dms-row">
                    <i data-lucide="info"></i>
                    <span><strong>Napomena o nepotpunom mesecu (${completenessInfo.incompleteMonthName}):</strong> Izveštaj od ${latestFile.dateFormatted} je sačinjen u toku meseca (do datuma je uneto ukupno <strong>${incMonthDocs.toLocaleString()}</strong> dokumenata). Pošto mesec ${completenessInfo.incompleteMonthName} još uvek nije kompletiran do kraja, podaci za taj mesec su automatski isključeni iz analize naglih oscilacija i anomalija unosa.</span>
                </div>
                `}
            </div>
        `;
    }

    // Poslednja 3 završena meseca (isključujući nepotpun mesec, osim ako je mesec završen za tabele)
    const completedMonthCols = monthClosedForTables ? monthCols : monthCols.filter(m => !lastIncompleteKey || m.key < lastIncompleteKey);
    const incompleteMonthCols = monthClosedForTables ? [] : monthCols.filter(m => lastIncompleteKey && m.key >= lastIncompleteKey);
    // Prosek se računa za 3 meseca PRE poslednjeg završenog meseca (npr. Jun, Jul, Avg za Septembar)
    const hist3MCols = completedMonthCols.slice(-4, -1);
    // Poslednji završeni mesec je referenca za procenat promene u odnosu na prosek
    const refMonthCol = completedMonthCols[completedMonthCols.length - 1] || null;
    const refKey = refMonthCol ? refMonthCol.key : null;
    const hist3MTitle = hist3MCols.map(m => m.label).join(', ');
    const hist3MLabel = hist3MCols.length > 0 ? `Prosek (${hist3MCols.length}M završeni)` : `Prosek (3M)`;

    // 2. TABELA 1: PREGLED PO SLUŽBAMA / SEKTORIMA (1. Služba -> 2. Lokacija -> 3. Zaposleni)
    let tableHtml = `
        <div class="dms-panel is-flush">
            <div class="dms-panel-head dms-sektori-head">
                <div>
                    <h4 class="dms-title dms-row">
                        <i data-lucide="building" class="dms-text-info"></i> 1. PREGLED PO SLUŽBAMA / SEKTORIMA (1. Služba ➔ 2. Lokacija ➔ 3. Zaposleni)
                    </h4>
                    <p class="dms-subtitle">Podaci iz najnovijeg fajla (${latestFile.dateFormatted}) hronološki sortirani po godinama i mesecima</p>
                </div>

                <div class="dms-row-wrap">
                    <!-- FILTER ZA OSCILACIJE -->
                    <div class="dms-sektori-seg">
                        <button id="btnFilterAllSektori" onclick="toggleOscillationFilter(false)" class="dms-btn-xs is-active">
                            Sve Službe (${sectorTree.length})
                        </button>
                        <button id="btnFilterOscSektori" onclick="toggleOscillationFilter(true)" class="dms-btn-xs">
                            <i data-lucide="alert-triangle" class="dms-text-warning"></i> Samo Oscilacije (${sectorsWithAnomalies.length})
                        </button>
                    </div>

                    <!-- PRETRAGA INPUT -->
                    <div class="dms-sektori-search">
                        <span class="dms-sektori-search-icon">
                            <i data-lucide="search"></i>
                        </span>
                        <input type="text" id="searchSektorInput" onkeyup="filterSektorRows()" placeholder="Pretraži službu ili zaposlenog..." class="dms-sektori-search-input">
                    </div>
                </div>
            </div>

            <!-- LEGENDA PRAVILA BOJENJA POLJA -->
            <div class="dms-sektori-legend dms-spread">
                <div class="dms-label dms-row">
                    <i data-lucide="palette" class="dms-text-info"></i> Legenda označenih oscilacija:
                </div>
                <div class="dms-row-wrap">
                    <div class="dms-sektori-legend-item">
                        <span class="dms-sektori-swatch is-plain"></span>
                        <span class="dms-text-muted">&lt; 5 dokumenata (Bez bojenja)</span>
                    </div>
                    <div class="dms-sektori-legend-item">
                        <span class="dms-sektori-swatch is-light-green"></span>
                        <span class="dms-text-success">Skok od +100% do 300% i skok preko 300% na &lt;10 dok (Svetlo zeleno)</span>
                    </div>
                    <div class="dms-sektori-legend-item">
                        <span class="dms-sektori-swatch is-dark-green"></span>
                        <span class="dms-text-success">Skok &ge; +300% na &ge;10 dok (Tamno zeleno)</span>
                    </div>
                    <div class="dms-sektori-legend-item">
                        <span class="dms-sektori-swatch is-light-red"></span>
                        <span class="dms-text-danger">Pad od -60% do -90% i pad od -90% do -100% na &lt;10 dok (Svetlo crveno)</span>
                    </div>
                    <div class="dms-sektori-legend-item">
                        <span class="dms-sektori-swatch is-dark-red"></span>
                        <span class="dms-text-danger">Pad &ge; -90% na &ge;10 dok (Tamno crveno)</span>
                    </div>
                </div>
            </div>

            <div class="dms-sektori-scroll">
                <table id="sektoriTable" class="dms-table is-sticky dms-sektori-table">
                    <thead>
                        <tr>
                            <th class="dms-center dms-sektori-col-idx">#</th>
                            <th>Služba / Sektor</th>
                            <th class="dms-center">Lokacija</th>
    `;

    completedMonthCols.forEach(m => {
        tableHtml += `<th class="dms-num" title="Kompletan mesec">${m.label}</th>`;
    });

    // Kolona za PROSEK (3M) pozicionirana ODMAH do poslednjeg kompletiranog meseca
    tableHtml += `<th class="dms-num dms-sektori-avg" title="Prosek za poslednja 3 završena meseca (${hist3MTitle})">${hist3MLabel}<br><span class="dms-sektori-avg-sub">% vs ${refMonthCol ? refMonthCol.label : '-'}</span></th>`;

    // Meseci nakon poslednjeg kompletiranog meseca (npr. tekući nepotpun mesec u toku)
    incompleteMonthCols.forEach(m => {
        tableHtml += `<th class="dms-num dms-sektori-open" title="Nepotpun mesec (${completenessInfo.incompleteMonthName}) - podaci u toku sačinjen ${latestFile.dateFormatted}">${m.label} *</th>`;
    });

    tableHtml += `
                            <th class="dms-num dms-sektori-total">Ukupno Dokumenata</th>
                            <th class="dms-num dms-sektori-share">% Udeo</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    sectorTree.forEach((sec, idx) => {
        const sharePct = grandTotalDocs > 0 ? ((sec.total / grandTotalDocs) * 100).toFixed(1) : '0.0';
        const locBadges = sortLocationsChaKv(sec.locations).map(l => `<span class="dms-badge">${l.location}</span>`).join('');

        const secOsc = detectMonthOscillations(sec.counts, oscKey, 5, oscMonthCols);
        const hasOsc = secOsc.length > 0;

        let oscBadgeHtml = '';
        if (hasOsc) {
            oscBadgeHtml = `<span class="dms-badge is-warning is-pill" title="Detektovane nagle oscilacije u unosu"><i data-lucide="line-chart"></i> Oscilacije (${secOsc.length})</span>`;
        }

        tableHtml += `<tr class="dms-sektori-row-sector sector-row" data-has-osc="${hasOsc}">`;
        tableHtml += `<td class="dms-center dms-mono dms-text-muted">${idx + 1}</td>`;
        tableHtml += `<td>
            <div class="dms-row-wrap">
                <span class="dms-sektori-tag">
                    <i data-lucide="building-2" class="dms-text-info"></i> Služba: ${sec.sector}
                </span>
                ${oscBadgeHtml}
            </div>
        </td>`;
        tableHtml += `<td class="dms-center"><span class="dms-sektori-tags">${locBadges}</span></td>`;

        completedMonthCols.forEach((m, cIdx) => {
            const val = sec.counts[m.key] || 0;
            let pctHtml = '';
            if (cIdx > 0) {
                const prevKey = completedMonthCols[cIdx - 1].key;
                const prevVal = sec.counts[prevKey] || 0;
                pctHtml = monthDeltaHtml(val, prevVal);
            }

            const mOsc = secOsc.find(o => o.currKey === m.key);
            if (mOsc) {
                const isJump = mOsc.type === 'jump';
                const cellTone = isJump ? 'is-jump' : 'is-drop';
                tableHtml += `<td class="dms-num dms-mono dms-sektori-osc ${cellTone}" title="Nagla oscilacija: ${mOsc.mPrev} ➔ ${mOsc.mCurr}: ${mOsc.pctText} (${mOsc.diff > 0 ? '+' : ''}${mOsc.diff} dok)">
                    <span>${val.toLocaleString()}</span>
                    ${pctHtml}
                </td>`;
            } else {
                tableHtml += `<td class="dms-num dms-mono ${val > 0 ? 'dms-strong' : 'dms-text-dim'}">
                    <span>${val > 0 ? val.toLocaleString() : '-'}</span>
                    ${pctHtml}
                </td>`;
            }
        });

        // 3M prosek za sektor ODMAH DO POSLEDNJEG KOMPLETIRANOG MESECA
        const sec3MSum = hist3MCols.reduce((acc, m) => acc + (sec.counts[m.key] || 0), 0);
        const sec3MAvg = hist3MCols.length > 0 ? Math.round(sec3MSum / hist3MCols.length) : 0;
        tableHtml += `<td class="dms-num dms-mono dms-sektori-avg" title="Prosek 3 završena meseca (${hist3MTitle}): ${sec3MAvg.toLocaleString()} dok/mes">${sec3MAvg.toLocaleString()}${renderAvgChangeBadge(sec3MAvg, sec.counts[refKey] || 0)}</td>`;

        // Prikaz unosa u mesecima POSLE poslednjeg kompletiranog meseca (npr. mesec u toku)
        incompleteMonthCols.forEach(m => {
            const val = sec.counts[m.key] || 0;
            tableHtml += `<td class="dms-num dms-mono dms-sektori-open" title="Nepotpun mesec (${completenessInfo.incompleteMonthName}) - podaci u toku">
                <span>${val > 0 ? val.toLocaleString() : '-'}</span>
            </td>`;
        });

        tableHtml += `<td class="dms-num dms-mono dms-sektori-total">${sec.total.toLocaleString()}</td>`;
        tableHtml += `<td class="dms-num dms-mono dms-sektori-share">${sharePct}%</td>`;
        tableHtml += `</tr>`;

        // Prikaz lokacija i zaposlenih unutar sektora sa jasnim razdvajanjem ČA i KV
        sortLocationsChaKv(sec.locations).forEach(loc => {
            const locNameFull = loc.location === 'ČA' ? 'Lokacija: ČAČAK (ČA)' : (loc.location === 'KV' ? 'Lokacija: KRALJEVO (KV)' : `Lokacija: ${loc.location}`);
            const locTone = loc.location === 'ČA' ? 'is-ca' : 'is-kv';
            const locBadgeTone = loc.location === 'ČA' ? 'is-info' : 'is-violet';
            const locShare = grandTotalDocs > 0 ? ((loc.total / grandTotalDocs) * 100).toFixed(1) : '0.0';

            // 1. Red podzaglavlja za Lokaciju (ČA ili KV)
            tableHtml += `<tr class="dms-sektori-row-loc ${locTone} sector-row" data-has-osc="${hasOsc}">`;
            tableHtml += `<td class="dms-center dms-text-dim">📍</td>`;
            tableHtml += `<td>
                <div class="dms-row-wrap">
                    <span class="dms-sektori-loc-tag ${locTone}">
                        <i data-lucide="map-pin"></i> ${locNameFull}
                    </span>
                    <span class="dms-badge">
                        ${loc.employees.length} zaposlenih
                    </span>
                </div>
            </td>`;
            tableHtml += `<td class="dms-center"><span class="dms-badge ${locBadgeTone}">${loc.location}</span></td>`;

            completedMonthCols.forEach(m => {
                const val = loc.counts[m.key] || 0;
                tableHtml += `<td class="dms-num dms-mono dms-strong">${val > 0 ? val.toLocaleString() : '-'}</td>`;
            });

            // 3M prosek za lokaciju ODMAH DO POSLEDNJEG KOMPLETIRANOG MESECA
            const loc3MSum = hist3MCols.reduce((acc, m) => acc + (loc.counts[m.key] || 0), 0);
            const loc3MAvg = hist3MCols.length > 0 ? Math.round(loc3MSum / hist3MCols.length) : 0;
            tableHtml += `<td class="dms-num dms-mono dms-sektori-avg" title="Prosek 3 završena meseca (${hist3MTitle}): ${loc3MAvg.toLocaleString()} dok/mes">${loc3MAvg.toLocaleString()}${renderAvgChangeBadge(loc3MAvg, loc.counts[refKey] || 0)}</td>`;

            // Meseci posle poslednjeg kompletiranog meseca
            incompleteMonthCols.forEach(m => {
                const val = loc.counts[m.key] || 0;
                tableHtml += `<td class="dms-num dms-mono dms-sektori-open">${val > 0 ? val.toLocaleString() : '-'}</td>`;
            });

            tableHtml += `<td class="dms-num dms-mono dms-sektori-total">${loc.total.toLocaleString()}</td>`;
            tableHtml += `<td class="dms-num dms-mono dms-sektori-share">${locShare}%</td>`;
            tableHtml += `</tr>`;

            // 2. Zaposleni pod toj lokaciji
            loc.employees.forEach(emp => {
                const empShare = grandTotalDocs > 0 ? ((emp.total / grandTotalDocs) * 100).toFixed(1) : '0.0';

                const empLocTag = loc.location === 'ČA'
                    ? `<span class="dms-badge is-info">ČA</span>`
                    : `<span class="dms-badge is-violet">KV</span>`;

                tableHtml += `<tr class="dms-sektori-row-emp ${locTone} sector-row" data-has-osc="${hasOsc}">`;
                tableHtml += `<td class="dms-center dms-mono dms-text-dim">└</td>`;
                tableHtml += `<td>
                    <div class="dms-row-wrap">
                        <i data-lucide="user" class="dms-text-dim"></i>
                        <span class="dms-strong">${emp.name}</span>
                        ${getUserSectorBadgeHtml(emp.name)}
                    </div>
                </td>`;
                tableHtml += `<td class="dms-center">${empLocTag}</td>`;

                completedMonthCols.forEach((m, cIdx) => {
                    const val = emp.counts[m.key] || 0;
                    const prog = getEmployeeMonthProgress(emp.counts, cIdx, completedMonthCols, null);

                    if (prog) {
                        const progTones = {
                            dark_green: 'is-dark-green',
                            light_green: 'is-light-green',
                            dark_red: 'is-dark-red',
                            light_red: 'is-light-red',
                            up_normal: 'is-up',
                            down_normal: 'is-neutral'
                        };
                        const cellStyle = `dms-sektori-prog ${progTones[prog.type] || 'is-muted'}`;

                        const title = `${prog.mPrevName} (${prog.prevVal}) ➔ ${prog.mCurrName} (${prog.currVal}): ${prog.pctText} (${prog.diff > 0 ? '+' : ''}${prog.diff} dok)`;
                        tableHtml += `<td class="dms-num dms-mono ${cellStyle}" title="${title}">
                            <span>${val > 0 ? val.toLocaleString() : '0'}</span>
                        </td>`;
                    } else {
                        tableHtml += `<td class="dms-num dms-mono dms-text-dim">${val > 0 ? val.toLocaleString() : '-'}</td>`;
                    }
                });

                // 3M prosek za zaposlenog ODMAH DO POSLEDNJEG KOMPLETIRANOG MESECA
                const emp3MSum = hist3MCols.reduce((acc, m) => acc + (emp.counts[m.key] || 0), 0);
                const emp3MAvg = hist3MCols.length > 0 ? Math.round(emp3MSum / hist3MCols.length) : 0;
                tableHtml += `<td class="dms-num dms-mono dms-sektori-avg" title="Prosek 3 završena meseca (${hist3MTitle}): ${emp3MAvg.toLocaleString()} dok/mes">${emp3MAvg.toLocaleString()}${renderAvgChangeBadge(emp3MAvg, emp.counts[refKey] || 0)}</td>`;

                // Meseci posle poslednjeg kompletiranog meseca
                incompleteMonthCols.forEach(m => {
                    const val = emp.counts[m.key] || 0;
                    tableHtml += `<td class="dms-num dms-mono dms-sektori-open">${val > 0 ? val.toLocaleString() : '-'}</td>`;
                });

                tableHtml += `<td class="dms-num dms-mono dms-sektori-total">${emp.total.toLocaleString()}</td>`;
                tableHtml += `<td class="dms-num dms-mono dms-sektori-share">${empShare}%</td>`;
                tableHtml += `</tr>`;
            });
        });
    });

    // Zbirni red Tabela 1
    tableHtml += `
                    </tbody>
                    <tfoot class="dms-sektori-foot">
                        <tr>
                            <td colspan="3">UKUPNO SVE SLUŽBE (${latestFile.dateFormatted})</td>
    `;

    completedMonthCols.forEach(m => {
        const mTotal = sectorTree.reduce((sum, s) => sum + (s.counts[m.key] || 0), 0);
        tableHtml += `<td class="dms-num dms-mono">${mTotal.toLocaleString()}</td>`;
    });

    const total3MSum = hist3MCols.reduce((acc, m) => acc + sectorTree.reduce((sum, s) => sum + (s.counts[m.key] || 0), 0), 0);
    const total3MAvg = hist3MCols.length > 0 ? Math.round(total3MSum / hist3MCols.length) : 0;
    tableHtml += `<td class="dms-num dms-mono dms-sektori-avg" title="Ukupan prosek 3 završena meseca (${hist3MTitle})">${total3MAvg.toLocaleString()}${renderAvgChangeBadge(total3MAvg, sectorTree.reduce((sum, s) => sum + (s.counts[refKey] || 0), 0))}</td>`;

    incompleteMonthCols.forEach(m => {
        const mTotal = sectorTree.reduce((sum, s) => sum + (s.counts[m.key] || 0), 0);
        tableHtml += `<td class="dms-num dms-mono dms-sektori-open">${mTotal.toLocaleString()}</td>`;
    });

    tableHtml += `
                            <td class="dms-num dms-mono dms-sektori-total">${grandTotalDocs.toLocaleString()}</td>
                            <td class="dms-num dms-mono dms-sektori-share">100.0%</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    `;

    // 3. TABELA 2: PREGLED PO LOKACIJAMA I SLUŽBAMA (1. Lokacija -> 2. Služba)
    const locationTree = buildLocationTree(sectorTree);

    let table2Html = `
        <div class="dms-panel is-flush">
            <div class="dms-panel-head dms-sektori-head">
                <div>
                    <h4 class="dms-title dms-row">
                        <i data-lucide="map-pin" class="dms-text-success"></i> 2. PREGLED PO LOKACIJAMA I SLUŽBAMA (1. Lokacija ➔ 2. Služba)
                    </h4>
                    <p class="dms-subtitle">Zbirni prikaz po mestu/lokaciji (ČA, KV) i službama unutar svake lokacije hronološki po godinama i mesecima</p>
                </div>
            </div>

            <div class="dms-sektori-scroll">
                <table id="lokacijeTable" class="dms-table is-sticky dms-sektori-table">
                    <thead>
                        <tr>
                            <th class="dms-center dms-sektori-col-idx">#</th>
                            <th>Lokacija / Služba</th>
                            <th class="dms-center">Služba</th>
    `;

    completedMonthCols.forEach(m => {
        table2Html += `<th class="dms-num" title="Kompletan mesec">${m.label}</th>`;
    });

    // Kolona za PROSEK (3M) pozicionirana ODMAH do poslednjeg kompletiranog meseca
    table2Html += `<th class="dms-num dms-sektori-avg" title="Prosek za poslednja 3 završena meseca (${hist3MTitle})">${hist3MLabel}<br><span class="dms-sektori-avg-sub">% vs ${refMonthCol ? refMonthCol.label : '-'}</span></th>`;

    // Meseci nakon poslednjeg kompletiranog meseca (npr. mesec u toku)
    incompleteMonthCols.forEach(m => {
        table2Html += `<th class="dms-num dms-sektori-open" title="Nepotpun mesec (${completenessInfo.incompleteMonthName}) - podaci u toku sačinjen ${latestFile.dateFormatted}">${m.label} *</th>`;
    });

    table2Html += `
                            <th class="dms-num dms-sektori-total">Ukupno Dokumenata</th>
                            <th class="dms-num dms-sektori-share">% Udeo</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    locationTree.forEach((loc, lIdx) => {
        const locSharePct = grandTotalDocs > 0 ? ((loc.total / grandTotalDocs) * 100).toFixed(1) : '0.0';
        const locNameFull = loc.location === 'ČA' ? 'LOKACIJA: ČAČAK (ČA)' : (loc.location === 'KV' ? 'LOKACIJA: KRALJEVO (KV)' : `LOKACIJA: ${loc.location}`);
        const locTone = loc.location === 'ČA' ? 'is-ca' : 'is-kv';

        table2Html += `<tr class="dms-sektori-row-loc ${locTone} sector-row" data-has-osc="false">`;
        table2Html += `<td class="dms-center dms-mono dms-text-muted">${lIdx + 1}</td>`;
        table2Html += `<td>
            <div class="dms-row-wrap">
                <span class="dms-sektori-loc-tag ${locTone}">
                    <i data-lucide="map-pin"></i> ${locNameFull}
                </span>
                <span class="dms-badge">
                    ${loc.sectors.length} službi
                </span>
            </div>
        </td>`;
        table2Html += `<td class="dms-center"><span class="dms-badge ${loc.location === 'ČA' ? 'is-info' : 'is-violet'}">${loc.location}</span></td>`;

        completedMonthCols.forEach(m => {
            const val = loc.counts[m.key] || 0;
            table2Html += `<td class="dms-num dms-mono dms-strong">${val > 0 ? val.toLocaleString() : '-'}</td>`;
        });

        // 3M prosek za lokaciju ODMAH DO POSLEDNJEG KOMPLETIRANOG MESECA
        const loc3MSum = hist3MCols.reduce((acc, m) => acc + (loc.counts[m.key] || 0), 0);
        const loc3MAvg = hist3MCols.length > 0 ? Math.round(loc3MSum / hist3MCols.length) : 0;
        table2Html += `<td class="dms-num dms-mono dms-sektori-avg" title="Prosek 3 završena meseca (${hist3MTitle}): ${loc3MAvg.toLocaleString()} dok/mes">${loc3MAvg.toLocaleString()}${renderAvgChangeBadge(loc3MAvg, loc.counts[refKey] || 0)}</td>`;

        // Meseci posle poslednjeg kompletiranog meseca
        incompleteMonthCols.forEach(m => {
            const val = loc.counts[m.key] || 0;
            table2Html += `<td class="dms-num dms-mono dms-sektori-open">${val > 0 ? val.toLocaleString() : '-'}</td>`;
        });

        table2Html += `<td class="dms-num dms-mono dms-sektori-total">${loc.total.toLocaleString()}</td>`;
        table2Html += `<td class="dms-num dms-mono dms-sektori-share">${locSharePct}%</td>`;
        table2Html += `</tr>`;

        // Službe pod ovom lokacijom (BEZ ZAPOSLENIH)
        loc.sectors.forEach(sec => {
            const secSharePct = grandTotalDocs > 0 ? ((sec.total / grandTotalDocs) * 100).toFixed(1) : '0.0';
            const secOsc = detectMonthOscillations(sec.counts, oscKey, 5, oscMonthCols);
            const hasOsc = secOsc.length > 0;

            let oscBadgeHtml = '';
            if (hasOsc) {
                oscBadgeHtml = `<span class="dms-badge is-warning is-pill" title="Detektovane nagle oscilacije"><i data-lucide="line-chart"></i> Oscilacije (${secOsc.length})</span>`;
            }

            table2Html += `<tr class="dms-sektori-row-sector is-nested sector-row" data-has-osc="${hasOsc}">`;
            table2Html += `<td class="dms-center dms-mono dms-text-muted">└</td>`;
            table2Html += `<td>
                <div class="dms-row-wrap">
                    <span class="dms-sektori-tag">
                        <i data-lucide="building-2" class="dms-text-info"></i> Služba: ${sec.sector}
                    </span>
                    <span class="dms-badge">
                        ${sec.employees.length} zaposlenih
                    </span>
                    ${oscBadgeHtml}
                </div>
            </td>`;
            table2Html += `<td class="dms-center"><span class="dms-badge">${sec.sector}</span></td>`;

            completedMonthCols.forEach((m, cIdx) => {
                const val = sec.counts[m.key] || 0;
                let pctHtml = '';
                if (cIdx > 0) {
                    const prevKey = completedMonthCols[cIdx - 1].key;
                    const prevVal = sec.counts[prevKey] || 0;
                    pctHtml = monthDeltaHtml(val, prevVal);
                }

                const mOsc = secOsc.find(o => o.currKey === m.key);
                if (mOsc) {
                    const isJump = mOsc.type === 'jump';
                    const cellTone = isJump ? 'is-jump' : 'is-drop';
                    table2Html += `<td class="dms-num dms-mono dms-sektori-osc ${cellTone}">
                        <span>${val.toLocaleString()}</span>
                        ${pctHtml}
                    </td>`;
                } else {
                    table2Html += `<td class="dms-num dms-mono ${val > 0 ? 'dms-strong' : 'dms-text-dim'}">
                        <span>${val > 0 ? val.toLocaleString() : '-'}</span>
                        ${pctHtml}
                    </td>`;
                }
            });

            // 3M prosek za sektor na ovoj lokaciji ODMAH DO POSLEDNJEG KOMPLETIRANOG MESECA
            const sec3MSum = hist3MCols.reduce((acc, m) => acc + (sec.counts[m.key] || 0), 0);
            const sec3MAvg = hist3MCols.length > 0 ? Math.round(sec3MSum / hist3MCols.length) : 0;
            table2Html += `<td class="dms-num dms-mono dms-sektori-avg" title="Prosek 3 završena meseca (${hist3MTitle}): ${sec3MAvg.toLocaleString()} dok/mes">${sec3MAvg.toLocaleString()}${renderAvgChangeBadge(sec3MAvg, sec.counts[refKey] || 0)}</td>`;

            // Meseci posle poslednjeg kompletiranog meseca
            incompleteMonthCols.forEach(m => {
                const val = sec.counts[m.key] || 0;
                table2Html += `<td class="dms-num dms-mono dms-sektori-open" title="Nepotpun mesec (${completenessInfo.incompleteMonthName})">
                    <span>${val > 0 ? val.toLocaleString() : '-'}</span>
                </td>`;
            });

            table2Html += `<td class="dms-num dms-mono dms-sektori-total">${sec.total.toLocaleString()}</td>`;
            table2Html += `<td class="dms-num dms-mono dms-sektori-share">${secSharePct}%</td>`;
            table2Html += `</tr>`;
        });
    });

    table2Html += `
                    </tbody>
                    <tfoot class="dms-sektori-foot">
                        <tr>
                            <td colspan="3">UKUPNO SVE LOKACIJE (${latestFile.dateFormatted})</td>
    `;

    completedMonthCols.forEach(m => {
        const mTotal = locationTree.reduce((sum, l) => sum + (l.counts[m.key] || 0), 0);
        table2Html += `<td class="dms-num dms-mono">${mTotal.toLocaleString()}</td>`;
    });

    const totalLoc3MSum = hist3MCols.reduce((acc, m) => acc + locationTree.reduce((sum, l) => sum + (l.counts[m.key] || 0), 0), 0);
    const totalLoc3MAvg = hist3MCols.length > 0 ? Math.round(totalLoc3MSum / hist3MCols.length) : 0;
    table2Html += `<td class="dms-num dms-mono dms-sektori-avg" title="Ukupan prosek 3 završena meseca (${hist3MTitle})">${totalLoc3MAvg.toLocaleString()}${renderAvgChangeBadge(totalLoc3MAvg, locationTree.reduce((sum, l) => sum + (l.counts[refKey] || 0), 0))}</td>`;

    incompleteMonthCols.forEach(m => {
        const mTotal = locationTree.reduce((sum, l) => sum + (l.counts[m.key] || 0), 0);
        table2Html += `<td class="dms-num dms-mono dms-sektori-open">${mTotal.toLocaleString()}</td>`;
    });

    table2Html += `
                            <td class="dms-num dms-mono dms-sektori-total">${grandTotalDocs.toLocaleString()}</td>
                            <td class="dms-num dms-mono dms-sektori-share">100.0%</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    `;

    // 3. PREGLED ZAPOSLENIH SA UDELOM VEĆIM OD 0%: isti podaci kao u tabeli 1, sortirano po procentu proseka (3M završeni), od najboljeg do najgoreg
    const pctVsAvg = (avg, curr) => (avg > 0 ? Math.round(((curr - avg) / avg) * 100) : (curr > 0 ? 100 : 0));
    const empRows = [];
    sectorTree.forEach(sec => sec.locations.forEach(loc => loc.employees.forEach(emp => {
        // Udeo se prikazuje sa jednom decimalom, pa se 0.0% ne prikazuje (od 0.1% nadalje)
        const sharePct = grandTotalDocs > 0 ? (emp.total / grandTotalDocs) * 100 : 0;
        if (!(Number(sharePct.toFixed(1)) > 0)) return;
        const sum3M = hist3MCols.reduce((acc, m) => acc + (emp.counts[m.key] || 0), 0);
        const avg3M = hist3MCols.length > 0 ? Math.round(sum3M / hist3MCols.length) : 0;
        const curr = emp.counts[refKey] || 0;
        empRows.push({ emp, sec, loc, avg3M, curr, pct: pctVsAvg(avg3M, curr) });
    })));
    empRows.sort((a, b) => (b.pct - a.pct) || (b.avg3M - a.avg3M) || a.emp.name.localeCompare(b.emp.name, 'sr'));

    const refLabel = refMonthCol ? refMonthCol.label : '-';
    const empBody = empRows.length === 0
        ? `<tr><td colspan="${completedMonthCols.length + 6}" class="dms-center dms-italic dms-text-dim">Nema zaposlenih sa udelom većim od 0%.</td></tr>`
        : empRows.map((r, i) => `
            <tr>
                <td class="dms-center dms-mono dms-text-dim">${i + 1}</td>
                <td class="dms-strong"><span>${dmsEscapeHtml(r.emp.name)}</span> ${getUserSectorBadgeHtml(r.emp.name)}</td>
                <td class="dms-center dms-strong">${dmsEscapeHtml(r.loc.location)}</td>
                ${completedMonthCols.map(m => `<td class="dms-num dms-mono dms-text-muted">${(r.emp.counts[m.key] || 0) > 0 ? r.emp.counts[m.key].toLocaleString() : '-'}</td>`).join('')}
                <td class="dms-num dms-mono dms-sektori-avg">${r.avg3M.toLocaleString()}${renderAvgChangeBadge(r.avg3M, r.curr)}</td>
                <td class="dms-num dms-mono dms-sektori-total">${r.emp.total.toLocaleString()}</td>
                <td class="dms-num dms-mono dms-sektori-share">${grandTotalDocs > 0 ? ((r.emp.total / grandTotalDocs) * 100).toFixed(1) : '0.0'}%</td>
            </tr>`).join('');

    const table3Html = `
        <div class="dms-panel is-flush">
            <div class="dms-panel-head dms-sektori-head">
                <div>
                    <h4 class="dms-title dms-row"><i data-lucide="award" class="dms-text-info"></i> 3. PREGLED ZAPOSLENIH SA UDELOM VEĆIM OD 0% (sortirano po proseku 3M: najbolji ➔ najgori)</h4>
                    <p class="dms-subtitle">Isti podaci kao u tabeli 1, samo zaposleni sa dokumentima. Sortirano po procentu proseka (3M završeni) u odnosu na ${refLabel}.</p>
                </div>
            </div>
            <div class="dms-sektori-scroll">
                <table class="dms-table is-sticky dms-sektori-table">
                    <thead>
                        <tr>
                            <th class="dms-center dms-sektori-col-idx">#</th>
                            <th>Zaposleni</th>
                            <th class="dms-center">Lokacija</th>
                            ${completedMonthCols.map(m => `<th class="dms-num">${m.label}</th>`).join('')}
                            <th class="dms-num dms-sektori-avg">${hist3MLabel}<br><span class="dms-sektori-avg-sub">% vs ${refLabel}</span></th>
                            <th class="dms-num dms-sektori-total">Ukupno Dokumenata</th>
                            <th class="dms-num dms-sektori-share">% Udeo</th>
                        </tr>
                    </thead>
                    <tbody>${empBody}</tbody>
                </table>
            </div>
        </div>
    `;

    div.innerHTML = infoBannerHtml + oscDashboardHtml + tableHtml + table2Html + table3Html;
    return div;
}

