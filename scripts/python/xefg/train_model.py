#!/usr/bin/env python3
"""
Train an xeFG model on the extracted shot CSV.

OUTPUTS:
  lib/xefg/coefficients.json            — logistic regression weights (ship to TS)
  scripts/python/xefg/output/model.json — XGBoost (reference / future use)
  scripts/python/xefg/output/metrics.json
  scripts/python/xefg/output/parity_sample.csv — 100 sampled rows + predicted
                                                 probability, for TS parity test

USAGE:
  python extract_shots.py
  python train_model.py
"""
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

try:
    import xgboost as xgb
    HAS_XGB = True
except ImportError:
    HAS_XGB = False

# ============================================================================
# Paths
# ============================================================================
HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]

INPUT_CSV = HERE / "data" / "shots.csv"
OUTPUT_DIR = HERE / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
COEFS_OUT = REPO_ROOT / "lib" / "xefg" / "coefficients.json"
COEFS_OUT.parent.mkdir(parents=True, exist_ok=True)
PARITY_OUT = OUTPUT_DIR / "parity_sample.csv"

SEED = 42

# ============================================================================
# Feature set
#
# `assisted` is intentionally EXCLUDED: in our data it's only populated on made
# shots, which leaks the target. See extract_shots.py header for details.
#
# Distance is provided BOTH as raw numeric AND as binned indicators because
# logistic regression is linear and the make-rate vs distance curve is sharply
# non-monotonic; bins give the LR a non-linear handle without going to XGBoost.
# ============================================================================
NUMERIC_FEATURES = [
    "distance_from_rim",
    "seconds_remaining_in_period",
    "score_differential",
    "period",
]
INDICATOR_FEATURES = [
    # zone one-hots — we encode "rim" and "three" and let "mid" be the baseline
    "zone_rim",
    "zone_three",
    "is_corner_three",
    # shot type
    "is_layup",
    "is_dunk",
    "is_jumper",
    "is_tip",
    # distance bins (dist_22_plus is dropped as the baseline)
    "dist_0_3",
    "dist_3_10",
    "dist_10_22",
    # context
    "is_end_of_period",
    "is_transition",
    "home_team",
]
ALL_FEATURES = NUMERIC_FEATURES + INDICATOR_FEATURES


