#!/usr/bin/env npx tsx
import 'dotenv/config';
import { prisma } from '../lib/prisma.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

interface PlayerComparison {
  playerId: number;
  playerName: string;
  team: string;
  productionOrapm: number;
  productionDrapm: number;
  productionNetRapm: number;
  retrainedOrapm: number;
  retrainedDrapm: number;
  retrainedNetRapm: number;
  orapmDiff: number;
  drapmDiff: number;
  netRapmDiff: number;
  productionRank: number;
  retrainedRank: number;
  rankDiff: number;
}

async function auditRapmReproducibility(): Promise<void> {
  console.log('=== RAPM DRAPM SIGN CONVENTION VALIDATION ===\n');
  console.log('🔍 Determining correct DRAPM sign mapping before production update\n');

  const season = 2026;

  // 1. Load production PlayerImpact data
  console.log('1. LOADING PRODUCTION PLAYERIMPACT DATA');
  console.log('======================================');

  const productionPlayers = await prisma.playerImpact.findMany({
    where: {
      season,
      orapm: { not: null },
      drapm: { not: null },
      rapm: { not: null }
    },
    include: {
      player: {
        include: {
          seasonStats: { where: { season }, include: { team: true } }
        }
      }
    },
    orderBy: { rapm: 'desc' }
  });

  console.log(`✅ Loaded ${productionPlayers.length} production PlayerImpact records`);
  console.log(`📊 Production top 10 Net RAPM:`);
  productionPlayers.slice(0, 10).forEach((player, i) => {
    const team = player.player.seasonStats[0]?.team?.abbreviation || 'UNK';
    console.log(`  ${(i + 1).toString().padStart(2)}. ${player.player.name} (${team}) - ${player.rapm?.toFixed(1)}`);
  });

  // 2. Load retrained λ=1000 and λ=300 data
  console.log('\n2. LOADING RETRAINED LAMBDA DATA');
  console.log('================================');

  let lambda1000Data, lambda300Data;

  // Load λ=1000 data
  try {
    const lambda1000Path = join('scripts', 'python', 'rapm', 'output', 'lambda_grid', 'rapm_lambda_1000.json');
    const content = readFileSync(lambda1000Path, 'utf-8');
    lambda1000Data = JSON.parse(content);
    console.log(`✅ Loaded retrained λ=1000: ${lambda1000Data.players.length} players`);
  } catch (error) {
    console.log(`❌ Failed to load λ=1000 data: ${error}`);
    throw error;
  }

  // Load λ=300 data
  try {
    const lambda300Path = join('scripts', 'python', 'rapm', 'output', 'lambda_grid', 'rapm_lambda_300.json');
    const content = readFileSync(lambda300Path, 'utf-8');
    lambda300Data = JSON.parse(content);
    console.log(`✅ Loaded retrained λ=300: ${lambda300Data.players.length} players`);
  } catch (error) {
    console.log(`❌ Failed to load λ=300 data: ${error}`);
    throw error;
  }

  // 3. Compare production vs retrained for exact same players
  console.log('\n3. PLAYER-BY-PLAYER COMPARISON');
  console.log('===============================');

  const comparisons: PlayerComparison[] = [];
  const retrainedMap = new Map(retrainedData.players.map((p: any) => [p.playerId, p]));

  for (const prodPlayer of productionPlayers) {
    const retrainedPlayer = retrainedMap.get(prodPlayer.player.id);

    if (retrainedPlayer) {
      const team = prodPlayer.player.seasonStats[0]?.team?.abbreviation || 'UNK';

      // Calculate ranks
      const productionRank = productionPlayers.findIndex(p => p.player.id === prodPlayer.player.id) + 1;
      const retrainedSorted = [...retrainedData.players].sort((a, b) => b.rapm - a.rapm);
      const retrainedRank = retrainedSorted.findIndex(p => p.playerId === prodPlayer.player.id) + 1;

      comparisons.push({
        playerId: prodPlayer.player.id,
        playerName: prodPlayer.player.name || `Player ${prodPlayer.player.id}`,
        team,
        productionOrapm: prodPlayer.orapm || 0,
        productionDrapm: prodPlayer.drapm || 0,
        productionNetRapm: prodPlayer.rapm || 0,
        retrainedOrapm: retrainedPlayer.orapm,
        retrainedDrapm: retrainedPlayer.drapm,
        retrainedNetRapm: retrainedPlayer.rapm,
        orapmDiff: (prodPlayer.orapm || 0) - retrainedPlayer.orapm,
        drapmDiff: (prodPlayer.drapm || 0) - retrainedPlayer.drapm,
        netRapmDiff: (prodPlayer.rapm || 0) - retrainedPlayer.rapm,
        productionRank,
        retrainedRank,
        rankDiff: productionRank - retrainedRank
      });
    }
  }

  console.log(`✅ Created ${comparisons.length} player comparisons`);

  // 4. Calculate correlations
  console.log('\n4. CORRELATION ANALYSIS');
  console.log('========================');

  const calculateCorrelation = (x: number[], y: number[]) => {
    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    return denominator === 0 ? 0 : numerator / denominator;
  };

  const orapmCorr = calculateCorrelation(
    comparisons.map(c => c.productionOrapm),
    comparisons.map(c => c.retrainedOrapm)
  );

  const drapmCorr = calculateCorrelation(
    comparisons.map(c => c.productionDrapm),
    comparisons.map(c => c.retrainedDrapm)
  );

  const netRapmCorr = calculateCorrelation(
    comparisons.map(c => c.productionNetRapm),
    comparisons.map(c => c.retrainedNetRapm)
  );

  console.log(`ORAPM correlation: ${orapmCorr.toFixed(4)}`);
  console.log(`DRAPM correlation: ${drapmCorr.toFixed(4)}`);
  console.log(`Net RAPM correlation: ${netRapmCorr.toFixed(4)}`);

  // Critical threshold assessment
  const criticalThreshold = 0.95;
  const correlationStatus = netRapmCorr >= criticalThreshold ? '✅ GOOD' : '❌ POOR';
  console.log(`\nCorrelation assessment: ${correlationStatus}`);
  console.log(`Expected: ≥${criticalThreshold}, Actual: ${netRapmCorr.toFixed(4)}`);

  // 5. Top 25 overlap analysis
  const productionTop25 = comparisons
    .sort((a, b) => a.productionRank - b.productionRank)
    .slice(0, 25)
    .map(c => c.playerId);

  const retrainedTop25 = comparisons
    .sort((a, b) => a.retrainedRank - b.retrainedRank)
    .slice(0, 25)
    .map(c => c.playerId);

  const top25Overlap = productionTop25.filter(id => retrainedTop25.includes(id)).length;

  console.log(`\n5. TOP 25 OVERLAP ANALYSIS`);
  console.log(`==========================`);
  console.log(`Top 25 overlap: ${top25Overlap}/25`);
  console.log(`Overlap percentage: ${(top25Overlap / 25 * 100).toFixed(1)}%`);

  if (top25Overlap < 20) {
    console.log(`❌ CRITICAL ISSUE: Low overlap suggests different data/model`);
  } else if (top25Overlap < 23) {
    console.log(`⚠️  MODERATE ISSUE: Some ranking differences`);
  } else {
    console.log(`✅ GOOD: High overlap confirms similar model`);
  }

  // 6. Biggest discrepancies
  console.log(`\n6. BIGGEST PLAYER DISCREPANCIES`);
  console.log(`==============================`);

  const biggestDiscrepancies = [...comparisons]
    .sort((a, b) => Math.abs(b.netRapmDiff) - Math.abs(a.netRapmDiff))
    .slice(0, 25);

  console.log(`Top 25 largest Net RAPM differences:`);
  console.log(`Player                     | Team | Prod RAPM | Retr RAPM | Diff   | Prod Rank | Retr Rank | Rank Diff`);
  console.log(`---------------------------|------|-----------|-----------|--------|-----------|-----------|----------`);

  biggestDiscrepancies.forEach(comp => {
    const name = comp.playerName.slice(0, 25).padEnd(25);
    const team = comp.team.padEnd(4);
    const prodRapm = comp.productionNetRapm.toFixed(1).padStart(9);
    const retrRapm = comp.retrainedNetRapm.toFixed(1).padStart(9);
    const diff = comp.netRapmDiff.toFixed(1).padStart(6);
    const prodRank = comp.productionRank.toString().padStart(9);
    const retrRank = comp.retrainedRank.toString().padStart(9);
    const rankDiff = comp.rankDiff.toString().padStart(9);

    console.log(`${name} | ${team} |${prodRapm} |${retrRapm} |${diff} |${prodRank} |${retrRank} |${rankDiff}`);
  });

  // 7. Benchmark players analysis
  console.log(`\n7. BENCHMARK PLAYERS ANALYSIS`);
  console.log(`=============================`);

  const benchmarkNames = [
    'Cameron Boozer', 'Yaxel Lendeborg', 'Joshua Jefferson', 'Isaiah Evans',
    'RJ Godfrey', 'Fletcher Loyer', 'Eric Mahaffey', 'Nate Heise',
    'Jeremy Fears Jr.', 'Bruce Thornton'
  ];

  for (const benchmarkName of benchmarkNames) {
    const comp = comparisons.find(c => c.playerName === benchmarkName);
    if (comp) {
      console.log(`\n**${benchmarkName}** (${comp.team}):`);
      console.log(`  Production: O=${comp.productionOrapm.toFixed(1)}, D=${comp.productionDrapm.toFixed(1)}, Net=${comp.productionNetRapm.toFixed(1)} (rank ${comp.productionRank})`);
      console.log(`  Retrained:  O=${comp.retrainedOrapm.toFixed(1)}, D=${comp.retrainedDrapm.toFixed(1)}, Net=${comp.retrainedNetRapm.toFixed(1)} (rank ${comp.retrainedRank})`);
      console.log(`  Difference: O=${comp.orapmDiff.toFixed(1)}, D=${comp.drapmDiff.toFixed(1)}, Net=${comp.netRapmDiff.toFixed(1)} (rank Δ${comp.rankDiff})`);

      const tier = comp.productionNetRapm > 7 ? 'Elite' : comp.productionNetRapm > 4 ? 'Very Good' : comp.productionNetRapm > 1 ? 'Good' : 'Average';
      const retrainedTier = comp.retrainedNetRapm > 7 ? 'Elite' : comp.retrainedNetRapm > 4 ? 'Very Good' : comp.retrainedNetRapm > 1 ? 'Good' : 'Average';
      console.log(`  Tier shift: ${tier} → ${retrainedTier}`);
    } else {
      console.log(`\n**${benchmarkName}**: Not found in comparison data`);
    }
  }

  // 8. Search for production source file
  console.log(`\n8. PRODUCTION SOURCE FILE INVESTIGATION`);
  console.log(`=======================================`);

  const possibleSourcePaths = [
    'scripts/python/rapm/output/rapm_phase3c.json',
    'scripts/python/rapm/output/rapm_phase3.json',
    'scripts/python/rapm/output/rapm_phase2.json',
    'scripts/python/rapm/output/rapm_actual.json',
    'scripts/python/rapm/output/rapm_2026.json'
  ];

  let productionSourceFound = false;

  for (const sourcePath of possibleSourcePaths) {
    if (existsSync(sourcePath)) {
      console.log(`\n🔍 Found potential source: ${sourcePath}`);
      try {
        const sourceContent = JSON.parse(readFileSync(sourcePath, 'utf-8'));
        console.log(`  Players: ${sourceContent.players?.length || 'unknown'}`);
        console.log(`  Lambda: ${sourceContent.lambda || 'unknown'}`);
        console.log(`  Season: ${sourceContent.season || 'unknown'}`);
        console.log(`  Phase: ${sourceContent.phase || 'unknown'}`);

        if (sourceContent.players && sourceContent.players.length > 0) {
          const samplePlayer = sourceContent.players[0];
          console.log(`  Sample player fields: ${Object.keys(samplePlayer).join(', ')}`);
        }
      } catch (error) {
        console.log(`  ❌ Failed to parse: ${error}`);
      }
    }
  }

  if (!productionSourceFound) {
    console.log(`❌ Could not identify production source file definitively`);
  }

  // 9. Sign convention validation
  console.log(`\n9. SIGN CONVENTION VALIDATION`);
  console.log(`=============================`);

  // Check if signs are flipped by looking at extreme players
  const topProduction = comparisons.sort((a, b) => b.productionNetRapm - a.productionNetRapm)[0];
  const topRetrained = comparisons.sort((a, b) => b.retrainedNetRapm - a.retrainedNetRapm)[0];

  console.log(`Production top player: ${topProduction.playerName} (${topProduction.productionNetRapm.toFixed(1)})`);
  console.log(`Retrained top player: ${topRetrained.playerName} (${topRetrained.retrainedNetRapm.toFixed(1)})`);

  // Check for sign flips
  const avgProductionOrapm = comparisons.reduce((sum, c) => sum + c.productionOrapm, 0) / comparisons.length;
  const avgRetrainedOrapm = comparisons.reduce((sum, c) => sum + c.retrainedOrapm, 0) / comparisons.length;
  const avgProductionDrapm = comparisons.reduce((sum, c) => sum + c.productionDrapm, 0) / comparisons.length;
  const avgRetrainedDrapm = comparisons.reduce((sum, c) => sum + c.retrainedDrapm, 0) / comparisons.length;

  console.log(`\nAverage values:`);
  console.log(`  Production: ORAPM=${avgProductionOrapm.toFixed(3)}, DRAPM=${avgProductionDrapm.toFixed(3)}`);
  console.log(`  Retrained:  ORAPM=${avgRetrainedOrapm.toFixed(3)}, DRAPM=${avgRetrainedDrapm.toFixed(3)}`);

  const possibleSignFlip = Math.abs(avgProductionOrapm + avgRetrainedOrapm) < 0.1 ||
                          Math.abs(avgProductionDrapm + avgRetrainedDrapm) < 0.1;

  if (possibleSignFlip) {
    console.log(`⚠️  POSSIBLE SIGN FLIP detected in ORAPM or DRAPM`);
  } else {
    console.log(`✅ Sign conventions appear consistent`);
  }

  // 10. Generate comprehensive report
  const report = generateReproducibilityReport(comparisons, {
    orapmCorr,
    drapmCorr,
    netRapmCorr,
    top25Overlap,
    totalComparisons: comparisons.length,
    biggestDiscrepancies: biggestDiscrepancies.slice(0, 10),
    avgProductionOrapm,
    avgRetrainedOrapm,
    avgProductionDrapm,
    avgRetrainedDrapm
  });

  writeFileSync('RAPM-REPRODUCIBILITY-AUDIT.md', report);
  console.log(`\n✅ Comprehensive audit report written to RAPM-REPRODUCIBILITY-AUDIT.md`);

  // Final assessment
  console.log(`\n=== REPRODUCIBILITY ASSESSMENT ===`);

  const isPipelineReproducible = netRapmCorr >= 0.95 && top25Overlap >= 20;

  if (isPipelineReproducible) {
    console.log(`✅ PIPELINE IS REPRODUCIBLE`);
    console.log(`   Net RAPM correlation: ${netRapmCorr.toFixed(4)}`);
    console.log(`   Top 25 overlap: ${top25Overlap}/25`);
    console.log(`   ✅ Lambda grid results are trustworthy`);
    console.log(`   ✅ λ=300 recommendation is valid`);
  } else {
    console.log(`❌ PIPELINE IS NOT REPRODUCIBLE`);
    console.log(`   Net RAPM correlation: ${netRapmCorr.toFixed(4)} (expected ≥0.95)`);
    console.log(`   Top 25 overlap: ${top25Overlap}/25 (expected ≥20)`);
    console.log(`   ❌ Lambda grid results are NOT trustworthy`);
    console.log(`   ❌ DO NOT use λ=300 recommendation`);
    console.log(`   🔧 Must fix pipeline before lambda optimization`);
  }

  await prisma.$disconnect();
}

