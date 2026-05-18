#!/usr/bin/env tsx
import 'dotenv/config';
import { PrismaClient } from '../app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { getTeams, getAllRosters, getTeamPlays, getPlays } from '../lib/cbbd';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const BASE = 'https://api.collegebasketballdata.com';
const auth = { Authorization: `Bearer ${process.env.CBBD_API_KEY}` };

async function fetchJson(url: string) {
  const res = await fetch(url, { headers: auth });
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`);
  const text = await res.text();
  if (text.startsWith('<!DOCTYPE')) throw new Error(`${url} returned HTML (wrong path)`);
  return JSON.parse(text);
}

async function main() {
  const [schoolName, seasonStr] = process.argv.slice(2);
  if (!schoolName || !seasonStr) {
    console.error('Usage: npx tsx scripts/ingest-team.ts "School Name" YYYY');
    process.exit(1);
  }
  const season = parseInt(seasonStr, 10);
  console.log(`🏀 Ingesting ${schoolName} for ${season}\n`);

  // ===== 1. Team =====
  console.log('1. Team lookup');
  const allTeams = await getTeams({ year: season });
  const team = allTeams.find((t) => t.school === schoolName);
  if (!team) throw new Error(`Team not found: ${schoolName}`);
  console.log(`   ${team.displayName} (id=${team.id})`);

  await prisma.team.upsert({
    where: { id: team.id },
    create: {
      id: team.id, sourceId: team.sourceId, school: team.school, mascot: team.mascot,
      abbreviation: team.abbreviation, displayName: team.displayName, conference: team.conference,
      conferenceId: team.conferenceId, primaryColor: team.primaryColor, secondaryColor: team.secondaryColor,
      currentVenue: team.currentVenue, currentCity: team.currentCity, currentState: team.currentState,
    },
    update: { school: team.school, conference: team.conference },
  });

  // ===== 2. Team plays — used to derive games AND list of plays =====
  console.log('\n2. Fetching team plays (all, not just shooting)...');
  const teamPlays = await getTeamPlays(team.school, season, false);
  console.log(`   ${teamPlays.length} plays`);

  // Derive game records + opponent ids
  const gameMap = new Map<number, any>();
  const opponentIds = new Set<number>();
  for (const p of teamPlays) {
    opponentIds.add(p.opponentId);
    if (!gameMap.has(p.gameId)) {
      gameMap.set(p.gameId, {
        id: p.gameId,
        sourceId: p.gameSourceId,
        season: p.season,
        seasonType: p.seasonType,
        startDate: new Date(p.gameStartDate),
        homeTeamId: p.isHomeTeam ? team.id : p.opponentId,
        awayTeamId: p.isHomeTeam ? p.opponentId : team.id,
      });
    }
  }
  console.log(`   → ${gameMap.size} unique games, ${opponentIds.size} opponents`);

  // ===== 3. Upsert opponent teams =====
  console.log('\n3. Upserting opponent teams...');
  const allTeamsById = new Map(allTeams.map((t) => [t.id, t]));
  let opponentsInserted = 0;
  for (const oppId of opponentIds) {
    const t = allTeamsById.get(oppId);
    if (!t) {
      console.log(`   ⚠️  opponent id=${oppId} not in /teams (non-D1?) — game will have null team ref`);
      continue;
    }
    await prisma.team.upsert({
      where: { id: t.id },
      create: {
        id: t.id, sourceId: t.sourceId, school: t.school, mascot: t.mascot,
        abbreviation: t.abbreviation, displayName: t.displayName, conference: t.conference,
        conferenceId: t.conferenceId, primaryColor: t.primaryColor, secondaryColor: t.secondaryColor,
        currentVenue: t.currentVenue, currentCity: t.currentCity, currentState: t.currentState,
      },
      update: {},
    });
    opponentsInserted++;
  }
  console.log(`   ${opponentsInserted} opponents inserted`);

  // ===== 4. Opponent rosters (all D1 rosters in one call) =====
  console.log('\n4. Fetching all D1 rosters for season (single call)...');
  const allRosters = await getAllRosters(season);
  console.log(`   ${allRosters.length} team rosters returned`);

  const wantedTeamIds = new Set<number>([team.id, ...opponentIds]);
  let playersInserted = 0;
  for (const rosterEntry of allRosters) {
    if (!wantedTeamIds.has(rosterEntry.teamId)) continue;
    for (const p of rosterEntry.players || []) {
      await prisma.player.upsert({
        where: { id: p.id },
        create: {
          id: p.id,
          sourceId: (p as any).sourceId,
          firstName: p.firstName,
          lastName: p.lastName,
          name: p.name,
          position: p.position,
          height: p.height,
          weight: p.weight,
          jersey: p.jersey,
          teamId: rosterEntry.teamId,
        },
        update: {
          name: p.name,
          position: p.position,
          teamId: rosterEntry.teamId,
        },
      });
      playersInserted++;
    }
  }
  console.log(`   ${playersInserted} players inserted`);

  // Load valid player IDs to filter plays' FKs
  const validPlayerIds = new Set<number>(
    (await prisma.player.findMany({ select: { id: true } })).map((p) => p.id)
  );
  console.log(`   ${validPlayerIds.size} valid player IDs known`);

  // ===== 5. Upsert games (nullable team refs handled) =====
  console.log('\n5. Upserting games...');
  const validTeamIds = new Set<number>(
    (await prisma.team.findMany({ select: { id: true } })).map((t) => t.id)
  );
  let gamesInserted = 0;
  let gamesWithNullTeam = 0;
  for (const g of gameMap.values()) {
    const homeTeamId = validTeamIds.has(g.homeTeamId) ? g.homeTeamId : null;
    const awayTeamId = validTeamIds.has(g.awayTeamId) ? g.awayTeamId : null;
    if (homeTeamId === null || awayTeamId === null) gamesWithNullTeam++;
    await prisma.game.upsert({
      where: { id: g.id },
      create: { ...g, homeTeamId, awayTeamId },
      update: {},
    });
    gamesInserted++;
  }
  console.log(`   ${gamesInserted} games (${gamesWithNullTeam} with at least one null team ref)`);

  // ===== 6. Plays — bulk insert with FK normalization =====
  console.log('\n6. Ingesting plays (per game)...');
  const games = await prisma.game.findMany({
    where: { id: { in: [...gameMap.keys()] } },
    orderBy: { startDate: 'asc' },
  });

  let totalAttempted = 0;
  let totalInserted = 0;
  let totalSkippedDuplicates = 0;
  const missingPlayerIds = new Map<number, number>(); // id → count
  let gamesWithPlays = 0;

  for (const [idx, game] of games.entries()) {
    const plays = await getPlays(game.id, false);
    if (plays.length === 0) {
      process.stdout.write(`   [${idx + 1}/${games.length}] gameId=${game.id}: 0 plays\n`);
      continue;
    }
    gamesWithPlays++;
    totalAttempted += plays.length;

    const rows = plays.map((p: any) => {
      const shooterId = p.shotInfo?.shooter?.id ?? null;
      const primaryParticipant = p.participants?.[0]?.id ?? null;
      let playerId = shooterId ?? primaryParticipant ?? null;
      if (playerId !== null && !validPlayerIds.has(playerId)) {
        missingPlayerIds.set(playerId, (missingPlayerIds.get(playerId) ?? 0) + 1);
        playerId = null; // normalize to null instead of failing FK
      }
      return {
        id: String(p.id),
        gameId: p.gameId,
        playerId,
        teamId: validTeamIds.has(p.teamId) ? p.teamId : null,
        period: p.period,
        clock: p.clock,
        secondsRemaining: p.secondsRemaining,
        homeScore: p.homeScore,
        awayScore: p.awayScore,
        playType: p.playType,
        playText: p.playText,
        scoringPlay: !!p.scoringPlay,
        shootingPlay: !!p.shootingPlay,
        scoreValue: p.scoreValue ?? null,
        shotMade: p.shotInfo?.made ?? null,
        shotRange: p.shotInfo?.range ?? null,
        shotAssisted: p.shotInfo?.assisted ?? null,
        shotX: p.shotInfo?.location?.x ?? null,
        shotY: p.shotInfo?.location?.y ?? null,
        assisterId: p.shotInfo?.assistedBy?.id ?? null,
        assisterName: p.shotInfo?.assistedBy?.name ?? null,
      };
    });

    const result = await prisma.play.createMany({ data: rows, skipDuplicates: true });
    totalInserted += result.count;
    totalSkippedDuplicates += rows.length - result.count;
    process.stdout.write(`   [${idx + 1}/${games.length}] gameId=${game.id}: ${rows.length} attempted, ${result.count} inserted\n`);
  }

  console.log(`\n   Plays: ${totalInserted}/${totalAttempted} inserted (${totalSkippedDuplicates} dupes skipped) from ${gamesWithPlays} games`);
  if (missingPlayerIds.size > 0) {
    const top = [...missingPlayerIds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log(`   ⚠️  ${missingPlayerIds.size} player IDs referenced in plays but missing from Player table.`);
    console.log(`      Top 5 missing: ${top.map(([id, n]) => `${id}(${n}x)`).join(', ')}`);
  }

  // ===== 7. Team season stats — nested mapping =====
  console.log('\n7. Team season stats...');
  const teamStatsArr = await fetchJson(`${BASE}/stats/team/season?team=${encodeURIComponent(team.school)}&season=${season}`);
  const ts = teamStatsArr[0];
  if (ts) {
    const s = ts.teamStats;
    await prisma.teamSeasonStats.upsert({
      where: { teamId_season: { teamId: team.id, season } },
      create: {
        teamId: team.id, season,
        games: ts.games, wins: ts.wins, losses: ts.losses,
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
      },
      update: {
        pointsTotal: s.points?.total ?? 0,
        fieldGoalsMade: s.fieldGoals?.made ?? 0,
        fieldGoalsAttempted: s.fieldGoals?.attempted ?? 0,
      },
    });
    console.log(`   ${ts.games}G ${ts.wins}-${ts.losses}, ${s.points?.total} pts, ${s.fieldGoals?.made}/${s.fieldGoals?.attempted} FG`);
  }

  // ===== 8. Player season stats — nested mapping =====
  console.log('\n8. Player season stats...');
  const playerStats = await fetchJson(`${BASE}/stats/player/season?team=${encodeURIComponent(team.school)}&season=${season}`);
  console.log(`   ${playerStats.length} player stat rows`);

  let playerStatsInserted = 0;
  let playerStatsSkippedNoPlayer = 0;
  for (const p of playerStats) {
    if (!validPlayerIds.has(p.athleteId)) {
      playerStatsSkippedNoPlayer++;
      continue;
    }
    await prisma.playerSeasonStats.upsert({
      where: { playerId_season: { playerId: p.athleteId, season } },
      create: {
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
      },
      update: {},
    });
    playerStatsInserted++;
  }
  console.log(`   ${playerStatsInserted} player stat rows inserted (${playerStatsSkippedNoPlayer} skipped — player not in DB)`);

  // ===== 9. Final report =====
  const counts = {
    teams: await prisma.team.count(),
    players: await prisma.player.count(),
    games: await prisma.game.count(),
    plays: await prisma.play.count(),
    teamSeasonStats: await prisma.teamSeasonStats.count(),
    playerSeasonStats: await prisma.playerSeasonStats.count(),
  };

  console.log('\n📊 Final row counts:');
  for (const [k, v] of Object.entries(counts)) console.log(`   ${k}: ${v.toLocaleString()}`);

  const playsWithCoords = await prisma.play.count({ where: { shotX: { not: null } } });
  console.log(`\n🎯 Plays with shot coordinates: ${playsWithCoords.toLocaleString()}`);
  console.log(`   Plays attempted/inserted this run: ${totalAttempted} / ${totalInserted}`);
  console.log(`   Success rate: ${((totalInserted / totalAttempted) * 100).toFixed(1)}%`);

  // Sample 3 random plays
  const sampleCount = await prisma.play.count();
  if (sampleCount > 0) {
    console.log('\n🎲 3 random plays (sanity check):');
    // Get random plays via offset
    const offsets = Array.from({ length: 3 }, () => Math.floor(Math.random() * sampleCount));
    for (const offset of offsets) {
      const [p] = await prisma.play.findMany({ skip: offset, take: 1, orderBy: { id: 'asc' } });
      if (p) {
        console.log(`   • [${p.playType}] g=${p.gameId} p${p.period} ${p.clock} | ${p.playText?.slice(0, 80)}`);
        if (p.shotX !== null) console.log(`     shot: range=${p.shotRange} made=${p.shotMade} x=${p.shotX} y=${p.shotY}`);
      }
    }
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error('💥 FAILED:', err);
  process.exit(1);
});
