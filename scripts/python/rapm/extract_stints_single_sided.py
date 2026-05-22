#!/usr/bin/env python3
"""
Phase 3C Part 3 — Single-sided stint extraction (DRAPM rescue).

FIXED VERSION: Emits only ONE row per game segment instead of two.
This eliminates the artificial off/def balance that prevents DRAPM identification.

CHANGE FROM ORIGINAL:
- Original: Each A vs B segment → 2 rows (A offense + B offense)
- Fixed: Each A vs B segment → 1 row (A offense only)

This creates true opponent variation where:
- Players face different defensive lineups
- Defensive players face different offensive lineups
- Off/def exposure ratios become naturally imbalanced
- DRAPM becomes identifiable

OUTPUT:
  scripts/python/rapm/data/stints_single_sided.csv
"""
import os
import sys
from pathlib import Path

import pandas as pd
import psycopg2
from dotenv import load_dotenv
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse


def _strip_unsupported_params(url: str) -> str:
    """Supabase pooler URLs include pgbouncer=true which psycopg2 rejects."""
    parsed = urlparse(url)
    kept = [(k, v) for k, v in parse_qsl(parsed.query) if k.lower() != "pgbouncer"]
    return urlunparse(parsed._replace(query=urlencode(kept)))


HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
for env_path in [HERE / ".env", REPO_ROOT / ".env"]:
    if env_path.exists():
        load_dotenv(env_path)
        break

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set.", file=sys.stderr)
    sys.exit(1)

SEASON = int(os.environ.get("RAPM_SEASON", "2026"))
OUTPUT = HERE / "data" / "stints_single_sided.csv"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

# A sub-interval shorter than this (seconds) is dropped
MIN_SUBINTERVAL_SECONDS = 1.0

QUERY = """
SELECT
  s.id, s."gameId", s."teamId", s."opponentTeamId",
  s.period, s."startSeconds", s."endSeconds",
  s."playerIds", s.confidence,
  s."possessionsFor", s."possessionsAgainst",
  s."pointsFor", s."pointsAgainst",
  s."expectedPointsFor", s."expectedPointsAgainst",
  g."homeTeamId",
  (LENGTH(s."playerIds") - LENGTH(REPLACE(s."playerIds", ',', '')) + 1) AS n_players
FROM lineup_stints s
JOIN games g ON g.id = s."gameId"
WHERE s.season = %(season)s
  AND s.confidence = 'full'
  AND s."playerIds" IS NOT NULL
"""


def intersect_game_period_single_sided(team_a_rows, team_b_rows):
    """FIXED VERSION: Emits only Team A offensive observations.

    This eliminates the double-row construction that creates perfect
    off/def collinearity. Each game segment produces ONE row where
    Team A is on offense and Team B is on defense.
    """
    # Boundaries are seconds-remaining values; clock counts DOWN
    bounds = set()
    for r in team_a_rows + team_b_rows:
        bounds.add(r["start"])
        bounds.add(r["end"])
    ordered = sorted(bounds, reverse=True)  # high -> low

    out = []
    for hi, lo in zip(ordered[:-1], ordered[1:]):
        if hi - lo < MIN_SUBINTERVAL_SECONDS:
            continue

        # Find covering stints for this interval
        a = next((r for r in team_a_rows if r["start"] >= hi and r["end"] <= lo), None)
        b = next((r for r in team_b_rows if r["start"] >= hi and r["end"] <= lo), None)
        if a is None or b is None:
            continue  # one side has no full 5-player lineup

        sub_dur = hi - lo
        a_dur = a["start"] - a["end"]
        b_dur = b["start"] - b["end"]
        if a_dur <= 0 or b_dur <= 0:
            continue

        a_frac = sub_dur / a_dur
        b_frac = sub_dur / b_dur

        # SINGLE ROW: Team A offense vs Team B defense
        # (No reciprocal Team B offense vs Team A defense)
        out.append({
            "gameId": a["gameId"],
            "period": a["period"],
            "startSeconds": hi,
            "endSeconds": lo,
            "teamId": a["teamId"],  # offensive team
            "opponentTeamId": b["teamId"],  # defensive team
            "is_home": 1 if a["teamId"] == a["homeTeamId"] else 0,
            "playerIds": a["playerIds"],  # offensive lineup
            "opp_playerIds": b["playerIds"],  # defensive lineup
            "possessionsFor": a["possessionsFor"] * a_frac,
            "possessionsAgainst": a["possessionsAgainst"] * a_frac,
            "pointsFor": a["pointsFor"] * a_frac,
            "pointsAgainst": a["pointsAgainst"] * a_frac,
            "expectedPointsFor": a["expectedPointsFor"] * a_frac,
            "expectedPointsAgainst": a["expectedPointsAgainst"] * a_frac,
        })
    return out


