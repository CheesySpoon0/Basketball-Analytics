// ============================================================================
// Opponent attack plan — what the OPPONENT will try to do against the subject.
//
// This is the deterministic core of the brief's "How They Will Attack Us"
// section. Unlike the offensive/defensive rules (which are UCI instructions),
// every prediction here is a statement about the OPPONENT's intent, derived
// from their own offensive profile and where it meets a UCI weakness.
//
// The LLM never invents strategy — it only converts these grounded predictions
// into coach voice.
// ============================================================================
import type { MatchupData, TeamProfile } from './types';

export interface AttackPrediction {
  /** Stable id for dedup / ordering. */
  id: string;
  /** Coach-readable headline, e.g. "Hunt early threes". */
  headline: string;
  /** One-sentence deterministic prediction citing numbers. */
  detail: string;
  /** 5 = near-certain primary action, 1 = minor tendency. */
  priority: 1 | 2 | 3 | 4 | 5;
  /** Numbers backing the prediction (already display-formatted). */
  evidence: Array<{ label: string; value: string }>;
}

const pct = (x: number | null, d = 1) => (x === null ? 'N/A' : `${(x * 100).toFixed(d)}%`);
const num = (x: number | null, d = 1) => (x === null ? 'N/A' : x.toFixed(d));
const gt = (x: number | null, t: number) => x !== null && x > t;
const lt = (x: number | null, t: number) => x !== null && x < t;

/**
 * Build the opponent's likely attack plan. `subject` = UCI (the team we defend
 * with), `opponent` = the team being scouted.
 */
