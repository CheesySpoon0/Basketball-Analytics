'use client';

import React from 'react';
import type { FiredRule } from '../lib/tactical-engine/types';
import { formatEvidenceLines } from '../lib/tactical-engine/format-evidence';

type TeamStats = {
  games: number | null;
  fieldGoalsMade: number | null;
  fieldGoalsAttempted: number | null;
  threePointsMade: number | null;
  threePointsAttempted: number | null;
  freeThrowsAttempted: number | null;
  offensiveRebounds: number | null;
  defensiveRebounds: number | null;
  turnoversTotal: number | null;
  pointsTotal: number | null;
  oppFieldGoalsMade: number | null;
  oppFieldGoalsAttempted: number | null;
  oppThreePointsMade: number | null;
  oppThreePointsAttempted: number | null;
  oppFreeThrowsAttempted: number | null;
  oppOffensiveRebounds: number | null;
  oppDefensiveRebounds: number | null;
  oppTurnovers: number | null;
  oppPoints: number | null;
  oppPossessions: number | null;
};

type Zone = 'rim' | 'mid' | 'three';
type ZoneAgg = { att: number; made: number };

type UciMatchupProps = {
  uciStats: TeamStats | null;
  opponentStats: TeamStats | null;
  uciZones: Record<Zone, ZoneAgg>;
  opponentZones: Record<Zone, ZoneAgg>;
  opponentTeamName: string;
  /** Pre-computed by the page (server-side) — attack-side rules (offensive + style). */
  attackRules: FiredRule[];
  /** Defend-side rules (defensive + per-player). */
  defendRules: FiredRule[];
};

function fmtPct(p: number | null, digits = 1): string {
  return p === null ? '—' : `${(p * 100).toFixed(digits)}%`;
}

function StatComparison({
  label,
  uciValue,
  oppValue,
  uciLabel = 'UCI',
  oppLabel,
  higherIsBetter = true,
  format = fmtPct,
}: {
  label: string;
  uciValue: number | null;
  oppValue: number | null;
  uciLabel?: string;
  oppLabel: string;
  higherIsBetter?: boolean;
  format?: (n: number | null) => string;
}) {
  const uciAdvantage =
    uciValue === null || oppValue === null
      ? null
      : higherIsBetter
      ? uciValue > oppValue
      : uciValue < oppValue;

  const diff =
    uciValue !== null && oppValue !== null ? Math.abs(uciValue - oppValue) : null;

  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-surface-2 transition-colors">
      <td className="py-3 px-4 font-medium text-text">{label}</td>
      <td className="py-3 px-4 mono tabular-nums text-right">
        <span className={uciAdvantage === true ? 'text-made' : uciAdvantage === false ? 'text-missed' : ''}>
          {format(uciValue)}
        </span>
      </td>
      <td className="py-3 px-4 mono tabular-nums text-right">
        <span className={uciAdvantage === false ? 'text-made' : uciAdvantage === true ? 'text-missed' : ''}>
          {format(oppValue)}
        </span>
      </td>
      <td className="py-3 px-4 text-center text-text-dim">
        {uciAdvantage === null ? (
          '—'
        ) : (
          <span className={`mono text-xs ${diff && diff > 0.05 ? 'text-text' : 'text-text-dim'}`}>
            {uciAdvantage ? `${uciLabel} +${format(diff)}` : `${oppLabel} +${format(diff)}`}
          </span>
        )}
      </td>
    </tr>
  );
}

function PriorityPill({ priority }: { priority: number }) {
  return (
    <span className="mono text-[9px] uppercase tracking-widest text-text-dim border border-border px-1.5 py-0.5 tabular-nums shrink-0">
      P{priority}
    </span>
  );
}

