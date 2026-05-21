import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { Prisma } from '../../../../app/generated/prisma/client';
import { prisma } from '../../../../lib/prisma';
import { shotDistanceFt } from '../../../../components/Court';
import {
  buildMatchupData,
  runTacticalEngine,
  partitionFiredRules,
  PROXY_RULE_IDS,
  type FiredRule,
} from '../../../../lib/tactical-engine';

export const dynamic = 'force-dynamic';

const SEASON = 2025;
const UCI_TEAM_ID = 308;
/** Bump when brief payload/prompt shape changes (e.g. xeFG added). Stale caches are ignored. */
const CURRENT_PROMPT_VERSION = 2;

// Persistent cache lives in the CoachBriefCache table. Briefs only regenerate
// on explicit user action (?regenerate=1). The data is static right now —
// no TTL, no auto-revalidate. We can add stale-while-revalidate later.

// ============================================================================
// Types
// ============================================================================

type Zone = 'rim' | 'mid' | 'three';

type ThreatPlayer = {
  id: number;
  name: string;
  position: string | null;
  jersey: string | null;
  ppg: number;
  rpg: number;
  apg: number;
  fgPct: number | null;
  threePct: number | null;
  threeAtt: number;
  rimPct: number | null;
  actualEfg: number | null;
  expectedEfg: number | null;
  efgDeltaPp: number | null;
};

type TeamSnapshot = {
  name: string;
  record: string;
  ppg: number | null;
  oppPpg: number | null;
  pace: number | null;
  efgPct: number | null;
  tovPct: number | null;
  orebPct: number | null;
  ftr: number | null;
  ortg: number | null;
  drtg: number | null;
  defEfgPct: number | null;
  defTpaRate: number | null;
  defTpPct: number | null;
  defFtr: number | null;
  shotMix: { rim: number; mid: number; three: number };
  shotPct: { rim: number | null; mid: number | null; three: number | null };
  xefgOffense?: { actualEfg: string; expectedEfg: string; deltaPp: string } | null;
  xefgDefense?: { actualEfgAllowed: string; expectedEfgAllowed: string; contestDeltaPp: string } | null;
};

type MatchupDelta = {
  metric: string;
  uci: number | null;
  opp: number | null;
  edge: 'UCI' | 'OPP' | 'EVEN' | null;
};

type StatsPayload = {
  opponent: TeamSnapshot;
  uci: TeamSnapshot;
  topPlayers: ThreatPlayer[];
  matchupDeltas: MatchupDelta[];
};

type BriefSections = {
  executiveSummary: string;
  identity: string;
  topThreats: Array<{ player: string; playerId?: number; analysis: string }>;
  howToAttack: string[];
  /** Coach voice — what UCI does on defense. Renamed from howTheyAttackUs. */
  howToDefend: string[];
  threeKeys: string[];
  /** Raw engine output, surfaced for transparency / debugging. */
  firedRules: FiredRule[];
};

type UsageSummary = {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  perSection: Record<string, { inputTokens: number; outputTokens: number }>;
};

// ============================================================================
// Stat computation helpers
// ============================================================================

function pct(num: number, den: number): number | null {
  if (!den) return null;
  return num / den;
}

function classifyZone(range: string | null, rawX: number, rawY: number): Zone {
  if (range === 'three_pointer') return 'three';
  if (range === 'rim') return 'rim';
  const dist = shotDistanceFt(rawX, rawY);
  if (dist < 4) return 'rim';
  return 'mid';
}

