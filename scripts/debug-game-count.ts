import 'dotenv/config';
import { prisma } from '../lib/prisma';

const SEASON = 2025;
const UCI_TEAM_ID = 308;

async function debugGameCount() {
  console.log('🔍 Debugging UCI game count discrepancy\n');

  // Games used in derivation script (with both homeTeamId and awayTeamId not null)
  const derivationGames = await prisma.game.findMany({
    where: {
      season: SEASON,
      OR: [
        { homeTeamId: UCI_TEAM_ID },
        { awayTeamId: UCI_TEAM_ID }
      ],
      // Ensure both teams are valid (skip exhibitions against non-D1)
      homeTeamId: { not: null },
      awayTeamId: { not: null }
    },
    select: {
      id: true,
      homeTeam: { select: { school: true } },
      awayTeam: { select: { school: true } }
    }
  });

  // All games with UCI (including exhibitions)
  const allUciGames = await prisma.game.findMany({
    where: {
      season: SEASON,
      OR: [
        { homeTeamId: UCI_TEAM_ID },
        { awayTeamId: UCI_TEAM_ID }
      ]
    },
    select: {
      id: true,
      homeTeamId: true,
      awayTeamId: true,
      homeTeam: { select: { school: true } },
      awayTeam: { select: { school: true } }
    }
  });

  console.log(`📊 Game Counts:`);
  console.log('='.repeat(40));
  console.log(`Derivation script games: ${derivationGames.length}`);
  console.log(`All UCI games: ${allUciGames.length}`);
  console.log(`Games excluded: ${allUciGames.length - derivationGames.length}`);

  if (allUciGames.length > derivationGames.length) {
    console.log('\n🚨 Excluded games:');
    const derivationGameIds = new Set(derivationGames.map(g => g.id));
    const excludedGames = allUciGames.filter(g => !derivationGameIds.has(g.id));

    excludedGames.forEach(game => {
      console.log(`  Game ${game.id}: ${game.homeTeam?.school || 'NULL'} vs ${game.awayTeam?.school || 'NULL'}`);
      console.log(`    homeTeamId: ${game.homeTeamId}, awayTeamId: ${game.awayTeamId}`);
    });
  }

  // Count rebounds in derivation games vs all games
  const derivationGameIds = derivationGames.map(g => g.id);
  const allGameIds = allUciGames.map(g => g.id);

  const derivationOpponentDreb = await prisma.play.count({
    where: {
      gameId: { in: derivationGameIds },
      playType: 'Defensive Rebound',
      player: { teamId: { not: UCI_TEAM_ID } }
    }
  });

  const allGamesOpponentDreb = await prisma.play.count({
    where: {
      gameId: { in: allGameIds },
      playType: 'Defensive Rebound',
      player: { teamId: { not: UCI_TEAM_ID } }
    }
  });

  console.log('\n📊 Opponent DREB counts:');
  console.log('='.repeat(40));
  console.log(`Derivation games: ${derivationOpponentDreb}`);
  console.log(`All games: ${allGamesOpponentDreb}`);
  console.log(`Missing: ${allGamesOpponentDreb - derivationOpponentDreb}`);

  await prisma.$disconnect();
}

debugGameCount().catch(console.error);