import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

const APIFY_BASE = 'https://api.apify.com/v2';

const KEYWORDS_METIER = [
  'electricien', 'électricien', 'plombier', 'carreleur', 'peintre',
  'macon', 'maçon', 'couvreur', 'menuisier', 'charpentier', 'plaquiste',
  'platrier', 'plâtrier', 'carrelage', 'plomberie', 'electricité',
  'électricité', 'btp', 'artisan', 'renovation', 'rénovation',
  'batiment', 'bâtiment', 'travaux', 'construction', 'isolation',
  'façade', 'facade', 'zingueur', 'peinture', 'dallage',
];

const KEYWORDS_STATUT = [
  'auto-entrepreneur', 'autoentrepreneur', 'auto entrepreneur',
  'micro-entrepreneur', 'microentrepreneur', 'micro entrepreneur',
  'siret', 'siren', 'tpe', 'indépendant', 'independant',
  'gérant', 'gerant', 'freelance', 'à mon compte', 'a mon compte',
];

const EMAIL_REGEX = /[\w.+\-]+@[\w\-]+\.[a-z]{2,6}/i;

function scoreProfile(bio: string, followers: number, externalUrl: string, latestPost: string | null) {
  let score = 0;
  const details: string[] = [];
  const bl = bio.toLowerCase();

  if (KEYWORDS_METIER.some((k) => bl.includes(k))) { score += 20; details.push('métier+20'); }
  if (!externalUrl) { score += 25; details.push('sans-site+25'); }

  const emailMatch = bio.match(EMAIL_REGEX);
  const emailBio = emailMatch ? emailMatch[0] : null;
  if (emailBio) { score += 20; details.push('email+20'); }

  if (latestPost) {
    const days = (Date.now() - new Date(latestPost).getTime()) / 86_400_000;
    if (days <= 30) { score += 15; details.push('récent+15'); }
  }

  if (followers >= 200 && followers <= 5000) { score += 10; details.push('abonnés+10'); }
  if (KEYWORDS_STATUT.some((k) => bl.includes(k))) { score += 10; details.push('statut+10'); }

  return { score, score_details: details.join(', '), email_bio: emailBio };
}

function normalizePost(item: any) {
  const profile = item.ownerProfile || {};

  const username   = profile.username || item.ownerUsername || item.username || '';
  if (!username) return null;

  // Use profile bio if available, otherwise fall back to post caption
  const bio        = profile.biography || profile.bio || item.caption || item.description || '';
  const followers  = Number(profile.followersCount || profile.followers_count || 0);
  const externalUrl = profile.externalUrl || profile.external_url || '';
  // Post timestamp = when the post was published = proof of recent activity
  const latestPost = profile.latestPostTimestamp || item.timestamp || item.taken_at_timestamp || null;
  const fullName   = (profile.fullName || profile.full_name || item.ownerFullName || '').trim();

  const { score, score_details, email_bio } = scoreProfile(bio, followers, externalUrl, latestPost);
  if (score < 60) return null;

  const parts = fullName.split(' ');
  const first_name = parts[0] || username;
  const last_name  = parts.slice(1).join(' ') || 'Instagram';

  const notes = [
    `📸 @${username}`,
    `🔗 https://www.instagram.com/${username}/`,
    followers > 0 ? `👥 ${followers} abonnés` : null,
    bio ? `📝 ${bio.slice(0, 200)}` : null,
    email_bio ? `📧 ${email_bio}` : null,
    `⭐ Score : ${score}/100 (${score_details})`,
    `🗓️ Import : ${new Date().toISOString().slice(0, 10)}`,
  ].filter(Boolean).join('\n');

  return { first_name, last_name, email: email_bio || '', instagram_username: username, instagram_score: score, notes };
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
  if (!APIFY_TOKEN) {
    return NextResponse.json({ message: 'APIFY_API_TOKEN manquant' }, { status: 500 });
  }

  const db = supabase as any;

  // Find the most recent succeeded run of the hashtag scraper
  const runsRes = await fetch(
    `${APIFY_BASE}/acts/apify~instagram-hashtag-scraper/runs?token=${APIFY_TOKEN}&status=SUCCEEDED&limit=1`,
  );
  if (!runsRes.ok) {
    return NextResponse.json({ message: 'Impossible de contacter Apify' }, { status: 500 });
  }

  const runsJson = await runsRes.json();
  const lastRun = runsJson.data?.items?.[0];
  if (!lastRun) {
    return NextResponse.json({ message: 'Aucun run Apify terminé trouvé' }, { status: 404 });
  }

  const datasetId = lastRun.defaultDatasetId;

  // Fetch all items from that dataset
  const itemsRes = await fetch(
    `${APIFY_BASE}/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=2000&format=json`,
  );
  if (!itemsRes.ok) {
    return NextResponse.json({ message: 'Impossible de récupérer le dataset Apify' }, { status: 500 });
  }

  const items = await itemsRes.json();
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ message: 'Dataset vide' }, { status: 404 });
  }

  // Deduplicate by username and score
  const seenUsernames = new Set<string>();
  const leads = items
    .map((item: any) => {
      const lead = normalizePost(item);
      if (!lead) return null;
      if (seenUsernames.has(lead.instagram_username)) return null;
      seenUsernames.add(lead.instagram_username);
      return lead;
    })
    .filter(Boolean);

  // Create bot_run record
  const { data: botRun } = await db
    .from('bot_runs')
    .insert({ runs_total: 1, runs_done: 0 })
    .select('id')
    .single();

  if (leads.length === 0) {
    await db.rpc('increment_bot_run', { p_id: botRun?.id, p_inserted: 0, p_updated: 0 });
    return NextResponse.json({
      items: items.length,
      unique_users: seenUsernames.size,
      qualified: 0,
      inserted: 0,
      updated: 0,
    });
  }

  const { data: result } = await db.rpc('upsert_instagram_leads', { p_leads: leads });
  const inserted = result?.inserted ?? 0;
  const updated  = result?.updated  ?? 0;

  await db.rpc('increment_bot_run', { p_id: botRun?.id, p_inserted: inserted, p_updated: updated });

  return NextResponse.json({
    items: items.length,
    unique_users: seenUsernames.size,
    qualified: leads.length,
    inserted,
    updated,
  });
}
