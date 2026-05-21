# xeFG Python training pipeline

Train shot-quality models on `Play` rows and export coefficients for the TypeScript app.

## Setup

```bash
cd scripts/python/xefg
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env: DATABASE_URL=postgresql://...
```

Load `DATABASE_URL` from the repo root `.env` if you prefer:

```bash
export $(grep -v '^#' ../../../.env | xargs)
```

## 1. Extract shots

```bash
python extract_shots.py
```

Writes `data/shots.csv` (gitignored). Filters:

- `shotX` / `shotY` present
- `shotRange != 'free_throw'`
- Target: `shotMade` (not `scoringPlay`)

Prints zone FG% sanity check — compare to NCAA norms before training.

## 2. Train models

```bash
python train_model.py
```

- 80/20 split, stratified by zone, `random_state=42`
- Logistic regression (scaled numerics + one-hot indicators) → **`../../../lib/xefg/coefficients.json`**
- XGBoost reference → `output/model.json` (not used in production TS)
- Calibration plot → `output/calibration_lr.png`
- Parity sample → `output/parity_sample.csv` (100 rows for TS test)

## 3. TypeScript cache + parity

From repo root:

```bash
npx tsx scripts/test-xefg-parity.ts
npx tsx scripts/compute-xefg-cache.ts
```

## When to retrain

- Major play ingest / new season
- Feature engineering changes (bump `model_version` in JSON + `CURRENT_PROMPT_VERSION` in coach brief route)
- After retrain, regenerate cache and spot-check players (`scripts/validate-xefg-players.ts`)

## Coordinate system

Distance and zones use the **same transform** as `components/Court.tsx`:

```text
courtX = rawX > 470 ? 940 - rawX : rawX
svgX   = rawY
svgY   = 350 - courtX
basket at (250, 297.5), 10 SVG units = 1 foot
```

Do not use `(shotX-25, shotY)` — CBBD coords are not in that space.
