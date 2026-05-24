/**
 * Coordinate-coverage QA for the xeFG training pool, run before retraining.
 *
 * Reports, per season:
 *   - non-FT FGA, coordinate-tagged FGA, coverage %
 *   - missing-coordinate FGA by month / conference / team
 *   - games with zero coordinate shots
 *
 * Aggregation runs in Postgres (raw SQL) so we never stream ~700K rows into
 * Node — the all-rows approach trips the Supabase pooled connection.
 *
 * Usage: npx tsx scripts/xefg-coverage-qa.ts --seasons 2025,2026
 */
import 'dotenv/config';
import { prisma } from '../lib/prisma';

function parseSeasons(): number[] {
  const i = process.argv.indexOf('--seasons');
  if (i >= 0 && process.argv[i + 1]) {
    return process.argv[i + 1].split(',').map((s) => Number(s.trim()));
  }
  return [2025, 2026];
}

const FGA_FILTER = `p."shootingPlay" = true AND p."shotRange" <> 'free_throw'`;

async function qaSeason(season: number) {
  console.log(`\n${'='.repeat(60)}\nSEASON ${season}\n${'='.repeat(60)}`);

  // --- Totals ---
  const totals = await prisma.$queryRawUnsafe<Array<{ total: bigint; tagged: bigint }>>(
    `SELECT COUNT(*)::bigint AS total,
            COUNT(p."shotX")::bigint AS tagged
     FROM plays p JOIN games g ON g.id = p."gameId"
     WHERE g.season = $1 AND ${FGA_FILTER}`,
    season,
  );
  const total = Number(totals[0].total);
  const tagged = Number(totals[0].tagged);
  const missing = total - tagged;
  console.log(`Non-FT FGA:            ${total.toLocaleString()}`);
  console.log(`Coordinate-tagged FGA: ${tagged.toLocaleString()}`);
  console.log(`Missing coordinates:   ${missing.toLocaleString()}`);
  console.log(`Coverage:              ${total ? ((tagged / total) * 100).toFixed(1) : 0}%`);

  // --- Missing by month ---
  const months = await prisma.$queryRawUnsafe<
    Array<{ month: string; total: bigint; missing: bigint }>
  >(
    `SELECT to_char(g."startDate", 'YYYY-MM') AS month,
            COUNT(*)::bigint AS total,
            (COUNT(*) - COUNT(p."shotX"))::bigint AS missing
     FROM plays p JOIN games g ON g.id = p."gameId"
     WHERE g.season = $1 AND ${FGA_FILTER}
     GROUP BY 1 ORDER BY 1`,
    season,
  );
  console.log('\nMissing-coordinate FGA by month:');
  for (const m of months) {
    const t = Number(m.total);
    const miss = Number(m.missing);
    console.log(`  ${m.month}: ${miss.toLocaleString()}/${t.toLocaleString()} missing (${((miss / t) * 100).toFixed(1)}%)`);
  }

  // --- Missing by conference ---
  const confs = await prisma.$queryRawUnsafe<
    Array<{ conference: string | null; total: bigint; missing: bigint }>
  >(
    `SELECT t.conference,
            COUNT(*)::bigint AS total,
            (COUNT(*) - COUNT(p."shotX"))::bigint AS missing
     FROM plays p
     JOIN games g ON g.id = p."gameId"
     LEFT JOIN teams t ON t.id = p."teamId"
     WHERE g.season = $1 AND ${FGA_FILTER}
     GROUP BY 1 ORDER BY (COUNT(*) - COUNT(p."shotX"))::float / NULLIF(COUNT(*),0) DESC
     LIMIT 12`,
    season,
  );
  console.log('\nMissing-coordinate FGA by conference (worst 12):');
  for (const c of confs) {
    const t = Number(c.total);
    const miss = Number(c.missing);
    console.log(`  ${(c.conference ?? '(unknown)').padEnd(16)} ${miss.toLocaleString()}/${t.toLocaleString()} (${((miss / t) * 100).toFixed(1)}%)`);
  }

  // --- Missing by team (>=50 FGA) ---
  const teams = await prisma.$queryRawUnsafe<
    Array<{ school: string | null; total: bigint; missing: bigint }>
  >(
    `SELECT t.school,
            COUNT(*)::bigint AS total,
            (COUNT(*) - COUNT(p."shotX"))::bigint AS missing
     FROM plays p
     JOIN games g ON g.id = p."gameId"
     LEFT JOIN teams t ON t.id = p."teamId"
     WHERE g.season = $1 AND ${FGA_FILTER}
     GROUP BY t.school HAVING COUNT(*) >= 50
     ORDER BY (COUNT(*) - COUNT(p."shotX"))::float / NULLIF(COUNT(*),0) DESC
     LIMIT 15`,
    season,
  );
  console.log('\nMissing-coordinate FGA by team (worst 15, >=50 FGA):');
  for (const t of teams) {
    const tot = Number(t.total);
    const miss = Number(t.missing);
    console.log(`  ${(t.school ?? '(unknown)').padEnd(26)} ${miss}/${tot} (${((miss / tot) * 100).toFixed(1)}%)`);
  }

  // --- Games with zero coordinate shots ---
  const zeroGames = await prisma.$queryRawUnsafe<Array<{ zero: bigint; withfga: bigint }>>(
    `SELECT COUNT(*) FILTER (WHERE tagged = 0)::bigint AS zero,
            COUNT(*)::bigint AS withfga
     FROM (
       SELECT p."gameId", COUNT(p."shotX") AS tagged
       FROM plays p JOIN games g ON g.id = p."gameId"
       WHERE g.season = $1 AND ${FGA_FILTER}
       GROUP BY p."gameId"
     ) sub`,
    season,
  );
  console.log(
    `\nGames with FGA but ZERO coordinate shots: ${Number(zeroGames[0].zero)} of ${Number(zeroGames[0].withfga)} games with FGA`,
  );

  return { season, total, tagged, missing };
}

async function main() {
  const seasons = parseSeasons();
  console.log(`xeFG coverage QA — seasons: ${seasons.join(', ')}`);

  const results = [];
  for (const s of seasons) results.push(await qaSeason(s));

  console.log(`\n${'='.repeat(60)}\nCOMBINED\n${'='.repeat(60)}`);
  const totalAll = results.reduce((a, r) => a + r.total, 0);
  const taggedAll = results.reduce((a, r) => a + r.tagged, 0);
  console.log(`Total non-FT FGA:      ${totalAll.toLocaleString()}`);
  console.log(`Total coordinate FGA:  ${taggedAll.toLocaleString()} (training pool)`);
  console.log(`Combined coverage:     ${((taggedAll / totalAll) * 100).toFixed(1)}%`);
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
