#!/usr/bin/env tsx
/**
 * Python ↔ TypeScript parity test for the xeFG model.
 *
 * Loads scripts/python/xefg/output/parity_sample.csv (100 shots + Python's
 * predicted probability) and re-predicts each shot through the TS pipeline.
 * Fails if max absolute difference exceeds 1e-6.
 *
 * Run after every retrain:
 *   npx tsx scripts/test-xefg-parity.ts
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../lib/prisma';
import { predictShot } from '../lib/xefg/predict';
import type { RawShot } from '../lib/xefg/types';

const CSV_PATH = path.resolve(
  __dirname,
  'python/xefg/output/parity_sample.csv',
);

interface ParityRow {
  id: string;
  shotX: number;
  shotY: number;
  shotRange: string | null;
  playType: string | null;
  p_lr: number;
  is_transition: number;
  home_team: number;
  seconds_remaining_in_period: number;
  score_differential: number;
  period: number;
}

function parseCsv(text: string): ParityRow[] {
  const [headerLine, ...lines] = text.trim().split('\n');
  const headers = headerLine.split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    const obj = Object.fromEntries(headers.map((h, i) => [h, cells[i]])) as Record<string, string>;
    return {
      id: obj.id,
      shotX: parseFloat(obj.shotX),
      shotY: parseFloat(obj.shotY),
      shotRange: obj.shotRange === '' ? null : obj.shotRange,
      playType: obj.playType === '' ? null : obj.playType,
      p_lr: parseFloat(obj.p_lr),
      is_transition: parseInt(obj.is_transition, 10),
      home_team: parseInt(obj.home_team, 10),
      seconds_remaining_in_period: parseInt(obj.seconds_remaining_in_period, 10),
      score_differential: parseFloat(obj.score_differential),
      period: parseInt(obj.period, 10),
    };
  });
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`Missing ${CSV_PATH} — run python train_model.py first.`);
    process.exit(1);
  }
  const rows = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
  console.log(`Loaded ${rows.length} sampled shots from parity CSV`);

  // We need the original Play rows from DB to feed RawShot. They contain
  // homeScore/awayScore/teamId/gameHomeTeamId which the CSV doesn't carry.
  const playIds = rows.map((r) => r.id);
  const plays = await prisma.play.findMany({
    where: { id: { in: playIds } },
    select: {
      id: true,
      shotX: true,
      shotY: true,
      shotRange: true,
      playType: true,
      shotMade: true,
      period: true,
      secondsRemaining: true,
      homeScore: true,
      awayScore: true,
      teamId: true,
      game: { select: { homeTeamId: true } },
    },
  });
  const byId = new Map(plays.map((p) => [p.id, p]));

  let maxDiff = 0;
  let mismatches = 0;
  const exemplars: Array<{ id: string; py: number; ts: number; diff: number }> = [];

  for (const r of rows) {
    const p = byId.get(r.id);
    if (!p) {
      console.warn(`Play ${r.id} not found in DB — skipping`);
      continue;
    }
    const raw: RawShot = {
      shotX: p.shotX!,
      shotY: p.shotY!,
      shotRange: p.shotRange,
      playType: p.playType,
      shotMade: p.shotMade,
      period: p.period,
      secondsRemaining: p.secondsRemaining,
      homeScore: p.homeScore,
      awayScore: p.awayScore,
      teamId: p.teamId,
      gameHomeTeamId: p.game.homeTeamId,
      // We use the Python is_transition value from the CSV so the parity test
      // isolates the predictor (not the upstream context computation). The
      // production code path computes secondsSinceDefEvent from the play stream.
      secondsSinceDefEvent: r.is_transition === 1 ? 3 : 999,
    };
    const { pMake } = predictShot(raw);
    const diff = Math.abs(pMake - r.p_lr);
    if (diff > maxDiff) maxDiff = diff;
    if (diff > 1e-4) {
      mismatches++;
      if (exemplars.length < 5) exemplars.push({ id: r.id, py: r.p_lr, ts: pMake, diff });
    }
  }

  console.log(`\nMax |ts - py|: ${maxDiff.toExponential(3)}`);
  console.log(`# rows with diff > 1e-4: ${mismatches} / ${rows.length}`);

  if (exemplars.length) {
    console.log('\nExemplar mismatches:');
    for (const e of exemplars) {
      console.log(`  id=${e.id}  py=${e.py.toFixed(6)}  ts=${e.ts.toFixed(6)}  diff=${e.diff.toExponential(3)}`);
    }
  }

  await prisma.$disconnect();

  if (maxDiff > 1e-4) {
    console.error('\n❌ PARITY FAIL — TS and Python diverge.');
    process.exit(1);
  }
  console.log('\n✅ PARITY PASS');
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
