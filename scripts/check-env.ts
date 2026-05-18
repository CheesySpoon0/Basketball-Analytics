import 'dotenv/config';
import { PrismaClient } from '../app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { getTeams } from '../lib/cbbd';

const ok = (m: string) => console.log(`✅ ${m}`);
const bad = (m: string) => console.log(`❌ ${m}`);

async function main() {
  console.log('🏀 Basketball Scouting Environment Check\n');

  // 1. Env vars
  console.log('1. Environment Variables');
  const required = ['DATABASE_URL', 'DIRECT_URL', 'CBBD_API_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const missing = required.filter((k) => !process.env[k] || process.env[k]!.trim() === '');
  if (missing.length) {
    bad(`Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
  required.forEach((k) => ok(`${k} is set`));

  // 2. CBBD API
  console.log('\n2. CBBD API');
  try {
    const teams = await getTeams({ conference: 'Big West', year: 2026 });
    ok(`Got ${teams.length} Big West teams`);
    teams.forEach((t, i) => console.log(`   ${i + 1}. ${t.school}`));
  } catch (e) {
    bad(`CBBD API failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3. Prisma + Supabase
  console.log('\n3. Database Connection');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const result = await prisma.$queryRaw`SELECT 1 as ok`;
    ok(`DB reachable: ${JSON.stringify(result)}`);
  } catch (e) {
    bad(`DB query failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 4. Tables
  console.log('\n4. Schema (table existence)');
  try {
    const counts = {
      teams: await prisma.team.count(),
      players: await prisma.player.count(),
      games: await prisma.game.count(),
      plays: await prisma.play.count(),
      teamSeasonStats: await prisma.teamSeasonStats.count(),
      playerSeasonStats: await prisma.playerSeasonStats.count(),
    };
    ok(`All 6 tables exist`);
    Object.entries(counts).forEach(([k, v]) => console.log(`   ${k}: ${v}`));
  } catch (e) {
    bad(`Table check failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error('💥', e);
  process.exit(1);
});
