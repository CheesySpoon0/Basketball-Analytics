import { prisma } from '../lib/prisma';

async function validateSeasonRoster(teamId: number, season: number) {
  console.log(`\n🏀 Validating season-specific roster for team ${teamId}, season ${season}...\n`);

  // Get team info
  const team = await prisma.team.findUnique({
    where: { id: teamId }
  });

  if (!team) {
    console.log(`❌ Team ${teamId} not found`);
    return;
  }

  console.log(`Team: ${team.school} (ID: ${teamId})\n`);

  // OLD WAY: Player.teamId (current assignment, wrong for season-specific)
  const oldWayRoster = await prisma.player.findMany({
    where: { teamId },
    include: {
      seasonStats: { where: { season } },
      team: true
    },
  });

  // NEW WAY: PlayerSeasonStats (season-specific, correct)
  const newWayRoster = await prisma.playerSeasonStats.findMany({
    where: { teamId, season },
    include: { player: true },
  });

  console.log(`📊 Roster Comparison:`);
  console.log(`• OLD WAY (Player.teamId): ${oldWayRoster.length} players`);
  console.log(`• NEW WAY (PlayerSeasonStats): ${newWayRoster.length} players\n`);

  // Check for players who appear in OLD but not NEW (wrong season)
  const oldPlayerIds = new Set(oldWayRoster.map(p => p.id));
  const newPlayerIds = new Set(newWayRoster.map(pss => pss.playerId));

  const wrongSeasonPlayers = oldWayRoster.filter(p => !newPlayerIds.has(p.id));
  const missingFromOld = newWayRoster.filter(pss => !oldPlayerIds.has(pss.playerId));

  if (wrongSeasonPlayers.length > 0) {
    console.log(`❌ Players incorrectly showing for season ${season}:`);
    wrongSeasonPlayers.forEach(p => {
      const seasonStats = p.seasonStats[0];
      console.log(`   • ${p.name} - has ${seasonStats ? 'season stats' : 'NO season stats'} for ${season}`);
    });
    console.log('');
  } else {
    console.log(`✅ No players incorrectly showing for season ${season}\n`);
  }

  if (missingFromOld.length > 0) {
    console.log(`📋 Players correctly included by NEW WAY but missed by OLD WAY:`);
    missingFromOld.forEach(pss => {
      console.log(`   • ${pss.player.name} - has season stats for ${season}`);
    });
    console.log('');
  }

  // Show both rosters for comparison
  console.log(`OLD WAY roster (first 10):`);
  oldWayRoster.slice(0, 10).forEach((p, i) => {
    const seasonStats = p.seasonStats[0];
    const hasSeasonStats = seasonStats ? '✅' : '❌';
    const games = seasonStats?.games || 0;
    console.log(`${i + 1}. ${hasSeasonStats} ${p.name} (${games} games)`);
  });

  console.log(`\nNEW WAY roster (first 10):`);
  newWayRoster.slice(0, 10).forEach((pss, i) => {
    console.log(`${i + 1}. ✅ ${pss.player.name} (${pss.games} games)`);
  });

  return {
    oldCount: oldWayRoster.length,
    newCount: newWayRoster.length,
    wrongSeasonCount: wrongSeasonPlayers.length,
    wrongSeasonPlayers: wrongSeasonPlayers.map(p => p.name)
  };
}

async function main() {
  // Test Michigan State as mentioned in the user's bug report
  console.log('🔍 Testing the reported Michigan State roster bug...');

  const msuResults2025 = await validateSeasonRoster(169, 2025); // Michigan State 2024-25
  const msuResults2026 = await validateSeasonRoster(169, 2026); // Michigan State 2025-26

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Michigan State 2024-25:`);
  console.log(`  • OLD WAY: ${msuResults2025.oldCount} players`);
  console.log(`  • NEW WAY: ${msuResults2026.newCount} players`);
  console.log(`  • Wrong season players: ${msuResults2025.wrongSeasonCount}`);
  if (msuResults2025.wrongSeasonPlayers.length > 0) {
    console.log(`  • Names: ${msuResults2025.wrongSeasonPlayers.join(', ')}`);
  }

  console.log(`\nMichigan State 2025-26:`);
  console.log(`  • OLD WAY: ${msuResults2026.oldCount} players`);
  console.log(`  • NEW WAY: ${msuResults2026.newCount} players`);
  console.log(`  • Wrong season players: ${msuResults2026.wrongSeasonCount}`);
  if (msuResults2026.wrongSeasonPlayers.length > 0) {
    console.log(`  • Names: ${msuResults2026.wrongSeasonPlayers.join(', ')}`);
  }

  // Check if Trey Fort and Cam Ward specifically appear in wrong seasons
  const allOldRoster2025 = await prisma.player.findMany({
    where: { teamId: 169 },
    include: { seasonStats: { where: { season: 2025 } } },
  });

  const treyFort = allOldRoster2025.find(p => p.name?.toLowerCase().includes('trey fort'));
  const camWard = allOldRoster2025.find(p => p.name?.toLowerCase().includes('cam ward'));

  console.log(`\n🔍 Specific Bug Check:`);
  console.log(`  • Trey Fort in Michigan State 2024-25: ${treyFort ? '❌ FOUND (BUG)' : '✅ NOT FOUND (FIXED)'}`);
  console.log(`  • Cam Ward in Michigan State 2024-25: ${camWard ? '❌ FOUND (BUG)' : '✅ NOT FOUND (FIXED)'}`);

  await prisma.$disconnect();
}

main().catch(console.error);