import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buildPlayerScoutingReport } from '../../../../lib/player-scouting';
import { getPlayerXeFGCached } from '../../../../lib/xefg';
import { PlayerShotQualityPanel } from '../../../../components/ShotQualityPanel';
import { SeasonSelector } from '../../../../components/SeasonSelector';
import { prisma } from '../../../../lib/prisma';
import { resolveSeason, seasonLabel, withSeason } from '../../../../lib/season';
import { ShotChartView, type Shot } from '../ShotChartView';
import type { PlayerNote } from '../../../../lib/player-scouting';

export const dynamic = 'force-dynamic';

function pctStr(x: number | null | undefined, d = 1): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return `${(x * 100).toFixed(d)}%`;
}
function num(x: number | null | undefined, d = 1): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return x.toFixed(d);
}

export default async function PlayerReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ playerId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { playerId: idStr } = await params;
  const playerId = parseInt(idStr, 10);
  if (Number.isNaN(playerId)) notFound();

  const SEASON = resolveSeason(await searchParams);

  const [report, playerXeFG] = await Promise.all([
    buildPlayerScoutingReport(playerId, SEASON),
    getPlayerXeFGCached(playerId, SEASON),
  ]);
  if (!report) notFound();

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

  const {
    player,
    stats,
    zones,
    shotTypes,
    threeSubzones,
    creation,
    role,
    scoutingPriority,
    notes,
    liveWith,
    deny,
    defenseProxy,
    rotation,
    caveats,
  } = report;
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
          <Link
            href={withSeason(`/players/${player.id}`, SEASON)}
            className="hover:text-text transition-colors"
          >
            {player.name}
          </Link>
          <span className="mx-2 opacity-40">/</span>
          <span>Report</span>
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
          <div className="mono text-[11px] uppercase tracking-[0.2em] text-text-dim mb-2 flex flex-wrap items-center gap-3">
            {player.jersey && <span className="tabular-nums">#{player.jersey}</span>}
            <span>{player.position ?? '—'}</span>
            {defenseProxy.sizeNote && (
              <>
                <span className="opacity-40">·</span>
                <span>{defenseProxy.sizeNote}</span>
              </>
            )}
            <span className="opacity-40">·</span>
            {player.team && (
              <Link
                href={withSeason(`/teams/${player.team.id}`, SEASON)}
                className="hover:text-text transition-colors"
              >
                {player.team.school}
              </Link>
            )}
            <span className="opacity-40">·</span>
            <span>{seasonLabel(SEASON)}</span>
          </div>
          <h1 className="display text-[56px] sm:text-[72px] leading-[0.95] tracking-tight font-medium">
            {player.name}
          </h1>
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <span className="mono text-[10px] uppercase tracking-widest text-accent border border-accent px-2 py-1">
              {role.archetype}
            </span>
            <span
              className="mono text-[10px] uppercase tracking-widest border border-border text-text px-2 py-1"
              title="How much prep this matchup deserves"
            >
              {scoutingPriority}
            </span>
            {!rotation.eligible && (
              <span className="mono text-[10px] uppercase tracking-widest text-text-dim border border-border px-2 py-1">
                deep bench
              </span>
            )}
            <span className="text-text-dim text-sm">{role.summary}</span>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-x-6 gap-y-4 lg:min-w-[520px]">
          <Stat label="MPG" value={num(stats.minutesPerGame)} />
          <Stat label="PPG" value={num(stats.ppg)} />
          <Stat label="RPG" value={num(stats.rpg)} />
          <Stat label="APG" value={num(stats.apg)} />
          <Stat label="GP" value={String(stats.games)} />
        </div>
      </header>

      {/* Snapshot grid */}
      <section className="mb-10 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Panel title="Role">
          <Row label="Archetype" value={role.archetype} />
          <Row label="Share of team FGA" value={pctStr(stats.shareOfTeamFga)} />
          <Row label="eFG%" value={pctStr(stats.efgPct)} />
          <Row label="FG%" value={pctStr(stats.fgPct)} />
          <Row label="3PT%" value={pctStr(stats.threePct)} />
          <Row label="FT%" value={pctStr(stats.ftPct)} />
        </Panel>

        <Panel title="Per-game production">
          <Row label="Minutes" value={num(stats.minutesPerGame)} />
          <Row label="Points" value={num(stats.ppg)} />
          <Row label="Rebounds" value={num(stats.rpg)} />
          <Row label="Assists" value={num(stats.apg)} />
          <Row label="Turnovers" value={num(stats.topg)} />
          <Row label="AST/TOV" value={num(stats.astToTov, 2)} />
        </Panel>

        <Panel title="Shot diet">
          <Row label="Rim rate" value={pctStr(zones.rim.share)} />
          <Row label="Mid rate" value={pctStr(zones.mid.share)} />
          <Row label="3PT rate" value={pctStr(zones.three.share)} />
          <Row label="Rim FG%" value={pctStr(zones.rim.pct)} />
          <Row label="Mid FG%" value={pctStr(zones.mid.pct)} />
          <Row label="FTR" value={pctStr(stats.ftr)} />
        </Panel>
      </section>

      {/* Shot type + creation profile */}
      <section className="mb-10 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Panel title="Shot types">
          <Row
            label={`Layups (${shotTypes.layup.att})`}
            value={pctStr(shotTypes.layup.pct)}
          />
          <Row
            label={`Dunks (${shotTypes.dunk.att})`}
            value={pctStr(shotTypes.dunk.pct)}
          />
          <Row
            label={`Jumpers (${shotTypes.jumper.att})`}
            value={pctStr(shotTypes.jumper.pct)}
          />
          {shotTypes.tip.att > 0 && (
            <Row
              label={`Tip-ins (${shotTypes.tip.att})`}
              value={pctStr(shotTypes.tip.pct)}
            />
          )}
        </Panel>

        <Panel title="Threes by zone">
          <Row
            label={`Corner 3 (${threeSubzones.corner.att})`}
            value={pctStr(threeSubzones.corner.pct)}
          />
          <Row
            label={`Above the break (${threeSubzones.above_break.att})`}
            value={pctStr(threeSubzones.above_break.pct)}
          />
          <Row label="Total 3PA" value={String(stats.threeAttempts)} />
          <Row label="3PA / game" value={num(stats.threePerGame)} />
          <Row label="3PT%" value={pctStr(stats.threePct)} />
        </Panel>

        <Panel title="Creation profile">
          <Row label="Assisted rate" value={pctStr(creation.assistedRate)} />
          <Row label="Unassisted rate" value={pctStr(creation.unassistedRate)} />
          <Row label="Assisted 3 rate" value={pctStr(creation.assistedThreeRate)} />
          <Row label="Assisted rim rate" value={pctStr(creation.assistedRimRate)} />
          <Row label="Unassisted jumper rate" value={pctStr(creation.unassistedJumperRate)} />
        </Panel>
      </section>

      {/* Shot quality profile */}
      {playerXeFG && playerXeFG.sampleSize >= 20 && (
        <section className="mb-10">
          <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-border">
            <h2 className="display text-2xl font-medium">Shot Quality Profile</h2>
            <span className="mono text-[11px] uppercase tracking-widest text-text-dim">
              actual eFG% vs expected eFG% (xeFG)
            </span>
          </div>
          <PlayerShotQualityPanel xefg={playerXeFG} />
        </section>
      )}

      {/* How to guard him */}
      {notes.length > 0 && (
        <NoteSection title="How to guard him" notes={notes} accent="missed" />
      )}

      {/* What not to allow */}
      {deny.length > 0 && <NoteSection title="What not to allow" notes={deny} accent="missed" />}

      {/* What to live with */}
      {liveWith.length > 0 && (
        <NoteSection title="What to live with" notes={liveWith} accent="made" />
      )}

      {/* Defensive profile — clearly inferred */}
      <section className="mb-10">
        <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-border">
          <h2 className="display text-2xl font-medium">Defensive profile</h2>
          <span className="mono text-[11px] uppercase tracking-widest text-text-dim">
            inferred · no tracking data
          </span>
        </div>
        <div className="bg-surface border border-border p-5">
          <p className="text-text-dim text-sm mb-4 leading-relaxed">
            We don&apos;t store defensive matchup or tracking data. The numbers below are box-score
            proxies only — use them as direction, not verdict.
          </p>
          <p className="text-sm text-text mb-4">{defenseProxy.descriptor}.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="STL/g" value={num(defenseProxy.spg)} />
            <Stat label="BLK/g" value={num(defenseProxy.bpg)} />
            <Stat label="REB/g" value={num(defenseProxy.rpg)} />
            <Stat label="Fouls/g" value={num(defenseProxy.fpg)} />
          </div>
          {defenseProxy.sizeNote && (
            <div className="mt-4 mono text-[11px] text-text-dim">
              Size: {defenseProxy.sizeNote}
            </div>
          )}
        </div>
      </section>

      {/* Shot chart + zone breakdown */}
      <section className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(0,1.5fr)] gap-8 lg:gap-12 mb-10">
        <aside>
          <div className="mono text-[10px] uppercase tracking-[0.25em] text-text-dim mb-3">
            Shot Zones
          </div>
          <div className="bg-surface border border-border">
            <table className="w-full mono tabular-nums text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="stat-label py-3 px-4">Zone</th>
                  <th className="stat-label py-3 px-4 text-right">Att</th>
                  <th className="stat-label py-3 px-4 text-right">FG%</th>
                  <th className="stat-label py-3 px-4 text-right">% of shots</th>
                </tr>
              </thead>
              <tbody>
                {(['rim', 'mid', 'three'] as const).map((k) => {
                  const z = zones[k];
                  return (
                    <tr key={k} className="border-b border-border last:border-b-0">
                      <td className="py-3 px-4 font-medium text-text">
                        {k === 'rim' ? 'Rim' : k === 'mid' ? 'Mid-range' : '3-Point'}
                      </td>
                      <td className="py-3 px-4 text-right">{z.att}</td>
                      <td className="py-3 px-4 text-right">{pctStr(z.pct)}</td>
                      <td className="py-3 px-4 text-right">{pctStr(z.share)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </aside>

        <div>
          <div className="mono text-[10px] uppercase tracking-[0.25em] text-text-dim mb-3 flex items-center justify-between">
            <span>Shot Chart · {shots.length} attempts</span>
            <span>Hover for detail</span>
          </div>
          <ShotChartView shots={shots} />
        </div>
      </section>

      {/* Caveats */}
      {caveats.length > 0 && (
        <section className="mb-6 bg-surface border border-border p-4">
          <div className="mono text-[10px] uppercase tracking-[0.25em] text-text-dim mb-2">
            Data caveats
          </div>
          <ul className="text-sm text-text-dim space-y-1">
            {caveats.map((c, i) => (
              <li key={i}>• {c}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function NoteSection({
  title,
  notes,
  accent,
}: {
  title: string;
  notes: PlayerNote[];
  accent: 'missed' | 'made';
}) {
  const borderClass = accent === 'missed' ? 'border-l-missed' : 'border-l-made';
  const titleClass = accent === 'missed' ? 'text-missed' : 'text-made';
  return (
    <section className="mb-10">
      <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-border">
        <h2 className="display text-2xl font-medium">{title}</h2>
        <span className="mono text-[11px] uppercase tracking-widest text-text-dim">
          {notes.length} note{notes.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {notes.map((n) => (
          <div
            key={n.id}
            className={`bg-surface border border-border border-l-2 ${borderClass} p-4`}
          >
            <div className={`font-medium ${titleClass} text-sm mb-1`}>{n.title}</div>
            <div className="text-sm text-text leading-relaxed mb-3">{n.detail}</div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {n.evidence.map((e) => (
                <span key={e.label} className="mono text-[10px] tabular-nums text-text-dim">
                  {e.label}: {e.value}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className="mono text-3xl tabular-nums mt-1">{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border">
      <div className="border-b border-border px-4 py-3">
        <h3 className="display text-lg font-medium">{title}</h3>
      </div>
      <div className="p-4 space-y-2">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-text-dim">{label}</span>
      <span className="mono tabular-nums">{value}</span>
    </div>
  );
}
