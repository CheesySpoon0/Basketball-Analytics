import Link from 'next/link';
import { prisma } from '../../lib/prisma';
import { SeasonSelector } from '../../components/SeasonSelector';
import { resolveSeason, withSeason } from '../../lib/season';

export const dynamic = 'force-dynamic';

const UCI_TEAM_ID = 308;

export default async function CoachBriefsHubPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const season = resolveSeason(await searchParams);

  // Get teams that UCI has played against or could play against
  const allTeams = await prisma.team.findMany({
    where: {
      id: { not: UCI_TEAM_ID }, // Exclude UCI itself
      teamSeasonStats: {
        some: { season }
      }
    },
    include: {
      teamSeasonStats: {
        where: { season }
      }
    },
    orderBy: { school: 'asc' }
  });

  // Get existing cached briefs
  const existingBriefs = await prisma.coachBriefCache.findMany({
    where: { season }
  });

  // Get team data for existing briefs
  const briefTeamIds = existingBriefs.map(brief => brief.opponentTeamId);
  const briefTeams = briefTeamIds.length > 0 ? await prisma.team.findMany({
    where: { id: { in: briefTeamIds } }
  }) : [];
  const briefTeamsMap = new Map(briefTeams.map(team => [team.id, team]));

  // Add team data to briefs
  const briefsWithTeams = existingBriefs.map(brief => ({
    ...brief,
    team: briefTeamsMap.get(brief.opponentTeamId)!
  }));

  const briefsByTeamId = new Map(
    existingBriefs.map(brief => [brief.opponentTeamId, brief])
  );

  return (
    <main className="max-w-[1400px] mx-auto px-6 lg:px-8 py-8 lg:py-12">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-8 flex-wrap">
        <div>
          <div className="mono text-[11px] uppercase tracking-[0.2em] text-text-dim mb-2">
            Coaching Intelligence Hub
          </div>
          <h1 className="display text-[44px] sm:text-[56px] leading-[0.95] tracking-tight font-medium">
            Coach Briefs
          </h1>
          <p className="text-text-dim mt-4 max-w-2xl">
            AI-generated scouting reports with tactical breakdowns, player matchups, and strategic recommendations.
            Select an opponent to generate or view an existing brief.
          </p>
        </div>
        <SeasonSelector season={season} />
      </div>

      {/* Brief Overview */}
      <div className="bg-surface-2/50 border border-border p-6 mb-8">
        <h2 className="display text-xl font-medium mb-4">What's in a Coach Brief</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 text-sm">
          <div>
            <h3 className="font-medium text-accent mb-2">Team Analysis</h3>
            <p className="text-text-dim leading-relaxed">
              Opponent strengths, weaknesses, and key statistical tendencies based on season performance.
            </p>
          </div>
          <div>
            <h3 className="font-medium text-blue-400 mb-2">Player Matchups</h3>
            <p className="text-text-dim leading-relaxed">
              Impact metrics (RAPM), scoring patterns, and individual player scouting notes.
            </p>
          </div>
          <div>
            <h3 className="font-medium text-green-400 mb-2">Tactical Insights</h3>
            <p className="text-text-dim leading-relaxed">
              Lineup preferences, shot selection patterns, and strategic recommendations.
            </p>
          </div>
          <div>
            <h3 className="font-medium text-orange-400 mb-2">Game Plan</h3>
            <p className="text-text-dim leading-relaxed">
              Specific offensive and defensive strategies tailored to exploit opponent weaknesses.
            </p>
          </div>
        </div>
      </div>

      {/* Existing Briefs */}
      {briefsWithTeams.length > 0 && (
        <div className="mb-8">
          <h2 className="display text-2xl font-medium mb-4">Recent Briefs</h2>
          <div className="bg-surface border border-border">
            <div className="divide-y divide-border">
              {briefsWithTeams.slice(0, 5).map((brief) => (
                <div key={brief.id} className="p-4 hover:bg-surface-2 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-text mb-1">
                        UC Irvine vs {brief.team.school}
                      </h3>
                      <div className="text-sm text-text-dim">
                        Generated {new Date(brief.generatedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <Link
                      href={withSeason(`/teams/${brief.opponentTeamId}/brief`, season)}
                      className="px-4 py-2 bg-accent text-bg text-sm font-medium hover:bg-accent/90 transition-colors"
                    >
                      View Brief
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Team Selection */}
      <div>
        <h2 className="display text-2xl font-medium mb-4">Generate New Brief</h2>
        <p className="text-text-dim mb-6">
          Select an opponent to generate a new scouting brief or view an existing one.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {allTeams.map((team) => {
            const existingBrief = briefsByTeamId.get(team.id);
            const stats = team.teamSeasonStats[0];

            return (
              <Link
                key={team.id}
                href={withSeason(`/teams/${team.id}/brief`, season)}
                className="group bg-surface hover:bg-surface-2 transition-colors p-4 border border-border hover:border-accent"
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium group-hover:text-accent transition-colors">
                    {team.school}
                  </h3>
                  {existingBrief && (
                    <div className="w-2 h-2 bg-accent rounded-full" title="Brief available"></div>
                  )}
                </div>

                <div className="text-sm text-text-dim mb-3">
                  {team.displayName || team.school}
                </div>

                {stats && (
                  <div className="text-xs text-text-dim mb-3">
                    {stats.wins}-{stats.losses} • {stats.games} games
                  </div>
                )}

                <div className="text-xs transition-colors">
                  {existingBrief ? (
                    <span className="text-accent group-hover:text-text">
                      View Brief →
                    </span>
                  ) : (
                    <span className="text-blue-400 group-hover:text-text">
                      Generate Brief →
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Note about UCI */}
      <div className="mt-8 p-4 bg-surface-2/30 border border-border text-sm text-text-dim">
        <strong className="text-text">Note:</strong> Briefs are generated from the perspective of UC Irvine (UCI)
        coaching staff preparing to face the selected opponent. All strategic recommendations are tailored for UCI's
        roster and playing style.
      </div>
    </main>
  );
}