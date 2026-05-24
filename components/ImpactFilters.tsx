'use client';

import { useRouter, useSearchParams } from 'next/navigation';

interface ImpactFiltersProps {
  search?: string;
  conference?: string;
  position?: string;
  minGames: number;
  conferences: string[];
  positions: string[];
}

export function ImpactFilters({
  search,
  conference,
  position,
  minGames,
  conferences,
  positions
}: ImpactFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateParams = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`?${params.toString()}`);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
      {/* Search */}
      <div>
        <label className="stat-label mb-2 block">Search Player</label>
        <input
          type="text"
          placeholder="Player name..."
          defaultValue={search || ''}
          className="w-full bg-surface-2 border border-border px-3 py-2 text-sm"
          onChange={(e) => updateParams('search', e.target.value || null)}
        />
      </div>

      {/* Conference Filter */}
      <div>
        <label className="stat-label mb-2 block">Conference</label>
        <select
          defaultValue={conference || ''}
          className="w-full bg-surface-2 border border-border px-3 py-2 text-sm"
          onChange={(e) => updateParams('conference', e.target.value || null)}
        >
          <option value="">All Conferences</option>
          {conferences.map(conf => (
            <option key={conf} value={conf}>{conf}</option>
          ))}
        </select>
      </div>

      {/* Position Filter */}
      <div>
        <label className="stat-label mb-2 block">Position</label>
        <select
          defaultValue={position || ''}
          className="w-full bg-surface-2 border border-border px-3 py-2 text-sm"
          onChange={(e) => updateParams('position', e.target.value || null)}
        >
          <option value="">All Positions</option>
          {positions.map(pos => (
            <option key={pos} value={pos}>{pos}</option>
          ))}
        </select>
      </div>

      {/* Min Games */}
      <div>
        <label className="stat-label mb-2 block">Min Games</label>
        <select
          defaultValue={minGames.toString()}
          className="w-full bg-surface-2 border border-border px-3 py-2 text-sm"
          onChange={(e) => updateParams('minGames', e.target.value)}
        >
          <option value="1">1+</option>
          <option value="5">5+</option>
          <option value="10">10+</option>
          <option value="15">15+</option>
          <option value="20">20+</option>
        </select>
      </div>
    </div>
  );
}