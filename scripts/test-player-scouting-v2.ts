#!/usr/bin/env tsx
/**
 * Phase 2 player-scouting smoke test. Builds the full report for a set of
 * named players across both seasons and prints archetype, top tendencies,
 * and how-to-guard notes so we can eyeball wording variety.
 */
import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { buildPlayerScoutingReport } from '../lib/player-scouting';

const NAMES = [
  'Aniwaniwa Tait-Jones',
  'Tyler McGhie',
  'Hayden Gray',
  'Nordin Kapic',
  'Bent Leuchten',
  'Devin Tillis',
  'Aidan Burke',
];

const pct = (x: number | null | undefined) =>
  x === null || x === undefined ? '—' : `${(x * 100).toFixed(1)}%`;

async function main() {
  for (const name of NAMES) {
    const last = name.split(' ').pop()!;
    const players = await prisma.player.findMany({
      where: { name: { contains: last } },
    });
    const match = players.find((p) => p.name === name) ?? players[0];
    console.log(`\n${'='.repeat(72)}\n${name}`);
    if (!match) {
      console.log('  NOT FOUND');
      continue;
    }
    for (const season of [2025, 2026] as const) {
      const report = await buildPlayerScoutingReport(match.id, season);
      if (!report || report.totalFga === 0) {
        console.log(`  [${season}] no data`);
        continue;
      }
      const t = report.tendencies;
      console.log(`  [${season}] ${report.role.archetype}` +
        (report.role.secondary.length ? ` (+ ${report.role.secondary.join(', ')})` : ''));
      console.log(`         confidence: ${report.confidence.level} (${report.confidence.score})`);
      console.log(`         summary: ${report.role.summary}`);
      console.log(`         diet: rim ${pct(t.rim.share)} / mid ${pct(t.mid.share)} / 3 ${pct(t.three.share)}` +
        `  | xeFG Δ ${pct(t.quality.delta)}`);
      console.log(`         guard notes:`);
      for (const n of report.notes) {
        console.log(`           • ${n.title}: ${n.detail}`);
      }
      if (report.liveWith.length) {
        console.log(`         live with:`);
        for (const n of report.liveWith) console.log(`           • ${n.title}`);
      }
      if (report.deny.length) {
        console.log(`         deny:`);
        for (const n of report.deny) console.log(`           • ${n.title}`);
      }
    }
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
