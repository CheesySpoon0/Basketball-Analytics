# Net RAPM Leaderboard Discrepancy Audit

## Root Cause: Dual RAPM Table Architecture

**CRITICAL FINDING**: Our application has TWO separate RAPM data sources that may be out of sync.

## 1. Net RAPM Calculation Method

### Current Implementation
- **Source**: `/impact` and `/players` pages use `PlayerImpact` table
- **Fields Used**:
  ```typescript
  rapm: impact.rapm,           // Line 94 impact/page.tsx
  orapm: impact.orapm,         // Line 95 impact/page.tsx  
  drapm: impact.drapm          // Line 96 impact/page.tsx
  ```
- **Net RAPM**: Uses direct `impact.rapm` field, NOT `orapm + drapm`
- **Schema**: PlayerImpact table (lines 195-218 prisma/schema.prisma)

### Dual Table Architecture
1. **PlayerImpact** (Legacy):
   - Used by leaderboard pages (`/impact`, `/players`)
   - Fields: `orapm`, `drapm`, `rapm`, `orapmExpected`, `drapmExpected`, `rapmExpected`
   - Unique key: `[playerId, season]`

2. **PlayerRapm** (New):
   - Used by validation scripts and data loading
   - Fields: `orapm`, `drapm`, `rapm`, `offPossUsed`, `defPossUsed`, `lambda`
   - Unique key: `[playerId, season, target]` (supports 'actual' vs 'xefg' targets)

## 2. Query Sorting Analysis

### /players Page (lines 75-137)
❌ **MAJOR ISSUE**: In-memory sorting with arbitrary limit
```typescript
take: 500 // Line 87 - fetches arbitrary 500 players
.sort((a, b) => { // Line 124 - sorts in memory after fetch
  case 'rapm': return (b.rapm || -999) - (a.rapm || -999);
```

**Problem**: This fetches first 500 players matching WHERE conditions, then sorts. Database ORDER BY would be more accurate.

### /impact Page (lines 25-113)
✅ **CORRECT**: Fetches ALL eligible players, sorts in memory
```typescript
// No take() limit - gets all players
.sort((a, b) => { // Line 103 - sorts all eligible players
  case 'rapm': return (b.rapm || -999) - (a.rapm || -999);
```

## 3. PlayerImpact Join Verification

### Season-Specific Data ✅
Both pages correctly use:
```typescript
seasonStats: {
  where: { season },
  include: { team: true } // Season-specific team
},
impact: {
  where: { season }      // Season-specific RAPM
}
```

### Team Display ✅
```typescript
team: stats.team, // Uses season-specific team from PlayerSeasonStats
```

## 4. Top 25 Comparison Issues

### Missing Players - Potential Causes:

1. **Different Data Sources**: 
   - Our leaderboards use `PlayerImpact`
   - Hoop Explorer may use different model/data
   
2. **Sample Size Filters**:
   ```typescript
   games: { gte: minGames }  // Default 5 games minimum
   ```
   
3. **Data Coverage**:
   - PlayerImpact may not have all players that Hoop Explorer has
   - Different season data completeness
   
4. **Model Differences**:
   - Our model uses different regularization (λ parameter)
   - Different prior distributions
   - Different stint filtering criteria

### Specific Player Check (Would Need Database):
- Cameron Boozer
- Yaxel Lendeborg  
- Jeremy Fears Jr.
- Fletcher Loyer
- Joshua Jefferson
- Nate Heise

## 5. Scale Analysis

### Expected Ranges (Points per 100 Possessions):
- **Elite Players**: +8 to +15 Net RAPM
- **Good Players**: +3 to +8 Net RAPM  
- **Average**: -2 to +3 Net RAPM
- **Poor**: Below -2 Net RAPM

### Code Evidence of Proper Scale:
```typescript
// UI displays with 1 decimal place, proper +/- signs
{player.rapm >= 0 ? '+' : ''}{player.rapm.toFixed(1)}
```

### Confidence Explanation:
```html
"Regularized Adjusted Plus-Minus measures individual player impact in points per 100 possessions"
```

## 6. Model Construction Analysis

### From load-rapm.ts (lines 18-26):
```typescript
interface RapmResult {
  orapm: number;    // Separate offensive model
  drapm: number;    // Separate defensive model  
  rapm: number;     // Net result
}
```

**FINDING**: Net RAPM is calculated as separate O/D models, but stored as independent `rapm` field.

**Line 183 Bug**: Validation script has typo:
```typescript
mean_rapm: validPlayers.reduce((sum, p) => sum + p.ramp, 0) // Should be p.rapm
```

## Root Cause Categories

### 1. ❌ Data Mapping Bug 
**CRITICAL**: Dual table architecture with potential sync issues
- `PlayerImpact` (used by UI) vs `PlayerRapm` (used by data pipeline)
- May have different data completeness or model versions

### 2. ❌ Query Bug
**MAJOR**: `/players` page sorts only first 500 results, not all eligible players
- Should use database-level `ORDER BY` instead of in-memory sort after arbitrary limit

### 3. ⚠️ Model Methodology Difference
- Our model may use different parameters than Hoop Explorer
- Need to verify λ (lambda) regularization values
- Need to verify prior distributions

### 4. ✅ Display/UI Correctly Implemented
- Proper season-specific joins
- Correct scale (points per 100 possessions)  
- Proper confidence explanations

## Immediate Recommendations

### HIGH PRIORITY:
1. **Reconcile Dual RAPM Tables**: 
   - Audit which table is canonical
   - Sync data between `PlayerImpact` and `PlayerRapm`
   - Deprecate one or clearly separate their purposes

2. **Fix /players Query**:
   ```typescript
   // Change from:
   take: 500
   // To database-level sorting:
   orderBy: { impact: { rapm: 'desc' } }
   ```

3. **Database Query for Missing Players**:
   - Check if test players exist in our `PlayerImpact` table
   - Compare counts between our data and expected D1 coverage

### MEDIUM PRIORITY:
4. **Model Parameter Audit**:
   - Compare our λ values with Hoop Explorer methodology
   - Verify prior strength and distribution
   - Check stint inclusion criteria

5. **Direct Net RAPM Model**:
   - Consider training direct Net RAPM instead of O+D models
   - Would eliminate potential O/D summation vs direct model differences

### LOW PRIORITY:
6. **Leaderboard Enhancement**:
   - Add possession counts for confidence assessment
   - Add model version/date information
   - Add filters for different confidence levels

## Next Steps

1. Access database to audit data completeness
2. Compare `PlayerImpact` vs `PlayerRapm` data coverage
3. Fix `/players` page query methodology
4. Generate actual top-25 comparison with real data