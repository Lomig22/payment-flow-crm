import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { miniMarkdown } from '@/lib/miniMarkdown';

// Ressource gratuite d'un post LinkedIn de Lomig (« Commente MOT et je t'envoie… ») : page publique,
// lien envoyé en message privé aux personnes qui commentent. Accessible dès que le post est publié
// (ou programmé, pour que Lomig puisse la relire avant).
export const dynamic = 'force-dynamic';

async function load(slug: string) {
  const { data } = await (supabase as any).from('linkedin_posts').select('resource_title, resource_body, status')
    .eq('resource_slug', slug).neq('status', 'cancelled').maybeSingle();
  return data?.resource_body ? data : null;
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const r = await load(params.slug);
  return { title: r ? `${r.resource_title} — Lomig · Payment Flow` : 'Ressource — Payment Flow', robots: { index: false } };
}

export default async function ResourcePage({ params }: { params: { slug: string } }) {
  const r = await load(params.slug);
  if (!r) notFound();
  return (
    <main className="min-h-screen bg-[#f5f7ff]">
      <div className="bg-[#060a1e] text-white">
        <div className="max-w-2xl mx-auto px-5 py-6 flex items-center gap-3">
          <img src="/pf-logo.png" alt="Payment Flow" className="w-10 h-10" />
          <div>
            <p className="text-xs uppercase tracking-widest text-[#a9c4ff]">Ressource offerte par Lomig · Payment Flow</p>
            <h1 className="text-xl sm:text-2xl font-bold leading-tight mt-1">{r.resource_title}</h1>
          </div>
        </div>
      </div>
      <article className="pf-resource max-w-2xl mx-auto px-5 py-8 bg-white sm:my-8 sm:rounded-2xl sm:shadow-sm text-gray-800 leading-relaxed"
        dangerouslySetInnerHTML={{ __html: miniMarkdown(r.resource_body) }} />
      <p className="max-w-2xl mx-auto px-5 pb-10 text-xs text-gray-500">Une question ? Réponds simplement au message LinkedIn de Lomig.</p>
      <style>{`
        .pf-resource h2{font-size:1.35rem;font-weight:700;color:#0f1736;margin:1.6rem 0 .6rem}
        .pf-resource h3{font-size:1.15rem;font-weight:700;color:#0f1736;margin:1.3rem 0 .5rem}
        .pf-resource h4{font-weight:700;margin:1rem 0 .4rem}
        .pf-resource p{margin:.7rem 0}
        .pf-resource ul,.pf-resource ol{margin:.6rem 0 .6rem 1.3rem}
        .pf-resource ul{list-style:disc}.pf-resource ol{list-style:decimal}
        .pf-resource ul.check{list-style:none;margin-left:0}
        .pf-resource li{margin:.35rem 0}
        .pf-resource strong{color:#0f1736}
        .pf-resource blockquote{border-left:4px solid #5186fd;background:#f0f4ff;padding:.6rem .9rem;margin:1rem 0;border-radius:.4rem}
        .pf-resource hr{margin:1.5rem 0;border-color:#e3e8f7}
      `}</style>
    </main>
  );
}
