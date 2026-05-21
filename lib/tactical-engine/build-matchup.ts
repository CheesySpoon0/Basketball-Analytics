// ============================================================================
// build-matchup.ts
//
// Pure Prisma → MatchupData adapter. No UCI-specific logic — the team page
// and coach-brief route choose which team is `subject` and which is `opponent`.
//
// Computes:
//   - TeamProfile for both teams (four factors, ratings, shot mix, defense,
//     and TRUE opp shot-zone allowed derived from Play rows where teamId is
//     not this team)
//   - PlayerProfile for opponent's top scorers (rim/3PT splits, share of FGAs)
//
// Honest about availability: any number that can't be computed from the
// schema is returned as null. Rules MUST guard against null.
// ============================================================================
import { prisma } from '../prisma';
import { shotDistanceFt } from '../../components/Court';
import { DEFAULT_SEASON } from '../season';
import type { MatchupData, TeamProfile, PlayerProfile } from './types';

/** Re-exported so existing imports from this module keep working. */
export { DEFAULT_SEASON };

/**
 * Minimum opp FGAs we want before reporting any zone-allowed number.
 * Below this, the noise overwhelms the signal (one good shooting night swings the FG%).
 */
const MIN_OPP_ZONE_SAMPLE = 200;

/** Per-zone minimum. Rules can be stricter; this is the floor for surfacing the number at all. */
const MIN_OPP_RIM_FGA_FOR_ZONE_PCT = 100;
const MIN_OPP_MID_FGA_FOR_ZONE_PCT = 100;
const MIN_OPP_THREE_PA_FOR_ZONE_PCT = 100;

type Zone = 'rim' | 'mid' | 'three';

function classifyZone(range: string | null, rawX: number, rawY: number): Zone {
  if (range === 'three_pointer') return 'three';
  if (range === 'rim') return 'rim';
  if (shotDistanceFt(rawX, rawY) < 4) return 'rim';
  return 'mid';
}

function pctSafe(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

/**
 * Pull opponent shot-zone aggregates for one team-season:
 *   "all shots taken BY THE OTHER TEAM in games this team played"
 *
 * Attribution: Play.teamId. Verified 100% agreement with Player.teamId on UCI
 * 2025 data (2,236 / 2,236), so the join via Play.player is unnecessary here.
 *
 * Free throws are explicitly excluded; only coordinate-bearing FGAs are counted.
 */
async function buildOpponentZoneAllowed(
  teamId: number,
  season: number,
): Promise<{
  rim: { att: number; made: number };
  mid: { att: number; made: number };
  three: { att: number; made: number };
  total: number;
}> {
  const games = await prisma.game.findMany({
    where: { season, OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] },
    select: { id: true },
  });
  const gameIds = games.map((g) => g.id);
  if (gameIds.length === 0) {
    return { rim: { att: 0, made: 0 }, mid: { att: 0, made: 0 }, three: { att: 0, made: 0 }, total: 0 };
  }

  const oppShots = await prisma.play.findMany({
    where: {
      gameId: { in: gameIds },
      teamId: { not: teamId, notIn: [] },
      shotX: { not: null },
      shotY: { not: null },
      shotRange: { not: 'free_throw' },
    },
    select: { teamId: true, shotMade: true, shotRange: true, shotX: true, shotY: true },
  });
  // Filter null-team rows defensively (Prisma's `not: teamId` keeps null per SQL semantics)
  const cleaned = oppShots.filter((s) => s.teamId !== null && s.teamId !== teamId);

  const zones = {
    rim: { att: 0, made: 0 },
    mid: { att: 0, made: 0 },
    three: { att: 0, made: 0 },
  };
  for (const s of cleaned) {
    const z = classifyZone(s.shotRange, s.shotX!, s.shotY!);
    zones[z].att += 1;
    if (s.shotMade) zones[z].made += 1;
  }
  return { ...zones, total: cleaned.length };
}

