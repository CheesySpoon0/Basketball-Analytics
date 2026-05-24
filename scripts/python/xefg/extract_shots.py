#!/usr/bin/env python3
"""
Extract every field-goal attempt from the Play table and engineer the features
used by the xeFG model.

OUTPUTS:
  scripts/python/xefg/data/shots.csv

FEATURE PARITY:
  Every feature in this file must have a 1:1 implementation in
  lib/xefg/features.ts. The coordinate transform is ported VERBATIM from
  components/Court.tsx so distance_from_rim matches the existing app.

LIMITATIONS:
  - No defender data, no shot-clock data
  - is_transition is INFERRED from time since the previous defensive event
  - is_end_of_period (<30s in period) is a coarse proxy
  - shotMade (NOT scoringPlay) is the target; scoringPlay also includes FTs
  - `assisted` / `assisterId` are populated ONLY on made shots in our ingestion.
    Using them as features would leak the target (shotAssisted=True implies
    shotMade=True 100% of the time). We compute them for descriptive use only
    and EXCLUDE them from the trained feature set in train_model.py.
"""
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg2
from dotenv import load_dotenv
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse


def _strip_unsupported_params(url: str) -> str:
    """Supabase pooler URLs include pgbouncer=true which psycopg2 rejects."""
    parsed = urlparse(url)
    kept = [(k, v) for k, v in parse_qsl(parsed.query) if k.lower() != "pgbouncer"]
    return urlunparse(parsed._replace(query=urlencode(kept)))

# Resolve repo root and load env (try local .env first, then repo .env)
HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
for env_path in [HERE / ".env", REPO_ROOT / ".env"]:
    if env_path.exists():
        load_dotenv(env_path)
        break

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set. Copy .env.example to .env.", file=sys.stderr)
    sys.exit(1)


def _resolve_seasons() -> list[int]:
    """Seasons to extract.

    XEFG_SEASONS (comma-separated) takes precedence, e.g. XEFG_SEASONS=2025,2026.
    Falls back to XEFG_SEASON (single), then defaults to 2025.
    """
    multi = os.environ.get("XEFG_SEASONS")
    if multi:
        return sorted({int(s.strip()) for s in multi.split(",") if s.strip()})
    return [int(os.environ.get("XEFG_SEASON", "2025"))]


SEASONS = _resolve_seasons()
OUTPUT = HERE / "data" / "shots.csv"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

# ============================================================================
# Coord transform — ported verbatim from components/Court.tsx
#   courtX = rawX > 470 ? 940 - rawX : rawX
#   svgX   = rawY
#   svgY   = 350 - courtX
#   basket at (svgX=250, svgY=297.5); 10 SVG units = 1 ft
# ============================================================================
BASKET_SVG_X = 250.0
BASKET_SVG_Y = 297.5
FT_TO_SVG = 10.0


def shot_to_svg(raw_x: float, raw_y: float) -> tuple[float, float]:
    court_x = (940.0 - raw_x) if raw_x > 470.0 else raw_x
    svg_x = raw_y
    svg_y = 350.0 - court_x
    return svg_x, svg_y


def distance_ft(raw_x: float, raw_y: float) -> float:
    svg_x, svg_y = shot_to_svg(raw_x, raw_y)
    dx = svg_x - BASKET_SVG_X
    dy = svg_y - BASKET_SVG_Y
    return float(np.sqrt(dx * dx + dy * dy) / FT_TO_SVG)


def classify_zone(shot_range: str | None, raw_x: float, raw_y: float) -> str:
    """Matches lib/player-scouting/shot-profile.ts::classifyZone."""
    if shot_range == "three_pointer":
        return "three"
    if shot_range == "rim":
        return "rim"
    if distance_ft(raw_x, raw_y) < 4.0:
        return "rim"
    return "mid"


def is_corner_three(zone: str, raw_x: float, raw_y: float) -> bool:
    """Matches lib/player-scouting/shot-profile.ts::classifyThreeSubzone."""
    if zone != "three":
        return False
    svg_x, svg_y = shot_to_svg(raw_x, raw_y)
    dx_ft = abs(svg_x - BASKET_SVG_X) / FT_TO_SVG
    # Corner = far sideways AND close to baseline (svgY > 250)
    return dx_ft > 18.0 and svg_y > 250.0


DEFENSIVE_EVENT_PLAYTYPES = {
    "Defensive Rebound",
    "Steal",
    "Lost Ball Turnover",
    "Block Shot",
    # treat dead-ball rebound as defensive — these are usually live-ball cleanups
    "Dead Ball Rebound",
}


