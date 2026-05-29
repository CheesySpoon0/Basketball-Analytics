#!/usr/bin/env npx ts-node
import { prisma } from '../lib/prisma.js';

async function auditDefensiveData() {
  console.log('=== AUDITING AVAILABLE DEFENSIVE DATA ===\n');

  // 1. Check PlayerSeasonStats defensive fields
  console.log('1. PlayerSeasonStats defensive fields available:');
  const samplePlayerStats = await prisma.playerSeasonStats.findFirst({
    where: { season: 2026, minutes: { gt: 100 } },
  });

  if (samplePlayerStats) {
    const defensiveFields = [
      'steals', 'blocks', 'defRebounds', 'fouls', 'minutes', 'games'
    ];
    console.log('Available fields:');
    defensiveFields.forEach(field => {
      const value = (samplePlayerStats as any)[field];
      console.log(`  - ${field}: ${value} (type: ${typeof value})`);
    });
  }

  // 2. Check PlayerImpact defensive fields
  console.log('\n2. PlayerImpact defensive fields available:');
  const sampleImpact = await prisma.playerImpact.findFirst({
    where: { season: 2026 },
  });

  if (sampleImpact) {
    const impactFields = [
      'drapm', 'drapmExpected', 'confidence', 'possessions', 'minutes'
    ];
    console.log('Available fields:');
    impactFields.forEach(field => {
      const value = (sampleImpact as any)[field];
      console.log(`  - ${field}: ${value} (type: ${typeof value})`);
    });
  }

  // 3. Check LineupStint opponent/defensive fields
  console.log('\n3. LineupStint opponent/defensive fields available:');
  const sampleStint = await prisma.lineupStint.findFirst({
    where: {
      season: 2026,
      confidence: 'full',
      possessionsAgainst: { gt: 0 }
    },
  });

  if (sampleStint) {
    // Look for opponent-related fields
    const allFields = Object.keys(sampleStint);
    const opponentFields = allFields.filter(field =>
      field.includes('Against') ||
      field.includes('opp') ||
      field.includes('Opp') ||
      field.includes('defensive') ||
      field.includes('Defensive')
    );

    console.log('Opponent/defensive fields found:');
    opponentFields.forEach(field => {
      const value = (sampleStint as any)[field];
      console.log(`  - ${field}: ${value} (type: ${typeof value})`);
    });

    console.log('\nOther potentially useful defensive fields:');
    const otherFields = ['pointsAgainst', 'possessionsAgainst', 'steals', 'blocks', 'defRebounds', 'turnovers'];
    otherFields.forEach(field => {
      if (field in sampleStint) {
        const value = (sampleStint as any)[field];
        console.log(`  - ${field}: ${value} (type: ${typeof value})`);
      }
    });
  }

  // 4. Check if we have opponent shot data in Play table
  console.log('\n4. Play table - opponent shot data when player is on court:');
  const samplePlay = await prisma.play.findFirst({
    where: {
      shotRange: { not: null },
      game: { season: 2026 }
    },
  });

  if (samplePlay) {
    const shotFields = ['shotRange', 'shotMade', 'shotX', 'shotY', 'teamId', 'playerId'];
    console.log('Shot-related fields available:');
    shotFields.forEach(field => {
      const value = (samplePlay as any)[field];
      console.log(`  - ${field}: ${value} (type: ${typeof value})`);
    });
  }

  // 5. Sample a player's LineupStint data to see defensive calculations possible
  console.log('\n5. Sample player defensive stint data:');
  const testPlayer = await prisma.playerSeasonStats.findFirst({
    where: {
      season: 2026,
      minutes: { gt: 300 } // decent sample
    },
    include: { team: true, player: true }
  });

  if (testPlayer) {
    console.log(`\nAnalyzing ${testPlayer.player.name} (${testPlayer.team?.school}) - ${2026}:`);

    // Find LineupStints where this player was on court
    const stints = await prisma.lineupStint.findMany({
      where: {
        season: 2026,
        teamId: testPlayer.teamId!,
        confidence: 'full',
        playerIds: { contains: testPlayer.playerId.toString() },
        possessionsAgainst: { gt: 0 }
      },
      take: 10
    });

    console.log(`Found ${stints.length} valid defensive stints for analysis:`);

    if (stints.length > 0) {
      let totalPossAgainst = 0;
      let totalPointsAgainst = 0;
      let totalStints = 0;

      stints.forEach(stint => {
        totalPossAgainst += stint.possessionsAgainst || 0;
        totalPointsAgainst += stint.pointsAgainst || 0;
        totalStints++;
      });

      if (totalPossAgainst > 0) {
        const onCourtDRtg = (totalPointsAgainst / totalPossAgainst) * 100;
        console.log(`  - On-court DRtg: ${onCourtDRtg.toFixed(1)} (${totalPointsAgainst} pts allowed / ${totalPossAgainst.toFixed(1)} poss)`);
        console.log(`  - Sample size: ${totalStints} stints, ${totalPossAgainst.toFixed(1)} defensive possessions`);
      }
    }
  }

  console.log('\n=== AUDIT COMPLETE ===');
}

auditDefensiveData()
  .catch(console.error)
  .finally(() => prisma.$disconnect());