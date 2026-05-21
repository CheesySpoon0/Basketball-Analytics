// ============================================================================
// Offensive volume / threat tiers — drives note intensity and scouting priority.
// ============================================================================

export type ScoutingPriority =
  | 'Must game-plan'
  | 'Key rotation threat'
  | 'Role player'
  | 'Low-usage spacer'
  | 'Limited sample';

export interface VolumeContext {
  mpg: number | null;
  ppg: number;
  shareOfTeamFga: number | null;
  threePerGame: number | null;
  threeAttempts: number;
  totalFga: number;
  threeRate: number | null;
  rotationEligible: boolean;
}

/** Primary offensive threats — top-lock / trap / chase language. */
export function isPrimaryThreat(v: VolumeContext): boolean {
  if (v.ppg >= 15) return true;
  if (v.shareOfTeamFga !== null && v.shareOfTeamFga >= 0.20 && v.ppg >= 12) return true;
  if (v.threePerGame !== null && v.threePerGame >= 5 && v.ppg >= 12) return true;
  return false;
}

/** Rotation scorers / shooters — stay attached, controlled closeouts. */
export function isSecondaryThreat(v: VolumeContext): boolean {
  if (isPrimaryThreat(v)) return true;
  if (v.ppg >= 8 && v.mpg !== null && v.mpg >= 18) return true;
  if (v.shareOfTeamFga !== null && v.shareOfTeamFga >= 0.12) return true;
  if (v.threePerGame !== null && v.threePerGame >= 2.5) return true;
  if (v.threeAttempts >= 50) return true;
  return false;
}

/** Spacing role with limited touches — know where he is, don't over-help. */
export function isLowUsageSpacer(v: VolumeContext): boolean {
  const lowShare = v.shareOfTeamFga !== null && v.shareOfTeamFga < 0.12;
  const lowScoring = v.ppg < 7;
  const lowThreeVol = (v.threePerGame ?? 0) < 2.5 && v.threeAttempts < 60;
  const spaces = v.threeRate !== null && v.threeRate > 0.40;
  return spaces && (lowShare || (lowScoring && lowThreeVol));
}

export function deriveScoutingPriority(v: VolumeContext): ScoutingPriority {
  if (v.totalFga < 20 || !v.rotationEligible) return 'Limited sample';
  if (v.mpg !== null && v.mpg < 8 && v.ppg < 5) return 'Limited sample';

  if (isPrimaryThreat(v)) return 'Must game-plan';

  if (isLowUsageSpacer(v)) return 'Low-usage spacer';

  if (
    (v.mpg !== null && v.mpg >= 20 && v.ppg >= 9) ||
    (v.shareOfTeamFga !== null && v.shareOfTeamFga >= 0.14 && v.ppg >= 8) ||
    (v.threePerGame !== null && v.threePerGame >= 3.5 && v.ppg >= 8) ||
    v.ppg >= 12
  ) {
    return 'Key rotation threat';
  }

  if (v.totalFga < 40 && (v.mpg === null || v.mpg < 12)) return 'Limited sample';

  return 'Role player';
}
