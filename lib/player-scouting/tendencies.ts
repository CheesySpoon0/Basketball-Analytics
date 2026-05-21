// ============================================================================
// Player tendency profile — deterministic, derived from Play rows + season
// stats + the precomputed PlayerXeFG cache.
//
// Everything here is grounded in data already in the DB. Where a signal is a
// proxy (transition, end-of-period), the field name and the consuming UI label
// it clearly. No tracking data, no shot-clock data.
// ============================================================================
import { annotateSecondsSinceDefEvent, type MinimalPlay } from '../xefg/transition';
import {
  classifyShotType,
  classifyThreeSubzone,
  classifyZone,
} from './shot-profile';
import type { XeFGAggregate } from '../xefg/types';

/** A Play row as needed by the tendency pass. */
export interface TendencyPlay {
  id: string;
  gameId: number;
  shotRange: string | null;
  playType: string | null;
  playText: string | null;
  shotMade: boolean | null;
  shotX: number | null;
  shotY: number | null;
  shotAssisted: boolean | null;
  period: number | null;
  secondsRemaining: number | null;
}

export interface RateAndPct {
  /** Attempts in this bucket. */
  att: number;
  made: number;
  /** Share of the player's total coordinate FGAs. null if no shots. */
  share: number | null;
  /** FG% within the bucket. null below sample. */
  pct: number | null;
}

/** A zone bucket enriched with xeFG actual vs expected, when the cache has it. */
export interface ZoneQuality {
  actualEfg: number | null;
  expectedEfg: number | null;
  /** actualEfg − expectedEfg, raw fraction. Positive = makes tough shots. */
  delta: number | null;
}

export interface TendencyProfile {
  /** Total coordinate-bearing FGAs analyzed. */
  totalFga: number;

  // ---- shot diet (shares sum to ~1 across rim/mid/three) ----
  rim: RateAndPct;
  mid: RateAndPct;
  three: RateAndPct;
  cornerThree: RateAndPct;
  aboveBreakThree: RateAndPct;

  // ---- shot types ----
  layup: RateAndPct;
  dunk: RateAndPct;
  jumper: RateAndPct;
  /** Tip-ins — our cleanest second-chance/putback signal (playType=TipShot). */
  tip: RateAndPct;

  // ---- proxies (clearly labeled in UI) ----
  /** Shots within 7s of a defensive event in the same period. INFERRED. */
  transition: RateAndPct;
  /** Shots with <30s left in a period. Coarse end-of-quarter proxy, NOT shot clock. */
  endOfPeriod: RateAndPct;

  // ---- creation (descriptive — assisted flag only exists on MADE shots) ----
  creation: {
    /** Made shots that were assisted. */
    assistedMakes: number;
    /** Made shots that were unassisted. */
    unassistedMakes: number;
    totalMakes: number;
    /** Of his MAKES, share that were assisted. Labeled "assisted-make rate". */
    assistedMakeShare: number | null;
    /** Of his made threes, share assisted. */
    assistedThreeMakeShare: number | null;
    /** Made threes (denominator for assistedThreeMakeShare). */
    threeMakes: number;
    /** Assisted made threes (numerator). */
    assistedThreeMakes: number;
    /** Of his made rim shots, share assisted. */
    assistedRimMakeShare: number | null;
    /** Made rim shots (denominator for assistedRimMakeShare). */
    rimMakes: number;
  };

  // ---- xeFG shot quality, overall + per zone ----
  quality: {
    sampleSize: number;
    actualEfg: number | null;
    expectedEfg: number | null;
    /** Overall shotmaking delta. Positive = beats expected. */
    delta: number | null;
    byZone: Record<'rim' | 'mid' | 'three', ZoneQuality>;
  };
}

function emptyRate(): RateAndPct {
  return { att: 0, made: 0, share: null, pct: null };
}

function finalize(r: RateAndPct, total: number): RateAndPct {
  r.share = total > 0 ? r.att / total : null;
  r.pct = r.att > 0 ? r.made / r.att : null;
  return r;
}

const TRANSITION_WINDOW_SECONDS = 7;
const END_OF_PERIOD_SECONDS = 30;

/**
 * Build the full tendency profile from a player's coordinate-bearing FGAs.
 *
 * `allTeamPlaysByGame` supplies the FULL play stream per game so the transition
 * proxy can find the previous defensive event. If omitted, transition is left
 * at zero (share stays null) rather than guessed.
 */
