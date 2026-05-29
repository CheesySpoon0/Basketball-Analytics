# RAPM Pipeline - Complete Implementation Guide

## Overview

The RAPM (Regularized Adjusted Plus-Minus) pipeline generates player impact ratings by fitting ridge regression on lineup data. This implementation includes partial stint recovery, bias auditing, and dual-target modeling (actual vs xeFG points).

**Output**: Per-player `ORAPM` and `DRAPM` in points per 100 possessions, with box-score priors and comprehensive validation.

---

## Pipeline Architecture

### Phase 0: Data Preparation
- **0A**: Partial stint recovery using hard evidence only
- **0B**: Coverage bias audit to identify potential RAPM reliability issues

### Phase 1: RAPM Training
- **1A**: Extract full-confidence stints with interval intersection
- **1B**: Fit ridge regression with box-score priors on dual targets

### Phase 2: Database Integration
- Load RAPM results into `PlayerRapm` table with validation

---

## File Structure

```
scripts/
├── recover-partial-stints.ts          # Phase 0A: Evidence-based stint recovery  
├── audit-rapm-coverage.ts             # Phase 0B: Bias detection and reporting
├── load-rapm.ts                       # Load JSON results to database
├── validate-rapm.ts                   # Comprehensive result validation
└── python/rapm/
    ├── extract_stints.py              # Phase 1A: Pull stints with intersection
    ├── build_design_matrix.py         # Sparse matrix construction
    ├── train_rapm.py                  # Phase 1B: Ridge fitting
    ├── requirements.txt               # Python dependencies
    └── output/                        # Generated JSON results (gitignored)
        ├── rapm_actual.json
        └── rapm_xefg.json
```

---

## Phase 0A: Partial Stint Recovery

**Purpose**: Recover lineup stints where player identification failed, using only hard evidence.

### Recovery Methods

1. **Event-based presence** (primary): Players credited with play events during stint windows are demonstrably on the floor
2. **Bookend propagation** (secondary): Players who start/end adjacent full stints with no recorded substitution

### Usage

```bash
# Preview recovery without database changes
npx tsx scripts/recover-partial-stints.ts --season=2026 --dry-run

# Apply recovery to database
npx tsx scripts/recover-partial-stints.ts --season=2026 --write
```

### Output
- Updates `lineup_stints.confidence` to `'full_inferred'` or `'conflict'`
- Reports recovery counts by method
- Shows new confidence breakdown

### Key Principles
- **Never guess a player onto the floor** - only use proof of presence
- **Flag conflicts** - if >5 players have evidence, mark as `'conflict'` rather than guess
- **Transparent reporting** - distinguish `'full'` (original) from `'full_inferred'` (recovered)

---

## Phase 0B: Coverage Bias Audit

**Purpose**: Identify players with high partial stint exposure who may have unreliable RAPM estimates.

### Bias Detection

1. **Per-player partial fraction**: `(total_poss - usable_poss) / total_poss`
2. **Distribution analysis**: Check if missingness is random or skewed
3. **Situational bias**: Compare partial vs full stint game contexts

### Usage

```bash
npx tsx scripts/audit-rapm-coverage.ts --season=2026
```

### Output
- Player-level partial exposure rates
- Distribution histogram and verdict
- Situational bias analysis (blowouts vs close games)
- List of high-partial players (>35%) to flag in RAPM output

### Interpretation
- **"Flat" distribution**: Random missingness, RAPM is sound
- **"Skewed" distribution**: Systematic bias, flag affected players
- **"Concerning" situational bias**: Crunch-time or garbage-time clustering

---

## Phase 1A: Stint Extraction

**Purpose**: Extract full-confidence lineup stints with temporal intersection for RAPM training.

### The Pairing Problem
Lineup stints are recorded per-team, but RAPM requires knowing both teams' lineups simultaneously. Simple time-window matching only catches ~16% of stints.

### Solution: Interval Intersection
1. Within each (game, period), overlay both teams' stint timelines
2. Cut at every boundary from either team to create sub-intervals
3. Each sub-interval has constant 5-player lineups on both sides
4. Prorate box-score stats by sub-interval duration

### Usage

