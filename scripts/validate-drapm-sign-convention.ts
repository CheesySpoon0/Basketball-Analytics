#!/usr/bin/env npx tsx
import 'dotenv/config';
import { prisma } from '../lib/prisma.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

interface PlayerSignAnalysis {
  playerId: number;
  playerName: string;
  team: string;

  // Production values
  prodOrapm: number;
  prodDrapm: number;
  prodNetRapm: number;

  // λ=1000 raw values (straight from model)
  lambda1000RawOrapm: number;
  lambda1000RawDrapm: number;
  lambda1000RawNet: number;

  // λ=1000 corrected values (DRAPM sign flipped for display)
  lambda1000CorrOrapm: number;
  lambda1000CorrDrapm: number;
  lambda1000CorrNet: number;

  // λ=300 corrected values
  lambda300CorrOrapm: number;
  lambda300CorrDrapm: number;
  lambda300CorrNet: number;

  // Differences
  prodVsRawDrapmDiff: number;
  prodVsCorrDrapmDiff: number;
  prodVsCorrNetDiff: number;
}

async function validateDrapmSignConvention(): Promise<void> {
  console.log('=== DRAPM SIGN CONVENTION VALIDATION ===\n');
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
    }
  });

  console.log(`✅ Loaded ${productionPlayers.length} production PlayerImpact records`);

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

  // 3. Create comprehensive player analysis
  console.log('\n3. DRAPM SIGN COMPARISON ANALYSIS');
  console.log('==================================');

  const analyses: PlayerSignAnalysis[] = [];
  const lambda1000Map = new Map(lambda1000Data.players.map((p: any) => [p.playerId, p]));
  const lambda300Map = new Map(lambda300Data.players.map((p: any) => [p.playerId, p]));

  for (const prodPlayer of productionPlayers) {
    const lambda1000Player = lambda1000Map.get(prodPlayer.player.id);
    const lambda300Player = lambda300Map.get(prodPlayer.player.id);

    if (lambda1000Player && lambda300Player) {
      const team = prodPlayer.player.seasonStats[0]?.team?.abbreviation || 'UNK';

      // Raw values from retrained models
      const lambda1000RawOrapm = lambda1000Player.orapm;
      const lambda1000RawDrapm = lambda1000Player.drapm;
      const lambda1000RawNet = lambda1000Player.rapm;

      // Corrected values (flip DRAPM sign for display: positive = good defense)
      const lambda1000CorrDrapm = -lambda1000RawDrapm;
      const lambda1000CorrNet = lambda1000RawOrapm + lambda1000CorrDrapm;

      const lambda300RawOrapm = lambda300Player.orapm;
      const lambda300RawDrapm = lambda300Player.drapm;
      const lambda300CorrDrapm = -lambda300RawDrapm;
      const lambda300CorrNet = lambda300RawOrapm + lambda300CorrDrapm;

      analyses.push({
        playerId: prodPlayer.player.id,
        playerName: prodPlayer.player.name || `Player ${prodPlayer.player.id}`,
        team,

        // Production
        prodOrapm: prodPlayer.orapm || 0,
        prodDrapm: prodPlayer.drapm || 0,
        prodNetRapm: prodPlayer.rapm || 0,

        // λ=1000 raw and corrected
        lambda1000RawOrapm,
        lambda1000RawDrapm,
        lambda1000RawNet,
        lambda1000CorrOrapm: lambda1000RawOrapm,
        lambda1000CorrDrapm,
        lambda1000CorrNet,

        // λ=300 corrected
        lambda300CorrOrapm: lambda300RawOrapm,
        lambda300CorrDrapm,
        lambda300CorrNet,

        // Differences for correlation analysis
        prodVsRawDrapmDiff: (prodPlayer.drapm || 0) - lambda1000RawDrapm,
        prodVsCorrDrapmDiff: (prodPlayer.drapm || 0) - lambda1000CorrDrapm,
        prodVsCorrNetDiff: (prodPlayer.rapm || 0) - lambda1000CorrNet
      });
    }
  }

  console.log(`✅ Created ${analyses.length} player comparisons`);

  // 4. Calculate correlations for both sign conventions
  console.log('\n4. CORRELATION ANALYSIS - RAW vs CORRECTED DRAPM');
  console.log('=================================================');

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

  // Production vs Raw λ=1000 DRAPM
  const prodVsRawDrapmCorr = calculateCorrelation(
    analyses.map(a => a.prodDrapm),
    analyses.map(a => a.lambda1000RawDrapm)
  );

  // Production vs Corrected λ=1000 DRAPM
  const prodVsCorrDrapmCorr = calculateCorrelation(
    analyses.map(a => a.prodDrapm),
    analyses.map(a => a.lambda1000CorrDrapm)
  );

  // Production vs Corrected λ=1000 Net RAPM
  const prodVsCorrNetCorr = calculateCorrelation(
    analyses.map(a => a.prodNetRapm),
    analyses.map(a => a.lambda1000CorrNet)
  );

  console.log(`Production DRAPM vs Raw λ=1000 DRAPM correlation:       ${prodVsRawDrapmCorr.toFixed(4)}`);
  console.log(`Production DRAPM vs Corrected λ=1000 DRAPM correlation: ${prodVsCorrDrapmCorr.toFixed(4)}`);
  console.log(`Production Net vs Corrected λ=1000 Net correlation:     ${prodVsCorrNetCorr.toFixed(4)}`);

  // Determine which sign convention matches production
  const rawIsCloser = Math.abs(prodVsRawDrapmCorr) > Math.abs(prodVsCorrDrapmCorr);
  const corrIsCloser = Math.abs(prodVsCorrDrapmCorr) > Math.abs(prodVsRawDrapmCorr);

  console.log('\nSign Convention Assessment:');
  if (rawIsCloser && prodVsRawDrapmCorr > 0.9) {
    console.log('✅ Production DRAPM appears to use RAW sign convention');
    console.log('   (Production DRAPM ≈ Raw Model DRAPM)');
  } else if (corrIsCloser && prodVsCorrDrapmCorr > 0.9) {
    console.log('✅ Production DRAPM appears to use CORRECTED sign convention');
    console.log('   (Production DRAPM ≈ -1 × Raw Model DRAPM)');
  } else {
    console.log('❌ Neither sign convention strongly matches production');
    console.log(`   Raw correlation: ${prodVsRawDrapmCorr.toFixed(4)}`);
    console.log(`   Corrected correlation: ${prodVsCorrDrapmCorr.toFixed(4)}`);
  }

  // 5. Top 25 overlap analysis
  console.log('\n5. TOP 25 RANKING OVERLAP ANALYSIS');
  console.log('===================================');

  // Production top 25
  const prodTop25 = analyses
    .sort((a, b) => b.prodNetRapm - a.prodNetRapm)
    .slice(0, 25)
    .map(a => a.playerId);

  // λ=1000 corrected top 25
  const lambda1000CorrTop25 = analyses
    .sort((a, b) => b.lambda1000CorrNet - a.lambda1000CorrNet)
    .slice(0, 25)
    .map(a => a.playerId);

  // λ=1000 corrected DRAPM top 25
  const lambda1000DrapmTop25 = analyses
    .sort((a, b) => b.lambda1000CorrDrapm - a.lambda1000CorrDrapm)
    .slice(0, 25)
    .map(a => a.playerId);

  // Production DRAPM top 25
  const prodDrapmTop25 = analyses
    .sort((a, b) => b.prodDrapm - a.prodDrapm)
    .slice(0, 25)
    .map(a => a.playerId);

  const netTop25Overlap = prodTop25.filter(id => lambda1000CorrTop25.includes(id)).length;
  const drapmTop25Overlap = prodDrapmTop25.filter(id => lambda1000DrapmTop25.includes(id)).length;

  console.log(`Top 25 Net RAPM overlap: ${netTop25Overlap}/25 (${(netTop25Overlap/25*100).toFixed(1)}%)`);
  console.log(`Top 25 DRAPM overlap: ${drapmTop25Overlap}/25 (${(drapmTop25Overlap/25*100).toFixed(1)}%)`);

  // 6. Benchmark players analysis
  console.log('\n6. BENCHMARK PLAYERS ANALYSIS');
  console.log('==============================');

  const benchmarkNames = [
    'Cameron Boozer', 'Yaxel Lendeborg', 'Joshua Jefferson', 'Isaiah Evans',
    'RJ Godfrey', 'Fletcher Loyer', 'Eric Mahaffey', 'Nate Heise',
    'Jeremy Fears Jr.', 'Bruce Thornton'
  ];

  for (const benchmarkName of benchmarkNames) {
    const analysis = analyses.find(a => a.playerName === benchmarkName);
    if (analysis) {
      console.log(`\n**${benchmarkName}** (${analysis.team}):`);
      console.log(`  Production:     O=${analysis.prodOrapm.toFixed(1)}, D=${analysis.prodDrapm.toFixed(1)}, Net=${analysis.prodNetRapm.toFixed(1)}`);
      console.log(`  λ=1000 Raw:     O=${analysis.lambda1000RawOrapm.toFixed(1)}, D=${analysis.lambda1000RawDrapm.toFixed(1)}, Net=${analysis.lambda1000RawNet.toFixed(1)}`);
      console.log(`  λ=1000 Corr:    O=${analysis.lambda1000CorrOrapm.toFixed(1)}, D=${analysis.lambda1000CorrDrapm.toFixed(1)}, Net=${analysis.lambda1000CorrNet.toFixed(1)}`);
      console.log(`  λ=300 Corr:     O=${analysis.lambda300CorrOrapm.toFixed(1)}, D=${analysis.lambda300CorrDrapm.toFixed(1)}, Net=${analysis.lambda300CorrNet.toFixed(1)}`);

      // Determine which makes more basketball sense
      const isEliteDefender = analysis.prodNetRapm > 6; // Elite overall players
      const prodDrapmPositive = analysis.prodDrapm > 0;
      const corrDrapmPositive = analysis.lambda1000CorrDrapm > 0;

      if (isEliteDefender) {
        console.log(`  Basketball sense: Elite player should have positive DRAPM`);
        console.log(`    Production DRAPM positive: ${prodDrapmPositive ? '✅' : '❌'}`);
        console.log(`    Corrected DRAPM positive: ${corrDrapmPositive ? '✅' : '❌'}`);
      }
    } else {
      console.log(`\n**${benchmarkName}**: Not found in comparison data`);
    }
  }

  // 7. Team-level validation
  console.log('\n7. TEAM-LEVEL DEFENSIVE CORRELATION VALIDATION');
  console.log('===============================================');

  // Get team defensive ratings for correlation check
  const teamStats = await prisma.teamSeasonStats.findMany({
    where: { season },
    include: { team: true }
  });

  console.log(`✅ Loaded ${teamStats.length} team defensive ratings`);

  // Calculate average DRAPM by team for both production and corrected
  const teamDrapmAnalysis = new Map<string, {
    teamName: string;
    prodAvgDrapm: number;
    correctedAvgDrapm: number;
    drtg: number;
    playerCount: number;
  }>();

  for (const analysis of analyses) {
    if (!teamDrapmAnalysis.has(analysis.team)) {
      const teamStat = teamStats.find(ts => ts.team.abbreviation === analysis.team);
      teamDrapmAnalysis.set(analysis.team, {
        teamName: analysis.team,
        prodAvgDrapm: 0,
        correctedAvgDrapm: 0,
        drtg: teamStat?.defensiveRating || 0,
        playerCount: 0
      });
    }

    const teamData = teamDrapmAnalysis.get(analysis.team)!;
    teamData.prodAvgDrapm += analysis.prodDrapm;
    teamData.correctedAvgDrapm += analysis.lambda1000CorrDrapm;
    teamData.playerCount += 1;
  }

  // Finalize team averages
  for (const [team, data] of teamDrapmAnalysis) {
    data.prodAvgDrapm /= data.playerCount;
    data.correctedAvgDrapm /= data.playerCount;
  }

  console.log('\nTop 10 defensive teams by DRtg (lower is better):');
  const sortedTeams = Array.from(teamDrapmAnalysis.values())
    .filter(t => t.drtg > 0)
    .sort((a, b) => a.drtg - b.drtg)
    .slice(0, 10);

  console.log('Team | DRtg | Prod Avg DRAPM | Corr Avg DRAPM | Expected');
  console.log('-----|------|----------------|----------------|----------');
  sortedTeams.forEach(team => {
    const expected = 'High+'; // Good defensive teams should have high positive DRAPM
    console.log(`${team.teamName.padEnd(4)} | ${team.drtg.toFixed(1).padStart(4)} | ${team.prodAvgDrapm.toFixed(2).padStart(14)} | ${team.correctedAvgDrapm.toFixed(2).padStart(14)} | ${expected}`);
  });

  // 8. Final assessment and classification
  console.log('\n8. FINAL ASSESSMENT AND CLASSIFICATION');
  console.log('=======================================');

  let classification = 'D'; // Default to "reproduction still not matching"
  let trustLambda300 = false;

  if (prodVsCorrDrapmCorr > 0.9 && prodVsCorrNetCorr > 0.9) {
    classification = 'A';
    trustLambda300 = true;
    console.log('✅ CLASSIFICATION A: Production PlayerImpact already uses corrected DRAPM sign');
    console.log('   Strong correlation between production and corrected retrained values');
  } else if (prodVsRawDrapmCorr > 0.9) {
    classification = 'B';
    trustLambda300 = true;
    console.log('❌ CLASSIFICATION B: Production PlayerImpact uses raw/unflipped DRAPM and is wrong');
    console.log('   Strong correlation between production and raw retrained values');
  } else if (netTop25Overlap < 15 && drapmTop25Overlap < 15) {
    classification = 'C';
    trustLambda300 = false;
    console.log('⚠️  CLASSIFICATION C: Production PlayerImpact is mixed/stale and needs full reimport');
    console.log('   Low overlap suggests inconsistent or outdated data');
  } else {
    classification = 'D';
    trustLambda300 = false;
    console.log('❌ CLASSIFICATION D: Reproduction is still not matching and lambda validation cannot be trusted');
    console.log('   Neither sign convention produces strong correlation');
  }

  console.log('\nCorrelation Evidence:');
  console.log(`  Production vs Raw DRAPM: ${prodVsRawDrapmCorr.toFixed(4)}`);
  console.log(`  Production vs Corrected DRAPM: ${prodVsCorrDrapmCorr.toFixed(4)}`);
  console.log(`  Production vs Corrected Net: ${prodVsCorrNetCorr.toFixed(4)}`);

  console.log('\nRanking Evidence:');
  console.log(`  Net RAPM top 25 overlap: ${netTop25Overlap}/25`);
  console.log(`  DRAPM top 25 overlap: ${drapmTop25Overlap}/25`);

  // 9. Lambda 300 recommendation status
  console.log('\n9. LAMBDA 300 RECOMMENDATION STATUS');
  console.log('====================================');

  if (trustLambda300) {
    console.log('✅ λ=300 recommendation IS VALID and can be trusted');

    if (classification === 'A') {
      console.log('✅ Production DRAPM sign is already correct');
      console.log('   Import mapping: Use corrected DRAPM (flip sign from raw model)');
    } else if (classification === 'B') {
      console.log('❌ Production DRAPM sign is incorrect (uses raw values)');
      console.log('   Import mapping: Use corrected DRAPM (flip sign from raw model)');
    }
  } else {
    console.log('❌ λ=300 recommendation CANNOT BE TRUSTED');
    console.log('   Must fix reproducibility issues before lambda optimization');
  }

  // 10. Safe import plan (preparation only)
  console.log('\n10. SAFE IMPORT PLAN PREPARATION');
  console.log('=================================');

  if (trustLambda300) {
    console.log('Preparing safe import plan (NOT EXECUTING):');

    // Backup current PlayerImpact
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = `PlayerImpact_backup_${timestamp}.json`;

    console.log(`1. Backup: Export current PlayerImpact to ${backupFile}`);

    const backupData = productionPlayers.map(p => ({
      id: p.id,
      playerId: p.playerId,
      season: p.season,
      orapm: p.orapm,
      drapm: p.drapm,
      rapm: p.rapm
    }));

    writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
    console.log(`✅ Backup saved to ${backupFile}`);

    // Prepare λ=300 validation data
    const lambda300Validation = lambda300Data.players.map((p: any) => ({
      playerId: p.playerId,
      rawOrapm: p.orapm,
      rawDrapm: p.drapm,
      rawNet: p.rapm,
      correctedDrapm: -p.drapm, // Flip sign for display
      correctedNet: p.orapm + (-p.drapm) // Corrected net
    }));

    const validationFile = `Lambda300_validation_${timestamp}.json`;
    writeFileSync(validationFile, JSON.stringify(lambda300Validation, null, 2));
    console.log(`✅ λ=300 validation data saved to ${validationFile}`);

    console.log('\n⚠️  NEXT STEPS (manual execution required):');
    console.log('1. Review validation files for correctness');
    console.log('2. Verify top players make basketball sense');
    console.log('3. Check for extreme outliers');
    console.log('4. Validate team-level defensive correlations');
    console.log('5. Only then proceed with PlayerImpact update');
  } else {
    console.log('❌ Cannot prepare import plan - lambda validation not trustworthy');
  }

  // Generate final report
  const report = generateFinalReport(analyses, {
    classification,
    trustLambda300,
    prodVsRawDrapmCorr,
    prodVsCorrDrapmCorr,
    prodVsCorrNetCorr,
    netTop25Overlap,
    drapmTop25Overlap
  });

  writeFileSync('DRAPM-SIGN-VALIDATION-FINAL.md', report);
  console.log(`\n✅ Final validation report saved to DRAPM-SIGN-VALIDATION-FINAL.md`);

  await prisma.$disconnect();
}

