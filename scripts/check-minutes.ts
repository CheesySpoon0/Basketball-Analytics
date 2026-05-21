#!/usr/bin/env tsx
import 'dotenv/config';
import { prisma } from '../lib/prisma';

async function main() {
  const sample = await prisma.playerSeasonStats.findMany({
    where: { season: 2025, teamId: 310 },
    include: { player: { select: { name: true } } },
    orderBy: { points: 'desc' },
    take: 12,
  });
  console.log('UCSD 2025 rotation:');
  for (const s of sample) {
    const mpg = (s.games ?? 0) > 0 ? (s.minutes ?? 0) / (s.games ?? 1) : 0;
    console.log(
      `  ${(s.player.name ?? '???').padEnd(26)}  G=${String(s.games).padStart(2)}  MIN=${String(s.minutes).padStart(4)}  MPG=${mpg.toFixed(1).padStart(5)}  PTS=${s.points}`,
    );
  }
  const nonZero = await prisma.playerSeasonStats.count({ where: { season: 2025, minutes: { gt: 0 } } });
  const total = await prisma.playerSeasonStats.count({ where: { season: 2025 } });
  console.log(`\nMinutes populated: ${nonZero} / ${total}`);
  await prisma.$disconnect();
}

main();
