#!/usr/bin/env npx tsx
import { buildPlayerScoutingReport } from '../lib/player-scouting';
import { prisma } from '../lib/prisma.js';

interface ValidationResult {
  playerId: number;
  playerName: string;
  teamName: string;
  season: number;
  hasObservedDefense: boolean;
  confidence: string | null;
  defensivePossessions: number;
  hasDrapm: boolean;
  hasOnCourtMetrics: boolean;
  drapmValue: number | null;
  onCourtDRtg: number | null;
  seasonSpecificTeamId: number | null;
  errors: string[];
  warnings: string[];
}

async function validateDefensiveImplementation() {
  console.log('=== PHASE 4: DEFENSIVE IMPLEMENTATION VALIDATION ===\n');

  const validationResults: ValidationResult[] = [];

  // 1. Test Michigan State 2025-26
  console.log('1. Testing Michigan State 2025-26...');
  await validateTeamDefense('Michigan State', 2026, validationResults);

  // 2. Test UC Irvine 2025-26
  console.log('\n2. Testing UC Irvine 2025-26...');
  await validateTeamDefense('UC Irvine', 2026, validationResults);

  // 3. Test UC San Diego 2025-26
  console.log('\n3. Testing UC San Diego 2025-26...');
  await validateTeamDefense('UC San Diego', 2026, validationResults);

  // 4. Test Auburn 2025-26
  console.log('\n4. Testing Auburn 2025-26...');
  await validateTeamDefense('Auburn', 2026, validationResults);

  // 5. Test some 2024-25 teams to ensure no season leakage
  console.log('\n5. Testing Michigan State 2024-25 (check season isolation)...');
  await validateTeamDefense('Michigan State', 2025, validationResults);

  // 6. Test low-minute players
  console.log('\n6. Testing low-minute players...');
  await validateLowMinutePlayers(validationResults);

  // 7. Test players with no PlayerImpact row
  console.log('\n7. Testing players with no PlayerImpact data...');
  await validateNoImpactPlayers(validationResults);

  // Generate validation report
  generateValidationReport(validationResults);
}

async function validateTeamDefense(schoolName: string, season: number, results: ValidationResult[]) {
  const team = await prisma.team.findFirst({
    where: { school: schoolName }
  });

  if (!team) {
    console.log(`  ❌ Team ${schoolName} not found`);
    return;
  }

  const players = await prisma.playerSeasonStats.findMany({
    where: {
      season,
      teamId: team.id,
      minutes: { gt: 100 } // Focus on players with some playing time
    },
    include: {
      player: true,
      team: true
    },
    take: 5 // Test first 5 players
  });

  console.log(`  Found ${players.length} players for ${schoolName} ${season}`);

  for (const playerStats of players) {
    await validatePlayerDefense(playerStats, results);
  }
}

async function validateLowMinutePlayers(results: ValidationResult[]) {
  const lowMinutePlayers = await prisma.playerSeasonStats.findMany({
    where: {
      season: 2026,
      minutes: { lt: 200, gt: 50 } // Very low but not zero minutes
    },
    include: {
      player: true,
      team: true
    },
    take: 3
  });

  console.log(`  Found ${lowMinutePlayers.length} low-minute players`);

  for (const playerStats of lowMinutePlayers) {
    await validatePlayerDefense(playerStats, results);
  }
}

async function validateNoImpactPlayers(results: ValidationResult[]) {
  // Find players who have season stats but no impact data
  const playersWithoutImpact = await prisma.playerSeasonStats.findMany({
    where: {
      season: 2026,
      minutes: { gt: 100 },
      player: {
        impact: {
          none: {
            season: 2026
          }
        }
      }
    },
    include: {
      player: true,
      team: true
    },
    take: 3
  });

  console.log(`  Found ${playersWithoutImpact.length} players without impact data`);

  for (const playerStats of playersWithoutImpact) {
    await validatePlayerDefense(playerStats, results);
  }
}

async function validatePlayerDefense(
  playerStats: any,
  results: ValidationResult[]
): Promise<void> {
  const { player, team, season, playerId, teamId } = playerStats;
  const result: ValidationResult = {
    playerId,
    playerName: player.name || `${player.firstName} ${player.lastName}`,
    teamName: team?.school || 'Unknown Team',
    season,
    hasObservedDefense: false,
    confidence: null,
    defensivePossessions: 0,
    hasDrapm: false,
    hasOnCourtMetrics: false,
    drapmValue: null,
    onCourtDRtg: null,
    seasonSpecificTeamId: teamId,
    errors: [],
    warnings: []
  };

  try {
    console.log(`    Testing: ${result.playerName} (${result.teamName})`);

    // Build scouting report
    const report = await buildPlayerScoutingReport(playerId, season);

    if (!report) {
      result.errors.push('Failed to build scouting report');
      results.push(result);
      return;
    }

    const defense = report.observedDefenseProfile;

    if (!defense) {
      result.errors.push('No observedDefenseProfile generated');
      results.push(result);
      return;
    }

    // Validate defensive profile
    result.hasObservedDefense = true;
    result.confidence = defense.confidence;
    result.defensivePossessions = defense.defensivePossessions;
    result.hasDrapm = defense.drapm !== null;
    result.hasOnCourtMetrics = defense.showOnCourtMetrics;
    result.drapmValue = defense.drapm;
    result.onCourtDRtg = defense.onCourtDRtg;

    // Validate season-specific data integrity
    await validateDataIntegrity(playerStats, defense, result);

    // Check confidence logic
    validateConfidenceLogic(defense, result);

    console.log(`      ✅ Confidence: ${defense.confidence}, Poss: ${defense.defensivePossessions}, DRAPM: ${defense.drapm?.toFixed(2) || 'N/A'}`);

  } catch (error) {
    result.errors.push(`Exception: ${error instanceof Error ? error.message : String(error)}`);
    console.log(`      ❌ Error: ${result.errors[result.errors.length - 1]}`);
  }

  results.push(result);
}

