#!/usr/bin/env tsx
/**
 * Rebuild the PlayerXeFG / TeamXeFG cache for a season.
 *
 * Run this:
 *   - once after `python train_model.py` writes new coefficients.json
 *   - any time the underlying play data is refreshed
 *
 * Computes every player + team aggregate in ONE streaming pass over the
 * season's plays (see lib/xefg/aggregate.ts::aggregateSeasonXeFG), then writes
 * the results in batched upserts. At national scale this is minutes, not hours.
 */
import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { aggregateSeasonXeFG, XEFG_MODEL_INFO } from '../lib/xefg';
import type { XeFGAggregate } from '../lib/xefg/types';

const SEASON = parseInt(process.env.XEFG_SEASON ?? '2025', 10);
const UPSERT_BATCH = 25;

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

async function main() {
  console.log(
    `Building xeFG cache for season ${SEASON} ` +
      `(model v${XEFG_MODEL_INFO.modelVersion}, trained ${XEFG_MODEL_INFO.trainedOn})`,
  );

  const t0 = Date.now();
  console.log('\nStreaming season plays (single pass)...');
  const { players, teamOffense, teamDefense } = await aggregateSeasonXeFG(SEASON);
  console.log(
    `  aggregated ${players.size} players, ${teamOffense.size} team-offense, ` +
      `${teamDefense.size} team-defense in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );

  // --- Players ---
  const playerRows = [...players.entries()].filter(([, agg]) => agg.sampleSize > 0);
  console.log(`\nUpserting ${playerRows.length} PlayerXeFG rows...`);
  let pDone = 0;
  await inBatches(playerRows, UPSERT_BATCH, async ([playerId, agg]) => {
    const data = aggToData(agg);
    await prisma.playerXeFG.upsert({
      where: { playerId_season: { playerId, season: SEASON } },
      update: data,
      create: { playerId, season: SEASON, ...data },
    });
    pDone++;
  });
  console.log(`  ${pDone} players cached`);

  // --- Teams (offense + defense) ---
  const teamSides: Array<{ teamId: number; side: 'offense' | 'defense'; agg: XeFGAggregate }> = [];
  for (const [teamId, agg] of teamOffense) {
    if (agg.sampleSize > 0) teamSides.push({ teamId, side: 'offense', agg });
  }
  for (const [teamId, agg] of teamDefense) {
    if (agg.sampleSize > 0) teamSides.push({ teamId, side: 'defense', agg });
  }
  console.log(`\nUpserting ${teamSides.length} TeamXeFG rows...`);
  let tDone = 0;
  await inBatches(teamSides, UPSERT_BATCH, async ({ teamId, side, agg }) => {
    const data = aggToData(agg);
    await prisma.teamXeFG.upsert({
      where: { teamId_season_side: { teamId, season: SEASON, side } },
      update: data,
      create: { teamId, season: SEASON, side, ...data },
    });
    tDone++;
  });
  console.log(`  ${tDone} team-side rows cached`);

  await prisma.$disconnect();
  console.log(`\n✅ xeFG cache rebuild complete in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
}

function aggToData(agg: XeFGAggregate) {
  return {
    sampleSize: agg.sampleSize,
    fgPct: agg.fgPct,
    actualEfg: agg.actualEfg,
    expectedEfg: agg.expectedEfg,
    delta: agg.delta,
    byZone: agg.byZone as object,
    modelVersion: XEFG_MODEL_INFO.modelVersion,
  };
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
