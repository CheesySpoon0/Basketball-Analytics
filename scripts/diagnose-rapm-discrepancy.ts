#!/usr/bin/env npx tsx
import 'dotenv/config';
import { prisma } from '../lib/prisma.js';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Diagnose the exact discrepancy between production PlayerImpact and retrained models
 */

async function diagnoseRapmDiscrepancy(): Promise<void> {
  console.log('=== DIAGNOSING RAPM PIPELINE DISCREPANCY ===\n');

  const season = 2026;

  // 1. Compare identical players across all available RAPM files
  const rapmFiles = [
    { name: 'Phase 3 (Production source)', path: 'scripts/python/rapm/output/rapm_phase3.json' },
    { name: 'Phase 3c (New single-sided)', path: 'scripts/python/rapm/output/rapm_phase3c.json' },
    { name: 'Phase 2 (Earlier version)', path: 'scripts/python/rapm/output/rapm_phase2.json' }
  ];

  const datasets: { [key: string]: any } = {};

  for (const file of rapmFiles) {
    try {
      const content = readFileSync(file.path, 'utf-8');
      datasets[file.name] = JSON.parse(content);
      console.log(`✅ Loaded ${file.name}:`);
      console.log(`   Players: ${datasets[file.name].players.length}`);
      console.log(`   Lambda: ${datasets[file.name].lambda}`);
      console.log(`   Phase: ${datasets[file.name].phase}`);
      console.log(`   Model: ${datasets[file.name].model || 'unknown'}`);
      console.log(`   Data source: ${datasets[file.name].data_source || 'unknown'}`);
      console.log(`   DRAPM sign: ${datasets[file.name].drapm_sign || 'unknown'}`);
      console.log(`   Observations: ${datasets[file.name].n_observations || 'unknown'}`);
      console.log();
    } catch (error) {
      console.log(`❌ Failed to load ${file.name}: ${error}`);
      console.log();
    }
  }

  // 2. Get production PlayerImpact data for Cameron Boozer specifically
  const cameronProduction = await prisma.playerImpact.findFirst({
    where: {
      season,
      player: { name: 'Cameron Boozer' }
    },
    include: { player: true }
  });

  console.log('=== CAMERON BOOZER COMPARISON ===');
  if (cameronProduction) {
    console.log(`Production PlayerImpact:`);
    console.log(`  PlayerId: ${cameronProduction.playerId}`);
    console.log(`  ORAPM: ${cameronProduction.orapm}`);
    console.log(`  DRAPM: ${cameronProduction.drapm}`);
    console.log(`  Net RAPM: ${cameronProduction.rapm}`);
    console.log();

    // Find Cameron in each dataset
    for (const [datasetName, data] of Object.entries(datasets)) {
      const cameron = data.players.find((p: any) => p.playerId === cameronProduction.playerId);

      if (cameron) {
        console.log(`${datasetName}:`);
        console.log(`  PlayerId: ${cameron.playerId}`);
        console.log(`  ORAPM: ${cameron.orapm_actual || cameron.orapm}`);
        console.log(`  DRAPM: ${cameron.drapm_actual || cameron.drapm}`);
        console.log(`  Net RAPM: ${cameron.rapm_actual || cameron.rapm}`);

        const prodDrapm = cameronProduction.drapm || 0;
        const dataDrapm = cameron.drapm_actual || cameron.drapm;
        const drapmDiff = prodDrapm - dataDrapm;
        const drapmCorr = prodDrapm * dataDrapm > 0 ? 'same sign' : 'opposite sign';

        console.log(`  DRAPM vs Production: ${drapmDiff.toFixed(3)} difference (${drapmCorr})`);
        console.log();
      } else {
        console.log(`${datasetName}: Cameron Boozer not found`);
        console.log();
      }
    }
  } else {
    console.log('❌ Cameron Boozer not found in production PlayerImpact');
  }

  // 3. Check the actual data source differences
  console.log('=== DATA SOURCE ANALYSIS ===');

  for (const [datasetName, data] of Object.entries(datasets)) {
    console.log(`${datasetName}:`);
    console.log(`  Observations: ${data.n_observations}`);
    console.log(`  Players: ${data.n_players}`);
    console.log(`  Model type: ${data.model}`);
    console.log(`  Data source: ${data.data_source}`);

    if (data.intercept_actual) {
      console.log(`  Intercept: ${data.intercept_actual.toFixed(3)}`);
    }

    if (data.drapm_sign) {
      console.log(`  DRAPM convention: ${data.drapm_sign}`);
    }
    console.log();
  }

  // 4. Check if the production data might be from a different source
  console.log('=== PRODUCTION SOURCE HYPOTHESIS ===');

  // Check if production DRAPM is simply the negative of any dataset
  if (cameronProduction) {
    const prodDrapm = cameronProduction.drapm || 0;

    for (const [datasetName, data] of Object.entries(datasets)) {
      const cameron = data.players.find((p: any) => p.playerId === cameronProduction.playerId);

      if (cameron) {
        const dataDrapm = cameron.drapm_actual || cameron.drapm;
        const isNegated = Math.abs(prodDrapm + dataDrapm) < 0.1;
        const isIdentical = Math.abs(prodDrapm - dataDrapm) < 0.1;

        console.log(`Production vs ${datasetName}:`);
        console.log(`  Is negated: ${isNegated} (prod=${prodDrapm.toFixed(1)}, data=${dataDrapm.toFixed(1)})`);
        console.log(`  Is identical: ${isIdentical}`);

        if (isNegated) {
          console.log(`  🔍 HYPOTHESIS: Production PlayerImpact used negative of ${datasetName} DRAPM`);
        }
        if (isIdentical) {
          console.log(`  🔍 HYPOTHESIS: Production PlayerImpact directly matches ${datasetName}`);
        }
        console.log();
      }
    }
  }

  // 5. Check the timestamp/creation pattern
  console.log('=== TIMELINE ANALYSIS ===');

  // Get the first and last production PlayerImpact records to understand import timing
  const firstPlayer = await prisma.playerImpact.findFirst({
    where: { season },
    orderBy: { id: 'asc' },
    include: { player: true }
  });

  const lastPlayer = await prisma.playerImpact.findFirst({
    where: { season },
    orderBy: { id: 'desc' },
    include: { player: true }
  });

  console.log(`Production PlayerImpact range:`);
  console.log(`  First record: ID ${firstPlayer?.id}, Player ${firstPlayer?.player?.name}`);
  console.log(`  Last record: ID ${lastPlayer?.id}, Player ${lastPlayer?.player?.name}`);
  console.log();

  await prisma.$disconnect();
}

diagnoseRapmDiscrepancy().catch(console.error);