#!/usr/bin/env tsx
// ============================================================================
// derive-lineup-stints.ts
//
// Reconstructs per-team on-court lineup stints from substitution play-by-play.
//
// Algorithm:
//   1. Load all plays for a game in period + secondsRemaining DESC order.
//   2. For each team, build a timeline of lineup changes from Substitution rows.
//   3. Infer the starting lineup for each period: the first set of players who
//      appear as "subbing out" BEFORE any first "subbing in" at the same
//      (period, secondsRemaining) tick, combined with survivors carried forward.
//   4. Walk the timeline forward, emitting a LineupStint for each stretch.
//   5. For each stint, aggregate box-score events from play rows that fall
//      within the stint's time window (exclusive on startSeconds, inclusive on
//      endSeconds — i.e. [endSeconds, startSeconds) when secondsRemaining
//      counts DOWN). Aggregates both our team AND the opponent (for defensive
//      possessions / PPP allowed).
//   6. For each FGA with shot coordinates, run the xeFG model to get expected
//      points: P(make)*2 for twos, P(make)*3 for threes. FT expected points use
//      ACTUAL made-FT points (xeFG does not model free throws). PPP is
//      per-possession (points / possessions), NOT per-100.
//
// Usage:
//   npx tsx scripts/derive-lineup-stints.ts [options]
//
// Options:
//   --season=YYYY      Season year (default: 2025)
//   --team=ID          Restrict to one team ID (can repeat)
//   --game=ID          Restrict to one game ID (can repeat)
//   --limit-games=N    Process at most N games (for smoke-testing)
//   --dry-run          Print stints to stdout; do NOT write to DB
//   --write            Upsert stints to DB (replaces existing for same game+team)
//   --verbose          Print per-game detail even when --write is active
// ============================================================================
import 'dotenv/config';
import { createHash } from 'crypto';
import { prisma } from '../lib/prisma';
import { predictShot, annotateSecondsSinceDefEvent } from '../lib/xefg';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const seasonArg = args.find((a) => a.startsWith('--season='));
const SEASON = seasonArg ? Number(seasonArg.split('=')[1]) : 2025;
const teamArgs = args.filter((a) => a.startsWith('--team=')).map((a) => Number(a.split('=')[1]));
const gameArgs = args.filter((a) => a.startsWith('--game=')).map((a) => Number(a.split('=')[1]));
const limitGames = args.find((a) => a.startsWith('--limit-games='))
  ? Number(args.find((a) => a.startsWith('--limit-games='))!.split('=')[1])
  : null;
const DRY_RUN = args.includes('--dry-run');
const WRITE = args.includes('--write');
const VERBOSE = args.includes('--verbose') || DRY_RUN;

