#!/usr/bin/env python3
"""Suivi des campagnes envoyées directement par Hermès (19/10/2026, 1re campagne « maquette »).

Lit le journal d'envoi d'Hermès (ses CSV : statut_envoi = envoye, message_id Gmail), puis la boîte
lomig.guegueniat@gmail.com par l'API Gmail (accès d'Hermès, ~/.hermes/google_token.json, lecture
seule ici) : réponse et rebond de chaque mail. Ouvertures : journal du pixel d'Hermès
(pixel_server.py, data/ouvertures.log), présent dans les mails partis en HTML (email_utils.send_html).
Remonte tout au CRM (/api/emailing/campaigns/sync, clé EMAILING_AGENT_KEY).
Installé sur le VPS : /opt/pf-cron/hermes_campaigns.py, cron toutes les 15 min.
Bibliothèque standard uniquement (le Python système n'a pas les bibliothèques Google d'Hermès).
"""
import csv, hashlib, html, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone
from email.utils import parseaddr

HERMES = '/root/.hermes'
FILES = ['data/emails_a_envoyer.csv', 'data/emails_video_a_envoyer.csv']
# Mails partis en HTML avec le pixel d'Hermès (send_video_daily.py) ; ceux de send_emails.py partent en texte brut
TRACKED = {'data/emails_video_a_envoyer.csv'}
OPENS = f'{HERMES}/data/ouvertures.log'      # une ligne JSON par ouverture : id = md5(email), ts, ip
OWN_IPS = {'187.55.224.186', '127.0.0.1'}    # tests du pixel depuis le VPS
# Gmail (proxy d'images Google) et les filtres Microsoft chargent le pixel 2 à 30 s après l'envoi, sans lecteur :
# une ouverture plus rapprochée de l'envoi n'est pas comptée
MIN_DELAY = 60
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


def norm(subject):
    return re.sub(r'^((re|tr|fw|fwd|aw|auto|réf)\s*:\s*)+', '', (subject or '').strip(), flags=re.I).strip().lower()


ANTISPAM = re.compile(r'mailinblack|xefi|antispam|altospam|vade|mailcontrol|spamenmoins|challenge', re.I)
ANTISPAM_SUBJECT = re.compile(r'en attente de lib[ée]ration|validez|confirm(ez|er) (votre|que)|authentifi|anti.?spam', re.I)
AUTO_SUBJECT = re.compile(r'^auto\s*:|r[ée]ponse automatique|automatic reply|auto.?reply|absen(ce|t)|out of office|accus[ée] de r[ée]ception', re.I)


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
            c = out.setdefault(cid, {'id': cid, 'name': f"{word.capitalize()} · {day[8:10]}/{day[5:7]}", 'source': f,
                                     'tracked': f in TRACKED, 'messages': []})
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


