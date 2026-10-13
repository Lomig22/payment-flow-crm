'use client';
import ImportCard from '@/components/linkedin/ImportCard';
import SettingsCard from '@/components/linkedin/SettingsCard';
import RampSettingsCard from '@/components/linkedin/RampSettingsCard';
import { Candidates, LinkedinShell, WorkerKey } from '@/components/linkedin/parts';

// LinkedIn · Import & réglages (organisation) : CSV Hermès, leads à ajouter à la séquence,
// rythme et délais, clé du robot
export default function LinkedinReglagesPage() {
  return (
    <LinkedinShell title="Import & réglages" subtitle="Importer les leads d'Hermès, les ajouter à la séquence, régler le rythme et les délais.">
      {(d) => (
        <>
          <ImportCard />
          <Candidates candidates={d.candidates} />
          <RampSettingsCard settings={d.settings} />
          <SettingsCard settings={d.settings} />
          <WorkerKey settings={d.settings} />
        </>
      )}
    </LinkedinShell>
  );
}
