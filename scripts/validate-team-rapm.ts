#!/usr/bin/env npx tsx
/**
 * Team-level RAPM sanity check.
 * Validate that PlayerImpact values make sense when aggregated by team
 * and compared to team-level performance metrics.
 */

import 'dotenv/config';
import { PrismaClient } from '../app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const SEASON = 2026;

// Target teams for detailed analysis
const TARGET_TEAMS = {
  'UC Irvine': 308,
  'UC San Diego': 310,
  'UC Santa Barbara': 311,
  'Auburn': 16,
  'Duke': 150,
  'Houston': 248,
  'Florida': 57,
  'Gonzaga': 2250
};

interface TeamRAPM {
  teamId: number;
  teamName: string;
  playerCount: number;
  weightedORAMP: number;
  weightedDRAMP: number;
  weightedNetRAMP: number;
  totalPossessions: number;
  averageConfidence: string;
  coverage: number; // % of players with RAPM
}

interface TeamStats {
  teamId: number;
  games: number;
  wins: number;
  losses: number;
  points: number;
  oppPoints: number;
  possessions: number;
  oppPossessions: number;
}

async function loadTeamRAMP(): Promise<Map<number, TeamRAPM>> {
  console.log("📊 Computing team-weighted RAPM averages...");

  const teamRAPMData = await prisma.$queryRaw<any[]>`
    SELECT
      t.id as "teamId",
      t.school as "teamName",
      COUNT(pi.id) as "playerCount",
      COUNT(pss.id) as "totalPlayers",

      -- Weighted RAPM averages (by possessions, fallback to minutes)
      COALESCE(
        SUM(pi.orapm * COALESCE(pi.possessions, pss.minutes, 100)) /
        NULLIF(SUM(COALESCE(pi.possessions, pss.minutes, 100)), 0),
        0
      ) as "weightedORAMP",

      COALESCE(
        SUM(pi.drapm * COALESCE(pi.possessions, pss.minutes, 100)) /
        NULLIF(SUM(COALESCE(pi.possessions, pss.minutes, 100)), 0),
        0
      ) as "weightedDRAMP",

      COALESCE(
        SUM(pi.rapm * COALESCE(pi.possessions, pss.minutes, 100)) /
        NULLIF(SUM(COALESCE(pi.possessions, pss.minutes, 100)), 0),
        0
      ) as "weightedNetRAMP",

      SUM(COALESCE(pi.possessions, 0)) as "totalPossessions",

      -- Coverage and confidence
      ROUND(COUNT(pi.id)::numeric / COUNT(pss.id) * 100, 1) as "coverage",
      MODE() WITHIN GROUP (ORDER BY pi.confidence) as "averageConfidence"

    FROM teams t
    LEFT JOIN player_season_stats pss ON pss."teamId" = t.id AND pss.season = ${SEASON}
    LEFT JOIN player_impact pi ON pi."playerId" = pss."playerId" AND pi.season = ${SEASON}
    WHERE pss.season = ${SEASON}
    GROUP BY t.id, t.school
    HAVING COUNT(pss.id) >= 5  -- Only teams with at least 5 players
    ORDER BY "weightedNetRAMP" DESC
  `;

  const teamMap = new Map<number, TeamRAPM>();
  for (const row of teamRAPMData) {
    teamMap.set(row.teamId, {
      teamId: row.teamId,
      teamName: row.teamName,
      playerCount: parseInt(row.playerCount),
      weightedORAMP: parseFloat(row.weightedORAMP),
      weightedDRAMP: parseFloat(row.weightedDRAMP),
      weightedNetRAMP: parseFloat(row.weightedNetRAMP),
      totalPossessions: parseInt(row.totalPossessions),
      averageConfidence: row.averageConfidence,
      coverage: parseFloat(row.coverage)
    });
  }

  console.log(`   ✅ Computed RAPM for ${teamMap.size} teams`);
  return teamMap;
}

