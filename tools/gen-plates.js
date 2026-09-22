'use strict';

/**
 * Generates the illustrated "plates" used as tour artwork.
 *
 * Why generated rather than stock photography: the demo needs nine distinct
 * images with no licence attached to any of them. These are procedural
 * silhouette landscapes in the site palette — they read as a deliberate
 * editorial choice rather than as missing photos, and they cost nothing to
 * ship. Swap any of them for a real photograph by dropping a file with the
 * same name into public/img/plates/.
 *
 * Output is deterministic: the PRNG is seeded per plate, so re-running this
 * script produces byte-identical files and never churns the git diff.
 */

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'img', 'plates');
const W = 1200;
const H = 800;

// Small deterministic PRNG (mulberry32).
function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const n = (v) => Math.round(v * 100) / 100;

// ------------------------------------------------------------------ layer art

/** Jagged mountain ridge. */
function peaks(rand, { y, amp, count, jitter = 0.35 }) {
  const pts = [[0, y + amp * 0.2]];
  const step = W / count;
  for (let i = 0; i <= count; i++) {
    const x = i * step;
    const up = y - amp * (0.45 + rand() * 0.55);
    const mid = x - step * (0.25 + rand() * jitter);
    pts.push([mid, y - amp * 0.1 * rand()]);
    pts.push([x, up]);
  }
  pts.push([W, y + amp * 0.2]);
  return `M ${pts.map(([x, yy]) => `${n(x)} ${n(yy)}`).join(' L ')} L ${W} ${H} L 0 ${H} Z`;
}

/** Smooth rolling dunes / hills, drawn with cubic segments. */
function dunes(rand, { y, amp, count }) {
  const step = W / count;
  let d = `M 0 ${n(y)}`;
  let cy = y;
  for (let i = 0; i < count; i++) {
    const x0 = i * step;
    const x1 = x0 + step;
    const ny = y - amp * (rand() - 0.35);
    d += ` C ${n(x0 + step * 0.4)} ${n(cy)} ${n(x1 - step * 0.4)} ${n(ny)} ${n(x1)} ${n(ny)}`;
    cy = ny;
  }
  return `${d} L ${W} ${H} L 0 ${H} Z`;
}

/** City skyline: blocks of varying height with occasional spires. */
function skyline(rand, { y, amp, count }) {
  const step = W / count;
  let d = `M 0 ${H} L 0 ${n(y)}`;
  let x = 0;
  for (let i = 0; i < count; i++) {
    const w = step * (0.6 + rand() * 0.8);
    const h = amp * (0.25 + rand() * 0.95);
    const top = y - h;
    d += ` L ${n(x)} ${n(top)} L ${n(x + w)} ${n(top)}`;
    if (rand() > 0.78) {
      const sw = w * 0.16;
      const sx = x + w / 2 - sw / 2;
      d += ` L ${n(sx + sw)} ${n(top)} L ${n(sx + sw)} ${n(top - amp * 0.35)}` +
           ` L ${n(sx)} ${n(top - amp * 0.35)} L ${n(sx)} ${n(top)}`;
    }
    d += ` L ${n(x + w)} ${n(y + 4)}`;
    x += w;
  }
  return `${d} L ${W} ${n(y)} L ${W} ${H} Z`;
}

/** Forest canopy: overlapping conifer triangles along a baseline. */
function canopy(rand, { y, amp, count }) {
  let d = '';
  const step = W / count;
  for (let i = -1; i <= count + 1; i++) {
    const x = i * step + (rand() - 0.5) * step * 0.6;
    const h = amp * (0.5 + rand() * 0.8);
    const w = step * (0.7 + rand() * 0.6);
    d += ` M ${n(x - w / 2)} ${n(y)} L ${n(x)} ${n(y - h)} L ${n(x + w / 2)} ${n(y)} Z`;
  }
  return `${d} M 0 ${n(y - 1)} L ${W} ${n(y - 1)} L ${W} ${H} L 0 ${H} Z`;
}

/** Low island humps sitting on a waterline. */
function islands(rand, { y, amp, count }) {
  let d = '';
  for (let i = 0; i < count; i++) {
    const cx = (W / count) * (i + 0.5) + (rand() - 0.5) * 80;
    const rx = 70 + rand() * 150;
    const ry = amp * (0.35 + rand() * 0.8);
    d += ` M ${n(cx - rx)} ${n(y)} Q ${n(cx - rx * 0.4)} ${n(y - ry)} ${n(cx)} ${n(y - ry * 0.92)}` +
         ` Q ${n(cx + rx * 0.5)} ${n(y - ry * 0.7)} ${n(cx + rx)} ${n(y)} Z`;
  }
  return d.trim();
}