async function buildTeamSnapshot(teamId: number, teamName: string): Promise<TeamSnapshot | null> {
  const stats = await prisma.teamSeasonStats.findUnique({
    where: { teamId_season: { teamId, season: SEASON } },
  });
  if (!stats) return null;

  const games = stats.games ?? 0;
  const wins = stats.wins ?? 0;
  const losses = stats.losses ?? 0;
  const fga = stats.fieldGoalsAttempted ?? 0;
  const fgm = stats.fieldGoalsMade ?? 0;
  const tpa = stats.threePointsAttempted ?? 0;
  const tpm = stats.threePointsMade ?? 0;
  const fta = stats.freeThrowsAttempted ?? 0;
  const oreb = stats.offensiveRebounds ?? 0;
  const to = stats.turnoversTotal ?? 0;
  const pointsTotal = stats.pointsTotal ?? 0;

  const ppg = games > 0 ? pointsTotal / games : null;

  const efg = fga > 0 ? (fgm + 0.5 * tpm) / fga : null;
  const ftr = fga > 0 ? fta / fga : null;
  const poss = fga + 0.44 * fta - oreb + to;
  const tovPct = poss > 0 ? to / poss : null;
  const ortg = poss > 0 ? (pointsTotal / poss) * 100 : null;
  const pace = games > 0 ? poss / games : null;

  // Defensive (opp-derived)
  const oppFga = stats.oppFieldGoalsAttempted ?? 0;
  const oppFgm = stats.oppFieldGoalsMade ?? 0;
  const oppTpa = stats.oppThreePointsAttempted ?? 0;
  const oppTpm = stats.oppThreePointsMade ?? 0;
  const oppFta = stats.oppFreeThrowsAttempted ?? 0;
  const oppDreb = stats.oppDefensiveRebounds ?? 0;
  const oppPoints = stats.oppPoints ?? 0;
  const oppPoss = stats.oppPossessions ?? 0;

  const orebPct = (oreb + oppDreb) > 0 ? oreb / (oreb + oppDreb) : null;
  const drtg = oppPoss > 0 ? (oppPoints / oppPoss) * 100 : null;
  const defEfg = oppFga > 0 ? (oppFgm + 0.5 * oppTpm) / oppFga : null;
  const defTpaRate = oppFga > 0 ? oppTpa / oppFga : null;
  const defTpPct = pct(oppTpm, oppTpa);
  const defFtr = oppFga > 0 ? oppFta / oppFga : null;

  // Opp PPG (from games)
  const ourGames = await prisma.game.findMany({
    where: {
      season: SEASON,
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
    },
    select: { id: true, homeTeamId: true, awayTeamId: true },
  });
  const gameIds = ourGames.map((g) => g.id);
  const gameScoreRows =
    gameIds.length > 0
      ? await prisma.play.groupBy({
          by: ['gameId'],
          where: { gameId: { in: gameIds } },
          _max: { homeScore: true, awayScore: true },
        })
      : [];
  const scoresByGame = new Map(
    gameScoreRows.map((r) => [r.gameId, { home: r._max.homeScore ?? 0, away: r._max.awayScore ?? 0 }]),
  );
  let oppPointsGames = 0;
  let gamesScored = 0;
  for (const g of ourGames) {
    const s = scoresByGame.get(g.id);
    if (!s) continue;
    const oppScore = g.homeTeamId === teamId ? s.away : s.home;
    if (oppScore > 0) {
      oppPointsGames += oppScore;
      gamesScored++;
    }
  }
  const oppPpg = gamesScored > 0 ? oppPointsGames / gamesScored : null;

  // Shot zones from plays
  const shotPlays = await prisma.play.findMany({
    where: {
      teamId,
      shotX: { not: null },
      shotY: { not: null },
      shotRange: { not: 'free_throw' },
      game: { season: SEASON },
    },
    select: { shotX: true, shotY: true, shotMade: true, shotRange: true },
  });
  const zones: Record<Zone, { att: number; made: number }> = {
    rim: { att: 0, made: 0 },
    mid: { att: 0, made: 0 },
    three: { att: 0, made: 0 },
  };
  for (const p of shotPlays) {
    const z = classifyZone(p.shotRange, p.shotX!, p.shotY!);
    zones[z].att++;
    if (p.shotMade) zones[z].made++;
  }
  const totalShots = shotPlays.length || 1;

  return {
    name: teamName,
    record: `${wins}-${losses}`,
    ppg: ppg !== null ? round(ppg, 1) : null,
    oppPpg: oppPpg !== null ? round(oppPpg, 1) : null,
    pace: pace !== null ? round(pace, 1) : null,
    efgPct: efg !== null ? round(efg, 3) : null,
    tovPct: tovPct !== null ? round(tovPct, 3) : null,
    orebPct: orebPct !== null ? round(orebPct, 3) : null,
    ftr: ftr !== null ? round(ftr, 3) : null,
    ortg: ortg !== null ? round(ortg, 1) : null,
    drtg: drtg !== null ? round(drtg, 1) : null,
    defEfgPct: defEfg !== null ? round(defEfg, 3) : null,
    defTpaRate: defTpaRate !== null ? round(defTpaRate, 3) : null,
    defTpPct: defTpPct !== null ? round(defTpPct, 3) : null,
    defFtr: defFtr !== null ? round(defFtr, 3) : null,
    shotMix: {
      rim: round(zones.rim.att / totalShots, 3),
      mid: round(zones.mid.att / totalShots, 3),
      three: round(zones.three.att / totalShots, 3),
    },
    shotPct: {
      rim: zones.rim.att > 0 ? round(zones.rim.made / zones.rim.att, 3) : null,
      mid: zones.mid.att > 0 ? round(zones.mid.made / zones.mid.att, 3) : null,
      three: zones.three.att > 0 ? round(zones.three.made / zones.three.att, 3) : null,
    },
  };
}