async function loadTeamStats(): Promise<Map<number, TeamStats>> {
  console.log("📊 Loading team performance stats...");

  const teamStats = await prisma.teamSeasonStats.findMany({
    where: { season: SEASON },
    select: {
      teamId: true,
      games: true,
      wins: true,
      losses: true,
      pointsTotal: true,
      oppPoints: true,
      oppPossessions: true
    }
  });

  const statsMap = new Map<number, TeamStats>();
  for (const stats of teamStats) {
    if (stats.oppPossessions && stats.oppPossessions > 0) {
      statsMap.set(stats.teamId, {
        teamId: stats.teamId,
        games: stats.games || 0,
        wins: stats.wins || 0,
        losses: stats.losses || 0,
        points: stats.pointsTotal || 0,
        oppPoints: stats.oppPoints || 0,
        possessions: stats.oppPossessions || 1, // Approximate team possessions ≈ opponent possessions
        oppPossessions: stats.oppPossessions || 1
      });
    }
  }

  console.log(`   ✅ Loaded stats for ${statsMap.size} teams`);
  return statsMap;
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

async function analyzeCorrelations(teamRAMP: Map<number, TeamRAPM>, teamStats: Map<number, TeamStats>) {
  console.log("\n🔗 Team RAPM vs Performance Correlations");
  console.log("=".repeat(60));

  // Get teams with both RAPM and stats data
  const commonTeams = [];
  for (const [teamId, rapm] of teamRAMP.entries()) {
    const stats = teamStats.get(teamId);
    if (stats && stats.games >= 10 && rapm.coverage >= 50) { // Minimum 10 games and 50% RAPM coverage
      const ortg = (stats.points / stats.possessions) * 100;
      const drtg = (stats.oppPoints / stats.oppPossessions) * 100;
      const netRtg = ortg - drtg;
      const winPct = stats.games > 0 ? stats.wins / stats.games : 0;

      commonTeams.push({
        teamId,
        teamName: rapm.teamName,
        weightedORAMP: rapm.weightedORAMP,
        weightedDRAMP: rapm.weightedDRAMP,
        weightedNetRAMP: rapm.weightedNetRAMP,
        ortg,
        drtg,
        netRtg,
        winPct,
        coverage: rapm.coverage
      });
    }
  }

  console.log(`Analyzing ${commonTeams.length} teams with sufficient data...`);

  if (commonTeams.length >= 10) {
    const orampValues = commonTeams.map(t => t.weightedORAMP);
    const drampValues = commonTeams.map(t => t.weightedDRAMP);
    const netRampValues = commonTeams.map(t => t.weightedNetRAMP);
    const ortgValues = commonTeams.map(t => t.ortg);
    const drtgValues = commonTeams.map(t => -t.drtg); // Flip DRTG so lower (better) = higher value
    const netRtgValues = commonTeams.map(t => t.netRtg);
    const winPctValues = commonTeams.map(t => t.winPct);

    const orampOrtgCorr = calculateCorrelation(orampValues, ortgValues);
    const drampDrtgCorr = calculateCorrelation(drampValues, drtgValues);
    const netRampNetRtgCorr = calculateCorrelation(netRampValues, netRtgValues);
    const netRampWinPctCorr = calculateCorrelation(netRampValues, winPctValues);

    console.log(`\nTeam-level correlations:`);
    console.log(`  Weighted ORAPM vs Team ORtg:     ${orampOrtgCorr.toFixed(3)} ${orampOrtgCorr >= 0.4 ? '✅' : orampOrtgCorr >= 0.2 ? '⚠️' : '❌'}`);
    console.log(`  Weighted DRAPM vs Team DRtg:     ${drampDrtgCorr.toFixed(3)} ${drampDrtgCorr >= 0.4 ? '✅' : drampDrtgCorr >= 0.2 ? '⚠️' : '❌'}`);
    console.log(`  Weighted Net RAPM vs Net Rating: ${netRampNetRtgCorr.toFixed(3)} ${netRampNetRtgCorr >= 0.4 ? '✅' : netRampNetRtgCorr >= 0.2 ? '⚠️' : '❌'}`);
    console.log(`  Weighted Net RAPM vs Win%:       ${netRampWinPctCorr.toFixed(3)} ${netRampWinPctCorr >= 0.4 ? '✅' : netRampWinPctCorr >= 0.2 ? '⚠️' : '❌'}`);

    // Show some example teams
    console.log(`\nSample teams (sorted by Net RAPM):`);
    const sortedTeams = commonTeams.sort((a, b) => b.weightedNetRAMP - a.weightedNetRAMP);
    console.log(`${'Team'.padEnd(20)} | Net RAPM | Net Rtg | Win% | Coverage`);
    console.log(`${''.padEnd(20, '-')}|----------|---------|------|--------`);

    for (const team of sortedTeams.slice(0, 10)) {
      console.log(`${team.teamName.substring(0,19).padEnd(20)}| ${team.weightedNetRAMP.toFixed(2).padStart(8)} | ${team.netRtg.toFixed(1).padStart(7)} | ${(team.winPct*100).toFixed(0).padStart(3)}% | ${team.coverage.toFixed(0).padStart(6)}%`);
    }

    console.log(`\nBottom 5 teams by Net RAPM:`);
    for (const team of sortedTeams.slice(-5)) {
      console.log(`${team.teamName.substring(0,19).padEnd(20)}| ${team.weightedNetRAMP.toFixed(2).padStart(8)} | ${team.netRtg.toFixed(1).padStart(7)} | ${(team.winPct*100).toFixed(0).padStart(3)}% | ${team.coverage.toFixed(0).padStart(6)}%`);
    }

  } else {
    console.log(`❌ Insufficient teams (${commonTeams.length}) for correlation analysis`);
  }

  return commonTeams;
}

async function analyzeTargetTeams(teamRAMP: Map<number, TeamRAPM>) {
  console.log("\n🏀 Target Team Detailed Analysis");
  console.log("=".repeat(60));

  for (const [teamName, teamId] of Object.entries(TARGET_TEAMS)) {
    console.log(`\n${teamName} (ID: ${teamId}):`);

    const teamRAPMData = teamRAMP.get(teamId);
    if (!teamRAPMData) {
      console.log(`  ❌ No RAPM data found`);
      continue;
    }

    console.log(`  Team weighted averages:`);
    console.log(`    Net RAPM: ${teamRAPMData.weightedNetRAMP.toFixed(2)}`);
    console.log(`    ORAPM: ${teamRAPMData.weightedORAMP.toFixed(2)}`);
    console.log(`    DRAPM: ${teamRAPMData.weightedDRAMP.toFixed(2)}`);
    console.log(`    Coverage: ${teamRAPMData.coverage.toFixed(1)}% (${teamRAPMData.playerCount} players)`);
    console.log(`    Confidence: ${teamRAPMData.averageConfidence}`);

    // Get individual players
    const players = await prisma.playerImpact.findMany({
      where: {
        season: SEASON,
        teamId: teamId
      },
      include: {
        player: { select: { name: true } }
      },
      orderBy: { rapm: 'desc' }
    });

    if (players.length > 0) {
      console.log(`\n  Top 5 Net RAPM players:`);
      for (let i = 0; i < Math.min(5, players.length); i++) {
        const p = players[i];
        const name = p.player.name || `Player ${p.playerId}`;
        console.log(`    ${i+1}. ${name}: ${p.rapm?.toFixed(2)} Net (+${p.orapm?.toFixed(2)} O / +${p.drapm?.toFixed(2)} D) [${p.possessions} poss, ${p.confidence}]`);
      }

      const topORAMP = players.filter(p => p.orapm !== null).sort((a, b) => (b.orapm || 0) - (a.orapm || 0));
      console.log(`\n  Top 5 ORAPM players:`);
      for (let i = 0; i < Math.min(5, topORAMP.length); i++) {
        const p = topORAMP[i];
        const name = p.player.name || `Player ${p.playerId}`;
        console.log(`    ${i+1}. ${name}: ${p.orapm?.toFixed(2)} ORAPM [${p.possessions} poss]`);
      }

      const topDRAMP = players.filter(p => p.drapm !== null).sort((a, b) => (b.drapm || 0) - (a.drapm || 0));
      console.log(`\n  Top 5 DRAPM players:`);
      for (let i = 0; i < Math.min(5, topDRAMP.length); i++) {
        const p = topDRAMP[i];
        const name = p.player.name || `Player ${p.playerId}`;
        console.log(`    ${i+1}. ${name}: ${p.drapm?.toFixed(2)} DRAPM [${p.possessions} poss]`);
      }
    }
  }
}

async function investigateUCIUCSD(teamRAMP: Map<number, TeamRAPM>) {
  console.log("\n🔍 UCI/UCSD Low RAPM Investigation");
  console.log("=".repeat(60));

  const teams = [
    { name: 'UC Irvine', id: 308 },
    { name: 'UC San Diego', id: 310 },
    { name: 'Auburn', id: 16 }
  ];

  for (const team of teams) {
    console.log(`\n${team.name}:`);

    // Check player mapping and season data
    const seasonStats = await prisma.playerSeasonStats.findMany({
      where: {
        teamId: team.id,
        season: SEASON
      },
      include: {
        player: { select: { name: true } }
      }
    });

    const impactData = await prisma.playerImpact.findMany({
      where: {
        season: SEASON,
        teamId: team.id
      },
      include: {
        player: { select: { name: true } }
      }
    });

    console.log(`  Season stats records: ${seasonStats.length}`);
    console.log(`  Impact records: ${impactData.length}`);
    console.log(`  RAPM coverage: ${impactData.length}/${seasonStats.length} (${((impactData.length/Math.max(seasonStats.length,1))*100).toFixed(1)}%)`);

    // Check possession/minute ranges
    const possessionRanges = impactData.map(p => p.possessions || 0);
    const minuteRanges = seasonStats.map(p => p.minutes || 0);

    if (possessionRanges.length > 0) {
      console.log(`  RAPM possessions range: ${Math.min(...possessionRanges)} - ${Math.max(...possessionRanges)}`);
    }
    if (minuteRanges.length > 0) {
      console.log(`  Season minutes range: ${Math.min(...minuteRanges)} - ${Math.max(...minuteRanges)}`);
    }

    // Show confidence breakdown
    const confidenceBreakdown = impactData.reduce((acc, p) => {
      acc[p.confidence || 'null'] = (acc[p.confidence || 'null'] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log(`  Confidence breakdown:`, confidenceBreakdown);

    // Show top player details
    const topPlayer = impactData.sort((a, b) => (b.rapm || 0) - (a.rapm || 0))[0];
    if (topPlayer) {
      console.log(`  Top player: ${topPlayer.player.name || `Player ${topPlayer.playerId}`}`);
      console.log(`    Net RAPM: ${topPlayer.rapm?.toFixed(2)}`);
      console.log(`    Possessions: ${topPlayer.possessions}`);
      console.log(`    Minutes: ${topPlayer.minutes}`);
      console.log(`    Confidence: ${topPlayer.confidence}`);
    }
  }
}

async function main() {
  console.log("🔍 Team-Level RAPM Sanity Check");
  console.log("=".repeat(70));

  try {
    // Load data
    const [teamRAMP, teamStats] = await Promise.all([
      loadTeamRAMP(),
      loadTeamStats()
    ]);

    // Analyze correlations
    await analyzeCorrelations(teamRAMP, teamStats);

    // Detailed target team analysis
    await analyzeTargetTeams(teamRAMP);

    // Investigate UCI/UCSD low values
    await investigateUCIUCSD(teamRAMP);

    console.log("\n✅ Team-level RAPM sanity check completed!");

  } catch (error) {
    console.error("❌ Sanity check failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}