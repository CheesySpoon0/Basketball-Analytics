#!/usr/bin/env tsx
/**
 * Audit script for team_season_stats.
 * Prints all Big West rows with the key derived fields used by the team page.
 * Read-only — does not modify the DB.
 */
import 'dotenv/config';
import { PrismaClient } from '../app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const BIG_WEST = [
  'UC Irvine',
  'UC Santa Barbara',
  'Long Beach State',
  'Cal Poly',
  'Cal State Bakersfield',
  'Cal State Fullerton',
  'Cal State Northridge',
  "Hawai'i",
  'UC Davis',
  'UC Riverside',
  'UC San Diego',
];

const SEASON = 2025;

function pad(s: string | number, n: number, right = false) {
  const str = String(s);
  return right ? str.padEnd(n) : str.padStart(n);
}

async function main() {
  const teams = await prisma.team.findMany({ where: { school: { in: BIG_WEST } } });
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const stats = await prisma.teamSeasonStats.findMany({
    where: { teamId: { in: teams.map((t) => t.id) }, season: SEASON },
  });

  console.log(`Big West TeamSeasonStats audit — season ${SEASON}`);
  console.log('='.repeat(120));
  console.log(
    [
      pad('School', 22, true),
      pad('G', 3),
      pad('W-L', 6),
      pad('Pts', 5),
      pad('FGA', 5),
      pad('FGM', 5),
      pad('3PA', 5),
      pad('FTA', 5),
      pad('OREB', 5),
      pad('DREB', 5),
      pad('TO', 4),
      pad('AST', 4),
      pad('Poss', 6),
      pad('ORtg', 6),
      pad('Pace', 6),
      pad('eFG%', 6),
      pad('FTR', 6),
    ].join(' ')
  );
  console.log('-'.repeat(120));

  const rows: Array<{ school: string; fta: number; oreb: number; ftr: number; poss: number }> = [];

  for (const s of stats) {
    const t = teamById.get(s.teamId);
    if (!t) continue;
    const fga = s.fieldGoalsAttempted ?? 0;
    const fgm = s.fieldGoalsMade ?? 0;
    const tpa = s.threePointsAttempted ?? 0;
    const tpm = s.threePointsMade ?? 0;
    const fta = s.freeThrowsAttempted ?? 0;
    const oreb = s.offensiveRebounds ?? 0;
    const dreb = s.defensiveRebounds ?? 0;
    const to = s.turnoversTotal ?? 0;
    const ast = s.assists ?? 0;
    const pts = s.pointsTotal ?? 0;
    const g = s.games ?? 0;
    const poss = fga + 0.44 * fta - oreb + to;
    const ortg = poss > 0 ? (pts / poss) * 100 : 0;
    const pace = g > 0 ? poss / g : 0;
    const efg = fga > 0 ? (fgm + 0.5 * tpm) / fga : 0;
    const ftr = fga > 0 ? fta / fga : 0;

    const flag = fta === 0 || oreb === 0 || dreb === 0 ? ' ⚠️' : '';

    console.log(
      [
        pad(t.school, 22, true),
        pad(g, 3),
        pad(`${s.wins}-${s.losses}`, 6),
        pad(pts, 5),
        pad(fga, 5),
        pad(fgm, 5),
        pad(tpa, 5),
        pad(fta, 5),
        pad(oreb, 5),
        pad(dreb, 5),
        pad(to, 4),
        pad(ast, 4),
        pad(poss.toFixed(0), 6),
        pad(ortg.toFixed(1), 6),
        pad(pace.toFixed(1), 6),
        pad((efg * 100).toFixed(1), 6),
        pad(ftr.toFixed(3), 6),
      ].join(' ') + flag
    );
    rows.push({ school: t.school, fta, oreb, ftr, poss });
  }

  console.log('-'.repeat(120));
  const broken = rows.filter((r) => r.fta === 0 || r.oreb === 0);
  if (broken.length) {
    console.log(`\n⚠️  ${broken.length} team(s) with FTA=0 or OREB=0 (likely ingestion mapping bug):`);
    broken.forEach((r) => console.log(`   - ${r.school}: FTA=${r.fta}, OREB=${r.oreb}`));
  } else {
    console.log('\n✅ All Big West rows have non-zero FTA and OREB.');
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error('💥', e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
