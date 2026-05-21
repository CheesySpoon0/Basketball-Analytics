// ============================================================================
// Compute "seconds since previous defensive event" for each shot in a play
// stream. Matches the Python window logic in extract_shots.py.
//
// A "defensive event" is one of: Defensive Rebound, Steal, Lost Ball Turnover,
// Block Shot, Dead Ball Rebound. Within a (gameId, period), we look at the
// most recent such event BEFORE the shot. Plays are processed in clock-DESC
// order (clock counts down).
// ============================================================================

export const DEFENSIVE_EVENT_PLAY_TYPES = new Set([
  'Defensive Rebound',
  'Steal',
  'Lost Ball Turnover',
  'Block Shot',
  'Dead Ball Rebound',
]);

export interface MinimalPlay {
  id: string;
  gameId: number;
  period: number | null;
  secondsRemaining: number | null;
  playType: string | null;
}

/**
 * For each play, returns secondsSinceDefEvent — the time delta from the most
 * recent defensive event earlier in the same period. Null if no prior def
 * event exists.
 *
 * Caller is responsible for passing plays from the SAME game (or batching
 * by game).
 */
export function annotateSecondsSinceDefEvent(
  plays: MinimalPlay[],
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  // Sort by (period asc, secondsRemaining desc). Stable within ties.
  const sorted = [...plays].sort((a, b) => {
    const pa = a.period ?? 1;
    const pb = b.period ?? 1;
    if (pa !== pb) return pa - pb;
    const sa = a.secondsRemaining ?? 0;
    const sb = b.secondsRemaining ?? 0;
    return sb - sa;
  });
  let currentPeriod = -1;
  let lastDefClock: number | null = null;
  for (const p of sorted) {
    const period = p.period ?? 1;
    if (period !== currentPeriod) {
      currentPeriod = period;
      lastDefClock = null;
    }
    const isDef = p.playType !== null && DEFENSIVE_EVENT_PLAY_TYPES.has(p.playType);
    if (lastDefClock !== null && p.secondsRemaining !== null) {
      out.set(p.id, lastDefClock - p.secondsRemaining);
    } else {
      out.set(p.id, null);
    }
    if (isDef && p.secondsRemaining !== null) {
      lastDefClock = p.secondsRemaining;
    }
  }
  return out;
}
