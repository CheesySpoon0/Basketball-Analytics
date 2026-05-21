#!/usr/bin/env tsx
/**
 * Refresh team_season_stats (and player_season_stats) for one or more schools.
 * Uses the SAME upsert payload as ingest-team.ts. Safe to rerun.
 *
 * Usage:
 *   npx tsx scripts/refresh-season-stats.ts "UC Santa Barbara"
 *   npx tsx scripts/refresh-season-stats.ts --all-big-west
 */
import 'dotenv/config';
import { PrismaClient } from '../app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const BASE = 'https://api.collegebasketballdata.com';
const auth = { Authorization: `Bearer ${process.env.CBBD_API_KEY}` };
const SEASON = 2025;

const BIG_WEST = [
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

async function fetchJson(url: string) {
  const res = await fetch(url, { headers: auth });
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`);
  return res.json();
}

async function refreshOne(school: string) {
  const team = await prisma.team.findFirst({ where: { school } });
  if (!team) {
    console.log(`   ⚠️  ${school}: team not in DB, skipping`);
    return;
  }

  // Team season stats
  const teamStatsArr = await fetchJson(`${BASE}/stats/team/season?team=${encodeURIComponent(school)}&season=${SEASON}`);
  const ts = teamStatsArr[0];
  if (!ts) {
    console.log(`   ⚠️  ${school}: no team season stats from CBBD`);
    return;
  }
  const s = ts.teamStats;
  const teamStatsData = {
    teamId: team.id,
    season: SEASON,
    games: ts.games,
    wins: ts.wins,
    losses: ts.losses,
    pointsTotal: s.points?.total ?? 0,
    pointsInPaint: s.points?.inPaint ?? 0,
    pointsFastBreak: s.points?.fastBreak ?? 0,
    pointsOffTurnovers: s.points?.offTurnovers ?? 0,
    fieldGoalsMade: s.fieldGoals?.made ?? 0,
    fieldGoalsAttempted: s.fieldGoals?.attempted ?? 0,
    threePointsMade: s.threePointFieldGoals?.made ?? 0,
    threePointsAttempted: s.threePointFieldGoals?.attempted ?? 0,
    freeThrowsMade: s.freeThrows?.made ?? 0,
    freeThrowsAttempted: s.freeThrows?.attempted ?? 0,
    offensiveRebounds: s.rebounds?.offensive ?? 0,
    defensiveRebounds: s.rebounds?.defensive ?? 0,
    totalRebounds: s.rebounds?.total ?? 0,
    assists: s.assists ?? 0,
    steals: s.steals ?? 0,
    blocks: s.blocks ?? 0,
    turnoversTotal: s.turnovers?.total ?? 0,
    turnoversTeam: s.turnovers?.teamTotal ?? 0,
    foulsTotal: s.fouls?.total ?? 0,
    foulsTechnical: s.fouls?.technical ?? 0,
    foulsFlagrant: s.fouls?.flagrant ?? 0,
  };
  await prisma.teamSeasonStats.upsert({
    where: { teamId_season: { teamId: team.id, season: SEASON } },
    create: teamStatsData,
    update: teamStatsData,
  });
  console.log(
    `   ✅ ${school.padEnd(22)} — ${ts.games}G ${ts.wins}-${ts.losses} · ${s.points?.total} pts · ${s.fieldGoals?.made}/${s.fieldGoals?.attempted} FG · ${s.freeThrows?.attempted} FTA · ${s.rebounds?.offensive} OREB · ${s.rebounds?.defensive} DREB`
  );

  // Player season stats (re-refresh too — same root bug)
  const players = await fetchJson(`${BASE}/stats/player/season?team=${encodeURIComponent(school)}&season=${SEASON}`);
  const validPlayerIds = new Set<number>(
    (await prisma.player.findMany({ select: { id: true } })).map((p) => p.id)
  );
  let refreshed = 0;
  for (const p of players) {
    if (!validPlayerIds.has(p.athleteId)) continue;
    const playerStatsData = {
      playerId: p.athleteId,
      teamId: p.teamId,
      season: p.season,
      games: p.games,
      gamesStarted: p.starts,
      minutes: p.minutes,
      points: p.points,
      rebounds: p.rebounds?.total ?? 0,
      offRebounds: p.rebounds?.offensive ?? 0,
      defRebounds: p.rebounds?.defensive ?? 0,
      assists: p.assists,
      steals: p.steals,
      blocks: p.blocks,
      turnovers: p.turnovers,
      fouls: p.fouls,
      fieldGoalsMade: p.fieldGoals?.made ?? 0,
      fieldGoalsAttempted: p.fieldGoals?.attempted ?? 0,
      threePointsMade: p.threePointFieldGoals?.made ?? 0,
      threePointsAttempted: p.threePointFieldGoals?.attempted ?? 0,
      freeThrowsMade: p.freeThrows?.made ?? 0,
      freeThrowsAttempted: p.freeThrows?.attempted ?? 0,
    };
    await prisma.playerSeasonStats.upsert({
      where: { playerId_season: { playerId: p.athleteId, season: SEASON } },
      create: playerStatsData,
      update: playerStatsData,
    });
    refreshed++;
  }
  console.log(`      └─ ${refreshed} player stat rows refreshed`);
}

async function main() {
  const args = process.argv.slice(2);
  const schools = args[0] === '--all-big-west' ? BIG_WEST : args;
  if (schools.length === 0) {
    console.error('Usage: npx tsx scripts/refresh-season-stats.ts "<School Name>" | --all-big-west');
    process.exit(1);
  }
  console.log(`🔄 Refreshing season stats for ${schools.length} team(s) — season ${SEASON}\n`);
  for (const school of schools) {
    await refreshOne(school);
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
