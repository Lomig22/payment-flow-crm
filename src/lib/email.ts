const APP_URL = 'https://payment-flow-crm-delta.vercel.app';

export async function sendChatNotification({
  to,
  senderName,
  conversationName,
  content,
}: {
  to: string;
  senderName: string;
  conversationName: string;
  content: string;
}) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;

  const escaped = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Payment Flow CRM <onboarding@resend.dev>',
      to,
      subject: `💬 ${senderName} — ${conversationName}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
          <div style="background:#4F46E5;padding:16px 24px;border-radius:8px 8px 0 0">
            <h2 style="color:#fff;margin:0;font-size:18px">Nouveau message — Payment Flow CRM</h2>
          </div>
          <div style="border:1px solid #E5E7EB;border-top:none;padding:24px;border-radius:0 0 8px 8px">
            <p style="margin:0 0 6px"><strong>De :</strong> ${senderName}</p>
            <p style="margin:0 0 18px"><strong>Conversation :</strong> ${conversationName}</p>
            <div style="background:#F9FAFB;border-left:4px solid #4F46E5;padding:12px 16px;border-radius:4px">
              <p style="margin:0;color:#1F2937;line-height:1.6">${escaped}</p>
            </div>
            <p style="margin:20px 0 0">
              <a href="${APP_URL}/chat"
                 style="background:#4F46E5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;display:inline-block">
                Répondre dans le CRM →
              </a>
            </p>
          </div>
          <p style="color:#9CA3AF;font-size:11px;margin:12px 0 0;text-align:center">
            Payment Flow CRM · Vous recevez cet email car vous êtes administrateur.
          </p>
        </div>
      `,
    }),
  });
}
