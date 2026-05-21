import 'dotenv/config';
import { prisma } from '../lib/prisma';

async function main() {
  const seasonArg = process.argv.find((a) => a.startsWith('--season='));
  const season = seasonArg ? Number(seasonArg.split('=')[1]) : undefined;

  console.log('=== DB COVERAGE AUDIT ===');
  console.log(season ? `Season filter: ${season}` : 'Season filter: ALL');
  console.log('');

  // Seasons present
  const gameSeasons = await prisma.game.groupBy({
    by: ['season'],
    _count: { id: true },
    orderBy: { season: 'asc' },
  });
  console.log('Games by season:');
  for (const s of gameSeasons) console.log(`  ${s.season}: ${s._count.id} games`);
  console.log('');

  const teams = await prisma.team.count();
  const players = await prisma.player.count();
  const games = await prisma.game.count(season ? { where: { season } } : {});
  const plays = season
    ? await prisma.play.count({ where: { game: { season } } })
    : await prisma.play.count();

  // Conferences
  const confRows = await prisma.team.groupBy({
    by: ['conference'],
    _count: { id: true },
    orderBy: { conference: 'asc' },
  });

  // Non-FT FGA: shootingPlay shots that are not free throws
  const nonFtFga = season
    ? await prisma.play.count({
        where: {
          game: { season },
          shootingPlay: true,
          shotRange: { not: 'free_throw' },
        },
      })
    : await prisma.play.count({
        where: { shootingPlay: true, shotRange: { not: 'free_throw' } },
      });

  // Coordinate-tagged non-FT FGA
  const coordFga = season
    ? await prisma.play.count({
        where: {
          game: { season },
          shootingPlay: true,
          shotRange: { not: 'free_throw' },
          shotX: { not: null },
          shotY: { not: null },
        },
      })
    : await prisma.play.count({
        where: {
          shootingPlay: true,
          shotRange: { not: 'free_throw' },
          shotX: { not: null },
          shotY: { not: null },
        },
      });

  // Training shots: coordinate-tagged non-FT FGA with a known shotMade label
  const trainingShots = season
    ? await prisma.play.count({
        where: {
          game: { season },
          shootingPlay: true,
          shotRange: { not: 'free_throw' },
          shotX: { not: null },
          shotY: { not: null },
          shotMade: { not: null },
        },
      })
    : await prisma.play.count({
        where: {
          shootingPlay: true,
          shotRange: { not: 'free_throw' },
          shotX: { not: null },
          shotY: { not: null },
          shotMade: { not: null },
        },
      });

  console.log(`Teams loaded:          ${teams}`);
  console.log(`Players loaded:        ${players}`);
  console.log(`Games loaded:          ${games}`);
  console.log(`Plays loaded:          ${plays}`);
  console.log(`Non-FT FGA:            ${nonFtFga}`);
  console.log(`Coordinate-tagged FGA: ${coordFga}`);
  console.log(`Training shots:        ${trainingShots}`);
  console.log(
    `Coordinate coverage:   ${nonFtFga > 0 ? ((coordFga / nonFtFga) * 100).toFixed(1) : 0}%`,
  );
  console.log('');

  console.log(`Conferences represented (${confRows.length}):`);
  for (const c of confRows) {
    console.log(`  ${c.conference ?? '(null)'}: ${c._count.id} teams`);
  }
  console.log('');

  // Is data mostly Big West?
  const bigWestTeams = confRows.find((c) => (c.conference ?? '').toLowerCase().includes('big west'));
  const bwCount = bigWestTeams?._count.id ?? 0;
  console.log(
    `Big West teams: ${bwCount} of ${teams} (${teams > 0 ? ((bwCount / teams) * 100).toFixed(0) : 0}%)`,
  );
}

main()
  .catch((e) => {
    console.error('ERROR:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
