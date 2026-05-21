#!/usr/bin/env tsx
/**
 * Derive per-team opponent season stats from play-by-play, in bulk.
 *
 * Replaces the per-game loop in derive-opponent-stats.ts: that issued
 * ~2 queries per team-game (~120k queries at national scale). This does the
 * whole season in a handful of set-based SQL aggregations.
 *
 * For a team T, "opponent" stats are the offensive production of every team
 * that is NOT T, in games T played. Each (team_in_game, opponent) pair is
 * derived from games + plays joined on gameId.
 *
 * Usage: npx tsx scripts/derive-opponent-stats-bulk.ts --season=2026
 */
import 'dotenv/config';
import { prisma } from '../lib/prisma';

const seasonArg = process.argv.find((a) => a.startsWith('--season='));
const SEASON = seasonArg ? Number(seasonArg.split('=')[1]) : 2026;

type OppRow = {
  team_id: number;
  opp_fga: number;
  opp_fgm: number;
  opp_3pa: number;
  opp_3pm: number;
  opp_fta: number;
  opp_ftm: number;
  opp_oreb: number;
  opp_dreb: number;
  opp_to: number;
  opp_pts: number;
};

// Per-team-batch query. Bounding `our_team_game` to a small set of teams keeps
// the hash join against the huge `plays` table from spilling to Postgres temp
// disk (the unbounded form errors with "No space left on device").
const BATCH_SQL = `
  WITH team_games AS (
    SELECT g.id AS game_id, g."homeTeamId" AS t1, g."awayTeamId" AS t2
    FROM games g
    WHERE g.season = $1
  ),
  our_team_game AS (
    SELECT t1 AS team_id, game_id FROM team_games WHERE t1 = ANY($2::int[])
    UNION ALL
    SELECT t2 AS team_id, game_id FROM team_games WHERE t2 = ANY($2::int[])
  )
  SELECT
    otg.team_id,
    COALESCE(SUM(CASE WHEN p."shootingPlay" = true AND p."scoreValue" <> 1 THEN 1 ELSE 0 END), 0)::int AS opp_fga,
    COALESCE(SUM(CASE WHEN p."shootingPlay" = true AND p."scoreValue" <> 1 AND p."shotMade" = true THEN 1 ELSE 0 END), 0)::int AS opp_fgm,
    COALESCE(SUM(CASE WHEN p."shootingPlay" = true AND p."scoreValue" = 3 THEN 1 ELSE 0 END), 0)::int AS opp_3pa,
    COALESCE(SUM(CASE WHEN p."scoreValue" = 3 AND p."shotMade" = true THEN 1 ELSE 0 END), 0)::int AS opp_3pm,
    COALESCE(SUM(CASE WHEN p."playType" = 'MadeFreeThrow' THEN 1 ELSE 0 END), 0)::int AS opp_fta,
    COALESCE(SUM(CASE WHEN p."playType" = 'MadeFreeThrow' THEN 1 ELSE 0 END), 0)::int AS opp_ftm,
    COALESCE(SUM(CASE WHEN p."playType" = 'Offensive Rebound' THEN 1 ELSE 0 END), 0)::int AS opp_oreb,
    COALESCE(SUM(CASE WHEN p."playType" = 'Defensive Rebound' THEN 1 ELSE 0 END), 0)::int AS opp_dreb,
    COALESCE(SUM(CASE WHEN p."playType" = 'Lost Ball Turnover' THEN 1 ELSE 0 END), 0)::int AS opp_to,
    COALESCE(SUM(CASE WHEN p."scoringPlay" = true THEN COALESCE(p."scoreValue", 0) ELSE 0 END), 0)::int AS opp_pts
  FROM our_team_game otg
  JOIN plays p
    ON p."gameId" = otg.game_id
   AND p."teamId" IS NOT NULL
   AND p."teamId" <> otg.team_id
  GROUP BY otg.team_id
`;

async function main() {
  console.log(`Bulk opponent-stat derivation · season ${SEASON}\n`);

  // Teams to process: every team with a season-stats row this season.
  const statRows = await prisma.teamSeasonStats.findMany({
    where: { season: SEASON },
    select: { teamId: true },
  });
  const teamIds = statRows.map((r) => r.teamId);
  console.log(`  ${teamIds.length} teams to process`);

  const BATCH = 40;
  const rows: OppRow[] = [];
  for (let i = 0; i < teamIds.length; i += BATCH) {
    const batch = teamIds.slice(i, i + BATCH);
    const batchRows = await prisma.$queryRawUnsafe<OppRow[]>(BATCH_SQL, SEASON, batch);
    rows.push(...batchRows);
    process.stdout.write(`\r  aggregated ${Math.min(i + BATCH, teamIds.length)}/${teamIds.length} teams`);
  }
  console.log(`\n  ${rows.length} teams with opponent data\n`);

  // Note: FTA/FTM only count MADE free throws — CBBD play-by-play has no
  // "MissedFreeThrow" rows in this DB, so opp FTA is really opp FTM. The team
  // page uses oppFreeThrowsAttempted only for defensive FTR; documented limit.
  let updated = 0;
  for (const r of rows) {
    const oppPoss = r.opp_fga + 0.44 * r.opp_fta - r.opp_oreb + r.opp_to;
    await prisma.teamSeasonStats.updateMany({
      where: { teamId: r.team_id, season: SEASON },
      data: {
        oppFieldGoalsAttempted: r.opp_fga,
        oppFieldGoalsMade: r.opp_fgm,
        oppThreePointsAttempted: r.opp_3pa,
        oppThreePointsMade: r.opp_3pm,
        oppFreeThrowsAttempted: r.opp_fta,
        oppFreeThrowsMade: r.opp_ftm,
        oppOffensiveRebounds: r.opp_oreb,
        oppDefensiveRebounds: r.opp_dreb,
        oppTurnovers: r.opp_to,
        oppPoints: r.opp_pts,
        oppPossessions: oppPoss,
      },
    });
    updated++;
  }
  console.log(`Updated ${updated} team_season_stats rows for season ${SEASON}.`);

  // Audit a few known teams.
  for (const teamId of [308, 310, 311]) {
    const s = await prisma.teamSeasonStats.findUnique({
      where: { teamId_season: { teamId, season: SEASON } },
    });
    if (!s) continue;
    const oreb = s.offensiveRebounds ?? 0;
    const oppDreb = s.oppDefensiveRebounds ?? 0;
    const orebPct = oreb + oppDreb > 0 ? (oreb / (oreb + oppDreb)) * 100 : null;
    console.log(
      `  team ${teamId}: oppDREB=${oppDreb} oppPts=${s.oppPoints} oppPoss=${s.oppPossessions?.toFixed(0)} -> OREB% ${orebPct?.toFixed(1) ?? 'n/a'}`,
    );
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
