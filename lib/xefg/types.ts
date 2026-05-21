// ============================================================================
// xeFG types — public surface of the inference module.
// ============================================================================

/** Raw input fields needed from a Play row to extract features. */
export interface RawShot {
  shotX: number;
  shotY: number;
  shotRange: string | null;
  playType: string | null;
  shotMade: boolean | null;
  period: number | null;
  secondsRemaining: number | null;
  homeScore: number | null;
  awayScore: number | null;
  /** Team that took the shot. */
  teamId: number | null;
  /** Game home team — used to compute home_team + score_differential. */
  gameHomeTeamId: number | null;
  /** Seconds since previous defensive event in the same period.
   *  Null if unknown (start of period / no prior def event). Used only to
   *  derive `is_transition`. The caller is responsible for computing this
   *  from the play stream (see lib/xefg/transition.ts). */
  secondsSinceDefEvent: number | null;
}

/** Feature vector — order MUST match coefficients.json `features` order. */
export interface ShotFeatures {
  distance_from_rim: number;
  seconds_remaining_in_period: number;
  score_differential: number;
  period: number;
  zone_rim: number;
  zone_three: number;
  is_corner_three: number;
  is_layup: number;
  is_dunk: number;
  is_jumper: number;
  is_tip: number;
  dist_0_3: number;
  dist_3_10: number;
  dist_10_22: number;
  is_end_of_period: number;
  is_transition: number;
  home_team: number;
}

export interface ShotPrediction {
  /** P(made) in [0, 1]. */
  pMake: number;
  /** Expected eFG contribution of this single shot:
   *    threes:        pMake * 1.5  (because eFG counts a made 3 as 1.5)
   *    twos / others: pMake        */
  expectedEfg: number;
  /** Whether this shot is a three (1) or a two (0). Useful for callers. */
  isThree: number;
}

export interface XeFGAggregate {
  sampleSize: number;
  /** raw FG made / FGA — kept for reference */
  fgPct: number | null;
  /** actual eFG = (FGM + 0.5*3PM) / FGA */
  actualEfg: number | null;
  /** mean expectedEfg over the same set of shots */
  expectedEfg: number | null;
  /** actualEfg − expectedEfg, in raw fraction (multiply by 100 for percentage points) */
  delta: number | null;
  byZone: Record<'rim' | 'mid' | 'three', ZoneAggregate>;
}

export interface ZoneAggregate {
  sampleSize: number;
  fgPct: number | null;
  actualEfg: number | null;
  expectedEfg: number | null;
  delta: number | null;
}
