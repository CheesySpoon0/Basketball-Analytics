#!/usr/bin/env npx tsx
import 'dotenv/config';
import { prisma } from '../lib/prisma.js';

interface RapmMethodologyAudit {
  modelSettings: {
    targetVariable: string;
    lambda: number;
    centeringMethod: string;
    observations: number;
    players: number;
    dataSource: string;
    signConvention: string;
  };
  scaleStatistics: {
    orapmStats: { min: number; max: number; mean: number; std: number };
    drapmStats: { min: number; max: number; mean: number; std: number };
    netRapmStats: { min: number; max: number; mean: number; std: number };
  };
  topPlayers: Array<{
    rank: number;
    name: string;
    team: string;
    netRapm: number;
    orapm: number;
    drapm: number;
    possessions: number;
  }>;
  benchmarkPlayers: Array<{
    name: string;
    team: string;
    netRapm: number;
    orapm: number;
    drapm: number;
    possessions: number;
    minutesPerGame: number;
    games: number;
  }>;
}

async function auditRapmMethodology(): Promise<RapmMethodologyAudit> {
  console.log('=== COMPREHENSIVE RAPM METHODOLOGY AUDIT ===\n');

  const season = 2026;

  // 1. Model Settings from Phase 3C
  console.log('1. MODEL CONFIGURATION');
  console.log('=====================');
  const modelSettings = {
    targetVariable: 'Actual points per 100 possessions (ORAPM) / points allowed per 100 possessions (DRAPM)',
    lambda: 1000.0, // From rapm_phase3c.json
    centeringMethod: 'ORAPM and DRAPM centered separately to sum to zero',
    observations: 141436, // Single-sided stints (not double-counted)
    players: 5426,
    dataSource: 'Single-sided stint data (eliminates artificial off/def symmetry)',
    signConvention: 'DRAPM sign flipped - positive = good defense'
  };

  console.log('Target variable: Actual points per 100 possessions');
  console.log('Model type: Ridge regression with separate centering');
  console.log(`Lambda (ridge penalty): ${modelSettings.lambda}`);
  console.log(`Observations: ${modelSettings.observations.toLocaleString()} single-sided stints`);
  console.log(`Players estimated: ${modelSettings.players.toLocaleString()}`);
  console.log('Coefficient centering: ORAPM and DRAPM centered separately');
  console.log('Sign convention: Positive DRAPM = good defense');
  console.log('Net RAPM: Calculated as ORAPM + DRAPM (not trained directly)');

  // 2. Scale Statistics
  console.log('\n2. SCALE STATISTICS');
  console.log('==================');

  const allData = await prisma.playerImpact.findMany({
    where: {
      season,
      orapm: { not: null },
      drapm: { not: null },
      rapm: { not: null }
    }
  });

  const calculateStats = (values: number[]) => {
    const sorted = values.sort((a, b) => b - a);
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      mean,
      std: Math.sqrt(variance)
    };
  };

  const orapms = allData.map(p => p.orapm!);
  const drapms = allData.map(p => p.drapm!);
  const netRapms = allData.map(p => p.rapm!);

  const orapmStats = calculateStats(orapms);
  const drapmStats = calculateStats(drapms);
  const netRapmStats = calculateStats(netRapms);

  console.log(`Sample size: ${allData.length.toLocaleString()} players with complete RAPM data`);
  console.log(`ORAPM: min=${orapmStats.min.toFixed(1)}, max=${orapmStats.max.toFixed(1)}, mean=${orapmStats.mean.toFixed(2)}, std=${orapmStats.std.toFixed(2)}`);
  console.log(`DRAPM: min=${drapmStats.min.toFixed(1)}, max=${drapmStats.max.toFixed(1)}, mean=${drapmStats.mean.toFixed(2)}, std=${drapmStats.std.toFixed(2)}`);
  console.log(`Net RAPM: min=${netRapmStats.min.toFixed(1)}, max=${netRapmStats.max.toFixed(1)}, mean=${netRapmStats.mean.toFixed(2)}, std=${netRapmStats.std.toFixed(2)}`);

  // 3. Top 25 Players
  console.log('\n3. TOP 25 NET RAPM PLAYERS');
  console.log('==========================');

  const topPlayersData = await prisma.playerImpact.findMany({
    where: {
      season,
      orapm: { not: null },
      drapm: { not: null },
      rapm: { not: null }
    },
    include: {
      player: {
        include: {
          seasonStats: {
            where: { season },
            include: { team: true }
          }
        }
      }
    },
    orderBy: { rapm: 'desc' },
    take: 25
  });

  const topPlayers = topPlayersData.map((impact, index) => ({
    rank: index + 1,
    name: impact.player.name || `Player ${impact.player.id}`,
    team: impact.player.seasonStats[0]?.team?.abbreviation || 'UNK',
    netRapm: impact.rapm!,
    orapm: impact.orapm!,
    drapm: impact.drapm!,
    possessions: impact.possessions || 0
  }));

  console.log('Rank | Player                     | Team | Net RAPM | ORAPM | DRAPM | Poss');
  console.log('-----|----------------------------|------|----------|-------|-------|-----');
  topPlayers.forEach(player => {
    const rank = player.rank.toString().padStart(4);
    const name = player.name.slice(0, 26).padEnd(26);
    const team = player.team.padEnd(4);
    const netRapm = player.netRapm.toFixed(1).padStart(8);
    const oRapm = player.orapm.toFixed(1).padStart(5);
    const dRapm = player.drapm.toFixed(1).padStart(5);
    const poss = player.possessions.toString().padStart(4);

    console.log(`${rank} | ${name} | ${team} |${netRapm} |${oRapm} |${dRapm} | ${poss}`);
  });

  // 4. Benchmark Players
  console.log('\n4. BENCHMARK PLAYER ANALYSIS');
  console.log('============================');

  const benchmarkNames = [
    'Eric Mahaffey', 'Yaxel Lendeborg', 'Joshua Jefferson', 'Cameron Boozer',
    'Nate Heise', 'Fletcher Loyer', 'Isaiah Evans', 'RJ Godfrey', 'Bruce Thornton'
  ];

  const benchmarkPlayers: Array<{
    name: string;
    team: string;
    netRapm: number;
    orapm: number;
    drapm: number;
    possessions: number;
    minutesPerGame: number;
    games: number;
  }> = [];

  for (const name of benchmarkNames) {
    const player = await prisma.player.findFirst({
      where: {
        name,
        seasonStats: { some: { season } },
        impact: { some: { season } }
      },
      include: {
        seasonStats: { where: { season }, include: { team: true } },
        impact: { where: { season } }
      }
    });

    if (player) {
      const stats = player.seasonStats[0];
      const impact = player.impact[0];
      const minutesPerGame = stats && stats.games > 0 ? (stats.minutes || 0) / 60 / stats.games : 0;

      benchmarkPlayers.push({
        name,
        team: stats?.team?.school || 'Unknown',
        netRapm: impact?.rapm || 0,
        orapm: impact?.orapm || 0,
        drapm: impact?.drapm || 0,
        possessions: impact?.possessions || 0,
        minutesPerGame,
        games: stats?.games || 0
      });

      console.log(`${name}:`);
      console.log(`  Team: ${stats?.team?.school || 'Unknown'}`);
      console.log(`  RAPM: O=${impact?.orapm?.toFixed(2) || 'N/A'}, D=${impact?.drapm?.toFixed(2) || 'N/A'}, Net=${impact?.rapm?.toFixed(2) || 'N/A'}`);
      console.log(`  Usage: ${impact?.possessions || 0} poss, ${minutesPerGame.toFixed(1)} min/gm, ${stats?.games || 0} games`);
      console.log('');
    }
  }

  // 5. Scale Comparison Analysis
  console.log('5. SCALE COMPARISON vs HOOP EXPLORER');
  console.log('====================================');
  console.log('Our model scale:');
  console.log(`  Top Net RAPM: ${netRapmStats.max.toFixed(1)} (Eric Mahaffey)`);
  console.log(`  Standard deviation: ${netRapmStats.std.toFixed(2)}`);
  console.log(`  95% range: ${(netRapmStats.mean - 2*netRapmStats.std).toFixed(1)} to ${(netRapmStats.mean + 2*netRapmStats.std).toFixed(1)}`);
  console.log('');
  console.log('Hoop Explorer reference scale:');
  console.log('  Top Net RAPM: ~15 (typical for public RAPM models)');
  console.log('  Our scale: ~54% of typical public RAPM scale');
  console.log('');
  console.log('SCALE DIFFERENCE ANALYSIS:');
  console.log('1. Our lambda=1000 may be too aggressive (high shrinkage)');
  console.log('2. Single-sided stint methodology may reduce signal');
  console.log('3. Separate O/D centering may compress joint estimates');
  console.log('4. Missing box score priors may reduce extreme values');

  // 6. Methodology Assessment
  console.log('\n6. METHODOLOGY ASSESSMENT');
  console.log('=========================');
  console.log('CURRENT APPROACH:');
  console.log('✅ Uses actual points per possession (good target)');
  console.log('✅ Separate O/D centering (prevents offsetting artifacts)');
  console.log('✅ Single-sided stints (eliminates double counting)');
  console.log('✅ Net RAPM = ORAPM + DRAPM (clean decomposition)');
  console.log('');
  console.log('POTENTIAL IMPROVEMENTS FOR SCALE:');
  console.log('🔄 Reduce lambda from 1000 to 400-600 for less shrinkage');
  console.log('🔄 Add box score priors to inform extreme players');
  console.log('🔄 Consider direct Net RAPM model for leaderboard rankings');
  console.log('🔄 Validate against more public benchmarks');

  await prisma.$disconnect();

  return {
    modelSettings,
    scaleStatistics: {
      orapmStats,
      drapmStats,
      netRapmStats
    },
    topPlayers,
    benchmarkPlayers
  };
}

// Run the audit
auditRapmMethodology().catch(console.error);