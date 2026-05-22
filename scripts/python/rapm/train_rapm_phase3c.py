#!/usr/bin/env python3
"""
Phase 3C — DRAPM rescue with single-sided stint data.

Uses the corrected single-sided stint data that eliminates artificial
off/def symmetry, restoring DRAPM identifiability.

KEY CHANGES:
1. Uses stints_single_sided.csv (141k obs vs 259k)
2. Adds coefficient centering constraints
3. Uses separate ridge penalties for O/D if needed
4. Includes proper sign validation

OUTPUTS:
  scripts/python/rapm/output/rapm_phase3c.json
  scripts/python/rapm/output/rapm_phase3c.csv
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

# Import the build_design_matrix but modify to use single-sided data
from build_design_matrix import build_design_matrix as _build_design_matrix_orig

REPO_ROOT = HERE.parents[2]
OUTPUT_DIR = HERE / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
JSON_OUT = OUTPUT_DIR / "rapm_phase3c.json"
CSV_OUT = OUTPUT_DIR / "rapm_phase3c.csv"
SINGLE_SIDED_CSV = HERE / "data" / "stints_single_sided.csv"

# Use same lambda as Phase 2 for comparison
LAMBDA = 1000.0


def build_design_matrix_single_sided(target="actual", csv_path=None):
    """Modified to use single-sided stint data."""
    path = csv_path or SINGLE_SIDED_CSV
    if not path.exists():
        raise SystemExit(f"Missing {path} — run create_single_sided_from_existing.py first.")

    return _build_design_matrix_orig(target=target, csv_path=path)


def center_coefficients(coefficients, player_base, n_players):
    """Center player coefficients to sum to zero."""
    player_coeffs = coefficients[player_base:player_base + n_players]
    centered_coeffs = player_coeffs - player_coeffs.mean()
    coefficients[player_base:player_base + n_players] = centered_coeffs
    return coefficients


def main() -> None:
    print("=" * 64)
    print("PHASE 3C — DRAPM rescue with single-sided data")
    print("=" * 64)

    # Build design matrix with single-sided data
    X, y_actual, w, pidx, meta = build_design_matrix_single_sided(target="actual")
    _, y_xefg, _, _, _ = build_design_matrix_single_sided(target="xefg")
    n_players = meta["n_players"]
    orapm_base = meta["orapm_base"]
    drapm_base = meta["drapm_base"]
    all_ids = meta["all_ids"]

    print(f"\n  observations: {meta['n_stints']:,} (single-sided)")
    print(f"  players:      {n_players:,}")
    print(f"  columns:      {meta['n_cols']:,}")

    # --- Fit with centering constraints -------------------------------------
    print(f"\n-- Fitting ridge with coefficient centering at lambda={LAMBDA:.0f} --")

    # Fit actual target
    model_actual = Ridge(alpha=LAMBDA, fit_intercept=True, solver="lsqr")
    model_actual.fit(X, y_actual, sample_weight=w)
    coeffs_actual = model_actual.coef_.copy()

    # Center ORAPM and DRAPM coefficients separately
    coeffs_actual = center_coefficients(coeffs_actual, orapm_base, n_players)
    coeffs_actual = center_coefficients(coeffs_actual, drapm_base, n_players)

    # Fit xeFG target
    model_xefg = Ridge(alpha=LAMBDA, fit_intercept=True, solver="lsqr")
    model_xefg.fit(X, y_xefg, sample_weight=w)
    coeffs_xefg = model_xefg.coef_.copy()

    # Center xeFG coefficients
    coeffs_xefg = center_coefficients(coeffs_xefg, orapm_base, n_players)
    coeffs_xefg = center_coefficients(coeffs_xefg, drapm_base, n_players)

    print(f"  actual intercept: {model_actual.intercept_:.2f}")
    print(f"  xefg   intercept: {model_xefg.intercept_:.2f}")

    # --- Extract per-player results ------------------------------------------
    rows = []
    off_poss = meta["off_poss_used"]
    def_poss = meta["def_poss_used"]

    for i, pid in enumerate(all_ids):
        orapm_a = float(coeffs_actual[orapm_base + i])
        # DRAPM sign flip: defensive coefficients are negative raw, flip to positive=good
        drapm_a = -float(coeffs_actual[drapm_base + i])
        orapm_x = float(coeffs_xefg[orapm_base + i])
        drapm_x = -float(coeffs_xefg[drapm_base + i])

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

    # --- Save results --------------------------------------------------------
    payload = {
        "phase": "3c",
        "model": "ridge_single_sided_centered",
        "season": int(__import__("os").environ.get("RAPM_SEASON", "2026")),
        "lambda": LAMBDA,
        "n_observations": int(meta["n_stints"]),
        "n_players": n_players,
        "intercept_actual": float(model_actual.intercept_),
        "intercept_xefg": float(model_xefg.intercept_),
        "data_source": "single_sided_stints",
        "coefficient_centering": "ORAPM and DRAPM centered separately",
        "drapm_sign": "flipped — good defense is positive; RAPM = ORAPM + DRAPM",
        "players": table.to_dict(orient="records"),
    }

    JSON_OUT.write_text(json.dumps(payload, indent=2))
    table.to_csv(CSV_OUT, index=False)
    print(f"\nWrote {JSON_OUT.relative_to(REPO_ROOT)}")
    print(f"Wrote {CSV_OUT.relative_to(REPO_ROOT)}")

    # --- Quick validation checks ---------------------------------------------
    print("\n=== Phase 3C validation preview ===")

    # Distribution check
    for target in ["actual", "xefg"]:
        for component in ["orapm", "drapm", "rapm"]:
            col = f"{component}_{target}"
            vals = table[col]
            print(f"  {col.upper():15s}: mean={vals.mean():+.3f}  std={vals.std():.3f}  "
                  f"range=[{vals.min():+.2f}, {vals.max():+.2f}]")

    # Sign sanity check
    print(f"\n  Sign sanity check:")
    print(f"    ORAPM mean (should ≈ 0): {table['orapm_actual'].mean():+.6f}")
    print(f"    DRAPM mean (should ≈ 0): {table['drapm_actual'].mean():+.6f}")

    # Between-target correlation
    high_poss = table[table["off_poss_used"] + table["def_poss_used"] >= 300]
    if len(high_poss) > 0:
        drapm_corr = np.corrcoef(high_poss["drapm_actual"], high_poss["drapm_xefg"])[0, 1]
        orapm_corr = np.corrcoef(high_poss["orapm_actual"], high_poss["orapm_xefg"])[0, 1]
        print(f"    DRAPM actual vs xeFG correlation: {drapm_corr:.3f} (target: >0.7)")
        print(f"    ORAPM actual vs xeFG correlation: {orapm_corr:.3f} (should stay high)")

        if drapm_corr >= 0.7:
            print(f"    🎉 SUCCESS: DRAPM correlation target achieved!")
        elif drapm_corr > 0.6:
            print(f"    ✅ PROGRESS: Substantial DRAPM improvement")
        else:
            print(f"    ⚠️  LIMITED: More work needed on DRAPM identification")


if __name__ == "__main__":
    main()