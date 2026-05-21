// ============================================================================
// Feature engineering for xeFG inference.
//
// EVERY function here must produce a value bit-identical to the corresponding
// Python implementation in scripts/python/xefg/extract_shots.py. A parity
// regression test lives in scripts/test-xefg-parity.ts.
//
// Coordinate transform is the same one used by components/Court.tsx and
// lib/player-scouting/shot-profile.ts.
// ============================================================================
import type { RawShot, ShotFeatures } from './types';

const BASKET_SVG_X = 250.0;
const BASKET_SVG_Y = 297.5;
const FT_TO_SVG = 10.0;

export function shotToSvg(rawX: number, rawY: number): { svgX: number; svgY: number } {
  const courtX = rawX > 470 ? 940 - rawX : rawX;
  return { svgX: rawY, svgY: 350 - courtX };
}

export function distanceFromRim(rawX: number, rawY: number): number {
  const { svgX, svgY } = shotToSvg(rawX, rawY);
  const dx = svgX - BASKET_SVG_X;
  const dy = svgY - BASKET_SVG_Y;
  return Math.sqrt(dx * dx + dy * dy) / FT_TO_SVG;
}

export function classifyZone(
  shotRange: string | null,
  rawX: number,
  rawY: number,
): 'rim' | 'mid' | 'three' {
  if (shotRange === 'three_pointer') return 'three';
  if (shotRange === 'rim') return 'rim';
  if (distanceFromRim(rawX, rawY) < 4.0) return 'rim';
  return 'mid';
}

export function isCornerThree(
  zone: 'rim' | 'mid' | 'three',
  rawX: number,
  rawY: number,
): boolean {
  if (zone !== 'three') return false;
  const { svgX, svgY } = shotToSvg(rawX, rawY);
  const dxFt = Math.abs(svgX - BASKET_SVG_X) / FT_TO_SVG;
  return dxFt > 18.0 && svgY > 250.0;
}

/**
 * Extract the feature vector for one shot. Order is irrelevant — applyModel
 * looks up by name. All booleans are coerced to 0/1 to match the trained
 * Python LR exactly.
 */
export function extractFeatures(shot: RawShot): ShotFeatures {
  const rawX = shot.shotX;
  const rawY = shot.shotY;
  const dist = distanceFromRim(rawX, rawY);
  const zone = classifyZone(shot.shotRange, rawX, rawY);
  const corner = isCornerThree(zone, rawX, rawY);

  const isLayup = shot.playType === 'LayUpShot';
  const isDunk = shot.playType === 'DunkShot';
  const isJumper = shot.playType === 'JumpShot';
  const isTip = shot.playType === 'TipShot';

  const secondsLeft = shot.secondsRemaining ?? 0;
  const period = shot.period ?? 1;

  const homeTeam = shot.teamId !== null && shot.teamId === shot.gameHomeTeamId;
  const shooterScore =
    (homeTeam ? shot.homeScore : shot.awayScore) ?? 0;
  const oppScore =
    (homeTeam ? shot.awayScore : shot.homeScore) ?? 0;

  const sinceDef = shot.secondsSinceDefEvent;
  const isTransition =
    sinceDef !== null && sinceDef >= 0 && sinceDef <= 7;

  return {
    distance_from_rim: dist,
    seconds_remaining_in_period: secondsLeft,
    score_differential: shooterScore - oppScore,
    period,
    zone_rim: zone === 'rim' ? 1 : 0,
    zone_three: zone === 'three' ? 1 : 0,
    is_corner_three: corner ? 1 : 0,
    is_layup: isLayup ? 1 : 0,
    is_dunk: isDunk ? 1 : 0,
    is_jumper: isJumper ? 1 : 0,
    is_tip: isTip ? 1 : 0,
    dist_0_3: dist < 3.0 ? 1 : 0,
    dist_3_10: dist >= 3.0 && dist < 10.0 ? 1 : 0,
    dist_10_22: dist >= 10.0 && dist < 22.0 ? 1 : 0,
    is_end_of_period: (shot.secondsRemaining ?? 999) < 30 ? 1 : 0,
    is_transition: isTransition ? 1 : 0,
    home_team: homeTeam ? 1 : 0,
  };
}