async function buildTopPlayers(teamId: number, limit = 8): Promise<ThreatPlayer[]> {
  const roster = await prisma.player.findMany({
    where: { teamId },
    include: { seasonStats: { where: { season: SEASON } } },
  });

  const withStats = roster
    .map((p) => ({ player: p, stats: p.seasonStats[0] ?? null }))
    .filter((r) => r.stats && (r.stats.games ?? 0) > 0)
    .sort((a, b) => (b.stats!.points ?? 0) - (a.stats!.points ?? 0))
    .slice(0, limit);

  // Per-player rim FG% from plays
  const playerIds = withStats.map((r) => r.player.id);
  const playerShots = playerIds.length > 0
    ? await prisma.play.findMany({
        where: {
          playerId: { in: playerIds },
          shotX: { not: null },
          shotY: { not: null },
          shotRange: { not: 'free_throw' },
          game: { season: SEASON },
        },
        select: { playerId: true, shotMade: true, shotRange: true, shotX: true, shotY: true },
      })
    : [];
  const rimByPlayer = new Map<number, { att: number; made: number }>();
  for (const s of playerShots) {
    const z = classifyZone(s.shotRange, s.shotX!, s.shotY!);
    if (z !== 'rim') continue;
    const r = rimByPlayer.get(s.playerId!) ?? { att: 0, made: 0 };
    r.att++;
    if (s.shotMade) r.made++;
    rimByPlayer.set(s.playerId!, r);
  }

  const xefgRows =
    playerIds.length > 0
      ? await prisma.playerXeFG.findMany({
          where: { playerId: { in: playerIds }, season: SEASON },
        })
      : [];
  const xefgByPlayer = new Map(xefgRows.map((x) => [x.playerId, x]));

  return withStats.map((r) => {
    const s = r.stats!;
    const g = s.games ?? 1;
    const rim = rimByPlayer.get(r.player.id);
    const xefg = xefgByPlayer.get(r.player.id);
    const deltaPp =
      xefg?.delta !== null && xefg?.delta !== undefined ? round(xefg.delta * 100, 1) : null;
    return {
      id: r.player.id,
      name: r.player.name ?? `${r.player.firstName} ${r.player.lastName}`,
      position: r.player.position ?? null,
      jersey: r.player.jersey ?? null,
      ppg: round((s.points ?? 0) / g, 1),
      rpg: round((s.rebounds ?? 0) / g, 1),
      apg: round((s.assists ?? 0) / g, 1),
      fgPct: roundN(pct(s.fieldGoalsMade ?? 0, s.fieldGoalsAttempted ?? 0), 3),
      threePct: roundN(pct(s.threePointsMade ?? 0, s.threePointsAttempted ?? 0), 3),
      threeAtt: s.threePointsAttempted ?? 0,
      rimPct: rim && rim.att > 0 ? round(rim.made / rim.att, 3) : null,
      actualEfg: xefg?.actualEfg ?? null,
      expectedEfg: xefg?.expectedEfg ?? null,
      efgDeltaPp: deltaPp,
    };
  });
}

