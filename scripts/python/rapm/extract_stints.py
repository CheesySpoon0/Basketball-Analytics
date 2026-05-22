#!/usr/bin/env python3
"""
Phase 1a — pull the RAPM training set from the lineup_stints table.

OUTPUT:
  scripts/python/rapm/data/stints.csv

THE PAIRING PROBLEM:
  Each row in lineup_stints is one team's on-court window. The two teams in a
  game are partitioned INDEPENDENTLY — when team A subs, team B's lineup is
  unchanged, so A's stint boundaries do NOT line up with B's. A simple
  equality join on (gameId, period, start, end) only catches windows where
  both teams happened to sub at the same tick (~16% of stints).

  The fix is INTERVAL INTERSECTION. Within each (game, period):
    - Take team A's full 5-player stints and team B's full 5-player stints.
    - Overlay both timelines and cut at every boundary from either team.
    - Each resulting sub-interval has ONE constant lineup per team.
    - A sub-interval inherits each team's box-score PRORATED by its share of
      that team's parent stint duration.

  A sub-interval is a valid RAPM observation iff BOTH teams have a known
  5-player lineup over it. Sub-intervals where either side is partial/gap are
  dropped (they cannot be attributed).

TRAINING SET RULES:
  - confidence == 'full' AND exactly 5 players, on BOTH sides.
  - A sub-interval contributes a fractional possession count; we keep only
    sub-intervals whose prorated possessions are > 0 on both sides.

UNIT OF OBSERVATION:
  One row per (game, period, sub-interval). off_ppp / def_ppp are
  per-possession rates; prorated possessions are the row weight.
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
OUTPUT = HERE / "data" / "stints.csv"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

# A sub-interval shorter than this (seconds) is dropped — it is almost always a
# boundary-rounding sliver carrying a meaningless fraction of a possession.
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


def intersect_game_period(team_a_rows, team_b_rows):
    """Given two teams' stint rows within one (game, period), cut both
    timelines at every shared boundary and emit sub-intervals where BOTH
    teams have a constant 5-player lineup.

    Each input row is a dict with start, end (seconds remaining; start > end),
    plus the lineup and prorated-able box-score fields. Yields dicts.

    Box-score proration: a parent stint's points/possessions are spread
    uniformly over its duration, so a sub-interval gets
    parent_value * (sub_duration / parent_duration).
    """
    # Boundaries are seconds-remaining values; clock counts DOWN so a stint
    # runs from a higher `start` to a lower `end`.
    bounds = set()
    for r in team_a_rows + team_b_rows:
        bounds.add(r["start"])
        bounds.add(r["end"])
    ordered = sorted(bounds, reverse=True)  # high -> low

    out = []
    for hi, lo in zip(ordered[:-1], ordered[1:]):
        if hi - lo < MIN_SUBINTERVAL_SECONDS:
            continue
        # The team-A stint covering (hi, lo): start >= hi and end <= lo.
        a = next((r for r in team_a_rows if r["start"] >= hi and r["end"] <= lo), None)
        b = next((r for r in team_b_rows if r["start"] >= hi and r["end"] <= lo), None)
        if a is None or b is None:
            continue  # one side has no full 5-player lineup over this slice
        sub_dur = hi - lo
        a_dur = a["start"] - a["end"]
        b_dur = b["start"] - b["end"]
        if a_dur <= 0 or b_dur <= 0:
            continue
        a_frac = sub_dur / a_dur
        b_frac = sub_dur / b_dur
        # Offense = team A's offense; defense against = team A's possessionsAgainst.
        # Team A's box-score is authoritative for A's offense. For symmetry the
        # offensive row we emit is from A's perspective.
        out.append({
            "gameId": a["gameId"],
            "period": a["period"],
            "startSeconds": hi,
            "endSeconds": lo,
            "teamId": a["teamId"],
            "opponentTeamId": b["teamId"],
            "is_home": 1 if a["teamId"] == a["homeTeamId"] else 0,
            "playerIds": a["playerIds"],
            "opp_playerIds": b["playerIds"],
            "possessionsFor": a["possessionsFor"] * a_frac,
            "possessionsAgainst": a["possessionsAgainst"] * a_frac,
            "pointsFor": a["pointsFor"] * a_frac,
            "pointsAgainst": a["pointsAgainst"] * a_frac,
            "expectedPointsFor": a["expectedPointsFor"] * a_frac,
            "expectedPointsAgainst": a["expectedPointsAgainst"] * a_frac,
        })
    return out


def main() -> None:
    print(f"Connecting to Postgres; pulling full stints for season {SEASON}...")
    with psycopg2.connect(_strip_unsupported_params(DATABASE_URL)) as conn:
        raw = pd.read_sql(QUERY, conn, params={"season": SEASON})
    print(f"  {len(raw):,} full-confidence stint rows pulled")

    five = raw[raw["n_players"] == 5].copy()
    print(f"  {len(five):,} have exactly 5 players "
          f"({len(raw) - len(five):,} off-5 dropped)")

    # --- Intersect each game/period -----------------------------------------
    records: list[dict] = []
    n_groups = 0
    for (game_id, period), grp in five.groupby(["gameId", "period"]):
        teams = grp["teamId"].unique()
        if len(teams) != 2:
            continue  # need both teams present with full lineups
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
        # Emit from A's perspective, then from B's perspective — both teams'
        # offense must appear as observations.
        records.extend(intersect_game_period(team_rows[a_id], team_rows[b_id]))
        records.extend(intersect_game_period(team_rows[b_id], team_rows[a_id]))

    df = pd.DataFrame.from_records(records)
    print(f"  {n_groups:,} game-periods with both teams full")
    print(f"  {len(df):,} sub-interval observations before possession filter")

    out = df[
        (df["possessionsFor"] > 0) & (df["possessionsAgainst"] > 0)
    ].copy()
    print(f"  {len(out):,} sub-intervals with possessions on both sides (final)")

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
    print(f"\nWrote {len(out):,} rows to {OUTPUT.relative_to(REPO_ROOT)}")

    off_players = set()
    def_players = set()
    for ids in out["playerIds"]:
        off_players.update(int(x) for x in str(ids).split(","))
    for ids in out["opp_playerIds"]:
        def_players.update(int(x) for x in str(ids).split(","))

    print("\n=== Training set summary ===")
    print(f"  observations (rows):      {len(out):,}")
    print(f"  distinct players (any):   {len(off_players | def_players):,}")
    print(f"  total offensive poss:     {out['possessionsFor'].sum():,.0f}")
    print(f"  total defensive poss:     {out['possessionsAgainst'].sum():,.0f}")
    print(f"  mean off_ppp:             {out['off_ppp'].mean():.4f}")
    print(f"  mean xoff_ppp:            {out['xoff_ppp'].mean():.4f}")
    print(f"  home-team observations:   {out['is_home'].sum():,} / {len(out):,}")


if __name__ == "__main__":
    main()
