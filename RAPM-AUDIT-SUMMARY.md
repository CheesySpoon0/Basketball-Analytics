# Net RAPM Leaderboard Audit - Summary Report

## Critical Issues Found

### 🔴 HIGH PRIORITY: Dual RAPM Table Architecture
**Root Cause**: Data mapping inconsistency
- **PlayerImpact** table (used by UI leaderboards)
- **PlayerRapm** table (used by data pipeline/validation)
- These may be out of sync or have different model versions

### 🔴 HIGH PRIORITY: Query Sorting Bug in /players
**Root Cause**: Display/query bug
- Previously used `take: 500` then sorted in memory
- Would miss top RAPM players not in first 500 arbitrary results
- **FIXED**: Removed arbitrary limit to sort all eligible players

### 🟡 MEDIUM PRIORITY: Model Methodology Differences
**Root Cause**: True model disagreement with Hoop Explorer
- Different regularization parameters (λ)
- Different prior distributions  
- Different stint inclusion criteria
- Different data coverage

## Technical Analysis

### 1. Net RAPM Calculation ✅ Correct
```typescript
// Uses direct RAPM field from PlayerImpact, not ORAPM + DRAPM
rapm: impact.rapm
```

### 2. Season-Specific Joins ✅ Correct  
```typescript
seasonStats: { where: { season }, include: { team: true } }
impact: { where: { season } }
team: stats.team // Uses season-specific team data
```

### 3. Scale ✅ Correct
- Points per 100 possessions
- Proper +/- display formatting
- Reasonable value ranges expected

### 4. Query Efficiency ✅ Fixed
- `/impact` page: Fetches all eligible players ✅
- `/players` page: **FIXED** to remove arbitrary 500 limit ✅

## Missing Player Analysis

Without database access, cannot confirm if specific players are missing due to:
1. **Data coverage**: Players not in our PlayerImpact table
2. **Sample size filters**: Minimum games requirements (default 5)
3. **Model differences**: Different inclusion criteria than Hoop Explorer

## Immediate Actions Taken

### Code Changes:
1. **Fixed /players sorting**: Removed `take: 500` limit that caused incomplete sorting
2. **Added documentation**: Clarified dual table architecture issues
3. **Performance note**: Added TODO for database-level ORDER BY

### Audit Documentation:
1. **NET-RAPM-DISCREPANCY-AUDIT.md**: Comprehensive technical analysis
2. **Code annotations**: Identified critical areas needing database validation

## Recommendations by Priority

### IMMEDIATE (Database Access Required):
1. **Data Sync Audit**: Compare PlayerImpact vs PlayerRapm coverage
2. **Missing Player Check**: Query for Cameron Boozer, Yaxel Lendeborg, etc.
3. **Model Version Verification**: Confirm which table is canonical

### SHORT-TERM:
4. **Database-Level Sorting**: Add ORDER BY to queries for better performance
5. **Table Consolidation**: Deprecate one RAPM table or clarify purposes
6. **Model Parameter Documentation**: Document λ, priors, stint criteria

### MEDIUM-TERM:  
7. **Direct Net RAPM Model**: Consider unified model vs separate O/D models
8. **Leaderboard Enhancements**: Add possession counts, model metadata
9. **Validation Pipeline**: Ensure data sync between tables

## Root Cause Classification

✅ **Display/Query Bug**: Fixed sorting issue in /players
🟡 **Data Mapping Bug**: Dual table architecture needs resolution (requires DB access)
🟡 **Model Methodology Difference**: Likely contributor to Hoop Explorer differences
❌ **True Model Disagreement**: Cannot rule out until model parameters compared

## Next Steps

1. **Database access** to run comprehensive data audit
2. **Compare actual top 25** with database queries
3. **Validate model parameters** against Hoop Explorer methodology
4. **Implement recommendations** based on audit findings

The dual table architecture is the most likely root cause of leaderboard discrepancies, followed by potential model parameter differences with Hoop Explorer.