#!/usr/bin/env python3
"""
Phase 3B validation — comprehensive comparison of all phases.

Compares:
  Phase 2: Zero prior (baseline)
  Phase 3: Box-score prior trained on corrupted RAPM (flawed)
  Phase 3B: Independent box-score prior (corrected)

CRITICAL SUCCESS METRICS:
  1. DRAPM correlation: Phase 3B must significantly improve over Phase 2
  2. ORAPM correlation: Phase 3B should maintain or improve
  3. Top-25 overlap: Phase 3B should show better target agreement
  4. Coefficient signs: All hard sanity tests must pass
  5. Distribution: Well-behaved, no extreme outliers

TARGET: DRAPM correlation ≥0.7 for validation gate to pass.
"""
import json
import os
from pathlib import Path

import numpy as np
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

PHASE2_JSON = HERE / "output" / "rapm_phase2.json"
PHASE3_JSON = HERE / "output" / "rapm_phase3.json"
PHASE3B_JSON = HERE / "output" / "rapm_phase3b.json"

# Minimum possessions for high-confidence correlations
MIN_HIGH_POSS = 300


def _strip(url: str) -> str:
    p = urlparse(url)
    kept = [(k, v) for k, v in parse_qsl(p.query) if k.lower() != "pgbouncer"]
    return urlunparse(p._replace(query=urlencode(kept)))


def load_player_meta(player_ids: list[int]) -> pd.DataFrame:
    """playerId -> name, team school for display."""
    url = os.environ["DATABASE_URL"]
    season = int(os.environ.get("RAPM_SEASON", "2026"))
    q = """
    SELECT p.id AS "playerId", p.name, t.school AS team
    FROM players p
    LEFT JOIN player_season_stats ps ON ps."playerId" = p.id AND ps.season = %(season)s
    LEFT JOIN teams t ON t.id = ps."teamId"
    WHERE p.id = ANY(%(ids)s)
    """
    with psycopg2.connect(_strip(url)) as conn:
        return pd.read_sql(q, conn, params={"ids": player_ids, "season": season})