# ============================================================================
# Pull all plays for the requested season(s) so we can compute "time since
# previous defensive event" (transition feature) before filtering to shots.
# `season` is carried through to the output so downstream train/test splits
# can be season-aware (validation: train one season, test another).
# ============================================================================
# NOTE: no ORDER BY in SQL. Sorting ~5M rows server-side spills to the
# Postgres temp area and can exhaust disk on a small instance. We pull
# unordered and sort in pandas (cheap in memory) before the transition pass.
QUERY = """
SELECT
  p.id, p."gameId", p."playerId", p."teamId", p.period,
  p."secondsRemaining", p."homeScore", p."awayScore",
  p."playType", p."playText",
  p."shotMade", p."shotRange", p."shotAssisted",
  p."shotX", p."shotY", p."assisterId",
  g.season, g."homeTeamId", g."awayTeamId"
FROM plays p
JOIN games g ON g.id = p."gameId"
WHERE g.season = ANY(%(seasons)s)
"""


def main() -> None:
    print(f"Connecting to Postgres; pulling plays for season(s) {SEASONS}...")
    # Fetch one season at a time with a server-side cursor streamed in chunks.
    # Pulling ~5M rows in a single round-trip exceeds the statement timeout;
    # per-season chunked reads keep each query small and bounded.
    frames: list[pd.DataFrame] = []
    with psycopg2.connect(_strip_unsupported_params(DATABASE_URL)) as conn:
        for season in SEASONS:
            print(f"  season {season}...", end="", flush=True)
            season_frames = list(
                pd.read_sql(
                    QUERY,
                    conn,
                    params={"seasons": [season]},
                    chunksize=200_000,
                )
            )
            sdf = pd.concat(season_frames, ignore_index=True)
            print(f" {len(sdf):,} plays")
            frames.append(sdf)
    df = pd.concat(frames, ignore_index=True)

    print(f"  {len(df):,} total plays loaded across {len(SEASONS)} season(s)")

    # Order within each game: period asc, then clock descending (counts down),
    # then play id. The transition feature's groupby().ffill() depends on this.
    df = df.sort_values(
        ["gameId", "period", "secondsRemaining", "id"],
        ascending=[True, True, False, True],
    ).reset_index(drop=True)

    # Mark defensive events (used by every shot to compute time-since)
    df["is_def_event"] = df["playType"].isin(DEFENSIVE_EVENT_PLAYTYPES)

    # Within (gameId, period), compute "secondsRemaining at previous def event".
    # Plays are sorted DESC by secondsRemaining (clock counts down), so a
    # higher value = earlier in the period. We want the most recent defensive
    # event BEFORE this play, which means the row immediately above it in
    # sorted order that has is_def_event=True.
    def_clock_per_period = (
        df.assign(_clock=np.where(df["is_def_event"], df["secondsRemaining"], np.nan))
        .groupby(["gameId", "period"])["_clock"]
        .ffill()
    )
    df["last_def_event_clock"] = def_clock_per_period
    df["seconds_since_def_event"] = df["last_def_event_clock"] - df["secondsRemaining"]
    # If no defensive event yet in the period, leave as NaN.

    # ----- Filter to true FGAs (excludes FTs and non-shot plays) -----
    shots = df[
        df["shotMade"].notna()
        & df["shotX"].notna()
        & df["shotY"].notna()
        & (df["shotRange"] != "free_throw")
    ].copy()
    print(f"  {len(shots):,} FGAs with coordinates (after filter)")

    # ----- Derive features -----
    shots["distance_from_rim"] = [
        distance_ft(x, y) for x, y in zip(shots["shotX"], shots["shotY"])
    ]
    shots["shot_zone"] = [
        classify_zone(r, x, y)
        for r, x, y in zip(shots["shotRange"], shots["shotX"], shots["shotY"])
    ]
    shots["is_corner_three"] = [
        is_corner_three(z, x, y)
        for z, x, y in zip(shots["shot_zone"], shots["shotX"], shots["shotY"])
    ]
    shots["is_above_break_three"] = (shots["shot_zone"] == "three") & ~shots["is_corner_three"]

    shots["is_layup"] = shots["playType"] == "LayUpShot"
    shots["is_dunk"] = shots["playType"] == "DunkShot"
    shots["is_jumper"] = shots["playType"] == "JumpShot"
    shots["is_tip"] = shots["playType"] == "TipShot"

    # DESCRIPTIVE ONLY — do not use as a training feature.
    # In our data shotAssisted is only set TRUE on made shots, so it leaks the target.
    shots["assisted_descriptive"] = shots["shotAssisted"].fillna(False).infer_objects(copy=False).astype(bool)

    # Binned distance — gives LR a non-linear distance handle
    shots["dist_0_3"] = shots["distance_from_rim"] < 3.0
    shots["dist_3_10"] = (shots["distance_from_rim"] >= 3.0) & (shots["distance_from_rim"] < 10.0)
    shots["dist_10_22"] = (shots["distance_from_rim"] >= 10.0) & (shots["distance_from_rim"] < 22.0)
    shots["dist_22_plus"] = shots["distance_from_rim"] >= 22.0

    # End-of-period proxy (matches lib/player-scouting/shot-profile.ts::isEndOfPeriod)
    shots["is_end_of_period"] = shots["secondsRemaining"].fillna(999) < 30

    # Transition proxy — previous defensive event within 7 seconds (same period)
    shots["is_transition"] = (
        shots["seconds_since_def_event"].notna()
        & (shots["seconds_since_def_event"] >= 0)
        & (shots["seconds_since_def_event"] <= 7)
    )

    # Home-team shooter
    shots["home_team"] = shots["teamId"] == shots["homeTeamId"]

    # Score differential from shooter's perspective (Play.homeScore/awayScore are
    # AT TIME OF play — close enough; the model effect is small).
    shooter_score = np.where(shots["home_team"], shots["homeScore"], shots["awayScore"])
    opp_score = np.where(shots["home_team"], shots["awayScore"], shots["homeScore"])
    shots["score_differential"] = (shooter_score - opp_score).astype(float)

    # Period as int (1, 2, OT periods are 3+)
    shots["period"] = shots["period"].fillna(1).astype(int)
    shots["seconds_remaining_in_period"] = shots["secondsRemaining"].fillna(0).astype(int)

    # Target
    shots["made"] = shots["shotMade"].astype(int)

    # Final columns
    keep = [
        "id", "season", "gameId", "playerId", "teamId",
        "shotX", "shotY", "shotRange", "playType",
        "distance_from_rim", "shot_zone",
        "is_corner_three", "is_above_break_three",
        "is_layup", "is_dunk", "is_jumper", "is_tip",
        "assisted_descriptive",
        "dist_0_3", "dist_3_10", "dist_10_22", "dist_22_plus",
        "is_end_of_period", "is_transition",
        "home_team",
        "seconds_remaining_in_period", "score_differential", "period",
        "made",
    ]
    out = shots[keep].copy()
    # Coerce booleans to ints for clean CSV / downstream ML
    for col in out.select_dtypes(include="bool").columns:
        out[col] = out[col].astype(int)

    out.to_csv(OUTPUT, index=False)
    print(f"\nWrote {len(out):,} rows to {OUTPUT.relative_to(REPO_ROOT)}")

    # ============================================================================
    # Sanity summary
    # ============================================================================
    if len(SEASONS) > 1:
        print("\n=== Training shots by season ===")
        per = out.groupby("season")["made"].agg(["count", "mean"])
        for season, row in per.iterrows():
            print(f"  {season}: {int(row['count']):,} shots, FG% {row['mean'] * 100:.2f}%")

    print("\n=== Sanity check: FG% by zone ===")
    z = out.groupby("shot_zone")["made"].agg(["count", "mean"])
    z["mean"] = (z["mean"] * 100).round(2)
    z = z.rename(columns={"count": "fga", "mean": "fg_pct"})
    print(z)

    print("\n=== Corner vs above-break threes ===")
    threes = out[out["shot_zone"] == "three"]
    if len(threes) > 0:
        corner_pct = threes["is_corner_three"].mean() * 100
        corner_fg = threes.loc[threes["is_corner_three"] == 1, "made"].mean() * 100
        ab_fg = threes.loc[threes["is_corner_three"] == 0, "made"].mean() * 100
        print(f"  corner share of 3s:   {corner_pct:.1f}%")
        print(f"  corner 3 FG%:         {corner_fg:.2f}%")
        print(f"  above-break 3 FG%:    {ab_fg:.2f}%")

    print("\n=== Assisted vs unassisted (DESCRIPTIVE — not a training feature) ===")
    print("  NOTE: shotAssisted is only set on made shots, so assisted=1 → 100% make.")
    print("        This is a data limitation; feature is dropped from the trained model.")
    a = out.groupby(["shot_zone", "assisted_descriptive"])["made"].mean().unstack() * 100
    print(a.round(2))

    print("\n=== Transition share + FG% ===")
    print(f"  % of FGAs flagged transition: {out['is_transition'].mean() * 100:.1f}%")
    print(out.groupby("is_transition")["made"].mean().round(4) * 100)

    print("\n=== Shot-type share ===")
    for col in ["is_layup", "is_dunk", "is_jumper", "is_tip"]:
        share = out[col].mean() * 100
        fg = out.loc[out[col] == 1, "made"].mean() * 100 if out[col].sum() > 0 else 0
        print(f"  {col:14s} share={share:5.1f}%   FG%={fg:5.2f}%")


if __name__ == "__main__":
    main()
