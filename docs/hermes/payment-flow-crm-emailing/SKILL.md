---
name: payment-flow-crm-emailing
description: Envoyer la prospection email de Payment Flow à partir du CRM. À utiliser pour chaque session d'envoi : récupérer les mails à envoyer auprès du CRM, les rédiger, les envoyer depuis les boîtes préchauffées, puis rapporter chaque événement (envoi, réponse, rebond, désinscription) au CRM.
---

# Prospection email Payment Flow, pilotée par le CRM

Le CRM Payment Flow est la source de vérité. Il décide **qui** contacter et **quand** (séquence, arrêt à la première réponse, adresses invalides, désinscriptions, « ne pas contacter » commun à tous les canaux). Toi, tu **rédiges**, tu **envoies** depuis les boîtes préchauffées et tu **rapportes** tout au CRM. N'envoie jamais un mail à une adresse que le CRM ne t'a pas remise.

## Connexion

Utilise l'outil `python3 /root/.hermes/scripts/pf_crm.py` : il lit la clé dans `/root/.hermes/secrets/pf_crm_emailing.key` (ne l'affiche jamais, ne la recopie nulle part).

- `pf_crm.py next 50` : mails à envoyer
- `pf_crm.py event '{"events": [...]}'` : rapporter des événements
- `pf_crm.py release <lead_id> …` : rendre des leads non envoyés
- `pf_crm.py stats` : indicateurs (envois du jour, taux d'ouverture et de réponse sur 7 et 30 jours), à donner à Lomig quand il demande où en est l'emailing

(API sous-jacente : `https://payment-flow-crm-delta.vercel.app/api/emailing/agent/{next,events,release,stats}`, en-tête `Authorization: Bearer <clé>`.)

## Cycle d'envoi (à répéter toute la journée)

1. **Récupérer les mails à envoyer** : `GET /next?limit=50`

   ```json
   {
     "tasks": [{
       "lead_id": "uuid", "step": 1, "email": "contact@exemple.fr",
       "mailbox": null, "thread_id": null,
       "lead": { "first_name": "Julien", "company": "Menuiserie R.", "sector": "Menuisier", "city": "Rennes" },
       "template": { "subject": "…", "body": "…" },
       "previous": []
     }],
     "sent_today": 120, "goal": 1000,
     "instructions": "consignes de rédaction de Lomig",
     "reason": "présent seulement quand il n'y a rien à envoyer (pause, hors horaires, objectif atteint)"
   }
   ```

   - `step` : 1 = premier mail, 2 et 3 = relances. Pour une relance, `previous` contient les mails déjà envoyés à ce lead. Réponds **dans le même fil** (`thread_id`) et **depuis la même boîte** (`mailbox`).
   - `segment` : `site` (le prospect a un site internet) ou `no_site` (il n'en a pas). Lomig a écrit un parcours différent pour chacun : le `template` reçu est déjà celui du bon segment, ne le mélange jamais avec l'autre.
   - `rendered` : **le mail de Lomig déjà personnalisé par le CRM** (objet et corps, variables remplacées). Envoie-le tel quel, sans le réécrire ni le compléter. `template` est la version brute avec ses variables `{entreprise}`, `{ville}`… et `variables` les valeurs de ce lead (pour info ou si tu dois rédiger toi-même quand `rendered` est nul). Respecte le modèle mot pour mot. Une relance dont l'objet est vide part **en réponse dans le même fil** que le mail 1 (objet « Re: <objet du mail 1> », en-têtes In-Reply-To / References avec le `thread_id`). Remplace les variables `{{first_name}}`, `{{company}}`, `{{city}}`, `{{sector}}`… avec `lead`. Si `template` est `null`, rédige toi-même en suivant `instructions`.
   - Chaque lead remis est réservé 6 h pour toi. Si `tasks` est vide, lis `reason` et attends (15 min) avant de redemander.
   - `tracking` : **à mettre dans chaque mail, relances comprises** (le jeton change à chaque mail : c'est ce qui donne le taux d'ouverture par mail). `pixel_html` juste avant `</body>` de la version HTML (c'est lui qui mesure le taux d'ouverture dans le CRM), et `unsubscribe_url` comme lien de désinscription en pied de mail ainsi que dans l'en-tête `List-Unsubscribe: <unsubscribe_url>` avec `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Le CRM enregistre lui-même ouvertures et désinscriptions : tu n'as pas à les rapporter.

2. **Envoyer** chaque mail depuis une boîte préchauffée. Respecte tes plafonds par boîte et l'espacement entre les envois : la délivrabilité passe avant l'objectif du jour.

3. **Rapporter l'envoi tout de suite** : `POST /events`

   ```json
   { "events": [{ "lead_id": "uuid", "type": "sent", "step": 1, "subject": "…", "body": "…",
                  "mailbox": "lomig@domaine-envoi.fr", "message_id": "<id@domaine>", "thread_id": "<id@domaine>",
                  "occurred_at": "2026-10-15T09:12:00+02:00" }] }
   ```

   Sans ce rapport, le CRM ne programme pas la relance et compte le lead comme non envoyé.

4. **En cas d'échec d'envoi** (boîte saturée, erreur SMTP temporaire) : rends les leads au CRM avec `POST /release` `{ "lead_ids": ["uuid", …] }`.

## Événements à rapporter (même route `POST /events`)

| type | quand | effet dans le CRM |
|---|---|---|
| `sent` | mail envoyé | relance suivante programmée |
| `opened`, `clicked` | déjà mesurés par le pixel du CRM ; ne rapporte que les clics si tu les suis | statistiques seulement |
| `replied` | **toute** réponse humaine | séquence arrêtée, lead à traiter par Lomig |
| `interested` | la réponse montre de l'intérêt (rendez-vous, prix, « oui ») | séquence arrêtée, lead chaud |
| `not_interested` | refus poli | séquence arrêtée |
| `unsubscribed` | « stop », « désinscription », « ne plus me contacter » | séquence arrêtée, « ne pas contacter » partout dans le CRM |
| `bounced` | rebond définitif (adresse inexistante) | séquence arrêtée |
| `note` | toute information utile (body = texte) | ajoutée à l'historique |

- Identifie le lead par `lead_id`, ou à défaut par `email`.
- Mets `message_id` quand tu l'as : les doublons sont ignorés, tu peux renvoyer un événement sans risque.
- Pour une réponse, mets le texte reçu dans `body`. Une réponse automatique d'absence n'est **pas** une réponse : ignore-la. Un « intéressé » est aussi une réponse : envoie seulement `interested`.
- 500 événements au plus par appel.

## Détecter les réponses (taux de réponse)

Le taux de réponse est l'indicateur n° 1. Plusieurs fois par jour, relève la boîte de réception de chaque boîte d'envoi (IMAP) : pour chaque message reçu d'une adresse de prospect, rapporte `replied` (ou `interested`, `not_interested`, `unsubscribed` selon le contenu, `bounced` pour un retour « adresse inexistante » du serveur), avec le texte dans `body` et l'`email` du prospect.

## Règles absolues

- Ne contacte que les leads remis par `/next`, une seule fois par tâche.
- Ne réponds jamais toi-même à un prospect qui a répondu : rapporte `replied` ou `interested`, Lomig reprend la main.
- Chaque mail contient une façon simple de se désinscrire (une phrase suffit : « Réponds STOP si tu ne veux plus recevoir de message »).
- N'invente ni chiffres, ni clients, ni références. Pas de pièce jointe, pas plus d'un lien dans le premier mail.
