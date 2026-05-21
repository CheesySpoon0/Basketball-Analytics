// ============================================================================
// Score-based player archetype classifier.
//
// Instead of one threshold cascade ("if threeRate > 0.5 -> shooter"), every
// archetype accumulates a score from multiple weighted signals. The top scorer
// wins, provided it clears MIN_SCORE; otherwise the player gets a generic role
// based on volume. This produces varied, defensible labels.
// ============================================================================
import type { TendencyProfile } from './tendencies';

export type Archetype =
  | 'primary creator'
  | 'downhill rim pressure'
  | 'movement shooter'
  | 'spot-up spacer'
  | 'stretch big'
  | 'rim finisher'
  | 'post scorer'
  | 'connector'
  | 'low-usage spacer'
  | 'inefficient volume scorer'
  | 'transition finisher'
  | 'foul-drawing attacker'
  | 'glass / putback threat'
  | 'rotation role player'
  | 'deep bench / limited sample';

export interface ArchetypeInput {
  ppg: number;
  apg: number;
  rpg: number;
  topg: number;
  mpg: number | null;
  shareOfTeamFga: number | null;
  astToTov: number | null;
  threePct: number | null;
  threeAttempts: number;
  threePerGame: number | null;
  efgPct: number | null;
  ftr: number | null;
  isFrontcourt: boolean;
  rotationEligible: boolean;
  tend: TendencyProfile;
}

export interface ArchetypeResult {
  archetype: Archetype;
  /** Winning score (for debugging / confidence). */
  score: number;
  /** One-line, archetype-specific summary citing the player's own numbers. */
  summary: string;
  /** Ranked runner-up archetypes that also cleared a soft floor. */
  secondary: Archetype[];
}

const pctStr = (x: number | null, d = 1) => (x === null ? '—' : `${(x * 100).toFixed(d)}%`);
const numStr = (x: number | null | undefined, d = 1) =>
  x === null || x === undefined ? '—' : x.toFixed(d);

/** A signal contributes `weight` to `archetype` when `test` passes. */
interface Signal {
  archetype: Archetype;
  weight: number;
  test: (i: ArchetypeInput) => boolean;
}

// Helpers kept terse — every test reads a derived rate.
const rimShare = (i: ArchetypeInput) => i.tend.rim.share ?? 0;
const threeShare = (i: ArchetypeInput) => i.tend.three.share ?? 0;
const midShare = (i: ArchetypeInput) => i.tend.mid.share ?? 0;
const cornerShareOf3 = (i: ArchetypeInput) => {
  const c = i.tend.cornerThree.att;
  const a = i.tend.aboveBreakThree.att;
  return c + a > 0 ? c / (c + a) : 0;
};

