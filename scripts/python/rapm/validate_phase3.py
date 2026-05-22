#!/usr/bin/env python3
"""
Phase 3 verification — must improve O/D identification vs Phase 2.

CRITICAL CHECKS:
  1. DRAPM correlation: DRAPM_actual vs DRAPM_xefg must improve from Phase 2's 0.52
     toward 0.8+. This is the primary success metric for Phase 3.
  2. Top-25 overlap: Overlap in top 25 net RAPM between targets must improve from
     Phase 2's 1/25 baseline.
  3. Face validity: Top/bottom players should still make sense (not broken by prior).
  4. Distribution: Should remain well-behaved (not over-regularized).

The box-score prior's job is to anchor O and D separately so ridge can identify
the O/D split correctly rather than just the net sum.
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

# Minimum possessions for "high-confidence" correlations
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
    if not PHASE2_JSON.exists():
        raise SystemExit(f"Missing {PHASE2_JSON} — run train_rapm.py first.")
    if not PHASE3_JSON.exists():
        raise SystemExit(f"Missing {PHASE3_JSON} — run train_rapm_phase3.py first.")

    print("=" * 70)
    print("PHASE 3 VALIDATION — box-score prior vs zero prior")
    print("=" * 70)

    # Load both phases
    phase2_data = json.loads(PHASE2_JSON.read_text())
    phase3_data = json.loads(PHASE3_JSON.read_text())
    p2 = pd.DataFrame(phase2_data["players"])
    p3 = pd.DataFrame(phase3_data["players"])

    # Merge on playerId
    df = p2.merge(p3, on="playerId", suffixes=("_p2", "_p3"))
    print(f"  {len(df):,} players in both phases")

    # Load player names for display
    meta = load_player_meta(df["playerId"].tolist())
    df = df.merge(meta, on="playerId", how="left")
    df["name"] = df["name"].fillna(df["playerId"].astype(str))

    # Total possessions (use Phase 3 values)
    df["total_poss"] = df["off_poss_used_p3"] + df["def_poss_used_p3"]
    high_poss = df[df["total_poss"] >= MIN_HIGH_POSS]
    print(f"  {len(high_poss):,} players with {MIN_HIGH_POSS}+ possessions (high-confidence)")

    failures: list[str] = []

    # --- Check 1: DRAPM correlation improvement -----------------------------
    print(f"\n[1] DRAPM between-target correlation improvement")

    # Phase 2 baseline
    r2_drapm = np.corrcoef(df["drapm_actual_p2"], df["drapm_xefg_p2"])[0, 1]
    r2_drapm_hi = np.corrcoef(high_poss["drapm_actual_p2"], high_poss["drapm_xefg_p2"])[0, 1]

    # Phase 3 result
    r3_drapm = np.corrcoef(df["drapm_actual_p3"], df["drapm_xefg_p3"])[0, 1]
    r3_drapm_hi = np.corrcoef(high_poss["drapm_actual_p3"], high_poss["drapm_xefg_p3"])[0, 1]

    print(f"    Phase 2 DRAPM correlation:")
    print(f"      all players:         r = {r2_drapm:.3f}")
    print(f"      high-possession:     r = {r2_drapm_hi:.3f}")
    print(f"    Phase 3 DRAPM correlation:")
    print(f"      all players:         r = {r3_drapm:.3f}")
    print(f"      high-possession:     r = {r3_drapm_hi:.3f}")

    improvement = r3_drapm_hi - r2_drapm_hi
    target_reached = r3_drapm_hi >= 0.7  # substantial improvement toward 0.8+
    ok1 = improvement >= 0.1 and target_reached

    print(f"    Improvement: {improvement:+.3f}")
    print(f"    Target (≥0.7): {'REACHED' if target_reached else 'MISSED'}")
    print(f"    -> {'PASS' if ok1 else 'FAIL'}")

    if not ok1:
        failures.append(f"DRAPM correlation improvement insufficient ({improvement:+.3f})")

    # --- Check 2: ORAPM correlation (should stay high) ----------------------
    r2_orapm_hi = np.corrcoef(high_poss["orapm_actual_p2"], high_poss["orapm_xefg_p2"])[0, 1]
    r3_orapm_hi = np.corrcoef(high_poss["orapm_actual_p3"], high_poss["orapm_xefg_p3"])[0, 1]

    print(f"\n[2] ORAPM correlation (should stay high)")
    print(f"    Phase 2: r = {r2_orapm_hi:.3f}")
    print(f"    Phase 3: r = {r3_orapm_hi:.3f}")

    ok2 = r3_orapm_hi >= 0.3  # should not degrade
    print(f"    -> {'PASS' if ok2 else 'FAIL'}")
    if not ok2:
        failures.append("ORAPM correlation degraded")

    # --- Check 3: Net RAPM top-25 overlap improvement -----------------------
    print(f"\n[3] Top-25 net RAPM overlap improvement")

    # Phase 2 top 25
    top25_p2_actual = set(df.nlargest(25, "rapm_actual_p2")["playerId"])
    top25_p2_xefg = set(df.nlargest(25, "rapm_xefg_p2")["playerId"])
    overlap_p2 = len(top25_p2_actual & top25_p2_xefg)

    # Phase 3 top 25
    top25_p3_actual = set(df.nlargest(25, "rapm_actual_p3")["playerId"])
    top25_p3_xefg = set(df.nlargest(25, "rapm_xefg_p3")["playerId"])
    overlap_p3 = len(top25_p3_actual & top25_p3_xefg)

    print(f"    Phase 2 top-25 overlap: {overlap_p2}/25")
    print(f"    Phase 3 top-25 overlap: {overlap_p3}/25")

    ok3 = overlap_p3 > overlap_p2
    print(f"    -> {'PASS' if ok3 else 'FAIL'}")
    if not ok3:
        failures.append("Top-25 overlap did not improve")

    # --- Check 4: Face validity ---------------------------------------------
    print(f"\n[4] Face validity — top 10 Phase 3 actual RAPM")
    top10 = df.nlargest(10, "rapm_actual_p3")
    for _, r in top10.iterrows():
        print(f"    {r['rapm_actual_p3']:+6.2f}  {r['name']:<26} "
              f"O={r['orapm_actual_p3']:+5.2f} D={r['drapm_actual_p3']:+5.2f} "
              f"poss={r['total_poss']:.0f}")
    print("    (manual eyeball check)")

    # --- Check 5: Distribution sanity ---------------------------------------
    ra_p3 = df["rapm_actual_p3"]
    print(f"\n[5] Phase 3 distribution")
    print(f"    mean={ra_p3.mean():+.3f}  std={ra_p3.std():.3f}  "
          f"range=[{ra_p3.min():+.2f}, {ra_p3.max():+.2f}]")

    insane = df[ra_p3.abs() > 25]
    ok5 = len(insane) == 0 and ra_p3.std() > 1.0 and ra_p3.std() < 6.0
    print(f"    outliers |RAPM|>25: {len(insane)}")
    print(f"    -> {'PASS' if ok5 else 'FAIL'}")
    if not ok5:
        failures.append("Phase 3 distribution problems")

    # --- Summary comparison table -------------------------------------------
    print(f"\n=== PHASE 2 vs PHASE 3 SUMMARY ===")
    print(f"{'Metric':<25} {'Phase 2':<12} {'Phase 3':<12} {'Change':<10}")
    print(f"{'-'*25} {'-'*12} {'-'*12} {'-'*10}")
    print(f"{'DRAPM correlation':<25} {r2_drapm_hi:<12.3f} {r3_drapm_hi:<12.3f} {improvement:+.3f}")
    print(f"{'ORAPM correlation':<25} {r2_orapm_hi:<12.3f} {r3_orapm_hi:<12.3f} "
          f"{r3_orapm_hi - r2_orapm_hi:+.3f}")
    print(f"{'Top-25 overlap':<25} {overlap_p2:<12} {overlap_p3:<12} {overlap_p3 - overlap_p2:+}")
    print(f"{'RAPM std':<25} {df['rapm_actual_p2'].std():<12.3f} {ra_p3.std():<12.3f} "
          f"{ra_p3.std() - df['rapm_actual_p2'].std():+.3f}")

    # --- Verdict -------------------------------------------------------------
    print("\n" + "=" * 70)
    if failures:
        print(f"VERDICT: {len(failures)} CHECK(S) NEED REVIEW")
        for f in failures:
            print(f"  - {f}")
        print(f"\nPhase 3 box-score prior did NOT successfully fix O/D identification.")
    else:
        print("VERDICT: ALL CHECKS PASSED")
        print(f"Phase 3 box-score prior successfully improved O/D identification!")
        print(f"DRAPM correlation improved by {improvement:+.3f} to {r3_drapm_hi:.3f}")


if __name__ == "__main__":
    main()