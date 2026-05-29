#!/usr/bin/env python3
"""
Simplified Lambda Grid Validation for RAPM Models

Retrain RAPM models with different lambda values using full dataset.
Uses actual RAPM training pipeline with real stint data.

IMPORTANT: This does NOT overwrite production PlayerImpact data.
Results are saved to separate JSON files for validation.
"""
import json
import sys
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
import warnings
warnings.filterwarnings('ignore')

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

# Import existing infrastructure
from build_design_matrix import build_design_matrix as _build_design_matrix_orig

REPO_ROOT = HERE.parents[2]
OUTPUT_DIR = HERE / "output" / "lambda_grid"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SINGLE_SIDED_CSV = HERE / "data" / "stints_single_sided.csv"

# Lambda values to test
LAMBDAS = [1000, 750, 500, 400, 300, 250]

def build_design_matrix_single_sided(target="actual", csv_path=None):
    """Modified to use single-sided stint data."""
    path = csv_path or SINGLE_SIDED_CSV
    if not path.exists():
        raise SystemExit(f"Missing {path} — run stint extraction first.")

    return _build_design_matrix_orig(target=target, csv_path=path)

def center_coefficients(coefficients, player_base, n_players):
    """Center player coefficients to sum to zero."""
    player_coeffs = coefficients[player_base:player_base + n_players]
    centered_coeffs = player_coeffs - player_coeffs.mean()
    coefficients[player_base:player_base + n_players] = centered_coeffs
    return coefficients

def train_rapm_lambda(lambda_val, X, y, w, meta):
    """Train RAPM with specific lambda and return results."""

    n_players = meta["n_players"]
    orapm_base = meta["orapm_base"]
    drapm_base = meta["drapm_base"]
    all_ids = meta["all_ids"]

    print(f"\n--- Training RAPM with λ={lambda_val} ---")

    # Fit model
    model = Ridge(alpha=lambda_val, fit_intercept=True, solver="lsqr")
    model.fit(X, y, sample_weight=w)
    coeffs = model.coef_.copy()

    # Center ORAPM and DRAPM coefficients separately
    coeffs = center_coefficients(coeffs, orapm_base, n_players)
    coeffs = center_coefficients(coeffs, drapm_base, n_players)

    # Calculate in-sample fit metrics (not ideal for validation but useful)
    y_pred = model.predict(X)
    mse = np.mean((y - y_pred) ** 2)
    r_squared = 1 - (mse / np.var(y))

    # Extract per-player results
    off_poss = meta["off_poss_used"]
    def_poss = meta["def_poss_used"]

    players = []
    for i, pid in enumerate(all_ids):
        orapm = float(coeffs[orapm_base + i])
        # DRAPM sign flip: defensive coefficients are negative raw, flip to positive=good
        drapm = -float(coeffs[drapm_base + i])

        players.append({
            "playerId": int(pid),
            "off_poss_used": float(off_poss[i]),
            "def_poss_used": float(def_poss[i]),
            "orapm": orapm,
            "drapm": drapm,
            "rapm": orapm + drapm,
        })

    return {
        "lambda": lambda_val,
        "r_squared": r_squared,
        "mse": mse,
        "intercept": float(model.intercept_),
        "players": players,
        "n_players": len(players),
        "n_observations": len(y)
    }

