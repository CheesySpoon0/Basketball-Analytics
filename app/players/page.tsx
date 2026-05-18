import Link from 'next/link';
import { prisma } from '../../lib/prisma';

export const dynamic = 'force-dynamic';

const SEASON = 2025;

const BIG_WEST_SCHOOLS = [
  'UC Irvine',
  'UC Santa Barbara',
  'Long Beach State',
  'Cal Poly',
  'Cal State Bakersfield',
  'Cal State Fullerton',
  'Cal State Northridge',
  "Hawai'i",
  'UC Davis',
  'UC Riverside',
  'UC San Diego',
];

export default async function PlayersIndex() {
  const teams = await prisma.team.findMany({
    where: { school: { in: BIG_WEST_SCHOOLS } },
  });
  const teamIds = teams.map((t) => t.id);
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const top = await prisma.playerSeasonStats.findMany({
    where: { teamId: { in: teamIds }, season: SEASON },
    orderBy: { points: 'desc' },
    take: 50,
    include: { player: true },
  });

  return (
    <main className="max-w-[1400px] mx-auto px-6 lg:px-8 py-12 lg:py-16">
      <div className="mono text-[11px] uppercase tracking-[0.2em] text-text-dim mb-6">
        Big West · {SEASON - 1}–{String(SEASON).slice(2)}
      </div>
      <h1 className="display text-[56px] sm:text-[72px] leading-[0.95] tracking-tight font-medium mb-12">
        Top Scorers
      </h1>

      <div className="bg-surface border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="stat-label py-3 px-4 w-12">#</th>
              <th className="stat-label py-3 px-4">Player</th>
              <th className="stat-label py-3 px-4">Team</th>
              <th className="stat-label py-3 px-4 text-right">G</th>
              <th className="stat-label py-3 px-4 text-right">Pts</th>
              <th className="stat-label py-3 px-4 text-right">PPG</th>
              <th className="stat-label py-3 px-4 text-right">RPG</th>
              <th className="stat-label py-3 px-4 text-right">APG</th>
            </tr>
          </thead>
          <tbody>
            {top.map((s, i) => {
              const team = s.teamId !== null ? teamById.get(s.teamId) : null;
              const ppg = (s.games ?? 0) > 0 ? (s.points ?? 0) / (s.games ?? 1) : 0;
              const rpg = (s.games ?? 0) > 0 ? (s.rebounds ?? 0) / (s.games ?? 1) : 0;
              const apg = (s.games ?? 0) > 0 ? (s.assists ?? 0) / (s.games ?? 1) : 0;
              return (
                <tr key={s.id} className="border-b border-border last:border-b-0 hover:bg-surface-2 transition-colors">
                  <td className="py-3 px-4 mono tabular-nums text-text-dim">{i + 1}</td>
                  <td className="py-3 px-4">
                    <Link href={`/players/${s.playerId}`} className="hover:text-accent transition-colors">
                      <span className="display font-medium">{s.player.name}</span>
                      {s.player.jersey && (
                        <span className="ml-2 mono text-xs tabular-nums text-text-dim">#{s.player.jersey}</span>
                      )}
                    </Link>
                  </td>
                  <td className="py-3 px-4 text-text-dim">
                    {team ? (
                      <Link href={`/teams/${team.id}`} className="hover:text-text transition-colors">
                        {team.abbreviation ?? team.school}
                      </Link>
                    ) : '—'}
                  </td>
                  <td className="py-3 px-4 mono tabular-nums text-right">{s.games}</td>
                  <td className="py-3 px-4 mono tabular-nums text-right">{s.points}</td>
                  <td className="py-3 px-4 mono tabular-nums text-right font-medium">{ppg.toFixed(1)}</td>
                  <td className="py-3 px-4 mono tabular-nums text-right">{rpg.toFixed(1)}</td>
                  <td className="py-3 px-4 mono tabular-nums text-right">{apg.toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
