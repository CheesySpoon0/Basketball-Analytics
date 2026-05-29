// ============================================================================
// Observed Defensive Impact
//
// Replaces inferred defensive profile with real data from:
// - PlayerSeasonStats (steals, blocks, def rebounds, fouls per 40)
// - PlayerImpact (DRAPM, expected DRAPM)
// - LineupStint (on-court DRtg, forced TO%, team defensive events)
//
// NO INFERENCES about matchups, size, or position. Only observed performance.
// ============================================================================

import { prisma } from '../prisma';

export interface ObservedDefenseInput {
  playerId: number;
  season: number;
  teamId: number; // Season-specific team
}

export interface ObservedDefenseProfile {
  // Sample size and confidence
  confidence: 'high' | 'medium' | 'low' | 'insufficient';
  defensivePossessions: number; // From LineupStint aggregation
  sampleNote: string;

  // RAPM (most reliable metric)
  drapm: number | null;
  drapmExpected: number | null;
  drapmDelta: number | null; // drapm - drapmExpected
  drapmConfidence: string | null;

  // On-court defense (from LineupStint)
  onCourtDRtg: number | null; // Points allowed per 100 possessions
  expectedDRtg: number | null; // Expected points allowed per 100 possessions
  onOffDRtg: number | null; // Team defense with player on vs off court
  forcedTurnoverPct: number | null; // Team TOs forced per 100 opponent possessions

  // Advanced on-court metrics (if available)
  opponentEfgPct: number | null; // Opponent eFG% while on court
  defensiveReboundingPct: number | null; // Team DREB% while on court

  // Individual box score rates (per 40 minutes)
  stealsPer40: number | null;
  blocksPer40: number | null;
  defReboundsPer40: number | null;
  foulsPer40: number | null;

  // Display flags
  showOnCourtMetrics: boolean;
  showDetailedRates: boolean;
  showAdvancedMetrics: boolean;
}

