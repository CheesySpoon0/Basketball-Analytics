#!/usr/bin/env tsx
// One-off: verify whether the 2025 substitution coverage gap is a CBBD source
// limitation or an old-ingest artifact. Samples 2025 games that have ZERO
// Substitution plays in our DB and re-fetches raw CBBD play-by-play.
import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { getPlays } from '../lib/cbbd';

async function main() {
  // Find 2025 games that have plays but zero Substitution plays.
  const games = await prisma.game.findMany({
    where: { season: 2025 },
    select: { id: true, homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
    orderBy: { id: 'asc' },
  });

  // Filter to games that have plays but no subs — sample 10 spread across the season.
  const candidates: Array<{ id: number; homeTeamId: number | null; awayTeamId: number | null }> = [];
  for (const g of games) {
    const totalPlays = await prisma.play.count({ where: { gameId: g.id } });
    if (totalPlays === 0) continue;
    const subs = await prisma.play.count({ where: { gameId: g.id, playType: 'Substitution' } });
    if (subs === 0) {
      candidates.push(g);
    }
    if (candidates.length >= 400) break; // enough to sample from
  }

  // Sample 10 evenly across the candidate list.
  const sample: typeof candidates = [];
  const step = Math.max(1, Math.floor(candidates.length / 10));
  for (let i = 0; i < candidates.length && sample.length < 10; i += step) {
    sample.push(candidates[i]);
  }

  console.log(`\nCandidates (2025 games with plays, zero subs): ${candidates.length}`);
  console.log(`Sampling ${sample.length} games for raw CBBD re-fetch.\n`);

  let cbbdHasSubs = 0;
  let cbbdNoSubs = 0;
  const refreshNeeded: number[] = [];

  for (const g of sample) {
    const teams = `home=${g.homeTeamId} away=${g.awayTeamId}`;
    const dbSubs = await prisma.play.count({ where: { gameId: g.id, playType: 'Substitution' } });
    const dbTotal = await prisma.play.count({ where: { gameId: g.id } });

    let rawSubs = 0;
    let rawTotal = 0;
    let rawErr: string | null = null;
    try {
      const plays = await getPlays(g.id, false);
      rawTotal = plays.length;
      rawSubs = plays.filter((p) => p.playType === 'Substitution').length;
    } catch (err) {
      rawErr = err instanceof Error ? err.message : String(err);
    }

    if (rawErr) {
      console.log(`game ${g.id} (${teams}): DB subs=${dbSubs}/${dbTotal} | CBBD ERROR: ${rawErr}`);
    } else if (rawSubs > 0) {
      cbbdHasSubs++;
      refreshNeeded.push(g.id);
      console.log(
        `game ${g.id} (${teams}): DB subs=${dbSubs}/${dbTotal} | ` +
        `CBBD subs=${rawSubs}/${rawTotal}  ⚠ CBBD NOW HAS SUBS — ingest skipped them`,
      );
    } else {
      cbbdNoSubs++;
      console.log(
        `game ${g.id} (${teams}): DB subs=${dbSubs}/${dbTotal} | ` +
        `CBBD subs=${rawSubs}/${rawTotal}  ✓ source limitation (CBBD has none)`,
      );
    }
    // gentle pacing
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('VERDICT');
  console.log(`${'='.repeat(60)}`);
  console.log(`  Games where CBBD now returns subs (ingest gap): ${cbbdHasSubs}`);
  console.log(`  Games where CBBD has no subs (source limit):    ${cbbdNoSubs}`);
  if (cbbdHasSubs > 0) {
    console.log(`\n  → A "force refresh PBP" path would recover ${cbbdHasSubs}/${sample.length} sampled games.`);
    console.log(`  → Games needing refresh: ${refreshNeeded.join(', ')}`);
  } else {
    console.log(`\n  → 2025 sub gap is a genuine CBBD source limitation. Leave 2025 as partial coverage.`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
