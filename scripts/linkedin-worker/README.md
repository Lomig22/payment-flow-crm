# Worker LinkedIn (VPS)

Ce worker exécute la séquence LinkedIn du CRM sur le VPS Hostinger, même quand ton ordinateur est éteint :
invitation → acceptation → DM (J+1) → relance (J+2 sans réponse).

Le CRM (page `/linkedin`) décide quoi faire et quand : plafonds, horaires, messages. Le worker ouvre un vrai Chromium avec ta session LinkedIn, fait l'action, puis rend compte au CRM.

Le code qui agit dans les pages LinkedIn est `../linkedin-extension/pageAction.js`. Il est partagé avec l'extension Chrome : ne fais tourner **qu'un des deux**.

## Installation (une fois)

**1. Sur le VPS** (Ubuntu ; en SSH, `ssh root@IP_DU_VPS`) :

```bash
apt update && apt install -y curl rsync xvfb
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs
mkdir -p /opt/linkedin-worker
```

**2. Sur ton Mac**, dans ce dossier :

```bash
npm install && npx playwright install chromium
npm run login            # une fenêtre s'ouvre : connecte-toi à LinkedIn (2FA compris)
scp state.json root@IP_DU_VPS:/opt/linkedin-worker/state.json
cp .env.example .env     # puis renseigne EXT_KEY (clé affichée sur la page /linkedin du CRM)
scp .env root@IP_DU_VPS:/opt/linkedin-worker/.env
./deploy.sh root@IP_DU_VPS
```

**3. Vérifier**

- Sur la page `/linkedin` du CRM, la carte « Exécution » passe à **Actif** dans les 2 minutes.
- Pour suivre l'activité en direct sur le VPS : `journalctl -u linkedin-worker -f`.

## Au quotidien

- **Mettre à jour le worker** (après une modification de `pageAction.js`, par exemple) : `./deploy.sh root@IP_DU_VPS`.
- **Alerte « Session LinkedIn déconnectée »** dans le CRM :
  1. Relance `npm run login` sur ton Mac.
  2. Recopie `state.json` avec `scp`.
  3. Redémarre le service : `ssh root@IP_DU_VPS systemctl restart linkedin-worker`.
- **Arrêter le worker** :
  - pour stopper aussi les envois : `ssh root@IP_DU_VPS systemctl stop linkedin-worker` ;
  - pour suspendre seulement les envois, c'est plus simple : bouton « Mettre en pause » sur la page `/linkedin`.

## Localisation du VPS

- LinkedIn voit l'IP du VPS. Un VPS situé en France, comme ta connexion habituelle, limite les vérifications de sécurité.
- Si le VPS est ailleurs, renseigne `PROXY_URL` dans `.env`, avec une IP française.
