#!/usr/bin/env python3
"""
Phase 3D Task 2 — Build defensive-only dataset.

Creates a dataset focused specifically on defensive performance:
- One row per defensive stint
- Target: opponent points allowed per 100 possessions
- Defensive players get +1 (helping to prevent points)
- Optional opponent offensive controls

This isolates the defensive modeling problem from offensive/net interactions.

OUTPUTS:
  scripts/python/rapm/data/defensive_stints.csv - defensive-focused observations

APPROACH:
  For each stint in single-sided data:
  - Flip perspective: focus on defense allowing points
  - Target = pointsAgainst / possessionsAgainst from defender's team perspective
  - Defensive lineup gets +1 columns (lower target = better defense)
  - Optional: opponent offensive players as control variables
"""
from pathlib import Path
import pandas as pd
import numpy as np

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]

SINGLE_SIDED_CSV = HERE / "data" / "stints_single_sided.csv"
DEFENSIVE_OUTPUT = HERE / "data" / "defensive_stints.csv"


def parse_ids(ids_str):
    """Parse comma-separated player IDs."""
    return [int(x) for x in str(ids_str).split(",")]


def main() -> None:
    print("=" * 70)
    print("PHASE 3D TASK 2 — Building Defensive-Only Dataset")
    print("=" * 70)

    if not SINGLE_SIDED_CSV.exists():
        raise SystemExit(f"Missing {SINGLE_SIDED_CSV} — run create_single_sided_from_existing.py first.")

    # Load single-sided stints
    stints = pd.read_csv(SINGLE_SIDED_CSV)
    print(f"  Loaded {len(stints):,} single-sided stint observations")

    # --- Build defensive-focused dataset ------------------------------------
    defensive_records = []

    for _, stint in stints.iterrows():
        # Basic stint info
        game_id = stint["gameId"]
        period = stint["period"]
        start_sec = stint["startSeconds"]
        end_sec = stint["endSeconds"]

        # PERSPECTIVE FLIP: Focus on the DEFENSIVE team
        # Original: teamId = offense, opponentTeamId = defense, pointsFor = offense scored
        # Defensive: teamId = defense, opponentTeamId = offense, pointsAllowed = defense allowed

        defensive_team_id = stint["opponentTeamId"]  # Original defender becomes focus team
        offensive_team_id = stint["teamId"]          # Original offense becomes opponent

        # Defensive lineup (original opp_playerIds become defensive focus)
        defensive_players = parse_ids(stint["opp_playerIds"])

        # Offensive lineup (original playerIds become offensive opponents)
        offensive_players = parse_ids(stint["playerIds"])

        # TARGET: Points allowed by defense per 100 possessions
        # From defense perspective: pointsAgainst = points they allowed to offense
        # But in original data, pointsAgainst is from OFFENSE perspective
        # So from defense perspective, points allowed = original pointsFor
        possessions_defense = stint["possessionsAgainst"]  # Defensive possessions
        points_allowed = stint["pointsFor"]                # Points defense allowed
        expected_points_allowed = stint["expectedPointsFor"]  # Expected points allowed

        if possessions_defense <= 0:
            continue  # Skip invalid possessions

        defensive_record = {
            "gameId": game_id,
            "period": period,
            "startSeconds": start_sec,
            "endSeconds": end_sec,
            "defensive_teamId": defensive_team_id,
            "offensive_teamId": offensive_team_id,
            "is_home_defense": 1 if defensive_team_id == stint.get("homeTeamId", -1) else 0,

            # Defensive lineup (5 players who are trying to prevent points)
            "defensive_playerIds": ",".join(map(str, defensive_players)),

            # Opponent offensive lineup (5 players trying to score)
            "offensive_playerIds": ",".join(map(str, offensive_players)),

            # Possessions and outcomes
            "defensive_possessions": possessions_defense,
            "points_allowed": points_allowed,
            "expected_points_allowed": expected_points_allowed,

            # Defensive targets (lower is better for defense)
            "def_ppp_allowed": points_allowed / possessions_defense,
            "def_xppp_allowed": expected_points_allowed / possessions_defense,
        }

        defensive_records.append(defensive_record)

    defensive_df = pd.DataFrame(defensive_records)
    print(f"  Built {len(defensive_df):,} defensive observations")

    # --- Analyze defensive dataset -----------------------------------------
    print(f"\n=== Defensive dataset analysis ===")

    # Unique defensive teams and players
    def_teams = defensive_df["defensive_teamId"].nunique()
    off_teams = defensive_df["offensive_teamId"].nunique()

    # Count unique defensive and offensive players
    all_def_players = set()
    all_off_players = set()

    for ids_str in defensive_df["defensive_playerIds"]:
        all_def_players.update(parse_ids(ids_str))

    for ids_str in defensive_df["offensive_playerIds"]:
        all_off_players.update(parse_ids(ids_str))

    print(f"  Unique defensive teams: {def_teams}")
    print(f"  Unique offensive teams: {off_teams}")
    print(f"  Unique defensive players: {len(all_def_players):,}")
    print(f"  Unique offensive players: {len(all_off_players):,}")
    print(f"  Player overlap: {len(all_def_players & all_off_players):,}")

    # Target distributions
    print(f"\n  Defensive target distributions:")
    print(f"    Points allowed per 100:")
    print(f"      Mean: {defensive_df['def_ppp_allowed'].mean():.2f}")
    print(f"      Std:  {defensive_df['def_ppp_allowed'].std():.2f}")
    print(f"      Range: [{defensive_df['def_ppp_allowed'].min():.1f}, {defensive_df['def_ppp_allowed'].max():.1f}]")

    print(f"    Expected points allowed per 100:")
    print(f"      Mean: {defensive_df['def_xppp_allowed'].mean():.2f}")
    print(f"      Std:  {defensive_df['def_xppp_allowed'].std():.2f}")
    print(f"      Range: [{defensive_df['def_xppp_allowed'].min():.1f}, {defensive_df['def_xppp_allowed'].max():.1f}]")

    # Check correlation between actual and expected
    corr_actual_expected = np.corrcoef(
        defensive_df["def_ppp_allowed"],
        defensive_df["def_xppp_allowed"]
    )[0, 1]
    print(f"    Correlation actual vs expected: {corr_actual_expected:.3f}")

    # --- Exposure analysis -------------------------------------------------
    print(f"\n=== Player exposure analysis ===")

    # Calculate defensive exposures per player
    def_exposures = {}
    for _, row in defensive_df.iterrows():
        poss = row["defensive_possessions"]
        for pid in parse_ids(row["defensive_playerIds"]):
            def_exposures[pid] = def_exposures.get(pid, 0) + poss

    exposure_series = pd.Series(def_exposures)
    substantial_defenders = exposure_series[exposure_series >= 100]  # 100+ defensive possessions

    print(f"  Defensive exposure distribution:")
    print(f"    Total defensive players: {len(exposure_series):,}")
    print(f"    Players with 100+ def possessions: {len(substantial_defenders):,}")
    print(f"    Median defensive possessions: {exposure_series.median():.0f}")
    print(f"    Max defensive possessions: {exposure_series.max():.0f}")

    # Show some high-exposure defenders
    top_defenders = substantial_defenders.nlargest(10)
    print(f"\n  Top 10 most-exposed defensive players:")
    for pid, poss in top_defenders.items():
        print(f"    Player {pid}: {poss:.0f} defensive possessions")

    # --- Save dataset ------------------------------------------------------
    defensive_df.to_csv(DEFENSIVE_OUTPUT, index=False)
    print(f"\nWrote {len(defensive_df):,} defensive observations to {DEFENSIVE_OUTPUT.relative_to(REPO_ROOT)}")

    print(f"\n=== Dataset ready for defensive-only modeling ===")
    print(f"  Target interpretation: Lower points allowed per 100 = better defense")
    print(f"  Model setup: Defensive players get +1 (helping prevent points)")
    print(f"  Expected: Good defenders → negative raw coefficients → positive displayed DRAPM")


if __name__ == "__main__":
    main()