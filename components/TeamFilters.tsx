'use client';

import { useRouter, useSearchParams } from 'next/navigation';

interface TeamFiltersProps {
  search?: string;
  conference?: string;
  sortBy: string;
  conferences: string[];
}

export function TeamFilters({
  search,
  conference,
  sortBy,
  conferences
}: TeamFiltersProps) {
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
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
      {/* Search */}
      <div>
        <label className="stat-label mb-2 block">Search Team</label>
        <input
          type="text"
          placeholder="Team name..."
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

      {/* Sort */}
      <div>
        <label className="stat-label mb-2 block">Sort By</label>
        <select
          defaultValue={sortBy}
          className="w-full bg-surface-2 border border-border px-3 py-2 text-sm"
          onChange={(e) => updateParams('sort', e.target.value)}
        >
          <option value="wins">Most Wins</option>
          <option value="losses">Fewest Losses</option>
          <option value="pointsAvg">Highest Scoring</option>
          <option value="school">Alphabetical</option>
        </select>
      </div>
    </div>
  );
}