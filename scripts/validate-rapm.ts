import { prisma } from '../lib/prisma';
import { Command } from 'commander';

/**
 * RAPM validation script with leaderboards and sanity checks.
 */

interface ValidationResults {
  season: number;
  targets: string[];
  totalPlayers: number;
  playersPerTarget: Record<string, number>;
  distributions: Record<string, {
    mean: number;
    std: number;
    min: number;
    max: number;
    outliers: number;
  }>;
  correlations: Array<{
    target1: string;
    target2: string;
    pearsonR: number;
    sampleSize: number;
  }>;
  teamSpotChecks: Array<{
    teamName: string;
    teamId: number;
    playersFound: number;
    topPlayer?: {
      name: string;
      orapm: number;
      drapm: number;
      rapm: number;
      target: string;
    };
  }>;
  topPlayers: Record<string, Array<{
    playerId: number;
    playerName: string;
    teamName: string;
    orapm: number;
    drapm: number;
    rapm: number;
    offPoss: number;
    defPoss: number;
  }>>;
  bottomPlayers: Record<string, Array<{
    playerId: number;
    playerName: string;
    teamName: string;
    orapm: number;
    drapm: number;
    rapm: number;
    offPoss: number;
    defPoss: number;
  }>>;
}

async function validateRapm(season: number): Promise<ValidationResults> {
  console.log(`🔍 Validating RAPM for season ${season}...\n`);

  const rapmData = await prisma.playerRapm.findMany({
    where: { season },
    include: {
      player: {
        include: {
          seasonStats: {
            where: { season },
            include: { team: true }
          }
        }
      }
    },
    orderBy: [{ target: 'asc' }, { rapm: 'desc' }]
  });

  if (rapmData.length === 0) {
    throw new Error(`No RAPM data found for season ${season}`);
  }

  console.log(`📊 Found ${rapmData.length} RAPM records`);

  const targets = [...new Set(rapmData.map(r => r.target))];
  const playersPerTarget: Record<string, number> = {};
  const distributions: Record<string, any> = {};
  const topPlayers: Record<string, any[]> = {};
  const bottomPlayers: Record<string, any[]> = {};

  for (const target of targets) {
    const targetData = rapmData.filter(r => r.target === target);
    playersPerTarget[target] = targetData.length;

    const rapmValues = targetData.map(r => r.rapm);
    const orapmValues = targetData.map(r => r.orapm);
    const drapmValues = targetData.map(r => r.drapm);

    const mean = rapmValues.reduce((sum, val) => sum + val, 0) / rapmValues.length;
    const variance = rapmValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / rapmValues.length;
    const std = Math.sqrt(variance);
    const min = Math.min(...rapmValues);
    const max = Math.max(...rapmValues);
    const outliers = rapmValues.filter(val => Math.abs(val) > 25).length;

    distributions[target] = { mean, std, min, max, outliers };

    console.log(`📈 ${target.toUpperCase()} distribution:`);
    console.log(`   Mean: ${mean.toFixed(2)}, Std: ${std.toFixed(2)}`);
    console.log(`   Range: ${min.toFixed(1)} to ${max.toFixed(1)}`);
    console.log(`   Outliers (|RAPM| > 25): ${outliers}`);
    console.log(`   ORAPM range: ${Math.min(...orapmValues).toFixed(1)} to ${Math.max(...orapmValues).toFixed(1)}`);
    console.log(`   DRAPM range: ${Math.min(...drapmValues).toFixed(1)} to ${Math.max(...drapmValues).toFixed(1)}\n`);

    const enrichedData = targetData.map(r => ({
      playerId: r.playerId,
      playerName: r.player.name || `Player ${r.playerId}`,
      teamName: r.player.seasonStats[0]?.team?.school || 'Unknown Team',
      orapm: r.orapm,
      drapm: r.drapm,
      rapm: r.rapm,
      offPoss: r.offPossUsed,
      defPoss: r.defPossUsed
    }));

    topPlayers[target] = enrichedData.slice(0, 20);
    bottomPlayers[target] = enrichedData.slice(-20).reverse();
  }

  // Calculate correlations
  const correlations = [];
  if (targets.length > 1) {
    for (let i = 0; i < targets.length; i++) {
      for (let j = i + 1; j < targets.length; j++) {
        const target1 = targets[i];
        const target2 = targets[j];

        const data1 = rapmData.filter(r => r.target === target1);
        const data2 = rapmData.filter(r => r.target === target2);

        const common = data1.filter(r1 =>
          data2.some(r2 => r2.playerId === r1.playerId)
        );

        if (common.length > 0) {
          const values1 = common.map(r => r.rapm);
          const values2 = common.map(r => {
            const matching = data2.find(r2 => r2.playerId === r.playerId);
            return matching ? matching.rapm : 0;
          });

          const pearsonR = calculatePearsonCorrelation(values1, values2);

          correlations.push({
            target1,
            target2,
            pearsonR,
            sampleSize: common.length
          });

          console.log(`🔗 ${target1} vs ${target2} correlation: r=${pearsonR.toFixed(3)} (n=${common.length})`);
        }
      }
    }
  }

  // Team spot checks
  const spotCheckTeams = [
    { name: 'UC Irvine', id: 308 },
    { name: 'UC San Diego', id: 310 },
    { name: 'UC Santa Barbara', id: 311 },
    { name: 'Auburn', id: 16 }
  ];

  const teamSpotChecks = [];
  for (const team of spotCheckTeams) {
    console.log(`\n🏀 ${team.name} (ID: ${team.id}) spot check:`);

    const teamRapmData = rapmData.filter(r =>
      r.player.seasonStats.some(s => s.teamId === team.id && s.season === season)
    );

    if (teamRapmData.length === 0) {
      console.log(`   No players found`);
      teamSpotChecks.push({
        teamName: team.name,
        teamId: team.id,
        playersFound: 0
      });
      continue;
    }

    const byTarget = groupBy(teamRapmData, r => r.target);
    let spotCheckEntry: any = {
      teamName: team.name,
      teamId: team.id,
      playersFound: teamRapmData.length
    };

    for (const [target, players] of Object.entries(byTarget)) {
      const sortedPlayers = (players as any[]).sort((a, b) => b.rapm - a.rapm);
      const topPlayer = sortedPlayers[0];

      console.log(`   ${target.toUpperCase()} - ${sortedPlayers.length} players:`);
      console.log(`     Top: ${topPlayer.player.name} (RAPM: ${topPlayer.rapm.toFixed(1)}, O: ${topPlayer.orapm.toFixed(1)}, D: ${topPlayer.drapm.toFixed(1)})`);

      if (!spotCheckEntry.topPlayer || topPlayer.rapm > spotCheckEntry.topPlayer.rapm) {
        spotCheckEntry.topPlayer = {
          name: topPlayer.player.name,
          orapm: topPlayer.orapm,
          drapm: topPlayer.drapm,
          rapm: topPlayer.rapm,
          target: target
        };
      }

      sortedPlayers.slice(0, Math.min(5, sortedPlayers.length)).forEach((player, i) => {
        if (i > 0) {
          console.log(`          ${player.player.name} (${player.rapm.toFixed(1)})`);
        }
      });
    }

    teamSpotChecks.push(spotCheckEntry);
  }

  return {
    season,
    targets,
    totalPlayers: rapmData.length,
    playersPerTarget,
    distributions,
    correlations,
    teamSpotChecks,
    topPlayers,
    bottomPlayers
  };
}

function calculatePearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n !== y.length || n === 0) return 0;

  const meanX = x.reduce((sum, val) => sum + val, 0) / n;
  const meanY = y.reduce((sum, val) => sum + val, 0) / n;

  let numerator = 0;
  let sumXSquared = 0;
  let sumYSquared = 0;

  for (let i = 0; i < n; i++) {
    const deltaX = x[i] - meanX;
    const deltaY = y[i] - meanY;
    numerator += deltaX * deltaY;
    sumXSquared += deltaX * deltaX;
    sumYSquared += deltaY * deltaY;
  }

  const denominator = Math.sqrt(sumXSquared * sumYSquared);
  return denominator === 0 ? 0 : numerator / denominator;
}

function groupBy<T>(array: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  array.forEach(item => {
    const key = keyFn(item);
    if (!result[key]) result[key] = [];
    result[key].push(item);
  });
  return result;
}

function printValidationReport(results: ValidationResults) {
  console.log('\n' + '='.repeat(70));
  console.log('📋 RAPM VALIDATION REPORT');
  console.log('='.repeat(70));

  console.log(`\n📊 Overall Statistics:`);
  console.log(`  Season: ${results.season}`);
  console.log(`  Targets: ${results.targets.join(', ')}`);
  console.log(`  Total records: ${results.totalPlayers.toLocaleString()}`);
  results.targets.forEach(target => {
    console.log(`  ${target} players: ${results.playersPerTarget[target].toLocaleString()}`);
  });

  console.log(`\n📈 Distribution Health Checks:`);
  results.targets.forEach(target => {
    const dist = results.distributions[target];
    console.log(`  ${target.toUpperCase()}:`);
    console.log(`    Mean: ${dist.mean.toFixed(2)} (should be ~0)`);
    console.log(`    Std:  ${dist.std.toFixed(2)}`);
    console.log(`    Range: ${dist.min.toFixed(1)} to ${dist.max.toFixed(1)}`);

    if (dist.outliers > 0) {
      console.log(`    ⚠️  ${dist.outliers} extreme outliers (|RAPM| > 25)`);
    } else {
      console.log(`    ✅ No extreme outliers`);
    }
  });

  if (results.correlations.length > 0) {
    console.log(`\n🔗 Cross-Target Correlations:`);
    results.correlations.forEach(corr => {
      const status = corr.pearsonR > 0.7 ? '✅' : corr.pearsonR > 0.5 ? '⚠️ ' : '❌';
      console.log(`  ${corr.target1} vs ${corr.target2}: r=${corr.pearsonR.toFixed(3)} ${status} (n=${corr.sampleSize})`);
    });

    const worstCorrelation = Math.min(...results.correlations.map(c => c.pearsonR));
    if (worstCorrelation < 0.5) {
      console.log(`  ⚠️  Low correlation detected - targets may be measuring different things`);
    }
  }

  console.log(`\n🏀 Team Spot Checks:`);
  results.teamSpotChecks.forEach(team => {
    if (team.playersFound === 0) {
      console.log(`  ${team.teamName}: No players found`);
    } else if (team.topPlayer) {
      console.log(`  ${team.teamName}: ${team.playersFound} players`);
      console.log(`    Best: ${team.topPlayer.name} (${team.topPlayer.target}) - RAPM: ${team.topPlayer.rapm.toFixed(1)}`);
    }
  });

  // Show leaderboards for first target
  if (results.targets.length > 0) {
    const primaryTarget = results.targets[0];

    console.log(`\n🔥 Top 10 ${primaryTarget.toUpperCase()} RAPM:`);
    results.topPlayers[primaryTarget].slice(0, 10).forEach((player, i) => {
      const rank = String(i + 1).padStart(2);
      const name = player.playerName.padEnd(20);
      const team = player.teamName.padEnd(15);
      const orapm = player.orapm.toFixed(1).padStart(5);
      const drapm = player.drapm.toFixed(1).padStart(5);
      const rapm = player.rapm.toFixed(1).padStart(5);
      const poss = `(${player.offPoss}/${player.defPoss})`;

      console.log(`  ${rank}. ${name} ${team} O:${orapm} D:${drapm} Net:${rapm} ${poss}`);
    });

    console.log(`\n❄️  Bottom 10 ${primaryTarget.toUpperCase()} RAPM:`);
    results.bottomPlayers[primaryTarget].slice(0, 10).forEach((player, i) => {
      const rank = String(i + 1).padStart(2);
      const name = player.playerName.padEnd(20);
      const team = player.teamName.padEnd(15);
      const orapm = player.orapm.toFixed(1).padStart(5);
      const drapm = player.drapm.toFixed(1).padStart(5);
      const rapm = player.rapm.toFixed(1).padStart(5);
      const poss = `(${player.offPoss}/${player.defPoss})`;

      console.log(`  ${rank}. ${name} ${team} O:${orapm} D:${drapm} Net:${rapm} ${poss}`);
    });
  }

  console.log(`\n💡 Recommendations:`);
  results.targets.forEach(target => {
    const dist = results.distributions[target];
    if (Math.abs(dist.mean) > 1.0) {
      console.log(`  • ${target}: Mean RAPM is ${dist.mean.toFixed(2)}, should be closer to 0`);
    }
    if (dist.outliers > results.playersPerTarget[target] * 0.01) {
      console.log(`  • ${target}: High outlier rate (${dist.outliers}), check for data quality issues`);
    }
  });

  if (results.correlations.some(c => c.pearsonR < 0.7)) {
    console.log(`  • Cross-target correlations are lower than expected - validate model consistency`);
  }

  const overallValid = results.targets.every(target => {
    const dist = results.distributions[target];
    return Math.abs(dist.mean) < 1.0 && dist.outliers < 5;
  });

  if (overallValid && results.correlations.every(c => c.pearsonR > 0.7)) {
    console.log(`\n✅ RAPM validation PASSED - results look healthy`);
  } else {
    console.log(`\n⚠️  RAPM validation flagged potential issues - review recommendations above`);
  }
}

