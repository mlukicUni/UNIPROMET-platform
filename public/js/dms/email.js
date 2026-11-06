let activeGroupEmailKeys = [];

/** Platformski modal za slanje mejla (isti ID-jevi polja kao u staroj aplikaciji) */
function dmsEnsureEmailModal() {
    if (document.getElementById('emailModal')) return;
    const modal = document.createElement('div');
    modal.className = 'modal-overlay dms-modal';
    modal.id = 'emailModal';
    modal.style.display = 'none';
    modal.innerHTML = `
        <div class="modal-window dms-wide">
            <div class="modal-top">
                <div class="modal-title-wrap">
                    <div class="yellow-icon-square-sm"><i data-lucide="send"></i></div>
                    <h5 id="emailModalTitle">Slanje e-mail obaveštenja</h5>
                </div>
                <button type="button" class="modal-close-icon" onclick="closeEmailModal()"><i data-lucide="x"></i></button>
            </div>
            <form onsubmit="handleSendEmailSubmit(event)">
                <div class="modal-body-content dms-modal-scroll">
                    <input type="hidden" id="emailRecipientKey" value="">
                    <div class="form-field">
                        <label>Pošiljalac:</label>
                        <div class="dms-sender"><i data-lucide="mail"></i><span>UNIPROMET IT Služba &lt;it@unipromet.co.rs&gt;</span></div>
                    </div>
                    <div class="form-field">
                        <label for="emailRecipientAddress">E-mail adresa(e) primaoca * <small class="dms-text-dim">(automatski uključuje ključne korisnike službe)</small></label>
                        <input type="text" id="emailRecipientAddress" required placeholder="korisnik@unipromet.co.rs" class="form-text-input">
                    </div>
                    <div class="form-field">
                        <label for="emailSubject">Naslov poruke *</label>
                        <input type="text" id="emailSubject" required class="form-text-input">
                    </div>
                    <div class="form-field">
                        <label for="emailBody">Tekst poruke *</label>
                        <textarea id="emailBody" rows="15" required class="form-text-input email-text-area"></textarea>
                    </div>
                </div>
                <div class="modal-bottom-actions">
                    <button type="button" class="btn-dark-sm" onclick="openOutlookClient()"><i data-lucide="mail-open"></i><span>Otvori u Outlook-u</span></button>
                    <button type="button" class="btn-dark-sm" onclick="closeEmailModal()"><span>Otkaži</span></button>
                    <button type="submit" class="btn-yellow-solid-sm" id="btnSendEmailSubmit"><i data-lucide="send"></i><span>Pošalji poruku</span></button>
                </div>
            </form>
        </div>`;
    document.body.appendChild(modal);
}

function dmsShowEmailModal() {
    const modal = document.getElementById('emailModal');
    if (modal) modal.style.display = 'flex';
}


/**
 * Pronalazi statistiku kreiranih dokumenata i procenu oscilacije za konkretnog korisnika
 */
