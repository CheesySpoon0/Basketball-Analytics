#!/usr/bin/env tsx
/**
 * All-D1 ingestion for one season.
 *
 * Pulls every D1 team, roster, season stats, game, and play-by-play record
 * for a season so the xeFG model can train on a national shot sample rather
 * than a Big West-sized slice.
 *
 * Usage:
 *   npx tsx scripts/ingest-all-d1.ts --season 2025 --dry-run
 *   npx tsx scripts/ingest-all-d1.ts --season 2025 --limit-teams 10
 *   npx tsx scripts/ingest-all-d1.ts --season 2025
 *
 * Flags:
 *   --season <year>     Season to ingest (required).
 *   --dry-run           Estimate scope; no DB writes, no play-by-play fetches.
 *   --limit-teams <n>   Restrict to the first n D1 teams (alphabetical) and
 *                       only their games. For smoke testing.
 *   --retry-failed      Re-attempt only the games listed in the prior
 *                       failures JSON instead of the full set.
 *
 * Safe by design:
 *   - Skips games that already have plays in the DB (resume-friendly).
 *   - Dedupes games by gameId across month-window pagination.
 *   - Upserts numeric stat fields without overwriting good values with null.
 *   - Writes failed teams/games to scripts/output/ingest-all-d1-failures.json.
 *   - 150ms delay between play-by-play calls; retry with backoff on errors.
 */
import 'dotenv/config';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '../app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { getTeams, getAllRosters, getPlays, type CbbdTeam } from '../lib/cbbd';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const BASE = 'https://api.collegebasketballdata.com';
const auth = { Authorization: `Bearer ${process.env.CBBD_API_KEY}` };

const OUTPUT_DIR = join(process.cwd(), 'scripts', 'output');
const FAILURES_PATH = join(OUTPUT_DIR, 'ingest-all-d1-failures.json');

const PLAY_FETCH_DELAY_MS = 150; // conservative pacing for CBBD rate limits
const MAX_RETRIES = 4;

// ---------- arg parsing ----------
function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const season = Number(get('--season'));
  if (!season || Number.isNaN(season)) {
    console.error('ERROR: --season <year> is required.');
    process.exit(1);
  }
  return {
    season,
    dryRun: args.includes('--dry-run'),
    limitTeams: get('--limit-teams') ? Number(get('--limit-teams')) : undefined,
    retryFailed: args.includes('--retry-failed'),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Retry a DB operation on transient connection errors (Supabase pooler drops,
// socket timeouts). Prisma surfaces these as P1001/P1008/P1017.
async function withDbRetry<T>(label: string, fn: () => Promise<T>, attempt = 1): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const code = err?.code ?? '';
    const transient =
      ['P1001', 'P1008', 'P1017', 'P2024'].includes(code) ||
      /socket|timeout|ECONNRESET|terminat/i.test(String(err?.message ?? err));
    if (transient && attempt <= 5) {
      const backoff = 500 * 2 ** attempt;
      console.log(`    ⚠️  ${label}: transient DB error (${code || 'conn'}), retry ${attempt} in ${backoff}ms`);
      await sleep(backoff);
      return withDbRetry(label, fn, attempt + 1);
    }
    throw err;
  }
}

// Run an async mapper over items in bounded-concurrency batches.
async function inBatches<T>(items: T[], batchSize: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(fn));
  }
}

async function fetchJson(url: string, attempt = 1): Promise<any> {
  try {
    const res = await fetch(url, { headers: auth });
    if (res.status === 429 || res.status >= 500) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const text = await res.text();
    if (text.startsWith('<!DOCTYPE')) throw new Error('returned HTML');
    return JSON.parse(text);
  } catch (err) {
    if (attempt <= MAX_RETRIES) {
      const backoff = PLAY_FETCH_DELAY_MS * 2 ** attempt;
      await sleep(backoff);
      return fetchJson(url, attempt + 1);
    }
    throw err;
  }
}

