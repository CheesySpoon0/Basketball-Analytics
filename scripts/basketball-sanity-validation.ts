#!/usr/bin/env npx tsx
import 'dotenv/config';
import { prisma } from '../lib/prisma.js';

interface BasketballSanityCheck {
  lambda: number;
  teamLevelCorrelations: {
    avgRapmVsNetRating: number;
    avgOrapmVsOffRating: number;
    avgDrapmVsDefRating: number;
    sampleSize: number;
  };
  playerLevelSanity: {
    extremeOutliersCount: number;
    unreasonableValues: string[];
    positionMismatches: string[];
  };
  benchmarkComparison: {
    knownElitePlayers: Array<{
      name: string;
      expectedTier: 'Elite' | 'Very Good' | 'Good' | 'Average';
      actualRapm: number;
      actualTier: string;
      reasonable: boolean;
    }>;
  };
}

async function validateBasketballSanity(lambdas: number[]): Promise<BasketballSanityCheck[]> {
  console.log('=== BASKETBALL SANITY VALIDATION ===\n');

  const season = 2026;
  const results: BasketballSanityCheck[] = [];

  // Get baseline data
  const players = await prisma.playerImpact.findMany({
    where: {
      season,
      orapm: { not: null },
      drapm: { not: null },
      rapm: { not: null }
    },
    include: {
      player: {
        include: {
          seasonStats: {
            where: { season },
            include: { team: true }
          }
        }
      }
    }
  });

  // Get team-level data for correlations
  const teams = await prisma.team.findMany({
    where: {
      seasonStats: { some: { season } },
      playerStats: { some: { season } }
    },
    include: {
      seasonStats: { where: { season } },
      playerStats: {
        where: { season },
        include: {
          player: {
            include: {
              impact: { where: { season } }
            }
          }
        }
      }
    }
  });

  for (const lambda of lambdas) {
    console.log(`\nValidating Basketball Sanity for λ=${lambda}`);
    console.log('=======================================');

    // Simulate lambda scaling
    const shrinkageFactor = Math.sqrt(1000 / lambda);

    const scaledPlayers = players.map(p => ({
      ...p,
      scaledOrapm: p.orapm! * shrinkageFactor,
      scaledDrapm: p.drapm! * shrinkageFactor,
      scaledNetRapm: p.rapm! * shrinkageFactor
    }));

    // 1. Team-level correlations
    const teamAnalysis = teams.map(team => {
      const teamStats = team.seasonStats[0];
      if (!teamStats) return null;

      // Calculate average player RAPM for team
      const teamPlayers = team.playerStats.filter(ps =>
        ps.player.impact[0] && ps.games && ps.games >= 5
      );

      if (teamPlayers.length === 0) return null;

      const avgRapm = teamPlayers.reduce((sum, ps) => {
        const impact = ps.player.impact[0];
        const scaledRapm = impact.rapm! * shrinkageFactor;
        return sum + scaledRapm;
      }, 0) / teamPlayers.length;

      const avgOrapm = teamPlayers.reduce((sum, ps) => {
        const impact = ps.player.impact[0];
        const scaledOrapm = impact.orapm! * shrinkageFactor;
        return sum + scaledOrapm;
      }, 0) / teamPlayers.length;

      const avgDrapm = teamPlayers.reduce((sum, ps) => {
        const impact = ps.player.impact[0];
        const scaledDrapm = impact.drapm! * shrinkageFactor;
        return sum + scaledDrapm;
      }, 0) / teamPlayers.length;

      // Calculate team efficiency ratings
      const games = teamStats.games || 1;
      const possessions = (teamStats.fieldGoalsAttempted || 0) +
                         0.44 * (teamStats.freeThrowsAttempted || 0) +
                         (teamStats.turnovers || 0) -
                         (teamStats.offRebounds || 0);

      const offRating = possessions > 0 ? ((teamStats.points || 0) / possessions) * 100 : 0;
      const oppPossessions = possessions; // Approximation
      const defRating = oppPossessions > 0 ? ((teamStats.oppPoints || 0) / oppPossessions) * 100 : 0;
      const netRating = offRating - defRating;

      return {
        teamId: team.id,
        teamName: team.school,
        avgRapm,
        avgOrapm,
        avgDrapm,
        netRating,
        offRating,
        defRating: -defRating // Flip sign so positive is better
      };
    }).filter(t => t !== null);

    // Calculate correlations
    const calculateCorrelation = (x: number[], y: number[]) => {
      if (x.length !== y.length || x.length === 0) return 0;

      const meanX = x.reduce((a, b) => a + b) / x.length;
      const meanY = y.reduce((a, b) => a + b) / y.length;

      const numerator = x.reduce((sum, xi, i) => sum + (xi - meanX) * (y[i] - meanY), 0);
      const denomX = Math.sqrt(x.reduce((sum, xi) => sum + Math.pow(xi - meanX, 2), 0));
      const denomY = Math.sqrt(y.reduce((sum, yi) => sum + Math.pow(yi - meanY, 2), 0));

      return denomX === 0 || denomY === 0 ? 0 : numerator / (denomX * denomY);
    };

    const netRatings = teamAnalysis.map(t => t!.netRating);
    const offRatings = teamAnalysis.map(t => t!.offRating);
    const defRatings = teamAnalysis.map(t => t!.defRating);
    const avgRapms = teamAnalysis.map(t => t!.avgRapm);
    const avgOrapms = teamAnalysis.map(t => t!.avgOrapm);
    const avgDrapms = teamAnalysis.map(t => t!.avgDrapm);

    const teamLevelCorrelations = {
      avgRapmVsNetRating: calculateCorrelation(avgRapms, netRatings),
      avgOrapmVsOffRating: calculateCorrelation(avgOrapms, offRatings),
      avgDrapmVsDefRating: calculateCorrelation(avgDrapms, defRatings),
      sampleSize: teamAnalysis.length
    };

    // 2. Player-level sanity checks
    const extremeOutliers = scaledPlayers.filter(p =>
      Math.abs(p.scaledNetRapm) > 20 ||
      Math.abs(p.scaledOrapm) > 15 ||
      Math.abs(p.scaledDrapm) > 15
    );

    const unreasonableValues: string[] = [];
    if (extremeOutliers.length > 0) {
      extremeOutliers.slice(0, 5).forEach(p => {
        unreasonableValues.push(`${p.player.name}: Net=${p.scaledNetRapm.toFixed(1)}`);
      });
    }

    // 3. Known elite players validation
    const knownElitePlayers = [
      { name: 'Cameron Boozer', expected: 'Elite' as const },
      { name: 'Fletcher Loyer', expected: 'Very Good' as const },
      { name: 'Yaxel Lendeborg', expected: 'Elite' as const },
      { name: 'Joshua Jefferson', expected: 'Very Good' as const },
      { name: 'Eric Mahaffey', expected: 'Very Good' as const },
      { name: 'Bruce Thornton', expected: 'Good' as const }
    ];

    const benchmarkComparison = {
      knownElitePlayers: knownElitePlayers.map(known => {
        const player = scaledPlayers.find(p => p.player.name === known.name);
        if (!player) {
          return {
            ...known,
            actualRapm: 0,
            actualTier: 'Not Found',
            reasonable: false
          };
        }

        let actualTier = 'Average';
        if (player.scaledNetRapm > 10) actualTier = 'Elite';
        else if (player.scaledNetRapm > 7) actualTier = 'Very Good';
        else if (player.scaledNetRapm > 4) actualTier = 'Good';
        else if (player.scaledNetRapm > 1) actualTier = 'Above Average';

        const reasonable =
          (known.expected === 'Elite' && player.scaledNetRapm > 8) ||
          (known.expected === 'Very Good' && player.scaledNetRapm > 6) ||
          (known.expected === 'Good' && player.scaledNetRapm > 3);

        return {
          name: known.name,
          expectedTier: known.expected,
          actualRapm: player.scaledNetRapm,
          actualTier,
          reasonable
        };
      })
    };

    console.log(`Team-level correlations: RAPM/NetRtg=${teamLevelCorrelations.avgRapmVsNetRating.toFixed(2)}`);
    console.log(`Extreme outliers: ${extremeOutliers.length}`);
    console.log(`Elite player validation: ${benchmarkComparison.knownElitePlayers.filter(p => p.reasonable).length}/${benchmarkComparison.knownElitePlayers.length} reasonable`);

    results.push({
      lambda,
      teamLevelCorrelations,
      playerLevelSanity: {
        extremeOutliersCount: extremeOutliers.length,
        unreasonableValues,
        positionMismatches: [] // Would need position analysis
      },
      benchmarkComparison
    });
  }

  return results;
}

