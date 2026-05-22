#!/usr/bin/env npx tsx
/**
 * Validate RAPM import results for Phase 4.
 * Check specific teams (UCI, UCSD, UCSB, Auburn) and overall data quality.
 */

import 'dotenv/config';
import { PrismaClient } from '../app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Create direct Prisma connection
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const SEASON = 2026;

// Target teams for validation
const TARGET_TEAMS = {
  'UC Irvine': 308,
  'UC San Diego': 310,
  'UC Santa Barbara': 311,
  'Auburn': 16
};

async function validateOverallStats() {
  console.log("📊 Overall RAPM Import Validation");
  console.log("=".repeat(50));

  const totalPlayers = await prisma.playerImpact.count({
    where: { season: SEASON }
  });

  const withORAMP = await prisma.playerImpact.count({
    where: { season: SEASON, orapm: { not: null } }
  });

  const withDRAMP = await prisma.playerImpact.count({
    where: { season: SEASON, drapm: { not: null } }
  });

  const withBoth = await prisma.playerImpact.count({
    where: {
      season: SEASON,
      orapm: { not: null },
      drapm: { not: null }
    }
  });

  const confidenceBreakdown = await prisma.playerImpact.groupBy({
    by: ['confidence'],
    where: { season: SEASON },
    _count: { id: true }
  });

  console.log(`Total PlayerImpact records: ${totalPlayers.toLocaleString()}`);
  console.log(`Players with ORAPM: ${withORAMP.toLocaleString()} (${((withORAMP/totalPlayers)*100).toFixed(1)}%)`);
  console.log(`Players with DRAPM: ${withDRAMP.toLocaleString()} (${((withDRAMP/totalPlayers)*100).toFixed(1)}%)`);
  console.log(`Players with both: ${withBoth.toLocaleString()} (${((withBoth/totalPlayers)*100).toFixed(1)}%)`);

  console.log(`\nConfidence levels:`);
  for (const { confidence, _count } of confidenceBreakdown) {
    console.log(`  ${confidence || 'null'}: ${_count.id.toLocaleString()} players`);
  }

  // Check for extreme outliers
  const extremeORAMP = await prisma.playerImpact.findMany({
    where: {
      season: SEASON,
      orapm: { not: null },
      OR: [
        { orapm: { gt: 25 } },
        { orapm: { lt: -25 } }
      ]
    },
    include: {
      player: { select: { name: true } }
    }
  });

  const extremeDRAMP = await prisma.playerImpact.findMany({
    where: {
      season: SEASON,
      drapm: { not: null },
      OR: [
        { drapm: { gt: 25 } },
        { drapm: { lt: -25 } }
      ]
    },
    include: {
      player: { select: { name: true } }
    }
  });

  if (extremeORAMP.length > 0) {
    console.log(`\n⚠️ Extreme ORAPM outliers (>±25): ${extremeORAMP.length}`);
    for (const player of extremeORAMP.slice(0, 5)) {
      console.log(`  ${player.player.name || `Player ${player.playerId}`}: ${player.orapm?.toFixed(2)} ORAPM`);
    }
  }

  if (extremeDRAMP.length > 0) {
    console.log(`\n⚠️ Extreme DRAPM outliers (>±25): ${extremeDRAMP.length}`);
    for (const player of extremeDRAMP.slice(0, 5)) {
      console.log(`  ${player.player.name || `Player ${player.playerId}`}: ${player.drapm?.toFixed(2)} DRAPM`);
    }
  }

  return { totalPlayers, withORAMP, withDRAMP, withBoth };
}

async function validateTargetTeams() {
  console.log(`\n🏀 Target Team Validation`);
  console.log("=".repeat(50));

  for (const [teamName, teamId] of Object.entries(TARGET_TEAMS)) {
    console.log(`\n${teamName} (ID: ${teamId}):`);

    // Get team players with RAPM data
    const teamPlayers = await prisma.playerImpact.findMany({
      where: {
        season: SEASON,
        teamId: teamId
      },
      include: {
        player: {
          select: {
            name: true,
            seasonStats: {
              where: { season: SEASON },
              select: { minutes: true }
            }
          }
        }
      },
      orderBy: { rapm: 'desc' }
    });

    if (teamPlayers.length === 0) {
      console.log(`  ❌ No RAPM data found for ${teamName}`);
      continue;
    }

    console.log(`  ✅ Found ${teamPlayers.length} players with RAPM data`);

    const withORAMP = teamPlayers.filter(p => p.orapm !== null).length;
    const withDRAMP = teamPlayers.filter(p => p.drapm !== null).length;
    const withBoth = teamPlayers.filter(p => p.orapm !== null && p.drapm !== null).length;

    console.log(`     ORAPM coverage: ${withORAMP}/${teamPlayers.length} players`);
    console.log(`     DRAPM coverage: ${withDRAMP}/${teamPlayers.length} players`);
    console.log(`     Complete data: ${withBoth}/${teamPlayers.length} players`);

    // Top 3 players by Net RAPM
    const topPlayers = teamPlayers.filter(p => p.rapm !== null).slice(0, 3);
    console.log(`\n  Top 3 players by Net RAPM:`);
    for (const player of topPlayers) {
      const name = player.player.name || `Player ${player.playerId}`;
      const minutes = player.player.seasonStats[0]?.minutes || 0;
      console.log(`    ${name}: ${player.rapm?.toFixed(2)} Net (+${player.orapm?.toFixed(2)} O / +${player.drapm?.toFixed(2)} D) [${minutes} min]`);
    }
  }
}

