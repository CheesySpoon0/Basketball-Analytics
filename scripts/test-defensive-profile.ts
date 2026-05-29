#!/usr/bin/env npx tsx
import { buildPlayerScoutingReport } from '../lib/player-scouting';
import { prisma } from '../lib/prisma.js';

async function testDefensiveProfile() {
  console.log('=== TESTING NEW DEFENSIVE PROFILE ===\n');

  // Find a Michigan State player for 2026 season
  const testPlayer = await prisma.playerSeasonStats.findFirst({
    where: {
      season: 2026,
      minutes: { gt: 300 }, // decent sample
      team: { school: 'Michigan State' }
    },
    include: {
      player: true,
      team: true
    }
  });

  if (!testPlayer) {
    console.log('No suitable test player found');
    return;
  }

  console.log(`Testing player: ${testPlayer.player.name} (${testPlayer.team?.school})\n`);

  // Build the scouting report with new defensive profile
  const report = await buildPlayerScoutingReport(testPlayer.playerId, 2026);

  if (!report) {
    console.log('Failed to build scouting report');
    return;
  }

  const defense = report.observedDefenseProfile;

  if (!defense) {
    console.log('No defensive profile generated (likely no teamId)');
    return;
  }

  console.log('=== OBSERVED DEFENSIVE IMPACT ===');
  console.log(`Confidence: ${defense.confidence}`);
  console.log(`Sample: ${defense.sampleNote}`);
  console.log(`Defensive possessions: ${defense.defensivePossessions}`);
  console.log('');

  if (defense.drapm !== null) {
    console.log('=== RAPM METRICS ===');
    console.log(`DRAPM: ${defense.drapm.toFixed(2)}`);
    console.log(`Expected DRAPM: ${defense.drapmExpected?.toFixed(2) ?? 'N/A'}`);
    console.log(`DRAPM vs Expected: ${defense.drapmDelta ? (defense.drapmDelta >= 0 ? '+' : '') + defense.drapmDelta.toFixed(2) : 'N/A'}`);
    console.log(`DRAPM Confidence: ${defense.drapmConfidence ?? 'N/A'}`);
    console.log('');
  }

  if (defense.showOnCourtMetrics) {
    console.log('=== ON-COURT METRICS ===');
    console.log(`On-court DRtg: ${defense.onCourtDRtg?.toFixed(1) ?? 'N/A'}`);
    console.log(`Forced TO%: ${defense.forcedTurnoverPct?.toFixed(1) ?? 'N/A'}%`);
    console.log('');
  }

  if (defense.showDetailedRates) {
    console.log('=== INDIVIDUAL RATES (per 40) ===');
    console.log(`Steals: ${defense.stealsPer40?.toFixed(1) ?? 'N/A'}`);
    console.log(`Blocks: ${defense.blocksPer40?.toFixed(1) ?? 'N/A'}`);
    console.log(`Defensive rebounds: ${defense.defReboundsPer40?.toFixed(1) ?? 'N/A'}`);
    console.log(`Fouls: ${defense.foulsPer40?.toFixed(1) ?? 'N/A'}`);
  }

  console.log('\n=== TEST COMPLETE ===');
}

testDefensiveProfile()
  .catch(console.error)
  .finally(() => prisma.$disconnect());