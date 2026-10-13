'use client';
import TodayCard from '@/components/linkedin/TodayCard';
import LeadsTimeline from '@/components/linkedin/LeadsTimeline';
import { LinkedinShell, ToResume } from '@/components/linkedin/parts';

// LinkedIn · Leads (opérationnel) : la journée, les réponses à reprendre, chaque lead avec sa
// dernière étape, sa prochaine étape datée et son historique
export default function LinkedinLeadsPage() {
  return (
    <LinkedinShell title="Leads" subtitle="Ce qui part aujourd'hui, les réponses à reprendre, et où en est chaque lead.">
      {(d) => (
        <>
          <TodayCard leads={d.leads} settings={d.settings} />
          <ToResume leads={d.leads} />
          <LeadsTimeline leads={d.leads} settings={d.settings} />
        </>
      )}
    </LinkedinShell>
  );
}
