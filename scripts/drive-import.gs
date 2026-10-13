/**
 * Import automatique du dossier Google Drive « REELS » vers la file de publication
 * du CRM Payment Flow (Instagram → Publication, statut « À valider »).
 *
 * Installation (compte Google propriétaire du dossier, ex. paymentfloww@gmail.com) :
 *   1. script.google.com → Nouveau projet → coller ce fichier à la place du code.
 *   2. Paramètres du projet (roue dentée) → Propriétés du script → ajouter
 *      CRM_KEY = la clé CRON_SECRET du CRM (dernière ligne de .env.local).
 *   3. Exécuter une fois importReels (autoriser l'accès au Drive quand Google le demande).
 *   4. Déclencheurs (réveil) → Ajouter → importReels → Déclencheur horaire → toutes les 10 minutes.
 *
 * Chaque vidéo importée est rangée dans le sous-dossier « Importés » ; une vidéo déjà
 * publiée sur Instagram va dans « Déjà publiés » (lien du reel en description) ; une
 * vidéo refusée (trop lourde, erreur) va dans « Erreurs import » avec la raison.
 */

const CRM_URL   = 'https://payment-flow-crm-delta.vercel.app';
const FOLDER_ID = '1zrgintKUV1aCWhVf8NsKJIe6zOmGtW8C';   // dossier REELS
const MAX_BYTES = 50 * 1024 * 1024;                      // limite Supabase (offre gratuite)
const PER_RUN   = 1;                                     // une vidéo par exécution (mémoire limitée)
const IN_PROGRESS = 'Import CRM en cours';               // marqueur : si on le retrouve, l'exécution a planté

function importReels() {
  const key = PropertiesService.getScriptProperties().getProperty('CRM_KEY');
  if (!key) throw new Error('Propriété CRM_KEY manquante (Paramètres du projet → Propriétés du script)');

  const folder = DriveApp.getFolderById(FOLDER_ID);
  const done   = subFolder_(folder, 'Importés');
  const failed = subFolder_(folder, 'Erreurs import');
  const published = subFolder_(folder, 'Déjà publiés');
  const files  = folder.getFiles();
  let imported = 0;

  while (files.hasNext() && imported < PER_RUN) {
    const file = files.next();
    const name = file.getName();
    if (!/^video\//.test(file.getMimeType())) continue;

    try {
      // Une exécution précédente a planté sur ce fichier (mémoire, délai) : on l'écarte
      if (file.getDescription() === IN_PROGRESS) {
        throw new Error('l\'import a échoué à l\'exécution précédente (fichier trop lourd pour le script ?)');
      }
      if (file.getSize() > MAX_BYTES) {
        throw new Error('Fichier de ' + Math.round(file.getSize() / 1048576) + ' Mo : 50 Mo maximum. Réexporter en débit plus faible.');
      }
      const fileName = /\.(mp4|mov)$/i.test(name) ? name : name + '.mp4';

      // 1. Entrée dans la file + URL d'envoi
      const start = call_('/api/drive-import', key, { file_name: fileName, file_size: file.getSize(), format: 'reel' });

      // 2. Envoi de la vidéo directement dans le stockage du CRM (le blob tel quel :
      //    getBytes() en ferait une copie qui dépasse la mémoire du script)
      file.setDescription(IN_PROGRESS);
      const up = UrlFetchApp.fetch(start.upload_url, {
        method: 'put',
        contentType: /\.mov$/i.test(fileName) ? 'video/quicktime' : 'video/mp4',
        headers: { 'x-upsert': 'true' },
        payload: file.getBlob(),
        muteHttpExceptions: true,
      });
      if (up.getResponseCode() >= 300) throw new Error('Envoi refusé : ' + up.getContentText());

      // 3. Nettoyage des métadonnées + légende automatique (ou détection d'un reel déjà posté)
      const result = call_('/api/drive-import/' + start.id + '/process', key, {});

      if (result.status === 'duplicate') {
        file.setDescription(result.message || 'Déjà publié ou déjà dans la file');
        file.moveTo(published);
        console.log('Doublon, ignoré : ' + name + ' → ' + (result.message || ''));
      } else {
        file.setDescription('');
        file.moveTo(done);
        console.log('Importé : ' + name);
      }
      imported++;
    } catch (e) {
      file.setDescription('Import CRM impossible : ' + e.message);
      file.moveTo(failed);
      console.error(name + ' : ' + e.message);
    }
  }
}

function call_(path, key, body) {
  const res = UrlFetchApp.fetch(CRM_URL + path, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  const text = res.getContentText();
  if (res.getResponseCode() >= 300) {
    let msg = text;
    try { msg = JSON.parse(text).message || text; } catch (e) { /* réponse non JSON */ }
    throw new Error(msg);
  }
  return JSON.parse(text);
}

function subFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
