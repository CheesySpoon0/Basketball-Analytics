// ============================================================================
// Shot-quality-aware scouting rules.
//
// These rules consume the TendencyProfile (which carries per-zone xeFG actual
// vs expected) and produce guarding / live_with / deny notes that cite a
// player's own numbers. They complement the volume-based rules in rules.ts.
//
// Design goal: notes read DIFFERENTLY per player because the evidence is the
// player's own zone deltas, shares, and efficiency — not a fixed template.
// ============================================================================
import type { PlayerNote } from './types';
import type { TendencyProfile } from './tendencies';
import type { Archetype } from './archetype';

export interface XeFGRuleInput {
  name: string;
  archetype: Archetype;
  tend: TendencyProfile;
  threePct: number | null;
  threeAttempts: number;
  efgPct: number | null;
  ftr: number | null;
  ppg: number;
  rpg: number;
  topg: number;
  apg: number;
  astToTov: number | null;
  shareOfTeamFga: number | null;
  /** When true, rules soften wording and weak-evidence rules are dropped. */
  soften: boolean;
}

const pct = (x: number | null, d = 1) => (x === null ? '—' : `${(x * 100).toFixed(d)}%`);
const pp = (x: number | null, d = 1) =>
  x === null ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}pp`;
const num = (x: number | null | undefined, d = 1) =>
  x === null || x === undefined ? '—' : x.toFixed(d);

interface XeFGRule {
  id: string;
  bucket: PlayerNote['bucket'];
  build: (i: XeFGRuleInput) => PlayerNote | null;
}

// Minimum attempts before a zone rule is allowed to fire.
const MIN_ZONE_ATT = 25;
const MIN_THREE_ATT = 35;

const XEFG_RULES: XeFGRule[] = [
  // ======================= GUARDING =======================

  // Run him off the line — real three-point shotmaker.
  {
    id: 'run-off-line',
    bucket: 'guarding',
    build: (i) => {
      const t = i.tend.three;
      const q = i.tend.quality.byZone.three;
      const realShooter =
        (i.threePct ?? 0) >= 0.36 || (q.delta !== null && q.delta > 0.02);
      if (!(t.att >= MIN_THREE_ATT && (t.share ?? 0) > 0.45 && realShooter)) return null;
      const lead = i.soften
        ? 'He profiles as a shooter to chase off the line'
        : 'Chase him off the line on every catch';
      const deltaClause =
        q.delta !== null && q.delta > 0
          ? ` and he sits ${pp(q.delta)} vs expected on threes`
          : '';
      return {
        id: 'run-off-line',
        title: 'Run him off the line',
        detail: `${lead} — ${pct(t.share)} of his attempts are threes${deltaClause}. Crowd the catch and force the drive.`,
        priority: 5,
        bucket: 'guarding',
        evidence: [
          { label: '3PT rate', value: pct(t.share) },
          { label: '3PT%', value: pct(i.threePct) },
          { label: '3PA', value: String(t.att) },
          ...(q.delta !== null ? [{ label: 'xeFG Δ 3', value: pp(q.delta) }] : []),
        ],
      };
    },
  },

  // Top-lock the movement shooter.
  {
    id: 'top-lock-movement',
    bucket: 'guarding',
    build: (i) => {
      if (i.archetype !== 'movement shooter') return null;
      if (i.tend.three.att < MIN_THREE_ATT) return null;
      return {
        id: 'top-lock-movement',
        title: 'Top-lock him off screens',
        detail: `Deny the catch coming off pin-downs and flares — he hunts threes at volume (${i.tend.three.att} attempts at ${pct(i.threePct)}). Make someone else beat us.`,
        priority: 5,
        bucket: 'guarding',
        evidence: [
          { label: '3PA', value: String(i.tend.three.att) },
          { label: '3PT%', value: pct(i.threePct) },
          { label: 'Assisted-make 3 rate', value: pct(i.tend.creation.assistedThreeMakeShare) },
        ],
      };
    },
  },

  // Make him a passer — high turnover load, pressure the handle.
  {
    id: 'pressure-handle',
    bucket: 'guarding',
    build: (i) => {
      const highUsage = (i.shareOfTeamFga ?? 0) > 0.15;
      const loose = i.topg > 2.4 || (i.astToTov !== null && i.astToTov < 1.1 && i.apg >= 2);
      if (!(highUsage && loose)) return null;
      return {
        id: 'pressure-handle',
        title: 'Pressure his handle — make him a passer',
        detail: `Get into him early. He coughs it up under pressure (${num(i.topg)} TOV/g, ${num(i.astToTov, 2)} AST/TO) — speed him up and trap side ball-screens.`,
        priority: 4,
        bucket: 'guarding',
        evidence: [
          { label: 'TOV/g', value: num(i.topg) },
          { label: 'AST/TO', value: num(i.astToTov, 2) },
          { label: 'Share of team FGA', value: pct(i.shareOfTeamFga) },
        ],
      };
    },
  },

  // Wall off the rim — downhill threat who finishes.
  {
    id: 'wall-off-rim',
    bucket: 'guarding',
    build: (i) => {
      const r = i.tend.rim;
      if (!(r.att >= MIN_ZONE_ATT && (r.share ?? 0) > 0.42 && (r.pct ?? 0) > 0.58)) return null;
      return {
        id: 'wall-off-rim',
        title: 'Build the wall — no straight-line drives',
        detail: `He gets to the rim and finishes (${pct(r.pct)} on ${r.att} rim attempts, ${pct(r.share)} of his shots). Cut off the paint early, contest vertical.`,
        priority: 4,
        bucket: 'guarding',
        evidence: [
          { label: 'Rim rate', value: pct(r.share) },
          { label: 'Rim FG%', value: pct(r.pct) },
          { label: 'Rim att', value: String(r.att) },
        ],
      };
    },
  },

  // Make him create — most of his makes are assisted.
  {
    id: 'make-him-create',
    bucket: 'guarding',
    build: (i) => {
      const c = i.tend.creation;
      const share = c.assistedMakeShare;
      if (!(share !== null && share > 0.72 && c.totalMakes >= 30)) return null;
      const madeCtx = `${c.assistedMakes}/${c.totalMakes} made baskets assisted`;
      return {
        id: 'make-him-create',
        title: 'Make him create off the dribble',
        detail: `He's a finisher of others' offense — ${madeCtx} (made-shot context only; assist data exists only on makes). Stay attached on the catch and take away the easy feed; he is far less comfortable creating his own.`,
        priority: 3,
        bucket: 'guarding',
        evidence: [
          { label: 'Assisted made baskets', value: madeCtx },
          { label: 'Assisted-make rate', value: pct(share) },
        ],
      };
    },
  },

  // Don't foul him — efficient foul-drawer.
  {
    id: 'do-not-foul',
    bucket: 'guarding',
    build: (i) => {
      if (!(i.ftr !== null && i.ftr > 0.40 && i.tend.totalFga > 60)) return null;
      return {
        id: 'do-not-foul',
        title: 'Show hands — do not foul him',
        detail: `He converts drives into free throws (${pct(i.ftr)} FT rate). No reach-ins, no body on closeouts — make him finish through contact, not from the line.`,
        priority: 3,
        bucket: 'guarding',
        evidence: [{ label: 'FT rate', value: pct(i.ftr) }],
      };
    },
  },

  // ======================= WHAT TO LIVE WITH =======================

  // Live with his above-break threes — below expected there.
  {
    id: 'live-with-abovebreak',
    bucket: 'live_with',
    build: (i) => {
      const ab = i.tend.aboveBreakThree;
      const q = i.tend.quality.byZone.three;
      const belowExpected = q.delta !== null && q.delta < -0.015;
      const coldPct = (ab.pct ?? 1) < 0.33;
      if (!(ab.att >= MIN_ZONE_ATT && (belowExpected || coldPct))) return null;
      const why =
        belowExpected && q.delta !== null
          ? `he is ${pp(q.delta)} vs expected on threes`
          : `he hits just ${pct(ab.pct)} on them`;
      return {
        id: 'live-with-abovebreak',
        title: 'Live with above-the-break threes',
        detail: `Short-closeout the top-of-key looks — ${why}. Send help off him before you scramble off a real shooter.`,
        priority: 3,
        bucket: 'live_with',
        evidence: [
          { label: 'Above-break 3PA', value: String(ab.att) },
          { label: 'Above-break 3PT%', value: pct(ab.pct) },
          ...(q.delta !== null ? [{ label: 'xeFG Δ 3', value: pp(q.delta) }] : []),
        ],
      };
    },
  },

  // Live with his midrange.
  {
    id: 'live-with-mid',
    bucket: 'live_with',
    build: (i) => {
      const m = i.tend.mid;
      if (!(m.att >= MIN_ZONE_ATT && (m.share ?? 0) > 0.22 && (m.pct ?? 1) < 0.38)) return null;
      return {
        id: 'live-with-mid',
        title: 'Concede the mid-range pull-up',
        detail: `Go under screens and funnel him into long twos — he shoots ${pct(m.pct)} from mid-range on ${m.att} attempts, his least efficient shot.`,
        priority: 2,
        bucket: 'live_with',
        evidence: [
          { label: 'Mid rate', value: pct(m.share) },
          { label: 'Mid FG%', value: pct(m.pct) },
          { label: 'Mid att', value: String(m.att) },
        ],
      };
    },
  },

  // Make him finish over size — weak rim conversion.
  {
    id: 'live-with-rim-misses',
    bucket: 'live_with',
    build: (i) => {
      const r = i.tend.rim;
      if (!(r.att >= MIN_ZONE_ATT && (r.pct ?? 1) < 0.52)) return null;
      return {
        id: 'live-with-rim-misses',
        title: 'Make him finish over size',
        detail: `Wall up and let him try to score through a body — he converts only ${pct(r.pct)} at the rim (${r.att} attempts). Don't foul; make him prove he can finish.`,
        priority: 2,
        bucket: 'live_with',
        evidence: [
          { label: 'Rim FG%', value: pct(r.pct) },
          { label: 'Rim att', value: String(r.att) },
        ],
      };
    },
  },

  // ======================= WHAT NOT TO ALLOW =======================

  // No corner threes — efficient corner shooter.
  {
    id: 'deny-corner-three',
    bucket: 'deny',
    build: (i) => {
      const c = i.tend.cornerThree;
      if (!(c.att >= 18 && (c.pct ?? 0) > 0.37)) return null;
      return {
        id: 'deny-corner-three',
        title: 'No corner threes',
        detail: `ID him first on every weak-side rotation — he shoots ${pct(c.pct)} from the corner on ${c.att} attempts. The baseline closeout is non-negotiable.`,
        priority: 4,
        bucket: 'deny',
        evidence: [
          { label: 'Corner 3PT%', value: pct(c.pct) },
          { label: 'Corner 3PA', value: String(c.att) },
        ],
      };
    },
  },

  // No rhythm catch-and-shoot — assisted shooter who is hot.
  {
    id: 'deny-rhythm-catch',
    bucket: 'deny',
    build: (i) => {
      const t = i.tend.three;
      const c = i.tend.creation;
      const assisted = c.assistedThreeMakeShare;
      const hot = (i.threePct ?? 0) >= 0.37;
      // Need a real made-three sample before claiming "mostly assisted".
      if (!(t.att >= MIN_THREE_ATT && hot && c.threeMakes >= 15 && assisted !== null && assisted > 0.8))
        return null;
      const madeCtx = `${c.assistedThreeMakes}/${c.threeMakes} made threes assisted`;
      return {
        id: 'deny-rhythm-catch',
        title: 'No rhythm catch-and-shoot looks',
        detail: `Close out high and run him off the line — ${madeCtx} (made-shot context only), and he buries them at ${pct(i.threePct)}. Take away the feet-set catch.`,
        priority: 4,
        bucket: 'deny',
        evidence: [
          { label: 'Assisted made 3s', value: madeCtx },
          { label: '3PT%', value: pct(i.threePct) },
          { label: '3PA', value: String(t.att) },
        ],
      };
    },
  },

  // No second-chance touches — offensive glass / putback threat.
  {
    id: 'deny-second-chance',
    bucket: 'deny',
    build: (i) => {
      const tipVol = i.tend.tip.att >= 8;
      const boards = i.rpg >= 6.5;
      if (!(tipVol || boards)) return null;
      const ev: Array<{ label: string; value: string }> = [{ label: 'RPG', value: num(i.rpg) }];
      if (i.tend.tip.att > 0) ev.push({ label: 'Tip-ins', value: String(i.tend.tip.att) });
      return {
        id: 'deny-second-chance',
        title: 'No second-chance touches',
        detail: `Body him off the glass on every shot — he scored ${i.tend.tip.att} tip-ins and pulls ${num(i.rpg)} rebounds a game. One box-out breakdown becomes a putback.`,
        priority: 3,
        bucket: 'deny',
        evidence: ev,
      };
    },
  },

  // No transition rim attempts — transition finisher.
  {
    id: 'deny-transition-rim',
    bucket: 'deny',
    build: (i) => {
      const tr = i.tend.transition;
      if (!(tr.att >= 20 && (tr.share ?? 0) > 0.18 && (i.tend.rim.share ?? 0) > 0.4)) return null;
      return {
        id: 'deny-transition-rim',
        title: 'No transition rim runs',
        detail: `Get a body on him and build the wall before he reaches the paint — ${pct(tr.share)} of his shots come in transition (inferred from play sequencing), mostly at the rim. Find him in the floor balance.`,
        priority: 3,
        bucket: 'deny',
        evidence: [
          { label: 'Transition shot rate', value: pct(tr.share) },
          { label: 'Transition att', value: String(tr.att) },
          { label: 'Rim rate', value: pct(i.tend.rim.share) },
        ],
      };
    },
  },
];

export function runXeFGRules(input: XeFGRuleInput): PlayerNote[] {
  const out: PlayerNote[] = [];
  for (const rule of XEFG_RULES) {
    const note = rule.build(input);
    if (note) out.push(note);
  }
  return out.sort((a, b) => b.priority - a.priority);
}
