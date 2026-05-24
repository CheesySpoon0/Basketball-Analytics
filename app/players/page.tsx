import Link from 'next/link';
import { prisma } from '../../lib/prisma';
import { SeasonSelector } from '../../components/SeasonSelector';
import { PlayerFilters } from '../../components/PlayerFilters';
import { resolveSeason, withSeason } from '../../lib/season';

export const dynamic = 'force-dynamic';

type SortOption = 'ppg' | 'rpg' | 'apg' | 'efg' | 'rapm' | 'orapm' | 'drapm' | 'games' | 'minutes';

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const season = resolveSeason(params);
  const sortBy = (params.sort as SortOption) || 'ppg';
  const conference = params.conference as string | undefined;
  const team = params.team as string | undefined;
  const position = params.position as string | undefined;
  const minGames = parseInt((params.minGames as string) || '5');
  const search = params.search as string | undefined;
  const scope = params.scope as 'bigwest' | 'all' || 'all';

  // Build where conditions
  const whereConditions: any = {
    AND: [
      search ? {
        name: {
          contains: search,
          mode: 'insensitive'
        }
      } : {},
      {
        seasonStats: {
          some: {
            season,
            games: { gte: minGames }
          }
        }
      },
      position ? { position } : {},
      team ? {
        seasonStats: {
          some: {
            season,
            teamId: parseInt(team)
          }
        }
      } : {},
      conference ? {
        seasonStats: {
          some: {
            season,
            team: { conference }
          }
        }
      } : {},
      scope === 'bigwest' ? {
        team: {
          school: {
            in: [
              'UC Irvine', 'UC Santa Barbara', 'Long Beach State', 'Cal Poly',
              'Cal State Bakersfield', 'Cal State Fullerton', 'Cal State Northridge',
              "Hawai'i", 'UC Davis', 'UC Riverside', 'UC San Diego'
            ]
          }
        }
      } : {}
    ]
  };

  // Get players with stats and RAPM data
  const players = await prisma.player.findMany({
    where: whereConditions,
    include: {
      team: true,
      seasonStats: {
        where: { season },
        include: { team: true } // Season-specific team
      },
      impact: {
        where: { season }
      }
    },
    take: 500 // Limit for performance
  });

  // Transform and sort
  const playerData = players
    .map(player => {
      const stats = player.seasonStats[0];
      const rapm = player.impact[0];

      if (!stats) return null;

      const ppg = stats.games && stats.games > 0 ? (stats.points || 0) / stats.games : 0;
      const rpg = stats.games && stats.games > 0 ? (stats.rebounds || 0) / stats.games : 0;
      const apg = stats.games && stats.games > 0 ? (stats.assists || 0) / stats.games : 0;
      const fgAtt = stats.fieldGoalsAttempted || 0;
      const threePtAtt = stats.threePointsAttempted || 0;
      const efg = fgAtt > 0 ?
        ((stats.fieldGoalsMade || 0) + 0.5 * (stats.threePointsMade || 0)) / fgAtt : 0;

      return {
        id: player.id,
        name: player.name,
        position: player.position,
        team: stats.team, // Use season-specific team, not current team
        games: stats.games,
        minutes: stats.minutes || 0,
        ppg,
        rpg,
        apg,
        efg: efg * 100,
        rapm: rapm?.rapm || null,
        orapm: rapm?.orapm || null,
        drapm: rapm?.drapm || null,
        confidence: rapm?.confidence || null
      };
    })
    .filter((player): player is NonNullable<typeof player> => Boolean(player))
    .sort((a, b) => {
      switch (sortBy) {
        case 'ppg': return b.ppg - a.ppg;
        case 'rpg': return b.rpg - a.rpg;
        case 'apg': return b.apg - a.apg;
        case 'efg': return b.efg - a.efg;
        case 'rapm': return (b.rapm || -999) - (a.rapm || -999);
        case 'orapm': return (b.orapm || -999) - (a.orapm || -999);
        case 'drapm': return (b.drapm || -999) - (a.drapm || -999);
        case 'games': return (b.games || 0) - (a.games || 0);
        case 'minutes': return (b.minutes || 0) - (a.minutes || 0);
        default: return b.ppg - a.ppg;
      }
    });

  // Get filter options using season-specific data
  const conferences = [...new Set(playerData.map(p => p.team?.conference).filter((conf): conf is string => Boolean(conf)))].sort();
  const positions = [...new Set(players.map(p => p.position).filter((pos): pos is string => Boolean(pos)))].sort();
  const teamsForFilter = [...new Set(playerData.map(p => p.team).filter((team): team is NonNullable<typeof team> => Boolean(team)))]
    .sort((a, b) => a.school.localeCompare(b.school));

  return (
    <main className="max-w-[1400px] mx-auto px-6 lg:px-8 py-8 lg:py-12">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-8 flex-wrap">
        <div>
          <div className="mono text-[11px] uppercase tracking-[0.2em] text-text-dim mb-2">
            Player Database
          </div>
          <h1 className="display text-[44px] sm:text-[56px] leading-[0.95] tracking-tight font-medium">
            Players
          </h1>
          <p className="text-text-dim mt-4 max-w-2xl">
            Search and filter players across all D1 programs. View traditional stats, advanced impact metrics,
            and individual player pages with shot charts and detailed analysis.
          </p>
        </div>
        <SeasonSelector season={season} />
      </div>

      {/* Scope Toggle */}
      <div className="flex gap-2 mb-6">
        <Link
          href={`?${new URLSearchParams({ ...params, scope: 'all' }).toString()}`}
          className={`px-4 py-2 text-sm border transition-colors ${
            scope === 'all'
              ? 'border-accent text-accent bg-accent/10'
              : 'border-border text-text-dim hover:border-accent/50'
          }`}
        >
          All D1 ({playerData.length})
        </Link>
        <Link
          href={`?${new URLSearchParams({ ...params, scope: 'bigwest' }).toString()}`}
          className={`px-4 py-2 text-sm border transition-colors ${
            scope === 'bigwest'
              ? 'border-accent text-accent bg-accent/10'
              : 'border-border text-text-dim hover:border-accent/50'
          }`}
        >
          Big West Only
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-surface border border-border p-6 mb-8">
        <PlayerFilters
          search={search}
          conference={conference}
          team={team}
          position={position}
          minGames={minGames}
          conferences={conferences}
          positions={positions}
          teams={teamsForFilter}
        />

        {/* Sort Options */}
        <div className="flex flex-wrap gap-2">
          <span className="stat-label mr-3">Sort by:</span>
          {[
            { value: 'ppg', label: 'PPG' },
            { value: 'rpg', label: 'RPG' },
            { value: 'apg', label: 'APG' },
            { value: 'efg', label: 'eFG%' },
            { value: 'rapm', label: 'Net RAPM' },
            { value: 'orapm', label: 'ORAPM' },
            { value: 'drapm', label: 'DRAPM' },
            { value: 'games', label: 'Games' }
          ].map(option => (
            <Link
              key={option.value}
              href={`?${new URLSearchParams({ ...params, sort: option.value }).toString()}`}
              className={`px-3 py-1 text-xs border transition-colors ${
                sortBy === option.value
                  ? 'border-accent text-accent bg-accent/10'
                  : 'border-border text-text-dim hover:border-accent/50'
              }`}
            >
              {option.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Results Table */}
      <div className="bg-surface border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="stat-label py-3 px-4">Player</th>
                <th className="stat-label py-3 px-4">Team</th>
                <th className="stat-label py-3 px-4">Pos</th>
                <th className="stat-label py-3 px-4 text-right">G</th>
                <th className="stat-label py-3 px-4 text-right">PPG</th>
                <th className="stat-label py-3 px-4 text-right">RPG</th>
                <th className="stat-label py-3 px-4 text-right">APG</th>
                <th className="stat-label py-3 px-4 text-right">eFG%</th>
                <th className="stat-label py-3 px-4 text-right">RAPM</th>
                <th className="stat-label py-3 px-4 text-right">Conf.</th>
              </tr>
            </thead>
            <tbody>
              {playerData.map((player, index) => (
                <tr key={player.id} className="border-b border-border hover:bg-surface-2 transition-colors">
                  <td className="py-3 px-4">
                    <Link
                      href={withSeason(`/players/${player.id}`, season)}
                      className="font-medium text-text hover:text-accent transition-colors"
                    >
                      {player.name}
                    </Link>
                  </td>
                  <td className="py-3 px-4">
                    {player.team ? (
                      <Link
                        href={withSeason(`/teams/${player.team.id}`, season)}
                        className="text-text-dim hover:text-accent transition-colors text-xs"
                      >
                        {player.team.abbreviation || player.team.school}
                      </Link>
                    ) : '—'}
                  </td>
                  <td className="py-3 px-4 text-text-dim text-xs">{player.position || '—'}</td>
                  <td className="py-3 px-4 text-right mono tabular-nums text-xs">{player.games}</td>
                  <td className="py-3 px-4 text-right mono tabular-nums">{player.ppg.toFixed(1)}</td>
                  <td className="py-3 px-4 text-right mono tabular-nums">{player.rpg.toFixed(1)}</td>
                  <td className="py-3 px-4 text-right mono tabular-nums">{player.apg.toFixed(1)}</td>
                  <td className="py-3 px-4 text-right mono tabular-nums">{player.efg.toFixed(1)}</td>
                  <td className="py-3 px-4 text-right mono tabular-nums">
                    {player.rapm !== null ? (
                      <span className={player.rapm >= 0 ? 'text-[var(--made)]' : 'text-[var(--missed)]'}>
                        {player.rapm >= 0 ? '+' : ''}{player.rapm.toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-text-dim">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right text-xs text-text-dim">
                    {player.team?.conference || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {playerData.length === 0 && (
          <div className="p-8 text-center text-text-dim">
            No players found matching your filters.
          </div>
        )}
      </div>
    </main>
  );
}
