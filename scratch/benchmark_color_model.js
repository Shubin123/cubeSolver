// Benchmarks the scanner's colour model (src/scan/colorModel.js) and repair
// step (src/scan/cubeState.js) on the Rubik's Cube colour dataset from
// "Color Recognition for Rubik's Cube Robot" (arXiv:1901.03470):
// https://github.com/eyeeco/Rubick-s-Cube-Dataset
//
// Each CSV row is one sticker as OpenCV HSV (H 0-180, S/V 0-255) plus its
// colour label; every 54 rows are one cube state with the centres at 9f + 4.
// The data has no licence, so it is downloaded at run time, not vendored.
//
//   node scratch/benchmark_color_model.js [local-dir-with-csvs]

import { readFile } from "node:fs/promises";
import { classifyStickers } from "../src/scan/colorModel.js";
import { isSolvable, repairScan, randomCube } from "../src/scan/cubeState.js";

const BASE = "https://raw.githubusercontent.com/eyeeco/Rubick-s-Cube-Dataset/master/";
const CONDITIONS = [
  ["A", "cube1_light_labels", "cube A, bright"],
  ["B", "cube1_dark_labels", "cube A, dark"],
  ["C", "cube2_light_labels", "cube B, bright"],
  ["D", "cube2_right_light_labels", "cube B, lit from right"],
  ["E", "cube2_up_light_labels", "cube B, lit from above"],
];

function hsvToRgb(h, s, v) {
  const H = h * 2;
  const S = s / 255;
  const V = v / 255;
  const k = (n) => (n + H / 60) % 6;
  const f = (n) => V - V * S * Math.max(0, Math.min(k(n), 4 - k(n), 1));
  return [f(5) * 255, f(3) * 255, f(1) * 255];
}

async function loadCsv(name, dir) {
  const text = dir
    ? await readFile(`${dir}/${name}.csv`, "utf8")
    : await (await fetch(BASE + name + ".csv")).text();
  const rows = text.trim().split(/\r?\n/).map((line) => line.split(",").map(Number));
  const states = [];
  for (let i = 0; i + 54 <= rows.length; i += 54) states.push(rows.slice(i, i + 54));
  return states;
}

// deterministic PRNG so the stress tests are reproducible
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Phone scanning captures each face in its own frame, so exposure and white
// balance drift between faces: give every face its own random gain and
// per-channel tint
function perFaceDrift(rgbs, rand) {
  const out = [];
  for (let f = 0; f < 6; f++) {
    const gain = 0.7 + 0.6 * rand();
    const tint = [0, 1, 2].map(() => 0.88 + 0.24 * rand());
    for (let i = f * 9; i < f * 9 + 9; i++) {
      out.push(rgbs[i].map((c, ch) => Math.min(255, c * gain * tint[ch])));
    }
  }
  return out;
}

// A logo on one centre: half of the sampled centre patch is dark print
function logoOnCenter(rgbs, rand) {
  const out = rgbs.map((c) => c.slice());
  const center = Math.floor(rand() * 6) * 9 + 4;
  out[center] = out[center].map((c) => 0.5 * c + 0.5 * 30);
  return out;
}

// predicted colour of a sticker = true colour of the centre it was matched to
function scoreState(state, options, perturb) {
  let rgbs = state.map(([h, s, v]) => hsvToRgb(h, s, v));
  if (perturb) rgbs = perturb(rgbs);
  const truth = state.map((row) => row[3]);
  const { faces } = classifyStickers(rgbs, options);
  let correct = 0;
  faces.forEach((f, i) => {
    if (truth[f * 9 + 4] === truth[i]) correct++;
  });
  return { correct, perfect: correct === 54 };
}

const VARIANTS = [
  ["nearest centre", { balanced: false, lighting: false }],
  ["balanced", { lighting: false }],
  ["balanced + refine", { lighting: false, refine: true }],
  ["balanced, CIEDE2000", { lighting: false, metric: "ciede2000" }],
  ["balanced + lighting (default)", {}],
  ["balanced + lighting, prior 2", { lightingPrior: 2 }],
  ["balanced + lighting + refine", { refine: true }],
];

