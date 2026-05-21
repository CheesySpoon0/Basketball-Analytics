#!/usr/bin/env tsx
/** Audit playType distribution (all plays, not just shots) so we can design
 *  the transition / defensive-event detector correctly. */
import 'dotenv/config';
import { prisma } from '../lib/prisma';

async function main() {
  const rows = await prisma.play.groupBy({
    by: ['playType'],
    where: { game: { season: 2025 } },
    _count: { _all: true },
    orderBy: { _count: { playType: 'desc' } },
    take: 80,
  });
  console.log('=== playType distribution (all plays) ===');
  for (const r of rows) {
    console.log(`  ${(r.playType ?? 'NULL').padEnd(36)} n=${r._count._all}`);
  }
  await prisma.$disconnect();
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