```bash
cd scripts/python/rapm
python extract_stints.py --season=2026
```

### Output
- `data/stints.csv`: Sub-interval observations with prorated stats
- Each row represents one team's offensive possessions vs opponent defense
- Includes actual and xeFG expected points for dual-target training

---

## Phase 1B: RAPM Training

**Purpose**: Fit ridge regression on dual targets with box-score priors.

### Design Matrix Structure
- **Rows**: One per team-possession (offense vs defense)
- **Columns**: `[ORAPM_1...ORAPM_n | DRAPM_1...DRAPM_n | home_advantage]`
- **Targets**: Points per 100 possessions (actual and xeFG)
- **Weights**: Possession counts

### Box-Score Prior
Instead of shrinking toward zero, shrink toward expected RAPM from traditional stats:
- **Offensive prior**: Points, assists, turnovers, TS%, 3P%
- **Defensive prior**: Steals, blocks, defensive rebounds

### Usage

```bash
cd scripts/python/rapm
python train_rapm.py --season=2026
```

### Output
- `output/rapm_actual.json`: Actual points per 100 RAPM
- `output/rapm_xefg.json`: Expected points per 100 RAPM
- Cross-validation results and model diagnostics

### Key Parameters
- **λ=2500**: Ridge penalty (tunable via environment variable `RAPM_LAMBDA`)
- **Dual targets**: Enables comparison of actual vs expected performance
- **Possession thresholds**: Only includes players with meaningful sample sizes

---

## Phase 2: Database Integration

### Loading Results

```bash
# Preview what would be loaded
npx tsx scripts/load-rapm.ts --season=2026 --dry-run

# Load both actual and xeFG results
npx tsx scripts/load-rapm.ts --season=2026

# Load specific file
npx tsx scripts/load-rapm.ts --actual=scripts/python/rapm/output/rapm_actual.json

# Show existing data
npx tsx scripts/load-rapm.ts --show-existing --season=2026
```

### Database Schema

```sql
CREATE TABLE player_rapm (
  id SERIAL PRIMARY KEY,
  "playerId" INTEGER NOT NULL,
  season INTEGER NOT NULL,
  target VARCHAR NOT NULL, -- 'actual' | 'xefg'
  
  orapm DECIMAL NOT NULL,    -- Offensive RAPM (pts/100)
  drapm DECIMAL NOT NULL,    -- Defensive RAPM (pts/100) 
  rapm DECIMAL NOT NULL,     -- orapm + drapm
  
  "offPossUsed" INTEGER NOT NULL,  -- Sample size
  "defPossUsed" INTEGER NOT NULL,
  
  lambda DECIMAL NOT NULL,         -- Ridge penalty used
  "priorOrapm" DECIMAL,           -- Box-score prior
  "priorDrapm" DECIMAL,
  
  "modelVersion" INTEGER DEFAULT 1,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW(),
  
  UNIQUE("playerId", season, target),
  FOREIGN KEY("playerId") REFERENCES players(id)
);
```

---

## Validation and Quality Assurance

### Comprehensive Validation

```bash
# Full validation report
npx tsx scripts/validate-rapm.ts --season=2026

# Target-specific leaderboards  
npx tsx scripts/validate-rapm.ts --season=2026 --target=actual

# Team-specific analysis
npx tsx scripts/validate-rapm.ts --season=2026 --team=308
```

### Health Check Criteria

1. **Distribution symmetry**: Mean RAPM ≈ 0 (centered around league average)
2. **Outlier detection**: Flag players with |RAPM| > 25 as potential data issues
3. **Cross-target correlation**: r > 0.7 between actual and xeFG targets
4. **Sample size validation**: Minimum possession thresholds for reliable estimates
5. **Team spot checks**: Named programs (UCI, Auburn, etc.) for sanity validation

### Expected Output Ranges
- **ORAPM**: Typically -15 to +15 pts/100 for college basketball
- **DRAPM**: Typically -10 to +10 pts/100 (positive = good defense)
- **Total RAPM**: Elite players often ±8-12, exceptional outliers may reach ±20

---

## End-to-End Execution

### Full Pipeline Run

