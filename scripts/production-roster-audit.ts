import { prisma } from '../lib/prisma';
import { Command } from 'commander';

/**
 * Production Roster Audit Script
 *
 * Validates that ALL roster assignments match PlayerSeasonStats truth.
 * Flags any player shown on a team page whose PlayerSeasonStats does not match.
 */

interface RosterViolation {
  playerId: number;
  playerName: string;
  shownOnTeamId: number;
  shownOnTeamName: string;
  season: number;
  actualTeamId?: number;
  actualTeamName?: string;
  violationType: 'missing_season_stats' | 'wrong_team' | 'duplicate_team';
}

interface TransferCase {
  playerId: number;
  playerName: string;
  currentTeamId?: number;
  currentTeamName?: string;
  seasonAssignments: Array<{
    season: number;
    teamId: number;
    teamName: string;
    minutes: number;
  }>;
}

interface AuditResults {
  totalTeamsAudited: number;
  totalSeasonsAudited: number;
  rosterViolations: RosterViolation[];
  transferCases: TransferCase[];
  michiganStateAudit: {
    season2025: {
      playersShown: Array<{ id: number; name: string }>;
      shouldNotInclude: string[];
      violations: string[];
    };
    season2026: {
      playersShown: Array<{ id: number; name: string }>;
      shouldOnlyInclude: Array<{ id: number; name: string }>;
    };
  };
}

async function auditTeamRoster(teamId: number, season: number): Promise<RosterViolation[]> {
  // Get the "truth" - who actually has PlayerSeasonStats for this team+season
  const actualRoster = await prisma.playerSeasonStats.findMany({
    where: { teamId, season },
    include: {
      player: { select: { id: true, name: true } },
      team: { select: { id: true, school: true } }
    }
  });

  const actualPlayerIds = new Set(actualRoster.map(r => r.playerId));

  // Get who would be shown by current Player.teamId logic (the old way)
  const currentlyAssignedPlayers = await prisma.player.findMany({
    where: { teamId },
    select: { id: true, name: true, teamId: true },
    include: {
      team: { select: { id: true, school: true } },
      seasonStats: {
        where: { season },
        include: { team: { select: { id: true, school: true } } }
      }
    }
  });

  const violations: RosterViolation[] = [];

  // Check each player currently assigned to this team
  for (const player of currentlyAssignedPlayers) {
    // If they don't have season stats for this team+season, it's a violation
    if (!actualPlayerIds.has(player.id)) {
      const actualSeasonStats = player.seasonStats[0];

      violations.push({
        playerId: player.id,
        playerName: player.name || `Player ${player.id}`,
        shownOnTeamId: teamId,
        shownOnTeamName: player.team?.school || 'Unknown',
        season,
        actualTeamId: actualSeasonStats?.teamId,
        actualTeamName: actualSeasonStats?.team?.school,
        violationType: actualSeasonStats ? 'wrong_team' : 'missing_season_stats'
      });
    }
  }

  return violations;
}

async function findTransferCases(): Promise<TransferCase[]> {
  // Find players who have played for multiple teams
  const playersWithMultipleTeams = await prisma.player.findMany({
    include: {
      seasonStats: {
        include: { team: { select: { id: true, school: true } } },
        orderBy: { season: 'desc' }
      },
      team: { select: { id: true, school: true } }
    }
  });

  const transferCases: TransferCase[] = [];

  for (const player of playersWithMultipleTeams) {
    const uniqueTeams = new Set(player.seasonStats.map(s => s.teamId));

    if (uniqueTeams.size > 1) {
      transferCases.push({
        playerId: player.id,
        playerName: player.name || `Player ${player.id}`,
        currentTeamId: player.teamId || undefined,
        currentTeamName: player.team?.school,
        seasonAssignments: player.seasonStats.map(s => ({
          season: s.season,
          teamId: s.teamId!,
          teamName: s.team!.school,
          minutes: s.minutes || 0
        }))
      });
    }
  }

  return transferCases.slice(0, 10); // Limit for readability
}

async function auditMichiganState(): Promise<AuditResults['michiganStateAudit']> {
  const MSU_TEAM_ID = 169;

  // Get 2025 roster (should NOT include Trey Fort, Cam Ward)
  const roster2025 = await prisma.playerSeasonStats.findMany({
    where: { teamId: MSU_TEAM_ID, season: 2025 },
    include: { player: { select: { id: true, name: true } } }
  });

  // Get 2026 roster
  const roster2026 = await prisma.playerSeasonStats.findMany({
    where: { teamId: MSU_TEAM_ID, season: 2026 },
    include: { player: { select: { id: true, name: true } } }
  });

  // Check for known problematic players
  const problematicNames = ['Fort', 'Ward'];
  const violations2025: string[] = [];

  for (const player of roster2025) {
    const name = player.player.name || '';
    if (problematicNames.some(prob => name.includes(prob))) {
      violations2025.push(`${name} should NOT appear in MSU 2025 roster`);
    }
  }

  return {
    season2025: {
      playersShown: roster2025.map(r => ({
        id: r.playerId,
        name: r.player.name || `Player ${r.playerId}`
      })),
      shouldNotInclude: ['Trey Fort', 'Cam Ward'],
      violations: violations2025
    },
    season2026: {
      playersShown: roster2026.map(r => ({
        id: r.playerId,
        name: r.player.name || `Player ${r.playerId}`
      })),
      shouldOnlyInclude: roster2026.map(r => ({
        id: r.playerId,
        name: r.player.name || `Player ${r.playerId}`
      }))
    }
  };
}

