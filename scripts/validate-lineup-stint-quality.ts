import { prisma } from '../lib/prisma';

/**
 * Comprehensive LineupStint data quality validation
 *
 * Checks for data integrity issues at the database level:
 * - Invalid player counts (not exactly 5)
 * - Duplicate playerIds within lineups
 * - Negative or zero minutes
 * - Players without matching PlayerSeasonStats
 * - Malformed playerIds strings
 */

interface ValidationResults {
  totalStints: number;
  invalidPlayerCounts: number;
  duplicatePlayerIds: number;
  negativeMinutes: number;
  orphanedPlayers: number;
  malformedPlayerIds: number;
  validStints: number;
  worstTeams: Array<{
    teamId: number;
    teamName: string;
    issues: number;
    issueTypes: string[];
  }>;
}

async function calculateStintMinutes(stint: any): Promise<number> {
  // Basketball clock logic: startSeconds > endSeconds
  if (stint.startSeconds == null || stint.endSeconds == null) {
    return -1; // Invalid
  }

  const minutes = (stint.startSeconds - stint.endSeconds) / 60;
  return minutes;
}

async function validateLineupStintQuality(season: number = 2026): Promise<ValidationResults> {
  console.log(`🔍 Validating LineupStint data quality for season ${season}...\n`);

  // Get all lineup stints for the season
  const allStints = await prisma.lineupStint.findMany({
    where: { season },
    include: { team: true },
    orderBy: { teamId: 'asc' }
  });

  console.log(`Found ${allStints.length} total lineup stints for season ${season}\n`);

  let invalidPlayerCounts = 0;
  let duplicatePlayerIds = 0;
  let negativeMinutes = 0;
  let orphanedPlayers = 0;
  let malformedPlayerIds = 0;
  let validStints = 0;

  const teamIssues = new Map<number, { count: number; types: Set<string>; name: string }>();

  // Get all PlayerSeasonStats for validation
  const allPlayerSeasonStats = await prisma.playerSeasonStats.findMany({
    where: { season }
  });
  const playerSeasonMap = new Map<string, boolean>(); // key: "playerId-teamId"
  allPlayerSeasonStats.forEach(pss => {
    playerSeasonMap.set(`${pss.playerId}-${pss.teamId}`, true);
  });

  for (const stint of allStints) {
    const issues: string[] = [];

    // Initialize team tracking
    if (!teamIssues.has(stint.teamId)) {
      teamIssues.set(stint.teamId, {
        count: 0,
        types: new Set(),
        name: stint.team.school
      });
    }
    const teamData = teamIssues.get(stint.teamId)!;

    // Check 1: Malformed or null playerIds
    if (!stint.playerIds) {
      malformedPlayerIds++;
      issues.push('null_playerIds');
    } else {
      try {
        const playerIds = stint.playerIds.split(',').map(id => parseInt(id.trim(), 10));

        // Check 2: Invalid player count (not exactly 5)
        if (playerIds.length !== 5) {
          invalidPlayerCounts++;
          issues.push(`invalid_count_${playerIds.length}`);
        }

        // Check 3: Duplicate playerIds within lineup
        const uniqueIds = new Set(playerIds);
        if (uniqueIds.size !== playerIds.length) {
          duplicatePlayerIds++;
          issues.push('duplicate_players');
        }

        // Check 4: Players without PlayerSeasonStats for this team-season
        for (const playerId of playerIds) {
          if (!isNaN(playerId)) {
            const key = `${playerId}-${stint.teamId}`;
            if (!playerSeasonMap.has(key)) {
              orphanedPlayers++;
              issues.push('orphaned_player');
              break; // Only count once per stint
            }
          }
        }

        // Check for NaN playerIds
        if (playerIds.some(id => isNaN(id))) {
          malformedPlayerIds++;
          issues.push('nan_playerIds');
        }

      } catch (error) {
        malformedPlayerIds++;
        issues.push('parse_error');
      }
    }

    // Check 5: Negative or zero minutes
    const minutes = await calculateStintMinutes(stint);
    if (minutes <= 0) {
      negativeMinutes++;
      issues.push('invalid_minutes');
    }

    // Track team issues
    if (issues.length > 0) {
      teamData.count++;
      issues.forEach(issue => teamData.types.add(issue));
    } else {
      validStints++;
    }
  }

  // Sort teams by issue count to find worst offenders
  const worstTeams = Array.from(teamIssues.entries())
    .filter(([_, data]) => data.count > 0)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([teamId, data]) => ({
      teamId,
      teamName: data.name,
      issues: data.count,
      issueTypes: Array.from(data.types)
    }));

  const results: ValidationResults = {
    totalStints: allStints.length,
    invalidPlayerCounts,
    duplicatePlayerIds,
    negativeMinutes,
    orphanedPlayers,
    malformedPlayerIds,
    validStints,
    worstTeams
  };

  return results;
}