def opens():
    # md5(email) -> horodatages des ouvertures (le pixel identifie le destinataire, pas le mail)
    out = {}
    if not os.path.exists(OPENS):
        return out
    for line in open(OPENS, encoding='utf-8'):
        try:
            o = json.loads(line)
        except ValueError:
            continue
        if o.get('ip') not in OWN_IPS:
            out.setdefault(o['id'], []).append(int(o['ts']))
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
    msgs = [m for c in camps.values() for m in c['messages']]
    by_email = {m['email']: m for m in msgs}
    by_id = {m['gmail_id']: m for m in msgs}                         # fil d'un nouveau mail = identifiant de ce mail
    by_subject = {norm(m['subject']): m for m in msgs if m['subject']}   # anti-spam : « Re: <notre objet> » depuis l'adresse du filtre
    bounces = {}
    # Messages reçus depuis le premier envoi, spams compris : chacun est rattaché à un mail envoyé
    # (expéditeur, fil ou objet), puis classé : vraie réponse, réponse automatique ou anti-spam
    seen = state.setdefault('_msg', {})   # id -> [gmail_id du mail envoyé, type, date, extrait] ou rien (cache : quota Gmail partagé)
    for q, is_bounce in ((f'after:{after} -from:me -from:mailer-daemon -from:postmaster', False), (f'after:{after} (from:mailer-daemon OR from:postmaster)', True)):
        page = None
        while True:
            res = gmail(tok, 'messages', q=q, maxResults=500, includeSpamTrash=True, **({'pageToken': page} if page else {})) or {}
            for it in res.get('messages', []):
                if not is_bounce and it['id'] in seen:
                    continue
                m = gmail(tok, f"messages/{it['id']}", format='metadata', metadataHeaders=['From', 'X-Failed-Recipients', 'Auto-Submitted', 'X-Autoreply', 'X-Autorespond', 'Precedence', 'Subject'])
                if not m:
                    continue
                if is_bounce:
                    failed = header(m, 'X-Failed-Recipients').lower()
                    for e in re.findall(r'[\w.+-]+@[\w-]+\.[\w.-]+', failed or m.get('snippet', '').lower()):
                        bounces.setdefault(e, iso_ms(m['internalDate']))
                    continue
                sender, subject = parseaddr(header(m, 'From'))[1].lower(), header(m, 'Subject')
                target = by_email.get(sender) or by_id.get(it['threadId']) or by_subject.get(norm(subject))
                if not target:
                    seen[it['id']] = None
                    continue
                if ANTISPAM.search(sender) or ANTISPAM_SUBJECT.search(subject):
                    kind = 'antispam'
                elif header(m, 'Auto-Submitted').lower() not in ('', 'no') or header(m, 'X-Autoreply') or header(m, 'X-Autorespond') \
                        or header(m, 'Precedence').lower() in ('auto_reply', 'bulk', 'junk') or AUTO_SUBJECT.search(subject):
                    kind = 'auto'
                else:
                    kind = 'human'
                seen[it['id']] = [target['gmail_id'], kind, iso_ms(m['internalDate']), html.unescape(m.get('snippet', ''))]
            page = res.get('nextPageToken')
            if not page:
                break
    # Par mail envoyé : la vraie réponse l'emporte sur l'anti-spam, qui l'emporte sur la réponse automatique
    RANK = {'human': 3, 'antispam': 2, 'auto': 1}
    best = {}
    for mid, v in seen.items():
        if v and v[0] in by_id and RANK[v[1]] > RANK.get(best.get(v[0], [None, None])[1], 0):
            best[v[0]] = [mid] + v[1:]
    pixel = opens()
    for c in camps.values():
        for m in c['messages']:
            m['thread_id'] = m['gmail_id']
            if c['tracked'] and m['sent_at']:
                # Ouvertures postérieures à l'envoi (le même destinataire a pu recevoir d'autres mails d'Hermès avant)
                sent = datetime.fromisoformat(m['sent_at']).timestamp()
                seen_at = sorted(t for t in pixel.get(hashlib.md5(m['email'].encode()).hexdigest(), []) if t >= sent + MIN_DELAY)
                m['open_count'] = len(seen_at)
                m['opened_at'] = datetime.fromtimestamp(seen_at[0], timezone.utc).isoformat() if seen_at else None
            if m['gmail_id'] in best:
                mid, kind, at, snip = best[m['gmail_id']]
                m.update(replied_at=at, reply_snippet=snip, reply_kind=kind, reply_gmail_id=mid)
            if m['email'] in bounces:
                m['bounced_at'] = bounces[m['email']]
        sent = [m['sent_at'] for m in c['messages'] if m['sent_at']]
        body = {'campaign': {'id': c['id'], 'name': c['name'], 'source': c['source'], 'first_sent_at': min(sent) if sent else None,
                             'open_tracking': c['tracked']}, 'messages': c['messages']}
        if DRY:
            print(f"{c['id']} : {len(c['messages'])} envoyés, {sum(1 for m in c['messages'] if m.get('opened_at'))} ouverts,{sum(1 for m in c['messages'] if m.get('reply_kind') == 'human')} réponses, {sum(1 for m in c['messages'] if m.get('reply_kind') == 'auto')} auto, {sum(1 for m in c['messages'] if m.get('reply_kind') == 'antispam')} anti-spam, {sum(1 for m in c['messages'] if m.get('bounced_at'))} rebonds (essai, rien envoyé au CRM)")
            continue
        req = urllib.request.Request(f'{CRM}/api/emailing/campaigns/sync', json.dumps(body).encode(),
                                     headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
        r = json.load(urllib.request.urlopen(req, timeout=60))
        replied = sum(1 for m in c['messages'] if m.get('reply_kind') == 'human')
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
