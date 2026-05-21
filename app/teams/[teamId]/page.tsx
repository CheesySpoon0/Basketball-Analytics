import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '../../../lib/prisma';
import { TeamShotHeatmap, type AggregateShot } from '../../../components/TeamShotHeatmap';
import { UciMatchup } from '../../../components/UciMatchup';
import { TeamShotQualityPanel } from '../../../components/ShotQualityPanel';
import { SeasonSelector } from '../../../components/SeasonSelector';
import { buildTeamHeatmapShots, getTeamXeFGCached } from '../../../lib/xefg';
import { shotDistanceFt } from '../../../components/Court';
import { resolveSeason, seasonLabel, withSeason } from '../../../lib/season';
import {
  buildMatchupData,
  runTacticalEngine,
  partitionFiredRules,
} from '../../../lib/tactical-engine';

export const dynamic = 'force-dynamic';

type Zone = 'rim' | 'mid' | 'three';

function classifyZone(range: string | null, rawX: number, rawY: number): Zone {
  if (range === 'three_pointer') return 'three';
  if (range === 'rim') return 'rim';
  const dist = shotDistanceFt(rawX, rawY);
  if (dist < 4) return 'rim';
  return 'mid';
}

function pct(num: number, den: number): number | null {
  if (!den) return null;
  return num / den;
}

function fmtPct(p: number | null, digits = 1): string {
  return p === null ? '—' : `${(p * 100).toFixed(digits)}`;
}

function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toFixed(digits);
}

// ============================================================================
// Stat card primitives
// ============================================================================

function StatBlock({
  label,
  value,
  hint,
  estimated,
  unavailable,
}: {
  label: string;
  value: string;
  hint?: string;
  estimated?: boolean;
  unavailable?: boolean;
}) {
  return (
    <div className="p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="stat-label">{label}</div>
        {estimated && (
          <span className="mono text-[9px] uppercase tracking-widest text-text-dim border border-border px-1.5 py-0.5">
            EST
          </span>
        )}
      </div>
      <div
        className={[
          'mono text-2xl tabular-nums mt-1',
          unavailable ? 'text-text-dim' : 'text-text',
        ].join(' ')}
      >
        {value}
      </div>
      {hint && <div className="mono text-[10px] text-text-dim mt-1">{hint}</div>}
    </div>
  );
}

