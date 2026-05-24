import Link from 'next/link';
import { prisma } from '../lib/prisma';
import { SeasonSelector } from '../components/SeasonSelector';
import { resolveSeason, seasonLabel, withSeason } from '../lib/season';

export const dynamic = 'force-dynamic';

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

async function getTeamCards(season: number): Promise<TeamCard[]> {
  const teams = await prisma.team.findMany({
    where: { school: { in: BIG_WEST_SCHOOLS } },
  });
  const teamIds = teams.map((t) => t.id);

  const stats = await prisma.teamSeasonStats.findMany({
    where: { teamId: { in: teamIds }, season },
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

function TeamCard({
  team,
  season,
  featured,
}: {
  team: TeamCard;
  season: number;
  featured?: boolean;
}) {
  const winPct = team.games > 0 ? team.wins / team.games : 0;
  const ppg = team.games > 0 ? team.pointsTotal / team.games : 0;
  const accentColor = team.primaryColor ? `#${team.primaryColor}` : 'var(--accent)';

  return (
    <Link
      href={withSeason(`/teams/${team.id}`, season)}
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

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const season = resolveSeason(await searchParams);
  const teams = await getTeamCards(season);
  const home = teams.find((t) => t.school === HOME_TEAM);
  const others = teams.filter((t) => t.school !== HOME_TEAM);
  const totalGames = teams.reduce((acc, t) => acc + t.games, 0);

  return (
    <main className="max-w-[1400px] mx-auto px-6 lg:px-8 py-16 lg:py-24">
      <section className="mb-16 lg:mb-24 max-w-3xl">
        <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
          <div className="mono text-[11px] uppercase tracking-[0.25em] text-text-dim">
            {seasonLabel(season)} Conference Report
          </div>
          <SeasonSelector season={season} />
        </div>
        <h1 className="display text-[56px] sm:text-[72px] lg:text-[88px] leading-[0.95] tracking-tight font-medium">
          Big West<br />
          <span className="text-accent">Conference</span> Scouting
        </h1>
        <p className="mt-8 text-text-dim text-lg leading-relaxed max-w-2xl">
          Eleven programs. {totalGames} team-seasons of play-by-play tracked.
          Shot locations, possession-level intelligence, and roster intel for
          the {seasonLabel(season)} season.
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
            <div className="mono text-xl tabular-nums mt-1">{seasonLabel(season)}</div>
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
        {home && <TeamCard team={home} season={season} featured />}
        {others.map((t) => (
          <TeamCard key={t.id} team={t} season={season} />
        ))}
      </section>

      {/* Features Dashboard */}
      <section className="mt-24">
        <div className="flex items-baseline justify-between mb-8 pb-3 border-b border-border">
          <h2 className="display text-2xl font-medium">Analytical Tools</h2>
          <span className="mono text-[11px] uppercase tracking-widest text-text-dim">
            Coach-Ready Analytics
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {/* Lineup Optimizer */}
          <Link
            href={withSeason('/lineups', season)}
            className="group bg-surface hover:bg-surface-2 transition-colors p-6 border-l-4 border-accent"
          >
            <div className="flex items-start justify-between mb-4">
              <h3 className="display text-xl font-medium group-hover:text-accent transition-colors">
                Lineup Optimizer
              </h3>
              <div className="mono text-xs text-accent border border-accent/40 px-2 py-1 uppercase tracking-wider">
                Interactive
              </div>
            </div>
            <p className="text-text-dim leading-relaxed text-sm mb-4">
              Compare observed lineups and build projected 5-man units using RAPM estimates.
              Select any team to analyze their combinations and test new lineups.
            </p>
            <div className="text-xs text-accent group-hover:text-text transition-colors">
              Choose Team & Analyze Lineups →
            </div>
          </Link>

          {/* Impact Metrics / RAPM */}
          <Link
            href={withSeason('/impact', season)}
            className="group bg-surface hover:bg-surface-2 transition-colors p-6 border-l-4 border-blue-400"
          >
            <div className="flex items-start justify-between mb-4">
              <h3 className="display text-xl font-medium group-hover:text-blue-400 transition-colors">
                Impact Metrics
              </h3>
              <div className="mono text-xs text-blue-400 border border-blue-400/40 px-2 py-1 uppercase tracking-wider">
                RAPM
              </div>
            </div>
            <p className="text-text-dim leading-relaxed text-sm mb-4">
              Advanced player impact leaderboards with ORAPM, DRAPM, and Net RAPM.
              Filter and sort players by impact metrics across all D1 programs.
            </p>
            <div className="text-xs text-blue-400 group-hover:text-text transition-colors">
              Explore RAPM Leaderboards →
            </div>
          </Link>

          {/* Coach Briefs */}
          <Link
            href={withSeason('/briefs', season)}
            className="group bg-surface hover:bg-surface-2 transition-colors p-6 border-l-4 border-green-400"
          >
            <div className="flex items-start justify-between mb-4">
              <h3 className="display text-xl font-medium group-hover:text-green-400 transition-colors">
                Coach Briefs
              </h3>
              <div className="mono text-xs text-green-400 border border-green-400/40 px-2 py-1 uppercase tracking-wider">
                AI-Generated
              </div>
            </div>
            <p className="text-text-dim leading-relaxed text-sm mb-4">
              Comprehensive scouting reports with tactical breakdowns, player matchups,
              and strategic recommendations. Select opponent and generate briefs.
            </p>
            <div className="text-xs text-green-400 group-hover:text-text transition-colors">
              Generate Coach Briefs →
            </div>
          </Link>

          {/* Shot Quality / xeFG */}
          <Link
            href={withSeason('/shot-quality', season)}
            className="group bg-surface hover:bg-surface-2 transition-colors p-6 border-l-4 border-orange-400"
          >
            <div className="flex items-start justify-between mb-4">
              <h3 className="display text-xl font-medium group-hover:text-orange-400 transition-colors">
                Shot Quality
              </h3>
              <div className="mono text-xs text-orange-400 border border-orange-400/40 px-2 py-1 uppercase tracking-wider">
                xeFG Model
              </div>
            </div>
            <p className="text-text-dim leading-relaxed text-sm mb-4">
              Expected effective field goal analysis based on shot location and context.
              Explore team and player shooting efficiency across all D1 programs.
            </p>
            <div className="text-xs text-orange-400 group-hover:text-text transition-colors">
              Explore Shot Quality Hub →
            </div>
          </Link>

          {/* Team Analytics */}
          <Link
            href={withSeason('/teams', season)}
            className="group bg-surface hover:bg-surface-2 transition-colors p-6 border-l-4 border-purple-400"
          >
            <div className="flex items-start justify-between mb-4">
              <h3 className="display text-xl font-medium group-hover:text-purple-400 transition-colors">
                Team Analytics
              </h3>
              <div className="mono text-xs text-purple-400 border border-purple-400/40 px-2 py-1 uppercase tracking-wider">
                Database
              </div>
            </div>
            <p className="text-text-dim leading-relaxed text-sm mb-4">
              Complete team performance database with filtering by conference, record,
              and performance metrics across all D1 programs.
            </p>
            <div className="text-xs text-purple-400 group-hover:text-text transition-colors">
              Explore Team Database →
            </div>
          </Link>

          {/* Player Database */}
          <Link
            href={withSeason('/players', season)}
            className="group bg-surface hover:bg-surface-2 transition-colors p-6 border-l-4 border-pink-400"
          >
            <div className="flex items-start justify-between mb-4">
              <h3 className="display text-xl font-medium group-hover:text-pink-400 transition-colors">
                Player Database
              </h3>
              <div className="mono text-xs text-pink-400 border border-pink-400/40 px-2 py-1 uppercase tracking-wider">
                Searchable
              </div>
            </div>
            <p className="text-text-dim leading-relaxed text-sm mb-4">
              Search and filter all D1 players by stats, impact metrics, team, conference,
              and position. Sort by PPG, RAPM, eFG%, and more.
            </p>
            <div className="text-xs text-pink-400 group-hover:text-text transition-colors">
              Search Player Database →
            </div>
          </Link>
        </div>
      </section>

      {/* Quick Start for Friend */}
      <section className="mt-16 bg-surface-2 p-8 border border-border">
        <div className="max-w-4xl">
          <h3 className="display text-xl font-medium mb-4 text-accent">
            Quick Start Guide
          </h3>
          <p className="text-text-dim text-sm mb-6 leading-relaxed">
            New to the platform? Start with these working examples to see the analytical power:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="space-y-3">
              <div>
                <Link
                  href={withSeason('/teams/308', season)}
                  className="text-accent hover:text-text transition-colors font-medium"
                >
                  1. UCI Team Overview →
                </Link>
                <p className="text-text-dim text-xs mt-1">
                  Complete team profile with advanced metrics and shot analysis
                </p>
              </div>
              <div>
                <Link
                  href={withSeason('/teams/308/lineups', season)}
                  className="text-accent hover:text-text transition-colors font-medium"
                >
                  2. Interactive Lineup Builder →
                </Link>
                <p className="text-text-dim text-xs mt-1">
                  Project 5-man lineups using individual RAPM impact data
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <Link
                  href={withSeason('/players/4971', season)}
                  className="text-accent hover:text-text transition-colors font-medium"
                >
                  3. Sample Player Impact Report →
                </Link>
                <p className="text-text-dim text-xs mt-1">
                  ORAPM, DRAPM, and advanced individual impact metrics
                </p>
              </div>
              <div>
                <Link
                  href={withSeason('/teams/35/brief', season)}
                  className="text-accent hover:text-text transition-colors font-medium"
                >
                  4. AI Coach Brief →
                </Link>
                <p className="text-text-dim text-xs mt-1">
                  Comprehensive opponent analysis and tactical recommendations
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="mt-24 pt-8 border-t border-border text-text-dim text-xs flex justify-between">
        <span className="mono uppercase tracking-widest">SCOUT · v0.1</span>
        <span className="mono">Data: CBBD · React + Prisma</span>
      </footer>
    </main>
  );
}
