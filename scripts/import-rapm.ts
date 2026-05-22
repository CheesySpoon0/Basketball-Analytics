#!/usr/bin/env npx tsx
/**
 * Import RAPM data from Phase 3C and Phase 3D JSON outputs into PlayerImpact table.
 *
 * Data sources:
 * - ORAPM and Net RAPM from rapm_phase3c.json (single-sided data)
 * - DRAPM from rapm_phase3d_defense_only.json (Model B - defenders + controls)
 *
 * Confidence levels based on possessions:
 * - high: 400+ possessions
 * - moderate: 200-399 possessions
 * - low: <200 possessions
 */

import 'dotenv/config';
import { readFile } from "fs/promises";
import { join } from "path";
import { PrismaClient } from '../app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Create direct Prisma connection like working scripts
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const SEASON = 2026;
const BATCH_SIZE = 100;

// File paths
const PHASE3C_FILE = join(process.cwd(), "scripts/python/rapm/output/rapm_phase3c.json");
const PHASE3D_FILE = join(process.cwd(), "scripts/python/rapm/output/rapm_phase3d_defense_only.json");

interface Phase3CPlayer {
  playerId: number;
  off_poss_used: number;
  def_poss_used: number;
  orapm_actual: number;
  orapm_xefg: number;  // Expected ORAPM
  drapm_actual: number;
  drapm_xefg: number;  // Expected DRAPM
  rapm_actual: number;
  rapm_xefg: number;   // Expected Net RAPM
}

interface Phase3DPlayer {
  playerId: number;
  drapm_model_b_actual: number;
  drapm_model_b_expected: number;
}

function calculateConfidence(possessions: number, minutes: number | null): string {
  // Priority: use possessions if available, otherwise use minutes
  if (possessions >= 1000 || (minutes && minutes >= 500)) return "high";
  if (possessions >= 400 || (minutes && minutes >= 200)) return "moderate";
  return "low";
}

async function loadPhase3CData(): Promise<Map<number, Phase3CPlayer>> {
  try {
    console.log("📁 Loading Phase 3C data (ORAPM + Net RAPM)...");
    const data = JSON.parse(await readFile(PHASE3C_FILE, "utf-8"));

    const playerMap = new Map<number, Phase3CPlayer>();
    for (const player of data.players) {
      playerMap.set(player.playerId, player);
    }

    console.log(`   ✅ Loaded ${playerMap.size.toLocaleString()} players from Phase 3C`);
    return playerMap;
  } catch (error) {
    console.error(`❌ Failed to load Phase 3C data: ${error}`);
    throw error;
  }
}

async function loadPhase3DData(): Promise<Map<number, Phase3DPlayer>> {
  try {
    console.log("📁 Loading Phase 3D data (DRAPM Model B)...");
    const data = JSON.parse(await readFile(PHASE3D_FILE, "utf-8"));

    const playerMap = new Map<number, Phase3DPlayer>();
    for (const player of data.players) {
      if (player.drapm_model_b_actual !== undefined) {
        playerMap.set(player.playerId, player);
      }
    }

    console.log(`   ✅ Loaded ${playerMap.size.toLocaleString()} players from Phase 3D`);
    return playerMap;
  } catch (error) {
    console.error(`❌ Failed to load Phase 3D data: ${error}`);
    throw error;
  }
}

async function loadPlayerSeasonData(): Promise<Map<number, { teamId: number | null; minutes: number | null }>> {
  console.log("📁 Loading player season data (teams + minutes)...");

  // Test connection first
  try {
    const testCount = await prisma.player.count();
    console.log(`   ✅ Database connection test: ${testCount.toLocaleString()} players in database`);
  } catch (error) {
    console.error(`   ❌ Database connection test failed:`, error);
    throw error;
  }

  const players = await prisma.playerSeasonStats.findMany({
    where: { season: SEASON },
    select: {
      playerId: true,
      teamId: true,
      minutes: true
    }
  });

  const playerMap = new Map();
  for (const player of players) {
    playerMap.set(player.playerId, {
      teamId: player.teamId,
      minutes: player.minutes
    });
  }

  console.log(`   ✅ Loaded season data for ${playerMap.size.toLocaleString()} players`);
  return playerMap;
}

