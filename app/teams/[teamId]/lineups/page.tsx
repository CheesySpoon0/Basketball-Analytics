import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '../../../../lib/prisma';
import { SeasonSelector } from '../../../../components/SeasonSelector';
import { LineupTable } from '../../../../components/LineupTable';
import { resolveSeason, seasonLabel, withSeason } from '../../../../lib/season';
import { LineupFilters } from './LineupFilters';
import { ProjectedLineups } from './ProjectedLineups';

export const dynamic = 'force-dynamic';

interface LineupData {
  lineupHash: string | null;
  playerIds: string | null;
  playerNames: string[];
  players: { id: number; name: string }[]; // For clickable links
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

  // Get player RAPM data from canonical PlayerImpact table for projected lineups
  const playerRAMP = await prisma.playerImpact.findMany({
    where: {
      season,
      playerId: { in: teamPlayers.map(p => p.playerId) }
    },
  });
  const rampMap = new Map(playerRAMP.map(p => [p.playerId, p]));

  const playersWithRAMP = teamPlayers.map(p => {
    const impactData = rampMap.get(p.playerId);
    // Use Net RAPM from PlayerImpact, with validation that rapm ≈ orapm + drapm
    const netRapm = impactData?.rapm || undefined;
    const calculatedNetRapm = impactData && impactData.orapm !== null && impactData.drapm !== null
      ? (impactData.orapm + impactData.drapm)
      : undefined;

    const totalPoss = impactData?.possessions || 0;
    const confidence = totalPoss >= 400 ? 'high' : totalPoss >= 200 ? 'moderate' : 'low';

    return {
      id: p.playerId,
      name: p.player.name || `Player ${p.playerId}`,
      orapm: impactData?.orapm || undefined,
      drapm: impactData?.drapm || undefined,
      rapm: netRapm, // Use actual Net RAPM from PlayerImpact
      confidence: impactData ? confidence : undefined,
      possessions: totalPoss || undefined,
      minutes: p.minutes || undefined,
    };
  });

  // Note: For now using league baseline. Team-specific baseline would require
  // proper possession and efficiency calculations from TeamSeasonStats

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

      // Calculate minutes using basketball clock logic: startSeconds > endSeconds
      // startSeconds = seconds remaining at START (higher value)
      // endSeconds = seconds remaining at END (lower value)
      // Duration = startSeconds - endSeconds
      const minutes = stints.reduce((sum, stint) => {
        // Validate stint has required fields
        if (stint.startSeconds == null || stint.endSeconds == null) {
          return sum;
        }

        const stintMinutes = (stint.startSeconds - stint.endSeconds) / 60;
        // Guard against negative durations and only include positive durations
        if (stintMinutes > 0) {
          return sum + stintMinutes;
        }
        return sum;
      }, 0);
      const games = new Set(stints.map(s => s.gameId)).size;
      const confidence = stints.find(s => s.confidence === 'full')?.confidence ||
                        stints.find(s => s.confidence === 'partial')?.confidence || 'gap';

