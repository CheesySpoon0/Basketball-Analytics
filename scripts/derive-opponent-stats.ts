import 'dotenv/config';
import { prisma } from '../lib/prisma';

const SEASON = 2025;

// Classify playType into categories based on audit results
const MADE_FIELD_GOAL_TYPES = new Set([
  'JumpShot',
  'LayUpShot',
  'DunkShot',
  'TipShot'
]);

const MADE_FREE_THROW_TYPES = new Set(['MadeFreeThrow']);

const OFFENSIVE_REBOUND_TYPES = new Set(['Offensive Rebound']);
const DEFENSIVE_REBOUND_TYPES = new Set(['Defensive Rebound']);

const TURNOVER_TYPES = new Set([
  'Lost Ball Turnover',
  // Add other turnover types if they exist
]);

async function deriveOpponentStats() {
  console.log('📊 Deriving opponent stats for all teams...\n');

  // Get all teams with season stats
  const teams = await prisma.teamSeasonStats.findMany({
    where: { season: SEASON },
    include: { team: true }
  });

  console.log(`Processing ${teams.length} teams for season ${SEASON}`);

  for (const teamSeasonStats of teams) {
    const teamId = teamSeasonStats.teamId;
    const teamName = teamSeasonStats.team.school;

    console.log(`\n🏀 Processing ${teamName} (ID: ${teamId})`);

    // Find all games involving this team (including exhibitions)
    const games = await prisma.game.findMany({
      where: {
        season: SEASON,
        OR: [
          { homeTeamId: teamId },
          { awayTeamId: teamId }
        ]
      },
      select: {
        id: true,
        homeTeamId: true,
        awayTeamId: true,
        homeScore: true,
        awayScore: true
      }
    });

    let gamesSkipped = 0;
    let totalOppFGA = 0;
    let totalOppFGM = 0;
    let totalOpp3PA = 0;
    let totalOpp3PM = 0;
    let totalOppFTA = 0;
    let totalOppFTM = 0;
    let totalOppOREB = 0;
    let totalOppDREB = 0;
    let totalOppTO = 0;
    let totalOppPoints = 0;

    for (const game of games) {
      const opponentTeamId = game.homeTeamId === teamId ? game.awayTeamId : game.homeTeamId;

      // For exhibition games (null opponentTeamId), we still count rebounds but skip offensive stats
      if (!opponentTeamId) {
        // Still count rebounds for exhibition games
        const allGamePlays = await prisma.play.findMany({
          where: {
            gameId: game.id
          },
          select: {
            playType: true,
            player: {
              select: {
                teamId: true
              }
            }
          }
        });

        // Count rebounds in exhibition games
        for (const play of allGamePlays) {
          const playType = play.playType;
          const playerTeamId = play.player?.teamId;

          if (!playType) continue;

          // Count opponent rebounds: any rebound by a player NOT on our team
          if (playerTeamId !== teamId) {
            if (OFFENSIVE_REBOUND_TYPES.has(playType)) {
              totalOppOREB++;
            } else if (DEFENSIVE_REBOUND_TYPES.has(playType)) {
              totalOppDREB++;
            }
          }
        }

        gamesSkipped++;
        continue;
      }

      // We'll derive points from scoring plays instead of game scores
      let gameOppPoints = 0;

      // Get all plays in this game for stats attribution
      const allGamePlays = await prisma.play.findMany({
        where: {
          gameId: game.id
        },
        select: {
          playType: true,
          scoringPlay: true,
          shootingPlay: true,
          scoreValue: true,
          shotMade: true,
          teamId: true,
          playerId: true,
          player: {
            select: {
              teamId: true
            }
          }
        }
      });

      // Filter opponent offensive plays for scoring stats
      const oppOffensivePlays = allGamePlays.filter(play => play.teamId === opponentTeamId);

      // Count opponent's offensive stats in this game
      let gameFGA = 0;
      let gameFGM = 0;
      let game3PA = 0;
      let game3PM = 0;
      let gameFTA = 0;
      let gameFTM = 0;
      let gameOREB = 0;
      let gameDREB = 0;
      let gameTO = 0;

      // Process offensive plays (shooting, scoring, turnovers) - use teamId filter
      for (const play of oppOffensivePlays) {
        const playType = play.playType;

        if (!playType) continue;

        // Count field goal attempts (shooting plays that aren't free throws)
        if (play.shootingPlay && play.scoreValue !== 1) {
          gameFGA++;

          // Count makes - check if it's a scoring play with field goal types
          if (play.scoringPlay && MADE_FIELD_GOAL_TYPES.has(playType)) {
            gameFGM++;
          }

          // Count three-point attempts and makes
          if (play.scoreValue === 3) {
            game3PA++;
            if (play.scoringPlay && play.shotMade) {
              game3PM++;
            }
          }
        }

        // Count free throw attempts and makes
        if (MADE_FREE_THROW_TYPES.has(playType)) {
          gameFTA++;
          gameFTM++;
        }

        // Count turnovers
        if (TURNOVER_TYPES.has(playType)) {
          gameTO++;
        }

        // Count points from scoring plays
        if (play.scoringPlay && play.scoreValue) {
          gameOppPoints += play.scoreValue;
        }
      }

      // Process rebounds separately - count all rebounds by NON-team players
      for (const play of allGamePlays) {
        const playType = play.playType;
        const playerTeamId = play.player?.teamId;

        if (!playType) continue;

        // Count opponent rebounds: any rebound by a player NOT on our team
        // This includes unknown players (null teamId) as opponent rebounds
        if (playerTeamId !== teamId) {
          if (OFFENSIVE_REBOUND_TYPES.has(playType)) {
            gameOREB++;
          } else if (DEFENSIVE_REBOUND_TYPES.has(playType)) {
            gameDREB++;
          }
        }
      }

      totalOppPoints += gameOppPoints;

      // Accumulate totals
      totalOppFGA += gameFGA;
      totalOppFGM += gameFGM;
      totalOpp3PA += game3PA;
      totalOpp3PM += game3PM;
      totalOppFTA += gameFTA;
      totalOppFTM += gameFTM;
      totalOppOREB += gameOREB;
      totalOppDREB += gameDREB;
      totalOppTO += gameTO;
    }

    // Calculate opponent possessions
    const oppPossessions = totalOppFGA + 0.44 * totalOppFTA - totalOppOREB + totalOppTO;

    // Update the team's season stats with opponent totals
    await prisma.teamSeasonStats.update({
      where: {
        teamId_season: { teamId, season: SEASON }
      },
      data: {
        oppFieldGoalsAttempted: totalOppFGA,
        oppFieldGoalsMade: totalOppFGM,
        oppThreePointsAttempted: totalOpp3PA,
        oppThreePointsMade: totalOpp3PM,
        oppFreeThrowsAttempted: totalOppFTA,
        oppFreeThrowsMade: totalOppFTM,
        oppOffensiveRebounds: totalOppOREB,
        oppDefensiveRebounds: totalOppDREB,
        oppTurnovers: totalOppTO,
        oppPoints: totalOppPoints,
        oppPossessions: oppPossessions
      }
    });

    console.log(`  Processed ${games.length} games, skipped ${gamesSkipped}`);
    console.log(`  Opp totals: ${totalOppFGM}/${totalOppFGA} FG, ${totalOpp3PM}/${totalOpp3PA} 3PT`);
    console.log(`  ${totalOppFTM}/${totalOppFTA} FT, ${totalOppOREB} OREB, ${totalOppTO} TO, ${totalOppPoints} PTS`);
  }

  console.log('\n✅ Opponent stats derivation complete!');

  // Print UCI audit (before/after)
  const uciStats = await prisma.teamSeasonStats.findUnique({
    where: { teamId_season: { teamId: 308, season: SEASON } },
    include: { team: true }
  });

  if (uciStats) {
    console.log('\n🔍 UCI (Team 308) Final Stats Audit:');
    console.log('='.repeat(50));

    const oppFGA = uciStats.oppFieldGoalsAttempted ?? 0;
    const oppFGM = uciStats.oppFieldGoalsMade ?? 0;
    const opp3PM = uciStats.oppThreePointsMade ?? 0;
    const oppPoss = uciStats.oppPossessions ?? 0;
    const oppTO = uciStats.oppTurnovers ?? 0;
    const oppOREB = uciStats.oppOffensiveRebounds ?? 0;
    const oppDREB = uciStats.oppDefensiveRebounds ?? 0;
    const uciOREB = uciStats.offensiveRebounds ?? 0;
    const oppPts = uciStats.oppPoints ?? 0;
    const oppFTA = uciStats.oppFreeThrowsAttempted ?? 0;

    const oppEfg = oppFGA > 0 ? ((oppFGM + 0.5 * opp3PM) / oppFGA) : 0;
    const oppTovPct = oppPoss > 0 ? (oppTO / oppPoss) : 0;
    const uciOrebPct = (oppDREB + uciOREB) > 0 ? (uciOREB / (oppDREB + uciOREB)) : 0;
    const uciDrtg = oppPoss > 0 ? (oppPts / oppPoss) * 100 : 0;
    const oppFtr = oppFGA > 0 ? (oppFTA / oppFGA) : 0;

    console.log(`Opponent FGA: ${oppFGA}, FGM: ${oppFGM}`);
    console.log(`Opponent eFG%: ${(oppEfg * 100).toFixed(1)}%`);
    console.log(`Opponent TO: ${oppTO}, TOV%: ${(oppTovPct * 100).toFixed(1)}%`);
    console.log(`UCI OREB%: ${(uciOrebPct * 100).toFixed(1)}%`);
    console.log(`UCI DRtg: ${uciDrtg.toFixed(1)}`);
    console.log(`Opponent FTR: ${(oppFtr * 100).toFixed(1)}%`);
  }

  await prisma.$disconnect();
}

deriveOpponentStats().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});