export function buildOpponentAttackPlan(data: MatchupData): AttackPrediction[] {
  const opp = data.opponent;
  const uci = data.subject;
  const out: AttackPrediction[] = [];

  // ---- Tempo: will they push or grind? ----
  if (gt(opp.pace, 70)) {
    out.push({
      id: 'push-tempo',
      headline: 'Push tempo and attack early',
      detail: `${opp.name} plays fast — ${num(opp.pace)} possessions a game. Expect early offense, drag screens, and shots before our defense is set.`,
      priority: 4,
      evidence: [
        { label: 'Opp pace', value: num(opp.pace) },
        ...(uci.pace !== null ? [{ label: 'UCI pace', value: num(uci.pace) }] : []),
      ],
    });
  } else if (lt(opp.pace, 65) && opp.pace !== null) {
    out.push({
      id: 'grind-tempo',
      headline: 'Slow the game and grind possessions',
      detail: `${opp.name} plays deliberately — ${num(opp.pace)} possessions a game. Expect long possessions, deep clock, and half-court execution.`,
      priority: 3,
      evidence: [{ label: 'Opp pace', value: num(opp.pace) }],
    });
  }

  // ---- Three-point hunting ----
  if (gt(opp.threeRate, 0.42)) {
    const efficient = gt(opp.threePct, 0.35);
    out.push({
      id: 'hunt-threes',
      headline: efficient ? 'Hunt threes — they make them' : 'Hunt threes at volume',
      detail: `${pct(opp.threeRate)} of ${opp.name}'s shots are threes${
        efficient ? ` and they hit ${pct(opp.threePct)}` : ` (${pct(opp.threePct)})`
      }. Expect early ball reversal, flare and pin-down actions, and weak-side relocation to free shooters.`,
      priority: efficient ? 5 : 3,
      evidence: [
        { label: 'Opp 3PT rate', value: pct(opp.threeRate) },
        { label: 'Opp 3PT%', value: pct(opp.threePct) },
        { label: '3PA/game', value: num(opp.threePerGame) },
      ],
    });
  }

  // ---- Rim pressure / paint attack ----
  if (gt(opp.rimRate, 0.40) && gt(opp.rimPct, 0.58)) {
    out.push({
      id: 'attack-rim',
      headline: 'Attack the rim and finish',
      detail: `${opp.name} lives in the paint — ${pct(opp.rimRate)} of their shots come at the rim and they convert ${pct(opp.rimPct)}. Expect downhill drives, ball-screen rolls, and cuts hunting our help.`,
      priority: 4,
      evidence: [
        { label: 'Opp rim rate', value: pct(opp.rimRate) },
        { label: 'Opp rim FG%', value: pct(opp.rimPct) },
      ],
    });
  }

  // ---- Run a movement shooter off screens ----
  const movementShooter = data.opponentTopPlayers.find(
    (p) => gt(p.threePerGame, 5) && gt(p.threePct, 0.35),
  );
  if (movementShooter) {
    out.push({
      id: 'movement-shooter',
      headline: `Run ${movementShooter.name} off screens`,
      detail: `${movementShooter.name} hunts threes at volume — ${num(movementShooter.threePerGame)} a game at ${pct(movementShooter.threePct)}. Expect pin-downs, flares, and dribble hand-offs to get him clean catches off the move.`,
      priority: 4,
      evidence: [
        { label: 'Player', value: movementShooter.name },
        { label: '3PA/game', value: num(movementShooter.threePerGame) },
        { label: '3PT%', value: pct(movementShooter.threePct) },
      ],
    });
  }

  // ---- Drag our bigs into space (stretch big) ----
  const stretchBig = data.opponentTopPlayers.find(
    (p) =>
      (p.position?.toUpperCase().includes('F') || p.position?.toUpperCase().includes('C')) &&
      gt(p.threePerGame, 1.8) &&
      gt(p.threePct, 0.31),
  );
  if (stretchBig) {
    out.push({
      id: 'stretch-big',
      headline: 'Play through a stretch big',
      detail: `${stretchBig.name} (${stretchBig.position ?? 'F'}) pops to the arc — ${num(stretchBig.threePerGame)} threes a game at ${pct(stretchBig.threePct)}. Expect pick-and-pop to drag our rim protector away from the basket.`,
      priority: 4,
      evidence: [
        { label: 'Player', value: stretchBig.name },
        { label: '3PA/game', value: num(stretchBig.threePerGame) },
        { label: '3PT%', value: pct(stretchBig.threePct) },
      ],
    });
  }

  // ---- Feature a primary scorer ----
  // A clear lead scorer is an iso/ball-screen threat. Two ways in: very high
  // shot share, OR high scoring volume (a 17+ PPG player is featured even if
  // his share is spread across a balanced offense).
  const isoScorer = data.opponentTopPlayers.find(
    (p) => (p.ppg >= 17 || (p.ppg >= 13 && gt(p.shareOfTeamFga, 0.22))),
  );
  if (isoScorer) {
    out.push({
      id: 'isolate-scorer',
      headline: `Get the ball to ${isoScorer.name}`,
      detail: `${isoScorer.name} is their go-to scorer — ${num(isoScorer.ppg)} PPG on ${pct(isoScorer.shareOfTeamFga)} of team shots. Expect ball-screens and late-clock isolations hunting a switch onto a smaller or slower defender.`,
      priority: 5,
      evidence: [
        { label: 'Player', value: isoScorer.name },
        { label: 'PPG', value: num(isoScorer.ppg) },
        { label: 'Share of team FGA', value: pct(isoScorer.shareOfTeamFga) },
      ],
    });
  }

  // ---- Crash the offensive glass ----
  if (gt(opp.orebPct, 0.30)) {
    out.push({
      id: 'crash-glass',
      headline: 'Crash the offensive glass',
      detail: `${opp.name} hits the offensive boards hard — ${pct(opp.orebPct)} OREB%. Expect multiple bodies crashing weak-side and second-chance putbacks if we don't lock up box-outs.`,
      priority: 3,
      evidence: [{ label: 'Opp OREB%', value: pct(opp.orebPct) }],
    });
  }

  // ---- Attack OUR turnover weakness ----
  // If UCI turns it over a lot, the opponent will pressure to force it.
  if (gt(uci.tovPct, 0.17) && gt(opp.oppForcedTovPct, 0.16)) {
    out.push({
      id: 'attack-our-tov',
      headline: 'Pressure us into turnovers',
      detail: `We turn it over on ${pct(uci.tovPct)} of possessions and ${opp.name}'s defense forces TOs at ${pct(opp.oppForcedTovPct)}. Expect ball pressure, trapping ball-screens, and gambling for steals to get out in transition.`,
      priority: 4,
      evidence: [
        { label: 'UCI TOV%', value: pct(uci.tovPct) },
        { label: 'Opp forced-TOV%', value: pct(opp.oppForcedTovPct) },
      ],
    });
  }

  // ---- Get to the line ----
  if (gt(opp.ftr, 0.34)) {
    out.push({
      id: 'draw-fouls',
      headline: 'Attack downhill to draw fouls',
      detail: `${opp.name} gets to the line often — ${pct(opp.ftr)} FT rate. Expect them to drive into our bigs and hunt early fouls.`,
      priority: 3,
      evidence: [{ label: 'Opp FT rate', value: pct(opp.ftr) }],
    });
  }

  // ---- Fallback: if nothing else fired, give a baseline read ----
  if (out.length === 0) {
    out.push({
      id: 'balanced-attack',
      headline: 'Balanced half-court attack',
      detail: `${opp.name} has no single dominant tendency in the data — expect a balanced half-court offense. Defend their primary actions and make role players beat us.`,
      priority: 2,
      evidence: [
        { label: 'Opp ORtg', value: num(opp.ortg) },
        { label: 'Opp eFG%', value: pct(opp.efgPct) },
      ],
    });
  }

  return out.sort((a, b) => b.priority - a.priority);
}

