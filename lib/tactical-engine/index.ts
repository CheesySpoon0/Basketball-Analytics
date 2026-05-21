export * from './types';
export * from './engine';
export { buildMatchupData } from './build-matchup';
export { formatEvidenceLines, PROXY_RULE_IDS } from './format-evidence';
export {
  buildOpponentAttackPlan,
  buildMatchupRisks,
  type AttackPrediction,
  type MatchupRisk,
} from './opponent-attack';
