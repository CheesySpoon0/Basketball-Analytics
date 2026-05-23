import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '../../../../lib/prisma';
import { SeasonSelector } from '../../../../components/SeasonSelector';
import { resolveSeason, seasonLabel, withSeason } from '../../../../lib/season';
import { LineupFilters } from './LineupFilters';
import { ProjectedLineups } from './ProjectedLineups';

export const dynamic = 'force-dynamic';

interface LineupData {
  lineupHash: string | null;
  playerIds: string | null;
  playerNames: string[];
  minutes: number;
  games: number;
  possessionsFor: number;
  possessionsAgainst: number;
  pppFor: number;
  pppAgainst: number;
  netPpp: number;
  expectedPppFor?: number;
  expectedPppAgainst?: number;
  expectedNetPpp?: number;
  confidence: 'full' | 'partial' | 'gap';
}

type SortOption = 'minutes' | 'netPpp' | 'pppFor' | 'pppAgainst' | 'expectedNetPpp' | 'expectedPppFor' | 'expectedPppAgainst';

const SORT_OPTIONS = {
  'minutes': { label: 'Most Used', field: 'minutes', desc: true },
  'netPpp': { label: 'Best Net', field: 'netPpp', desc: true },
  'pppFor': { label: 'Best Offense', field: 'pppFor', desc: true },
  'pppAgainst': { label: 'Best Defense', field: 'pppAgainst', desc: false }, // Lower is better for defense
  'expectedNetPpp': { label: 'Best Expected Net', field: 'expectedNetPpp', desc: true },
  'expectedPppFor': { label: 'Best Expected Offense', field: 'expectedPppFor', desc: true },
  'expectedPppAgainst': { label: 'Best Expected Defense', field: 'expectedPppAgainst', desc: false },
} as const;