async function attachTeamXeFG(teamId: number, snap: TeamSnapshot): Promise<TeamSnapshot> {
  const [off, def] = await Promise.all([
    prisma.teamXeFG.findUnique({
      where: { teamId_season_side: { teamId, season: SEASON, side: 'offense' } },
    }),
    prisma.teamXeFG.findUnique({
      where: { teamId_season_side: { teamId, season: SEASON, side: 'defense' } },
    }),
  ]);
  const fmtPp = (d: number | null) =>
    d === null ? 'N/A' : `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}pp`;
  return {
    ...snap,
    xefgOffense: off
      ? {
          actualEfg: formatPctData(off.actualEfg),
          expectedEfg: formatPctData(off.expectedEfg),
          deltaPp: fmtPp(off.delta),
        }
      : null,
    xefgDefense: def
      ? {
          actualEfgAllowed: formatPctData(def.actualEfg),
          expectedEfgAllowed: formatPctData(def.expectedEfg),
          contestDeltaPp: fmtPp(def.delta),
        }
      : null,
  };
}

function computeMatchupDeltas(uci: TeamSnapshot, opp: TeamSnapshot): MatchupDelta[] {
  return [
    delta('Pace', uci.pace, opp.pace, 'higher'),
    delta('Offensive eFG%', uci.efgPct, opp.efgPct, 'higher'),
    delta('Defensive eFG% allowed', uci.defEfgPct, opp.defEfgPct, 'lower'),
    delta('TOV%', uci.tovPct, opp.tovPct, 'lower'),
    delta('OREB%', uci.orebPct, opp.orebPct, 'higher'),
    delta('FTR', uci.ftr, opp.ftr, 'higher'),
    delta('3PT attempt rate', uci.shotMix.three, opp.shotMix.three, 'neither'),
    delta('Opp 3PT% allowed', uci.defTpPct, opp.defTpPct, 'lower'),
  ];
}

function delta(
  metric: string,
  uci: number | null,
  opp: number | null,
  betterIs: 'higher' | 'lower' | 'neither',
): MatchupDelta {
  let edge: 'UCI' | 'OPP' | 'EVEN' | null = null;
  if (uci !== null && opp !== null) {
    if (betterIs === 'neither' || Math.abs(uci - opp) < 0.005) edge = 'EVEN';
    else if (betterIs === 'higher') edge = uci > opp ? 'UCI' : 'OPP';
    else edge = uci < opp ? 'UCI' : 'OPP';
  }
  return { metric, uci, opp, edge };
}

function round(n: number, places: number): number {
  const m = Math.pow(10, places);
  return Math.round(n * m) / m;
}

function roundN(n: number | null, places: number): number | null {
  return n === null ? null : round(n, places);
}

// ============================================================================
// LLM section generation
// ============================================================================

const MODEL = 'claude-opus-4-7';

const SYSTEM_PROMPT = `You are a college basketball scout writing for a head coach. Be direct, specific, and concrete. Cite exact numbers from the data provided. Do not invent facts not present in the data. Write in the voice of a sharp analyst, not a recap reporter. When you cite a number, write it as it appears in the data — do not round, recompute, or estimate. NEVER write a percentage as a decimal (write "18.1%", never "0.181"). If a stat is null or missing, do not mention it.`;

type SectionResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
};

async function callClaude(
  client: Anthropic,
  userPrompt: string,
): Promise<SectionResult> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  const text = textBlock && textBlock.type === 'text' ? textBlock.text.trim() : '';

  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

function formatPctData(n: number | null): string {
  return n === null ? 'N/A' : `${(n * 100).toFixed(1)}%`;
}

function formatNumData(n: number | null): string {
  return n === null ? 'N/A' : n.toFixed(1);
}

async function generateExecutiveSummary(client: Anthropic, stats: StatsPayload): Promise<SectionResult> {
  const opp = stats.opponent;
  const data = {
    team: opp.name,
    record: opp.record,
    ppg: opp.ppg,
    opp_ppg: opp.oppPpg,
    pace: opp.pace,
    ortg: opp.ortg,
    drtg: opp.drtg,
    efg: formatPctData(opp.efgPct),
    def_efg: formatPctData(opp.defEfgPct),
    three_rate: formatPctData(opp.shotMix.three),
    rim_rate: formatPctData(opp.shotMix.rim),
  };
  const prompt = `Given these stats for ${opp.name}:\n${JSON.stringify(data, null, 2)}\n\nWrite a 2-3 sentence executive summary that captures who this team is. Cite exact numbers. No fluff.`;
  return callClaude(client, prompt);
}

