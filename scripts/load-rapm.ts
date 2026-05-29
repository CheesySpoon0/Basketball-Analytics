import 'dotenv/config'; // Load environment variables first
import { prisma } from '../lib/prisma';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Command } from 'commander';

/**
 * Load RAPM results from JSON output files into the database.
 *
 * Expected JSON structure:
 * {
 *   "season": 2026,
 *   "target": "actual" | "xefg",
 *   "lambda": 2500,
 *   "players": [
 *     {
 *       "playerId": 1234,
 *       "orapm": 2.14,
 *       "drapm": -1.07,
 *       "rapm": 1.07,
 *       "offPossUsed": 1840,
 *       "defPossUsed": 1790,
 *       "priorOrapm": 1.5,
 *       "priorDrapm": -0.8
 *     }
 *   ]
 * }
 */

interface RapmResult {
  season: number;
  target: string;
  lambda: number;
  n_stints?: number;
  r_squared?: number;
  intercept?: number;
  home_advantage?: number;
  modelVersion?: number;
  players: Array<{
    playerId: number;
    orapm: number;
    drapm: number;
    rapm: number;
    offPossUsed: number;
    defPossUsed: number;
    priorOrapm?: number;
    priorDrapm?: number;
  }>;
}

async function loadRampResults(filePaths: string[], dryRun: boolean) {
  console.log('📊 Loading RAPM results into database...\n');

  const allResults: RapmResult[] = [];

  // Load and validate JSON files
  for (const filePath of filePaths) {
    try {
      console.log(`📁 Reading ${filePath}...`);
      const jsonContent = readFileSync(filePath, 'utf-8');
      const result: RapmResult = JSON.parse(jsonContent);

      // Basic validation
      if (!result.season || !result.target || !result.players) {
        throw new Error(`Invalid JSON structure in ${filePath}`);
      }

      if (!['actual', 'xefg'].includes(result.target)) {
        throw new Error(`Invalid target '${result.target}' in ${filePath}`);
      }

      console.log(`✅ Loaded ${result.players.length} players for ${result.target} target`);
      allResults.push(result);

    } catch (error) {
      console.error(`❌ Error loading ${filePath}:`, error);
      throw error;
    }
  }

  if (allResults.length === 0) {
    console.log('❌ No valid RAPM files found');
    return;
  }

  // Process each result file
  for (const result of allResults) {
    await processRapmResult(result, dryRun);
  }

  console.log('\n✅ RAPM loading complete');
}

async function processRapmResult(result: RapmResult, dryRun: boolean) {
  console.log(`\n🎯 Processing ${result.target} RAPM for season ${result.season}`);
  console.log(`   λ=${result.lambda}, ${result.players.length} players`);

  if (dryRun) {
    console.log('🏃 DRY RUN MODE - no database writes\n');
    return;
  }

  // Get existing player IDs to validate
  const playerIds = result.players.map(p => p.playerId);
  const existingPlayers = await prisma.player.findMany({
    where: { id: { in: playerIds } },
    select: { id: true }
  });

  const existingPlayerIds = new Set(existingPlayers.map(p => p.id));
  const validPlayers = result.players.filter(p => existingPlayerIds.has(p.playerId));
  const invalidPlayers = result.players.filter(p => !existingPlayerIds.has(p.playerId));

  if (invalidPlayers.length > 0) {
    console.log(`⚠️  Skipping ${invalidPlayers.length} players with invalid IDs:`,
      invalidPlayers.slice(0, 10).map(p => p.playerId));
  }

  console.log(`💾 Upserting ${validPlayers.length} valid RAPM records...`);

  // Batch upsert in chunks of 50
  const batchSize = 50;
  let processed = 0;

  for (let i = 0; i < validPlayers.length; i += batchSize) {
    const batch = validPlayers.slice(i, i + batchSize);

    try {
      await Promise.all(
        batch.map(player =>
          prisma.playerRapm.upsert({
            where: {
              playerId_season_target: {
                playerId: player.playerId,
                season: result.season,
                target: result.target
              }
            },
            update: {
              orapm: player.orapm,
              drapm: player.drapm,
              rapm: player.rapm,
              offPossUsed: player.offPossUsed,
              defPossUsed: player.defPossUsed,
              lambda: result.lambda,
              priorOrapm: player.priorOrapm ?? null,
              priorDrapm: player.priorDrapm ?? null,
              modelVersion: result.modelVersion ?? 1,
              updatedAt: new Date()
            },
            create: {
              playerId: player.playerId,
              season: result.season,
              target: result.target,
              orapm: player.orapm,
              drapm: player.drapm,
              rapm: player.rapm,
              offPossUsed: player.offPossUsed,
              defPossUsed: player.defPossUsed,
              lambda: result.lambda,
              priorOrapm: player.priorOrapm ?? null,
              priorDrapm: player.priorDrapm ?? null,
              modelVersion: result.modelVersion ?? 1
            }
          })
        )
      );

      processed += batch.length;
      console.log(`   📊 Processed ${processed}/${validPlayers.length} records`);

    } catch (error) {
      console.error(`❌ Error processing batch starting at index ${i}:`, error);
      throw error;
    }
  }

  console.log(`✅ Successfully loaded ${processed} ${result.target} RAPM records`);

  // Show summary statistics
  const stats = {
    mean_orapm: validPlayers.reduce((sum, p) => sum + p.orapm, 0) / validPlayers.length,
    mean_drapm: validPlayers.reduce((sum, p) => sum + p.drapm, 0) / validPlayers.length,
    mean_rapm: validPlayers.reduce((sum, p) => sum + p.ramp, 0) / validPlayers.length,
    max_rapm: Math.max(...validPlayers.map(p => p.rapm)),
    min_rapm: Math.min(...validPlayers.map(p => p.rapm)),
    total_off_poss: validPlayers.reduce((sum, p) => sum + p.offPossUsed, 0),
    total_def_poss: validPlayers.reduce((sum, p) => sum + p.defPossUsed, 0)
  };

  console.log(`📊 Summary for ${result.target}:`);
  console.log(`   Mean ORAPM: ${stats.mean_orapm.toFixed(2)}`);
  console.log(`   Mean DRAPM: ${stats.mean_drapm.toFixed(2)}`);
  console.log(`   Mean RAPM: ${stats.mean_rapm.toFixed(2)}`);
  console.log(`   RAPM range: ${stats.min_rapm.toFixed(1)} to ${stats.max_rapm.toFixed(1)}`);
  console.log(`   Total poss: ${stats.total_off_poss.toLocaleString()}O / ${stats.total_def_poss.toLocaleString()}D`);
}

