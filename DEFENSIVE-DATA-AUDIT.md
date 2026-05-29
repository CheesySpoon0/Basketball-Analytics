# Phase 1: Defensive Data Audit Report

## Summary
Based on schema analysis, here are the available defensive data fields for building an "Observed Defensive Impact" section:

## 1. PlayerSeasonStats Defensive Fields
**Available for individual box score stats:**
- `steals: Int?` - Player steals per season
- `blocks: Int?` - Player blocks per season  
- `defRebounds: Int?` - Player defensive rebounds per season
- `fouls: Int?` - Player fouls per season
- `minutes: Int?` - Player minutes per season (for per-40 calculations)
- `games: Int?` - Player games per season (for per-game calculations)

**Possible calculations:**
- Steals per 40 minutes: `(steals / minutes) * 40 * 60` (minutes stored as seconds)
- Blocks per 40 minutes: `(blocks / minutes) * 40 * 60`
- Defensive rebounds per 40 minutes: `(defRebounds / minutes) * 40 * 60`
- Personal foul rate per 40 minutes: `(fouls / minutes) * 40 * 60`
- Defensive rebounding percentage (need team data for comparison)

## 2. PlayerImpact/RAPM Defensive Fields
**Available for adjusted impact metrics:**
- `drapm: Float?` - Defensive Regularized Adjusted Plus-Minus 
- `drapmExpected: Float?` - Expected defensive RAPM based on box score
- `confidence: String?` - Statistical confidence level
- `possessions: Int?` - Sample size of possessions for impact calculation
- `minutes: Int?` - Sample size of minutes for impact calculation

**Possible calculations:**
- DRAPM (primary defensive impact metric)
- DRAPM vs Expected (over/under-performance vs box score expectations)
- Confidence weighting based on possession sample size

## 3. LineupStint Defensive Fields
**Available for on-court defensive performance:**
- `pointsAgainst: Int` - Points allowed while player's lineup is on court
- `possessionsAgainst: Float?` - Opponent possessions while player's lineup is on court
- `confidence: String` - Data quality ('full' confidence only for reliable calculations)
- `steals: Int` - Team steals while lineup on court
- `blocks: Int` - Team blocks while lineup on court  
- `defRebounds: Int` - Team defensive rebounds while lineup on court
- `turnovers: Int` - Opponent turnovers forced while lineup on court
- `season: Int` - Season filter
- `teamId: Int` - Team filter
- `playerIds: String?` - Contains player ID to filter lineups

**Missing opponent shooting fields:** 
- No `oppFGA`, `oppFGM`, `opp3PA`, `opp3PM`, `oppFTA` fields found in LineupStint
- Cannot calculate opponent eFG% allowed or free throw rate allowed from current data

**Possible calculations:**
- On-court Defensive Rating: `(pointsAgainst / possessionsAgainst) * 100`
- Forced turnover rate: `(turnovers / possessionsAgainst) * 100`
- Team defensive events per 100 possessions while on court

## 4. Play/Shot Data Defensive Fields
**Limited defensive shot tracking:**
- Opponent shots can be identified by `teamId` != player's team
- `shotRange: String?` - Three-pointer vs two-pointer classification
- `shotMade: Boolean?` - Made/missed result
- `shotX/shotY: Float?` - Shot location coordinates
- `gameId: Int` - To match with player's games

**Limitations:**
- No direct "defender" field - cannot identify which specific player defended the shot
- Can only analyze opponent shooting in games player participated in, not specifically when player was on court
- Would need to cross-reference with LineupStint timing data to determine on-court context

## 5. Sample Size Thresholds for Confidence
Based on common basketball analytics standards:

**High confidence:** 500+ defensive possessions
- Reliable for all defensive metrics
- Full display with confidence badge

**Medium confidence:** 200-499 defensive possessions  
- Show main metrics with "limited sample" warning
- Gray out most granular breakdowns

**Low confidence:** <200 defensive possessions
- Show only DRAPM and basic box score rates
- Heavy "small sample" disclaimers
- Hide on-court metrics entirely

## 6. Recommended Phase 2 Implementation

### Available Calculations (in priority order):
1. **DRAPM** - Most reliable single defensive metric (from PlayerImpact)
2. **On-court DRtg** - Points allowed per 100 possessions (from LineupStint)  
3. **Forced TO%** - Turnover rate created while on court (from LineupStint)
4. **Personal foul rate per 40** - Individual fouling tendency (from PlayerSeasonStats)
5. **Steals per 40** - Individual steal rate (from PlayerSeasonStats)
6. **Blocks per 40** - Individual shot blocking (from PlayerSeasonStats)
7. **Defensive rebounds per 40** - Individual rebounding (from PlayerSeasonStats)

### Not Available with Current Data:
- Opponent eFG% allowed (no opponent shooting stats in LineupStint)
- Opponent 3PA rate allowed (no opponent shot type breakdown)
- Opponent free throw rate allowed (no opponent FTA data)
- Individual matchup data (no defender tracking)
- Shot contests or defensive impact on individual possessions

### Season/Team Specificity:
✅ **PlayerSeasonStats**: Already season/team specific via `playerId + season + teamId`
✅ **PlayerImpact**: Season specific via `playerId + season` 
✅ **LineupStint**: Season/team specific via `season + teamId + playerIds contains`

This ensures no cross-season or cross-team data leakage.