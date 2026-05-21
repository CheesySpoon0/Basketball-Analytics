// ============================================================================
// xeFG aggregation over arbitrary shot sets (player, team-offense, team-defense).
//
// Pulls plays from Prisma in batches by game so we can compute the transition
// feature correctly (it requires the full play stream of each game).
//
// Result is cached in PlayerXeFG / TeamXeFG via scripts/compute-xefg-cache.ts.
// ============================================================================
import { prisma } from '../prisma';
import { predictShot } from './predict';
import { annotateSecondsSinceDefEvent } from './transition';
import { classifyZone } from './features';
import type { XeFGAggregate, ZoneAggregate } from './types';

function pct(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

function emptyZone(): { fgm: number; fga: number; threeMade: number; sumExpected: number } {
  return { fgm: 0, fga: 0, threeMade: 0, sumExpected: 0 };
}

interface ZoneAcc {
  fgm: number;
  fga: number;
  threeMade: number;
  sumExpected: number;
}

interface RawAcc {
  total: ZoneAcc;
  byZone: { rim: ZoneAcc; mid: ZoneAcc; three: ZoneAcc };
}

function emptyAcc(): RawAcc {
  return {
    total: emptyZone(),
    byZone: { rim: emptyZone(), mid: emptyZone(), three: emptyZone() },
  };
}

function finalizeZone(z: ZoneAcc): ZoneAggregate {
  const fgPct = pct(z.fgm, z.fga);
  // actual eFG = (FGM + 0.5·3PM) / FGA
  const actualEfg = z.fga > 0 ? (z.fgm + 0.5 * z.threeMade) / z.fga : null;
  // expected eFG = Σ P(make)×shotValue / FGA; twos use 1.0, threes use 1.5 (see predict.ts)
  const expectedEfg = z.fga > 0 ? z.sumExpected / z.fga : null;
  const delta = actualEfg !== null && expectedEfg !== null ? actualEfg - expectedEfg : null;
  return { sampleSize: z.fga, fgPct, actualEfg, expectedEfg, delta };
}

function finalize(acc: RawAcc): XeFGAggregate {
  const total = finalizeZone(acc.total);
  return {
    sampleSize: total.sampleSize,
    fgPct: total.fgPct,
    actualEfg: total.actualEfg,
    expectedEfg: total.expectedEfg,
    delta: total.delta,
    byZone: {
      rim: finalizeZone(acc.byZone.rim),
      mid: finalizeZone(acc.byZone.mid),
      three: finalizeZone(acc.byZone.three),
    },
  };
}

/**
 * Pull all plays for the given game-set, annotate transition, and process the
 * subset of shots matching `shooterMatches(play)` predicate.
 *
 * This is the core loop: every aggregator (player, team-offense, team-defense)
 * funnels through it.
 */
async function aggregateForGames(
  gameIds: number[],
  shooterMatches: (play: {
    playerId: number | null;
    teamId: number | null;
  }) => boolean,
): Promise<XeFGAggregate> {
  const acc = emptyAcc();
  if (gameIds.length === 0) return finalize(acc);

  // Process one game at a time to keep memory bounded — many teams have ~30 games.
  for (const gameId of gameIds) {
    const plays = await prisma.play.findMany({
      where: { gameId },
      select: {
        id: true,
        gameId: true,
        playerId: true,
        teamId: true,
        period: true,
        secondsRemaining: true,
        playType: true,
        shotMade: true,
        shotRange: true,
        shotX: true,
        shotY: true,
        homeScore: true,
        awayScore: true,
        game: { select: { homeTeamId: true } },
      },
    });
    if (plays.length === 0) continue;
    const transitions = annotateSecondsSinceDefEvent(plays);

    for (const p of plays) {
      if (p.shotMade === null) continue;
      if (p.shotX === null || p.shotY === null) continue;
      if (p.shotRange === 'free_throw') continue;
      if (!shooterMatches({ playerId: p.playerId, teamId: p.teamId })) continue;

      const { expectedEfg, isThree } = predictShot({
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
        gameHomeTeamId: p.game.homeTeamId,
        secondsSinceDefEvent: transitions.get(p.id) ?? null,
      });

      const zone = classifyZone(p.shotRange, p.shotX, p.shotY);
      const made = p.shotMade ? 1 : 0;
      const wasThree = isThree === 1;

      acc.total.fga += 1;
      acc.total.fgm += made;
      acc.total.threeMade += made && wasThree ? 1 : 0;
      acc.total.sumExpected += expectedEfg;

      const z = acc.byZone[zone];
      z.fga += 1;
      z.fgm += made;
      z.threeMade += made && wasThree ? 1 : 0;
      z.sumExpected += expectedEfg;
    }
  }
  return finalize(acc);
}

// ============================================================================
// Public API
// ============================================================================

export async function computePlayerXeFG(
  playerId: number,
  season: number,
): Promise<XeFGAggregate> {
  const games = await prisma.game.findMany({
    where: { season, plays: { some: { playerId } } },
    select: { id: true },
  });
  return aggregateForGames(
    games.map((g) => g.id),
    (play) => play.playerId === playerId,
  );
}

export async function computeTeamXeFG(
  teamId: number,
  season: number,
  side: 'offense' | 'defense',
): Promise<XeFGAggregate> {
  const games = await prisma.game.findMany({
    where: {
      season,
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
    },
    select: { id: true },
  });
  if (side === 'offense') {
    return aggregateForGames(
      games.map((g) => g.id),
      (play) => play.teamId === teamId,
    );
  }
  // defense = what OPPONENTS shot against this team
  return aggregateForGames(
    games.map((g) => g.id),
    (play) => play.teamId !== null && play.teamId !== teamId,
  );
}

// ============================================================================
// Bulk season pass — computes EVERY player + team aggregate in one streaming
// pass over the season's plays. Used by scripts/compute-xefg-cache.ts.
//
// The per-entity functions above issue ~31 queries per player; at national
// scale (~8,700 players) that is ~270K queries and hours of runtime. This does
// the same arithmetic but reads each game's plays exactly once.
// ============================================================================

export interface SeasonXeFG {
  players: Map<number, XeFGAggregate>;
  teamOffense: Map<number, XeFGAggregate>;
  teamDefense: Map<number, XeFGAggregate>;
}

export async function aggregateSeasonXeFG(season: number): Promise<SeasonXeFG> {
  const games = await prisma.game.findMany({
    where: { season },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  const gameIds = games.map((g) => g.id);

  const playerAcc = new Map<number, RawAcc>();
  const offenseAcc = new Map<number, RawAcc>();
  const defenseAcc = new Map<number, RawAcc>();
  const getAcc = (map: Map<number, RawAcc>, key: number): RawAcc => {
    let acc = map.get(key);
    if (!acc) {
      acc = emptyAcc();
      map.set(key, acc);
    }
    return acc;
  };

  // Read plays in game-id batches so memory stays bounded. Transition
  // annotation needs each game's full stream, so we group by gameId first.
  const GAME_BATCH = 400;
  for (let i = 0; i < gameIds.length; i += GAME_BATCH) {
    const batch = gameIds.slice(i, i + GAME_BATCH);
    const plays = await prisma.play.findMany({
      where: { gameId: { in: batch } },
      select: {
        id: true,
        gameId: true,
        playerId: true,
        teamId: true,
        period: true,
        secondsRemaining: true,
        playType: true,
        shotMade: true,
        shotRange: true,
        shotX: true,
        shotY: true,
        homeScore: true,
        awayScore: true,
        game: { select: { homeTeamId: true, awayTeamId: true } },
      },
    });

    const byGame = new Map<number, typeof plays>();
    for (const p of plays) {
      const bucket = byGame.get(p.gameId);
      if (bucket) bucket.push(p);
      else byGame.set(p.gameId, [p]);
    }

    for (const gamePlays of byGame.values()) {
      const transitions = annotateSecondsSinceDefEvent(gamePlays);
      for (const p of gamePlays) {
        if (p.shotMade === null) continue;
        if (p.shotX === null || p.shotY === null) continue;
        if (p.shotRange === 'free_throw') continue;

        const { expectedEfg, isThree } = predictShot({
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
          gameHomeTeamId: p.game.homeTeamId,
          secondsSinceDefEvent: transitions.get(p.id) ?? null,
        });

        const zone = classifyZone(p.shotRange, p.shotX, p.shotY);
        const made = p.shotMade ? 1 : 0;
        const wasThree = isThree === 1;

        const apply = (acc: RawAcc) => {
          for (const z of [acc.total, acc.byZone[zone]]) {
            z.fga += 1;
            z.fgm += made;
            z.threeMade += made && wasThree ? 1 : 0;
            z.sumExpected += expectedEfg;
          }
        };

        if (p.playerId !== null) apply(getAcc(playerAcc, p.playerId));

        // Offense = shooting team; defense = the other team in this game.
        if (p.teamId !== null) {
          apply(getAcc(offenseAcc, p.teamId));
          const homeId = p.game.homeTeamId;
          const awayId = p.game.awayTeamId;
          const defenderId =
            p.teamId === homeId ? awayId : p.teamId === awayId ? homeId : null;
          if (defenderId !== null) apply(getAcc(defenseAcc, defenderId));
        }
      }
    }
  }

  const finalizeMap = (m: Map<number, RawAcc>) => {
    const out = new Map<number, XeFGAggregate>();
    for (const [key, acc] of m) out.set(key, finalize(acc));
    return out;
  };

  return {
    players: finalizeMap(playerAcc),
    teamOffense: finalizeMap(offenseAcc),
    teamDefense: finalizeMap(defenseAcc),
  };
}

/** Pretty-print a delta as "+3.2pp" / "-1.1pp" / "—". */
export function formatDelta(delta: number | null, digits = 1): string {
  if (delta === null || Number.isNaN(delta)) return '—';
  const pp = delta * 100;
  const sign = pp > 0 ? '+' : '';
  return `${sign}${pp.toFixed(digits)}pp`;
}

/** Pretty-print a rate as "53.8%" or "—". */
export function formatRate(r: number | null, digits = 1): string {
  if (r === null || Number.isNaN(r)) return '—';
  return `${(r * 100).toFixed(digits)}%`;
}
