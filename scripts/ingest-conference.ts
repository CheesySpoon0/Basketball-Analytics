#!/usr/bin/env tsx
import 'dotenv/config';
import { PrismaClient } from '../app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { spawn } from 'child_process';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const BIG_WEST_TEAMS = [
  'UC Santa Barbara',
  'UC Irvine',
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

function runIngest(school: string): Promise<{ ok: boolean; durationMs: number }> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsx', 'scripts/ingest-team.ts', school, String(SEASON)], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => {
      resolve({ ok: code === 0, durationMs: Date.now() - start });
    });
  });
}

async function teamHasSeasonStats(school: string, season: number): Promise<boolean> {
  const team = await prisma.team.findFirst({ where: { school } });
  if (!team) return false;
  const stats = await prisma.teamSeasonStats.findUnique({
    where: { teamId_season: { teamId: team.id, season } },
  });
  return stats !== null;
}

async function main() {
  console.log(`🏀 Big West conference ingestion for ${SEASON}\n`);
  console.log(`Teams (${BIG_WEST_TEAMS.length}):`);
  BIG_WEST_TEAMS.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
  console.log('');

  const results: Array<{ school: string; status: 'skipped' | 'ingested' | 'failed'; durationMs?: number }> = [];

  for (const [idx, school] of BIG_WEST_TEAMS.entries()) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`[${idx + 1}/${BIG_WEST_TEAMS.length}] ${school}`);
    console.log('='.repeat(70));

    const already = await teamHasSeasonStats(school, SEASON);
    if (already) {
      console.log(`✓ Already ingested (TeamSeasonStats exists for ${SEASON}) — skipping`);
      results.push({ school, status: 'skipped' });
      continue;
    }

    const { ok, durationMs } = await runIngest(school);
    results.push({ school, status: ok ? 'ingested' : 'failed', durationMs });
    console.log(`\n→ ${school}: ${ok ? '✅ done' : '❌ failed'} in ${(durationMs / 1000).toFixed(1)}s`);
  }

  // ===== Final summary =====
  console.log(`\n\n${'='.repeat(70)}`);
  console.log('CONFERENCE INGESTION COMPLETE');
  console.log('='.repeat(70));

  console.log('\nPer-team status:');
  for (const r of results) {
    const dur = r.durationMs ? ` (${(r.durationMs / 1000).toFixed(1)}s)` : '';
    const icon = r.status === 'ingested' ? '✅' : r.status === 'skipped' ? '⏭️ ' : '❌';
    console.log(`   ${icon} ${r.school} — ${r.status}${dur}`);
  }

  const counts = {
    teams: await prisma.team.count(),
    players: await prisma.player.count(),
    games: await prisma.game.count(),
    plays: await prisma.play.count(),
    teamSeasonStats: await prisma.teamSeasonStats.count(),
    playerSeasonStats: await prisma.playerSeasonStats.count(),
  };

  console.log('\n📊 Final database row counts:');
  for (const [k, v] of Object.entries(counts)) {
    console.log(`   ${k.padEnd(20)} ${v.toLocaleString()}`);
  }

  const playsWithCoords = await prisma.play.count({ where: { shotX: { not: null } } });
  console.log(`\n🎯 Plays with shot coordinates: ${playsWithCoords.toLocaleString()}`);
  console.log(`   (${((playsWithCoords / counts.plays) * 100).toFixed(1)}% of all plays)`);

  const failed = results.filter((r) => r.status === 'failed');
  if (failed.length > 0) {
    console.log(`\n⚠️  ${failed.length} team(s) failed:`);
    failed.forEach((r) => console.log(`   - ${r.school}`));
    process.exit(1);
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (err) => {
  console.error('💥 FAILED:', err);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
