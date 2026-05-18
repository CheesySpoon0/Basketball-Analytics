import * as React from 'react';

// NCAA Men's half-court. 1 ft = 10 SVG units.
//
// ORIENTATION: basket at BOTTOM (NBA.com / Basketball-Reference convention).
//
// Internal coord system in this SVG:
//   - viewBox 500 × 350 (50 ft wide × 35 ft tall — trimmed from full 47ft half)
//   - x = 0 is left sideline, x = 500 is right sideline, x = 250 is center
//   - y = 350 is baseline (bottom of SVG), y = 0 is the "top of chart"
//     (which is 35 ft from baseline — past the 3pt line and most shots)
//   - Basket center: (250, 297.5). 297.5 = 350 - 52.5 (5.25 ft from baseline)
//   - 47 ft half-court line would be at y = -120 (off-canvas — intentionally trimmed)

const VB_W = 500;
const VB_H = 350;
const BASELINE_Y = 350;
const BASKET_X = 250;
const BASKET_Y = BASELINE_Y - 52.5; // 297.5
const RIM_R = 7.5;
const BACKBOARD_Y = BASELINE_Y - 40; // 4 ft from baseline → y=310
const BACKBOARD_HALF_W = 30;          // backboard is 6 ft → 60 units wide
const PAINT_HALF_W = 60;              // paint is 12 ft wide
const PAINT_DEPTH = 190;              // 19 ft from baseline
const FT_LINE_Y = BASELINE_Y - PAINT_DEPTH; // 160
const FT_CIRCLE_R = 60;
const THREE_R = 221.46;
const THREE_STRAIGHT_OFFSET = 219.9;  // 21.99 ft from center → 3.34 ft from sideline
const RESTRICTED_R = 40;

export type CourtProps = {
  className?: string;
  children?: React.ReactNode;
};

