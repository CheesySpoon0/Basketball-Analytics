// ============================================================================
// Read precomputed xeFG aggregates from PlayerXeFG / TeamXeFG tables.
// Populated by scripts/compute-xefg-cache.ts after model training.
// ============================================================================
import { prisma } from '../prisma';
import type { XeFGAggregate, ZoneAggregate } from './types';

function rowToAggregate(row: {
  sampleSize: number;
  fgPct: number | null;
  actualEfg: number | null;
  expectedEfg: number | null;
  delta: number | null;
  byZone: unknown;
}): XeFGAggregate {
  const byZone = row.byZone as Record<'rim' | 'mid' | 'three', ZoneAggregate>;
  return {
    sampleSize: row.sampleSize,
    fgPct: row.fgPct,
    actualEfg: row.actualEfg,
    expectedEfg: row.expectedEfg,
    delta: row.delta,
    byZone: byZone ?? {
      rim: { sampleSize: 0, fgPct: null, actualEfg: null, expectedEfg: null, delta: null },
      mid: { sampleSize: 0, fgPct: null, actualEfg: null, expectedEfg: null, delta: null },
      three: { sampleSize: 0, fgPct: null, actualEfg: null, expectedEfg: null, delta: null },
    },
  };
}

export async function getPlayerXeFGCached(
  playerId: number,
  season: number,
): Promise<XeFGAggregate | null> {
  const row = await prisma.playerXeFG.findUnique({
    where: { playerId_season: { playerId, season } },
  });
  if (!row || row.sampleSize === 0) return null;
  return rowToAggregate(row);
}

export async function getTeamXeFGCached(
  teamId: number,
  season: number,
  side: 'offense' | 'defense',
): Promise<XeFGAggregate | null> {
  const row = await prisma.teamXeFG.findUnique({
    where: { teamId_season_side: { teamId, season, side } },
  });
  if (!row || row.sampleSize === 0) return null;
  return rowToAggregate(row);
}