async function validateDataIntegrity(playerStats: any, defense: any, result: ValidationResult) {
  const { playerId, season, teamId } = playerStats;

  // 1. Verify PlayerSeasonStats is season-specific
  const seasonStatsCheck = await prisma.playerSeasonStats.findUnique({
    where: { playerId_season: { playerId, season } }
  });

  if (!seasonStatsCheck || seasonStatsCheck.teamId !== teamId) {
    result.errors.push('PlayerSeasonStats teamId mismatch or season leakage');
  }

  // 2. Verify PlayerImpact is season-specific
  if (defense.hasDrapm) {
    const impactCheck = await prisma.playerImpact.findUnique({
      where: { playerId_season: { playerId, season } }
    });

    if (!impactCheck) {
      result.errors.push('DRAPM reported but no PlayerImpact row found');
    }
  }

  // 3. Verify LineupStint data is team/season specific
  if (defense.showOnCourtMetrics) {
    const stintCheck = await prisma.lineupStint.findFirst({
      where: {
        season,
        teamId,
        confidence: 'full',
        playerIds: { contains: playerId.toString() },
        possessionsAgainst: { gt: 0 }
      }
    });

    if (!stintCheck) {
      result.warnings.push('On-court metrics shown but no valid LineupStint found');
    }
  }
}

function validateConfidenceLogic(defense: any, result: ValidationResult) {
  const { confidence, defensivePossessions } = defense;

  // Check confidence thresholds match implementation
  if (defensivePossessions >= 500 && confidence !== 'high') {
    result.warnings.push(`Expected high confidence with ${defensivePossessions} possessions, got ${confidence}`);
  } else if (defensivePossessions >= 200 && defensivePossessions < 500 && confidence !== 'medium') {
    result.warnings.push(`Expected medium confidence with ${defensivePossessions} possessions, got ${confidence}`);
  } else if (defensivePossessions >= 50 && defensivePossessions < 200 && confidence !== 'low') {
    result.warnings.push(`Expected low confidence with ${defensivePossessions} possessions, got ${confidence}`);
  } else if (defensivePossessions < 50 && confidence !== 'insufficient') {
    result.warnings.push(`Expected insufficient confidence with ${defensivePossessions} possessions, got ${confidence}`);
  }
}

function generateValidationReport(results: ValidationResult[]) {
  console.log('\n=== VALIDATION SUMMARY ===');

  const totalTested = results.length;
  const withDefense = results.filter(r => r.hasObservedDefense).length;
  const withErrors = results.filter(r => r.errors.length > 0).length;
  const withWarnings = results.filter(r => r.warnings.length > 0).length;
  const withDrapm = results.filter(r => r.hasDrapm).length;
  const withOnCourt = results.filter(r => r.hasOnCourtMetrics).length;

  console.log(`Total players tested: ${totalTested}`);
  console.log(`With observed defense: ${withDefense} (${(withDefense/totalTested*100).toFixed(1)}%)`);
  console.log(`With DRAPM: ${withDrapm} (${(withDrapm/totalTested*100).toFixed(1)}%)`);
  console.log(`With on-court metrics: ${withOnCourt} (${(withOnCourt/totalTested*100).toFixed(1)}%)`);
  console.log(`With errors: ${withErrors} (${(withErrors/totalTested*100).toFixed(1)}%)`);
  console.log(`With warnings: ${withWarnings} (${(withWarnings/totalTested*100).toFixed(1)}%)`);

  // Confidence distribution
  const confidenceCounts = results.reduce((acc, r) => {
    const conf = r.confidence || 'null';
    acc[conf] = (acc[conf] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log('\nConfidence distribution:');
  Object.entries(confidenceCounts).forEach(([conf, count]) => {
    console.log(`  ${conf}: ${count} players`);
  });

  // Show errors and warnings
  if (withErrors > 0) {
    console.log('\n❌ ERRORS FOUND:');
    results.filter(r => r.errors.length > 0).forEach(r => {
      console.log(`  ${r.playerName} (${r.teamName} ${r.season}):`);
      r.errors.forEach(e => console.log(`    - ${e}`));
    });
  }

  if (withWarnings > 0) {
    console.log('\n⚠️  WARNINGS:');
    results.filter(r => r.warnings.length > 0).forEach(r => {
      console.log(`  ${r.playerName} (${r.teamName} ${r.season}):`);
      r.warnings.forEach(w => console.log(`    - ${w}`));
    });
  }

  // Export detailed results for report
  exportDetailedResults(results);
}

async function exportDetailedResults(results: ValidationResult[]) {
  const reportPath = '/Users/harrisonclarkson/basketball-scouting/DEFENSIVE-VALIDATION-RESULTS.json';
  await require('fs').promises.writeFile(reportPath, JSON.stringify(results, null, 2));
  console.log(`\nDetailed results exported to: ${reportPath}`);
}

validateDefensiveImplementation()
  .catch(console.error)
  .finally(() => prisma.$disconnect());