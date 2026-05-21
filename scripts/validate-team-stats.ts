#!/usr/bin/env tsx
/**
 * Team Four-Factors validation report with realistic-range checks.
 * Recomputes every displayed stat exactly as the team page does and flags
 * any value outside its expected range.
 */
import 'dotenv/config';
import { prisma } from '../lib/prisma';

const TEAMS = [308, 310, 311];
const SEASONS = [2025, 2026];

const RANGES: Record<string, [number, number]> = {
  'eFG%': [40, 60],
  'TOV%': [10, 25],
  'OREB%': [15, 45],
  'FTr%': [15, 50],
  ORtg: [85, 130],
  Pace: [55, 80],
};

function check(name: string, value: number | null): string {
  if (value === null) return 'unavailable';
  const r = RANGES[name];
  if (!r) return 'ok';
  return value >= r[0] && value <= r[1] ? 'PASS' : `FAIL (expect ${r[0]}-${r[1]})`;
}

async function main() {
  for (const teamId of TEAMS) {
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    for (const season of SEASONS) {
      const s = await prisma.teamSeasonStats.findUnique({
        where: { teamId_season: { teamId, season } },
      });
      console.log(`\n${'='.repeat(60)}`);
      console.log(`${team?.school} (${teamId}) · ${season - 1}-${String(season).slice(2)}`);
      if (!s) { console.log('  NO ROW'); continue; }

      const games = s.games ?? 0;
      const fga = s.fieldGoalsAttempted ?? 0;
      const fgm = s.fieldGoalsMade ?? 0;
      const tpm = s.threePointsMade ?? 0;
      const fta = s.freeThrowsAttempted ?? 0;
      const oreb = s.offensiveRebounds ?? 0;
      const to = s.turnoversTotal ?? 0;
      const pts = s.pointsTotal ?? 0;
      const oppDreb = s.oppDefensiveRebounds && s.oppDefensiveRebounds > 0 ? s.oppDefensiveRebounds : null;
      const oppPts = s.oppPoints ?? 0;
      const oppPoss = s.oppPossessions ?? 0;

      const efg = fga > 0 ? ((fgm + 0.5 * tpm) / fga) * 100 : null;
      const poss = fga + 0.44 * fta - oreb + to;
      const tovPct = poss > 0 ? (to / poss) * 100 : null;
      const orebPct = oppDreb !== null && oreb + oppDreb > 0 ? (oreb / (oreb + oppDreb)) * 100 : null;
      const ftr = fga > 0 ? (fta / fga) * 100 : null;
      const ortg = poss > 0 ? (pts / poss) * 100 : null;
      const pace = games > 0 ? poss / games : null;
      const drtg = oppPoss > 0 ? (oppPts / oppPoss) * 100 : null;

      console.log(`  record ${s.wins}-${s.losses}  games ${games}  pts ${pts}`);
      console.log(`  FGA ${fga}  FGM ${fgm}  3PM ${tpm}  FTA ${fta}  OREB ${oreb}  TO ${to}`);
      console.log(`  opp DREB ${oppDreb ?? 'MISSING'} (PBP-derived)  oppPts ${oppPts}  oppPoss ${oppPoss.toFixed(0)}`);
      const fmt = (v: number | null, d = 1) => (v === null ? 'N/A' : v.toFixed(d));
      console.log(`  eFG%  ${fmt(efg)}   [${check('eFG%', efg)}]`);
      console.log(`  TOV%  ${fmt(tovPct)}   [${check('TOV%', tovPct)}]`);
      console.log(`  OREB% ${fmt(orebPct)}   [${check('OREB%', orebPct)}]`);
      console.log(`  FTr%  ${fmt(ftr)}   [${check('FTr%', ftr)}]`);
      console.log(`  poss  ${poss.toFixed(0)}`);
      console.log(`  ORtg  ${fmt(ortg)}   [${check('ORtg', ortg)}]`);
      console.log(`  Pace  ${fmt(pace)}   [${check('Pace', pace)}]`);
      console.log(`  DRtg  ${fmt(drtg)}   [${drtg === null ? 'unavailable' : 'ok'}]`);
    }
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
