'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SEASONS, DEFAULT_SEASON, seasonLabel } from '../lib/season';

/**
 * Season switcher. Rewrites `?season=` on the current path and preserves any
 * other query params. The default season is rendered without the param to keep
 * canonical URLs clean.
 */
export function SeasonSelector({ season }: { season: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function select(next: number) {
    if (next === season) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === DEFAULT_SEASON) params.delete('season');
    else params.set('season', String(next));
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div
      className="inline-flex border border-border"
      role="group"
      aria-label="Season"
    >
      {SEASONS.map((s) => {
        const active = s === season;
        return (
          <button
            key={s}
            type="button"
            onClick={() => select(s)}
            aria-pressed={active}
            className={[
              'mono text-[11px] uppercase tracking-widest px-3 py-1.5 transition-colors',
              active
                ? 'bg-accent text-bg'
                : 'text-text-dim hover:text-text hover:bg-surface-2',
            ].join(' ')}
          >
            {seasonLabel(s)}
          </button>
        );
      })}
    </div>
  );
}
