import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

const APIFY_BASE = 'https://api.apify.com/v2';

function encodeWebhooks(requestUrl: string) {
  const hooks = [{
    eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.ABORTED', 'ACTOR.RUN.TIMED_OUT'],
    requestUrl,
  }];
  return Buffer.from(JSON.stringify(hooks)).toString('base64');
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const APIFY_TOKEN    = process.env.APIFY_API_TOKEN;
  const WEBHOOK_SECRET = process.env.BOT_WEBHOOK_SECRET;
  const APP_URL        = process.env.APP_URL || 'https://payment-flow-crm-delta.vercel.app';

  if (!APIFY_TOKEN)    return NextResponse.json({ message: 'APIFY_API_TOKEN manquant' }, { status: 500 });
  if (!WEBHOOK_SECRET) return NextResponse.json({ message: 'BOT_WEBHOOK_SECRET manquant' }, { status: 500 });

  const db = supabase as any;

  // Block if already running
  const { data: existing } = await db
    .from('bot_runs').select('id').eq('status', 'running').limit(1).maybeSingle();
  if (existing) {
    return NextResponse.json({ message: 'Un scraping est déjà en cours.' }, { status: 409 });
  }

  // Find the most recent succeeded hashtag scraper run
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

  // Fetch all post items from that dataset
  const itemsRes = await fetch(
    `${APIFY_BASE}/datasets/${lastRun.defaultDatasetId}/items?token=${APIFY_TOKEN}&limit=2000&format=json`,
  );
  if (!itemsRes.ok) {
    return NextResponse.json({ message: 'Impossible de récupérer le dataset Apify' }, { status: 500 });
  }

  const items = await itemsRes.json();
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ message: 'Dataset vide' }, { status: 404 });
  }

  // Extract unique ownerUsernames from the posts
  const usernames = Array.from(new Set(
    items
      .map((item: any) => item.ownerProfile?.username || item.ownerUsername || item.username || '')
      .filter(Boolean),
  )) as string[];

  if (usernames.length === 0) {
    return NextResponse.json({ message: 'Aucun username trouvé dans le dataset' }, { status: 404 });
  }

  // Create bot_run record (1 run = profile scraper)
  const { data: botRun, error: insertError } = await db
    .from('bot_runs').insert({ runs_total: 1 }).select('id').single();
  if (insertError) {
    return NextResponse.json({ message: `Supabase : ${insertError.message}` }, { status: 500 });
  }

  // Launch profile scraper with those usernames
  const profileWebhookUrl = `${APP_URL}/api/bot/instagram/webhook?bot_run_id=${botRun.id}&secret=${WEBHOOK_SECRET}&task=profiles`;
  const webhooksParam = encodeURIComponent(encodeWebhooks(profileWebhookUrl));

  try {
    const res = await fetch(
      `${APIFY_BASE}/acts/apify~instagram-profile-scraper/runs?token=${APIFY_TOKEN}&webhooks=${webhooksParam}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames }),
      },
    );
    const json = await res.json();
    if (!res.ok) {
      const msg = json.error?.message || `HTTP ${res.status}`;
      await db.from('bot_runs').update({
        status: 'error', error_message: msg, finished_at: new Date().toISOString(), runs_done: 1,
      }).eq('id', botRun.id);
      return NextResponse.json({ message: `Apify : ${msg}` }, { status: 500 });
    }
  } catch (err: any) {
    await db.from('bot_runs').update({
      status: 'error', error_message: err.message, finished_at: new Date().toISOString(), runs_done: 1,
    }).eq('id', botRun.id);
    return NextResponse.json({ message: err.message }, { status: 500 });
  }

  return NextResponse.json({
    message: 'Profile scraper lancé en arrière-plan',
    posts: items.length,
    usernames: usernames.length,
    bot_run_id: botRun.id,
  });
}
