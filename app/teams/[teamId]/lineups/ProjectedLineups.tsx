'use client';

import { useState } from 'react';

interface Player {
  id: number;
  name: string;
  orapm?: number;
  drapm?: number;
  rapm?: number;
  confidence?: string;
  possessions?: number;
  minutes?: number;
}

interface ProjectedLineupsProps {
  players: Player[];
  teamId: number;
  teamBaseline: {
    ortg: number;
    drtg: number;
  };
}

export function ProjectedLineups({ players, teamId, teamBaseline }: ProjectedLineupsProps) {
  const [selectedPlayers, setSelectedPlayers] = useState<Player[]>([]);
  const [projectedStats, setProjectedStats] = useState<{
    projectedORtg: number;
    projectedDRtg: number;
    projectedNet: number;
    confidence: 'high' | 'moderate' | 'low';
  } | null>(null);

  const availablePlayers = players.filter(p => !selectedPlayers.find(sp => sp.id === p.id));

  const addPlayer = (player: Player) => {
    if (selectedPlayers.length < 5) {
      const newSelection = [...selectedPlayers, player];
      setSelectedPlayers(newSelection);

      if (newSelection.length === 5) {
        calculateProjection(newSelection);
      }
    }
  };

  const removePlayer = (playerId: number) => {
    const newSelection = selectedPlayers.filter(p => p.id !== playerId);
    setSelectedPlayers(newSelection);

    if (newSelection.length === 5) {
      calculateProjection(newSelection);
    } else {
      setProjectedStats(null);
    }
  };

  const calculateProjection = (lineup: Player[]) => {
    // Simple RAPM-based projection
    const totalORAMP = lineup.reduce((sum, p) => sum + (p.orapm || 0), 0);
    const totalDRAMP = lineup.reduce((sum, p) => sum + (p.drapm || 0), 0);

    // Use team's actual baseline performance
    const baselineORtg = teamBaseline.ortg;
    const baselineDRtg = teamBaseline.drtg;

    // Project based on RAPM impact
    const projectedORtg = baselineORtg + totalORAMP;
    const projectedDRtg = baselineDRtg - totalDRAMP; // Defensive RAPM reduces points allowed
    const projectedNet = projectedORtg - projectedDRtg;

    // Calculate confidence based on sample sizes
    const avgPossessions = lineup.reduce((sum, p) => sum + (p.possessions || 0), 0) / 5;
    const confidence: 'high' | 'moderate' | 'low' =
      avgPossessions >= 800 ? 'high' :
      avgPossessions >= 400 ? 'moderate' : 'low';

    setProjectedStats({
      projectedORtg,
      projectedDRtg,
      projectedNet,
      confidence
    });
  };

  return (
    <div className="space-y-6">
      {/* Player Selection */}
      <div>
        <h3 className="display text-xl font-medium mb-4">Select 5 Players</h3>

        {/* Selected Players */}
        <div className="mb-6">
          <div className="stat-label mb-2">Selected Lineup ({selectedPlayers.length}/5)</div>
          <div className="bg-surface border border-border p-4 min-h-[120px]">
            {selectedPlayers.length === 0 ? (
              <div className="text-text-dim text-center py-8">
                Select players from the roster below to build a projected lineup
              </div>
            ) : (
              <div className="space-y-2">
                {selectedPlayers.map((player, index) => (
                  <div key={player.id} className="flex items-center justify-between bg-surface-2 p-3 border border-border">
                    <div className="flex items-center gap-3">
                      <span className="mono text-sm text-text-dim w-4">{index + 1}.</span>
                      <span className="text-text">{player.name}</span>
                      {player.rapm !== undefined && (
                        <span className={`mono text-xs ${player.rapm >= 0 ? 'text-[var(--made)]' : 'text-[var(--missed)]'}`}>
                          {player.rapm >= 0 ? '+' : ''}{player.rapm.toFixed(1)} RAPM
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => removePlayer(player.id)}
                      className="text-text-dim hover:text-[var(--missed)] transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Available Players */}
        {availablePlayers.length > 0 && selectedPlayers.length < 5 && (
          <div>
            <div className="stat-label mb-2">Available Players</div>
            <div className="bg-surface border border-border max-h-64 overflow-y-auto">
              {availablePlayers
                .sort((a, b) => (b.rapm || 0) - (a.rapm || 0))
                .map(player => (
                  <button
                    key={player.id}
                    onClick={() => addPlayer(player)}
                    className="w-full flex items-center justify-between p-3 border-b border-border last:border-b-0 hover:bg-surface-2 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-text">{player.name}</span>
                      {player.rapm !== undefined && (
                        <span className={`mono text-xs ${player.rapm >= 0 ? 'text-[var(--made)]' : 'text-[var(--missed)]'}`}>
                          {player.rapm >= 0 ? '+' : ''}{player.rapm.toFixed(1)} Net
                        </span>
                      )}
                      {player.confidence && (
                        <span className={`text-xs px-2 py-1 rounded ${
                          player.confidence === 'high' ? 'bg-[var(--made)]/20 text-[var(--made)]' :
                          player.confidence === 'moderate' ? 'bg-amber-400/20 text-amber-400' :
                          'bg-[var(--missed)]/20 text-[var(--missed)]'
                        }`}>
                          {player.confidence}
                        </span>
                      )}
                    </div>
                    <span className="text-text-dim">+</span>
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Projected Stats */}
      {projectedStats && selectedPlayers.length === 5 && (
        <div>
          <h3 className="display text-xl font-medium mb-4">Projected Performance</h3>
          <div className="bg-surface border border-border p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <div className="text-center">
                <div className="stat-label mb-2">Projected ORtg</div>
                <div className="mono text-3xl tabular-nums">{projectedStats.projectedORtg.toFixed(1)}</div>
                <div className="text-text-dim text-xs mt-1">Points per 100 possessions</div>
              </div>
              <div className="text-center">
                <div className="stat-label mb-2">Projected DRtg</div>
                <div className="mono text-3xl tabular-nums">{projectedStats.projectedDRtg.toFixed(1)}</div>
                <div className="text-text-dim text-xs mt-1">Points allowed per 100</div>
              </div>
              <div className="text-center">
                <div className="stat-label mb-2">Projected Net</div>
                <div className={`mono text-3xl tabular-nums ${
                  projectedStats.projectedNet >= 0 ? 'text-[var(--made)]' : 'text-[var(--missed)]'
                }`}>
                  {projectedStats.projectedNet >= 0 ? '+' : ''}{projectedStats.projectedNet.toFixed(1)}
                </div>
                <div className="text-text-dim text-xs mt-1">Net rating</div>
              </div>
            </div>

            {/* RAPM Breakdown */}
            <div className="border border-border mb-4">
              <div className="p-4 border-b border-border bg-surface-2/30">
                <h4 className="text-sm font-medium mb-3">Individual RAPM Contributions</h4>
                <div className="space-y-2">
                  {selectedPlayers.map((player, index) => (
                    <div key={player.id} className="flex items-center justify-between text-sm">
                      <span className="text-text">{player.name}</span>
                      <div className="flex items-center gap-4 mono text-xs">
                        <span className="text-text-dim w-12 text-right">
                          O: <span className={`${(player.orapm || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {player.orapm ? (player.orapm >= 0 ? '+' : '') + player.orapm.toFixed(1) : '—'}
                          </span>
                        </span>
                        <span className="text-text-dim w-12 text-right">
                          D: <span className={`${(player.drapm || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {player.drapm ? (player.drapm >= 0 ? '+' : '') + player.drapm.toFixed(1) : '—'}
                          </span>
                        </span>
                        <span className="text-text w-12 text-right">
                          Net: <span className={`${(player.rapm || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {player.rapm ? (player.rapm >= 0 ? '+' : '') + player.rapm.toFixed(1) : '—'}
                          </span>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-sm">
                  <span className="text-text-dim font-medium">Lineup Totals:</span>
                  <div className="flex items-center gap-4 mono text-xs">
                    <span className="text-text-dim w-12 text-right">
                      O: <span className="text-text">{selectedPlayers.reduce((sum, p) => sum + (p.orapm || 0), 0).toFixed(1)}</span>
                    </span>
                    <span className="text-text-dim w-12 text-right">
                      D: <span className="text-text">{selectedPlayers.reduce((sum, p) => sum + (p.drapm || 0), 0).toFixed(1)}</span>
                    </span>
                    <span className="text-text w-12 text-right">
                      Net: <span className="text-text">{selectedPlayers.reduce((sum, p) => sum + (p.rapm || 0), 0).toFixed(1)}</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-surface-2/50 border border-border p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-dim">
                  Projection Confidence:
                  <span className={`ml-2 font-medium ${
                    projectedStats.confidence === 'high' ? 'text-[var(--made)]' :
                    projectedStats.confidence === 'moderate' ? 'text-amber-400' :
                    'text-[var(--missed)]'
                  }`}>
                    {projectedStats.confidence.toUpperCase()}
                  </span>
                </span>
                <span className="text-text-dim text-xs">
                  Based on RAPM estimates
                </span>
              </div>
            </div>

            <div className="mt-4 p-3 bg-surface-3/30 border border-border text-xs text-text-dim leading-relaxed">
              <strong className="text-text">Projection Method:</strong> Uses league baseline ({teamBaseline.ortg.toFixed(1)} ORtg, {teamBaseline.drtg.toFixed(1)} DRtg) plus selected players' RAPM impact, measured in points per 100 possessions.
              <strong className="text-text"> Lower confidence</strong> indicates limited sample sizes for RAPM estimates.
              These projections should be used as rough estimates, not precise predictions.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}