async function generateIdentity(client: Anthropic, stats: StatsPayload): Promise<SectionResult> {
  const opp = stats.opponent;
  const data = {
    pace: opp.pace,
    ortg: opp.ortg,
    drtg: opp.drtg,
    offensive_efg: formatPctData(opp.efgPct),
    tov_pct: formatPctData(opp.tovPct),
    oreb_pct: formatPctData(opp.orebPct),
    ftr: formatPctData(opp.ftr),
    shot_mix_3pt: formatPctData(opp.shotMix.three),
    shot_mix_rim: formatPctData(opp.shotMix.rim),
    shot_mix_mid: formatPctData(opp.shotMix.mid),
    fg_pct_3pt: formatPctData(opp.shotPct.three),
    fg_pct_rim: formatPctData(opp.shotPct.rim),
    fg_pct_mid: formatPctData(opp.shotPct.mid),
    def_efg_allowed: formatPctData(opp.defEfgPct),
    def_3pt_allowed: formatPctData(opp.defTpPct),
    def_ftr_allowed: formatPctData(opp.defFtr),
  };
  const prompt = `Given these stats for ${opp.name}:\n${JSON.stringify(data, null, 2)}\n\nWrite 4-5 sentences identifying this team's identity: how they play offensively (pace, shot selection, efficiency), where they score (rim/mid/three), and what they defend (or fail to defend). Cite exact numbers. Avoid generic phrases.`;
  return callClaude(client, prompt);
}

async function generateTopThreats(
  client: Anthropic,
  stats: StatsPayload,
): Promise<{ result: SectionResult; threats: Array<{ player: string; analysis: string }> }> {
  const top3 = stats.topPlayers.slice(0, 3);
  const data = top3.map((p) => ({
    name: p.name,
    position: p.position,
    ppg: p.ppg,
    rpg: p.rpg,
    apg: p.apg,
    fg_pct: formatPctData(p.fgPct),
    three_pct: formatPctData(p.threePct),
    three_attempts: p.threeAtt,
    rim_fg_pct: formatPctData(p.rimPct),
    actual_efg: p.actualEfg !== null ? formatPctData(p.actualEfg) : 'N/A',
    expected_efg: p.expectedEfg !== null ? formatPctData(p.expectedEfg) : 'N/A',
    efg_delta_pp:
      p.efgDeltaPp !== null ? `${p.efgDeltaPp >= 0 ? '+' : ''}${p.efgDeltaPp}pp vs expected` : 'N/A',
  }));
  const prompt = `Given these top players for ${stats.opponent.name}:\n${JSON.stringify(data, null, 2)}\n\nFor EACH of the 3 players, write 1-2 sentences covering their role, key stat, and how UCI should handle them defensively. Cite exact numbers.\n\nTerminology (strict):\n- actual_efg and expected_efg are effective field goal percentage (eFG%), not raw FG% and not three_pct.\n- expected_efg is shot-quality eFG: each look is weighted by shot value (made threes count 1.5 in the eFG formula). It is NOT per-shot make probability.\n- efg_delta_pp = actual eFG minus expected eFG in percentage points. Positive = real shotmaker on his looks; negative = efficiency driven by shot selection more than finishing.\n- three_pct is a separate stat; never describe it as eFG or compare it to expected_efg.\n\nFormat your response as exactly 3 entries, each starting with the player name followed by a colon. Example:\n\nPlayer Name: Analysis text here.\n\nNext Player: Analysis text here.\n\nDo not include any other text, headers, or commentary.`;

  const result = await callClaude(client, prompt);
  const threats = parsePlayerThreats(result.text, top3);
  return { result, threats };
}

function parsePlayerThreats(
  text: string,
  players: ThreatPlayer[],
): Array<{ player: string; playerId: number; analysis: string }> {
  const lines = text.split(/\n\n+/).map((l) => l.trim()).filter(Boolean);
  const out: Array<{ player: string; playerId: number; analysis: string }> = [];
  for (const p of players) {
    const found = lines.find((l) =>
      l.toLowerCase().startsWith(p.name.toLowerCase() + ':') ||
      l.toLowerCase().startsWith(p.name.toLowerCase()),
    );
    if (found) {
      const idx = found.indexOf(':');
      out.push({
        player: p.name,
        playerId: p.id,
        analysis: idx > -1 ? found.slice(idx + 1).trim() : found,
      });
    } else {
      out.push({ player: p.name, playerId: p.id, analysis: '' });
    }
  }
  return out;
}

