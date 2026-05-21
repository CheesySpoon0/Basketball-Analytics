#!/usr/bin/env tsx
/**
 * Smoke-test the deterministic player scouting engine against UCSD's rotation.
 * Prints archetype, shot diet, shot types, creation, top notes.
 */
import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { buildPlayerScoutingReport } from '../lib/player-scouting';

const UCSD = 310;
const NAMES = ['Aidan Burke', 'Nordin Kapic', 'Tyler McGhie', 'Aniwaniwa Tait-Jones', 'Hayden Gray'];

const pct = (x: number | null, d = 1) => (x === null ? '—' : `${(x * 100).toFixed(d)}%`);

async function main() {
  const players = await prisma.player.findMany({
    where: { teamId: UCSD, name: { in: NAMES } },
    select: { id: true, name: true, position: true },
  });

  for (const p of players) {
    const r = await buildPlayerScoutingReport(p.id);
    if (!r) {
      console.log(`\n=== ${p.name} — NO REPORT ===`);
      continue;
    }
    console.log(`\n========== ${r.player.name}  (${r.player.position ?? '—'}) ==========`);
    console.log(`MPG ${r.stats.minutesPerGame?.toFixed(1) ?? '—'}  PPG ${r.stats.ppg.toFixed(1)}  share-of-team-FGA ${pct(r.stats.shareOfTeamFga)}`);
    console.log(`SCOUTING PRIORITY: ${r.scoutingPriority}`);
    console.log(`ARCHETYPE: ${r.role.archetype}`);
    console.log(`  ${r.role.summary}`);
    console.log(`SHOT DIET: rim ${pct(r.zones.rim.share)} @ ${pct(r.zones.rim.pct)} | mid ${pct(r.zones.mid.share)} @ ${pct(r.zones.mid.pct)} | three ${pct(r.zones.three.share)} @ ${pct(r.zones.three.pct)}`);
    console.log(`SHOT TYPE: layup ${r.shotTypes.layup.att}@${pct(r.shotTypes.layup.pct)} | dunk ${r.shotTypes.dunk.att}@${pct(r.shotTypes.dunk.pct)} | jumper ${r.shotTypes.jumper.att}@${pct(r.shotTypes.jumper.pct)} | tip ${r.shotTypes.tip.att}`);
    console.log(`3 SUBZONE: corner ${r.threeSubzones.corner.att}@${pct(r.threeSubzones.corner.pct)} | above-break ${r.threeSubzones.above_break.att}@${pct(r.threeSubzones.above_break.pct)}`);
    console.log(`CREATION: assistedRate ${pct(r.creation.assistedRate)} | assisted-3 ${pct(r.creation.assistedThreeRate)} | assisted-rim ${pct(r.creation.assistedRimRate)} | unassisted-jumper ${pct(r.creation.unassistedJumperRate)}`);
    console.log(`DEFENSIVE (inferred): ${r.defenseProxy.descriptor}`);
    console.log(`NOTES (guarding):`);
    for (const n of r.notes) {
      const ev = n.evidence.map((e) => `${e.label}=${e.value}`).join(', ');
      console.log(`  [P${n.priority}] ${n.title} — ${n.detail}`);
      console.log(`        ${ev}`);
    }
    if (r.liveWith.length) {
      console.log(`LIVE WITH:`);
      for (const n of r.liveWith) console.log(`  ${n.title} — ${n.detail}`);
    }
    if (r.deny.length) {
      console.log(`DENY:`);
      for (const n of r.deny) console.log(`  ${n.title} — ${n.detail}`);
    }
    if (r.caveats.length) console.log(`CAVEATS: ${r.caveats.join(' | ')}`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
