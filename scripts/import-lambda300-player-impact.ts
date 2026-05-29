#!/usr/bin/env npx tsx
import 'dotenv/config';
import { prisma } from '../lib/prisma.js';
import { readFileSync } from 'fs';
import { join } from 'path';

interface Lambda300Player {
  playerId: number;
  rawOrapm: number;
  rawDrapm: number;
  rawNet: number;
  correctedOrapm: number;
  correctedDrapm: number;
  correctedNet: number;
  offPossUsed?: number;
  defPossUsed?: number;
}

interface ImportStats {
  modelRowsFound: number;
  matchingExistingRows: number;
  missingPlayerImpactRows: number;
  updatedRows: number;
  skippedRows: number;
  errorRows: number;
}

async function importLambda300PlayerImpact(): Promise<void> {
  console.log('=== LAMBDA 300 PLAYER IMPACT IMPORT ===\n');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const seasonArg = args.find(arg => arg.startsWith('--season='));
  const isDryRun = args.includes('--dry-run');
  const isWrite = args.includes('--write');

  if (!seasonArg) {
    throw new Error('Season is required. Use --season=2026');
  }

  if (!isDryRun && !isWrite) {
    throw new Error('Must specify either --dry-run or --write mode');
  }

  const season = parseInt(seasonArg.split('=')[1]);
  const mode = isDryRun ? 'DRY RUN' : 'WRITE';

  console.log(`🎯 Mode: ${mode}`);
  console.log(`📅 Season: ${season}`);
  console.log();

  // 1. Load λ=300 model data
  console.log('1. LOADING λ=300 MODEL DATA');
  console.log('===========================');

  let lambda300Data;
  try {
    const lambda300Path = join('scripts', 'python', 'rapm', 'output', 'lambda_grid', 'rapm_lambda_300.json');
    const content = readFileSync(lambda300Path, 'utf-8');
    lambda300Data = JSON.parse(content);
    console.log(`✅ Loaded λ=300 model data`);
    console.log(`📊 Players: ${lambda300Data.players.length}`);
    console.log(`🔢 Lambda: ${lambda300Data.lambda}`);
    console.log(`📈 Model: ${lambda300Data.model_info?.model || 'unknown'}`);
  } catch (error) {
    throw new Error(`Failed to load λ=300 data: ${error}`);
  }

  // 2. Process and validate model data
  console.log('\n2. PROCESSING MODEL DATA WITH SIGN CORRECTION');
  console.log('==============================================');

  const processedPlayers: Lambda300Player[] = lambda300Data.players.map((p: any) => {
    // Apply correct sign convention: positive DRAPM = good defense
    const correctedOrapm = p.orapm;
    const correctedDrapm = -p.drapm; // Flip sign from raw model output
    const correctedNet = correctedOrapm + correctedDrapm;

    return {
      playerId: p.playerId,
      rawOrapm: p.orapm,
      rawDrapm: p.drapm,
      rawNet: p.rapm,
      correctedOrapm,
      correctedDrapm,
      correctedNet,
      offPossUsed: p.off_poss_used,
      defPossUsed: p.def_poss_used
    };
  });

  console.log(`✅ Processed ${processedPlayers.length} players with corrected DRAPM signs`);

  // 3. Load existing PlayerImpact data
  console.log('\n3. LOADING EXISTING PLAYERIMPACT DATA');
  console.log('====================================');

  const existingPlayers = await prisma.playerImpact.findMany({
    where: { season },
    include: {
      player: { select: { name: true } }
    }
  });

  console.log(`✅ Found ${existingPlayers.length} existing PlayerImpact records`);

  // Create lookup map
  const existingMap = new Map(existingPlayers.map(p => [p.playerId, p]));

  // 4. Match model data to existing records
  console.log('\n4. MATCHING MODEL TO EXISTING RECORDS');
  console.log('=====================================');

  const stats: ImportStats = {
    modelRowsFound: processedPlayers.length,
    matchingExistingRows: 0,
    missingPlayerImpactRows: 0,
    updatedRows: 0,
    skippedRows: 0,
    errorRows: 0
  };

  const matchedPlayers: (Lambda300Player & { existingRecord: any; playerName: string })[] = [];
  const missingPlayerIds: number[] = [];

  for (const modelPlayer of processedPlayers) {
    const existingRecord = existingMap.get(modelPlayer.playerId);

    if (existingRecord) {
      stats.matchingExistingRows++;
      matchedPlayers.push({
        ...modelPlayer,
        existingRecord,
        playerName: existingRecord.player?.name || `Player ${modelPlayer.playerId}`
      });
    } else {
      stats.missingPlayerImpactRows++;
      missingPlayerIds.push(modelPlayer.playerId);
    }
  }

  console.log(`✅ Matched players: ${stats.matchingExistingRows}`);
  console.log(`⚠️  Missing PlayerImpact records: ${stats.missingPlayerImpactRows}`);

  if (stats.missingPlayerImpactRows > 0) {
    console.log(`Missing player IDs (first 10): ${missingPlayerIds.slice(0, 10).join(', ')}`);
  }

  // 5. Generate dry-run report
  console.log('\n5. DRY-RUN VALIDATION REPORT');
  console.log('=============================');

  // Sort by corrected Net RAPM
  const sortedByNet = [...matchedPlayers].sort((a, b) => b.correctedNet - a.correctedNet);
  const sortedByOrapm = [...matchedPlayers].sort((a, b) => b.correctedOrapm - a.correctedOrapm);
  const sortedByDrapm = [...matchedPlayers].sort((a, b) => b.correctedDrapm - a.correctedDrapm);

  console.log('Top 25 Net RAPM (after import mapping):');
  console.log('Rank | Player                    | ORAPM | DRAPM | Net RAPM | Current Net');
  console.log('-----|---------------------------|-------|-------|----------|------------');
  sortedByNet.slice(0, 25).forEach((player, i) => {
    const rank = (i + 1).toString().padStart(4);
    const name = player.playerName.slice(0, 25).padEnd(25);
    const orapm = player.correctedOrapm.toFixed(1).padStart(5);
    const drapm = player.correctedDrapm.toFixed(1).padStart(5);
    const net = player.correctedNet.toFixed(1).padStart(7);
    const currentNet = (player.existingRecord.rapm || 0).toFixed(1).padStart(10);
    console.log(`${rank} | ${name} |${orapm} |${drapm} |${net} |${currentNet}`);
  });

  console.log('\nTop 15 ORAPM:');
  sortedByOrapm.slice(0, 15).forEach((player, i) => {
    console.log(`  ${(i + 1).toString().padStart(2)}. ${player.playerName} - ${player.correctedOrapm.toFixed(1)}`);
  });

  console.log('\nTop 15 DRAPM:');
  sortedByDrapm.slice(0, 15).forEach((player, i) => {
    console.log(`  ${(i + 1).toString().padStart(2)}. ${player.playerName} - ${player.correctedDrapm.toFixed(1)}`);
  });

  // 6. Check for extreme outliers
  console.log('\n6. OUTLIER DETECTION');
  console.log('====================');

  const extremeOrapm = matchedPlayers.filter(p => Math.abs(p.correctedOrapm) > 25);
  const extremeDrapm = matchedPlayers.filter(p => Math.abs(p.correctedDrapm) > 25);
  const extremeNet = matchedPlayers.filter(p => Math.abs(p.correctedNet) > 25);

  console.log(`Extreme ORAPM (>±25): ${extremeOrapm.length}`);
  console.log(`Extreme DRAPM (>±25): ${extremeDrapm.length}`);
  console.log(`Extreme Net RAPM (>±25): ${extremeNet.length}`);

  if (extremeNet.length > 0) {
    console.log('Extreme outliers:');
    extremeNet.slice(0, 5).forEach(player => {
      console.log(`  ${player.playerName}: Net=${player.correctedNet.toFixed(1)}`);
    });
  }

  // 7. Validate Net RAPM calculation
  console.log('\n7. NET RAPM CALCULATION VALIDATION');
  console.log('===================================');

  const calculationErrors = matchedPlayers.filter(p => {
    const expectedNet = p.correctedOrapm + p.correctedDrapm;
    const actualNet = p.correctedNet;
    return Math.abs(expectedNet - actualNet) > 0.01;
  });

  console.log(`Calculation errors (Net ≠ ORAPM + DRAPM): ${calculationErrors.length}`);

  if (calculationErrors.length > 0) {
    console.log('First 5 calculation errors:');
    calculationErrors.slice(0, 5).forEach(player => {
      const expected = player.correctedOrapm + player.correctedDrapm;
      console.log(`  ${player.playerName}: Expected=${expected.toFixed(3)}, Actual=${player.correctedNet.toFixed(3)}`);
    });
  }

  // 8. Benchmark players analysis
  console.log('\n8. BENCHMARK PLAYERS ANALYSIS');
  console.log('==============================');

  const benchmarkNames = [
    'Cameron Boozer', 'Yaxel Lendeborg', 'Joshua Jefferson', 'Isaiah Evans',
    'RJ Godfrey', 'Fletcher Loyer', 'Eric Mahaffey', 'Nate Heise',
    'Jeremy Fears Jr.', 'Bruce Thornton'
  ];

  for (const benchmarkName of benchmarkNames) {
    const player = matchedPlayers.find(p => p.playerName === benchmarkName);
    if (player) {
      console.log(`\n**${benchmarkName}**:`);
      console.log(`  Current:  O=${player.existingRecord.orapm?.toFixed(1)}, D=${player.existingRecord.drapm?.toFixed(1)}, Net=${player.existingRecord.rapm?.toFixed(1)}`);
      console.log(`  λ=300:    O=${player.correctedOrapm.toFixed(1)}, D=${player.correctedDrapm.toFixed(1)}, Net=${player.correctedNet.toFixed(1)}`);
      console.log(`  Change:   O=${(player.correctedOrapm - (player.existingRecord.orapm || 0)).toFixed(1)}, D=${(player.correctedDrapm - (player.existingRecord.drapm || 0)).toFixed(1)}, Net=${(player.correctedNet - (player.existingRecord.rapm || 0)).toFixed(1)}`);
    } else {
      console.log(`\n**${benchmarkName}**: Not found in matched data`);
    }
  }

  // 9. Sign convention validation
  console.log('\n9. SIGN CONVENTION VALIDATION');
  console.log('==============================');

  const eliteDefenders = ['Cameron Boozer', 'Isaiah Evans', 'RJ Godfrey'];
  console.log('Elite defenders should have positive DRAPM:');

  for (const defenderName of eliteDefenders) {
    const player = matchedPlayers.find(p => p.playerName === defenderName);
    if (player) {
      const isPositive = player.correctedDrapm > 0;
      console.log(`  ${defenderName}: ${player.correctedDrapm.toFixed(1)} ${isPositive ? '✅' : '❌'}`);
    }
  }

  // 10. Execute write if requested
  if (isWrite) {
    console.log('\n10. EXECUTING PRODUCTION WRITE');
    console.log('===============================');

    console.log(`⚠️  About to update ${stats.matchingExistingRows} PlayerImpact records`);
    console.log('Starting batch update...');

    let batchSize = 100;
    let batchCount = Math.ceil(matchedPlayers.length / batchSize);

    for (let i = 0; i < batchCount; i++) {
      const batch = matchedPlayers.slice(i * batchSize, (i + 1) * batchSize);

      try {
        for (const player of batch) {
          await prisma.playerImpact.update({
            where: { id: player.existingRecord.id },
            data: {
              orapm: player.correctedOrapm,
              drapm: player.correctedDrapm,
              rapm: player.correctedNet,
              // Preserve other fields, only update RAPM values
            }
          });
          stats.updatedRows++;
        }

        console.log(`  Batch ${i + 1}/${batchCount} complete (${batch.length} records)`);
      } catch (error) {
        console.log(`  ❌ Batch ${i + 1} failed: ${error}`);
        stats.errorRows += batch.length;
      }
    }

    console.log(`\n✅ Update complete:`);
    console.log(`   Successfully updated: ${stats.updatedRows} records`);
    console.log(`   Errors: ${stats.errorRows} records`);
  } else {
    console.log('\n10. DRY-RUN COMPLETE');
    console.log('====================');
    console.log('✅ Dry-run validation passed. No database changes made.');
    console.log('To proceed with import, run with --write flag');
  }

  console.log('\n=== IMPORT SUMMARY ===');
  console.log(`Mode: ${mode}`);
  console.log(`Model rows found: ${stats.modelRowsFound}`);
  console.log(`Matching existing rows: ${stats.matchingExistingRows}`);
  console.log(`Missing PlayerImpact rows: ${stats.missingPlayerImpactRows}`);
  if (isWrite) {
    console.log(`Updated rows: ${stats.updatedRows}`);
    console.log(`Error rows: ${stats.errorRows}`);
  }
  console.log(`Calculation errors: ${calculationErrors.length}`);
  console.log(`Extreme outliers: ${extremeNet.length}`);

  await prisma.$disconnect();
}

importLambda300PlayerImpact().catch(console.error);