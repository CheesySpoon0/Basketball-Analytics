import Link from 'next/link';
import { prisma } from '../../lib/prisma';
import { SeasonSelector } from '../../components/SeasonSelector';
import { resolveSeason, withSeason } from '../../lib/season';

export const dynamic = 'force-dynamic';

export default async function TeamsHubPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const season = resolveSeason(params);
  const conference = params.conference as string | undefined;
  const search = params.search as string | undefined;
  const sortBy = (params.sort as 'wins' | 'losses' | 'pointsAvg' | 'school') || 'wins';

  // Get teams with season stats
  const teams = await prisma.team.findMany({
    where: {
      AND: [
        search ? {
          OR: [
            { school: { contains: search, mode: 'insensitive' } },
            { displayName: { contains: search, mode: 'insensitive' } }
          ]
        } : {},
        conference ? { conference } : {},
        {
          teamSeasonStats: {
            some: { season }
          }
        }
      ]
    },
    include: {
      teamSeasonStats: {
        where: { season }
      },
      _count: {
        select: {
          players: {
            where: {
              seasonStats: {
                some: { season }
              }
            }
          }
        }
      }
    }
  });

  // Transform and sort teams
  const teamData = teams
    .map(team => {
      const stats = team.teamSeasonStats[0];
      return {
        ...team,
        stats,
        winPct: stats?.games && stats.wins ? stats.wins / stats.games : 0,
        pointsAvg: stats?.games ? (stats.pointsTotal || 0) / stats.games : 0
      };
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'wins': return (b.stats?.wins || 0) - (a.stats?.wins || 0);
        case 'losses': return (a.stats?.losses || 0) - (b.stats?.losses || 0);
        case 'pointsAvg': return b.pointsAvg - a.pointsAvg;
        case 'school': return a.school.localeCompare(b.school);
        default: return (b.stats?.wins || 0) - (a.stats?.wins || 0);
      }
    });

  const conferences = [...new Set(teams.map(t => t.conference).filter((conf): conf is string => Boolean(conf)))].sort();

  return (
    <main className="max-w-[1400px] mx-auto px-6 lg:px-8 py-8 lg:py-12">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-8 flex-wrap">
        <div>
          <div className="mono text-[11px] uppercase tracking-[0.2em] text-text-dim mb-2">
            Team Database
          </div>
          <h1 className="display text-[44px] sm:text-[56px] leading-[0.95] tracking-tight font-medium">
            Teams
          </h1>
          <p className="text-text-dim mt-4 max-w-2xl">
            Explore team analytics, player rosters, lineup analysis, and shot quality data across all D1 programs.
          </p>
        </div>
        <SeasonSelector season={season} />
      </div>

      {/* Filters */}
      <div className="bg-surface border border-border p-6 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          {/* Search */}
          <div>
            <label className="stat-label mb-2 block">Search Team</label>
            <input
              type="text"
              placeholder="Team name..."
              defaultValue={search || ''}
              className="w-full bg-surface-2 border border-border px-3 py-2 text-sm"
              onChange={(e) => {
                const url = new URL(window.location.href);
                if (e.target.value) {
                  url.searchParams.set('search', e.target.value);
                } else {
                  url.searchParams.delete('search');
                }
                window.history.pushState({}, '', url);
              }}
            />
          </div>

          {/* Conference Filter */}
          <div>
            <label className="stat-label mb-2 block">Conference</label>
            <select
              defaultValue={conference || ''}
              className="w-full bg-surface-2 border border-border px-3 py-2 text-sm"
              onChange={(e) => {
                const url = new URL(window.location.href);
                if (e.target.value) {
                  url.searchParams.set('conference', e.target.value);
                } else {
                  url.searchParams.delete('conference');
                }
                window.location.href = url.toString();
              }}
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
              onChange={(e) => {
                const url = new URL(window.location.href);
                url.searchParams.set('sort', e.target.value);
                window.location.href = url.toString();
              }}
            >
              <option value="wins">Most Wins</option>
              <option value="losses">Fewest Losses</option>
              <option value="pointsAvg">Highest Scoring</option>
              <option value="school">Alphabetical</option>
            </select>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {teamData.map((team) => (
          <Link
            key={team.id}
            href={withSeason(`/teams/${team.id}`, season)}
            className="group bg-surface hover:bg-surface-2 transition-colors p-4 border border-border hover:border-accent"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="min-w-0 flex-1">
                <h3 className="font-medium group-hover:text-accent transition-colors truncate">
                  {team.school}
                </h3>
                {team.displayName && team.displayName !== team.school && (
                  <div className="text-xs text-text-dim mt-1 truncate">
                    {team.displayName}
                  </div>
                )}
              </div>
              {team.stats && (
                <div className="text-xs text-text-dim ml-2 shrink-0">
                  {team.stats.wins}-{team.stats.losses}
                </div>
              )}
            </div>

            <div className="space-y-2 text-xs text-text-dim">
              {team.conference && (
                <div className="truncate">{team.conference}</div>
              )}

              {team.stats && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-text-dim">Win%:</span>{' '}
                    <span className="mono tabular-nums">
                      {(team.winPct * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div>
                    <span className="text-text-dim">PPG:</span>{' '}
                    <span className="mono tabular-nums">
                      {team.pointsAvg.toFixed(1)}
                    </span>
                  </div>
                </div>
              )}

              <div>
                <span className="text-text-dim">Players:</span> {team._count.players}
              </div>
            </div>

            <div className="text-xs text-accent group-hover:text-text transition-colors mt-3">
              View Team Analytics →
            </div>
          </Link>
        ))}
      </div>

      {teamData.length === 0 && (
        <div className="text-center py-12 text-text-dim">
          No teams found matching your filters.
        </div>
      )}
    </main>
  );
}
