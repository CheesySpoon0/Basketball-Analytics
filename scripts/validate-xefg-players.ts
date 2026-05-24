#!/usr/bin/env tsx
/**
 * Spot-check xeFG cache for known players (sniff test).
 */
import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { formatDelta, formatRate } from '../lib/xefg';

const seasonArg = process.argv.find((a) => a.startsWith('--season='));
const SEASON = seasonArg ? Number(seasonArg.split('=')[1]) : 2025;

const CHECKS: Array<{ name: string; teamId?: number }> = [
  { name: 'Tyler McGhie', teamId: 310 },
  { name: 'Hayden Gray', teamId: 310 },
  { name: 'Aniwaniwa Tait-Jones', teamId: 310 },
  { name: 'Nordin Kapic', teamId: 266 },
  { name: 'Bent Leuchten' },
];

async function main() {
  console.log(`xeFG player spot-check · season ${SEASON}\n`);

  for (const c of CHECKS) {
    const player = await prisma.player.findFirst({
      where: c.teamId
        ? { name: c.name, teamId: c.teamId }
        : { name: { contains: c.name.split(' ').pop() } },
    });
    if (!player) {
      console.log(`— ${c.name}: not found\n`);
      continue;
    }
    const row = await prisma.playerXeFG.findUnique({
      where: { playerId_season: { playerId: player.id, season: SEASON } },
    });
    if (!row) {
      console.log(`— ${player.name}: no xeFG cache (run compute-xefg-cache)\n`);
      continue;
    }
    console.log(`${player.name} (id ${player.id})`);
    console.log(
      `  actual eFG ${formatRate(row.actualEfg)} | expected ${formatRate(row.expectedEfg)} | Δ ${formatDelta(row.delta)} | n=${row.sampleSize}`,
    );
    const bz = row.byZone as Record<string, { actualEfg: number | null; expectedEfg: number | null }>;
    for (const z of ['rim', 'mid', 'three'] as const) {
      const zr = bz[z];
      if (!zr) continue;
      console.log(
        `  ${z}: actual ${formatRate(zr.actualEfg)} expected ${formatRate(zr.expectedEfg)}`,
      );
    }
    console.log('');
  }

  const ucsd = await prisma.teamXeFG.findMany({
    where: { teamId: 310, season: SEASON },
  });
  console.log('UCSD team xeFG:');
  for (const t of ucsd) {
    console.log(
      `  ${t.side}: actual ${formatRate(t.actualEfg)} expected ${formatRate(t.expectedEfg)} Δ ${formatDelta(t.delta)}`,
    );
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
