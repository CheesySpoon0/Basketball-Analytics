#!/usr/bin/env tsx
import 'dotenv/config';
import { PrismaClient } from '../app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// Stored coords: full court 940 (length, X) × 495 (width, Y), in tenths of feet.
// Half-court SVG: 470 wide (baseline→half, our SVG-X) × 500 tall (sideline→sideline, our SVG-Y).
// We swap axes so the basket is at the bottom and the court extends upward (typical shot chart layout).
// Result: SVG viewBox is 500 × 470. svgX = court-Y (width). svgY = court-X distance from baseline.
export function shotToSvgCoords(rawX: number, rawY: number): { svgX: number; svgY: number; flipped: boolean } {
  let courtX = rawX;
  let flipped = false;
  if (rawX > 470) {
    courtX = 940 - rawX;
    flipped = true;
  }
  return {
    svgX: rawY,         // court width → svgX (0..500)
    svgY: courtX,       // distance from baseline → svgY (0..470). Basket at svgY ≈ 52.5
    flipped,
  };
}

async function main() {
  const rimShots = await prisma.play.findMany({
    where: { shotRange: 'rim', shotX: { not: null }, shotY: { not: null } },
    take: 10,
    select: { shotX: true, shotY: true, shotMade: true, playText: true },
  });

  console.log('🎯 Transform verification — rim shots should map near (svgX=250, svgY≈52)\n');
  console.log('Raw → Transformed:');
  rimShots.forEach((s, i) => {
    const { svgX, svgY, flipped } = shotToSvgCoords(s.shotX!, s.shotY!);
    const distFromRim = Math.sqrt((svgX - 250) ** 2 + (svgY - 52.5) ** 2);
    console.log(
      `  [${i + 1}] raw=(${s.shotX}, ${s.shotY})${flipped ? ' [flipped]' : ''} → svg=(${svgX.toFixed(1)}, ${svgY.toFixed(1)})  dist-from-rim=${distFromRim.toFixed(1)}u (${(distFromRim / 10).toFixed(1)} ft)`
    );
  });

  // Aggregate check: how close do all rim shots cluster to the basket?
  const allRim = await prisma.play.findMany({
    where: { shotRange: 'rim', shotX: { not: null }, shotY: { not: null } },
    select: { shotX: true, shotY: true },
  });
  const distances = allRim.map((s) => {
    const { svgX, svgY } = shotToSvgCoords(s.shotX!, s.shotY!);
    return Math.sqrt((svgX - 250) ** 2 + (svgY - 52.5) ** 2);
  });
  const avgDist = distances.reduce((a, b) => a + b, 0) / distances.length;
  const within50 = distances.filter((d) => d < 50).length;
  console.log(`\nAll ${allRim.length} rim shots:`);
  console.log(`  avg distance from rim: ${avgDist.toFixed(1)} units (${(avgDist / 10).toFixed(1)} ft)`);
  console.log(`  within 5 ft of rim: ${within50} (${((within50 / allRim.length) * 100).toFixed(1)}%)`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
