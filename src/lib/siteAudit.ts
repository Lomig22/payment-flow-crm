import Anthropic from '@anthropic-ai/sdk';

// Recommandations sur le site d'un prospect (variable {recommandations} des mails) : le CRM relève des
// constats vérifiables sur la page d'accueil, puis Claude en tire les 3 recommandations qui pèsent le
// plus sur les demandes de devis. Chaque recommandation cite un constat réel : rien d'inventé.

const MODEL = 'claude-sonnet-5-5';
const UA = 'Mozilla/5.0 (compatible; PaymentFlowAudit/1.0; +https://payment-flow-crm-delta.vercel.app)';

export interface SiteFacts {
  url: string; final_url: string | null; https: boolean; ok: boolean; status: number | null; error?: string;
  load_ms: number | null; html_kb: number | null; phone_in_top: boolean; devis_in_top: boolean; title: string; meta_description: string; mobile_viewport: boolean;
  h1: string[]; h2: string[]; phone_links: number; phones_in_text: number; email_links: number; forms: number;
  devis_cta: boolean; quote_form_fields: number; images: number; images_without_alt: number;
  mentions_avis: boolean; google_reviews_widget: boolean; city_in_title: boolean; copyright_year: number | null;
  nav_links: string[]; social: string[]; schema_local_business: boolean; text_excerpt: string;
}
export interface Reco { reco: string; constat: string }

const strip = (s: string) => s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&eacute;/g, 'é').replace(/\s+/g, ' ').trim();
const all = (html: string, re: RegExp) => Array.from(html.matchAll(re)).map((m) => strip(m[1])).filter(Boolean);

