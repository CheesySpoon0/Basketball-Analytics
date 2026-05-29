import { prisma } from '../lib/prisma';
import { Command } from 'commander';

/**
 * Comprehensive season-specific roster audit script.
 *
 * Validates that team rosters are correctly shown based on PlayerSeasonStats
 * rather than current Player.teamId assignments.
 *
 * This script is read-only and identifies mismatches without making changes.
 */

interface TeamSeasonAudit {
  teamId: number;
  teamName: string;
  season: number;
  correctPlayerIds: number[]; // From PlayerSeasonStats
  incorrectPlayerIds: number[]; // From Player.teamId who don't belong
  missingPlayerIds: number[]; // Should be on roster but missing from Player.teamId
  duplicateSeasonPlayers: number[]; // Players on multiple teams same season
  orphanedPlayers: number[]; // Players with stats but no matching player record
}

interface AuditSummary {
  totalTeamsAudited: number;
  totalSeasons: number;
  totalTeamSeasonCombinations: number;
  badRosterMismatches: number;
  teamsWithDuplicatePlayers: number;
  playersWithMultipleTeams: number;
  spotCheckResults: Record<string, TeamSeasonAudit[]>;
}

async function auditTeamSeasonRoster(teamId: number, season: number): Promise<TeamSeasonAudit> {
  // Get team info
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, school: true }
  });

  if (!team) {
    throw new Error(`Team ${teamId} not found`);
  }

  // CORRECT: Get roster from PlayerSeasonStats (season-specific truth)
  const correctRoster = await prisma.playerSeasonStats.findMany({
    where: { teamId, season },
    select: { playerId: true, player: { select: { name: true } } }
  });
  const correctPlayerIds = correctRoster.map(r => r.playerId);

  // POTENTIALLY INCORRECT: Get roster from Player.teamId (current assignment)
  const currentRoster = await prisma.player.findMany({
    where: { teamId },
    select: { id: true, name: true }
  });
  const currentPlayerIds = currentRoster.map(p => p.id);

  // Find mismatches
  const incorrectPlayerIds = currentPlayerIds.filter(id => !correctPlayerIds.includes(id));
  const missingPlayerIds = correctPlayerIds.filter(id => !currentPlayerIds.includes(id));

  // Check for players on multiple teams in same season
  const allPlayersInSeason = await prisma.playerSeasonStats.findMany({
    where: {
      season,
      playerId: { in: correctPlayerIds }
    },
    select: { playerId: true, teamId: true }
  });

  const playerTeamCounts = new Map<number, Set<number>>();
  allPlayersInSeason.forEach(pss => {
    if (!playerTeamCounts.has(pss.playerId)) {
      playerTeamCounts.set(pss.playerId, new Set());
    }
    playerTeamCounts.get(pss.playerId)!.add(pss.teamId);
  });

  const duplicateSeasonPlayers = Array.from(playerTeamCounts.entries())
    .filter(([_, teams]) => teams.size > 1)
    .map(([playerId, _]) => playerId)
    .filter(playerId => correctPlayerIds.includes(playerId));

  // Check for orphaned players (PlayerSeasonStats without Player record)
  const playerRecords = await prisma.player.findMany({
    where: { id: { in: correctPlayerIds } },
    select: { id: true }
  });
  const playerRecordIds = new Set(playerRecords.map(p => p.id));
  const orphanedPlayers = correctPlayerIds.filter(id => !playerRecordIds.has(id));

  return {
    teamId,
    teamName: team.school,
    season,
    correctPlayerIds,
    incorrectPlayerIds,
    missingPlayerIds,
    duplicateSeasonPlayers,
    orphanedPlayers
  };
}

