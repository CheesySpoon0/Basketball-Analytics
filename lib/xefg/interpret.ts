// ============================================================================
// Coach-facing copy for xeFG deltas.
// ============================================================================

/** One-line read on actual vs expected eFG (delta in raw fraction, e.g. 0.032 = +3.2pp). */
export function interpretXeFGDelta(
  delta: number | null,
  sampleSize: number,
  minSample = 30,
): string {
  if (sampleSize < minSample) {
    return 'Sample too small to separate shot-making from shot quality.';
  }
  if (delta === null || Number.isNaN(delta)) {
    return 'xeFG comparison unavailable.';
  }
  const pp = delta * 100;
  if (pp >= 2.5) {
    return `Real shotmaker — finishes ${pp.toFixed(1)} percentage points above the quality of his looks.`;
  }
  if (pp >= 1) {
    return `Slight positive shot-making (${pp.toFixed(1)}pp above expected eFG on his shot profile).`;
  }
  if (pp <= -2.5) {
    return `Efficiency is mostly shot-selection — ${Math.abs(pp).toFixed(1)}pp below expected eFG on his looks.`;
  }
  if (pp <= -1) {
    return `Mild negative finishing (${pp.toFixed(1)}pp below expected eFG).`;
  }
  const sign = pp >= 0 ? '+' : '';
  return `Finishes in line with shot quality (${sign}${pp.toFixed(1)}pp vs expectation).`;
}

/** Team offense: positive delta = over-performing shot quality. */
export function interpretTeamOffenseDelta(delta: number | null, sampleSize: number): string {
  if (sampleSize < 50 || delta === null) return 'Shot-making vs shot quality (offense)';
  const pp = delta * 100;
  if (pp >= 1.5) return 'Shotmaking efficiency — converts looks better than expected';
  if (pp <= -1.5) return 'Shot quality driven — efficiency tracks shot selection more than finishing';
  return 'Finishing roughly matches shot quality generated';
}

/** Team defense: lower xeFG allowed = good prevention; actual−xeFG = contest quality. */
export function interpretTeamDefensePrevention(expectedEfg: number | null): string {
  if (expectedEfg === null) return '—';
  return `${(expectedEfg * 100).toFixed(1)}% expected eFG allowed (shot prevention)`;
}

export function interpretTeamDefenseContest(delta: number | null): string {
  if (delta === null) return '—';
  const pp = delta * 100;
  if (pp > 1) return `Opponents finish hot (+${pp.toFixed(1)}pp vs expected)`;
  if (pp < -1) return `Strong contests (${pp.toFixed(1)}pp below expected)`;
  return `Contest quality near expectation (${pp >= 0 ? '+' : ''}${pp.toFixed(1)}pp)`;
}
