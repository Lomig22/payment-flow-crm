#!/usr/bin/env python3
"""Suivi des campagnes envoyées directement par Hermès (19/10/2026, 1re campagne « maquette »).

Lit le journal d'envoi d'Hermès (ses CSV : statut_envoi = envoye, message_id Gmail), puis la boîte
lomig.guegueniat@gmail.com par l'API Gmail (accès d'Hermès, ~/.hermes/google_token.json, lecture
seule ici) : réponse et rebond de chaque mail. Remonte tout au CRM (/api/emailing/campaigns/sync,
clé EMAILING_AGENT_KEY). Installé sur le VPS : /opt/pf-cron/hermes_campaigns.py, cron toutes les 15 min.
Bibliothèque standard uniquement (le Python système n'a pas les bibliothèques Google d'Hermès).
"""
import csv, html, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone
from email.utils import parseaddr

HERMES = '/root/.hermes'
FILES = ['data/emails_a_envoyer.csv', 'data/emails_video_a_envoyer.csv']
TOKEN = f'{HERMES}/google_token.json'
KEY = open(f'{HERMES}/secrets/pf_crm_emailing.key').read().strip()
CRM = os.environ.get('CRM_URL', 'https://payment-flow-crm-delta.vercel.app')
STATE = '/var/lib/pf-hermes-campaigns.json'   # messages de la boîte déjà lus (évite de les redemander)
ME = 'lomig.guegueniat@gmail.com'
GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'
csv.field_size_limit(10_000_000)
DRY = '--dry' in sys.argv   # essai : lit Gmail, n'envoie rien au CRM


def access_token():
    t = json.load(open(TOKEN))
    data = urllib.parse.urlencode({'grant_type': 'refresh_token', 'refresh_token': t['refresh_token'],
                                   'client_id': t['client_id'], 'client_secret': t['client_secret']}).encode()
    r = json.load(urllib.request.urlopen(t.get('token_uri', 'https://oauth2.googleapis.com/token'), data, timeout=30))
    return r['access_token']


def gmail(tok, path, **params):
    q = urllib.parse.urlencode(params, doseq=True)
    req = urllib.request.Request(f'{GMAIL}/{path}?{q}', headers={'Authorization': f'Bearer {tok}'})
    for attempt in range(3):
        try:
            time.sleep(0.25)
            return json.load(urllib.request.urlopen(req, timeout=30))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code in (403, 429, 500, 503) and attempt < 2:
                time.sleep(65)   # quota Gmail par minute (partagé avec Hermès) : on attend la minute suivante
                continue
            raise


def header(msg, name):
    for h in msg.get('payload', {}).get('headers', []):
        if h['name'].lower() == name.lower():
            return h['value']
    return ''


def iso_ms(ms):
    return datetime.fromtimestamp(int(ms) / 1000, timezone.utc).isoformat()


