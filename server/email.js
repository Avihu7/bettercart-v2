/**
 * Outgoing email through Resend (https://resend.com) — used for password resets.
 *
 * Settings (server-side only, in .env.local):
 *   RESEND_API_KEY  – required to send
 *   EMAIL_FROM      – sender, default "BetterCart <onboarding@resend.dev>"
 *                     (Resend's test sender can only deliver to the address of
 *                     the Resend account owner until a domain is verified)
 *
 * Never logs recipients, links or tokens.
 */

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'BetterCart <onboarding@resend.dev>';

export const isEmailConfigured = () => !!process.env.RESEND_API_KEY;

async function sendEmail({ to, subject, html, text }) {
  if (!isEmailConfigured()) {
    console.warn('[email] RESEND_API_KEY is not set — email not sent');
    return false;
  }
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: process.env.EMAIL_FROM || DEFAULT_FROM, to: [to], subject, html, text }),
  });
  if (!res.ok) {
    console.error(`[email] Resend rejected the message (HTTP ${res.status})`);
    return false;
  }
  return true;
}

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Hebrew, RTL password-reset email with a one-time link. */
export function sendPasswordResetEmail(to, link, minutesValid) {
  const safeLink = escapeHtml(link);
  const html = `<!doctype html>
<html lang="he" dir="rtl">
  <body style="margin:0;padding:24px;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;direction:rtl;text-align:right;color:#1a1a1a">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
      <h1 style="font-size:20px;margin:0 0 12px">איפוס סיסמה ל-BetterCart</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 20px">קיבלנו בקשה לאפס את הסיסמה לחשבון שלך. כדי לבחור סיסמה חדשה, לחצו על הכפתור:</p>
      <p style="margin:0 0 20px"><a href="${safeLink}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:bold">בחירת סיסמה חדשה</a></p>
      <p style="font-size:13px;line-height:1.6;color:#555;margin:0 0 8px">הקישור תקף ל-${minutesValid} דקות ולשימוש אחד בלבד.</p>
      <p style="font-size:13px;line-height:1.6;color:#555;margin:0">אם לא ביקשת לאפס את הסיסמה, אפשר להתעלם מהמייל הזה — הסיסמה הנוכחית תישאר בתוקף.</p>
    </div>
  </body>
</html>`;
  const text = `איפוס סיסמה ל-BetterCart\n\nכדי לבחור סיסמה חדשה, פתחו את הקישור:\n${link}\n\nהקישור תקף ל-${minutesValid} דקות ולשימוש אחד בלבד.\nאם לא ביקשת לאפס את הסיסמה, אפשר להתעלם מהמייל הזה.`;
  return sendEmail({ to, subject: 'איפוס סיסמה ל-BetterCart', html, text });
}
