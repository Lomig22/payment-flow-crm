// Envoi de SMS transactionnels via l'API Brevo (HTTPS — compatible Vercel).
// Env : BREVO_API_KEY (compte Brevo avec crédits SMS prépayés) ;
// SMS_SENDER optionnel — expéditeur alphanumérique ≤ 11 caractères sans
// espaces (défaut PaymentFlow). Envoi one-way : pas de réponse possible,
// les messages renvoient donc le prospect vers WhatsApp.

export function smsConfigured(): boolean {
  return !!process.env.BREVO_API_KEY;
}

// « 06 87 19 05 33 » → « 33687190533 » (format international attendu par Brevo)
export function toInternationalFr(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) return '33' + digits.slice(1);
  if (digits.length === 11 && digits.startsWith('33')) return digits;
  if (digits.length >= 11) return digits; // déjà international (ex. +41…)
  return null;
}

export async function sendSms(to: string, content: string) {
  const recipient = toInternationalFr(to);
  if (!recipient) throw new Error(`Numéro de téléphone invalide : ${to}`);

  const res = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY!,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      type: 'transactional',
      sender: (process.env.SMS_SENDER || 'PaymentFlow').replace(/\s/g, '').slice(0, 11),
      recipient,
      content,
    }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`Brevo SMS ${res.status} — ${detail}`);
  }
}