// ---------- game enumeration via month windows ----------
// /games is capped at 3000 rows, so we page via startDateRange/endDateRange.
function monthWindows(season: number): Array<[string, string]> {
  // NCAA season spans Nov(season-1) through Apr(season).
  const y0 = season - 1;
  const y1 = season;
  return [
    [`${y0}-10-15`, `${y0}-11-30`],
    [`${y0}-12-01`, `${y0}-12-31`],
    [`${y1}-01-01`, `${y1}-01-31`],
    [`${y1}-02-01`, `${y1}-02-28`],
    [`${y1}-03-01`, `${y1}-03-31`],
    [`${y1}-04-01`, `${y1}-05-15`],
  ];
}

interface GameRow {
  id: number;
  sourceId: string | null;
  season: number;
  seasonType: string | null;
  startDate: Date;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeScore: number | null;
  awayScore: number | null;
  venue: string | null;
  status: string | null;
  neutralSite: boolean;
  conferenceGame: boolean;
}

async function enumerateGames(season: number): Promise<GameRow[]> {
  const byId = new Map<number, GameRow>();
  for (const [start, end] of monthWindows(season)) {
    const url = `${BASE}/games?season=${season}&startDateRange=${start}&endDateRange=${end}`;
    const rows: any[] = await fetchJson(url);
    for (const g of rows) {
      if (byId.has(g.id)) continue;
      byId.set(g.id, {
        id: g.id,
        sourceId: g.sourceId ?? null,
        season: g.season,
        seasonType: g.seasonType ?? null,
        startDate: new Date(g.startDate),
        homeTeamId: g.homeTeamId ?? null,
        awayTeamId: g.awayTeamId ?? null,
        homeScore: g.homePoints ?? null,
        awayScore: g.awayPoints ?? null,
        venue: g.venue ?? null,
        status: g.status ?? null,
        neutralSite: !!g.neutralSite,
        conferenceGame: !!g.conferenceGame,
      });
    }
  }
  return [...byId.values()];
}

// ---------- stat field maps (drop nullish so upserts never null good data) ----------
function teamStatsData(ts: any, teamId: number, season: number): Record<string, unknown> {
  const s = ts.teamStats ?? {};
  const raw: Record<string, unknown> = {
    teamId,
    season,
    games: ts.games,
    wins: ts.wins,
    losses: ts.losses,
    pointsTotal: s.points?.total,
    pointsInPaint: s.points?.inPaint,
    pointsFastBreak: s.points?.fastBreak,
    pointsOffTurnovers: s.points?.offTurnovers,
    fieldGoalsMade: s.fieldGoals?.made,
    fieldGoalsAttempted: s.fieldGoals?.attempted,
    threePointsMade: s.threePointFieldGoals?.made,
    threePointsAttempted: s.threePointFieldGoals?.attempted,
    freeThrowsMade: s.freeThrows?.made,
    freeThrowsAttempted: s.freeThrows?.attempted,
    offensiveRebounds: s.rebounds?.offensive,
    defensiveRebounds: s.rebounds?.defensive,
    totalRebounds: s.rebounds?.total,
    assists: s.assists,
    steals: s.steals,
    blocks: s.blocks,
    turnoversTotal: s.turnovers?.total,
    turnoversTeam: s.turnovers?.teamTotal,
    foulsTotal: s.fouls?.total,
    foulsTechnical: s.fouls?.technical,
    foulsFlagrant: s.fouls?.flagrant,
  };
  return dropNullish(raw, ['teamId', 'season']);
}