export function buildTendencyProfile(
  shotPlays: TendencyPlay[],
  xefg: XeFGAggregate | null,
  transitionShotIds?: Set<string>,
): TendencyProfile {
  const rim = emptyRate();
  const mid = emptyRate();
  const three = emptyRate();
  const cornerThree = emptyRate();
  const aboveBreakThree = emptyRate();
  const layup = emptyRate();
  const dunk = emptyRate();
  const jumper = emptyRate();
  const tip = emptyRate();
  const transition = emptyRate();
  const endOfPeriod = emptyRate();

  let assistedMakes = 0;
  let unassistedMakes = 0;
  let assistedThreeMakes = 0;
  let threeMakes = 0;
  let assistedRimMakes = 0;
  let rimMakes = 0;

  for (const p of shotPlays) {
    if (p.shotX === null || p.shotY === null) continue;
    const zone = classifyZone({ shotRange: p.shotRange, shotX: p.shotX, shotY: p.shotY });
    const stype = classifyShotType({ playType: p.playType, playText: p.playText });
    const made = p.shotMade === true;

    const zoneBucket = zone === 'rim' ? rim : zone === 'mid' ? mid : three;
    zoneBucket.att++;
    if (made) zoneBucket.made++;

    if (zone === 'three') {
      const sub = classifyThreeSubzone(p.shotX, p.shotY);
      const subBucket = sub === 'corner' ? cornerThree : aboveBreakThree;
      subBucket.att++;
      if (made) subBucket.made++;
    }

    const typeBucket =
      stype === 'layup' ? layup : stype === 'dunk' ? dunk : stype === 'jumper' ? jumper : stype === 'tip' ? tip : null;
    if (typeBucket) {
      typeBucket.att++;
      if (made) typeBucket.made++;
    }

    if (transitionShotIds?.has(p.id)) {
      transition.att++;
      if (made) transition.made++;
    }

    if (p.secondsRemaining !== null && p.secondsRemaining < END_OF_PERIOD_SECONDS) {
      endOfPeriod.att++;
      if (made) endOfPeriod.made++;
    }

    // Creation — assisted flag is reliable only on MADE shots.
    if (made) {
      if (p.shotAssisted === true) assistedMakes++;
      else if (p.shotAssisted === false) unassistedMakes++;
      if (zone === 'three') {
        threeMakes++;
        if (p.shotAssisted === true) assistedThreeMakes++;
      }
      if (zone === 'rim') {
        rimMakes++;
        if (p.shotAssisted === true) assistedRimMakes++;
      }
    }
  }

  const total = shotPlays.filter((p) => p.shotX !== null && p.shotY !== null).length;
  for (const r of [rim, mid, three, cornerThree, aboveBreakThree, layup, dunk, jumper, tip, transition, endOfPeriod]) {
    finalize(r, total);
  }

  const totalMakes = assistedMakes + unassistedMakes;
  const zoneQuality = (z: 'rim' | 'mid' | 'three'): ZoneQuality => {
    const zr = xefg?.byZone?.[z];
    return {
      actualEfg: zr?.actualEfg ?? null,
      expectedEfg: zr?.expectedEfg ?? null,
      delta: zr?.delta ?? null,
    };
  };

  return {
    totalFga: total,
    rim,
    mid,
    three,
    cornerThree,
    aboveBreakThree,
    layup,
    dunk,
    jumper,
    tip,
    transition,
    endOfPeriod,
    creation: {
      assistedMakes,
      unassistedMakes,
      totalMakes,
      assistedMakeShare: totalMakes > 0 ? assistedMakes / totalMakes : null,
      assistedThreeMakeShare: threeMakes > 0 ? assistedThreeMakes / threeMakes : null,
      threeMakes,
      assistedThreeMakes,
      assistedRimMakeShare: rimMakes > 0 ? assistedRimMakes / rimMakes : null,
      rimMakes,
    },
    quality: {
      sampleSize: xefg?.sampleSize ?? 0,
      actualEfg: xefg?.actualEfg ?? null,
      expectedEfg: xefg?.expectedEfg ?? null,
      delta: xefg?.delta ?? null,
      byZone: {
        rim: zoneQuality('rim'),
        mid: zoneQuality('mid'),
        three: zoneQuality('three'),
      },
    },
  };
}

/**
 * Compute which of a player's shots were transition-ish. Needs the FULL play
 * stream for every game the player shot in. Returns the set of shot ids that
 * fall within the transition window after a defensive event.
 */
export function deriveTransitionShotIds(
  playsByGame: Map<number, MinimalPlay[]>,
  playerShotIds: Set<string>,
): Set<string> {
  const out = new Set<string>();
  for (const plays of playsByGame.values()) {
    const sinceDef = annotateSecondsSinceDefEvent(plays);
    for (const [id, secs] of sinceDef) {
      if (!playerShotIds.has(id)) continue;
      if (secs !== null && secs >= 0 && secs <= TRANSITION_WINDOW_SECONDS) {
        out.add(id);
      }
    }
  }
  return out;
}
