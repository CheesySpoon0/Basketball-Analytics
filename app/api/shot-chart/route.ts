import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const playerIdStr = searchParams.get('playerId');
  const seasonStr = searchParams.get('season');

  if (!playerIdStr || !seasonStr) {
    return NextResponse.json({ error: 'playerId and season required' }, { status: 400 });
  }
  const playerId = parseInt(playerIdStr, 10);
  const season = parseInt(seasonStr, 10);
  if (Number.isNaN(playerId) || Number.isNaN(season)) {
    return NextResponse.json({ error: 'playerId and season must be integers' }, { status: 400 });
  }

  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: { team: true },
  });
  if (!player) {
    return NextResponse.json({ error: 'player not found' }, { status: 404 });
  }

  const plays = await prisma.play.findMany({
    where: {
      playerId,
      shotX: { not: null },
      shotY: { not: null },
      game: { season },
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

  const shots = plays.map((p) => ({
    id: p.id,
    x: p.shotX!,
    y: p.shotY!,
    made: p.shotMade ?? false,
    range: p.shotRange,
    scoreValue: p.scoreValue,
    gameId: p.gameId,
    gameDate: p.game.startDate,
  }));

  return NextResponse.json({
    player: {
      id: player.id,
      name: player.name,
      jersey: player.jersey,
      position: player.position,
      team: player.team
        ? { id: player.team.id, school: player.team.school, displayName: player.team.displayName }
        : null,
    },
    season,
    shots,
  });
}
