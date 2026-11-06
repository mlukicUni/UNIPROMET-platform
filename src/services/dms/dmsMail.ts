import { getMailTransport, SMTP_CONFIG } from '../mailService';

/**
 * Slanje mejlova iz DMS sekcije preko zajedničkog mail servisa platforme
 * (pošiljalac je adresa platforme; na dev mašini mejlovi idu samo na MAIL_REDIRECT_TO).
 */

const escapeHtml = (s: string) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 50;

/** Proverava listu primalaca: samo ispravne adrese, bez duplikata */
export function cleanRecipients(list: unknown): string[] {
  if (!Array.isArray(list)) throw new Error('Lista primalaca nije ispravna');
  const unique = [...new Set(list.map(e => String(e || '').trim().toLowerCase()).filter(Boolean))];
  if (unique.length === 0) throw new Error('Nije izabran nijedan primalac');
  if (unique.length > MAX_RECIPIENTS) throw new Error(`Najviše ${MAX_RECIPIENTS} primalaca`);
  const invalid = unique.filter(e => !EMAIL_RE.test(e));
  if (invalid.length > 0) throw new Error(`Neispravne adrese: ${invalid.join(', ')}`);
  return unique;
}

export async function sendDmsMail(subject: string, content: string, recipients: string[]): Promise<{ messageId: string }> {
  const isHtml = /<[a-z][\s\S]*>/i.test(content);
  const html = isHtml
    ? content
    : `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1e293b;line-height:1.6;">${escapeHtml(content).replace(/\r\n|\r|\n/g, '<br>')}</div>`;

  const info = await getMailTransport().sendMail({
    from: `"${SMTP_CONFIG.senderName}" <${SMTP_CONFIG.sender}>`,
    to: recipients.join(', '),
    subject,
    text: isHtml ? content.replace(/<[^>]*>/g, '') : content,
    html
  });
  console.log(`[DMS Mail] "${subject}" poslat na: ${recipients.join(', ')}`);
  return { messageId: info.messageId };
}
