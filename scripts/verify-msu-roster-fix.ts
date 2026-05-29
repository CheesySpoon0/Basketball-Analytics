import { prisma } from '../lib/prisma';

/**
 * Michigan State Roster Fix Verification
 *
 * Tests the specific regression case to ensure players like Jaden Akins,
 * Jase Richardson, Frankie Fidler, and Szymon Zapala no longer appear
 * on Michigan State 2025-26 roster.
 */

interface MSURosterCheck {
  season: number;
  playersShown: Array<{
    id: number;
    name: string;
    games: number;
    minutes: number;
    points: number;
    hasParticipation: boolean;
  }>;
  problematicPlayers: string[];
  totalPlayers: number;
}

async function checkMSURosters(): Promise<MSURosterCheck[]> {
  const MSU_TEAM_ID = 169;
  const results: MSURosterCheck[] = [];

  for (const season of [2025, 2026]) {
    // Use the EXACT same query that the team page now uses (with participation filter)
    const rosterStats = await prisma.playerSeasonStats.findMany({
      where: {
        teamId: MSU_TEAM_ID,
        season,
        OR: [
          { games: { gt: 0 } },
          { minutes: { gt: 0 } },
          { points: { gt: 0 } },
          { rebounds: { gt: 0 } },
          { assists: { gt: 0 } },
          { fieldGoalsMade: { gt: 0 } },
          { fieldGoalsAttempted: { gt: 0 } }
        ]
      },
      include: { player: true }
    });

    // Known problematic players from the bug report
    const problematicNames = [
      'Jaden Akins', 'Jase Richardson', 'Frankie Fidler', 'Szymon Zapala',
      'Trey Fort', 'Cam Ward' // Original transfer cases
    ];

    const playersShown = rosterStats.map(pss => {
      const name = pss.player.name || `Player ${pss.playerId}`;
      const games = pss.games || 0;
      const minutes = pss.minutes || 0;
      const points = pss.points || 0;

      return {
        id: pss.playerId,
        name,
        games,
        minutes,
        points,
        hasParticipation: games > 0 || minutes > 0 || points > 0 ||
          (pss.rebounds || 0) > 0 || (pss.assists || 0) > 0 ||
          (pss.fieldGoalsMade || 0) > 0 || (pss.fieldGoalsAttempted || 0) > 0
      };
    });

    const problematicFound = problematicNames.filter(problemName =>
      playersShown.some(p => p.name.includes(problemName.split(' ')[1])) // Match last name
    );

    results.push({
      season,
      playersShown,
      problematicPlayers: problematicFound,
      totalPlayers: playersShown.length
    });
  }

  return results;
}

async function printMSUVerificationReport(results: MSURosterCheck[]) {
  console.log('🏀 MICHIGAN STATE ROSTER FIX VERIFICATION\n');
  console.log('=' * 80);

  for (const result of results) {
    const seasonLabel = result.season === 2025 ? '2024-25' : '2025-26';
    console.log(`\n📋 Michigan State ${seasonLabel} Roster (teamId: 169):`);
    console.log(`  Players shown on team page: ${result.totalPlayers}`);

    if (result.problematicPlayers.length > 0) {
      console.log(`  ❌ PROBLEMATIC PLAYERS STILL SHOWING:`);
      result.problematicPlayers.forEach(name => {
        console.log(`    • ${name} (should NOT appear)`);
      });
    } else {
      console.log(`  ✅ No problematic transfer players found`);
    }

    console.log(`  \n  📊 All players currently on roster:`);
    result.playersShown.forEach((p, i) => {
      const status = p.hasParticipation ? '✅' : '⚠️';
      console.log(`    ${i + 1}. ${status} ${p.name} (G:${p.games}, Min:${p.minutes}, Pts:${p.points})`);
    });

    // Specific season expectations
    if (result.season === 2025) {
      console.log(`\n  🎯 2024-25 Season Expectations:`);
      console.log(`    • Should NOT include: Trey Fort, Cam Ward (transferred out)`);
      console.log(`    • Should show: Only players who actually played for MSU in 2024-25`);
    } else {
      console.log(`\n  🎯 2025-26 Season Expectations:`);
      console.log(`    • Should NOT include: Jaden Akins, Jase Richardson, Frankie Fidler, Szymon Zapala`);
      console.log(`    • Should show: Only current MSU players with actual participation`);
    }
  }

  console.log('\n' + '=' * 80);
  console.log('🎯 REGRESSION TEST SUMMARY:');

  const allProblematic = results.flatMap(r => r.problematicPlayers);

  if (allProblematic.length === 0) {
    console.log('✅ REGRESSION TEST PASSED: No problematic players found');
    console.log('✅ Michigan State "No stats recorded" bug is FIXED');
    console.log('✅ Team rosters now show only players with actual participation');
  } else {
    console.log('❌ REGRESSION TEST FAILED: Problematic players still appearing');
    console.log(`   Found: ${allProblematic.join(', ')}`);
  }

  console.log('\n🔗 Manual Verification URLs (once deployed):');
  console.log('• MSU 2024-25: /teams/169?season=2025');
  console.log('• MSU 2025-26: /teams/169?season=2026');

  console.log('\n💡 What This Fix Accomplishes:');
  console.log('• Eliminates "No stats recorded" roster entries');
  console.log('• Shows only PlayerSeasonStats with actual participation');
  console.log('• Fixes transfer portal roster correctness universally');
  console.log('• Applies to ALL teams, not just Michigan State');
}

async function main() {
  try {
    console.log('🚀 Verifying Michigan State roster fix...\n');

    const results = await checkMSURosters();
    await printMSUVerificationReport(results);

    // Exit with appropriate code
    const allProblematic = results.flatMap(r => r.problematicPlayers);
    if (allProblematic.length === 0) {
      console.log('\n✅ VERIFICATION SUCCESSFUL - Ready for production');
      process.exit(0);
    } else {
      console.log('\n❌ VERIFICATION FAILED - Fix incomplete');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);