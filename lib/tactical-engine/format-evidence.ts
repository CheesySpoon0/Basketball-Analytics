// Human-readable evidence lines for coach-facing UI and brief grounding.
import type { Evidence } from './types';

const LABELS: Record<string, string> = {
  opp_3PA_rate: '3PA rate',
  opp_3PT_pct: '3PT%',
  opp_OREB_pct: 'OREB%',
  opp_pace: 'Pace',
  subject_pace: 'Our pace',
  pace_gap: 'Pace gap',
  opp_TOV_pct: 'TOV%',
  opp_FTR: 'FTR',
  opp_rim_fg_pct_allowed: 'Rim FG% allowed',
  opp_rim_fga_allowed: 'Rim att. allowed',
  opp_rim_rate_allowed: 'Rim rate allowed',
  opp_mid_rate_allowed: 'Mid rate allowed',
  opp_3PT_pct_allowed: '3PT% allowed',
  opp_3PA_allowed: '3PA allowed',
  opp_3PA_rate_allowed: '3PA rate allowed',
  subject_3PT_pct: 'Our 3PT%',
  opp_forced_TOV: 'Forced TOV%',
  opp_OREB_allowed: 'OREB% allowed',
  opp_FTR_allowed: 'FTR allowed',
  opp_eFG_allowed: 'eFG% allowed',
  player_name: 'Player',
  player_share_of_FGA: 'Share of team FGA',
  player_eFG: 'eFG',
  player_PPG: 'PPG',
  three_pct: '3PT%',
  three_attempts: '3PA',
  three_per_game: '3PA/g',
  rim_rate: 'Rim rate',
  position: 'Pos',
  opp_rim_rate: 'Rim rate',
  opp_mid_rate: 'Mid rate',
};

function formatValue(key: string, v: number | string): string {
  if (typeof v === 'string') return v;
  if (key.includes('pace') || key.includes('PPG') || key === 'pace_gap') return v.toFixed(1);
  if (key.includes('fga') || key.includes('attempts') || key.includes('FGA') && !key.includes('pct') && !key.includes('rate'))
    return String(Math.round(v));
  if (Math.abs(v) <= 1.5 && !key.includes('pace')) return `${(v * 100).toFixed(1)}%`;
  return v.toFixed(1);
}

/** One-line stat chips for display under a fired rule card. */
export function formatEvidenceLines(evidence: Evidence, max = 4): string[] {
  const lines: string[] = [];
  for (const [key, val] of Object.entries(evidence)) {
    if (val === null || val === undefined) continue;
    const label = LABELS[key] ?? key.replace(/_/g, ' ');
    lines.push(`${label}: ${formatValue(key, val)}`);
    if (lines.length >= max) break;
  }
  return lines;
}

/** Rules whose evidence uses a proxy stat — coach brief must not call it "usage". */
export const PROXY_RULE_IDS = new Set(['dominant-volume-scorer']);
