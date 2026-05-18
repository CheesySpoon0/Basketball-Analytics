import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '../../../lib/prisma';

export const dynamic = 'force-dynamic';

const SEASON = 2025;

export default async function TeamPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId: teamIdStr } = await params;
  const teamId = parseInt(teamIdStr, 10);
  if (Number.isNaN(teamId)) notFound();

  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) notFound();

  const teamStats = await prisma.teamSeasonStats.findUnique({
    where: { teamId_season: { teamId, season: SEASON } },
  });

  const roster = await prisma.player.findMany({
    where: { teamId },
    include: {
      seasonStats: {
        where: { season: SEASON },
      },
    },
  });

  // Sort roster by season points (those who played most), then by name
  const rosterSorted = roster
    .map((p) => ({
      ...p,
      stats: p.seasonStats[0] ?? null,
    }))
    .sort((a, b) => {
      const ap = a.stats?.points ?? -1;
      const bp = b.stats?.points ?? -1;
      if (ap !== bp) return bp - ap;
      return (a.lastName ?? '').localeCompare(b.lastName ?? '');
    });

  const accentColor = team.primaryColor ? `#${team.primaryColor}` : 'var(--accent)';
  const winPct = teamStats && (teamStats.games ?? 0) > 0 ? (teamStats.wins ?? 0) / (teamStats.games ?? 1) : 0;
  const ppg = teamStats && (teamStats.games ?? 0) > 0 ? (teamStats.pointsTotal ?? 0) / (teamStats.games ?? 1) : 0;
  const fgPct =
    teamStats && (teamStats.fieldGoalsAttempted ?? 0) > 0
      ? (teamStats.fieldGoalsMade ?? 0) / (teamStats.fieldGoalsAttempted ?? 1)
      : null;
  const threePct =
    teamStats && (teamStats.threePointsAttempted ?? 0) > 0
      ? (teamStats.threePointsMade ?? 0) / (teamStats.threePointsAttempted ?? 1)
      : null;

  return (
    <main className="max-w-[1400px] mx-auto px-6 lg:px-8 py-12 lg:py-16">
      {/* Breadcrumb */}
      <div className="mono text-[11px] uppercase tracking-[0.2em] text-text-dim mb-8">
        <Link href="/" className="hover:text-text transition-colors">Conference</Link>
        <span className="mx-2 opacity-40">/</span>
        <span>{team.abbreviation ?? team.school}</span>
      </div>

      {/* Header */}
      <header className="mb-12 lg:mb-16 grid lg:grid-cols-[1fr_auto] gap-8 items-end pb-8 border-b border-border">
        <div className="relative">
          <div
            className="absolute -left-6 top-2 bottom-2 w-[3px]"
            style={{ backgroundColor: accentColor }}
          />
          <div className="mono text-[11px] uppercase tracking-[0.2em] text-text-dim mb-2">
            {team.conference ?? 'Independent'} · {SEASON - 1}–{String(SEASON).slice(2)}
          </div>
          <h1 className="display text-[56px] sm:text-[72px] leading-[0.95] tracking-tight font-medium">
            {team.school}
          </h1>
          {team.mascot && (
            <div className="text-text-dim text-lg mt-3">{team.mascot}</div>
          )}
        </div>

        {teamStats && (
          <div className="grid grid-cols-4 lg:grid-cols-2 gap-x-10 gap-y-6 lg:min-w-[280px]">
            <div>
              <div className="stat-label">Record</div>
              <div className="mono text-3xl tabular-nums mt-1">{teamStats.wins}-{teamStats.losses}</div>
            </div>
            <div>
              <div className="stat-label">Win %</div>
              <div className="mono text-3xl tabular-nums mt-1">{(winPct * 100).toFixed(1)}</div>
            </div>
            <div>
              <div className="stat-label">PPG</div>
              <div className="mono text-3xl tabular-nums mt-1">{ppg.toFixed(1)}</div>
            </div>
            <div>
              <div className="stat-label">FG%</div>
              <div className="mono text-3xl tabular-nums mt-1">{fgPct !== null ? (fgPct * 100).toFixed(1) : '—'}</div>
            </div>
          </div>
        )}
      </header>

      {/* Roster */}
      <section>
        <div className="flex items-baseline justify-between mb-6 pb-3 border-b border-border">
          <h2 className="display text-2xl font-medium">Roster</h2>
          <span className="mono text-[11px] uppercase tracking-widest text-text-dim">
            {rosterSorted.length} Players · Sorted by Points
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-border">
          {rosterSorted.map((p) => {
            const s = p.stats;
            const played = s !== null && (s.games ?? 0) > 0;
            const ppg = played ? (s!.points ?? 0) / (s!.games ?? 1) : 0;
            const rpg = played ? (s!.rebounds ?? 0) / (s!.games ?? 1) : 0;
            const apg = played ? (s!.assists ?? 0) / (s!.games ?? 1) : 0;
            return (
              <Link
                key={p.id}
                href={`/players/${p.id}`}
                className="block bg-surface hover:bg-surface-2 transition-colors p-5"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      {p.jersey && (
                        <span className="mono text-text-dim text-xs tabular-nums">#{p.jersey}</span>
                      )}
                      <span className="mono text-[10px] uppercase tracking-widest text-text-dim">
                        {p.position ?? '—'}
                      </span>
                    </div>
                    <div className="display text-xl font-medium mt-1 leading-tight truncate">
                      {p.name ?? `${p.firstName} ${p.lastName}`}
                    </div>
                  </div>
                  {played && (
                    <div className="text-right shrink-0">
                      <div className="mono text-2xl tabular-nums font-medium">{ppg.toFixed(1)}</div>
                      <div className="stat-label mt-0.5">PPG</div>
                    </div>
                  )}
                </div>

                {played ? (
                  <div className="grid grid-cols-3 gap-3 pt-3 border-t border-border">
                    <div>
                      <div className="stat-label">G</div>
                      <div className="mono text-sm tabular-nums mt-0.5">{s!.games}</div>
                    </div>
                    <div>
                      <div className="stat-label">RPG</div>
                      <div className="mono text-sm tabular-nums mt-0.5">{rpg.toFixed(1)}</div>
                    </div>
                    <div>
                      <div className="stat-label">APG</div>
                      <div className="mono text-sm tabular-nums mt-0.5">{apg.toFixed(1)}</div>
                    </div>
                  </div>
                ) : (
                  <div className="pt-3 border-t border-border mono text-xs text-text-dim">
                    No stats recorded
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