def iso_local(s):
    # date_envoi d'Hermès : heure du VPS (UTC)
    try:
        return datetime.strptime(s, '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc).isoformat()
    except Exception:
        return None


def campaigns():
    out = {}
    for f in FILES:
        path = f'{HERMES}/{f}'
        if not os.path.exists(path):
            continue
        stem = os.path.splitext(os.path.basename(f))[0]
        for r in csv.DictReader(open(path, encoding='utf-8')):
            # Envoyé : un identifiant Gmail, quel que soit le statut (Hermès passe la ligne en « a_repondu » quand on lui répond)
            if not r.get('message_id') or (r.get('statut_envoi') or '').upper() == 'ERREUR':
                continue
            day = (r.get('date_envoi') or '')[:10]
            word = re.sub(r'\W+', '', (r.get('objet') or 'mail').split(' ')[0].lower()) or 'mail'
            cid = f'hermes-{stem}-{word}-{day}'
            c = out.setdefault(cid, {'id': cid, 'name': f"{word.capitalize()} · {day[8:10]}/{day[5:7]}", 'source': f, 'messages': []})
            c['messages'].append({'gmail_id': r['message_id'], 'email': r['email'].strip().lower(), 'company': r.get('entreprise'),
                                  'subject': r.get('objet'), 'sent_at': iso_local(r.get('date_envoi', ''))})
    # Nom lisible : début d'objet commun à tous les mails de la campagne (« Votre vidéo … », « maquette »)
    for c in out.values():
        subj = [(m['subject'] or '').split() for m in c['messages']]
        common = []
        for words in zip(*subj):
            if len(set(w.lower() for w in words)) > 1:
                break
            common.append(words[0])
        day = c['id'][-10:]
        c['name'] = f"{' '.join(common[:6]) or c['name'].split(' · ')[0]} · {day[8:10]}/{day[5:7]}"
    return out


def main():
    state = json.load(open(STATE)) if os.path.exists(STATE) else {}
    camps = campaigns()
    if not camps:
        print('aucune campagne')
        return
    tok = access_token()
    # Réponses et rebonds reçus depuis le premier envoi (y compris hors du fil d'origine)
    start = min(m['sent_at'] for c in camps.values() for m in c['messages'] if m['sent_at'])
    after = int(datetime.fromisoformat(start).timestamp())
    by_email = {m['email']: m for c in camps.values() for m in c['messages']}
    inbox_replies, bounces = {}, {}
    seen = state.setdefault('_inbox', {})   # messages de la boîte déjà lus : id -> [expéditeur, date, extrait] ou rien
    for q, sink in ((f'in:inbox after:{after} -from:me -from:mailer-daemon -from:postmaster', inbox_replies), (f'after:{after} (from:mailer-daemon OR from:postmaster)', bounces)):
        page = None
        while True:
            res = gmail(tok, 'messages', q=q, maxResults=500, **({'pageToken': page} if page else {})) or {}
            for it in res.get('messages', []):
                if sink is inbox_replies and it['id'] in seen:
                    if seen[it['id']] and seen[it['id']][0] in by_email:
                        sink.setdefault(seen[it['id']][0], tuple(seen[it['id']][1:]))
                    continue
                m = gmail(tok, f"messages/{it['id']}", format='metadata', metadataHeaders=['From', 'X-Failed-Recipients', 'Auto-Submitted', 'X-Autoreply', 'X-Autorespond', 'Precedence', 'Subject'])
                if not m:
                    continue
                if sink is bounces:
                    failed = header(m, 'X-Failed-Recipients').lower()
                    for e in re.findall(r'[\w.+-]+@[\w-]+\.[\w.-]+', failed or m.get('snippet', '').lower()):
                        bounces.setdefault(e, iso_ms(m['internalDate']))
                else:
                    sender = parseaddr(header(m, 'From'))[1].lower()
                    # Réponses automatiques (absence, changement d'adresse, accusé de réception) : pas des réponses
                    auto = header(m, 'Auto-Submitted').lower() not in ('', 'no') or header(m, 'X-Autoreply') or header(m, 'X-Autorespond') \
                        or header(m, 'Precedence').lower() in ('auto_reply', 'bulk', 'junk') \
                        or re.search(r'r[ée]ponse automatique|automatic reply|auto.?reply|absence|out of office', header(m, 'Subject'), re.I)
                    seen[it['id']] = [sender, iso_ms(m['internalDate']), html.unescape(m.get('snippet', ''))] if sender in by_email and not auto else None
                    if auto:
                        continue
                    if sender in by_email and sender not in sink:
                        sink[sender] = (iso_ms(m['internalDate']), html.unescape(m.get('snippet', '')))
            page = res.get('nextPageToken')
            if not page:
                break
    # Réponses (dans le fil ou non) : messages de la boîte venant d'un destinataire ; le fil d'un
    # nouveau mail porte l'identifiant de ce mail (pas d'appel par mail envoyé : quota Gmail partagé)
    for c in camps.values():
        for m in c['messages']:
            m['thread_id'] = m['gmail_id']
            if m['email'] in inbox_replies:
                m['replied_at'], m['reply_snippet'] = inbox_replies[m['email']]
            if m['email'] in bounces:
                m['bounced_at'] = bounces[m['email']]
        sent = [m['sent_at'] for m in c['messages'] if m['sent_at']]
        body = {'campaign': {'id': c['id'], 'name': c['name'], 'source': c['source'], 'first_sent_at': min(sent) if sent else None,
                             'open_tracking': False}, 'messages': c['messages']}
        if DRY:
            print(f"{c['id']} : {len(c['messages'])} envoyés, {sum(1 for m in c['messages'] if m.get('replied_at'))} réponses, {sum(1 for m in c['messages'] if m.get('bounced_at'))} rebonds (essai, rien envoyé au CRM)")
            continue
        req = urllib.request.Request(f'{CRM}/api/emailing/campaigns/sync', json.dumps(body).encode(),
                                     headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
        r = json.load(urllib.request.urlopen(req, timeout=60))
        replied = sum(1 for m in c['messages'] if m.get('replied_at'))
        bounced = sum(1 for m in c['messages'] if m.get('bounced_at'))
        print(f"{c['id']} : {len(c['messages'])} envoyés, {replied} réponses, {bounced} rebonds -> {r}")
    if not DRY:
        json.dump(state, open(STATE, 'w'))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print('échec', repr(e)[:300], file=sys.stderr)
        sys.exit(1)