async function importRAPMData() {
  console.log("=".repeat(70));
  console.log("IMPORTING RAPM DATA TO PlayerImpact TABLE");
  console.log("=".repeat(70));

  // Load all data sources
  const [phase3cData, phase3dData, seasonData] = await Promise.all([
    loadPhase3CData(),
    loadPhase3DData(),
    loadPlayerSeasonData()
  ]);

  // Get all unique player IDs across both phases
  const allPlayerIds = new Set([...phase3cData.keys(), ...phase3dData.keys()]);
  console.log(`\n🔍 Processing ${allPlayerIds.size.toLocaleString()} unique players...`);

  // Build player impact records
  const playerImpacts = [];
  let hasORAMP = 0, hasDRAMP = 0, hasBoth = 0;

  for (const playerId of allPlayerIds) {
    const phase3c = phase3cData.get(playerId);
    const phase3d = phase3dData.get(playerId);
    const season = seasonData.get(playerId) || { teamId: null, minutes: null };

    // Skip players with no RAPM data
    if (!phase3c && !phase3d) continue;

    // Calculate total possessions (offensive + defensive from Phase 3C)
    const totalPossessions = phase3c ? (phase3c.off_poss_used + phase3c.def_poss_used) : 0;
    const confidence = calculateConfidence(totalPossessions, season.minutes);

    const record = {
      season: SEASON,
      playerId,
      teamId: season.teamId,

      // ORAPM from Phase 3C
      orapm: phase3c?.orapm_actual || null,
      orapmExpected: phase3c?.orapm_xefg || null,

      // DRAPM from Phase 3D Model B
      drapm: phase3d?.drapm_model_b_actual || null,
      drapmExpected: phase3d?.drapm_model_b_expected || null,

      // Net RAPM from Phase 3C
      rapm: phase3c?.rapm_actual || null,
      rapmExpected: phase3c?.rapm_xefg || null,

      confidence,
      possessions: Math.round(totalPossessions),
      minutes: season.minutes,
      modelVersion: 1
    };

    // Count coverage
    if (record.orapm !== null) hasORAMP++;
    if (record.drapm !== null) hasDRAMP++;
    if (record.orapm !== null && record.drapm !== null) hasBoth++;

    playerImpacts.push(record);
  }

  console.log(`\n📊 RAPM Coverage Summary:`);
  console.log(`   Players with ORAPM: ${hasORAMP.toLocaleString()}`);
  console.log(`   Players with DRAPM: ${hasDRAMP.toLocaleString()}`);
  console.log(`   Players with both: ${hasBoth.toLocaleString()}`);
  console.log(`   Total records: ${playerImpacts.length.toLocaleString()}`);

  // Clear existing data for this season
  console.log(`\n🗑️  Clearing existing PlayerImpact data for season ${SEASON}...`);
  const deleted = await prisma.playerImpact.deleteMany({
    where: { season: SEASON }
  });
  console.log(`   Deleted ${deleted.count} existing records`);

  // Insert in batches
  console.log(`\n💾 Inserting ${playerImpacts.length.toLocaleString()} PlayerImpact records...`);

  for (let i = 0; i < playerImpacts.length; i += BATCH_SIZE) {
    const batch = playerImpacts.slice(i, i + BATCH_SIZE);
    await prisma.playerImpact.createMany({
      data: batch,
      skipDuplicates: true
    });

    const progress = Math.min(i + BATCH_SIZE, playerImpacts.length);
    console.log(`   Progress: ${progress.toLocaleString()}/${playerImpacts.length.toLocaleString()} (${((progress/playerImpacts.length)*100).toFixed(1)}%)`);
  }

  console.log(`\n✅ Successfully imported ${playerImpacts.length.toLocaleString()} PlayerImpact records`);

  // Validation summary
  console.log(`\n🔍 Validation Summary:`);

  const counts = await prisma.playerImpact.groupBy({
    by: ['confidence'],
    where: { season: SEASON },
    _count: { id: true }
  });

  for (const { confidence, _count } of counts) {
    console.log(`   ${confidence}: ${_count.id.toLocaleString()} players`);
  }

  // Top ORAPM/DRAPM preview
  const topORAMP = await prisma.playerImpact.findMany({
    where: {
      season: SEASON,
      orapm: { not: null }
    },
    include: {
      player: { select: { name: true } }
    },
    orderBy: { orapm: 'desc' },
    take: 5
  });

  const topDRAMP = await prisma.playerImpact.findMany({
    where: {
      season: SEASON,
      drapm: { not: null }
    },
    include: {
      player: { select: { name: true } }
    },
    orderBy: { drapm: 'desc' },
    take: 5
  });

  console.log(`\n🏆 Top 5 ORAPM leaders:`);
  for (const player of topORAMP) {
    console.log(`   ${player.player.name || `Player ${player.playerId}`}: ${player.orapm?.toFixed(2)} ORAPM`);
  }

  console.log(`\n🛡️  Top 5 DRAPM leaders:`);
  for (const player of topDRAMP) {
    console.log(`   ${player.player.name || `Player ${player.playerId}`}: ${player.drapm?.toFixed(2)} DRAPM`);
  }
}

async function main() {
  try {
    await importRAPMData();
    console.log(`\n🎉 RAPM import completed successfully!`);
  } catch (error) {
    console.error(`\n❌ Import failed:`, error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}