function getUserOscillationStat(userName) {
    if (!userName || uploadedFiles.length === 0) return null;

    const latestFile = uploadedFiles[uploadedFiles.length - 1];
    const parsedData = getKreiraniParsed(latestFile.workbook);

    if (!parsedData || !parsedData.sectorTree || !parsedData.monthCols) return null;

    const { monthCols, sectorTree } = parsedData;
    const completenessInfo = getReportMonthCompleteness(latestFile, monthCols);
    const lastIncompleteKey = completenessInfo ? completenessInfo.lastIncompleteKey : null;

    // Uzimamo samo kompletirane mesece (isključujući nepotpun mesec)
    const completedMonthCols = monthCols.filter(m => !lastIncompleteKey || m.key < lastIncompleteKey);

    if (completedMonthCols.length < 2) return null;

    // Poslednji završeni mesec je currCol (npr. Sep '26)
    const currCol = completedMonthCols[completedMonthCols.length - 1];
    // Mesec pre njega je prevCol (npr. Avg '26)
    const prevCol = completedMonthCols[completedMonthCols.length - 2];

    // Poslednja 3 završena meseca do currCol (uključujući currCol, ili pre currCol)
    // Za poređenje unosa u currCol u odnosu na 3M istorijski prosek pre currCol:
    // Ako imamo barem 4 završena meseca, istorija su 3 meseca pre currCol.
    // Ako imamo 2 ili 3 završena meseca, istorija su svi meseci pre currCol (ili poslednja 3 završena meseca).
    let histCols = completedMonthCols.slice(0, completedMonthCols.length - 1).slice(-3);
    if (histCols.length === 0) {
        histCols = [prevCol];
    }

    const cleanName = String(userName).replace(/^Zaključao\/la\s*/i, '').replace(/^Dodeljeno\s*/i, '').trim();

    let foundEmp = null;
    let foundSectorName = '';

    for (const sec of sectorTree) {
        for (const loc of sec.locations) {
            for (const emp of loc.employees) {
                if (emp.name === cleanName || emp.name.toLowerCase() === cleanName.toLowerCase()) {
                    foundEmp = emp;
                    foundSectorName = sec.sector;
                    break;
                }
            }
            if (foundEmp) break;
        }
        if (foundEmp) break;
    }

    if (!foundEmp) return null;

    const hVals = histCols.map(col => foundEmp.counts[col.key] || 0);
    const sum3M = hVals.reduce((a, b) => a + b, 0);
    const val3MAvg = Math.round(sum3M / histCols.length);
    const valCurr = foundEmp.counts[currCol.key] || 0;
    const valPrev = foundEmp.counts[prevCol.key] || 0;
    const diff = valCurr - val3MAvg;
    const pct = val3MAvg > 0 ? Math.round((diff / val3MAvg) * 100) : (valCurr > 0 ? 100 : 0);

    const histFormatted = histCols.map((col, i) => `${col.label} (${hVals[i].toLocaleString()} dok)`).join(', ');

    let statusName = 'Nepromenjeno (0%)';
    let oscillationType = 'neutral';
    let isPraise = diff >= 0;

    if (diff > 0) {
        if (pct >= 100 || (val3MAvg === 0 && diff >= 10)) {
            statusName = 'Nagli skok u odnosu na prosek';
            oscillationType = 'nagli_skok';
        } else {
            statusName = 'Blagi skok u odnosu na prosek';
            oscillationType = 'blagi_skok';
        }
        isPraise = true;
    } else if (diff < 0) {
        const absPct = Math.abs(pct);
        if (absPct >= 60) {
            statusName = 'Nagli pad u odnosu na prosek';
            oscillationType = 'nagli_pad';
        } else {
            statusName = 'Blagi pad u odnosu na prosek';
            oscillationType = 'blagi_pad';
        }
        isPraise = false;
    }

    return {
        name: foundEmp.name,
        sector: foundSectorName,
        prevKey: prevCol.key,
        currKey: currCol.key,
        histCols,
        histFormatted,
        sum3M,
        prevName: prevCol.label,
        currName: currCol.label,
        prevShortName: prevCol.label,
        currShortName: currCol.label,
        valPrev,
        val3MAvg,
        valCurr,
        diff,
        pct,
        statusName,
        oscillationType,
        isPraise
    };
}

