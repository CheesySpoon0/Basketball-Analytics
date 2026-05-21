'use client';

import * as React from 'react';

type Brief = {
  executiveSummary: string;
  identity: string;
  topThreats: Array<{ player: string; playerId?: number; analysis: string }>;
  howToAttack: string[];
  /** Renamed from howTheyAttackUs — coach voice for UCI's defense. */
  howToDefend: string[];
  /** Legacy field name still present in some old cached briefs. */
  howTheyAttackUs?: string[];
  threeKeys: string[];
};

type Usage = {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
};

type ApiResponse = {
  brief: Brief;
  stats: unknown;
  usage: Usage;
  cached: boolean;
  generatedAt?: string;
  updatedAt?: string;
  /** Legacy field. */
  cachedAt?: string;
  error?: string;
};

// Format inline numbers (anything that looks like a stat) with mono styling.
// Catches: 27.6%, 1.05, 96.4, 12-9, $5.00, 35.2 PPG, +4.2
function MonoNumbers({ text }: { text: string }) {
  if (!text) return null;
  const parts = text.split(/(\d+\.?\d*%?|\d+-\d+|\$\d+\.?\d*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (/^\d/.test(part) || /^\$\d/.test(part)) {
          return (
            <span key={i} className="mono tabular-nums text-text">
              {part}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/**
 * CoachBriefView — load-or-generate semantics:
 *   - On mount we GET the cached brief. The route only calls Claude if no
 *     cache row exists (first visit) — otherwise it returns the stored copy.
 *   - The "Update Brief" button explicitly POSTs (regenerate) which calls
 *     Claude and writes a new row.
 *   - A page refresh costs ZERO API calls once a brief is cached.
 */
export function CoachBriefView({
  teamId,
  opponentName,
}: {
  teamId: number;
  opponentName: string;
}) {
  const [data, setData] = React.useState<ApiResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [regenerating, setRegenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  /** Read existing cached brief; generates only if no cache yet. */
  const loadBrief = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/coach-brief/${teamId}`, { cache: 'no-store' });
      const json = (await res.json()) as ApiResponse;
      if (!res.ok || json.error) {
        throw new Error(json.error ?? `Request failed (${res.status})`);
      }
      setData(json);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  /** Force regenerate. Costs API credits — only fires on button click. */
  const regenerateBrief = React.useCallback(async () => {
    setRegenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/coach-brief/${teamId}`, {
        method: 'POST',
        cache: 'no-store',
      });
      const json = (await res.json()) as ApiResponse;
      if (!res.ok || json.error) {
        throw new Error(json.error ?? `Request failed (${res.status})`);
      }
      setData(json);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
    } finally {
      setRegenerating(false);
    }
  }, [teamId]);

  React.useEffect(() => {
    loadBrief();
  }, [loadBrief]);

  if (loading && !data) {
    return (
      <div className="py-20 text-center">
        <div className="mono text-[11px] uppercase tracking-[0.25em] text-text-dim animate-pulse">
          Loading scouting brief…
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="bg-surface border border-border p-6">
        <div className="display text-lg font-medium mb-2">Brief unavailable</div>
        <div className="text-text-dim text-sm mb-4">{error}</div>
        <button
          onClick={regenerateBrief}
          disabled={regenerating}
          className="mono text-[11px] uppercase tracking-widest px-4 py-2 border border-border hover:bg-surface-2 transition-colors disabled:opacity-50"
        >
          {regenerating ? 'Generating…' : 'Generate brief'}
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { brief, usage, cached } = data;
  const lastUpdated = data.updatedAt ?? data.generatedAt ?? data.cachedAt ?? null;
  // Backward-compat: legacy cache rows used `howTheyAttackUs`.
  const defendBullets = brief.howToDefend ?? brief.howTheyAttackUs ?? [];

  return (
    <div className="space-y-12">
      {/* Top bar: cache metadata + explicit regenerate */}
      <div className="flex flex-wrap items-center justify-between gap-3 mono text-[10px] uppercase tracking-widest text-text-dim">
        <div className="flex items-center gap-3 flex-wrap">
          <span>
            Last updated:{' '}
            {lastUpdated
              ? new Date(lastUpdated).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })
              : '—'}
          </span>
          <span className="opacity-60">·</span>
          <span>{cached ? 'Cached' : 'Fresh'}</span>
          <span className="opacity-60">·</span>
          <span>
            {usage.totalInputTokens.toLocaleString()} in /{' '}
            {usage.totalOutputTokens.toLocaleString()} out
          </span>
          <span className="opacity-60">·</span>
          <span>${usage.totalCost.toFixed(4)}</span>
        </div>
        <button
          onClick={regenerateBrief}
          disabled={regenerating}
          className="px-3 py-1.5 border border-border hover:bg-surface-2 transition-colors disabled:opacity-50"
          title="Calls Claude and writes a new cached brief. Normal page loads do NOT regenerate."
        >
          {regenerating ? 'Updating…' : 'Update brief'}
        </button>
      </div>

      {/* Executive Summary */}
      <section>
        <h2 className="display text-2xl font-medium mb-4 pb-2 border-b border-border">
          Executive Summary
        </h2>
        <p className="text-lg leading-relaxed text-text">
          <MonoNumbers text={brief.executiveSummary} />
        </p>
      </section>

      {/* Identity */}
      <section>
        <h2 className="display text-2xl font-medium mb-4 pb-2 border-b border-border">
          Team Identity
        </h2>
        <p className="text-base leading-relaxed text-text">
          <MonoNumbers text={brief.identity} />
        </p>
      </section>

      {/* Top Threats */}
      <section>
        <h2 className="display text-2xl font-medium mb-4 pb-2 border-b border-border">
          Top Threats
        </h2>
        <div className="space-y-5">
          {brief.topThreats.map((threat, i) => {
            const heading = (
              <div className="display text-lg font-medium mb-1.5 flex items-baseline gap-3">
                <span className="mono text-[11px] text-text-dim tabular-nums">
                  0{i + 1}
                </span>
                <span>{threat.player}</span>
              </div>
            );
            return (
              <div key={i} className="border-l-2 border-accent pl-4">
                {threat.playerId ? (
                  <a
                    href={`/players/${threat.playerId}/report`}
                    className="hover:underline decoration-text-dim"
                  >
                    {heading}
                  </a>
                ) : (
                  heading
                )}
                <p className="text-text leading-relaxed">
                  <MonoNumbers text={threat.analysis} />
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* How to Attack */}
      <section>
        <h2 className="display text-2xl font-medium mb-4 pb-2 border-b border-border">
          How UCI Can Attack
        </h2>
        <ul className="space-y-3">
          {brief.howToAttack.map((bullet, i) => (
            <li key={i} className="flex gap-3 items-start">
              <span className="mono text-[11px] text-made tabular-nums mt-1.5 shrink-0">
                →
              </span>
              <span className="text-text leading-relaxed">
                <MonoNumbers text={bullet} />
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* How UCI Should Defend */}
      <section>
        <h2 className="display text-2xl font-medium mb-4 pb-2 border-b border-border">
          How UCI Should Defend
        </h2>
        <ul className="space-y-3">
          {defendBullets.map((bullet, i) => (
            <li key={i} className="flex gap-3 items-start">
              <span className="mono text-[11px] text-missed tabular-nums mt-1.5 shrink-0">
                ←
              </span>
              <span className="text-text leading-relaxed">
                <MonoNumbers text={bullet} />
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Three Keys */}
      <section>
        <h2 className="display text-2xl font-medium mb-4 pb-2 border-b border-border">
          Three Keys to the Game
        </h2>
        <ol className="space-y-4">
          {brief.threeKeys.map((key, i) => (
            <li key={i} className="flex gap-4 items-start">
              <span className="mono text-3xl tabular-nums text-accent leading-none">
                {i + 1}
              </span>
              <span className="text-text leading-relaxed pt-1">
                <MonoNumbers text={key} />
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* Footer */}
      <footer className="pt-6 border-t border-border mono text-[10px] uppercase tracking-widest text-text-dim">
        Generated by Claude Opus 4.7 · Grounded in season stats and matchup data
      </footer>
    </div>
  );
}
