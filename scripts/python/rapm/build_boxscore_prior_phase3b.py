#!/usr/bin/env python3
"""
Phase 3B — independent box-score priors (no RAPM dependency).

Builds offensive and defensive priors using ONLY individual box-score stats,
with NO dependency on Phase 2 RAPM, team outcomes, or any RAPM-derived metrics.

DEFENSIVE PRIOR:
  Uses deterministic z-score combination with sign-constrained weights:
  defensive_prior = +w1*z(steals) + w2*z(blocks) + w3*z(dreb) - w4*z(fouls)

OFFENSIVE PRIOR:
  Uses deterministic z-score combination:
  offensive_prior = +w1*z(points) + w2*z(assists) - w3*z(turnovers) + w4*z(ts_pct)

No regression on corrupted RAPM targets. All weights have correct signs by construction.

OUTPUTS:
  scripts/python/rapm/output/boxscore_prior_phase3b.json
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
OUTPUT_DIR = HERE / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

BOXSCORE_CSV = HERE / "data" / "boxscore_stats.csv"
PRIOR_JSON = OUTPUT_DIR / "boxscore_prior_phase3b.json"

# Minimum possessions to include in validation calculations
MIN_TOTAL_POSS = 100

# Sign-constrained weights for deterministic priors
OFFENSIVE_WEIGHTS = {
    "points_per40": +0.10,     # more points = better offense
    "assists_per40": +0.15,    # more assists = better offense
    "turnovers_per40": -0.12,  # more turnovers = worse offense
    "ts_pct": +3.0,           # higher TS% = better offense
    "tp_pct": +1.0            # higher 3P% = better offense (bonus)
}

DEFENSIVE_WEIGHTS = {
    "steals_per40": +0.20,     # more steals = better defense
    "blocks_per40": +0.25,     # more blocks = better defense
    "dreb_per40": +0.08,       # more defensive boards = better defense
    "fouls_per40": -0.10       # more fouls = worse defense
}

# Scale factor to convert z-score priors to reasonable RAPM-like range
OFFENSIVE_SCALE = 1.2
DEFENSIVE_SCALE = 0.8


def compute_z_scores(series: pd.Series) -> pd.Series:
    """Standardize to z-scores, handling zero variance."""
    if series.std() == 0:
        return pd.Series(0.0, index=series.index)
    return (series - series.mean()) / series.std()


def main() -> None:
    print("=" * 64)
    print("PHASE 3B — independent box-score priors (no RAPM dependency)")
    print("=" * 64)

    if not BOXSCORE_CSV.exists():
        raise SystemExit(f"Missing {BOXSCORE_CSV} — run extract_boxscore_stats.py first.")

    # Load box-score stats
    df = pd.read_csv(BOXSCORE_CSV)
    print(f"  {len(df):,} players with box-score data")

    # Filter to players with some playing time for meaningful stats
    active = df[df["minutes"] > 0].copy()
    print(f"  {len(active):,} players with >0 minutes")

    # Use fouls per 40 minutes (already computed in extraction)
    # No need for per-game calculation

    # --- Offensive prior (z-score combination) ------------------------------
    print(f"\n-- Building offensive prior (z-score combination) --")
    print(f"    weights: {OFFENSIVE_WEIGHTS}")

    off_prior = pd.Series(0.0, index=active.index)
    for feature, weight in OFFENSIVE_WEIGHTS.items():
        if feature in active.columns:
            z_vals = compute_z_scores(active[feature])
            off_prior += weight * z_vals
            print(f"      {feature:<20}: weight={weight:+6.2f}, "
                  f"mean={active[feature].mean():6.2f}, std={active[feature].std():6.2f}")
        else:
            print(f"      {feature:<20}: MISSING - skipped")

    off_prior *= OFFENSIVE_SCALE
    active["prior_orapm"] = off_prior

    print(f"    offensive prior: mean={off_prior.mean():+.3f}, "
          f"std={off_prior.std():.3f}, range=[{off_prior.min():+.2f}, {off_prior.max():+.2f}]")

    # --- Defensive prior (z-score combination) ------------------------------
    print(f"\n-- Building defensive prior (z-score combination) --")
    print(f"    weights: {DEFENSIVE_WEIGHTS}")

    def_prior = pd.Series(0.0, index=active.index)
    for feature, weight in DEFENSIVE_WEIGHTS.items():
        if feature in active.columns:
            z_vals = compute_z_scores(active[feature])
            def_prior += weight * z_vals
            print(f"      {feature:<20}: weight={weight:+6.2f}, "
                  f"mean={active[feature].mean():6.2f}, std={active[feature].std():6.2f}")
        else:
            print(f"      {feature:<20}: MISSING - skipped")

    def_prior *= DEFENSIVE_SCALE
    active["prior_drapm"] = def_prior

    print(f"    defensive prior: mean={def_prior.mean():+.3f}, "
          f"std={def_prior.std():.3f}, range=[{def_prior.min():+.2f}, {def_prior.max():+.2f}]")

    # --- Extend to all players (fill zeros for inactive) --------------------
    df = df.merge(
        active[["playerId", "prior_orapm", "prior_drapm"]],
        on="playerId",
        how="left"
    )
    df["prior_orapm"] = df["prior_orapm"].fillna(0.0)
    df["prior_drapm"] = df["prior_drapm"].fillna(0.0)

    print(f"\n-- Extended to all {len(df):,} players (inactive get zero prior) --")

    # --- Save prior model ------------------------------------------------
    prior_data = {
        "phase": "3b",
        "description": "Independent box-score priors (z-score, sign-constrained)",
        "season": 2026,  # hardcoded for now
        "method": "deterministic_z_score",
        "no_rapm_dependency": True,
        "offensive_weights": OFFENSIVE_WEIGHTS,
        "defensive_weights": DEFENSIVE_WEIGHTS,
        "offensive_scale": OFFENSIVE_SCALE,
        "defensive_scale": DEFENSIVE_SCALE,
        "n_players_total": len(df),
        "n_players_active": len(active),
        "players": [
            {
                "playerId": int(row["playerId"]),
                "prior_orapm": float(row["prior_orapm"]),
                "prior_drapm": float(row["prior_drapm"])
            }
            for _, row in df.iterrows()
        ]
    }

    PRIOR_JSON.write_text(json.dumps(prior_data, indent=2))
    print(f"\nWrote independent prior to {PRIOR_JSON.relative_to(REPO_ROOT)}")

    # --- Hard sanity tests -----------------------------------------------
    print(f"\n=== Hard sanity tests ===")

    # Find players for sanity checks (use name matching if available)
    stable_active = active[active["minutes"] >= 200].copy()  # substantial playing time
    if len(stable_active) == 0:
        stable_active = active  # fallback

    # Test 1: High blocks + high DREB + low fouls should have positive defensive prior
    defense_composite = (
        stable_active["blocks_per40"] +
        stable_active["dreb_per40"] -
        stable_active["fouls_per40"] * 5  # scale fouls to comparable magnitude
    )
    top_defender = stable_active.loc[defense_composite.idxmax()]

    print(f"  Test 1 - Elite rim protector: {top_defender.get('name', 'Unknown')} (id {top_defender['playerId']})")
    print(f"    blocks/40={top_defender['blocks_per40']:.1f}, dreb/40={top_defender['dreb_per40']:.1f}, "
          f"fouls/40={top_defender['fouls_per40']:.1f}")
    print(f"    defensive prior: {top_defender['prior_drapm']:+.3f} "
          f"-> {'PASS' if top_defender['prior_drapm'] > 0 else 'FAIL'}")

    # Test 2: High steals should have positive defensive prior
    top_stealer = stable_active.loc[stable_active["steals_per40"].idxmax()]
    print(f"  Test 2 - Elite stealer: {top_stealer.get('name', 'Unknown')} (id {top_stealer['playerId']})")
    print(f"    steals/40={top_stealer['steals_per40']:.1f}")
    print(f"    defensive prior: {top_stealer['prior_drapm']:+.3f} "
          f"-> {'PASS' if top_stealer['prior_drapm'] > 0 else 'FAIL'}")

    # Test 3: High scorer should have positive offensive prior
    top_scorer = stable_active.loc[stable_active["points_per40"].idxmax()]
    print(f"  Test 3 - Elite scorer: {top_scorer.get('name', 'Unknown')} (id {top_scorer['playerId']})")
    print(f"    points/40={top_scorer['points_per40']:.1f}, TS%={top_scorer['ts_pct']:.3f}")
    print(f"    offensive prior: {top_scorer['prior_orapm']:+.3f} "
          f"-> {'PASS' if top_scorer['prior_orapm'] > 0 else 'FAIL'}")

    # Test 4: High foul, low stocks should not get strong positive defensive prior
    foul_heavy = stable_active[stable_active["fouls_per40"] > stable_active["fouls_per40"].quantile(0.9)]
    low_stocks = foul_heavy[
        (foul_heavy["steals_per40"] < foul_heavy["steals_per40"].median()) &
        (foul_heavy["blocks_per40"] < foul_heavy["blocks_per40"].median())
    ]
    if len(low_stocks) > 0:
        worst_defender = low_stocks.loc[low_stocks["prior_drapm"].idxmin()]
        print(f"  Test 4 - High fouls, low stocks: {worst_defender.get('name', 'Unknown')} (id {worst_defender['playerId']})")
        print(f"    fouls/40={worst_defender['fouls_per40']:.1f}, "
              f"steals/40={worst_defender['steals_per40']:.1f}, blocks/40={worst_defender['blocks_per40']:.1f}")
        print(f"    defensive prior: {worst_defender['prior_drapm']:+.3f} "
              f"-> {'PASS' if worst_defender['prior_drapm'] < 0.5 else 'FAIL'}")
    else:
        print(f"  Test 4 - No high-foul, low-stocks players found")

    # Cross-correlation check
    corr_off_def = np.corrcoef(df["prior_orapm"], df["prior_drapm"])[0, 1]
    print(f"\n  Cross-correlation: offensive vs defensive prior = {corr_off_def:.3f}")
    print(f"    -> {'PASS' if abs(corr_off_def) < 0.3 else 'FAIL'} (should be roughly independent)")


if __name__ == "__main__":
    main()