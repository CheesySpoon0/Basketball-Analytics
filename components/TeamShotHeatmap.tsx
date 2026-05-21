'use client';

import * as React from 'react';
import { Court, shotToSvgCoords, COURT_CONSTANTS } from './Court';

export type AggregateShot = {
  x: number;
  y: number;
  made: boolean;
  range: string | null;
  /** Model P(make) per shot — not eFG. Present when built via buildTeamHeatmapShots. */
  expectedFg?: number;
};

// ============================================================================
// Bin geometry
// ============================================================================

// Bin size in SVG units. FT_TO_SVG=10, so 30 = 3-ft cells.
const BIN_SIZE = 30;
const LABEL_MIN_ATT = 10;     // attempt count is drawn inside a bin only if >= this
const HIGH_VOL_PERCENTILE = 0.75; // bins above this percentile of att get an outline

type Zone = 'rim' | 'mid' | 'three';

type Bin = {
  ix: number;
  iy: number;
  cx: number;       // svg center x
  cy: number;       // svg center y
  att: number;
  made: number;
  sumExpectedFg: number;
  zone: Zone;
};

function binZone(
  cx: number,
  cy: number,
  threeCount: number,
  rimCount: number,
  midCount: number
): Zone {
  if (threeCount >= rimCount && threeCount >= midCount && threeCount > 0) return 'three';
  if (rimCount >= midCount && rimCount > 0) return 'rim';
  if (midCount > 0) return 'mid';
  const { BASKET_X, BASKET_Y, FT_TO_SVG } = COURT_CONSTANTS;
  const dx = cx - BASKET_X;
  const dy = cy - BASKET_Y;
  const dist = Math.sqrt(dx * dx + dy * dy) / FT_TO_SVG;
  if (dist < 4) return 'rim';
  if (dist > 22.1) return 'three';
  return 'mid';
}

function buildBins(shots: AggregateShot[]): Bin[] {
  const { VB_W, VB_H } = COURT_CONSTANTS;
  const cols = Math.ceil(VB_W / BIN_SIZE);
  const rows = Math.ceil(VB_H / BIN_SIZE);

  type Raw = {
    ix: number;
    iy: number;
    att: number;
    made: number;
    sumExpectedFg: number;
    rim: number;
    mid: number;
    three: number;
  };
  const index = new Map<number, Raw>();
  const order: Raw[] = [];

  for (const s of shots) {
    if (s.range === 'free_throw') continue;
    const { svgX, svgY } = shotToSvgCoords(s.x, s.y);
    if (svgX < 0 || svgX > VB_W || svgY < 0 || svgY > VB_H) continue;
    const ix = Math.min(cols - 1, Math.max(0, Math.floor(svgX / BIN_SIZE)));
    const iy = Math.min(rows - 1, Math.max(0, Math.floor(svgY / BIN_SIZE)));
    const key = iy * cols + ix;
    let bin = index.get(key);
    if (!bin) {
      bin = { ix, iy, att: 0, made: 0, sumExpectedFg: 0, rim: 0, mid: 0, three: 0 };
      index.set(key, bin);
      order.push(bin);
    }
    bin.att += 1;
    if (s.made) bin.made += 1;
    if (s.expectedFg !== undefined) bin.sumExpectedFg += s.expectedFg;
    if (s.range === 'three_pointer') bin.three += 1;
    else if (s.range === 'rim') bin.rim += 1;
    else bin.mid += 1;
  }

  return order.map((b) => {
    const cx = b.ix * BIN_SIZE + BIN_SIZE / 2;
    const cy = b.iy * BIN_SIZE + BIN_SIZE / 2;
    return {
      ix: b.ix,
      iy: b.iy,
      cx,
      cy,
      att: b.att,
      made: b.made,
      sumExpectedFg: b.sumExpectedFg,
      zone: binZone(cx, cy, b.three, b.rim, b.mid),
    };
  });
}

