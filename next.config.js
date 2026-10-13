/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // ffmpeg (nettoyage des métadonnées des vidéos) : binaire chargé à l'exécution,
    // à ne pas empaqueter par webpack mais à embarquer dans la fonction Vercel.
    serverComponentsExternalPackages: ['ffmpeg-static'],
    outputFileTracingIncludes: {
      '/api/instagram/queue/[id]/process': ['./node_modules/ffmpeg-static/ffmpeg'],
      '/api/drive-import/[id]/process':    ['./node_modules/ffmpeg-static/ffmpeg'],
      // empreintes des miniatures publiées (détection des vidéos déjà postées)
      '/api/cron/instagram-sync':          ['./node_modules/ffmpeg-static/ffmpeg'],
      '/api/instagram/content/sync':       ['./node_modules/ffmpeg-static/ffmpeg'],
      // anti-doublon juste avant « Publier maintenant »
      '/api/instagram/queue/[id]/publish': ['./node_modules/ffmpeg-static/ffmpeg'],
      // voix off : ffmpeg + police des sous-titres
      '/api/instagram/queue/[id]/voiceover': ['./node_modules/ffmpeg-static/ffmpeg', './assets/fonts/**'],
      '/api/cron/voiceover':                 ['./node_modules/ffmpeg-static/ffmpeg', './assets/fonts/**'],
    },
  },
};
module.exports = nextConfig;