if (!DRY_RUN && !WRITE) {
  console.error('Pass --dry-run or --write');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface RawPlay {
  id: string;
  gameId: number;
  period: number;
  secondsRemaining: number;
  playType: string | null;
  playText: string | null;
  playerId: number | null;
  teamId: number | null;
  homeScore: number | null;
  awayScore: number | null;
  scoringPlay: boolean | null;
  shootingPlay: boolean | null;
  shotMade: boolean | null;
  shotRange: string | null;
  shotX: number | null;
  shotY: number | null;
  scoreValue: number | null;
}

interface StintDraft {
  period: number;
  startSeconds: number;
  endSeconds: number;
  playerIds: number[] | null; // null = lineup unknown (gap)
  confidence: 'full' | 'partial' | 'gap';
  notes: string[];
  // box-score accumulators (our team)
  pointsFor: number;
  pointsAgainst: number;
  fga: number; fgm: number;
  threepa: number; threepm: number;
  fta: number; ftm: number;
  offRebounds: number; defRebounds: number;
  turnovers: number; assists: number; steals: number; blocks: number;
  // opponent box-score accumulators (for possessionsAgainst)
  oppFga: number; oppFta: number; oppOreb: number; oppTurnovers: number;
  // xeFG expected points (model only covers FGA with coordinates).
  // FT points use ACTUAL made-FT points (xeFG does not model free throws).
  expectedPointsFor: number;
  expectedPointsAgainst: number;
  shotQualityFgaFor: number;   // count of our FGA that received an xeFG prediction
  shotQualityFgaAgainst: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function lineupHash(ids: number[]): string {
  const key = [...ids].sort((a, b) => a - b).join(',');
  return createHash('md5').update(key).digest('hex').slice(0, 12);
}

function canonicalIds(ids: number[]): string {
  return [...ids].sort((a, b) => a - b).join(',');
}

// Parse playText to determine direction. Returns 'in' | 'out' | null.
function subDirection(playText: string | null): 'in' | 'out' | null {
  if (!playText) return null;
  const lower = playText.toLowerCase();
  if (lower.includes('subbing in')) return 'in';
  if (lower.includes('subbing out')) return 'out';
  return null;
}

// Standard Four Factors possession estimate.
function possessions(fga: number, fta: number, oreb: number, to: number): number {
  return fga + 0.44 * fta - oreb + to;
}

// ---------------------------------------------------------------------------
// Core: reconstruct stints for one team within one game
// ---------------------------------------------------------------------------
function deriveStintsForTeam(
  teamId: number,
  opponentTeamId: number | null,
  plays: RawPlay[],
  isHomeTeam: boolean,
  gameHomeTeamId: number | null,
  transitions: Map<string, number | null>,
): StintDraft[] {
  // Bucket plays by period
  const periods = [...new Set(plays.map((p) => p.period))].sort((a, b) => a - b);
  const stints: StintDraft[] = [];

  for (const period of periods) {
    const periodPlays = plays
      .filter((p) => p.period === period)
      .sort((a, b) => b.secondsRemaining - a.secondsRemaining); // high → low (game time flows down)

    const periodStart = periodPlays[0]?.secondsRemaining ?? 1200;

    // Substitution events for this team this period, bucketed by clock tick.
    const subPlays = periodPlays.filter(
      (p) => p.playType === 'Substitution' && p.teamId === teamId,
    );

    if (subPlays.length === 0) {
      // No sub data — emit a single gap stint covering the whole period.
      const gap = makeStint(period, periodStart, 0, null, 'gap', ['no substitution data for this period']);
      accumulateBoxScore(gap, periodPlays, teamId, gameHomeTeamId, transitions);
      stints.push(gap);
      continue;
    }

    // Group subs into clock ticks (same secondsRemaining = simultaneous swap).
    const tickMap = new Map<number, { ins: number[]; outs: number[]; nullCount: number }>();
    for (const sp of subPlays) {
      const tick = sp.secondsRemaining;
      if (!tickMap.has(tick)) tickMap.set(tick, { ins: [], outs: [], nullCount: 0 });
      const bucket = tickMap.get(tick)!;
      const dir = subDirection(sp.playText);
      if (sp.playerId === null) {
        bucket.nullCount++;
      } else if (dir === 'in') {
        bucket.ins.push(sp.playerId);
      } else if (dir === 'out') {
        bucket.outs.push(sp.playerId);
      }
    }

    // Sort ticks descending (high secondsRemaining = early in period).
    const ticks = [...tickMap.keys()].sort((a, b) => b - a);

    // ---- Infer starting lineup ----
    // Strategy for period 1:
    //   The first sub event tells us who was on the floor at tip-off ONLY for the
    //   players who "subbed out" — those were definitely starters. Players who
    //   "subbed in" at that same tick were NOT starters (they replaced someone).
    //   The remaining starters are players who appear in period-1 plays with this
    //   teamId whose playerId is NOT in any "subbing in" set at or before the first
    //   sub tick AND who are not in any "subbing out" set at the first sub tick
    //   (because those we're removing). We collect all player IDs that touched the
    //   ball for this team before the first sub and use that as the universe.
    //
    // For period 2+, CBBD emits halftime adjustment subs at secondsRemaining=1200.
    // Those subs tell us exactly who starts the second period/OT.

    let currentLineup: Set<number> | null = null;
    let nullsInLineup = 0;

    const firstTick = ticks[0];
    const firstBucket = tickMap.get(firstTick)!;

    // All players who ever subbed IN across the entire period (they weren't starters).
    const allSubIns = new Set<number>();
    for (const bucket of tickMap.values()) {
      for (const pid of bucket.ins) allSubIns.add(pid);
    }

    if (period === 1) {
      // Players seen in non-sub plays BEFORE or AT the first sub tick who were NOT
      // subbed in (i.e., they were already on the floor at tip-off).
      const seenBeforeFirstSub = new Set<number>();
      for (const p of periodPlays) {
        if (p.secondsRemaining < firstTick) break; // past first sub — stop
        if (p.playType === 'Substitution') continue;
        if (p.teamId === teamId && p.playerId !== null) {
          seenBeforeFirstSub.add(p.playerId);
        }
      }

      if (firstBucket.outs.length > 0 || seenBeforeFirstSub.size > 0) {
        // Starters = outs at first tick + players seen before first sub who weren't sub-ins.
        const starters = new Set<number>([...firstBucket.outs]);
        for (const pid of seenBeforeFirstSub) {
          if (!allSubIns.has(pid)) starters.add(pid);
        }
        // Now apply the first swap to get the post-first-sub lineup.
        currentLineup = new Set(starters);
        for (const pid of firstBucket.outs) currentLineup.delete(pid);
        for (const pid of firstBucket.ins) currentLineup.add(pid);
      } else {
        // Only ins at first tick with no prior play events — can't reconstruct starters.
        currentLineup = null;
      }
    } else {
      // Period 2+: halftime / OT subs at tick == periodStart (1200 or 300 for OT).
      // The "outs" at this tick are ending the previous period; the "ins" are
      // starting the new period.
      const startTick = ticks.find((t) => t === periodStart);
      if (startTick !== undefined) {
        const startBucket = tickMap.get(startTick)!;
        if (startBucket.ins.length > 0) {
          // Build lineup from the previous period's ending lineup if available,
          // then apply the halftime subs.
          const prevPeriodEndLineup = getPrevPeriodEndLineup(stints, period);
          if (prevPeriodEndLineup) {
            currentLineup = new Set(prevPeriodEndLineup);
            for (const pid of startBucket.outs) currentLineup.delete(pid);
            for (const pid of startBucket.ins) currentLineup.add(pid);
          } else {
            // No prev period data — infer purely from "ins" at period start.
            // We'll mark as partial since we don't know the full 5.
            currentLineup = new Set(startBucket.ins);
          }
          nullsInLineup += startBucket.nullCount;
        } else if (startBucket.outs.length > 0) {
          // Only outs at period start — unusual; carry prev lineup.
          const prevPeriodEndLineup = getPrevPeriodEndLineup(stints, period);
          currentLineup = prevPeriodEndLineup ? new Set(prevPeriodEndLineup) : null;
          for (const pid of startBucket.outs) currentLineup?.delete(pid);
          nullsInLineup += startBucket.nullCount;
        } else {
          // Null-only subs at start — use prev lineup.
          const prevPeriodEndLineup = getPrevPeriodEndLineup(stints, period);
          currentLineup = prevPeriodEndLineup ? new Set(prevPeriodEndLineup) : null;
          nullsInLineup += startBucket.nullCount;
        }
      } else {
        // No subs at period start — carry previous period's ending lineup.
        const prevPeriodEndLineup = getPrevPeriodEndLineup(stints, period);
        currentLineup = prevPeriodEndLineup ? new Set(prevPeriodEndLineup) : null;
      }
    }

    // ---- Walk through all ticks and emit stints ----
    // Build sorted list of all change-point seconds (including period end = 0).
    // All ticks where a swap occurs (skip the period-start tick for p2+ since
    // it was used to set currentLineup above).
    const changeTicks = ticks.filter((t) => {
      if (period !== 1 && t === periodStart) return false; // already applied above
      return true;
    });

    // Insert synthetic "end of period" tick at 0 if not already there.
    if (!changeTicks.includes(0)) changeTicks.push(0);
    // Re-sort descending.
    changeTicks.sort((a, b) => b - a);

    let stintStart = periodStart;
    let stintNulls = nullsInLineup;
    let stintNotes: string[] = [];

    // Helper: emit current stint from stintStart down to tick boundary.
    const emitStint = (endSeconds: number) => {
      if (stintStart <= endSeconds) return; // zero-length or inverted — skip
      const ids = currentLineup ? [...currentLineup].sort((a, b) => a - b) : null;
      const conf: 'full' | 'partial' | 'gap' =
        currentLineup === null ? 'gap' : stintNulls > 0 ? 'partial' : 'full';
      const s = makeStint(period, stintStart, endSeconds, ids, conf, stintNotes);
      // Accumulate box score for plays in (endSeconds, stintStart] window.
      const window = periodPlays.filter(
        (p) => p.secondsRemaining <= stintStart && p.secondsRemaining > endSeconds,
      );
      accumulateBoxScore(s, window, teamId, gameHomeTeamId, transitions);
      stints.push(s);
    };

    for (let i = 0; i < changeTicks.length; i++) {
      const tick = changeTicks[i];

      if (tick === 0) {
        // End of period: emit remaining stint.
        emitStint(0);
        break;
      }

      const bucket = tickMap.get(tick);
      if (!bucket) {
        // Synthetic tick (e.g., end-of-period 0) — skip.
        continue;
      }

      // Emit the stint that ran from stintStart down to this tick.
      emitStint(tick);

      // Apply the substitution.
      stintStart = tick;
      stintNulls = bucket.nullCount;
      stintNotes = [];

      if (bucket.nullCount > 0) {
        stintNotes.push(`${bucket.nullCount} sub(s) had null playerId at ${tick}s`);
      }

      if (currentLineup !== null) {
        for (const pid of bucket.outs) currentLineup.delete(pid);
        for (const pid of bucket.ins) currentLineup.add(pid);
      }

      // Validate: if lineup drifts to wrong size, flag it.
      if (currentLineup !== null && currentLineup.size !== 5) {
        stintNotes.push(`lineup size ${currentLineup.size} after sub at ${tick}s (expected 5)`);
        if (stintNulls === 0) stintNulls = bucket.nullCount + 1;
      }
    }
  }

  return stints;
}

// Get the final lineup from the last stint of the previous period.
function getPrevPeriodEndLineup(stints: StintDraft[], period: number): number[] | null {
  const prevStints = stints.filter((s) => s.period === period - 1 && s.playerIds !== null);
  if (prevStints.length === 0) return null;
  return prevStints[prevStints.length - 1].playerIds;
}

function makeStint(
  period: number,
  startSeconds: number,
  endSeconds: number,
  playerIds: number[] | null,
  confidence: 'full' | 'partial' | 'gap',
  notes: string[],
): StintDraft {
  return {
    period, startSeconds, endSeconds,
    playerIds, confidence, notes,
    pointsFor: 0, pointsAgainst: 0,
    fga: 0, fgm: 0, threepa: 0, threepm: 0,
    fta: 0, ftm: 0,
    offRebounds: 0, defRebounds: 0,
    turnovers: 0, assists: 0, steals: 0, blocks: 0,
    oppFga: 0, oppFta: 0, oppOreb: 0, oppTurnovers: 0,
    expectedPointsFor: 0, expectedPointsAgainst: 0,
    shotQualityFgaFor: 0, shotQualityFgaAgainst: 0,
  };
}

const SHOT_TYPES = new Set(['JumpShot', 'LayUpShot', 'DunkShot', 'TipShot']);

// Expected points for one FGA from the xeFG model.
//   2PT FGA: P(make) * 2
//   3PT FGA: P(make) * 3
// `transitions` maps play.id → secondsSinceDefEvent (for the is_transition feature).
function expectedPointsForShot(
  p: RawPlay,
  gameHomeTeamId: number | null,
  secondsSinceDefEvent: number | null,
): number | null {
  if (p.shotX === null || p.shotY === null) return null; // no coords — can't predict
  const { pMake } = predictShot({
    shotX: p.shotX,
    shotY: p.shotY,
    shotRange: p.shotRange,
    playType: p.playType,
    shotMade: p.shotMade,
    period: p.period,
    secondsRemaining: p.secondsRemaining,
    homeScore: p.homeScore,
    awayScore: p.awayScore,
    teamId: p.teamId,
    gameHomeTeamId,
    secondsSinceDefEvent,
  });
  const isThree = p.shotRange === 'three_pointer';
  return pMake * (isThree ? 3 : 2);
}

function accumulateBoxScore(
  stint: StintDraft,
  plays: RawPlay[],
  teamId: number,
  gameHomeTeamId: number | null,
  transitions: Map<string, number | null>,
) {
  for (const p of plays) {
    const isOurTeam = p.teamId === teamId;
    const isOpponent = !isOurTeam && p.teamId !== null;
    const isShot = SHOT_TYPES.has(p.playType ?? '');
    // 3PT detection uses shotRange — format-agnostic across seasons.
    const isThree = p.shotRange === 'three_pointer';

    // Points — scoringPlay + scoreValue covers both FGs and FTs (no double-count).
    if (p.scoringPlay && p.scoreValue != null) {
      if (isOurTeam) stint.pointsFor += p.scoreValue;
      else if (isOpponent) stint.pointsAgainst += p.scoreValue;
    }

    if (isOurTeam) {
      if (isShot) {
        stint.fga++;
        if (p.shotMade) stint.fgm++;
        if (isThree) {
          stint.threepa++;
          if (p.shotMade) stint.threepm++;
        }
        const xp = expectedPointsForShot(p, gameHomeTeamId, transitions.get(p.id) ?? null);
        if (xp !== null) {
          stint.expectedPointsFor += xp;
          stint.shotQualityFgaFor++;
        }
      }
      if (p.playType === 'MadeFreeThrow') {
        stint.fta++;
        if (p.shotMade !== false) {
          stint.ftm++;
          // FTs are not modelled by xeFG — use actual made-FT points.
          stint.expectedPointsFor += 1;
        }
      }
      if (p.playType === 'Offensive Rebound') stint.offRebounds++;
      if (p.playType === 'Defensive Rebound') stint.defRebounds++;
      if (p.playType?.includes('Turnover')) stint.turnovers++;
      if (p.playType === 'Steal') stint.steals++;
      if (p.playType === 'Block Shot') stint.blocks++;
    } else if (isOpponent) {
      // Opponent box score — needed for possessionsAgainst + expected PPP allowed.
      if (isShot) {
        stint.oppFga++;
        const xp = expectedPointsForShot(p, gameHomeTeamId, transitions.get(p.id) ?? null);
        if (xp !== null) {
          stint.expectedPointsAgainst += xp;
          stint.shotQualityFgaAgainst++;
        }
      }
      if (p.playType === 'MadeFreeThrow') {
        stint.oppFta++;
        if (p.shotMade !== false) stint.expectedPointsAgainst += 1;
      }
      if (p.playType === 'Offensive Rebound') stint.oppOreb++;
      if (p.playType?.includes('Turnover')) stint.oppTurnovers++;
    }
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------
interface GameValidation {
  gameId: number;
  teamId: number;
  stints: number;
  allFive: boolean;
  minutesCovered: number; // seconds
  minutesExpected: number;
  pctCovered: number;
  pointsFromStints: number;
  pointsActual: number | null;
  possFromStints: number;
  fullStints: number;
  partialStints: number;
  gapStints: number;
  issues: string[];
}

function validateGame(
  gameId: number,
  teamId: number,
  stints: StintDraft[],
  isHomeTeam: boolean,
  homeScore: number | null,
  awayScore: number | null,
  periods: number[],
): GameValidation {
  const actualPoints = isHomeTeam ? homeScore : awayScore;
  const issues: string[] = [];
  let allFive = true;
  let minutesCovered = 0;
  let pointsFromStints = 0;
  let possFromStints = 0;
  let fullStints = 0, partialStints = 0, gapStints = 0;

  for (const s of stints) {
    const duration = s.startSeconds - s.endSeconds;
    minutesCovered += duration;
    pointsFromStints += s.pointsFor;
    possFromStints += possessions(s.fga, s.fta, s.offRebounds, s.turnovers);
    if (s.confidence === 'full') fullStints++;
    else if (s.confidence === 'partial') partialStints++;
    else gapStints++;
    if (s.playerIds !== null && s.playerIds.length !== 5) {
      allFive = false;
      issues.push(`Stint p${s.period} ${s.startSeconds}-${s.endSeconds}s has ${s.playerIds.length} players`);
    }
    for (const note of s.notes) issues.push(`  note: ${note}`);
  }

  // Expected minutes = 20min per regulation half + 5min per OT.
  const maxPeriod = Math.max(...periods, 2);
  const expectedSeconds = maxPeriod <= 2 ? 2400 : 2400 + (maxPeriod - 2) * 300;

  const pctCovered = expectedSeconds > 0 ? (minutesCovered / expectedSeconds) * 100 : 0;

  if (actualPoints !== null && Math.abs(pointsFromStints - actualPoints) > 2) {
    issues.push(`Points mismatch: stints=${pointsFromStints} actual=${actualPoints}`);
  }

  return {
    gameId, teamId, stints: stints.length, allFive, minutesCovered,
    minutesExpected: expectedSeconds, pctCovered, pointsFromStints,
    pointsActual: actualPoints, possFromStints, fullStints, partialStints,
    gapStints, issues,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // Build game filter
  const gameWhere: Record<string, unknown> = { season: SEASON };
  if (gameArgs.length > 0) {
    gameWhere['id'] = { in: gameArgs };
  } else if (teamArgs.length > 0) {
    gameWhere['OR'] = [{ homeTeamId: { in: teamArgs } }, { awayTeamId: { in: teamArgs } }];
  }

  const games = await prisma.game.findMany({
    where: gameWhere,
    orderBy: { id: 'asc' },
    ...(limitGames ? { take: limitGames } : {}),
  });

  console.log(`\nProcessing ${games.length} games (season ${SEASON}, ${DRY_RUN ? 'DRY RUN' : 'WRITE'})`);

  const allValidations: GameValidation[] = [];
  let gamesWithSubs = 0;
  let gamesWithoutSubs = 0;
  let totalStints = 0;
  let totalWritten = 0;

  for (const game of games) {
    const plays = await prisma.play.findMany({
      where: { gameId: game.id },
      orderBy: [{ period: 'asc' }, { secondsRemaining: 'desc' }],
      select: {
        id: true, gameId: true, period: true, secondsRemaining: true,
        playType: true, playText: true, playerId: true, teamId: true,
        homeScore: true, awayScore: true, scoringPlay: true, shootingPlay: true,
        shotMade: true, shotRange: true, shotX: true, shotY: true, scoreValue: true,
      },
    }) as RawPlay[];

    // Transition map (secondsSinceDefEvent per play) — required by the xeFG model.
    const transitions = annotateSecondsSinceDefEvent(
      plays.map((p) => ({
        id: p.id, gameId: p.gameId, period: p.period,
        secondsRemaining: p.secondsRemaining, playType: p.playType,
      })),
    );

    const subCount = plays.filter((p) => p.playType === 'Substitution').length;
    if (subCount === 0) {
      gamesWithoutSubs++;
      if (VERBOSE) {
        console.log(`  game ${game.id}: 0 subs — skipped (no lineup data)`);
      }
      continue;
    }
    gamesWithSubs++;

    const periods = [...new Set(plays.map((p) => p.period))].sort((a, b) => a - b);
    const teamIds: Array<{ id: number; isHome: boolean }> = [];
    if (game.homeTeamId) teamIds.push({ id: game.homeTeamId, isHome: true });
    if (game.awayTeamId) teamIds.push({ id: game.awayTeamId, isHome: false });

    // Restrict to requested teams if specified.
    const filteredTeamIds = teamArgs.length > 0
      ? teamIds.filter((t) => teamArgs.includes(t.id))
      : teamIds;

    for (const { id: teamId, isHome } of filteredTeamIds) {
      const stints = deriveStintsForTeam(
        teamId,
        isHome ? (game.awayTeamId ?? null) : (game.homeTeamId ?? null),
        plays,
        isHome,
        game.homeTeamId ?? null,
        transitions,
      );

      const validation = validateGame(
        game.id, teamId, stints, isHome,
        game.homeScore, game.awayScore, periods,
      );
      allValidations.push(validation);
      totalStints += stints.length;

      if (VERBOSE) {
        const pct = validation.pctCovered.toFixed(1);
        const issueStr = validation.issues.length > 0 ? ` ⚠ ${validation.issues.length} issue(s)` : ' ✓';
        console.log(
          `  game ${game.id} team ${teamId}: ${stints.length} stints | ` +
          `${pct}% covered | pts ${validation.pointsFromStints}/${validation.pointsActual ?? '?'} | ` +
          `full:${validation.fullStints} partial:${validation.partialStints} gap:${validation.gapStints}${issueStr}`
        );
        for (const issue of validation.issues) console.log(`    ${issue}`);

        // Print stints detail in dry-run
        if (DRY_RUN) {
          for (const s of stints) {
            const ids = s.playerIds ? s.playerIds.join(',') : 'UNKNOWN';
            console.log(
              `    p${s.period} ${String(s.startSeconds).padStart(4)}s→${String(s.endSeconds).padStart(4)}s` +
              ` [${s.confidence.padEnd(7)}] pts=${s.pointsFor} xPts=${s.expectedPointsFor.toFixed(1)}` +
              ` fga=${s.fga}(${s.shotQualityFgaFor} xq) oreb=${s.offRebounds} to=${s.turnovers}` +
              ` | ${ids}`
            );
          }
        }
      }

      if (WRITE) {
        // Delete old stints for this game+team, then insert fresh.
        await prisma.lineupStint.deleteMany({ where: { gameId: game.id, teamId } });
        const rows = stints.map((s) => {
          const poss = possessions(s.fga, s.fta, s.offRebounds, s.turnovers);
          const oppPoss = possessions(s.oppFga, s.oppFta, s.oppOreb, s.oppTurnovers);
          // PPP is per-possession (points / possessions), NOT per-100.
          // Require >= 2 possessions before reporting a rate (single-possession
          // stints are pure noise — common with rapid sub waves).
          const minPoss = 2;
          const pppFor = poss >= minPoss ? s.pointsFor / poss : null;
          const pppAgainst = oppPoss >= minPoss ? s.pointsAgainst / oppPoss : null;
          const expPppFor = poss >= minPoss ? s.expectedPointsFor / poss : null;
          const expPppAgainst = oppPoss >= minPoss ? s.expectedPointsAgainst / oppPoss : null;
          return {
            season: SEASON,
            gameId: game.id,
            teamId,
            opponentTeamId: isHome ? (game.awayTeamId ?? null) : (game.homeTeamId ?? null),
            period: s.period,
            startSeconds: s.startSeconds,
            endSeconds: s.endSeconds,
            playerIds: s.playerIds ? canonicalIds(s.playerIds) : null,
            lineupHash: s.playerIds ? lineupHash(s.playerIds) : null,
            pointsFor: s.pointsFor,
            pointsAgainst: s.pointsAgainst,
            fga: s.fga, fgm: s.fgm,
            threepa: s.threepa, threepm: s.threepm,
            fta: s.fta, ftm: s.ftm,
            offRebounds: s.offRebounds,
            defRebounds: s.defRebounds,
            turnovers: s.turnovers,
            assists: s.assists,
            steals: s.steals,
            blocks: s.blocks,
            possessionsFor: poss > 0 ? poss : null,
            possessionsAgainst: oppPoss > 0 ? oppPoss : null,
            pppFor,
            pppAgainst,
            netPpp: pppFor !== null && pppAgainst !== null ? pppFor - pppAgainst : null,
            expectedPointsFor: s.expectedPointsFor,
            expectedPointsAgainst: s.expectedPointsAgainst,
            expectedPppFor: expPppFor,
            expectedPppAgainst: expPppAgainst,
            expectedNetPpp:
              expPppFor !== null && expPppAgainst !== null ? expPppFor - expPppAgainst : null,
            shotQualityFgaFor: s.shotQualityFgaFor,
            shotQualityFgaAgainst: s.shotQualityFgaAgainst,
            confidence: s.confidence,
            notes: s.notes.length > 0 ? s.notes.join('; ') : null,
          };
        });
        if (rows.length > 0) {
          await prisma.lineupStint.createMany({ data: rows });
          totalWritten += rows.length;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Summary report
  // ---------------------------------------------------------------------------
  console.log(`\n${'='.repeat(60)}`);
  console.log(`SUMMARY — season ${SEASON}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Games processed:        ${games.length}`);
  console.log(`  Games with sub data:    ${gamesWithSubs}`);
  console.log(`  Games without sub data: ${gamesWithoutSubs} (skipped)`);
  console.log(`  Total stints derived:   ${totalStints}`);
  if (WRITE) console.log(`  Stints written to DB:   ${totalWritten}`);

  if (allValidations.length > 0) {
    const allFiveCount = allValidations.filter((v) => v.allFive).length;
    const avgCovered = allValidations.reduce((s, v) => s + v.pctCovered, 0) / allValidations.length;
    const withIssues = allValidations.filter((v) => v.issues.length > 0).length;
    const totalFull = allValidations.reduce((s, v) => s + v.fullStints, 0);
    const totalPartial = allValidations.reduce((s, v) => s + v.partialStints, 0);
    const totalGap = allValidations.reduce((s, v) => s + v.gapStints, 0);

    console.log(`\n  Validation (${allValidations.length} team-game pairs)`);
    console.log(`  All stints have 5 players:  ${allFiveCount}/${allValidations.length}`);
    console.log(`  Avg time coverage:           ${avgCovered.toFixed(1)}%`);
    console.log(`  Team-games with issues:      ${withIssues}`);
    console.log(`  Confidence breakdown:`);
    console.log(`    full:    ${totalFull}`);
    console.log(`    partial: ${totalPartial}`);
    console.log(`    gap:     ${totalGap}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
