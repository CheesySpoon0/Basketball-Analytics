#!/usr/bin/env python3
"""
Phase 3b — build box-score prior from Phase 2 RAPM results.

Fits OLS regression: Phase2_RAPM ~ box_score_features to learn coefficients.
These coefficients define the prior for Phase 3's offset ridge regression.

The prior provides separate ORAPM and DRAPM anchors based on traditional stats,
breaking the O/D collinearity that ridge alone cannot resolve.

OUTPUTS:
  scripts/python/rapm/output/boxscore_prior.json

PRIOR FORMULA (fitted from data):
  prior_ORAPM = α_pts * points_per40 + α_ast * assists_per40
              + α_to * turnovers_per40 + α_3p * tp_pct
              + α_ts * ts_pct + intercept_off

  prior_DRAPM = β_blk * blocks_per40 + β_stl * steals_per40
              + β_dreb * dreb_per40 + intercept_def
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.metrics import r2_score

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
OUTPUT_DIR = HERE / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

PHASE2_JSON = OUTPUT_DIR / "rapm_phase2.json"
BOXSCORE_CSV = HERE / "data" / "boxscore_stats.csv"
PRIOR_JSON = OUTPUT_DIR / "boxscore_prior.json"

# Minimum possessions to include in prior fitting (avoid noise from sparse players)
MIN_TOTAL_POSS = 100


def main() -> None:
    if not PHASE2_JSON.exists():
        raise SystemExit(f"Missing {PHASE2_JSON} — run train_rapm.py first.")
    if not BOXSCORE_CSV.exists():
        raise SystemExit(f"Missing {BOXSCORE_CSV} — run extract_boxscore_stats.py first.")

    print("=" * 64)
    print("PHASE 3B — box-score prior from Phase 2 RAPM")
    print("=" * 64)

    # Load Phase 2 RAPM results (actual target only for prior fitting)
    phase2 = json.loads(PHASE2_JSON.read_text())
    rapm_df = pd.DataFrame(phase2["players"])

    # Load box-score stats
    boxscore = pd.read_csv(BOXSCORE_CSV)

    # Merge on playerId
    df = rapm_df.merge(boxscore, on="playerId", how="inner")
    print(f"  {len(df):,} players with both RAPM and box-score data")

    # Filter to players with sufficient possessions for stable estimates
    df["total_poss"] = df["off_poss_used"] + df["def_poss_used"]
    stable = df[df["total_poss"] >= MIN_TOTAL_POSS].copy()
    print(f"  {len(stable):,} players with {MIN_TOTAL_POSS}+ total possessions")

    if len(stable) < 50:
        print("WARNING: Very few stable players for prior fitting.")

    # --- Offensive prior model ---------------------------------------------
    print(f"\n-- Fitting offensive prior (ORAPM ~ box stats) --")

    # Features for offensive impact
    off_features = [
        "points_per40", "assists_per40", "turnovers_per40",
        "tp_pct", "ts_pct"
    ]

    # Check for missing features
    missing_off = [f for f in off_features if f not in stable.columns]
    if missing_off:
        raise SystemExit(f"Missing offensive features: {missing_off}")

    X_off = stable[off_features].values
    y_off = stable["orapm_actual"].values

    # Fit OLS
    off_model = LinearRegression(fit_intercept=True)
    off_model.fit(X_off, y_off)
    off_pred = off_model.predict(X_off)
    off_r2 = r2_score(y_off, off_pred)

    print(f"    features: {off_features}")
    print(f"    R² = {off_r2:.4f}")
    print(f"    coefficients:")
    for i, feat in enumerate(off_features):
        coef = off_model.coef_[i]
        print(f"      {feat:<20}: {coef:+8.4f}")
    print(f"      {'intercept':<20}: {off_model.intercept_:+8.4f}")

    # --- Defensive prior model ---------------------------------------------
    print(f"\n-- Fitting defensive prior (DRAPM ~ box stats) --")

    # Features for defensive impact
    def_features = [
        "blocks_per40", "steals_per40", "dreb_per40"
    ]

    # Check for missing features
    missing_def = [f for f in def_features if f not in stable.columns]
    if missing_def:
        raise SystemExit(f"Missing defensive features: {missing_def}")

    X_def = stable[def_features].values
    y_def = stable["drapm_actual"].values

    # Fit OLS
    def_model = LinearRegression(fit_intercept=True)
    def_model.fit(X_def, y_def)
    def_pred = def_model.predict(X_def)
    def_r2 = r2_score(y_def, def_pred)

    print(f"    features: {def_features}")
    print(f"    R² = {def_r2:.4f}")
    print(f"    coefficients:")
    for i, feat in enumerate(def_features):
        coef = def_model.coef_[i]
        print(f"      {feat:<20}: {coef:+8.4f}")
    print(f"      {'intercept':<20}: {def_model.intercept_:+8.4f}")

    # --- Compute prior for all players -----------------------------------
    print(f"\n-- Computing prior for all {len(df):,} players --")

    # Apply fitted models to full dataset (all players with any possessions)
    X_off_all = df[off_features].values
    X_def_all = df[def_features].values

    df["prior_orapm"] = off_model.predict(X_off_all)
    df["prior_drapm"] = def_model.predict(X_def_all)

    # Summary of prior values
    print(f"    prior ORAPM: mean={df['prior_orapm'].mean():+.3f}, "
          f"std={df['prior_orapm'].std():.3f}, "
          f"range=[{df['prior_orapm'].min():+.2f}, {df['prior_orapm'].max():+.2f}]")
    print(f"    prior DRAPM: mean={df['prior_drapm'].mean():+.3f}, "
          f"std={df['prior_drapm'].std():.3f}, "
          f"range=[{df['prior_drapm'].min():+.2f}, {df['prior_drapm'].max():+.2f}]")

    # --- Save prior model ------------------------------------------------
    prior_data = {
        "phase": "3b",
        "description": "Box-score prior fitted from Phase 2 RAPM",
        "season": phase2["season"],
        "min_possessions_for_fitting": MIN_TOTAL_POSS,
        "n_players_fitted": len(stable),
        "n_players_total": len(df),
        "offensive_model": {
            "features": off_features,
            "coefficients": off_model.coef_.tolist(),
            "intercept": float(off_model.intercept_),
            "r_squared": off_r2
        },
        "defensive_model": {
            "features": def_features,
            "coefficients": def_model.coef_.tolist(),
            "intercept": float(def_model.intercept_),
            "r_squared": def_r2
        },
        "players": [
            {
                "playerId": int(row["playerId"]),
                "prior_orapm": float(row["prior_orapm"]),
                "prior_drapm": float(row["prior_drapm"]),
                "total_poss": int(row["total_poss"])
            }
            for _, row in df.iterrows()
        ]
    }

    PRIOR_JSON.write_text(json.dumps(prior_data, indent=2))
    print(f"\nWrote prior model to {PRIOR_JSON.relative_to(REPO_ROOT)}")

    # --- Validation checks -----------------------------------------------
    print(f"\n=== Prior validation ===")

    # Compute prior for the stable subset for validation
    X_off_stable = stable[off_features].values
    X_def_stable = stable[def_features].values
    stable_prior_off = off_model.predict(X_off_stable)
    stable_prior_def = def_model.predict(X_def_stable)
    stable_actual_off = stable["orapm_actual"].values
    stable_actual_def = stable["drapm_actual"].values

    corr_off = np.corrcoef(stable_prior_off, stable_actual_off)[0, 1]
    corr_def = np.corrcoef(stable_prior_def, stable_actual_def)[0, 1]

    print(f"  prior-actual correlation (stable players only):")
    print(f"    ORAPM: r = {corr_off:.3f}")
    print(f"    DRAPM: r = {corr_def:.3f}")

    # Show top/bottom 5 by prior vs actual for sense check
    print(f"\n  Top 5 by offensive prior:")
    stable_copy = stable.copy()
    stable_copy["prior_orapm"] = stable_prior_off
    stable_copy["prior_drapm"] = stable_prior_def
    top_off = stable_copy.nlargest(5, "prior_orapm")[["name", "team", "prior_orapm", "orapm_actual"]]
    for _, r in top_off.iterrows():
        print(f"    {r['prior_orapm']:+5.2f} → {r['orapm_actual']:+5.2f}  {r['name']} ({r['team']})")

    print(f"\n  Top 5 by defensive prior:")
    top_def = stable_copy.nlargest(5, "prior_drapm")[["name", "team", "prior_drapm", "drapm_actual"]]
    for _, r in top_def.iterrows():
        print(f"    {r['prior_drapm']:+5.2f} → {r['drapm_actual']:+5.2f}  {r['name']} ({r['team']})")


if __name__ == "__main__":
    main()