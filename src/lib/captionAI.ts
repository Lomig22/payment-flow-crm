import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '@/lib/supabase';
import { fixEscapedEmoji } from '@/lib/utils';

// Rédaction automatique de la légende d'un reel : Claude regarde des images de
// la vidéo, identifie le chantier et le lieu qu'il évoque, et écrit une légende
// dans le style des reels qui performent déjà sur le compte.

const MODEL = 'claude-opus-5';

const SYSTEM = `Tu écris les légendes Instagram de @lomig_guegueniat, fondateur de Payment Flow, agence de marketing pour les artisans du bâtiment. Le compte publie des reels de chantiers impressionnants et de la vie d'artisan pour attirer des vues, des abonnés et des demandes d'audit.

Tu fournis deux éléments ; la légende est assemblée ensuite dans un format fixe (catchline, CTA « Commente DEVIS », hashtags) :
1. catchline : une seule ligne courte (60 caractères max) qui décrit ce qu'on voit de façon accrocheuse, suivie d'un émoji en rapport. Exemples du compte : « Construction massive d'un aéroport 🛩️ », « Installation d'une piscine 🏊‍♂️ », « Un maçon obtient ce chantier grâce à sa pub en ligne 🔥 », « Les priorités non-négociables 🤣 ».
   Ne cite un lieu (ville, région, monument) que s'il est clairement reconnaissable dans les images (panneau, monument connu) ; sinon, aucun lieu. La catchline doit rester vraie.
2. hashtags : 4 à 6, en minuscules, sans accents : toujours #btp et #chantier, puis ceux qui correspondent au sujet (#artisan #construction #architecture #maconnerie #piscine #paysagiste #charpente #renovation…).`;

// Même appel à l'action que la séquence de fin collée à chaque vidéo
// Émojis construits à l'exécution : le compilateur de Next.js (prod) réécrivait les
// échappements \u{…} d'une chaîne fusionnée dans un modèle de texte en « \\uD83D » littéral.
const CTA = `${String.fromCodePoint(0x1F4AC)} Commente « DEVIS » pour recevoir ma stratégie d'acquisition offerte, adaptée à ton activité ${String.fromCodePoint(0x1F680)}`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['catchline', 'hashtags', 'place_guess', 'subject'],
  properties: {
    catchline:   { type: 'string', description: 'Une ligne, émoji compris' },
    hashtags:    { type: 'array', items: { type: 'string' }, description: 'Hashtags avec le #' },
    place_guess: { type: ['string', 'null'], description: 'Lieu clairement reconnaissable, ou null' },
    subject:     { type: 'string', description: 'Ce que montre la vidéo, en une phrase' },
  },
} as const;

export interface CaptionResult {
  caption:     string;   // légende finale, hashtags inclus
  hashtags:    string[];
  place_guess: string | null;
  subject:     string;
}

// Légendes des reels les plus vus du compte : exemples de style
async function topCaptions(account: string): Promise<string[]> {
  const { data } = await (supabase as any)
    .from('ig_content')
    .select('caption, views')
    .eq('account_username', account)
    .eq('format', 'reel')
    .not('caption', 'is', null)
    .order('views', { ascending: false, nullsFirst: false })
    .limit(5);
  return (data ?? []).map((r: any) => `(${r.views ?? '?'} vues) ${r.caption}`);
}

// Rattrapage (cron) : reels de la file sans légende (moteur saturé à l'import, etc.)
export async function captionMissing(limit = 2): Promise<number> {
  const { data } = await (supabase as any).from('content_queue')
    .select('id').eq('format', 'reel').eq('status', 'draft').is('caption', null)
    .not('frame_paths', 'is', null).order('created_at', { ascending: true }).limit(limit);
  let done = 0;
  for (const r of data ?? []) {
    try { await captionQueueItem(r.id); done++; } catch { /* nouvel essai au prochain passage */ }
  }
  return done;
}

// Rédige et enregistre la légende d'un reel de la file (images déjà extraites)
export async function captionQueueItem(id: string, force = false): Promise<{ caption: string; skipped?: boolean }> {
  const db = supabase as any;
  const { data: row } = await db.from('content_queue')
    .select('id, account_username, format, status, caption, frame_paths').eq('id', id).single();
  if (!row) throw new Error('Contenu introuvable');
  if (row.format !== 'reel') throw new Error('Les stories n\'ont pas de légende');
  if (!['draft', 'scheduled', 'failed'].includes(row.status)) throw new Error('Ce contenu ne peut plus être modifié');
  if (!row.frame_paths?.length) throw new Error('Images de la vidéo indisponibles');
  if (row.caption && !force) return { caption: row.caption, skipped: true };

  const urls   = row.frame_paths.map((p: string) => supabase.storage.from('content-media').getPublicUrl(p).data.publicUrl);
  const result = await writeCaption(row.account_username, urls);
  await db.from('content_queue').update({
    caption:        result.caption,
    caption_ai:     { hashtags: result.hashtags, place_guess: result.place_guess, subject: result.subject },
    caption_source: 'ai',
    updated_at:     new Date().toISOString(),
  }).eq('id', row.id);
  return { caption: result.caption };
}

