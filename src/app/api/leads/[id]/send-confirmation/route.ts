import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import jwt from 'jsonwebtoken';
import { getAuthUser, unauthorized, forbidden, notFound, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { parisIso, formatRdvFr } from '@/lib/rdv';

// Mail-passerelle (Opération Show-Up).
// Le setter saisit en direct l'email (donné à l'oral pendant l'appel) et le
// créneau du RDV ; le prospect reçoit le récapitulatif + un bouton CONFIRMER
// qui pointe vers /api/confirm/[token] (horodatage + notification équipe),
// puis redirige vers le WhatsApp de closing avec « CONFIRMER » pré-rempli.
// Envoi : Vercel bloque le SMTP sortant des fonctions serverless — en prod
// l'envoi passe par l'API HTTP Brevo (BREVO_API_KEY) ; le SMTP (SMTP_HOST/
// PORT/USER/PASS) reste un fallback hors Vercel. SMTP_FROM (Nom <adresse>)
// est l'identité d'expéditeur dans les deux cas — l'adresse doit être un
// expéditeur vérifié chez Brevo.
// Optionnelles : APP_URL (sinon origine de la requête), WHATSAPP_CONFIRM_PHONE.

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const { BREVO_API_KEY, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  const smtpReady = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
  if (!SMTP_FROM || (!BREVO_API_KEY && !smtpReady)) {
    return NextResponse.json(
      { message: 'Envoi non configuré : renseigner SMTP_FROM + BREVO_API_KEY (recommandé sur Vercel), ou SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS.' },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const email    = String(body.email ?? '').trim().toLowerCase();
  const rdvLocal = String(body.rdv_date ?? '').trim(); // 'YYYY-MM-DDTHH:mm' heure de Paris

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return badRequest('Adresse email invalide.');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(rdvLocal)) return badRequest('Créneau du RDV invalide.');

  const { data: lead, error } = await supabase
    .from('leads')
    .select('id, first_name, last_name, company, setter_id')
    .eq('id', params.id)
    .single();

  if (error || !lead) return notFound('Lead introuvable');
  if (user.role !== 'admin' && lead.setter_id !== user.id) return forbidden();

  const rdvIso = parisIso(rdvLocal);
  const rdvFr  = formatRdvFr(rdvIso);

  const token = jwt.sign(
    { leadId: lead.id, purpose: 'rdv-confirm' },
    process.env.JWT_SECRET!,
    { expiresIn: '7d' }
  );
  const baseUrl    = process.env.APP_URL?.replace(/\/$/, '') || request.nextUrl.origin;
  const confirmUrl = `${baseUrl}/api/confirm/${token}`;

  // Leads « entreprise » importés avec nom = société : on salue sans prénom
  const fullName      = `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim();
  const isCompanyName = !!lead.company && fullName === lead.company.trim();
  const greeting      = isCompanyName ? 'Bonjour,' : `Bonjour ${lead.first_name},`;

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px 16px;color:#1f2937;">
    <p style="font-size:15px;line-height:1.6;">${greeting}</p>
    <p style="font-size:15px;line-height:1.6;">
      Comme convenu au téléphone, voici le récapitulatif :
    </p>
    <div style="background:#f3f4f6;border-radius:12px;padding:16px 20px;margin:20px 0;">
      <p style="font-size:15px;line-height:1.8;margin:0;">
        📅 <strong>Votre rendez-vous : ${rdvFr}</strong><br/>
        🎨 Votre maquette part en production dès votre confirmation
      </p>
    </div>
    <p style="font-size:15px;line-height:1.6;">
      Confirmez dans les <strong>15 minutes</strong> — passé ce délai,
      le créneau repart à un autre artisan.
    </p>
    <p style="text-align:center;margin:28px 0;">
      <a href="${confirmUrl}"
         style="background:#16a34a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 28px;border-radius:10px;display:inline-block;">
        CONFIRMER&nbsp;&#9656;
      </a>
    </p>
    <p style="font-size:12px;color:#9ca3af;text-align:center;">
      Le bouton confirme votre créneau et ouvre WhatsApp. À tout de suite.
    </p>
  </div>`;

  const text = `${greeting}\n\nComme convenu au téléphone, le récapitulatif :\n— Votre rendez-vous : ${rdvFr}\n— Votre maquette part en production dès votre confirmation\n\nConfirmez dans les 15 minutes — passé ce délai, le créneau repart à un autre artisan.\n\nConfirmer : ${confirmUrl}`;

  const subject = 'Votre créneau + votre maquette';

  try {
    if (BREVO_API_KEY) {
      const m = SMTP_FROM.match(/^\s*(.*?)\s*<(.+)>\s*$/);
      const sender = m ? { name: m[1] || undefined, email: m[2] } : { email: SMTP_FROM };
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          sender,
          to: [{ email }],
          subject,
          htmlContent: html,
          textContent: text,
        }),
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 300);
        throw new Error(`Brevo ${res.status} — ${detail}`);
      }
    } else {
      const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT ?? 587),
        secure: Number(SMTP_PORT ?? 587) === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });
      await transporter.sendMail({ from: SMTP_FROM, to: email, subject, html, text });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erreur d\'envoi inconnue';
    return NextResponse.json({ message: `Échec de l'envoi : ${msg}` }, { status: 502 });
  }

  const sentAt = new Date().toISOString();
  await supabase.from('leads').update({
    email,
    rdv_date: rdvIso,
    confirmation_email_sent_at: sentAt,
    confirmation_received_at: null,
  }).eq('id', lead.id);

  await supabase.from('lead_history').insert({
    lead_id: lead.id,
    user_id: user.id,
    action_note: `Mail-passerelle envoyé à ${email} — RDV proposé ${rdvFr}`,
  });

  return NextResponse.json({ ok: true, sent_at: sentAt });
}
