// Facelet-level checks for a scanned cube, plus automatic repair of the two
// common scanning mistakes: a face held at the wrong rotation, and a pair of
// similar colours (red/orange, white/yellow) read the wrong way round.
//
// Faces are indexed 0-5 as U, R, F, D, L, B and stickers use the Kociemba
// facelet order that cubejs expects (U1..U9, R1..R9, F1..F9, D1..D9, L1..L9,
// B1..B9).

export const FACE_LETTERS = "URFDLB";

const U = 0, R = 1, F = 2, D = 3, L = 4, B = 5;

const CORNER_FACELETS = [
  [8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11],
  [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51],
];
const CORNER_COLORS = [
  [U, R, F], [U, F, L], [U, L, B], [U, B, R],
  [D, F, R], [D, L, F], [D, B, L], [D, R, B],
];
const EDGE_FACELETS = [
  [5, 10], [7, 19], [3, 37], [1, 46], [32, 16], [28, 25],
  [30, 43], [34, 52], [23, 12], [21, 41], [50, 39], [48, 14],
];
const EDGE_COLORS = [
  [U, R], [U, F], [U, L], [U, B], [D, R], [D, F],
  [D, L], [D, B], [F, R], [F, L], [B, L], [B, R],
];

export function facesToString(faces) {
  return faces.map((f) => FACE_LETTERS[f]).join("");
}

function permutationParity(perm) {
  let parity = 0;
  for (let i = 0; i < perm.length; i++) {
    for (let j = i + 1; j < perm.length; j++) if (perm[i] > perm[j]) parity ^= 1;
  }
  return parity;
}

// Decode the stickers into pieces. A corner/edge that matches no real piece
// gets -1.
function toCubies(faces) {
  const cp = [], co = [], ep = [], eo = [];
  for (const facelets of CORNER_FACELETS) {
    const colors = facelets.map((i) => faces[i]);
    const ori = colors.findIndex((c) => c === U || c === D);
    const piece = ori === -1 ? -1 : CORNER_COLORS.findIndex((cc) =>
      cc[0] === colors[ori] && cc[1] === colors[(ori + 1) % 3] && cc[2] === colors[(ori + 2) % 3]
    );
    cp.push(piece);
    co.push(Math.max(ori, 0));
  }
  for (const facelets of EDGE_FACELETS) {
    const [a, b] = facelets.map((i) => faces[i]);
    let piece = EDGE_COLORS.findIndex((ec) => ec[0] === a && ec[1] === b);
    let ori = 0;
    if (piece === -1) {
      piece = EDGE_COLORS.findIndex((ec) => ec[0] === b && ec[1] === a);
      ori = 1;
    }
    ep.push(piece);
    eo.push(ori);
  }
  return { cp, co, ep, eo };
}

export function isSolvable(faces) {
  const counts = [0, 0, 0, 0, 0, 0];
  for (const f of faces) counts[f]++;
  if (counts.some((c) => c !== 9)) return false;
  const { cp, co, ep, eo } = toCubies(faces);
  if (new Set(cp).size !== 8 || cp.includes(-1)) return false;
  if (new Set(ep).size !== 12 || ep.includes(-1)) return false;
  if (co.reduce((a, b) => a + b, 0) % 3 !== 0) return false;
  if (eo.reduce((a, b) => a + b, 0) % 2 !== 0) return false;
  return permutationParity(cp) === permutationParity(ep);
}

