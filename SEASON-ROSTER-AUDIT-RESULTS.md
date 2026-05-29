# Season-Specific Roster Correctness Audit - COMPLETED

## Problem Identified
The app was using `Player.teamId` (current/latest team assignment) instead of `PlayerSeasonStats` for season-aware pages, causing players to appear on team rosters for seasons they didn't actually play for that team.

**Example Bug:** Michigan State 2024-25 incorrectly showed Trey Fort and Cam Ward, who weren't on that team-season.

## Root Cause
Multiple pages and APIs queried players using `Player.teamId` and `include: { team: true }`, which returns the current team assignment rather than the historical season-specific team from `PlayerSeasonStats`.

## Files Fixed

### 1. `/app/players/page.tsx` ✅
**Issue:** Used `player.team` (current team) in player listings  
**Fix:** Added `include: { team: true }` to `seasonStats` query and changed `team: player.team` to `team: stats.team`  
**Impact:** Player Database now shows correct season-specific teams

### 2. `/app/players/[playerId]/report/page.tsx` ✅
**Issue:** Player scouting reports showed current team, not season-specific team  
**Fix:** Modified `buildPlayerScoutingReport()` in `/lib/player-scouting/build-player-report.ts` to:
- Remove `include: { team: true }` from player query
- Add `include: { team: true }` to seasonStats query  
- Return `seasonStats?.team` instead of `player.team`
**Impact:** Player reports now show correct team for the selected season

### 3. `/app/players/[playerId]/page.tsx` ✅
**Issue:** Player shot chart pages showed current team info  
**Fix:** Added season-specific team to `seasonStats` query and updated all `player.team` references to `seasonStats?.team`  
**Impact:** Player pages show correct season-specific team info

### 4. `/app/shot-quality/page.tsx` ✅  
**Issue:** Top shooters list showed current teams  
**Fix:** Completely refactored query to:
- Get players with shot volume first
- Separately query `PlayerSeasonStats` for season-specific teams
- Map results to combine player data with correct season teams
- Filter to only show players with season team data
**Impact:** Shot Quality page shows players with their correct season teams

### 5. `/app/impact/page.tsx` ✅
**Issue:** RAPM impact listings showed current teams  
**Fix:** Added `include: { team: true }` to seasonStats and changed `team: player.team` to `team: stats.team`  
**Impact:** Impact Metrics page shows correct season-specific teams

### 6. `/app/api/shot-chart/route.ts` ✅
**Issue:** Shot chart API returned current team info  
**Fix:** Added separate `PlayerSeasonStats` query with team include, updated response to use `seasonStats?.team`  
**Impact:** Shot chart API returns correct season-specific team data

### 7. `/app/teams/[teamId]/page.tsx` ✅ (Previously Fixed)
**Issue:** Team rosters showed players by current `teamId`  
**Fix:** Changed from `Player.findMany({ where: { teamId } })` to `PlayerSeasonStats.findMany({ where: { teamId, season } })`  
**Impact:** Team pages show only players who actually played for that team in that season

### 8. `/app/api/coach-brief/[teamId]/route.ts` ✅ (Previously Fixed)
**Issue:** Coach briefs analyzed current roster, not season roster  
**Fix:** Same pattern - use `PlayerSeasonStats` instead of `Player.teamId`  
**Impact:** Coach briefs analyze the correct season-specific roster

## Query Pattern Changes

### Before (Incorrect):
```typescript
const players = await prisma.player.findMany({
  where: { teamId },  // Current team assignment
  include: { 
    team: true,       // Current team
    seasonStats: { where: { season } }
  }
});
// Result: Shows players currently on team, regardless of season
```

### After (Correct):
```typescript
const seasonStats = await prisma.playerSeasonStats.findMany({
  where: { teamId, season },  // Season-specific filter
  include: { 
    team: true,               // Season-specific team
    player: true 
  }
});
// Result: Shows only players who played for that team in that season
```

## Validation

### Validation Script: `scripts/validate-season-roster-correctness.ts`
Created comprehensive validation that checks:
- Michigan State specific cases (Trey Fort, Cam Ward)
- Transfer case detection and validation  
- Consistency between old and new methods
- Sample team validation across multiple seasons

### Build Verification
- ✅ TypeScript compilation passes
- ✅ All pages build successfully  
- ✅ No type errors introduced

## Key Principle Established
**For any season-aware page, `PlayerSeasonStats` with `{ teamId, season }` is the source of truth for team membership, NOT `Player.teamId`.**

## Remaining Valid Uses of Player.teamId
`Player.teamId` should ONLY be used when current/latest team assignment is explicitly intended:
- General player search without season context
- Current roster management tools  
- "Where does this player play now?" queries

## Impact Summary
✅ **Michigan State 2024-25** will no longer incorrectly show Trey Fort or Cam Ward  
✅ **All team pages** show accurate historical rosters  
✅ **Player reports** display correct team for selected season  
✅ **Transfer cases** handled correctly across all pages  
✅ **Coach briefs** analyze accurate season-specific rosters  
✅ **RAPM/Impact data** shows correct team assignments  
✅ **Shot quality data** reflects actual season participation

The fix ensures complete season-specific roster correctness across the entire application while maintaining current team functionality where appropriate.