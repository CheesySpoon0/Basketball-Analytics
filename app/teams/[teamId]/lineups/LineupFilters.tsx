'use client';

import { useRouter, useSearchParams } from 'next/navigation';

interface LineupFiltersProps {
  teamId: number;
  season: number;
}

export function LineupFilters({ teamId, season }: LineupFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const minPossessions = parseInt(searchParams.get('minPoss') || '20', 10);
  const onlyFull = searchParams.get('onlyFull') !== 'false';

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(key, value);
    router.push(`/teams/${teamId}/lineups?${params.toString()}`);
  };

  return (
    <div className="bg-surface border border-border p-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div>
          <label className="stat-label block mb-2">Minimum Possessions</label>
          <select
            value={minPossessions}
            onChange={(e) => updateFilter('minPoss', e.target.value)}
            className="w-full px-3 py-2 bg-bg border border-border text-text"
          >
            <option value="10">10+</option>
            <option value="20">20+</option>
            <option value="50">50+</option>
            <option value="100">100+</option>
          </select>
        </div>
        <div>
          <label className="stat-label block mb-2">Confidence Level</label>
          <select
            value={onlyFull ? 'full' : 'all'}
            onChange={(e) => updateFilter('onlyFull', e.target.value === 'full' ? 'true' : 'false')}
            className="w-full px-3 py-2 bg-bg border border-border text-text"
          >
            <option value="full">Full confidence only</option>
            <option value="all">All confidence levels</option>
          </select>
        </div>
      </div>
    </div>
  );
}