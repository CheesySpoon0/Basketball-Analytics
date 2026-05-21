// ============================================================================
// engine.ts — the rule runner.
//
// Evaluates every team-level rule against MatchupData and every player rule
// against each top opponent player. Returns fired rules sorted by priority.
//
// Rule conditions and evidence functions are wrapped in try/catch so a single
// throwing rule never breaks the entire pipeline.
// ============================================================================
import type {
  FiredRule,
  MatchupData,
  PlayerTacticalRule,
  TacticalRule,
} from './types';
import { defensiveRules } from './rules/defensive';
import { offensiveRules } from './rules/offensive';
import { styleRules } from './rules/style';
import { playerMatchupRules } from './rules/player-matchups';

export const ALL_TEAM_RULES: TacticalRule[] = [
  ...defensiveRules,
  ...offensiveRules,
  ...styleRules,
];

export const ALL_PLAYER_RULES: PlayerTacticalRule[] = playerMatchupRules;

export type EngineOptions = {
  /** Max fired rules returned. Default 8. Pass Infinity to disable. */
  maxResults?: number;
};

function runTeamRules(rules: TacticalRule[], data: MatchupData): FiredRule[] {
  const out: FiredRule[] = [];
  for (const rule of rules) {
    try {
      if (!rule.condition(data)) continue;
      out.push({
        id: rule.id,
        category: rule.category,
        title: rule.title,
        priority: rule.priority,
        recommendation: rule.recommendation(data),
        evidence: rule.evidence(data),
      });
    } catch (err) {
      // Bad data shouldn't break the engine. Surface for debugging.
      console.error(`[tactical-engine] rule '${rule.id}' threw:`, err);
    }
  }
  return out;
}

function runPlayerRules(rules: PlayerTacticalRule[], data: MatchupData): FiredRule[] {
  const out: FiredRule[] = [];
  for (const rule of rules) {
    for (const player of data.opponentTopPlayers) {
      try {
        if (!rule.condition(player, data)) continue;
        out.push({
          id: `${rule.id}::${player.playerId}`,
          category: rule.category,
          title: rule.title,
          priority: rule.priority,
          recommendation: rule.recommendation(player, data),
          evidence: rule.evidence(player, data),
          playerName: player.name,
        });
      } catch (err) {
        console.error(`[tactical-engine] player rule '${rule.id}' threw on ${player.name}:`, err);
      }
    }
  }
  return out;
}

/** Drop overlapping cards so coaches don't read the same idea twice. */
function suppressRedundant(fired: FiredRule[]): FiredRule[] {
  const baseIds = new Set(fired.map((f) => f.id.split('::')[0]));
  const dominantPlayers = new Set(
    fired
      .filter((f) => f.id.startsWith('dominant-volume-scorer::'))
      .map((f) => f.playerName)
      .filter(Boolean),
  );

  return fired.filter((f) => {
    const base = f.id.split('::')[0];
    // Rim: catastrophic finishing rule covers paint attack; skip the softer variant.
    if (baseIds.has('pressure-the-rim') && base === 'concedes-the-paint') return false;
    // Player: go-to scorer rule supersedes generic shooter lock for same guy.
    if (base === 'high-volume-shooter' && f.playerName && dominantPlayers.has(f.playerName))
      return false;
    return true;
  });
}

/**
 * Run every rule against `data`, return fired rules sorted by priority desc
 * (with a deterministic tie-break: defensive → offensive → player → style).
 */
export function runTacticalEngine(data: MatchupData, opts: EngineOptions = {}): FiredRule[] {
  const maxResults = opts.maxResults ?? 8;
  const all = suppressRedundant([
    ...runTeamRules(ALL_TEAM_RULES, data),
    ...runPlayerRules(ALL_PLAYER_RULES, data),
  ]);

  const categoryOrder: Record<FiredRule['category'], number> = {
    defensive: 0,
    offensive: 1,
    player: 2,
    style: 3,
  };

  all.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return categoryOrder[a.category] - categoryOrder[b.category];
  });

  if (Number.isFinite(maxResults)) return all.slice(0, maxResults);
  return all;
}

/** Helper: split fired rules into "attack" (offensive + style) and "defend" (defensive + player). */
export function partitionFiredRules(fired: FiredRule[]): {
  attack: FiredRule[];
  defend: FiredRule[];
} {
  const attack: FiredRule[] = [];
  const defend: FiredRule[] = [];
  for (const r of fired) {
    if (r.category === 'offensive' || r.category === 'style') attack.push(r);
    else defend.push(r);
  }
  return { attack, defend };
}
