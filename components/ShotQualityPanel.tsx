import { formatDelta, formatRate } from '../lib/xefg';
import {
  interpretTeamDefenseContest,
  interpretTeamDefensePrevention,
  interpretTeamOffenseDelta,
  interpretXeFGDelta,
} from '../lib/xefg/interpret';
import type { XeFGAggregate } from '../lib/xefg';

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) {
    return <span className="mono text-sm text-text-dim">—</span>;
  }
  const pp = delta * 100;
  const positive = pp > 0;
  const negative = pp < 0;
  return (
    <span
      className={[
        'mono text-sm tabular-nums font-medium',
        positive ? 'text-made' : negative ? 'text-missed' : 'text-text-dim',
      ].join(' ')}
    >
      {formatDelta(delta)}
    </span>
  );
}

function MetricCell({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="p-4">
      <div className="stat-label">{label}</div>
      <div className="mono text-2xl tabular-nums mt-1 text-text">{value}</div>
      {hint && <div className="mono text-[10px] text-text-dim mt-1">{hint}</div>}
    </div>
  );
}

/** Team-level shot quality: offense + defense tiles. */
export function TeamShotQualityPanel({
  offense,
  defense,
}: {
  offense: XeFGAggregate | null;
  defense: XeFGAggregate | null;
}) {
  if (!offense && !defense) {
    return (
      <p className="text-sm text-text-dim p-4">
        xeFG not cached yet — run{' '}
        <code className="mono text-[11px]">npx tsx scripts/compute-xefg-cache.ts</code> after
        training the model.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border">
      {offense && (
        <div>
          <div className="px-4 py-2 border-b border-border mono text-[10px] uppercase tracking-widest text-text-dim">
            Offense
          </div>
          <div className="grid grid-cols-2 divide-x divide-border">
            <MetricCell
              label="Expected eFG%"
              value={formatRate(offense.expectedEfg)}
              hint="Shot quality generated on profile"
            />
            <MetricCell
              label="Actual eFG%"
              value={formatRate(offense.actualEfg)}
              hint={`${offense.sampleSize} FGA`}
            />
          </div>
          <div className="px-4 py-3 border-t border-border flex items-baseline justify-between gap-4">
            <span className="text-sm text-text-dim">
              {interpretTeamOffenseDelta(offense.delta, offense.sampleSize)}
            </span>
            <DeltaBadge delta={offense.delta} />
          </div>
        </div>
      )}
      {defense && (
        <div>
          <div className="px-4 py-2 border-b border-border mono text-[10px] uppercase tracking-widest text-text-dim">
            Defense
          </div>
          <div className="grid grid-cols-2 divide-x divide-border">
            <MetricCell
              label="Expected eFG% allowed"
              value={formatRate(defense.expectedEfg)}
              hint={interpretTeamDefensePrevention(defense.expectedEfg)}
            />
            <MetricCell
              label="Actual eFG% allowed"
              value={formatRate(defense.actualEfg)}
              hint={`${defense.sampleSize} opp FGA`}
            />
          </div>
          <div className="px-4 py-3 border-t border-border flex items-baseline justify-between gap-4">
            <span className="text-sm text-text-dim">
              {interpretTeamDefenseContest(defense.delta)}
            </span>
            <DeltaBadge delta={defense.delta} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Player report shot quality block. */
export function PlayerShotQualityPanel({ xefg }: { xefg: XeFGAggregate }) {
  return (
    <div className="bg-surface border border-border">
      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-border border-b border-border">
        <MetricCell label="Actual eFG%" value={formatRate(xefg.actualEfg)} />
        <MetricCell label="Expected eFG%" value={formatRate(xefg.expectedEfg)} />
        <MetricCell label="Delta" value={formatDelta(xefg.delta)} />
        <MetricCell label="FGA sample" value={String(xefg.sampleSize)} />
      </div>
      <p className="px-4 py-3 text-sm text-text border-b border-border">
        {interpretXeFGDelta(xefg.delta, xefg.sampleSize)}
      </p>
      <table className="w-full mono tabular-nums text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="stat-label py-2 px-4">Zone</th>
            <th className="stat-label py-2 px-4 text-right">FGA</th>
            <th className="stat-label py-2 px-4 text-right">Actual</th>
            <th className="stat-label py-2 px-4 text-right">Expected eFG%</th>
            <th className="stat-label py-2 px-4 text-right">Δ</th>
          </tr>
        </thead>
        <tbody>
          {(['rim', 'mid', 'three'] as const).map((z) => {
            const row = xefg.byZone[z];
            const label = z === 'rim' ? 'Rim' : z === 'mid' ? 'Mid' : '3PT';
            return (
              <tr key={z} className="border-b border-border last:border-b-0">
                <td className="py-2 px-4">{label}</td>
                <td className="py-2 px-4 text-right">{row.sampleSize}</td>
                <td className="py-2 px-4 text-right">{formatRate(row.actualEfg)}</td>
                <td className="py-2 px-4 text-right">{formatRate(row.expectedEfg)}</td>
                <td className="py-2 px-4 text-right">
                  <DeltaBadge delta={row.delta} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