// Rule-driven prompt. Each fired rule is converted to one coach-voice bullet
// citing the numbers in its evidence. The LLM is explicitly told NOT to
// invent recommendations beyond the fired rule set.
function rulesForBrief(fired: FiredRule[]) {
  return fired.map((r) => {
    const baseId = r.id.split('::')[0];
    const payload: Record<string, unknown> = {
      id: r.id,
      title: r.title,
      category: r.category,
      priority: r.priority,
      recommendation: r.recommendation,
      evidence: r.evidence,
    };
    if (r.playerName) payload.playerName = r.playerName;
    if (PROXY_RULE_IDS.has(baseId)) {
      payload.stat_note =
        'player_share_of_FGA is share of team field goal attempts, NOT possession usage rate. Say "share of shots" or "touches" — never "usage".';
    }
    return payload;
  });
}

function tacticalPrompt(opponentName: string, side: 'attack' | 'defend', fired: FiredRule[]): string {
  const direction =
    side === 'attack'
      ? `HOW UCI CAN ATTACK ${opponentName} — what UCI does on offense.`
      : `HOW UCI SHOULD DEFEND ${opponentName} — what UCI does on defense.`;
  const voiceRule =
    side === 'attack'
      ? `Every bullet is something UCI's OFFENSE does (push tempo, attack the paint, hunt threes). Do NOT describe what ${opponentName} does on offense.`
      : `Every bullet is something UCI's DEFENSE does (switch, top-lock, ICE, box out, trap). Do NOT describe what ${opponentName} will do on offense — only UCI's defensive response.`;
  return `UCI is preparing to play ${opponentName}.

Our tactical engine fired these recommendations (already grounded in the season data):

${JSON.stringify(rulesForBrief(fired), null, 2)}

${direction}

${voiceRule}

Write EXACTLY ${fired.length} bullet points, one per fired rule, IN THE SAME ORDER as the JSON above. Each bullet is a one-sentence coach-voice version of that rule's recommendation, citing only the numbers in its 'evidence' field (honor any stat_note). Lead with a verb addressed to UCI's players or coaching staff. Do NOT add a rule that wasn't fired. Do NOT mention multiple rules in one bullet. Do NOT drop any rule. Do NOT invent stats.

Start each bullet with "- " on its own line. No preamble.`;
}

async function generateHowToAttack(
  client: Anthropic,
  stats: StatsPayload,
  fired: FiredRule[],
): Promise<SectionResult> {
  if (fired.length === 0) {
    return {
      text: '- No high-confidence offensive edges identified from current data — focus on execution of base sets.',
      inputTokens: 0,
      outputTokens: 0,
    };
  }
  return callClaude(client, tacticalPrompt(stats.opponent.name, 'attack', fired));
}

async function generateHowTheyAttackUs(
  client: Anthropic,
  stats: StatsPayload,
  fired: FiredRule[],
): Promise<SectionResult> {
  if (fired.length === 0) {
    return {
      text: '- No standout defensive priorities from current data — stick to base defensive principles.',
      inputTokens: 0,
      outputTokens: 0,
    };
  }
  return callClaude(client, tacticalPrompt(stats.opponent.name, 'defend', fired));
}

/**
 * Format raw matchup deltas (which carry decimal pcts like 0.181) into
 * display strings before sending to the LLM. Without this, Claude echoes
 * "0.181 TOV%" verbatim into the brief instead of "18.1%".
 */
function formatMatchupDeltasForLLM(deltas: MatchupDelta[]): Array<Record<string, unknown>> {
  // metrics expressed as fractions in our pipeline:
  const pctMetrics = new Set([
    'Offensive eFG%',
    'Defensive eFG% allowed',
    'TOV%',
    'OREB%',
    'FTR',
    '3PT attempt rate',
    'Opp 3PT% allowed',
  ]);
  return deltas.map((d) => {
    const isPct = pctMetrics.has(d.metric);
    return {
      metric: d.metric,
      uci: isPct ? formatPctData(d.uci) : formatNumData(d.uci),
      opp: isPct ? formatPctData(d.opp) : formatNumData(d.opp),
      edge: d.edge,
    };
  });
}

