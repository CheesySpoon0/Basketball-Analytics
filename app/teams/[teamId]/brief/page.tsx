import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '../../../../lib/prisma';
import { CoachBriefView } from '../../../../components/CoachBriefView';
import { SeasonSelector } from '../../../../components/SeasonSelector';
import { resolveSeason, seasonLabel, withSeason } from '../../../../lib/season';

export const dynamic = 'force-dynamic';

const UCI_TEAM_ID = 308;

export default async function CoachBriefPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { teamId: teamIdStr } = await params;
  const teamId = parseInt(teamIdStr, 10);
  if (Number.isNaN(teamId)) notFound();

  // No brief for UCI itself
  if (teamId === UCI_TEAM_ID) notFound();

  const season = resolveSeason(await searchParams);

  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) notFound();

  return (
    <main className="max-w-[1100px] mx-auto px-6 lg:px-8 py-12 lg:py-16">
      {/* Breadcrumb + Season selector */}
      <div className="flex items-center justify-between gap-4 mb-8 flex-wrap">
        <div className="mono text-[11px] uppercase tracking-[0.2em] text-text-dim">
          <Link href={withSeason('/', season)} className="hover:text-text transition-colors">
            Conference
          </Link>
          <span className="mx-2 opacity-40">/</span>
          <Link
            href={withSeason(`/teams/${teamId}`, season)}
            className="hover:text-text transition-colors"
          >
            {team.abbreviation ?? team.school}
          </Link>
          <span className="mx-2 opacity-40">/</span>
          <span>Coach Brief</span>
        </div>
        <SeasonSelector season={season} />
      </div>

      {/* Header */}
      <header className="mb-10 pb-6 border-b border-border">
        <div className="mono text-[11px] uppercase tracking-[0.25em] text-text-dim mb-3">
          Scouting Brief · UC Irvine vs Opponent · {seasonLabel(season)}
        </div>
        <h1 className="display text-[44px] sm:text-[56px] leading-[0.95] tracking-tight font-medium">
          {team.school}
        </h1>
        {team.mascot && (
          <div className="text-text-dim text-lg mt-2">{team.mascot}</div>
        )}
      </header>

      <CoachBriefView teamId={teamId} opponentName={team.school} season={season} />
    </main>
  );
}
