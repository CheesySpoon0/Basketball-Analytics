# RAPM Baseline Reproducibility Audit Report

## Executive Summary

**CRITICAL FINDING**: Investigation into whether the current RAPM training pipeline can reproduce production PlayerImpact values.

❌ **PIPELINE IS NOT REPRODUCIBLE**: Significant discrepancies found between retrained λ=1000 and production.
❌ **Lambda grid validation results are questionable**.

- **Net RAPM correlation**: 0.1054
- **Top 25 overlap**: 0/25
- **Players compared**: 4860
- **Method**: Direct comparison of identical players between production and retrained data

## Key Findings

### Correlation Analysis
- **ORAPM correlation**: 1.0000
- **DRAPM correlation**: -0.9534
- **Net RAPM correlation**: 0.1054

⚠️ **Low correlation indicates the retraining pipeline is using different data, model, or processing logic than production.**

### Ranking Stability
- **Top 25 overlap**: 0/25 (0.0%)

### Biggest Discrepancies

Top 10 players with largest Net RAPM differences:

| Player | Team | Production | Retrained | Difference | Prod Rank | Retr Rank |
|--------|------|------------|-----------|------------|-----------|-----------|
| Jaden Cooper | UMES | 4.7 | -5.7 | 10.3 | 71 | 5421 |
| RJ Godfrey | CLEM | 6.8 | -3.0 | 9.9 | 9 | 5262 |
| Isaiah Evans | DUKE | 7.6 | -1.8 | 9.3 | 7 | 4793 |
| Drew Steffe | SIU | 3.0 | -5.7 | 8.8 | 313 | 5422 |
| Tan Yildizoglu | VMI | -5.9 | 2.6 | -8.5 | 4855 | 299 |
| TJ Johnson | VMI | -5.2 | 3.3 | -8.4 | 4842 | 153 |
| Justin Monden | UMES | -4.2 | 4.2 | -8.4 | 4791 | 43 |
| Dylan Grant | RUTG | -4.9 | 3.4 | -8.4 | 4829 | 120 |
| Garwey Dual | MCN | 3.9 | -4.4 | 8.3 | 159 | 5403 |
| Kamrin Oriol | UNF | -5.9 | 2.3 | -8.2 | 4854 | 377 |

### Sign Convention Check
- Production average ORAPM: 0.002
- Retrained average ORAPM: 0.002
- Production average DRAPM: 0.016
- Retrained average DRAPM: -0.015

## Recommendations

### ❌ Pipeline Requires Investigation
1. **DO NOT update production PlayerImpact** until reproducibility is achieved
2. **DO NOT trust lambda grid results** - underlying pipeline has issues
3. **Investigate data source differences** between production and retraining
4. **Check model configuration differences** (centering, sign conventions, targets)
5. **Verify production source file** and compare to retraining output
6. **Fix pipeline discrepancies** before lambda optimization

**CRITICAL**: This audit must pass before any lambda changes reach production.