async function printValidationReport(results: ValidationResults) {
  console.log('📊 LINEUP STINT QUALITY VALIDATION RESULTS');
  console.log('='.repeat(50));

  console.log(`\n📈 Overall Statistics:`);
  console.log(`  • Total stints: ${results.totalStints.toLocaleString()}`);
  console.log(`  • Valid stints: ${results.validStints.toLocaleString()} (${((results.validStints / results.totalStints) * 100).toFixed(1)}%)`);
  console.log(`  • Invalid stints: ${(results.totalStints - results.validStints).toLocaleString()}`);

  console.log(`\n🚨 Issue Breakdown:`);
  console.log(`  • Invalid player counts (≠5): ${results.invalidPlayerCounts.toLocaleString()}`);
  console.log(`  • Duplicate players in lineup: ${results.duplicatePlayerIds.toLocaleString()}`);
  console.log(`  • Negative/zero minutes: ${results.negativeMinutes.toLocaleString()}`);
  console.log(`  • Orphaned players (no season stats): ${results.orphanedPlayers.toLocaleString()}`);
  console.log(`  • Malformed playerIds: ${results.malformedPlayerIds.toLocaleString()}`);

  if (results.worstTeams.length > 0) {
    console.log(`\n🏀 Teams with Most Issues:`);
    results.worstTeams.forEach((team, i) => {
      console.log(`  ${i + 1}. ${team.teamName} (ID: ${team.teamId})`);
      console.log(`     • ${team.issues} problematic stints`);
      console.log(`     • Issue types: ${team.issueTypes.join(', ')}`);
    });
  }

  console.log(`\n💡 Recommendations:`);
  if (results.invalidPlayerCounts > 0) {
    console.log(`  • Fix derive-lineup-stints.ts to only create 5-player lineups`);
  }
  if (results.negativeMinutes > 0) {
    console.log(`  • Add minutes validation to derivation pipeline`);
  }
  if (results.orphanedPlayers > 0) {
    console.log(`  • Cross-validate player roster membership during derivation`);
  }
  if (results.duplicatePlayerIds > 0) {
    console.log(`  • Add duplicate player detection to derivation logic`);
  }

  const qualityScore = (results.validStints / results.totalStints) * 100;
  if (qualityScore >= 95) {
    console.log(`\n✅ Data quality is excellent (${qualityScore.toFixed(1)}% valid)`);
  } else if (qualityScore >= 85) {
    console.log(`\n⚠️  Data quality needs improvement (${qualityScore.toFixed(1)}% valid)`);
  } else {
    console.log(`\n❌ Data quality is poor (${qualityScore.toFixed(1)}% valid) - derivation pipeline needs fixes`);
  }
}

async function analyzeSpecificTeams(teamIds: number[], season: number = 2026) {
  console.log(`\n🔍 Analyzing specific teams for season ${season}:\n`);

  for (const teamId of teamIds) {
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    const stints = await prisma.lineupStint.findMany({
      where: { teamId, season }
    });

    console.log(`${team?.school || `Team ${teamId}`} (ID: ${teamId}):`);
    console.log(`  • Total stints: ${stints.length}`);

    const issues = {
      invalidCounts: 0,
      negativeMinutes: 0,
      malformed: 0
    };

    for (const stint of stints) {
      if (!stint.playerIds) {
        issues.malformed++;
      } else {
        try {
          const playerIds = stint.playerIds.split(',').map(id => parseInt(id.trim(), 10));
          if (playerIds.length !== 5) {
            issues.invalidCounts++;
          }
        } catch {
          issues.malformed++;
        }
      }

      const minutes = await calculateStintMinutes(stint);
      if (minutes <= 0) {
        issues.negativeMinutes++;
      }
    }

    console.log(`  • Invalid counts: ${issues.invalidCounts}`);
    console.log(`  • Negative minutes: ${issues.negativeMinutes}`);
    console.log(`  • Malformed: ${issues.malformed}`);
    console.log(`  • Valid: ${stints.length - issues.invalidCounts - issues.negativeMinutes - issues.malformed}\n`);
  }
}

async function main() {
  const season = 2026;

  // Overall validation
  const results = await validateLineupStintQuality(season);
  await printValidationReport(results);

  // Analyze specific teams mentioned for testing
  const testTeams = [308, 169, 35]; // UCI, Michigan State, Duke
  await analyzeSpecificTeams(testTeams, season);

  console.log('\n' + '='.repeat(50));
  console.log('✅ VALIDATION COMPLETE');
  console.log('\nNext Steps:');
  console.log('1. If issues found, update scripts/derive-lineup-stints.ts');
  console.log('2. Re-run derivation with improved validation');
  console.log('3. Re-run this validation script to verify fixes');

  await prisma.$disconnect();
}

main().catch(console.error);