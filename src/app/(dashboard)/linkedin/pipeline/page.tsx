'use client';
import LinkedinPipeline from '@/components/linkedin/LinkedinPipeline';
import { LinkedinShell } from '@/components/linkedin/parts';

// LinkedIn · Pipeline (opérationnel) : les leads de la séquence en colonnes, étape par étape
export default function LinkedinPipelinePage() {
  return (
    <LinkedinShell title="Pipeline" subtitle="Chaque colonne est une étape de la séquence ; la carte indique la prochaine étape prévue.">
      {(d) => <LinkedinPipeline leads={d.leads} settings={d.settings} />}
    </LinkedinShell>
  );
}