export async function buildObservedDefenseProfile(
  input: ObservedDefenseInput
): Promise<ObservedDefenseProfile> {
  const { playerId, season, teamId } = input;

  // 1. Get player season stats for individual rates
  const seasonStats = await prisma.playerSeasonStats.findUnique({
    where: {
      playerId_season: { playerId, season }
    }
  });

  // 2. Get RAPM impact data from canonical PlayerImpact table
  const rapmData = await prisma.playerImpact.findUnique({
    where: {
      playerId_season: { playerId, season }
    }
  });

  // 3. Get LineupStint data for on-court defense
  // Find all stints where this player was on court for this team/season
  const stints = await prisma.lineupStint.findMany({
    where: {
      season,
      teamId,
      confidence: 'full', // Only high-quality data
      playerIds: { contains: playerId.toString() },
      possessionsAgainst: { gt: 0 } // Must have defensive possessions
    }
  });

  // 4. Calculate individual box score rates (per 40 minutes)
  const minutes = seasonStats?.minutes || 0;
  const minutesDecimal = minutes / 60; // Convert from seconds to minutes
  const per40Factor = minutesDecimal > 0 ? (40 / minutesDecimal) : 0;

  const stealsPer40 = seasonStats && minutesDecimal > 0
    ? (seasonStats.steals || 0) * per40Factor
    : null;
  const blocksPer40 = seasonStats && minutesDecimal > 0
    ? (seasonStats.blocks || 0) * per40Factor
    : null;
  const defReboundsPer40 = seasonStats && minutesDecimal > 0
    ? (seasonStats.defRebounds || 0) * per40Factor
    : null;
  const foulsPer40 = seasonStats && minutesDecimal > 0
    ? (seasonStats.fouls || 0) * per40Factor
    : null;

  // 5. Aggregate on-court defensive data
  let onCourtDRtg: number | null = null;
  let expectedDRtg: number | null = null;
  let onOffDRtg: number | null = null;
  let forcedTurnoverPct: number | null = null;
  let defensiveReboundingPct: number | null = null;
  let totalDefensivePossessions = 0;

  if (stints.length > 0) {
    let totalPointsAgainst = 0;
    let totalPossessionsAgainst = 0;
    let totalExpectedPointsAgainst = 0;
    let totalOpponentTurnovers = 0;
    let totalDefensiveRebounds = 0;
    let totalOpponentMisses = 0; // Approximate from possessions - points + turnovers

    stints.forEach(stint => {
      const poss = stint.possessionsAgainst || 0;
      if (poss > 0) {
        totalPointsAgainst += stint.pointsAgainst;
        totalPossessionsAgainst += poss;
        totalExpectedPointsAgainst += stint.expectedPointsAgainst || 0;
        totalOpponentTurnovers += stint.turnovers || 0;
        totalDefensiveRebounds += stint.defRebounds || 0;

        // Estimate opponent misses (very rough approximation)
        // Possessions that didn't end in points or turnovers likely ended in misses
        const estimatedMisses = Math.max(0, poss - (stint.pointsAgainst / 2.2) - (stint.turnovers || 0));
        totalOpponentMisses += estimatedMisses;
      }
    });

    totalDefensivePossessions = totalPossessionsAgainst;

    if (totalPossessionsAgainst > 0) {
      onCourtDRtg = (totalPointsAgainst / totalPossessionsAgainst) * 100;
      forcedTurnoverPct = (totalOpponentTurnovers / totalPossessionsAgainst) * 100;

      if (totalExpectedPointsAgainst > 0) {
        expectedDRtg = (totalExpectedPointsAgainst / totalPossessionsAgainst) * 100;
      }

      // Defensive rebounding percentage (rough approximation)
      if (totalOpponentMisses > 0) {
        defensiveReboundingPct = (totalDefensiveRebounds / (totalDefensiveRebounds + totalOpponentMisses)) * 100;
      }
    }

    // Calculate on/off defensive rating
    if (onCourtDRtg !== null) {
      const offCourtStints = await prisma.lineupStint.findMany({
        where: {
          season,
          teamId,
          confidence: 'full',
          playerIds: { not: { contains: playerId.toString() } }, // Player NOT on court
          possessionsAgainst: { gt: 0 }
        }
      });

      if (offCourtStints.length > 0) {
        let offCourtPointsAgainst = 0;
        let offCourtPossessionsAgainst = 0;

        offCourtStints.forEach(stint => {
          const poss = stint.possessionsAgainst || 0;
          if (poss > 0) {
            offCourtPointsAgainst += stint.pointsAgainst;
            offCourtPossessionsAgainst += poss;
          }
        });

        if (offCourtPossessionsAgainst > 0) {
          const offCourtDRtg = (offCourtPointsAgainst / offCourtPossessionsAgainst) * 100;
          onOffDRtg = onCourtDRtg - offCourtDRtg; // Positive = team defends better with player on court
        }
      }
    }
  }

  // 6. Determine confidence level based on RAPM sample + defensive possessions
  let confidence: 'high' | 'medium' | 'low' | 'insufficient';
  let sampleNote: string;

  const rapmDefPossessions = rapmData?.possessions || 0;
  const hasStrongRapmSample = rapmDefPossessions >= 400;

  if (hasStrongRapmSample && totalDefensivePossessions >= 400) {
    confidence = 'high';
    sampleNote = `${Math.round(totalDefensivePossessions)} defensive possessions, strong RAPM sample — reliable metrics`;
  } else if (totalDefensivePossessions >= 200) {
    confidence = 'medium';
    sampleNote = `${Math.round(totalDefensivePossessions)} defensive possessions — limited sample, use with context`;
  } else if (totalDefensivePossessions >= 50) {
    confidence = 'low';
    sampleNote = `${Math.round(totalDefensivePossessions)} defensive possessions — small sample, significant noise likely`;
  } else {
    confidence = 'insufficient';
    sampleNote = `${Math.round(totalDefensivePossessions)} defensive possessions — insufficient for reliable analysis`;
  }

  // 7. RAPM calculations from canonical source
  const drapm = rapmData?.drapm || null;
  const drapmExpected = rapmData?.drapmExpected || null; // Use expected DRAPM
  const drapmDelta = drapm !== null && drapmExpected !== null
    ? drapm - drapmExpected
    : null;
  const drapmConfidence = rapmDefPossessions >= 400 ? 'high' :
                           rapmDefPossessions >= 200 ? 'moderate' : 'low';

  // 8. Display flags based on confidence
  const showOnCourtMetrics = confidence !== 'insufficient';
  const showDetailedRates = confidence !== 'insufficient' && minutesDecimal >= 50; // At least ~83 minutes played
  const showAdvancedMetrics = confidence === 'high' || (confidence === 'medium' && totalDefensivePossessions >= 300);

  return {
    confidence,
    defensivePossessions: totalDefensivePossessions,
    sampleNote,

    drapm,
    drapmExpected,
    drapmDelta,
    drapmConfidence,

    onCourtDRtg,
    expectedDRtg,
    onOffDRtg,
    forcedTurnoverPct,

    opponentEfgPct: null, // Not available in current data
    defensiveReboundingPct,

    stealsPer40,
    blocksPer40,
    defReboundsPer40,
    foulsPer40,

    showOnCourtMetrics,
    showDetailedRates,
    showAdvancedMetrics,
  };
}