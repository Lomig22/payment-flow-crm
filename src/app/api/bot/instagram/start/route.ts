import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

const APIFY_BASE = 'https://api.apify.com/v2';

// Hashtags utilisés quasi exclusivement par les professionnels BTP (pas les particuliers)
const HASHTAGS = [
  'artisanbtp', 'artisanfrancais', 'btpfrance', 'electricienagréé',
  'plombierqualifié', 'couvreurprofessionnel', 'maconprofessionnel',
  'menuisierprofessionnel', 'peintreprofessionnel', 'carreleurprofessionnel',
  'autoentrepreneurbt', 'travauxtpe', 'devisartisan', 'artisanqualibat',
];

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

  const APIFY_TOKEN     = process.env.APIFY_API_TOKEN;
  const WEBHOOK_SECRET  = process.env.BOT_WEBHOOK_SECRET;
  const APP_URL         = process.env.APP_URL || 'https://payment-flow-crm-delta.vercel.app';

  if (!APIFY_TOKEN) {
    return NextResponse.json({ message: 'Variable APIFY_API_TOKEN manquante sur Vercel.' }, { status: 500 });
  }
  if (!WEBHOOK_SECRET) {
    return NextResponse.json({ message: 'Variable BOT_WEBHOOK_SECRET manquante sur Vercel.' }, { status: 500 });
  }

  const db = supabase as any;

  // Block if already running
  const { data: existing } = await db
    .from('bot_runs').select('id').eq('status', 'running').limit(1).maybeSingle();
  if (existing) {
    return NextResponse.json({ message: 'Un scraping est déjà en cours.' }, { status: 409 });
  }

  // Create tracking record (2 runs: hashtags → profiles)
  const { data: botRun, error: insertError } = await db
    .from('bot_runs').insert({ runs_total: 2 }).select('id').single();
  if (insertError) {
    return NextResponse.json({ message: `Supabase : ${insertError.message}` }, { status: 500 });
  }

  const botRunId: string = botRun.id;

  // Build webhook URL
  const webhookUrl = `${APP_URL}/api/bot/instagram/webhook?bot_run_id=${botRunId}&secret=${WEBHOOK_SECRET}&task=hashtags`;
  const webhooksParam = encodeURIComponent(encodeWebhooks(webhookUrl));

  // Launch hashtag run
  let apifyError = '';
  try {
    const res = await fetch(
      `${APIFY_BASE}/acts/apify~instagram-hashtag-scraper/runs?token=${APIFY_TOKEN}&webhooks=${webhooksParam}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hashtags: HASHTAGS, resultsLimit: 50 }),
      }
    );
    const json = await res.json();
    if (!res.ok) {
      apifyError = json.error?.message || `HTTP ${res.status}`;
      throw new Error(apifyError);
    }
  } catch (err: any) {
    await db.from('bot_runs').update({
      status: 'error',
      error_message: err.message,
      runs_total: 1,
      runs_done: 1,
      finished_at: new Date().toISOString(),
    }).eq('id', botRunId);
    return NextResponse.json({ message: `Apify : ${err.message}` }, { status: 500 });
  }

  return NextResponse.json({ bot_run_id: botRunId, runs_started: 1 });
}