async function validateCorrelations() {
  console.log(`\n🔗 RAPM Correlation Validation`);
  console.log("=".repeat(50));

  // Get players with both actual and expected values
  const playersWithBoth = await prisma.playerImpact.findMany({
    where: {
      season: SEASON,
      orapm: { not: null },
      orapmExpected: { not: null },
      drapm: { not: null },
      drapmExpected: { not: null }
    }
  });

  console.log(`Players with complete actual/expected data: ${playersWithBoth.length.toLocaleString()}`);

  if (playersWithBoth.length >= 100) {
    // Calculate correlations
    const oValues = playersWithBoth.map(p => p.orapm!);
    const oExpected = playersWithBoth.map(p => p.orapmExpected!);
    const dValues = playersWithBoth.map(p => p.drapm!);
    const dExpected = playersWithBoth.map(p => p.drapmExpected!);

    const oCorr = calculateCorrelation(oValues, oExpected);
    const dCorr = calculateCorrelation(dValues, dExpected);

    console.log(`ORAPM actual vs expected correlation: ${oCorr.toFixed(3)} ${oCorr >= 0.7 ? '✅' : oCorr >= 0.5 ? '⚠️' : '❌'}`);
    console.log(`DRAPM actual vs expected correlation: ${dCorr.toFixed(3)} ${dCorr >= 0.7 ? '✅' : dCorr >= 0.5 ? '⚠️' : '❌'}`);

    // Distribution stats
    const oMean = oValues.reduce((a, b) => a + b, 0) / oValues.length;
    const oStd = Math.sqrt(oValues.map(x => (x - oMean) ** 2).reduce((a, b) => a + b, 0) / oValues.length);
    const dMean = dValues.reduce((a, b) => a + b, 0) / dValues.length;
    const dStd = Math.sqrt(dValues.map(x => (x - dMean) ** 2).reduce((a, b) => a + b, 0) / dValues.length);

    console.log(`\nDistribution summary:`);
    console.log(`  ORAPM: mean=${oMean.toFixed(3)}, std=${oStd.toFixed(3)}, range=[${Math.min(...oValues).toFixed(2)}, ${Math.max(...oValues).toFixed(2)}]`);
    console.log(`  DRAPM: mean=${dMean.toFixed(3)}, std=${dStd.toFixed(3)}, range=[${Math.min(...dValues).toFixed(2)}, ${Math.max(...dValues).toFixed(2)}]`);
  }
}

async function showTopPerformers() {
  console.log(`\n🏆 Top RAPM Performers`);
  console.log("=".repeat(50));

  // Top 10 Net RAPM
  const topNet = await prisma.playerImpact.findMany({
    where: {
      season: SEASON,
      rapm: { not: null }
    },
    include: {
      player: {
        select: {
          name: true,
          seasonStats: {
            where: { season: SEASON },
            select: { teamId: true }
          }
        }
      }
    },
    orderBy: { rapm: 'desc' },
    take: 10
  });

  // Top 10 ORAPM
  const topOff = await prisma.playerImpact.findMany({
    where: {
      season: SEASON,
      orapm: { not: null }
    },
    include: {
      player: {
        select: {
          name: true,
          seasonStats: {
            where: { season: SEASON },
            select: { teamId: true }
          }
        }
      }
    },
    orderBy: { orapm: 'desc' },
    take: 5
  });

  // Top 10 DRAPM
  const topDef = await prisma.playerImpact.findMany({
    where: {
      season: SEASON,
      drapm: { not: null }
    },
    include: {
      player: {
        select: {
          name: true,
          seasonStats: {
            where: { season: SEASON },
            select: { teamId: true }
          }
        }
      }
    },
    orderBy: { drapm: 'desc' },
    take: 5
  });

  console.log(`Top 10 Net RAPM:`);
  for (let i = 0; i < topNet.length; i++) {
    const player = topNet[i];
    const name = player.player.name || `Player ${player.playerId}`;
    console.log(`  ${(i+1).toString().padStart(2)}: ${name} - ${player.rapm?.toFixed(2)} Net (+${player.orapm?.toFixed(2)} O / +${player.drapm?.toFixed(2)} D)`);
  }

  console.log(`\nTop 5 ORAPM (Offensive Impact):`);
  for (let i = 0; i < topOff.length; i++) {
    const player = topOff[i];
    const name = player.player.name || `Player ${player.playerId}`;
    console.log(`  ${(i+1)}: ${name} - ${player.orapm?.toFixed(2)} ORAPM`);
  }

  console.log(`\nTop 5 DRAPM (Defensive Impact):`);
  for (let i = 0; i < topDef.length; i++) {
    const player = topDef[i];
    const name = player.player.name || `Player ${player.playerId}`;
    console.log(`  ${(i+1)}: ${name} - ${player.drapm?.toFixed(2)} DRAPM`);
  }
}

function calculateCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < n; i++) {
    const diffX = x[i] - meanX;
    const diffY = y[i] - meanY;
    numerator += diffX * diffY;
    denomX += diffX * diffX;
    denomY += diffY * diffY;
  }

  return numerator / Math.sqrt(denomX * denomY);
}

async function main() {
  console.log("🔍 RAPM Import Validation for Phase 4");
  console.log("=".repeat(70));

  try {
    await validateOverallStats();
    await validateTargetTeams();
    await validateCorrelations();
    await showTopPerformers();

    console.log(`\n✅ RAPM validation completed successfully!`);
    console.log(`📋 Next step: Add RAPM to player reports and build lineup optimizer`);

  } catch (error) {
    console.error(`❌ Validation failed:`, error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}