/**
 * Matchup risks — where a UCI weakness directly meets an opponent strength.
 * These are the "this could lose us the game" flags.
 */
export interface MatchupRisk {
  id: string;
  headline: string;
  detail: string;
  severity: 'high' | 'medium';
  evidence: Array<{ label: string; value: string }>;
}

export function buildMatchupRisks(data: MatchupData): MatchupRisk[] {
  const uci = data.subject;
  const opp = data.opponent;
  const out: MatchupRisk[] = [];

  // Variance risk: a high-volume, accurate three-point team can win on a hot
  // night regardless of how well we defend the line on average.
  if (gt(opp.threeRate, 0.45) && gt(opp.threePct, 0.35)) {
    // Higher severity if our perimeter defense is also soft.
    const softPerimeter = gt(uci.oppThreePctAllowed, 0.34);
    out.push({
      id: 'risk-three-variance',
      headline: 'Their three-point volume is a variance threat',
      detail: `${opp.name} takes ${pct(opp.threeRate)} of its shots from three at ${pct(opp.threePct)}${
        softPerimeter ? ` and we allow ${pct(uci.oppThreePctAllowed)} from deep` : ''
      }. A hot shooting night from this team can swing the game on its own.`,
      severity: softPerimeter ? 'high' : 'medium',
      evidence: [
        { label: 'Opp 3PT rate', value: pct(opp.threeRate) },
        { label: 'Opp 3PT%', value: pct(opp.threePct) },
        ...(uci.oppThreePctAllowed !== null
          ? [{ label: 'UCI 3PT% allowed', value: pct(uci.oppThreePctAllowed) }]
          : []),
      ],
    });
  }

  // UCI gives up the rim + opponent attacks the rim.
  if (gt(uci.oppRimFgPct, 0.58) && gt(opp.rimRate, 0.40)) {
    out.push({
      id: 'risk-rim-defense',
      headline: 'Our rim protection vs their paint attack',
      detail: `We allow ${pct(uci.oppRimFgPct)} at the rim and ${opp.name} takes ${pct(opp.rimRate)} of its shots there. If our help is late, they live in the paint.`,
      severity: 'high',
      evidence: [
        { label: 'UCI rim FG% allowed', value: pct(uci.oppRimFgPct) },
        { label: 'Opp rim rate', value: pct(opp.rimRate) },
      ],
    });
  }

  // UCI turns it over + opponent forces turnovers.
  if (gt(uci.tovPct, 0.17) && gt(opp.oppForcedTovPct, 0.17)) {
    out.push({
      id: 'risk-turnovers',
      headline: 'Our ball security vs their pressure',
      detail: `We turn it over on ${pct(uci.tovPct)} of possessions and ${opp.name} forces TOs at ${pct(opp.oppForcedTovPct)}. Live-ball turnovers become their transition offense.`,
      severity: 'medium',
      evidence: [
        { label: 'UCI TOV%', value: pct(uci.tovPct) },
        { label: 'Opp forced-TOV%', value: pct(opp.oppForcedTovPct) },
      ],
    });
  }

  // Opponent crashes the glass + UCI is a poor defensive rebounding team.
  if (gt(opp.orebPct, 0.30) && gt(uci.oppOrebAllowed, 0.30)) {
    out.push({
      id: 'risk-oreb',
      headline: 'Our box-outs vs their offensive rebounding',
      detail: `${opp.name} grabs ${pct(opp.orebPct)} of its misses and we allow ${pct(uci.oppOrebAllowed)} OREB%. Second-chance points are a real threat.`,
      severity: 'medium',
      evidence: [
        { label: 'Opp OREB%', value: pct(opp.orebPct) },
        { label: 'UCI OREB% allowed', value: pct(uci.oppOrebAllowed) },
      ],
    });
  }

  return out.sort((a, b) => (a.severity === 'high' ? -1 : 1) - (b.severity === 'high' ? -1 : 1));
}