function FiredRuleCard({ rule, kind }: { rule: FiredRule; kind: 'attack' | 'defend' }) {
  const accent = kind === 'attack' ? 'border-made' : 'border-missed';
  const title = kind === 'attack' ? 'text-made' : 'text-missed';
  const subjectTag =
    rule.playerName !== undefined
      ? rule.playerName
      : rule.category === 'style'
      ? 'STYLE'
      : rule.category.toUpperCase();
  return (
    <div className={`p-3 bg-surface-2 border-l-2 ${accent}`}>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <div className={`font-medium ${title} text-sm`}>{rule.title}</div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="mono text-[10px] uppercase tracking-widest text-text-dim">
            {subjectTag}
          </span>
          <PriorityPill priority={rule.priority} />
        </div>
      </div>
      <div className="text-xs text-text leading-relaxed">{rule.recommendation}</div>
      {formatEvidenceLines(rule.evidence).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {formatEvidenceLines(rule.evidence).map((line) => (
            <span key={line} className="mono text-[10px] tabular-nums text-text-dim">
              {line}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function UciMatchup({
  uciStats,
  opponentStats,
  uciZones,
  opponentZones,
  opponentTeamName,
  attackRules,
  defendRules,
}: UciMatchupProps) {
  if (!uciStats || !opponentStats) {
    return (
      <div className="bg-surface border border-border p-6">
        <div className="text-text-dim text-sm">
          Matchup analysis not available — missing team statistics.
        </div>
      </div>
    );
  }

  // -------- Compact recompute for the Four Factors + Style tables --------
  const uciFga = uciStats.fieldGoalsAttempted ?? 0;
  const uciFgm = uciStats.fieldGoalsMade ?? 0;
  const uciTpm = uciStats.threePointsMade ?? 0;
  const uciFta = uciStats.freeThrowsAttempted ?? 0;
  const uciOreb = uciStats.offensiveRebounds ?? 0;
  const uciTo = uciStats.turnoversTotal ?? 0;
  const uciGames = uciStats.games ?? 0;

  const oppFga = opponentStats.fieldGoalsAttempted ?? 0;
  const oppFgm = opponentStats.fieldGoalsMade ?? 0;
  const oppTpm = opponentStats.threePointsMade ?? 0;
  const oppFta = opponentStats.freeThrowsAttempted ?? 0;
  const oppOreb = opponentStats.offensiveRebounds ?? 0;
  const oppTo = opponentStats.turnoversTotal ?? 0;
  const oppGames = opponentStats.games ?? 0;

  const uciEfg = uciFga > 0 ? (uciFgm + 0.5 * uciTpm) / uciFga : null;
  const oppEfg = oppFga > 0 ? (oppFgm + 0.5 * oppTpm) / oppFga : null;

  const uciPoss = uciFga + 0.44 * uciFta - uciOreb + uciTo;
  const oppPoss = oppFga + 0.44 * oppFta - oppOreb + oppTo;
  const uciTovPct = uciPoss > 0 ? uciTo / uciPoss : null;
  const oppTovPct = oppPoss > 0 ? oppTo / oppPoss : null;
  const uciFtr = uciFga > 0 ? uciFta / uciFga : null;
  const oppFtr = oppFga > 0 ? oppFta / oppFga : null;
  const uciPace = uciGames > 0 ? uciPoss / uciGames : null;
  const oppPace = oppGames > 0 ? oppPoss / oppGames : null;

  // Fourth factor — OREB%. Formula validated earlier: own OREB / (own OREB + opp DREB)
  const uciOppDreb = uciStats.oppDefensiveRebounds ?? 0;
  const oppOppDreb = opponentStats.oppDefensiveRebounds ?? 0;
  const uciOrebPct = uciOreb + uciOppDreb > 0 ? uciOreb / (uciOreb + uciOppDreb) : null;
  const oppOrebPct = oppOreb + oppOppDreb > 0 ? oppOreb / (oppOreb + oppOppDreb) : null;

  const uciTpaRate = uciFga > 0 ? (uciStats.threePointsAttempted ?? 0) / uciFga : null;
  const oppTpaRate = oppFga > 0 ? (opponentStats.threePointsAttempted ?? 0) / oppFga : null;
  const uciRimRate = uciFga > 0 ? uciZones.rim.att / uciFga : null;
  const oppRimRate = oppFga > 0 ? opponentZones.rim.att / oppFga : null;

  return (
    <section className="mb-14">
      <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-border">
        <h2 className="display text-2xl font-medium">vs UC Irvine</h2>
        <span className="mono text-[11px] uppercase tracking-widest text-text-dim">
          Tactical Engine · {attackRules.length + defendRules.length} rules fired
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Four Factors */}
        <div className="bg-surface border border-border">
          <div className="border-b border-border px-4 py-3">
            <h3 className="display text-lg font-medium">Four Factors</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="stat-label py-2 px-4"></th>
                <th className="stat-label py-2 px-4 text-center">UCI</th>
                <th className="stat-label py-2 px-4 text-center">{opponentTeamName}</th>
                <th className="stat-label py-2 px-4 text-center">Edge</th>
              </tr>
            </thead>
            <tbody>
              <StatComparison label="eFG%" uciValue={uciEfg} oppValue={oppEfg} oppLabel={opponentTeamName} higherIsBetter={true} />
              <StatComparison label="TOV%" uciValue={uciTovPct} oppValue={oppTovPct} oppLabel={opponentTeamName} higherIsBetter={false} />
              <StatComparison label="OREB%" uciValue={uciOrebPct} oppValue={oppOrebPct} oppLabel={opponentTeamName} higherIsBetter={true} />
              <StatComparison label="FTR" uciValue={uciFtr} oppValue={oppFtr} oppLabel={opponentTeamName} higherIsBetter={true} />
            </tbody>
          </table>
        </div>

        {/* Style Indicators */}
        <div className="bg-surface border border-border">
          <div className="border-b border-border px-4 py-3">
            <h3 className="display text-lg font-medium">Style Indicators</h3>
          </div>
          <div className="p-4 space-y-3 text-sm">
            {uciPace !== null && oppPace !== null && (
              <div>
                <span className="font-medium">Pace: </span>
                <span className="mono tabular-nums">
                  {Math.abs(oppPace - uciPace) > 2
                    ? oppPace > uciPace
                      ? `${opponentTeamName} plays ${(oppPace - uciPace).toFixed(1)} possessions faster`
                      : `${opponentTeamName} plays ${(uciPace - oppPace).toFixed(1)} possessions slower`
                    : 'Similar pace'}
                </span>
              </div>
            )}
            {uciTpaRate !== null && oppTpaRate !== null && (
              <div>
                <span className="font-medium">3PT Reliance: </span>
                <span className="mono tabular-nums">
                  UCI {fmtPct(uciTpaRate)} vs {opponentTeamName} {fmtPct(oppTpaRate)}
                </span>
              </div>
            )}
            {uciRimRate !== null && oppRimRate !== null && (
              <div>
                <span className="font-medium">Rim Attack: </span>
                <span className="mono tabular-nums">
                  UCI {fmtPct(uciRimRate)} vs {opponentTeamName} {fmtPct(oppRimRate)}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Rule-driven recommendations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <div className="bg-surface border border-border">
          <div className="border-b border-border px-4 py-3 flex items-baseline justify-between">
            <h3 className="display text-lg font-medium">Where UCI Can Attack</h3>
            <span className="mono text-[10px] uppercase tracking-widest text-text-dim">
              {attackRules.length} fired
            </span>
          </div>
          <div className="p-4 space-y-3">
            {attackRules.length > 0 ? (
              attackRules.map((r) => <FiredRuleCard key={r.id} rule={r} kind="attack" />)
            ) : (
              <div className="text-text-dim text-sm">
                No offensive or style edges fired against current data — focus on base execution.
              </div>
            )}
          </div>
        </div>

        <div className="bg-surface border border-border">
          <div className="border-b border-border px-4 py-3 flex items-baseline justify-between">
            <h3 className="display text-lg font-medium">Defensive Priorities</h3>
            <span className="mono text-[10px] uppercase tracking-widest text-text-dim">
              {defendRules.length} fired
            </span>
          </div>
          <div className="p-4 space-y-3">
            {defendRules.length > 0 ? (
              defendRules.map((r) => <FiredRuleCard key={r.id} rule={r} kind="defend" />)
            ) : (
              <div className="text-text-dim text-sm">
                No standout defensive priorities fired — stick to base principles.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
