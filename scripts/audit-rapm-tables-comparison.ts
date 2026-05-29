#!/usr/bin/env npx tsx
import { prisma } from '../lib/prisma.js';

interface PlayerRampData {
  playerId: number;
  playerName: string;
  team: string;
  season: number;
  games: number | null;
  minutes: number | null;
  possessions: number | null;

  // PlayerImpact data
  impact_orapm: number | null;
  impact_drapm: number | null;
  impact_rapm: number | null;
  impact_calculated_net: number | null;
  impact_orapm_expected: number | null;
  impact_drapm_expected: number | null;
  impact_confidence: string | null;
  impact_possessions: number | null;

  // PlayerRapm data (actual target)
  rapm_orapm: number | null;
  rapm_drapm: number | null;
  rapm_rapm: number | null;
  rapm_calculated_net: number | null;
  rapm_off_poss: number | null;
  rapm_def_poss: number | null;
  ramp_target: string | null;

  // Validation
  impact_net_matches_sum: boolean;
  rapm_net_matches_sum: boolean;
  tables_match: boolean;
}

async function auditRampTables() {
  console.log('=== RAPM TABLE COMPARISON AUDIT ===\n');

  const season = 2026;
  console.log(`Auditing season ${season}\n`);

  // 1. Get counts from both tables
  console.log('1. TABLE RECORD COUNTS');
  console.log('=====================');

  const impactCount = await prisma.playerImpact.count({
    where: { season }
  });

  const rampCount = await prisma.playerRapm.count({
    where: { season }
  });

  const rampActualCount = await prisma.playerRapm.count({
    where: { season, target: 'actual' }
  });

  const rampXefgCount = await prisma.playerRapm.count({
    where: { season, target: 'xefg' }
  });

  console.log(`PlayerImpact (${season}): ${impactCount.toLocaleString()} records`);
  console.log(`PlayerRapm total (${season}): ${rampCount.toLocaleString()} records`);
  console.log(`PlayerRapm 'actual' (${season}): ${rampActualCount.toLocaleString()} records`);
  console.log(`PlayerRapm 'xefg' (${season}): ${rampXefgCount.toLocaleString()} records\n`);

  // 2. Get detailed statistics from both tables
  console.log('2. TABLE FIELD STATISTICS');
  console.log('=========================');

  // PlayerImpact statistics
  const impactStats = await prisma.playerImpact.aggregate({
    where: {
      season,
      orapm: { not: null },
      drapm: { not: null },
      rapm: { not: null }
    },
    _count: { id: true },
    _avg: { orapm: true, drapm: true, rapm: true },
    _min: { orapm: true, drapm: true, rapm: true },
    _max: { orapm: true, drapm: true, rapm: true }
  });

  console.log('PlayerImpact Statistics:');
  console.log(`  Complete records (O+D+Net): ${impactStats._count.id}`);
  console.log(`  ORAPM range: ${impactStats._min.orapm?.toFixed(2)} to ${impactStats._max.orapm?.toFixed(2)}, avg: ${impactStats._avg.orapm?.toFixed(2)}`);
  console.log(`  DRAPM range: ${impactStats._min.drapm?.toFixed(2)} to ${impactStats._max.drapm?.toFixed(2)}, avg: ${impactStats._avg.drapm?.toFixed(2)}`);
  console.log(`  Net RAPM range: ${impactStats._min.rapm?.toFixed(2)} to ${impactStats._max.rapm?.toFixed(2)}, avg: ${impactStats._avg.rapm?.toFixed(2)}\n`);

  // PlayerRapm statistics (actual target)
  const rampActualStats = await prisma.playerRapm.aggregate({
    where: {
      season,
      target: 'actual',
      orapm: { not: null },
      drapm: { not: null },
      rapm: { not: null }
    },
    _count: { id: true },
    _avg: { orapm: true, drapm: true, rapm: true },
    _min: { orapm: true, drapm: true, rapm: true },
    _max: { orapm: true, drapm: true, rapm: true }
  });

  console.log('PlayerRapm (actual) Statistics:');
  console.log(`  Complete records (O+D+Net): ${rampActualStats._count.id}`);
  console.log(`  ORAPM range: ${rampActualStats._min.orapm?.toFixed(2)} to ${rampActualStats._max.orapm?.toFixed(2)}, avg: ${rampActualStats._avg.orapm?.toFixed(2)}`);
  console.log(`  DRAPM range: ${rampActualStats._min.drapm?.toFixed(2)} to ${rampActualStats._max.drapm?.toFixed(2)}, avg: ${rampActualStats._avg.drapm?.toFixed(2)}`);
  console.log(`  Net RAPM range: ${rampActualStats._min.rapm?.toFixed(2)} to ${rampActualStats._max.rapm?.toFixed(2)}, avg: ${rampActualStats._avg.rapm?.toFixed(2)}\n`);

  // 3. Get combined player data for comparison
  console.log('3. COMBINED PLAYER DATA ANALYSIS');
  console.log('================================');

  const playersWithBothData = await prisma.player.findMany({
    where: {
      AND: [
        {
          impact: {
            some: { season }
          }
        },
        {
          seasonStats: {
            some: { season }
          }
        }
      ]
    },
    include: {
      impact: {
        where: { season }
      },
      seasonStats: {
        where: { season },
        include: { team: true }
      }
    }
  });

  const playersWithRampData = await prisma.playerRapm.findMany({
    where: { season, target: 'actual' },
    include: {
      player: {
        include: {
          seasonStats: {
            where: { season },
            include: { team: true }
          }
        }
      }
    }
  });

  console.log(`Players with PlayerImpact data: ${playersWithBothData.length}`);
  console.log(`Players with PlayerRapm data: ${playersWithRampData.length}\n`);

  // 4. Create combined dataset for analysis
  const combinedData: PlayerRampData[] = [];

  // Add all players from PlayerImpact
  for (const player of playersWithBothData) {
    const impact = player.impact[0];
    const seasonStats = player.seasonStats[0];

    if (!seasonStats) continue;

    const rampRecord = playersWithRampData.find(r => r.playerId === player.id);

    const calculated_impact_net = impact?.orapm !== null && impact?.drapm !== null
      ? (impact.orapm + impact.drapm) : null;
    const calculated_ramp_net = rampRecord?.orapm !== null && rampRecord?.drapm !== null
      ? (rampRecord.orapm + rampRecord.drapm) : null;

    combinedData.push({
      playerId: player.id,
      playerName: player.name || `Player ${player.id}`,
      team: seasonStats.team?.school || 'Unknown',
      season,
      games: seasonStats.games,
      minutes: seasonStats.minutes,
      possessions: impact?.possessions || null,

      // PlayerImpact
      impact_orapm: impact?.orapm || null,
      impact_drapm: impact?.drapm || null,
      impact_rapm: impact?.rapm || null,
      impact_calculated_net: calculated_impact_net,
      impact_orapm_expected: impact?.orapmExpected || null,
      impact_drapm_expected: impact?.drapmExpected || null,
      impact_confidence: impact?.confidence || null,
      impact_possessions: impact?.possessions || null,

      // PlayerRapm
      rapm_orapm: rampRecord?.orapm || null,
      rapm_drapm: rampRecord?.drapm || null,
      rapm_rapm: rampRecord?.rapm || null,
      rapm_calculated_net: calculated_ramp_net,
      rapm_off_poss: rampRecord?.offPossUsed || null,
      rapm_def_poss: rampRecord?.defPossUsed || null,
      ramp_target: rampRecord?.target || null,

      // Validation
      impact_net_matches_sum: impact?.rapm !== null && calculated_impact_net !== null
        ? Math.abs(impact.rapm - calculated_impact_net) < 0.01 : false,
      rapm_net_matches_sum: rampRecord?.rapm !== null && calculated_ramp_net !== null
        ? Math.abs(rampRecord.rapm - calculated_ramp_net) < 0.01 : false,
      tables_match: impact?.rapm !== null && rampRecord?.rapm !== null
        ? Math.abs(impact.rapm - rampRecord.rapm) < 0.01 : false
    });
  }

  console.log(`Combined dataset: ${combinedData.length} players\n`);

  // 5. Net RAPM calculation validation
  console.log('4. NET RAPM CALCULATION VALIDATION');
  console.log('==================================');

  const impactWithData = combinedData.filter(p => p.impact_rapm !== null && p.impact_calculated_net !== null);
  const rampWithData = combinedData.filter(p => p.rapm_rapm !== null && p.rapm_calculated_net !== null);

  const impactMismatches = impactWithData.filter(p => !p.impact_net_matches_sum);
  const rampMismatches = rampWithData.filter(p => !p.rapm_net_matches_sum);

  console.log(`PlayerImpact Net = ORAPM + DRAPM check:`);
  console.log(`  Total with data: ${impactWithData.length}`);
  console.log(`  Matches (within 0.01): ${impactWithData.length - impactMismatches.length}`);
  console.log(`  Mismatches: ${impactMismatches.length}`);

  if (impactMismatches.length > 0 && impactMismatches.length <= 5) {
    console.log(`  Example mismatches:`);
    impactMismatches.slice(0, 5).forEach(p => {
      console.log(`    ${p.playerName}: stored=${p.impact_rapm?.toFixed(3)}, calculated=${p.impact_calculated_net?.toFixed(3)}`);
    });
  }

  console.log(`\nPlayerRapm Net = ORAPM + DRAPM check:`);
  console.log(`  Total with data: ${rampWithData.length}`);
  console.log(`  Matches (within 0.01): ${rampWithData.length - rampMismatches.length}`);
  console.log(`  Mismatches: ${rampMismatches.length}`);

  if (rampMismatches.length > 0 && rampMismatches.length <= 5) {
    console.log(`  Example mismatches:`);
    rampMismatches.slice(0, 5).forEach(p => {
      console.log(`    ${p.playerName}: stored=${p.rapm_rapm?.toFixed(3)}, calculated=${p.rapm_calculated_net?.toFixed(3)}`);
    });
  }

  // 6. Cross-table comparison
  console.log('\n5. CROSS-TABLE DATA COMPARISON');
  console.log('==============================');

  const bothTables = combinedData.filter(p => p.impact_rapm !== null && p.rapm_rapm !== null);
  const onlyImpact = combinedData.filter(p => p.impact_rapm !== null && p.ramp_target === null);
  const onlyRamp = combinedData.filter(p => p.impact_rapm === null && p.rapm_rapm !== null);
  const matching = bothTables.filter(p => p.tables_match);

  console.log(`Players in both tables: ${bothTables.length}`);
  console.log(`Only in PlayerImpact: ${onlyImpact.length}`);
  console.log(`Only in PlayerRapm: ${onlyRamp.length}`);
  console.log(`Cross-table Net RAPM matches (within 0.01): ${matching.length}/${bothTables.length}`);

  if (bothTables.length - matching.length > 0 && bothTables.length - matching.length <= 10) {
    console.log(`\nExample cross-table mismatches:`);
    const mismatches = bothTables.filter(p => !p.tables_match);
    mismatches.slice(0, 5).forEach(p => {
      console.log(`  ${p.playerName}: Impact=${p.impact_rapm?.toFixed(3)}, Rapm=${p.rapm_rapm?.toFixed(3)}`);
    });
  }

  // 7. Top 25 leaderboards from each table
  console.log('\n6. TOP 25 NET RAPM LEADERBOARDS');
  console.log('===============================');

  const impactTop25 = combinedData
    .filter(p => p.impact_rapm !== null)
    .sort((a, b) => (b.impact_rapm! - a.impact_rapm!))
    .slice(0, 25);

  const rampTop25 = combinedData
    .filter(p => p.rapm_rapm !== null)
    .sort((a, b) => (b.rapm_rapm! - a.rapm_rapm!))
    .slice(0, 25);

  console.log('TOP 25 from PlayerImpact:');
  console.log('Rank | Player Name              | Team               | Net RAPM | ORAPM | DRAPM | Games');
  console.log('-'.repeat(90));
  impactTop25.forEach((p, i) => {
    const rank = (i + 1).toString().padStart(4);
    const name = p.playerName.slice(0, 24).padEnd(24);
    const team = (p.team.slice(0, 18)).padEnd(18);
    const net = p.impact_rapm!.toFixed(1).padStart(8);
    const orapm = p.impact_orapm?.toFixed(1).padStart(5) || '    —';
    const drapm = p.impact_drapm?.toFixed(1).padStart(5) || '    —';
    const games = (p.games || 0).toString().padStart(5);

    console.log(`${rank} | ${name} | ${team} |${net} |${orapm} |${drapm} |${games}`);
  });

  console.log('\nTOP 25 from PlayerRapm (actual):');
  console.log('Rank | Player Name              | Team               | Net RAPM | ORAPM | DRAPM | OPoss');
  console.log('-'.repeat(90));
  rampTop25.forEach((p, i) => {
    const rank = (i + 1).toString().padStart(4);
    const name = p.playerName.slice(0, 24).padEnd(24);
    const team = (p.team.slice(0, 18)).padEnd(18);
    const net = p.rapm_rapm!.toFixed(1).padStart(8);
    const orapm = p.rapm_orapm?.toFixed(1).padStart(5) || '    —';
    const drapm = p.rapm_drapm?.toFixed(1).padStart(5) || '    —';
    const poss = (p.rapm_off_poss || 0).toString().padStart(5);

    console.log(`${rank} | ${name} | ${team} |${net} |${orapm} |${drapm} |${poss}`);
  });

  // 8. Check specific benchmark players
  console.log('\n7. BENCHMARK PLAYER LOOKUP');
  console.log('==========================');

  const benchmarkPlayers = [
    'Cameron Boozer',
    'Yaxel Lendeborg',
    'Keaton Wagler',
    'Jeremy Fears Jr.',
    'Bruce Thornton',
    'Joshua Jefferson',
    'Nate Heise',
    'Isaiah Evans',
    'Fletcher Loyer',
    'RJ Godfrey'
  ];

  for (const benchmarkName of benchmarkPlayers) {
    const found = combinedData.find(p =>
      p.playerName.toLowerCase().includes(benchmarkName.toLowerCase()) ||
      benchmarkName.toLowerCase().includes(p.playerName.toLowerCase().split(' ')[0]) ||
      benchmarkName.toLowerCase().includes(p.playerName.toLowerCase().split(' ').slice(-1)[0])
    );

    if (found) {
      console.log(`✅ ${benchmarkName}:`);
      console.log(`   ID: ${found.playerId}, Name: "${found.playerName}", Team: ${found.team}`);
      console.log(`   Games: ${found.games}, Season: ${found.season}`);
      console.log(`   PlayerImpact: ORAPM=${found.impact_orapm?.toFixed(2) || 'null'}, DRAPM=${found.impact_drapm?.toFixed(2) || 'null'}, Net=${found.impact_rapm?.toFixed(2) || 'null'}`);
      console.log(`   PlayerRapm: ORAPM=${found.rapm_orapm?.toFixed(2) || 'null'}, DRAPM=${found.rapm_drapm?.toFixed(2) || 'null'}, Net=${found.rapm_rapm?.toFixed(2) || 'null'}`);
      console.log(`   Net = O+D: Impact=${found.impact_net_matches_sum}, Rapm=${found.rapm_net_matches_sum}`);
      console.log(`   Tables match: ${found.tables_match}\n`);
    } else {
      console.log(`❌ ${benchmarkName}: Not found in our database for ${season}\n`);
    }
  }

  // 9. Summary and recommendations
  console.log('8. SUMMARY AND RECOMMENDATIONS');
  console.log('==============================');

  let recommendation = '';

  if (rampCount > impactCount) {
    recommendation = 'PlayerRapm appears to be the newer/canonical source';
  } else if (impactCount > rampCount) {
    recommendation = 'PlayerImpact appears to have more data coverage';
  } else {
    recommendation = 'Similar data coverage, check recency/quality';
  }

  console.log(`Data Coverage: ${recommendation}`);
  console.log(`Net RAPM Calculation Issues: Impact=${impactMismatches.length}, Rapm=${rampMismatches.length}`);
  console.log(`Cross-table Matches: ${matching.length}/${bothTables.length} (${(matching.length/bothTables.length*100).toFixed(1)}%)`);

  if (rampActualCount > 0 && rampActualCount >= impactCount * 0.9) {
    console.log('\n🎯 RECOMMENDATION: Use PlayerRapm as canonical source');
    console.log('   - Similar or better data coverage');
    console.log('   - Separate targets (actual/xefg)');
    console.log('   - Direct from model pipeline');
  } else if (impactCount > rampActualCount) {
    console.log('\n🎯 RECOMMENDATION: Sync PlayerRapm data to PlayerImpact');
    console.log('   - PlayerImpact has better coverage');
    console.log('   - Update pipeline to populate PlayerImpact');
  } else {
    console.log('\n⚠️  RECOMMENDATION: Further investigation needed');
  }

  return {
    impactCount,
    rampCount,
    rampActualCount,
    combinedData,
    impactTop25,
    rampTop25,
    impactMismatches: impactMismatches.length,
    rampMismatches: rampMismatches.length,
    crossTableMatches: matching.length,
    bothTablesCount: bothTables.length
  };
}

auditRampTables()
  .catch(console.error)
  .finally(() => prisma.$disconnect());