async function main() {
  const lambdas = [1000, 750, 500, 400, 300, 250];

  try {
    const results = await validateBasketballSanity(lambdas);

    console.log('\n=== BASKETBALL SANITY SUMMARY ===');
    console.log('Lambda | Team Corr | Outliers | Elite Valid | Assessment');
    console.log('-------|-----------|----------|-------------|------------');

    results.forEach(result => {
      const teamCorr = result.teamLevelCorrelations.avgRapmVsNetRating;
      const outliers = result.playerLevelSanity.extremeOutliersCount;
      const eliteValid = result.benchmarkComparison.knownElitePlayers.filter(p => p.reasonable).length;
      const eliteTotal = result.benchmarkComparison.knownElitePlayers.length;

      let assessment = 'Good';
      if (teamCorr < 0.3) assessment = 'Poor correlation';
      else if (outliers > 20) assessment = 'Too many outliers';
      else if (eliteValid < eliteTotal * 0.7) assessment = 'Elite mismatch';

      console.log(`${result.lambda.toString().padStart(6)} | ${teamCorr.toFixed(2).padStart(9)} | ${outliers.toString().padStart(8)} | ${eliteValid}/${eliteTotal}${' '.padStart(6)} | ${assessment}`);
    });

    // Detailed analysis for recommended lambda
    const recommendedLambda = 400;
    const recommended = results.find(r => r.lambda === recommendedLambda);

    if (recommended) {
      console.log(`\n=== DETAILED ANALYSIS FOR λ=${recommendedLambda} ===`);
      console.log(`Team-level correlation (RAPM vs Net Rating): ${recommended.teamLevelCorrelations.avgRapmVsNetRating.toFixed(3)}`);
      console.log(`ORAPM vs Offensive Rating correlation: ${recommended.teamLevelCorrelations.avgOrapmVsOffRating.toFixed(3)}`);
      console.log(`DRAPM vs Defensive Rating correlation: ${recommended.teamLevelCorrelations.avgDrapmVsDefRating.toFixed(3)}`);
      console.log(`Sample size: ${recommended.teamLevelCorrelations.sampleSize} teams`);

      console.log('\nElite Player Validation:');
      recommended.benchmarkComparison.knownElitePlayers.forEach(player => {
        const status = player.reasonable ? '✅' : '⚠️';
        console.log(`${status} ${player.name}: Expected ${player.expectedTier}, Got ${player.actualRapm.toFixed(1)} (${player.actualTier})`);
      });

      if (recommended.playerLevelSanity.unreasonableValues.length > 0) {
        console.log('\nPotential Outliers:');
        recommended.playerLevelSanity.unreasonableValues.forEach(outlier => {
          console.log(`  ⚠️ ${outlier}`);
        });
      }
    }

  } catch (error) {
    console.error('Basketball sanity validation failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);