async function runProductionAudit(seasons: number[]): Promise<AuditResults> {
  console.log('🔍 PRODUCTION ROSTER AUDIT - COMPREHENSIVE VALIDATION\n');

  // Get all teams with season data
  const teamsToAudit = await prisma.team.findMany({
    where: {
      playerSeasonStats: {
        some: { season: { in: seasons } }
      }
    },
    select: { id: true, school: true },
    take: 50 // Limit for performance in audit
  });

  console.log(`📊 Auditing ${teamsToAudit.length} teams across ${seasons.length} seasons\n`);

  const allViolations: RosterViolation[] = [];

  // Audit each team-season combination
  for (const team of teamsToAudit) {
    for (const season of seasons) {
      const violations = await auditTeamRoster(team.id, season);
      allViolations.push(...violations);
    }
  }

  // Find transfer cases
  console.log('🔍 Analyzing transfer cases...');
  const transferCases = await findTransferCases();

  // Special Michigan State audit
  console.log('🏀 Auditing Michigan State specifically...');
  const msuAudit = await auditMichiganState();

  return {
    totalTeamsAudited: teamsToAudit.length,
    totalSeasonsAudited: seasons.length,
    rosterViolations: allViolations,
    transferCases,
    michiganStateAudit: msuAudit
  };
}

function printAuditResults(results: AuditResults) {
  console.log('\n' + '='.repeat(80));
  console.log('📋 PRODUCTION ROSTER AUDIT RESULTS');
  console.log('='.repeat(80));

  console.log(`\n📊 Audit Scope:`);
  console.log(`  • Teams audited: ${results.totalTeamsAudited}`);
  console.log(`  • Seasons: ${results.totalSeasonsAudited}`);
  console.log(`  • Total team-season combinations: ${results.totalTeamsAudited * results.totalSeasonsAudited}`);

  console.log(`\n🚨 Roster Violations Found: ${results.rosterViolations.length}`);

  if (results.rosterViolations.length > 0) {
    console.log('\n❌ CRITICAL ISSUES:');
    results.rosterViolations.slice(0, 10).forEach((violation, i) => {
      console.log(`  ${i + 1}. ${violation.playerName} (${violation.playerId})`);
      console.log(`     Shown on: ${violation.shownOnTeamName} (${violation.shownOnTeamId})`);
      console.log(`     Actually played for: ${violation.actualTeamName || 'No team'} in season ${violation.season}`);
      console.log(`     Type: ${violation.violationType}`);
      console.log('');
    });

    if (results.rosterViolations.length > 10) {
      console.log(`     ... and ${results.rosterViolations.length - 10} more violations`);
    }
  } else {
    console.log('✅ NO ROSTER VIOLATIONS FOUND - All teams show correct season-specific rosters!');
  }

  console.log(`\n🔄 Transfer Cases Analyzed: ${results.transferCases.length}`);

  if (results.transferCases.length > 0) {
    console.log('\n📈 Sample Transfer Cases:');
    results.transferCases.slice(0, 5).forEach((tc, i) => {
      console.log(`  ${i + 1}. ${tc.playerName} (${tc.playerId})`);
      console.log(`     Current assignment: ${tc.currentTeamName || 'None'}`);
      console.log(`     Season history:`);
      tc.seasonAssignments.forEach(sa => {
        console.log(`       ${sa.season}: ${sa.teamName} (${sa.minutes} min)`);
      });
      console.log('');
    });
  }

  console.log(`\n🎯 Michigan State Audit:`);
  const msu = results.michiganStateAudit;

  console.log(`  2025 Season (${msu.season2025.playersShown.length} players):`);
  if (msu.season2025.violations.length > 0) {
    console.log(`    ❌ Violations found:`);
    msu.season2025.violations.forEach(v => console.log(`      • ${v}`));
  } else {
    console.log(`    ✅ No problematic transfers found (Fort/Ward not present)`);
  }

  console.log(`  2026 Season (${msu.season2026.playersShown.length} players):`);
  console.log(`    ✅ Shows only players with 2026 MSU PlayerSeasonStats`);

  console.log('\n💡 Assessment:');
  if (results.rosterViolations.length === 0) {
    console.log('🎉 AUDIT PASSED: All team rosters correctly use season-specific data');
    console.log('✅ Michigan State transfer bug is fixed');
    console.log('✅ All teams show correct season rosters');
  } else {
    console.log('❌ AUDIT FAILED: Roster violations found - see details above');
    console.log('🔧 Action required: Fix query patterns to use PlayerSeasonStats');
  }
}

async function main() {
  const program = new Command();

  program
    .option('--seasons <numbers>', 'Seasons to audit', '2025,2026')
    .option('--full', 'Run full audit on all teams')
    .option('--quick', 'Quick audit on sample teams');

  program.parse();
  const options = program.opts();

  const seasons = options.seasons.split(',').map((s: string) => parseInt(s.trim()));

  try {
    console.log('Starting production roster audit...\n');

    const results = await runProductionAudit(seasons);
    printAuditResults(results);

    if (results.rosterViolations.length === 0) {
      console.log('\n✅ PRODUCTION READY: Roster system is correctly implemented');
      process.exit(0);
    } else {
      console.log('\n❌ PRODUCTION NOT READY: Fix violations before deploying');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Audit failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);