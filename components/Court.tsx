import * as React from 'react';

// ============================================================================
// NCAA Men's HALF-COURT geometry.
//
// All curves are sampled as POLYLINES (no SVG <path A> arc commands). This
// makes the rendering immune to SVG arc sweep-flag / large-arc-flag bugs.
//
// Coordinate system used in this module (in FEET):
//   xFt: 0 = court center; sidelines at xFt = ±25.
//   yFt: 0 = baseline directly under the basket; positive yFt goes AWAY from
//        the baseline (toward half-court / top of the chart).
// Basket center sits at (0, 5.25) ft.
//
// SVG coordinate system:
//   svgX increases rightward (matches xFt direction).
//   svgY increases DOWNWARD (so we flip yFt during conversion).
//   1 ft = 10 SVG units.
//
// Visible chart trims the back of the half-court to 35 ft from baseline since
// virtually no shots come from beyond there.
// ============================================================================

const FT_TO_SVG = 10;

const COURT_WIDTH_FT = 50;          // sideline to sideline
const HALF_COURT_LENGTH_FT = 47;    // baseline to half-court line (full half)
const VISIBLE_DEPTH_FT = 35;        // we trim view here

const VB_W = COURT_WIDTH_FT * FT_TO_SVG;  // 500
const VB_H = VISIBLE_DEPTH_FT * FT_TO_SVG; // 350

// --- NCAA Men's measurements (feet) ---
const BASKET_Y_FT = 5.25;                // 5'3" from baseline to rim center
const RIM_R_FT = 0.75;                   // 9" radius
const BACKBOARD_Y_FT = 4;                // backboard plane
const BACKBOARD_HALF_W_FT = 3;           // backboard 6 ft wide
const PAINT_HALF_W_FT = 6;               // paint 12 ft wide
const PAINT_DEPTH_FT = 19;               // baseline → FT line
const FT_LINE_Y_FT = PAINT_DEPTH_FT;     // 19 ft
const FT_CIRCLE_R_FT = 6;
const RESTRICTED_R_FT = 4;
const THREE_R_FT = 22.1458;              // arc radius (22' 1¾")
const THREE_CORNER_X_FT = 21.667;        // ±21'8" from center (3'4" from sideline)

// ============================================================================
// Feet → SVG conversion (single source of truth)
// ============================================================================
function ftX(xFt: number): number {
  return (COURT_WIDTH_FT / 2 + xFt) * FT_TO_SVG;
}
function ftY(yFt: number): number {
  // baseline (yFt=0) sits at the BOTTOM of the SVG canvas
  return VB_H - yFt * FT_TO_SVG;
}
function ftR(rFt: number): number {
  return rFt * FT_TO_SVG;
}

// Pre-computed SVG landmarks (used by COURT_CONSTANTS and outside this module)
const BASKET_X = ftX(0);
const BASKET_Y = ftY(BASKET_Y_FT);
const BASELINE_Y = ftY(0);
const FT_LINE_Y = ftY(FT_LINE_Y_FT);
const BACKBOARD_Y = ftY(BACKBOARD_Y_FT);

// ============================================================================
// Polyline sampler.
//
// Samples a circular arc in FEET coordinates and returns an array of SVG
// "x,y" points. theta is in standard math radians:
//   theta = 0   → +x direction (right of center)
//   theta = π/2 → +y direction (away from baseline, "up" toward half-court)
//   theta = π   → -x direction (left of center)
//
// Because yFt is positive in the "up" direction (the natural basketball
// orientation), this matches normal math conventions; ftY() handles the
// SVG y-flip at the very end. So we cannot accidentally curve the wrong way.
// ============================================================================
function arcPoints(
  cxFt: number,
  cyFt: number,
  rFt: number,
  thetaStart: number,
  thetaEnd: number,
  samples: number = 96,
): string[] {
  const out: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = thetaStart + (thetaEnd - thetaStart) * (i / samples);
    const xFt = cxFt + rFt * Math.cos(t);
    const yFt = cyFt + rFt * Math.sin(t);
    out.push(`${ftX(xFt).toFixed(2)},${ftY(yFt).toFixed(2)}`);
  }
  return out;
}

// ============================================================================
// 3-POINT LINE — single continuous polyline
// ============================================================================
// Where the arc meets the corner-vertical lines:
//   The circle x² + (y − basketY)² = R²
//   At x = ±THREE_CORNER_X_FT:  yFt = basketY + √(R² − cornerX²)
const THREE_Y_MEET_FT =
  BASKET_Y_FT + Math.sqrt(THREE_R_FT ** 2 - THREE_CORNER_X_FT ** 2);
// → 5.25 + √(490.435 − 469.460) = 5.25 + √20.975 ≈ 5.25 + 4.580 = 9.830 ft

