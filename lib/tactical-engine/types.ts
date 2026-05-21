// ============================================================================
// Tactical engine types
//
// MatchupData is the contract every rule sees. All numeric fields are
// nullable — a rule must guard against missing data, never silently fail.
//
// Generic design: `subject` is the team being scouted FOR (the team whose
// coach we're writing the brief for), `opponent` is the next opponent.
// The engine has no UCI-specific knowledge; UCI is wired in by the UI layer
// (the team page) and the coach-brief API route. The same engine can run
// Duke vs UNC or any other D1 matchup once those teams are ingested.
// ============================================================================

export type RuleCategory = 'defensive' | 'offensive' | 'player' | 'style';

export type RulePriority = 1 | 2 | 3 | 4 | 5;

export type Evidence = Record<string, number | string | null>;

export interface TeamProfile {
  teamId: number;
  name: string;
  record: string;

  // Pace & efficiency
  pace: number | null;
  ortg: number | null;
  drtg: number | null;

  // Offensive four factors
  efgPct: number | null;
  tovPct: number | null;
  orebPct: number | null;
  ftr: number | null;

  // Shot mix (share of own FGA)
  rimRate: number | null;
  midRate: number | null;
  threeRate: number | null;

  // Shooting by zone
  rimPct: number | null;
  midPct: number | null;
  threePct: number | null;
  threePerGame: number | null;

  // Defensive aggregates (from box score)
  oppEfgAllowed: number | null;
  oppFtrAllowed: number | null;
  oppOrebAllowed: number | null;       // opponents' OREB% against this team
  oppForcedTovPct: number | null;      // how often this team's defense forces a TO

  // ==========================================================================
  // True defensive shot-zone allowed (derived from Play rows where teamId ≠
  // this team, in games involving this team). Counts come from coordinate-
  // bearing shot plays only (free throws excluded). Threes from
  // shotRange='three_pointer'; rim vs mid from shotRange + distance fallback.
  // Each is null if the opponent shot sample is too small to be meaningful
  // (see MIN_OPP_ZONE_SAMPLE in build-matchup.ts).
  // ==========================================================================
  oppRimFga: number | null;
  oppRimFgm: number | null;
  oppRimFgPct: number | null;
  oppMidFga: number | null;
  oppMidFgm: number | null;
  oppMidFgPct: number | null;
  oppThreePaAllowed: number | null;
  oppThreePmAllowed: number | null;
  oppThreePctAllowed: number | null;
  oppRimRateAllowed: number | null;
  oppMidRateAllowed: number | null;
  oppThreeRateAllowed: number | null;
  /** Total opponent FGAs we found in plays (rim + mid + three). Useful for sample-size gating. */
  oppFgaTracked: number | null;
}

export interface PlayerProfile {
  playerId: number;
  name: string;
  position: string | null;
  jersey: string | null;
  gamesPlayed: number;
  // Per-game scoring
  ppg: number;
  rpg: number;
  apg: number;
  // Shooting splits
  fgPct: number | null;
  efgPct: number | null;
  threePct: number | null;
  threePerGame: number | null;
  threeAttempts: number;
  rimPct: number | null;
  // Shot mix
  rimRate: number | null;     // share of this player's FGA at the rim
  threeRate: number | null;
  // Usage proxy: share of team FGAs (TRUE usage requires possession data we don't have yet)
  shareOfTeamFga: number | null;
}

export interface MatchupData {
  /** The team being scouted FOR. In the current UI this is UCI. */
  subject: TeamProfile;
  /** The team being scouted AGAINST. */
  opponent: TeamProfile;
  /** Opponent's top scorers, used by per-player rules. */
  opponentTopPlayers: PlayerProfile[];
  /** Season being analyzed. */
  season: number;
}

export interface TacticalRule {
  id: string;
  category: RuleCategory;
  title: string;
  priority: RulePriority;
  condition: (data: MatchupData) => boolean;
  recommendation: (data: MatchupData) => string;
  evidence: (data: MatchupData) => Evidence;
}

// Per-player rules iterate over opponentTopPlayers and emit one fired rule
// per player that matches.
export interface PlayerTacticalRule {
  id: string;
  category: 'player';
  title: string;
  priority: RulePriority;
  condition: (player: PlayerProfile, data: MatchupData) => boolean;
  recommendation: (player: PlayerProfile, data: MatchupData) => string;
  evidence: (player: PlayerProfile, data: MatchupData) => Evidence;
}

export interface FiredRule {
  id: string;
  category: RuleCategory;
  title: string;
  priority: RulePriority;
  recommendation: string;
  evidence: Evidence;
  /** For player rules, the player this fired for. */
  playerName?: string;
}

// Helpers for null-safe comparison inside rule conditions
export function gt(x: number | null, threshold: number): boolean {
  return x !== null && x > threshold;
}
export function lt(x: number | null, threshold: number): boolean {
  return x !== null && x < threshold;
}
export function pctStr(x: number | null, digits = 1): string {
  return x === null ? 'N/A' : `${(x * 100).toFixed(digits)}%`;
}
export function num(x: number | null, digits = 1): string {
  return x === null ? 'N/A' : x.toFixed(digits);
}
