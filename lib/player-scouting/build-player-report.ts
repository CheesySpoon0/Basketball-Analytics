// ============================================================================
// Build a PlayerScoutingReport from DB rows.
//
// Pure deterministic logic. No AI. Designed to be fast enough to render on
// every player page load.
// ============================================================================
import { prisma } from '../prisma';
import { DEFAULT_SEASON } from '../season';
import {
  classifyShotType,
  classifyThreeSubzone,
  classifyZone,
  isEndOfPeriod,
} from './shot-profile';
import { deriveScoutingPriority, runPlayerRules, type PlayerRuleInput } from './rules';
import type {
  Archetype,
  ContextAgg,
  CreationAgg,
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
const pctStr = (x: number | null, d = 1) => (x === null ? '—' : `${(x * 100).toFixed(d)}%`);

function emptyZone(): ZoneAgg {
  return { att: 0, made: 0, pct: null, share: null };
}

function emptyShotType(): ShotTypeAgg {
  return { att: 0, made: 0, pct: null, share: null };
}

function deriveArchetype(args: {
  ppg: number;
  shareOfTeamFga: number | null;
  zones: Record<Zone, ZoneAgg>;
  position: string | null;
  rpg: number;
  apg: number;
  threePct: number | null;
  isFrontcourt: boolean;
}): { archetype: Archetype; summary: string } {
  const { ppg, shareOfTeamFga, zones, rpg, apg, threePct, isFrontcourt } = args;
  const threeRate = zones.three.share;
  const rimRate = zones.rim.share;

  if (shareOfTeamFga !== null && shareOfTeamFga > 0.22 && ppg >= 14) {
    return {
      archetype: 'primary scorer',
      summary: `Primary scorer — ${ppg.toFixed(1)} PPG on ${pctStr(shareOfTeamFga)} of team FGA.`,
    };
  }
  if (threeRate !== null && threeRate > 0.5 && (threePct === null || threePct > 0.30)) {
    return {
      archetype: 'shooter',
      summary: `Floor-spacer — ${pctStr(threeRate)} of his shots are threes${
        threePct !== null ? ` at ${pctStr(threePct)}` : ''
      }.`,
    };
  }
  if (isFrontcourt) {
    return {
      archetype: 'big',
      summary: `Frontcourt — ${rpg.toFixed(1)} RPG${threeRate !== null && threeRate > 0.2 ? ', can pop' : ''}.`,
    };
  }
  if (rimRate !== null && rimRate > 0.5) {
    return {
      archetype: 'driver',
      summary: `Downhill driver — ${pctStr(rimRate)} of his shots come at the rim.`,
    };
  }
  if (apg > 3 && ppg < 12) {
    return {
      archetype: 'connector',
      summary: `Connector — ${apg.toFixed(1)} APG, secondary scorer.`,
    };
  }
  return {
    archetype: 'low-volume role player',
    summary: `Role player — ${ppg.toFixed(1)} PPG, limited shot volume.`,
  };
}

export async function buildPlayerScoutingReport(
  playerId: number,
  season = SEASON,
): Promise<PlayerScoutingReport | null> {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: { team: true },
  });
  if (!player) return null;

  const seasonStats = await prisma.playerSeasonStats.findUnique({
    where: { playerId_season: { playerId, season } },
  });

  const teamFgaRow = player.teamId
    ? await prisma.teamSeasonStats.findUnique({
        where: { teamId_season: { teamId: player.teamId, season } },
        select: { fieldGoalsAttempted: true },
      })
    : null;
  const teamFga = teamFgaRow?.fieldGoalsAttempted ?? 0;

  // Pull every FGA with coordinates (excludes FTs) — we need playType, playText, assisted, period, secondsRemaining.
  const plays = await prisma.play.findMany({
    where: {
      playerId,
      shotX: { not: null },
      shotY: { not: null },
      shotRange: { not: 'free_throw' },
      game: { season },
    },
    select: {
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

  // ----- ZONES -----
  const zones: Record<Zone, ZoneAgg> = {
    rim: emptyZone(),
    mid: emptyZone(),
    three: emptyZone(),
  };
  // ----- SHOT TYPES -----
  const shotTypes: Record<ShotType, ShotTypeAgg> = {
    layup: emptyShotType(),
    dunk: emptyShotType(),
    jumper: emptyShotType(),
    tip: emptyShotType(),
    unknown: emptyShotType(),
  };
  // ----- THREE SUBZONES -----
  const threeSubzones: Record<ThreeSubzone, ZoneAgg> = {
    corner: emptyZone(),
    above_break: emptyZone(),
  };
  // ----- CREATION -----
  let creationTracked = 0;
  let creationAssisted = 0;
  let creationUnassisted = 0;
  let assistedThree = 0;
  let threeTracked = 0;
  let assistedRim = 0;
  let rimTracked = 0;
  let unassistedJumper = 0;
  let jumperTracked = 0;
  // ----- CONTEXT -----
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
      // jumper = midrange + three (i.e. all non-rim, non-tip, non-dunk)
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

  // ----- SEASON STATS -----
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

  // ----- ROLE / ARCHETYPE -----
  const pos = (player.position ?? '').toUpperCase();
  const isFrontcourt =
    pos.includes('C') || pos.includes('F-C') || (pos === 'F' && rpg > 6);
  const role = deriveArchetype({
    ppg,
    shareOfTeamFga,
    zones,
    position: player.position,
    rpg,
    apg,
    threePct,
    isFrontcourt,
  });

  // ----- ROTATION -----
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

  // ----- NOTES via rules engine -----
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
  const allNotes = runPlayerRules(ruleInput);

  // Split by bucket; cap at 4 in guarding, 2 each elsewhere.
  const guarding = allNotes.filter((n) => n.bucket === 'guarding').slice(0, 4);
  const liveWith = allNotes.filter((n) => n.bucket === 'live_with').slice(0, 2);
  const deny = allNotes.filter((n) => n.bucket === 'deny').slice(0, 2);

  // ----- DEFENSIVE PROXY -----
  let sizeNote: string | null = null;
  if (player.height) {
    const ft = Math.floor(player.height / 12);
    const inch = player.height % 12;
    sizeNote = `${ft}'${inch}"`;
    if (player.weight) sizeNote += ` · ${player.weight} lbs`;
  }
  const defenseDescriptors: string[] = [];
  if (bpg > 1.0) defenseDescriptors.push('shot-blocking presence');
  if (spg > 1.5) defenseDescriptors.push('active hands / event creator');
  if (bpg < 0.3 && spg < 0.7) defenseDescriptors.push('low-event defender by box-score');
  if (rpg > 7) defenseDescriptors.push('strong defensive rebounder');
  if (fpg > 3) defenseDescriptors.push('foul risk');
  if (defenseDescriptors.length === 0) {
    if (isFrontcourt) defenseDescriptors.push('Likely interior defender by size and position');
    else defenseDescriptors.push('Likely guard/wing defender by size and position');
  }
  const defenseProxy = {
    spg,
    bpg,
    rpg,
    fpg,
    minutesPerGame: mpg,
    position: player.position,
    sizeNote,
    descriptor: defenseDescriptors.join('; '),
    inferred: true as const,
  };

  // ----- CAVEATS -----
  const caveats: string[] = [];
  if (!eligible && rotation.reason) caveats.push(rotation.reason);
  if (totalShots < 20) caveats.push(`Only ${totalShots} coordinate-bearing FGAs — zone splits are noisy.`);
  if (creationTracked < 10)
    caveats.push(`Only ${creationTracked} shots with assisted/unassisted data — creation profile is preliminary.`);

  return {
    player: {
      id: player.id,
      name: player.name ?? `${player.firstName ?? ''} ${player.lastName ?? ''}`.trim(),
      position: player.position,
      jersey: player.jersey,
      height: player.height,
      weight: player.weight,
      team: player.team
        ? {
            id: player.team.id,
            school: player.team.school,
            abbreviation: player.team.abbreviation,
            primaryColor: player.team.primaryColor,
          }
        : null,
    },
    season,
    rotation,
    scoutingPriority,
    role,
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
    defenseProxy,
    notes: guarding,
    liveWith,
    deny,
    totalFga: totalShots,
    caveats,
  };
}
