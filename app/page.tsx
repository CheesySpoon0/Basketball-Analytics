import Link from 'next/link';
import { prisma } from '../lib/prisma';

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

const HOME_TEAM = 'UC Irvine';

type TeamCard = {
  id: number;
  school: string;
  displayName: string | null;
  mascot: string | null;
  abbreviation: string | null;
  primaryColor: string | null;
  wins: number;
  losses: number;
  games: number;
  pointsTotal: number;
  fgPct: number | null;
  threePct: number | null;
};

async function getTeamCards(): Promise<TeamCard[]> {
  const teams = await prisma.team.findMany({
    where: { school: { in: BIG_WEST_SCHOOLS } },
  });
  const teamIds = teams.map((t) => t.id);

  const stats = await prisma.teamSeasonStats.findMany({
    where: { teamId: { in: teamIds }, season: SEASON },
  });
  const statsByTeam = new Map(stats.map((s) => [s.teamId, s]));

  return teams
    .map((t) => {
      const s = statsByTeam.get(t.id);
      const fgPct =
        s && (s.fieldGoalsAttempted ?? 0) > 0
          ? (s.fieldGoalsMade ?? 0) / (s.fieldGoalsAttempted ?? 1)
          : null;
      const threePct =
        s && (s.threePointsAttempted ?? 0) > 0
          ? (s.threePointsMade ?? 0) / (s.threePointsAttempted ?? 1)
          : null;
      return {
        id: t.id,
        school: t.school,
        displayName: t.displayName,
        mascot: t.mascot,
        abbreviation: t.abbreviation,
        primaryColor: t.primaryColor,
        wins: s?.wins ?? 0,
        losses: s?.losses ?? 0,
        games: s?.games ?? 0,
        pointsTotal: s?.pointsTotal ?? 0,
        fgPct,
        threePct,
      };
    })
    .sort((a, b) => b.wins - a.wins);
}

function TeamCard({ team, featured }: { team: TeamCard; featured?: boolean }) {
  const winPct = team.games > 0 ? team.wins / team.games : 0;
  const ppg = team.games > 0 ? team.pointsTotal / team.games : 0;
  const accentColor = team.primaryColor ? `#${team.primaryColor}` : 'var(--accent)';

  return (
    <Link
      href={`/teams/${team.id}`}
      className={[
        'group relative block bg-surface hover:bg-surface-2 transition-colors',
        featured ? 'sm:col-span-2 sm:row-span-2 p-8' : 'p-5',
      ].join(' ')}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ backgroundColor: accentColor }}
      />

      {featured && (
        <div className="mb-6 flex items-center gap-2">
          <span className="mono text-[10px] uppercase tracking-[0.2em] text-accent border border-accent/40 px-2 py-0.5">
            Home Program
          </span>
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mono text-[10px] uppercase tracking-widest text-text-dim mb-1">
            {team.abbreviation ?? team.school}
          </div>
          <h2
            className={[
              'display font-medium leading-[1.05] tracking-tight',
              featured ? 'text-[44px] sm:text-[56px]' : 'text-[22px]',
            ].join(' ')}
          >
            {team.school}
          </h2>
          {team.mascot && (
            <div className="text-text-dim text-sm mt-1">{team.mascot}</div>
          )}
        </div>
        <div className={featured ? 'text-right' : 'text-right shrink-0'}>
          <div className={['mono font-medium tabular-nums', featured ? 'text-[36px]' : 'text-[20px]'].join(' ')}>
            {team.wins}-{team.losses}
          </div>
          <div className="stat-label mt-0.5">Record</div>
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between mb-1.5">
          <span className="stat-label">Win %</span>
          <span className="mono text-xs tabular-nums text-text">{(winPct * 100).toFixed(1)}%</span>
        </div>
        <div className="h-[3px] bg-border overflow-hidden">
          <div
            className="h-full transition-all"
            style={{ width: `${winPct * 100}%`, backgroundColor: accentColor }}
          />
        </div>
      </div>

      {featured ? (
        <div className="mt-8 grid grid-cols-3 gap-6 pt-6 border-t border-border">
          <div>
            <div className="stat-label">PPG</div>
            <div className="mono text-2xl tabular-nums mt-1">{ppg.toFixed(1)}</div>
          </div>
          <div>
            <div className="stat-label">FG%</div>
            <div className="mono text-2xl tabular-nums mt-1">{team.fgPct !== null ? (team.fgPct * 100).toFixed(1) : '—'}</div>
          </div>
          <div>
            <div className="stat-label">3PT%</div>
            <div className="mono text-2xl tabular-nums mt-1">{team.threePct !== null ? (team.threePct * 100).toFixed(1) : '—'}</div>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 pt-4 border-t border-border">
          <div>
            <div className="stat-label">PPG</div>
            <div className="mono text-base tabular-nums mt-0.5">{ppg.toFixed(1)}</div>
          </div>
          <div>
            <div className="stat-label">FG%</div>
            <div className="mono text-base tabular-nums mt-0.5">{team.fgPct !== null ? (team.fgPct * 100).toFixed(1) : '—'}</div>
          </div>
        </div>
      )}
    </Link>
  );
}

export default async function HomePage() {
  const teams = await getTeamCards();
  const home = teams.find((t) => t.school === HOME_TEAM);
  const others = teams.filter((t) => t.school !== HOME_TEAM);
  const totalGames = teams.reduce((acc, t) => acc + t.games, 0);

  return (
    <main className="max-w-[1400px] mx-auto px-6 lg:px-8 py-16 lg:py-24">
      <section className="mb-16 lg:mb-24 max-w-3xl">
        <div className="mono text-[11px] uppercase tracking-[0.25em] text-text-dim mb-6">
          Vol. 01 · 2024–25 Conference Report
        </div>
        <h1 className="display text-[56px] sm:text-[72px] lg:text-[88px] leading-[0.95] tracking-tight font-medium">
          Big West<br />
          <span className="text-accent">Conference</span> Scouting
        </h1>
        <p className="mt-8 text-text-dim text-lg leading-relaxed max-w-2xl">
          Eleven programs. {totalGames} team-seasons of play-by-play tracked.
          Shot locations, possession-level intelligence, and roster intel for
          the {SEASON - 1}–{String(SEASON).slice(2)} season.
        </p>
        <div className="mt-10 flex items-center gap-8 text-sm">
          <div>
            <div className="stat-label">Teams</div>
            <div className="mono text-xl tabular-nums mt-1">{teams.length}</div>
          </div>
          <div className="h-10 w-px bg-border" />
          <div>
            <div className="stat-label">Games</div>
            <div className="mono text-xl tabular-nums mt-1">{totalGames}</div>
          </div>
          <div className="h-10 w-px bg-border" />
          <div>
            <div className="stat-label">Season</div>
            <div className="mono text-xl tabular-nums mt-1">{SEASON - 1}–{String(SEASON).slice(2)}</div>
          </div>
        </div>
      </section>

      <div className="flex items-baseline justify-between mb-8 pb-3 border-b border-border">
        <h2 className="display text-2xl font-medium">The Conference</h2>
        <span className="mono text-[11px] uppercase tracking-widest text-text-dim">
          Sorted by wins
        </span>
      </div>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-border">
        {home && <TeamCard team={home} featured />}
        {others.map((t) => (
          <TeamCard key={t.id} team={t} />
        ))}
      </section>

      <footer className="mt-24 pt-8 border-t border-border text-text-dim text-xs flex justify-between">
        <span className="mono uppercase tracking-widest">SCOUT · v0.1</span>
        <span className="mono">Data: CBBD · React + Prisma</span>
      </footer>
    </main>
  );
}
