// Build per-shot P(make) for team heatmaps (requires full game play streams for
// transition annotation). Heatmap colors use expected FG%, not expected eFG.
import { prisma } from '../prisma';
import { predictShot } from './predict';
import { annotateSecondsSinceDefEvent } from './transition';

export type HeatmapShot = {
  x: number;
  y: number;
  made: boolean;
  range: string | null;
  /** Model P(make) — not eFG; heatmap toggle labels this Expected FG%. */
  expectedFg: number;
};

export async function buildTeamHeatmapShots(
  teamId: number,
  season: number,
): Promise<HeatmapShot[]> {
  const games = await prisma.game.findMany({
    where: {
      season,
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
    },
    select: { id: true },
  });
  const gameIds = games.map((g) => g.id);

  const out: HeatmapShot[] = [];
  if (gameIds.length === 0) return out;

  // Fetch every play for all of the team's games in one query, then group by
  // gameId in memory. Transition annotation needs the full per-game stream, so
  // we can't pre-filter to this team — but a single round-trip beats one query
  // per game.
  const allPlays = await prisma.play.findMany({
    where: { gameId: { in: gameIds } },
    select: {
      id: true,
      gameId: true,
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

  const playsByGame = new Map<number, typeof allPlays>();
  for (const p of allPlays) {
    const bucket = playsByGame.get(p.gameId);
    if (bucket) bucket.push(p);
    else playsByGame.set(p.gameId, [p]);
  }

  for (const gameId of gameIds) {
    const plays = playsByGame.get(gameId);
    if (!plays || plays.length === 0) continue;

    const transitions = annotateSecondsSinceDefEvent(plays);

    for (const p of plays) {
      if (p.teamId !== teamId) continue;
      if (p.shotMade === null) continue;
      if (p.shotX === null || p.shotY === null) continue;
      if (p.shotRange === 'free_throw') continue;

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
        gameHomeTeamId: p.game.homeTeamId,
        secondsSinceDefEvent: transitions.get(p.id) ?? null,
      });

      out.push({
        x: p.shotX,
        y: p.shotY,
        made: p.shotMade,
        range: p.shotRange,
        expectedFg: pMake,
      });
    }
  }

  return out;
}
