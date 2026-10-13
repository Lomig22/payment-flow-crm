'use client';
import ReviewQueue from '@/components/linkedin/ReviewQueue';
import { LinkedinShell } from '@/components/linkedin/parts';

// LinkedIn · À valider (opérationnel) : messages rédigés par l'agent, à valider avant envoi
export default function LinkedinValidationPage() {
  return (
    <LinkedinShell title="À valider" subtitle="Premiers messages et relances post rédigés par l'agent : rien ne part sans votre validation tant que la validation manuelle est active.">
      {(d) => <ReviewQueue items={d.review} settings={d.settings} previewWaiting={d.preview_waiting} />}
    </LinkedinShell>
  );
}