// Math angles (in standard convention, +y = "up toward half-court") of the
// two arc endpoints relative to the basket center.
// Going from theta_left (≈168°) DOWN through 90° (apex above basket) TO
// theta_right (≈12°) traces the upper arc.
const THREE_THETA_LEFT = Math.atan2(
  THREE_Y_MEET_FT - BASKET_Y_FT,
  -THREE_CORNER_X_FT,
); // ≈ 2.933 rad
const THREE_THETA_RIGHT = Math.atan2(
  THREE_Y_MEET_FT - BASKET_Y_FT,
  THREE_CORNER_X_FT,
); // ≈ 0.208 rad

const THREE_ARC_POINTS = arcPoints(
  0,
  BASKET_Y_FT,
  THREE_R_FT,
  THREE_THETA_LEFT,
  THREE_THETA_RIGHT,
  96,
);

// Polyline = left-corner-baseline → (arc samples) → right-corner-baseline.
// The first/last arc samples land exactly at the top of each corner, so
// no separate corner segments are needed — straight lines from the baseline
// to those points handle the corners.
const THREE_POINT_POLY = [
  `${ftX(-THREE_CORNER_X_FT).toFixed(2)},${ftY(0).toFixed(2)}`,
  ...THREE_ARC_POINTS,
  `${ftX(THREE_CORNER_X_FT).toFixed(2)},${ftY(0).toFixed(2)}`,
].join(' ');

// ============================================================================
// RESTRICTED-AREA ARC — upper semicircle around the basket
// ============================================================================
// Sweep theta from π (left) DOWN through π/2 (top, away from baseline) TO 0
// (right). Endpoints sit at (±4, basketY) and the apex at (0, basketY + 4).
const RESTRICTED_POINTS = arcPoints(
  0,
  BASKET_Y_FT,
  RESTRICTED_R_FT,
  Math.PI,
  0,
  48,
);
const RESTRICTED_POLY = RESTRICTED_POINTS.join(' ');

// ============================================================================
// FREE-THROW CIRCLE — top half solid, bottom half dashed
// ============================================================================
// Center (0, 19), radius 6.
// Top half (away from baseline): theta π → 0 via π/2. Apex (0, 25 ft).
// Bottom half (inside paint): theta π → 2π via 3π/2. Apex (0, 13 ft).
const FT_TOP_POINTS = arcPoints(0, FT_LINE_Y_FT, FT_CIRCLE_R_FT, Math.PI, 0, 48);
const FT_BOTTOM_POINTS = arcPoints(
  0,
  FT_LINE_Y_FT,
  FT_CIRCLE_R_FT,
  Math.PI,
  2 * Math.PI,
  48,
);
const FT_TOP_POLY = FT_TOP_POINTS.join(' ');
const FT_BOTTOM_POLY = FT_BOTTOM_POINTS.join(' ');

// ============================================================================
// React component
// ============================================================================
export type CourtProps = {
  className?: string;
  children?: React.ReactNode;
  /** Rendered BEFORE the court lines (i.e. behind them). Useful for heatmaps. */
  behind?: React.ReactNode;
};

