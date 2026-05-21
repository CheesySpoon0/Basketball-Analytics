import 'dotenv/config';
import { prisma } from '../lib/prisma';

const SEASON = 2025;
const UCI_TEAM_ID = 308;

async function verifyOrebCounts() {
  console.log('🔍 Verifying OREB/DREB counts for UCI\n');

  // Get all UCI games
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
  console.log(`Found ${gameIds.length} UCI games\n`);

  // Count UCI OREB (UCI players get offensive rebounds)
  const uciOrebCount = await prisma.play.count({
    where: {
      gameId: { in: gameIds },
      playType: 'Offensive Rebound',
      player: { teamId: UCI_TEAM_ID }
    }
  });

  // Count opponent DREB (non-UCI players get defensive rebounds, including nulls)
  const allDrebInUciGames = await prisma.play.findMany({
    where: {
      gameId: { in: gameIds },
      playType: 'Defensive Rebound'
    },
    select: {
      player: { select: { teamId: true } }
    }
  });

  const nonUciDreb = allDrebInUciGames.filter(play =>
    play.player?.teamId !== UCI_TEAM_ID
  ).length;

  // Also count UCI's own DREB for comparison
  const uciDrebCount = await prisma.play.count({
    where: {
      gameId: { in: gameIds },
      playType: 'Defensive Rebound',
      player: { teamId: UCI_TEAM_ID }
    }
  });

  const totalDreb = uciDrebCount + nonUciDreb;
  const computedOrebPct = (uciOrebCount + nonUciDreb) > 0 ? uciOrebCount / (uciOrebCount + nonUciDreb) : 0;

  console.log('📊 Raw Play Counts:');
  console.log('='.repeat(40));
  console.log(`UCI OREB: ${uciOrebCount}`);
  console.log(`UCI DREB: ${uciDrebCount}`);
  console.log(`Non-UCI DREB: ${nonUciDreb}`);
  console.log(`Total DREB in UCI games: ${totalDreb}`);
  console.log(`Computed UCI OREB%: ${(computedOrebPct * 100).toFixed(1)}%`);

  // Get UCI TeamSeasonStats for comparison
  const uciStats = await prisma.teamSeasonStats.findUnique({
    where: { teamId_season: { teamId: UCI_TEAM_ID, season: SEASON } }
  });

  if (uciStats) {
    console.log('\n📊 TeamSeasonStats:');
    console.log('='.repeat(40));
    console.log(`UCI OREB (TeamSeasonStats): ${uciStats.offensiveRebounds}`);
    console.log(`Opponent DREB (derived): ${uciStats.oppDefensiveRebounds}`);
    console.log(`TeamSeasonStats OREB%: ${uciStats.offensiveRebounds && uciStats.oppDefensiveRebounds ? ((uciStats.offensiveRebounds / (uciStats.offensiveRebounds + uciStats.oppDefensiveRebounds)) * 100).toFixed(1) : 'N/A'}%`);

    console.log('\n🔍 Comparison:');
    console.log('='.repeat(40));
    console.log(`OREB difference: ${uciStats.offensiveRebounds} (stats) vs ${uciOrebCount} (raw) = ${(uciStats.offensiveRebounds || 0) - uciOrebCount}`);
    console.log(`DREB difference: ${uciStats.oppDefensiveRebounds} (stats) vs ${nonUciDreb} (raw) = ${(uciStats.oppDefensiveRebounds || 0) - nonUciDreb}`);
  }

  await prisma.$disconnect();
}

verifyOrebCounts().catch(console.error);