// ============================================================================
// Defensive rules — how to STOP the opponent.
// Each rule's recommendation MUST reference the specific number(s) that fired
// it. Rules read from `data.subject` (us / UCI in the current UI) and
// `data.opponent`. The engine has no UCI-specific knowledge.
// ============================================================================
import type { TacticalRule } from '../types';
import { gt, lt, pctStr, num } from '../types';

export const defensiveRules: TacticalRule[] = [
  {
    id: 'perimeter-shooter-heavy',
    category: 'defensive',
    title: 'Defend the perimeter',
    priority: 5,
    condition: ({ opponent }) => gt(opponent.threeRate, 0.42) && gt(opponent.threePct, 0.36),
    recommendation: ({ opponent }) =>
      `Switch 1-4 above the free throw line. Top-lock their best shooters off catches. Keep two defenders above the level of the ball at all times — they take ${pctStr(opponent.threeRate)} of shots from three and hit them at ${pctStr(opponent.threePct)}.`,
    evidence: ({ opponent }) => ({
      opp_3PA_rate: opponent.threeRate,
      opp_3PT_pct: opponent.threePct,
    }),
  },

  {
    id: 'high-oreb-team',
    category: 'defensive',
    title: 'Box out — limit second chances',
    priority: 4,
    condition: ({ opponent }) => gt(opponent.orebPct, 0.32),
    recommendation: ({ opponent }) =>
      `Box out from the free throw line back. Have the point guard crash. Limit them to one shot — no putbacks. Their ${pctStr(opponent.orebPct)} OREB rate is what makes them dangerous.`,
    evidence: ({ opponent }) => ({ opp_OREB_pct: opponent.orebPct }),
  },

  {
    id: 'transition-heavy',
    category: 'defensive',
    title: 'Get back in transition',
    priority: 4,
    condition: ({ opponent }) => gt(opponent.pace, 72),
    recommendation: ({ subject, opponent }) =>
      `Get back immediately on every shot. No transition fouls. Match up before they cross half court — they play ${num(opponent.pace)} possessions per game vs. our ${num(subject.pace)}. They want this game played at their tempo.`,
    evidence: ({ subject, opponent }) => ({
      opp_pace: opponent.pace,
      subject_pace: subject.pace,
      pace_gap: opponent.pace !== null && subject.pace !== null ? opponent.pace - subject.pace : null,
    }),
  },

  {
    id: 'low-turnover-team',
    category: 'defensive',
    title: 'Don\u2019t gamble',
    priority: 3,
    condition: ({ opponent }) => lt(opponent.tovPct, 0.16),
    recommendation: ({ opponent }) =>
      `Don't gamble for steals. Force them into halfcourt sets. They take care of the ball (${pctStr(opponent.tovPct)} TOV%) — make them work for every possession instead of giving them easy ones in the open floor.`,
    evidence: ({ opponent }) => ({ opp_TOV_pct: opponent.tovPct }),
  },

  {
    id: 'high-ft-rate-offense',
    category: 'defensive',
    title: 'Contest without fouling',
    priority: 3,
    condition: ({ opponent }) => gt(opponent.ftr, 0.32),
    recommendation: ({ opponent }) =>
      `No closeout fouls. Contest with verticality, hands straight up. They live at the line at ${pctStr(opponent.ftr)} FTR — don't extend their possessions.`,
    evidence: ({ opponent }) => ({ opp_FTR: opponent.ftr }),
  },
];
