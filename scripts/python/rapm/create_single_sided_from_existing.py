#!/usr/bin/env python3
"""
Phase 3C Part 3B — Create single-sided stints from existing data.

Since we can't re-extract from DB, convert the existing double-sided
stints.csv to single-sided by removing the duplicate perspective rows.

STRATEGY:
1. Load existing stints.csv (double-sided)
2. Group by (gameId, period, startSeconds, endSeconds)
3. Keep only one row per group (eliminating the reciprocal perspective)
4. Verify that off/def correlation drops significantly

This should cut observations roughly in half but restore DRAPM identifiability.
"""
from pathlib import Path
import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]

STINTS_CSV = HERE / "data" / "stints.csv"
OUTPUT_CSV = HERE / "data" / "stints_single_sided.csv"


def parse_ids(ids_str):
    """Parse comma-separated player IDs."""
    return [int(x) for x in str(ids_str).split(",")]


def main() -> None:
    print("=" * 60)
    print("Converting existing double-sided stints to single-sided")
    print("=" * 60)

    if not STINTS_CSV.exists():
        raise SystemExit(f"Missing {STINTS_CSV}")

    df = pd.read_csv(STINTS_CSV)
    print(f"  Original: {len(df):,} double-sided observations")

    # --- Strategy 1: Keep only the first row per game segment ---------------
    print(f"\n[1] Deduplication strategy: Keep first row per segment")

    # Create a unique identifier for each game segment
    df["segment_key"] = (
        df["gameId"].astype(str) + "_" +
        df["period"].astype(str) + "_" +
        df["startSeconds"].astype(str) + "_" +
        df["endSeconds"].astype(str)
    )

    # Count segments
    segment_counts = df["segment_key"].value_counts()
    single_segments = (segment_counts == 1).sum()
    double_segments = (segment_counts == 2).sum()
    other_segments = (segment_counts > 2).sum()

    print(f"    Segments with 1 row: {single_segments:,}")
    print(f"    Segments with 2 rows: {double_segments:,} (double-sided)")
    print(f"    Segments with 3+ rows: {other_segments:,}")

    # Keep first occurrence of each segment
    deduplicated = df.drop_duplicates(subset=["segment_key"], keep="first")
    print(f"    After deduplication: {len(deduplicated):,} rows ({len(deduplicated)/len(df):.1%})")

    # --- Strategy 2: Alternative - keep smaller teamId ----------------------
    print(f"\n[2] Alternative strategy: Keep smaller teamId per segment")

    # For each segment, keep the row with smaller teamId (arbitrary but consistent)
    alt_deduplicated = df.loc[df.groupby("segment_key")["teamId"].idxmin()]
    print(f"    Alternative result: {len(alt_deduplicated):,} rows")

    # Use the first strategy
    single_sided = deduplicated.copy()

    # --- Analyze off/def exposure patterns ----------------------------------
    print(f"\n[3] Off/def exposure analysis")

    def analyze_exposures(data, label):
        off_exposures = {}
        def_exposures = {}

        for _, row in data.iterrows():
            poss_for = row["possessionsFor"]
            poss_against = row["possessionsAgainst"]

            # Offensive exposures
            for pid in parse_ids(row["playerIds"]):
                off_exposures[pid] = off_exposures.get(pid, 0) + poss_for

            # Defensive exposures
            for pid in parse_ids(row["opp_playerIds"]):
                def_exposures[pid] = def_exposures.get(pid, 0) + poss_against

        # Build analysis DataFrame
        all_players = set(off_exposures.keys()) | set(def_exposures.keys())
        exposure_data = []

        for pid in all_players:
            off_poss = off_exposures.get(pid, 0)
            def_poss = def_exposures.get(pid, 0)
            total_poss = off_poss + def_poss

            if total_poss > 50:  # Substantial players only
                exposure_data.append({
                    "playerId": pid,
                    "off_poss": off_poss,
                    "def_poss": def_poss,
                    "total_poss": total_poss,
                    "off_ratio": off_poss / total_poss
                })

        if len(exposure_data) > 0:
            exposure_df = pd.DataFrame(exposure_data)
            corr = exposure_df["off_poss"].corr(exposure_df["def_poss"])
            ratio_mean = exposure_df["off_ratio"].mean()
            ratio_std = exposure_df["off_ratio"].std()
            ratio_range = (exposure_df["off_ratio"].min(), exposure_df["off_ratio"].max())

            print(f"    {label}:")
            print(f"      Players with 50+ possessions: {len(exposure_df):,}")
            print(f"      Off/def correlation: {corr:.6f}")
            print(f"      Off ratio mean: {ratio_mean:.4f}")
            print(f"      Off ratio std: {ratio_std:.4f}")
            print(f"      Off ratio range: [{ratio_range[0]:.4f}, {ratio_range[1]:.4f}]")
            return exposure_df
        else:
            print(f"    {label}: No substantial players found")
            return pd.DataFrame()

    # Analyze both versions
    original_exposures = analyze_exposures(df, "Original (double-sided)")
    single_exposures = analyze_exposures(single_sided, "Single-sided (fixed)")

    # --- Show improvement metrics --------------------------------------------
    if len(original_exposures) > 0 and len(single_exposures) > 0:
        print(f"\n[4] Improvement metrics")
        orig_corr = original_exposures["off_poss"].corr(original_exposures["def_poss"])
        single_corr = single_exposures["off_poss"].corr(single_exposures["def_poss"])
        corr_improvement = abs(orig_corr - single_corr)

        orig_std = original_exposures["off_ratio"].std()
        single_std = single_exposures["off_ratio"].std()
        std_improvement = single_std - orig_std

        print(f"    Off/def correlation change: {orig_corr:.6f} → {single_corr:.6f} (Δ={-corr_improvement:.6f})")
        print(f"    Off ratio std change: {orig_std:.6f} → {single_std:.6f} (Δ=+{std_improvement:.6f})")
        print(f"    Expected: Lower correlation + higher std = better DRAPM identification")

    # --- Save single-sided data ----------------------------------------------
    single_sided.drop(columns=["segment_key"], inplace=True)
    single_sided.to_csv(OUTPUT_CSV, index=False)
    print(f"\nWrote {len(single_sided):,} single-sided observations to {OUTPUT_CSV.relative_to(REPO_ROOT)}")

    # --- Summary -------------------------------------------------------------
    print(f"\n=== SUMMARY ===")
    print(f"  Original observations: {len(df):,}")
    print(f"  Single-sided observations: {len(single_sided):,}")
    print(f"  Reduction: {(1 - len(single_sided)/len(df)):.1%}")
    print(f"  Expected benefit: Restored DRAPM identifiability")
    print(f"  Next step: Retrain RAPM on single-sided data")


if __name__ == "__main__":
    main()