function playerStatsData(
  p: any,
  season: number,
  validTeamIds: Set<number>,
): Record<string, unknown> {
  // CBBD player-stats rows can reference a team outside our ingested set
  // (non-D1, or a team the player transferred from). PlayerSeasonStats.teamId
  // is nullable — normalize unknown ids to null rather than violating the FK.
  const teamId = p.teamId != null && validTeamIds.has(p.teamId) ? p.teamId : null;
  const raw: Record<string, unknown> = {
    playerId: p.athleteId,
    teamId,
    season: p.season ?? season,
    games: p.games,
    gamesStarted: p.starts,
    minutes: p.minutes,
    points: p.points,
    rebounds: p.rebounds?.total,
    offRebounds: p.rebounds?.offensive,
    defRebounds: p.rebounds?.defensive,
    assists: p.assists,
    steals: p.steals,
    blocks: p.blocks,
    turnovers: p.turnovers,
    fouls: p.fouls,
    fieldGoalsMade: p.fieldGoals?.made,
    fieldGoalsAttempted: p.fieldGoals?.attempted,
    threePointsMade: p.threePointFieldGoals?.made,
    threePointsAttempted: p.threePointFieldGoals?.attempted,
    freeThrowsMade: p.freeThrows?.made,
    freeThrowsAttempted: p.freeThrows?.attempted,
  };
  return dropNullish(raw, ['playerId', 'season']);
}

// Remove null/undefined keys so an upsert update never overwrites a good
// value with null. Keys in `keep` are always retained.
function dropNullish(obj: Record<string, unknown>, keep: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (keep.includes(k) || (v !== null && v !== undefined)) out[k] = v;
  }
  return out;
}

