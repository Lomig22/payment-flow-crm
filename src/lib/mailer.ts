import nodemailer from 'nodemailer';

// Envoi des emails du CRM. Vercel bloque le SMTP sortant des fonctions
// serverless : en production l'envoi doit passer par une API HTTPS.
// Priorité : API Gmail (expéditeur @gmail.com authentique, mails visibles
// dans « Messages envoyés ») > Brevo > SMTP (hors Vercel uniquement).
// SMTP_FROM = identité d'expéditeur commune, format « Nom <adresse> ».

// fromName : remplace le nom d'affichage de SMTP_FROM (l'adresse ne change
// jamais) — permet de signer le mail du prénom du setter qui envoie
type Mail = { to: string; subject: string; html: string; text: string; fromName?: string };

export function mailerConfigError(): string | null {
  const {
    GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN,
    BREVO_API_KEY, SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM,
  } = process.env;
  const gmailReady = !!(GMAIL_CLIENT_ID && GMAIL_CLIENT_SECRET && GMAIL_REFRESH_TOKEN);
  const smtpReady  = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
  if (!SMTP_FROM) return 'Envoi non configuré : SMTP_FROM manquant (format « Nom <adresse@gmail.com> »).';
  if (!gmailReady && !BREVO_API_KEY && !smtpReady) {
    return 'Envoi non configuré : renseigner GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN (recommandé sur Vercel), ou BREVO_API_KEY, ou SMTP_HOST/SMTP_USER/SMTP_PASS.';
  }
  return null;
}

function parseFrom(from: string): { name?: string; email: string } {
  const m = from.match(/^\s*(.*?)\s*<(.+)>\s*$/);
  return m ? { name: m[1] || undefined, email: m[2] } : { email: from };
}

const b64     = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const b64url  = (s: string) => b64(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// En-têtes MIME : les caractères non-ASCII (accents, tirets typographiques)
// doivent être encodés en mot RFC 2047
const rfc2047 = (s: string) => (/^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const wrap76  = (s: string) => s.match(/.{1,76}/g)?.join('\r\n') ?? s;

async function sendViaGmail(mail: Mail) {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, SMTP_FROM } = process.env;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     GMAIL_CLIENT_ID!,
      client_secret: GMAIL_CLIENT_SECRET!,
      refresh_token: GMAIL_REFRESH_TOKEN!,
      grant_type:    'refresh_token',
    }),
  });
  if (!tokenRes.ok) {
    const detail = (await tokenRes.text().catch(() => '')).slice(0, 300);
    throw new Error(`Google OAuth ${tokenRes.status} — ${detail}`);
  }
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const from = parseFrom(SMTP_FROM!);
  const fromName = mail.fromName ?? from.name;
  const fromHeader = fromName ? `${rfc2047(fromName)} <${from.email}>` : from.email;
  const boundary = 'b_' + Math.random().toString(36).slice(2);
  const mime = [
    `From: ${fromHeader}`,
    `To: ${mail.to}`,
    `Subject: ${rfc2047(mail.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(mail.text)),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(mail.html)),
    `--${boundary}--`,
  ].join('\r\n');

  const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: b64url(mime) }),
  });
  if (!sendRes.ok) {
    const detail = (await sendRes.text().catch(() => '')).slice(0, 300);
    throw new Error(`Gmail ${sendRes.status} — ${detail}`);
  }
}

async function sendViaBrevo(mail: Mail) {
  const { BREVO_API_KEY, SMTP_FROM } = process.env;
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY!, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender:      { ...parseFrom(SMTP_FROM!), ...(mail.fromName ? { name: mail.fromName } : {}) },
      to:          [{ email: mail.to }],
      subject:     mail.subject,
      htmlContent: mail.html,
      textContent: mail.text,
    }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`Brevo ${res.status} — ${detail}`);
  }
}

async function sendViaSmtp(mail: Mail) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT ?? 587),
    secure: Number(SMTP_PORT ?? 587) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  const parsed = parseFrom(SMTP_FROM!);
  await transporter.sendMail({
    from: mail.fromName ? { name: mail.fromName, address: parsed.email } : SMTP_FROM,
    to: mail.to, subject: mail.subject, html: mail.html, text: mail.text,
  });
}

export async function sendLeadEmail(mail: Mail) {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, BREVO_API_KEY } = process.env;
  if (GMAIL_CLIENT_ID && GMAIL_CLIENT_SECRET && GMAIL_REFRESH_TOKEN) return sendViaGmail(mail);
  if (BREVO_API_KEY) return sendViaBrevo(mail);
  return sendViaSmtp(mail);
}