const SCENARIOS = [
  ["dataset as captured", null, 1],
  ["per-face exposure/white-balance drift (x20 trials)", perFaceDrift, 20],
  ["logo on one centre (x20 trials)", logoOnCenter, 20],
];

const dir = process.argv[2];
const data = [];
for (const [key, file] of CONDITIONS) data.push([key, await loadCsv(file, dir)]);

for (const [scenario, perturb, trials] of SCENARIOS) {
  console.log(`\n${scenario}`);
  const header = ["variant".padEnd(32), ...CONDITIONS.map(([k]) => k.padStart(7)), "  total", "  perfect cubes"];
  console.log(header.join(""));
  for (const [label, options] of VARIANTS) {
    const rand = mulberry32(1234);
    let allCorrect = 0, allStickers = 0, allPerfect = 0, allStates = 0;
    const cells = data.map(([, states]) => {
      let correct = 0, perfect = 0;
      for (let t = 0; t < trials; t++) {
        for (const state of states) {
          const r = scoreState(state, options, perturb && ((rgbs) => perturb(rgbs, rand)));
          correct += r.correct;
          perfect += r.perfect;
        }
      }
      const n = states.length * trials;
      allCorrect += correct;
      allStickers += n * 54;
      allPerfect += perfect;
      allStates += n;
      return ((100 * correct) / (n * 54)).toFixed(2).padStart(7);
    });
    const total = ((100 * allCorrect) / allStickers).toFixed(2).padStart(7);
    console.log(label.padEnd(32) + cells.join("") + total + `  ${allPerfect}/${allStates}`.padStart(15));
  }
}
// End to end: random solvable cubes painted with real stickers drawn from
// the dataset (same lighting condition), per-face drift applied, then
// classify and repair. "wrong but solvable" is the failure that matters most:
// the scan would be accepted and solved as the wrong cube.
console.log("\nend to end on synthetic cubes with per-face drift (500 per condition)");
console.log("condition".padEnd(26) + "classified".padStart(12) + "after repair".padStart(14) + "wrong but solvable".padStart(20));
for (const [i, [key, , description]] of CONDITIONS.entries()) {
  const pool = [[], [], [], [], [], []];
  for (const state of data[i][1]) for (const row of state) pool[row[3]].push(row);
  const rand = mulberry32(99 + i);
  let classified = 0, repaired = 0, wrongSolvable = 0;
  const trials = 500;
  for (let t = 0; t < trials; t++) {
    const truth = randomCube(rand);
    const colorOfFace = [0, 1, 2, 3, 4, 5].sort(() => rand() - 0.5);
    let rgbs = truth.map((f) => {
      const p = pool[colorOfFace[f]];
      const [h, s, v] = p[Math.floor(rand() * p.length)];
      return hsvToRgb(h, s, v);
    });
    rgbs = perFaceDrift(rgbs, rand);
    const { faces, distances } = classifyStickers(rgbs);
    const exact = (cand) => cand.every((f, j) => f === truth[j]);
    if (exact(faces)) classified++;
    const result = isSolvable(faces) ? { faces } : repairScan(faces, distances);
    if (result && exact(result.faces)) repaired++;
    else if (result) wrongSolvable++;
  }
  const pct = (n) => ((100 * n) / trials).toFixed(1).padStart(10) + "%";
  console.log(`${key} ${description}`.padEnd(26) + pct(classified).padStart(12) + pct(repaired).padStart(14) + pct(wrongSolvable).padStart(20));
}

console.log("\nPublished on the unmodified dataset (arXiv:1901.03470, Table 2): KNN 86.45, WLHP* 96.22, DWLP 97.63 total");
console.log("5 of the 116 states have inconsistent labels (a colour counted 8 or 10 times), so a balanced model tops out at 111/116 perfect.");