// ---------- main ----------
async function main() {
  const { season, dryRun, limitTeams, retryFailed } = parseArgs();

  console.log('='.repeat(70));
  console.log(`ALL-D1 INGEST — season ${season}`);
  console.log(
    `mode: ${dryRun ? 'DRY RUN' : 'LIVE'}` +
      (limitTeams ? ` | limit-teams=${limitTeams}` : '') +
      (retryFailed ? ' | retry-failed' : ''),
  );
  console.log('='.repeat(70));

  // ===== 1. D1 teams =====
  console.log('\n[1] Fetching teams...');
  const allTeams = await getTeams({ year: season });
  let d1Teams: CbbdTeam[] = allTeams.filter((t) => t.conferenceId != null);
  d1Teams.sort((a, b) => a.school.localeCompare(b.school));
  console.log(`    ${allTeams.length} total teams, ${d1Teams.length} D1 (have conferenceId)`);

  if (limitTeams) {
    d1Teams = d1Teams.slice(0, limitTeams);
    console.log(`    limited to ${d1Teams.length}: ${d1Teams.map((t) => t.school).join(', ')}`);
  }
  const d1TeamIds = new Set(d1Teams.map((t) => t.id));

  // ===== 2. Enumerate games =====
  console.log('\n[2] Enumerating games (month-window pagination)...');
  const allGames = await enumerateGames(season);
  console.log(`    ${allGames.length} unique games season-wide`);

  // A game is in scope if at least one participant is a target D1 team.
  const scopedGames = allGames.filter(
    (g) =>
      (g.homeTeamId != null && d1TeamIds.has(g.homeTeamId)) ||
      (g.awayTeamId != null && d1TeamIds.has(g.awayTeamId)),
  );
  console.log(`    ${scopedGames.length} games involve a target D1 team`);

  // ===== DRY RUN: estimate and exit =====
  if (dryRun) {
    const existingWithPlays = await prisma.play.findMany({
      where: { gameId: { in: scopedGames.map((g) => g.id) } },
      distinct: ['gameId'],
      select: { gameId: true },
    });
    const alreadyHavePlays = new Set(existingWithPlays.map((p) => p.gameId));
    const toFetch = scopedGames.filter((g) => !alreadyHavePlays.has(g.id));

    const bulkCalls = 5; // teams, rosters, team stats, player stats, + games windows
    const windowCalls = monthWindows(season).length;
    const playCalls = toFetch.length;
    const totalCalls = bulkCalls + windowCalls + playCalls;
    const estSeconds = playCalls * (PLAY_FETCH_DELAY_MS / 1000) + playCalls * 0.4;
    // ~340 plays/game observed; ~32% are non-FT FGA, ~99% coordinate-tagged.
    const estPlays = toFetch.length * 340;
    const estFga = Math.round(estPlays * 0.32);
    const estCoordFga = Math.round(estFga * 0.99);

    console.log('\n' + '='.repeat(70));
    console.log('DRY RUN ESTIMATE');
    console.log('='.repeat(70));
    console.log(`  D1 teams:                  ${d1Teams.length}`);
    console.log(`  Games (season-wide):       ${allGames.length}`);
    console.log(`  Games in scope:            ${scopedGames.length}`);
    console.log(`  Games already have plays:  ${alreadyHavePlays.size} (skipped)`);
    console.log(`  Games needing play fetch:  ${toFetch.length}`);
    console.log(`  Bulk + window API calls:   ${bulkCalls + windowCalls}`);
    console.log(`  Play-by-play API calls:    ${playCalls}`);
    console.log(`  Total API calls:           ${totalCalls}`);
    console.log(`  Est. new plays:            ~${estPlays.toLocaleString()}`);
    console.log(`  Est. new non-FT FGA:       ~${estFga.toLocaleString()}`);
    console.log(`  Est. new coord-tagged FGA: ~${estCoordFga.toLocaleString()}`);
    console.log(
      `  Est. runtime:              ~${Math.round(estSeconds / 60)} min ` +
        `(${PLAY_FETCH_DELAY_MS}ms delay + ~400ms/call)`,
    );
    console.log(`\n  Rate-limit note: ${PLAY_FETCH_DELAY_MS}ms pacing + exp. backoff retry.`);
    console.log('  No DB writes performed (dry run).');
    await cleanup();
    return;
  }

  // ===== 3. Upsert D1 teams =====
  console.log('\n[3] Upserting D1 teams...');
  await inBatches(d1Teams, 25, async (t) => {
    await withDbRetry(`team ${t.id}`, () =>
      prisma.team.upsert({
        where: { id: t.id },
        create: {
          id: t.id, sourceId: t.sourceId, school: t.school, mascot: t.mascot,
          abbreviation: t.abbreviation, displayName: t.displayName, conference: t.conference,
          conferenceId: t.conferenceId, primaryColor: t.primaryColor, secondaryColor: t.secondaryColor,
          currentVenue: t.currentVenue, currentCity: t.currentCity, currentState: t.currentState,
        },
        update: { school: t.school, conference: t.conference, conferenceId: t.conferenceId },
      }),
    );
  });
  console.log(`    ${d1Teams.length} teams upserted`);

  // Opponents of target teams may be non-D1; upsert them too so game FKs resolve.
  const opponentIds = new Set<number>();
  for (const g of scopedGames) {
    if (g.homeTeamId != null) opponentIds.add(g.homeTeamId);
    if (g.awayTeamId != null) opponentIds.add(g.awayTeamId);
  }
  const teamsById = new Map(allTeams.map((t) => [t.id, t]));
  const opponentTeams = [...opponentIds]
    .filter((id) => !d1TeamIds.has(id))
    .map((id) => teamsById.get(id))
    .filter((t): t is CbbdTeam => t != null);
  await inBatches(opponentTeams, 25, async (t) => {
    await withDbRetry(`opponent ${t.id}`, () =>
      prisma.team.upsert({
        where: { id: t.id },
        create: {
          id: t.id, sourceId: t.sourceId, school: t.school, mascot: t.mascot,
          abbreviation: t.abbreviation, displayName: t.displayName, conference: t.conference,
          conferenceId: t.conferenceId, primaryColor: t.primaryColor, secondaryColor: t.secondaryColor,
          currentVenue: t.currentVenue, currentCity: t.currentCity, currentState: t.currentState,
        },
        update: {},
      }),
    );
  });
  const oppUpserts = opponentTeams.length;
  console.log(`    ${oppUpserts} non-D1 opponent teams upserted`);

  const validTeamIds = new Set(
    (await withDbRetry('load team ids', () => prisma.team.findMany({ select: { id: true } }))).map(
      (t) => t.id,
    ),
  );

  // ===== 4. Rosters (single bulk call) =====
  console.log('\n[4] Fetching all rosters...');
  const rosters = await getAllRosters(season);
  const rosterPlayers = rosters
    .filter((r) => validTeamIds.has(r.teamId))
    .flatMap((r) => (r.players || []).map((p) => ({ p, teamId: r.teamId })));
  let playersUpserted = 0;
  await inBatches(rosterPlayers, 25, async ({ p, teamId }) => {
    await withDbRetry(`player ${p.id}`, () =>
      prisma.player.upsert({
        where: { id: p.id },
        create: {
          id: p.id, sourceId: (p as any).sourceId, firstName: p.firstName,
          lastName: p.lastName, name: p.name, position: p.position,
          height: p.height, weight: p.weight, jersey: p.jersey, teamId,
        },
        update: { name: p.name, position: p.position, teamId },
      }),
    );
    playersUpserted++;
  });
  console.log(`    ${playersUpserted} players upserted`);
  const validPlayerIds = new Set(
    (
      await withDbRetry('load player ids', () => prisma.player.findMany({ select: { id: true } }))
    ).map((p) => p.id),
  );

  // ===== 5. Team season stats (bulk) =====
  console.log('\n[5] Fetching team season stats...');
  const teamStats: any[] = await fetchJson(`${BASE}/stats/team/season?season=${season}`);
  const scopedTeamStats = teamStats.filter((ts) => d1TeamIds.has(ts.teamId));
  let teamStatRows = 0;
  await inBatches(scopedTeamStats, 25, async (ts) => {
    const data = teamStatsData(ts, ts.teamId, season);
    await withDbRetry(`teamStats ${ts.teamId}`, () =>
      prisma.teamSeasonStats.upsert({
        where: { teamId_season: { teamId: ts.teamId, season } },
        create: data as any,
        update: data,
      }),
    );
    teamStatRows++;
  });
  console.log(`    ${teamStatRows} team season stat rows upserted`);

  // ===== 6. Player season stats (bulk) =====
  console.log('\n[6] Fetching player season stats...');
  const playerStats: any[] = await fetchJson(`${BASE}/stats/player/season?season=${season}`);
  const scopedPlayerStats = playerStats.filter((p) => validPlayerIds.has(p.athleteId));
  let playerStatRows = 0;
  await inBatches(scopedPlayerStats, 25, async (p) => {
    const data = playerStatsData(p, season, validTeamIds);
    await withDbRetry(`playerStats ${p.athleteId}`, () =>
      prisma.playerSeasonStats.upsert({
        where: { playerId_season: { playerId: p.athleteId, season } },
        create: data as any,
        update: data,
      }),
    );
    playerStatRows++;
  });
  console.log(`    ${playerStatRows} player season stat rows upserted`);

  // ===== 7. Upsert games =====
  console.log('\n[7] Upserting games...');
  let gamesUpserted = 0;
  await inBatches(scopedGames, 25, async (g) => {
    const homeTeamId = g.homeTeamId != null && validTeamIds.has(g.homeTeamId) ? g.homeTeamId : null;
    const awayTeamId = g.awayTeamId != null && validTeamIds.has(g.awayTeamId) ? g.awayTeamId : null;
    await withDbRetry(`game ${g.id}`, () =>
      prisma.game.upsert({
        where: { id: g.id },
        create: {
          id: g.id, sourceId: g.sourceId, season: g.season, seasonType: g.seasonType,
          startDate: g.startDate, homeTeamId, awayTeamId, homeScore: g.homeScore,
          awayScore: g.awayScore, venue: g.venue, status: g.status,
          neutralSite: g.neutralSite, conferenceGame: g.conferenceGame,
        },
        update: {
          homeTeamId, awayTeamId, homeScore: g.homeScore, awayScore: g.awayScore,
          status: g.status,
        },
      }),
    );
    gamesUpserted++;
  });
  console.log(`    ${gamesUpserted} games upserted`);

  // ===== 8. Play-by-play (per game, skip games that already have plays) =====
  console.log('\n[8] Ingesting play-by-play...');
  const gamesWithPlays = new Set(
    (
      await withDbRetry('load games with plays', () =>
        prisma.play.groupBy({
          by: ['gameId'],
          where: { gameId: { in: scopedGames.map((g) => g.id) } },
        }),
      )
    ).map((p) => p.gameId),
  );

  let gameIdsToFetch = scopedGames
    .filter((g) => !gamesWithPlays.has(g.id))
    .map((g) => g.id);

  if (retryFailed) {
    if (!existsSync(FAILURES_PATH)) {
      console.log('    --retry-failed set but no failures file found; nothing to retry.');
      gameIdsToFetch = [];
    } else {
      const prev = JSON.parse(readFileSync(FAILURES_PATH, 'utf-8'));
      const failedGameIds: number[] = prev.games ?? [];
      gameIdsToFetch = gameIdsToFetch.filter((id) => failedGameIds.includes(id));
      console.log(`    retry mode: ${gameIdsToFetch.length} previously-failed games`);
    }
  }

  console.log(
    `    ${gamesWithPlays.size} games already have plays (skipped), ` +
      `${gameIdsToFetch.length} to fetch`,
  );

  let totalInserted = 0;
  let gamesDone = 0;
  let gamesFailed = 0;
  const failedGames: Array<{ gameId: number; error: string }> = [];

  for (const gameId of gameIdsToFetch) {
    try {
      const plays = await getPlays(gameId, false);
      if (plays.length > 0) {
        const rows = plays.map((p: any) => {
          const shooterId = p.shotInfo?.shooter?.id ?? null;
          const primary = p.participants?.[0]?.id ?? null;
          let playerId = shooterId ?? primary ?? null;
          if (playerId !== null && !validPlayerIds.has(playerId)) playerId = null;
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
        const result = await withDbRetry(`plays game ${gameId}`, () =>
          prisma.play.createMany({ data: rows, skipDuplicates: true }),
        );
        totalInserted += result.count;
      }
      gamesDone++;
    } catch (err: any) {
      gamesFailed++;
      failedGames.push({ gameId, error: String(err?.message ?? err) });
    }

    if ((gamesDone + gamesFailed) % 50 === 0 || gamesDone + gamesFailed === gameIdsToFetch.length) {
      console.log(
        `    progress: ${gamesDone + gamesFailed}/${gameIdsToFetch.length} ` +
          `(${gamesDone} ok, ${gamesFailed} failed, ${totalInserted.toLocaleString()} plays inserted)`,
      );
    }
    await sleep(PLAY_FETCH_DELAY_MS);
  }

  // ===== 9. Persist failures =====
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(
    FAILURES_PATH,
    JSON.stringify(
      { season, ranAt: new Date().toISOString(), games: failedGames.map((f) => f.gameId), detail: failedGames },
      null,
      2,
    ),
  );

  // ===== 10. Report =====
  console.log('\n' + '='.repeat(70));
  console.log('INGEST COMPLETE');
  console.log('='.repeat(70));
  console.log(`  Teams upserted:        ${d1Teams.length} D1 + ${oppUpserts} opponents`);
  console.log(`  Players upserted:      ${playersUpserted}`);
  console.log(`  Team stat rows:        ${teamStatRows}`);
  console.log(`  Player stat rows:      ${playerStatRows}`);
  console.log(`  Games upserted:        ${gamesUpserted}`);
  console.log(`  Play-by-play games:    ${gamesDone} ok, ${gamesFailed} failed`);
  console.log(`  Plays inserted:        ${totalInserted.toLocaleString()}`);
  if (gamesFailed > 0) {
    console.log(`\n  ⚠️  ${gamesFailed} games failed — see ${FAILURES_PATH}`);
    console.log(`     Re-run with --retry-failed to retry them.`);
  }

  await cleanup();
}

async function cleanup() {
  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (err) => {
  console.error('💥 FAILED:', err);
  await cleanup();
  process.exit(1);
});
