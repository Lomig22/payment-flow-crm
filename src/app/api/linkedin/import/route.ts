import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { parseHermesCsv, analyzeImport, type Existing } from '@/lib/linkedinImport';

// POST { csv, filename?, dry_run?, enqueue? } → import des leads sourcés par Hermès.
// En-tête attendu : prenom,nom,entreprise,poste,secteur,ville,departement,site_web,linkedin,siren,source,date_sourcing
// Contrôles et dédoublonnage : voir @/lib/linkedinImport.
// dry_run : rapport seulement, rien n'est créé.
export const dynamic     = 'force-dynamic';
export const maxDuration = 60;

async function existingLeads(): Promise<Existing[]> {
  const out: Existing[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await (supabase as any).from('leads')
      .select('id, company, location, siren, linkedin_url, do_not_contact').range(from, from + 999);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();
  const { csv, filename, dry_run, enqueue } = await request.json().catch(() => ({}));
  if (typeof csv !== 'string' || !csv.trim()) return badRequest('Fichier CSV vide');

  let rows: Record<string, string>[];
  try {
    rows = parseHermesCsv(csv);
  } catch (e: any) {
    return badRequest(`Fichier CSV invalide : ${e.message}`);
  }

  const { rejected, warnings, toInsert } = analyzeImport(rows, await existingLeads());

  let imported = 0;
  if (!dry_run && toInsert.length) {
    const db = supabase as any;
    const now = new Date().toISOString();
    const { data: batch } = await db.from('import_batches')
      .insert({ user_id: user.id, filename: String(filename || 'hermes-linkedin.csv').slice(0, 255), total_leads: toInsert.length })
      .select('id').single();
    for (let i = 0; i < toInsert.length; i += 200) {
      const chunk = toInsert.slice(i, i + 200).map((l) => ({
        ...l, import_batch_id: batch?.id ?? null,
        ...(enqueue ? { li_status: 'to_invite', li_enqueued_at: now } : {}),
      }));
      const { data, error } = await db.from('leads').insert(chunk).select('id');
      if (error) return NextResponse.json({ message: `Import interrompu : ${error.message}`, imported }, { status: 500 });
      imported += data.length;
      await db.from('lead_history').insert(data.map((d: any) => ({
        lead_id: d.id, user_id: user.id, field_changed: 'li_status', new_value: enqueue ? 'En séquence' : 'Importé',
        action_note: `LinkedIn : importé depuis ${filename || 'le CSV Hermès'}${enqueue ? ' et ajouté à la séquence' : ''}`,
      })));
    }
  }

  return NextResponse.json({
    dry_run: !!dry_run, total: rows.length, imported: dry_run ? 0 : imported, importable: toInsert.length,
    rejected, warnings,
  });
}
