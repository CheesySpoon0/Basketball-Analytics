// ============================================================================
// Build a PlayerScoutingReport from DB rows.
//
// Pure deterministic logic. No AI, no API calls. Fast enough to render on every
// player page load. Combines:
//   - legacy zone / shot-type / creation aggregation (kept for shot tables)
//   - the tendency profile (tendencies.ts) merged with PlayerXeFG zone deltas
//   - score-based archetype classification (archetype.ts)
//   - report confidence (confidence.ts)
//   - inferred defensive profile (defense.ts)
//   - two rule engines: volume-based (rules.ts) + xeFG-aware (xefg-rules.ts)
// ============================================================================
import { prisma } from '../prisma';
import { DEFAULT_SEASON } from '../season';
import { getPlayerXeFGCached } from '../xefg/cache';
import {
  classifyShotType,
  classifyThreeSubzone,
  classifyZone,
  isEndOfPeriod,
} from './shot-profile';
import { deriveScoutingPriority, runPlayerRules, type PlayerRuleInput } from './rules';
import { buildTendencyProfile, deriveTransitionShotIds, type TendencyPlay } from './tendencies';
import { deriveArchetype } from './archetype';
import { deriveConfidence } from './confidence';
import { buildObservedDefenseProfile } from './observed-defense';
import { runXeFGRules } from './xefg-rules';
import type {
  ContextAgg,
  CreationAgg,
  PlayerNote,
  PlayerScoutingReport,
  ShotType,
  ShotTypeAgg,
  ThreeSubzone,
  Zone,
  ZoneAgg,
} from './types';

/** @deprecated Resolve the season per-request via lib/season; kept for callers without a request context. */
export const SEASON = DEFAULT_SEASON;
export const ROTATION_MPG = 5;

const pct = (n: number, d: number): number | null => (d > 0 ? n / d : null);

function emptyZone(): ZoneAgg {
  return { att: 0, made: 0, pct: null, share: null };
}
function emptyShotType(): ShotTypeAgg {
  return { att: 0, made: 0, pct: null, share: null };
}

/** Dedup notes by id, keep highest priority, cap per bucket. */
function pickNotes(notes: PlayerNote[], bucket: PlayerNote['bucket'], cap: number): PlayerNote[] {
  const seen = new Set<string>();
  const out: PlayerNote[] = [];
  for (const n of notes.filter((x) => x.bucket === bucket).sort((a, b) => b.priority - a.priority)) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
    if (out.length >= cap) break;
  }
  return out;
}

