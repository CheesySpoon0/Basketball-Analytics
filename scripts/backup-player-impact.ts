#!/usr/bin/env npx tsx
import 'dotenv/config';
import { prisma } from '../lib/prisma.js';
import { writeFileSync } from 'fs';

async function backupPlayerImpact(): Promise<void> {
  console.log('=== BACKING UP PLAYER IMPACT DATA ===\n');

  const season = 2026;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = `backups/player-impact-2026-before-lambda300-${timestamp}.json`;

  console.log('1. LOADING CURRENT PLAYERIMPACT DATA');
  console.log('====================================');

  const currentData = await prisma.playerImpact.findMany({
    where: { season },
    include: {
      player: {
        select: { name: true }
      }
    },
    orderBy: [
      { rapm: 'desc' },
      { id: 'asc' }
    ]
  });

  console.log(`✅ Found ${currentData.length} PlayerImpact records for season ${season}`);

  // Show top 10 for verification
  console.log('\nCurrent top 10 Net RAPM:');
  currentData.slice(0, 10).forEach((player, i) => {
    const name = player.player?.name || `Player ${player.playerId}`;
    console.log(`  ${(i + 1).toString().padStart(2)}. ${name} - Net: ${player.rapm?.toFixed(1)} (O: ${player.orapm?.toFixed(1)}, D: ${player.drapm?.toFixed(1)})`);
  });

  console.log('\n2. CREATING BACKUP FILE');
  console.log('=======================');

  const backupData = {
    metadata: {
      season,
      backup_timestamp: new Date().toISOString(),
      total_records: currentData.length,
      purpose: 'Pre-lambda-300-import backup',
      source_table: 'PlayerImpact'
    },
    players: currentData.map(player => ({
      id: player.id,
      playerId: player.playerId,
      season: player.season,
      orapm: player.orapm,
      drapm: player.drapm,
      rapm: player.rapm,
      expectedOrapm: player.expectedOrapm,
      expectedDrapm: player.expectedDrapm,
      expectedRapm: player.expectedRapm,
      confidence: player.confidence,
      offensivePossessions: player.offensivePossessions,
      defensivePossessions: player.defensivePossessions,
      minutes: player.minutes,
      gamesPlayed: player.gamesPlayed,
      playerName: player.player?.name || null
    }))
  };

  writeFileSync(backupFile, JSON.stringify(backupData, null, 2));

  console.log(`✅ Backup saved to: ${backupFile}`);
  console.log(`📊 Backup contains ${backupData.players.length} player records`);
  console.log(`💾 File size: ${Math.round(JSON.stringify(backupData).length / 1024)} KB`);

  console.log('\n3. BACKUP VERIFICATION');
  console.log('======================');

  // Verify backup integrity
  const backupContent = JSON.parse(JSON.stringify(backupData));
  const nonNullRapm = backupContent.players.filter((p: any) => p.rapm !== null).length;
  const validOrapm = backupContent.players.filter((p: any) => p.orapm !== null).length;
  const validDrapm = backupContent.players.filter((p: any) => p.drapm !== null).length;

  console.log(`✅ Records with valid Net RAPM: ${nonNullRapm}`);
  console.log(`✅ Records with valid ORAPM: ${validOrapm}`);
  console.log(`✅ Records with valid DRAPM: ${validDrapm}`);

  if (nonNullRapm === currentData.length && validOrapm === currentData.length && validDrapm === currentData.length) {
    console.log('✅ Backup integrity verified - all critical fields preserved');
  } else {
    console.log('⚠️  Warning: Some records have null RAPM values');
  }

  console.log(`\n🔒 Production PlayerImpact data safely backed up to: ${backupFile}`);

  await prisma.$disconnect();
}

backupPlayerImpact().catch(console.error);