function openEmailModal(encodedKey) {
    dmsEnsureEmailModal();
    const key = decodeURIComponent(encodedKey);
    const u = USERS[key] || { name: key, email: '', sector: '' };

    const modal = document.getElementById('emailModal');
    if (!modal) return;

    activeGroupEmailKeys = [key];
    document.getElementById('emailRecipientKey').value = key;
    
    // Dobavljamo pojedinačnu statistiku oscilacija korisnika
    const stat = getUserOscillationStat(u.name || key);

    // Prikupljanje svih e-mail adresa: primarni korisnik + ključni korisnici njegove službe/sektora
    const emailSet = new Set();
    if (u.email && u.email.trim()) {
        emailSet.add(u.email.trim());
    }

    const userSector = u.sector || (stat ? stat.sector : '');
    if (userSector) {
        const sectorKeyUsers = Object.values(USERS).filter(ku => 
            ku.isKeyUser && 
            ku.email && 
            ku.sector && 
            ku.sector.trim().toLowerCase() === userSector.trim().toLowerCase()
        );

        sectorKeyUsers.forEach(ku => {
            if (ku.email && ku.email.trim()) {
                emailSet.add(ku.email.trim());
            }
        });
    }

    const recipientEmails = Array.from(emailSet).join('; ');
    document.getElementById('emailRecipientAddress').value = recipientEmails;

    document.getElementById('emailModalTitle').innerText = `Slanje E-mail Obaveštenja Za: ${u.name || key}`;

    let subject = `[DMS Analitika] Obaveštenje o unosu novih dokumenata - ${u.name || key}`;
    let body = `Poštovani/a ${u.name || key},\n\nMolimo vas za proveru u vašoj službi (${userSector || 'Služba'}).\n\nSrdačan pozdrav,\n${dmsSignature()}`;

    if (stat) {
        const diffSign = stat.diff > 0 ? `+${stat.diff.toLocaleString()}` : `${stat.diff.toLocaleString()}`;
        const pctSign = stat.pct > 0 ? `+${stat.pct}%` : `${stat.pct}%`;

        if (stat.oscillationType === 'nagli_skok') {
            subject = `[DMS Pohvala] Pohvala za rad i nagli skok unosa dokumenata - ${u.name || key}`;
            body = `Poštovani/a ${u.name || key},\n\n` +
                   `Pohvaljuje se Vaš izuzetan rad i znatno povećanje u unosu novih dokumenata u mesecu ${stat.currName} u odnosu na Vaš tromesečni prosek!\n\n` +
                   `📊 STATISTIKA UNOSA DOKUMENATA:\n` +
                   `• Istorija unosa (3M): ${stat.histFormatted}\n` +
                   `• Zbir unosa (3M): ${stat.sum3M.toLocaleString()} dokumenata\n` +
                   `• Tromesečni prosek (Bazna vrednost): ${stat.val3MAvg.toLocaleString()} dokumenata/mesečno\n` +
                   `• Unos u mesecu ${stat.currName}: ${stat.valCurr.toLocaleString()} dokumenata\n` +
                   `• Razlika i Skok: ${diffSign} dokumenata (${pctSign} u odnosu na tromesečni prosek)\n` +
                   `• Procena aktivnosti: ${stat.statusName}\n\n` +
                   `Nastavite sa odličnim radom!\n\n` +
                   `Srdačan pozdrav,\n${dmsSignature()}`;
        } else if (stat.oscillationType === 'blagi_skok') {
            subject = `[DMS Pohvala] Pohvala za rad i blagi skok unosa dokumenata - ${u.name || key}`;
            body = `Poštovani/a ${u.name || key},\n\n` +
                   `Pohvaljuje se Vaš rad i primećen blagi skok u unosu novih dokumenata u mesecu ${stat.currName} u odnosu na Vaš tromesečni prosek.\n\n` +
                   `📊 STATISTIKA UNOSA DOKUMENATA:\n` +
                   `• Istorija unosa (3M): ${stat.histFormatted}\n` +
                   `• Zbir unosa (3M): ${stat.sum3M.toLocaleString()} dokumenata\n` +
                   `• Tromesečni prosek (Bazna vrednost): ${stat.val3MAvg.toLocaleString()} dokumenata/mesečno\n` +
                   `• Unos u mesecu ${stat.currName}: ${stat.valCurr.toLocaleString()} dokumenata\n` +
                   `• Razlika i Skok: ${diffSign} dokumenata (${pctSign} u odnosu na tromesečni prosek)\n` +
                   `• Procena aktivnosti: ${stat.statusName}\n\n` +
                   `Nastavite sa dobrim radom!\n\n` +
                   `Srdačan pozdrav,\n${dmsSignature()}`;
        } else if (stat.oscillationType === 'blagi_pad') {
            subject = `[DMS Provera] Primećen blagi pad u unosu novih dokumenata - ${u.name || key}`;
            body = `Poštovani/a ${u.name || key},\n\n` +
                   `Uvidom u analitiku DMS sistema primećen je blagi pad u unosu novih dokumenata u mesecu ${stat.currName} u odnosu na Vaš tromesečni prosek.\n\n` +
                   `📊 STATISTIKA UNOSA DOKUMENATA:\n` +
                   `• Istorija unosa (3M): ${stat.histFormatted}\n` +
                   `• Zbir unosa (3M): ${stat.sum3M.toLocaleString()} dokumenata\n` +
                   `• Tromesečni prosek (Bazna vrednost): ${stat.val3MAvg.toLocaleString()} dokumenata/mesečno\n` +
                   `• Unos u mesecu ${stat.currName}: ${stat.valCurr.toLocaleString()} dokumenata\n` +
                   `• Razlika i Pad: ${diffSign} dokumenata (${pctSign} u odnosu na tromesečni prosek)\n` +
                   `• Procena aktivnosti: ${stat.statusName}\n\n` +
                   `Molimo Vas za informaciju o trenutnom statusu unosa i održavanje kontinuiteta rada u narednom periodu.\n\n` +
                   `Očekujem Vaš odgovor.\n\n` +
                   `Srdačan pozdrav,\n${dmsSignature()}`;
        } else { // nagli_pad ili neutral
            subject = `[DMS Upozorenje] Primećen nagli pad u unosu novih dokumenata - ${u.name || key}`;
            body = `Poštovani/a ${u.name || key},\n\n` +
                   `Uvidom u analitiku DMS sistema primećen je pad u unosu novih dokumenata u mesecu ${stat.currName} u odnosu na Vaš tromesečni prosek.\n\n` +
                   `📊 STATISTIKA UNOSA DOKUMENATA:\n` +
                   `• Istorija unosa (3M): ${stat.histFormatted}\n` +
                   `• Zbir unosa (3M): ${stat.sum3M.toLocaleString()} dokumenata\n` +
                   `• Tromesečni prosek (Bazna vrednost): ${stat.val3MAvg.toLocaleString()} dokumenata/mesečno\n` +
                   `• Unos u mesecu ${stat.currName}: ${stat.valCurr.toLocaleString()} dokumenata\n` +
                   `• Razlika i Pad: ${diffSign} dokumenata (${pctSign} u odnosu na tromesečni prosek)\n` +
                   `• Procena aktivnosti: ${stat.statusName}\n\n` +
                   `Molimo Vas za povratnu informaciju zašto je došlo do zastoja/pada u unosu i da li postoje određene tehničke ili organizacione prepreke kako bismo ih zajedno otklonili.\n\n` +
                   `Očekujem Vaš odgovor.\n\n` +
                   `Srdačan pozdrav,\n${dmsSignature()}`;
        }
    }

    document.getElementById('emailSubject').value = subject;
    document.getElementById('emailBody').value = body;

    dmsShowEmailModal();
}