async function generateThreeKeys(client: Anthropic, stats: StatsPayload): Promise<SectionResult> {
  const data = {
    opponent: stats.opponent.name,
    matchup_deltas: formatMatchupDeltasForLLM(stats.matchupDeltas),
    opp_top_player: stats.topPlayers[0]?.name ?? null,
    opp_top_player_ppg: stats.topPlayers[0]?.ppg ?? null,
  };
  const prompt = `Given this UCI vs ${stats.opponent.name} matchup data:\n${JSON.stringify(data, null, 2)}\n\nWrite EXACTLY 3 game-plan keys for UCI, numbered "1.", "2.", "3.". One sentence each. Each key must reference a specific stat or player from the data. Cite stats EXACTLY as they appear (e.g. "18.1%", not "0.181"). Start each line with the number. No preamble.`;
  return callClaude(client, prompt);
}

// ============================================================================
// Route handler
// ============================================================================

function parseBulletList(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => l.replace(/^[-*•]\s*/, '').replace(/^\d+[.)]\s*/, '').trim())
    .filter((l) => l.length > 0);
}

function computeCost(input: number, output: number): number {
  // Opus 4.7 pricing: $5/MTok input, $25/MTok output
  return (input / 1_000_000) * 5 + (output / 1_000_000) * 25;
}

async function loadCached(teamId: number) {
  return prisma.coachBriefCache.findUnique({
    where: {
      subjectTeamId_opponentTeamId_season: {
        subjectTeamId: UCI_TEAM_ID,
        opponentTeamId: teamId,
        season: SEASON,
      },
    },
  });
}

