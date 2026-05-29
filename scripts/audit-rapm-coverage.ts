import { prisma } from '../lib/prisma';
import { Command } from 'commander';

/**
 * Phase 0B: RAPM coverage bias audit
 *
 * Analyzes the partial stint distribution to identify potential bias in RAPM
 * - Per-player partial exposure rates
 * - Distribution shape analysis
 * - Situational bias detection
 */

interface PlayerCoverage {
  playerId: number;
  playerName: string;
  teamName: string;
  totalPoss: number;
  usablePoss: number; // full + full_inferred
  partialFraction: number;
}

interface CoverageAudit {
  playerCoverage: PlayerCoverage[];
  distributionVerdict: string;
  situationalVerdict: string;
  lowConfidencePlayers: number[];
  summary: {
    totalPlayers: number;
    averagePartialFraction: number;
    playersAbove35Percent: number;
    playersWithMinimalPartial: number; // < 5%
  };
}

async function auditRapmCoverage(season: number): Promise<CoverageAudit> {
  console.log(`🔍 Phase 0B: RAPM coverage bias audit for season ${season}\n`);

  // Step 1: Calculate per-player partial exposure
  const playerCoverage = await calculatePlayerCoverage(season);

  // Step 2: Analyze distribution shape
  const distributionVerdict = analyzeDistributionShape(playerCoverage);

  // Step 3: Check situational bias
  const situationalVerdict = await analyzeSituationalBias(season);

  // Step 4: Identify low-confidence players
  const lowConfidencePlayers = playerCoverage
    .filter(p => p.partialFraction > 0.35)
    .map(p => p.playerId);

  // Step 5: Calculate summary statistics
  const summary = calculateSummaryStats(playerCoverage);

  return {
    playerCoverage,
    distributionVerdict,
    situationalVerdict,
    lowConfidencePlayers,
    summary
  };
}

async function calculatePlayerCoverage(season: number): Promise<PlayerCoverage[]> {
  console.log('📊 Calculating per-player stint exposure...\n');

  // Get all lineup stints with player involvement
  const stints = await prisma.lineupStint.findMany({
    where: {
      season,
      playerIds: { not: null },
      possessionsFor: { gt: 0 },
      possessionsAgainst: { gt: 0 }
    },
    select: {
      playerIds: true,
      possessionsFor: true,
      possessionsAgainst: true,
      confidence: true,
      team: { select: { school: true } }
    }
  });

  const playerStats = new Map<number, {
    teamName: string;
    totalPoss: number;
    usablePoss: number;
  }>();

  // Process each stint
  for (const stint of stints) {
    if (!stint.playerIds) continue;

    const playerIds = stint.playerIds.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id));
    const totalPoss = stint.possessionsFor + stint.possessionsAgainst;
    const isUsable = stint.confidence === 'full' || stint.confidence === 'full_inferred';

    for (const playerId of playerIds) {
      if (!playerStats.has(playerId)) {
        playerStats.set(playerId, {
          teamName: stint.team.school,
          totalPoss: 0,
          usablePoss: 0
        });
      }

      const stats = playerStats.get(playerId)!;
      stats.totalPoss += totalPoss;
      if (isUsable) {
        stats.usablePoss += totalPoss;
      }
    }
  }

  // Get player names
  const playerIds = Array.from(playerStats.keys());
  const players = await prisma.player.findMany({
    where: { id: { in: playerIds } },
    select: { id: true, name: true }
  });

  const playerNameMap = new Map(players.map(p => [p.id, p.name]));

  // Build coverage array
  const coverage: PlayerCoverage[] = [];
  for (const [playerId, stats] of playerStats) {
    if (stats.totalPoss >= 200) { // Only include players with meaningful sample
      coverage.push({
        playerId,
        playerName: playerNameMap.get(playerId) || `Player ${playerId}`,
        teamName: stats.teamName,
        totalPoss: stats.totalPoss,
        usablePoss: stats.usablePoss,
        partialFraction: (stats.totalPoss - stats.usablePoss) / stats.totalPoss
      });
    }
  }

  // Sort by partial fraction (highest exposure to partial stints first)
  return coverage.sort((a, b) => b.partialFraction - a.partialFraction);
}

