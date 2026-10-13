'use client';
import ColdCallLeadsView from '@/components/leads/ColdCallLeadsView';

// Sous-section SEA/ADS du pôle Cold Call : même vue, source dédiée.
export default function SeaAdsLeadsPage() {
  return <ColdCallLeadsView source="sea_ads" label="SEA/ADS" />;
}
