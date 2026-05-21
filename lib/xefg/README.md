# xeFG (Expected eFG) — TypeScript inference

Predicts **P(make)** per field-goal attempt from shot location, type, game context, and inferred transition. Aggregates to **expected eFG** and compares to **actual eFG** (shot-making vs shot quality).

## Model

- **Production:** logistic regression coefficients in `coefficients.json` (trained in Python).
- **Retrain:** `scripts/python/xefg/train_model.py` → overwrites `lib/xefg/coefficients.json`.

## Feature engineering (must match Python)

| Feature | Rule |
|---------|------|
| `distance_from_rim` | `shotDistanceFt(rawX, rawY)` — same transform as `components/Court.tsx` |
| `shot_zone` | `rim` / `mid` / `three` via `classifyZone()` |
| `is_corner_three` | Three + \|svgX−250\|/10 > 18 + svgY > 250 |
| Shot types | `playType`: LayUpShot, DunkShot, JumpShot, TipShot |
| `is_end_of_period` | `secondsRemaining < 30` (not shot-clock) |
| `is_transition` | ≤7s since prior defensive event in same period (`transition.ts`) |
| `home_team` | shooter `teamId === game.homeTeamId` |
| Distance bins | `dist_0_3`, `dist_3_10`, `dist_10_22` (one-hot) |

**Not used:** `shotAssisted` (only populated on makes — target leak).

## API

```ts
import { predictShot, getPlayerXeFGCached, formatDelta, formatRate } from '@/lib/xefg';

const { pMake, expectedEfg } = predictShot(rawShot);
const agg = await getPlayerXeFGCached(playerId, 2025);
// agg.actualEfg, agg.expectedEfg, agg.delta (fraction; ×100 for pp)
```

## Terminology (do not mix these)

| Term | Meaning | Formula |
|------|---------|---------|
| **P(make)** / **Expected FG%** | Model predicted make probability for one shot | Logistic output in `[0,1]` |
| **Expected eFG%** / **xeFG** | Shot-quality efficiency on a shot mix | `Σ P(make) × shotValue / FGA` where `shotValue` is `1.5` on threes, `1.0` on twos |
| **Actual eFG%** | What they actually shot | `(FGM + 0.5×3PM) / FGA` |
| **Delta** | Shot-making vs shot quality | `actual eFG − expected eFG` (report in pp) |

The **team shot heatmap** “Expected FG%” toggle colors cells by average **P(make)** only (spatial make quality). It is **not** expected eFG% (no 1.5× on threes in the heatmap).

## Interpretation

- **Expected eFG%** — quality of looks (what a league-average finisher would score on that mix).
- **Actual eFG%** — what they actually shot.
- **Delta (actual − expected)** — positive = shotmaker; negative = efficiency from selection not finishing.

Defense: **lower expected eFG allowed** = good shot prevention; **actual − expected** on defense = contest quality (negative is good).

## Cache

Run after training or data refresh:

```bash
npx tsx scripts/compute-xefg-cache.ts
```

Populates `PlayerXeFG` and `TeamXeFG` (Prisma).

## Parity

```bash
npx tsx scripts/test-xefg-parity.ts
```

Requires `scripts/python/xefg/output/parity_sample.csv` from training.

## Limitations

- No defender distance / contest data.
- No shot-clock; end-of-period proxy only.
- Transition inferred from play sequence.
- Model is logistic regression on binned features — not a full tracking model.