const SIGNALS: Signal[] = [
  // ---- primary creator ----
  { archetype: 'primary creator', weight: 3, test: (i) => i.ppg >= 15 },
  { archetype: 'primary creator', weight: 2, test: (i) => (i.shareOfTeamFga ?? 0) >= 0.22 },
  { archetype: 'primary creator', weight: 2, test: (i) => i.apg >= 3.5 && i.ppg >= 11 },
  { archetype: 'primary creator', weight: 1, test: (i) => (i.tend.creation.assistedMakeShare ?? 1) < 0.5 },

  // ---- downhill rim pressure ----
  { archetype: 'downhill rim pressure', weight: 3, test: (i) => rimShare(i) > 0.45 },
  { archetype: 'downhill rim pressure', weight: 2, test: (i) => (i.ftr ?? 0) > 0.30 && i.ppg >= 9 },
  { archetype: 'downhill rim pressure', weight: 1, test: (i) => (i.tend.layup.share ?? 0) > 0.35 },
  { archetype: 'downhill rim pressure', weight: 1, test: (i) => threeShare(i) < 0.30 },

  // ---- movement shooter (high-volume, off-screen) ----
  { archetype: 'movement shooter', weight: 3, test: (i) => threeShare(i) > 0.5 && i.threeAttempts > 90 },
  { archetype: 'movement shooter', weight: 2, test: (i) => (i.threePerGame ?? 0) >= 5 },
  { archetype: 'movement shooter', weight: 2, test: (i) => (i.threePct ?? 0) >= 0.36 && i.threeAttempts > 80 },
  { archetype: 'movement shooter', weight: 1, test: (i) => (i.tend.creation.assistedThreeMakeShare ?? 1) < 0.85 },

  // ---- spot-up spacer (catch-and-shoot, moderate volume) ----
  { archetype: 'spot-up spacer', weight: 3, test: (i) => threeShare(i) > 0.55 },
  { archetype: 'spot-up spacer', weight: 2, test: (i) => (i.tend.creation.assistedThreeMakeShare ?? 0) > 0.8 },
  { archetype: 'spot-up spacer', weight: 1, test: (i) => i.threeAttempts >= 40 && i.threeAttempts <= 140 },
  { archetype: 'spot-up spacer', weight: 1, test: (i) => cornerShareOf3(i) > 0.30 },

  // ---- stretch big ----
  { archetype: 'stretch big', weight: 3, test: (i) => i.isFrontcourt && (i.threePerGame ?? 0) >= 2 },
  { archetype: 'stretch big', weight: 2, test: (i) => i.isFrontcourt && (i.threePct ?? 0) >= 0.32 },
  { archetype: 'stretch big', weight: 1, test: (i) => i.isFrontcourt && threeShare(i) > 0.30 },

  // ---- rim finisher (efficient, assisted at the rim) ----
  { archetype: 'rim finisher', weight: 3, test: (i) => (i.tend.rim.pct ?? 0) > 0.62 && i.tend.rim.att > 50 },
  { archetype: 'rim finisher', weight: 2, test: (i) => rimShare(i) > 0.5 },
  { archetype: 'rim finisher', weight: 1, test: (i) => (i.tend.creation.assistedRimMakeShare ?? 0) > 0.55 },
  { archetype: 'rim finisher', weight: 1, test: (i) => (i.tend.dunk.share ?? 0) > 0.08 },

  // ---- post scorer (frontcourt, paint volume, not a shooter) ----
  { archetype: 'post scorer', weight: 3, test: (i) => i.isFrontcourt && rimShare(i) > 0.55 },
  { archetype: 'post scorer', weight: 2, test: (i) => i.isFrontcourt && threeShare(i) < 0.15 && i.ppg >= 9 },
  { archetype: 'post scorer', weight: 1, test: (i) => i.isFrontcourt && i.rpg >= 5 },

  // ---- connector (low usage, passes, takes care of the ball) ----
  { archetype: 'connector', weight: 3, test: (i) => i.apg >= 3 && i.ppg < 11 },
  { archetype: 'connector', weight: 2, test: (i) => (i.astToTov ?? 0) > 1.8 && (i.shareOfTeamFga ?? 1) < 0.16 },
  { archetype: 'connector', weight: 1, test: (i) => (i.shareOfTeamFga ?? 1) < 0.14 },

  // ---- low-usage spacer ----
  { archetype: 'low-usage spacer', weight: 3, test: (i) => threeShare(i) > 0.45 && (i.shareOfTeamFga ?? 1) < 0.13 },
  { archetype: 'low-usage spacer', weight: 2, test: (i) => i.ppg < 7 && threeShare(i) > 0.4 },
  { archetype: 'low-usage spacer', weight: 1, test: (i) => i.threeAttempts < 90 && threeShare(i) > 0.4 },

  // ---- inefficient volume scorer ----
  { archetype: 'inefficient volume scorer', weight: 3, test: (i) => (i.shareOfTeamFga ?? 0) > 0.18 && (i.efgPct ?? 1) < 0.46 },
  { archetype: 'inefficient volume scorer', weight: 2, test: (i) => i.ppg >= 9 && (i.efgPct ?? 1) < 0.45 },
  { archetype: 'inefficient volume scorer', weight: 1, test: (i) => midShare(i) > 0.3 && (i.tend.mid.pct ?? 1) < 0.36 },

  // ---- transition finisher ----
  { archetype: 'transition finisher', weight: 3, test: (i) => (i.tend.transition.share ?? 0) > 0.22 },
  { archetype: 'transition finisher', weight: 1, test: (i) => (i.tend.transition.share ?? 0) > 0.16 && rimShare(i) > 0.4 },

  // ---- foul-drawing attacker ----
  { archetype: 'foul-drawing attacker', weight: 3, test: (i) => (i.ftr ?? 0) > 0.42 && i.tend.totalFga > 70 },
  { archetype: 'foul-drawing attacker', weight: 2, test: (i) => (i.ftr ?? 0) > 0.35 && rimShare(i) > 0.4 },

  // ---- glass / putback threat ----
  { archetype: 'glass / putback threat', weight: 3, test: (i) => (i.tend.tip.share ?? 0) > 0.06 && i.tend.tip.att > 8 },
  { archetype: 'glass / putback threat', weight: 2, test: (i) => i.rpg >= 7 && i.isFrontcourt },
  { archetype: 'glass / putback threat', weight: 1, test: (i) => rimShare(i) > 0.6 && i.isFrontcourt },
];