```bash
# Phase 0A: Recover partial stints
npx tsx scripts/recover-partial-stints.ts --season=2026 --write

# Phase 0B: Audit coverage bias
npx tsx scripts/audit-rapm-coverage.ts --season=2026

# Phase 1A: Extract stint data
cd scripts/python/rapm
python extract_stints.py --season=2026

# Phase 1B: Train RAPM models
python train_rapm.py --season=2026

# Phase 2: Load to database
cd ../../../
npx tsx scripts/load-rapm.ts --season=2026

# Validation
npx tsx scripts/validate-rapm.ts --season=2026
```

### Prerequisites

1. **Database**: `lineup_stints` table populated with confidence ratings
2. **Python environment**: `pip install -r scripts/python/rapm/requirements.txt`
3. **Environment variables**: `DATABASE_URL`, optional `RAPM_SEASON`, `RAPM_LAMBDA`

### Time Estimates
- **Phase 0**: ~5-10 minutes (stint recovery + audit)
- **Phase 1**: ~10-20 minutes (extraction + training)
- **Phase 2**: ~2-5 minutes (database loading + validation)

---

## Troubleshooting

### Common Issues

1. **Low stint recovery**: Check play-by-play data completeness
2. **High partial fraction players**: Expected for bench players, flag in UI
3. **Poor cross-target correlation**: Validate xeFG model consistency
4. **Extreme outliers**: Check for data quality issues in source stints

### Data Quality Flags

- **Low confidence players**: >35% partial stint exposure
- **Small sample warnings**: <200 total possessions
- **Outlier alerts**: |RAPM| > 25 (manual review recommended)

### Performance Tuning

- **λ adjustment**: Increase if extreme outliers, decrease if all players too close to zero
- **Prior coefficient tuning**: Refit on previous season's RAPM for better shrinkage
- **Sample filtering**: Adjust minimum possession thresholds based on desired precision

---

## Integration with Frontend

### API Considerations

The `PlayerRapm` table enables season-specific RAPM queries:

```typescript
// Get player RAPM for specific season/target
const playerRapm = await prisma.playerRapm.findUnique({
  where: {
    playerId_season_target: {
      playerId: 1234,
      season: 2026,
      target: 'actual'
    }
  }
});

// Team RAPM leaderboard
const teamRapm = await prisma.playerRapm.findMany({
  where: { season: 2026, target: 'actual' },
  include: {
    player: {
      include: {
        seasonStats: {
          where: { season: 2026, teamId: 308 },
          include: { team: true }
        }
      }
    }
  },
  orderBy: { rapm: 'desc' },
  take: 20
});
```

### UI Components

- **Player cards**: Show ORAPM/DRAPM with confidence indicators
- **Team pages**: Lineup impact analysis with RAPM-based projections  
- **Comparison tools**: Cross-target analysis (actual vs expected)
- **Filters**: Min possession thresholds, confidence levels

---

## Future Enhancements

### V2 Improvements
1. **Multi-season modeling**: Partial pooling across seasons for stability
2. **Advanced priors**: Hierarchical models with team/conference effects
3. **Uncertainty quantification**: Bootstrap confidence intervals
4. **Real-time updates**: Incremental RAPM as season progresses

### Research Extensions
1. **Lineup synergy**: Interaction effects beyond individual player impact
2. **Context-dependent RAPM**: Opponent-adjusted impact ratings
3. **Temporal effects**: Early vs late season performance modeling
4. **Transfer analysis**: Cross-institutional player impact consistency

---

## Conclusion

This RAPM implementation provides robust, validated player impact metrics with comprehensive bias detection and quality assurance. The dual-target approach (actual vs expected) enables separation of luck from skill, while the box-score prior system provides more stable estimates than traditional zero-shrinkage RAPM.

Key strengths:
- **Evidence-based recovery**: No guessing on partial lineups
- **Bias transparency**: Clear reporting of data quality limitations  
- **Dual targets**: Actual vs expected performance separation
- **Validation depth**: Multiple sanity checks and correlation analysis
- **Production ready**: Database integration with proper indexing and constraints

The pipeline generates publication-quality RAPM estimates suitable for player evaluation, lineup optimization, and advanced analytics integration.