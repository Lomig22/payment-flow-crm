'use client';
import dynamic from 'next/dynamic';
import Spinner from '@/components/ui/Spinner';

const PipelineBoard = dynamic(() => import('@/components/leads/PipelineBoard'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center h-64"><Spinner className="w-8 h-8" /></div>,
});

export default function PipelineInstagramPage() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Funnel DM Instagram — glissez les leads pour changer leur statut.
      </p>
      <PipelineBoard source="instagram" />
    </div>
  );
}
