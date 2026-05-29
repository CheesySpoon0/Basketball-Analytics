import { prisma } from '../lib/prisma';
import { Command } from 'commander';

/**
 * Phase 0A: Evidence-based partial stint recovery for RAPM
 *
 * Hard rule: NEVER guess a player onto the floor. Only use hard evidence.
 * Two recovery methods:
 * 1. Event-based presence (primary) - player credited with play events
 * 2. Bookend propagation (secondary) - player in adjacent full stints
 */

interface RecoveryStats {
  initialCounts: {
    full: number;
    partial: number;
    gap: number;
    conflict: number;
    fullInferred: number;
  };
  finalCounts: {
    full: number;
    partial: number;
    gap: number;
    conflict: number;
    fullInferred: number;
  };
  recoveredByEvent: number;
  recoveredByBookend: number;
  flaggedConflicts: number;
}

async function getConfidenceCounts(season: number) {
  const counts = await prisma.lineupStint.groupBy({
    by: ['confidence'],
    where: { season },
    _count: { confidence: true }
  });

  const result = {
    full: 0,
    partial: 0,
    gap: 0,
    conflict: 0,
    fullInferred: 0
  };

  counts.forEach(({ confidence, _count }) => {
    if (confidence && Object.keys(result).includes(confidence)) {
      result[confidence as keyof typeof result] = _count.confidence;
    }
  });

  return result;
}

async function recoverPartialStints(season: number, dryRun: boolean): Promise<RecoveryStats> {
  console.log(`🔍 Phase 0A: Partial stint recovery for season ${season}`);
  if (dryRun) console.log('🏃 DRY RUN MODE - no database writes\n');

  const initialCounts = await getConfidenceCounts(season);
  console.log('📊 Initial confidence breakdown:');
  Object.entries(initialCounts).forEach(([conf, count]) => {
    console.log(`  • ${conf}: ${count.toLocaleString()}`);
  });

  let recoveredByEvent = 0;
  let recoveredByBookend = 0;
  let flaggedConflicts = 0;

  // Get all partial stints for processing
  const partialStints = await prisma.lineupStint.findMany({
    where: {
      season,
      confidence: 'partial'
    },
    include: {
      game: true
    },
    orderBy: [{ gameId: 'asc' }, { startSeconds: 'desc' }]
  });

  console.log(`\n🎯 Processing ${partialStints.length} partial stints...\n`);

  const updates: Array<{ id: number; confidence: string; playerIds: string }> = [];

  for (const stint of partialStints) {
    let recovered = false;
    let recoveryMethod = '';
    let newPlayerIds = stint.playerIds;
    let newConfidence = stint.confidence;

    // Method 1: Event-based presence (primary)
    const eventRecovery = await recoverFromPlayEvents(stint);
    if (eventRecovery.success) {
      newPlayerIds = eventRecovery.playerIds;
      if (eventRecovery.isFullLineup) {
        newConfidence = 'full';
        recoveredByEvent++;
        recovered = true;
        recoveryMethod = 'event-based';
      } else if (eventRecovery.hasConflict) {
        newConfidence = 'conflict';
        flaggedConflicts++;
        recovered = true;
        recoveryMethod = 'conflict-flagged';
      }
    }

    // Method 2: Bookend propagation (only if still partial)
    if (!recovered && newConfidence === 'partial') {
      const bookendRecovery = await recoverFromBookends(stint);
      if (bookendRecovery.success) {
        newPlayerIds = bookendRecovery.playerIds;
        newConfidence = 'full_inferred';
        recoveredByBookend++;
        recovered = true;
        recoveryMethod = 'bookend-propagation';
      }
    }

    // Queue update if changed
    if (newConfidence !== stint.confidence || newPlayerIds !== stint.playerIds) {
      updates.push({
        id: stint.id,
        confidence: newConfidence,
        playerIds: newPlayerIds
      });

      if (recovered) {
        console.log(`✅ Recovered stint ${stint.id} (Game ${stint.gameId}) via ${recoveryMethod}`);

        // Show evidence for first few recoveries
        if (updates.length <= 5) {
          console.log(`   • Before: ${stint.playerIds}`);
          console.log(`   • After:  ${newPlayerIds}`);
          console.log(`   • Method: ${recoveryMethod}\n`);
        }
      }
    }
  }

  // Apply updates
  if (!dryRun && updates.length > 0) {
    console.log(`\n💾 Applying ${updates.length} updates...`);

    for (const update of updates) {
      await prisma.lineupStint.update({
        where: { id: update.id },
        data: {
          confidence: update.confidence,
          playerIds: update.playerIds
        }
      });
    }
    console.log('✅ Updates applied successfully');
  } else if (dryRun) {
    console.log(`\n🏃 DRY RUN: Would apply ${updates.length} updates`);
  }

  const finalCounts = dryRun ? initialCounts : await getConfidenceCounts(season);

  return {
    initialCounts,
    finalCounts,
    recoveredByEvent,
    recoveredByBookend,
    flaggedConflicts
  };
}

