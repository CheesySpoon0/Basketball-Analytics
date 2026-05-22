#!/usr/bin/env python3
"""
Phase 3C Part 2 — Diagnose the O/D collinearity root cause.

Examines how the current stint extraction creates perfect collinearity between
offensive and defensive exposures, causing DRAPM identification failure.

THEORY:
The extract_stints.py creates TWO rows per game segment:
- Row 1: Team A offense (playerIds) vs Team B defense (opp_playerIds)
- Row 2: Team B offense (opp_playerIds from Row 1) vs Team A defense (playerIds from Row 1)

This means every player appears as both offense and defense with nearly identical
possession counts, creating 0.997±0.013 correlation between off/def exposures.

VERIFICATION:
1. Load stints.csv and check player exposure patterns
2. Show examples of the double-row construction
3. Calculate actual off/def possession correlations per player
4. Demonstrate the matrix rank deficiency
5. Propose corrected approach
"""
import json
from pathlib import Path
import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
STINTS_CSV = HERE / "data" / "stints.csv"

def parse_ids(ids_str):
    """Parse comma-separated player IDs."""
    return [int(x) for x in str(ids_str).split(",")]


def main() -> None:
    print("=" * 70)
    print("PHASE 3C DIAGNOSTIC — O/D collinearity root cause")
    print("=" * 70)

    if not STINTS_CSV.exists():
        raise SystemExit(f"Missing {STINTS_CSV}")

    df = pd.read_csv(STINTS_CSV)
    print(f"  {len(df):,} stint observations loaded")

    # --- Part 1: Examine the double-row structure ---------------------------
    print(f"\n[1] Double-row structure analysis")

    # Group by game/period to see how many teams appear
    game_periods = df.groupby(["gameId", "period"]).agg({
        "teamId": "nunique",
        "opponentTeamId": "nunique",
        "possessionsFor": "sum"
    }).reset_index()

    both_teams = game_periods[game_periods["teamId"] == 2]
    print(f"    Game-periods with both teams: {len(both_teams):,}")
    print(f"    Total game-periods: {len(game_periods):,}")
    print(f"    Ratio: {len(both_teams)/len(game_periods):.3f}")

    # --- Part 2: Show example rows ------------------------------------------
    print(f"\n[2] Example of double-row construction")

    # Find a game-period with both teams
    sample_game = both_teams.iloc[0]
    game_id, period = sample_game["gameId"], sample_game["period"]

    sample_rows = df[
        (df["gameId"] == game_id) & (df["period"] == period)
    ].sort_values("teamId")

    print(f"    Game {game_id}, Period {period}:")
    for _, row in sample_rows.head(2).iterrows():
        off_players = parse_ids(row["playerIds"])
        def_players = parse_ids(row["opp_playerIds"])
        print(f"      Team {row['teamId']} offense: {off_players}")
        print(f"      Team {row['opponentTeamId']} defense: {def_players}")
        print(f"      Possessions: {row['possessionsFor']:.1f}")
        print(f"      Points: {row['pointsFor']:.1f}")
        print()

    # --- Part 3: Calculate player exposure correlations ---------------------
    print(f"[3] Player off/def possession correlation analysis")

    # Build per-player exposure counts
    player_exposures = {}

    for _, row in df.iterrows():
        poss_for = row["possessionsFor"]
        poss_against = row["possessionsAgainst"]

        # Offensive players
        for pid in parse_ids(row["playerIds"]):
            if pid not in player_exposures:
                player_exposures[pid] = {"off": 0.0, "def": 0.0}
            player_exposures[pid]["off"] += poss_for

        # Defensive players
        for pid in parse_ids(row["opp_playerIds"]):
            if pid not in player_exposures:
                player_exposures[pid] = {"off": 0.0, "def": 0.0}
            player_exposures[pid]["def"] += poss_against

    # Convert to arrays for correlation
    players_df = pd.DataFrame.from_dict(player_exposures, orient="index")
    players_df["total"] = players_df["off"] + players_df["def"]
    players_df["off_ratio"] = players_df["off"] / players_df["total"].clip(lower=1e-9)

    # Filter to meaningful players
    substantial = players_df[players_df["total"] >= 50]

    print(f"    Players with 50+ total possessions: {len(substantial):,}")
    print(f"    Off/def possession correlation: {np.corrcoef(substantial['off'], substantial['def'])[0,1]:.6f}")
    print(f"    Off ratio mean: {substantial['off_ratio'].mean():.6f}")
    print(f"    Off ratio std:  {substantial['off_ratio'].std():.6f}")
    print(f"    Off ratio range: [{substantial['off_ratio'].min():.6f}, {substantial['off_ratio'].max():.6f}]")

    # --- Part 4: Matrix rank analysis ---------------------------------------
    print(f"\n[4] Design matrix rank deficiency analysis")

    # Sample players for quick matrix construction
    sample_players = substantial.head(100).index.tolist()
    player_index = {pid: i for i, pid in enumerate(sample_players)}
    n_players = len(sample_players)

    # Build small design matrix
    X_rows, X_cols, X_vals = [], [], []
    row_idx = 0

    for _, stint_row in df.head(1000).iterrows():  # Sample rows
        off_players = parse_ids(stint_row["playerIds"])
        def_players = parse_ids(stint_row["opp_playerIds"])

        # Only include if we have the players in our sample
        if all(pid in player_index for pid in off_players) and all(pid in player_index for pid in def_players):
            # ORAPM columns (offensive players get +1)
            for pid in off_players:
                X_rows.append(row_idx)
                X_cols.append(player_index[pid])  # ORAPM block
                X_vals.append(1.0)

            # DRAPM columns (defensive players get -1)
            for pid in def_players:
                X_rows.append(row_idx)
                X_cols.append(n_players + player_index[pid])  # DRAPM block
                X_vals.append(-1.0)

            row_idx += 1

    if row_idx > 0:
        from scipy.sparse import coo_matrix
        X = coo_matrix((X_vals, (X_rows, X_cols)), shape=(row_idx, 2 * n_players))

        # Calculate matrix properties
        X_dense = X.toarray()
        XtX = X_dense.T @ X_dense

        # Condition number
        eigenvals = np.linalg.eigvals(XtX)
        eigenvals = eigenvals[eigenvals > 1e-10]  # Remove near-zero
        condition_number = eigenvals.max() / eigenvals.min() if len(eigenvals) > 1 else np.inf

        print(f"    Sample matrix shape: {X.shape}")
        print(f"    Rank: {np.linalg.matrix_rank(X_dense)}")
        print(f"    Condition number: {condition_number:.2e}")

        # Check correlation between ORAPM and DRAPM blocks
        orapm_sums = X_dense[:, :n_players].sum(axis=1)
        drapm_sums = X_dense[:, n_players:].sum(axis=1)
        block_corr = np.corrcoef(orapm_sums, drapm_sums)[0, 1] if len(set(orapm_sums)) > 1 else np.nan
        print(f"    ORAPM vs DRAPM block correlation: {block_corr:.6f}")

    # --- Part 5: Proposed solution ------------------------------------------
    print(f"\n[5] Proposed solution: Single-sided stint construction")
    print(f"    CURRENT (broken): Each game segment → 2 rows (A vs B, B vs A)")
    print(f"    PROPOSED (fixed): Each game segment → 1 row (A vs B only)")
    print(f"    ")
    print(f"    Benefits:")
    print(f"    - Eliminates artificial off/def balance")
    print(f"    - Creates true opponent variation")
    print(f"    - Restores DRAPM identifiability")
    print(f"    ")
    print(f"    Implementation:")
    print(f"    - Modify intersect_game_period() to emit only A vs B")
    print(f"    - Remove the second call in extract_stints.py")
    print(f"    - Expect ~50% fewer observations but proper identification")

    # --- Part 6: Show player examples ---------------------------------------
    print(f"\n[6] Example players with near-perfect off/def balance")

    extreme_balanced = substantial[
        (substantial["off_ratio"] > 0.48) & (substantial["off_ratio"] < 0.52)
    ].sort_values("total", ascending=False)

    if len(extreme_balanced) > 0:
        print(f"    Top players with ~50% off/def split (showing structural collinearity):")
        for _, player_data in extreme_balanced.head(10).iterrows():
            print(f"      Player {player_data.name}: "
                  f"off={player_data['off']:.0f}, def={player_data['def']:.0f}, "
                  f"ratio={player_data['off_ratio']:.4f}")


if __name__ == "__main__":
    main()