      return { ...lineup, minutes, games, confidence };
    })
  );

  // Process lineup data - only valid 5-man lineups
  let totalStints = 0;
  let excludedPartialStints = 0;
  let excludedMalformedStints = 0;
  let excludedNegativeMinutes = 0;

  const lineups: LineupData[] = lineupDetails
    .filter(row => {
      totalStints++;

      // Filter out null playerIds
      if (row.playerIds === null) {
        excludedMalformedStints++;
        return false;
      }

      // Parse playerIds and validate exactly 5 players
      const playerIds = row.playerIds.split(',').map((id: string) => parseInt(id, 10));
      if (playerIds.length !== 5 || playerIds.some(id => isNaN(id))) {
        excludedPartialStints++;
        return false;
      }

      // Check if minutes would be negative or zero
      if (row.minutes <= 0) {
        excludedNegativeMinutes++;
        return false;
      }

      return true;
    })
    .map(row => {
      const playerIds = row.playerIds!.split(',').map((id: string) => parseInt(id, 10));

      // Create player objects for linking
      const players = playerIds.map((id: number) => ({
        id,
        name: playerMap.get(id) || `Player ${id}`
      }));

      // Keep playerNames for backward compatibility but sort for consistency
      const playerNames = players.map(p => p.name).sort();

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
        players, // For clickable links
        minutes: Math.max(0, Math.round(row.minutes)), // Additional guard against negative minutes in display
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
{team.school} · Lineups
          </div>
          <h1 className="display text-[56px] sm:text-[72px] leading-[0.95] tracking-tight font-medium">
            Lineup Analysis
          </h1>
          <p className="text-text-dim mt-4 max-w-2xl">
            Analyze observed lineup performance or project new lineup combinations using RAPM estimates.
          </p>
        </div>
      </header>

      {/* Navigation Cards */}
      <section className="mb-8">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {/* Team Overview */}
          <Link
            href={withSeason(`/teams/${team.id}`, season)}
            className="group bg-surface hover:bg-surface-2 transition-colors p-4 border border-border hover:border-accent/40"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium group-hover:text-accent transition-colors">Team Overview</h3>
              <div className="mono text-[10px] text-yellow-400 border border-yellow-400/40 px-2 py-0.5">
                Stats
              </div>
            </div>
            <p className="text-xs text-text-dim">
              Four Factors, ratings, and complete team profile
            </p>
          </Link>

          {/* Lineup Optimizer - Current page, highlighted */}
          <div className="bg-surface-2 border-2 border-accent p-4 opacity-90">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-accent">Lineup Optimizer</h3>
              <div className="mono text-[10px] text-accent border border-accent/40 px-2 py-0.5">
                Current
              </div>
            </div>
            <p className="text-xs text-text-dim">
              Build projected lineups using RAPM impact metrics
            </p>
          </div>

          {/* Coach Brief */}
          <Link
            href={withSeason(`/teams/${team.id}/brief`, season)}
            className="group bg-surface hover:bg-surface-2 transition-colors p-4 border border-border hover:border-accent/40"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium group-hover:text-accent transition-colors">Coach Brief</h3>
              <div className="mono text-[10px] text-green-400 border border-green-400/40 px-2 py-0.5">
                AI
              </div>
            </div>
            <p className="text-xs text-text-dim">
              Comprehensive opponent analysis and tactical insights
            </p>
          </Link>

          {/* Player Reports */}
          <Link
            href={withSeason('/players', season) + `?team=${team.id}`}
            className="group bg-surface hover:bg-surface-2 transition-colors p-4 border border-border hover:border-accent/40"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium group-hover:text-accent transition-colors">Player Reports</h3>
              <div className="mono text-[10px] text-purple-400 border border-purple-400/40 px-2 py-0.5">
                Individual
              </div>
            </div>
            <p className="text-xs text-text-dim">
              Advanced metrics and impact analysis per player
            </p>
          </Link>
        </div>
      </section>

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

      {/* Data Quality Note */}
      <section className="mb-6">
        <div className="bg-surface-2/50 border border-border rounded-lg p-4">
          <div className="text-sm text-text-dim leading-relaxed">
            <strong className="text-text">Data Quality:</strong> Observed lineups only include valid 5-player stints.
            Showing {lineups.length} valid lineups from {totalStints} total stints.
            {excludedPartialStints > 0 && ` Excluded ${excludedPartialStints} partial/malformed lineups.`}
            {excludedNegativeMinutes > 0 && ` Excluded ${excludedNegativeMinutes} stints with invalid minutes.`}
          </div>
        </div>
      </section>

      {/* Lineups table */}
      <section>
        <LineupTable lineups={lineups} season={season} />
      </section>
        </>
      ) : (
        /* Projected Lineups */
        <section>
          <ProjectedLineups
            players={playersWithRAMP}
            teamId={teamId}
            teamBaseline={{ ortg: 110, drtg: 110 }}
          />
        </section>
      )}
    </main>
  );
}