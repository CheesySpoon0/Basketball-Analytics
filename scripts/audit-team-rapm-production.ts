#!/usr/bin/env npx tsx
/**
 * Production-ready team RAPM audit.
 * Deep dive into UCI/UCSD mismatch and overall team correlations.
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

  // RAPM data
  weightedORAMP: number;
  weightedDRAMP: number;
  weightedNetRAMP: number;
  playerCount: number;
  playerCoverage: number;

  // Traditional stats
  ortg: number;
  drtg: number;
  netRtg: number;
  winPct: number;
  record: string;

  // Lineup data
  lineupStints: number;
  fullLineupStints: number;
  lineupCoverage: number;

  // Weighting details
  totalWeightedPossessions: number;
  avgPossessionsPerPlayer: number;
}

function calculateCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 3) return 0;

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

  return denomX > 0 && denomY > 0 ? numerator / Math.sqrt(denomX * denomY) : 0;
}

async function loadTeamAnalysis(): Promise<TeamAnalysis[]> {
  console.log("🔍 Loading comprehensive team analysis...");

  // Get all team data in one comprehensive query
  const teamData = await prisma.$queryRaw<any[]>`
    WITH team_rapm AS (
      SELECT
        t.id as team_id,
        t.school as team_name,
        COUNT(DISTINCT pss."playerId") as total_players,
        COUNT(DISTINCT pi."playerId") as players_with_rapm,

        -- Weighted RAPM calculations (by possessions, fallback to minutes)
        COALESCE(
          SUM(pi.orapm * COALESCE(pi.possessions, pss.minutes, 100)) /
          NULLIF(SUM(COALESCE(pi.possessions, pss.minutes, 100)), 0),
          0
        ) as weighted_orapm,

        COALESCE(
          SUM(pi.drapm * COALESCE(pi.possessions, pss.minutes, 100)) /
          NULLIF(SUM(COALESCE(pi.possessions, pss.minutes, 100)), 0),
          0
        ) as weighted_drapm,

        COALESCE(
          SUM(pi.rapm * COALESCE(pi.possessions, pss.minutes, 100)) /
          NULLIF(SUM(COALESCE(pi.possessions, pss.minutes, 100)), 0),
          0
        ) as weighted_net_rapm,

        SUM(COALESCE(pi.possessions, pss.minutes, 100)) as total_weighted_poss,
        AVG(COALESCE(pi.possessions, pss.minutes, 100)) as avg_poss_per_player

      FROM teams t
      LEFT JOIN player_season_stats pss ON pss."teamId" = t.id AND pss.season = ${SEASON}
      LEFT JOIN player_impact pi ON pi."playerId" = pss."playerId" AND pi.season = ${SEASON}
      WHERE pss.season = ${SEASON}
      GROUP BY t.id, t.school
      HAVING COUNT(DISTINCT pss."playerId") >= 5
    ),
    team_stats AS (
      SELECT
        tss."teamId",
        tss.games,
        tss.wins,
        tss.losses,
        tss."pointsTotal",
        tss."oppPoints",
        tss."oppPossessions"
      FROM team_season_stats tss
      WHERE tss.season = ${SEASON}
        AND tss."oppPossessions" > 0
    ),
    lineup_stats AS (
      SELECT
        ls."teamId",
        COUNT(*) as lineup_stints,
        COUNT(CASE WHEN ls.confidence = 'full' THEN 1 END) as full_lineup_stints
      FROM lineup_stints ls
      WHERE ls.season = ${SEASON}
        AND ls."playerIds" IS NOT NULL
      GROUP BY ls."teamId"
    )
    SELECT
      tr.team_id,
      tr.team_name,
      tr.total_players,
      tr.players_with_rapm,
      ROUND(tr.players_with_rapm::numeric / tr.total_players * 100, 1) as player_coverage,
      tr.weighted_orapm,
      tr.weighted_drapm,
      tr.weighted_net_rapm,
      tr.total_weighted_poss,
      tr.avg_poss_per_player,

      -- Team performance
      ROUND((ts."pointsTotal"::numeric / ts."oppPossessions" * 100), 1) as ortg,
      ROUND((ts."oppPoints"::numeric / ts."oppPossessions" * 100), 1) as drtg,
      ROUND((ts."pointsTotal"::numeric / ts."oppPossessions" * 100) - (ts."oppPoints"::numeric / ts."oppPossessions" * 100), 1) as net_rtg,
      ROUND(ts.wins::numeric / NULLIF(ts.games, 0), 3) as win_pct,
      ts.wins || '-' || ts.losses as record,

      -- Lineup coverage
      COALESCE(lst.lineup_stints, 0) as lineup_stints,
      COALESCE(lst.full_lineup_stints, 0) as full_lineup_stints,
      ROUND(COALESCE(lst.full_lineup_stints::numeric / NULLIF(lst.lineup_stints, 0) * 100, 0), 1) as lineup_coverage

    FROM team_rapm tr
    LEFT JOIN team_stats ts ON ts."teamId" = tr.team_id
    LEFT JOIN lineup_stats lst ON lst."teamId" = tr.team_id
    WHERE ts.games IS NOT NULL
    ORDER BY tr.weighted_net_rapm DESC
  `;

  return teamData.map(row => ({
    teamId: row.team_id,
    teamName: row.team_name,
    weightedORAMP: parseFloat(row.weighted_orapm),
    weightedDRAMP: parseFloat(row.weighted_drapm),
    weightedNetRAMP: parseFloat(row.weighted_net_rapm),
    playerCount: parseInt(row.players_with_rapm),
    playerCoverage: parseFloat(row.player_coverage),
    ortg: parseFloat(row.ortg),
    drtg: parseFloat(row.drtg),
    netRtg: parseFloat(row.net_rtg),
    winPct: parseFloat(row.win_pct),
    record: row.record,
    lineupStints: parseInt(row.lineup_stints || '0'),
    fullLineupStints: parseInt(row.full_lineup_stints || '0'),
    lineupCoverage: parseFloat(row.lineup_coverage),
    totalWeightedPossessions: parseFloat(row.total_weighted_poss),
    avgPossessionsPerPlayer: parseFloat(row.avg_poss_per_player)
  }));
}

async function auditCorrelations(teams: TeamAnalysis[]) {
  console.log("\n📊 Team RAPM vs Performance Correlations");
  console.log("=".repeat(60));

  // Filter to teams with reasonable sample sizes
  const validTeams = teams.filter(t =>
    t.playerCoverage >= 50 &&
    t.avgPossessionsPerPlayer >= 100 &&
    t.lineupStints >= 10
  );

  console.log(`Analyzing ${validTeams.length}/${teams.length} teams with sufficient data...`);

  const netRampValues = validTeams.map(t => t.weightedNetRAMP);
  const orampValues = validTeams.map(t => t.weightedORAMP);
  const drampValues = validTeams.map(t => t.weightedDRAMP);
  const netRtgValues = validTeams.map(t => t.netRtg);
  const ortgValues = validTeams.map(t => t.ortg);
  const invDrtgValues = validTeams.map(t => -t.drtg); // Invert for correlation

  const netCorr = calculateCorrelation(netRampValues, netRtgValues);
  const oCorr = calculateCorrelation(orampValues, ortgValues);
  const dCorr = calculateCorrelation(drampValues, invDrtgValues);

  console.log(`Net RAPM vs Net Rating:    ${netCorr.toFixed(3)} ${netCorr >= 0.3 ? '✅' : netCorr >= 0.1 ? '⚠️' : '❌'}`);
  console.log(`ORAPM vs ORtg:            ${oCorr.toFixed(3)} ${oCorr >= 0.5 ? '✅' : oCorr >= 0.3 ? '⚠️' : '❌'}`);
  console.log(`DRAPM vs inverted DRtg:   ${dCorr.toFixed(3)} ${dCorr >= 0.5 ? '✅' : dCorr >= 0.3 ? '⚠️' : '❌'}`);

  return { netCorr, oCorr, dCorr, validTeams };
}

async function analyzeTopBottom(teams: TeamAnalysis[]) {
  console.log("\n🏆 Top 20 Teams by Net Rating vs Net RAPM");
  console.log("=".repeat(80));

  const topByNetRtg = [...teams].sort((a, b) => b.netRtg - a.netRtg).slice(0, 20);

  console.log("Rank | Team                    | Net Rtg | Net RAPM | Diff   | Record | Coverage");
  console.log("-----|-------------------------|---------|----------|--------|--------|----------");

  for (let i = 0; i < topByNetRtg.length; i++) {
    const team = topByNetRtg[i];
    const diff = team.netRtg - (team.weightedNetRAMP * 100); // Scale RAPM to match rating
    console.log(
      `${(i+1).toString().padStart(4)} | ${team.teamName.substring(0, 23).padEnd(23)} | ` +
      `${team.netRtg.toFixed(1).padStart(7)} | ${team.weightedNetRAMP.toFixed(2).padStart(8)} | ` +
      `${diff >= 0 ? '+' : ''}${diff.toFixed(1).padStart(6)} | ${team.record.padStart(6)} | ` +
      `${team.playerCoverage.toFixed(0)}%`
    );
  }

  console.log("\n💥 Bottom 20 Teams by Net Rating vs Net RAPM");
  console.log("=".repeat(80));

  const bottomByNetRtg = [...teams].sort((a, b) => a.netRtg - b.netRtg).slice(0, 20);

  console.log("Rank | Team                    | Net Rtg | Net RAPM | Diff   | Record | Coverage");
  console.log("-----|-------------------------|---------|----------|--------|--------|----------");

  for (let i = 0; i < bottomByNetRtg.length; i++) {
    const team = bottomByNetRtg[i];
    const diff = team.netRtg - (team.weightedNetRAMP * 100);
    console.log(
      `${(i+1).toString().padStart(4)} | ${team.teamName.substring(0, 23).padEnd(23)} | ` +
      `${team.netRtg.toFixed(1).padStart(7)} | ${team.weightedNetRAMP.toFixed(2).padStart(8)} | ` +
      `${diff >= 0 ? '+' : ''}${diff.toFixed(1).padStart(6)} | ${team.record.padStart(6)} | ` +
      `${team.playerCoverage.toFixed(0)}%`
    );
  }
}

async function analyzeBiggestMismatches(teams: TeamAnalysis[]) {
  console.log("\n🔍 Biggest Mismatches (Net Rating vs Net RAPM)");
  console.log("=".repeat(80));

  // Calculate mismatches
  const teamsMismatches = teams.map(team => ({
    ...team,
    scaledNetRAMP: team.weightedNetRAMP * 100,
    mismatch: team.netRtg - (team.weightedNetRAMP * 100)
  }));

  // Biggest positive mismatches (better actual than RAPM predicts)
  console.log("Teams performing BETTER than RAPM suggests:");
  const positiveMismatches = teamsMismatches
    .filter(t => t.mismatch > 0)
    .sort((a, b) => b.mismatch - a.mismatch)
    .slice(0, 10);

  for (const team of positiveMismatches) {
    console.log(
      `  ${team.teamName.padEnd(25)} | Net Rtg: ${team.netRtg.toFixed(1).padStart(6)} | ` +
      `Net RAPM: ${team.weightedNetRAMP.toFixed(2).padStart(6)} | ` +
      `Diff: +${team.mismatch.toFixed(1)} | ${team.record}`
    );
  }

  // Biggest negative mismatches (worse actual than RAPM predicts)
  console.log("\nTeams performing WORSE than RAPM suggests:");
  const negativeMismatches = teamsMismatches
    .filter(t => t.mismatch < 0)
    .sort((a, b) => a.mismatch - b.mismatch)
    .slice(0, 10);

  for (const team of negativeMismatches) {
    console.log(
      `  ${team.teamName.padEnd(25)} | Net Rtg: ${team.netRtg.toFixed(1).padStart(6)} | ` +
      `Net RAPM: ${team.weightedNetRAMP.toFixed(2).padStart(6)} | ` +
      `Diff: ${team.mismatch.toFixed(1)} | ${team.record}`
    );
  }

  // Find UCI, UCSD specifically
  const targetTeams = ['UC Irvine', 'UC San Diego', 'Auburn'];
  console.log("\n🎯 Target Team Analysis:");
  for (const targetName of targetTeams) {
    const team = teamsMismatches.find(t => t.teamName === targetName);
    if (team) {
      console.log(
        `${team.teamName}:`
      );
      console.log(
        `  Net Rating: ${team.netRtg.toFixed(1)} | Net RAPM: ${team.weightedNetRAMP.toFixed(2)} | ` +
        `Mismatch: ${team.mismatch >= 0 ? '+' : ''}${team.mismatch.toFixed(1)} | Record: ${team.record}`
      );
      console.log(
        `  Player Coverage: ${team.playerCoverage.toFixed(1)}% | ` +
        `Avg Poss/Player: ${team.avgPossessionsPerPlayer.toFixed(0)} | ` +
        `Lineup Coverage: ${team.lineupCoverage.toFixed(1)}%`
      );
    }
  }
}

async function investigateWeightingMethod(teams: TeamAnalysis[]) {
  console.log("\n🔬 Weighting Method Investigation");
  console.log("=".repeat(60));

  // Check weighting distribution
  const possessionStats = teams.map(t => t.avgPossessionsPerPlayer);
  const coverageStats = teams.map(t => t.playerCoverage);

  console.log(`Average possessions per player across teams:`);
  console.log(`  Mean: ${(possessionStats.reduce((a, b) => a + b, 0) / possessionStats.length).toFixed(0)}`);
  console.log(`  Min: ${Math.min(...possessionStats).toFixed(0)}`);
  console.log(`  Max: ${Math.max(...possessionStats).toFixed(0)}`);

  console.log(`\nPlayer coverage across teams:`);
  console.log(`  Mean: ${(coverageStats.reduce((a, b) => a + b, 0) / coverageStats.length).toFixed(1)}%`);
  console.log(`  Min: ${Math.min(...coverageStats).toFixed(1)}%`);
  console.log(`  Max: ${Math.max(...coverageStats).toFixed(1)}%`);

  // Check for potential centering issues
  const allNetRAMP = teams.map(t => t.weightedNetRAMP);
  const rampMean = allNetRAMP.reduce((a, b) => a + b, 0) / allNetRAMP.length;

  console.log(`\nNet RAPM distribution:`);
  console.log(`  Mean: ${rampMean.toFixed(3)} (should be ~0 if properly centered)`);
  console.log(`  Range: [${Math.min(...allNetRAMP).toFixed(2)}, ${Math.max(...allNetRAMP).toFixed(2)}]`);

  if (Math.abs(rampMean) > 0.1) {
    console.log(`  ⚠️ WARNING: Net RAPM mean is ${rampMean.toFixed(3)}, not centered around 0`);
  } else {
    console.log(`  ✅ Net RAPM properly centered around 0`);
  }
}

async function main() {
  console.log("🔍 Production Team RAPM Audit");
  console.log("=".repeat(70));

  try {
    const teams = await loadTeamAnalysis();
    console.log(`Loaded data for ${teams.length} teams`);

    const { netCorr } = await auditCorrelations(teams);
    await analyzeTopBottom(teams);
    await analyzeBiggestMismatches(teams);
    await investigateWeightingMethod(teams);

    console.log("\n📋 AUDIT CONCLUSIONS:");
    if (netCorr < 0.2) {
      console.log("❌ CRITICAL: Very weak Net RAPM correlation - investigate weighting/centering");
    } else if (netCorr < 0.4) {
      console.log("⚠️ WARNING: Moderate Net RAPM correlation - may be legitimate team effects");
    } else {
      console.log("✅ GOOD: Strong Net RAPM correlation with team performance");
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