async function buildTeamProfile(teamId: number, teamName: string, season: number): Promise<TeamProfile | null> {
  const stats = await prisma.teamSeasonStats.findUnique({
    where: { teamId_season: { teamId, season } },
  });
  if (!stats) return null;

  const games = stats.games ?? 0;
  const wins = stats.wins ?? 0;
  const losses = stats.losses ?? 0;
  const fga = stats.fieldGoalsAttempted ?? 0;
  const fgm = stats.fieldGoalsMade ?? 0;
  const tpa = stats.threePointsAttempted ?? 0;
  const tpm = stats.threePointsMade ?? 0;
  const fta = stats.freeThrowsAttempted ?? 0;
  const oreb = stats.offensiveRebounds ?? 0;
  const dreb = stats.defensiveRebounds ?? 0;
  const to = stats.turnoversTotal ?? 0;
  const pts = stats.pointsTotal ?? 0;

  // Own efficiency
  const efgPct = pctSafe(fgm + 0.5 * tpm, fga);
  const ftr = pctSafe(fta, fga);
  const poss = fga + 0.44 * fta - oreb + to;
  const tovPct = poss > 0 ? to / poss : null;
  const ortg = poss > 0 ? (pts / poss) * 100 : null;
  const pace = games > 0 ? poss / games : null;

  // Defensive aggregates (box-score)
  const oppFga = stats.oppFieldGoalsAttempted ?? 0;
  const oppFgm = stats.oppFieldGoalsMade ?? 0;
  const oppFta = stats.oppFreeThrowsAttempted ?? 0;
  const oppOreb = stats.oppOffensiveRebounds ?? 0;
  const oppTo = stats.oppTurnovers ?? 0;
  const oppPoints = stats.oppPoints ?? 0;
  const oppPoss = stats.oppPossessions ?? 0;

  const oppEfgAllowed = pctSafe(oppFgm + 0.5 * (stats.oppThreePointsMade ?? 0), oppFga);
  const oppFtrAllowed = pctSafe(oppFta, oppFga);
  const oppOrebAllowed = pctSafe(oppOreb, oppOreb + dreb);
  const oppForcedTovPct = oppPoss > 0 ? oppTo / oppPoss : null;
  const drtg = oppPoss > 0 ? (oppPoints / oppPoss) * 100 : null;
  const orebPct = pctSafe(oreb, oreb + (stats.oppDefensiveRebounds ?? 0));

  // True defensive shot-zone allowed — derived from Play rows
  const oppZones = await buildOpponentZoneAllowed(teamId, season);
  const oppFgaTracked = oppZones.total;
  const totalEnough = oppFgaTracked >= MIN_OPP_ZONE_SAMPLE;

  // Per-zone surfacing: null if too few opp attempts in that zone OR if total sample too small.
  const oppRimFga = totalEnough && oppZones.rim.att >= MIN_OPP_RIM_FGA_FOR_ZONE_PCT ? oppZones.rim.att : null;
  const oppRimFgm = oppRimFga !== null ? oppZones.rim.made : null;
  const oppRimFgPct = oppRimFga !== null ? pctSafe(oppZones.rim.made, oppZones.rim.att) : null;

  const oppMidFga = totalEnough && oppZones.mid.att >= MIN_OPP_MID_FGA_FOR_ZONE_PCT ? oppZones.mid.att : null;
  const oppMidFgm = oppMidFga !== null ? oppZones.mid.made : null;
  const oppMidFgPct = oppMidFga !== null ? pctSafe(oppZones.mid.made, oppZones.mid.att) : null;

  const oppThreePaAllowed =
    totalEnough && oppZones.three.att >= MIN_OPP_THREE_PA_FOR_ZONE_PCT ? oppZones.three.att : null;
  const oppThreePmAllowed = oppThreePaAllowed !== null ? oppZones.three.made : null;
  const oppThreePctAllowed = oppThreePaAllowed !== null ? pctSafe(oppZones.three.made, oppZones.three.att) : null;

  // Rates (denominators are total tracked, so they're all consistent)
  const oppRimRateAllowed = totalEnough ? pctSafe(oppZones.rim.att, oppFgaTracked) : null;
  const oppMidRateAllowed = totalEnough ? pctSafe(oppZones.mid.att, oppFgaTracked) : null;
  const oppThreeRateAllowed = totalEnough ? pctSafe(oppZones.three.att, oppFgaTracked) : null;

  // Shot mix + zone FG% for own offense (existing logic)
  const shotPlays = await prisma.play.findMany({
    where: {
      teamId,
      shotX: { not: null },
      shotY: { not: null },
      shotRange: { not: 'free_throw' },
      game: { season },
    },
    select: { shotX: true, shotY: true, shotMade: true, shotRange: true },
  });
  const ownZones: Record<Zone, { att: number; made: number }> = {
    rim: { att: 0, made: 0 },
    mid: { att: 0, made: 0 },
    three: { att: 0, made: 0 },
  };
  for (const p of shotPlays) {
    const z = classifyZone(p.shotRange, p.shotX!, p.shotY!);
    ownZones[z].att++;
    if (p.shotMade) ownZones[z].made++;
  }
  const totalShots = shotPlays.length;

  const rimRate = pctSafe(ownZones.rim.att, totalShots);
  const midRate = pctSafe(ownZones.mid.att, totalShots);
  const threeRate = pctSafe(ownZones.three.att, totalShots);
  const rimPct = pctSafe(ownZones.rim.made, ownZones.rim.att);
  const midPct = pctSafe(ownZones.mid.made, ownZones.mid.att);
  const threePct = pctSafe(tpm, tpa);
  const threePerGame = games > 0 ? tpa / games : null;

  return {
    teamId,
    name: teamName,
    record: `${wins}-${losses}`,
    pace,
    ortg,
    drtg,
    efgPct,
    tovPct,
    orebPct,
    ftr,
    rimRate,
    midRate,
    threeRate,
    rimPct,
    midPct,
    threePct,
    threePerGame,
    oppEfgAllowed,
    oppFtrAllowed,
    oppOrebAllowed,
    oppForcedTovPct,
    // Zone-allowed (Play-derived)
    oppRimFga,
    oppRimFgm,
    oppRimFgPct,
    oppMidFga,
    oppMidFgm,
    oppMidFgPct,
    oppThreePaAllowed,
    oppThreePmAllowed,
    oppThreePctAllowed,
    oppRimRateAllowed,
    oppMidRateAllowed,
    oppThreeRateAllowed,
    oppFgaTracked,
  };
}

