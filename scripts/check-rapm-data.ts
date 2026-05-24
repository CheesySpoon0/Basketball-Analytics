#!/usr/bin/env npx tsx

import 'dotenv/config';
import { PrismaClient } from '../app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  console.log("🔍 Checking PlayerImpact data...");

  // Get total count
  const totalCount = await prisma.playerImpact.count({
    where: { season: 2026 }
  });
  console.log(`Total PlayerImpact records for season 2026: ${totalCount}`);

  if (totalCount === 0) {
    console.log("❌ No PlayerImpact records found!");
    return;
  }

  // Get sample records
  const sample = await prisma.playerImpact.findMany({
    take: 5,
    where: { season: 2026 },
    include: {
      player: {
        select: { name: true }
      }
    }
  });

  console.log("\nSample records:");
  for (const record of sample) {
    console.log(`${record.player?.name}: ORAPM=${record.orapm}, DRAPM=${record.drapm}, NetRAMP=${record.rapm}, Possessions=${record.possessions}`);
  }

  // Check distribution
  const stats = await prisma.playerImpact.aggregate({
    where: { season: 2026 },
    _avg: {
      orapm: true,
      drapm: true,
      rapm: true
    },
    _count: {
      id: true,
      orapm: true,
      drapm: true,
      rapm: true
    }
  });

  console.log("\nDistribution stats:");
  console.log(`  Records with ORAPM: ${stats._count.orapm}/${stats._count.id}`);
  console.log(`  Records with DRAPM: ${stats._count.drapm}/${stats._count.id}`);
  console.log(`  Records with Net RAPM: ${stats._count.rapm}/${stats._count.id}`);
  console.log(`  Average ORAPM: ${stats._avg.orapm?.toFixed(3)}`);
  console.log(`  Average DRAPM: ${stats._avg.drapm?.toFixed(3)}`);
  console.log(`  Average Net RAPM: ${stats._avg.rapm?.toFixed(3)}`);

  await prisma.$disconnect();
  await pool.end();
}

main();