/** Stacked stepped temple / terrace mass, centred. */
function terrace(rand, { y, amp, tiers = 5 }) {
  let d = '';
  const baseW = W * 0.52;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const w = baseW * (1 - t * 0.72);
    const h = amp / tiers;
    const top = y - (i + 1) * h;
    d += ` M ${n(W / 2 - w / 2)} ${n(top + h)} L ${n(W / 2 - w / 2)} ${n(top)}` +
         ` L ${n(W / 2 + w / 2)} ${n(top)} L ${n(W / 2 + w / 2)} ${n(top + h)} Z`;
  }
  const sp = amp * 0.3;
  d += ` M ${n(W / 2 - 14)} ${n(y - amp)} L ${n(W / 2)} ${n(y - amp - sp)} L ${n(W / 2 + 14)} ${n(y - amp)} Z`;
  return d.trim();
}

/** Horizontal wave strokes, for water foregrounds. */
function waves(rand, { y, rows = 7 }) {
  let d = '';
  for (let r = 0; r < rows; r++) {
    const yy = y + r * ((H - y) / rows) + 6;
    let x = -40 + rand() * 60;
    while (x < W) {
      const len = 40 + rand() * 130;
      d += ` M ${n(x)} ${n(yy)} q ${n(len / 2)} ${n(-4 - rand() * 5)} ${n(len)} 0`;
      x += len + 30 + rand() * 90;
    }
  }
  return d.trim();
}

// ------------------------------------------------------------------ plate spec

const PLATES = [
  {
    file: 'ridgeline.svg',
    sky: ['#2B3A4A', '#7C8FA0', '#E4C79A'],
    sun: { cx: 0.74, cy: 0.3, r: 74, fill: '#F3E3C3', glow: true },
    layers: [
      { kind: 'peaks', fill: '#5C7186', o: 0.9, y: 0.62, amp: 0.3, count: 5 },
      { kind: 'peaks', fill: '#3C4E60', o: 1, y: 0.72, amp: 0.26, count: 7 },
      { kind: 'canopy', fill: '#1E2A33', o: 1, y: 0.86, amp: 0.13, count: 34 },
    ],
  },
  {
    file: 'dunes.svg',
    sky: ['#9C4B2A', '#D98B4A', '#F2CE8E'],
    sun: { cx: 0.28, cy: 0.34, r: 58, fill: '#FFF0CE', glow: true },
    layers: [
      { kind: 'dunes', fill: '#C9743E', o: 0.95, y: 0.6, amp: 0.13, count: 5 },
      { kind: 'dunes', fill: '#A8552C', o: 1, y: 0.72, amp: 0.16, count: 4 },
      { kind: 'dunes', fill: '#6E3520', o: 1, y: 0.85, amp: 0.12, count: 3 },
    ],
  },
  {
    file: 'metropolis.svg',
    sky: ['#161C2C', '#2E3A57', '#B4708A'],
    sun: { cx: 0.2, cy: 0.26, r: 42, fill: '#F6DDE6', glow: true },
    layers: [
      { kind: 'skyline', fill: '#3A4665', o: 0.85, y: 0.68, amp: 0.34, count: 16 },
      { kind: 'skyline', fill: '#212A42', o: 1, y: 0.8, amp: 0.36, count: 22 },
      { kind: 'skyline', fill: '#10141F', o: 1, y: 0.92, amp: 0.22, count: 30 },
    ],
    windows: true,
  },
  {
    file: 'atoll.svg',
    sky: ['#2A6A84', '#6FB3BE', '#EBD9B4'],
    sun: { cx: 0.7, cy: 0.24, r: 50, fill: '#FDF3D8', glow: true },
    layers: [
      { kind: 'islands', fill: '#1F5464', o: 1, y: 0.62, amp: 0.2, count: 4 },
      { kind: 'flat', fill: '#8FC7CD', o: 1, y: 0.62 },
      { kind: 'waves', stroke: '#DCEFF0', o: 0.5, y: 0.64 },
    ],
  },
  {
    file: 'fjord.svg',
    sky: ['#1F2E38', '#4C6B75', '#C8D6CE'],
    sun: { cx: 0.5, cy: 0.22, r: 38, fill: '#E9F1E6', glow: false },
    layers: [
      { kind: 'peaks', fill: '#41606B', o: 0.9, y: 0.56, amp: 0.34, count: 4 },
      { kind: 'peaks', fill: '#28414C', o: 1, y: 0.68, amp: 0.3, count: 6 },
      { kind: 'flat', fill: '#16272F', o: 1, y: 0.74 },
      { kind: 'waves', stroke: '#7E9BA3', o: 0.35, y: 0.76 },
    ],
  },
  {
    file: 'highland.svg',
    sky: ['#2E2338', '#7A4A52', '#E0A76B'],
    sun: { cx: 0.24, cy: 0.3, r: 46, fill: '#FCE0B4', glow: true },
    layers: [
      { kind: 'peaks', fill: '#5A3F4C', o: 0.8, y: 0.58, amp: 0.28, count: 4 },
      { kind: 'skyline', fill: '#3A2B39', o: 1, y: 0.78, amp: 0.26, count: 20 },
      { kind: 'skyline', fill: '#211822', o: 1, y: 0.9, amp: 0.2, count: 28 },
    ],
    windows: true,
  },
  {
    file: 'temple.svg',
    sky: ['#3A2A4A', '#8A5C79', '#E9B98C'],
    sun: { cx: 0.34, cy: 0.28, r: 54, fill: '#FBE6C6', glow: true },
    layers: [
      { kind: 'peaks', fill: '#6B4D67', o: 0.75, y: 0.66, amp: 0.2, count: 6 },
      { kind: 'terrace', fill: '#2E2138', o: 1, y: 0.82, amp: 0.3 },
      { kind: 'canopy', fill: '#1B1324', o: 1, y: 0.88, amp: 0.1, count: 40 },
    ],
  },
  {
    file: 'vineyard.svg',
    sky: ['#4A5030', '#8C9354', '#E7DCA8'],
    sun: { cx: 0.76, cy: 0.3, r: 62, fill: '#FBF3CE', glow: true },
    layers: [
      { kind: 'dunes', fill: '#7C8A4C', o: 0.95, y: 0.6, amp: 0.12, count: 5 },
      { kind: 'rows', fill: '#5B6733', o: 1, y: 0.72 },
      { kind: 'dunes', fill: '#3A431F', o: 1, y: 0.9, amp: 0.07, count: 3 },
    ],
  },
  {
    file: 'aurora.svg',
    sky: ['#0D1626', '#16304A', '#2E5C64'],
    sun: { cx: 0.8, cy: 0.18, r: 26, fill: '#E8F2F6', glow: false },
    aurora: true,
    layers: [
      { kind: 'peaks', fill: '#1B3348', o: 1, y: 0.74, amp: 0.26, count: 5 },
      { kind: 'canopy', fill: '#0A1420', o: 1, y: 0.9, amp: 0.12, count: 36 },
    ],
  },
];