export async function buildPlayerScoutingReport(
  playerId: number,
  season = DEFAULT_SEASON,
): Promise<PlayerScoutingReport | null> {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
  });
  if (!player) return null;

  const seasonStats = await prisma.playerSeasonStats.findUnique({
    where: { playerId_season: { playerId, season } },
    include: { team: true }, // Season-specific team
  });

  const teamFgaRow = seasonStats?.teamId
    ? await prisma.teamSeasonStats.findUnique({
        where: { teamId_season: { teamId: seasonStats.teamId, season } },
        select: { fieldGoalsAttempted: true },
      })
    : null;
  const teamFga = teamFgaRow?.fieldGoalsAttempted ?? 0;

  // ----- player's coordinate FGAs -----
  const plays = await prisma.play.findMany({
    where: {
      playerId,
      shotX: { not: null },
      shotY: { not: null },
      shotRange: { not: 'free_throw' },
      game: { season },
    },
    select: {
      id: true,
      gameId: true,
      shotMade: true,
      shotRange: true,
      shotX: true,
      shotY: true,
      playType: true,
      playText: true,
      shotAssisted: true,
      period: true,
      secondsRemaining: true,
    },
  });

  // ----- transition proxy: pull the FULL play stream for his games -----
  const gameIds = [...new Set(plays.map((p) => p.gameId))];
  const playerShotIds = new Set(plays.map((p) => p.id));
  let transitionShotIds = new Set<string>();
  if (gameIds.length > 0) {
    const streamPlays = await prisma.play.findMany({
      where: { gameId: { in: gameIds } },
      select: { id: true, gameId: true, period: true, secondsRemaining: true, playType: true },
    });
    const byGame = new Map<number, typeof streamPlays>();
    for (const sp of streamPlays) {
      const arr = byGame.get(sp.gameId) ?? [];
      arr.push(sp);
      byGame.set(sp.gameId, arr);
    }
    transitionShotIds = deriveTransitionShotIds(byGame, playerShotIds);
  }

  // ----- xeFG cache (season-keyed; carries per-zone actual vs expected) -----
  const xefg = await getPlayerXeFGCached(playerId, season);

  // ----- tendency profile -----
  const tendencyPlays: TendencyPlay[] = plays.map((p) => ({
    id: p.id,
    gameId: p.gameId,
    shotRange: p.shotRange,
    playType: p.playType,
    playText: p.playText,
    shotMade: p.shotMade,
    shotX: p.shotX,
    shotY: p.shotY,
    shotAssisted: p.shotAssisted,
    period: p.period,
    secondsRemaining: p.secondsRemaining,
  }));
  const tendencies = buildTendencyProfile(tendencyPlays, xefg, transitionShotIds);

  // ----- legacy zone / shot-type / creation aggregation (for shot tables) -----
  const zones: Record<Zone, ZoneAgg> = { rim: emptyZone(), mid: emptyZone(), three: emptyZone() };
  const shotTypes: Record<ShotType, ShotTypeAgg> = {
    layup: emptyShotType(),
    dunk: emptyShotType(),
    jumper: emptyShotType(),
    tip: emptyShotType(),
    unknown: emptyShotType(),
  };
  const threeSubzones: Record<ThreeSubzone, ZoneAgg> = { corner: emptyZone(), above_break: emptyZone() };
  let creationTracked = 0;
  let creationAssisted = 0;
  let creationUnassisted = 0;
  let assistedThree = 0;
  let threeTracked = 0;
  let assistedRim = 0;
  let rimTracked = 0;
  let unassistedJumper = 0;
  let jumperTracked = 0;
  let endOfPeriodFga = 0;
  let endOfPeriodMade = 0;

  for (const p of plays) {
    const zone = classifyZone({ shotRange: p.shotRange, shotX: p.shotX!, shotY: p.shotY! });
    const stype = classifyShotType({ playType: p.playType, playText: p.playText });
    zones[zone].att++;
    if (p.shotMade) zones[zone].made++;
    shotTypes[stype].att++;
    if (p.shotMade) shotTypes[stype].made++;
    if (zone === 'three') {
      const sub = classifyThreeSubzone(p.shotX!, p.shotY!);
      threeSubzones[sub].att++;
      if (p.shotMade) threeSubzones[sub].made++;
    }
    if (p.shotAssisted !== null) {
      creationTracked++;
      if (p.shotAssisted) creationAssisted++;
      else creationUnassisted++;
      if (zone === 'three') {
        threeTracked++;
        if (p.shotAssisted) assistedThree++;
      }
      if (zone === 'rim') {
        rimTracked++;
        if (p.shotAssisted) assistedRim++;
      }
      if (zone === 'mid' || zone === 'three') {
        jumperTracked++;
        if (!p.shotAssisted) unassistedJumper++;
      }
    }
    if (isEndOfPeriod(p)) {
      endOfPeriodFga++;
      if (p.shotMade) endOfPeriodMade++;
    }
  }

  const totalShots = plays.length;
  for (const z of ['rim', 'mid', 'three'] as Zone[]) {
    zones[z].pct = pct(zones[z].made, zones[z].att);
    zones[z].share = pct(zones[z].att, totalShots);
  }
  for (const k of Object.keys(shotTypes) as ShotType[]) {
    shotTypes[k].pct = pct(shotTypes[k].made, shotTypes[k].att);
    shotTypes[k].share = pct(shotTypes[k].att, totalShots);
  }
  for (const k of ['corner', 'above_break'] as ThreeSubzone[]) {
    threeSubzones[k].pct = pct(threeSubzones[k].made, threeSubzones[k].att);
    threeSubzones[k].share = pct(threeSubzones[k].att, totalShots);
  }

  const creation: CreationAgg = {
    tracked: creationTracked,
    assisted: creationAssisted,
    unassisted: creationUnassisted,
    assistedRate: pct(creationAssisted, creationTracked),
    unassistedRate: pct(creationUnassisted, creationTracked),
    assistedThree,
    threeTracked,
    assistedThreeRate: pct(assistedThree, threeTracked),
    assistedRim,
    rimTracked,
    assistedRimRate: pct(assistedRim, rimTracked),
    unassistedJumper,
    jumperTracked,
    unassistedJumperRate: pct(unassistedJumper, jumperTracked),
  };
  const context: ContextAgg = {
    endOfPeriodShots: endOfPeriodFga,
    endOfPeriodFga,
    endOfPeriodFgPct: pct(endOfPeriodMade, endOfPeriodFga),
  };

  // ----- season stats -----
  const games = seasonStats?.games ?? 0;
  const minutes = seasonStats?.minutes ?? 0;
  const mpg = games > 0 ? minutes / games : null;
  const ppg = games > 0 ? (seasonStats?.points ?? 0) / games : 0;
  const rpg = games > 0 ? (seasonStats?.rebounds ?? 0) / games : 0;
  const apg = games > 0 ? (seasonStats?.assists ?? 0) / games : 0;
  const spg = games > 0 ? (seasonStats?.steals ?? 0) / games : 0;
  const bpg = games > 0 ? (seasonStats?.blocks ?? 0) / games : 0;
  const topg = games > 0 ? (seasonStats?.turnovers ?? 0) / games : 0;
  const fpg = games > 0 ? (seasonStats?.fouls ?? 0) / games : 0;

  const fga = seasonStats?.fieldGoalsAttempted ?? 0;
  const fgm = seasonStats?.fieldGoalsMade ?? 0;
  const tpa = seasonStats?.threePointsAttempted ?? 0;
  const tpm = seasonStats?.threePointsMade ?? 0;
  const fta = seasonStats?.freeThrowsAttempted ?? 0;
  const ftm = seasonStats?.freeThrowsMade ?? 0;

  const fgPct = pct(fgm, fga);
  const efgPct = pct(fgm + 0.5 * tpm, fga);
  const threePct = pct(tpm, tpa);
  const ftPct = pct(ftm, fta);
  const shareOfTeamFga = pct(fga, teamFga);
  const ftr = pct(fta, fga);
  const astToTov = topg > 0 ? apg / topg : null;
  const threePerGame = games > 0 ? tpa / games : null;

  const pos = (player.position ?? '').toUpperCase();
  const isFrontcourt = pos.includes('C') || pos.includes('F-C') || (pos === 'F' && rpg > 6);

  const eligible = mpg !== null && mpg > ROTATION_MPG;
  const rotation = {
    eligible,
    mpg,
    threshold: ROTATION_MPG,
    reason: eligible
      ? undefined
      : mpg === null
      ? 'No minutes data — no season-stats row.'
      : `MPG ${mpg.toFixed(1)} is at or below the ${ROTATION_MPG} rotation threshold; sample is small.`,
  };

  // ----- confidence -----
  const confidence = deriveConfidence({
    totalFga: tendencies.totalFga,
    xefgSample: tendencies.quality.sampleSize,
    minutesPerGame: mpg,
    games,
  });

  // ----- archetype (score-based) -----
  const archetypeResult = deriveArchetype({
    ppg,
    apg,
    rpg,
    topg,
    mpg,
    shareOfTeamFga,
    astToTov,
    threePct,
    threeAttempts: tpa,
    threePerGame,
    efgPct,
    ftr,
    isFrontcourt,
    rotationEligible: eligible,
    tend: tendencies,
  });

  const volumeCtx = {
    mpg,
    ppg,
    shareOfTeamFga,
    threePerGame,
    threeAttempts: tpa,
    totalFga: totalShots,
    threeRate: zones.three.share,
    rotationEligible: eligible,
  };
  const scoutingPriority = deriveScoutingPriority(volumeCtx);

  // ----- rule engines: volume-based + xeFG-aware -----
  const ruleInput: PlayerRuleInput = {
    name: player.name ?? `${player.firstName ?? ''} ${player.lastName ?? ''}`.trim(),
    position: player.position,
    isFrontcourt,
    totalFga: totalShots,
    mpg,
    rotationEligible: eligible,
    ppg,
    rpg,
    apg,
    topg,
    fpg,
    bpg,
    spg,
    threeAttempts: tpa,
    threePerGame,
    threePct,
    efgPct,
    fgPct,
    ftr,
    shareOfTeamFga,
    astToTov,
    zones,
    shotTypes,
    threeSubzones,
    creation,
  };
  const volumeNotes = runPlayerRules(ruleInput);
  const xefgNotes = runXeFGRules({
    name: ruleInput.name,
    archetype: archetypeResult.archetype,
    tend: tendencies,
    threePct,
    threeAttempts: tpa,
    efgPct,
    ftr,
    ppg,
    rpg,
    topg,
    apg,
    astToTov,
    shareOfTeamFga,
    soften: confidence.soften,
  });
  // xeFG rules lead (richer evidence); volume rules fill remaining slots.
  const allNotes = [...xefgNotes, ...volumeNotes];
  const guarding = pickNotes(allNotes, 'guarding', 5);
  const liveWith = pickNotes(allNotes, 'live_with', 4);
  const deny = pickNotes(allNotes, 'deny', 4);

  // ----- observed defensive impact -----
  const observedDefenseProfile = seasonStats?.teamId
    ? await buildObservedDefenseProfile({
        playerId,
        season,
        teamId: seasonStats.teamId,
      })
    : null;

  // ----- caveats -----
  const caveats: string[] = [];
  if (!eligible && rotation.reason) caveats.push(rotation.reason);
  if (totalShots < 20) caveats.push(`Only ${totalShots} coordinate-bearing FGAs — zone splits are noisy.`);
  if (creationTracked < 10)
    caveats.push(
      `Only ${creationTracked} made shots with assist data — creation profile uses made-shot context only.`,
    );
  if (confidence.level === 'low')
    caveats.push('Low report confidence — guarding notes are softened and weak signals suppressed.');

  return {
    player: {
      id: player.id,
      name: player.name ?? `${player.firstName ?? ''} ${player.lastName ?? ''}`.trim(),
      position: player.position,
      jersey: player.jersey,
      height: player.height,
      weight: player.weight,
      team: seasonStats?.team
        ? {
            id: seasonStats.team.id,
            school: seasonStats.team.school,
            abbreviation: seasonStats.team.abbreviation,
            primaryColor: seasonStats.team.primaryColor,
          }
        : null,
    },
    season,
    rotation,
    scoutingPriority,
    role: {
      archetype: archetypeResult.archetype,
      summary: archetypeResult.summary,
      secondary: archetypeResult.secondary,
    },
    tendencies,
    confidence,
    stats: {
      games,
      minutesPerGame: mpg,
      ppg,
      rpg,
      apg,
      spg,
      bpg,
      topg,
      fpg,
      fgPct,
      efgPct,
      threePct,
      ftPct,
      shareOfTeamFga,
      ftr,
      astToTov,
      threeAttempts: tpa,
      threePerGame,
    },
    zones,
    shotTypes,
    threeSubzones,
    creation,
    context,
    observedDefenseProfile,
    notes: guarding,
    liveWith,
    deny,
    totalFga: totalShots,
    caveats,
  };
}
