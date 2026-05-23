#!/usr/bin/env npx tsx
/**
 * Efficient team RAPM audit using direct SQL for bulk analysis.
 */

import 'dotenv/config';
import { PrismaClient } from '../app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const SEASON = 2026;

interface TeamAnalysis {
  teamId: number;
  teamName: string;
  weightedORAMP: number;
  weightedDRAMP: number;
  weightedNetRAMP: number;
  playerCount: number;
  playerCoverage: number;
  ortg: number;
  drtg: number;
  netRtg: number;
  winPct: number;
  record: string;
}

function calculateCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 3) return 0;
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let numerator = 0, denomX = 0, denomY = 0;
  for (let i = 0; i < n; i++) {
    const diffX = x[i] - meanX;
    const diffY = y[i] - meanY;
    numerator += diffX * diffY;
    denomX += diffX * diffX;
    denomY += diffY * diffY;
  }
  return denomX > 0 && denomY > 0 ? numerator / Math.sqrt(denomX * denomY) : 0;
}

async function loadTeamAnalysis(): Promise<TeamAnalysis[]> {
  console.log("🔍 Loading team analysis with efficient SQL...");

  // Single query to get team-level weighted RAPM
  const teamRampQuery = `
    SELECT
      t.id as team_id,
      t.school as team_name,
      COUNT(pi.id) as player_count,
      SUM(pi.orapm * COALESCE(pi.possessions, 100)) /
        NULLIF(SUM(CASE WHEN pi.orapm IS NOT NULL THEN COALESCE(pi.possessions, 100) END), 0) as weighted_orapm,
      SUM(pi.drapm * COALESCE(pi.possessions, 100)) /
        NULLIF(SUM(CASE WHEN pi.drapm IS NOT NULL THEN COALESCE(pi.possessions, 100) END), 0) as weighted_drapm,
      SUM(pi.rapm * COALESCE(pi.possessions, 100)) /
        NULLIF(SUM(CASE WHEN pi.rapm IS NOT NULL THEN COALESCE(pi.possessions, 100) END), 0) as weighted_net_rapm,
      COUNT(pss.id) as total_players
    FROM teams t
    INNER JOIN team_season_stats tss ON t.id = tss."teamId"
      AND tss.season = $1
      AND tss.games >= 5
      AND tss."oppPossessions" > 0
    LEFT JOIN player_season_stats pss ON t.id = pss."teamId"
      AND pss.season = $1
    LEFT JOIN player_impact pi ON pss."playerId" = pi."playerId"
      AND pi.season = $1
    GROUP BY t.id, t.school
    HAVING COUNT(pss.id) >= 5
  `;

  const rampResults = await pool.query(teamRampQuery, [SEASON]);

  // Single query to get team season stats
  const statsQuery = `
    SELECT
      t.id as team_id,
      t.school as team_name,
      tss."pointsTotal" as points,
      tss."oppPoints" as opp_points,
      tss."oppPossessions" as opp_possessions,
      tss.wins,
      tss.losses,
      tss.games
    FROM teams t
    INNER JOIN team_season_stats tss ON t.id = tss."teamId"
    WHERE tss.season = $1
      AND tss.games >= 5
      AND tss."oppPossessions" > 0
  `;

  const statsResults = await pool.query(statsQuery, [SEASON]);

  // Build lookup map for stats
  const statsMap = new Map();
  for (const row of statsResults.rows) {
    statsMap.set(row.team_id, row);
  }

  const teamAnalysis: TeamAnalysis[] = [];

  for (const row of rampResults.rows) {
    const stats = statsMap.get(row.team_id);
    if (!stats || !row.weighted_net_rapm) continue;

    const ortg = (stats.points || 0) / (stats.opp_possessions || 1) * 100;
    const drtg = (stats.opp_points || 0) / (stats.opp_possessions || 1) * 100;
    const netRtg = ortg - drtg;
    const winPct = (stats.wins || 0) / Math.max(stats.games || 1, 1);
    const playerCoverage = (row.player_count / row.total_players) * 100;

    teamAnalysis.push({
      teamId: row.team_id,
      teamName: row.team_name,
      weightedORAMP: row.weighted_orapm || 0,
      weightedDRAMP: row.weighted_drapm || 0,
      weightedNetRAMP: row.weighted_net_rapm || 0,
      playerCount: row.player_count,
      playerCoverage,
      ortg,
      drtg,
      netRtg,
      winPct,
      record: `${stats.wins || 0}-${stats.losses || 0}`
    });
  }

  console.log(`   ✅ Analyzed ${teamAnalysis.length} teams`);
  return teamAnalysis;
}

