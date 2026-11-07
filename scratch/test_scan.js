// Checks for the scanner's cube-state logic (src/scan/cubeState.js) and the
// balanced assignment it relies on (src/scan/colorModel.js).
//
//   node scratch/test_scan.js [path/to/cubejs/lib/cube.js]
//
// With a path to cubejs, random states are also cross-checked against the
// solver's own facelet parser.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { assignBalanced } from "../src/scan/colorModel.js";
import {
  isSolvable,
  describeProblems,
  facesToString,
  rotateFace,
  repairScan,
  randomCube,
  permuteSlots,
  arrangeStickers,
  SLOT_PERMUTATIONS,
  FACE_LETTERS,
} from "../src/scan/cubeState.js";

const toFaces = (s) => [...s].map((c) => FACE_LETTERS.indexOf(c));
const flat = (cube) => cube.map(() => [0, 0, 0, 0, 0, 0]);
const SOLVED = toFaces("UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB");

// valid states
for (let i = 0; i < 2000; i++) assert.ok(isSolvable(randomCube()));
assert.ok(isSolvable(SOLVED));
assert.ok(isSolvable(toFaces("FFBFULFLRBBUDRDLRFLFDLFFBRULDBUDBRLLUUUULUFBDRRRBBRDDD")));

// physically impossible states, with the right explanation
const twisted = SOLVED.slice();
[twisted[8], twisted[9], twisted[20]] = [twisted[20], twisted[8], twisted[9]];
assert.deepEqual(describeProblems(twisted).map((p) => p.message), ["One corner is twisted in place"]);
const flipped = SOLVED.slice();
[flipped[5], flipped[10]] = [flipped[10], flipped[5]];
assert.deepEqual(describeProblems(flipped).map((p) => p.message), ["One edge is flipped in place"]);
const swappedEdges = SOLVED.slice();
[swappedEdges[5], swappedEdges[1]] = [swappedEdges[1], swappedEdges[5]];
[swappedEdges[10], swappedEdges[46]] = [swappedEdges[46], swappedEdges[10]];
assert.deepEqual(describeProblems(swappedEdges).map((p) => p.message), ["Two pieces are swapped"]);
const badColour = SOLVED.slice();
[badColour[0], badColour[9]] = [badColour[9], badColour[0]];
assert.ok(describeProblems(badColour).some((p) => p.message.startsWith("No real")));

let tried = 0;

// A face held at the wrong rotation is turned back. Very rarely (~2 in
// 10,000) another solvable cube explains the stickers equally well, so the
// repair checks are rates.
let rotated = 0, rotatedExact = 0;
for (let i = 0; i < 300; i++) {
  const truth = randomCube();
  const misread = rotateFace(truth, i % 6, 1 + (i % 3));
  if (isSolvable(misread)) continue; // a rotation-symmetric face
  tried++;
  rotated++;
  if (facesToString(repairScan(misread, flat(truth)).faces) === facesToString(truth)) rotatedExact++;
}
assert.ok(rotatedExact >= rotated * 0.98, `rotation repairs ${rotatedExact}/${rotated}`);

// sides scanned turning the other way, top/bottom swapped, plus a rotated face
let compound = 0, compoundExact = 0;
for (let i = 0; i < 300; i++) {
  const truth = randomCube();
  let misread = permuteSlots(truth, SLOT_PERMUTATIONS[1 + (i % 3)], true);
  if (i % 2) misread = rotateFace(misread, i % 6, 1);
  if (isSolvable(misread)) continue;
  tried++;
  compound++;
  const fix = repairScan(misread, flat(truth));
  if (facesToString(fix.faces) === facesToString(truth)) compoundExact++;
  // per-sticker values (the captured colours) move the same way
  const source = arrangeStickers(misread.map((_, k) => k), fix);
  assert.ok(source.every((src, k) => fix.perm[misread[src]] === fix.faces[k]));
}
assert.ok(compoundExact >= compound * 0.98, `compound repairs ${compoundExact}/${compound}`);

// two similar colours read the wrong way round
for (let i = 0; i < 300; i++) {
  const truth = randomCube();
  const dist = truth.map((f) => [0, 1, 2, 3, 4, 5].map((g) => (g === f ? 0 : 50)));
  let a, b;
  do {
    a = Math.floor(Math.random() * 54);
    b = Math.floor(Math.random() * 54);
  } while (a % 9 === 4 || b % 9 === 4 || truth[a] === truth[b]);
  const misread = truth.slice();
  [misread[a], misread[b]] = [misread[b], misread[a]];
  dist[a][misread[a]] = 1; dist[a][truth[a]] = 2;
  dist[b][misread[b]] = 1; dist[b][truth[b]] = 2;
  if (isSolvable(misread)) continue;
  tried++;
  assert.equal(facesToString(repairScan(misread, dist).faces), facesToString(truth));
}

// correcting one sticker by hand re-solves its swapped partner too
for (let i = 0; i < 300; i++) {
  const truth = randomCube();
  const dist = truth.map((f) => [0, 1, 2, 3, 4, 5].map((g) => (g === f ? 5 : 50)));
  let a, b;
  do {
    a = Math.floor(Math.random() * 54);
    b = Math.floor(Math.random() * 54);
  } while (a % 9 === 4 || b % 9 === 4 || truth[a] === truth[b]);
  dist[a][truth[b]] = 1; dist[a][truth[a]] = 3;
  dist[b][truth[a]] = 1; dist[b][truth[b]] = 3;
  assert.equal(assignBalanced(dist)[a], truth[b]);
  assert.equal(facesToString(assignBalanced(dist, new Map([[a, truth[a]]]))), facesToString(truth));
  tried++;
}

// the facelet order matches cubejs, which the app's solver uses
if (process.argv[2]) {
  const Cube = createRequire(import.meta.url)(process.argv[2]);
  for (let i = 0; i < 2000; i++) {
    const s = facesToString(randomCube());
    assert.equal(Cube.fromString(s).asString(), s);
    assert.ok(isSolvable(toFaces(Cube.random().asString())));
  }
  console.log("cubejs cross-check passed");
}

console.log(`all scan checks passed (${tried} repair cases)`);
