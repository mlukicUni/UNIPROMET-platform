import nodemailer from 'nodemailer';
import { getAllPrinters } from '../db/printerDb';
import { publicUrl, publicHost, mailRedirectTo } from '../utils/appConfig';

// Default local SMTP server configuration
export const SMTP_CONFIG = {
  host: process.env.SMTP_HOST || '192.168.121.1',
  port: parseInt(process.env.SMTP_PORT || '25', 10),
  secure: false,
  sender: 'it@unipromet.co.rs',
  senderName: 'UNIPROMET IT Služba'
};

export const DEFAULT_ADMIN_RECIPIENTS = [
  'marko.lukic@unipromet.co.rs',
  'andrija.borovnjak@unipromet.co.rs'
];

/**
 * Creates and returns configured Nodemailer transport.
 * If MAIL_REDIRECT_TO is set in .env (dev machine), every mail goes only to that address
 * and the original recipients are shown in the subject.
 */
export function getMailTransport() {
  const transport = nodemailer.createTransport({
    host: SMTP_CONFIG.host,
    port: SMTP_CONFIG.port,
    secure: SMTP_CONFIG.secure,
    connectionTimeout: 5000,
    tls: {
      rejectUnauthorized: false
    }
  });

  const redirectTo = mailRedirectTo();
  if (redirectTo) {
    const originalSend = transport.sendMail.bind(transport) as (options: any) => Promise<any>;
    (transport as any).sendMail = (options: any) => {
      const originalRecipients = [options.to, options.cc, options.bcc].filter(Boolean).join(', ');
      return originalSend({
        ...options,
        to: redirectTo,
        cc: undefined,
        bcc: undefined,
        subject: `[DEV → ${originalRecipients}] ${options.subject || ''}`
      });
    };
  }

  return transport;
}

/**
 * Sends a branded welcome test email from it@unipromet.co.rs
 */
