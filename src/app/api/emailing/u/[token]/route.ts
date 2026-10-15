import { NextRequest, NextResponse } from 'next/server';
import { readToken } from '@/lib/emailTracking';
import { recordEvents } from '@/lib/emailing';

// Lien de désinscription des mails (public). GET : page de confirmation avec un bouton (les antivirus
// de messagerie ouvrent les liens tout seuls : un GET ne doit rien changer). POST : désinscription
// (bouton de la page, ou désabonnement en un clic des messageries, RFC 8058).
export const dynamic = 'force-dynamic';

const page = (body: string) => new NextResponse(
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Désinscription</title></head>
<body style="font-family:system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 20px;color:#1f2937;font-size:18px">${body}</body></html>`,
  { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  if (!readToken(params.token)) return page('<p>Lien de désinscription invalide.</p>');
  return page(`<p>Vous ne souhaitez plus recevoir nos messages ?</p>
<form method="post"><button type="submit" style="font-size:16px;padding:10px 18px;border-radius:8px;border:0;background:#1f2937;color:#fff;cursor:pointer">Me désinscrire</button></form>`);
}

export async function POST(_request: NextRequest, { params }: { params: { token: string } }) {
  const t = readToken(params.token);
  if (!t) return page('<p>Lien de désinscription invalide.</p>');
  const r = await recordEvents([{ lead_id: t.leadId, type: 'unsubscribed', step: t.step }]);
  return page(r.ok ? '<p>C\'est noté : vous ne recevrez plus de message de notre part.</p>' : '<p>Désinscription impossible pour le moment : répondez simplement STOP au mail.</p>');
}