async function main() {
  const program = new Command();

  program
    .option('--season <number>', 'Season to validate', '2026')
    .option('--target <string>', 'Show leaderboards for specific target only')
    .option('--team <number>', 'Show detailed breakdown for specific team ID');

  program.parse();
  const options = program.opts();

  const season = parseInt(options.season);

  try {
    const results = await validateRapm(season);
    printValidationReport(results);

    if (options.target) {
      const target = options.target;
      if (results.topPlayers[target]) {
        console.log(`\n📊 Full ${target.toUpperCase()} leaderboards:`);
        console.log(`🔥 Top 20:`);
        results.topPlayers[target].forEach((player, i) => {
          const rank = String(i + 1).padStart(2);
          const name = player.playerName.padEnd(25);
          const team = player.teamName.slice(0, 20).padEnd(20);
          const rapm = player.rapm.toFixed(1).padStart(6);
          const orapm = player.orapm.toFixed(1);
          const drapm = player.drapm.toFixed(1);

          console.log(`  ${rank}. ${name} ${team} ${rapm} (O:${orapm} D:${drapm})`);
        });

        console.log(`\n❄️  Bottom 20:`);
        results.bottomPlayers[target].forEach((player, i) => {
          const rank = String(i + 1).padStart(2);
          const name = player.playerName.padEnd(25);
          const team = player.teamName.slice(0, 20).padEnd(20);
          const rapm = player.rapm.toFixed(1).padStart(6);
          const orapm = player.orapm.toFixed(1);
          const drapm = player.drapm.toFixed(1);

          console.log(`  ${rank}. ${name} ${team} ${rapm} (O:${orapm} D:${drapm})`);
        });
      }
    }

  } catch (error) {
    console.error('❌ RAPM validation failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);