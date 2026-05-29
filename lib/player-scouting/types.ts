// ============================================================================
// Player scouting engine types.
//
// All output is deterministic. No AI involved at the engine layer — the LLM
// can later consume `notes` + `evidence` for prose generation but isn't required.
// ============================================================================

export type Zone = 'rim' | 'mid' | 'three';
export type ShotType = 'layup' | 'dunk' | 'jumper' | 'tip' | 'unknown';
export type ThreeSubzone = 'corner' | 'above_break';

// Archetype is now defined by the score-based classifier in archetype.ts.
export type { Archetype } from './archetype';

export type ScoutingPriority =
  | 'Must game-plan'
  | 'Key rotation threat'
  | 'Role player'
  | 'Low-usage spacer'
  | 'Limited sample';

export interface ZoneAgg {
  att: number;
  made: number;
  pct: number | null;
  share: number | null;
}

export interface ShotTypeAgg {
  att: number;
  made: number;
  pct: number | null;
  share: number | null;
}

export interface CreationAgg {
  /** total FGAs with shotAssisted populated (denominator for assisted/unassisted rates). */
  tracked: number;
  assisted: number;
  unassisted: number;
  /** rate over tracked. */
  assistedRate: number | null;
  unassistedRate: number | null;
  /** zone-specific. */
  assistedThree: number;
  threeTracked: number;
  assistedThreeRate: number | null;
  assistedRim: number;
  rimTracked: number;
  assistedRimRate: number | null;
  /** Of his jumpers (mid + three), how many were UNassisted? */
  unassistedJumper: number;
  jumperTracked: number;
  unassistedJumperRate: number | null;
}

export interface ContextAgg {
  /** Shots with <30s left in any period (proxy for end-of-quarter pressure). */
  endOfPeriodShots: number;
  endOfPeriodFga: number;
  endOfPeriodFgPct: number | null;
}

export interface PlayerNote {
  /** Stable id for dedup and analytics. */
  id: string;
  /** Headline shown as card title. */
  title: string;
  /** One-sentence coach-voice instruction. */
  detail: string;
  /** Highest priority surfaces first. */
  priority: 1 | 2 | 3 | 4 | 5;
  /** Defaults to "guarding"; "live_with"/"deny" route to dedicated UI sections. */
  bucket: 'guarding' | 'live_with' | 'deny';
  evidence: Array<{ label: string; value: string }>;
}

export interface PlayerScoutingReport {
  player: {
    id: number;
    name: string;
    position: string | null;
    jersey: string | null;
    height: number | null;
    weight: number | null;
    team: { id: number; school: string; abbreviation: string | null; primaryColor: string | null } | null;
  };
  season: number;
  rotation: { eligible: boolean; mpg: number | null; threshold: number; reason?: string };
  scoutingPriority: ScoutingPriority;
  role: {
    archetype: import('./archetype').Archetype;
    summary: string;
    /** Secondary traits from the archetype scorer. */
    secondary: import('./archetype').Archetype[];
  };

  /** Full deterministic tendency profile (shot diet, proxies, xeFG quality). */
  tendencies: import('./tendencies').TendencyProfile;
  /** Report trust level driven by sample size + coverage. */
  confidence: import('./confidence').ConfidenceResult;

  stats: {
    games: number;
    minutesPerGame: number | null;
    ppg: number;
    rpg: number;
    apg: number;
    spg: number;
    bpg: number;
    topg: number;
    fpg: number;
    fgPct: number | null;
    efgPct: number | null;
    threePct: number | null;
    ftPct: number | null;
    shareOfTeamFga: number | null;
    ftr: number | null;
    astToTov: number | null;
    threeAttempts: number;
    threePerGame: number | null;
  };

  /** rim / mid / three share + FG%. */
  zones: Record<Zone, ZoneAgg>;
  /** layup / dunk / jumper / tip share + FG%. */
  shotTypes: Record<ShotType, ShotTypeAgg>;
  /** Corner vs above-break threes (from coordinates). */
  threeSubzones: Record<ThreeSubzone, ZoneAgg>;

  creation: CreationAgg;
  context: ContextAgg;

  /** Observed defensive impact (real data only, no inferences). */
  observedDefenseProfile: import('./observed-defense').ObservedDefenseProfile | null;

  /** Top 2–4 prioritized notes, post dedup. */
  notes: PlayerNote[];
  /** Optional: "what to live with" cards (separate bucket). */
  liveWith: PlayerNote[];
  /** Optional: "what not to allow" cards. */
  deny: PlayerNote[];

  /** Total coordinate-bearing FGAs we found. */
  totalFga: number;
  /** Data caveats (rotation, small sample, missing fields). */
  caveats: string[];
}