export async function collectFacts(url: string, city?: string | null): Promise<SiteFacts> {
  const facts: SiteFacts = {
    url, final_url: null, https: url.startsWith('https'), ok: false, status: null, load_ms: null, html_kb: null, phone_in_top: false, devis_in_top: false, title: '', meta_description: '',
    mobile_viewport: false, h1: [], h2: [], phone_links: 0, phones_in_text: 0, email_links: 0, forms: 0, devis_cta: false, quote_form_fields: 0,
    images: 0, images_without_alt: 0, mentions_avis: false, google_reviews_widget: false, city_in_title: false, copyright_year: null,
    nav_links: [], social: [], schema_local_business: false, text_excerpt: '',
  };
  const started = Date.now();
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    facts.status = r.status; facts.final_url = r.url; facts.https = r.url.startsWith('https');
    const html = await r.text();
    facts.load_ms = Date.now() - started; facts.html_kb = Math.round(html.length / 1024); facts.ok = r.ok;
    facts.title = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
    facts.meta_description = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? '').trim();
    facts.mobile_viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
    facts.h1 = all(html, /<h1[^>]*>([\s\S]*?)<\/h1>/gi).slice(0, 3);
    facts.h2 = all(html, /<h2[^>]*>([\s\S]*?)<\/h2>/gi).slice(0, 10);
    facts.phone_links = (html.match(/href=["']tel:/gi) ?? []).length;
    const text = strip(html);
    facts.phones_in_text = (text.match(/(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}/g) ?? []).length;
    facts.email_links = (html.match(/href=["']mailto:/gi) ?? []).length;
    facts.forms = (html.match(/<form\b/gi) ?? []).length;
    facts.quote_form_fields = (html.match(/<(input|textarea|select)\b/gi) ?? []).length;
    facts.devis_cta = /devis/i.test(all(html, /<(?:a|button)[^>]*>([\s\S]*?)<\/(?:a|button)>/gi).join(' '));
    const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
    facts.images = imgs.length;
    facts.images_without_alt = imgs.filter((t) => !/\balt=["'][^"']+["']/i.test(t)).length;
    facts.mentions_avis = /avis|témoignage|recommand|clients satisfaits|note/i.test(text);
    facts.google_reviews_widget = /google.{0,40}(avis|review)|elfsight|trustindex|reviews-widget|g-review/i.test(html);
    facts.city_in_title = !!city && facts.title.toLowerCase().includes(city.toLowerCase());
    const years = (text.match(/(?:©|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/i) ?? [])[1];
    facts.copyright_year = years ? Number(years) : null;
    facts.nav_links = Array.from(new Set(all((html.match(/<nav[\s\S]*?<\/nav>/gi) ?? []).join(' '), /<a[^>]*>([\s\S]*?)<\/a>/gi).filter((x) => x.length < 30))).slice(0, 12);
    if (!facts.nav_links.length) facts.nav_links = Array.from(new Set(all(html, /<a[^>]*>([\s\S]{2,30}?)<\/a>/gi))).slice(0, 15);
    facts.social = Array.from(new Set((html.match(/(facebook|instagram|linkedin|tiktok|youtube)\.com/gi) ?? []).map((x) => x.toLowerCase().split('.')[0])));
    facts.schema_local_business = /"@type"\s*:\s*"(LocalBusiness|HomeAndConstructionBusiness|GeneralContractor|Plumber|Electrician|RoofingContractor)"/i.test(html);
    facts.text_excerpt = text.slice(0, 2500);
    // Haut de page : les 600 premiers caractères visibles (en-tête et premier écran, à peu près)
    const top = text.slice(0, 600);
    facts.phone_in_top = /(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}/.test(top);
    facts.devis_in_top = /devis/i.test(top);
  } catch (e: any) {
    facts.error = String(e?.message ?? e).slice(0, 200);
    facts.load_ms = Date.now() - started;
  }
  return facts;
}

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['recommandations'],
  properties: {
    recommandations: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['reco', 'constat'],
        properties: {
          reco: { type: 'string', description: 'La recommandation, une phrase à l\'infinitif, 90 à 150 caractères' },
          constat: { type: 'string', description: 'Le fait observé sur le site qui la justifie (repris des données fournies)' },
        },
      },
    },
  },
};

const SYSTEM = `Tu es consultant en acquisition de clients pour les artisans du bâtiment (Payment Flow). On te donne les constats relevés automatiquement sur la page d'accueil du site d'un artisan. Écris les 3 recommandations qui augmenteraient le plus ses demandes de devis, de la plus importante à la moins importante.

Règles :
- phone_in_top / devis_in_top disent si un numéro / le mot « devis » apparaissent dans le premier écran du texte. Ne dis pas qu'un élément est absent du haut de page si ce champ ne le confirme pas.
- Chaque recommandation s'appuie sur un constat présent dans les données (champ « constat »). N'invente rien : si une donnée est absente ou incertaine, ne fais pas de recommandation dessus.
- Une phrase à l'infinitif, concrète, que l'artisan comprend sans jargon (pas de « SEO », « CTA », « UX », « conversion »), 90 à 150 caractères. Exemple : « Mettre un bouton « Appeler » bien visible en haut de page sur mobile : aujourd'hui, le numéro n'apparaît qu'en bas. »
- Priorité à ce qui fait appeler ou demander un devis : numéro cliquable, formulaire de devis simple, avis clients visibles, photos de chantiers, ville et métier dans le titre, page rapide sur mobile, délai de réponse annoncé, zones d'intervention claires.
- Écarte les détails techniques secondaires (textes alternatifs des images, balises, données structurées, réseaux sociaux absents) sauf s'il n'y a vraiment rien de plus important.
- Trois sujets différents (par exemple : être joint, demander un devis, rassurer), jamais deux recommandations sur le même point.
- Ton bienveillant : on aide, on ne critique pas. Pas de chiffre inventé, pas de promesse.`;

export async function siteRecommendations(lead: { website: string; company?: string | null; sector?: string | null; city?: string | null }): Promise<{ facts: SiteFacts; recos: Reco[] }> {
  const facts = await collectFacts(lead.website, lead.city);
  if (!facts.ok && facts.status == null) return { facts, recos: [] };   // site injoignable : pas de recommandation
  const { text_excerpt, ...rest } = facts;
  const response = await new Anthropic().messages.create({
    model: MODEL, max_tokens: 2000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA as any } },
    system: SYSTEM,
    messages: [{ role: 'user', content: `Artisan : ${lead.company ?? '?'} (${lead.sector ?? 'artisan'}, ${lead.city ?? 'ville inconnue'})\n\nConstats relevés sur ${facts.final_url ?? facts.url} :\n${JSON.stringify(rest, null, 1)}\n\nDébut du texte de la page :\n${text_excerpt}` }],
  } as any);
  const text = (response.content as any[]).find((b) => b.type === 'text')?.text ?? '{}';
  const recos: Reco[] = (JSON.parse(text).recommandations ?? []).slice(0, 3)
    .map((r: any) => ({ reco: String(r.reco ?? '').trim().slice(0, 200), constat: String(r.constat ?? '').trim().slice(0, 300) }))
    .filter((r: Reco) => r.reco);
  return { facts, recos };
}

// Mise en forme pour le mail : une ligne par recommandation
export const formatRecos = (recos: Reco[]) => recos.map((r) => `– ${r.reco}`).join('\n');
