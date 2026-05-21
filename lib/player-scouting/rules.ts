// ============================================================================
// Deterministic player scouting note rules (volume-aware intensity).
// ============================================================================
import type {
  CreationAgg,
  PlayerNote,
  ShotType,
  ShotTypeAgg,
  ThreeSubzone,
  Zone,
  ZoneAgg,
} from './types';
import {
  deriveScoutingPriority,
  isLowUsageSpacer,
  isPrimaryThreat,
  isSecondaryThreat,
  type VolumeContext,
} from './volume';

export interface PlayerRuleInput {
  name: string;
  position: string | null;
  isFrontcourt: boolean;
  totalFga: number;
  mpg: number | null;
  ppg: number;
  rpg: number;
  apg: number;
  topg: number;
  fpg: number;
  bpg: number;
  spg: number;
  threeAttempts: number;
  threePerGame: number | null;
  threePct: number | null;
  efgPct: number | null;
  fgPct: number | null;
  ftr: number | null;
  shareOfTeamFga: number | null;
  astToTov: number | null;
  rotationEligible: boolean;
  zones: Record<Zone, ZoneAgg>;
  shotTypes: Record<ShotType, ShotTypeAgg>;
  threeSubzones: Record<ThreeSubzone, ZoneAgg>;
  creation: CreationAgg;
}

const pctStr = (x: number | null, d = 1) => (x === null ? '—' : `${(x * 100).toFixed(d)}%`);
const numStr = (x: number | null | undefined, d = 1) =>
  x === null || x === undefined ? '—' : x.toFixed(d);

function vol(p: PlayerRuleInput): VolumeContext {
  return {
    mpg: p.mpg,
    ppg: p.ppg,
    shareOfTeamFga: p.shareOfTeamFga,
    threePerGame: p.threePerGame,
    threeAttempts: p.threeAttempts,
    totalFga: p.totalFga,
    threeRate: p.zones.three.share,
    rotationEligible: p.rotationEligible,
  };
}

export interface PlayerRule {
  id: string;
  priority: 1 | 2 | 3 | 4 | 5;
  bucket?: 'guarding' | 'live_with' | 'deny';
  supersedes?: string[];
  build: (p: PlayerRuleInput) => PlayerNote | null;
}

