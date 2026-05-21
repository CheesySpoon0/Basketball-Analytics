// ============================================================================
// Central season configuration.
//
// Every page, API route, report builder, and xeFG/cache lookup resolves the
// active season through this module — there are no hardcoded season constants
// elsewhere. Seasons NEVER blend: one resolved season drives every query on a
// page render.
//
// A "season" here is the END year of the academic season, matching the `season`
// column on the games table (2025 = the 2024-25 season).
// ============================================================================

/** Seasons with data ingested, newest first. Add a year here once ingested. */
export const SEASONS = [2026, 2025] as const;

export type Season = (typeof SEASONS)[number];

/** Default season when no `?season=` param is present. Newest ingested season. */
export const DEFAULT_SEASON: Season = SEASONS[0];

export function isValidSeason(value: number): value is Season {
  return (SEASONS as readonly number[]).includes(value);
}

/**
 * Resolve a season from a Next.js searchParams object. Falls back to
 * DEFAULT_SEASON for a missing, malformed, or un-ingested value — never throws,
 * so a bad URL degrades gracefully instead of 500ing.
 */
export function resolveSeason(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): Season {
  const raw = searchParams?.season;
  const str = Array.isArray(raw) ? raw[0] : raw;
  if (!str) return DEFAULT_SEASON;
  const num = parseInt(str, 10);
  return isValidSeason(num) ? num : DEFAULT_SEASON;
}

/** Display label for a season, e.g. 2025 -> "2024-25". */
export function seasonLabel(season: number): string {
  return `${season - 1}-${String(season).slice(2)}`;
}

/**
 * Append `?season=` to a path, omitting it for the default season to keep
 * canonical URLs clean. Preserves an existing query string.
 */
export function withSeason(path: string, season: number): string {
  if (season === DEFAULT_SEASON) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}season=${season}`;
}
