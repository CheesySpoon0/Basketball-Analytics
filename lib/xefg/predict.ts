// ============================================================================
// xeFG inference: applies the logistic regression weights stored in
// lib/xefg/coefficients.json to a feature vector and returns P(make).
//
// Standardization: numeric features are (x - mean) / std using the scaler
// params from training. Indicator features (0/1) pass through unchanged.
// ============================================================================
import coefficients from './coefficients.json';
import { extractFeatures } from './features';
import type { RawShot, ShotFeatures, ShotPrediction } from './types';

type Coefs = typeof coefficients;

const FEATURES = (coefficients as Coefs).features;
const N_NUMERIC = (coefficients as Coefs).n_numeric;
const NUMERIC_FEATURES = (coefficients as Coefs).numeric_features;
const SCALER_MEAN = (coefficients as Coefs).scaler.mean;
const SCALER_SCALE = (coefficients as Coefs).scaler.scale;
const COEFS_VEC = (coefficients as Coefs).coefficients;
const INTERCEPT = (coefficients as Coefs).intercept;

if (FEATURES.length !== COEFS_VEC.length) {
  throw new Error('xeFG: features / coefficients length mismatch in coefficients.json');
}
if (SCALER_MEAN.length !== N_NUMERIC || SCALER_SCALE.length !== N_NUMERIC) {
  throw new Error('xeFG: scaler arrays must match n_numeric in coefficients.json');
}

function sigmoid(z: number): number {
  if (z > 30) return 1;
  if (z < -30) return 0;
  return 1 / (1 + Math.exp(-z));
}

/** Apply LR to an extracted feature vector. */
export function predictMakeFromFeatures(f: ShotFeatures): number {
  let z = INTERCEPT;
  for (let i = 0; i < FEATURES.length; i++) {
    const key = FEATURES[i] as keyof ShotFeatures;
    let v = f[key] ?? 0;
    if (i < N_NUMERIC) {
      const mean = SCALER_MEAN[i];
      const scale = SCALER_SCALE[i] || 1;
      v = (v - mean) / scale;
    }
    z += COEFS_VEC[i] * v;
  }
  return sigmoid(z);
}

/** Convenience: extract + predict in one call. */
export function predictShot(shot: RawShot): ShotPrediction {
  const features = extractFeatures(shot);
  const pMake = predictMakeFromFeatures(features);
  const isThree = features.zone_three;
  // pMake alone is Expected FG% (make probability), NOT xeFG.
  // expectedEfg is per-shot eFG contribution: P(make)×1.5 on threes, P(make)×1.0 on twos.
  // Aggregating expectedEfg / FGA yields Expected eFG%.
  const pointWeight = isThree ? 1.5 : 1.0;
  return {
    pMake,
    expectedEfg: pMake * pointWeight,
    isThree,
  };
}

/** Diagnostics for debugging — exposes the loaded metadata. */
export const XEFG_MODEL_INFO = {
  model: (coefficients as Coefs).model,
  trainedOn: (coefficients as Coefs).trained_on,
  modelVersion: (coefficients as Coefs).model_version,
  nShots: (coefficients as Coefs).n_shots,
  metrics: (coefficients as Coefs).metrics,
  limitations: (coefficients as Coefs).limitations,
};
