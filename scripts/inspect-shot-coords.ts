#!/usr/bin/env tsx
import 'dotenv/config';
import { PrismaClient } from '../app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  console.log('🔍 Inspecting stored shot coordinates\n');

  // 1. Overall min/max
  const stats = await prisma.$queryRaw<Array<any>>`
    SELECT
      MIN("shotX") AS min_x, MAX("shotX") AS max_x,
      MIN("shotY") AS min_y, MAX("shotY") AS max_y,
      COUNT(*) AS total
    FROM plays
    WHERE "shotX" IS NOT NULL AND "shotY" IS NOT NULL
  `;
  console.log('1. Overall coord ranges:');
  console.log(stats[0]);

  // 2. Distinct shotRange values
  const ranges = await prisma.$queryRaw<Array<any>>`
    SELECT "shotRange", COUNT(*) as n
    FROM plays
    WHERE "shotRange" IS NOT NULL
    GROUP BY "shotRange"
    ORDER BY n DESC
  `;
  console.log('\n2. Shot range categories:');
  console.log(ranges);

  // 3. Sample 10 rim shots — should cluster near the basket
  console.log('\n3. Sample 10 "rim" shots (should cluster near basket):');
  const rimShots = await prisma.play.findMany({
    where: { shotRange: 'rim', shotX: { not: null }, shotY: { not: null } },
    take: 10,
    select: {
      id: true, gameId: true, teamId: true,
      shotX: true, shotY: true, shotMade: true,
      shotRange: true, playText: true,
    },
  });
  rimShots.forEach((s, i) => {
    console.log(`   [${i + 1}] x=${s.shotX} y=${s.shotY} made=${s.shotMade} | "${s.playText?.slice(0, 80)}"`);
  });

  // 4. Three-pointers — these define the perimeter
  console.log('\n4. Sample 10 "three_pointer" shots:');
  const threes = await prisma.play.findMany({
    where: { shotRange: 'three_pointer', shotX: { not: null }, shotY: { not: null } },
    take: 10,
    select: { shotX: true, shotY: true, shotMade: true, playText: true },
  });
  threes.forEach((s, i) => {
    console.log(`   [${i + 1}] x=${s.shotX} y=${s.shotY} made=${s.shotMade}`);
  });

  // 5. Check if shots fall into two distinct X clusters (both halves of the court)
  console.log('\n5. X-coordinate distribution histogram (10 bins, 0 → maxX):');
  const xDist = await prisma.$queryRaw<Array<any>>`
    SELECT
      width_bucket("shotX", 0, 1000, 10) AS bucket,
      COUNT(*) AS n,
      MIN("shotX") AS bucket_min,
      MAX("shotX") AS bucket_max
    FROM plays
    WHERE "shotX" IS NOT NULL
    GROUP BY bucket
    ORDER BY bucket
  `;
  console.log(xDist);

  // 6. For rim shots, X distribution — should be bimodal if storing both ends
  console.log('\n6. Rim-shot X histogram (smaller bins, should be bimodal near each basket):');
  const rimXDist = await prisma.$queryRaw<Array<any>>`
    SELECT
      width_bucket("shotX", 0, 1000, 20) AS bucket,
      COUNT(*) AS n,
      MIN("shotX") AS bucket_min,
      MAX("shotX") AS bucket_max
    FROM plays
    WHERE "shotRange" = 'rim' AND "shotX" IS NOT NULL
    GROUP BY bucket
    ORDER BY bucket
  `;
  console.log(rimXDist);

  // 7. Y-distribution for rim shots — should cluster near center of width
  console.log('\n7. Rim-shot Y histogram:');
  const rimYDist = await prisma.$queryRaw<Array<any>>`
    SELECT
      width_bucket("shotY", 0, 600, 20) AS bucket,
      COUNT(*) AS n,
      MIN("shotY") AS bucket_min,
      MAX("shotY") AS bucket_max
    FROM plays
    WHERE "shotRange" = 'rim' AND "shotY" IS NOT NULL
    GROUP BY bucket
    ORDER BY bucket
  `;
  console.log(rimYDist);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (err) => {
  console.error('💥', err);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
