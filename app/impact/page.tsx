import Link from 'next/link';
import { prisma } from '../../lib/prisma';
import { SeasonSelector } from '../../components/SeasonSelector';
import { ImpactFilters } from '../../components/ImpactFilters';
import { resolveSeason, withSeason } from '../../lib/season';

export const dynamic = 'force-dynamic';

type SortOption = 'rapm' | 'orapm' | 'drapm' | 'rapmExpected' | 'possessions' | 'minutes' | 'ppg';

export default async function ImpactMetricsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const season = resolveSeason(params);
  const sortBy = (params.sort as SortOption) || 'rapm';
  const conference = params.conference as string | undefined;
  const position = params.position as string | undefined;
  const minGames = parseInt((params.minGames as string) || '5');
  const search = params.search as string | undefined;

  // Get players with RAPM data from canonical PlayerImpact table
  const players = await prisma.player.findMany({
    where: {
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
        {
          impact: {
            some: {
              season // Use PlayerImpact as canonical RAPM source
            }
          }
        },
        position ? { position } : {},
        conference ? {
          seasonStats: {
            some: {
              season,
              team: { conference }
            }
          }
        } : {}
      ]
    },
    include: {
      team: true,
      seasonStats: {
        where: { season },
        include: { team: true } // Season-specific team
      },
      impact: {
        where: { season }
      }
    }
  });

  // Transform and sort
  const playerData = players
    .map(player => {
      const stats = player.seasonStats[0];
      const impactData = player.impact[0];

      if (!stats || !impactData) return null;

      const ppg = stats.games && stats.games > 0 ? (stats.points || 0) / stats.games : 0;
      const rpg = stats.games && stats.games > 0 ? (stats.rebounds || 0) / stats.games : 0;
      const apg = stats.games && stats.games > 0 ? (stats.assists || 0) / stats.games : 0;

      // Use Net RAPM from PlayerImpact, with validation that rapm ≈ orapm + drapm
      const netRapm = impactData.rapm;
      const calculatedNetRapm = (impactData.orapm || 0) + (impactData.drapm || 0);

      // Determine confidence based on possession sample
      const totalPoss = impactData.possessions || 0;
      const confidence = totalPoss >= 400 ? 'high' : totalPoss >= 200 ? 'moderate' : 'low';

      return {
        id: player.id,
        name: player.name,
        position: player.position,
        team: stats.team, // Use season-specific team
        games: stats.games || 0,
        minutes: stats.minutes || 0,
        ppg,
        rpg,
        apg,
        rapm: netRapm, // Use actual Net RAPM from PlayerImpact
        orapm: impactData.orapm,
        drapm: impactData.drapm,
        rapmExpected: impactData.rapmExpected, // Available in PlayerImpact
        possessions: totalPoss,
        confidence
      };
    })
    .filter((player): player is NonNullable<typeof player> => Boolean(player))
    .sort((a, b) => {
      switch (sortBy) {
        case 'rapm': return (b.rapm || -999) - (a.rapm || -999);
        case 'orapm': return (b.orapm || -999) - (a.orapm || -999);
        case 'drapm': return (b.drapm || -999) - (a.drapm || -999);
        case 'possessions': return (b.possessions || 0) - (a.possessions || 0);
        case 'minutes': return (b.minutes || 0) - (a.minutes || 0);
        case 'ppg': return (b.ppg || 0) - (a.ppg || 0);
        default: return (b.rapm || -999) - (a.rapm || -999);
      }
    });

  const conferences = [...new Set(players.map(p => p.team?.conference).filter((conf): conf is string => Boolean(conf)))].sort();
  const positions = [...new Set(players.map(p => p.position).filter((pos): pos is string => Boolean(pos)))].sort();

  return (
    <main className="max-w-[1400px] mx-auto px-6 lg:px-8 py-8 lg:py-12">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-8 flex-wrap">
        <div>
          <div className="mono text-[11px] uppercase tracking-[0.2em] text-text-dim mb-2">
            Player Impact Analysis
          </div>
          <h1 className="display text-[44px] sm:text-[56px] leading-[0.95] tracking-tight font-medium">
            RAPM Leaderboards
          </h1>
          <p className="text-text-dim mt-4 max-w-2xl">
            Regularized Adjusted Plus-Minus measures individual player impact in points per 100 possessions.
            Filter and sort players by offensive, defensive, and total impact metrics.
          </p>
        </div>
        <SeasonSelector season={season} />
      </div>

      {/* RAPM Explanation */}
      <div className="bg-surface-2/50 border border-border p-6 mb-8">
        <h2 className="display text-xl font-medium mb-4">Understanding RAPM</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
          <div>
            <h3 className="font-medium text-blue-400 mb-2">ORAPM (Offensive)</h3>
            <p className="text-text-dim leading-relaxed">
              Points per 100 possessions added when the player's team has the ball.
              Positive values indicate the player helps their offense score more efficiently.
            </p>
          </div>
          <div>
            <h3 className="font-medium text-red-400 mb-2">DRAPM (Defensive)</h3>
            <p className="text-text-dim leading-relaxed">
              Points per 100 possessions prevented when opponents have the ball.
              Positive values indicate the player helps their defense prevent scoring.
            </p>
          </div>
          <div>
            <h3 className="font-medium text-accent mb-2">Net RAPM (Total)</h3>
            <p className="text-text-dim leading-relaxed">
              Combined offensive and defensive impact. The total points per 100 possessions
              added by the player across both ends of the floor.
            </p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-surface border border-border p-6 mb-8">
        <ImpactFilters
          search={search}
          conference={conference}
          position={position}
          minGames={minGames}
          conferences={conferences}
          positions={positions}
        />

        {/* Sort Options */}
        <div className="flex flex-wrap gap-2">
          <span className="stat-label mr-3">Sort by:</span>
          {[
            { value: 'rapm', label: 'Net RAPM' },
            { value: 'orapm', label: 'ORAPM' },
            { value: 'drapm', label: 'DRAPM' },
            { value: 'possessions', label: 'Sample Size' },
            { value: 'ppg', label: 'PPG' }
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

      {/* Results */}
      <div className="bg-surface border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="stat-label py-3 px-4">Player</th>
                <th className="stat-label py-3 px-4">Team</th>
                <th className="stat-label py-3 px-4">Pos</th>
                <th className="stat-label py-3 px-4 text-right">Games</th>
                <th className="stat-label py-3 px-4 text-right">PPG</th>
                <th className="stat-label py-3 px-4 text-right">Net RAPM</th>
                <th className="stat-label py-3 px-4 text-right">ORAPM</th>
                <th className="stat-label py-3 px-4 text-right">DRAPM</th>
                <th className="stat-label py-3 px-4 text-right">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {playerData.slice(0, 100).map((player, index) => (
                <tr key={player.id} className="border-b border-border hover:bg-surface-2 transition-colors">
                  <td className="py-3 px-4">
                    <Link
                      href={withSeason(`/players/${player.id}`, season)}
                      className="font-medium text-text hover:text-accent transition-colors"
                    >
                      {player.name}
                    </Link>
                  </td>
                  <td className="py-3 px-4 text-text-dim">
                    {player.team ? (
                      <Link
                        href={withSeason(`/teams/${player.team.id}`, season)}
                        className="hover:text-accent transition-colors"
                      >
                        {player.team.abbreviation || player.team.school}
                      </Link>
                    ) : '—'}
                  </td>
                  <td className="py-3 px-4 text-text-dim">{player.position || '—'}</td>
                  <td className="py-3 px-4 text-right mono tabular-nums">{player.games}</td>
                  <td className="py-3 px-4 text-right mono tabular-nums">{player.ppg.toFixed(1)}</td>
                  <td className="py-3 px-4 text-right mono tabular-nums">
                    {player.rapm !== null ? (
                      <span className={player.rapm >= 0 ? 'text-[var(--made)]' : 'text-[var(--missed)]'}>
                        {player.rapm >= 0 ? '+' : ''}{player.rapm.toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-text-dim">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right mono tabular-nums">
                    {player.orapm !== null ? (
                      <span className={player.orapm >= 0 ? 'text-[var(--made)]' : 'text-[var(--missed)]'}>
                        {player.orapm >= 0 ? '+' : ''}{player.orapm.toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-text-dim">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right mono tabular-nums">
                    {player.drapm !== null ? (
                      <span className={player.drapm >= 0 ? 'text-[var(--made)]' : 'text-[var(--missed)]'}>
                        {player.drapm >= 0 ? '+' : ''}{player.drapm.toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-text-dim">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className={`text-xs px-2 py-1 rounded ${
                      player.confidence === 'high' ? 'bg-[var(--made)]/20 text-[var(--made)]' :
                      player.confidence === 'moderate' ? 'bg-amber-400/20 text-amber-400' :
                      'bg-[var(--missed)]/20 text-[var(--missed)]'
                    }`}>
                      {player.confidence}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {playerData.length > 100 && (
          <div className="p-4 text-center text-text-dim text-sm border-t border-border">
            Showing top 100 results. Use filters to narrow your search.
          </div>
        )}
      </div>
    </main>
  );
}