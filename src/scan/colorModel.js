// Sticker colour model for the camera scanner.
//
// Every sticker is matched to one of the six centre stickers, under the
// constraint that each centre ends up with exactly nine stickers. The
// constrained matching is solved exactly with the Hungarian algorithm. Since
// each face is captured in its own frame, a per-face exposure/white-balance
// correction is then estimated from that matching and the matching is solved
// again, until it stops changing.
//
// Matching against the centres of the cube being scanned, rather than a fixed
// palette or an offline-trained classifier, is what keeps this robust when
// the lighting changes (see arXiv:1901.03470). Benchmark: scratch/benchmark_color_model.js

const BIG = 1e6;

// sRGB (0-255) -> linear RGB (0-1)
function srgbToLinear(rgb) {
  return rgb.map((c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
}

// linear RGB -> CIELAB, D65 white point
function linearToLab([R, G, B]) {
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function rgbToLab(r, g, b) {
  return linearToLab(srgbToLinear([r, g, b]));
}

// Euclidean Lab distance with lightness down-weighted, so shading across a
// face matters less than hue and chroma
export function labDistance(p, q, lightnessWeight = 0.5) {
  const dL = (p[0] - q[0]) * lightnessWeight;
  const da = p[1] - q[1];
  const db = p[2] - q[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

// CIEDE2000 colour difference
function deltaE2000(p, q) {
  const [L1, a1, b1] = p;
  const [L2, a2, b2] = q;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar7 = Math.pow((C1 + C2) / 2, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (b, a) => {
    if (a === 0 && b === 0) return 0;
    const h = Math.atan2(b, a) / rad;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbarp += h1p + h2p < 360 ? 360 : -360;
    hbarp /= 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hbarp - 30) * rad) +
    0.24 * Math.cos(2 * hbarp * rad) +
    0.32 * Math.cos((3 * hbarp + 6) * rad) -
    0.2 * Math.cos((4 * hbarp - 63) * rad);
  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Cbarp7 = Math.pow(Cbarp, 7);
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)));
  const SL = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(2 * dTheta * rad) * RC;
  return Math.sqrt(
    Math.pow(dLp / SL, 2) +
      Math.pow(dCp / SC, 2) +
      Math.pow(dHp / SH, 2) +
      RT * (dCp / SC) * (dHp / SH)
  );
}

// Minimum-cost perfect matching on a square cost matrix (Hungarian
// algorithm, O(n^3)). Returns rowToCol.
export function solveAssignment(cost) {
  const n = cost.length;
  const u = new Float64Array(n + 1);
  const v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1);
  const way = new Int32Array(n + 1);
  const minv = new Float64Array(n + 1);
  const used = new Uint8Array(n + 1);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    minv.fill(Infinity);
    used.fill(0);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      const row = cost[i0 - 1];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = row[j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  const rowToCol = new Int32Array(n);
  for (let j = 1; j <= n; j++) rowToCol[p[j] - 1] = j - 1;
  return rowToCol;
}

// Assign each sticker to a face so every face gets exactly nine stickers and
// the summed distance (distances[sticker][face]) is minimal. Centres always
// stay on their own face; `pins` (sticker -> face) fixes any other stickers
// whose face is already known, such as the user's corrections.
export function assignBalanced(distances, pins = new Map()) {
  const n = distances.length;
  const faceCount = 6;
  const perFace = n / faceCount;
  const cost = [];
  for (let s = 0; s < n; s++) {
    const pinned = s % perFace === Math.floor(perFace / 2) ? Math.floor(s / perFace) : pins.get(s);
    const row = new Float64Array(n);
    for (let f = 0; f < faceCount; f++) {
      const c = pinned === undefined || pinned === f ? distances[s][f] : BIG;
      for (let k = 0; k < perFace; k++) row[f * perFace + k] = c;
    }
    cost.push(row);
  }
  const rowToCol = solveAssignment(cost);
  return Array.from(rowToCol, (col) => Math.floor(col / perFace));
}

function nearestAssign(distances, centers) {
  return distances.map((row, s) => {
    const centerOf = centers.indexOf(s);
    if (centerOf !== -1) return centerOf;
    let best = 0;
    for (let f = 1; f < row.length; f++) if (row[f] < row[best]) best = f;
    return best;
  });
}

const METRICS = {
  lab: (p, q) => labDistance(p, q),
  ciede2000: deltaE2000,
};

// Per-face lighting correction. Each face is captured in its own frame, so
// exposure and white balance differ between faces. Model that as a von Kries
// gain per face and channel in linear RGB, fitted by least squares against
// the current colour estimates and pulled towards 1 by `prior` virtual
// stickers. Gains are normalised so their geometric mean per channel is 1.
function estimateFaceGains(linear, faces, gains, perFace, prior) {
  const faceCount = gains.length;
  const corrected = linear.map((x, s) => x.map((c, ch) => c * gains[Math.floor(s / perFace)][ch]));
  const targets = Array.from({ length: faceCount }, (_, k) => {
    const sum = [0, 0, 0];
    let count = 0;
    faces.forEach((face, s) => {
      if (face !== k) return;
      for (let ch = 0; ch < 3; ch++) sum[ch] += corrected[s][ch];
      count++;
    });
    return sum.map((v) => v / Math.max(count, 1));
  });

  const next = Array.from({ length: faceCount }, (_, f) =>
    [0, 1, 2].map((ch) => {
      let xy = 0;
      let xx = 0;
      for (let s = f * perFace; s < (f + 1) * perFace; s++) {
        const x = linear[s][ch];
        xy += x * targets[faces[s]][ch];
        xx += x * x;
      }
      const m = (prior * xx) / perFace;
      return xx > 0 ? (xy + m) / (xx + m) : 1;
    })
  );
  for (let ch = 0; ch < 3; ch++) {
    const logMean = next.reduce((acc, g) => acc + Math.log(g[ch]), 0) / faceCount;
    const norm = Math.exp(logMean);
    next.forEach((g) => (g[ch] /= norm));
  }
  return next;
}

function sameAssignment(a, b) {
  return a !== null && a.every((f, i) => f === b[i]);
}

// rgbs: 54 sRGB triples (0-255) in facelet order (U, R, F, D, L, B; centre of
// face f at index 9f + 4), one face per captured frame. Returns the face
// index for every sticker plus a per-sticker margin: how much closer the
// chosen face is than the best other face. Small or negative margins are the
// stickers worth double-checking.
export function classifyStickers(rgbs, options = {}) {
  const {
    metric = "lab",
    balanced = true,
    lighting = true,
    lightingPrior = 1,
    refine = false,
    maxIterations = 12,
  } = options;
  const dist = typeof metric === "function" ? metric : METRICS[metric];
  const faceCount = 6;
  const perFace = rgbs.length / faceCount;
  const centers = Array.from({ length: faceCount }, (_, f) => f * perFace + Math.floor(perFace / 2));
  const linear = rgbs.map(srgbToLinear);

  let gains = Array.from({ length: faceCount }, () => [1, 1, 1]);
  let labs = linear.map(linearToLab);
  let prototypes = centers.map((c) => labs[c]);
  let faces = null;
  let distances = null;

  const iterations = lighting || refine ? maxIterations : 1;
  for (let iter = 0; iter < iterations; iter++) {
    distances = labs.map((lab) => prototypes.map((proto) => dist(lab, proto)));
    const next = balanced ? assignBalanced(distances) : nearestAssign(distances, centers);
    const converged = sameAssignment(faces, next);
    faces = next;
    if (converged) break;

    if (lighting) {
      gains = estimateFaceGains(linear, faces, gains, perFace, lightingPrior);
      labs = linear.map((x, s) => linearToLab(x.map((c, ch) => c * gains[Math.floor(s / perFace)][ch])));
    }
    prototypes = refine
      ? prototypes.map((proto, f) => {
          const members = labs.filter((_, s) => faces[s] === f);
          if (!members.length) return proto;
          return [0, 1, 2].map((ch) => members.reduce((acc, lab) => acc + lab[ch], 0) / members.length);
        })
      : centers.map((c) => labs[c]);
  }

  const margins = distances.map((row, s) => {
    let other = Infinity;
    row.forEach((d, f) => {
      if (f !== faces[s]) other = Math.min(other, d);
    });
    return other - row[faces[s]];
  });

  return { faces, margins, distances, gains };
}
