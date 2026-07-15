import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { supabase } from '@/lib/supabase';
import { formatRdvFr } from '@/lib/rdv';

// Lien public cliqué par le prospect depuis le mail-passerelle (bouton CONFIRMER).
// Horodate la confirmation, notifie l'équipe (historique → page Notifications,
// + groupe WhatsApp si Whapi configuré), puis redirige vers le WhatsApp du
// SETTER ASSIGNÉ (users.phone) avec « CONFIRMER » pré-rempli.
// Env optionnelles : WHATSAPP_CONFIRM_PHONE (fallback si le setter n'a pas
// de numéro), WHAPI_TOKEN + WHAPI_GROUP_ID.

const page = (title: string, body: string) =>
  new NextResponse(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#f9fafb;color:#1f2937;">
<div style="text-align:center;padding:32px;"><h1 style="font-size:22px;">${title}</h1><p style="font-size:15px;color:#6b7280;">${body}</p></div>
</body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );

async function notifyWhatsAppGroup(message: string) {
  const { WHAPI_TOKEN, WHAPI_GROUP_ID } = process.env;
  if (!WHAPI_TOKEN || !WHAPI_GROUP_ID) return;
  try {
    await fetch('https://gate.whapi.cloud/messages/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WHAPI_TOKEN}` },
      body: JSON.stringify({ to: WHAPI_GROUP_ID, body: message }),
    });
  } catch {
    // La notification de groupe est best-effort : la confirmation est déjà enregistrée.
  }
}

export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  let leadId: string;
  try {
    const decoded = jwt.verify(params.token, process.env.JWT_SECRET!) as { leadId: string; purpose: string };
    if (decoded.purpose !== 'rdv-confirm') throw new Error('bad purpose');
    leadId = decoded.leadId;
  } catch {
    return page('Lien expiré', 'Ce lien de confirmation n\'est plus valide. Répondez simplement à notre email ou SMS.');
  }

  const { data: lead } = await supabase
    .from('leads')
    .select('id, first_name, last_name, company, rdv_date, confirmation_received_at, users!setter_id(first_name, last_name, phone)')
    .eq('id', leadId)
    .single();

  if (!lead) return page('Lien invalide', 'Ce lien ne correspond à aucun rendez-vous.');

  // Première confirmation uniquement : horodatage + notification équipe
  if (!lead.confirmation_received_at) {
    const confirmedAt = new Date().toISOString();
    await supabase.from('leads')
      .update({ confirmation_received_at: confirmedAt })
      .eq('id', leadId);

    const who   = `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim() || lead.company || 'Le prospect';
    const rdvFr = lead.rdv_date ? formatRdvFr(lead.rdv_date) : 'créneau non renseigné';
    const setter = (lead as any).users
      ? `${(lead as any).users.first_name} ${(lead as any).users.last_name}` : 'non assigné';

    await supabase.from('lead_history').insert({
      lead_id: leadId,
      action_note: `✅ ${who} a CONFIRMÉ son RDV (${rdvFr})`,
    });

    await notifyWhatsAppGroup(`✅ CONFIRMÉ — ${who}\n📅 ${rdvFr}\n👤 Setter : ${setter}\n🎨 Maquette à lancer`);
  }

  // Le prospect atterrit sur le WhatsApp du setter assigné ; fallback global sinon
  const setterPhone = String((lead as any).users?.phone ?? '').replace(/\D/g, '');
  const phone = setterPhone || String(process.env.WHATSAPP_CONFIRM_PHONE ?? '').replace(/\D/g, '');
  if (phone) {
    return NextResponse.redirect(`https://wa.me/${phone}?text=${encodeURIComponent('CONFIRMER')}`, 302);
  }
  return page('C\'est confirmé ✓', 'Votre créneau est verrouillé — on prépare votre maquette. À très vite.');
}