async function auditAllTeams(seasons: number[]): Promise<AuditSummary> {
  console.log(`🔍 Starting comprehensive team roster audit for seasons: ${seasons.join(', ')}\n`);

  // Get all teams with PlayerSeasonStats in target seasons
  const teamsWithSeasonStats = await prisma.team.findMany({
    where: {
      playerSeasonStats: {
        some: {
          season: { in: seasons }
        }
      }
    },
    select: { id: true, school: true },
    orderBy: { id: 'asc' }
  });

  console.log(`📊 Found ${teamsWithSeasonStats.length} teams with season stats\n`);

  const allAudits: TeamSeasonAudit[] = [];
  let auditedCount = 0;

  for (const team of teamsWithSeasonStats) {
    for (const season of seasons) {
      try {
        const audit = await auditTeamSeasonRoster(team.id, season);
        allAudits.push(audit);
        auditedCount++;

        if (auditedCount % 50 === 0) {
          console.log(`✅ Audited ${auditedCount} team-season combinations...`);
        }
      } catch (error) {
        console.warn(`⚠️  Skipped ${team.school} (${team.id}) season ${season}: ${error}`);
      }
    }
  }

  console.log(`\n📈 Completed audit of ${auditedCount} team-season combinations\n`);

  // Calculate summary statistics
  const badRosterMismatches = allAudits.filter(audit =>
    audit.incorrectPlayerIds.length > 0 || audit.missingPlayerIds.length > 0
  ).length;

  const teamsWithDuplicatePlayers = allAudits.filter(audit =>
    audit.duplicateSeasonPlayers.length > 0
  ).length;

  const allPlayersWithMultipleTeams = new Set(
    allAudits.flatMap(audit => audit.duplicateSeasonPlayers)
  );

  return {
    totalTeamsAudited: teamsWithSeasonStats.length,
    totalSeasons: seasons.length,
    totalTeamSeasonCombinations: auditedCount,
    badRosterMismatches,
    teamsWithDuplicatePlayers,
    playersWithMultipleTeams: allPlayersWithMultipleTeams.size,
    spotCheckResults: {}
  };
}

async function runSpotChecks(seasons: number[]): Promise<Record<string, TeamSeasonAudit[]>> {
  console.log('🎯 Running spot checks on key teams...\n');

  const spotCheckTeams = [
    { name: 'Michigan State', id: 169 },
    { name: 'UC Irvine', id: 308 },
    { name: 'UC San Diego', id: 310 },
    { name: 'UC Santa Barbara', id: 311 },
    { name: 'Auburn', id: 16 }
  ];

  const spotCheckResults: Record<string, TeamSeasonAudit[]> = {};

  for (const team of spotCheckTeams) {
    console.log(`🏀 Auditing ${team.name} (ID: ${team.id})...`);
    spotCheckResults[team.name] = [];

    for (const season of seasons) {
      try {
        const audit = await auditTeamSeasonRoster(team.id, season);
        spotCheckResults[team.name].push(audit);

        console.log(`   ${season}: ${audit.correctPlayerIds.length} correct players`);
        if (audit.incorrectPlayerIds.length > 0) {
          console.log(`     ❌ ${audit.incorrectPlayerIds.length} incorrect players from Player.teamId`);
        }
        if (audit.missingPlayerIds.length > 0) {
          console.log(`     ⚠️  ${audit.missingPlayerIds.length} missing players (have stats but not in Player.teamId)`);
        }
        if (audit.duplicateSeasonPlayers.length > 0) {
          console.log(`     🔄 ${audit.duplicateSeasonPlayers.length} players on multiple teams this season`);
        }
      } catch (error) {
        console.log(`     ❌ Error: ${error}`);
      }
    }
    console.log('');
  }

  return spotCheckResults;
}