// Human-readable problems with the stickers to highlight for each one.
// `names` gives a colour name for each face, e.g. from the scanned centres.
export function describeProblems(faces, names = FACE_LETTERS.split("")) {
  const problems = [];
  const counts = [0, 0, 0, 0, 0, 0];
  for (const f of faces) counts[f]++;
  counts.forEach((count, f) => {
    if (count !== 9) problems.push({ message: `${names[f]} appears ${count} times (needs 9)`, stickers: [] });
  });
  if (problems.length) return problems;

  const { cp, co, ep, eo } = toCubies(faces);
  const seenCorners = new Map();
  cp.forEach((piece, i) => {
    const stickers = CORNER_FACELETS[i];
    const label = stickers.map((s) => names[faces[s]]).join("/");
    if (piece === -1) problems.push({ message: `No real corner is ${label}`, stickers });
    else if (seenCorners.has(piece)) problems.push({ message: `Corner ${label} appears twice`, stickers: [...seenCorners.get(piece), ...stickers] });
    else seenCorners.set(piece, stickers);
  });
  const seenEdges = new Map();
  ep.forEach((piece, i) => {
    const stickers = EDGE_FACELETS[i];
    const label = stickers.map((s) => names[faces[s]]).join("/");
    if (piece === -1) problems.push({ message: `No real edge is ${label}`, stickers });
    else if (seenEdges.has(piece)) problems.push({ message: `Edge ${label} appears twice`, stickers: [...seenEdges.get(piece), ...stickers] });
    else seenEdges.set(piece, stickers);
  });
  if (problems.length) return problems;

  if (co.reduce((a, b) => a + b, 0) % 3 !== 0) problems.push({ message: "One corner is twisted in place", stickers: [] });
  if (eo.reduce((a, b) => a + b, 0) % 2 !== 0) problems.push({ message: "One edge is flipped in place", stickers: [] });
  if (permutationParity(cp) !== permutationParity(ep)) problems.push({ message: "Two pieces are swapped", stickers: [] });
  return problems;
}

// Index map for turning one face's 3x3 grid clockwise by `turns` quarters
function rotatedIndices(turns) {
  let idx = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  for (let t = 0; t < turns; t++) idx = [6, 3, 0, 7, 4, 1, 8, 5, 2].map((i) => idx[i]);
  return idx;
}
const ROTATIONS = [0, 1, 2, 3].map(rotatedIndices);

export function rotateFace(values, face, turns) {
  const out = values.slice();
  const map = ROTATIONS[((turns % 4) + 4) % 4];
  for (let i = 0; i < 9; i++) out[face * 9 + i] = values[face * 9 + map[i]];
  return out;
}

function applyRotations(values, rotations) {
  let out = values;
  rotations.forEach((turns, face) => {
    if (turns) out = rotateFace(out, face, turns);
  });
  return out;
}

// Which slot each captured face really belongs in (perm[captured] = actual).
// Turning the cube the other way between side faces swaps R and L; tilting
// the wrong way for the top and bottom swaps U and D. Real cubes are chiral,
// so only the right arrangement can validate.
export const SLOT_PERMUTATIONS = [
  [0, 1, 2, 3, 4, 5],
  [0, 4, 2, 3, 1, 5],
  [3, 1, 2, 0, 4, 5],
  [3, 4, 2, 0, 1, 5],
];

// Every re-placement x per-face rotation, most likely scanning mistake first.
// Ranking them together matters: different combinations can explain the same
// stickers (swapping U/D is also "swap R/L and turn every face 180 degrees",
// the same cube held upside down). Costs follow how easy each mistake is to
// make: the turning direction between sides is ambiguous with a webcam, the
// top and bottom are easy to hold at an angle, but side faces stay upright
// because the top stays on top.
const ARRANGEMENTS = (() => {
  const permCost = [0, 8, 20, 28];
  const topBottomTurn = [0, 10, 12, 10];
  const sideTurn = [0, 14, 16, 14];
  const arrangements = [];
  SLOT_PERMUTATIONS.forEach((perm, p) => {
    for (let n = 0; n < 4096; n++) {
      const rotations = [0, 1, 2, 3, 4, 5].map((f) => (n >> (2 * f)) & 3);
      const cost = rotations.reduce(
        (acc, t, f) => acc + (f === U || f === D ? topBottomTurn[t] : sideTurn[t]),
        permCost[p]
      );
      arrangements.push({ perm, rotations, cost });
    }
  });
  return arrangements.sort((a, b) => a.cost - b.cost);
})();

// Move whole faces to other slots. With `relabel` the values are face indices
// and get renamed as well (for the classifier's output).
export function permuteSlots(values, perm, relabel = false) {
  const out = new Array(values.length);
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 9; i++) {
      const v = values[f * 9 + i];
      out[perm[f] * 9 + i] = relabel ? perm[v] : v;
    }
  }
  return out;
}

