import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const APIFY_BASE = 'https://api.apify.com/v2';
const APIFY_TOKEN = process.env.APIFY_API_TOKEN!;

// ─── Scoring ──────────────────────────────────────────────────────────────────

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

// ─── Normalisation ────────────────────────────────────────────────────────────

function normalizeAndScore(raw: any) {
  const username = raw.username || raw.ownerUsername || raw.handle || '';
  if (!username) return null;

  const bio        = raw.biography || raw.bio || raw.description || '';
  const followers  = Number(raw.followersCount || raw.followers_count || 0);
  const externalUrl = raw.externalUrl || raw.external_url || raw.website || '';
  const latestPost  = raw.latestPostTimestamp || raw.timestamp || raw.lastPostDate || null;
  const fullName    = (raw.fullName || raw.full_name || raw.name || '').trim();

  const { score, score_details, email_bio } = scoreProfile(bio, followers, externalUrl, latestPost);
  if (score < 60) return null;

  const parts = fullName.split(' ');
  const first_name = parts[0] || username;
  const last_name  = parts.slice(1).join(' ') || 'Instagram';

  const notes = [
    `📸 @${username}`,
    `🔗 https://www.instagram.com/${username}/`,
    `👥 ${followers} abonnés`,
    bio ? `📝 ${bio.slice(0, 200)}` : null,
    email_bio ? `📧 ${email_bio}` : null,
    `⭐ Score : ${score}/100 (${score_details})`,
    `🗓️ Scraping : ${new Date().toISOString().slice(0, 10)}`,
  ].filter(Boolean).join('\n');

  return {
    first_name,
    last_name,
    email: email_bio || '',
    instagram_username: username,
    instagram_score: score,
    notes,
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const secret    = searchParams.get('secret');
  const botRunId  = searchParams.get('bot_run_id');

  if (!secret || secret !== process.env.BOT_WEBHOOK_SECRET) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }
  if (!botRunId) {
    return NextResponse.json({ message: 'Missing bot_run_id' }, { status: 400 });
  }

  const db = supabase as any;

  let body: any;
  try { body = await request.json(); } catch { body = {}; }

  const eventType = body.eventType as string || '';
  const datasetId = body.resource?.defaultDatasetId as string | undefined;

  // Failed / aborted run → just increment done counter
  if (!datasetId || !eventType.includes('SUCCEEDED')) {
    await db.rpc('increment_bot_run', { p_id: botRunId, p_inserted: 0, p_updated: 0 });
    return NextResponse.json({ ok: true });
  }

  // Fetch dataset
  let items: any[] = [];
  try {
    const res = await fetch(
      `${APIFY_BASE}/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=1000&format=json`
    );
    items = await res.json();
    if (!Array.isArray(items)) items = [];
  } catch {
    await db.rpc('increment_bot_run', { p_id: botRunId, p_inserted: 0, p_updated: 0 });
    return NextResponse.json({ ok: true });
  }

  // Normalize + score → qualified leads only
  const leads = items
    .map((item) => normalizeAndScore(item.ownerProfile || item.author || item))
    .filter(Boolean);

  if (leads.length === 0) {
    await db.rpc('increment_bot_run', { p_id: botRunId, p_inserted: 0, p_updated: 0 });
    return NextResponse.json({ ok: true });
  }

  // Upsert to leads table via DB function
  const { data: result } = await db.rpc('upsert_instagram_leads', { p_leads: leads });
  const inserted = result?.inserted ?? 0;
  const updated  = result?.updated  ?? 0;

  // Update bot_run counters (atomic)
  await db.rpc('increment_bot_run', { p_id: botRunId, p_inserted: inserted, p_updated: updated });

  return NextResponse.json({ ok: true, qualified: leads.length, inserted, updated });
}
