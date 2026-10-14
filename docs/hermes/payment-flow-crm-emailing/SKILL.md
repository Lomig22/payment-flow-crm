---
name: payment-flow-crm-emailing
description: Envoyer la prospection email de Payment Flow à partir du CRM. À utiliser pour chaque session d'envoi : récupérer les mails à envoyer auprès du CRM, les rédiger, les envoyer depuis les boîtes préchauffées, puis rapporter chaque événement (envoi, réponse, rebond, désinscription) au CRM.
---

# Prospection email Payment Flow, pilotée par le CRM

Le CRM Payment Flow est la source de vérité. Il décide **qui** contacter et **quand** (séquence, arrêt à la première réponse, adresses invalides, désinscriptions, « ne pas contacter » commun à tous les canaux). Toi, tu **rédiges**, tu **envoies** depuis les boîtes préchauffées et tu **rapportes** tout au CRM. N'envoie jamais un mail à une adresse que le CRM ne t'a pas remise.

## Connexion

- Adresse : `https://payment-flow-crm-delta.vercel.app/api/emailing/agent`
- En-tête sur chaque appel : `Authorization: Bearer $PF_CRM_EMAILING_KEY`. La clé est dans ta configuration (variable d'environnement), ne l'écris jamais dans un message ni dans un journal.
- Réponses en JSON. `401` = clé absente ou fausse.

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
   - `template` : modèle de Lomig pour ce mail. Remplace les variables `{{first_name}}`, `{{company}}`, `{{city}}`, `{{sector}}`… avec `lead`. Si `template` est `null`, rédige toi-même en suivant `instructions`.
   - Chaque lead remis est réservé 6 h pour toi. Si `tasks` est vide, lis `reason` et attends (15 min) avant de redemander.

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
| `opened`, `clicked` | ouverture ou clic (si suivi) | statistiques seulement |
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

## Règles absolues

- Ne contacte que les leads remis par `/next`, une seule fois par tâche.
- Ne réponds jamais toi-même à un prospect qui a répondu : rapporte `replied` ou `interested`, Lomig reprend la main.
- Chaque mail contient une façon simple de se désinscrire (une phrase suffit : « Réponds STOP si tu ne veux plus recevoir de message »).
- N'invente ni chiffres, ni clients, ni références. Pas de pièce jointe, pas plus d'un lien dans le premier mail.
