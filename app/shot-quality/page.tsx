import Link from 'next/link';
import { prisma } from '../../lib/prisma';
import { SeasonSelector } from '../../components/SeasonSelector';
import { resolveSeason, withSeason } from '../../lib/season';

export const dynamic = 'force-dynamic';

export default async function ShotQualityHubPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const season = resolveSeason(await searchParams);

  // Get teams with shot data
  const teams = await prisma.team.findMany({
    where: {
      players: {
        some: {
          plays: {
            some: {
              game: { season },
              shotMade: { not: null }
            }
          }
        }
      }
    },
    include: {
      _count: {
        select: {
          players: {
            where: {
              plays: {
                some: {
                  game: { season },
                  shotMade: { not: null }
                }
              }
            }
          }
        }
      }
    },
    orderBy: { school: 'asc' }
  });

  // Get sample players with high shot volume
  const topShooters = await prisma.player.findMany({
    where: {
      plays: {
        some: {
          game: { season },
          shotMade: { not: null }
        }
      }
    },
    include: {
      team: true,
      _count: {
        select: {
          plays: {
            where: {
              game: { season },
              shotMade: { not: null }
            }
          }
        }
      }
    },
    orderBy: {
      plays: {
        _count: 'desc'
      }
    },
    take: 12
  });

  return (
    <main className="max-w-[1400px] mx-auto px-6 lg:px-8 py-8 lg:py-12">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-8 flex-wrap">
        <div>
          <div className="mono text-[11px] uppercase tracking-[0.2em] text-text-dim mb-2">
            Expected Field Goal Hub
          </div>
          <h1 className="display text-[44px] sm:text-[56px] leading-[0.95] tracking-tight font-medium">
            Shot Quality
          </h1>
          <p className="text-text-dim mt-4 max-w-2xl">
            Analyze shooting efficiency using xeFG (expected effective field goal percentage) models.
            Compare actual vs expected shooting performance based on shot location, defender distance, and game context.
          </p>
        </div>
        <SeasonSelector season={season} />
      </div>

      {/* xeFG Explanation */}
      <div className="bg-surface-2/50 border border-border p-6 mb-8">
        <h2 className="display text-xl font-medium mb-4">Understanding xeFG</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
          <div>
            <h3 className="font-medium text-green-400 mb-2">Expected Field Goals</h3>
            <p className="text-text-dim leading-relaxed">
              Based on shot location, defender distance, and shot clock, the model predicts
              the probability of each shot going in.
            </p>
          </div>
          <div>
            <h3 className="font-medium text-blue-400 mb-2">Shot Quality vs Ability</h3>
            <p className="text-text-dim leading-relaxed">
              Players who consistently outperform their xeFG have strong shooting ability.
              Those who underperform may be taking difficult shots or struggling with form.
            </p>
          </div>
          <div>
            <h3 className="font-medium text-accent mb-2">Coaching Applications</h3>
            <p className="text-text-dim leading-relaxed">
              Identify players taking good shots but missing (stay aggressive) vs those
              taking bad shots but making them (improve shot selection).
            </p>
          </div>
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-surface border border-border p-6">
          <h3 className="display text-xl font-medium mb-4">Team Analysis</h3>
          <p className="text-text-dim text-sm mb-4">
            Compare team offensive efficiency, shot selection, and spacing across different zones.
          </p>
          <div className="space-y-2">
            {teams.slice(0, 5).map((team) => (
              <Link
                key={team.id}
                href={withSeason(`/teams/${team.id}`, season)}
                className="block group p-3 bg-surface-2/50 hover:bg-surface-2 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium group-hover:text-accent transition-colors">
                    {team.school}
                  </span>
                  <span className="text-xs text-text-dim">
                    {team._count.players} players →
                  </span>
                </div>
              </Link>
            ))}
            <Link
              href={withSeason('/teams', season)}
              className="block text-accent text-sm hover:text-text transition-colors mt-3"
            >
              View all teams →
            </Link>
          </div>
        </div>

        <div className="bg-surface border border-border p-6">
          <h3 className="display text-xl font-medium mb-4">Player Analysis</h3>
          <p className="text-text-dim text-sm mb-4">
            Individual shot charts, efficiency metrics, and shooting tendencies by location.
          </p>
          <div className="space-y-2">
            {topShooters.slice(0, 5).map((player) => (
              <Link
                key={player.id}
                href={withSeason(`/players/${player.id}`, season)}
                className="block group p-3 bg-surface-2/50 hover:bg-surface-2 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium group-hover:text-accent transition-colors">
                      {player.name}
                    </span>
                    {player.team && (
                      <span className="text-xs text-text-dim ml-2">
                        {player.team.abbreviation}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-text-dim">
                    {player._count.plays} shots →
                  </span>
                </div>
              </Link>
            ))}
            <Link
              href={withSeason('/players', season)}
              className="block text-accent text-sm hover:text-text transition-colors mt-3"
            >
              View all players →
            </Link>
          </div>
        </div>
      </div>

      {/* Team Grid */}
      <div>
        <h2 className="display text-2xl font-medium mb-6">Explore by Team</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {teams.map((team) => (
            <Link
              key={team.id}
              href={withSeason(`/teams/${team.id}`, season)}
              className="group bg-surface hover:bg-surface-2 transition-colors p-4 border border-border hover:border-accent"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium group-hover:text-accent transition-colors">
                  {team.school}
                </h3>
                <div className="text-xs text-text-dim">
                  {team._count.players} players
                </div>
              </div>
              <div className="text-sm text-text-dim mb-3">
                {team.displayName || team.school}
              </div>
              <div className="text-xs text-accent group-hover:text-text transition-colors">
                View Shot Quality →
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Model Info */}
      <div className="mt-8 p-4 bg-surface-2/30 border border-border text-sm text-text-dim">
        <strong className="text-text">Model Details:</strong> The xeFG model is trained on play-by-play data
        including shot coordinates, defender proximity, shot clock, and game situation. It outputs the probability
        of each shot attempt resulting in a made field goal, allowing comparison of actual vs expected performance.
      </div>
    </main>
  );
}