async function runRandomSpotChecks(seasons: number[], count: number = 20): Promise<void> {
  console.log(`🎲 Running ${count} random team spot checks...\n`);

  // Get random teams split between power conference and mid-major
  const powerConferences = ['Big Ten', 'SEC', 'ACC', 'Big 12', 'Pac-12', 'Big East'];

  const powerTeams = await prisma.team.findMany({
    where: {
      conference: { in: powerConferences },
      playerSeasonStats: {
        some: { season: { in: seasons } }
      }
    },
    select: { id: true, school: true, conference: true },
    take: Math.ceil(count / 2)
  });

  const midMajorTeams = await prisma.team.findMany({
    where: {
      conference: { notIn: [...powerConferences, null] },
      playerSeasonStats: {
        some: { season: { in: seasons } }
      }
    },
    select: { id: true, school: true, conference: true },
    take: Math.floor(count / 2)
  });

  const randomTeams = [...powerTeams, ...midMajorTeams];

  let issueCount = 0;

  for (const team of randomTeams) {
    for (const season of seasons) {
      try {
        const audit = await auditTeamSeasonRoster(team.id, season);
        const hasIssues = audit.incorrectPlayerIds.length > 0 || audit.missingPlayerIds.length > 0;

        if (hasIssues) {
          issueCount++;
          console.log(`❌ ${team.school} (${team.conference}) - Season ${season}:`);
          if (audit.incorrectPlayerIds.length > 0) {
            console.log(`   • ${audit.incorrectPlayerIds.length} incorrect players from Player.teamId`);
          }
          if (audit.missingPlayerIds.length > 0) {
            console.log(`   • ${audit.missingPlayerIds.length} missing season-specific players`);
          }
        } else {
          console.log(`✅ ${team.school} (${team.conference}) - Season ${season}: No roster issues`);
        }
      } catch (error) {
        console.log(`⚠️  ${team.school} - Season ${season}: ${error}`);
      }
    }
  }

  console.log(`\n📊 Random spot check summary: ${issueCount} team-season combinations with roster issues\n`);
}

async function checkSpecificMsuCases(seasons: number[]): Promise<void> {
  console.log('🎯 Checking specific Michigan State transfer cases...\n');

  // Check for known problematic players
  const problematicPlayers = [
    { name: 'Trey Fort', searchPattern: 'Fort' },
    { name: 'Cam Ward', searchPattern: 'Ward' }
  ];

  for (const playerInfo of problematicPlayers) {
    console.log(`🔍 Checking ${playerInfo.name}...`);

    // Find player by name pattern
    const players = await prisma.player.findMany({
      where: {
        name: {
          contains: playerInfo.searchPattern,
          mode: 'insensitive'
        }
      },
      include: {
        seasonStats: true,
        team: true
      }
    });

    for (const player of players) {
      console.log(`   Player: ${player.name} (ID: ${player.id})`);
      console.log(`   Current team: ${player.team?.school || 'None'} (${player.teamId})`);

      for (const season of seasons) {
        const seasonStats = player.seasonStats.find(s => s.season === season);
        if (seasonStats) {
          const seasonTeam = await prisma.team.findUnique({
            where: { id: seasonStats.teamId! },
            select: { school: true }
          });
          console.log(`   Season ${season}: ${seasonTeam?.school} (${seasonStats.teamId})`);

          // Check if this creates a Michigan State roster issue
          if (player.teamId === 169 && seasonStats.teamId !== 169) {
            console.log(`     ❌ ISSUE: Currently assigned to MSU but played for ${seasonTeam?.school} in ${season}`);
          }
        } else {
          console.log(`   Season ${season}: No stats`);
        }
      }
      console.log('');
    }
  }
}

