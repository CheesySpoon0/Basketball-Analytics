import Link from 'next/link';
import { prisma } from '../../lib/prisma';
import { SeasonSelector } from '../../components/SeasonSelector';
import { resolveSeason, withSeason } from '../../lib/season';

export const dynamic = 'force-dynamic';

export default async function LineupsHubPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const season = resolveSeason(await searchParams);

  // Get teams with lineup data
  const teams = await prisma.team.findMany({
    where: {
      lineupStints: {
        some: {
          game: { season }
        }
      }
    },
    include: {
      _count: {
        select: {
          lineupStints: {
            where: {
              game: { season }
            }
          }
        }
      }
    },
    orderBy: { school: 'asc' }
  });

  return (
    <main className="max-w-[1400px] mx-auto px-6 lg:px-8 py-8 lg:py-12">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-8 flex-wrap">
        <div>
          <div className="mono text-[11px] uppercase tracking-[0.2em] text-text-dim mb-2">
            Lineup Analysis Hub
          </div>
          <h1 className="display text-[44px] sm:text-[56px] leading-[0.95] tracking-tight font-medium">
            Lineup Optimizer
          </h1>
          <p className="text-text-dim mt-4 max-w-2xl">
            Analyze observed lineup performance and project new combinations using RAPM-based models.
            Choose a team to explore their lineup data and build projected 5-man units.
          </p>
        </div>
        <SeasonSelector season={season} />
      </div>

      {/* How It Works */}
      <div className="bg-surface-2/50 border border-border p-6 mb-8">
        <h2 className="display text-xl font-medium mb-4">How Lineup Analysis Works</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
          <div>
            <h3 className="font-medium text-accent mb-2">Observed Lineups</h3>
            <p className="text-text-dim leading-relaxed">
              View actual 5-man combinations that played together, with minutes, possessions,
              and efficiency metrics from real games.
            </p>
          </div>
          <div>
            <h3 className="font-medium text-blue-400 mb-2">RAPM Projections</h3>
            <p className="text-text-dim leading-relaxed">
              Build hypothetical lineups using individual player RAPM estimates.
              Projects ORtg, DRtg, and Net Rating for new combinations.
            </p>
          </div>
          <div>
            <h3 className="font-medium text-green-400 mb-2">Expected Performance</h3>
            <p className="text-text-dim leading-relaxed">
              Compare actual results vs xeFG-based expectations to identify
              lineups that over/under-perform relative to shot quality.
            </p>
          </div>
        </div>
      </div>

      {/* Team Selection */}
      <div>
        <h2 className="display text-2xl font-medium mb-6">Select Team</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {teams.map((team) => (
            <Link
              key={team.id}
              href={withSeason(`/teams/${team.id}/lineups`, season)}
              className="group bg-surface hover:bg-surface-2 transition-colors p-4 border border-border hover:border-accent"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium group-hover:text-accent transition-colors">
                  {team.school}
                </h3>
                <div className="text-xs text-text-dim">
                  {team._count.lineupStints} lineups
                </div>
              </div>
              <div className="text-sm text-text-dim mb-3">
                {team.displayName || team.school}
              </div>
              <div className="text-xs text-accent group-hover:text-text transition-colors">
                Analyze Lineups →
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}