#!/usr/bin/env tsx
/**
 * Smoke-test the tactical engine against several Big West opponents.
 * Prints fired rule counts and a one-line summary per rule so we can confirm
 * opponent-specificity (different teams should not light up the same set).
 */
import 'dotenv/config';
import { buildMatchupData, runTacticalEngine, partitionFiredRules } from '../lib/tactical-engine';
import { prisma } from '../lib/prisma';

const UCI_TEAM_ID = 308;
const SEASON = 2025;

const OPPONENTS = [
  { school: 'UC Santa Barbara' },
  { school: 'UC San Diego' },
  { school: 'Cal Poly' },
  { school: 'Cal State Northridge' },
  { school: "Hawai'i" },
];

async function main() {
  for (const { school } of OPPONENTS) {
    const team = await prisma.team.findFirst({ where: { school } });
    if (!team) {
      console.log(`\n=== ${school}: team not found, skipping ===`);
      continue;
    }
    const data = await buildMatchupData(UCI_TEAM_ID, team.id, SEASON);
    if (!data) {
      console.log(`\n=== ${school}: matchup data not available, skipping ===`);
      continue;
    }
    const fired = runTacticalEngine(data, { maxResults: Infinity });
    const { attack, defend } = partitionFiredRules(fired);

    console.log('\n' + '='.repeat(76));
    console.log(`${school}  (id=${team.id})`);
    console.log('='.repeat(76));
    console.log(
      `Profile: ${data.opponent.record} · pace=${fmt(data.opponent.pace)} · ` +
        `eFG=${fmtPct(data.opponent.efgPct)} · OREB=${fmtPct(data.opponent.orebPct)} · ` +
        `TOV=${fmtPct(data.opponent.tovPct)} · FTR=${fmtPct(data.opponent.ftr)} · ` +
        `defeFG=${fmtPct(data.opponent.oppEfgAllowed)}`,
    );
    console.log(
      `Def zones allowed (n=${data.opponent.oppFgaTracked ?? '—'}): ` +
        `rim ${fmtPct(data.opponent.oppRimFgPct)} on ${data.opponent.oppRimFga ?? '—'} att · ` +
        `mid ${fmtPct(data.opponent.oppMidFgPct)} on ${data.opponent.oppMidFga ?? '—'} att · ` +
        `3PT ${fmtPct(data.opponent.oppThreePctAllowed)} on ${data.opponent.oppThreePaAllowed ?? '—'} att`,
    );
    console.log(
      `Top players: ${data.opponentTopPlayers
        .slice(0, 4)
        .map((p) => `${p.name} ${p.ppg.toFixed(1)}p`)
        .join(', ')}`,
    );

    console.log(`\nFired: ${fired.length} total  (attack=${attack.length}  defend=${defend.length})`);
    for (const r of fired) {
      const tag = r.playerName ? ` [${r.playerName}]` : '';
      console.log(`  P${r.priority} ${r.category.padEnd(9)} ${r.id}${tag}`);
      console.log(`         → ${r.recommendation.slice(0, 130)}${r.recommendation.length > 130 ? '…' : ''}`);
    }
  }

  await prisma.$disconnect();
}

function fmt(n: number | null): string {
  return n === null ? '—' : n.toFixed(1);
}
function fmtPct(n: number | null): string {
  return n === null ? '—' : (n * 100).toFixed(1) + '%';
}

main().catch(async (e) => {
  console.error('💥', e);
  await prisma.$disconnect();
  process.exit(1);
});