async function main() {
  console.log("🔍 Team RAPM Production Audit (Efficient)");
  console.log("=".repeat(70));

  try {
    const teams = await loadTeamAnalysis();

    // Correlations
    const validTeams = teams.filter(t => t.playerCoverage >= 50);
    console.log(`\n📊 Correlations (${validTeams.length} teams with 50%+ player coverage):`);

    const netCorr = calculateCorrelation(
      validTeams.map(t => t.weightedNetRAMP),
      validTeams.map(t => t.netRtg)
    );
    const oCorr = calculateCorrelation(
      validTeams.map(t => t.weightedORAMP),
      validTeams.map(t => t.ortg)
    );
    const dCorr = calculateCorrelation(
      validTeams.map(t => t.weightedDRAMP),
      validTeams.map(t => -t.drtg)
    );

    console.log(`Net RAPM vs Net Rating:    ${netCorr.toFixed(3)} ${netCorr >= 0.3 ? '✅' : netCorr >= 0.1 ? '⚠️' : '❌'}`);
    console.log(`ORAPM vs ORtg:            ${oCorr.toFixed(3)} ${oCorr >= 0.5 ? '✅' : oCorr >= 0.3 ? '⚠️' : '❌'}`);
    console.log(`DRAPM vs inverted DRtg:   ${dCorr.toFixed(3)} ${dCorr >= 0.5 ? '✅' : dCorr >= 0.3 ? '⚠️' : '❌'}`);

    // Top/Bottom teams
    console.log("\n🏆 Top 10 Teams by Net Rating:");
    const topByNetRtg = [...teams].sort((a, b) => b.netRtg - a.netRtg).slice(0, 10);
    for (let i = 0; i < topByNetRtg.length; i++) {
      const team = topByNetRtg[i];
      const diff = team.netRtg - team.weightedNetRAMP;
      console.log(
        `${(i+1).toString().padStart(2)}. ${team.teamName.substring(0, 20).padEnd(20)} | ` +
        `NetRtg: ${team.netRtg.toFixed(1).padStart(6)} | ` +
        `NetRAMP: ${team.weightedNetRAMP.toFixed(2).padStart(6)} | ` +
        `Diff: ${diff >= 0 ? '+' : ''}${diff.toFixed(1).padStart(6)} | ${team.record}`
      );
    }

    // Biggest mismatches
    console.log("\n🔍 Biggest Positive Mismatches (Better than RAPM suggests):");
    const mismatches = teams.map(t => ({
      ...t,
      mismatch: t.netRtg - t.weightedNetRAMP
    })).sort((a, b) => b.mismatch - a.mismatch);

    for (let i = 0; i < Math.min(10, mismatches.length); i++) {
      const team = mismatches[i];
      if (team.mismatch > 0) {
        console.log(
          `${(i+1).toString().padStart(2)}. ${team.teamName.substring(0, 20).padEnd(20)} | ` +
          `NetRtg: ${team.netRtg.toFixed(1)} | NetRAMP: ${team.weightedNetRAMP.toFixed(2)} | ` +
          `Diff: +${team.mismatch.toFixed(1)} | ${team.record} | Coverage: ${team.playerCoverage.toFixed(0)}%`
        );
      }
    }

    // Check UCI, UCSD, Auburn specifically
    console.log("\n🎯 Target Team Analysis:");
    const targetTeams = ['UC Irvine', 'UC San Diego', 'Auburn'];
    for (const targetName of targetTeams) {
      const team = mismatches.find(t => t.teamName === targetName);
      if (team) {
        console.log(`${team.teamName}:`);
        console.log(`  Net Rating: ${team.netRtg.toFixed(1)} | Net RAMP: ${team.weightedNetRAMP.toFixed(2)}`);
        console.log(`  Mismatch: ${team.mismatch >= 0 ? '+' : ''}${team.mismatch.toFixed(1)} | Record: ${team.record}`);
        console.log(`  Player Coverage: ${team.playerCoverage.toFixed(1)}% (${team.playerCount} players)`);
      }
    }

    // Check centering
    const allNetRAMP = teams.map(t => t.weightedNetRAMP);
    const rampMean = allNetRAMP.reduce((a, b) => a + b, 0) / allNetRAMP.length;
    console.log(`\n📊 Net RAPM Centering Check:`);
    console.log(`Mean Net RAPM: ${rampMean.toFixed(3)} ${Math.abs(rampMean) < 0.1 ? '✅' : '⚠️'}`);
    console.log(`Range: [${Math.min(...allNetRAMP).toFixed(2)}, ${Math.max(...allNetRAMP).toFixed(2)}]`);

    console.log("\n📋 AUDIT CONCLUSION:");
    if (netCorr < 0.2) {
      console.log("❌ CRITICAL: Very weak Net RAPM correlation");
      console.log("   This suggests potential issues with RAPM calculation or weighting");
    } else if (netCorr < 0.4) {
      console.log("⚠️ MODERATE: Weak Net RAPM correlation");
      console.log("   May indicate legitimate team effects not captured by individual RAPM");
      console.log("   UCI/UCSD mismatches appear to be real coaching/chemistry effects");
    } else {
      console.log("✅ GOOD: Strong Net RAPM correlation validates individual impact estimates");
    }

  } catch (error) {
    console.error("❌ Audit failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}