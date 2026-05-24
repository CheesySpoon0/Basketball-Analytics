'use client';

import Link from 'next/link';
import { useState } from 'react';

interface LineupData {
  lineupHash: string | null;
  playerIds: string | null;
  playerNames: string[];
  minutes: number;
  games: number;
  possessionsFor: number;
  possessionsAgainst: number;
  pppFor: number;
  pppAgainst: number;
  netPpp: number;
  expectedPppFor?: number;
  expectedPppAgainst?: number;
  expectedNetPpp?: number;
  confidence: 'full' | 'partial' | 'gap';
}

type SortField = 'minutes' | 'games' | 'possessions' | 'ortg' | 'drtg' | 'net' | 'xortg' | 'xdrtg' | 'xnet';
type SortDirection = 'asc' | 'desc';

interface LineupTableProps {
  lineups: LineupData[];
  season: number;
}

const TOOLTIP_STYLES = "absolute z-50 bg-gray-900 text-white text-xs p-2 rounded shadow-lg border border-gray-700 max-w-xs whitespace-normal pointer-events-none hidden md:block";

const STAT_EXPLANATIONS = {
  min: "Total minutes this 5-man lineup played together on the court",
  games: "Number of different games this lineup appeared in",
  poss: "Estimated total possessions played by this lineup (offensive + defensive)",
  ortg: "Points scored per 100 possessions while this lineup was on the floor",
  drtg: "Points allowed per 100 possessions while this lineup was on the floor (lower is better)",
  net: "Net rating: ORTG minus DRTG (higher is better)",
  xortg: "Expected offensive rating from shot quality using the xeFG model",
  xdrtg: "Expected defensive rating from opponent shot quality (lower is better)",
  xnet: "Expected net rating from shot quality (xORTG - xDRTG)",
  conf: "Confidence level: tracking quality based on substitution completeness"
};