def main() -> None:
    print(f"Extracting SINGLE-SIDED stints for season {SEASON} (DRAPM rescue)...")
    with psycopg2.connect(_strip_unsupported_params(DATABASE_URL)) as conn:
        raw = pd.read_sql(QUERY, conn, params={"season": SEASON})
    print(f"  {len(raw):,} full-confidence stint rows pulled")

    five = raw[raw["n_players"] == 5].copy()
    print(f"  {len(five):,} have exactly 5 players")

    # --- Intersect each game/period (SINGLE-SIDED) --------------------------
    records: list[dict] = []
    n_groups = 0
    for (game_id, period), grp in five.groupby(["gameId", "period"]):
        teams = grp["teamId"].unique()
        if len(teams) != 2:
            continue  # need both teams present
        n_groups += 1

        team_rows = {}
        for tid in teams:
            tg = grp[grp["teamId"] == tid]
            team_rows[tid] = [
                {
                    "gameId": int(r["gameId"]),
                    "period": int(r["period"]),
                    "teamId": int(r["teamId"]),
                    "homeTeamId": int(r["homeTeamId"]),
                    "start": float(r["startSeconds"]),
                    "end": float(r["endSeconds"]),
                    "playerIds": r["playerIds"],
                    "possessionsFor": float(r["possessionsFor"] or 0),
                    "possessionsAgainst": float(r["possessionsAgainst"] or 0),
                    "pointsFor": float(r["pointsFor"] or 0),
                    "pointsAgainst": float(r["pointsAgainst"] or 0),
                    "expectedPointsFor": float(r["expectedPointsFor"] or 0),
                    "expectedPointsAgainst": float(r["expectedPointsAgainst"] or 0),
                }
                for _, r in tg.iterrows()
            ]

        a_id, b_id = teams[0], teams[1]

        # SINGLE-SIDED: Only emit A vs B (not B vs A)
        # This breaks the perfect off/def symmetry
        records.extend(intersect_game_period_single_sided(team_rows[a_id], team_rows[b_id]))

    df = pd.DataFrame.from_records(records)
    print(f"  {n_groups:,} game-periods with both teams full")
    print(f"  {len(df):,} SINGLE-SIDED observations before possession filter")

    out = df[
        (df["possessionsFor"] > 0) & (df["possessionsAgainst"] > 0)
    ].copy()
    print(f"  {len(out):,} final observations (expect ~50% of original)")

    out["off_ppp"] = out["pointsFor"] / out["possessionsFor"]
    out["def_ppp"] = out["pointsAgainst"] / out["possessionsAgainst"]
    out["xoff_ppp"] = out["expectedPointsFor"] / out["possessionsFor"]
    out["xdef_ppp"] = out["expectedPointsAgainst"] / out["possessionsAgainst"]

    keep = [
        "gameId", "teamId", "opponentTeamId", "is_home",
        "period", "startSeconds", "endSeconds",
        "playerIds", "opp_playerIds",
        "possessionsFor", "possessionsAgainst",
        "pointsFor", "pointsAgainst",
        "expectedPointsFor", "expectedPointsAgainst",
        "off_ppp", "def_ppp", "xoff_ppp", "xdef_ppp",
    ]
    out[keep].to_csv(OUTPUT, index=False)
    print(f"\nWrote {len(out):,} SINGLE-SIDED rows to {OUTPUT.relative_to(REPO_ROOT)}")

    # --- Analyze off/def exposure patterns ----------------------------------
    def parse_ids(ids_str):
        return [int(x) for x in str(ids_str).split(",")]

    off_players = {}
    def_players = {}

    for _, row in out.iterrows():
        poss = row["possessionsFor"]

        # Offensive exposures
        for pid in parse_ids(row["playerIds"]):
            off_players[pid] = off_players.get(pid, 0) + poss

        # Defensive exposures
        for pid in parse_ids(row["opp_playerIds"]):
            def_players[pid] = def_players.get(pid, 0) + poss

    # Calculate exposure statistics
    all_players = set(off_players.keys()) | set(def_players.keys())
    exposure_data = []

    for pid in all_players:
        off_poss = off_players.get(pid, 0)
        def_poss = def_players.get(pid, 0)
        total_poss = off_poss + def_poss

        if total_poss > 50:  # Substantial players only
            exposure_data.append({
                "playerId": pid,
                "off_poss": off_poss,
                "def_poss": def_poss,
                "total_poss": total_poss,
                "off_ratio": off_poss / total_poss
            })

    exposure_df = pd.DataFrame(exposure_data)

    print(f"\n=== SINGLE-SIDED exposure analysis ===")
    print(f"  Players with 50+ possessions: {len(exposure_df):,}")
    if len(exposure_df) > 0:
        print(f"  Off/def correlation: {exposure_df['off_poss'].corr(exposure_df['def_poss']):.6f}")
        print(f"  Off ratio mean: {exposure_df['off_ratio'].mean():.4f}")
        print(f"  Off ratio std: {exposure_df['off_ratio'].std():.4f}")
        print(f"  Off ratio range: [{exposure_df['off_ratio'].min():.4f}, {exposure_df['off_ratio'].max():.4f}]")
        print(f"  Expected improvement: much lower correlation, higher std, wider range")


if __name__ == "__main__":
    main()