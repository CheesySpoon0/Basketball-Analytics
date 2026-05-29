#!/usr/bin/env npx tsx
import 'dotenv/config'; // Load environment variables first
import { prisma } from '../lib/prisma.js';

interface ConnectionTestResult {
  success: boolean;
  error?: string;
  databaseUrl?: string;
  directUrl?: string;
  tableCounts?: {
    teams: number;
    players: number;
    playerSeasonStats: number;
    playerRapm: number;
  };
}

async function testDatabaseConnection(): Promise<ConnectionTestResult> {
  console.log('=== DATABASE CONNECTION TEST ===\n');

  // 1. Check environment variables
  console.log('1. ENVIRONMENT VARIABLES');
  console.log('========================');

  const databaseUrl = process.env.DATABASE_URL;
  const directUrl = process.env.DIRECT_URL;

  if (!databaseUrl) {
    console.log('❌ DATABASE_URL not found in environment');
    return { success: false, error: 'DATABASE_URL not found' };
  }

  // Mask the URL for security (show only structure)
  const maskedUrl = databaseUrl.replace(/:([^:@]+)@/, ':***@');
  console.log(`✅ DATABASE_URL exists: ${maskedUrl}`);

  if (directUrl) {
    const maskedDirectUrl = directUrl.replace(/:([^:@]+)@/, ':***@');
    console.log(`✅ DIRECT_URL exists: ${maskedDirectUrl}`);
  }

  // 2. Test Prisma connection
  console.log('\n2. PRISMA CONNECTION TEST');
  console.log('=========================');

  try {
    // Test basic connection
    await prisma.$connect();
    console.log('✅ Prisma connected successfully');

    // 3. Test table access with safe counts
    console.log('\n3. TABLE ACCESS TEST');
    console.log('===================');

    const [teamCount, playerCount, seasonStatsCount, playerRapmCount] = await Promise.all([
      prisma.team.count(),
      prisma.player.count(),
      prisma.playerSeasonStats.count({ where: { season: 2026 } }),
      prisma.playerRapm.count({ where: { season: 2026, target: 'actual' } })
    ]);

    console.log(`Teams: ${teamCount.toLocaleString()}`);
    console.log(`Players: ${playerCount.toLocaleString()}`);
    console.log(`Player Season Stats (2026): ${seasonStatsCount.toLocaleString()}`);
    console.log(`Player RAPM (2026, actual): ${playerRapmCount.toLocaleString()}`);

    const tableCounts = {
      teams: teamCount,
      players: playerCount,
      playerSeasonStats: seasonStatsCount,
      playerRapm: playerRapmCount
    };

    console.log('\n✅ ALL TESTS PASSED - Database connection working');

    return {
      success: true,
      databaseUrl: maskedUrl,
      directUrl: directUrl ? directUrl.replace(/:([^:@]+)@/, ':***@') : undefined,
      tableCounts
    };

  } catch (error) {
    console.log(`❌ Database connection failed: ${error}`);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      databaseUrl: maskedUrl,
      directUrl: directUrl ? directUrl.replace(/:([^:@]+)@/, ':***@') : undefined
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  try {
    const result = await testDatabaseConnection();

    if (result.success) {
      console.log('\n🎯 DATABASE CONNECTION: SUCCESS');
      process.exit(0);
    } else {
      console.log('\n❌ DATABASE CONNECTION: FAILED');
      console.log(`Error: ${result.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Connection test script failed:', error);
    process.exit(1);
  }
}

main().catch(console.error);