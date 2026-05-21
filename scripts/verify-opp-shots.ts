#!/usr/bin/env tsx
/**
 * Verify we can derive opponent shot-zone allowed from existing Play rows.
 * Checks:
 *  1) Plays exist for both teams in UCI games (i.e. opponent shots ARE in DB)
 *  2) Play.teamId agrees with Player.teamId for shot plays (attribution sanity)
 *  3) Sample of classified opponent shots for UCI
 */
import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { shotDistanceFt } from '../components/Court';

const SEASON = 2025;
const UCI = 308;

type Zone = 'rim' | 'mid' | 'three';
function classifyZone(range: string | null, x: number, y: number): Zone {
  if (range === 'three_pointer') return 'three';
  if (range === 'rim') return 'rim';
  if (shotDistanceFt(x, y) < 4) return 'rim';
  return 'mid';
}

async function main() {
  // 1) Game ids UCI played in
  const uciGames = await prisma.game.findMany({
    where: {
      season: SEASON,
      OR: [{ homeTeamId: UCI }, { awayTeamId: UCI }],
    },
    select: { id: true },
  });
  const gameIds = uciGames.map((g) => g.id);
  console.log(`UCI ${SEASON} games: ${gameIds.length}`);

  const allShots = await prisma.play.findMany({
    where: {
      gameId: { in: gameIds },
      shotX: { not: null },
      shotY: { not: null },
      shotRange: { not: 'free_throw' },
    },
    select: {
      id: true,
      teamId: true,
      playerId: true,
      shotMade: true,
      shotRange: true,
      shotX: true,
      shotY: true,
      player: { select: { teamId: true, name: true } },
    },
  });

  const uciShots = allShots.filter((s) => s.teamId === UCI);
  const oppShots = allShots.filter((s) => s.teamId !== null && s.teamId !== UCI);
  const nullTeam = allShots.filter((s) => s.teamId === null);
  console.log(
    `\nShots in UCI games: total=${allShots.length}  uci=${uciShots.length}  opp=${oppShots.length}  null-team=${nullTeam.length}`,
  );

  // 2) Attribution sanity: Play.teamId vs Player.teamId
  let agree = 0;
  let disagree = 0;
  let noPlayer = 0;
  const examples: Array<{ playTeam: number | null; playerTeam: number | null; player: string | null }> = [];
  for (const s of oppShots) {
    if (s.player === null) {
      noPlayer++;
      continue;
    }
    if (s.player.teamId === s.teamId) agree++;
    else {
      disagree++;
      if (examples.length < 5)
        examples.push({ playTeam: s.teamId, playerTeam: s.player.teamId, player: s.player.name });
    }
  }
  console.log(
    `\nAttribution check (opp shots only):  agree=${agree}  disagree=${disagree}  noPlayerRow=${noPlayer}`,
  );
  if (examples.length) {
    console.log('  sample disagreements:');
    for (const e of examples) console.log('  ', e);
  }

  // 3) Classify and aggregate opponent shots vs UCI
  const zones: Record<Zone, { att: number; made: number }> = {
    rim: { att: 0, made: 0 },
    mid: { att: 0, made: 0 },
    three: { att: 0, made: 0 },
  };
  for (const s of oppShots) {
    const z = classifyZone(s.shotRange, s.shotX!, s.shotY!);
    zones[z].att++;
    if (s.shotMade) zones[z].made++;
  }
  const total = oppShots.length;
  console.log('\nOpponent shot zones vs UCI defense:');
  for (const z of ['rim', 'mid', 'three'] as Zone[]) {
    const a = zones[z];
    const pct = a.att > 0 ? ((a.made / a.att) * 100).toFixed(1) : '—';
    const rate = total > 0 ? ((a.att / total) * 100).toFixed(1) : '—';
    console.log(`  ${z.padEnd(6)} att=${String(a.att).padStart(4)}  made=${String(a.made).padStart(4)}  FG%=${pct}%  rate=${rate}%`);
  }

  // 4) Print a 10-shot classified sample
  console.log('\nSample of 10 classified opponent shots:');
  for (const s of oppShots.slice(0, 10)) {
    const z = classifyZone(s.shotRange, s.shotX!, s.shotY!);
    const dist = shotDistanceFt(s.shotX!, s.shotY!).toFixed(1);
    console.log(
      `  ${s.player?.name?.padEnd(22) ?? '???'.padEnd(22)}  team=${s.teamId}  range=${(s.shotRange ?? '—').padEnd(13)}  dist=${dist}ft  →${z.padEnd(6)}  ${s.shotMade ? 'MADE' : 'miss'}`,
    );
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
