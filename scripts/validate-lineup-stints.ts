#!/usr/bin/env tsx
// ============================================================================
// validate-lineup-stints.ts
//
// Post-write validation for LineupStint rows. Reports coverage, confidence
// breakdown, minutes reconciliation, points/possession sanity, and lineup
// leaderboards (raw + threshold-filtered).
//
// Usage:
//   npx tsx scripts/validate-lineup-stints.ts --season=2026 [--team=ID ...]
// ============================================================================
import 'dotenv/config';
import { prisma } from '../lib/prisma';

const args = process.argv.slice(2);
const seasonArg = args.find((a) => a.startsWith('--season='));
const SEASON = seasonArg ? Number(seasonArg.split('=')[1]) : 2026;
const teamArgs = args.filter((a) => a.startsWith('--team=')).map((a) => Number(a.split('=')[1]));

// Minimum thresholds for lineup ranking — small samples are pure noise.
const MIN_POSS = 20;
const MIN_SECONDS = 20 * 60; // 20 minutes

function fmt(n: number | null, d = 2): string {
  return n === null ? 'N/A' : n.toFixed(d);
}
function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function playerNames(ids: number[]): Promise<Map<number, string>> {
  const players = await prisma.player.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, firstName: true, lastName: true },
  });
  const map = new Map<number, string>();
  for (const p of players) {
    map.set(p.id, p.name ?? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() ?? `#${p.id}`);
  }
  return map;
}

