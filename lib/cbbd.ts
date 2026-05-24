const BASE_URL = 'https://api.collegebasketballdata.com';

export interface CbbdTeam {
  id: number;
  sourceId: string;
  school: string;
  mascot: string | null;
  abbreviation: string | null;
  displayName: string;
  shortDisplayName: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  currentVenueId: number | null;
  currentVenue: string | null;
  currentCity: string | null;
  currentState: string | null;
  conferenceId: number | null;
  conference: string | null;
}

function authHeaders(): HeadersInit {
  const key = process.env.CBBD_API_KEY;
  if (!key) throw new Error('CBBD_API_KEY is not set');
  return { Authorization: `Bearer ${key}` };
}

export async function getTeams(opts: { conference?: string; year?: number } = {}): Promise<CbbdTeam[]> {
  const params = new URLSearchParams();
  if (opts.conference) params.set('conference', opts.conference);
  if (opts.year) params.set('year', String(opts.year));
  const url = `${BASE_URL}/teams${params.toString() ? `?${params}` : ''}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`CBBD /teams failed: ${res.status} ${res.statusText}`);
  return res.json();
}

export interface CbbdPlayer {
  id: number;
  sourceId?: string;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  position: string | null;
  height: number | null;
  weight: number | null;
  jersey: string | null;
  teamId?: number;
}

export async function getPlayers(teamId: number, season: number): Promise<CbbdPlayer[]> {
  const url = `${BASE_URL}/teams/roster?teamId=${teamId}&season=${season}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`CBBD /teams/roster failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  const teamData = Array.isArray(data) ? data.find((team: unknown) => (team as { teamId: number }).teamId === teamId) : data;
  return teamData?.players || [];
}

// Fetch all D1 rosters for a season in a single call. Returns array of {teamId, players: [...]}
export async function getAllRosters(season: number): Promise<Array<{ teamId: number; team: string; players: CbbdPlayer[] }>> {
  const url = `${BASE_URL}/teams/roster?season=${season}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`CBBD /teams/roster (all) failed: ${res.status} ${res.statusText}`);
  return res.json();
}

export interface CbbdGameTeam {
  gameId: number;
  season: number;
  seasonLabel: string;
  seasonType: string;
  startDate: string;
  teamId: number;
  team: string;
  conference: string;
  opponentId: number;
  opponent: string;
  opponentConference: string | null;
  neutralSite: boolean;
  isHome: boolean;
  conferenceGame: boolean;
  // Add team stats that come with this endpoint
  teamStats?: any;
}

export async function getTeamGames(teamId: number, season: number): Promise<CbbdGameTeam[]> {
  const url = `${BASE_URL}/games/teams?season=${season}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`CBBD /games/teams failed: ${res.status} ${res.statusText}`);
  const allGames = await res.json();
  // Filter to only games for our team
  return allGames.filter((game: any) => game.teamId === teamId);
}

export interface CbbdPlayerGame {
  gameId: number;
  season: number;
  athleteId: number;
  name: string;
  teamId: number;
  team: string;
  opponentId: number;
  opponent: string;
  // Game stats for this player
  stats?: any;
}

export async function getPlayerGames(teamId: number, season: number): Promise<CbbdPlayerGame[]> {
  const url = `${BASE_URL}/games/players?season=${season}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`CBBD /games/players failed: ${res.status} ${res.statusText}`);
  const allPlayerGames = await res.json();
  // Filter to only our team's players
  return allPlayerGames.filter((game: any) => game.teamId === teamId);
}

export interface CbbdTeamStats {
  teamId: number;
  team: string;
  conference: string;
  season: number;
  games: number;
  wins: number;
  losses: number;
  teamStats: {
    assists: number;
    blocks: number;
    steals: number;
    turnovers: number;
    fouls: number;
    fieldGoalsMade: number;
    fieldGoalsAttempted: number;
    threePointsMade: number;
    threePointsAttempted: number;
    freeThrowsMade: number;
    freeThrowsAttempted: number;
    offensiveRebounds: number;
    defensiveRebounds: number;
    totalRebounds: number;
    points: number;
    // many more fields...
  };
}

export async function getTeamStats(teamId: number, season: number): Promise<CbbdTeamStats | null> {
  const url = `${BASE_URL}/stats/team/season?season=${season}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`CBBD /stats/team/season failed: ${res.status} ${res.statusText}`);
  }
  const allTeamStats = await res.json();
  // Filter to our specific team
  return allTeamStats.find((stats: any) => stats.teamId === teamId) || null;
}

export interface CbbdPlayerStats {
  athleteId: number;
  name: string;
  teamId: number;
  team: string;
  conference: string;
  season: number;
  games: number;
  started: number;
  playerStats: {
    assists: number;
    blocks: number;
    steals: number;
    turnovers: number;
    fouls: number;
    fieldGoalsMade: number;
    fieldGoalsAttempted: number;
    threePointsMade: number;
    threePointsAttempted: number;
    freeThrowsMade: number;
    freeThrowsAttempted: number;
    offensiveRebounds: number;
    defensiveRebounds: number;
    totalRebounds: number;
    points: number;
    // many more fields...
  };
}

export async function getPlayerStats(teamId: number, season: number): Promise<CbbdPlayerStats[]> {
  const url = `${BASE_URL}/stats/player/season?season=${season}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`CBBD /stats/player/season failed: ${res.status} ${res.statusText}`);
  const allPlayerStats = await res.json();
  // Filter to our team's players
  return allPlayerStats.filter((stats: any) => stats.teamId === teamId);
}

export interface CbbdPlay {
  gameId: number;
  gameSourceId: string;
  id: number;
  sourceId: string;
  playType: string;
  isHomeTeam: boolean;
  teamId: number;
  team: string;
  conference: string;
  opponentId: number;
  opponent: string;
  homeScore: number;
  awayScore: number;
  period: number;
  clock: string;
  secondsRemaining: number;
  scoringPlay: boolean;
  shootingPlay: boolean;
  scoreValue?: number;
  playText: string;
  participants: Array<{ id: number; name: string }>;
  shotInfo?: {
    shooter: { id: number; name: string };
    made: boolean;
    range: string;
    assisted: boolean;
    assistedBy?: { id: number; name: string };
    location: { x: number; y: number };
  };
  onFloor: Array<{ id: number; name: string; team: string }>;
}

export async function getPlays(gameId: number, shootingOnly: boolean = false): Promise<CbbdPlay[]> {
  const params = new URLSearchParams();
  if (shootingOnly) params.set('shootingPlaysOnly', 'true');
  const url = `${BASE_URL}/plays/game/${gameId}${params.toString() ? `?${params}` : ''}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`CBBD /plays/game failed: ${res.status} ${res.statusText}`);
  return res.json();
}

export async function getTeamPlays(team: string, season: number, shootingOnly: boolean = false): Promise<CbbdPlay[]> {
  const params = new URLSearchParams();
  params.set('season', String(season));
  params.set('team', team);
  if (shootingOnly) params.set('shootingPlaysOnly', 'true');
  const url = `${BASE_URL}/plays/team?${params}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`CBBD /plays/team failed: ${res.status} ${res.statusText}`);
  return res.json();
}