type RawCaption = { catchline: string; hashtags: string[]; place_guess: string | null; subject: string };

const userPrompt = (count: number, examples: string[]) =>
  `Voici ${count} images réparties sur la durée d'un reel à publier.`
  + (examples.length ? `\n\nLégendes des reels les plus vus du compte (à suivre pour le style) :\n${examples.join('\n---\n')}` : '')
  + '\n\nÉcris la légende de ce reel.';

// Moteur : Gemini (offre gratuite) si GEMINI_API_KEY est défini, sinon Claude
export async function writeCaption(account: string, frameUrls: string[]): Promise<CaptionResult> {
  const examples = await topCaptions(account);
  const out = process.env.GEMINI_API_KEY
    ? await captionWithGemini(frameUrls, examples)
    : await captionWithClaude(frameUrls, examples);

  const hashtags = Array.from(new Set(out.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`).replace(/\s+/g, '').toLowerCase())));
  return {
    caption:     fixEscapedEmoji(`${out.catchline.trim()}\n\n${CTA}\n\n${hashtags.join(' ')}`).slice(0, 2200),
    hashtags,
    place_guess: out.place_guess,
    subject:     out.subject,
  };
}

async function captionWithClaude(frameUrls: string[], examples: string[]): Promise<RawCaption> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Aucune clé IA (GEMINI_API_KEY ou ANTHROPIC_API_KEY)');
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model:      MODEL,
    max_tokens: 16000,
    betas:      ['server-side-fallback-2026-07-01'],
    fallbacks:  'default',
    thinking:   { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA as any } },
    system:     SYSTEM,
    messages: [{
      role: 'user',
      content: [
        ...frameUrls.map((url) => ({ type: 'image' as const, source: { type: 'url' as const, url } })),
        { type: 'text' as const, text: userPrompt(frameUrls.length, examples) },
      ],
    }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Claude a refusé de rédiger cette légende');
  const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')?.text;
  if (!text) throw new Error('Réponse vide de Claude');
  return JSON.parse(text);
}

const GEMINI_SCHEMA = {
  type: 'OBJECT',
  required: ['catchline', 'hashtags', 'subject'],
  properties: {
    catchline:   { type: 'STRING' },
    hashtags:    { type: 'ARRAY', items: { type: 'STRING' } },
    place_guess: { type: 'STRING', nullable: true },
    subject:     { type: 'STRING' },
  },
};

// Modèles essayés dans l'ordre : sur l'offre gratuite, les plus gros sont souvent
// saturés (« high demand ») ; on passe alors au suivant. GEMINI_MODEL force le premier.
const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest'];

async function captionWithGemini(frameUrls: string[], examples: string[]): Promise<RawCaption> {
  // Gemini prend les images en base64
  const images = await Promise.all(frameUrls.map(async (url) => {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Image inaccessible (${res.status})`);
    return { inline_data: { mime_type: 'image/jpeg', data: Buffer.from(await res.arrayBuffer()).toString('base64') } };
  }));
  const models = Array.from(new Set([process.env.GEMINI_MODEL, ...GEMINI_MODELS].filter(Boolean) as string[]));
  let lastError = '';
  for (const model of models) {
    try {
      return await geminiCall(model, images, userPrompt(frameUrls.length, examples));
    } catch (e: any) {
      lastError = e.message;
      if (!e.retryable) throw e;
    }
  }
  throw new Error(lastError);
}

async function geminiCall(model: string, images: unknown[], prompt: string): Promise<RawCaption> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY! },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [...images, { text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA, temperature: 0.8 },
    }),
    cache: 'no-store',
  });
  const body = await res.json();
  if (!res.ok) {
    // Saturé, quota du modèle atteint ou modèle retiré : on essaie le suivant
    const err: any = new Error(`Gemini (${model}) : ${body.error?.message ?? res.status}`);
    err.retryable = [429, 500, 503, 404].includes(res.status) || /no longer available|high demand/i.test(body.error?.message ?? '');
    throw err;
  }
  const text = body.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('');
  if (!text) throw new Error(`Gemini : réponse vide (${body.candidates?.[0]?.finishReason ?? body.promptFeedback?.blockReason ?? 'inconnu'})`);
  const out = JSON.parse(text);
  return { ...out, place_guess: out.place_guess ?? null };
}