async function main() {
  console.log(`\n${'='.repeat(64)}`);
  console.log(`LINEUP STINT VALIDATION — season ${SEASON}`);
  console.log(`${'='.repeat(64)}`);

  // ---- Global coverage ----
  const totalStints = await prisma.lineupStint.count({ where: { season: SEASON } });
  const byConfidence = await prisma.lineupStint.groupBy({
    by: ['confidence'],
    where: { season: SEASON },
    _count: { _all: true },
  });
  const gamesCovered = await prisma.lineupStint.findMany({
    where: { season: SEASON },
    distinct: ['gameId'],
    select: { gameId: true },
  });
  const teamsCovered = await prisma.lineupStint.findMany({
    where: { season: SEASON },
    distinct: ['teamId'],
    select: { teamId: true },
  });
  const totalGames = await prisma.game.count({ where: { season: SEASON } });

  console.log(`\n-- Coverage --`);
  console.log(`  Total stints:        ${totalStints}`);
  console.log(`  Games covered:       ${gamesCovered.length} / ${totalGames}`);
  console.log(`  Teams covered:       ${teamsCovered.length}`);
  console.log(`  Confidence breakdown:`);
  for (const c of byConfidence) {
    const pct = ((c._count._all / totalStints) * 100).toFixed(1);
    console.log(`    ${c.confidence.padEnd(8)} ${c._count._all} (${pct}%)`);
  }

  // ---- Minutes reconciliation: a sample of team-games ----
  // Each team-game should sum to ~2400s (regulation) + OT.
  const sampleGames = await prisma.lineupStint.findMany({
    where: { season: SEASON },
    distinct: ['gameId'],
    select: { gameId: true },
    take: 50,
  });
  let minutesOk = 0;
  let minutesOff = 0;
  for (const { gameId } of sampleGames) {
    const stints = await prisma.lineupStint.findMany({
      where: { season: SEASON, gameId },
      select: { teamId: true, startSeconds: true, endSeconds: true, period: true },
    });
    const byTeam = new Map<number, { secs: number; maxPeriod: number }>();
    for (const s of stints) {
      const e = byTeam.get(s.teamId) ?? { secs: 0, maxPeriod: 2 };
      e.secs += s.startSeconds - s.endSeconds;
      e.maxPeriod = Math.max(e.maxPeriod, s.period);
      byTeam.set(s.teamId, e);
    }
    for (const [, e] of byTeam) {
      const expected = 2400 + (e.maxPeriod - 2) * 300;
      if (Math.abs(e.secs - expected) <= 5) minutesOk++;
      else minutesOff++;
    }
  }
  console.log(`\n-- Team-minutes reconciliation (${sampleGames.length} sample games) --`);
  console.log(`  Team-games within 5s of expected: ${minutesOk}`);
  console.log(`  Team-games off:                   ${minutesOff}`);

  // ---- Points reconciliation: stint sum vs final score ----
  let pointsOk = 0;
  let pointsOff = 0;
  const pointsOffDetail: string[] = [];
  for (const { gameId } of sampleGames) {
    const game = await prisma.game.findUnique({ where: { id: gameId } });
    if (!game) continue;
    const stints = await prisma.lineupStint.findMany({
      where: { season: SEASON, gameId },
      select: { teamId: true, pointsFor: true },
    });
    const byTeam = new Map<number, number>();
    for (const s of stints) {
      byTeam.set(s.teamId, (byTeam.get(s.teamId) ?? 0) + s.pointsFor);
    }
    for (const [teamId, pts] of byTeam) {
      const actual = teamId === game.homeTeamId ? game.homeScore : game.awayScore;
      if (actual === null) continue;
      if (Math.abs(pts - actual) <= 3) pointsOk++;
      else { pointsOff++; pointsOffDetail.push(`game ${gameId} team ${teamId}: ${pts} vs ${actual}`); }
    }
  }
  console.log(`\n-- Points reconciliation (${sampleGames.length} sample games) --`);
  console.log(`  Team-games within 3pts of final: ${pointsOk}`);
  console.log(`  Team-games off:                  ${pointsOff}`);
  for (const d of pointsOffDetail.slice(0, 10)) console.log(`    ${d}`);

  // ---- Player minutes from stints vs PlayerSeasonStats ----
  const checkTeams = teamArgs.length > 0 ? teamArgs : [308, 310, 311];
  console.log(`\n-- Player minutes: stints vs PlayerSeasonStats --`);
  for (const teamId of checkTeams) {
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    const stints = await prisma.lineupStint.findMany({
      where: { season: SEASON, teamId },
      select: { playerIds: true, startSeconds: true, endSeconds: true, confidence: true },
    });
    if (stints.length === 0) {
      console.log(`  ${team?.school ?? teamId}: no stints`);
      continue;
    }
    // Sum seconds per player across all stints with a known lineup.
    const playerSecs = new Map<number, number>();
    for (const s of stints) {
      if (!s.playerIds) continue;
      const dur = s.startSeconds - s.endSeconds;
      for (const idStr of s.playerIds.split(',')) {
        const pid = Number(idStr);
        playerSecs.set(pid, (playerSecs.get(pid) ?? 0) + dur);
      }
    }
    const seasonStats = await prisma.playerSeasonStats.findMany({
      where: { season: SEASON, teamId },
      select: { playerId: true, minutes: true },
    });
    const statsMap = new Map(seasonStats.map((s) => [s.playerId, s.minutes ?? 0]));
    const names = await playerNames([...playerSecs.keys()]);
    console.log(`  ${team?.school ?? teamId}:`);
    const rows = [...playerSecs.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    for (const [pid, secs] of rows) {
      const stintMin = secs / 60;
      const officialMin = statsMap.get(pid) ?? null;
      const diff = officialMin !== null ? stintMin - officialMin : null;
      console.log(
        `    ${(names.get(pid) ?? `#${pid}`).padEnd(24)} ` +
        `stints=${stintMin.toFixed(0).padStart(4)}min  ` +
        `official=${officialMin !== null ? String(officialMin).padStart(4) : '  ??'}min  ` +
        `diff=${diff !== null ? (diff >= 0 ? '+' : '') + diff.toFixed(0) : 'N/A'}`,
      );
    }
  }

  // ---- Lineup leaderboards (per team) ----
  for (const teamId of checkTeams) {
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    console.log(`\n${'─'.repeat(64)}`);
    console.log(`LINEUP LEADERBOARDS — ${team?.school ?? teamId} (${SEASON})`);
    console.log(`${'─'.repeat(64)}`);

    // Aggregate full-confidence stints by lineupHash.
    const stints = await prisma.lineupStint.findMany({
      where: { season: SEASON, teamId, confidence: 'full', playerIds: { not: null } },
      select: {
        lineupHash: true, playerIds: true, startSeconds: true, endSeconds: true,
        pointsFor: true, pointsAgainst: true,
        possessionsFor: true, possessionsAgainst: true,
        expectedPointsFor: true, expectedPointsAgainst: true,
      },
    });
    if (stints.length === 0) {
      console.log('  No full-confidence stints.');
      continue;
    }

    interface Agg {
      hash: string; playerIds: string;
      seconds: number; pointsFor: number; pointsAgainst: number;
      possFor: number; possAgainst: number;
      xPtsFor: number; xPtsAgainst: number;
    }
    const byHash = new Map<string, Agg>();
    for (const s of stints) {
      if (!s.lineupHash || !s.playerIds) continue;
      const a = byHash.get(s.lineupHash) ?? {
        hash: s.lineupHash, playerIds: s.playerIds,
        seconds: 0, pointsFor: 0, pointsAgainst: 0,
        possFor: 0, possAgainst: 0, xPtsFor: 0, xPtsAgainst: 0,
      };
      a.seconds += s.startSeconds - s.endSeconds;
      a.pointsFor += s.pointsFor;
      a.pointsAgainst += s.pointsAgainst;
      a.possFor += s.possessionsFor ?? 0;
      a.possAgainst += s.possessionsAgainst ?? 0;
      a.xPtsFor += s.expectedPointsFor ?? 0;
      a.xPtsAgainst += s.expectedPointsAgainst ?? 0;
      byHash.set(s.lineupHash, a);
    }
    const aggs = [...byHash.values()];

    // Resolve player names.
    const allPids = [...new Set(aggs.flatMap((a) => a.playerIds.split(',').map(Number)))];
    const names = await playerNames(allPids);
    const label = (a: Agg) =>
      a.playerIds.split(',').map((id) => names.get(Number(id)) ?? `#${id}`).join(' / ');

    // -- Top 10 by minutes --
    console.log(`\n  Top 10 lineups by minutes:`);
    for (const a of [...aggs].sort((x, y) => y.seconds - x.seconds).slice(0, 10)) {
      console.log(`    ${mmss(a.seconds).padStart(7)}  ${label(a)}`);
    }

    // -- Net PPP leaderboards --
    const withRates = aggs.map((a) => ({
      ...a,
      netPpp: a.possFor >= 1 && a.possAgainst >= 1
        ? a.pointsFor / a.possFor - a.pointsAgainst / a.possAgainst : null,
      xNetPpp: a.possFor >= 1 && a.possAgainst >= 1
        ? a.xPtsFor / a.possFor - a.xPtsAgainst / a.possAgainst : null,
    }));

    // RAW (no threshold)
    console.log(`\n  Top 10 by actual net PPP (RAW — no minimum):`);
    for (const a of [...withRates].filter((a) => a.netPpp !== null)
      .sort((x, y) => (y.netPpp ?? 0) - (x.netPpp ?? 0)).slice(0, 10)) {
      console.log(`    ${fmt(a.netPpp).padStart(6)}  poss=${a.possFor.toFixed(0).padStart(3)}  ${mmss(a.seconds).padStart(7)}  ${label(a)}`);
    }

    // FILTERED
    const filtered = withRates.filter(
      (a) => a.netPpp !== null && (a.possFor >= MIN_POSS || a.seconds >= MIN_SECONDS),
    );
    console.log(`\n  Top 10 by actual net PPP (FILTERED ≥${MIN_POSS} poss OR ≥${MIN_SECONDS / 60}min):`);
    if (filtered.length === 0) {
      console.log(`    (no lineup meets the threshold)`);
    } else {
      for (const a of [...filtered].sort((x, y) => (y.netPpp ?? 0) - (x.netPpp ?? 0)).slice(0, 10)) {
        console.log(`    ${fmt(a.netPpp).padStart(6)}  poss=${a.possFor.toFixed(0).padStart(3)}  ${mmss(a.seconds).padStart(7)}  ${label(a)}`);
      }
    }

    console.log(`\n  Top 10 by EXPECTED net PPP (FILTERED ≥${MIN_POSS} poss OR ≥${MIN_SECONDS / 60}min):`);
    if (filtered.length === 0) {
      console.log(`    (no lineup meets the threshold)`);
    } else {
      for (const a of [...filtered].sort((x, y) => (y.xNetPpp ?? 0) - (x.xNetPpp ?? 0)).slice(0, 10)) {
        console.log(`    ${fmt(a.xNetPpp).padStart(6)}  poss=${a.possFor.toFixed(0).padStart(3)}  ${mmss(a.seconds).padStart(7)}  ${label(a)}`);
      }
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