export async function sendWelcomeTestEmail(recipient: string | string[] = DEFAULT_ADMIN_RECIPIENTS) {
  const transporter = getMailTransport();
  const printers = getAllPrinters(false);
  const toAddress = Array.isArray(recipient) ? recipient.join(', ') : recipient;
  const nowStr = new Date().toLocaleString('sr-RS', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const mailOptions = {
    from: `"${SMTP_CONFIG.senderName}" <${SMTP_CONFIG.sender}>`,
    to: toAddress,
    subject: ' Dobrodošli - UNIPROMET Centralni Admin Panel (Test Email)',
    text: `UNIPROMET DOO ČAČAK\nCentralni Admin Panel & Nadzor Štampača\n\nUspešno je testirano slanje email poruka sa servera.\nPošiljalac: ${SMTP_CONFIG.sender}\nPrimalac: ${recipient}\nDatum i vreme: ${nowStr}\nAktivnih štampača pod nadzorom: ${printers.length}\n\nServer: ${publicUrl()}\nNa svetloj strani puta.`,
    html: `
      <!DOCTYPE html>
      <html lang="sr">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0b0e14; margin: 0; padding: 20px; color: #ffffff; }
          .email-card { max-width: 600px; margin: 0 auto; background-color: #10141d; border: 1px solid #ffb80040; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
          .email-header { background: linear-gradient(135deg, #181e2b 0%, #0d1117 100%); border-bottom: 2px solid #FFB800; padding: 24px; text-align: center; }
          .brand-title { color: #ffffff; font-size: 20px; font-weight: 900; letter-spacing: 0.08em; margin: 0; }
          .brand-slogan { color: #FFB800; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; margin-top: 4px; }
          .email-body { padding: 28px 24px; color: #e2e8f0; font-size: 14px; line-height: 1.6; }
          .status-badge { display: inline-block; background: rgba(16, 185, 129, 0.15); border: 1px solid #10b981; color: #10b981; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; margin-bottom: 18px; }
          .info-table { width: 100%; border-collapse: collapse; margin: 20px 0; background: #161b26; border-radius: 8px; overflow: hidden; font-size: 13px; }
          .info-table td { padding: 10px 14px; border-bottom: 1px solid #232a3b; }
          .info-table tr:last-child td { border-bottom: none; }
          .info-label { color: #94a3b8; font-weight: 600; width: 38%; }
          .info-val { color: #ffffff; font-weight: 700; font-family: 'Consolas', monospace; }
          .email-footer { background: #090b0f; border-top: 1px solid #1e2433; padding: 18px 24px; text-align: center; font-size: 11px; color: #64748b; }
          .btn-portal { display: inline-block; background: #FFB800; color: #000000 !important; font-weight: 800; padding: 10px 22px; border-radius: 6px; text-decoration: none; margin-top: 12px; font-size: 13px; }
        </style>
      </head>
      <body>
        <div class="email-card">
          <div class="email-header">
            <h1 class="brand-title">UNIPROMET DOO ČAČAK</h1>
            <div class="brand-slogan">Na svetloj strani puta</div>
          </div>
          
          <div class="email-body">
            <div style="text-align: center;">
              <span class="status-badge">✓ SMTP NOTIFIKACIONI SISTEM AKTIVAN</span>
            </div>
            
            <h2 style="color: #ffffff; font-size: 17px; margin-top: 0; text-align: center;">Uspešno testirano slanje email poruka</h2>
            <p style="text-align: center; color: #94a3b8; font-size: 13px;">
              Ovo je automatska testna poruka generisana iz <strong>UNIPROMET Centralnog Admin Panela</strong> radi verifikacije lokalne mail komunikacije.
            </p>

            <table class="info-table">
              <tr>
                <td class="info-label">Pošiljalac:</td>
                <td class="info-val">${SMTP_CONFIG.sender}</td>
              </tr>
              <tr>
                <td class="info-label">Primalac:</td>
                <td class="info-val" style="color: #FFB800;">${recipient}</td>
              </tr>
              <tr>
                <td class="info-label">SMTP Server:</td>
                <td class="info-val">${SMTP_CONFIG.host}:${SMTP_CONFIG.port} (Lokalni Relay)</td>
              </tr>
              <tr>
                <td class="info-label">Aktivnih štampača:</td>
                <td class="info-val">${printers.length} evidentiranih u bazi</td>
              </tr>
              <tr>
                <td class="info-label">Vreme slanja:</td>
                <td class="info-val">${nowStr}</td>
              </tr>
            </table>

            <div style="text-align: center; margin-top: 24px;">
              <a href="${publicUrl()}" class="btn-portal">Otvori Centralni Admin Panel</a>
            </div>
          </div>

          <div class="email-footer">
            UNIPROMET d.o.o. Čačak &bull; IT Služba i Upravljanje Mrežom<br>
            Server IP: ${publicHost()} &bull; Port: 3000 &bull; Node.js &amp; TypeScript
          </div>
        </div>
      </body>
      </html>
    `
  };

  const info = await transporter.sendMail(mailOptions);
  return {
    success: true,
    recipient,
    sender: SMTP_CONFIG.sender,
    messageId: info.messageId,
    response: info.response,
    timestamp: new Date().toISOString()
  };
}

/**
 * Sends formatted Low Toner Alert email report to administrators
 */
export async function sendLowTonersAlertEmail(
  recipient: string | string[] = DEFAULT_ADMIN_RECIPIENTS,
  reportData?: any
) {
  const transporter = getMailTransport();
  const toAddress = Array.isArray(recipient) ? recipient.join(', ') : recipient;
  
  let data = reportData;
  if (!data) {
    const { getFleetLowToners } = await import('./snmpService');
    data = await getFleetLowToners(5, true);
  }

  const nowStr = new Date().toLocaleString('sr-RS', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const criticalCount = data.totalLowTonerItems || 0;
  const wasteAlertsCount = data.totalWasteAlerts || (data.criticalPrinters?.filter((p: any) => p.wasteTonerNeedsReplacement || p.isWasteTonerFull || p.isWasteTonerNearFull).length) || 0;
  const hardwareErrorsCount = data.totalHardwareErrors || (data.criticalPrinters?.reduce((acc: number, p: any) => acc + (p.errors?.length || 0), 0)) || 0;
  const printersCount = data.affectedPrintersCount || 0;

  // Build critical printers table rows
  let tableRowsHtml = '';
  if (data.criticalPrinters && data.criticalPrinters.length > 0) {
    data.criticalPrinters.forEach((p: any, idx: number) => {
      const isOnlyWaste = p.onlyWasteToner || (p.lowToners.length === 0 && (p.isWasteTonerFull || p.isWasteTonerNearFull) && (!p.errors || p.errors.length === 0));
      const isOnlyError = p.onlyHardwareError || (p.lowToners.length === 0 && !p.isWasteTonerFull && !p.isWasteTonerNearFull && p.errors && p.errors.length > 0);
      let contentHtml = '';

      let errorHtml = '';
      if (p.errors && p.errors.length > 0) {
        errorHtml = `
          <div style="margin-bottom: 6px; padding: 6px 10px; background: rgba(239, 68, 68, 0.22); border: 1px solid #ef4444; border-radius: 6px;">
            <div style="font-weight: 900; color: #ef4444; font-size: 11px; text-transform: uppercase;">
              🚨 AKTIVNA GREŠKA ŠTAMPAČA:
            </div>
            <div style="font-size: 11px; color: #ffffff; font-weight: 700; margin-top: 2px;">
              ${p.errors.join('<br>')}
            </div>
          </div>
        `;
      }

      if (isOnlyError) {
        // Printer that only has a hardware error (paper jam, door open, paper empty, etc.)
        const colorPills = (p.allToners && p.allToners.length > 0)
          ? p.allToners.map((t: any) => {
              let dot = '#94a3b8';
              if (t.color === 'cyan') dot = '#06b6d4';
              else if (t.color === 'magenta') dot = '#ec4899';
              else if (t.color === 'yellow') dot = '#eab308';
              else if (t.color === 'black') dot = '#ffffff';
              return `<span style="background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 11px; color: #cbd5e1; margin-right: 4px; display: inline-block; margin-bottom: 2px;">
                <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${dot}; margin-right: 4px;"></span>${t.color ? t.color.toUpperCase().slice(0, 1) : 'T'}: <strong style="color: #ffffff;">${t.level}%</strong>
              </span>`;
            }).join('')
          : '';

        contentHtml = `
          ${errorHtml}
          <div style="padding: 6px 10px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 6px;">
            <div style="font-size: 11px; font-weight: 700; color: #10b981; margin-bottom: 3px;">
              ✓ Toneri su uredni (&gt; 5%):
            </div>
            <div>${colorPills}</div>
          </div>
        `;
      } else if (isOnlyWaste) {
        // Printer where only waste toner needs replacement, and all color toners are > 5%
        const alertColor = p.isWasteTonerFull ? '#ef4444' : '#f59e0b';
        const alertBg = p.isWasteTonerFull ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)';
        const alertTitle = p.isWasteTonerFull 
          ? '🚨 OTPADNI KONTEJNER: PUN (HITNA ZAMENA)' 
          : '⚠️ OTPADNI KONTEJNER: SKORO PUN (ZAMENITI)';

        const colorPills = (p.allToners && p.allToners.length > 0)
          ? p.allToners.map((t: any) => {
              let dot = '#94a3b8';
              if (t.color === 'cyan') dot = '#06b6d4';
              else if (t.color === 'magenta') dot = '#ec4899';
              else if (t.color === 'yellow') dot = '#eab308';
              else if (t.color === 'black') dot = '#ffffff';
              return `<span style="background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 11px; color: #cbd5e1; margin-right: 4px; display: inline-block; margin-bottom: 2px;">
                <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${dot}; margin-right: 4px;"></span>${t.color ? t.color.toUpperCase().slice(0, 1) : 'T'}: <strong style="color: #ffffff;">${t.level}%</strong>
              </span>`;
            }).join('')
          : '';

        contentHtml = `
          ${errorHtml}
          <div style="padding: 8px 10px; background: ${alertBg}; border: 1px solid ${alertColor}; border-radius: 6px; margin-bottom: 6px;">
            <div style="font-weight: 900; color: ${alertColor}; font-size: 12px;">
              ${alertTitle}
            </div>
            <div style="font-size: 11px; color: #cbd5e1; margin-top: 2px;">
              Status: <strong>${p.wasteTonerStatus || 'Potrebna zamena'}</strong>
            </div>
          </div>
          <div style="padding: 6px 10px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 6px;">
            <div style="font-size: 11px; font-weight: 700; color: #10b981; margin-bottom: 3px;">
              ✓ Toneri za boju su uredni (&gt; 5%):
            </div>
            <div>${colorPills}</div>
          </div>
        `;
      } else {
        const tonerBadges = p.lowToners.map((t: any) => {
          let colorDot = '#334155';
          let colorName = 'Crni (Black)';
          if (t.color === 'cyan') { colorDot = '#06b6d4'; colorName = 'Plavi (Cyan)'; }
          else if (t.color === 'magenta') { colorDot = '#ec4899'; colorName = 'Crveni (Magenta)'; }
          else if (t.color === 'yellow') { colorDot = '#eab308'; colorName = 'Žuti (Yellow)'; }

          const isZero = t.level === 0;
          return `
            <div style="margin-bottom: 6px; padding: 6px 10px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 6px;">
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <span style="font-weight: bold; color: #ffffff;">
                  <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${colorDot}; margin-right: 6px;"></span>
                  ${colorName}
                </span>
                <span style="font-weight: 900; color: #ef4444; font-family: monospace; font-size: 13px;">${isZero ? '0% (PRAZNO)' : t.level + '%'}</span>
              </div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">${t.name}</div>
            </div>
          `;
        }).join('');

        const isLarge = p.isLargeCopier || (p.model && (p.model.toLowerCase().includes('c5235') || p.model.toLowerCase().includes('ir')));
        let wasteHtml = '';
        if (isLarge) {
          if (p.isWasteTonerFull) {
            wasteHtml = `
              <div style="margin-top: 6px; padding: 4px 8px; background: rgba(239, 68, 68, 0.2); border: 1px solid #ef4444; border-radius: 4px; font-size: 11px; color: #ef4444; font-weight: bold;">
                🚨 OTPADNI KONTEJNER: PUN - HITNO ZAMENITI
              </div>
            `;
          } else if (p.isWasteTonerNearFull) {
            wasteHtml = `
              <div style="margin-top: 6px; padding: 4px 8px; background: rgba(245, 158, 11, 0.2); border: 1px solid #f59e0b; border-radius: 4px; font-size: 11px; color: #f59e0b; font-weight: bold;">
                ⚠️ OTPADNI KONTEJNER: SKORO PUN
              </div>
            `;
          } else {
            wasteHtml = `
              <div style="margin-top: 6px; padding: 3px 8px; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 4px; font-size: 11px; color: #10b981; font-weight: 600;">
                ✓ Otpadni kontejner: U redu
              </div>
            `;
          }
        }

        contentHtml = errorHtml + tonerBadges + wasteHtml;
      }

      tableRowsHtml += `
        <tr style="border-bottom: 1px solid #232a3b; ${isOnlyError ? 'background: rgba(239, 68, 68, 0.05);' : (isOnlyWaste ? 'background: rgba(245, 158, 11, 0.04);' : '')}">
          <td style="padding: 12px 14px; vertical-align: top;">
            <div style="font-weight: 800; color: #ffffff; font-size: 14px;">${idx + 1}. ${p.printerName}</div>
            <div style="color: #FFB800; font-family: monospace; font-size: 12px; margin-top: 2px;">${p.ip}</div>
            <div style="color: #64748b; font-size: 11px;">${p.model}</div>
            ${isOnlyError ? `
              <div style="margin-top: 6px;">
                <span style="display: inline-block; padding: 2px 8px; background: rgba(239, 68, 68, 0.2); border: 1px solid #ef4444; border-radius: 4px; font-size: 10px; font-weight: 800; color: #ef4444;">
                  🚨 GREŠKA UREĐAJA
                </span>
              </div>
            ` : (isOnlyWaste ? `
              <div style="margin-top: 6px;">
                <span style="display: inline-block; padding: 2px 8px; background: rgba(245, 158, 11, 0.18); border: 1px solid #f59e0b; border-radius: 4px; font-size: 10px; font-weight: 800; color: #f59e0b;">
                  ⚠️ SAMO OTPADNI KONTEJNER
                </span>
              </div>
            ` : '')}
          </td>
          <td style="padding: 12px 14px; vertical-align: top; color: #cbd5e1; font-weight: 600;">
            ${p.location}
          </td>
          <td style="padding: 12px 14px; vertical-align: top; min-width: 220px;">
            ${contentHtml}
          </td>
        </tr>
      `;
    });
  } else {
    tableRowsHtml = `
      <tr>
        <td colspan="3" style="padding: 30px; text-align: center; color: #10b981; font-weight: bold;">
          ✓ Svi toneri (> 5%), otpadni kontejneri i uređaji u fabrici su na zadovoljavajućem nivou. Nema hitnih potreba za intervencijom.
        </td>
      </tr>
    `;
  }

  // Determine dynamic email subject
  let emailSubject = '';
  if (hardwareErrorsCount > 0 && criticalCount > 0) {
    emailSubject = `⚠️ UNIPROMET - Hitna intervencija: ${hardwareErrorsCount} grešaka štampača i ${criticalCount} tonera (≤ 5%) [${printersCount} štampača]`;
  } else if (hardwareErrorsCount > 0) {
    emailSubject = `⚠️ UNIPROMET - Greške na štampačima: detektovano ${hardwareErrorsCount} grešaka na ${printersCount} štampača`;
  } else if (criticalCount > 0 && wasteAlertsCount > 0) {
    emailSubject = `⚠️ UNIPROMET - Hitna intervencija: ${criticalCount} tonera (≤ 5%) i ${wasteAlertsCount} otpadnika (${printersCount} štampača)`;
  } else if (criticalCount > 0) {
    emailSubject = `⚠️ UNIPROMET - Hitna zamena tonera: ${criticalCount} tonera na ${printersCount} štampača (≤ 5%)`;
  } else if (wasteAlertsCount > 0) {
    emailSubject = `⚠️ UNIPROMET - Hitna zamena: ${wasteAlertsCount} otpadnih kontejnera na ${printersCount} štampača (Toneri uredni > 5%)`;
  } else {
    emailSubject = `✓ UNIPROMET - Svi toneri i uređaji su u urednom stanju`;
  }

  // Plain text fallback
  const textBody = `UNIPROMET DOO ČAČAK
IZVEŠTAJ: NIVOI TONERA (≤ 5%), OTPADNI KONTEJNERI I GREŠKE ŠTAMPAČA
Datum: ${nowStr}
Ukupno tonera za zamenu (≤ 5%): ${criticalCount}
Ukupno otpadnih kontejnera za zamenu: ${wasteAlertsCount}
Ukupno grešaka na uređajima: ${hardwareErrorsCount}
Pogođeno štampača: ${printersCount}
Kriterijum: Toneri ≤ 5% | Otpadnik Pun/Skoro pun | Greške uređaja

${data.criticalPrinters && data.criticalPrinters.length > 0 
  ? data.criticalPrinters.map((p: any, i: number) => {
      let details = `${i + 1}. ${p.printerName} (${p.ip}) - ${p.location}\n`;
      if (p.errors && p.errors.length > 0) {
        details += `   🚨 GREŠKA ŠTAMPAČA: ${p.errors.join(' | ')}\n`;
      }
      const isOnlyWaste = p.onlyWasteToner || (p.lowToners.length === 0 && (p.isWasteTonerFull || p.isWasteTonerNearFull) && (!p.errors || p.errors.length === 0));
      if (isOnlyWaste) {
        details += `   🚨 INTERVENCIJA: SAMO OTPADNI KONTEJNER (${p.isWasteTonerFull ? 'PUN - ZAMENITI' : 'SKORO PUN'})\n`;
        const tonerLevels = (p.allToners || []).map((t: any) => `${t.color.toUpperCase()}: ${t.level}%`).join(', ');
        details += `   ✓ Toneri za boju su uredni (> 5%): ${tonerLevels}\n`;
      } else {
        p.lowToners.forEach((t: any) => {
          details += `   * [${t.color.toUpperCase()}] ${t.name}: ${t.level === 0 ? '0% (PRAZNO)' : t.level + '%'}\n`;
        });
        if (p.isLargeCopier) {
          details += `   * Otpadni kontejner: ${p.wasteTonerStatus}\n`;
        }
      }
      return details;
    }).join('\n')
  : 'Svi toneri, otpadni kontejneri i uređaji su u urednom stanju.'}

Detalji na centralnom admin portalu: ${publicUrl()}`;

  const mailOptions = {
    from: `"${SMTP_CONFIG.senderName}" <${SMTP_CONFIG.sender}>`,
    to: toAddress,
    subject: emailSubject,
    text: textBody,
    html: `
      <!DOCTYPE html>
      <html lang="sr">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0b0e14; margin: 0; padding: 20px; color: #ffffff; }
          .email-card { max-width: 740px; margin: 0 auto; background-color: #10141d; border: 1px solid #ef444460; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 35px rgba(0,0,0,0.6); }
          .email-header { background: linear-gradient(135deg, #1f1418 0%, #0d1117 100%); border-bottom: 2px solid #ef4444; padding: 24px; text-align: center; }
          .brand-title { color: #ffffff; font-size: 20px; font-weight: 900; letter-spacing: 0.08em; margin: 0; }
          .brand-slogan { color: #FFB800; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; margin-top: 4px; }
          .email-body { padding: 24px; color: #e2e8f0; font-size: 13px; line-height: 1.5; }
          .report-table { width: 100%; border-collapse: collapse; background: #161b26; border-radius: 8px; overflow: hidden; font-size: 12px; margin-bottom: 20px; }
          .report-table th { background: #1a202c; color: #94a3b8; font-size: 11px; text-transform: uppercase; font-weight: 800; padding: 10px 14px; text-align: left; border-bottom: 2px solid #2d3748; }
          .email-footer { background: #090b0f; border-top: 1px solid #1e2433; padding: 16px 24px; text-align: center; font-size: 11px; color: #64748b; }
          .btn-portal { display: inline-block; background: #FFB800; color: #000000 !important; font-weight: 800; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-size: 13px; }
        </style>
      </head>
      <body>
        <div class="email-card">
          <div class="email-header">
            <h1 class="brand-title">UNIPROMET DOO ČAČAK</h1>
            <div class="brand-slogan">Na svetloj strani puta &bull; IT Monitoring</div>
          </div>
          
          <div class="email-body">
            <div style="text-align: center; margin-bottom: 16px;">
              <span style="display: inline-block; background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #ef4444; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 800;">
                ⚠️ HITNO OBAVEŠTENJE ZA ADMINISTRATORE I NABAVKU
              </span>
            </div>
            
            <h2 style="color: #ffffff; font-size: 17px; margin: 0 0 6px 0; text-align: center;">Spisak uređaja za hitnu intervenciju (toneri &le; 5%, otpadnik ili greške)</h2>
            <p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 0;">
              Očitavanje celokupne fabričke mreže štampača izvršeno dana <strong>${nowStr}</strong>.
            </p>

            <table style="width: 100%; border-collapse: collapse; margin: 16px 0 20px 0; background: #161b26; border-radius: 8px; border: 1px solid #232a3b;">
              <tr>
                <td style="padding: 10px; text-align: center; border-right: 1px solid #232a3b; width: 25%;">
                  <span style="font-size: 9px; font-weight: 800; color: #94a3b8; text-transform: uppercase;">TONERA ZA ZAMENU</span>
                  <div style="font-size: 20px; font-weight: 900; color: #ef4444; font-family: monospace;">${criticalCount}</div>
                </td>
                <td style="padding: 10px; text-align: center; border-right: 1px solid #232a3b; width: 25%;">
                  <span style="font-size: 9px; font-weight: 800; color: #94a3b8; text-transform: uppercase;">OTPADNIKA ZA ZAMENU</span>
                  <div style="font-size: 20px; font-weight: 900; color: ${wasteAlertsCount > 0 ? '#f59e0b' : '#10b981'}; font-family: monospace;">${wasteAlertsCount}</div>
                </td>
                <td style="padding: 10px; text-align: center; border-right: 1px solid #232a3b; width: 25%;">
                  <span style="font-size: 9px; font-weight: 800; color: #94a3b8; text-transform: uppercase;">GREŠKE ŠTAMPAČA</span>
                  <div style="font-size: 20px; font-weight: 900; color: ${hardwareErrorsCount > 0 ? '#ef4444' : '#10b981'}; font-family: monospace;">${hardwareErrorsCount}</div>
                </td>
                <td style="padding: 10px; text-align: center; width: 25%;">
                  <span style="font-size: 9px; font-weight: 800; color: #94a3b8; text-transform: uppercase;">POGOĐENO ŠTAMPAČA</span>
                  <div style="font-size: 20px; font-weight: 900; color: #ffffff; font-family: monospace;">${printersCount} / ${data.totalPrinters || 39}</div>
                </td>
              </tr>
            </table>

            <!-- Section 1: Low Toner & Error Devices Table -->
            <table class="report-table">
              <thead>
                <tr>
                  <th style="width: 38%;">Štampač / IP</th>
                  <th style="width: 25%;">Lokacija</th>
                  <th style="width: 37%;">Kritični Toneri &bull; Otpadnik &bull; Greške</th>
                </tr>
              </thead>
              <tbody>
                ${tableRowsHtml}
              </tbody>
            </table>

            <div style="text-align: center; margin-top: 24px;">
              <a href="${publicUrl()}" class="btn-portal">Otvori Centralni Admin Panel</a>
            </div>
          </div>

          <div class="email-footer">
            UNIPROMET d.o.o. Čačak &bull; IT Služba i Upravljanje Mrežom<br>
            Server IP: ${publicHost()} &bull; Port: 3000 &bull; Poslato sa: ${SMTP_CONFIG.sender}
          </div>
        </div>
      </body>
      </html>
    `
  };

  const info = await transporter.sendMail(mailOptions);
  return {
    success: true,
    recipient: toAddress,
    sender: SMTP_CONFIG.sender,
    criticalCount,
    printersCount,
    messageId: info.messageId,
    response: info.response,
    timestamp: new Date().toISOString()
  };
}

/**
 * Sends formatted Offline Cameras Alert email report to administrators
 */
export async function sendOfflineCamerasAlertEmail(
  recipient: string | string[] = DEFAULT_ADMIN_RECIPIENTS,
  offlineData?: any
) {
  const transporter = getMailTransport();
  const toAddress = Array.isArray(recipient) ? recipient.join(', ') : recipient;

  let data = offlineData;
  if (!data) {
    const { checkOfflineCamerasLocked } = await import('./cameraScanner');
    data = await checkOfflineCamerasLocked();
  }

  const offlineCameras = data.offlineCameras || [];
  const offlineCount = offlineCameras.length;
  const totalInventory = data.inventoryTotalCount || 246;

  if (offlineCount === 0) {
    return {
      success: true,
      sent: false,
      message: 'Sve kamere su online na mreži. Email upozorenja nije poslat.',
      recipient: toAddress,
      offlineCount: 0,
      timestamp: new Date().toISOString()
    };
  }

  const nowStr = new Date().toLocaleString('sr-RS', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  // Build table rows
  let tableRowsHtml = offlineCameras.map((c: any, idx: number) => {
    return `
      <tr style="border-bottom: 1px solid #232a3b;">
        <td style="padding: 12px 14px; vertical-align: middle;">
          <div style="font-weight: 800; color: #ffffff; font-size: 14px;">${idx + 1}. ${c.name || 'Kamera'}</div>
          <div style="color: #ef4444; font-family: monospace; font-weight: 700; font-size: 13px; margin-top: 3px;">
            ${c.ip}
          </div>
          <div style="color: #94a3b8; font-size: 11px; margin-top: 2px;">
            ${c.subnet || ''}
          </div>
        </td>
        <td style="padding: 12px 14px; vertical-align: middle; color: #cbd5e1; font-size: 13px;">
          <div style="font-weight: 700; color: #ffffff;">${c.position || '-'}</div>
          <div style="color: #ffb800; font-size: 11px; margin-top: 2px;">
            Snimač: <strong>${c.recorder || 'Nedodeljeno'}</strong>
          </div>
        </td>
        <td style="padding: 12px 14px; vertical-align: middle;">
          <span style="display: inline-block; background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #ef4444; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 700;">
            BEZ ODZIVA (80/554)
          </span>
        </td>
      </tr>
    `;
  }).join('');

  const textCamerasList = offlineCameras.map((c: any, idx: number) => 
    `${idx + 1}. IP: ${c.ip} | Pozicija: ${c.position || '-'} | Snimač: ${c.recorder || '-'}`
  ).join('\n');

  const mailOptions = {
    from: `"${SMTP_CONFIG.senderName}" <${SMTP_CONFIG.sender}>`,
    to: toAddress,
    subject: `⚠️ UNIPROMET - Upozorenje: ${offlineCount} nedostupnih kamera na mreži`,
    text: `UNIPROMET DOO ČAČAK\nIZVEŠTAJ: NEDOSTUPNE KAMERE NA MREŽI\nDatum: ${nowStr}\nUkupno u evidenciji: ${totalInventory}\nNedostupnih kamera: ${offlineCount}\n\nSpisak kamera:\n${textCamerasList}\n\nDetalji na admin portalu: ${publicUrl()}\nNa svetloj strani puta.`,
    html: `
      <!DOCTYPE html>
      <html lang="sr">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0b0e14; margin: 0; padding: 20px; color: #ffffff; }
          .email-card { max-width: 720px; margin: 0 auto; background-color: #10141d; border: 1px solid #ef444470; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 35px rgba(0,0,0,0.6); }
          .email-header { background: linear-gradient(135deg, #241418 0%, #0d1117 100%); border-bottom: 2px solid #ef4444; padding: 24px; text-align: center; }
          .brand-title { color: #ffffff; font-size: 20px; font-weight: 900; letter-spacing: 0.08em; margin: 0; }
          .brand-slogan { color: #FFB800; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; margin-top: 4px; }
          .email-body { padding: 24px; color: #e2e8f0; font-size: 13px; line-height: 1.5; }
          .report-table { width: 100%; border-collapse: collapse; background: #161b26; border-radius: 8px; overflow: hidden; font-size: 12px; margin-bottom: 20px; }
          .report-table th { background: #1a202c; color: #94a3b8; font-size: 11px; text-transform: uppercase; font-weight: 800; padding: 10px 14px; text-align: left; border-bottom: 2px solid #2d3748; }
          .btn-portal { display: inline-block; background: #FFB800; color: #000000 !important; font-weight: 800; padding: 11px 26px; border-radius: 6px; text-decoration: none; font-size: 13px; box-shadow: 0 4px 15px rgba(255,184,0,0.3); }
          .email-footer { background: #090b0f; border-top: 1px solid #1e2433; padding: 18px 24px; text-align: center; font-size: 11px; color: #64748b; }
        </style>
      </head>
      <body>
        <div class="email-card">
          <div class="email-header">
            <h1 class="brand-title">UNIPROMET DOO ČAČAK</h1>
            <div class="brand-slogan">Na svetloj strani puta</div>
          </div>
          
          <div class="email-body">
            <div style="text-align: center; margin-bottom: 18px;">
              <span style="display: inline-block; background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #ef4444; padding: 6px 16px; border-radius: 20px; font-size: 12px; font-weight: 800;">
                ⚠️ DETEKTOVANE NEDOSTUPNE KAMERE NA MREŽI
              </span>
            </div>

            <p style="text-align: center; color: #94a3b8; font-size: 13px; margin: 0 0 16px 0;">
              Automatski mrežni scheduler je izvršio kontrolu kamera iz baze evidencije i utvrdio da sledeći uređaji trenutno nemaju mrežni odziv:
            </p>

            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
              <tr>
                <td style="width: 33%; padding: 8px;">
                  <div style="background: #161b26; border: 1px solid #232a3b; border-radius: 8px; padding: 12px; text-align: center;">
                    <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: #94a3b8; display: block;">EVIDENCIJA</span>
                    <span style="font-size: 18px; font-weight: 900; color: #ffffff; display: block; margin-top: 2px;">${totalInventory}</span>
                  </div>
                </td>
                <td style="width: 33%; padding: 8px;">
                  <div style="background: #161b26; border: 1px solid #ef444450; border-radius: 8px; padding: 12px; text-align: center;">
                    <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: #f87171; display: block;">NEDOSTUPNO (OFFLINE)</span>
                    <span style="font-size: 18px; font-weight: 900; color: #ef4444; display: block; margin-top: 2px;">${offlineCount}</span>
                  </div>
                </td>
                <td style="width: 33%; padding: 8px;">
                  <div style="background: #161b26; border: 1px solid #232a3b; border-radius: 8px; padding: 12px; text-align: center;">
                    <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: #94a3b8; display: block;">STATUS</span>
                    <span style="font-size: 13px; font-weight: 800; color: #ef4444; display: block; margin-top: 6px;">UPOZORENJE</span>
                  </div>
                </td>
              </tr>
            </table>

            <table class="report-table">
              <thead>
                <tr>
                  <th>Kamera / IP Adresa</th>
                  <th>Pozicija / Snimač</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${tableRowsHtml}
              </tbody>
            </table>

            <div style="text-align: center; margin-top: 24px;">
              <a href="${publicUrl()}" class="btn-portal">Otvori Centralni Admin Panel</a>
            </div>
          </div>

          <div class="email-footer">
            UNIPROMET d.o.o. Čačak &bull; IT Služba i Upravljanje Mrežom<br>
            Server IP: ${publicHost()} &bull; Poslato sa: ${SMTP_CONFIG.sender} &bull; Vreme: ${nowStr}
          </div>
        </div>
      </body>
      </html>
    `
  };

  const info = await transporter.sendMail(mailOptions);
  return {
    success: true,
    sent: true,
    recipient: toAddress,
    sender: SMTP_CONFIG.sender,
    offlineCount,
    messageId: info.messageId,
    response: info.response,
    timestamp: new Date().toISOString()
  };
}

/**
 * Sends formatted Offline RF Readers Alert email report to administrators
 */
export async function sendOfflineRfReadersAlertEmail(
  recipient: string | string[] = DEFAULT_ADMIN_RECIPIENTS,
  offlineData?: { offlineReaders: any[]; totalReaders?: number }
) {
  const transporter = getMailTransport();
  const toAddress = Array.isArray(recipient) ? recipient.join(', ') : recipient;

  let data = offlineData;
  if (!data) {
    const { pingAllRfReaders } = await import('../db/rfReaderDb');
    const readers = await pingAllRfReaders();
    data = {
      offlineReaders: readers.filter(r => r.status === 'offline'),
      totalReaders: readers.length
    };
  }

  const offlineReaders = data.offlineReaders || [];
  const offlineCount = offlineReaders.length;
  const totalCount = data.totalReaders || 9;

  if (offlineCount === 0) {
    return {
      success: true,
      sent: false,
      message: 'Svi RF čitači su online na mreži. Email upozorenja nije poslat.',
      recipient: toAddress,
      offlineCount: 0,
      timestamp: new Date().toISOString()
    };
  }

  const nowStr = new Date().toLocaleString('sr-RS', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  // Build table rows
  const tableRowsHtml = offlineReaders.map((r: any, idx: number) => {
    return `
      <tr style="border-bottom: 1px solid #232a3b;">
        <td style="padding: 12px 14px; vertical-align: middle;">
          <div style="font-weight: 800; color: #ffffff; font-size: 14px;">${idx + 1}. ${r.name || 'RF Čitač'}</div>
          <div style="color: #94a3b8; font-size: 11px; margin-top: 2px;">
            Model: <strong style="color: #cbd5e1;">${r.model || 'ZKTeco / Secutime RFID'}</strong>
          </div>
        </td>
        <td style="padding: 12px 14px; vertical-align: middle; color: #cbd5e1; font-size: 13px;">
          <div style="font-weight: 700; color: #ffffff;">${r.location || '-'}</div>
          <div style="color: #ffb800; font-size: 11px; margin-top: 2px;">
            Smer: <strong>${r.direction || '-'}</strong>
          </div>
        </td>
        <td style="padding: 12px 14px; vertical-align: middle;">
          <div style="color: #ef4444; font-family: monospace; font-weight: 700; font-size: 13px;">
            ${r.ip}
          </div>
          <div style="color: #94a3b8; font-size: 11px; margin-top: 2px;">
            Port: ${r.port || 4370}
          </div>
        </td>
        <td style="padding: 12px 14px; vertical-align: middle;">
          <span style="display: inline-block; background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #ef4444; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 700;">
            BEZ ODZIVA (TCP/ICMP)
          </span>
          ${r.lastSeen || r.last_seen ? `<div style="color: #64748b; font-size: 10px; margin-top: 3px;">Viđen: ${r.lastSeen || r.last_seen}</div>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  const textReadersList = offlineReaders.map((r: any, idx: number) =>
    `${idx + 1}. ${r.name} | Lokacija: ${r.location} (${r.direction}) | IP: ${r.ip}:${r.port || 4370} | Status: OFFLINE`
  ).join('\n');

  const mailOptions = {
    from: `"${SMTP_CONFIG.senderName}" <${SMTP_CONFIG.sender}>`,
    to: toAddress,
    subject: `⚠️ UNIPROMET - Upozorenje: ${offlineCount} nedostupnih RF čitača (Evidencija radnika)`,
    text: `UNIPROMET DOO ČAČAK\nIZVEŠTAJ: NEDOSTUPNI RF ČITAČI ZA EVIDENCIJU RADNIKA\nDatum: ${nowStr}\nUkupno čitača: ${totalCount}\nNedostupnih čitača: ${offlineCount}\n\nSpisak uređaja bez mrežnog odziva:\n${textReadersList}\n\nDetalji na admin portalu: ${publicUrl()}\nNa svetloj strani puta.`,
    html: `
      <!DOCTYPE html>
      <html lang="sr">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0b0e14; margin: 0; padding: 20px; color: #ffffff; }
          .email-card { max-width: 740px; margin: 0 auto; background-color: #10141d; border: 1px solid #ef444470; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 35px rgba(0,0,0,0.6); }
          .email-header { background: linear-gradient(135deg, #241418 0%, #0d1117 100%); border-bottom: 2px solid #ef4444; padding: 24px; text-align: center; }
          .brand-title { color: #ffffff; font-size: 20px; font-weight: 900; letter-spacing: 0.08em; margin: 0; }
          .brand-slogan { color: #FFB800; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; margin-top: 4px; }
          .email-body { padding: 24px; color: #e2e8f0; font-size: 13px; line-height: 1.5; }
          .report-table { width: 100%; border-collapse: collapse; background: #161b26; border-radius: 8px; overflow: hidden; font-size: 12px; margin-bottom: 20px; }
          .report-table th { background: #1a202c; color: #94a3b8; font-size: 11px; text-transform: uppercase; font-weight: 800; padding: 10px 14px; text-align: left; border-bottom: 2px solid #2d3748; }
          .btn-portal { display: inline-block; background: #FFB800; color: #000000 !important; font-weight: 800; padding: 11px 26px; border-radius: 6px; text-decoration: none; font-size: 13px; box-shadow: 0 4px 15px rgba(255,184,0,0.3); }
          .email-footer { background: #090b0f; border-top: 1px solid #1e2433; padding: 18px 24px; text-align: center; font-size: 11px; color: #64748b; }
        </style>
      </head>
      <body>
        <div class="email-card">
          <div class="email-header">
            <h1 class="brand-title">UNIPROMET DOO ČAČAK</h1>
            <div class="brand-slogan">Na svetloj strani puta &bull; Evidencija Radnog Vremena</div>
          </div>
          
          <div class="email-body">
            <div style="text-align: center; margin-bottom: 18px;">
              <span style="display: inline-block; background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #ef4444; padding: 6px 16px; border-radius: 20px; font-size: 12px; font-weight: 800;">
                ⚠️ DETEKTOVANI NEDOSTUPNI RF ČITAČI ZA EVIDENCIJU RADNIKA
              </span>
            </div>

            <p style="text-align: center; color: #94a3b8; font-size: 13px; margin: 0 0 16px 0;">
              Automatski nadzorni servis je izvršio ispitivanje mrežne dostupnosti RF čitača i utvrdio da sledeći terminali trenutno nemaju mrežni odziv:
            </p>

            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
              <tr>
                <td style="width: 33%; padding: 8px;">
                  <div style="background: #161b26; border: 1px solid #232a3b; border-radius: 8px; padding: 12px; text-align: center;">
                    <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: #94a3b8; display: block;">UKUPNO ČITAČA</span>
                    <span style="font-size: 18px; font-weight: 900; color: #ffffff; display: block; margin-top: 2px;">${totalCount}</span>
                  </div>
                </td>
                <td style="width: 33%; padding: 8px;">
                  <div style="background: #161b26; border: 1px solid #ef444450; border-radius: 8px; padding: 12px; text-align: center;">
                    <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: #f87171; display: block;">NEDOSTUPNO (OFFLINE)</span>
                    <span style="font-size: 18px; font-weight: 900; color: #ef4444; display: block; margin-top: 2px;">${offlineCount}</span>
                  </div>
                </td>
                <td style="width: 33%; padding: 8px;">
                  <div style="background: #161b26; border: 1px solid #232a3b; border-radius: 8px; padding: 12px; text-align: center;">
                    <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: #94a3b8; display: block;">STATUS SISTEMA</span>
                    <span style="font-size: 13px; font-weight: 800; color: #ef4444; display: block; margin-top: 6px;">PREKID VEZE</span>
                  </div>
                </td>
              </tr>
            </table>

            <table class="report-table">
              <thead>
                <tr>
                  <th style="width: 32%;">Terminal / Uređaj</th>
                  <th style="width: 28%;">Lokacija &amp; Smer</th>
                  <th style="width: 22%;">IP Adresa &amp; Port</th>
                  <th style="width: 18%;">Status</th>
                </tr>
              </thead>
              <tbody>
                ${tableRowsHtml}
              </tbody>
            </table>

            <div style="text-align: center; margin-top: 24px;">
              <a href="${publicUrl()}" class="btn-portal">Otvori Centralni Admin Panel</a>
            </div>
          </div>

          <div class="email-footer">
            UNIPROMET d.o.o. Čačak &bull; IT Služba i Upravljanje Mrežom<br>
            Server IP: ${publicHost()} &bull; Poslato sa: ${SMTP_CONFIG.sender} &bull; Vreme: ${nowStr}
          </div>
        </div>
      </body>
      </html>
    `
  };

  const info = await transporter.sendMail(mailOptions);
  return {
    success: true,
    sent: true,
    recipient: toAddress,
    sender: SMTP_CONFIG.sender,
    offlineCount,
    messageId: info.messageId,
    response: info.response,
    timestamp: new Date().toISOString()
  };
}

/**
 * Sends formatted Offline WiFi APs (Aruba) Alert email report to administrators
 */
export async function sendOfflineWifiApsAlertEmail(
  recipient: string | string[] = DEFAULT_ADMIN_RECIPIENTS,
  offlineData?: { offlineAps: any[]; totalAps?: number }
) {
  const transporter = getMailTransport();
  const toAddress = Array.isArray(recipient) ? recipient.join(', ') : recipient;

  let data = offlineData;
  if (!data) {
    const { syncAndCheckWifiAps } = await import('../db/wifiApDb');
    const res = await syncAndCheckWifiAps();
    data = {
      offlineAps: res.offlineAps,
      totalAps: res.totalAps
    };
  }

  const offlineAps = data.offlineAps || [];
  const offlineCount = offlineAps.length;
  const totalCount = data.totalAps || 34;

  if (offlineCount === 0) {
    return {
      success: true,
      sent: false,
      message: 'Sve WiFi pristupne tačke (Aruba AP) su online i aktivne u klasteru. Email upozorenja nije poslat.',
      recipient: toAddress,
      offlineCount: 0,
      timestamp: new Date().toISOString()
    };
  }

  const nowStr = new Date().toLocaleString('sr-RS', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  // Build table rows
  const tableRowsHtml = offlineAps.map((ap: any, idx: number) => {
    return `
      <tr style="border-bottom: 1px solid #232a3b;">
        <td style="padding: 12px 14px; vertical-align: middle;">
          <div style="font-weight: 800; color: #ffffff; font-size: 14px;">${idx + 1}. ${ap.name || 'Aruba AP'}</div>
          <div style="color: #94a3b8; font-size: 11px; margin-top: 2px;">
            Model: <strong style="color: #cbd5e1;">${ap.model || 'AP-505'}</strong>
            ${ap.serial ? ` &bull; S/N: <span style="font-family: monospace;">${ap.serial}</span>` : ''}
          </div>
        </td>
        <td style="padding: 12px 14px; vertical-align: middle; color: #cbd5e1; font-size: 13px;">
          <div style="font-weight: 700; color: #ffffff;">${ap.zone || 'Glavna Fabrika'}</div>
          <div style="color: ${ap.isOutdoor ? '#38bdf8' : '#a78bfa'}; font-size: 11px; font-weight: 700; margin-top: 2px;">
            ${ap.isOutdoor ? 'Outdoor (Spoljni)' : 'Indoor (Unutrašnji)'}
          </div>
        </td>
        <td style="padding: 12px 14px; vertical-align: middle;">
          <div style="color: #ef4444; font-family: monospace; font-weight: 700; font-size: 13px;">
            ${ap.ip}
          </div>
          <div style="color: #94a3b8; font-size: 11px; margin-top: 2px;">
            Uplink: ${ap.uplinkPort || 'eth0'}
          </div>
        </td>
        <td style="padding: 12px 14px; vertical-align: middle;">
          <span style="display: inline-block; background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #ef4444; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 700;">
            ISPAD IZ KLASTERA (OFFLINE)
          </span>
          ${ap.lastSeen ? `<div style="color: #64748b; font-size: 10px; margin-top: 3px;">Viđen: ${ap.lastSeen}</div>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  const textApList = offlineAps.map((ap: any, idx: number) =>
    `${idx + 1}. ${ap.name} | Lokacija/Zona: ${ap.zone || '-'} (${ap.isOutdoor ? 'Outdoor' : 'Indoor'}) | IP: ${ap.ip} | Uplink: ${ap.uplinkPort || 'eth0'} | Status: OFFLINE`
  ).join('\n');

  const mailOptions = {
    from: `"${SMTP_CONFIG.senderName}" <${SMTP_CONFIG.sender}>`,
    to: toAddress,
    subject: `⚠️ UNIPROMET - Upozorenje: ${offlineCount} nedostupnih WiFi AP uređaja (Aruba Mreža)`,
    text: `UNIPROMET DOO ČAČAK\nIZVEŠTAJ: NEDOSTUPNE WIFI PRISTUPNE TAČKE (ARUBA AP)\nDatum: ${nowStr}\nUkupno AP uređaja u mreži: ${totalCount}\nNedostupnih AP tačaka: ${offlineCount}\n\nSpisak uređaja bez odziva:\n${textApList}\n\nDetalji na admin portalu: ${publicUrl()}\nNa svetloj strani puta.`,
    html: `
      <!DOCTYPE html>
      <html lang="sr">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0b0e14; margin: 0; padding: 20px; color: #ffffff; }
          .email-card { max-width: 740px; margin: 0 auto; background-color: #10141d; border: 1px solid #ef444470; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 35px rgba(0,0,0,0.6); }
          .email-header { background: linear-gradient(135deg, #241418 0%, #0d1117 100%); border-bottom: 2px solid #ef4444; padding: 24px; text-align: center; }
          .brand-title { color: #ffffff; font-size: 20px; font-weight: 900; letter-spacing: 0.08em; margin: 0; }
          .brand-slogan { color: #FFB800; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; margin-top: 4px; }
          .email-body { padding: 24px; color: #e2e8f0; font-size: 13px; line-height: 1.5; }
          .report-table { width: 100%; border-collapse: collapse; background: #161b26; border-radius: 8px; overflow: hidden; font-size: 12px; margin-bottom: 20px; }
          .report-table th { background: #1a202c; color: #94a3b8; font-size: 11px; text-transform: uppercase; font-weight: 800; padding: 10px 14px; text-align: left; border-bottom: 2px solid #2d3748; }
          .btn-portal { display: inline-block; background: #FFB800; color: #000000 !important; font-weight: 800; padding: 11px 26px; border-radius: 6px; text-decoration: none; font-size: 13px; box-shadow: 0 4px 15px rgba(255,184,0,0.3); }
          .email-footer { background: #090b0f; border-top: 1px solid #1e2433; padding: 18px 24px; text-align: center; font-size: 11px; color: #64748b; }
        </style>
      </head>
      <body>
        <div class="email-card">
          <div class="email-header">
            <h1 class="brand-title">UNIPROMET DOO ČAČAK</h1>
            <div class="brand-slogan">Na svetloj strani puta &bull; Fabrička WiFi Mreža (Aruba)</div>
          </div>
          
          <div class="email-body">
            <div style="text-align: center; margin-bottom: 18px;">
              <span style="display: inline-block; background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #ef4444; padding: 6px 16px; border-radius: 20px; font-size: 12px; font-weight: 800;">
                ⚠️ DETEKTOVANE NEDOSTUPNE WIFI PRISTUPNE TAČKE (ARUBA AP)
              </span>
            </div>

            <p style="text-align: center; color: #94a3b8; font-size: 13px; margin: 0 0 16px 0;">
              Automatski nadzorni servis je izvršio ispitivanje fabričke WiFi infrastrukture i utvrdio prekid veze sa sledećim pristupnim tačkama:
            </p>

            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
              <tr>
                <td style="width: 33%; padding: 8px;">
                  <div style="background: #161b26; border: 1px solid #232a3b; border-radius: 8px; padding: 12px; text-align: center;">
                    <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: #94a3b8; display: block;">UKUPNO AP UREĐAJA</span>
                    <span style="font-size: 18px; font-weight: 900; color: #ffffff; display: block; margin-top: 2px;">${totalCount}</span>
                  </div>
                </td>
                <td style="width: 33%; padding: 8px;">
                  <div style="background: #161b26; border: 1px solid #ef444450; border-radius: 8px; padding: 12px; text-align: center;">
                    <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: #f87171; display: block;">NEDOSTUPNO (OFFLINE)</span>
                    <span style="font-size: 18px; font-weight: 900; color: #ef4444; display: block; margin-top: 2px;">${offlineCount}</span>
                  </div>
                </td>
                <td style="width: 33%; padding: 8px;">
                  <div style="background: #161b26; border: 1px solid #232a3b; border-radius: 8px; padding: 12px; text-align: center;">
                    <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: #94a3b8; display: block;">STATUS MREŽE</span>
                    <span style="font-size: 13px; font-weight: 800; color: #ef4444; display: block; margin-top: 6px;">PREKID VEZE</span>
                  </div>
                </td>
              </tr>
            </table>

            <table class="report-table">
              <thead>
                <tr>
                  <th style="width: 34%;">Pristupna Tačka / Model</th>
                  <th style="width: 26%;">Lokacija &amp; Zona</th>
                  <th style="width: 22%;">IP Adresa &amp; Uplink</th>
                  <th style="width: 18%;">Status</th>
                </tr>
              </thead>
              <tbody>
                ${tableRowsHtml}
              </tbody>
            </table>

            <div style="text-align: center; margin-top: 24px;">
              <a href="${publicUrl()}" class="btn-portal">Otvori Centralni Admin Panel</a>
            </div>
          </div>

          <div class="email-footer">
            UNIPROMET d.o.o. Čačak &bull; IT Služba i Upravljanje Mrežom<br>
            Server IP: ${publicHost()} &bull; Poslato sa: ${SMTP_CONFIG.sender} &bull; Vreme: ${nowStr}
          </div>
        </div>
      </body>
      </html>
    `
  };

  const info = await transporter.sendMail(mailOptions);
  return {
    success: true,
    sent: true,
    recipient: toAddress,
    sender: SMTP_CONFIG.sender,
    offlineCount,
    messageId: info.messageId,
    response: info.response,
    timestamp: new Date().toISOString()
  };
}

/**
 * Sends formatted Offline NVR Recorders Alert email report to administrators.
 * Highlights whether ping responded and whether webUI was unreachable.
 */
export async function sendOfflineRecordersAlertEmail(
  recipient: string | string[] = DEFAULT_ADMIN_RECIPIENTS,
  alertData?: any
) {
  const transporter = getMailTransport();
  const toAddress = Array.isArray(recipient) ? recipient.join(', ') : recipient;

  let data = alertData;
  if (!data) {
    const { checkAllRecordersStatus } = await import('./recorderScanner');
    data = await checkAllRecordersStatus();
  }

  const offlineRecorders = data.offlineRecorders || [];
  const offlineCount = offlineRecorders.length;
  const totalRecorders = data.total || 17;

  if (offlineCount === 0) {
    return {
      success: true,
      sent: false,
      message: 'Svi video snimači (NVR/DVR) su online i WebUI je dostupan. Email upozorenja nije poslat.',
      recipient: toAddress,
      offlineCount: 0,
      timestamp: new Date().toISOString()
    };
  }

  const nowStr = new Date().toLocaleString('sr-RS', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const tableRowsHtml = offlineRecorders.map((r: any, idx: number) => {
    const isPingOk = r.pingStatus === 'online';
    const isWebuiDown = r.webuiStatus === 'offline';

    const pingBadge = isPingOk
      ? `<span style="display: inline-block; background: rgba(34, 197, 94, 0.15); border: 1px solid #22c55e; color: #4ade80; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700;">✓ Ping aktivan (${r.latencyMs || 1}ms)</span>`
      : `<span style="display: inline-block; background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #ef4444; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700;">❌ Ping nedostupan</span>`;

    const webuiBadge = isWebuiDown
      ? `<span style="display: inline-block; background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #ef4444; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700;">❌ WebUI nedostupan</span>`
      : `<span style="display: inline-block; background: rgba(34, 197, 94, 0.15); border: 1px solid #22c55e; color: #4ade80; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700;">✓ WebUI aktivan</span>`;

    return `
      <tr style="border-bottom: 1px solid #232a3b;">
        <td style="padding: 12px 14px; vertical-align: middle;">
          <div style="font-weight: 800; color: #ffffff; font-size: 14px;">${idx + 1}. ${r.name || 'NVR Snimač'}</div>
          <div style="color: #ef4444; font-family: monospace; font-weight: 700; font-size: 13px; margin-top: 3px;">
            ${r.ip}
          </div>
          <div style="color: #94a3b8; font-size: 11px; margin-top: 2px;">
            ${r.model || 'Hikvision'} | Tip: ${r.type || 'NVR'}
          </div>
        </td>
        <td style="padding: 12px 14px; vertical-align: middle; color: #cbd5e1; font-size: 13px;">
          <div style="font-weight: 700; color: #ffffff;">${r.location || '-'}</div>
          <div style="color: #cbd5e1; font-size: 11px; margin-top: 4px; line-height: 1.4;">
            ${r.reason || 'Nedostupan na mreži'}
          </div>
        </td>
        <td style="padding: 12px 14px; vertical-align: middle;">
          <div style="margin-bottom: 4px;">${pingBadge}</div>
          <div>${webuiBadge}</div>
        </td>
      </tr>
    `;
  }).join('');

  const textList = offlineRecorders.map((r: any, idx: number) =>
    `${idx + 1}. ${r.name} (${r.ip}) | Lokacija: ${r.location} | Ping: ${r.pingStatus} | WebUI: ${r.webuiStatus} | Razlog: ${r.reason}`
  ).join('\n');

  const mailOptions = {
    from: `"${SMTP_CONFIG.senderName}" <${SMTP_CONFIG.sender}>`,
    to: toAddress,
    subject: `⚠️ UNIPROMET - Upozorenje: ${offlineCount} nedostupnih video snimača (NVR/DVR)`,
    text: `UNIPROMET DOO ČAČAK\nIZVEŠTAJ: NEDOSTUPNI VIDEO SNIMAČI NA MREŽI\nDatum: ${nowStr}\nUkupno u evidenciji: ${totalRecorders}\nNedostupnih snimača: ${offlineCount}\n\nSpisak snimača:\n${textList}\n\nDetalji na admin portalu: ${publicUrl()}\nNa svetloj strani puta.`,
    html: `
      <!DOCTYPE html>
      <html lang="sr">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0b0e14; margin: 0; padding: 20px; color: #ffffff; }
          .email-card { max-width: 720px; margin: 0 auto; background-color: #10141d; border: 1px solid #ef444470; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 35px rgba(0,0,0,0.6); }
          .email-header { background: linear-gradient(135deg, #241418 0%, #0d1117 100%); border-bottom: 2px solid #ef4444; padding: 24px; text-align: center; }
          .brand-title { color: #ffffff; font-size: 20px; font-weight: 900; letter-spacing: 0.08em; margin: 0; }
          .brand-slogan { color: #FFB800; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; margin-top: 4px; }
          .email-body { padding: 24px; color: #e2e8f0; font-size: 13px; line-height: 1.5; }
          .report-table { width: 100%; border-collapse: collapse; background: #161b26; border-radius: 8px; overflow: hidden; font-size: 12px; margin-bottom: 20px; }
          .report-table th { background: #1a202c; color: #94a3b8; font-size: 11px; text-transform: uppercase; font-weight: 800; padding: 10px 14px; text-align: left; border-bottom: 2px solid #2d3748; }
          .btn-portal { display: inline-block; background: #FFB800; color: #000000 !important; font-weight: 800; padding: 11px 26px; border-radius: 6px; text-decoration: none; font-size: 13px; box-shadow: 0 4px 15px rgba(255,184,0,0.3); }
          .email-footer { background: #090b0f; border-top: 1px solid #1e2433; padding: 18px 24px; text-align: center; font-size: 11px; color: #64748b; }
        </style>
      </head>
      <body>
        <div class="email-card">
          <div class="email-header">
            <h1 class="brand-title">UNIPROMET DOO ČAČAK</h1>
            <div class="brand-slogan">Na svetloj strani puta</div>
          </div>
          
          <div class="email-body">
            <div style="text-align: center; margin-bottom: 18px;">
              <span style="display: inline-block; background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #ef4444; padding: 6px 16px; border-radius: 20px; font-size: 12px; font-weight: 800;">
                ⚠️ DETEKTOVANI NEDOSTUPNI NVR SNIMAČI NA MREŽI
              </span>
            </div>

            <p style="text-align: center; color: #94a3b8; font-size: 13px; margin: 0 0 16px 0;">
              Automatski nadzorni servis je proverio mrežnu dostupnost i Web interfejs (WebUI) svih video snimača i utvrdio prekid rada ili nedostupnost sledećih uređaja:
            </p>

            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
              <tr>
                <td style="width: 33%; padding: 8px;">
                  <div style="background: #161b26; border: 1px solid #232a3b; border-radius: 8px; padding: 12px; text-align: center;">
                    <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: #94a3b8; display: block;">UKUPNO SNIMAČA</span>
                    <span style="font-size: 18px; font-weight: 900; color: #ffffff; display: block; margin-top: 2px;">${totalRecorders}</span>
                  </div>
                </td>
                <td style="width: 33%; padding: 8px;">
                  <div style="background: #161b26; border: 1px solid #ef444450; border-radius: 8px; padding: 12px; text-align: center;">
                    <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: #f87171; display: block;">NEDOSTUPNO (OFFLINE)</span>
                    <span style="font-size: 18px; font-weight: 900; color: #ef4444; display: block; margin-top: 2px;">${offlineCount}</span>
                  </div>
                </td>
                <td style="width: 33%; padding: 8px;">
                  <div style="background: #161b26; border: 1px solid #22c55e50; border-radius: 8px; padding: 12px; text-align: center;">
                    <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: #4ade80; display: block;">ONLINE I FUNKCIONALNO</span>
                    <span style="font-size: 18px; font-weight: 900; color: #22c55e; display: block; margin-top: 2px;">${totalRecorders - offlineCount}</span>
                  </div>
                </td>
              </tr>
            </table>

            <table class="report-table">
              <thead>
                <tr>
                  <th>Snimač & IP Adresa</th>
                  <th>Lokacija & Razlog</th>
                  <th>Status Odziva</th>
                </tr>
              </thead>
              <tbody>
                ${tableRowsHtml}
              </tbody>
            </table>

            <div style="text-align: center; margin-top: 26px;">
              <a href="${publicUrl()}/#recorders" class="btn-portal" style="color: #000 !important;">
                Otvori Evidenciju Snimača na Portalu
              </a>
            </div>
          </div>

          <div class="email-footer">
            UNIPROMET DOO ČAČAK &bull; Služba za Informacione Tehnologije<br>
            Automatski generisan izveštaj &bull; ${nowStr}
          </div>
        </div>
      </body>
      </html>
    `
  };

  const info = await transporter.sendMail(mailOptions);
  return {
    success: true,
    sent: true,
    recipient: toAddress,
    sender: SMTP_CONFIG.sender,
    offlineCount,
    messageId: info.messageId,
    response: info.response,
    timestamp: new Date().toISOString()
  };
}

/**
 * Sends urgent alert email for printers with FULL waste toner box or COLOR toner at 0%
 * (Triggered by hourly scheduled service between 08:00 and 15:00 on weekdays)
 */
export async function sendUrgentTonerAlertEmail(
  recipient: string | string[] = DEFAULT_ADMIN_RECIPIENTS,
  urgentReportData?: any
) {
  const transporter = getMailTransport();
  const toAddress = Array.isArray(recipient) ? recipient.join(', ') : recipient;

  let data = urgentReportData;
  if (!data) {
    const { checkUrgentTonersAndWaste } = await import('./snmpService');
    data = await checkUrgentTonersAndWaste(true);
  }

  const now = new Date();
  const nowStr = now.toLocaleString('sr-RS', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  const nowTimeStr = now.toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' });

  const urgentCount = data.urgentPrintersCount || (data.urgentPrinters ? data.urgentPrinters.length : 0);
  const totalWasteFull = data.totalWasteFullCount || 0;
  const totalZeroColor = data.totalZeroColorTonersCount || 0;
  const totalHardwareErrors = data.totalHardwareErrorsCount || (data.urgentPrinters?.reduce((acc: number, p: any) => acc + (p.errors?.length || 0), 0)) || 0;
  const totalPrinters = data.totalPrinters || 0;
  const urgentPrinters = data.urgentPrinters || [];

  // Build rows for each urgent printer
  let tableRowsHtml = '';
  if (urgentPrinters.length > 0) {
    urgentPrinters.forEach((p: any, idx: number) => {
      // 0. Hardware errors badge
      let errorBadge = '';
      if (p.errors && p.errors.length > 0) {
        errorBadge = `
          <div style="margin-bottom: 6px; padding: 6px 10px; background: rgba(239, 68, 68, 0.25); border: 1px solid #ef4444; border-radius: 6px;">
            <div style="font-weight: 900; color: #ef4444; font-size: 11px; text-transform: uppercase; display: flex; align-items: center; gap: 4px;">
              <span>🚨 GREŠKA ŠTAMPAČA:</span>
            </div>
            <div style="font-size: 11px; color: #ffffff; font-weight: 700; margin-top: 2px;">
              ${p.errors.join('<br>')}
            </div>
          </div>
        `;
      }

      // 1. Waste toner alert badge
      let wasteBadge = '';
      if (p.isWasteFull) {
        wasteBadge = `
          <div style="margin-bottom: 6px; padding: 6px 10px; background: rgba(239, 68, 68, 0.2); border: 1px solid #ef4444; border-radius: 6px;">
            <div style="font-weight: 900; color: #ef4444; font-size: 11px; display: flex; align-items: center; gap: 6px;">
              <span>🚨 OTPADNI KONTEJNER: PUN (HITNA ZAMENA)</span>
            </div>
            <div style="font-size: 11px; color: #cbd5e1; margin-top: 2px;">
              Status senzora: <strong>${p.wasteStatusText || 'Prepunjen'}</strong>
            </div>
          </div>
        `;
      }

      // 2. Zero color toners badges
      let zeroColorBadges = '';
      if (p.zeroColorToners && p.zeroColorToners.length > 0) {
        zeroColorBadges = p.zeroColorToners.map((t: any) => {
          return `
            <div style="margin-bottom: 6px; padding: 6px 10px; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 6px;">
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <span style="font-weight: bold; color: #ffffff; font-size: 12px;">
                  <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${t.colorDot || '#ef4444'}; margin-right: 6px;"></span>
                  ${t.colorName || 'Kolor Toner'}
                </span>
                <span style="font-weight: 900; color: #ef4444; font-family: monospace; font-size: 13px; background: rgba(239, 68, 68, 0.25); padding: 1px 6px; border-radius: 4px;">
                  0% (PRAZNO)
                </span>
              </div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">${t.name || ''}</div>
            </div>
          `;
        }).join('');
      }

      // 3. Compact overview pills for all toners on this machine
      const allTonersPills = (p.allToners && p.allToners.length > 0)
        ? p.allToners.map((t: any) => {
            let dot = '#94a3b8';
            const col = (t.color || '').toLowerCase();
            if (col === 'cyan') dot = '#06b6d4';
            else if (col === 'magenta') dot = '#ec4899';
            else if (col === 'yellow') dot = '#eab308';
            else if (col === 'black') dot = '#ffffff';

            const isZero = t.level === 0;
            const isLow = t.level > 0 && t.level <= 10;
            const levelColor = isZero ? '#ef4444' : (isLow ? '#f59e0b' : '#10b981');

            return `
              <span style="background: rgba(255,255,255,0.06); padding: 3px 6px; border-radius: 4px; font-family: monospace; font-size: 11px; color: #cbd5e1; margin-right: 4px; display: inline-block; margin-bottom: 3px; border: 1px solid ${isZero ? 'rgba(239, 68, 68, 0.5)' : 'rgba(255,255,255,0.1)'};">
                <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${dot}; margin-right: 4px;"></span>${col ? col.toUpperCase().slice(0, 1) : 'T'}: <strong style="color: ${levelColor};">${t.level}%</strong>
              </span>
            `;
          }).join('')
        : '<span style="color: #64748b; font-size: 11px;">N/A</span>';

      tableRowsHtml += `
        <tr style="border-bottom: 1px solid #232a3b; background: rgba(239, 68, 68, 0.03);">
          <td style="padding: 12px 14px; vertical-align: top;">
            <div style="font-weight: 800; color: #ffffff; font-size: 14px;">${idx + 1}. ${p.printerName}</div>
            <div style="margin-top: 3px;">
              <a href="http://${p.ip}" target="_blank" style="color: #FFB800; font-family: monospace; font-size: 12px; text-decoration: none; font-weight: bold;">
                🌐 ${p.ip}
              </a>
            </div>
            <div style="color: #64748b; font-size: 11px; margin-top: 2px;">${p.model}</div>
          </td>
          <td style="padding: 12px 14px; vertical-align: top; color: #cbd5e1; font-weight: 600;">
            <div style="color: #ffffff; font-size: 13px;">${p.location}</div>
          </td>
          <td style="padding: 12px 14px; vertical-align: top;">
            ${errorBadge}
            ${wasteBadge}
            ${zeroColorBadges}
          </td>
          <td style="padding: 12px 14px; vertical-align: top;">
            <div style="font-size: 10px; text-transform: uppercase; color: #94a3b8; font-weight: 700; margin-bottom: 4px;">Svi toneri:</div>
            <div>${allTonersPills}</div>
          </td>
        </tr>
      `;
    });
  }

  // Plain text fallback
  const textBody = `🚨 HITNO UPOZORENJE ŠTAMPAČA - UNIPROMET DOO ČAČAK
Vreme provere: ${nowStr}
Detektovano hitnih uređaja: ${urgentCount}
Detektovano grešaka na štampačima: ${totalHardwareErrors}
Puni waste kontejneri: ${totalWasteFull}
Kolor toneri na 0%: ${totalZeroColor}

SPISAK UREĐAJA KOJI ZAHTEVAJU HITNU INTERVENCIJU:
${urgentPrinters.map((p: any, idx: number) => {
  const reasonsText = (p.reasons || []).join(' | ');
  return `${idx + 1}. ${p.printerName} (${p.ip}) - Lokacija: ${p.location}\n   Hitni razlog: ${reasonsText}\n`;
}).join('\n')}

Otvorite Admin Panel: ${publicUrl()}/#scheduled_services
UNIPROMET Služba za IT`;

  const subjectReasons: string[] = [];
  if (totalHardwareErrors > 0) subjectReasons.push(`${totalHardwareErrors} grešaka`);
  if (totalWasteFull > 0) subjectReasons.push(`${totalWasteFull} punih waste`);
  if (totalZeroColor > 0) subjectReasons.push(`${totalZeroColor} kolor tonera na 0%`);

  const reasonText = subjectReasons.length > 0 ? ` [${subjectReasons.join(', ')}]` : '';
  const emailSubject = `🚨 HITNO: ${urgentCount} ${urgentCount === 1 ? 'štampač' : 'štampača'}${reasonText} - [${nowTimeStr}h]`;

  const mailOptions = {
    from: `"${SMTP_CONFIG.senderName}" <${SMTP_CONFIG.sender}>`,
    to: toAddress,
    subject: emailSubject,
    text: textBody,
    html: `
      <!DOCTYPE html>
      <html lang="sr">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0b0e14; margin: 0; padding: 20px; color: #ffffff; }
          .email-container { max-width: 820px; margin: 0 auto; background-color: #111622; border-radius: 12px; border: 1px solid #1e293b; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
          .email-header { background: linear-gradient(135deg, #1e1b18 0%, #151922 100%); padding: 24px; border-bottom: 2px solid #ef4444; }
          .brand-title { color: #FFB800; font-size: 13px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; margin: 0; }
          .report-title { color: #ffffff; font-size: 20px; font-weight: 900; margin: 6px 0 0 0; }
          .content-body { padding: 24px; }
          .stat-pill { display: inline-block; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 700; margin-right: 8px; margin-bottom: 8px; }
          .report-table { width: 100%; border-collapse: collapse; margin-top: 16px; background-color: #0c1017; border-radius: 8px; overflow: hidden; border: 1px solid #1f293d; }
          .report-table th { background-color: #161c28; color: #94a3b8; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; padding: 10px 14px; border-bottom: 1px solid #232a3b; }
          .email-footer { padding: 18px 24px; background-color: #090c10; border-top: 1px solid #19202e; text-align: center; font-size: 12px; color: #64748b; }
          .btn-portal { display: inline-block; padding: 10px 22px; background: #FFB800; color: #000000 !important; font-weight: 800; border-radius: 6px; text-decoration: none; font-size: 13px; }
        </style>
      </head>
      <body>
        <div class="email-container">
          <div class="email-header">
            <table style="width: 100%;">
              <tr>
                <td>
                  <span class="brand-title">UNIPROMET DOO ČAČAK &bull; IT SLUŽBA</span>
                  <h2 class="report-title">🚨 HITAN ALARM: Greške na Štampačima, Puni Otpadnici & 0% Toneri</h2>
                  <div style="color: #94a3b8; font-size: 12px; margin-top: 4px;">
                    Satna automatska provera stanja &bull; Termin: <strong>${nowTimeStr}h</strong> (Radni dani: 08:00 - 15:00)
                  </div>
                </td>
                <td style="text-align: right; vertical-align: top;">
                  <span style="background: rgba(239, 68, 68, 0.2); border: 1px solid #ef4444; color: #ef4444; font-weight: 900; font-size: 12px; padding: 4px 10px; border-radius: 20px;">
                    HITNA ZAMENA
                  </span>
                </td>
              </tr>
            </table>
          </div>

          <div class="content-body">
            <!-- Warning Alert Box -->
            <div style="background: rgba(239, 68, 68, 0.12); border-left: 4px solid #ef4444; padding: 14px 16px; border-radius: 6px; margin-bottom: 22px;">
              <div style="font-weight: 800; color: #ef4444; font-size: 13px; margin-bottom: 4px;">
                ⚠️ DETEKTOVANI ŠTAMPAČI KOJI ZAHTEVAJU HITNU INTERVENCIJU (${urgentCount})
              </div>
              <div style="color: #cbd5e1; font-size: 12px; line-height: 1.5;">
                Automatski servis je u <strong>${nowTimeStr}</strong> zabeležio da sledeći štampači imaju <strong>aktivne greške (zaglavljen papir, otvoren poklopac, servisni kvar)</strong>, <strong>pun otpadni (waste) toner</strong> ili je neki od <strong>kolor tonera na 0%</strong>. Potrebno je hitno reagovati kako ne bi došlo do zastoja.
              </div>
            </div>

            <!-- KPI Cards Row -->
            <table style="width: 100%; border-spacing: 0; margin-bottom: 20px;">
              <tr>
                <td style="width: 25%; padding-right: 6px;">
                  <div style="background: #141a24; border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; padding: 12px; text-align: center;">
                    <div style="font-size: 10px; font-weight: 800; color: #f87171; text-transform: uppercase;">HITNIH ŠTAMPAČA</div>
                    <div style="font-size: 22px; font-weight: 900; color: #ef4444; margin-top: 2px;">${urgentCount}</div>
                  </div>
                </td>
                <td style="width: 25%; padding: 0 4px;">
                  <div style="background: #141a24; border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; padding: 12px; text-align: center;">
                    <div style="font-size: 10px; font-weight: 800; color: #f87171; text-transform: uppercase;">GREŠKE ŠTAMPAČA</div>
                    <div style="font-size: 22px; font-weight: 900; color: ${totalHardwareErrors > 0 ? '#ef4444' : '#10b981'}; margin-top: 2px;">${totalHardwareErrors}</div>
                  </div>
                </td>
                <td style="width: 25%; padding: 0 4px;">
                  <div style="background: #141a24; border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 8px; padding: 12px; text-align: center;">
                    <div style="font-size: 10px; font-weight: 800; color: #fbbf24; text-transform: uppercase;">PUNI WASTE KONTEJNERI</div>
                    <div style="font-size: 22px; font-weight: 900; color: #f59e0b; margin-top: 2px;">${totalWasteFull}</div>
                  </div>
                </td>
                <td style="width: 25%; padding-left: 6px;">
                  <div style="background: #141a24; border: 1px solid rgba(236, 72, 153, 0.4); border-radius: 8px; padding: 12px; text-align: center;">
                    <div style="font-size: 10px; font-weight: 800; color: #f472b6; text-transform: uppercase;">KOLOR TONERI NA 0%</div>
                    <div style="font-size: 22px; font-weight: 900; color: #ec4899; margin-top: 2px;">${totalZeroColor}</div>
                  </div>
                </td>
              </tr>
            </table>

            <!-- Table of affected devices -->
            <table class="report-table">
              <thead>
                <tr>
                  <th style="width: 32%;">Štampač & IP Adresa</th>
                  <th style="width: 20%;">Lokacija</th>
                  <th style="width: 28%;">Hitni Problem & Greške</th>
                  <th style="width: 20%;">Stanje Tonera</th>
                </tr>
              </thead>
              <tbody>
                ${tableRowsHtml}
              </tbody>
            </table>

            <div style="text-align: center; margin-top: 26px;">
              <a href="${publicUrl()}/#scheduled_services" class="btn-portal" style="color: #000000 !important;">
                Otvori Centralni Admin Panel &bull; Automatski Servisi
              </a>
            </div>
          </div>

          <div class="email-footer">
            UNIPROMET DOO ČAČAK &bull; Služba za Informacione Tehnologije<br>
            Automatski generisano obaveštenje &bull; Datum: ${nowStr}
          </div>
        </div>
      </body>
      </html>
    `
  };

  const info = await transporter.sendMail(mailOptions);
  return {
    success: true,
    sent: true,
    recipient: toAddress,
    sender: SMTP_CONFIG.sender,
    urgentCount,
    totalWasteFull,
    totalZeroColor,
    totalHardwareErrors,
    messageId: info.messageId,
    response: info.response,
    timestamp: new Date().toISOString()
  };
}

/**
 * Sends a comprehensive single printer report email to administrators.
 * Can be triggered on-demand directly from the printer details modal.
 */
export async function sendSinglePrinterReportEmail(
  recipient: string | string[] = DEFAULT_ADMIN_RECIPIENTS,
  printerIp: string,
  customData?: any
) {
  const transporter = getMailTransport();
  const toAddress = Array.isArray(recipient) ? recipient.join(', ') : recipient;
  const cleanIp = printerIp.replace(/_1$/, '').trim();

  let data = customData;
  if (!data) {
    const { getPrinterConsumables } = await import('./snmpService');
    data = await getPrinterConsumables(cleanIp, 'public', true);
  }

  const { getPrinterByIp } = await import('../db/printerDb');
  const dbPrinter = getPrinterByIp(cleanIp);
  const printerName = dbPrinter?.name || data.deviceName || `Štampač ${cleanIp}`;
  const location = dbPrinter?.location || data.location || '-';

  const now = new Date();
  const nowStr = now.toLocaleString('sr-RS', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const hasErrors = data.hasError && data.errors && data.errors.length > 0;
  const errorCount = hasErrors ? data.errors.length : 0;
  const isWasteFull = data.wasteToner && data.wasteToner.status === 'full';
  const isWasteNear = data.wasteToner && data.wasteToner.status === 'near_full';

  // Build Toners HTML
  let tonersHtml = '';
  if (data.toners && data.toners.length > 0) {
    tonersHtml = data.toners.map((t: any) => {
      let colorDot = '#334155';
      let colorName = 'Crni (Black)';
      if (t.color === 'cyan') { colorDot = '#06b6d4'; colorName = 'Plavi (Cyan)'; }
      else if (t.color === 'magenta') { colorDot = '#ec4899'; colorName = 'Crveni (Magenta)'; }
      else if (t.color === 'yellow') { colorDot = '#eab308'; colorName = 'Žuti (Yellow)'; }

      const isZero = t.level === 0;
      const isLow = t.level <= 10;
      const pctBg = isZero ? 'rgba(239, 68, 68, 0.25)' : (isLow ? 'rgba(245, 158, 11, 0.2)' : 'rgba(16, 185, 129, 0.15)');
      const pctColor = isZero ? '#ef4444' : (isLow ? '#f59e0b' : '#34d399');

      return `
        <div style="background: #141a24; border: 1px solid #232a3b; border-radius: 8px; padding: 12px; margin-bottom: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-weight: 700; color: #ffffff; font-size: 13px;">
              <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${colorDot}; margin-right: 6px;"></span>
              ${colorName}
            </span>
            <span style="font-family: monospace; font-weight: 900; font-size: 13px; color: ${pctColor}; background: ${pctBg}; padding: 2px 8px; border-radius: 4px;">
              ${t.level}% ${isZero ? '(PRAZNO)' : ''}
            </span>
          </div>
          <div style="background: rgba(255,255,255,0.08); height: 8px; border-radius: 4px; overflow: hidden; margin: 8px 0 4px 0;">
            <div style="background: ${colorDot}; width: ${Math.max(t.level, 2)}%; height: 100%;"></div>
          </div>
          <div style="font-size: 11px; color: #94a3b8;">${t.name}</div>
        </div>
      `;
    }).join('');
  } else {
    tonersHtml = '<div style="color: #94a3b8; font-size: 12px;">Nema dostupnih senzora tonera za ovaj uređaj.</div>';
  }

  // Build Hardware Errors Alert Box
  let errorBannerHtml = '';
  if (hasErrors) {
    errorBannerHtml = `
      <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <div style="font-weight: 900; color: #ef4444; font-size: 14px; display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
          <span>🚨 DETEKTOVANA AKTIVNA GREŠKA ŠTAMPAČA (${errorCount})</span>
        </div>
        <div style="font-size: 13px; color: #ffffff; font-weight: 700; line-height: 1.6;">
          ${data.errors.map((e: string) => `• ${e}`).join('<br>')}
        </div>
        <div style="font-size: 11px; color: #fca5a5; margin-top: 6px;">
          Uređaj zahteva fizičku intervenciju ili proveru operatera.
        </div>
      </div>
    `;
  }

  // Waste Toner Status Box
  let wasteBoxHtml = '';
  if (data.wasteToner) {
    const wasteColor = isWasteFull ? '#ef4444' : (isWasteNear ? '#f59e0b' : '#10b981');
    const wasteBg = isWasteFull ? 'rgba(239, 68, 68, 0.15)' : (isWasteNear ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.1)');
    wasteBoxHtml = `
      <div style="background: ${wasteBg}; border: 1px solid ${wasteColor}; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <span style="font-size: 11px; font-weight: 800; color: #94a3b8; text-transform: uppercase;">OTPADNI TONER (WASTE CONTAINER)</span>
          <div style="font-size: 14px; font-weight: 800; color: #ffffff; margin-top: 2px;">${data.wasteToner.name || 'Otpadni kontejner'}</div>
        </div>
        <span style="font-weight: 900; font-size: 12px; color: ${wasteColor}; background: rgba(0,0,0,0.3); padding: 4px 10px; border-radius: 6px; border: 1px solid ${wasteColor};">
          ${isWasteFull ? '🚨 PUN (ZAMENITI)' : (isWasteNear ? '⚠️ SKORO PUN' : '✓ U REDU')}
        </span>
      </div>
    `;
  }

  // Lifetime metrics
  const totalPagesFormatted = data.totalPageCount !== null ? Number(data.totalPageCount).toLocaleString('sr-RS') : '-';
  const totalScansFormatted = data.scanCount !== null ? Number(data.scanCount).toLocaleString('sr-RS') : (data.hasScanner ? '0' : 'N/A');

  const subjectPrefix = hasErrors ? '🚨 [GREŠKA] ' : (isWasteFull ? '⚠️ [PUN WASTE] ' : '📄 ');
  const emailSubject = `${subjectPrefix}UNIPROMET - Izveštaj o štampaču: ${printerName} (${cleanIp})`;

  const textBody = `UNIPROMET DOO ČAČAK
IZVEŠTAJ O ŠTAMPAČU: ${printerName} (${cleanIp})
Datum: ${nowStr}
Model: ${data.model}
Lokacija: ${location}
Status: ${data.printerStatusText || 'Spreman'}
${hasErrors ? `\n🚨 AKTIVNE GREŠKE (${errorCount}):\n` + data.errors.map((e: string) => `  * ${e}`).join('\n') : ''}
${isWasteFull ? '\n⚠️ OTPADNI KONTEJNER: PUN (hitna zamena)' : ''}

Nivoi tonera:
${(data.toners || []).map((t: any) => `  * ${t.color.toUpperCase()}: ${t.level}% (${t.name})`).join('\n')}

Brojači:
  * Ukupno odštampano: ${totalPagesFormatted}
  * Ukupno skenirano: ${totalScansFormatted}

Web panel uređaja: http://${cleanIp}
Centralni Admin Panel: ${publicUrl()}`;

  const mailOptions = {
    from: `"${SMTP_CONFIG.senderName}" <${SMTP_CONFIG.sender}>`,
    to: toAddress,
    subject: emailSubject,
    text: textBody,
    html: `
      <!DOCTYPE html>
      <html lang="sr">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0b0e14; margin: 0; padding: 20px; color: #ffffff; }
          .email-container { max-width: 680px; margin: 0 auto; background-color: #111622; border-radius: 12px; border: 1px solid ${hasErrors ? '#ef4444' : '#1e293b'}; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
          .email-header { background: linear-gradient(135deg, #181e2b 0%, #0d1117 100%); padding: 22px 24px; border-bottom: 2px solid ${hasErrors ? '#ef4444' : '#FFB800'}; }
          .brand-title { color: #FFB800; font-size: 12px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; margin: 0; }
          .report-title { color: #ffffff; font-size: 19px; font-weight: 900; margin: 4px 0 0 0; }
          .content-body { padding: 24px; }
          .info-table { width: 100%; border-collapse: collapse; margin-bottom: 18px; background: #161b26; border-radius: 8px; overflow: hidden; font-size: 12px; }
          .info-table td { padding: 9px 14px; border-bottom: 1px solid #232a3b; }
          .info-table tr:last-child td { border-bottom: none; }
          .email-footer { padding: 18px 24px; background-color: #090c10; border-top: 1px solid #19202e; text-align: center; font-size: 12px; color: #64748b; }
          .btn-portal { display: inline-block; padding: 9px 20px; background: #FFB800; color: #000000 !important; font-weight: 800; border-radius: 6px; text-decoration: none; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="email-container">
          <div class="email-header">
            <span class="brand-title">UNIPROMET DOO ČAČAK &bull; IT SLUŽBA</span>
            <h2 class="report-title">${printerName}</h2>
            <div style="color: #94a3b8; font-size: 12px; margin-top: 4px;">
              IP Adresa: <strong style="color: #FFB800; font-family: monospace;">${cleanIp}</strong> &bull; Vreme provere: <strong>${nowStr}</strong>
            </div>
          </div>

          <div class="content-body">
            ${errorBannerHtml}

            <!-- Device Summary Strip -->
            <table class="info-table">
              <tr>
                <td style="color: #94a3b8; width: 35%;">Model Uređaja:</td>
                <td style="color: #ffffff; font-weight: 700;">${data.model}</td>
              </tr>
              <tr>
                <td style="color: #94a3b8;">Lokacija / Sektor:</td>
                <td style="color: #FFB800; font-weight: 700;">${location}</td>
              </tr>
              <tr>
                <td style="color: #94a3b8;">Serijski Broj:</td>
                <td style="color: #cbd5e1; font-family: monospace;">${data.serialNumber || '-'}</td>
              </tr>
              <tr>
                <td style="color: #94a3b8;">Trenutni Status:</td>
                <td>
                  <span style="font-weight: 800; color: ${hasErrors ? '#ef4444' : (isWasteFull ? '#f59e0b' : '#34d399')};">
                    ${data.printerStatusText || 'Spreman za rad'}
                  </span>
                </td>
              </tr>
              <tr>
                <td style="color: #94a3b8;">Vreme Rada (Uptime):</td>
                <td style="color: #cbd5e1; font-family: monospace;">${data.uptimeText || 'Aktivno'}</td>
              </tr>
            </table>

            ${wasteBoxHtml}

            <!-- Toner Section -->
            <div style="margin-bottom: 20px;">
              <div style="font-size: 12px; font-weight: 800; color: #94a3b8; text-transform: uppercase; margin-bottom: 8px;">
                Nivoi Potrošnog Materijala (Toneri)
              </div>
              ${tonersHtml}
            </div>

            <!-- Counters Grid -->
            <table style="width: 100%; border-spacing: 0; margin-bottom: 20px;">
              <tr>
                <td style="width: 50%; padding-right: 6px;">
                  <div style="background: #141a24; border: 1px solid #232a3b; border-radius: 8px; padding: 12px; text-align: center;">
                    <div style="font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase;">UKUPNO ODŠTAMPANO</div>
                    <div style="font-size: 20px; font-weight: 900; color: #FFB800; font-family: monospace; margin-top: 3px;">${totalPagesFormatted}</div>
                    <div style="font-size: 10px; color: #64748b; margin-top: 2px;">Marker Life Count</div>
                  </div>
                </td>
                <td style="width: 50%; padding-left: 6px;">
                  <div style="background: #141a24; border: 1px solid #232a3b; border-radius: 8px; padding: 12px; text-align: center;">
                    <div style="font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase;">UKUPNO SKENIRANO</div>
                    <div style="font-size: 20px; font-weight: 900; color: #38bdf8; font-family: monospace; margin-top: 3px;">${totalScansFormatted}</div>
                    <div style="font-size: 10px; color: #64748b; margin-top: 2px;">Counter 501 / Scan Total</div>
                  </div>
                </td>
              </tr>
            </table>

            <div style="display: flex; gap: 10px; justify-content: center; margin-top: 24px;">
              <a href="http://${cleanIp}" target="_blank" class="btn-portal" style="background: #1e293b; color: #ffffff !important; border: 1px solid #334155;">
                🌐 Otvori Web Panel Štampača
              </a>
              <a href="${publicUrl()}" class="btn-portal">
                Centralni Admin Panel
              </a>
            </div>
          </div>

          <div class="email-footer">
            UNIPROMET d.o.o. Čačak &bull; IT Služba &bull; Server IP: ${publicHost()}<br>
            Izveštaj generisan na zahtev administratora &bull; ${nowStr}
          </div>
        </div>
      </body>
      </html>
    `
  };

  const info = await transporter.sendMail(mailOptions);
  return {
    success: true,
    sent: true,
    recipient: toAddress,
    printerName,
    printerIp: cleanIp,
    hasErrors,
    errorsCount: errorCount,
    messageId: info.messageId,
    timestamp: new Date().toISOString()
  };
}