function printAuditSummary(summary: AuditSummary, spotCheckResults: Record<string, TeamSeasonAudit[]>) {
  console.log('='.repeat(80));
  console.log('📋 SEASON-SPECIFIC ROSTER AUDIT SUMMARY');
  console.log('='.repeat(80));

  console.log(`\n📊 Audit Scope:`);
  console.log(`  • Total teams audited: ${summary.totalTeamsAudited}`);
  console.log(`  • Seasons analyzed: ${summary.totalSeasons}`);
  console.log(`  • Total team-season combinations: ${summary.totalTeamSeasonCombinations}`);

  console.log(`\n🚨 Issues Found:`);
  console.log(`  • Team-seasons with roster mismatches: ${summary.badRosterMismatches}`);
  console.log(`  • Teams with players on multiple teams same season: ${summary.teamsWithDuplicatePlayers}`);
  console.log(`  • Total players with multiple teams: ${summary.playersWithMultipleTeams}`);

  console.log(`\n🎯 Spot Check Results:`);
  Object.entries(spotCheckResults).forEach(([teamName, audits]) => {
    console.log(`  ${teamName}:`);
    audits.forEach(audit => {
      const issueCount = audit.incorrectPlayerIds.length + audit.missingPlayerIds.length;
      const status = issueCount === 0 ? '✅' : '❌';
      console.log(`    Season ${audit.season}: ${status} ${issueCount} roster issues`);
    });
  });

  console.log(`\n💡 Recommendations:`);
  if (summary.badRosterMismatches > 0) {
    console.log(`  • Fix ${summary.badRosterMismatches} team roster queries to use PlayerSeasonStats`);
  }
  if (summary.playersWithMultipleTeams > 0) {
    console.log(`  • Review ${summary.playersWithMultipleTeams} players with multiple team assignments`);
  }

  const overallHealthy = summary.badRosterMismatches === 0 && summary.playersWithMultipleTeams === 0;
  if (overallHealthy) {
    console.log(`\n✅ AUDIT PASSED: All team rosters correctly use season-specific data`);
  } else {
    console.log(`\n⚠️  AUDIT FLAGGED ISSUES: Review recommendations above`);
  }
}

async function main() {
  const program = new Command();

  program
    .option('--seasons <numbers>', 'Comma-separated seasons to audit', '2025,2026')
    .option('--teams <numbers>', 'Comma-separated team IDs for focused audit')
    .option('--skip-random', 'Skip random team spot checks')
    .option('--msu-focus', 'Focus on Michigan State transfer cases');

  program.parse();
  const options = program.opts();

  const seasons = options.seasons.split(',').map((s: string) => parseInt(s.trim()));

  try {
    if (options.msuFocus) {
      await checkSpecificMsuCases(seasons);
      return;
    }

    let summary: AuditSummary;
    let spotCheckResults: Record<string, TeamSeasonAudit[]> = {};

    if (options.teams) {
      // Focused audit on specific teams
      const teamIds = options.teams.split(',').map((t: string) => parseInt(t.trim()));
      console.log(`🎯 Focused audit on teams: ${teamIds.join(', ')}\n`);

      for (const teamId of teamIds) {
        const team = await prisma.team.findUnique({ where: { id: teamId } });
        if (team) {
          const audits: TeamSeasonAudit[] = [];
          for (const season of seasons) {
            const audit = await auditTeamSeasonRoster(teamId, season);
            audits.push(audit);
          }
          spotCheckResults[team.school] = audits;
        }
      }

      summary = {
        totalTeamsAudited: teamIds.length,
        totalSeasons: seasons.length,
        totalTeamSeasonCombinations: teamIds.length * seasons.length,
        badRosterMismatches: Object.values(spotCheckResults).flat().filter(audit =>
          audit.incorrectPlayerIds.length > 0 || audit.missingPlayerIds.length > 0
        ).length,
        teamsWithDuplicatePlayers: 0,
        playersWithMultipleTeams: 0,
        spotCheckResults
      };
    } else {
      // Full audit
      summary = await auditAllTeams(seasons);
      spotCheckResults = await runSpotChecks(seasons);

      if (!options.skipRandom) {
        await runRandomSpotChecks(seasons);
      }
    }

    await checkSpecificMsuCases(seasons);

    printAuditSummary(summary, spotCheckResults);

    console.log('\n📋 Next Steps:');
    console.log('1. Review flagged roster mismatches');
    console.log('2. Fix app queries to use PlayerSeasonStats instead of Player.teamId');
    console.log('3. Re-run audit to verify fixes');
    console.log('4. Run build to ensure no TypeScript errors');

  } catch (error) {
    console.error('❌ Audit failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);