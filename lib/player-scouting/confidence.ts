// ============================================================================
// Report confidence — how much a coach should trust this scouting report.
//
// Driven by four observable inputs: coordinate FGAs, minutes per game, games
// played, and xeFG coordinate coverage (what fraction of shots the model could
// score). Low confidence softens / suppresses borderline rules upstream.
// ============================================================================

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface ConfidenceInput {
  /** Coordinate-bearing FGAs analyzed. */
  totalFga: number;
  /** xeFG sample (shots the model actually scored). */
  xefgSample: number;
  minutesPerGame: number | null;
  games: number;
}

export interface ConfidenceResult {
  level: ConfidenceLevel;
  /** 0–100, for display. */
  score: number;
  /** Short reasons explaining the level. */
  reasons: string[];
  /** True when rules should be softened ("likely", "may") and weak ones dropped. */
  soften: boolean;
}

/** Sub-score in [0,1] with a linear ramp between floor and full. */
function ramp(value: number, floor: number, full: number): number {
  if (value <= floor) return 0;
  if (value >= full) return 1;
  return (value - floor) / (full - floor);
}

export function deriveConfidence(input: ConfidenceInput): ConfidenceResult {
  const { totalFga, xefgSample, minutesPerGame, games } = input;

  // Four weighted sub-scores.
  const fgaScore = ramp(totalFga, 25, 200); // 25 -> 0, 200+ -> 1
  const mpgScore = ramp(minutesPerGame ?? 0, 8, 25);
  const gamesScore = ramp(games, 8, 28);
  // Coverage: how much of his shot volume the xeFG model scored.
  const coverage = totalFga > 0 ? Math.min(1, xefgSample / totalFga) : 0;
  const coverageScore = ramp(coverage, 0.4, 0.9);

  const score = Math.round(
    100 * (0.4 * fgaScore + 0.2 * mpgScore + 0.2 * gamesScore + 0.2 * coverageScore),
  );

  const reasons: string[] = [];
  if (totalFga < 50) reasons.push(`${totalFga} tracked FGAs — shot splits are noisy`);
  else if (totalFga < 120) reasons.push(`${totalFga} tracked FGAs — moderate sample`);
  else reasons.push(`${totalFga} tracked FGAs — solid shot sample`);

  if (minutesPerGame !== null && minutesPerGame < 12) {
    reasons.push(`${minutesPerGame.toFixed(1)} MPG — limited rotation role`);
  }
  if (games < 12) reasons.push(`only ${games} games played`);
  if (coverage < 0.6 && totalFga >= 25) {
    reasons.push(`xeFG scored ${Math.round(coverage * 100)}% of his shots`);
  }

  let level: ConfidenceLevel;
  if (score >= 70) level = 'high';
  else if (score >= 45) level = 'medium';
  else level = 'low';

  return {
    level,
    score,
    reasons,
    soften: level === 'low',
  };
}