export default async function TeamLineupsPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { teamId: teamIdStr } = await params;
  const searchParamsData = await searchParams;
  const teamId = parseInt(teamIdStr, 10);
  if (Number.isNaN(teamId)) notFound();

  const season = resolveSeason(searchParamsData);
  const sort = (searchParamsData.sort as SortOption) || 'minutes';
  const minPossessions = parseInt((searchParamsData.minPoss as string) || '20', 10);
  const onlyFull = (searchParamsData.onlyFull as string) !== 'false';
  const tab = (searchParamsData.tab as string) || 'observed';

  // Get team info
  const team = await prisma.team.findUnique({
    where: { id: teamId },
  });
  if (!team) notFound();

  // Get team players for name resolution
  const teamPlayers = await prisma.playerSeasonStats.findMany({
    where: { teamId, season },
    include: { player: true },
  });
  const playerMap = new Map(teamPlayers.map(p => [p.playerId, p.player.name || `Player ${p.playerId}`]));

  // Get player RAPM data for projected lineups
  const playerRAMP = await prisma.playerImpact.findMany({
    where: {
      season,
      playerId: { in: teamPlayers.map(p => p.playerId) }
    },
  });
  const rampMap = new Map(playerRAMP.map(p => [p.playerId, p]));

  const playersWithRAMP = teamPlayers.map(p => ({
    id: p.playerId,
    name: p.player.name || `Player ${p.playerId}`,
    orapm: rampMap.get(p.playerId)?.orapm || undefined,
    drapm: rampMap.get(p.playerId)?.drapm || undefined,
    rapm: rampMap.get(p.playerId)?.rapm || undefined,
    confidence: rampMap.get(p.playerId)?.confidence || undefined,
    possessions: rampMap.get(p.playerId)?.possessions || undefined,
    minutes: p.minutes || undefined,
  }));

  // Build lineup aggregates - use Prisma for proper parameterization
  const whereClause = {
    teamId,
    season,
    playerIds: { not: null },
    ...(onlyFull && { confidence: 'full' as const }),
  };

  const rawLineups = await prisma.lineupStint.groupBy({
    by: ['lineupHash', 'playerIds'],
    where: whereClause,
    _sum: {
      possessionsFor: true,
      possessionsAgainst: true,
      pointsFor: true,
      pointsAgainst: true,
      expectedPointsFor: true,
      expectedPointsAgainst: true,
    },
    _count: {
      gameId: true,
    },
    having: {
      OR: [
        { possessionsFor: { _sum: { gte: minPossessions } } },
        { possessionsAgainst: { _sum: { gte: minPossessions } } }
      ]
    }
  });

  // Also get confidence and time data
  const lineupDetails = await Promise.all(
    rawLineups.map(async (lineup) => {
      const stints = await prisma.lineupStint.findMany({
        where: {
          ...whereClause,
          lineupHash: lineup.lineupHash,
        },
        select: {
          confidence: true,
          startSeconds: true,
          endSeconds: true,
          gameId: true,
        },
      });

      const minutes = stints.reduce((sum, stint) =>
        sum + (stint.endSeconds - stint.startSeconds) / 60, 0);
      const games = new Set(stints.map(s => s.gameId)).size;
      const confidence = stints.find(s => s.confidence === 'full')?.confidence ||
                        stints.find(s => s.confidence === 'partial')?.confidence || 'gap';

      return { ...lineup, minutes, games, confidence };
    })
  );

  // Process lineup data
  const lineups: LineupData[] = lineupDetails
    .filter(row => row.playerIds !== null) // Filter out null playerIds
    .map(row => {
    const playerIds = row.playerIds!.split(',').map((id: string) => parseInt(id, 10));
    const playerNames = playerIds
      .map((id: number) => playerMap.get(id) || `Player ${id}`)
      .sort(); // Alphabetical for consistency

    const possFor = row._sum.possessionsFor || 0;
    const possAgainst = row._sum.possessionsAgainst || 0;
    const ptsFor = row._sum.pointsFor || 0;
    const ptsAgainst = row._sum.pointsAgainst || 0;
    const xPtsFor = row._sum.expectedPointsFor || 0;
    const xPtsAgainst = row._sum.expectedPointsAgainst || 0;

    return {
      lineupHash: row.lineupHash,
      playerIds: row.playerIds,
      playerNames,
      minutes: Math.round(row.minutes),
      games: row.games,
      possessionsFor: Math.round(possFor),
      possessionsAgainst: Math.round(possAgainst),
      pppFor: possFor > 0 ? ptsFor / possFor : 0,
      pppAgainst: possAgainst > 0 ? ptsAgainst / possAgainst : 0,
      netPpp: (possFor > 0 ? ptsFor / possFor : 0) - (possAgainst > 0 ? ptsAgainst / possAgainst : 0),
      expectedPppFor: possFor > 0 && xPtsFor > 0 ? xPtsFor / possFor : undefined,
      expectedPppAgainst: possAgainst > 0 && xPtsAgainst > 0 ? xPtsAgainst / possAgainst : undefined,
      expectedNetPpp: (possFor > 0 && xPtsFor > 0 && possAgainst > 0 && xPtsAgainst > 0)
        ? (xPtsFor / possFor) - (xPtsAgainst / possAgainst)
        : undefined,
      confidence: row.confidence as 'full' | 'partial' | 'gap'
    };
  });

  // Sort lineups by selected criteria (since SQL ORDER BY might not work with computed columns)
  lineups.sort((a, b) => {
    const sortConfig = SORT_OPTIONS[sort];
    const aVal = a[sortConfig.field as keyof LineupData] as number;
    const bVal = b[sortConfig.field as keyof LineupData] as number;
    return sortConfig.desc ? bVal - aVal : aVal - bVal;
  });

  const accentColor = team.primaryColor ? `#${team.primaryColor}` : 'var(--accent)';

  return (
    <main className="max-w-[1400px] mx-auto px-6 lg:px-8 py-10 lg:py-14">
      {/* Breadcrumb + Season selector */}
      <div className="flex items-center justify-between gap-4 mb-8 flex-wrap">
        <div className="mono text-[11px] uppercase tracking-[0.2em] text-text-dim">
          <Link href={withSeason('/', season)} className="hover:text-text transition-colors">
            Conference
          </Link>
          <span className="mx-2 opacity-40">/</span>
          <Link
            href={withSeason(`/teams/${team.id}`, season)}
            className="hover:text-text transition-colors"
          >
            {team.abbreviation ?? team.school}
          </Link>
          <span className="mx-2 opacity-40">/</span>
          <span>Lineups</span>
        </div>
        <SeasonSelector season={season} />
      </div>

      {/* Header */}
      <header className="mb-10 lg:mb-14">
        <div className="relative">
          <div
            className="absolute -left-6 top-2 bottom-2 w-[3px]"
            style={{ backgroundColor: accentColor }}
          />
          <div className="mono text-[11px] uppercase tracking-[0.2em] text-text-dim mb-2">
            {team.school} · {seasonLabel(season)} · Lineups
          </div>
          <h1 className="display text-[56px] sm:text-[72px] leading-[0.95] tracking-tight font-medium">
            Lineup Analysis
          </h1>
          <p className="text-text-dim mt-4 max-w-2xl">
            Analyze observed lineup performance or project new lineup combinations using RAPM estimates.
          </p>
        </div>
      </header>

      {/* Tab Navigation */}
      <section className="mb-8">
        <div className="flex gap-2 mb-6">
          <Link
            href={`?${new URLSearchParams({ ...searchParamsData as Record<string, string>, tab: 'observed' }).toString()}`}
            className={`px-6 py-3 text-sm border transition-colors ${
              tab === 'observed'
                ? 'border-accent text-accent bg-accent/5'
                : 'border-border text-text-dim hover:text-text hover:border-text-dim'
            }`}
          >
            Observed Lineups
          </Link>
          <Link
            href={`?${new URLSearchParams({ ...searchParamsData as Record<string, string>, tab: 'projected' }).toString()}`}
            className={`px-6 py-3 text-sm border transition-colors ${
              tab === 'projected'
                ? 'border-accent text-accent bg-accent/5'
                : 'border-border text-text-dim hover:text-text hover:border-text-dim'
            }`}
          >
            Projected Lineups
          </Link>
        </div>

        {tab === 'observed' && <LineupFilters teamId={teamId} season={season} />}
      </section>

      {/* Tab Content */}
      {tab === 'observed' ? (
        <>
          {/* Sort tabs */}
          <section className="mb-6">
            <div className="flex flex-wrap gap-2">
              {Object.entries(SORT_OPTIONS).map(([key, config]) => (
                <Link
                  key={key}
                  href={`?${new URLSearchParams({
                    ...searchParamsData as Record<string, string>,
                    sort: key,
                    tab: 'observed'
                  }).toString()}`}
                  className={`px-4 py-2 text-sm border transition-colors ${
                    sort === key
                      ? 'border-accent text-accent bg-accent/5'
                      : 'border-border text-text-dim hover:text-text hover:border-text-dim'
                  }`}
                >
                  {config.label}
                </Link>
              ))}
            </div>
          </section>

      {/* Lineups table */}
      <section>
        <div className="bg-surface border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full mono text-sm">
              <thead>
                <tr className="border-b border-border text-left bg-surface-2">
                  <th className="stat-label py-4 px-4 text-left min-w-[300px]">Lineup</th>
                  <th className="stat-label py-4 px-3 text-right">Min</th>
                  <th className="stat-label py-4 px-3 text-right">G</th>
                  <th className="stat-label py-4 px-3 text-right">Poss</th>
                  <th className="stat-label py-4 px-3 text-right">ORtg</th>
                  <th className="stat-label py-4 px-3 text-right">DRtg</th>
                  <th className="stat-label py-4 px-3 text-right">Net</th>
                  <th className="stat-label py-4 px-3 text-right">xORtg</th>
                  <th className="stat-label py-4 px-3 text-right">xDRtg</th>
                  <th className="stat-label py-4 px-3 text-right">xNet</th>
                  <th className="stat-label py-4 px-3 text-center">Conf</th>
                </tr>
              </thead>
              <tbody>
                {lineups.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-8 px-4 text-center text-text-dim">
                      No lineups found matching the current filters.
                      Try lowering the minimum possessions or including partial confidence stints.
                    </td>
                  </tr>
                ) : (
                  lineups.map((lineup, i) => (
                    <tr key={lineup.lineupHash} className="border-b border-border last:border-b-0 hover:bg-surface-2 transition-colors">
                      <td className="py-3 px-4">
                        <div className="space-y-1">
                          {lineup.playerNames.map((name, j) => (
                            <div key={j} className="text-text text-xs">
                              {name}
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums">{lineup.minutes}</td>
                      <td className="py-3 px-3 text-right tabular-nums">{lineup.games}</td>
                      <td className="py-3 px-3 text-right tabular-nums">{lineup.possessionsFor + lineup.possessionsAgainst}</td>
                      <td className="py-3 px-3 text-right tabular-nums">{(lineup.pppFor * 100).toFixed(1)}</td>
                      <td className="py-3 px-3 text-right tabular-nums">{(lineup.pppAgainst * 100).toFixed(1)}</td>
                      <td className="py-3 px-3 text-right tabular-nums">
                        <span className={lineup.netPpp >= 0 ? 'text-[var(--made)]' : 'text-[var(--missed)]'}>
                          {lineup.netPpp >= 0 ? '+' : ''}{(lineup.netPpp * 100).toFixed(1)}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums text-text-dim">
                        {lineup.expectedPppFor ? (lineup.expectedPppFor * 100).toFixed(1) : '—'}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums text-text-dim">
                        {lineup.expectedPppAgainst ? (lineup.expectedPppAgainst * 100).toFixed(1) : '—'}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums text-text-dim">
                        {lineup.expectedNetPpp !== undefined ? (
                          <span className={lineup.expectedNetPpp >= 0 ? 'text-[var(--made)]/70' : 'text-[var(--missed)]/70'}>
                            {lineup.expectedNetPpp >= 0 ? '+' : ''}{(lineup.expectedNetPpp * 100).toFixed(1)}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className={`inline-block w-2 h-2 rounded-full ${
                          lineup.confidence === 'full' ? 'bg-[var(--made)]' :
                          lineup.confidence === 'partial' ? 'bg-amber-400' :
                          'bg-[var(--missed)]'
                        }`} title={`${lineup.confidence} confidence`} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {lineups.length > 0 && (
          <div className="mt-4 text-xs text-text-dim">
            Showing {lineups.length} lineups ·
            ORtg/DRtg/Net in points per 100 possessions ·
            xORtg/xDRtg/xNet are xeFG-based expectations ·
            Confidence: <span className="text-[var(--made)]">●</span> Full,
            <span className="text-amber-400"> ●</span> Partial,
            <span className="text-[var(--missed)]"> ●</span> Gap
          </div>
        )}
      </section>
        </>
      ) : (
        /* Projected Lineups */
        <section>
          <ProjectedLineups players={playersWithRAMP} teamId={teamId} />
        </section>
      )}
    </main>
  );
}