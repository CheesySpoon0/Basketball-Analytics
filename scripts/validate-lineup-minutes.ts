import { prisma } from '../lib/prisma';

async function validateTeamLineups(teamId: number) {
  console.log(`🏀 Validating lineup optimizer for team ${teamId}...\n`);

  const season = 2026;

  try {
    // Get team info
    const team = await prisma.team.findUnique({
      where: { id: teamId }
    });

    if (!team) {
      console.log(`❌ Team ${teamId} not found`);
      return;
    }

    console.log(`Team: ${team.school} (ID: ${teamId})\n`);

    // Get team players
    const teamPlayers = await prisma.playerSeasonStats.findMany({
      where: { teamId, season },
      include: { player: true },
    });

    console.log(`📋 Team has ${teamPlayers.length} players for season ${season}\n`);

    // Check lineup stints for this team
    const rawLineups = await prisma.lineupStint.groupBy({
      by: ['lineupHash', 'playerIds'],
      where: {
        teamId,
        season,
        playerIds: { not: null }
      },
      _sum: {
        possessionsFor: true,
        possessionsAgainst: true,
      },
      _count: {
        gameId: true,
      },
      having: {
        OR: [
          { possessionsFor: { _sum: { gte: 20 } } },
          { possessionsAgainst: { _sum: { gte: 20 } } }
        ]
      }
    });

    console.log(`🏀 Found ${rawLineups.length} observed lineups with 20+ possessions\n`);

    // Check minutes calculation for each lineup
    let minMinutes = Infinity;
    let maxMinutes = 0;
    let totalMinutes = 0;
    let negativeMinuteCount = 0;
    let invalidPlayerCount = 0;

    const playerIds = new Set(teamPlayers.map(p => p.playerId));

    console.log('Top 5 lineups by usage:');
    console.log('Minutes | Games | Possessions | Player Check');
    console.log('--------|-------|-------------|-------------');

    for (let i = 0; i < Math.min(5, rawLineups.length); i++) {
      const lineup = rawLineups[i];

      const stints = await prisma.lineupStint.findMany({
        where: {
          teamId,
          season,
          lineupHash: lineup.lineupHash,
        },
        select: {
          startSeconds: true,
          endSeconds: true,
          gameId: true,
        },
      });

      // Calculate minutes using correct basketball clock logic
      const minutes = stints.reduce((sum, stint) => {
        const stintMinutes = (stint.startSeconds - stint.endSeconds) / 60;
        return sum + Math.max(0, stintMinutes);
      }, 0);

      const games = new Set(stints.map(s => s.gameId)).size;
      const possessions = (lineup._sum.possessionsFor || 0) + (lineup._sum.possessionsAgainst || 0);

      // Check if all players are on the team
      const lineupPlayerIds = lineup.playerIds!.split(',').map(id => parseInt(id, 10));
      const allPlayersOnTeam = lineupPlayerIds.every(pid => playerIds.has(pid));

      if (!allPlayersOnTeam) {
        invalidPlayerCount++;
      }

      if (minutes < 0) {
        negativeMinuteCount++;
      }

      totalMinutes += minutes;
      minMinutes = Math.min(minMinutes, minutes);
      maxMinutes = Math.max(maxMinutes, minutes);

      console.log(`${minutes.toFixed(1)}     | ${games}     | ${possessions}         | ${allPlayersOnTeam ? '✅' : '❌'}`);
    }

    console.log('\n📊 Summary:');
    console.log(`• Total lineups: ${rawLineups.length}`);
    console.log(`• Minimum minutes: ${minMinutes === Infinity ? 0 : minMinutes.toFixed(1)}`);
    console.log(`• Maximum minutes: ${maxMinutes.toFixed(1)}`);
    console.log(`• Total lineup minutes: ${totalMinutes.toFixed(1)}`);
    console.log(`• Lineups with negative minutes: ${negativeMinuteCount}`);
    console.log(`• Lineups with players not on team: ${invalidPlayerCount}`);

    if (negativeMinuteCount > 0) {
      console.log('\n❌ ISSUE: Found lineups with negative minutes');
    } else {
      console.log('\n✅ SUCCESS: No negative minutes found');
    }

    if (invalidPlayerCount > 0) {
      console.log('❌ ISSUE: Found lineups with players not on the team roster');
    } else {
      console.log('✅ SUCCESS: All lineup players are on the team roster');
    }

  } catch (error) {
    console.error('Error validating team lineups:', error);
  }
}

async function main() {
  // Test multiple teams
  await validateTeamLineups(308); // UCI
  console.log('\n' + '='.repeat(60) + '\n');
  await validateTeamLineups(109); // Another team

  await prisma.$disconnect();
}

main().catch(console.error);