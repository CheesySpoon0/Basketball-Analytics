#!/usr/bin/env python3
"""
Phase 3D Task 3 — Train defensive-only APM models.

Builds three isolated defensive models to test whether defensive impact
can be identified when separated from offensive confounds:

Model A: Defenders only
Model B: Defenders + opponent offensive controls
Model C: Defenders + opponent controls + game/team effects

Each model predicts opponent points allowed per 100 possessions.
Good defenders should have negative raw coefficients (fewer points allowed).
Display as positive DRAPM for intuitive interpretation.

OUTPUTS:
  scripts/python/rapm/output/rapm_phase3d_defense_only.json
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from scipy.sparse import coo_matrix

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
OUTPUT_DIR = HERE / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

DEFENSIVE_CSV = HERE / "data" / "defensive_stints.csv"
JSON_OUT = OUTPUT_DIR / "rapm_phase3d_defense_only.json"

LAMBDA = 1000.0  # Same regularization as other phases


def parse_ids(ids_str):
    """Parse comma-separated player IDs."""
    return [int(x) for x in str(ids_str).split(",")]


def build_design_matrix_defenders_only(df):
    """Model A: Defenders only."""
    print("  Building Model A: Defenders only")

    # Get all unique defensive players
    all_def_players = set()
    for ids_str in df["defensive_playerIds"]:
        all_def_players.update(parse_ids(ids_str))

    def_players = sorted(all_def_players)
    def_player_index = {pid: i for i, pid in enumerate(def_players)}
    n_def_players = len(def_players)

    print(f"    Defensive players: {n_def_players:,}")

    # Build sparse matrix: defenders get +1
    rows, cols, vals = [], [], []
    for r, (_, stint) in enumerate(df.iterrows()):
        for pid in parse_ids(stint["defensive_playerIds"]):
            if pid in def_player_index:
                rows.append(r)
                cols.append(def_player_index[pid])
                vals.append(1.0)

    X = coo_matrix((vals, (rows, cols)), shape=(len(df), n_def_players)).tocsr()

    return X, def_players, {"n_def_players": n_def_players}


def build_design_matrix_with_controls(df):
    """Model B: Defenders + opponent offensive controls."""
    print("  Building Model B: Defenders + opponent offensive controls")

    # Get unique defensive and offensive players
    all_def_players = set()
    all_off_players = set()

    for ids_str in df["defensive_playerIds"]:
        all_def_players.update(parse_ids(ids_str))
    for ids_str in df["offensive_playerIds"]:
        all_off_players.update(parse_ids(ids_str))

    def_players = sorted(all_def_players)
    off_players = sorted(all_off_players)

    def_player_index = {pid: i for i, pid in enumerate(def_players)}
    off_player_index = {pid: i + len(def_players) for i, pid in enumerate(off_players)}

    n_def_players = len(def_players)
    n_off_players = len(off_players)
    n_total = n_def_players + n_off_players

    print(f"    Defensive players: {n_def_players:,}")
    print(f"    Offensive players: {n_off_players:,}")

    # Build sparse matrix: defenders +1, opponent offense +1 (as controls)
    rows, cols, vals = [], [], []

    for r, (_, stint) in enumerate(df.iterrows()):
        # Defensive players (main effect)
        for pid in parse_ids(stint["defensive_playerIds"]):
            if pid in def_player_index:
                rows.append(r)
                cols.append(def_player_index[pid])
                vals.append(1.0)

        # Offensive players (control for opponent strength)
        for pid in parse_ids(stint["offensive_playerIds"]):
            if pid in off_player_index:
                rows.append(r)
                cols.append(off_player_index[pid])
                vals.append(1.0)

    X = coo_matrix((vals, (rows, cols)), shape=(len(df), n_total)).tocsr()

    all_players = def_players + off_players
    return X, all_players, {
        "n_def_players": n_def_players,
        "n_off_players": n_off_players,
        "def_base": 0,
        "off_base": n_def_players
    }


def build_design_matrix_with_fixed_effects(df):
    """Model C: Defenders + controls + team fixed effects."""
    print("  Building Model C: Defenders + controls + team fixed effects")

    # Get players (same as Model B)
    all_def_players = set()
    all_off_players = set()

    for ids_str in df["defensive_playerIds"]:
        all_def_players.update(parse_ids(ids_str))
    for ids_str in df["offensive_playerIds"]:
        all_off_players.update(parse_ids(ids_str))

    def_players = sorted(all_def_players)
    off_players = sorted(all_off_players)

    # Get unique defensive teams for fixed effects
    def_teams = sorted(df["defensive_teamId"].unique())
    off_teams = sorted(df["offensive_teamId"].unique())

    def_player_index = {pid: i for i, pid in enumerate(def_players)}
    off_player_index = {pid: i + len(def_players) for i, pid in enumerate(off_players)}
    def_team_index = {tid: i + len(def_players) + len(off_players) for i, tid in enumerate(def_teams)}
    off_team_index = {tid: i + len(def_players) + len(off_players) + len(def_teams) for i, tid in enumerate(off_teams)}

    n_def_players = len(def_players)
    n_off_players = len(off_players)
    n_def_teams = len(def_teams)
    n_off_teams = len(off_teams)
    n_total = n_def_players + n_off_players + n_def_teams + n_off_teams

    print(f"    Defensive players: {n_def_players:,}")
    print(f"    Offensive players: {n_off_players:,}")
    print(f"    Defensive teams: {n_def_teams}")
    print(f"    Offensive teams: {n_off_teams}")

    # Build design matrix
    rows, cols, vals = [], [], []

    for r, (_, stint) in enumerate(df.iterrows()):
        # Defensive players
        for pid in parse_ids(stint["defensive_playerIds"]):
            if pid in def_player_index:
                rows.append(r)
                cols.append(def_player_index[pid])
                vals.append(1.0)

        # Offensive players (controls)
        for pid in parse_ids(stint["offensive_playerIds"]):
            if pid in off_player_index:
                rows.append(r)
                cols.append(off_player_index[pid])
                vals.append(1.0)

        # Team fixed effects
        def_tid = stint["defensive_teamId"]
        off_tid = stint["offensive_teamId"]

        if def_tid in def_team_index:
            rows.append(r)
            cols.append(def_team_index[def_tid])
            vals.append(1.0)

        if off_tid in off_team_index:
            rows.append(r)
            cols.append(off_team_index[off_tid])
            vals.append(1.0)

    X = coo_matrix((vals, (rows, cols)), shape=(len(df), n_total)).tocsr()

    all_entities = def_players + off_players + def_teams + off_teams
    return X, all_entities, {
        "n_def_players": n_def_players,
        "n_off_players": n_off_players,
        "n_def_teams": n_def_teams,
        "n_off_teams": n_off_teams,
        "def_players_base": 0,
        "off_players_base": n_def_players,
        "def_teams_base": n_def_players + n_off_players,
        "off_teams_base": n_def_players + n_off_players + n_def_teams
    }


def fit_defensive_model(X, y, weights, lam, name):
    """Fit ridge regression and return coefficients."""
    print(f"  Fitting {name} (lambda={lam:.0f})")

    model = Ridge(alpha=lam, fit_intercept=True, solver="lsqr")
    model.fit(X, y, sample_weight=weights)

    print(f"    Intercept: {model.intercept_:.2f}")
    print(f"    Coeff range: [{model.coef_.min():+.3f}, {model.coef_.max():+.3f}]")

    return model


def extract_defensive_results(model, players, meta, model_name):
    """Extract per-player defensive results."""
    coefficients = model.coef_

    if model_name == "Model A":
        # All coefficients are defensive
        def_coeffs = coefficients
        def_players = players
    else:
        # Extract defensive coefficients only
        n_def = meta["n_def_players"]
        def_coeffs = coefficients[:n_def]
        def_players = players[:n_def]

    # Convert to displayed DRAPM
    # Raw coefficient: negative = good defender (fewer points allowed)
    # Displayed DRAPM: positive = good defender
    displayed_drapm = -def_coeffs

    # Center around zero
    displayed_drapm = displayed_drapm - displayed_drapm.mean()

    results = []
    for i, pid in enumerate(def_players):
        results.append({
            "playerId": int(pid),
            "raw_coefficient": float(def_coeffs[i]),
            "displayed_drapm": float(displayed_drapm[i]),
            f"drapm_{model_name.lower().replace(' ', '_')}": float(displayed_drapm[i])
        })

    return results


def main() -> None:
    print("=" * 70)
    print("PHASE 3D TASK 3 — Training Defensive-Only APM Models")
    print("=" * 70)

    if not DEFENSIVE_CSV.exists():
        raise SystemExit(f"Missing {DEFENSIVE_CSV} — run build_defensive_only_dataset.py first.")

    # Load defensive dataset
    df = pd.read_csv(DEFENSIVE_CSV)
    print(f"  Loaded {len(df):,} defensive observations")

    # Target and weights
    y_actual = df["def_ppp_allowed"].values * 100  # Scale to per-100 possessions
    y_expected = df["def_xppp_allowed"].values * 100
    weights = df["defensive_possessions"].values

    print(f"  Target actual mean: {y_actual.mean():.2f} points/100")
    print(f"  Target expected mean: {y_expected.mean():.2f} points/100")

    # --- Model A: Defenders only -----------------------------------------
    print(f"\n=== MODEL A: DEFENDERS ONLY ===")
    X_a, players_a, meta_a = build_design_matrix_defenders_only(df)
    print(f"    Matrix shape: {X_a.shape}")

    # Fit both targets
    model_a_actual = fit_defensive_model(X_a, y_actual, weights, LAMBDA, "Model A (actual)")
    model_a_expected = fit_defensive_model(X_a, y_expected, weights, LAMBDA, "Model A (expected)")

    # Extract results
    results_a_actual = extract_defensive_results(model_a_actual, players_a, meta_a, "Model A")
    results_a_expected = extract_defensive_results(model_a_expected, players_a, meta_a, "Model A")

    # --- Model B: Defenders + controls -----------------------------------
    print(f"\n=== MODEL B: DEFENDERS + OFFENSIVE CONTROLS ===")
    X_b, players_b, meta_b = build_design_matrix_with_controls(df)
    print(f"    Matrix shape: {X_b.shape}")

    model_b_actual = fit_defensive_model(X_b, y_actual, weights, LAMBDA, "Model B (actual)")
    model_b_expected = fit_defensive_model(X_b, y_expected, weights, LAMBDA, "Model B (expected)")

    results_b_actual = extract_defensive_results(model_b_actual, players_b, meta_b, "Model B")
    results_b_expected = extract_defensive_results(model_b_expected, players_b, meta_b, "Model B")

    # --- Model C: Defenders + controls + fixed effects ------------------
    print(f"\n=== MODEL C: DEFENDERS + CONTROLS + FIXED EFFECTS ===")
    X_c, entities_c, meta_c = build_design_matrix_with_fixed_effects(df)
    print(f"    Matrix shape: {X_c.shape}")

    model_c_actual = fit_defensive_model(X_c, y_actual, weights, LAMBDA, "Model C (actual)")
    model_c_expected = fit_defensive_model(X_c, y_expected, weights, LAMBDA, "Model C (expected)")

    results_c_actual = extract_defensive_results(model_c_actual, entities_c, meta_c, "Model C")
    results_c_expected = extract_defensive_results(model_c_expected, entities_c, meta_c, "Model C")

    # --- Combine and save results ----------------------------------------
    print(f"\n=== COMBINING RESULTS ===")

    # Create comprehensive dataset
    all_defensive_players = set()
    for results in [results_a_actual, results_b_actual, results_c_actual]:
        for r in results:
            all_defensive_players.add(r["playerId"])

    comprehensive_results = []
    for pid in sorted(all_defensive_players):
        player_result = {"playerId": pid}

        # Find results from each model
        for results, suffix in [
            (results_a_actual, "_model_a_actual"),
            (results_a_expected, "_model_a_expected"),
            (results_b_actual, "_model_b_actual"),
            (results_b_expected, "_model_b_expected"),
            (results_c_actual, "_model_c_actual"),
            (results_c_expected, "_model_c_expected")
        ]:
            found = next((r for r in results if r["playerId"] == pid), None)
            if found:
                player_result[f"drapm{suffix}"] = found["displayed_drapm"]
            else:
                player_result[f"drapm{suffix}"] = 0.0

        comprehensive_results.append(player_result)

    # Save results
    output_data = {
        "phase": "3d",
        "description": "Defensive-only APM models",
        "models": {
            "A": "Defenders only",
            "B": "Defenders + opponent offensive controls",
            "C": "Defenders + controls + team fixed effects"
        },
        "targets": {
            "actual": "Actual points allowed per 100 possessions",
            "expected": "Expected points allowed per 100 possessions"
        },
        "lambda": LAMBDA,
        "n_observations": len(df),
        "n_defensive_players": len(all_defensive_players),
        "coefficient_interpretation": "Negative raw coefficient = good defense (fewer points allowed)",
        "display_convention": "Positive displayed DRAPM = good defense",
        "players": comprehensive_results
    }

    JSON_OUT.write_text(json.dumps(output_data, indent=2))
    print(f"  Saved results: {JSON_OUT.relative_to(REPO_ROOT)}")

    # --- Quick validation summary ----------------------------------------
    print(f"\n=== QUICK VALIDATION ===")

    for model_name, suffix in [("Model A", "_model_a_actual"), ("Model B", "_model_b_actual"), ("Model C", "_model_c_actual")]:
        col_name = f"drapm{suffix}"
        values = [p[col_name] for p in comprehensive_results if abs(p[col_name]) > 0]

        if values:
            values = np.array(values)
            print(f"  {model_name}:")
            print(f"    Players with estimates: {len(values):,}")
            print(f"    DRAPM range: [{values.min():+.2f}, {values.max():+.2f}]")
            print(f"    DRAPM std: {values.std():.3f}")

    print(f"\nNext step: Run validate_phase3d_drapm.py for comprehensive validation")


if __name__ == "__main__":
    main()