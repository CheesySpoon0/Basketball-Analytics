// ============================================================================
// Style rules — pace, tempo, shot diet mismatches.
// Reads from `data.subject` (us) and `data.opponent`. Surfaced under
// "How UCI Can Attack" since the subject is initiating these adjustments.
// ============================================================================
import type { TacticalRule } from '../types';
import { gt, num } from '../types';

const paceGap = (a: number | null, b: number | null): number | null =>
  a === null || b === null ? null : a - b;

export const styleRules: TacticalRule[] = [
  {
    id: 'pace-mismatch-subject-faster',
    category: 'style',
    title: 'Push the tempo',
    priority: 3,
    condition: ({ subject, opponent }) => {
      const gap = paceGap(subject.pace, opponent.pace);
      return gap !== null && gap > 3;
    },
    recommendation: ({ subject, opponent }) =>
      `Push in transition — advance with the pass, hunt early offense. We play ${num(subject.pace)} possessions, they play ${num(opponent.pace)}. Make them defend before their halfcourt shell is set.`,
    evidence: ({ subject, opponent }) => ({
      subject_pace: subject.pace,
      opp_pace: opponent.pace,
      pace_gap: paceGap(subject.pace, opponent.pace),
    }),
  },

  {
    id: 'pace-mismatch-subject-slower',
    category: 'style',
    title: 'Slow it down',
    priority: 3,
    condition: ({ subject, opponent }) => {
      const gap = paceGap(opponent.pace, subject.pace);
      return gap !== null && gap > 3;
    },
    recommendation: ({ subject, opponent }) =>
      `Walk it up after makes. No quick shots off the break. They play ${num(opponent.pace)} possessions per game — we play ${num(subject.pace)}. Drag them into halfcourt where our execution wins.`,
    evidence: ({ subject, opponent }) => ({
      subject_pace: subject.pace,
      opp_pace: opponent.pace,
      pace_gap: paceGap(opponent.pace, subject.pace),
    }),
  },

  {
    id: 'style-three-and-rim-spam',
    category: 'style',
    title: 'Force long twos',
    priority: 4,
    condition: ({ opponent }) =>
      gt(opponent.threeRate, 0.40) && gt(opponent.rimRate, 0.35),
    recommendation: ({ opponent }) => {
      const midRate = opponent.midRate;
      const midStr = midRate === null ? '' : ` (${(midRate * 100).toFixed(1)}% of shots)`;
      return `They've abandoned the midrange${midStr}. Force them into long twos and contested floaters. Get them off the line AND wall off the rim — everything else is acceptable.`;
    },
    evidence: ({ opponent }) => ({
      opp_3PA_rate: opponent.threeRate,
      opp_rim_rate: opponent.rimRate,
      opp_mid_rate: opponent.midRate,
    }),
  },
];
