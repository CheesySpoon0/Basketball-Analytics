#!/usr/bin/env python3
"""
Phase 3a — extract box-score stats for RAPM prior construction.

Pulls season-level stats for all players appearing in the RAPM design matrix.
Used to build independent offensive and defensive priors that anchor O/D
identification when off/def possession ratios are collinear.

OUTPUT:
  scripts/python/rapm/data/boxscore_stats.csv

STATS PULLED:
  Offensive: points, assists, turnovers, 3P%, TS%, minutes
  Defensive: blocks, steals, defensive rebounds, minutes
  Plus totals for rate calculations: FGM, FGA, FTM, FTA, 3PM, 3PA
"""
import os
import sys
from pathlib import Path

import pandas as pd
import psycopg2
from dotenv import load_dotenv
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse

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
OUTPUT_DIR = HERE / "data"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
BOXSCORE_CSV = OUTPUT_DIR / "boxscore_stats.csv"


def _strip_unsupported_params(url: str) -> str:
    """Supabase pooler URLs include pgbouncer=true which psycopg2 rejects."""
    parsed = urlparse(url)
    kept = [(k, v) for k, v in parse_qsl(parsed.query) if k.lower() != "pgbouncer"]
    return urlunparse(parsed._replace(query=urlencode(kept)))


def main() -> None:
    # Get list of all players in RAPM design matrix from stints.csv
    stints_csv = HERE / "data" / "stints.csv"
    if not stints_csv.exists():
        raise SystemExit(f"Missing {stints_csv} — run extract_stints.py first.")

    stints = pd.read_csv(stints_csv)

    # Collect all unique player IDs from both offense and defense
    all_players = set()
    for ids_col in ["playerIds", "opp_playerIds"]:
        for ids_str in stints[ids_col]:
            all_players.update(int(x) for x in str(ids_str).split(","))

    player_list = sorted(all_players)
    print(f"Extracting box-score stats for {len(player_list):,} players from season {SEASON}")

    # Pull comprehensive box-score stats from PlayerSeasonStats
    query = """
    SELECT
        ps."playerId",
        p.name,
        t.school AS team,
        ps.minutes,
        ps.points,
        ps.assists,
        ps.turnovers,
        ps."fieldGoalsMade" AS fgm,
        ps."fieldGoalsAttempted" AS fga,
        ps."threePointsMade" AS tpm,
        ps."threePointsAttempted" AS tpa,
        ps."freeThrowsMade" AS ftm,
        ps."freeThrowsAttempted" AS fta,
        ps.blocks,
        ps.steals,
        ps.fouls,
        ps."defRebounds" AS dreb,
        ps."offRebounds" AS oreb,
        ps.rebounds AS treb
    FROM player_season_stats ps
    LEFT JOIN players p ON p.id = ps."playerId"
    LEFT JOIN teams t ON t.id = ps."teamId"
    WHERE ps.season = %(season)s
      AND ps."playerId" = ANY(%(player_ids)s)
      AND ps.minutes > 0
    """

    with psycopg2.connect(_strip_unsupported_params(DATABASE_URL)) as conn:
        df = pd.read_sql(query, conn, params={
            "season": SEASON,
            "player_ids": player_list
        })

    print(f"  {len(df):,} players with box-score stats found")

    # Fill missing players with zeros (they have no season stats)
    missing = set(player_list) - set(df["playerId"])
    if missing:
        print(f"  {len(missing):,} players have no box-score stats (will use zeros)")
        missing_rows = []
        for pid in missing:
            missing_rows.append({
                "playerId": pid,
                "name": None,
                "team": None,
                "minutes": 0.0,
                "points": 0.0,
                "assists": 0.0,
                "turnovers": 0.0,
                "fgm": 0.0,
                "fga": 0.0,
                "tpm": 0.0,
                "tpa": 0.0,
                "ftm": 0.0,
                "fta": 0.0,
                "blocks": 0.0,
                "steals": 0.0,
                "fouls": 0.0,
                "dreb": 0.0,
                "oreb": 0.0,
                "treb": 0.0,
            })
        df = pd.concat([df, pd.DataFrame(missing_rows)], ignore_index=True)

    # Compute derived stats
    df["fg_pct"] = df["fgm"] / df["fga"].clip(lower=1e-9)
    df["tp_pct"] = df["tpm"] / df["tpa"].clip(lower=1e-9)
    df["ft_pct"] = df["ftm"] / df["fta"].clip(lower=1e-9)

    # True shooting percentage
    df["ts_pct"] = df["points"] / (2 * (df["fga"] + 0.44 * df["fta"])).clip(lower=1e-9)

    # Per-minute rates (standardized to 40 minutes)
    for stat in ["points", "assists", "turnovers", "blocks", "steals", "fouls", "dreb", "oreb", "treb"]:
        df[f"{stat}_per40"] = df[stat] / df["minutes"].clip(lower=1e-9) * 40

    # Clean up NaN values from division by zero
    df = df.fillna(0.0)

    # Sort by playerId for consistency
    df = df.sort_values("playerId").reset_index(drop=True)

    # Write output
    df.to_csv(BOXSCORE_CSV, index=False)
    print(f"\nWrote {len(df):,} player box-score records to {BOXSCORE_CSV.relative_to(REPO_ROOT)}")

    # Summary stats
    print(f"\n=== Box-score summary ===")
    print(f"  players with >0 minutes:     {(df['minutes'] > 0).sum():,}")
    print(f"  mean points per 40 min:      {df['points_per40'].mean():.2f}")
    print(f"  mean assists per 40 min:     {df['assists_per40'].mean():.2f}")
    print(f"  mean blocks per 40 min:      {df['blocks_per40'].mean():.2f}")
    print(f"  mean steals per 40 min:      {df['steals_per40'].mean():.2f}")
    print(f"  mean 3P%:                    {df['tp_pct'].mean():.3f}")
    print(f"  mean TS%:                    {df['ts_pct'].mean():.3f}")


if __name__ == "__main__":
    main()