async function recoverFromPlayEvents(stint: any): Promise<{
  success: boolean;
  playerIds: string;
  isFullLineup: boolean;
  hasConflict: boolean;
}> {
  // Get all play events within this stint's time window
  const playEvents = await prisma.playByPlay.findMany({
    where: {
      gameId: stint.gameId,
      gameClock: {
        lte: stint.startSeconds,
        gte: stint.endSeconds
      }
    },
    select: {
      shootingPlayerId: true,
      assistPlayerId: true,
      reboundPlayerId: true,
      stealPlayerId: true,
      blockPlayerId: true,
      turnoverPlayerId: true,
      foulCommittedByPlayerId: true,
      foulDrawnByPlayerId: true,
      teamId: true
    }
  });

  if (playEvents.length === 0) {
    return { success: false, playerIds: stint.playerIds, isFullLineup: false, hasConflict: false };
  }

  // Extract all player IDs with evidence of being on floor
  const evidencePlayers = new Set<number>();

  playEvents.forEach(play => {
    [
      play.shootingPlayerId,
      play.assistPlayerId,
      play.reboundPlayerId,
      play.stealPlayerId,
      play.blockPlayerId,
      play.turnoverPlayerId,
      play.foulCommittedByPlayerId,
      play.foulDrawnByPlayerId
    ].forEach(playerId => {
      if (playerId) evidencePlayers.add(playerId);
    });
  });

  // Split evidence players by team
  const homeTeamPlayers = new Set<number>();
  const awayTeamPlayers = new Set<number>();

  for (const playerId of evidencePlayers) {
    // Find which team this player was on for this game/stint
    const playerSeason = await prisma.playerSeasonStats.findFirst({
      where: {
        playerId,
        season: stint.season,
        teamId: { in: [stint.teamId, stint.game.homeTeamId === stint.teamId ? stint.game.visitingTeamId : stint.game.homeTeamId] }
      }
    });

    if (playerSeason) {
      if (playerSeason.teamId === stint.teamId) {
        homeTeamPlayers.add(playerId);
      } else {
        awayTeamPlayers.add(playerId);
      }
    }
  }

  // Check for conflicts (>5 players on either side)
  const hasConflict = homeTeamPlayers.size > 5 || awayTeamPlayers.size > 5;

  // Check for complete lineups (exactly 5 on each side)
  const isFullLineup = homeTeamPlayers.size === 5 && awayTeamPlayers.size === 5;

  if (hasConflict || isFullLineup) {
    // Build new playerIds string for the stint's team
    const stintTeamPlayers = stint.teamId === stint.game.homeTeamId ? homeTeamPlayers : awayTeamPlayers;
    const newPlayerIds = Array.from(stintTeamPlayers).sort((a, b) => a - b).join(',');

    return {
      success: true,
      playerIds: newPlayerIds,
      isFullLineup,
      hasConflict
    };
  }

  return { success: false, playerIds: stint.playerIds, isFullLineup: false, hasConflict: false };
}