function permuteDistances(distances, perm) {
  const out = new Array(distances.length);
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 9; i++) {
      const row = distances[f * 9 + i];
      const next = new Array(6);
      for (let g = 0; g < 6; g++) next[perm[g]] = row[g];
      out[perm[f] * 9 + i] = next;
    }
  }
  return out;
}

// Re-place and re-rotate per-sticker values (e.g. the captured colours) the
// way a repairScan result says
export function arrangeStickers(values, { perm, rotations }) {
  return applyRotations(permuteSlots(values, perm), rotations);
}

// Try to turn an unsolvable scan into a solvable one with the smallest
// change: first by re-placing and re-rotating whole faces, then by swapping
// the colours of one or two pairs of stickers (cheapest swaps by colour
// distance first). Returns { faces, perm, rotations, swapped } or null;
// `swapped` holds sticker indices after the re-placement.
export function repairScan(faces, distances, { maxSwapCandidates = 24 } = {}) {
  const noRotation = [0, 0, 0, 0, 0, 0];

  for (const { perm, rotations } of ARRANGEMENTS) {
    const arranged = applyRotations(permuteSlots(faces, perm, true), rotations);
    if (isSolvable(arranged)) return { faces: arranged, perm, rotations, swapped: [] };
  }

  for (const perm of SLOT_PERMUTATIONS) {
    const placed = permuteSlots(faces, perm, true);
    const dist = permuteDistances(distances, perm);
    const pairs = cheapestSwaps(placed, dist, maxSwapCandidates);
    for (const swap of pairs) {
      const candidate = placed.slice();
      for (const { a, b } of swap) [candidate[a], candidate[b]] = [candidate[b], candidate[a]];
      if (isSolvable(candidate)) {
        return { faces: candidate, perm, rotations: noRotation, swapped: swap.flatMap((p) => [p.a, p.b]) };
      }
    }
  }
  return null;
}

// Swapping two stickers' colours keeps nine of each colour. Returns single
// and double swaps among the cheapest candidates, cheapest first.
function cheapestSwaps(faces, distances, maxCandidates) {
  const singles = [];
  for (let a = 0; a < faces.length; a++) {
    if (a % 9 === 4) continue;
    for (let b = a + 1; b < faces.length; b++) {
      if (b % 9 === 4 || faces[a] === faces[b]) continue;
      const delta =
        distances[a][faces[b]] + distances[b][faces[a]] - distances[a][faces[a]] - distances[b][faces[b]];
      singles.push({ a, b, delta });
    }
  }
  singles.sort((x, y) => x.delta - y.delta);
  const top = singles.slice(0, maxCandidates);

  const options = top.map((s) => ({ pairs: [s], delta: s.delta }));
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const p = top[i], q = top[j];
      if (p.a === q.a || p.a === q.b || p.b === q.a || p.b === q.b) continue;
      options.push({ pairs: [p, q], delta: p.delta + q.delta });
    }
  }
  options.sort((x, y) => x.delta - y.delta);
  return options.map((o) => o.pairs);
}

// Uniformly random solvable cube as face indices (for tests and benchmarks)
export function randomCube(rand = Math.random) {
  const shuffle = (n) => {
    const p = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    return p;
  };
  const cp = shuffle(8);
  const ep = shuffle(12);
  if (permutationParity(cp) !== permutationParity(ep)) [ep[0], ep[1]] = [ep[1], ep[0]];
  const co = cp.map(() => Math.floor(rand() * 3));
  co[7] = (3 - (co.slice(0, 7).reduce((a, b) => a + b, 0) % 3)) % 3;
  const eo = ep.map(() => Math.floor(rand() * 2));
  eo[11] = eo.slice(0, 11).reduce((a, b) => a + b, 0) % 2;

  const faces = new Array(54);
  for (let f = 0; f < 6; f++) faces[f * 9 + 4] = f;
  cp.forEach((piece, i) => {
    for (let n = 0; n < 3; n++) faces[CORNER_FACELETS[i][(n + co[i]) % 3]] = CORNER_COLORS[piece][n];
  });
  ep.forEach((piece, i) => {
    for (let n = 0; n < 2; n++) faces[EDGE_FACELETS[i][(n + eo[i]) % 2]] = EDGE_COLORS[piece][n];
  });
  return faces;
}
