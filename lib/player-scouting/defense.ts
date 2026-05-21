// ============================================================================
// Inferred defensive profile.
//
// We have NO tracking or matchup data. Everything here is a box-score + size
// proxy and the consuming UI labels it as inferred. Language is deliberately
// hedged ("likely", "best used", "avoid asking him to") — never a verdict.
// ============================================================================

export interface DefenseInput {
  position: string | null;
  heightInches: number | null;
  weightLbs: number | null;
  isFrontcourt: boolean;
  spg: number;
  bpg: number;
  rpg: number;
  fpg: number;
  minutesPerGame: number | null;
}

export interface DefenseProfile {
  /** Always true — included so the UI can hard-label the section. */
  inferred: true;
  sizeNote: string | null;
  /** "likely guardable by" — matchup type he can defend. */
  likelyGuards: string;
  /** "best used defending" — his strongest defensive role. */
  bestUsedDefending: string;
  /** "avoid asking him to" — the assignment to keep him away from. */
  avoidAskingHimTo: string;
  /** Short box-score descriptor list. */
  descriptors: string[];
  spg: number;
  bpg: number;
  rpg: number;
  fpg: number;
}

function formatSize(heightInches: number | null, weightLbs: number | null): string | null {
  if (!heightInches) return null;
  const ft = Math.floor(heightInches / 12);
  const inch = heightInches % 12;
  let s = `${ft}'${inch}"`;
  if (weightLbs) s += ` · ${weightLbs} lbs`;
  return s;
}

export function buildDefenseProfile(input: DefenseInput): DefenseProfile {
  const { position, heightInches, isFrontcourt, spg, bpg, rpg, fpg } = input;
  const pos = (position ?? '').toUpperCase();
  const tall = heightInches !== null && heightInches >= 79; // 6'7"+
  const short = heightInches !== null && heightInches <= 73; // 6'1"-

  const descriptors: string[] = [];
  if (bpg >= 1.0) descriptors.push('rim protection (shot-blocking)');
  if (spg >= 1.5) descriptors.push('active hands / event creation');
  if (rpg >= 7) descriptors.push('strong defensive rebounder');
  if (bpg < 0.3 && spg < 0.6) descriptors.push('low-event defender by box score');
  if (fpg >= 3) descriptors.push('foul-prone');
  if (descriptors.length === 0) {
    descriptors.push('average box-score defensive footprint');
  }

  // likelyGuards — matchup type derived from size + position.
  let likelyGuards: string;
  if (isFrontcourt || tall) {
    likelyGuards = 'opposing fours and fives, or switched onto bigger wings';
  } else if (short) {
    likelyGuards = 'opposing point guards and smaller ball-handlers';
  } else {
    likelyGuards = 'opposing wings and combo guards';
  }

  // bestUsedDefending — his strongest inferred role.
  let bestUsedDefending: string;
  if (bpg >= 1.0) {
    bestUsedDefending = 'protecting the rim as a help defender and weak-side shot-blocker';
  } else if (spg >= 1.5) {
    bestUsedDefending = 'pressuring the ball and jumping passing lanes';
  } else if (rpg >= 7) {
    bestUsedDefending = 'anchoring the defensive glass and finishing possessions';
  } else if (isFrontcourt) {
    bestUsedDefending = 'interior positional defense and pick-and-roll coverage';
  } else {
    bestUsedDefending = 'on-ball point-of-attack defense within his size range';
  }

  // avoidAskingHimTo — the risk assignment.
  let avoidAskingHimTo: string;
  if (fpg >= 3) {
    avoidAskingHimTo = 'defend in space without fouling — he picks up cheap whistles';
  } else if (short || (!isFrontcourt && bpg < 0.3)) {
    avoidAskingHimTo = 'switch onto and contain post-ups against bigger players';
  } else if (isFrontcourt && spg < 0.6) {
    avoidAskingHimTo = 'switch out and stay in front of quick perimeter guards';
  } else {
    avoidAskingHimTo = 'carry the toughest perimeter assignment for a full game';
  }

  return {
    inferred: true,
    sizeNote: formatSize(heightInches, input.weightLbs),
    likelyGuards,
    bestUsedDefending,
    avoidAskingHimTo,
    descriptors,
    spg,
    bpg,
    rpg,
    fpg,
  };
}
