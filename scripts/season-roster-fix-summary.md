# Season-Specific Roster Data Fix

## Problem
Team pages were showing wrong players for specific seasons because they were using `Player.teamId` (current team assignment) instead of `PlayerSeasonStats` (historical season-specific roster).

Example bug: Michigan State 2024-25 showing Trey Fort and Cam Ward who weren't on that team-season.

## Root Cause
Two files had incorrect roster queries:

### 1. `/app/teams/[teamId]/page.tsx` (lines 164-167)
**BEFORE (Wrong):**
```typescript
// Roster + per-player season stats
const roster = await prisma.player.findMany({
  where: { teamId },
  include: { seasonStats: { where: { season: SEASON } } },
});
```

**AFTER (Fixed):**
```typescript
// Roster + per-player season stats
// Get season-specific roster from PlayerSeasonStats (not Player.teamId)
const seasonRosterStats = await prisma.playerSeasonStats.findMany({
  where: { teamId, season: SEASON },
  include: { player: true },
});
const roster = seasonRosterStats.map(pss => ({
  ...pss.player,
  seasonStats: [pss], // Match original structure
}));
```

### 2. `/app/api/coach-brief/[teamId]/route.ts` (lines 281-284)
**BEFORE (Wrong):**
```typescript
const roster = await prisma.player.findMany({
  where: { teamId },
  include: { seasonStats: { where: { season } } },
});
```

**AFTER (Fixed):**
```typescript
// Get season-specific roster from PlayerSeasonStats (not Player.teamId)
const seasonRosterStats = await prisma.playerSeasonStats.findMany({
  where: { teamId, season },
  include: { player: true },
});
const roster = seasonRosterStats.map(pss => ({
  ...pss.player,
  seasonStats: [pss], // Match original structure
}));
```

## Files Already Correct
These files were already using the correct season-specific pattern:
- `/app/teams/[teamId]/lineups/page.tsx` ✅
- `/app/players/page.tsx` ✅  
- `/app/shot-quality/page.tsx` ✅
- `/app/impact/page.tsx` ✅

## Fix Logic
The key change is switching from:
- **Wrong:** `Player.teamId = X` → shows all players currently assigned to team X
- **Correct:** `PlayerSeasonStats.teamId = X AND season = Y` → shows only players who played for team X in season Y

This ensures:
- Trey Fort won't show up for Michigan State 2024-25 if he didn't have PlayerSeasonStats for that team-season
- Cam Ward won't show up for Michigan State 2024-25 if he was a 2025-26 freshman
- Only players who actually played for that team in that specific season appear

## Verification
The TypeScript build passes successfully, confirming the syntax is correct and the data structure transformations maintain compatibility with existing UI components.

## Impact
- Team overview pages now show correct season-specific rosters
- Coach brief generation uses correct season-specific player data
- Lineup optimizer was already correct
- All other player-related pages were already using correct patterns