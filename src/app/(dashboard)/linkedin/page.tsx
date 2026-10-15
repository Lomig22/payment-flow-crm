'use client';
import ExecutionCard from '@/components/linkedin/ExecutionCard';
import StatsPanel from '@/components/linkedin/StatsPanel';
import RampCard from '@/components/linkedin/RampCard';
import KpiCard from '@/components/linkedin/KpiCard';
import { Journal, LinkedinShell } from '@/components/linkedin/parts';

// LinkedIn · Pilotage (organisation) : état d'exécution, plafonds, indicateurs, journal du robot
export default function LinkedinPilotagePage() {
  return (
    <LinkedinShell title="Pilotage" subtitle="État du compte et de la séquence, montée en charge, résultats par variante, journal du robot.">
      {(d) => (
        <>
          <KpiCard leads={d.leads} />
          <ExecutionCard execution={d.execution} settings={d.settings} />
          <RampCard ramp={d.ramp} />
          <StatsPanel leads={d.leads} />
          <Journal log={d.log} />
        </>
      )}
    </LinkedinShell>
  );
}
