#!/usr/bin/env tsx
/**
 * Verify the court geometry math without rendering.
 * Prints every landmark in BOTH feet and SVG units so a wrong number is
 * immediately visible.
 */
import { COURT_DEBUG_INFO, shotToSvgCoords, shotDistanceFt } from '../components/Court';

function row(label: string, value: unknown) {
  console.log(`  ${label.padEnd(28)} ${typeof value === 'object' ? JSON.stringify(value) : value}`);
}

console.log('Court geometry — FEET');
console.log('-'.repeat(60));
for (const [k, v] of Object.entries(COURT_DEBUG_INFO.feet)) row(k, v);

console.log('\nCourt geometry — SVG');
console.log('-'.repeat(60));
for (const [k, v] of Object.entries(COURT_DEBUG_INFO.svg)) row(k, v);

console.log('\nDerived sanity checks');
console.log('-'.repeat(60));
const f = COURT_DEBUG_INFO.feet;
const dx = f.threeCornerXFt;
const dy = f.threeYMeetFt - f.basketYFt;
const distToCorner = Math.sqrt(dx * dx + dy * dy);
row('corner-meet → basket dist (ft)', distToCorner.toFixed(4) + '  (must equal ' + f.threeRadiusFt + ')');
row('Δ from target radius', (distToCorner - f.threeRadiusFt).toExponential(2));

console.log('\nshotToSvgCoords sample probes');
console.log('-'.repeat(60));
const samples: Array<[number, number, string]> = [
  [56.4, 280, 'rim make (close to basket, both ends should land near basket)'],
  [940 - 56.4, 280, 'same shot, far baseline (mirrored)'],
  [37.6, 480, 'corner three (right corner side)'],
  [220, 250, 'top of arc 3PT (basket center xy-ish)'],
];
for (const [rx, ry, note] of samples) {
  const { svgX, svgY } = shotToSvgCoords(rx, ry);
  const dist = shotDistanceFt(rx, ry).toFixed(2);
  console.log(`  raw=(${rx}, ${ry}) → svg=(${svgX}, ${svgY}) · ${dist} ft from basket  // ${note}`);
}
