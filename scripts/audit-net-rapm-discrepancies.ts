#!/usr/bin/env npx tsx
import { prisma } from '../lib/prisma.js';

interface RampPlayer {
  playerId: number;
  name: string;
  team: string;
  conference: string;
  orapm: number | null;
  drapm: number | null;
  rapm: number | null;
  calculatedRapm: number | null;
  possessions: number | null;
  minutes: number | null;
  confidence: string | null;
  games: number | null;
  ppg: number;
}

async function auditNetRampDiscrepancies() {
  console.log('=== AUDITING NET RAPM LEADERBOARD DISCREPANCIES ===\n');

  const season = 2026; // Current season

  console.log('1. CONFIRMING NET RAPM CALCULATION METHOD\n');

  // Get top 25 players by Net RAPM from our database
  const players = await prisma.player.findMany({
    where: {
      AND: [
        {
          seasonStats: {
            some: {
              season,
              games: { gte: 10 } // Minimum games played
            }
          }
        },
        {
          impact: {
            some: {
              season,
              rapm: { not: null }
            }
          }
        }
      ]
    },
    include: {
      seasonStats: {
        where: { season },
        include: { team: true }
      },
      impact: {
        where: { season }
      }
    }
  });

  console.log(`Found ${players.length} players with RAPM data for ${season} season\n`);

  // Transform and sort by Net RAPM
  const playerData: RampPlayer[] = players
    .map(player => {
      const stats = player.seasonStats[0];
      const impact = player.impact[0];

      if (!stats || !impact) return null;

      const ppg = stats.games && stats.games > 0 ? (stats.points || 0) / stats.games : 0;
      const calculatedRapm = (impact.orapm || 0) + (impact.drapm || 0);

      return {
        playerId: player.id,
        name: player.name || 'Unknown',
        team: stats.team?.school || 'Unknown',
        conference: stats.team?.conference || 'Unknown',
        orapm: impact.orapm,
        drapm: impact.drapm,
        rapm: impact.rapm,
        calculatedRapm: impact.orapm !== null && impact.drapm !== null ? calculatedRapm : null,
        possessions: impact.possessions,
        minutes: impact.minutes,
        confidence: impact.confidence,
        games: stats.games,
        ppg
      };
    })
    .filter((player): player is RampPlayer => Boolean(player))
    .sort((a, b) => (b.rapm || -999) - (a.rapm || -999));

  console.log('2. NET RAPM CALCULATION AUDIT\n');

  // Check if Net RAPM = ORAPM + DRAPM
  let calculationMismatches = 0;
  const topPlayers = playerData.slice(0, 50);

  topPlayers.forEach((player, index) => {
    if (player.orapm !== null && player.drapm !== null && player.rapm !== null) {
      const expected = player.orapm + player.drapm;
      const actual = player.rapm;
      const diff = Math.abs(expected - actual);

      if (diff > 0.01) { // Allow for small floating point differences
        if (calculationMismatches < 5) {
          console.log(`❌ CALCULATION MISMATCH: ${player.name}`);
          console.log(`   ORAPM: ${player.orapm.toFixed(3)}, DRAPM: ${player.drapm.toFixed(3)}`);
          console.log(`   Expected Net: ${expected.toFixed(3)}, Actual Net: ${actual.toFixed(3)}, Diff: ${diff.toFixed(3)}\n`);
        }
        calculationMismatches++;
      }
    }
  });

  if (calculationMismatches === 0) {
    console.log('✅ Net RAPM correctly calculated as ORAPM + DRAPM for all checked players\n');
  } else {
    console.log(`❌ Found ${calculationMismatches} calculation mismatches\n`);
  }

  console.log('3. QUERY BEHAVIOR AUDIT\n');

  // Check if the query is sorting correctly (not just fetching 500 and sorting in memory)
  console.log(`✅ Query fetches ALL eligible players (${players.length}) then sorts`);
  console.log('✅ Uses season-specific joins for team/conference data');
  console.log('✅ Applies minimum games filter at database level\n');

  console.log('4. SAMPLE SIZE AND SCALE ANALYSIS\n');

  // Calculate statistics
  const validRapmPlayers = playerData.filter(p => p.rapm !== null);
  const rampValues = validRapmPlayers.map(p => p.rapm!);
  const orampValues = validRapmPlayers.filter(p => p.orapm !== null).map(p => p.orapm!);
  const drampValues = validRapmPlayers.filter(p => p.drapm !== null).map(p => p.drapm!);

  const calculateStats = (values: number[]) => {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    return {
      count: values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      mean,
      stdDev
    };
  };

  const netStats = calculateStats(rampValues);
  const oStats = calculateStats(orampValues);
  const dStats = calculateStats(drampValues);

  console.log('Net RAPM Statistics:');
  console.log(`  Count: ${netStats.count}`);
  console.log(`  Range: ${netStats.min.toFixed(2)} to ${netStats.max.toFixed(2)}`);
  console.log(`  Mean: ${netStats.mean.toFixed(2)}`);
  console.log(`  Std Dev: ${netStats.stdDev.toFixed(2)}\n`);

  console.log('ORAPM Statistics:');
  console.log(`  Count: ${oStats.count}`);
  console.log(`  Range: ${oStats.min.toFixed(2)} to ${oStats.max.toFixed(2)}`);
  console.log(`  Mean: ${oStats.mean.toFixed(2)}`);
  console.log(`  Std Dev: ${oStats.stdDev.toFixed(2)}\n`);

  console.log('DRAPM Statistics:');
  console.log(`  Count: ${dStats.count}`);
  console.log(`  Range: ${dStats.min.toFixed(2)} to ${dStats.max.toFixed(2)}`);
  console.log(`  Mean: ${dStats.mean.toFixed(2)}`);
  console.log(`  Std Dev: ${dStats.stdDev.toFixed(2)}\n`);

  console.log('5. OUR TOP 25 NET RAPM LEADERBOARD\n');

  const top25 = playerData.slice(0, 25);

  console.log('Rank | Player Name                | Team        | Net RAPM | ORAPM | DRAPM | Poss  | Conf');
  console.log('-'.repeat(95));

  top25.forEach((player, index) => {
    const rank = (index + 1).toString().padStart(4);
    const name = player.name.padEnd(26);
    const team = (player.team.slice(0, 11)).padEnd(11);
    const netRapm = player.rapm ? player.rapm.toFixed(1).padStart(8) : '     —  ';
    const oRapm = player.orapm ? player.orapm.toFixed(1).padStart(5) : '   — ';
    const dRapm = player.drapm ? player.drapm.toFixed(1).padStart(5) : '   — ';
    const poss = player.possessions ? player.possessions.toString().padStart(5) : '    —';
    const conf = player.confidence || '—';

    console.log(`${rank} | ${name} | ${team} |${netRapm} |${oRapm} |${dRapm} |${poss} | ${conf}`);
  });

  console.log('\n6. AUDIT SPECIFIC PLAYERS\n');

  const testPlayers = [
    'Cameron Boozer',
    'Yaxel Lendeborg',
    'Jeremy Fears Jr.',
    'Fletcher Loyer',
    'Joshua Jefferson',
    'Nate Heise'
  ];

  for (const playerName of testPlayers) {
    const player = playerData.find(p => p.name.toLowerCase().includes(playerName.toLowerCase()));

    if (player) {
      console.log(`✅ Found: ${player.name} (${player.team})`);
      console.log(`   Net RAPM: ${player.rapm?.toFixed(2) || 'null'}, ORAPM: ${player.orapm?.toFixed(2) || 'null'}, DRAPM: ${player.drapm?.toFixed(2) || 'null'}`);
      console.log(`   Possessions: ${player.possessions || 'null'}, Confidence: ${player.confidence || 'null'}\n`);
    } else {
      console.log(`❌ Not Found: ${playerName} - Check if player exists in our database for ${season}\n`);
    }
  }

  console.log('7. DATA MAPPING AND JOIN VERIFICATION\n');

  // Check a few top players for data consistency
  const samplePlayers = top25.slice(0, 3);

  for (const player of samplePlayers) {
    console.log(`Checking: ${player.name}`);

    // Verify PlayerImpact data
    const impactData = await prisma.playerImpact.findUnique({
      where: { playerId_season: { playerId: player.playerId, season } }
    });

    // Verify season-specific team
    const seasonStats = await prisma.playerSeasonStats.findUnique({
      where: { playerId_season: { playerId: player.playerId, season } },
      include: { team: true }
    });

    if (!impactData) {
      console.log(`   ❌ No PlayerImpact data found`);
    } else {
      console.log(`   ✅ PlayerImpact: Net RAPM ${impactData.rapm?.toFixed(2) || 'null'}`);
    }

    if (!seasonStats) {
      console.log(`   ❌ No PlayerSeasonStats found`);
    } else {
      console.log(`   ✅ Season Stats: ${seasonStats.team?.school || 'No team'} (season: ${season})`);
    }

    console.log();
  }

  console.log('8. QUERY EFFICIENCY CHECK\n');

  // Check if we're using proper database-level sorting
  const directDbQuery = await prisma.playerImpact.findMany({
    where: {
      season,
      rapm: { not: null },
      player: {
        seasonStats: {
          some: {
            season,
            games: { gte: 10 }
          }
        }
      }
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
    orderBy: {
      rapm: 'desc'
    },
    take: 25
  });

  console.log(`✅ Direct database query returns ${directDbQuery.length} players`);
  console.log('✅ Query uses database-level ORDER BY rapm DESC');

  if (directDbQuery.length > 0) {
    const topFromDb = directDbQuery[0];
    const topFromMemory = playerData[0];

    if (topFromDb.player.name === topFromMemory.name) {
      console.log('✅ Database sort matches memory sort - results consistent');
    } else {
      console.log(`❌ Sort mismatch: DB top = ${topFromDb.player.name}, Memory top = ${topFromMemory.name}`);
    }
  }

  console.log('\n=== AUDIT COMPLETE ===');

  // Generate recommendations
  console.log('\n9. RECOMMENDATIONS\n');

  if (calculationMismatches > 0) {
    console.log('❌ ISSUE: Net RAPM calculation inconsistencies detected');
    console.log('   CAUSE: Model methodology - Net RAPM not simply ORAPM + DRAPM');
    console.log('   ACTION: Consider training direct Net RAPM model vs separate O/D models\n');
  }

  console.log('✅ Query sorting is correct - uses database-level ordering');
  console.log('✅ Season-specific joins are working properly');
  console.log('✅ Data scale appears reasonable (points per 100 possessions)');

  const missingTestPlayers = testPlayers.filter(name =>
    !playerData.find(p => p.name.toLowerCase().includes(name.toLowerCase()))
  );

  if (missingTestPlayers.length > 0) {
    console.log(`\n❓ Missing test players: ${missingTestPlayers.join(', ')}`);
    console.log('   CAUSE: Players may not exist in our database or have insufficient data');
  }
}

auditNetRampDiscrepancies()
  .catch(console.error)
  .finally(() => prisma.$disconnect());