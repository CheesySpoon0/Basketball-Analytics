import 'dotenv/config';
import { prisma } from '../lib/prisma';

const SEASON = 2025;
const UCI_TEAM_ID = 308;

async function debugOrebDetailed() {
  console.log('🔍 Detailed OREB% Debug for UCI\n');

  // Get UCI's first game for detailed analysis
  const uciGame = await prisma.game.findFirst({
    where: {
      season: SEASON,
      OR: [
        { homeTeamId: UCI_TEAM_ID },
        { awayTeamId: UCI_TEAM_ID }
      ]
    },
    include: {
      homeTeam: true,
      awayTeam: true
    }
  });

  if (!uciGame) {
    console.log('❌ No UCI game found');
    return;
  }

  const opponentTeamId = uciGame.homeTeamId === UCI_TEAM_ID ? uciGame.awayTeamId : uciGame.homeTeamId;
  const opponentTeam = uciGame.homeTeamId === UCI_TEAM_ID ? uciGame.awayTeam : uciGame.homeTeam;

  console.log(`🏀 Analyzing Game: ${uciGame.homeTeam?.school} vs ${uciGame.awayTeam?.school}`);
  console.log(`UCI vs ${opponentTeam?.school} (ID: ${opponentTeamId})`);
  console.log('='.repeat(60));

  // Get ALL rebound plays in this game
  const allRebounds = await prisma.play.findMany({
    where: {
      gameId: uciGame.id,
      playType: { in: ['Offensive Rebound', 'Defensive Rebound'] }
    },
    include: {
      player: {
        include: { team: true }
      }
    },
    orderBy: { id: 'asc' }
  });

  let uciOreb = 0;
  let uciDreb = 0;
  let oppOreb = 0;
  let oppDreb = 0;
  let unknownRebounds = 0;

  console.log('All rebounds in this game:');
  allRebounds.forEach((play, i) => {
    const playType = play.playType;
    const playerTeamId = play.player?.teamId;
    const playerTeam = play.player?.team?.school || 'Unknown';
    const playerName = play.player?.name || 'Unknown';

    console.log(`  ${i+1}. ${playType} | ${playerName} (${playerTeam})`);

    if (!playerTeamId) {
      unknownRebounds++;
    } else if (playerTeamId === UCI_TEAM_ID) {
      if (playType === 'Offensive Rebound') uciOreb++;
      if (playType === 'Defensive Rebound') uciDreb++;
    } else if (playerTeamId === opponentTeamId) {
      if (playType === 'Offensive Rebound') oppOreb++;
      if (playType === 'Defensive Rebound') oppDreb++;
    } else {
      console.log(`    ⚠️  Player from unexpected team: ${playerTeam} (ID: ${playerTeamId})`);
    }
  });

  console.log('\n📊 Rebound Totals for this game:');
  console.log('='.repeat(40));
  console.log(`UCI OREB: ${uciOreb}`);
  console.log(`UCI DREB: ${uciDreb}`);
  console.log(`${opponentTeam?.school} OREB: ${oppOreb}`);
  console.log(`${opponentTeam?.school} DREB: ${oppDreb}`);
  console.log(`Unknown rebounds: ${unknownRebounds}`);

  const totalOffensiveRebounds = uciOreb + oppOreb;
  const gameOrebPct = totalOffensiveRebounds > 0 ? uciOreb / totalOffensiveRebounds : 0;

  // The correct OREB% formula: UCI_OREB / (UCI_OREB + OPP_DREB)
  const correctOrebPct = (uciOreb + oppDreb) > 0 ? uciOreb / (uciOreb + oppDreb) : 0;

  console.log('\n🧮 OREB% Calculations:');
  console.log('='.repeat(40));
  console.log(`Percentage of offensive rebounds: ${uciOreb} / ${totalOffensiveRebounds} = ${(gameOrebPct * 100).toFixed(1)}%`);
  console.log(`Correct OREB% formula: ${uciOreb} / (${uciOreb} + ${oppDreb}) = ${(correctOrebPct * 100).toFixed(1)}%`);

  await prisma.$disconnect();
}

debugOrebDetailed().catch(console.error);