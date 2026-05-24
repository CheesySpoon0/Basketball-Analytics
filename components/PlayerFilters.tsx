'use client';

import { useRouter, useSearchParams } from 'next/navigation';

interface PlayerFiltersProps {
  search?: string;
  conference?: string;
  team?: string;
  position?: string;
  minGames: number;
  conferences: string[];
  positions: string[];
  teams: Array<{id: number; school: string; abbreviation?: string | null}>;
}

export function PlayerFilters({
  search,
  conference,
  team,
  position,
  minGames,
  conferences,
  positions,
  teams
}: PlayerFiltersProps) {
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

  const updateParamsMultiple = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    router.push(`?${params.toString()}`);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
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
          onChange={(e) => updateParamsMultiple({
            conference: e.target.value || null,
            team: null // Reset team filter when changing conference
          })}
        >
          <option value="">All Conferences</option>
          {conferences.map(conf => (
            <option key={conf} value={conf}>{conf}</option>
          ))}
        </select>
      </div>

      {/* Team Filter */}
      <div>
        <label className="stat-label mb-2 block">Team</label>
        <select
          defaultValue={team || ''}
          className="w-full bg-surface-2 border border-border px-3 py-2 text-sm"
          onChange={(e) => updateParams('team', e.target.value || null)}
        >
          <option value="">All Teams</option>
          {teams.map(t => (
            <option key={t.id} value={t.id.toString()}>
              {t.abbreviation || t.school}
            </option>
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