// ============================================================================
// Page
// ============================================================================

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { teamId: teamIdStr } = await params;
  const teamId = parseInt(teamIdStr, 10);
  if (Number.isNaN(teamId)) notFound();

  const SEASON = resolveSeason(await searchParams);

  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) notFound();

  // ------- Pull data -------
  const teamStats = await prisma.teamSeasonStats.findUnique({
    where: { teamId_season: { teamId, season: SEASON } },
  });

  // All field-goal attempts taken BY this team this season (with coords).
  // Excludes free_throw rows: those have coords but are not FGAs.
  const shotPlays = await prisma.play.findMany({
    where: {
      teamId,
      shotX: { not: null },
      shotY: { not: null },
      shotRange: { not: 'free_throw' },
      game: { season: SEASON },
    },
    select: {
      shotX: true,
      shotY: true,
      shotMade: true,
      shotRange: true,
    },
  });

  // For opponent PPG: max(home/awayScore) per game, sum the side that wasn't us
  // We do this in two steps to keep the query simple & correct.
  const ourGames = await prisma.game.findMany({
    where: {
      season: SEASON,
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
    },
    select: { id: true, homeTeamId: true, awayTeamId: true },
  });
  const gameIds = ourGames.map((g) => g.id);

  // groupBy maxes of homeScore / awayScore per gameId across plays
  const gameScoreRows =
    gameIds.length > 0
      ? await prisma.play.groupBy({
          by: ['gameId'],
          where: { gameId: { in: gameIds } },
          _max: { homeScore: true, awayScore: true },
        })
      : [];
  const scoresByGame = new Map(
    gameScoreRows.map((r) => [r.gameId, { home: r._max.homeScore ?? 0, away: r._max.awayScore ?? 0 }])
  );

  let oppPointsTotal = 0;
  let gamesWithFinalScore = 0;
  for (const g of ourGames) {
    const s = scoresByGame.get(g.id);
    if (!s) continue;
    const oppScore = g.homeTeamId === teamId ? s.away : s.home;
    if (oppScore > 0) {
      oppPointsTotal += oppScore;
      gamesWithFinalScore++;
    }
  }
  const oppPpg = gamesWithFinalScore > 0 ? oppPointsTotal / gamesWithFinalScore : null;

  // Roster + per-player season stats
  const roster = await prisma.player.findMany({
    where: { teamId },
    include: { seasonStats: { where: { season: SEASON } } },
  });

  // UCI matchup data (only fetch if this is not UCI)
  const UCI_TEAM_ID = 308;
  const isUci = teamId === UCI_TEAM_ID;
  let uciStats = null;
  let uciShotPlays: any[] = [];

  if (!isUci) {
    // Fetch UCI's team stats
    uciStats = await prisma.teamSeasonStats.findUnique({
      where: { teamId_season: { teamId: UCI_TEAM_ID, season: SEASON } },
    });

    // Fetch UCI's shot plays for zone analysis
    uciShotPlays = await prisma.play.findMany({
      where: {
        teamId: UCI_TEAM_ID,
        shotX: { not: null },
        shotY: { not: null },
        shotRange: { not: 'free_throw' },
        game: { season: SEASON },
      },
      select: {
        shotX: true,
        shotY: true,
        shotMade: true,
        shotRange: true,
      },
    });
  }

  const rosterRows = roster
    .map((p) => ({ ...p, stats: p.seasonStats[0] ?? null }))
    .sort((a, b) => {
      const ap = a.stats?.points ?? -1;
      const bp = b.stats?.points ?? -1;
      if (ap !== bp) return bp - ap;
      return (a.lastName ?? '').localeCompare(b.lastName ?? '');
    });

  const topFive = rosterRows.filter((r) => r.stats && (r.stats.games ?? 0) > 0).slice(0, 5);

  // ------- Core team derived metrics -------
  const games = teamStats?.games ?? 0;
  const wins = teamStats?.wins ?? 0;
  const losses = teamStats?.losses ?? 0;
  const fga = teamStats?.fieldGoalsAttempted ?? 0;
  const fgm = teamStats?.fieldGoalsMade ?? 0;
  const tpa = teamStats?.threePointsAttempted ?? 0;
  const tpm = teamStats?.threePointsMade ?? 0;
  const fta = teamStats?.freeThrowsAttempted ?? 0;
  const oreb = teamStats?.offensiveRebounds ?? 0;
  const to = teamStats?.turnoversTotal ?? 0;
  const pointsTotal = teamStats?.pointsTotal ?? 0;

  const winPct = games > 0 ? wins / games : 0;
  const ppg = games > 0 ? pointsTotal / games : null;
  const fgPct = pct(fgm, fga);
  const efg = fga > 0 ? (fgm + 0.5 * tpm) / fga : null;
  const ftr = fga > 0 ? fta / fga : null;
  // One-sided possession estimate (own team only)
  const possessionsTotal = fga + 0.44 * fta - oreb + to;
  const tovPct = possessionsTotal > 0 ? to / possessionsTotal : null;
  const ortg = possessionsTotal > 0 ? (pointsTotal / possessionsTotal) * 100 : null;
  const paceEst = games > 0 ? possessionsTotal / games : null;

  // Defensive metrics using opponent stats
  const oppDreb = teamStats?.oppDefensiveRebounds ?? 0;
  const orebPct = (oreb + oppDreb) > 0 ? oreb / (oreb + oppDreb) : null;
  const oppPoints = teamStats?.oppPoints ?? 0;
  const oppPoss = teamStats?.oppPossessions ?? 0;
  const drtg = oppPoss > 0 ? (oppPoints / oppPoss) * 100 : null;

  // ------- Shot profile from Play rows -------
  type ZoneAgg = { att: number; made: number };
  const zones: Record<Zone, ZoneAgg> = {
    rim: { att: 0, made: 0 },
    mid: { att: 0, made: 0 },
    three: { att: 0, made: 0 },
  };
  for (const p of shotPlays) {
    const z = classifyZone(p.shotRange, p.shotX!, p.shotY!);
    zones[z].att++;
    if (p.shotMade) zones[z].made++;
  }
  const shotTotal = shotPlays.length;

  const heatmapShots = await buildTeamHeatmapShots(teamId, SEASON);
  const aggregateShots: AggregateShot[] = heatmapShots;

  // Process UCI zone data for matchup analysis
  let uciZones: Record<Zone, { att: number; made: number }> = {
    rim: { att: 0, made: 0 },
    mid: { att: 0, made: 0 },
    three: { att: 0, made: 0 },
  };

  if (!isUci && uciShotPlays.length > 0) {
    for (const p of uciShotPlays) {
      const z = classifyZone(p.shotRange, p.shotX!, p.shotY!);
      uciZones[z].att++;
      if (p.shotMade) uciZones[z].made++;
    }
  }

  // Tactical engine (only for opponent pages — runs server-side, top 8 rules).
  // UCI is the subject (scouted FOR); the page's team becomes the opponent.
  // The engine itself is team-agnostic — UCI_TEAM_ID lives only in this UI layer.
  let attackRules: ReturnType<typeof partitionFiredRules>['attack'] = [];
  let defendRules: ReturnType<typeof partitionFiredRules>['defend'] = [];
  if (!isUci) {
    const matchup = await buildMatchupData(UCI_TEAM_ID, teamId, SEASON);
    if (matchup) {
      const fired = runTacticalEngine(matchup, { maxResults: 8 });
      ({ attack: attackRules, defend: defendRules } = partitionFiredRules(fired));
    }
  }

  const [teamXeFGOffense, teamXeFGDefense] = await Promise.all([
    getTeamXeFGCached(teamId, SEASON, 'offense'),
    getTeamXeFGCached(teamId, SEASON, 'defense'),
  ]);

  const accentColor = team.primaryColor ? `#${team.primaryColor}` : 'var(--accent)';

  return (
    <main className="max-w-[1400px] mx-auto px-6 lg:px-8 py-12 lg:py-16">
      {/* Breadcrumb + Season selector + Coach Brief CTA */}
      <div className="flex items-center justify-between mb-8 gap-4 flex-wrap">
        <div className="mono text-[11px] uppercase tracking-[0.2em] text-text-dim">
          <Link href={withSeason('/', SEASON)} className="hover:text-text transition-colors">
            Conference
          </Link>
          <span className="mx-2 opacity-40">/</span>
          <span>{team.abbreviation ?? team.school}</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <SeasonSelector season={SEASON} />
          {!isUci && (
            <Link
              href={withSeason(`/teams/${teamId}/brief`, SEASON)}
              className="mono text-[11px] uppercase tracking-widest px-3 py-1.5 border border-accent text-accent hover:bg-accent hover:text-bg transition-colors"
            >
              View Coach Brief →
            </Link>
          )}
        </div>
      </div>

      {/* 1. Identity header */}
      <header className="mb-12 lg:mb-16 grid lg:grid-cols-[1fr_auto] gap-8 items-end pb-8 border-b border-border">
        <div className="relative">
          <div
            className="absolute -left-6 top-2 bottom-2 w-[3px]"
            style={{ backgroundColor: accentColor }}
          />
          <div className="mono text-[11px] uppercase tracking-[0.2em] text-text-dim mb-2">
            {team.conference ?? 'Independent'} · {seasonLabel(SEASON)}
          </div>
          <h1 className="display text-[56px] sm:text-[72px] leading-[0.95] tracking-tight font-medium">
            {team.school}
          </h1>
          {team.mascot && <div className="text-text-dim text-lg mt-3">{team.mascot}</div>}
        </div>

        {teamStats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-4 lg:min-w-[480px]">
            <div>
              <div className="stat-label">Record</div>
              <div className="mono text-3xl tabular-nums mt-1">{wins}-{losses}</div>
            </div>
            <div>
              <div className="stat-label">Win %</div>
              <div className="mono text-3xl tabular-nums mt-1">{(winPct * 100).toFixed(1)}</div>
            </div>
            <div>
              <div className="stat-label">PPG</div>
              <div className="mono text-3xl tabular-nums mt-1">{fmtNum(ppg)}</div>
            </div>
            <div>
              <div className="stat-label">Opp PPG</div>
              <div className="mono text-3xl tabular-nums mt-1">{fmtNum(oppPpg)}</div>
            </div>
          </div>
        )}
      </header>

      {/* 2. Four Factors + Ratings */}
      <section className="mb-14">
        <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-border">
          <h2 className="display text-2xl font-medium">Four Factors & Ratings</h2>
          <span className="mono text-[11px] uppercase tracking-widest text-text-dim">
            Season totals · EST = derived from one-sided possessions
          </span>
        </div>

        <div className="bg-surface border border-border">
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y divide-border">
            <StatBlock
              label="eFG%"
              value={fmtPct(efg)}
              hint="(FGM + 0.5·3PM) / FGA"
            />
            <StatBlock
              label="TOV%"
              value={fmtPct(tovPct)}
              hint="TO / possessions"
              estimated
            />
            <StatBlock
              label="OREB%"
              value={fmtPct(orebPct)}
              hint="OREB / (OREB + opp DREB)"
            />
            <StatBlock
              label="FTR"
              value={fmtPct(ftr)}
              hint="FTA / FGA"
            />
            <StatBlock
              label="ORtg"
              value={fmtNum(ortg)}
              hint="100 · pts / possessions"
              estimated
            />
            <StatBlock
              label="DRtg"
              value={fmtNum(drtg)}
              hint="100 · opp pts / opp possessions"
            />
            <StatBlock
              label="Pace"
              value={fmtNum(paceEst)}
              hint="Own poss / game"
              estimated
            />
            <StatBlock
              label="Possessions"
              value={fmtNum(possessionsTotal, 0)}
              hint="FGA + 0.44·FTA − OREB + TO"
              estimated
            />
          </div>
        </div>
      </section>

      {/* Shot quality (xeFG) */}
      {(teamXeFGOffense || teamXeFGDefense) && (
        <section className="mb-14">
          <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-border">
            <h2 className="display text-2xl font-medium">Shot Quality</h2>
            <span className="mono text-[11px] uppercase tracking-widest text-text-dim">
              actual eFG% vs expected eFG% (xeFG)
            </span>
          </div>
          <div className="bg-surface border border-border">
            <TeamShotQualityPanel offense={teamXeFGOffense} defense={teamXeFGDefense} />
          </div>
        </section>
      )}

      {/* 3 + 4. Shot profile + aggregate chart */}
      <section className="mb-14">
        <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-border">
          <h2 className="display text-2xl font-medium">Shot Profile</h2>
          <span className="mono text-[11px] uppercase tracking-widest text-text-dim">
            {shotTotal.toLocaleString()} shots with coordinates
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(0,1.5fr)] gap-8 lg:gap-12">
          {/* Zone table */}
          <div className="bg-surface border border-border">
            <table className="w-full mono tabular-nums text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="stat-label py-3 px-4">Zone</th>
                  <th className="stat-label py-3 px-4 text-right">% Shots</th>
                  <th className="stat-label py-3 px-4 text-right">FG%</th>
                  <th className="stat-label py-3 px-4 text-right">Pts/Shot</th>
                </tr>
              </thead>
              <tbody>
                {(['rim', 'mid', 'three'] as const).map((k) => {
                  const z = zones[k];
                  const share = shotTotal > 0 ? z.att / shotTotal : 0;
                  const zPct = z.att > 0 ? z.made / z.att : 0;
                  const pps =
                    z.att > 0 ? ((k === 'three' ? 3 : 2) * z.made) / z.att : 0;
                  const label = k === 'rim' ? 'At Rim' : k === 'mid' ? 'Mid-Range' : '3-Point';
                  return (
                    <tr key={k} className="border-b border-border last:border-b-0 hover:bg-surface-2 transition-colors">
                      <td className="py-3 px-4 font-medium text-text">{label}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-text-dim">{(share * 100).toFixed(1)}%</span>
                          <span className="inline-block h-1 w-14 bg-border overflow-hidden">
                            <span className="block h-full" style={{ width: `${share * 100}%`, backgroundColor: accentColor }} />
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">{(zPct * 100).toFixed(1)}</td>
                      <td className="py-3 px-4 text-right">{pps.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="border-t border-border p-4 text-[11px] text-text-dim leading-relaxed">
              Zones: <span className="text-text">Rim</span> = <code className="mono">range = rim</code> or &lt; 4 ft.{' '}
              <span className="text-text">Mid</span> = inside the arc &amp; not at rim.{' '}
              <span className="text-text">3-Point</span> = <code className="mono">range = three_pointer</code>.
            </div>
          </div>

          {/* Aggregate shot chart (heatmap) */}
          <div>
            <div className="mono text-[10px] uppercase tracking-[0.25em] text-text-dim mb-3 flex items-center justify-between">
              <span>Aggregate Shot Locations</span>
              <span>{shotTotal.toLocaleString()} FGA</span>
            </div>
            <div className="bg-surface border border-border">
              <TeamShotHeatmap shots={aggregateShots} />
            </div>
          </div>
        </div>
      </section>

      {/* UCI Matchup Analysis (only for non-UCI teams) */}
      {!isUci && uciStats && (
        <UciMatchup
          uciStats={uciStats}
          opponentStats={teamStats}
          uciZones={uciZones}
          opponentZones={zones}
          opponentTeamName={team.school}
          attackRules={attackRules}
          defendRules={defendRules}
        />
      )}

      {/* 5. Top players */}
      <section className="mb-14">
        <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-border">
          <h2 className="display text-2xl font-medium">Top Players</h2>
          <span className="mono text-[11px] uppercase tracking-widest text-text-dim">By total points</span>
        </div>

        {topFive.length === 0 ? (
          <div className="bg-surface border border-border p-6 text-text-dim text-sm">
            No player season stats recorded yet.
          </div>
        ) : (
          <div className="bg-surface border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="stat-label py-3 px-4 w-10">#</th>
                  <th className="stat-label py-3 px-4">Player</th>
                  <th className="stat-label py-3 px-4">Pos</th>
                  <th className="stat-label py-3 px-4 text-right">PPG</th>
                  <th className="stat-label py-3 px-4 text-right">RPG</th>
                  <th className="stat-label py-3 px-4 text-right">APG</th>
                  <th className="stat-label py-3 px-4 text-right">FG%</th>
                  <th className="stat-label py-3 px-4 text-right">3PT%</th>
                </tr>
              </thead>
              <tbody>
                {topFive.map((p, i) => {
                  const s = p.stats!;
                  const g = s.games ?? 1;
                  const pp = (s.points ?? 0) / g;
                  const rp = (s.rebounds ?? 0) / g;
                  const ap = (s.assists ?? 0) / g;
                  const fgp = pct(s.fieldGoalsMade ?? 0, s.fieldGoalsAttempted ?? 0);
                  const tpp = pct(s.threePointsMade ?? 0, s.threePointsAttempted ?? 0);
                  return (
                    <tr key={p.id} className="border-b border-border last:border-b-0 hover:bg-surface-2 transition-colors">
                      <td className="py-3 px-4 mono tabular-nums text-text-dim">{i + 1}</td>
                      <td className="py-3 px-4">
                        <Link href={withSeason(`/players/${p.id}/report`, SEASON)} className="hover:text-accent transition-colors">
                          <span className="display font-medium">{p.name}</span>
                          {p.jersey && (
                            <span className="ml-2 mono text-xs tabular-nums text-text-dim">#{p.jersey}</span>
                          )}
                          <span className="ml-2 mono text-[10px] uppercase tracking-widest text-text-dim">
                            Report →
                          </span>
                        </Link>
                      </td>
                      <td className="py-3 px-4 mono text-xs text-text-dim uppercase tracking-widest">{p.position ?? '—'}</td>
                      <td className="py-3 px-4 mono tabular-nums text-right font-medium">{pp.toFixed(1)}</td>
                      <td className="py-3 px-4 mono tabular-nums text-right">{rp.toFixed(1)}</td>
                      <td className="py-3 px-4 mono tabular-nums text-right">{ap.toFixed(1)}</td>
                      <td className="py-3 px-4 mono tabular-nums text-right">{fmtPct(fgp)}</td>
                      <td className="py-3 px-4 mono tabular-nums text-right">{fmtPct(tpp)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 6. Roster (preserved from prior version) */}
      <section>
        <div className="flex items-baseline justify-between mb-6 pb-3 border-b border-border">
          <h2 className="display text-2xl font-medium">Roster</h2>
          <span className="mono text-[11px] uppercase tracking-widest text-text-dim">
            {rosterRows.length} Players · Sorted by Points
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-border">
          {rosterRows.map((p) => {
            const s = p.stats;
            const played = s !== null && (s.games ?? 0) > 0;
            const ppg = played ? (s!.points ?? 0) / (s!.games ?? 1) : 0;
            const rpg = played ? (s!.rebounds ?? 0) / (s!.games ?? 1) : 0;
            const apg = played ? (s!.assists ?? 0) / (s!.games ?? 1) : 0;
            return (
              <Link
                key={p.id}
                href={withSeason(`/players/${p.id}/report`, SEASON)}
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