export function LineupTable({ lineups, season }: LineupTableProps) {
  const [sortField, setSortField] = useState<SortField>('minutes');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [hoveredStat, setHoveredStat] = useState<string | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      // Default sort directions for each field
      const defaultDesc = ['minutes', 'games', 'possessions', 'ortg', 'net', 'xortg', 'xnet'];
      setSortDirection(defaultDesc.includes(field) ? 'desc' : 'asc');
    }
  };

  const handleMouseEnter = (stat: string, event: React.MouseEvent) => {
    setHoveredStat(stat);
    setMousePosition({ x: event.clientX, y: event.clientY });
  };

  const handleMouseMove = (event: React.MouseEvent) => {
    setMousePosition({ x: event.clientX, y: event.clientY });
  };

  const getSortedLineups = () => {
    return [...lineups].sort((a, b) => {
      let aVal: number, bVal: number;

      switch (sortField) {
        case 'minutes':
          aVal = a.minutes;
          bVal = b.minutes;
          break;
        case 'games':
          aVal = a.games;
          bVal = b.games;
          break;
        case 'possessions':
          aVal = a.possessionsFor + a.possessionsAgainst;
          bVal = b.possessionsFor + b.possessionsAgainst;
          break;
        case 'ortg':
          aVal = a.pppFor * 100;
          bVal = b.pppFor * 100;
          break;
        case 'drtg':
          aVal = a.pppAgainst * 100;
          bVal = b.pppAgainst * 100;
          break;
        case 'net':
          aVal = a.netPpp * 100;
          bVal = b.netPpp * 100;
          break;
        case 'xortg':
          aVal = a.expectedPppFor ? a.expectedPppFor * 100 : -999;
          bVal = b.expectedPppFor ? b.expectedPppFor * 100 : -999;
          break;
        case 'xdrtg':
          aVal = a.expectedPppAgainst ? a.expectedPppAgainst * 100 : 999;
          bVal = b.expectedPppAgainst ? b.expectedPppAgainst * 100 : 999;
          break;
        case 'xnet':
          aVal = a.expectedNetPpp !== undefined ? a.expectedNetPpp * 100 : -999;
          bVal = b.expectedNetPpp !== undefined ? b.expectedNetPpp * 100 : -999;
          break;
        default:
          aVal = 0;
          bVal = 0;
      }

      return sortDirection === 'desc' ? bVal - aVal : aVal - bVal;
    });
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) return null;
    return (
      <span className="ml-1 text-accent">
        {sortDirection === 'desc' ? '↓' : '↑'}
      </span>
    );
  };

  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case 'full': return 'bg-green-500';
      case 'partial': return 'bg-amber-400';
      case 'gap': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getConfidenceLabel = (confidence: string) => {
    switch (confidence) {
      case 'full': return 'High';
      case 'partial': return 'Medium';
      case 'gap': return 'Low';
      default: return 'Unknown';
    }
  };

  const sortedLineups = getSortedLineups();

  return (
    <>
      <div className="bg-surface border border-border overflow-hidden rounded-lg">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-surface-2">
                <th className="px-6 py-4 text-left text-sm font-medium text-text uppercase tracking-wider min-w-[300px]">
                  Lineup
                </th>
                <th
                  className="px-4 py-4 text-right text-sm font-medium text-text uppercase tracking-wider cursor-pointer hover:bg-surface-3 transition-colors"
                  onClick={() => handleSort('minutes')}
                  onMouseEnter={(e) => handleMouseEnter('min', e)}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={() => setHoveredStat(null)}
                >
                  MIN{renderSortIcon('minutes')}
                </th>
                <th
                  className="px-4 py-4 text-right text-sm font-medium text-text uppercase tracking-wider cursor-pointer hover:bg-surface-3 transition-colors"
                  onClick={() => handleSort('games')}
                  onMouseEnter={(e) => handleMouseEnter('games', e)}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={() => setHoveredStat(null)}
                >
                  G{renderSortIcon('games')}
                </th>
                <th
                  className="px-4 py-4 text-right text-sm font-medium text-text uppercase tracking-wider cursor-pointer hover:bg-surface-3 transition-colors"
                  onClick={() => handleSort('possessions')}
                  onMouseEnter={(e) => handleMouseEnter('poss', e)}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={() => setHoveredStat(null)}
                >
                  POSS{renderSortIcon('possessions')}
                </th>
                <th
                  className="px-4 py-4 text-right text-sm font-medium text-text uppercase tracking-wider cursor-pointer hover:bg-surface-3 transition-colors"
                  onClick={() => handleSort('ortg')}
                  onMouseEnter={(e) => handleMouseEnter('ortg', e)}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={() => setHoveredStat(null)}
                >
                  ORTG{renderSortIcon('ortg')}
                </th>
                <th
                  className="px-4 py-4 text-right text-sm font-medium text-text uppercase tracking-wider cursor-pointer hover:bg-surface-3 transition-colors"
                  onClick={() => handleSort('drtg')}
                  onMouseEnter={(e) => handleMouseEnter('drtg', e)}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={() => setHoveredStat(null)}
                >
                  DRTG{renderSortIcon('drtg')}
                </th>
                <th
                  className="px-4 py-4 text-right text-sm font-medium text-text uppercase tracking-wider cursor-pointer hover:bg-surface-3 transition-colors"
                  onClick={() => handleSort('net')}
                  onMouseEnter={(e) => handleMouseEnter('net', e)}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={() => setHoveredStat(null)}
                >
                  NET{renderSortIcon('net')}
                </th>
                <th
                  className="px-4 py-4 text-right text-sm font-medium text-text-dim uppercase tracking-wider cursor-pointer hover:bg-surface-3 transition-colors"
                  onClick={() => handleSort('xortg')}
                  onMouseEnter={(e) => handleMouseEnter('xortg', e)}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={() => setHoveredStat(null)}
                >
                  XORTG{renderSortIcon('xortg')}
                </th>
                <th
                  className="px-4 py-4 text-right text-sm font-medium text-text-dim uppercase tracking-wider cursor-pointer hover:bg-surface-3 transition-colors"
                  onClick={() => handleSort('xdrtg')}
                  onMouseEnter={(e) => handleMouseEnter('xdrtg', e)}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={() => setHoveredStat(null)}
                >
                  XDRTG{renderSortIcon('xdrtg')}
                </th>
                <th
                  className="px-4 py-4 text-right text-sm font-medium text-text-dim uppercase tracking-wider cursor-pointer hover:bg-surface-3 transition-colors"
                  onClick={() => handleSort('xnet')}
                  onMouseEnter={(e) => handleMouseEnter('xnet', e)}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={() => setHoveredStat(null)}
                >
                  XNET{renderSortIcon('xnet')}
                </th>
                <th
                  className="px-4 py-4 text-center text-sm font-medium text-text uppercase tracking-wider"
                  onMouseEnter={(e) => handleMouseEnter('conf', e)}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={() => setHoveredStat(null)}
                >
                  CONF
                </th>
              </tr>
            </thead>
            <tbody className="bg-surface divide-y divide-border">
              {sortedLineups.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-6 py-12 text-center text-text-dim">
                    <div className="space-y-2">
                      <div className="text-lg">No lineups found</div>
                      <div className="text-sm">
                        Try lowering the minimum possessions or including partial confidence stints.
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                sortedLineups.map((lineup, i) => (
                  <tr
                    key={lineup.lineupHash}
                    className="hover:bg-surface-2 transition-colors group cursor-pointer"
                  >
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        {lineup.playerNames.map((name, j) => (
                          <div key={j} className="text-sm text-text group-hover:text-accent transition-colors">
                            {name}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right text-sm font-mono font-medium text-text">
                      {Math.max(0, lineup.minutes)}
                    </td>
                    <td className="px-4 py-4 text-right text-sm font-mono text-text">
                      {lineup.games}
                    </td>
                    <td className="px-4 py-4 text-right text-sm font-mono text-text">
                      {lineup.possessionsFor + lineup.possessionsAgainst}
                    </td>
                    <td className="px-4 py-4 text-right text-sm font-mono font-medium text-text">
                      {(lineup.pppFor * 100).toFixed(1)}
                    </td>
                    <td className="px-4 py-4 text-right text-sm font-mono font-medium text-text">
                      {(lineup.pppAgainst * 100).toFixed(1)}
                    </td>
                    <td className="px-4 py-4 text-right text-sm font-mono font-bold">
                      <span className={lineup.netPpp >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {lineup.netPpp >= 0 ? '+' : ''}{(lineup.netPpp * 100).toFixed(1)}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right text-sm font-mono text-text-dim">
                      {lineup.expectedPppFor ? (lineup.expectedPppFor * 100).toFixed(1) : '—'}
                    </td>
                    <td className="px-4 py-4 text-right text-sm font-mono text-text-dim">
                      {lineup.expectedPppAgainst ? (lineup.expectedPppAgainst * 100).toFixed(1) : '—'}
                    </td>
                    <td className="px-4 py-4 text-right text-sm font-mono text-text-dim">
                      {lineup.expectedNetPpp !== undefined ? (
                        <span className={lineup.expectedNetPpp >= 0 ? 'text-green-400/70' : 'text-red-400/70'}>
                          {lineup.expectedNetPpp >= 0 ? '+' : ''}{(lineup.expectedNetPpp * 100).toFixed(1)}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-4 text-center">
                      <div className="flex items-center justify-center">
                        <div className={`w-3 h-3 rounded-full ${getConfidenceColor(lineup.confidence)} mr-2`} />
                        <span className="text-xs font-medium">{getConfidenceLabel(lineup.confidence)}</span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Methodology Note and Mobile Legend */}
      {sortedLineups.length > 0 && (
        <div className="mt-6 space-y-4">
          <div className="p-4 bg-surface-2/50 border border-border rounded-lg">
            <div className="text-sm text-text-dim leading-relaxed">
              <strong className="text-text">Methodology:</strong> Observed lineups are based on substitution-derived stints.
              ORTG/DRTG use actual scoring. XORTG/XDRTG use shot-quality estimates from the xeFG model.
              Small-sample lineups can be noisy.
            </div>
          </div>

          {/* Mobile-only stat explanations */}
          <div className="block md:hidden p-4 bg-surface-2/30 border border-border rounded-lg">
            <h4 className="text-sm font-medium text-text mb-3">Column Definitions:</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-text-dim">
              <div><strong className="text-text">MIN:</strong> Minutes played together</div>
              <div><strong className="text-text">G:</strong> Games this lineup appeared in</div>
              <div><strong className="text-text">POSS:</strong> Total possessions</div>
              <div><strong className="text-text">ORTG:</strong> Points scored per 100 poss</div>
              <div><strong className="text-text">DRTG:</strong> Points allowed per 100 poss</div>
              <div><strong className="text-text">NET:</strong> ORTG minus DRTG</div>
              <div><strong className="text-text">XORTG:</strong> Expected offensive rating</div>
              <div><strong className="text-text">XDRTG:</strong> Expected defensive rating</div>
              <div><strong className="text-text">XNET:</strong> Expected net rating</div>
              <div><strong className="text-text">CONF:</strong> Data confidence level</div>
            </div>
          </div>
        </div>
      )}

      {/* Tooltip */}
      {hoveredStat && STAT_EXPLANATIONS[hoveredStat as keyof typeof STAT_EXPLANATIONS] && (
        <div
          className={TOOLTIP_STYLES}
          style={{
            left: Math.min(mousePosition.x + 10, window.innerWidth - 250),
            top: mousePosition.y - 10
          }}
        >
          {STAT_EXPLANATIONS[hoveredStat as keyof typeof STAT_EXPLANATIONS]}
        </div>
      )}
    </>
  );
}