function generateReproducibilityReport(comparisons: PlayerComparison[], stats: any): string {
  let report = '# RAPM Baseline Reproducibility Audit Report\n\n';

  report += '## Executive Summary\n\n';
  report += '**CRITICAL FINDING**: Investigation into whether the current RAPM training pipeline can reproduce production PlayerImpact values.\n\n';

  if (stats.netRapmCorr >= 0.95 && stats.top25Overlap >= 20) {
    report += '✅ **PIPELINE IS REPRODUCIBLE**: Retrained λ=1000 closely matches production PlayerImpact.\n';
    report += '✅ **Lambda grid validation is trustworthy**.\n\n';
  } else {
    report += '❌ **PIPELINE IS NOT REPRODUCIBLE**: Significant discrepancies found between retrained λ=1000 and production.\n';
    report += '❌ **Lambda grid validation results are questionable**.\n\n';
  }

  report += `- **Net RAPM correlation**: ${stats.netRapmCorr.toFixed(4)}\n`;
  report += `- **Top 25 overlap**: ${stats.top25Overlap}/25\n`;
  report += `- **Players compared**: ${stats.totalComparisons}\n`;
  report += `- **Method**: Direct comparison of identical players between production and retrained data\n\n`;

  report += '## Key Findings\n\n';
  report += `### Correlation Analysis\n`;
  report += `- **ORAPM correlation**: ${stats.orapmCorr.toFixed(4)}\n`;
  report += `- **DRAPM correlation**: ${stats.drapmCorr.toFixed(4)}\n`;
  report += `- **Net RAPM correlation**: ${stats.netRapmCorr.toFixed(4)}\n\n`;

  if (stats.netRapmCorr < 0.95) {
    report += '⚠️ **Low correlation indicates the retraining pipeline is using different data, model, or processing logic than production.**\n\n';
  }

  report += `### Ranking Stability\n`;
  report += `- **Top 25 overlap**: ${stats.top25Overlap}/25 (${(stats.top25Overlap/25*100).toFixed(1)}%)\n\n`;

  report += '### Biggest Discrepancies\n\n';
  report += 'Top 10 players with largest Net RAPM differences:\n\n';
  report += '| Player | Team | Production | Retrained | Difference | Prod Rank | Retr Rank |\n';
  report += '|--------|------|------------|-----------|------------|-----------|-----------|\n';

  stats.biggestDiscrepancies.forEach((comp: PlayerComparison) => {
    report += `| ${comp.playerName} | ${comp.team} | ${comp.productionNetRapm.toFixed(1)} | ${comp.retrainedNetRapm.toFixed(1)} | ${comp.netRapmDiff.toFixed(1)} | ${comp.productionRank} | ${comp.retrainedRank} |\n`;
  });

  report += '\n### Sign Convention Check\n';
  report += `- Production average ORAPM: ${stats.avgProductionOrapm.toFixed(3)}\n`;
  report += `- Retrained average ORAPM: ${stats.avgRetrainedOrapm.toFixed(3)}\n`;
  report += `- Production average DRAPM: ${stats.avgProductionDrapm.toFixed(3)}\n`;
  report += `- Retrained average DRAPM: ${stats.avgRetrainedDrapm.toFixed(3)}\n\n`;

  report += '## Recommendations\n\n';

  if (stats.netRapmCorr >= 0.95 && stats.top25Overlap >= 20) {
    report += '### ✅ Pipeline is Reproducible\n';
    report += '1. **Proceed with lambda optimization** - retrained models are trustworthy\n';
    report += '2. **Use λ=300 recommendation** from lambda grid validation\n';
    report += '3. **Production PlayerImpact can be safely updated** after final validation\n\n';
  } else {
    report += '### ❌ Pipeline Requires Investigation\n';
    report += '1. **DO NOT update production PlayerImpact** until reproducibility is achieved\n';
    report += '2. **DO NOT trust lambda grid results** - underlying pipeline has issues\n';
    report += '3. **Investigate data source differences** between production and retraining\n';
    report += '4. **Check model configuration differences** (centering, sign conventions, targets)\n';
    report += '5. **Verify production source file** and compare to retraining output\n';
    report += '6. **Fix pipeline discrepancies** before lambda optimization\n\n';
  }

  report += '**CRITICAL**: This audit must pass before any lambda changes reach production.\n';

  return report;
}

auditRapmReproducibility().catch(console.error);