function analyzeDistributionShape(playerCoverage: PlayerCoverage[]): string {
  const fractions = playerCoverage.map(p => p.partialFraction);

  // Calculate quartiles
  const sorted = [...fractions].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const median = sorted[Math.floor(sorted.length * 0.5)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];

  // Check for skewness
  const mean = fractions.reduce((sum, f) => sum + f, 0) / fractions.length;
  const skewness = (mean - median) / median;

  console.log('📈 Distribution Analysis:');
  console.log(`  • Q1: ${(q1 * 100).toFixed(1)}%`);
  console.log(`  • Median: ${(median * 100).toFixed(1)}%`);
  console.log(`  • Q3: ${(q3 * 100).toFixed(1)}%`);
  console.log(`  • Mean: ${(mean * 100).toFixed(1)}%`);

  // Create histogram
  const bins = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 1.0];
  const histogram = new Array(bins.length - 1).fill(0);

  fractions.forEach(f => {
    for (let i = 0; i < bins.length - 1; i++) {
      if (f >= bins[i] && f < bins[i + 1]) {
        histogram[i]++;
        break;
      }
    }
  });

  console.log('\n📊 Partial Fraction Histogram:');
  bins.slice(0, -1).forEach((bin, i) => {
    const range = `${(bin * 100).toFixed(0)}-${(bins[i + 1] * 100).toFixed(0)}%`;
    const bar = '█'.repeat(Math.ceil(histogram[i] / Math.max(...histogram) * 20));
    console.log(`  ${range.padEnd(8)}: ${histogram[i].toString().padStart(3)} ${bar}`);
  });

  // Verdict
  if (Math.abs(skewness) < 0.2 && q3 < 0.25) {
    return 'flat - random missingness, RAPM estimates are sound';
  } else if (q3 < 0.35 && fractions.filter(f => f > 0.5).length < 5) {
    return 'slightly skewed but acceptable - flag high-partial players';
  } else {
    return 'concerning skew - substantial bias risk in RAPM estimates';
  }
}

async function analyzeSituationalBias(season: number): Promise<string> {
  console.log('\n🎯 Situational Bias Analysis:');

  // Get partial stints with game context
  const partialStints = await prisma.lineupStint.findMany({
    where: {
      season,
      confidence: 'partial'
    },
    include: {
      game: {
        select: {
          homeScore: true,
          visitingScore: true
        }
      }
    }
  });

  // Get full stints for comparison
  const fullStints = await prisma.lineupStint.findMany({
    where: {
      season,
      confidence: { in: ['full', 'full_inferred'] }
    },
    include: {
      game: {
        select: {
          homeScore: true,
          visitingScore: true
        }
      }
    },
    take: Math.min(10000, partialStints.length * 2) // Sample for performance
  });

  // Analyze game situations
  const partialContext = analyzeGameContext(partialStints);
  const fullContext = analyzeGameContext(fullStints);

  console.log('  Partial stints context:');
  console.log(`    • Close games (<10pt): ${(partialContext.closeGame * 100).toFixed(1)}%`);
  console.log(`    • Blowouts (≥25pt): ${(partialContext.blowout * 100).toFixed(1)}%`);
  console.log(`    • 4th period: ${(partialContext.fourthPeriod * 100).toFixed(1)}%`);

  console.log('  Full stints context:');
  console.log(`    • Close games (<10pt): ${(fullContext.closeGame * 100).toFixed(1)}%`);
  console.log(`    • Blowouts (≥25pt): ${(fullContext.blowout * 100).toFixed(1)}%`);
  console.log(`    • 4th period: ${(fullContext.fourthPeriod * 100).toFixed(1)}%`);

  // Verdict based on differences
  const blowoutDiff = Math.abs(partialContext.blowout - fullContext.blowout);
  const closeDiff = Math.abs(partialContext.closeGame - fullContext.closeGame);

  if (blowoutDiff > 0.15) {
    return 'concerning - partial stints concentrated in blowouts (biases bench/starter estimates)';
  } else if (closeDiff > 0.15) {
    return 'concerning - partial stints concentrated in close games (biases clutch estimates)';
  } else {
    return 'benign - partial stints distributed similarly to full stints';
  }
}

function analyzeGameContext(stints: any[]): {
  closeGame: number;
  blowout: number;
  fourthPeriod: number;
} {
  let closeGame = 0;
  let blowout = 0;
  let fourthPeriod = 0;

  stints.forEach(stint => {
    if (stint.game) {
      const margin = Math.abs((stint.game.homeScore || 0) - (stint.game.visitingScore || 0));

      if (margin < 10) closeGame++;
      if (margin >= 25) blowout++;
    }

    // Approximate 4th period detection (endSeconds < 720 = last 12 minutes)
    if (stint.endSeconds < 720) fourthPeriod++;
  });

  const total = stints.length;
  return {
    closeGame: closeGame / total,
    blowout: blowout / total,
    fourthPeriod: fourthPeriod / total
  };
}

