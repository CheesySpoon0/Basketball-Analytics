import { redirect } from 'next/navigation';
import { prisma } from '../../lib/prisma';

export const dynamic = 'force-dynamic';

const SEASON = 2025;
const HOME_TEAM = 'UC Irvine';

export default async function ShotChartRedirect() {
  const team = await prisma.team.findFirst({ where: { school: HOME_TEAM } });
  if (!team) redirect('/');
  const topScorer = await prisma.playerSeasonStats.findFirst({
    where: { teamId: team.id, season: SEASON },
    orderBy: { points: 'desc' },
  });
  if (!topScorer) redirect(`/teams/${team.id}`);
  redirect(`/players/${topScorer.playerId}`);
}