const MIN_SCORE = 4;

const SUMMARY: Record<Archetype, (i: ArchetypeInput) => string> = {
  'primary creator': (i) =>
    `Offensive engine — ${numStr(i.ppg)} PPG on ${pctStr(i.shareOfTeamFga)} of team shots, ${numStr(i.apg)} APG.`,
  'downhill rim pressure': (i) =>
    `Lives going downhill — ${pctStr(i.tend.rim.share)} of his shots are at the rim, ${pctStr(i.ftr)} FT rate.`,
  'movement shooter': (i) =>
    `High-volume shooter — ${i.threeAttempts} threes at ${pctStr(i.threePct)}, ${numStr(i.threePerGame)} a game.`,
  'spot-up spacer': (i) =>
    `Catch-and-shoot spacer — ${pctStr(i.tend.three.share)} of his shots are threes; ${i.tend.creation.assistedThreeMakes}/${i.tend.creation.threeMakes} made threes were assisted.`,
  'stretch big': (i) =>
    `Stretch ${i.isFrontcourt ? 'big' : 'forward'} — pops for ${numStr(i.threePerGame)} threes a game at ${pctStr(i.threePct)}.`,
  'rim finisher': (i) =>
    `Finisher — ${pctStr(i.tend.rim.pct)} at the rim on ${i.tend.rim.att} attempts.`,
  'post scorer': (i) =>
    `Paint scorer — ${pctStr(i.tend.rim.share)} of his shots inside, ${numStr(i.rpg)} RPG.`,
  connector: (i) =>
    `Connector — ${numStr(i.apg)} APG, ${numStr(i.astToTov, 2)} AST/TO on only ${pctStr(i.shareOfTeamFga)} of team shots.`,
  'low-usage spacer': (i) =>
    `Floor-spacer in a limited role — ${pctStr(i.tend.three.share)} threes, ${pctStr(i.shareOfTeamFga)} of team shots.`,
  'inefficient volume scorer': (i) =>
    `High-volume, low-efficiency — ${numStr(i.ppg)} PPG but ${pctStr(i.efgPct)} eFG.`,
  'transition finisher': (i) =>
    `Runs the floor — ${pctStr(i.tend.transition.share)} of his shots come in transition (inferred).`,
  'foul-drawing attacker': (i) =>
    `Draws contact — ${pctStr(i.ftr)} FT rate attacking the rim.`,
  'glass / putback threat': (i) =>
    `Lives on the offensive glass — ${numStr(i.rpg)} RPG, ${i.tend.tip.att} tip-ins.`,
  'rotation role player': (i) =>
    `Rotation role player — ${numStr(i.ppg)} PPG, complementary shot volume.`,
  'deep bench / limited sample': (i) =>
    `Limited sample — ${i.tend.totalFga} tracked FGAs, ${numStr(i.mpg)} MPG.`,
};

export function deriveArchetype(input: ArchetypeInput): ArchetypeResult {
  // Limited-sample players don't get a strong label.
  if (!input.rotationEligible || input.tend.totalFga < 25) {
    return {
      archetype: 'deep bench / limited sample',
      score: 0,
      summary: SUMMARY['deep bench / limited sample'](input),
      secondary: [],
    };
  }

  const scores = new Map<Archetype, number>();
  for (const sig of SIGNALS) {
    if (sig.test(input)) {
      scores.set(sig.archetype, (scores.get(sig.archetype) ?? 0) + sig.weight);
    }
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];

  if (!top || top[1] < MIN_SCORE) {
    return {
      archetype: 'rotation role player',
      score: top?.[1] ?? 0,
      summary: SUMMARY['rotation role player'](input),
      secondary: ranked.slice(0, 2).map((r) => r[0]),
    };
  }

  // Runner-ups that scored within 2 points of the winner are real secondary traits.
  const secondary = ranked
    .slice(1)
    .filter((r) => r[1] >= top[1] - 2 && r[1] >= 3)
    .map((r) => r[0]);

  return {
    archetype: top[0],
    score: top[1],
    summary: SUMMARY[top[0]](input),
    secondary,
  };
}