function acacia(rand, { y }) {
  // Two flat-topped acacias, one large one small, off-centre.
  const trees = [
    { x: W * 0.24, s: 1 },
    { x: W * 0.72, s: 0.6 },
  ];
  let d = '';
  for (const t of trees) {
    const h = 150 * t.s;
    const cw = 190 * t.s;
    d += ` M ${n(t.x - 6 * t.s)} ${n(y)} L ${n(t.x - 3 * t.s)} ${n(y - h)}` +
         ` L ${n(t.x + 3 * t.s)} ${n(y - h)} L ${n(t.x + 6 * t.s)} ${n(y)} Z`;
    d += ` M ${n(t.x - cw / 2)} ${n(y - h)} Q ${n(t.x - cw * 0.3)} ${n(y - h - 46 * t.s)} ${n(t.x)} ${n(y - h - 40 * t.s)}` +
         ` Q ${n(t.x + cw * 0.34)} ${n(y - h - 48 * t.s)} ${n(t.x + cw / 2)} ${n(y - h)}` +
         ` Q ${n(t.x)} ${n(y - h + 14 * t.s)} ${n(t.x - cw / 2)} ${n(y - h)} Z`;
    d += ` M ${n(t.x - 3 * t.s)} ${n(y - h * 0.72)} L ${n(t.x - 44 * t.s)} ${n(y - h * 0.94)}`;
    d += ` M ${n(t.x + 3 * t.s)} ${n(y - h * 0.66)} L ${n(t.x + 40 * t.s)} ${n(y - h * 0.9)}`;
  }
  return d.trim();
}

function vineRows(rand, { y }) {
  // Converging trellis rows — cheap perspective, reads as cultivated land.
  let d = '';
  const vanishX = W * 0.62;
  for (let i = 0; i <= 26; i++) {
    const t = i / 26;
    const xBottom = -W * 0.5 + t * W * 2;
    const yy = y + 12;
    d += ` M ${n(xBottom)} ${H} L ${n(vanishX + (xBottom - vanishX) * 0.12)} ${n(yy)}`;
  }
  return d.trim();
}

function windowLights(rand) {
  let d = '';
  for (let i = 0; i < 190; i++) {
    const x = rand() * W;
    const y = H * (0.56 + rand() * 0.34);
    const w = 3 + rand() * 4;
    const h = 4 + rand() * 6;
    d += ` M ${n(x)} ${n(y)} h ${n(w)} v ${n(h)} h ${n(-w)} Z`;
  }
  return d.trim();
}