async function buildOpponentTopPlayers(
  teamId: number,
  teamFga: number,
  season: number,
  limit = 6,
): Promise<PlayerProfile[]> {
  const roster = await prisma.player.findMany({
    where: { teamId },
    include: { seasonStats: { where: { season } } },
  });
  const withStats = roster
    .map((p) => ({ player: p, stats: p.seasonStats[0] ?? null }))
    .filter((r) => r.stats && (r.stats.games ?? 0) > 0)
    .sort((a, b) => (b.stats!.points ?? 0) - (a.stats!.points ?? 0))
    .slice(0, limit);

  const playerIds = withStats.map((r) => r.player.id);
  const playerShots = playerIds.length > 0
    ? await prisma.play.findMany({
        where: {
          playerId: { in: playerIds },
          shotX: { not: null },
          shotY: { not: null },
          shotRange: { not: 'free_throw' },
          game: { season },
        },
        select: { playerId: true, shotMade: true, shotRange: true, shotX: true, shotY: true },
      })
    : [];

  const byPlayer = new Map<number, { rim: { att: number; made: number }; total: number }>();
  for (const s of playerShots) {
    if (s.playerId === null) continue;
    let agg = byPlayer.get(s.playerId);
    if (!agg) {
      agg = { rim: { att: 0, made: 0 }, total: 0 };
      byPlayer.set(s.playerId, agg);
    }
    agg.total += 1;
    const z = classifyZone(s.shotRange, s.shotX!, s.shotY!);
    if (z === 'rim') {
      agg.rim.att += 1;
      if (s.shotMade) agg.rim.made += 1;
    }
  }

  return withStats.map((r) => {
    const p = r.player;
    const s = r.stats!;
    const g = s.games ?? 0;
    const fga = s.fieldGoalsAttempted ?? 0;
    const fgm = s.fieldGoalsMade ?? 0;
    const tpa = s.threePointsAttempted ?? 0;
    const tpm = s.threePointsMade ?? 0;

    const shotAgg = byPlayer.get(p.id);
    const playerTotalShots = shotAgg?.total ?? 0;
    const rimAtt = shotAgg?.rim.att ?? 0;
    const rimMade = shotAgg?.rim.made ?? 0;

    return {
      playerId: p.id,
      name: p.name ?? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim(),
      position: p.position ?? null,
      jersey: p.jersey ?? null,
      gamesPlayed: g,
      ppg: g > 0 ? (s.points ?? 0) / g : 0,
      rpg: g > 0 ? (s.rebounds ?? 0) / g : 0,
      apg: g > 0 ? (s.assists ?? 0) / g : 0,
      fgPct: pctSafe(fgm, fga),
      efgPct: pctSafe(fgm + 0.5 * tpm, fga),
      threePct: pctSafe(tpm, tpa),
      threePerGame: g > 0 ? tpa / g : null,
      threeAttempts: tpa,
      rimPct: pctSafe(rimMade, rimAtt),
      rimRate: pctSafe(rimAtt, playerTotalShots),
      threeRate: pctSafe(tpa, fga),
      shareOfTeamFga: pctSafe(fga, teamFga),
    };
  });
}

/**
 * Build MatchupData for `subjectTeamId` (the team being scouted FOR — UCI by
 * default in the current UI) vs `opponentTeamId`. Engine-side code is fully
 * generic; the caller decides which team plays which role.
 */
export async function buildMatchupData(
  subjectTeamId: number,
  opponentTeamId: number,
  season: number = DEFAULT_SEASON,
): Promise<MatchupData | null> {
  const [subjectTeam, opponentTeam] = await Promise.all([
    prisma.team.findUnique({ where: { id: subjectTeamId } }),
    prisma.team.findUnique({ where: { id: opponentTeamId } }),
  ]);
  if (!subjectTeam || !opponentTeam) return null;

  const [subjectProfile, opponentProfile] = await Promise.all([
    buildTeamProfile(subjectTeamId, subjectTeam.school, season),
    buildTeamProfile(opponentTeamId, opponentTeam.school, season),
  ]);
  if (!subjectProfile || !opponentProfile) return null;

  // Opponent FGA total (used to compute each top player's share of team FGAs)
  const oppRaw = await prisma.teamSeasonStats.findUnique({
    where: { teamId_season: { teamId: opponentTeamId, season } },
    select: { fieldGoalsAttempted: true },
  });
  const oppTeamFga = oppRaw?.fieldGoalsAttempted ?? 0;

  const opponentTopPlayers = await buildOpponentTopPlayers(opponentTeamId, oppTeamFga, season, 6);

  return {
    subject: subjectProfile,
    opponent: opponentProfile,
    opponentTopPlayers,
    season,
  };
}
