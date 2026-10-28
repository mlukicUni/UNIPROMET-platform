import { getMailTransport, SMTP_CONFIG, DEFAULT_ADMIN_RECIPIENTS } from './mailService';
import { publicUrl } from '../utils/appConfig';

/**
 * ==========================================================================
 * UNIPROMET IT ADMIN - ISTEK AZURE KLJUČA (AZURE_CLIENT_SECRET)
 * Ključ aplikacije za Microsoft 365 prijavu (Entra ID) ima rok važenja.
 * Datum isteka je u .env kao AZURE_CLIENT_SECRET_EXPIRES=YYYY-MM-DD; posle
 * zamene ključa u Azure portalu upisuje se novi ključ i novi datum isteka.
 * ==========================================================================
 */

export interface SecretExpiryStatus {
  configured: boolean;
  expiresOn: string;      // YYYY-MM-DD
  expiresOnDisplay: string; // 3.9.2028.
  daysLeft: number;       // 1 = ističe sutra, 0 = ističe danas, < 0 = istekao
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Broj kalendarskih dana od danas do datuma isteka (po lokalnom vremenu servera) */
export function getAzureSecretExpiry(now: Date = new Date()): SecretExpiryStatus {
  const raw = (process.env.AZURE_CLIENT_SECRET_EXPIRES || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) {
    return { configured: false, expiresOn: raw, expiresOnDisplay: raw || '-', daysLeft: NaN };
  }
  const expires = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysLeft = Math.round((expires.getTime() - today.getTime()) / DAY_MS);
  return {
    configured: true,
    expiresOn: raw,
    expiresOnDisplay: `${Number(m[3])}.${Number(m[2])}.${m[1]}.`,
    daysLeft
  };
}

/** Upozorenje administratorima: ključ ističe sutra (daysLeft = 1) ili je već istekao (daysLeft <= 0) */
export async function sendAzureSecretExpiryEmail(
  recipient: string | string[] = DEFAULT_ADMIN_RECIPIENTS,
  status: SecretExpiryStatus
) {
  const transporter = getMailTransport();
  const toAddress = Array.isArray(recipient) ? recipient.join(', ') : recipient;
  const expired = status.daysLeft <= 0;
  const nowStr = new Date().toLocaleString('sr-RS', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const headline = expired
    ? (status.daysLeft === 0 ? 'AZURE KLJUČ ISTIČE DANAS' : 'AZURE KLJUČ JE ISTEKAO')
    : 'AZURE KLJUČ ISTIČE SUTRA';
  const accent = expired ? '#ef4444' : '#FFB800';
  const consequence = 'Kada ključ istekne, prijava na Centralni Admin Panel preko Microsoft 365 naloga (Entra ID) prestaje da radi za sve korisnike.';
  const steps = [
    'Azure portal → Microsoft Entra ID → App registrations → aplikacija Admin Panela',
    'Certificates &amp; secrets → New client secret (napravite novi ključ)',
    'Na serveru u fajlu .env zamenite AZURE_CLIENT_SECRET novom vrednošću',
    'U istom fajlu ažurirajte AZURE_CLIENT_SECRET_EXPIRES na novi datum isteka (YYYY-MM-DD)',
    'Restartujte server, proverite prijavu, pa obrišite stari ključ u Azure portalu'
  ];

  const subject = expired
    ? `🚨 UNIPROMET - ${status.daysLeft === 0 ? 'Azure ključ za prijavu ističe DANAS' : 'Azure ključ za prijavu je ISTEKAO'} (${status.expiresOnDisplay})`
    : `⚠️ UNIPROMET - Azure ključ za prijavu ističe SUTRA (${status.expiresOnDisplay})`;

  const text = `UNIPROMET DOO ČAČAK
${headline}
Datum isteka: ${status.expiresOnDisplay}
Promenljiva: AZURE_CLIENT_SECRET (Microsoft 365 / Entra ID prijava)

${consequence}

Koraci za zamenu:
${steps.map((s, i) => `${i + 1}. ${s.replace(/&amp;/g, '&')}`).join('\n')}

Poslato: ${nowStr}
Admin portal: ${publicUrl()}`;

  const html = `
    <!DOCTYPE html>
    <html lang="sr">
    <head><meta charset="UTF-8"></head>
    <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0b0e14; margin: 0; padding: 20px; color: #ffffff;">
      <div style="max-width: 680px; margin: 0 auto; background-color: #10141d; border: 1px solid ${accent}70; border-radius: 12px; overflow: hidden;">
        <div style="background: #0d1117; border-bottom: 2px solid ${accent}; padding: 24px; text-align: center;">
          <h1 style="color: #ffffff; font-size: 20px; font-weight: 900; letter-spacing: 0.08em; margin: 0;">UNIPROMET DOO ČAČAK</h1>
          <div style="color: #FFB800; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; margin-top: 4px;">Na svetloj strani puta &bull; Bezbednost sistema</div>
        </div>
        <div style="padding: 24px; color: #e2e8f0; font-size: 13px; line-height: 1.55;">
          <div style="text-align: center; margin-bottom: 18px;">
            <span style="display: inline-block; background: ${accent}26; border: 1px solid ${accent}; color: ${accent}; padding: 6px 16px; border-radius: 20px; font-size: 12px; font-weight: 800;">
              ${expired ? '🚨' : '⚠️'} ${headline}
            </span>
          </div>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 18px;">
            <tr>
              <td style="width: 50%; padding: 6px;">
                <div style="background: #161b26; border: 1px solid ${accent}50; border-radius: 8px; padding: 12px; text-align: center;">
                  <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: #94a3b8; display: block;">DATUM ISTEKA</span>
                  <span style="font-size: 18px; font-weight: 900; color: ${accent}; display: block; margin-top: 2px;">${status.expiresOnDisplay}</span>
                </div>
              </td>
              <td style="width: 50%; padding: 6px;">
                <div style="background: #161b26; border: 1px solid #232a3b; border-radius: 8px; padding: 12px; text-align: center;">
                  <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: #94a3b8; display: block;">KLJUČ</span>
                  <span style="font-size: 13px; font-weight: 800; color: #ffffff; display: block; margin-top: 4px; font-family: monospace;">AZURE_CLIENT_SECRET</span>
                </div>
              </td>
            </tr>
          </table>
          <p style="margin: 0 0 14px 0; color: #cbd5e1;">${consequence}</p>
          <div style="background: #161b26; border: 1px solid #232a3b; border-radius: 8px; padding: 14px 18px;">
            <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: #94a3b8; margin-bottom: 8px;">Koraci za zamenu ključa</div>
            <ol style="margin: 0; padding-left: 18px; color: #e2e8f0;">
              ${steps.map(s => `<li style="margin-bottom: 4px;">${s}</li>`).join('')}
            </ol>
          </div>
          <div style="text-align: center; margin-top: 22px;">
            <a href="${publicUrl()}" style="display: inline-block; background: #FFB800; color: #000000; font-weight: 800; padding: 11px 26px; border-radius: 6px; text-decoration: none; font-size: 13px;">Otvori Centralni Admin Panel</a>
          </div>
        </div>
        <div style="background: #090b0f; border-top: 1px solid #1e2433; padding: 18px 24px; text-align: center; font-size: 11px; color: #64748b;">
          UNIPROMET d.o.o. Čačak &bull; IT Služba i Upravljanje Mrežom<br>
          Poslato sa: ${SMTP_CONFIG.sender} &bull; Vreme: ${nowStr}
        </div>
      </div>
    </body>
    </html>`;

  const info = await transporter.sendMail({
    from: `"${SMTP_CONFIG.senderName}" <${SMTP_CONFIG.sender}>`,
    to: toAddress,
    subject,
    text,
    html
  });

  return { success: true, sent: true, recipient: toAddress, messageId: info.messageId, response: info.response, timestamp: new Date().toISOString() };
}