async function recoverFromBookends(stint: any): Promise<{
  success: boolean;
  playerIds: string;
}> {
  // Find the full stint immediately before this partial stint
  const priorStint = await prisma.lineupStint.findFirst({
    where: {
      gameId: stint.gameId,
      teamId: stint.teamId,
      startSeconds: { gt: stint.startSeconds },
      confidence: 'full'
    },
    orderBy: { startSeconds: 'asc' }
  });

  // Find the full stint immediately after this partial stint
  const nextStint = await prisma.lineupStint.findFirst({
    where: {
      gameId: stint.gameId,
      teamId: stint.teamId,
      endSeconds: { lt: stint.endSeconds },
      confidence: 'full'
    },
    orderBy: { endSeconds: 'desc' }
  });

  if (!priorStint || !nextStint || !priorStint.playerIds || !nextStint.playerIds) {
    return { success: false, playerIds: stint.playerIds };
  }

  const priorPlayers = priorStint.playerIds.split(',').map(id => parseInt(id, 10));
  const nextPlayers = nextStint.playerIds.split(',').map(id => parseInt(id, 10));

  // Find players who appear in both adjacent stints
  const continuousPlayers = priorPlayers.filter(playerId =>
    nextPlayers.includes(playerId)
  );

  // Check if we have exactly 5 continuous players (perfect bookend case)
  if (continuousPlayers.length === 5) {
    const newPlayerIds = continuousPlayers.sort((a, b) => a - b).join(',');
    return { success: true, playerIds: newPlayerIds };
  }

  return { success: false, playerIds: stint.playerIds };
}

function printRecoveryReport(stats: RecoveryStats) {
  console.log('\n📈 RECOVERY RESULTS');
  console.log('='.repeat(40));

  console.log('\n🔢 Before → After:');
  Object.entries(stats.initialCounts).forEach(([conf, initial]) => {
    const final = stats.finalCounts[conf as keyof typeof stats.finalCounts];
    const change = final - initial;
    const arrow = change > 0 ? '↗️' : change < 0 ? '↘️' : '→';
    console.log(`  • ${conf}: ${initial.toLocaleString()} ${arrow} ${final.toLocaleString()} ${change !== 0 ? `(${change > 0 ? '+' : ''}${change})` : ''}`);
  });

  console.log('\n🎯 Recovery Methods:');
  console.log(`  • Event-based evidence: ${stats.recoveredByEvent.toLocaleString()}`);
  console.log(`  • Bookend propagation: ${stats.recoveredByBookend.toLocaleString()}`);
  console.log(`  • Conflicts flagged: ${stats.flaggedConflicts.toLocaleString()}`);

  const totalRecovered = stats.recoveredByEvent + stats.recoveredByBookend;
  console.log(`\n✅ Total recovered: ${totalRecovered.toLocaleString()}`);

  const finalValidStints = stats.finalCounts.full + stats.finalCounts.fullInferred;
  const initialValidStints = stats.initialCounts.full + stats.initialCounts.fullInferred;
  console.log(`📊 Valid stints for RAPM: ${initialValidStints.toLocaleString()} → ${finalValidStints.toLocaleString()}`);
}

async function main() {
  const program = new Command();

  program
    .option('--season <number>', 'Season to process', '2026')
    .option('--dry-run', 'Preview changes without writing to database')
    .option('--write', 'Apply changes to database');

  program.parse();
  const options = program.opts();

  if (!options.dryRun && !options.write) {
    console.log('❌ Must specify either --dry-run or --write');
    process.exit(1);
  }

  const season = parseInt(options.season);
  const dryRun = options.dryRun;

  try {
    const stats = await recoverPartialStints(season, dryRun);
    printRecoveryReport(stats);

    console.log('\n📋 Next Steps:');
    console.log('1. Run bias audit: npx tsx scripts/audit-rapm-coverage.ts');
    console.log('2. Extract stints: cd scripts/python/rapm && python extract_stints.py');
    console.log('3. Train RAPM: python train_rapm.py');

  } catch (error) {
    console.error('❌ Recovery failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);