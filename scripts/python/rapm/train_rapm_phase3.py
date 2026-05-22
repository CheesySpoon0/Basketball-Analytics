#!/usr/bin/env python3
"""
Phase 3 — box-score prior RAPM (offset ridge regression).

Uses the box-score prior from build_boxscore_prior.py to anchor O/D identification.
Instead of shrinking toward zero, shrinks each player toward their predicted RAPM
from traditional stats. This breaks the O/D collinearity that pure ridge cannot resolve.

MATHEMATICAL STRUCTURE:
  Standard ridge:     min ||y - X β||²_w + λ ||β||²
  Box-score prior:    min ||y - X β||²_w + λ ||β - β_prior||²

Implemented as offset regression:
  y_offset = y - X @ β_prior
  β_offset = Ridge(X, y_offset, alpha=λ)
  β_final = β_offset + β_prior

OUTPUTS:
  scripts/python/rapm/output/rapm_phase3.json   — per-player table, both targets
  scripts/python/rapm/output/rapm_phase3.csv    — same, flat CSV
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from build_design_matrix import build_design_matrix  # noqa: E402

REPO_ROOT = HERE.parents[2]
OUTPUT_DIR = HERE / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
JSON_OUT = OUTPUT_DIR / "rapm_phase3.json"
CSV_OUT = OUTPUT_DIR / "rapm_phase3.csv"
PRIOR_JSON = OUTPUT_DIR / "boxscore_prior.json"

# Use same lambda as Phase 2 for comparison
LAMBDA = 1000.0


def cross_validate_lambda(X, y, w, beta_prior, grid=[300.0, 1000.0, 3000.0], n_folds=5):
    """k-fold CV for offset ridge. Returns (best_lambda, cv_results)."""
    rng = np.random.default_rng(42)
    n = X.shape[0]
    fold_id = rng.integers(0, n_folds, size=n)

    results = []
    for lam in grid:
        fold_mses = []
        for k in range(n_folds):
            test = fold_id == k
            train = ~test

            # Offset target
            X_prior_train = X[train] @ beta_prior
            y_offset_train = y[train] - X_prior_train

            # Fit ridge on offset
            model = Ridge(alpha=lam, fit_intercept=True, solver="lsqr")
            model.fit(X[train], y_offset_train, sample_weight=w[train])

            # Predict: β_final = β_offset + β_prior applied to original target
            pred = model.predict(X[test]) + X[test] @ beta_prior
            err2 = (pred - y[test]) ** 2
            wmse = np.average(err2, weights=w[test])
            fold_mses.append(wmse)

        mean_wmse = float(np.mean(fold_mses))
        results.append((lam, mean_wmse))
        print(f"    lambda={lam:>8.0f}   weighted MSE={mean_wmse:.4f}")

    best = min(results, key=lambda r: r[1])[0]
    return best, results


def fit_offset_ridge(X, y, w, beta_prior, lam):
    """Fit offset ridge: min ||y - X β||²_w + λ ||β - β_prior||²."""
    # Transform to standard ridge on offset target
    X_prior = X @ beta_prior
    y_offset = y - X_prior

    model = Ridge(alpha=lam, fit_intercept=True, solver="lsqr")
    model.fit(X, y_offset, sample_weight=w)

    # Recover final coefficients
    beta_final = model.coef_ + beta_prior
    intercept_final = model.intercept_

    return beta_final, intercept_final, model


def main() -> None:
    print("=" * 64)
    print("PHASE 3 — box-score prior RAPM (offset ridge)")
    print("=" * 64)

    if not PRIOR_JSON.exists():
        raise SystemExit(f"Missing {PRIOR_JSON} — run build_boxscore_prior.py first.")

    # Load prior model
    prior_data = json.loads(PRIOR_JSON.read_text())
    prior_players = {p["playerId"]: p for p in prior_data["players"]}
    print(f"  Loaded box-score prior for {len(prior_players):,} players")

    # Build design matrix (same as Phase 2)
    X, y_actual, w, pidx, meta = build_design_matrix(target="actual")
    _, y_xefg, _, _, _ = build_design_matrix(target="xefg")
    n_players = meta["n_players"]
    orapm_base = meta["orapm_base"]
    drapm_base = meta["drapm_base"]
    all_ids = meta["all_ids"]

    print(f"\n  observations: {meta['n_stints']:,}")
    print(f"  players:      {n_players:,}")
    print(f"  columns:      {meta['n_cols']:,}")

    # --- Construct prior coefficient vector β_prior -------------------------
    print(f"\n-- Building prior coefficient vector --")
    beta_prior = np.zeros(meta["n_cols"])

    matched = 0
    for i, pid in enumerate(all_ids):
        if pid in prior_players:
            prior_orapm = prior_players[pid]["prior_orapm"]
            prior_drapm = prior_players[pid]["prior_drapm"]
            beta_prior[orapm_base + i] = prior_orapm
            beta_prior[drapm_base + i] = -prior_drapm  # negate for -1 column convention
            matched += 1

    print(f"    {matched:,} players have box-score priors")
    print(f"    {n_players - matched:,} players default to zero prior")
    print(f"    prior ORAPM range: [{beta_prior[orapm_base:orapm_base+n_players].min():+.2f}, "
          f"{beta_prior[orapm_base:orapm_base+n_players].max():+.2f}]")
    # DRAPM prior is negated, so flip signs for display
    drapm_prior_display = -beta_prior[drapm_base:drapm_base+n_players]
    print(f"    prior DRAPM range: [{drapm_prior_display.min():+.2f}, "
          f"{drapm_prior_display.max():+.2f}]")

    # --- Cross-validate lambda (optional - using Phase 2 value) ------------
    use_cv = False
    if use_cv:
        print(f"\n-- Cross-validating lambda (actual target) --")
        best_lambda, cv_results = cross_validate_lambda(X, y_actual, w, beta_prior)
        print(f"  -> selected lambda = {best_lambda:.0f}")
    else:
        best_lambda = LAMBDA
        cv_results = [(best_lambda, 0.0)]  # placeholder
        print(f"\n-- Using fixed lambda = {best_lambda:.0f} (same as Phase 2) --")

    # --- Fit both targets at chosen lambda ----------------------------------
    print(f"\n-- Fitting offset ridge at lambda={best_lambda:.0f} --")

    # Actual target
    beta_actual, intercept_actual, model_actual = fit_offset_ridge(
        X, y_actual, w, beta_prior, best_lambda
    )

    # xeFG target
    beta_xefg, intercept_xefg, model_xefg = fit_offset_ridge(
        X, y_xefg, w, beta_prior, best_lambda
    )

    print(f"  actual intercept: {intercept_actual:.2f}")
    print(f"  xefg   intercept: {intercept_xefg:.2f}")

    # --- Extract per-player results ------------------------------------------
    rows = []
    off_poss = meta["off_poss_used"]
    def_poss = meta["def_poss_used"]

    for i, pid in enumerate(all_ids):
        orapm_a = float(beta_actual[orapm_base + i])
        drapm_a = -float(beta_actual[drapm_base + i])  # flip back to positive=good
        orapm_x = float(beta_xefg[orapm_base + i])
        drapm_x = -float(beta_xefg[drapm_base + i])

        # Prior values for this player
        prior_o = prior_players.get(pid, {}).get("prior_orapm", 0.0)
        prior_d = prior_players.get(pid, {}).get("prior_drapm", 0.0)

        rows.append({
            "playerId": pid,
            "off_poss_used": float(off_poss[i]),
            "def_poss_used": float(def_poss[i]),
            "orapm_actual": orapm_a,
            "drapm_actual": drapm_a,
            "rapm_actual": orapm_a + drapm_a,
            "orapm_xefg": orapm_x,
            "drapm_xefg": drapm_x,
            "rapm_xefg": orapm_x + drapm_x,
            "prior_orapm": prior_o,
            "prior_drapm": prior_d,
        })

    table = pd.DataFrame(rows)

    # --- Save results ----------------------------------------------------
    payload = {
        "phase": 3,
        "model": "ridge_boxscore_prior",
        "season": int(__import__("os").environ.get("RAPM_SEASON", "2026")),
        "lambda": best_lambda,
        "n_observations": int(meta["n_stints"]),
        "n_players": n_players,
        "n_players_with_prior": matched,
        "intercept_actual": float(intercept_actual),
        "intercept_xefg": float(intercept_xefg),
        "cv_results": [{"lambda": l, "weighted_mse": m} for l, m in cv_results],
        "prior_source": "Phase 2 RAPM → box-score OLS",
        "drapm_sign": "flipped — good defense is positive; RAPM = ORAPM + DRAPM",
        "players": table.to_dict(orient="records"),
    }

    JSON_OUT.write_text(json.dumps(payload, indent=2))
    table.to_csv(CSV_OUT, index=False)
    print(f"\nWrote {JSON_OUT.relative_to(REPO_ROOT)}")
    print(f"Wrote {CSV_OUT.relative_to(REPO_ROOT)}")

    # --- Distribution comparison with Phase 2 -------------------------------
    print("\n=== Phase 3 vs Phase 2 distribution comparison ===")
    for target in ["actual", "xefg"]:
        col = f"rapm_{target}"
        ra = table[col]
        print(f"  RAPM_{target}: mean={ra.mean():+.3f}  std={ra.std():.3f}  "
              f"range=[{ra.min():+.2f}, {ra.max():+.2f}]")


if __name__ == "__main__":
    main()