export function Court({ className, children, behind }: CourtProps) {
  const lineStroke = 'var(--text-dim)';
  const lineOpacity = 0.6;
  const dimOpacity = 0.45; // FT circle, restricted arc — shouldn't fight 3PT line
  const sw = 1.6;

  const paintHalfW = ftR(PAINT_HALF_W_FT);
  const backboardHalfW = ftR(BACKBOARD_HALF_W_FT);
  const rimR = ftR(RIM_R_FT);

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className={className}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Basketball half-court shot chart"
    >
      {behind}

      {/* Court geometry never steals pointer events from overlays */}
      <g
        style={{ pointerEvents: 'none' }}
        stroke={lineStroke}
        strokeWidth={sw}
        fill="none"
      >
        {/* Sidelines + baseline (slightly heavier) */}
        <g strokeOpacity={lineOpacity}>
          <line x1={ftX(-25)} y1={BASELINE_Y} x2={ftX(25)} y2={BASELINE_Y} />
          <line x1={ftX(-25)} y1={0} x2={ftX(-25)} y2={BASELINE_Y} />
          <line x1={ftX(25)} y1={0} x2={ftX(25)} y2={BASELINE_Y} />
        </g>

        {/* Paint (key) */}
        <rect
          x={BASKET_X - paintHalfW}
          y={FT_LINE_Y}
          width={paintHalfW * 2}
          height={BASELINE_Y - FT_LINE_Y}
          strokeOpacity={lineOpacity}
        />

        {/* Free-throw line (explicit) */}
        <line
          x1={BASKET_X - paintHalfW}
          y1={FT_LINE_Y}
          x2={BASKET_X + paintHalfW}
          y2={FT_LINE_Y}
          strokeOpacity={lineOpacity}
        />

        {/* Free-throw circle — dimmer than 3PT so it doesn't visually compete */}
        <polyline points={FT_TOP_POLY} strokeOpacity={dimOpacity} />
        <polyline
          points={FT_BOTTOM_POLY}
          strokeOpacity={dimOpacity}
          strokeDasharray="6 5"
        />

        {/* 3-POINT LINE — one continuous sampled polyline. */}
        <polyline
          points={THREE_POINT_POLY}
          strokeOpacity={lineOpacity}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Restricted-area arc — sampled polyline above the rim */}
        <polyline points={RESTRICTED_POLY} strokeOpacity={dimOpacity} />

        {/* Backboard */}
        <line
          x1={BASKET_X - backboardHalfW}
          y1={BACKBOARD_Y}
          x2={BASKET_X + backboardHalfW}
          y2={BACKBOARD_Y}
          strokeOpacity={0.9}
          strokeWidth={sw * 1.5}
        />

        {/* Rim (a primitive <circle>, not an arc command) */}
        <circle cx={BASKET_X} cy={BASKET_Y} r={rimR} strokeOpacity={0.9} />

        {/* Tiny zone labels */}
        <g
          fontFamily="var(--font-jetbrains), monospace"
          fontSize="8"
          fill="var(--text-dim)"
          letterSpacing="0.15em"
          opacity={0.55}
          stroke="none"
        >
          <text x={BASKET_X} y={BASKET_Y - 22} textAnchor="middle">
            RIM
          </text>
          <text x={BASKET_X} y={FT_LINE_Y - 12} textAnchor="middle">
            MID
          </text>
          <text x={BASKET_X} y={ftY(THREE_Y_MEET_FT) - 18} textAnchor="middle">
            3PT
          </text>
        </g>
      </g>

      {/* Shot overlay */}
      {children}
    </svg>
  );
}

// ============================================================================
// Stored coord → SVG transform.
// VERIFIED CORRECT against sampled real shots (rim makes resolve to ~5–9 ft
// from baseline, 3PT attempts to 23+ ft from basket center). DO NOT TOUCH
// without re-verifying against real shots.
//
// CBBD stored coords:
//   rawX: 0..940 — distance along full court length (both ends share the axis)
//   rawY: 0..495 — position across court width
// ============================================================================
export function shotToSvgCoords(rawX: number, rawY: number): {
  svgX: number;
  svgY: number;
} {
  const courtX = rawX > 470 ? 940 - rawX : rawX;
  return {
    svgX: rawY,
    svgY: BASELINE_Y - courtX,
  };
}

export function shotDistanceFt(rawX: number, rawY: number): number {
  const { svgX, svgY } = shotToSvgCoords(rawX, rawY);
  const dx = svgX - BASKET_X;
  const dy = svgY - BASKET_Y;
  return Math.sqrt(dx * dx + dy * dy) / FT_TO_SVG;
}

// ============================================================================
// Exports for outside consumers
// ============================================================================
export const COURT_CONSTANTS = {
  VB_W,
  VB_H,
  BASELINE_Y,
  BASKET_X,
  BASKET_Y,
  FT_TO_SVG,
};

// Geometry snapshot — used by scripts/debug-court-geometry.ts to verify
// the math against reality. Safe to import; pure data.
export const COURT_DEBUG_INFO = {
  feet: {
    courtWidthFt: COURT_WIDTH_FT,
    halfCourtLengthFt: HALF_COURT_LENGTH_FT,
    basketYFt: BASKET_Y_FT,
    threeRadiusFt: THREE_R_FT,
    threeCornerXFt: THREE_CORNER_X_FT,
    threeYMeetFt: THREE_Y_MEET_FT,
    threeThetaLeftRad: THREE_THETA_LEFT,
    threeThetaRightRad: THREE_THETA_RIGHT,
    restrictedRadiusFt: RESTRICTED_R_FT,
  },
  svg: {
    basket: { x: BASKET_X, y: BASKET_Y },
    baselineY: BASELINE_Y,
    ftLineY: FT_LINE_Y,
    threeLeftMeet: {
      x: ftX(-THREE_CORNER_X_FT),
      y: ftY(THREE_Y_MEET_FT),
    },
    threeRightMeet: {
      x: ftX(THREE_CORNER_X_FT),
      y: ftY(THREE_Y_MEET_FT),
    },
    threeArcTop: {
      x: ftX(0),
      y: ftY(BASKET_Y_FT + THREE_R_FT),
    },
    restrictedLeft: { x: ftX(-RESTRICTED_R_FT), y: ftY(BASKET_Y_FT) },
    restrictedRight: { x: ftX(RESTRICTED_R_FT), y: ftY(BASKET_Y_FT) },
    restrictedTop: { x: ftX(0), y: ftY(BASKET_Y_FT + RESTRICTED_R_FT) },
  },
};
