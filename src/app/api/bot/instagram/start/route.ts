import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

const APIFY_TOKEN  = process.env.APIFY_API_TOKEN!;
const WEBHOOK_SECRET = process.env.BOT_WEBHOOK_SECRET!;
const APP_URL      = process.env.APP_URL || 'https://payment-flow-crm-delta.vercel.app';
const APIFY_BASE   = 'https://api.apify.com/v2';

const HASHTAG_ACTOR   = 'apify~instagram-hashtag-scraper';
const FOLLOWERS_ACTOR = 'apify~instagram-followers-scraper';

const HASHTAGS = [
  'electricien', 'plombier', 'plomberie', 'carreleur', 'carrelage',
  'peintre', 'peinturedecoration', 'macon', 'maconnerie', 'couvreur',
  'menuisier', 'menuiserie', 'charpentier', 'charpente',
  'artisanfrancais', 'artisanbtp', 'btpfrance', 'renovationmaison',
  'renovation', 'travauxtpe', 'autoentrepreneur', 'isolation', 'platrier', 'zingueur',
];

const TARGET_ACCOUNTS = [
  'point_p_materiauxconstruction', 'leroymerlin_france', 'bricodepot_fr',
  'rexel_france', 'groupesamse', 'kiloutou_officiel', 'loxam_france', 'cedeo_france',
];

function buildWebhookUrl(botRunId: string, task: string, account?: string) {
  const p = new URLSearchParams({ bot_run_id: botRunId, secret: WEBHOOK_SECRET, task });
  if (account) p.set('account', account);
  return `${APP_URL}/api/bot/instagram/webhook?${p}`;
}

function encodeWebhooks(requestUrl: string) {
  const hooks = [{
    eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.ABORTED', 'ACTOR.RUN.TIMED-OUT'],
    requestUrl,
  }];
  return Buffer.from(JSON.stringify(hooks)).toString('base64');
}

async function startApifyRun(actorId: string, input: object, webhookUrl: string): Promise<string> {
  const res = await fetch(
    `${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/runs?token=${APIFY_TOKEN}&webhooks=${encodeURIComponent(encodeWebhooks(webhookUrl))}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `HTTP ${res.status}`);
  return json.data.id as string;
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const db = supabase as any;

  // Block if already running
  const { data: existing } = await db
    .from('bot_runs').select('id').eq('status', 'running').limit(1).maybeSingle();
  if (existing) {
    return NextResponse.json({ message: 'Un scraping est déjà en cours.' }, { status: 409 });
  }

  // Create tracking record (runs_total = 0, updated after starts succeed)
  const { data: botRun, error: insertError } = await db
    .from('bot_runs').insert({ runs_total: 0 }).select('id').single();
  if (insertError) return NextResponse.json({ message: insertError.message }, { status: 500 });

  const botRunId: string = botRun.id;

  // Launch all Apify runs in parallel
  const tasks: Promise<string>[] = [
    startApifyRun(
      HASHTAG_ACTOR,
      { hashtags: HASHTAGS, resultsLimit: 200, searchType: 'hashtag', searchLimit: 200 },
      buildWebhookUrl(botRunId, 'hashtags'),
    ),
    ...TARGET_ACCOUNTS.map((account) =>
      startApifyRun(
        FOLLOWERS_ACTOR,
        { username: [account], usernames: [account], resultsLimit: 500, resultsType: 'followers' },
        buildWebhookUrl(botRunId, 'followers', account),
      )
    ),
  ];

  const results = await Promise.allSettled(tasks);
  const started = results.filter((r) => r.status === 'fulfilled').length;

  if (started === 0) {
    await db.from('bot_runs').update({ status: 'error', error_message: 'Aucun run Apify n\'a démarré' }).eq('id', botRunId);
    return NextResponse.json({ message: 'Impossible de démarrer Apify.' }, { status: 500 });
  }

  await db.from('bot_runs').update({ runs_total: started }).eq('id', botRunId);

  return NextResponse.json({ bot_run_id: botRunId, runs_started: started });
}