// ============================================================================
// Color — zone-aware efficiency thresholds with small-sample protection.
//
// Updated thresholds based on basketball analytics and D1 averages:
//   - 3PT: Red below 33%, neutral 33-34%, green 34%+, strong green 37%+
//   - Mid: Red below 40%, neutral 40-45%, green 45%+, strong green 50%+
//   - Rim: Red below 55%, neutral 55-60%, green 60%+, strong green 65%+
//
// Color logic:
// - Slightly red below baseline
// - Neutral around baseline
// - Slightly green above baseline
// - Stronger green at elite levels
//
// Small sample protection: bins with < 5 attempts get pulled toward neutral
// ============================================================================

const ZONE_THRESHOLDS = {
  three: { red: 0.33, neutral: 0.34, green: 0.37 },
  mid: { red: 0.40, neutral: 0.45, green: 0.50 },
  rim: { red: 0.50, neutral: 0.55, green: 0.60 },
};

const SMALL_SAMPLE_FLOOR = 5;   // below this # attempts, color is pulled toward neutral

function fgPctColor(pct: number, zone: Zone, att: number): string {
  const thresholds = ZONE_THRESHOLDS[zone];

  // Determine color intensity based on zone-specific thresholds
  let t = 0; // -1 = full red, 0 = neutral, 1 = full green

  if (pct < thresholds.red) {
    // Below red threshold - scale from -1 to 0
    t = -1 + (pct / thresholds.red);
    t = Math.max(-1, t);
  } else if (pct < thresholds.neutral) {
    // Between red and neutral - scale from slightly negative to 0
    const range = thresholds.neutral - thresholds.red;
    const pos = pct - thresholds.red;
    t = -0.3 + (pos / range) * 0.3; // -0.3 to 0
  } else if (pct < thresholds.green) {
    // Between neutral and green - scale from 0 to 0.6
    const range = thresholds.green - thresholds.neutral;
    const pos = pct - thresholds.neutral;
    t = (pos / range) * 0.6; // 0 to 0.6
  } else {
    // Above green threshold - scale from 0.6 to 1
    const excess = Math.min(pct - thresholds.green, 0.10); // cap at 10% above green
    t = 0.6 + (excess / 0.10) * 0.4; // 0.6 to 1
  }

  // Small sample protection
  if (att < SMALL_SAMPLE_FLOOR) {
    t *= att / SMALL_SAMPLE_FLOOR;
  }

  const neutral = 'var(--accent)';
  if (t < 0) {
    const k = -t;
    return `color-mix(in oklab, ${neutral} ${Math.round((1 - k) * 100)}%, var(--missed) ${Math.round(k * 100)}%)`;
  }
  return `color-mix(in oklab, ${neutral} ${Math.round((1 - t) * 100)}%, var(--made) ${Math.round(t * 100)}%)`;
}

function zoneLabel(z: Zone): string {
  return z === 'rim' ? 'At Rim' : z === 'mid' ? 'Mid-Range' : '3-Point';
}

// ============================================================================
// Component
// ============================================================================

type HeatmapMode = 'actual' | 'expected';