async function showExistingData(season: number) {
  console.log(`📊 Existing RAPM data for season ${season}:\n`);

  const existingCounts = await prisma.playerRapm.groupBy({
    by: ['target'],
    where: { season },
    _count: { target: true }
  });

  if (existingCounts.length === 0) {
    console.log('   No existing RAPM data found');
  } else {
    existingCounts.forEach(({ target, _count }) => {
      console.log(`   ${target}: ${_count.target} players`);
    });
  }

  console.log('');
}

async function main() {
  const program = new Command();

  program
    .option('--season <number>', 'Season (for validation)', '2026')
    .option('--actual <path>', 'Path to actual RAPM JSON file')
    .option('--xefg <path>', 'Path to xeFG RAPM JSON file')
    .option('--dir <path>', 'Directory containing RAPM JSON files (auto-detect)', 'scripts/python/rapm/output')
    .option('--dry-run', 'Preview changes without writing to database')
    .option('--show-existing', 'Show existing RAPM data counts and exit');

  program.parse();
  const options = program.opts();

  const season = parseInt(options.season);

  if (options.showExisting) {
    await showExistingData(season);
    await prisma.$disconnect();
    return;
  }

  const dryRun = options.dryRun;

  // Determine file paths
  let filePaths: string[] = [];

  if (options.actual) {
    filePaths.push(options.actual);
  }

  if (options.xefg) {
    filePaths.push(options.xefg);
  }

  // If no specific files provided, auto-detect from directory
  if (filePaths.length === 0 && options.dir) {
    const actualPath = join(options.dir, 'rapm_actual.json');
    const xefgPath = join(options.dir, 'rapm_xefg.json');

    try {
      readFileSync(actualPath);
      filePaths.push(actualPath);
      console.log(`📁 Found actual RAPM: ${actualPath}`);
    } catch {
      console.log(`⚠️  Actual RAPM not found: ${actualPath}`);
    }

    try {
      readFileSync(xefgPath);
      filePaths.push(xefgPath);
      console.log(`📁 Found xeFG RAPM: ${xefgPath}`);
    } catch {
      console.log(`⚠️  xeFG RAPM not found: ${xefgPath}`);
    }
  }

  if (filePaths.length === 0) {
    console.log('❌ No RAPM JSON files found. Options:');
    console.log('   --actual <path>  : Load specific actual RAPM file');
    console.log('   --xefg <path>    : Load specific xeFG RAPM file');
    console.log('   --dir <path>     : Auto-detect from directory');
    process.exit(1);
  }

  await showExistingData(season);

  try {
    await loadRampResults(filePaths, dryRun);
  } catch (error) {
    console.error('❌ RAPM loading failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }

  console.log('\n📋 Next steps:');
  console.log('1. Validate results: npx tsx scripts/validate-rapm.ts');
  console.log('2. Check specific teams/players for sanity');
}

main().catch(console.error);