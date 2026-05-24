'use client';

import { useSearchParams } from 'next/navigation';
import { resolveSeason, seasonLabel } from '../lib/season';

export function SeasonDisplay() {
  const searchParams = useSearchParams();
  const season = resolveSeason({ season: searchParams.get('season') || undefined });

  return (
    <span className="mono text-[11px] uppercase tracking-wider px-2.5 py-1 border border-border rounded text-text-dim">
      {seasonLabel(season)}
    </span>
  );
}