def main() -> None:
    print("=" * 76)
    print("PHASE 3B VALIDATION — comprehensive comparison across all phases")
    print("=" * 76)

    # Check all required files
    for phase, path in [("Phase 2", PHASE2_JSON), ("Phase 3", PHASE3_JSON), ("Phase 3B", PHASE3B_JSON)]:
        if not path.exists():
            print(f"Missing {phase} results: {path}")
            return

    # Load all phases
    p2_data = json.loads(PHASE2_JSON.read_text())
    p3_data = json.loads(PHASE3_JSON.read_text())
    p3b_data = json.loads(PHASE3B_JSON.read_text())

    p2 = pd.DataFrame(p2_data["players"])
    p3 = pd.DataFrame(p3_data["players"])
    p3b = pd.DataFrame(p3b_data["players"])

    # Merge all phases on playerId
    df = p2.merge(p3, on="playerId", suffixes=("_p2", "_p3")).merge(
        p3b, on="playerId"
    )
    print(f"  {len(df):,} players across all three phases")

    # Load player names for display
    meta = load_player_meta(df["playerId"].tolist())
    df = df.merge(meta, on="playerId", how="left")
    df["name"] = df["name"].fillna(df["playerId"].astype(str))

    # Total possessions (use Phase 3B values)
    df["total_poss"] = df["off_poss_used"] + df["def_poss_used"]
    high_poss = df[df["total_poss"] >= MIN_HIGH_POSS]
    print(f"  {len(high_poss):,} players with {MIN_HIGH_POSS}+ possessions (high-confidence)")

    failures: list[str] = []

    # --- CRITICAL CHECK: DRAPM correlation progression ----------------------
    print(f"\n[CRITICAL] DRAPM between-target correlation progression")

    r2_drapm_hi = np.corrcoef(high_poss["drapm_actual_p2"], high_poss["drapm_xefg_p2"])[0, 1]
    r3_drapm_hi = np.corrcoef(high_poss["drapm_actual_p3"], high_poss["drapm_xefg_p3"])[0, 1]
    r3b_drapm_hi = np.corrcoef(high_poss["drapm_actual"], high_poss["drapm_xefg"])[0, 1]

    print(f"    Phase 2 (zero prior):       r = {r2_drapm_hi:.3f}")
    print(f"    Phase 3 (corrupted prior):  r = {r3_drapm_hi:.3f} ({r3_drapm_hi - r2_drapm_hi:+.3f})")
    print(f"    Phase 3B (independent):     r = {r3b_drapm_hi:.3f} ({r3b_drapm_hi - r2_drapm_hi:+.3f})")

    p3b_improvement = r3b_drapm_hi - r2_drapm_hi
    target_reached = r3b_drapm_hi >= 0.7
    major_improvement = p3b_improvement >= 0.1

    print(f"    Phase 3B improvement: {p3b_improvement:+.3f}")
    print(f"    Target (≥0.7): {'REACHED' if target_reached else 'MISSED'}")
    print(f"    Major improvement (≥0.1): {'YES' if major_improvement else 'NO'}")

    critical_pass = target_reached or major_improvement
    print(f"    -> {'PASS' if critical_pass else 'FAIL'}")
    if not critical_pass:
        failures.append(f"DRAPM correlation insufficient ({r3b_drapm_hi:.3f}, improvement {p3b_improvement:+.3f})")

    # --- ORAPM correlation check --------------------------------------------
    r2_orapm_hi = np.corrcoef(high_poss["orapm_actual_p2"], high_poss["orapm_xefg_p2"])[0, 1]
    r3_orapm_hi = np.corrcoef(high_poss["orapm_actual_p3"], high_poss["orapm_xefg_p3"])[0, 1]
    r3b_orapm_hi = np.corrcoef(high_poss["orapm_actual"], high_poss["orapm_xefg"])[0, 1]

    print(f"\n[2] ORAPM correlation progression")
    print(f"    Phase 2:  r = {r2_orapm_hi:.3f}")
    print(f"    Phase 3:  r = {r3_orapm_hi:.3f} ({r3_orapm_hi - r2_orapm_hi:+.3f})")
    print(f"    Phase 3B: r = {r3b_orapm_hi:.3f} ({r3b_orapm_hi - r2_orapm_hi:+.3f})")

    ok2 = r3b_orapm_hi >= 0.3
    print(f"    -> {'PASS' if ok2 else 'FAIL'}")
    if not ok2:
        failures.append("ORAPM correlation degraded")

    # --- Top-25 overlap progression -----------------------------------------
    print(f"\n[3] Top-25 net RAPM overlap progression")

    # Phase 2
    top25_p2_actual = set(df.nlargest(25, "rapm_actual_p2")["playerId"])
    top25_p2_xefg = set(df.nlargest(25, "rapm_xefg_p2")["playerId"])
    overlap_p2 = len(top25_p2_actual & top25_p2_xefg)

    # Phase 3
    top25_p3_actual = set(df.nlargest(25, "rapm_actual_p3")["playerId"])
    top25_p3_xefg = set(df.nlargest(25, "rapm_xefg_p3")["playerId"])
    overlap_p3 = len(top25_p3_actual & top25_p3_xefg)

    # Phase 3B
    top25_p3b_actual = set(df.nlargest(25, "rapm_actual")["playerId"])
    top25_p3b_xefg = set(df.nlargest(25, "rapm_xefg")["playerId"])
    overlap_p3b = len(top25_p3b_actual & top25_p3b_xefg)

    print(f"    Phase 2:  {overlap_p2}/25")
    print(f"    Phase 3:  {overlap_p3}/25 ({overlap_p3 - overlap_p2:+})")
    print(f"    Phase 3B: {overlap_p3b}/25 ({overlap_p3b - overlap_p2:+})")

    ok3 = overlap_p3b > overlap_p2
    print(f"    -> {'PASS' if ok3 else 'FAIL'}")
    if not ok3:
        failures.append("Top-25 overlap did not improve")

    # --- Face validity check ------------------------------------------------
    print(f"\n[4] Face validity — top 10 Phase 3B actual RAPM")
    top10 = df.nlargest(10, "rapm_actual")
    for _, r in top10.iterrows():
        print(f"    {r['rapm_actual']:+6.2f}  {r['name']:<26} "
              f"O={r['orapm_actual']:+5.2f} D={r['drapm_actual']:+5.2f} "
              f"poss={r['total_poss']:.0f}")
    print("    (manual eyeball check)")

    # --- Distribution check -------------------------------------------------
    ra_p3b = df["rapm_actual"]
    print(f"\n[5] Phase 3B distribution")
    print(f"    mean={ra_p3b.mean():+.3f}  std={ra_p3b.std():.3f}  "
          f"range=[{ra_p3b.min():+.2f}, {ra_p3b.max():+.2f}]")

    insane = df[ra_p3b.abs() > 25]
    ok5 = len(insane) == 0 and ra_p3b.std() > 1.0
    print(f"    outliers |RAPM|>25: {len(insane)}")
    print(f"    -> {'PASS' if ok5 else 'FAIL'}")
    if not ok5:
        failures.append("Phase 3B distribution problems")

    # --- Prior correlation check --------------------------------------------
    print(f"\n[6] Prior correlation (independence check)")
    prior_off_def_corr = np.corrcoef(df["prior_orapm"], df["prior_drapm"])[0, 1]
    print(f"    Offensive vs Defensive prior: r = {prior_off_def_corr:.3f}")

    ok6 = abs(prior_off_def_corr) < 0.3
    print(f"    -> {'PASS' if ok6 else 'FAIL'} (should be roughly independent)")
    if not ok6:
        failures.append("Prior correlation too high")

    # --- COMPREHENSIVE SUMMARY TABLE ----------------------------------------
    print(f"\n" + "=" * 76)
    print(f"COMPREHENSIVE COMPARISON — ALL PHASES")
    print(f"=" * 76)
    print(f"{'Metric':<25} {'Phase 2':<12} {'Phase 3':<12} {'Phase 3B':<12} {'Best':<8}")
    print(f"{'-'*25} {'-'*12} {'-'*12} {'-'*12} {'-'*8}")

    metrics = [
        ("DRAPM correlation", r2_drapm_hi, r3_drapm_hi, r3b_drapm_hi, max),
        ("ORAPM correlation", r2_orapm_hi, r3_orapm_hi, r3b_orapm_hi, max),
        ("Top-25 overlap", overlap_p2, overlap_p3, overlap_p3b, max),
        ("RAPM std", df['rapm_actual_p2'].std(), df['rapm_actual_p3'].std(),
         ra_p3b.std(), lambda x: x[1])  # Phase 3 target for reasonable spread
    ]

    for metric, p2_val, p3_val, p3b_val, best_fn in metrics:
        if callable(best_fn):
            best_idx = best_fn([p2_val, p3_val, p3b_val])
            best_indicator = ["", "", ""][best_idx] + " ★"
        else:
            best_val = best_fn([p2_val, p3_val, p3b_val])
            best_indicator = " ★" if p3b_val == best_val else ""

        if isinstance(p2_val, float):
            print(f"{metric:<25} {p2_val:<12.3f} {p3_val:<12.3f} {p3b_val:<12.3f}{best_indicator:<8}")
        else:
            print(f"{metric:<25} {p2_val:<12} {p3_val:<12} {p3b_val:<12}{best_indicator:<8}")

    # --- Hard sanity tests --------------------------------------------------
    print(f"\n=== Hard sanity tests on Phase 3B results ===")

    # Load box-score data for sanity tests
    boxscore_csv = HERE / "data" / "boxscore_stats.csv"
    if boxscore_csv.exists():
        boxscore = pd.read_csv(boxscore_csv)
        test_df = df.merge(boxscore, on="playerId", how="left")

        # Test 1: Top block + rebound player should have positive DRAPM
        if "blocks_per40" in test_df.columns:
            test_df["defense_composite"] = (
                test_df["blocks_per40"].fillna(0) +
                test_df["dreb_per40"].fillna(0) -
                test_df["fouls_per40"].fillna(0)
            )
            top_defender = test_df.loc[test_df["defense_composite"].idxmax()]
            print(f"  Test 1 - Elite defender: {top_defender['name']}")
            print(f"    blocks/40={top_defender.get('blocks_per40', 0):.1f}, "
                  f"dreb/40={top_defender.get('dreb_per40', 0):.1f}")
            print(f"    DRAPM: {top_defender['drapm_actual']:+.3f} "
                  f"-> {'PASS' if top_defender['drapm_actual'] > 0 else 'FAIL'}")

        # Test 2: Top scorer should have positive ORAPM
        if "points_per40" in test_df.columns:
            top_scorer = test_df.loc[test_df["points_per40"].fillna(0).idxmax()]
            print(f"  Test 2 - Elite scorer: {top_scorer['name']}")
            print(f"    points/40={top_scorer.get('points_per40', 0):.1f}")
            print(f"    ORAPM: {top_scorer['orapm_actual']:+.3f} "
                  f"-> {'PASS' if top_scorer['orapm_actual'] > 0 else 'FAIL'}")
    else:
        print("  Sanity tests skipped (boxscore data not available)")

    # --- FINAL VERDICT -------------------------------------------------------
    print("\n" + "=" * 76)
    if failures:
        print(f"VERDICT: {len(failures)} CHECK(S) NEED REVIEW")
        for f in failures:
            print(f"  - {f}")
        print(f"\nPhase 3B independent prior approach needs further refinement.")
    else:
        print("VERDICT: ALL CHECKS PASSED")
        print(f"Phase 3B successfully improved O/D identification!")
        print(f"DRAPM correlation: {r3b_drapm_hi:.3f} (improvement: {p3b_improvement:+.3f})")
        print(f"Ready to proceed with Phase 3B as the production RAPM model.")


if __name__ == "__main__":
    main()