export const PLAYER_RULES: PlayerRule[] = [
  // ---------- PRIMARY SCORER (trap) — primary threats only ----------
  {
    id: 'primary-scorer-trap',
    priority: 5,
    supersedes: ['stay-home', 'low-usage-spacer-guard'],
    build: (p) => {
      const v = vol(p);
      if (!isPrimaryThreat(v)) return null;
      if (!(p.shareOfTeamFga !== null && p.shareOfTeamFga > 0.20 && p.efgPct !== null && p.efgPct > 0.52 && p.ppg >= 12))
        return null;
      return {
        id: 'primary-scorer-trap',
        title: 'Trap his go-to actions',
        detail: `Pre-rotate on every catch above the elbow. Show a second defender on the first dribble. Make ${p.name} give it up.`,
        priority: 5,
        bucket: 'guarding',
        evidence: [
          { label: 'Share of team FGA', value: pctStr(p.shareOfTeamFga) },
          { label: 'eFG', value: pctStr(p.efgPct) },
          { label: 'PPG', value: numStr(p.ppg) },
        ],
      };
    },
  },

  // ---------- SHOOTER TIERS (mutually exclusive by volume) ----------

  // Tier 1: high-volume elite — top-lock / chase
  {
    id: 'elite-shooter-high',
    priority: 5,
    supersedes: [
      'stay-home',
      'shooter-medium',
      'low-usage-spacer-guard',
      'catch-and-shoot-spacer',
    ],
    build: (p) => {
      const v = vol(p);
      if (!isPrimaryThreat(v)) return null;
      const threeRate = p.zones.three.share;
      if (!(threeRate !== null && threeRate > 0.42 && p.threePct !== null && p.threePct > 0.36 && p.threeAttempts > 80))
        return null;
      return {
        id: 'elite-shooter-high',
        title: 'Top-lock and chase over screens',
        detail: `Deny straight-line catches above the break. He launches at volume and punishes help — treat him as a primary shooting threat.`,
        priority: 5,
        bucket: 'guarding',
        evidence: [
          { label: '3PT rate', value: pctStr(threeRate) },
          { label: '3PT%', value: pctStr(p.threePct) },
          { label: '3PA', value: String(p.threeAttempts) },
          { label: '3PA/g', value: numStr(p.threePerGame) },
          { label: 'PPG', value: numStr(p.ppg) },
        ],
      };
    },
  },

  // Tier 2: medium-volume — stay attached, no rhythm
  {
    id: 'shooter-medium',
    priority: 4,
    supersedes: ['stay-home', 'low-usage-spacer-guard'],
    build: (p) => {
      const v = vol(p);
      if (isPrimaryThreat(v) || isLowUsageSpacer(v)) return null;
      if (!isSecondaryThreat(v)) return null;
      const threeRate = p.zones.three.share;
      if (!(threeRate !== null && threeRate > 0.38 && p.threePct !== null && p.threePct > 0.34 && p.threeAttempts > 40))
        return null;
      return {
        id: 'shooter-medium',
        title: 'Stay attached — no clean rhythm looks',
        detail: `Close out under control and take away the catch-and-shoot. He's a rotation shooter — don't give him free looks, but save top-lock/chase energy for their primary threats.`,
        priority: 4,
        bucket: 'guarding',
        evidence: [
          { label: '3PT rate', value: pctStr(threeRate) },
          { label: '3PT%', value: pctStr(p.threePct) },
          { label: '3PA/g', value: numStr(p.threePerGame) },
          { label: 'PPG', value: numStr(p.ppg) },
        ],
      };
    },
  },

  // Tier 3: low-usage spacer — stay connected, don't over-help
  {
    id: 'low-usage-spacer-guard',
    priority: 3,
    supersedes: ['stay-home', 'self-created-jumper'],
    build: (p) => {
      const v = vol(p);
      if (!isLowUsageSpacer(v)) return null;
      const threeRate = p.zones.three.share;
      if (!(threeRate !== null && threeRate > 0.40)) return null;
      return {
        id: 'low-usage-spacer-guard',
        title: 'Stay connected as a spacer',
        detail: `Know where he is on kickouts and weakside swings. Do not lose him, but do not over-help off primary threats just to deny him — make him put it on the floor.`,
        priority: 3,
        bucket: 'guarding',
        evidence: [
          { label: '3PT rate', value: pctStr(threeRate) },
          { label: '3PT%', value: pctStr(p.threePct) },
          { label: 'Share of team FGA', value: pctStr(p.shareOfTeamFga) },
          { label: 'PPG', value: numStr(p.ppg) },
        ],
      };
    },
  },

  // High-volume bad shooter
  {
    id: 'high-volume-bad-shooter',
    priority: 4,
    supersedes: ['stay-home', 'low-usage-spacer-guard'],
    build: (p) => {
      if (!isSecondaryThreat(vol(p))) return null;
      const threeRate = p.zones.three.share;
      if (
        !(
          threeRate !== null &&
          threeRate > 0.40 &&
          p.threePct !== null &&
          p.threePct < 0.32 &&
          p.threeAttempts > 40
        )
      )
        return null;
      return {
        id: 'high-volume-bad-shooter',
        title: 'Close short — make him prove it',
        detail: `Stay attached, contest with a hand, but don't fly past him. Live with above-the-break threes — he shoots volume but doesn't make enough to punish a short closeout.`,
        priority: 4,
        bucket: 'guarding',
        evidence: [
          { label: '3PT rate', value: pctStr(threeRate) },
          { label: '3PT%', value: pctStr(p.threePct) },
          { label: '3PA', value: String(p.threeAttempts) },
        ],
      };
    },
  },

  {
    id: 'live-with-his-threes',
    priority: 3,
    bucket: 'live_with',
    build: (p) => {
      if (!isSecondaryThreat(vol(p))) return null;
      const threeRate = p.zones.three.share;
      if (
        !(
          threeRate !== null &&
          threeRate > 0.40 &&
          p.threePct !== null &&
          p.threePct < 0.32 &&
          p.threeAttempts > 40
        )
      )
        return null;
      return {
        id: 'live-with-his-threes',
        title: 'Live with his threes',
        detail: `Force him into mid-range pull-ups or contested drives — those are lower-value shots for him.`,
        priority: 3,
        bucket: 'live_with',
        evidence: [
          { label: '3PT rate', value: pctStr(threeRate) },
          { label: '3PT%', value: pctStr(p.threePct) },
        ],
      };
    },
  },

  // Catch-and-shoot spacer — secondary+ volume only
  {
    id: 'catch-and-shoot-spacer',
    priority: 4,
    supersedes: ['stay-home'],
    build: (p) => {
      if (!isSecondaryThreat(vol(p)) || isLowUsageSpacer(vol(p))) return null;
      const a3r = p.creation.assistedThreeRate;
      const threeRate = p.zones.three.share;
      if (
        !(
          a3r !== null &&
          a3r > 0.75 &&
          threeRate !== null &&
          threeRate > 0.35 &&
          p.threeAttempts > 30
        )
      )
        return null;
      return {
        id: 'catch-and-shoot-spacer',
        title: 'Don\u2019t help off — kill the kickout',
        detail: `His value is spacing and catch-and-shoot, not self-creation. Stay connected on drives and tag him on the pass-out.`,
        priority: 4,
        bucket: 'guarding',
        evidence: [
          { label: 'Assisted 3 rate', value: pctStr(a3r) },
          { label: '3PT rate', value: pctStr(threeRate) },
          { label: '3PT%', value: pctStr(p.threePct) },
        ],
      };
    },
  },

  // Self-created — meaningful unassisted volume + secondary threat minimum
  {
    id: 'self-created-jumper',
    priority: 3,
    supersedes: ['stay-home'],
    build: (p) => {
      const v = vol(p);
      if (!isSecondaryThreat(v) || isLowUsageSpacer(v)) return null;
      const ujr = p.creation.unassistedJumperRate;
      const unassistedCount = p.creation.unassistedJumper;
      if (
        !(
          ujr !== null &&
          ujr > 0.55 &&
          unassistedCount >= 50 &&
          p.creation.jumperTracked >= 100 &&
          p.threePct !== null &&
          p.threePct > 0.32
        )
      )
        return null;
      const title = isPrimaryThreat(v)
        ? 'Don\u2019t give rhythm dribbles'
        : 'Crowd the pull-up — no free step-backs';
      const detail = isPrimaryThreat(v)
        ? `Crowd the handle. Make him take tough pull-ups off the bounce — don't give him space to find his step-back rhythm.`
        : `Meet him early on the catch. Take away the one-dribble pull-up — he creates off the bounce more than the pass.`;
      return {
        id: 'self-created-jumper',
        title,
        detail,
        priority: isPrimaryThreat(v) ? 4 : 3,
        bucket: 'guarding',
        evidence: [
          { label: 'Unassisted jumpers', value: String(unassistedCount) },
          { label: 'Unassisted jumper rate', value: pctStr(ujr) },
          { label: '3PT%', value: pctStr(p.threePct) },
        ],
      };
    },
  },

  // Rim pressure driver
  {
    id: 'rim-pressure-driver',
    priority: 4,
    supersedes: ['stay-home'],
    build: (p) => {
      const rimRate = p.zones.rim.share;
      if (!(rimRate !== null && rimRate > 0.40 && p.ftr !== null && p.ftr > 0.30 && isSecondaryThreat(vol(p))))
        return null;
      return {
        id: 'rim-pressure-driver',
        title: 'Build the wall — no straight-line drives',
        detail: `He lives in the paint and earns trips to the line. Cut off the rim, contest with verticality, don't reach.`,
        priority: 4,
        bucket: 'deny',
        evidence: [
          { label: 'Rim rate', value: pctStr(rimRate) },
          { label: 'Rim FG%', value: pctStr(p.zones.rim.pct) },
          { label: 'FTR', value: pctStr(p.ftr) },
          { label: 'PPG', value: numStr(p.ppg) },
        ],
      };
    },
  },

  // Non-shooting driver
  {
    id: 'non-shooting-driver',
    priority: 4,
    supersedes: ['stay-home', 'low-usage-spacer-guard'],
    build: (p) => {
      const rimRate = p.zones.rim.share;
      const threeRate = p.zones.three.share;
      const cantShoot = p.threePct !== null && p.threePct < 0.30;
      const lowVolumeThree = (p.threeAttempts ?? 0) < 30 || (threeRate !== null && threeRate < 0.18);
      if (!(rimRate !== null && rimRate > 0.50 && (cantShoot || lowVolumeThree) && isSecondaryThreat(vol(p))))
        return null;
      return {
        id: 'non-shooting-driver',
        title: 'Go under and load the paint',
        detail: `Sag off and clog his driving lanes. Dare him to shoot — he's not a threat from outside.`,
        priority: 4,
        bucket: 'guarding',
        evidence: [
          { label: 'Rim rate', value: pctStr(rimRate) },
          { label: '3PT%', value: pctStr(p.threePct) },
          { label: 'PPG', value: numStr(p.ppg) },
        ],
      };
    },
  },

  // Stretch big — frontcourt with meaningful 3 volume
  {
    id: 'stretch-big',
    priority: 4,
    supersedes: ['stay-home'],
    build: (p) => {
      if (
        !(
          p.isFrontcourt &&
          p.threePct !== null &&
          p.threePct > 0.30 &&
          p.threePerGame !== null &&
          p.threePerGame > 2 &&
          isSecondaryThreat(vol(p))
        )
      )
        return null;
      const aggressive = isPrimaryThreat(vol(p)) || (p.threePerGame !== null && p.threePerGame > 3.5);
      return {
        id: 'stretch-big',
        title: aggressive ? 'Switch 1-5 on his screens' : 'Trail the pop — no drop',
        detail: aggressive
          ? `No drop coverage — if our big drops, he pops for an open three. Trail him out to the arc.`
          : `Show on ball screens and recover to his pop. He's a stretch four — don't lose him on the second side.`,
        priority: 4,
        bucket: 'deny',
        evidence: [
          { label: 'Position', value: p.position ?? '—' },
          { label: '3PT%', value: pctStr(p.threePct) },
          { label: '3PA/g', value: numStr(p.threePerGame) },
        ],
      };
    },
  },

  {
    id: 'rim-finisher',
    priority: 3,
    build: (p) => {
      const rimPct = p.zones.rim.pct;
      const rimRate = p.zones.rim.share;
      if (!(rimPct !== null && rimPct > 0.62 && rimRate !== null && rimRate > 0.30 && p.zones.rim.att > 60))
        return null;
      return {
        id: 'rim-finisher',
        title: 'Make him finish over size',
        detail: `Don't bite on pump fakes. Wall up vertical — he converts well on uncontested looks.`,
        priority: 3,
        bucket: 'deny',
        evidence: [
          { label: 'Rim FG%', value: pctStr(rimPct) },
          { label: 'Rim att', value: String(p.zones.rim.att) },
        ],
      };
    },
  },

  {
    id: 'lob-threat',
    priority: 3,
    build: (p) => {
      const dunkShare = p.shotTypes.dunk.share;
      if (!(dunkShare !== null && dunkShare > 0.10 && p.shotTypes.dunk.att > 15)) return null;
      return {
        id: 'lob-threat',
        title: 'Tag the roller, no lobs',
        detail: `Front in PNR or build a wall on the catch. He punishes weak-side help with finishes above the rim.`,
        priority: 3,
        bucket: 'deny',
        evidence: [
          { label: 'Dunk share', value: pctStr(dunkShare) },
          { label: 'Dunk att', value: String(p.shotTypes.dunk.att) },
        ],
      };
    },
  },

  {
    id: 'corner-specialist',
    priority: 3,
    build: (p) => {
      if (!isSecondaryThreat(vol(p))) return null;
      const corner = p.threeSubzones.corner;
      if (!(corner.att > 25 && corner.pct !== null && corner.pct > 0.36)) return null;
      const cornerShareOfThrees =
        corner.att + p.threeSubzones.above_break.att > 0
          ? corner.att / (corner.att + p.threeSubzones.above_break.att)
          : null;
      if (!(cornerShareOfThrees !== null && cornerShareOfThrees > 0.30)) return null;
      return {
        id: 'corner-specialist',
        title: 'Tag him on weakside rotations',
        detail: `He lives in the corner — every drive against us, ID him first on the help recovery.`,
        priority: 3,
        bucket: 'deny',
        evidence: [
          { label: 'Corner 3 FG%', value: pctStr(corner.pct) },
          { label: 'Corner 3PA', value: String(corner.att) },
          { label: 'Share of his 3s', value: pctStr(cornerShareOfThrees) },
        ],
      };
    },
  },

  {
    id: 'glass-cleaner',
    priority: 3,
    build: (p) => {
      if (!(p.rpg > 7)) return null;
      return {
        id: 'glass-cleaner',
        title: 'Box him out',
        detail: `Find him on every shot — he crashes the glass hard and extends possessions.`,
        priority: 3,
        bucket: 'deny',
        evidence: [{ label: 'RPG', value: numStr(p.rpg) }],
      };
    },
  },

  {
    id: 'turnover-prone',
    priority: 3,
    build: (p) => {
      const usageHigh = p.shareOfTeamFga !== null && p.shareOfTeamFga > 0.15;
      if (!(p.topg > 2.5 && usageHigh && isSecondaryThreat(vol(p)))) return null;
      return {
        id: 'turnover-prone',
        title: 'Pressure the handle',
        detail: `Get into him 35 feet from the rim. He's loose with the ball — force him left, trap on side ball-screens.`,
        priority: 3,
        bucket: 'guarding',
        evidence: [
          { label: 'TOV/g', value: numStr(p.topg) },
          { label: 'AST/TOV', value: numStr(p.astToTov, 2) },
        ],
      };
    },
  },

  {
    id: 'foul-drawer',
    priority: 3,
    build: (p) => {
      if (!(p.ftr !== null && p.ftr > 0.40 && p.totalFga > 80 && isSecondaryThreat(vol(p)))) return null;
      return {
        id: 'foul-drawer',
        title: 'Show hands — stay vertical',
        detail: `He turns drives into free throws. No reach-ins, no chest contact on closeouts.`,
        priority: 3,
        bucket: 'deny',
        evidence: [{ label: 'FTR', value: pctStr(p.ftr) }],
      };
    },
  },

  {
    id: 'low-usage-connector',
    priority: 2,
    build: (p) => {
      const lowUsage = p.shareOfTeamFga !== null && p.shareOfTeamFga < 0.12;
      const passes = p.apg >= 2 || (p.astToTov !== null && p.astToTov > 1.5);
      if (!(lowUsage && passes)) return null;
      return {
        id: 'low-usage-connector',
        title: 'Pressure passing lanes',
        detail: `Treat him as a connector, not a scorer. Get hands in his passing lanes; force decisions, don't over-rotate.`,
        priority: 2,
        bucket: 'guarding',
        evidence: [
          { label: 'Share of team FGA', value: pctStr(p.shareOfTeamFga) },
          { label: 'AST/g', value: numStr(p.apg) },
          { label: 'AST/TOV', value: numStr(p.astToTov, 2) },
        ],
      };
    },
  },

  {
    id: 'inefficient-mid',
    priority: 2,
    bucket: 'live_with',
    build: (p) => {
      const midRate = p.zones.mid.share;
      const midPct = p.zones.mid.pct;
      if (!(midRate !== null && midRate > 0.25 && midPct !== null && midPct < 0.38 && p.zones.mid.att > 30))
        return null;
      return {
        id: 'inefficient-mid',
        title: 'Give him the mid-range',
        detail: `Funnel him into long twos. Stay out of foul trouble.`,
        priority: 2,
        bucket: 'live_with',
        evidence: [
          { label: 'Mid rate', value: pctStr(midRate) },
          { label: 'Mid FG%', value: pctStr(midPct) },
          { label: 'Mid att', value: String(p.zones.mid.att) },
        ],
      };
    },
  },

  {
    id: 'stay-home',
    priority: 1,
    build: (p) => ({
      id: 'stay-home',
      title: 'Stay attached, no help-off',
      detail: `Limited offensive profile. Stay home on shooters; force him to put the ball on the floor without giving up open catches.`,
      priority: 1,
      bucket: 'guarding',
      evidence: [
        { label: 'PPG', value: numStr(p.ppg) },
        { label: 'Share of team FGA', value: pctStr(p.shareOfTeamFga) },
      ],
    }),
  },
];

export function runPlayerRules(input: PlayerRuleInput): PlayerNote[] {
  const fired: Array<{ note: PlayerNote; supersedes: string[]; bucket: PlayerNote['bucket'] }> = [];
  for (const rule of PLAYER_RULES) {
    const note = rule.build(input);
    if (note) fired.push({ note, supersedes: rule.supersedes ?? [], bucket: note.bucket });
  }

  const supersededByBucket = new Map<string, Set<string>>();
  for (const f of fired) {
    if (!f.supersedes.length) continue;
    const set = supersededByBucket.get(f.bucket) ?? new Set<string>();
    for (const s of f.supersedes) set.add(s);
    supersededByBucket.set(f.bucket, set);
  }

  return fired
    .filter((f) => !(supersededByBucket.get(f.bucket)?.has(f.note.id) ?? false))
    .map((f) => f.note)
    .sort((a, b) => b.priority - a.priority);
}

export { deriveScoutingPriority };