function openGroupEmailModal() {
    dmsEnsureEmailModal();
    const modal = document.getElementById('emailModal');
    if (!modal) return;

    let targetKeys = Array.from(selectedUsersForEmail);
    if (targetKeys.length === 0) {
        targetKeys = Object.keys(USERS).filter(k => USERS[k]?.isKeyUser && USERS[k]?.email);
    }

    if (targetKeys.length === 0) {
        dmsAlert('Nema odabranih niti unetih ključnih korisnika sa e-mail adresom.');
        return;
    }

    activeGroupEmailKeys = [...targetKeys];
    renderGroupEmailModalUI();

    dmsShowEmailModal();
}

function removeRecipientFromGroup(encodedKey) {
    const key = decodeURIComponent(encodedKey);
    activeGroupEmailKeys = activeGroupEmailKeys.filter(k => k !== key);
    
    if (activeGroupEmailKeys.length === 0) {
        closeEmailModal();
        dmsAlert('Uklonjeni su svi primaoci iz e-mail liste.');
        return;
    }

    renderGroupEmailModalUI();
}

function renderGroupEmailModalUI() {
    const emailsSet = new Set();
    const individualStatsBody = [];
    let detectedPeriodStr = 'JUL i AVG';

    activeGroupEmailKeys.forEach(k => {
        const u = USERS[k];
        if (u) {
            const email = u.email ? u.email.trim() : '';
            if (email) {
                emailsSet.add(email);
            }

            const stat = getUserOscillationStat(u.name);
            const userSector = u.sector || (stat ? stat.sector : '');

            // Takođe automatski priključi ključne korisnike te službe
            if (userSector) {
                const sectorKeyUsers = Object.values(USERS).filter(ku => 
                    ku.isKeyUser && 
                    ku.email && 
                    ku.sector && 
                    ku.sector.trim().toLowerCase() === userSector.trim().toLowerCase()
                );
                sectorKeyUsers.forEach(ku => {
                    if (ku.email && ku.email.trim()) emailsSet.add(ku.email.trim());
                });
            }

            if (stat) {
                detectedPeriodStr = `${stat.prevShortName} i ${stat.currShortName}`;
                const diffSign = stat.diff > 0 ? `+${stat.diff.toLocaleString()}` : `${stat.diff.toLocaleString()}`;
                const pctSign = stat.pct > 0 ? `+${stat.pct}%` : `${stat.pct}%`;
                
                let note = '';
                if (stat.oscillationType === 'nagli_skok') {
                    note = 'Pohvala za izuzetan rezultat i nagli skok unosa!';
                } else if (stat.oscillationType === 'blagi_skok') {
                    note = 'Pohvala za stabilan rad i blagi skok unosa.';
                } else if (stat.oscillationType === 'blagi_pad') {
                    note = 'Primećen blagi pad u unosu. Očekujemo informaciju i kontinuitet.';
                } else {
                    note = 'Primećen nagli pad u unosu. Očekujemo povratnu informaciju o razlozima zastoja.';
                }

                individualStatsBody.push(
                    `👤 ${stat.name} (${stat.sector})\n` +
                    `   • ${stat.prevName}: ${stat.valPrev.toLocaleString()} dok | ${stat.currName}: ${stat.valCurr.toLocaleString()} dok | Promena: ${diffSign} (${pctSign})\n` +
                    `   • Procena: ${stat.statusName}\n` +
                    `   • Napomena: ${note}`
                );
            } else {
                individualStatsBody.push(
                    `👤 ${u.name} (${userSector || 'Služba'})\n` +
                    `   • Pregled statusa i nezavršenih dokumenata u radu.`
                );
            }
        }
    });

    const emailsList = Array.from(emailsSet);
    document.getElementById('emailRecipientKey').value = 'GROUP';
    document.getElementById('emailRecipientAddress').value = emailsList.join('; ');
    document.getElementById('emailModalTitle').innerText = `Grupno Slanje E-mail Obaveštenja (${emailsList.length} Adresa Primaoca)`;

    document.getElementById('emailSubject').value = `[DMS Analitika] Pregled pojedinačne statistike i aktivnosti unosa novih dokumenata po službama (${detectedPeriodStr})`;

    const groupBody = `Poštovani,\n\n` +
        `U nastavku je pojedinačna analiza i statistika unosa novih dokumenata po službama u periodu ${detectedPeriodStr}:\n\n` +
        `--------------------------------------------------\n` +
        individualStatsBody.join('\n--------------------------------------------------\n') +
        `\n--------------------------------------------------\n\n` +
        `Korisnike kod kojih je registrovan pad u unosu dokumenata molimo za povratnu informaciju o razlozima zastoja i eventualnim organizacionim/tehničkim poteškoćama.\n\n` +
        `Srdačan pozdrav,\n${dmsSignature()}`;

    document.getElementById('emailBody').value = groupBody;
}