function generateFinalReport(analyses: PlayerSignAnalysis[], results: any): string {
  let report = '# DRAPM Sign Convention Validation - Final Report\n\n';

  report += '## Executive Summary\n\n';
  report += `**Classification: ${results.classification}**\n\n`;

  switch (results.classification) {
    case 'A':
      report += '✅ **Production PlayerImpact already uses corrected DRAPM sign**\n';
      report += '✅ **λ=300 recommendation is valid and trustworthy**\n';
      report += 'Production DRAPM values correlate strongly with corrected retrained values.\n\n';
      break;
    case 'B':
      report += '❌ **Production PlayerImpact uses raw/unflipped DRAPM and is wrong**\n';
      report += '✅ **λ=300 recommendation is valid but requires sign correction**\n';
      report += 'Production DRAPM values correlate strongly with raw retrained values.\n\n';
      break;
    case 'C':
      report += '⚠️  **Production PlayerImpact is mixed/stale and needs full reimport**\n';
      report += '❌ **Cannot trust λ=300 until data consistency is resolved**\n';
      report += 'Low ranking overlap suggests inconsistent or outdated production data.\n\n';
      break;
    case 'D':
      report += '❌ **Reproduction is still not matching - lambda validation cannot be trusted**\n';
      report += '❌ **Must fix underlying pipeline issues before proceeding**\n';
      report += 'Neither sign convention produces strong correlation with production.\n\n';
      break;
  }

  report += '## Key Findings\n\n';
  report += `### Correlation Analysis\n`;
  report += `- **Production vs Raw DRAPM**: ${results.prodVsRawDrapmCorr.toFixed(4)}\n`;
  report += `- **Production vs Corrected DRAPM**: ${results.prodVsCorrDrapmCorr.toFixed(4)}\n`;
  report += `- **Production vs Corrected Net**: ${results.prodVsCorrNetCorr.toFixed(4)}\n\n`;

  report += `### Ranking Overlap\n`;
  report += `- **Top 25 Net RAPM overlap**: ${results.netTop25Overlap}/25\n`;
  report += `- **Top 25 DRAPM overlap**: ${results.drapmTop25Overlap}/25\n\n`;

  report += '## Recommendations\n\n';

  if (results.trustLambda300) {
    if (results.classification === 'A') {
      report += '### ✅ Safe to Proceed with λ=300\n';
      report += '1. **Production DRAPM sign is already correct**\n';
      report += '2. **Use corrected DRAPM when importing λ=300** (flip sign from raw model)\n';
      report += '3. **Import mapping**: correctedDRAPM = -rawDRAPM from model\n';
      report += '4. **Net RAPM**: ORAPM + correctedDRAPM\n\n';
    } else {
      report += '### ⚠️  Proceed with λ=300 After Sign Correction\n';
      report += '1. **Production DRAPM sign is incorrect (uses raw values)**\n';
      report += '2. **Must fix DRAPM signs when importing λ=300**\n';
      report += '3. **Import mapping**: correctedDRAPM = -rawDRAPM from model\n';
      report += '4. **Verify elite defenders show positive DRAPM after import**\n\n';
    }
  } else {
    report += '### ❌ Do Not Proceed with λ=300\n';
    report += '1. **Reproducibility issues must be fixed first**\n';
    report += '2. **Cannot trust lambda optimization results**\n';
    report += '3. **Investigate data source and pipeline differences**\n';
    report += '4. **Re-run validation after fixing underlying issues**\n\n';
  }

  report += '**CRITICAL**: No production writes have been performed. Review validation files before proceeding.\n';

  return report;
}

validateDrapmSignConvention().catch(console.error);