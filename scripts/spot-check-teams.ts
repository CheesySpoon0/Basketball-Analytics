import 'dotenv/config';
import { prisma } from '../lib/prisma';

async function spotCheckTeams() {
  const SEASON = 2025;

  console.log('🔍 Spot-checking OREB% for other teams\n');

  const teams = [
    { id: 311, name: 'UC Santa Barbara' },
    { id: 35, name: 'Cal Poly' }
  ];

  for (const team of teams) {
    const teamStats = await prisma.teamSeasonStats.findUnique({
      where: { teamId_season: { teamId: team.id, season: SEASON } }
    });

    if (teamStats) {
      const oreb = teamStats.offensiveRebounds ?? 0;
      const oppDreb = teamStats.oppDefensiveRebounds ?? 0;
      const orebPct = (oreb + oppDreb) > 0 ? (oreb / (oreb + oppDreb)) * 100 : 0;

      console.log(`📊 ${team.name}:`);
      console.log(`  OREB: ${oreb}, Opp DREB: ${oppDreb}`);
      console.log(`  OREB%: ${orebPct.toFixed(1)}%`);
      console.log('');
    }
  }

  await prisma.$disconnect();
}

spotCheckTeams().catch(console.error);