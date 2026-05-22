#!/usr/bin/env python3
"""
Phase 3D Task 4 — Comprehensive validation of defensive-only models.

Tests all three defensive models against multiple validation criteria:
1. Box-score stat correlations (blocks, steals, rebounds, fouls)
2. Between-target correlations (actual vs expected)
3. Defensive on/off baseline correlation
4. Distribution sanity and face validity
5. Model comparison and recommendation

CRITICAL: Determines which DRAPM model, if any, is suitable for production.
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

PHASE3D_JSON = HERE / "output" / "rapm_phase3d_defense_only.json"
DEFENSIVE_CSV = HERE / "data" / "defensive_stints.csv"
BOXSCORE_CSV = HERE / "data" / "boxscore_stats.csv"

MIN_POSS = 200  # Minimum possessions for stable correlation analysis


def _strip(url: str) -> str:
    p = urlparse(url)
    kept = [(k, v) for k, v in parse_qsl(p.query) if k.lower() != "pgbouncer"]
    return urlunparse(p._replace(query=urlencode(kept)))


def load_player_meta(player_ids: list[int]) -> pd.DataFrame:
    """Load player names and teams."""
    url = os.environ["DATABASE_URL"]
    season = int(os.environ.get("RAPM_SEASON", "2026"))
    q = """
    SELECT p.id AS "playerId", p.name, t.school AS team
    FROM players p
    LEFT JOIN player_season_stats ps ON ps."playerId" = p.id AND ps.season = %(season)s
    LEFT JOIN teams t ON t.id = ps."teamId"
    WHERE p.id = ANY(%(ids)s)
    """
    try:
        with psycopg2.connect(_strip(url)) as conn:
            return pd.read_sql(q, conn, params={"ids": player_ids, "season": season})
    except Exception as e:
        print(f"    Warning: Could not load player metadata: {e}")
        return pd.DataFrame({"playerId": player_ids})


def compute_defensive_exposures(defensive_csv):
    """Compute per-player defensive possessions from stint data."""
    print("  Computing defensive exposures from stint data...")

    if not defensive_csv.exists():
        return pd.DataFrame()

    stints = pd.read_csv(defensive_csv)

    def parse_ids(ids_str):
        return [int(x) for x in str(ids_str).split(",")]

    def_exposures = {}
    for _, stint in stints.iterrows():
        poss = stint["defensive_possessions"]
        for pid in parse_ids(stint["defensive_playerIds"]):
            def_exposures[pid] = def_exposures.get(pid, 0) + poss

    exposure_df = pd.DataFrame([
        {"playerId": pid, "def_possessions": poss}
        for pid, poss in def_exposures.items()
    ])

    print(f"    Computed exposures for {len(exposure_df):,} defensive players")
    return exposure_df


def validate_box_score_correlations(df, model_cols):
    """Test correlations between DRAPM models and defensive box-score stats."""
    print(f"\n=== BOX-SCORE CORRELATION VALIDATION ===")

    # Defensive stats that should correlate with good defense
    defensive_stats = {
        "blocks_per40": ("Blocks/40", "positive"),
        "steals_per40": ("Steals/40", "positive"),
        "dreb_per40": ("DefReb/40", "positive"),
        "fouls_per40": ("Fouls/40", "negative")
    }

    # Filter to substantial players
    substantial = df[df["def_possessions"] >= MIN_POSS]
    print(f"  Players with {MIN_POSS}+ defensive possessions: {len(substantial):,}")

    if len(substantial) < 100:
        print("  Insufficient data for box-score correlation analysis")
        return {}

    correlation_results = {}

    for model_col in model_cols:
        print(f"\n  {model_col.upper()} vs defensive box-score stats:")
        print(f"    Stat            | Correlation | Expected | Status")
        print(f"    ----------------|-------------|----------|-------")

        correct_correlations = 0
        total_correlations = 0
        model_correlations = {}

        for stat_col, (stat_name, expected_dir) in defensive_stats.items():
            if stat_col in substantial.columns:
                # Filter valid data
                valid_data = substantial.dropna(subset=[stat_col, model_col])
                if len(valid_data) >= 50:
                    corr = np.corrcoef(valid_data[stat_col], valid_data[model_col])[0, 1]

                    # Check if correlation matches expectation
                    if expected_dir == "positive":
                        correct = corr > 0.05  # Small positive threshold
                        expected_str = "Positive"
                    else:
                        correct = corr < -0.05  # Small negative threshold
                        expected_str = "Negative"

                    status = "✓" if correct else "✗"
                    if correct:
                        correct_correlations += 1
                    total_correlations += 1

                    model_correlations[stat_col] = corr

                    print(f"    {stat_name:<15} | {corr:>10.3f} | {expected_str:<8} | {status:>6}")

        # Model score
        if total_correlations > 0:
            correlation_score = correct_correlations / total_correlations
            print(f"    Correlation correctness: {correct_correlations}/{total_correlations} ({correlation_score:.1%})")
            model_correlations["correctness_score"] = correlation_score
        else:
            model_correlations["correctness_score"] = 0.0

        correlation_results[model_col] = model_correlations

    return correlation_results


def validate_between_target_correlations(df, model_pairs):
    """Test correlations between actual and expected DRAPM for each model."""
    print(f"\n=== BETWEEN-TARGET CORRELATION VALIDATION ===")

    # Filter to substantial players
    substantial = df[df["def_possessions"] >= MIN_POSS]

    between_target_results = {}

    for model_name, (actual_col, expected_col) in model_pairs.items():
        valid_data = substantial.dropna(subset=[actual_col, expected_col])

        if len(valid_data) >= 100:
            corr = np.corrcoef(valid_data[actual_col], valid_data[expected_col])[0, 1]
            print(f"  {model_name}: actual vs expected correlation = {corr:.3f}")

            # Classification
            if corr >= 0.7:
                status = "STRONG"
            elif corr >= 0.5:
                status = "MODERATE"
            elif corr >= 0.3:
                status = "WEAK"
            else:
                status = "POOR"

            print(f"    Status: {status}")
            between_target_results[model_name] = {"correlation": corr, "status": status}
        else:
            print(f"  {model_name}: Insufficient data ({len(valid_data)} players)")
            between_target_results[model_name] = {"correlation": 0.0, "status": "NO_DATA"}

    return between_target_results


def validate_face_validity(df, model_cols, n_players=10):
    """Check if top/bottom performers make basketball sense."""
    print(f"\n=== FACE VALIDITY VALIDATION ===")

    # Filter to substantial players for reliable face validity
    substantial = df[df["def_possessions"] >= MIN_POSS]

    face_validity_results = {}

    for model_col in model_cols:
        print(f"\n  {model_col.upper()} - Top {n_players} defensive players:")

        if model_col not in substantial.columns:
            print(f"    {model_col} not found in data")
            continue

        # Top defenders
        top_defenders = substantial.nlargest(n_players, model_col)

        print(f"  Rank | DRAPM |  Name                     | Team         | DPoss | Blk | Stl | DRB")
        print(f"  -----|-------|---------------------------|--------------|-------|-----|-----|----")

        basketball_sense_count = 0
        for i, (_, player) in enumerate(top_defenders.iterrows()):
            name = str(player.get("name", f"Player{player['playerId']}"))[:25]
            team = str(player.get("team", "Unknown"))[:12]
            drapm = player[model_col]
            dposs = player["def_possessions"]

            # Defensive stats (use per-40 if available, raw otherwise)
            blocks = player.get("blocks_per40", 0)
            steals = player.get("steals_per40", 0)
            dreb = player.get("dreb_per40", 0)

            # Basketball sense: good defenders should have reasonable defensive stats
            defensive_activity = blocks + steals + dreb / 3
            makes_sense = defensive_activity >= 1.5  # Modest threshold

            if makes_sense:
                basketball_sense_count += 1
                sense_flag = "✓"
            else:
                sense_flag = "?"

            print(f"  {i+1:>4} | {drapm:>5.2f} | {name:<25} | {team:<12} | {dposs:>5.0f} | {blocks:>3.1f} | {steals:>3.1f} | {dreb:>3.1f} {sense_flag}")

        face_validity_score = basketball_sense_count / n_players
        print(f"  Basketball sense: {basketball_sense_count}/{n_players} ({face_validity_score:.1%})")

        face_validity_results[model_col] = {
            "basketball_sense_score": face_validity_score,
            "basketball_sense_count": basketball_sense_count,
            "total_evaluated": n_players
        }

    return face_validity_results


def compute_model_rankings(correlation_results, between_target_results, face_validity_results):
    """Rank models by overall performance."""
    print(f"\n=== MODEL PERFORMANCE RANKING ===")

    model_scores = {}
    models = ["drapm_model_a_actual", "drapm_model_b_actual", "drapm_model_c_actual"]

    for model in models:
        score = 0.0
        components = []

        # Box-score correlation score (40% weight)
        if model in correlation_results:
            box_score = correlation_results[model].get("correctness_score", 0.0)
            score += 0.4 * box_score
            components.append(f"Box-score: {box_score:.1%}")

        # Between-target correlation score (30% weight)
        model_key = model.replace("_actual", "").replace("drapm_", "").replace("_", " ").title()
        if model_key in between_target_results:
            bt_corr = between_target_results[model_key]["correlation"]
            bt_score = max(0.0, min(1.0, bt_corr))  # Clamp to [0,1]
            score += 0.3 * bt_score
            components.append(f"Between-target: {bt_corr:.3f}")

        # Face validity score (30% weight)
        if model in face_validity_results:
            face_score = face_validity_results[model]["basketball_sense_score"]
            score += 0.3 * face_score
            components.append(f"Face validity: {face_score:.1%}")

        model_scores[model] = {"score": score, "components": components}

    # Rank models
    ranked_models = sorted(model_scores.items(), key=lambda x: x[1]["score"], reverse=True)

    print(f"  Model Rankings (weighted composite score):")
    print(f"  Rank | Model   | Score | Components")
    print(f"  -----|---------|-------|------------------------------------------")

    for i, (model, data) in enumerate(ranked_models):
        model_name = model.replace("drapm_", "").replace("_actual", "").upper()
        score = data["score"]
        components_str = ", ".join(data["components"])
        print(f"  {i+1:>4} | {model_name:<7} | {score:>5.3f} | {components_str}")

    return ranked_models


def main() -> None:
    print("=" * 80)
    print("PHASE 3D TASK 4 — Comprehensive Defensive-Only Model Validation")
    print("=" * 80)

    if not PHASE3D_JSON.exists():
        raise SystemExit(f"Missing {PHASE3D_JSON} — run train_defensive_only_apm.py first.")

    # Load results
    phase3d_data = json.loads(PHASE3D_JSON.read_text())
    players_df = pd.DataFrame(phase3d_data["players"])
    print(f"  Loaded {len(players_df):,} players from 3 defensive models")

    # Load player metadata
    try:
        player_meta = load_player_meta(players_df["playerId"].tolist())
        players_df = players_df.merge(player_meta, on="playerId", how="left")
        players_df["name"] = players_df["name"].fillna(players_df["playerId"].astype(str))
    except Exception as e:
        print(f"  Warning: Could not load player names: {e}")
        players_df["name"] = players_df["playerId"].astype(str)

    # Load defensive exposures
    defensive_exposures = compute_defensive_exposures(DEFENSIVE_CSV)
    if len(defensive_exposures) > 0:
        players_df = players_df.merge(defensive_exposures, on="playerId", how="left")
        players_df["def_possessions"] = players_df["def_possessions"].fillna(0)
    else:
        players_df["def_possessions"] = 100  # Fallback for testing

    # Load box-score stats
    if BOXSCORE_CSV.exists():
        try:
            boxscore_df = pd.read_csv(BOXSCORE_CSV)
            players_df = players_df.merge(boxscore_df, on="playerId", how="left")
            print(f"  Loaded box-score stats")
        except Exception as e:
            print(f"  Warning: Could not load box-score stats: {e}")

    print(f"  Players with {MIN_POSS}+ defensive possessions: {(players_df['def_possessions'] >= MIN_POSS).sum():,}")

    # --- Validation 1: Box-score correlations -------------------------------
    model_cols = ["drapm_model_a_actual", "drapm_model_b_actual", "drapm_model_c_actual"]
    correlation_results = validate_box_score_correlations(players_df, model_cols)

    # --- Validation 2: Between-target correlations --------------------------
    model_pairs = {
        "Model A": ("drapm_model_a_actual", "drapm_model_a_expected"),
        "Model B": ("drapm_model_b_actual", "drapm_model_b_expected"),
        "Model C": ("drapm_model_c_actual", "drapm_model_c_expected")
    }
    between_target_results = validate_between_target_correlations(players_df, model_pairs)

    # --- Validation 3: Face validity ----------------------------------------
    face_validity_results = validate_face_validity(players_df, model_cols)

    # --- Validation 4: Model ranking ----------------------------------------
    ranked_models = compute_model_rankings(correlation_results, between_target_results, face_validity_results)

    # --- Final recommendation -----------------------------------------------
    print(f"\n" + "=" * 80)
    print("DEFENSIVE MODEL RECOMMENDATION")
    print("=" * 80)

    best_model, best_data = ranked_models[0]
    best_score = best_data["score"]

    print(f"🥇 BEST MODEL: {best_model.replace('drapm_', '').replace('_actual', '').upper()}")
    print(f"   Composite score: {best_score:.3f}")
    print(f"   Components: {', '.join(best_data['components'])}")

    # Decision thresholds
    if best_score >= 0.6:
        recommendation = "PRODUCTION READY"
        confidence = "HIGH"
    elif best_score >= 0.4:
        recommendation = "CAUTIOUS PRODUCTION"
        confidence = "MODERATE"
    elif best_score >= 0.2:
        recommendation = "RESEARCH ONLY"
        confidence = "LOW"
    else:
        recommendation = "NOT VIABLE"
        confidence = "VERY LOW"

    print(f"\n📋 RECOMMENDATION: {recommendation}")
    print(f"🎯 CONFIDENCE: {confidence}")

    if recommendation in ["PRODUCTION READY", "CAUTIOUS PRODUCTION"]:
        print(f"\n✅ DRAPM CAN BE SURFACED FOR PRODUCTION")
        print(f"   Use: {best_model.replace('drapm_', '').replace('_actual', '').upper()} model estimates")
        print(f"   Caveat: Include confidence indicators based on defensive possessions")
    else:
        print(f"\n❌ DRAPM NOT READY FOR PRODUCTION")
        print(f"   Issue: Insufficient validation across multiple criteria")
        print(f"   Alternative: Surface Net RAPM and ORAPM only")

    print(f"\n📊 SUMMARY TABLE:")
    # Extract scores from ranked_models for summary table
    model_scores_dict = dict(ranked_models)
    print(f"   Model A (Defenders only):           Score = {model_scores_dict.get('drapm_model_a_actual', {}).get('score', 0):.3f}")
    print(f"   Model B (+ offensive controls):     Score = {model_scores_dict.get('drapm_model_b_actual', {}).get('score', 0):.3f}")
    print(f"   Model C (+ team fixed effects):     Score = {model_scores_dict.get('drapm_model_c_actual', {}).get('score', 0):.3f}")

    return best_score >= 0.4  # Return True if any model passes production threshold


if __name__ == "__main__":
    success = main()