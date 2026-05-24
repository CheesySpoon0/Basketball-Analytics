#!/usr/bin/env tsx
/** One-off audit: understand substitution play structure for lineup derivation. */
import 'dotenv/config';
import { prisma } from '../lib/prisma';

async function main() {
  // 1. Sub counts by season
  const sub2025 = await prisma.play.count({ where: { playType: 'Substitution', game: { season: 2025 } } });
  const sub2026 = await prisma.play.count({ where: { playType: 'Substitution', game: { season: 2026 } } });
  const total = sub2025 + sub2026;
  console.log('\n=== Substitution counts by season ===');
  console.log(`  2025: ${sub2025}`);
  console.log(`  2026: ${sub2026}`);
  console.log(`  total: ${total}`);

  // 2. Null-field stats
  const nullPid = await prisma.play.count({ where: { playType: 'Substitution', playerId: null } });
  const nullSec = await prisma.play.count({ where: { playType: 'Substitution', secondsRemaining: null } });
  const nullTeam = await prisma.play.count({ where: { playType: 'Substitution', teamId: null } });
  console.log('\n=== Null field rates ===');
  console.log(`  playerId null:          ${nullPid} / ${total} (${(nullPid/total*100).toFixed(1)}%)`);
  console.log(`  secondsRemaining null:  ${nullSec} / ${total} (${(nullSec/total*100).toFixed(1)}%)`);
  console.log(`  teamId null:            ${nullTeam} / ${total} (${(nullTeam/total*100).toFixed(1)}%)`);

  // 3. Top playText patterns (grouped)
  const textPatterns = await prisma.play.groupBy({
    by: ['playText'],
    where: { playType: 'Substitution' },
    _count: { _all: true },
    orderBy: { _count: { playText: 'desc' } },
    take: 20,
  });
  console.log('\n=== Top 20 sub playText patterns ===');
  for (const t of textPatterns) console.log(`  (${t._count._all}x) ${t.playText}`);

  // 4. Games with subs — coverage check
  const gamesWithSubs2025 = await prisma.play.groupBy({
    by: ['gameId'],
    where: { playType: 'Substitution', game: { season: 2025 } },
  });
  const gamesWithSubs2026 = await prisma.play.groupBy({
    by: ['gameId'],
    where: { playType: 'Substitution', game: { season: 2026 } },
  });
  const totalGames2025 = await prisma.game.count({ where: { season: 2025 } });
  const totalGames2026 = await prisma.game.count({ where: { season: 2026 } });
  console.log('\n=== Games with substitution data ===');
  console.log(`  2025: ${gamesWithSubs2025.length} / ${totalGames2025} games (${(gamesWithSubs2025.length/totalGames2025*100).toFixed(1)}%)`);
  console.log(`  2026: ${gamesWithSubs2026.length} / ${totalGames2026} games (${(gamesWithSubs2026.length/totalGames2026*100).toFixed(1)}%)`);

  // 5. Subs per game distribution — UCI 2025
  const uciGames2025 = await prisma.game.findMany({
    where: { season: 2025, OR: [{ homeTeamId: 308 }, { awayTeamId: 308 }] },
    orderBy: { id: 'asc' },
  });
  console.log('\n=== Subs per game (UCI 2025) ===');
  for (const g of uciGames2025) {
    const n = await prisma.play.count({ where: { gameId: g.id, playType: 'Substitution' } });
    const plays = await prisma.play.count({ where: { gameId: g.id } });
    console.log(`  game ${g.id} (home:${g.homeTeamId} away:${g.awayTeamId}): ${n} subs / ${plays} total plays`);
  }

  // 6. Pick a game WITH subs — full sub listing
  const gameWithSubs = await prisma.play.findFirst({
    where: { playType: 'Substitution', game: { season: 2025, OR: [{ homeTeamId: 308 }, { awayTeamId: 308 }] } },
    select: { gameId: true },
  });
  if (gameWithSubs) {
    const g = await prisma.game.findUnique({ where: { id: gameWithSubs.gameId } });
    console.log(`\n=== Game ${gameWithSubs.gameId} (home:${g?.homeTeamId} away:${g?.awayTeamId}) — all subs ===`);
    const subs = await prisma.play.findMany({
      where: { gameId: gameWithSubs.gameId, playType: 'Substitution' },
      orderBy: [{ period: 'asc' }, { secondsRemaining: 'desc' }],
    });
    for (const s of subs) {
      console.log(`  p${s.period} ${String(s.clock).padEnd(6)} (${String(s.secondsRemaining).padEnd(4)}s) pid=${String(s.playerId ?? 'NULL').padEnd(6)} team=${s.teamId} | ${s.playText}`);
    }
    // Also show the beginning of period 1 (last 2 minutes clock = first to play)
    console.log(`\n=== Game ${gameWithSubs.gameId} — first 8 plays of each period ===`);
    for (const period of [1, 2]) {
      const first = await prisma.play.findMany({
        where: { gameId: gameWithSubs.gameId, period },
        orderBy: { secondsRemaining: 'desc' },
        take: 8,
      });
      console.log(`  --- Period ${period} ---`);
      for (const p of first) {
        console.log(`    ${p.clock} (${p.secondsRemaining}s) ${(p.playType ?? '').padEnd(20)} pid=${p.playerId} | ${p.playText}`);
      }
    }
  }

  // 7. UCSD 2025 game with subs
  const ucsdWithSubs = await prisma.play.findFirst({
    where: { playType: 'Substitution', game: { season: 2025, OR: [{ homeTeamId: 310 }, { awayTeamId: 310 }] } },
    select: { gameId: true },
  });
  if (ucsdWithSubs) {
    console.log(`\n=== UCSD game ${ucsdWithSubs.gameId} — subs ===`);
    const subs = await prisma.play.findMany({
      where: { gameId: ucsdWithSubs.gameId, playType: 'Substitution' },
      orderBy: [{ period: 'asc' }, { secondsRemaining: 'desc' }],
    });
    for (const s of subs) {
      console.log(`  p${s.period} ${String(s.clock).padEnd(6)} (${String(s.secondsRemaining).padEnd(4)}s) pid=${String(s.playerId ?? 'NULL').padEnd(6)} team=${s.teamId} | ${s.playText}`);
    }
  }

  // 8. Do any sub playTexts contain both "in" and "out" (single-row pairing)?
  const combinedRow = await prisma.play.count({
    where: {
      playType: 'Substitution',
      AND: [
        { playText: { contains: 'Subbing in' } },
        { playText: { contains: 'Subbing out' } },
      ],
    },
  });
  console.log(`\n=== Single-row combined in+out subs: ${combinedRow}`);

  // 9. PlayerSeasonStats minutes coverage
  const minStats = await prisma.playerSeasonStats.aggregate({
    where: { season: 2025, minutes: { gt: 0 } },
    _count: { _all: true },
    _avg: { minutes: true },
    _max: { minutes: true },
  });
  console.log('\n=== PlayerSeasonStats 2025 minutes coverage ===');
  console.log(`  players with minutes > 0: ${minStats._count._all}`);
  console.log(`  avg season minutes: ${minStats._avg.minutes?.toFixed(0)}`);
  console.log(`  max season minutes: ${minStats._max.minutes}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
