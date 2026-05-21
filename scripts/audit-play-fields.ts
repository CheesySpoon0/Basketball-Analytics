#!/usr/bin/env tsx
/**
 * Audit what's actually in our Play rows for scouting-engine planning.
 * Specifically:
 *   - distinct shotRange values
 *   - distinct playType values (do they distinguish layup/dunk/jumper/tip?)
 *   - assisted vs unassisted distribution
 *   - playText samples per shot type (so we can text-classify if range alone is too coarse)
 *   - corner-three classifier feasibility (sample x/y for three_pointer shots)
 *   - clock / period coverage
 */
import 'dotenv/config';
import { prisma } from '../lib/prisma';

const SEASON = 2025;

async function main() {
  // 1) Distinct shotRange values
  const ranges = await prisma.play.groupBy({
    by: ['shotRange'],
    where: { game: { season: SEASON } },
    _count: { _all: true },
    orderBy: { _count: { shotRange: 'desc' } },
  });
  console.log('=== shotRange distribution ===');
  for (const r of ranges) {
    console.log(`  ${(r.shotRange ?? 'NULL').padEnd(18)}  n=${r._count._all}`);
  }

  // 2) Distinct playType values (only on rows with shotMade not null, to get shot plays)
  const playTypes = await prisma.play.groupBy({
    by: ['playType'],
    where: { game: { season: SEASON }, shotMade: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { playType: 'desc' } },
    take: 40,
  });
  console.log('\n=== playType distribution (shot plays only) ===');
  for (const t of playTypes) {
    console.log(`  ${(t.playType ?? 'NULL').padEnd(28)}  n=${t._count._all}`);
  }

  // 3) Assisted shots
  const total = await prisma.play.count({
    where: { game: { season: SEASON }, shotMade: { not: null }, shotRange: { not: 'free_throw' } },
  });
  const asstNotNull = await prisma.play.count({
    where: { game: { season: SEASON }, shotMade: { not: null }, shotRange: { not: 'free_throw' }, shotAssisted: { not: null } },
  });
  const asstTrue = await prisma.play.count({
    where: { game: { season: SEASON }, shotMade: { not: null }, shotRange: { not: 'free_throw' }, shotAssisted: true },
  });
  console.log('\n=== shotAssisted coverage ===');
  console.log(`  total FGAs: ${total}`);
  console.log(`  with shotAssisted set: ${asstNotNull}`);
  console.log(`  shotAssisted=true: ${asstTrue}`);

  // 4) playText samples by playType (look for "Layup", "Dunk", "Tip", "Jumper" etc)
  console.log('\n=== playText samples (8 per shot playType) ===');
  for (const t of playTypes.slice(0, 6)) {
    if (!t.playType) continue;
    const samples = await prisma.play.findMany({
      where: { game: { season: SEASON }, playType: t.playType, playText: { not: null } },
      select: { playText: true, shotRange: true, shotMade: true },
      take: 6,
    });
    console.log(`\n  playType="${t.playType}"`);
    for (const s of samples) {
      console.log(`    [${s.shotRange ?? '—'} ${s.shotMade ? 'M' : 'm'}] ${(s.playText ?? '').slice(0, 110)}`);
    }
  }

  // 5) Corner three classifier — sample x/y for three_pointer shots, then bucket
  const threes = await prisma.play.findMany({
    where: { game: { season: SEASON }, shotRange: 'three_pointer', shotX: { not: null } },
    select: { shotX: true, shotY: true, shotMade: true },
    take: 4000,
  });
  console.log(`\n=== three_pointer sample (n=${threes.length}) ===`);
  // Half-court SVG transform: courtX = rawX > 470 ? 940-rawX : rawX; svgX = rawY; svgY = 350 - courtX
  // Court is 50ft wide → x: 0..500 SVG units (~10/ft); basket at svgY=297.5.
  // Corner threes: |svgX - 250| > 200 (i.e. > ~20ft sideways from center) AND svgY < 90 (close to baseline)
  let corner = 0, abovebreak = 0;
  for (const t of threes) {
    const courtX = t.shotX! > 470 ? 940 - t.shotX! : t.shotX!;
    const svgX = t.shotY!;
    const svgY = 350 - courtX;
    const dx = svgX - 250;
    // Heuristic: corner means low Y (close to baseline) and far X. After this 50-ft court → 10 svg/ft,
    // NCAA corner-3 sideline x = ±21.667 ft → ±216.7 from center. Top-of-arc Y is at ~71 from baseline (basket Y=297.5, radius=22.146*10=221.5, so top at 76).
    const isCorner = Math.abs(dx) > 180 && svgY > 250; // svgY > 250 means closer to baseline (basket at 297.5)
    if (isCorner) corner++; else abovebreak++;
  }
  console.log(`  corner~       ${corner}  (${((corner / threes.length) * 100).toFixed(1)}%)`);
  console.log(`  above-break~  ${abovebreak}  (${((abovebreak / threes.length) * 100).toFixed(1)}%)`);

  // 6) clock + period coverage
  const withClock = await prisma.play.count({ where: { game: { season: SEASON }, secondsRemaining: { not: null } } });
  const withPeriod = await prisma.play.count({ where: { game: { season: SEASON }, period: { not: null } } });
  console.log('\n=== clock/period coverage ===');
  console.log(`  plays with secondsRemaining: ${withClock}`);
  console.log(`  plays with period: ${withPeriod}`);

  // 7) Late-clock proxy — last 5s of shot clock is impossible without shot-clock data,
  //    but we can use last 30s of the period as "end-of-period" proxy.
  const lastPeriodShots = await prisma.play.count({
    where: {
      game: { season: SEASON },
      shotMade: { not: null },
      shotRange: { not: 'free_throw' },
      secondsRemaining: { lt: 30 },
    },
  });
  console.log(`  shots with <30s left in period: ${lastPeriodShots}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