export function TeamShotHeatmap({ shots }: { shots: AggregateShot[] }) {
  const hasExpected = shots.some((s) => s.expectedFg !== undefined);
  const [mode, setMode] = React.useState<HeatmapMode>('actual');

  const bins = React.useMemo(() => buildBins(shots), [shots]);
  const totalFga = bins.reduce((n, b) => n + b.att, 0);
  const maxAtt = bins.reduce((m, b) => Math.max(m, b.att), 0) || 1;
  const showExpected = mode === 'expected' && hasExpected;

  // 75th-percentile attempt threshold for the "high volume" outline.
  const highVolThreshold = React.useMemo(() => {
    if (bins.length === 0) return Infinity;
    const sorted = [...bins].map((b) => b.att).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * HIGH_VOL_PERCENTILE)] ?? Infinity;
  }, [bins]);

  const [hoverKey, setHoverKey] = React.useState<string | null>(null);
  const hovered = bins.find((b) => `${b.ix}-${b.iy}` === hoverKey) ?? null;

  const cells = bins.map((b) => {
    const key = `${b.ix}-${b.iy}`;
    const pct = b.att > 0 ? b.made / b.att : 0;
    const expectedPct = b.att > 0 ? b.sumExpectedFg / b.att : 0;
    const colorPct = showExpected ? expectedPct : pct;
    const isHover = key === hoverKey;
    const isHighVol = b.att >= highVolThreshold && b.att > 3;

    // Volume → cell SIZE.
    //   Smallest bins fill ~45% of the cell, top-volume bins fill 100%.
    //   sqrt scaling so a 10-shot cell looks meaningfully smaller than a 60-shot cell
    //   but a 1-shot cell still reads.
    const ratio = b.att / maxAtt;
    const sizeFrac = 0.45 + 0.55 * Math.sqrt(ratio);
    const sz = BIN_SIZE * sizeFrac;
    const x = b.ix * BIN_SIZE + (BIN_SIZE - sz) / 2;
    const y = b.iy * BIN_SIZE + (BIN_SIZE - sz) / 2;

    const stroke = isHover
      ? 'var(--text)'
      : isHighVol
      ? 'var(--text)'
      : 'none';
    const strokeWidth = isHover ? 2 : isHighVol ? 1 : 0;
    const strokeOpacity = isHover ? 1 : isHighVol ? 0.55 : 0;

    return (
      <g key={key}>
        <rect
          x={x}
          y={y}
          width={sz}
          height={sz}
          fill={fgPctColor(colorPct, b.zone, b.att)}
          fillOpacity={isHover ? 1 : 0.92}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeOpacity={strokeOpacity}
          rx={2}
          style={{
            cursor: 'pointer',
            transition: 'fill-opacity 100ms ease, stroke-opacity 100ms ease',
          }}
          onMouseEnter={() => setHoverKey(key)}
          onMouseLeave={() => setHoverKey((cur) => (cur === key ? null : cur))}
        />
        {b.att >= LABEL_MIN_ATT && (
          <text
            x={b.cx}
            y={b.cy + 3}
            textAnchor="middle"
            fontFamily="var(--font-jetbrains), monospace"
            fontSize="9"
            fontWeight={600}
            fill="var(--bg)"
            stroke="var(--bg)"
            strokeWidth="0.5"
            style={{ pointerEvents: 'none' }}
          >
            {b.att}
          </text>
        )}
      </g>
    );
  });

  // Hover readout
  let readout: React.ReactNode = (
    <span className="text-text-dim">Hover any cell for detail</span>
  );
  if (hovered) {
    const pct = hovered.att > 0 ? hovered.made / hovered.att : 0;
    const expectedPct = hovered.att > 0 ? hovered.sumExpectedFg / hovered.att : 0;
    const pps =
      hovered.att > 0
        ? ((hovered.zone === 'three' ? 3 : 2) * hovered.made) / hovered.att
        : 0;
    const share = totalFga > 0 ? hovered.att / totalFga : 0;
    readout = (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-text font-medium">{zoneLabel(hovered.zone)}</span>
        <span className="text-text-dim">·</span>
        <span className="tabular-nums">{hovered.att} attempts</span>
        <span className="text-text-dim">·</span>
        {showExpected ? (
          <>
            <span className="tabular-nums">{(expectedPct * 100).toFixed(1)}% expected FG</span>
            <span className="text-text-dim">·</span>
            <span className="tabular-nums text-text-dim">
              actual {(pct * 100).toFixed(1)}% ({hovered.made}/{hovered.att})
            </span>
          </>
        ) : (
          <>
            <span className="tabular-nums">{hovered.made}/{hovered.att}</span>
            <span className="text-text-dim">·</span>
            <span className="tabular-nums">{(pct * 100).toFixed(1)}% FG</span>
            <span className="text-text-dim">·</span>
            <span className="tabular-nums">{pps.toFixed(2)} pts/shot</span>
          </>
        )}
        <span className="text-text-dim">·</span>
        <span className="tabular-nums">{(share * 100).toFixed(1)}% of team FGAs</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {hasExpected && (
        <div className="flex items-center gap-2 mono text-[11px]">
          <span className="text-text-dim uppercase tracking-widest">Color by</span>
          <button
            type="button"
            onClick={() => setMode('actual')}
            className={[
              'px-2.5 py-1 border transition-colors',
              mode === 'actual'
                ? 'border-text text-text bg-surface'
                : 'border-border text-text-dim hover:text-text',
            ].join(' ')}
          >
            Actual FG%
          </button>
          <button
            type="button"
            onClick={() => setMode('expected')}
            className={[
              'px-2.5 py-1 border transition-colors',
              mode === 'expected'
                ? 'border-text text-text bg-surface'
                : 'border-border text-text-dim hover:text-text',
            ].join(' ')}
          >
            Expected FG%
          </button>
        </div>
      )}
      {/* Unobstructed chart */}
      <div className="relative">
        <Court className="w-full h-auto block" behind={cells} />

        {/* Subtle hover hint (minimal overlay) */}
        <div className="absolute top-2 right-2 text-[9px] text-text-dim/60 pointer-events-none mono">
          hover for detail
        </div>
      </div>

      {/* Hover readout (below chart) */}
      <div className="bg-bg/95 border border-border px-3 py-2 mono text-[11px] min-h-[2.5rem] flex items-center">
        {readout}
      </div>

      {/* Zone baseline explanation and legend (side-by-side below chart) */}
      <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-4">
        {/* Zone baseline note */}
        <div className="bg-bg/95 border border-border px-3 py-2 mono text-[10px] leading-tight text-text-dim">
          <div className="text-text font-medium text-[11px] mb-1">
            {showExpected ? 'Color = Expected FG%' : 'Color = Zone Baseline'}
          </div>
          <div className="space-y-0.5">
            {showExpected ? (
              <>
                <div>Model P(make) per cell, vs zone FG% norms</div>
                <div>Not expected eFG (no 1.5× on threes)</div>
              </>
            ) : (
              <>
                <div>3PT turns green above ~34%</div>
                <div>Mid turns green above ~45%</div>
                <div>Rim turns green above ~55%</div>
              </>
            )}
          </div>
          <div className="mt-2 pt-1.5 border-t border-border/50 text-[9px]">
            <div>33% from 3 ≈ 1.00 pts/shot</div>
            <div>50% from mid ≈ 1.00 pts/shot</div>
          </div>
        </div>

        {/* Legend strip */}
        <div className="bg-bg/95 border border-border px-3 py-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 mono text-[10px] uppercase tracking-widest text-text-dim">
          <div className="flex items-center gap-2">
            <span className="text-text">Color</span>
            <span>{showExpected ? 'Expected FG% vs baseline' : 'FG% vs D1 baseline'}</span>
            <span className="inline-flex h-2 w-20 overflow-hidden rounded-[1px]">
              <span className="flex-1 bg-[var(--missed)]" />
              <span className="flex-1 bg-[var(--accent)]" />
              <span className="flex-1 bg-[var(--made)]" />
            </span>
            <span>below → above</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-text">Size</span>
            <span>volume</span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 bg-[var(--accent)] rounded-[1px]" />
              <span className="inline-block h-2.5 w-2.5 bg-[var(--accent)] rounded-[1px]" />
              <span className="inline-block h-3.5 w-3.5 bg-[var(--accent)] rounded-[1px]" />
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 border border-[var(--text)]/55 bg-[var(--accent)]" />
            <span>top-quartile volume</span>
          </div>

          {totalFga > 0 && (
            <div className="ml-auto tabular-nums normal-case">
              <span className="text-text-dim">Total FGAs</span>{' '}
              <span className="text-text">{totalFga.toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