def add_zone_onehots(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["zone_rim"] = (df["shot_zone"] == "rim").astype(int)
    df["zone_three"] = (df["shot_zone"] == "three").astype(int)
    return df


def evaluate(name: str, y_true: np.ndarray, p_pred: np.ndarray) -> dict:
    metrics = {
        "log_loss": float(log_loss(y_true, p_pred)),
        "brier": float(brier_score_loss(y_true, p_pred)),
        "auc": float(roc_auc_score(y_true, p_pred)),
        "n": int(len(y_true)),
        "mean_pred": float(p_pred.mean()),
        "mean_actual": float(y_true.mean()),
    }
    print(f"\n  {name}")
    print(f"    log loss : {metrics['log_loss']:.4f}")
    print(f"    brier    : {metrics['brier']:.4f}")
    print(f"    auc      : {metrics['auc']:.4f}")
    print(f"    n        : {metrics['n']:,}")
    print(f"    mean pred: {metrics['mean_pred']:.4f}")
    print(f"    mean act : {metrics['mean_actual']:.4f}")
    return metrics


def calibration_buckets(y_true: np.ndarray, p_pred: np.ndarray, n_bins: int = 10) -> list:
    """Bucket predictions into n_bins and compare to actuals."""
    df = pd.DataFrame({"y": y_true, "p": p_pred})
    df["bucket"] = pd.cut(df["p"], bins=n_bins, labels=False, include_lowest=True)
    grouped = df.groupby("bucket").agg(n=("y", "size"), pred=("p", "mean"), actual=("y", "mean"))
    out = []
    for _, row in grouped.iterrows():
        out.append({"n": int(row["n"]), "pred": round(row["pred"], 4), "actual": round(row["actual"], 4)})
    return out


def main() -> None:
    if not INPUT_CSV.exists():
        raise SystemExit(f"Missing {INPUT_CSV} — run extract_shots.py first.")

    print(f"Loading {INPUT_CSV.relative_to(REPO_ROOT)} ...")
    df = pd.read_csv(INPUT_CSV)
    print(f"  {len(df):,} rows")

    df = add_zone_onehots(df)

    raw_X = df[ALL_FEATURES].astype(float).values
    y = df["made"].astype(int).values

    # Fit scaler on numeric columns ONLY (first len(NUMERIC_FEATURES) columns);
    # indicators (0/1) are passed through. We store the resulting means/stds in
    # coefficients.json so the TS predictor can apply the same transform.
    n_num = len(NUMERIC_FEATURES)
    scaler = StandardScaler()
    scaler.fit(raw_X[:, :n_num])
    scaled_X = raw_X.copy()
    scaled_X[:, :n_num] = scaler.transform(raw_X[:, :n_num])

    X_train, X_test, y_train, y_test = train_test_split(
        scaled_X, y, test_size=0.20, random_state=SEED, stratify=df["shot_zone"]
    )
    print(f"  train: {len(X_train):,}   test: {len(X_test):,}")

    # ========================================================================
    # Logistic Regression — the production model
    # ========================================================================
    print("\n=== Training logistic regression ===")
    lr = LogisticRegression(
        max_iter=1000,
        solver="lbfgs",
        random_state=SEED,
    )
    lr.fit(X_train, y_train)
    lr_train_p = lr.predict_proba(X_train)[:, 1]
    lr_test_p = lr.predict_proba(X_test)[:, 1]
    lr_train_metrics = evaluate("LR train", y_train, lr_train_p)
    lr_test_metrics = evaluate("LR test", y_test, lr_test_p)

    # Per-zone evaluation — re-do the split using indices so we can recover the
    # underlying DataFrame rows for the test set.
    print("\n  Per-zone LR test metrics:")
    idx = np.arange(len(df))
    idx_train, idx_test = train_test_split(
        idx, test_size=0.20, random_state=SEED, stratify=df["shot_zone"]
    )
    test_df = df.iloc[idx_test].copy()
    test_df["p_lr"] = lr.predict_proba(scaled_X[idx_test])[:, 1]

    for zone, sub in test_df.groupby("shot_zone"):
        if len(sub) < 50:
            continue
        actual = sub["made"].mean()
        pred = sub["p_lr"].mean()
        print(
            f"    {zone:6s}  n={len(sub):5d}  actual={actual*100:5.2f}%  "
            f"xeFG_mean={pred*100:5.2f}%  delta={(actual-pred)*100:+5.2f}pp"
        )

    # Sanity by context
    print("\n  LR xeFG by context (test split):")
    for ctx_col in ["is_transition", "is_corner_three"]:
        for v in [0, 1]:
            sub = test_df[test_df[ctx_col] == v]
            if len(sub) < 50:
                continue
            print(
                f"    {ctx_col}={v} n={len(sub):5d}  "
                f"actual={sub['made'].mean()*100:5.2f}%  "
                f"xeFG_mean={sub['p_lr'].mean()*100:5.2f}%"
            )

    lr_calibration = calibration_buckets(y_test, lr_test_p)

    # ========================================================================
    # XGBoost — reference / future-use
    # ========================================================================
    xgb_metrics = None
    if HAS_XGB:
        print("\n=== Training XGBoost (reference; not shipped to TS yet) ===")
        booster = xgb.XGBClassifier(
            n_estimators=300,
            max_depth=4,
            learning_rate=0.05,
            subsample=0.9,
            colsample_bytree=0.9,
            objective="binary:logistic",
            eval_metric="logloss",
            random_state=SEED,
            n_jobs=2,
        )
        booster.fit(X_train, y_train, verbose=False)
        xgb_test_p = booster.predict_proba(X_test)[:, 1]
        xgb_metrics = evaluate("XGB test", y_test, xgb_test_p)
        booster.save_model(str(OUTPUT_DIR / "model.json"))
        print(f"  XGBoost saved to {OUTPUT_DIR.relative_to(REPO_ROOT) / 'model.json'}")

    # ========================================================================
    # Write coefficients.json (production)
    # ========================================================================
    payload = {
        "model": "logistic_regression",
        "trained_on": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "model_version": 1,
        "seed": SEED,
        "n_shots": int(len(df)),
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "features": ALL_FEATURES,
        "n_numeric": n_num,
        "numeric_features": NUMERIC_FEATURES,
        "indicator_features": INDICATOR_FEATURES,
        # Apply (x - mean) / std to numeric features BEFORE the linear combination.
        # TS predictor mirrors this transform from lib/xefg/coefficients.json.
        "scaler": {
            "mean": scaler.mean_.tolist(),
            "scale": scaler.scale_.tolist(),
        },
        "coefficients": lr.coef_[0].tolist(),
        "intercept": float(lr.intercept_[0]),
        "metrics": {
            "train": lr_train_metrics,
            "test": lr_test_metrics,
            "test_calibration": lr_calibration,
            "xgb_test": xgb_metrics,
        },
        "limitations": [
            "Excludes shotAssisted (only populated on made shots — would leak target).",
            "No defender / contest data.",
            "is_transition inferred from time since previous defensive event (<=7s).",
            "is_end_of_period is a coarse <30s-in-period proxy; no shot-clock data.",
        ],
    }
    COEFS_OUT.write_text(json.dumps(payload, indent=2))
    print(f"\nWrote coefficients to {COEFS_OUT.relative_to(REPO_ROOT)}")

    # ========================================================================
    # Parity sample for TS-side test
    # ========================================================================
    sample_df = df.sample(n=min(100, len(df)), random_state=SEED).copy()
    sample_raw = sample_df[ALL_FEATURES].astype(float).values
    sample_scaled = sample_raw.copy()
    sample_scaled[:, :n_num] = scaler.transform(sample_raw[:, :n_num])
    sample_df["p_lr"] = lr.predict_proba(sample_scaled)[:, 1]
    parity_cols = [
        "id", "shot_zone", "shotX", "shotY", "shotRange", "playType",
        "distance_from_rim",
        "is_corner_three", "is_above_break_three",
        "is_layup", "is_dunk", "is_jumper", "is_tip",
        "dist_0_3", "dist_3_10", "dist_10_22", "dist_22_plus",
        "is_end_of_period", "is_transition", "home_team",
        "seconds_remaining_in_period", "score_differential", "period",
        "made", "p_lr",
    ]
    sample_df[parity_cols].to_csv(PARITY_OUT, index=False)
    print(f"Wrote parity sample to {PARITY_OUT.relative_to(REPO_ROOT)}")

    # ========================================================================
    # Coefficient inspection (sanity check before shipping)
    # ========================================================================
    print("\n=== Logistic regression coefficients ===")
    for name, coef in zip(ALL_FEATURES, lr.coef_[0]):
        print(f"  {name:32s} {coef:+.4f}")
    print(f"  {'(intercept)':32s} {lr.intercept_[0]:+.4f}")


if __name__ == "__main__":
    main()
