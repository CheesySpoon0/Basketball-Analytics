import { redirect } from 'next/navigation';
import { prisma } from '../../lib/prisma';
import { resolveSeason, withSeason } from '../../lib/season';

export const dynamic = 'force-dynamic';

const HOME_TEAM = 'UC Irvine';

export default async function ShotChartRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const season = resolveSeason(await searchParams);
  const team = await prisma.team.findFirst({ where: { school: HOME_TEAM } });
  if (!team) redirect('/');
  const topScorer = await prisma.playerSeasonStats.findFirst({
    where: { teamId: team.id, season },
    orderBy: { points: 'desc' },
  });
  if (!topScorer) redirect(withSeason(`/teams/${team.id}`, season));
  redirect(withSeason(`/players/${topScorer.playerId}`, season));
}
