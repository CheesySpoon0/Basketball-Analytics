#!/usr/bin/env python3
"""
Phase 2 — classic ridge RAPM (shrink toward zero). The safety checkpoint.

This fits a possession-weighted ridge regression on the two-block design
matrix from build_design_matrix.py, for BOTH targets (actual points/100 and
xeFG points/100). The prior mean is zero — coefficients are deviations from
league-average PPP. Phase 3 will swap the zero prior for a box-score prior;
this zero-prior fit is kept forever as the comparison baseline.

OUTPUTS:
  scripts/python/rapm/output/rapm_phase2.json   — per-player table, both targets
  scripts/python/rapm/output/rapm_phase2.csv    — same, flat CSV

MODEL:
  sklearn.linear_model.Ridge, sample_weight = possessions, fit_intercept = True.
  The intercept absorbs league-average PPP so coefficients are deviations.

  Column layout (from build_design_matrix): [ORAPM block | DRAPM block | home].
  Defenders enter the matrix as -1 against an offense-points target, so the
  raw DRAPM-block coefficient is already "points/100 saved" for a good
  defender (negative effect on opponent points * -1 column = positive raw
  coef). We store DRAPM with the flip convention agreed in Phase 1:
  GOOD DEFENSE = POSITIVE DRAPM, and RAPM = ORAPM + DRAPM.

LAMBDA:
  Selected by k-fold CV over a log grid (see cross_validate_lambda). Folds are
  over stints/observations, scored by possession-weighted held-out MSE.
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
JSON_OUT = OUTPUT_DIR / "rapm_phase2.json"
CSV_OUT = OUTPUT_DIR / "rapm_phase2.csv"

LAMBDA_GRID = [10.0, 30.0, 100.0, 300.0, 1000.0, 3000.0, 10000.0]
N_FOLDS = 5
SEED = 42


def cross_validate_lambda(X, y, w, grid=LAMBDA_GRID, n_folds=N_FOLDS):
    """k-fold CV over the lambda grid. Folds are over observations (stints).
    Score = possession-weighted MSE on the held-out fold. Returns
    (best_lambda, list of (lambda, mean_weighted_mse))."""
    rng = np.random.default_rng(SEED)
    n = X.shape[0]
    fold_id = rng.integers(0, n_folds, size=n)

    results = []
    for lam in grid:
        fold_mses = []
        for k in range(n_folds):
            test = fold_id == k
            train = ~test
            model = Ridge(alpha=lam, fit_intercept=True, solver="lsqr")
            model.fit(X[train], y[train], sample_weight=w[train])
            pred = model.predict(X[test])
            err2 = (pred - y[test]) ** 2
            wmse = np.average(err2, weights=w[test])
            fold_mses.append(wmse)
        mean_wmse = float(np.mean(fold_mses))
        results.append((lam, mean_wmse))
        print(f"    lambda={lam:>8.0f}   weighted MSE={mean_wmse:.4f}")
    best = min(results, key=lambda r: r[1])[0]
    return best, results


def fit_target(X, y, w, lam):
    """Fit the production ridge at the chosen lambda. Returns the model."""
    model = Ridge(alpha=lam, fit_intercept=True, solver="sparse_cg")
    model.fit(X, y, sample_weight=w)
    return model


def main() -> None:
    print("=" * 64)
    print("PHASE 2 — classic ridge RAPM (zero prior)")
    print("=" * 64)

    # X is identical across targets; build once with the actual target, reuse.
    X, y_actual, w, pidx, meta = build_design_matrix(target="actual")
    _, y_xefg, _, _, _ = build_design_matrix(target="xefg")
    n_players = meta["n_players"]
    orapm_base = meta["orapm_base"]
    drapm_base = meta["drapm_base"]

    print(f"\n  observations: {meta['n_stints']:,}")
    print(f"  players:      {n_players:,}")
    print(f"  columns:      {meta['n_cols']:,}")

    # --- 2b. Tune lambda on the ACTUAL target -------------------------------
    print(f"\n-- Cross-validating lambda ({N_FOLDS}-fold, actual target) --")
    best_lambda, cv_results = cross_validate_lambda(X, y_actual, w)
    print(f"  -> selected lambda = {best_lambda:.0f}")

    # --- 2a. Fit both targets at the chosen lambda --------------------------
    print(f"\n-- Fitting ridge at lambda={best_lambda:.0f} --")
    model_actual = fit_target(X, y_actual, w, best_lambda)
    model_xefg = fit_target(X, y_xefg, w, best_lambda)
    print(f"  actual intercept (league avg pts/100): "
          f"{model_actual.intercept_:.2f}")
    print(f"  xefg   intercept (league avg pts/100): "
          f"{model_xefg.intercept_:.2f}")

    # --- 2c. Assemble per-player output -------------------------------------
    ca, cx = model_actual.coef_, model_xefg.coef_
    all_ids = meta["all_ids"]
    off_poss = meta["off_poss_used"]
    def_poss = meta["def_poss_used"]

    rows = []
    for i, pid in enumerate(all_ids):
        orapm_a = float(ca[orapm_base + i])
        # DRAPM flip: good defense -> positive. The raw -1-column coefficient
        # is already "points saved"; we negate sklearn's raw coef so that a
        # coefficient indicating fewer opponent points reads as positive.
        drapm_a = -float(ca[drapm_base + i])
        orapm_x = float(cx[orapm_base + i])
        drapm_x = -float(cx[drapm_base + i])
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
        })
    table = pd.DataFrame(rows)

    payload = {
        "phase": 2,
        "model": "ridge_zero_prior",
        "season": int(__import__("os").environ.get("RAPM_SEASON", "2026")),
        "lambda": best_lambda,
        "n_observations": int(meta["n_stints"]),
        "n_players": n_players,
        "intercept_actual": float(model_actual.intercept_),
        "intercept_xefg": float(model_xefg.intercept_),
        "cv_results": [{"lambda": l, "weighted_mse": m} for l, m in cv_results],
        "drapm_sign": "flipped — good defense is positive; RAPM = ORAPM + DRAPM",
        "players": table.to_dict(orient="records"),
    }
    JSON_OUT.write_text(json.dumps(payload, indent=2))
    table.to_csv(CSV_OUT, index=False)
    print(f"\nWrote {JSON_OUT.relative_to(REPO_ROOT)}")
    print(f"Wrote {CSV_OUT.relative_to(REPO_ROOT)}")

    # --- Quick distribution sanity ------------------------------------------
    print("\n=== RAPM_actual distribution ===")
    ra = table["rapm_actual"]
    print(f"  mean={ra.mean():+.3f}  std={ra.std():.3f}  "
          f"min={ra.min():+.2f}  max={ra.max():+.2f}")
    print(f"  players: {len(table):,}")


if __name__ == "__main__":
    main()