function closeEmailModal() {
    const modal = document.getElementById('emailModal');
    if (modal) modal.style.display = 'none';
}

function openOutlookClient() {
    const rawEmails = document.getElementById('emailRecipientAddress').value.trim();
    const subject = encodeURIComponent(document.getElementById('emailSubject').value.trim());
    const body = encodeURIComponent(document.getElementById('emailBody').value.trim());

    if (!rawEmails) {
        dmsAlert('Molimo unesite e-mail adresu primaoca.');
        return;
    }

    // Za zarez ili tačka-zarez razdvojene mail adrese
    const formattedEmails = rawEmails.replace(/;\s*/g, ',').replace(/\s+/g, '');
    const mailtoUrl = `mailto:${formattedEmails}?subject=${subject}&body=${body}`;
    window.location.href = mailtoUrl;
}

async function handleSendEmailSubmit(e) {
    e.preventDefault();
    const rawEmails = document.getElementById('emailRecipientAddress').value.trim();
    const subject = document.getElementById('emailSubject').value.trim();
    const body = document.getElementById('emailBody').value.trim();

    if (!rawEmails) {
        dmsAlert('Unesite bar jednu e-mail adresu.');
        return;
    }

    const btnSubmit = document.getElementById('btnSendEmailSubmit');
    const originalText = btnSubmit.innerHTML;
    btnSubmit.innerHTML = '<i data-lucide="loader" class="dms-spin"></i> Šaljem...';
    btnSubmit.disabled = true;

    try {
        // Server šalje sa adrese platforme; primaoci su razdvojeni sa ";" ili ","
        await dmsApi('/api/dms/mail/send', dmsJson({ to: rawEmails.split(/[;,]/).map(x => x.trim()).filter(Boolean), subject, body }));
        dmsNotify('E-mail je poslat.', 'success');
        closeEmailModal();
    } catch (err) {
        console.warn('[DMS] Slanje sa servera nije uspelo:', err);
        dmsNotify('Slanje nije uspelo: ' + err.message + '. Otvaram Outlook sa popunjenim poljima.', 'error');
        openOutlookClient();
        closeEmailModal();
    } finally {
        btnSubmit.innerHTML = originalText;
        btnSubmit.disabled = false;
    }
}

