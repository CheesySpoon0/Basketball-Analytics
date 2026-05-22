#!/usr/bin/env python3
"""
Phase 3B — offset ridge RAPM with independent box-score priors.

Uses the corrected independent priors from build_boxscore_prior_phase3b.py
that have NO dependency on Phase 2 RAPM outputs.

OUTPUTS:
  scripts/python/rapm/output/rapm_phase3b.json   — per-player table, both targets
  scripts/python/rapm/output/rapm_phase3b.csv    — same, flat CSV
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
JSON_OUT = OUTPUT_DIR / "rapm_phase3b.json"
CSV_OUT = OUTPUT_DIR / "rapm_phase3b.csv"
PRIOR_JSON = OUTPUT_DIR / "boxscore_prior_phase3b.json"

# Use same lambda as Phase 2 for comparison
LAMBDA = 1000.0


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
    print("PHASE 3B — independent box-score prior RAPM")
    print("=" * 64)

    if not PRIOR_JSON.exists():
        raise SystemExit(f"Missing {PRIOR_JSON} — run build_boxscore_prior_phase3b.py first.")

    # Load independent prior model
    prior_data = json.loads(PRIOR_JSON.read_text())
    prior_players = {p["playerId"]: p for p in prior_data["players"]}
    print(f"  Loaded independent box-score prior for {len(prior_players):,} players")
    print(f"  Prior method: {prior_data['method']}")
    print(f"  RAPM dependency: {prior_data['no_rapm_dependency']}")

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
    print(f"\n-- Building independent prior coefficient vector --")
    beta_prior = np.zeros(meta["n_cols"])

    matched = 0
    for i, pid in enumerate(all_ids):
        if pid in prior_players:
            prior_orapm = prior_players[pid]["prior_orapm"]
            prior_drapm = prior_players[pid]["prior_drapm"]
            beta_prior[orapm_base + i] = prior_orapm
            beta_prior[drapm_base + i] = -prior_drapm  # negate for -1 column convention
            matched += 1

    print(f"    {matched:,} players have independent box-score priors")
    print(f"    {n_players - matched:,} players default to zero prior")

    orapm_priors = beta_prior[orapm_base:orapm_base+n_players]
    drapm_priors_display = -beta_prior[drapm_base:drapm_base+n_players]  # flip for display

    print(f"    prior ORAPM range: [{orapm_priors.min():+.2f}, {orapm_priors.max():+.2f}]")
    print(f"    prior DRAPM range: [{drapm_priors_display.min():+.2f}, {drapm_priors_display.max():+.2f}]")

    # --- Fit both targets at lambda = 1000 ----------------------------------
    print(f"\n-- Fitting offset ridge at lambda={LAMBDA:.0f} --")

    # Actual target
    beta_actual, intercept_actual, model_actual = fit_offset_ridge(
        X, y_actual, w, beta_prior, LAMBDA
    )

    # xeFG target
    beta_xefg, intercept_xefg, model_xefg = fit_offset_ridge(
        X, y_xefg, w, beta_prior, LAMBDA
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
        "phase": "3b",
        "model": "ridge_independent_boxscore_prior",
        "season": int(__import__("os").environ.get("RAPM_SEASON", "2026")),
        "lambda": LAMBDA,
        "n_observations": int(meta["n_stints"]),
        "n_players": n_players,
        "n_players_with_prior": matched,
        "intercept_actual": float(intercept_actual),
        "intercept_xefg": float(intercept_xefg),
        "prior_source": "independent box-score z-scores (no RAPM dependency)",
        "prior_method": prior_data["method"],
        "drapm_sign": "flipped — good defense is positive; RAPM = ORAPM + DRAPM",
        "players": table.to_dict(orient="records"),
    }

    JSON_OUT.write_text(json.dumps(payload, indent=2))
    table.to_csv(CSV_OUT, index=False)
    print(f"\nWrote {JSON_OUT.relative_to(REPO_ROOT)}")
    print(f"Wrote {CSV_OUT.relative_to(REPO_ROOT)}")

    # --- Distribution comparison with Phase 2 -------------------------------
    print("\n=== Phase 3B distribution ===")
    for target in ["actual", "xefg"]:
        col = f"rapm_{target}"
        ra = table[col]
        print(f"  RAPM_{target}: mean={ra.mean():+.3f}  std={ra.std():.3f}  "
              f"range=[{ra.min():+.2f}, {ra.max():+.2f}]")


if __name__ == "__main__":
    main()