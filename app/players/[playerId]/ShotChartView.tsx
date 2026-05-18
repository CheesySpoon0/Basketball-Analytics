'use client';

import * as React from 'react';
import { Court, shotToSvgCoords, shotDistanceFt } from '../../../components/Court';

export type Shot = {
  id: string;
  x: number;
  y: number;
  made: boolean;
  range: string | null;
  scoreValue: number | null;
  gameId: number;
  gameDate: string;
};

function formatGameDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

function shotTitle(s: Shot): string {
  const dist = shotDistanceFt(s.x, s.y).toFixed(1);
  const rangeLabel = s.range === 'three_pointer' ? '3PT' : s.range === 'rim' ? 'Rim' : s.range === 'jumper' ? 'Mid' : s.range ?? '';
  const result = s.made ? 'MADE' : 'MISS';
  return `${rangeLabel} · ${dist} ft · ${result} · ${formatGameDate(s.gameDate)}`;
}

export function ShotChartView({ shots }: { shots: Shot[] }) {
  const [hoverId, setHoverId] = React.useState<string | null>(null);
  const hovered = shots.find((s) => s.id === hoverId);

  return (
    <div className="relative bg-surface border border-border">
      <Court className="w-full h-auto block">
        {shots.map((s) => {
          const { svgX, svgY } = shotToSvgCoords(s.x, s.y);
          const isHover = s.id === hoverId;
          const color = s.made ? 'var(--made)' : 'var(--missed)';
          return (
            <g key={s.id}>
              <circle
                cx={svgX}
                cy={svgY}
                r={isHover ? 6.5 : 5}
                fill={color}
                fillOpacity={isHover ? 1 : 0.8}
                stroke={color}
                strokeWidth={1}
                strokeOpacity={0.4}
                onMouseEnter={() => setHoverId(s.id)}
                onMouseLeave={() => setHoverId((cur) => (cur === s.id ? null : cur))}
                style={{ cursor: 'pointer', transition: 'r 120ms ease' }}
              >
                <title>{shotTitle(s)}</title>
              </circle>
            </g>
          );
        })}
      </Court>

      {/* Hover readout (top-right of chart) */}
      {hovered && (
        <div className="absolute top-3 right-3 bg-bg/95 border border-border px-3 py-2 mono text-[11px] tabular-nums leading-relaxed pointer-events-none">
          <div className="flex items-center gap-2">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: hovered.made ? 'var(--made)' : 'var(--missed)' }}
            />
            <span className={hovered.made ? 'text-[var(--made)]' : 'text-[var(--missed)]'}>
              {hovered.made ? 'MADE' : 'MISS'}
            </span>
            <span className="text-text-dim">·</span>
            <span>{shotDistanceFt(hovered.x, hovered.y).toFixed(1)} ft</span>
          </div>
          <div className="text-text-dim mt-1">
            {hovered.range === 'three_pointer' ? '3-Point' : hovered.range === 'rim' ? 'At Rim' : 'Mid-Range'} · {formatGameDate(hovered.gameDate)}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-3 left-4 flex items-center gap-4 mono text-[10px] uppercase tracking-widest text-text-dim">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--made)]" />
          <span>Made</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--missed)]" />
          <span>Missed</span>
        </div>
      </div>
    </div>
  );
}