function calculateSummaryStats(playerCoverage: PlayerCoverage[]) {
  const totalPlayers = playerCoverage.length;
  const averagePartialFraction = playerCoverage.reduce((sum, p) => sum + p.partialFraction, 0) / totalPlayers;
  const playersAbove35Percent = playerCoverage.filter(p => p.partialFraction > 0.35).length;
  const playersWithMinimalPartial = playerCoverage.filter(p => p.partialFraction < 0.05).length;

  return {
    totalPlayers,
    averagePartialFraction,
    playersAbove35Percent,
    playersWithMinimalPartial
  };
}

function printAuditReport(audit: CoverageAudit) {
  console.log('\n' + '='.repeat(60));
  console.log('📋 RAPM COVERAGE BIAS AUDIT REPORT');
  console.log('='.repeat(60));

  console.log(`\n📊 Overall Statistics:`);
  console.log(`  • Total players (≥200 poss): ${audit.summary.totalPlayers.toLocaleString()}`);
  console.log(`  • Average partial fraction: ${(audit.summary.averagePartialFraction * 100).toFixed(1)}%`);
  console.log(`  • Players with >35% partial: ${audit.summary.playersAbove35Percent} (${((audit.summary.playersAbove35Percent / audit.summary.totalPlayers) * 100).toFixed(1)}%)`);
  console.log(`  • Players with <5% partial: ${audit.summary.playersWithMinimalPartial} (${((audit.summary.playersWithMinimalPartial / audit.summary.totalPlayers) * 100).toFixed(1)}%)`);

  console.log(`\n🔍 Distribution Verdict: ${audit.distributionVerdict}`);
  console.log(`🎯 Situational Verdict: ${audit.situationalVerdict}`);

  if (audit.playerCoverage.length > 0) {
    console.log(`\n⚠️  Top 30 Players by Partial Exposure:`);
    console.log('    Name'.padEnd(25) + 'Team'.padEnd(15) + 'Total'.padStart(8) + 'Usable'.padStart(8) + 'Partial%'.padStart(10));
    console.log('    ' + '-'.repeat(70));

    audit.playerCoverage.slice(0, 30).forEach(player => {
      console.log(
        '    ' +
        player.playerName.padEnd(25).slice(0, 25) +
        player.teamName.padEnd(15).slice(0, 15) +
        player.totalPoss.toString().padStart(8) +
        player.usablePoss.toString().padStart(8) +
        `${(player.partialFraction * 100).toFixed(1)}%`.padStart(10)
      );
    });
  }

  if (audit.lowConfidencePlayers.length > 0) {
    console.log(`\n🚨 Low Confidence Players (>35% partial):`);
    console.log(`    ${audit.lowConfidencePlayers.length} players flagged for RAPM output annotation`);
    console.log(`    Player IDs: ${audit.lowConfidencePlayers.slice(0, 20).join(', ')}${audit.lowConfidencePlayers.length > 20 ? '...' : ''}`);
  }

  console.log(`\n💡 Recommendations:`);
  if (audit.summary.playersAbove35Percent > 0) {
    console.log(`  • Tag ${audit.summary.playersAbove35Percent} high-partial players with 'low_confidence' in RAPM output`);
  }
  if (audit.distributionVerdict.includes('concerning')) {
    console.log(`  • Consider excluding players with >50% partial from RAPM analysis`);
  }
  if (audit.situationalVerdict.includes('concerning')) {
    console.log(`  • Weight RAPM estimates by situation-specific sample sizes`);
  }
  console.log(`  • Phase 1 can now proceed with full + full_inferred stints`);
}

async function main() {
  const program = new Command();

  program
    .option('--season <number>', 'Season to audit', '2026')
    .parse();

  const season = parseInt(program.opts().season);

  try {
    const audit = await auditRapmCoverage(season);
    printAuditReport(audit);

    console.log('\n📋 Next Steps:');
    console.log('1. If bias is acceptable, proceed to Phase 1');
    console.log('2. Extract stints: cd scripts/python/rapm && python extract_stints.py');
    console.log('3. Train RAPM: python train_rapm.py');

  } catch (error) {
    console.error('❌ Audit failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);