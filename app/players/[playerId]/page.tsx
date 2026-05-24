import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '../../../lib/prisma';
import { SeasonSelector } from '../../../components/SeasonSelector';
import { resolveSeason, seasonLabel, withSeason } from '../../../lib/season';
import { ShotChartView, type Shot } from './ShotChartView';

export const dynamic = 'force-dynamic';

type ZoneStats = { att: number; made: number; pct: number };

function zone(range: string | null, distFt: number): 'rim' | 'mid' | 'three' {
  if (range === 'three_pointer') return 'three';
  if (range === 'rim' || distFt < 4) return 'rim';
  return 'mid';
}

function shotDistance(rawX: number, rawY: number): number {
  // Match transform: mirror, basket at (250, 297.5) in 0..350 SVG
  // After flip: svgX = rawY, svgY = 350 - (rawX > 470 ? 940 - rawX : rawX)
  const courtX = rawX > 470 ? 940 - rawX : rawX;
  const svgX = rawY;
  const svgY = 350 - courtX;
  const dx = svgX - 250;
  const dy = svgY - 297.5;
  return Math.sqrt(dx * dx + dy * dy) / 10;
}

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ playerId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { playerId: playerIdStr } = await params;
  const playerId = parseInt(playerIdStr, 10);
  if (Number.isNaN(playerId)) notFound();

  const SEASON = resolveSeason(await searchParams);

  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: { team: true },
  });
  if (!player) notFound();

  const seasonStats = await prisma.playerSeasonStats.findUnique({
    where: { playerId_season: { playerId, season: SEASON } },
  });

  const playerImpact = await prisma.playerImpact.findUnique({
    where: { playerId_season: { playerId, season: SEASON } },
  });

  const plays = await prisma.play.findMany({
    where: {
      playerId,
      shotX: { not: null },
      shotY: { not: null },
      game: { season: SEASON },
    },
    select: {
      id: true,
      shotX: true,
      shotY: true,
      shotMade: true,
      shotRange: true,
      scoreValue: true,
      gameId: true,
      game: { select: { startDate: true } },
    },
  });

  const shots: Shot[] = plays.map((p) => ({
    id: p.id,
    x: p.shotX!,
    y: p.shotY!,
    made: p.shotMade ?? false,
    range: p.shotRange,
    scoreValue: p.scoreValue,
    gameId: p.gameId,
    gameDate: p.game.startDate.toISOString(),
  }));

  const makes = shots.filter((s) => s.made).length;
  const total = shots.length;
  const misses = total - makes;
  const fgPct = total > 0 ? makes / total : 0;

  // Zone breakdown
  const zones: Record<'rim' | 'mid' | 'three', ZoneStats> = {
    rim: { att: 0, made: 0, pct: 0 },
    mid: { att: 0, made: 0, pct: 0 },
    three: { att: 0, made: 0, pct: 0 },
  };
  let twoPtMade = 0, twoPtAtt = 0, threePtMade = 0, threePtAtt = 0;
  for (const s of shots) {
    const z = zone(s.range, shotDistance(s.x, s.y));
    zones[z].att++;
    if (s.made) zones[z].made++;
    if (s.range === 'three_pointer') {
      threePtAtt++;
      if (s.made) threePtMade++;
    } else {
      twoPtAtt++;
      if (s.made) twoPtMade++;
    }
  }
  for (const k of Object.keys(zones) as Array<keyof typeof zones>) {
    zones[k].pct = zones[k].att > 0 ? zones[k].made / zones[k].att : 0;
  }

  // eFG%
  const efg = total > 0 ? (makes + 0.5 * threePtMade) / total : 0;

  const ppg = seasonStats && (seasonStats.games ?? 0) > 0 ? (seasonStats.points ?? 0) / (seasonStats.games ?? 1) : 0;
  const rpg = seasonStats && (seasonStats.games ?? 0) > 0 ? (seasonStats.rebounds ?? 0) / (seasonStats.games ?? 1) : 0;
  const apg = seasonStats && (seasonStats.games ?? 0) > 0 ? (seasonStats.assists ?? 0) / (seasonStats.games ?? 1) : 0;

  const accentColor = player.team?.primaryColor ? `#${player.team.primaryColor}` : 'var(--accent)';

  return (
    <main className="max-w-[1400px] mx-auto px-6 lg:px-8 py-10 lg:py-14">
      {/* Breadcrumb + Season selector */}
      <div className="flex items-center justify-between gap-4 mb-8 flex-wrap">
        <div className="mono text-[11px] uppercase tracking-[0.2em] text-text-dim">
          <Link href={withSeason('/', SEASON)} className="hover:text-text transition-colors">
            Conference
          </Link>
          <span className="mx-2 opacity-40">/</span>
          {player.team && (
            <>
              <Link
                href={withSeason(`/teams/${player.team.id}`, SEASON)}
                className="hover:text-text transition-colors"
              >
                {player.team.abbreviation ?? player.team.school}
              </Link>
              <span className="mx-2 opacity-40">/</span>
            </>
          )}
          <span>{player.name}</span>
        </div>
        <SeasonSelector season={SEASON} />
      </div>

      {/* Header */}
      <header className="mb-10 lg:mb-14 grid lg:grid-cols-[1fr_auto] gap-8 items-end pb-8 border-b border-border">
        <div className="relative">
          <div
            className="absolute -left-6 top-2 bottom-2 w-[3px]"
            style={{ backgroundColor: accentColor }}
          />
          <div className="mono text-[11px] uppercase tracking-[0.2em] text-text-dim mb-2 flex items-center gap-3">
            {player.jersey && <span className="tabular-nums">#{player.jersey}</span>}
            <span>{player.position ?? '—'}</span>
            <span className="opacity-40">·</span>
            {player.team && (
              <Link href={withSeason(`/teams/${player.team.id}`, SEASON)} className="hover:text-text transition-colors">
                {player.team.school}
              </Link>
            )}
          </div>
          <h1 className="display text-[56px] sm:text-[72px] leading-[0.95] tracking-tight font-medium">
            {player.name}
          </h1>
        </div>

        {seasonStats && (
          <div className="grid grid-cols-4 gap-x-8 gap-y-4 lg:min-w-[420px]">
            <div>
              <div className="stat-label">PPG</div>
              <div className="mono text-3xl tabular-nums mt-1">{ppg.toFixed(1)}</div>
            </div>
            <div>
              <div className="stat-label">RPG</div>
              <div className="mono text-3xl tabular-nums mt-1">{rpg.toFixed(1)}</div>
            </div>
            <div>
              <div className="stat-label">APG</div>
              <div className="mono text-3xl tabular-nums mt-1">{apg.toFixed(1)}</div>
            </div>
            <div>
              <div className="stat-label">Games</div>
              <div className="mono text-3xl tabular-nums mt-1">{seasonStats.games}</div>
            </div>
          </div>
        )}
      </header>

      {/* Main grid: 60/40 split */}
      <section className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(0,1.5fr)] gap-8 lg:gap-12 mb-12">
        {/* LEFT: Stat panels */}
        <aside className="space-y-6">
          <div>
            <div className="mono text-[10px] uppercase tracking-[0.25em] text-text-dim mb-3">
              Shooting · Season
            </div>
            <div className="bg-surface border border-border">
              <div className="grid grid-cols-3 divide-x divide-border">
                <div className="p-4">
                  <div className="stat-label">Shots</div>
                  <div className="mono text-2xl tabular-nums mt-1">{total}</div>
                </div>
                <div className="p-4">
                  <div className="stat-label">Made</div>
                  <div className="mono text-2xl tabular-nums mt-1 text-[var(--made)]">{makes}</div>
                </div>
                <div className="p-4">
                  <div className="stat-label">Missed</div>
                  <div className="mono text-2xl tabular-nums mt-1 text-[var(--missed)]">{misses}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 divide-x divide-border border-t border-border">
                <div className="p-4">
                  <div className="stat-label">FG%</div>
                  <div className="mono text-2xl tabular-nums mt-1">{(fgPct * 100).toFixed(1)}</div>
                </div>
                <div className="p-4">
                  <div className="stat-label">eFG%</div>
                  <div className="mono text-2xl tabular-nums mt-1">{(efg * 100).toFixed(1)}</div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="mono text-[10px] uppercase tracking-[0.25em] text-text-dim mb-3">
              Two vs Three
            </div>
            <div className="bg-surface border border-border">
              <div className="p-4 flex items-center justify-between border-b border-border">
                <span className="stat-label">2-Point</span>
                <div className="mono tabular-nums text-sm">
                  <span className="text-text">{twoPtMade}/{twoPtAtt}</span>
                  <span className="text-text-dim ml-2">{twoPtAtt ? ((twoPtMade / twoPtAtt) * 100).toFixed(1) : '0.0'}%</span>
                </div>
              </div>
              <div className="p-4 flex items-center justify-between">
                <span className="stat-label">3-Point</span>
                <div className="mono tabular-nums text-sm">
                  <span className="text-text">{threePtMade}/{threePtAtt}</span>
                  <span className="text-text-dim ml-2">{threePtAtt ? ((threePtMade / threePtAtt) * 100).toFixed(1) : '0.0'}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Advanced Impact Analysis */}
          {playerImpact && (
            <div>
              <div className="mono text-[10px] uppercase tracking-[0.25em] text-text-dim mb-3">
                Advanced Impact · RAPM
              </div>
              <div className="bg-surface border border-border">
                {/* Net RAPM - Main Impact Score */}
                <div className="p-6 border-b border-border">
                  <div className="flex items-center justify-between mb-3">
                    <div className="stat-label">Net RAPM (Total Impact)</div>
                    <div className={`mono text-xs px-2 py-1 border ${
                      playerImpact.confidence === 'high' ? 'border-green-400 text-green-400' :
                      playerImpact.confidence === 'moderate' ? 'border-yellow-400 text-yellow-400' :
                      'border-red-400 text-red-400'
                    }`}>
                      {playerImpact.confidence?.toUpperCase() || 'UNKNOWN'} CONFIDENCE
                    </div>
                  </div>
                  <div className="mono text-4xl tabular-nums mb-2">
                    {playerImpact.rapm !== null ? (
                      <span className={playerImpact.rapm >= 0 ? 'text-[var(--made)]' : 'text-[var(--missed)]'}>
                        {playerImpact.rapm >= 0 ? '+' : ''}{playerImpact.rapm.toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-text-dim">—</span>
                    )}
                  </div>
                  <div className="text-text-dim text-sm mb-4">
                    {playerImpact.rapm !== null ? 'points per 100 possessions' : 'No RAPM data available'}
                  </div>
                  <div className="text-text-dim text-xs leading-relaxed">
                    <strong className="text-text">Net RAPM</strong> measures total player impact when on court.
                    Positive values help the team score more points per 100 possessions than average.
                  </div>
                </div>

                {/* Component Breakdown */}
                <div className="grid grid-cols-2 divide-x divide-border">
                  <div className="p-4">
                    <div className="stat-label mb-3">Offensive RAPM</div>
                    <div className="mono text-2xl tabular-nums mb-2">
                      {playerImpact.orapm !== null ? (
                        <span className={playerImpact.orapm >= 0 ? 'text-[var(--made)]' : 'text-[var(--missed)]'}>
                          {playerImpact.orapm >= 0 ? '+' : ''}{playerImpact.orapm.toFixed(1)}
                        </span>
                      ) : (
                        <span className="text-text-dim">—</span>
                      )}
                    </div>
                    <div className="text-text-dim text-xs leading-relaxed">
                      Impact when team has the ball. Positive ORAPM helps offense score more efficiently.
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="stat-label mb-3">Defensive RAPM</div>
                    <div className="mono text-2xl tabular-nums mb-2">
                      {playerImpact.drapm !== null ? (
                        <span className={playerImpact.drapm >= 0 ? 'text-[var(--made)]' : 'text-[var(--missed)]'}>
                          {playerImpact.drapm >= 0 ? '+' : ''}{playerImpact.drapm.toFixed(1)}
                        </span>
                      ) : (
                        <span className="text-text-dim">—</span>
                      )}
                    </div>
                    <div className="text-text-dim text-xs leading-relaxed">
                      Impact when opponent has the ball. Positive DRAPM helps defense prevent scoring.
                    </div>
                  </div>
                </div>

                {/* Expected vs Actual */}
                {(playerImpact.rapmExpected !== null || playerImpact.orapmExpected !== null) && (
                  <div className="border-t border-border">
                    <div className="p-4 bg-surface-2/50">
                      <div className="stat-label mb-3">Expected vs Actual Performance</div>
                      <div className="grid grid-cols-2 gap-6 text-sm">
                        {playerImpact.rapmExpected !== null && (
                          <div>
                            <div className="text-text-dim text-xs">Net RAPM</div>
                            <div className="mono tabular-nums">
                              Actual: <span className="text-text">{playerImpact.rapm?.toFixed(1) || '—'}</span>
                            </div>
                            <div className="mono tabular-nums">
                              Expected: <span className="text-text-dim">{playerImpact.rapmExpected.toFixed(1)}</span>
                            </div>
                          </div>
                        )}
                        {playerImpact.orapmExpected !== null && (
                          <div>
                            <div className="text-text-dim text-xs">ORAPM</div>
                            <div className="mono tabular-nums">
                              Actual: <span className="text-text">{playerImpact.orapm?.toFixed(1) || '—'}</span>
                            </div>
                            <div className="mono tabular-nums">
                              Expected: <span className="text-text-dim">{playerImpact.orapmExpected.toFixed(1)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Methodology and Confidence */}
                <div className="p-4 bg-surface-3/30 border-t border-border">
                  <div className="flex items-center justify-between text-sm mb-3">
                    <span>
                      Sample Size: <span className="text-text mono">{playerImpact.possessions?.toLocaleString() || '—'} possessions</span>
                    </span>
                    {playerImpact.minutes && (
                      <span>
                        Minutes: <span className="text-text mono">{playerImpact.minutes.toLocaleString()}</span>
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-text-dim leading-relaxed">
                    <strong className="text-text">RAPM Methodology:</strong> Regularized Adjusted Plus-Minus isolates individual player impact
                    using lineup stint data. Higher confidence estimates come from larger sample sizes and more game time.
                  </div>
                </div>
              </div>

              {/* RAPM Explanation */}
              <div className="mt-3 p-3 bg-surface-3/30 border border-border text-xs text-text-dim leading-relaxed">
                <strong className="text-text">RAPM</strong> (Regularized Adjusted Plus-Minus) estimates player impact in points per 100 possessions.
                <strong className="text-text"> ORAPM</strong> measures offensive impact,
                <strong className="text-text"> DRAPM</strong> measures defensive impact from a defense-only model with opponent controls.
                {playerImpact.confidence === 'low' && (
                  <span className="block mt-1 text-amber-400">
                    ⚠️ Low-confidence estimate due to limited playing time.
                  </span>
                )}
              </div>
            </div>
          )}
        </aside>

        {/* RIGHT: Court */}
        <div>
          <div className="mono text-[10px] uppercase tracking-[0.25em] text-text-dim mb-3 flex items-center justify-between">
            <span>Shot Chart · {total} attempts</span>
            <span>Hover for detail</span>
          </div>
          <ShotChartView shots={shots} />
        </div>
      </section>

      {/* Zone breakdown table */}
      <section>
        <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-border">
          <h2 className="display text-2xl font-medium">Shot Zones</h2>
          <span className="mono text-[11px] uppercase tracking-widest text-text-dim">
            By Location
          </span>
        </div>
        <div className="bg-surface border border-border">
          <table className="w-full mono tabular-nums text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="stat-label py-3 px-4">Zone</th>
                <th className="stat-label py-3 px-4 text-right">Attempts</th>
                <th className="stat-label py-3 px-4 text-right">Made</th>
                <th className="stat-label py-3 px-4 text-right">FG%</th>
                <th className="stat-label py-3 px-4 text-right">Pts/Shot</th>
                <th className="stat-label py-3 px-4 text-right">% of Shots</th>
              </tr>
            </thead>
            <tbody>
              {(['rim', 'mid', 'three'] as const).map((k) => {
                const z = zones[k];
                const ptsPerShot = z.att > 0
                  ? (k === 'three' ? z.made * 3 : z.made * 2) / z.att
                  : 0;
                const shareOfShots = total > 0 ? z.att / total : 0;
                const label = k === 'rim' ? 'At Rim' : k === 'mid' ? 'Mid-Range' : '3-Point';
                return (
                  <tr key={k} className="border-b border-border last:border-b-0 hover:bg-surface-2 transition-colors">
                    <td className="py-3 px-4 font-medium text-text">{label}</td>
                    <td className="py-3 px-4 text-right">{z.att}</td>
                    <td className="py-3 px-4 text-right">{z.made}</td>
                    <td className="py-3 px-4 text-right">{(z.pct * 100).toFixed(1)}</td>
                    <td className="py-3 px-4 text-right">{ptsPerShot.toFixed(2)}</td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-text-dim">{(shareOfShots * 100).toFixed(1)}%</span>
                        <span className="inline-block h-1 w-16 bg-border overflow-hidden">
                          <span
                            className="block h-full bg-accent"
                            style={{ width: `${shareOfShots * 100}%` }}
                          />
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