async function generateAndStore(teamId: number): Promise<NextResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  const opponentTeam = await prisma.team.findUnique({ where: { id: teamId } });
  const uciTeam = await prisma.team.findUnique({ where: { id: UCI_TEAM_ID } });
  if (!opponentTeam || !uciTeam) {
    return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  }

  const [opponentRaw, uciRaw, topPlayers] = await Promise.all([
    buildTeamSnapshot(teamId, opponentTeam.school),
    buildTeamSnapshot(UCI_TEAM_ID, uciTeam.school),
    buildTopPlayers(teamId, 8),
  ]);
  if (!opponentRaw || !uciRaw) {
    return NextResponse.json({ error: 'Missing team stats' }, { status: 404 });
  }

  const [opponent, uci] = await Promise.all([
    attachTeamXeFG(teamId, opponentRaw),
    attachTeamXeFG(UCI_TEAM_ID, uciRaw),
  ]);

  const stats: StatsPayload = {
    opponent,
    uci,
    topPlayers,
    matchupDeltas: computeMatchupDeltas(uci, opponent),
  };

  const matchup = await buildMatchupData(UCI_TEAM_ID, teamId, SEASON);
  const firedAll = matchup ? runTacticalEngine(matchup, { maxResults: 8 }) : [];
  const { attack: attackRules, defend: defendRules } = partitionFiredRules(firedAll);

  const client = new Anthropic({ apiKey });
  const [summary, identity, threats, attack, defense, keys] = await Promise.all([
    generateExecutiveSummary(client, stats),
    generateIdentity(client, stats),
    generateTopThreats(client, stats),
    generateHowToAttack(client, stats, attackRules),
    generateHowTheyAttackUs(client, stats, defendRules),
    generateThreeKeys(client, stats),
  ]);

  const brief: BriefSections = {
    executiveSummary: summary.text || 'Brief unavailable — try regenerate',
    identity: identity.text || 'Brief unavailable — try regenerate',
    topThreats:
      threats.threats.length > 0
        ? threats.threats
        : [{ player: '', playerId: 0, analysis: 'Brief unavailable — try regenerate' }],
    howToAttack: parseBulletList(attack.text),
    howToDefend: parseBulletList(defense.text),
    threeKeys: parseBulletList(keys.text).slice(0, 3),
    firedRules: firedAll,
  };

  const totalIn =
    summary.inputTokens + identity.inputTokens + threats.result.inputTokens +
    attack.inputTokens + defense.inputTokens + keys.inputTokens;
  const totalOut =
    summary.outputTokens + identity.outputTokens + threats.result.outputTokens +
    attack.outputTokens + defense.outputTokens + keys.outputTokens;
  const usage: UsageSummary = {
    totalInputTokens: totalIn,
    totalOutputTokens: totalOut,
    totalCost: computeCost(totalIn, totalOut),
    perSection: {
      executiveSummary: { inputTokens: summary.inputTokens, outputTokens: summary.outputTokens },
      identity: { inputTokens: identity.inputTokens, outputTokens: identity.outputTokens },
      topThreats: { inputTokens: threats.result.inputTokens, outputTokens: threats.result.outputTokens },
      howToAttack: { inputTokens: attack.inputTokens, outputTokens: attack.outputTokens },
      howToDefend: { inputTokens: defense.inputTokens, outputTokens: defense.outputTokens },
      threeKeys: { inputTokens: keys.inputTokens, outputTokens: keys.outputTokens },
    },
  };

  const stored = await prisma.coachBriefCache.upsert({
    where: {
      subjectTeamId_opponentTeamId_season: {
        subjectTeamId: UCI_TEAM_ID,
        opponentTeamId: teamId,
        season: SEASON,
      },
    },
    create: {
      subjectTeamId: UCI_TEAM_ID,
      opponentTeamId: teamId,
      season: SEASON,
      brief: brief as unknown as Prisma.InputJsonValue,
      firedRules: firedAll as unknown as Prisma.InputJsonValue,
      stats: stats as unknown as Prisma.InputJsonValue,
      model: MODEL,
      inputTokens: totalIn,
      outputTokens: totalOut,
      costUsd: usage.totalCost,
      promptVersion: CURRENT_PROMPT_VERSION,
    },
    update: {
      brief: brief as unknown as Prisma.InputJsonValue,
      firedRules: firedAll as unknown as Prisma.InputJsonValue,
      stats: stats as unknown as Prisma.InputJsonValue,
      model: MODEL,
      inputTokens: totalIn,
      outputTokens: totalOut,
      costUsd: usage.totalCost,
      promptVersion: CURRENT_PROMPT_VERSION,
      generatedAt: new Date(),
    },
  });

  return NextResponse.json({
    brief,
    stats,
    usage,
    cached: false,
    generatedAt: stored.generatedAt.toISOString(),
    updatedAt: stored.updatedAt.toISOString(),
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId: teamIdStr } = await params;
  const teamId = parseInt(teamIdStr, 10);
  if (Number.isNaN(teamId)) {
    return NextResponse.json({ error: 'Invalid teamId' }, { status: 400 });
  }
  if (teamId === UCI_TEAM_ID) {
    return NextResponse.json({ error: 'Brief is for opponents only' }, { status: 400 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get('regenerate') === '1';

  if (!force) {
    const row = await loadCached(teamId);
    if (row && (row.promptVersion ?? 1) >= CURRENT_PROMPT_VERSION) {
      return NextResponse.json({
        brief: row.brief,
        stats: row.stats,
        usage: {
          totalInputTokens: row.inputTokens ?? 0,
          totalOutputTokens: row.outputTokens ?? 0,
          totalCost: row.costUsd ?? 0,
        },
        cached: true,
        generatedAt: row.generatedAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      });
    }
    // No cache yet — fall through and generate once.
  }

  try {
    return await generateAndStore(teamId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Coach brief generation failed:', err);
    return NextResponse.json({ error: `Brief generation failed: ${message}` }, { status: 500 });
  }
}

/** Explicit regenerate via POST — keeps `?regenerate=1` for parity. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId: teamIdStr } = await params;
  const teamId = parseInt(teamIdStr, 10);
  if (Number.isNaN(teamId)) {
    return NextResponse.json({ error: 'Invalid teamId' }, { status: 400 });
  }
  if (teamId === UCI_TEAM_ID) {
    return NextResponse.json({ error: 'Brief is for opponents only' }, { status: 400 });
  }
  try {
    return await generateAndStore(teamId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Coach brief regeneration failed:', err);
    return NextResponse.json({ error: `Brief generation failed: ${message}` }, { status: 500 });
  }
}