function auroraBands(rand) {
  let out = '';
  const tints = ['#5FE0B0', '#9BE8C6', '#6FB7E8'];
  for (let i = 0; i < 3; i++) {
    const y = H * (0.14 + i * 0.1);
    const amp = 40 + rand() * 40;
    let d = `M -50 ${n(y)}`;
    for (let x = 0; x <= W + 50; x += 120) {
      d += ` Q ${n(x + 60)} ${n(y - amp * (rand() - 0.2))} ${n(x + 120)} ${n(y + amp * 0.2 * (rand() - 0.5))}`;
    }
    out += `<path d="${d}" fill="none" stroke="${tints[i]}" stroke-width="${n(18 + rand() * 26)}"` +
           ` stroke-linecap="round" opacity="${n(0.16 + i * 0.05)}" filter="url(#soft)"/>`;
  }
  return out;
}

function buildLayer(rand, spec) {
  const y = H * spec.y;
  const amp = H * (spec.amp || 0);
  switch (spec.kind) {
    case 'peaks':
      return `<path d="${peaks(rand, { y, amp, count: spec.count })}" fill="${spec.fill}" opacity="${spec.o}"/>`;
    case 'dunes':
      return `<path d="${dunes(rand, { y, amp, count: spec.count })}" fill="${spec.fill}" opacity="${spec.o}"/>`;
    case 'skyline':
      return `<path d="${skyline(rand, { y, amp, count: spec.count })}" fill="${spec.fill}" opacity="${spec.o}"/>`;
    case 'canopy':
      return `<path d="${canopy(rand, { y, amp, count: spec.count })}" fill="${spec.fill}" opacity="${spec.o}"/>`;
    case 'islands':
      return `<path d="${islands(rand, { y, amp, count: spec.count })}" fill="${spec.fill}" opacity="${spec.o}"/>`;
    case 'terrace':
      return `<path d="${terrace(rand, { y, amp })}" fill="${spec.fill}" opacity="${spec.o}"/>`;
    case 'acacia':
      return `<path d="${acacia(rand, { y })}" fill="${spec.fill}" stroke="${spec.fill}" stroke-width="3" opacity="${spec.o}"/>`;
    case 'rows':
      return `<path d="${vineRows(rand, { y })}" fill="none" stroke="${spec.fill}" stroke-width="5" opacity="${spec.o}"/>`;
    case 'waves':
      return `<path d="${waves(rand, { y })}" fill="none" stroke="${spec.stroke}" stroke-width="3" stroke-linecap="round" opacity="${spec.o}"/>`;
    case 'flat':
      return `<rect x="0" y="${n(y)}" width="${W}" height="${n(H - y)}" fill="${spec.fill}" opacity="${spec.o}"/>`;
    default:
      return '';
  }
}

function plateSVG(spec) {
  const rand = rng(hashSeed(spec.file));
  const id = spec.file.replace('.svg', '');
  const [a, b, c] = spec.sky;

  const body = spec.layers.map((l) => buildLayer(rand, l)).join('\n  ');
  const sun = spec.sun
    ? `<circle cx="${n(W * spec.sun.cx)}" cy="${n(H * spec.sun.cy)}" r="${spec.sun.r}"` +
      ` fill="${spec.sun.fill}"${spec.sun.glow ? ' filter="url(#soft)"' : ''} opacity="0.95"/>` +
      (spec.sun.glow
        ? `<circle cx="${n(W * spec.sun.cx)}" cy="${n(H * spec.sun.cy)}" r="${spec.sun.r * 2.6}"` +
          ` fill="url(#glow-${id})" opacity="0.5"/>`
        : '')
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">
  <defs>
    <linearGradient id="sky-${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${a}"/>
      <stop offset="55%" stop-color="${b}"/>
      <stop offset="100%" stop-color="${c}"/>
    </linearGradient>
    <radialGradient id="glow-${id}">
      <stop offset="0%" stop-color="${spec.sun ? spec.sun.fill : '#fff'}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${spec.sun ? spec.sun.fill : '#fff'}" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="14"/>
    </filter>
    <filter id="grain-${id}" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" seed="7" result="n"/>
      <feColorMatrix in="n" type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.10"/></feComponentTransfer>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky-${id})"/>
  ${spec.aurora ? auroraBands(rand) : ''}
  ${sun}
  ${body}
  ${spec.windows ? `<path d="${windowLights(rand)}" fill="#F7D98C" opacity="0.5"/>` : ''}
  <rect width="${W}" height="${H}" filter="url(#grain-${id})" opacity="0.5" style="mix-blend-mode:overlay"/>
</svg>
`;
}

fs.mkdirSync(OUT, { recursive: true });
for (const spec of PLATES) {
  fs.writeFileSync(path.join(OUT, spec.file), plateSVG(spec));
  process.stdout.write(`wrote ${spec.file}\n`);
}
