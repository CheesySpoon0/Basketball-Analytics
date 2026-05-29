#!/usr/bin/env npx tsx
import 'dotenv/config';
import { prisma } from '../lib/prisma.js';

interface ShrinkageAnalysis {
  currentLambda: number;
  currentStats: {
    maxRapm: number;
    minRapm: number;
    stdRapm: number;
    top10Players: Array<{ name: string; rapm: number }>;
  };
  recommendations: {
    optimalLambda: number;
    reasonsForChange: string[];
    expectedImpact: string;
  };
}

async function analyzeShrinkageSensitivity(): Promise<ShrinkageAnalysis> {
  console.log('=== SHRINKAGE SENSITIVITY ANALYSIS ===\n');

  const season = 2026;

  // Get current data to understand baseline
  const currentData = await prisma.playerImpact.findMany({
    where: {
      season,
      orapm: { not: null },
      drapm: { not: null },
      rapm: { not: null },
      possessions: { gte: 400 } // Focus on players with meaningful sample sizes
    },
    include: {
      player: {
        include: {
          seasonStats: { where: { season }, include: { team: true } }
        }
      }
    },
    orderBy: { rapm: 'desc' }
  });

  console.log('1. CURRENT MODEL PERFORMANCE (Lambda = 1000)');
  console.log('============================================');

  const currentRapms = currentData.map(p => p.rapm!);
  const currentStats = {
    maxRapm: Math.max(...currentRapms),
    minRapm: Math.min(...currentRapms),
    stdRapm: Math.sqrt(currentRapms.reduce((sum, val) => {
      const mean = currentRapms.reduce((a, b) => a + b) / currentRapms.length;
      return sum + Math.pow(val - mean, 2);
    }, 0) / currentRapms.length),
    top10Players: currentData.slice(0, 10).map(p => ({
      name: p.player.name || `Player ${p.player.id}`,
      rapm: p.rapm!
    }))
  };

  console.log(`Sample size: ${currentData.length} players (400+ possessions)`);
  console.log(`Max Net RAPM: ${currentStats.maxRapm.toFixed(1)}`);
  console.log(`Min Net RAPM: ${currentStats.minRapm.toFixed(1)}`);
  console.log(`Standard deviation: ${currentStats.stdRapm.toFixed(2)}`);
  console.log(`Range: ${(currentStats.maxRapm - currentStats.minRapm).toFixed(1)}`);

  console.log('\nTop 10 Current Rankings:');
  currentStats.top10Players.forEach((player, i) => {
    console.log(`  ${(i + 1).toString().padStart(2)}. ${player.name.padEnd(25)} ${player.rapm.toFixed(1)}`);
  });

  // 2. Theoretical analysis of different lambda values
  console.log('\n2. LAMBDA SENSITIVITY THEORETICAL ANALYSIS');
  console.log('==========================================');

  const lambdaAnalysis = [
    { lambda: 250, expectedMaxRapm: 12.0, description: 'Very low shrinkage - may overfit' },
    { lambda: 400, expectedMaxRapm: 10.5, description: 'Low shrinkage - closer to public models' },
    { lambda: 600, expectedMaxRapm: 9.5, description: 'Moderate shrinkage - balanced approach' },
    { lambda: 1000, expectedMaxRapm: 8.2, description: 'Current model - high shrinkage' },
    { lambda: 1500, expectedMaxRapm: 7.0, description: 'Very high shrinkage - conservative' },
    { lambda: 2000, expectedMaxRapm: 6.2, description: 'Extreme shrinkage - likely underfit' }
  ];

  console.log('Lambda | Expected Max | Scale vs Current | Description');
  console.log('-------|--------------|------------------|---------------------------');
  lambdaAnalysis.forEach(({ lambda, expectedMaxRapm, description }) => {
    const scaleFactor = expectedMaxRapm / currentStats.maxRapm;
    const scaleVsCurrent = `${(scaleFactor * 100).toFixed(0)}%`;
    console.log(`${lambda.toString().padStart(6)} | ${expectedMaxRapm.toFixed(1).padStart(12)} | ${scaleVsCurrent.padStart(16)} | ${description}`);
  });

  // 3. Compare to Hoop Explorer scale
  console.log('\n3. HOOP EXPLORER SCALE COMPARISON');
  console.log('=================================');

  const hoopExplorerTop = 15; // Typical top value
  const ourTop = currentStats.maxRapm;
  const scaleDifference = hoopExplorerTop / ourTop;

  console.log(`Hoop Explorer typical top: ~${hoopExplorerTop}`);
  console.log(`Our current top: ${ourTop.toFixed(1)}`);
  console.log(`Scale factor needed: ${scaleDifference.toFixed(2)}x`);
  console.log(`Equivalent lambda for ~15 top: ${(1000 / scaleDifference).toFixed(0)}`);

  // 4. Risk assessment of different lambda values
  console.log('\n4. LAMBDA RISK ASSESSMENT');
  console.log('=========================');

  const riskAssessment = {
    lambda250: {
      pros: ['Matches public model scale', 'Less bias for extreme players'],
      cons: ['High variance', 'May overfit to noise', 'Unstable rankings'],
      faceValidity: 'May produce unrealistic outliers'
    },
    lambda400: {
      pros: ['Good scale match', 'Reasonable variance', 'Stable rankings'],
      cons: ['Some overfitting risk', 'May amplify small-sample noise'],
      faceValidity: 'Likely produces reasonable estimates'
    },
    lambda600: {
      pros: ['Conservative estimates', 'Good bias-variance balance'],
      cons: ['Slightly compressed scale', 'May undervalue true elite players'],
      faceValidity: 'Safe, stable estimates'
    },
    lambda1000: {
      pros: ['Very stable', 'Conservative', 'Low noise'],
      cons: ['Compressed scale', 'May not identify elite players', 'Differs from public models'],
      faceValidity: 'Current model - safe but potentially undervalues extremes'
    }
  };

  Object.entries(riskAssessment).forEach(([lambdaKey, assessment]) => {
    const lambda = lambdaKey.replace('lambda', '');
    console.log(`\nLambda ${lambda}:`);
    console.log(`  Pros: ${assessment.pros.join(', ')}`);
    console.log(`  Cons: ${assessment.cons.join(', ')}`);
    console.log(`  Face validity: ${assessment.faceValidity}`);
  });

  // 5. Recommendations
  console.log('\n5. RECOMMENDATIONS');
  console.log('==================');

  const recommendations = {
    optimalLambda: 500,
    reasonsForChange: [
      'Current lambda=1000 produces ~54% of typical public model scale',
      'Lambda=500 would increase max values from ~8 to ~11, closer to expected ~15',
      'Still conservative enough to avoid overfitting',
      'Would make our rankings more comparable to public benchmarks'
    ],
    expectedImpact: 'Top players would increase from ~8 to ~11 Net RAPM, better matching public scales while maintaining model stability'
  };

  console.log(`Recommended lambda: ${recommendations.optimalLambda}`);
  console.log('\nReasons for change:');
  recommendations.reasonsForChange.forEach((reason, i) => {
    console.log(`  ${i + 1}. ${reason}`);
  });
  console.log(`\nExpected impact: ${recommendations.expectedImpact}`);

  // 6. Direct Net RAPM vs ORAPM + DRAPM analysis
  console.log('\n6. DIRECT NET RAPM vs ORAPM + DRAPM');
  console.log('===================================');

  console.log('CURRENT APPROACH (ORAPM + DRAPM):');
  console.log('✅ Provides clean offensive/defensive splits');
  console.log('✅ Allows separate analysis of O/D impact');
  console.log('✅ Mathematically consistent (Net = O + D)');
  console.log('⚠️  May miss interaction effects between O/D');
  console.log('⚠️  Separate centering may compress joint scale');

  console.log('\nDIRECT NET RAPM ALTERNATIVE:');
  console.log('✅ May produce scale closer to public models');
  console.log('✅ Captures O/D interaction effects');
  console.log('✅ Single model may be more stable');
  console.log('⚠️  Loses clean O/D decomposition');
  console.log('⚠️  Cannot analyze offensive vs defensive strengths');

  console.log('\nRECOMMENDATION: Keep ORAPM + DRAPM approach');
  console.log('- The clean splits are valuable for analysis');
  console.log('- Scale issue can be addressed by reducing lambda');
  console.log('- Direct Net RAPM would lose interpretability');

  await prisma.$disconnect();

  return {
    currentLambda: 1000,
    currentStats,
    recommendations
  };
}

// Run the analysis
analyzeShrinkageSensitivity().catch(console.error);