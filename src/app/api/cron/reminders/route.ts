import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { sendSms, smsConfigured } from '@/lib/sms';
import { formatRdvFr, formatHeureFr } from '@/lib/rdv';

// Relances automatiques avant RDV (Opération Show-Up) : SMS à J-1 et H-2
// pour les leads cold call dont le RDV est confirmé (clic CONFIRMER).
// À appeler toutes les ~15 min par un planificateur externe (cron-job.org)
// ou un cron Vercel. Protégé par CRON_SECRET (header « Authorization:
// Bearer … » ou paramètre ?key=). Anti-doublon : les colonnes
// reminder_j1_sent_at / reminder_h2_sent_at sont réclamées AVANT l'envoi.

export const dynamic = 'force-dynamic';

const HOUR = 3_600_000;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth   = request.headers.get('authorization');
  const key    = request.nextUrl.searchParams.get('key');
  if (!secret || (auth !== `Bearer ${secret}` && key !== secret)) {
    return NextResponse.json({ message: 'Non autorisé' }, { status: 401 });
  }
  if (!smsConfigured()) {
    return NextResponse.json({ skipped: 'SMS non configuré (BREVO_API_KEY manquante)' });
  }

  const now = Date.now();
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, first_name, last_name, company, phone, rdv_date, confirmation_received_at, reminder_j1_sent_at, reminder_h2_sent_at')
    .eq('source', 'cold_call')
    .neq('status', 'lost')
    .not('confirmation_received_at', 'is', null)
    .not('phone', 'is', null)
    .gt('rdv_date', new Date(now).toISOString())
    .lte('rdv_date', new Date(now + 24 * HOUR).toISOString())
    .limit(100);

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  let j1 = 0, h2 = 0;
  const errors: string[] = [];

  for (const lead of leads ?? []) {
    const msToRdv = new Date(lead.rdv_date).getTime() - now;

    // Confirmé il y a moins d'1 h : le SMS de confirmation vient de partir,
    // inutile d'enchaîner une relance dans la foulée
    if (now - new Date(lead.confirmation_received_at).getTime() < HOUR) continue;

    const fullName      = `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim();
    const isCompanyName = !!lead.company && fullName === lead.company.trim();
    const prenom        = isCompanyName ? '' : ` ${lead.first_name}`;

    // H-2 prioritaire ; J-1 seulement s'il reste plus de 3 h (sinon les deux
    // relances partiraient presque en même temps pour un RDV confirmé tard)
    const due: 'h2' | 'j1' | null =
      msToRdv <= 2 * HOUR && !lead.reminder_h2_sent_at ? 'h2'
      : msToRdv > 3 * HOUR && !lead.reminder_j1_sent_at ? 'j1'
      : null;
    if (!due) continue;

    const col = due === 'h2' ? 'reminder_h2_sent_at' : 'reminder_j1_sent_at';
    const { data: claimed } = await supabase
      .from('leads')
      .update({ [col]: new Date().toISOString() })
      .eq('id', lead.id)
      .is(col, null)
      .select('id');
    if (!claimed || claimed.length === 0) continue; // déjà réclamé par un autre passage

    const message = due === 'h2'
      ? `Payment Flow : on se retrouve à ${formatHeureFr(lead.rdv_date)}${prenom}, tout est en place. Un imprévu de dernière minute ? Ecrivez-nous sur WhatsApp.`
      : `Payment Flow : votre RDV du ${formatRdvFr(lead.rdv_date)} approche${prenom ? `,${prenom}` : ''}. Votre maquette sera dévoilée pendant le rendez-vous. Un imprévu ? Ecrivez-nous sur WhatsApp.`;

    try {
      await sendSms(lead.phone, message);
      await supabase.from('lead_history').insert({
        lead_id: lead.id,
        action_note: `Relance ${due === 'h2' ? 'H-2' : 'J-1'} envoyée par SMS au ${lead.phone}`,
      });
      due === 'h2' ? h2++ : j1++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'erreur inconnue';
      errors.push(`${lead.id}: ${msg}`);
      await supabase.from('lead_history').insert({
        lead_id: lead.id,
        action_note: `⚠️ Échec de la relance ${due === 'h2' ? 'H-2' : 'J-1'} (SMS) : ${msg}`,
      });
    }
  }

  return NextResponse.json({ ok: true, j1_envoyes: j1, h2_envoyes: h2, erreurs: errors });
}