export function Court({ className, children }: CourtProps) {
  const stroke = 'var(--border)';
  const labelColor = 'var(--text-dim)';
  const sw = 1.5;

  // Where 3pt arc meets the straight portions.
  // Arc: (x-250)² + (y-297.5)² = 221.46²
  // Straight at x = 250 ± 219.9. So (y-297.5)² = 221.46² - 219.9² = 688.5 → y - 297.5 = ±26.24
  // We want the value going TOWARD the top of the chart (smaller y), so:
  const arcMeetY = BASKET_Y - Math.sqrt(THREE_R ** 2 - THREE_STRAIGHT_OFFSET ** 2); // 271.26
  const arcLeftX = BASKET_X - THREE_STRAIGHT_OFFSET;
  const arcRightX = BASKET_X + THREE_STRAIGHT_OFFSET;

  // 3pt arc sweeps from upper-left to upper-right around basket (sweep flag 0 because basket is below the arc)
  const arcPath = `M ${arcLeftX} ${arcMeetY} A ${THREE_R} ${THREE_R} 0 0 0 ${arcRightX} ${arcMeetY}`;

  // Restricted area: semicircle above the basket (curving away from baseline)
  const restrictedPath = `M ${BASKET_X - RESTRICTED_R} ${BASKET_Y} A ${RESTRICTED_R} ${RESTRICTED_R} 0 0 0 ${BASKET_X + RESTRICTED_R} ${BASKET_Y}`;

  // Free throw circle: top half solid, bottom half dashed (where "top" = toward the top of chart, away from basket)
  // FT line is at FT_LINE_Y. Top half curves AWAY from basket (smaller y).
  const ftTopHalf = `M ${BASKET_X - FT_CIRCLE_R} ${FT_LINE_Y} A ${FT_CIRCLE_R} ${FT_CIRCLE_R} 0 0 0 ${BASKET_X + FT_CIRCLE_R} ${FT_LINE_Y}`;
  const ftBottomHalf = `M ${BASKET_X - FT_CIRCLE_R} ${FT_LINE_Y} A ${FT_CIRCLE_R} ${FT_CIRCLE_R} 0 0 1 ${BASKET_X + FT_CIRCLE_R} ${FT_LINE_Y}`;

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className={className}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Basketball half-court shot chart"
    >
      {/* Sidelines + baseline */}
      <line x1={0} y1={BASELINE_Y} x2={VB_W} y2={BASELINE_Y} stroke={stroke} strokeWidth={sw} />
      <line x1={0} y1={0} x2={0} y2={BASELINE_Y} stroke={stroke} strokeWidth={sw} />
      <line x1={VB_W} y1={0} x2={VB_W} y2={BASELINE_Y} stroke={stroke} strokeWidth={sw} />

      {/* Paint (key) */}
      <rect
        x={BASKET_X - PAINT_HALF_W}
        y={FT_LINE_Y}
        width={PAINT_HALF_W * 2}
        height={PAINT_DEPTH}
        fill="none"
        stroke={stroke}
        strokeWidth={sw}
      />

      {/* FT circle — solid top, dashed bottom (inside the paint) */}
      <path d={ftTopHalf} fill="none" stroke={stroke} strokeWidth={sw} />
      <path d={ftBottomHalf} fill="none" stroke={stroke} strokeWidth={sw} strokeDasharray="6 5" />

      {/* 3pt straight portions: vertical lines from baseline up to where arc meets */}
      <line x1={arcLeftX} y1={BASELINE_Y} x2={arcLeftX} y2={arcMeetY} stroke={stroke} strokeWidth={sw} />
      <line x1={arcRightX} y1={BASELINE_Y} x2={arcRightX} y2={arcMeetY} stroke={stroke} strokeWidth={sw} />
      <path d={arcPath} fill="none" stroke={stroke} strokeWidth={sw} />

      {/* Restricted area arc */}
      <path d={restrictedPath} fill="none" stroke={stroke} strokeWidth={sw} />

      {/* Backboard */}
      <line
        x1={BASKET_X - BACKBOARD_HALF_W}
        y1={BACKBOARD_Y}
        x2={BASKET_X + BACKBOARD_HALF_W}
        y2={BACKBOARD_Y}
        stroke="var(--text-dim)"
        strokeWidth={sw * 1.5}
      />

      {/* Rim */}
      <circle cx={BASKET_X} cy={BASKET_Y} r={RIM_R} fill="none" stroke="var(--text-dim)" strokeWidth={sw} />

      {/* Zone labels — tiny mono in --text-dim */}
      <text
        x={BASKET_X}
        y={BASKET_Y - 22}
        textAnchor="middle"
        fontFamily="var(--font-jetbrains), monospace"
        fontSize="8"
        fill={labelColor}
        letterSpacing="0.15em"
        opacity={0.6}
      >
        RIM
      </text>
      <text
        x={BASKET_X}
        y={FT_LINE_Y - 12}
        textAnchor="middle"
        fontFamily="var(--font-jetbrains), monospace"
        fontSize="8"
        fill={labelColor}
        letterSpacing="0.15em"
        opacity={0.6}
      >
        MID
      </text>
      <text
        x={BASKET_X}
        y={arcMeetY - 18}
        textAnchor="middle"
        fontFamily="var(--font-jetbrains), monospace"
        fontSize="8"
        fill={labelColor}
        letterSpacing="0.15em"
        opacity={0.6}
      >
        3PT
      </text>

      {/* Shot overlay */}
      {children}
    </svg>
  );
}

// Transform stored coords (tenths of feet, full-court 940 × 495) → SVG coords
// with basket at the BOTTOM of the chart.
//
// Stored:
//   rawX: 0..940 = distance along court length (both ends)
//   rawY: 0..495 = position across court width
//
// Steps:
//   1. Mirror to one end: if rawX > 470, rawX' = 940 - rawX (so all shots are on the "left" basket end)
//   2. SVG: x-axis = court width (rawY), y-axis = distance from baseline (rawX')
//   3. Flip Y so basket is at bottom: svgY = BASELINE_Y - rawX'
export function shotToSvgCoords(rawX: number, rawY: number): { svgX: number; svgY: number } {
  const courtX = rawX > 470 ? 940 - rawX : rawX;
  return {
    svgX: rawY,                  // 0..495 → 0..500 SVG width
    svgY: BASELINE_Y - courtX,   // basket at bottom: rim ends up at y = 350 - 52.5 = 297.5
  };
}

// Distance from basket in feet (for tooltips / zone classification)
export function shotDistanceFt(rawX: number, rawY: number): number {
  const { svgX, svgY } = shotToSvgCoords(rawX, rawY);
  const dx = svgX - BASKET_X;
  const dy = svgY - BASKET_Y;
  return Math.sqrt(dx * dx + dy * dy) / 10;
}

export const COURT_CONSTANTS = {
  VB_W,
  VB_H,
  BASELINE_Y,
  BASKET_X,
  BASKET_Y,
};
