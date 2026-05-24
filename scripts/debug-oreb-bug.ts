import 'dotenv/config';
import { prisma } from '../lib/prisma';

const SEASON = 2025;
const UCI_TEAM_ID = 308;

async function debugOrebBug() {
  console.log('🔍 Debugging UCI OREB% Bug\n');

  // 1. Get UCI's TeamSeasonStats numbers
  const uciStats = await prisma.teamSeasonStats.findUnique({
    where: { teamId_season: { teamId: UCI_TEAM_ID, season: SEASON } },
    include: { team: true }
  });

  if (!uciStats) {
    console.log('❌ UCI stats not found');
    return;
  }

  const uciOreb = uciStats.offensiveRebounds ?? 0;
  const oppDreb = uciStats.oppDefensiveRebounds ?? 0;
  const computedOrebPct = (uciOreb + oppDreb) > 0 ? uciOreb / (uciOreb + oppDreb) : 0;

  console.log('📊 UCI TeamSeasonStats Numbers:');
  console.log('='.repeat(40));
  console.log(`UCI OREB: ${uciOreb}`);
  console.log(`Opponent DREB: ${oppDreb}`);
  console.log(`Computed OREB%: ${(computedOrebPct * 100).toFixed(1)}%`);
  console.log(`(Formula: ${uciOreb} / (${uciOreb} + ${oppDreb}) = ${computedOrebPct.toFixed(3)})`);

  // 2. Count from raw plays - UCI's games
  const uciGames = await prisma.game.findMany({
    where: {
      season: SEASON,
      OR: [
        { homeTeamId: UCI_TEAM_ID },
        { awayTeamId: UCI_TEAM_ID }
      ]
    },
    select: { id: true }
  });

  const gameIds = uciGames.map(g => g.id);

  // Count UCI offensive rebounds (UCI player gets OREB)
  const uciOrebPlays = await prisma.play.findMany({
    where: {
      gameId: { in: gameIds },
      playType: 'Offensive Rebound',
      player: { teamId: UCI_TEAM_ID }
    }
  });

  // Count opponent defensive rebounds (non-UCI player gets DREB)
  const oppDrebPlays = await prisma.play.findMany({
    where: {
      gameId: { in: gameIds },
      playType: 'Defensive Rebound',
      player: { teamId: { not: UCI_TEAM_ID } }
    }
  });

  const playCountOreb = uciOrebPlays.length;
  const playCountOppDreb = oppDrebPlays.length;
  const playComputedOrebPct = (playCountOreb + playCountOppDreb) > 0 ? playCountOreb / (playCountOreb + playCountOppDreb) : 0;

  console.log('\n📝 From Raw Plays Count:');
  console.log('='.repeat(40));
  console.log(`UCI OREB plays: ${playCountOreb}`);
  console.log(`Opponent DREB plays: ${playCountOppDreb}`);
  console.log(`Play-computed OREB%: ${(playComputedOrebPct * 100).toFixed(1)}%`);

  console.log('\n🔍 Comparison:');
  console.log('='.repeat(40));
  console.log(`TeamSeasonStats OREB%: ${(computedOrebPct * 100).toFixed(1)}%`);
  console.log(`Play-count OREB%: ${(playComputedOrebPct * 100).toFixed(1)}%`);
  if (Math.abs(computedOrebPct - playComputedOrebPct) > 0.02) {
    console.log('❌ MISMATCH DETECTED - Bug in derivation script');
  } else {
    console.log('✅ Numbers match - Bug may be elsewhere');
  }

  // 3. Examine one specific game's rebounds
  if (gameIds.length > 0) {
    const sampleGameId = gameIds[0];

    const sampleGame = await prisma.game.findUnique({
      where: { id: sampleGameId },
      include: { homeTeam: true, awayTeam: true }
    });

    console.log(`\n🏀 Sample Game Analysis (ID: ${sampleGameId})`);
    if (sampleGame) {
      console.log(`${sampleGame.homeTeam?.school} vs ${sampleGame.awayTeam?.school}`);
    }
    console.log('='.repeat(50));

    const reboundPlays = await prisma.play.findMany({
      where: {
        gameId: sampleGameId,
        playType: { in: ['Offensive Rebound', 'Defensive Rebound'] }
      },
      include: {
        player: { include: { team: true } }
      },
      orderBy: { id: 'asc' },
      take: 10 // First 10 rebound plays
    });

    console.log('First 10 rebound plays:');
    for (const play of reboundPlays) {
      const playerTeam = play.player?.team?.school || 'Unknown Team';
      const playType = play.playType;
      const teamId = play.player?.teamId;

      console.log(`  ${playType} | Player team: ${playerTeam} (ID: ${teamId}) | Player: ${play.player?.name || 'Unknown'}`);
    }
  }

  await prisma.$disconnect();
}

debugOrebBug().catch(console.error);