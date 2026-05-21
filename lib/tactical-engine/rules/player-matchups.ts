// ============================================================================
// Player-matchup rules — iterate over opponent.topPlayers.
// Each rule fires once PER MATCHING PLAYER.
// ============================================================================
import type { PlayerTacticalRule } from '../types';
import { gt, lt, pctStr, num } from '../types';

const isFrontcourt = (pos: string | null): boolean => {
  if (!pos) return false;
  const p = pos.toUpperCase();
  return p.includes('F') || p.includes('C');
};

export const playerMatchupRules: PlayerTacticalRule[] = [
  {
    id: 'dominant-volume-scorer',
    category: 'player',
    title: 'Trap their go-to scorer',
    priority: 5,
    // NOTE: shareOfTeamFga is a volume proxy, NOT true usage rate.
    condition: (p) => gt(p.shareOfTeamFga, 0.22) && gt(p.efgPct, 0.52),
    recommendation: (p) =>
      `Pre-rotate to ${p.name} on every catch above the elbow. Show a second defender on the first dribble — he accounts for ${pctStr(p.shareOfTeamFga)} of their FGA at ${pctStr(p.efgPct)} eFG (${num(p.ppg)} PPG). Make someone else beat us.`,
    evidence: (p) => ({
      player_name: p.name,
      player_share_of_FGA: p.shareOfTeamFga,
      player_eFG: p.efgPct,
      player_PPG: p.ppg,
    }),
  },

  {
    id: 'high-volume-shooter',
    category: 'player',
    title: 'Top-lock the shooter',
    priority: 5,
    condition: (p) => gt(p.threePerGame, 5) && gt(p.threePct, 0.36),
    recommendation: (p) =>
      `Top-lock ${p.name}. No catches above the break. Make him put it on the floor — he's at ${pctStr(p.threePct)} on ${p.threeAttempts} attempts (${num(p.threePerGame)} per game). The catch-and-shoot is his money.`,
    evidence: (p) => ({
      player_name: p.name,
      three_pct: p.threePct,
      three_attempts: p.threeAttempts,
      three_per_game: p.threePerGame,
    }),
  },

  {
    id: 'weak-three-shooter',
    category: 'player',
    title: 'Go under screens',
    priority: 3,
    condition: (p) => lt(p.threePct, 0.30) && gt(p.threePerGame, 2),
    recommendation: (p) =>
      `Go under screens against ${p.name}. Concede the deep two and open threes — he's at ${pctStr(p.threePct)} on ${p.threeAttempts} attempts. Don't help off shooters to recover on him.`,
    evidence: (p) => ({
      player_name: p.name,
      three_pct: p.threePct,
      three_attempts: p.threeAttempts,
    }),
  },

  {
    id: 'one-dimensional-driver',
    category: 'player',
    title: 'ICE and wall him off',
    priority: 4,
    condition: (p) => gt(p.rimRate, 0.55) && lt(p.threePct, 0.30),
    recommendation: (p) =>
      `ICE the screens against ${p.name}, force baseline. Wall up at the rim. Don't reach — he'll get to the line. ${pctStr(p.rimRate)} of his shots are at the rim and he's only ${pctStr(p.threePct)} from three — dare him to shoot.`,
    evidence: (p) => ({
      player_name: p.name,
      rim_rate: p.rimRate,
      three_pct: p.threePct,
    }),
  },

  {
    id: 'stretch-big',
    category: 'player',
    title: 'Switch 1-5 on his screens',
    priority: 4,
    condition: (p) =>
      isFrontcourt(p.position) && gt(p.threePct, 0.34) && gt(p.threePerGame, 2),
    recommendation: (p) =>
      `Switch 1-5 on ${p.name}'s screens. No drop coverage — if our big drops, he pops for an open three. ${pctStr(p.threePct)} on ${p.threeAttempts} attempts as a ${p.position}.`,
    evidence: (p) => ({
      player_name: p.name,
      position: p.position,
      three_pct: p.threePct,
      three_attempts: p.threeAttempts,
    }),
  },
];
