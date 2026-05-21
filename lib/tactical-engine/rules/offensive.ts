// ============================================================================
// Offensive rules — how to ATTACK the opponent.
//
// All rim/three/mid defensive-zone numbers come from `data.opponent.opp{Zone}*`
// which is DERIVED from Play rows (opponent shots in games this team played).
// Each per-zone field is null unless a minimum sample size is met
// (see build-matchup.ts MIN_OPP_*_FOR_ZONE_PCT). Rules also enforce their own
// rate gates so a rule that says "they let teams get to the rim" doesn't fire
// on a low-volume zone.
// ============================================================================
import type { TacticalRule } from '../types';
import { gt, lt, pctStr } from '../types';

export const offensiveRules: TacticalRule[] = [
  {
    // FIXED: previously fired on overall oppEfgAllowed which conflated all zones.
    // Now fires only on true rim FG% allowed, with sample-size gating.
    id: 'pressure-the-rim',
    category: 'offensive',
    title: 'Pressure the rim',
    priority: 5,
    condition: ({ opponent }) =>
      gt(opponent.oppRimFgPct, 0.60) && gt(opponent.oppRimFga, 250),
    recommendation: ({ opponent }) =>
      `Run downhill — PNR, ISO drives, and seal-and-cuts. Force help and hit the roller or corner. They allow ${pctStr(opponent.oppRimFgPct)} at the rim on ${opponent.oppRimFga} opponent attempts.`,
    evidence: ({ opponent }) => ({
      opp_rim_fg_pct_allowed: opponent.oppRimFgPct,
      opp_rim_fga_allowed: opponent.oppRimFga,
      opp_rim_rate_allowed: opponent.oppRimRateAllowed,
    }),
  },

  {
    // Scheme opens the paint but finishing isn't catastrophic (>60% handled by
    // pressure-the-rim). Fires on 55–60% rim FG with high attempt rate.
    id: 'concedes-the-paint',
    category: 'offensive',
    title: 'Attack the paint',
    priority: 4,
    condition: ({ opponent }) =>
      gt(opponent.oppRimRateAllowed, 0.36) &&
      gt(opponent.oppRimFgPct, 0.55) &&
      opponent.oppRimFgPct !== null &&
      opponent.oppRimFgPct <= 0.60 &&
      gt(opponent.oppRimFga, 200),
    recommendation: ({ opponent }) =>
      `Run ball screens and drive gaps — they allow ${pctStr(opponent.oppRimRateAllowed)} of shots at the rim (${opponent.oppRimFga} attempts) at ${pctStr(opponent.oppRimFgPct)}. Wall up late, but their help rotations are slow.`,
    evidence: ({ opponent }) => ({
      opp_rim_rate_allowed: opponent.oppRimRateAllowed,
      opp_rim_fg_pct_allowed: opponent.oppRimFgPct,
      opp_rim_fga_allowed: opponent.oppRimFga,
    }),
  },

  {
    // Upgraded: now uses TRUE 3PT% allowed (derived) and the subject's own
    // 3PT shooting. Also gated on opp 3PA sample size.
    id: 'vulnerable-to-threes',
    category: 'offensive',
    title: 'Hunt threes',
    priority: 5,
    condition: ({ subject, opponent }) =>
      gt(opponent.oppThreePctAllowed, 0.36) &&
      gt(opponent.oppThreePaAllowed, 200) &&
      gt(subject.threePct, 0.34),
    recommendation: ({ subject, opponent }) =>
      `Run their best defenders off the line. Quick reversal into second-side action and find a clean catch — they allow ${pctStr(opponent.oppThreePctAllowed)} from three on ${opponent.oppThreePaAllowed} attempts and we shoot ${pctStr(subject.threePct)}.`,
    evidence: ({ subject, opponent }) => ({
      opp_3PT_pct_allowed: opponent.oppThreePctAllowed,
      opp_3PA_allowed: opponent.oppThreePaAllowed,
      subject_3PT_pct: subject.threePct,
    }),
  },

  {
    // NEW: opponent runs teams off the line (low 3PA rate allowed). Tells the
    // subject team they should expect a paint-heavy / mid-range game.
    id: 'runs-shooters-off-the-line',
    category: 'offensive',
    title: 'Punish closeouts',
    priority: 3,
    condition: ({ opponent }) =>
      lt(opponent.oppThreeRateAllowed, 0.30) && gt(opponent.oppFgaTracked, 1000),
    recommendation: ({ opponent }) =>
      `Expect hard closeouts — only ${pctStr(opponent.oppThreeRateAllowed)} of opponent shots are threes. Drive the closeout, touch the paint, and kick to the weak side for open threes.`,
    evidence: ({ opponent }) => ({
      opp_3PA_rate_allowed: opponent.oppThreeRateAllowed,
      opp_3PT_pct_allowed: opponent.oppThreePctAllowed,
    }),
  },

  {
    id: 'gambling-defense',
    category: 'offensive',
    title: 'Take care of the ball',
    priority: 3,
    condition: ({ opponent }) =>
      gt(opponent.oppForcedTovPct, 0.20) && gt(opponent.oppThreeRateAllowed, 0.40),
    recommendation: ({ opponent }) =>
      `Take care of the ball. Move it, no isolation. They gamble — they force TOs at ${pctStr(opponent.oppForcedTovPct)} but give up ${pctStr(opponent.oppThreeRateAllowed)} of opponent shots from three. Swing it and find the clean look.`,
    evidence: ({ opponent }) => ({
      opp_forced_TOV: opponent.oppForcedTovPct,
      opp_3PA_rate_allowed: opponent.oppThreeRateAllowed,
    }),
  },

  {
    id: 'bad-defensive-rebounding',
    category: 'offensive',
    title: 'Crash the offensive glass',
    priority: 3,
    condition: ({ opponent }) => gt(opponent.oppOrebAllowed, 0.30),
    recommendation: ({ opponent }) =>
      `Crash the offensive glass aggressively. Send three bodies to the boards on every shot — opponents grab ${pctStr(opponent.oppOrebAllowed)} of their misses against this defense.`,
    evidence: ({ opponent }) => ({ opp_OREB_allowed: opponent.oppOrebAllowed }),
  },

  {
    id: 'high-foul-rate-defense',
    category: 'offensive',
    title: 'Attack and draw fouls',
    priority: 4,
    condition: ({ opponent }) => gt(opponent.oppFtrAllowed, 0.30),
    recommendation: ({ opponent }) =>
      `Drive at their bigs. Get them in early foul trouble. Their defense allows ${pctStr(opponent.oppFtrAllowed)} FTR — get into the bonus by the 10-minute mark.`,
    evidence: ({ opponent }) => ({ opp_FTR_allowed: opponent.oppFtrAllowed }),
  },
];
