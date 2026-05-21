// ============================================================================
// Pure shot-classification helpers. No DB access.
//
// All thresholds and bounds derived from the audit script's empirical sample:
//   - shotRange: 'rim' | 'jumper' | 'three_pointer' | 'free_throw' | null
//   - playType:  'JumpShot' | 'LayUpShot' | 'DunkShot' | 'TipShot' | ...
//
// SVG transform reminder (matches components/Court.tsx):
//   courtX = rawX > 470 ? 940 - rawX : rawX
//   svgX   = rawY
//   svgY   = 350 - courtX
//   basket at (svgX=250, svgY=297.5), 10 SVG units = 1 foot
// ============================================================================
import { shotDistanceFt } from '../../components/Court';
import type { ShotType, ThreeSubzone, Zone } from './types';

export interface RawPlay {
  shotRange: string | null;
  playType: string | null;
  shotMade: boolean | null;
  shotX: number | null;
  shotY: number | null;
  shotAssisted: boolean | null;
  period: number | null;
  secondsRemaining: number | null;
  playText: string | null;
}

export function classifyZone(p: { shotRange: string | null; shotX: number; shotY: number }): Zone {
  if (p.shotRange === 'three_pointer') return 'three';
  if (p.shotRange === 'rim') return 'rim';
  if (shotDistanceFt(p.shotX, p.shotY) < 4) return 'rim';
  return 'mid';
}

/**
 * Classify shot type from playType + playText fallback.
 * `JumpShot` covers both midrange jumpers and threes — we keep both as 'jumper'
 * since the zone breakdown already separates them.
 */
export function classifyShotType(p: { playType: string | null; playText: string | null }): ShotType {
  const t = p.playType;
  if (t === 'LayUpShot') return 'layup';
  if (t === 'DunkShot') return 'dunk';
  if (t === 'JumpShot') return 'jumper';
  if (t === 'TipShot') return 'tip';
  // Fallback: text classifier for missing playType rows
  const text = (p.playText ?? '').toLowerCase();
  if (text.includes('dunk')) return 'dunk';
  if (text.includes('tip shot')) return 'tip';
  if (text.includes('layup')) return 'layup';
  if (text.includes('jumper')) return 'jumper';
  return 'unknown';
}

/**
 * For three-pointers: corner vs above-break, derived from coordinates.
 * Heuristic validated against ~4000 sampled threes:
 *   - Corner = |dx from center| > 18 ft AND y close to baseline (svgY > 250)
 *   - Audit produced 20.2% / 79.8% split, consistent with NCAA norms.
 */
export function classifyThreeSubzone(rawX: number, rawY: number): ThreeSubzone {
  const courtX = rawX > 470 ? 940 - rawX : rawX;
  const svgX = rawY;
  const svgY = 350 - courtX;
  const dxFt = Math.abs(svgX - 250) / 10;
  // Closer to baseline than to top of arc when svgY > 250 (basket at 297.5).
  if (dxFt > 18 && svgY > 250) return 'corner';
  return 'above_break';
}

/** True if shot was taken with <30s remaining in any period. End-of-period proxy only. */
export function isEndOfPeriod(p: { secondsRemaining: number | null }): boolean {
  return p.secondsRemaining !== null && p.secondsRemaining < 30;
}