def validate_lambda_grid():
    """Main validation function."""
    print("=" * 64)
    print("RAPM LAMBDA GRID VALIDATION (TRUE RETRAINING)")
    print("=" * 64)
    print(f"Testing lambdas: {LAMBDAS}")
    print(f"Output directory: {OUTPUT_DIR.relative_to(REPO_ROOT)}")

    # Build design matrix once
    print("\nBuilding design matrix from single-sided stint data...")
    X, y, w, pidx, meta = build_design_matrix_single_sided(target="actual")

    print(f"\nDesign matrix shape: {X.shape}")
    print(f"Observations: {len(y):,}")
    print(f"Players: {meta['n_players']:,}")
    print(f"Features: {X.shape[1]:,}")

    results = []

    # Train models for each lambda
    for lambda_val in LAMBDAS:
        try:
            result = train_rapm_lambda(lambda_val, X, y, w, meta)
            results.append(result)

            # Calculate distribution statistics
            player_rapms = [p["rapm"] for p in result["players"]]
            player_orapms = [p["orapm"] for p in result["players"]]
            player_drapms = [p["drapm"] for p in result["players"]]

            stats = {
                "rapm": {
                    "min": min(player_rapms),
                    "max": max(player_rapms),
                    "mean": np.mean(player_rapms),
                    "std": np.std(player_rapms)
                },
                "orapm": {
                    "min": min(player_orapms),
                    "max": max(player_orapms),
                    "mean": np.mean(player_orapms),
                    "std": np.std(player_orapms)
                },
                "drapm": {
                    "min": min(player_drapms),
                    "max": max(player_drapms),
                    "mean": np.mean(player_drapms),
                    "std": np.std(player_drapms)
                }
            }

            # Count extreme outliers
            extreme_15 = sum(1 for rapm in player_rapms if abs(rapm) > 15)
            extreme_20 = sum(1 for rapm in player_rapms if abs(rapm) > 20)
            extreme_25 = sum(1 for rapm in player_rapms if abs(rapm) > 25)

            # Save individual lambda results
            output_file = OUTPUT_DIR / f"rapm_lambda_{lambda_val}.json"

            # Create full result payload
            payload = {
                "model_info": {
                    "phase": "lambda_grid_validation",
                    "model": "ridge_single_sided_centered",
                    "season": 2026,
                    "lambda": lambda_val,
                    "data_source": "single_sided_stints",
                    "coefficient_centering": "ORAPM and DRAPM centered separately",
                    "drapm_sign": "flipped — good defense is positive",
                    "retrain_method": "ACTUAL_RETRAINING"
                },
                "model_performance": {
                    "r_squared": result["r_squared"],
                    "mse": result["mse"],
                    "n_observations": result["n_observations"]
                },
                "model_parameters": {
                    "intercept": result["intercept"],
                    "n_players": result["n_players"]
                },
                "distribution_stats": stats,
                "extreme_outliers": {
                    "above_15": extreme_15,
                    "above_20": extreme_20,
                    "above_25": extreme_25
                },
                "players": result["players"]
            }

            with open(output_file, 'w') as f:
                json.dump(payload, f, indent=2)

            print(f"✅ Saved {output_file.name}")
            print(f"   Max RAPM: {stats['rapm']['max']:.1f}")
            print(f"   R²: {result['r_squared']:.4f}")
            print(f"   Outliers >15: {extreme_15}")

        except Exception as e:
            print(f"❌ Failed λ={lambda_val}: {e}")
            import traceback
            traceback.print_exc()
            continue

    # Create summary comparison
    print("\n" + "="*64)
    print("LAMBDA VALIDATION SUMMARY")
    print("="*64)

    if results:
        print("\nModel Performance:")
        print("Lambda | Max RAPM | R²     | MSE    | Outliers>15 | Players")
        print("-------|----------|--------|--------|-------------|--------")

        for result in results:
            player_rapms = [p["rapm"] for p in result["players"]]
            max_rapm = max(player_rapms)
            extreme_15 = sum(1 for rapm in player_rapms if abs(rapm) > 15)

            print(f"{result['lambda']:6} | {max_rapm:8.1f} | {result['r_squared']:6.4f} | {result['mse']:6.2f} | {extreme_15:11} | {result['n_players']:7}")

        # Find best R² (though this is in-sample, so less meaningful)
        best_r2 = max(r["r_squared"] for r in results)
        best_lambda_r2 = next(r["lambda"] for r in results if abs(r["r_squared"] - best_r2) < 1e-6)

        print(f"\n📈 Best in-sample fit: λ={best_lambda_r2} (R²={best_r2:.4f})")
        print("⚠️  Note: Lower lambda typically has better in-sample fit but may overfit")

        # Scale analysis
        print(f"\nScale Comparison (vs Hoop Explorer ~15 reference):")
        for result in results:
            player_rapms = [p["rapm"] for p in result["players"]]
            max_rapm = max(player_rapms)
            scale_pct = (max_rapm / 15.0) * 100
            print(f"λ={result['lambda']}: Max RAPM {max_rapm:.1f} ({scale_pct:.0f}% of HE scale)")

        # Generate summary file
        summary = {
            "validation_summary": {
                "test_date": "2026-05-28",
                "method": "actual_rapm_retraining_full_dataset",
                "note": "This is TRUE model retraining, not rescaled estimates",
                "limitation": "Uses full dataset - no holdout validation",
                "recommendation": "Choose based on scale match and outlier count"
            },
            "results": [
                {
                    "lambda": r["lambda"],
                    "max_rapm": max([p["rapm"] for p in r["players"]]),
                    "r_squared": r["r_squared"],
                    "mse": r["mse"],
                    "n_players": r["n_players"],
                    "extreme_outliers_15": sum(1 for p in r["players"] if abs(p["rapm"]) > 15)
                } for r in results
            ]
        }

        summary_file = OUTPUT_DIR / "lambda_validation_summary.json"
        with open(summary_file, 'w') as f:
            json.dump(summary, f, indent=2)

        print(f"\n📊 Summary saved to {summary_file.relative_to(REPO_ROOT)}")

    print(f"\n✅ Lambda grid validation complete!")
    print(f"📁 Results saved to: {OUTPUT_DIR.relative_to(REPO_ROOT)}")
    print(f"🔍 Next: Run TypeScript analysis to compare rankings and basketball validity")

    return results

if __name__ == "__main__":
    import os
    os.environ["RAPM_SEASON"] = "2026"

    try:
        results = validate_lambda_grid()
        print(f"\n🎉 Successfully validated {len(results)} lambda values with ACTUAL RETRAINING")
        print("📋 Key finding: This uses the real RAPM training pipeline, not scaled estimates")
    except Exception as e:
        print(f"\n❌ Lambda grid validation failed: {e}")
        raise