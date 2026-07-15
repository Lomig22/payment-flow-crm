import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { getAuthUser, unauthorized, forbidden, notFound } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

// Mail-passerelle (Opération Show-Up) : un lien, rien d'autre.
// Le prospect clique → WhatsApp s'ouvre sur le fil avec « CONFIRMER » pré-rempli.
// Variables d'environnement requises : SMTP_HOST, SMTP_PORT, SMTP_USER,
// SMTP_PASS, SMTP_FROM, WHATSAPP_CONFIRM_PHONE (format international sans +, ex. 336XXXXXXXX).

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, WHATSAPP_CONFIRM_PHONE } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM || !WHATSAPP_CONFIRM_PHONE) {
    return NextResponse.json(
      { message: 'Envoi non configuré : renseigner SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM et WHATSAPP_CONFIRM_PHONE.' },
      { status: 503 }
    );
  }

  const { data: lead, error } = await supabase
    .from('leads')
    .select('id, first_name, last_name, company, email, setter_id, confirmation_email_sent_at')
    .eq('id', params.id)
    .single();

  if (error || !lead) return notFound('Lead introuvable');
  if (user.role !== 'admin' && lead.setter_id !== user.id) return forbidden();
  if (!lead.email || !lead.email.includes('@')) {
    return NextResponse.json({ message: 'Ce lead n\'a pas d\'adresse email.' }, { status: 400 });
  }

  // Leads « entreprise » importés avec nom = société : on salue sans prénom
  const fullName  = `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim();
  const isCompanyName = !!lead.company && fullName === lead.company.trim();
  const greeting  = isCompanyName ? 'Bonjour,' : `Bonjour ${lead.first_name},`;

  const waLink = `https://wa.me/${WHATSAPP_CONFIRM_PHONE}?text=${encodeURIComponent('CONFIRMER')}`;

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px 16px;color:#1f2937;">
    <p style="font-size:15px;line-height:1.6;">${greeting}</p>
    <p style="font-size:15px;line-height:1.6;">
      Comme convenu au téléphone : cliquez ci-dessous, vous arrivez directement
      sur WhatsApp pour confirmer. À tout de suite.
    </p>
    <p style="text-align:center;margin:32px 0;">
      <a href="${waLink}"
         style="background:#16a34a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 28px;border-radius:10px;display:inline-block;">
        Confirmer sur WhatsApp&nbsp;&#9656;
      </a>
    </p>
  </div>`;

  const text = `${greeting}\n\nComme convenu au téléphone : ouvrez ce lien, vous arrivez directement sur WhatsApp pour confirmer. À tout de suite.\n\n${waLink}`;

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT ?? 587),
    secure: Number(SMTP_PORT ?? 587) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  try {
    await transporter.sendMail({
      from: SMTP_FROM,
      to: lead.email,
      subject: 'Votre créneau + votre maquette',
      html,
      text,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erreur SMTP inconnue';
    return NextResponse.json({ message: `Échec de l'envoi : ${msg}` }, { status: 502 });
  }

  const sentAt = new Date().toISOString();
  await supabase.from('leads').update({ confirmation_email_sent_at: sentAt }).eq('id', lead.id);
  await supabase.from('lead_history').insert({
    lead_id: lead.id,
    user_id: user.id,
    action_note: `Mail-passerelle envoyé à ${lead.email} (bouton CONFIRMER → WhatsApp)`,
  });

  return NextResponse.json({ ok: true, sent_at: sentAt });
}
