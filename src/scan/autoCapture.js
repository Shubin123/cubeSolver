// Auto-capture for the camera scanner: decides from the sampled guide square
// whether a cube face fills the grid, whether it is holding still and whether
// it is a face that hasn't been scanned yet.

import { rgbToLab, labDistance } from "./colorModel.js";

const SEAM_REACH = 0.22; // how far either side of a grid line to look for the seam, in cells
const SEAM_DEPTH = 0.1; // a seam is at least this much darker than the stickers beside it
const STEP_COLOR = 30; // Lab units; neighbours this different need no visible seam
const MIN_SEAMS = 10; // of the 12 lines between stickers
const MAX_SPREAD = 22; // mean deviation from a sticker's median colour, sRGB units
const MIN_EVEN = 7; // of the 8 stickers around the centre, which may carry a logo
const MIN_BRIGHT = 30; // darker than this is plastic or background, not a sticker
const MIN_LIT = 8; // of the 9 stickers

const HOLD_FRAMES = 7; // still frames before capturing, about 0.6 s
const STILL_COLOR = 10; // Lab units a sticker may drift during the hold
const MIN_STILL = 8; // of the 9 stickers, so a moving glare spot doesn't restart the hold
const SAME_COLOR = 15; // Lab units; the same sticker seen again is closer than this
const MIN_SAME = 6; // of the 8 stickers around the centre
const MOVED_COLOR = 20; // Lab units a sticker changes when the cube has really moved
const MIN_MOVED = 3; // of the 9 stickers

export const BACK_COOLDOWN = 15; // frames to wait after Back, about 1.2 s

// Averaging the channels rather than taking the largest shows the faint seams
// of stickerless cubes, where one channel stays near full between the pieces
const brightness = (r, g, b) => (r + g + b) / 3;
const lab = (rgb) => rgbToLab(...rgb);
const toLabs = (samples) => samples.map(lab);

function median(values) {
  values.sort((a, b) => a - b);
  return values[values.length >> 1];
}

// How far the pixels in the middle of a cell stray from its median colour
function cellSpread(data, size, row, col) {
  const cell = size / 3;
  const from = (k) => Math.floor((k + 0.25) * cell);
  const to = (k) => Math.ceil((k + 0.75) * cell);
  const channels = [[], [], []];
  for (let y = from(row); y < to(row); y++) {
    for (let x = from(col); x < to(col); x++) {
      const k = (y * size + x) * 4;
      for (let ch = 0; ch < 3; ch++) channels[ch].push(data[k + ch]);
    }
  }
  return channels.reduce((total, values) => {
    const mid = median(values);
    return total + values.reduce((acc, v) => acc + Math.abs(v - mid), 0) / values.length;
  }, 0) / 3;
}

// Darkest line near a grid line, averaged along it so a tilted or slightly
// misplaced cube still shows its seam
function seamBrightness(data, size, line, start, vertical) {
  const cell = size / 3;
  const reach = Math.round(cell * SEAM_REACH);
  const from = Math.round(start + cell * 0.2);
  const to = Math.round(start + cell * 0.8);
  let lowest = Infinity;
  for (let d = -reach; d <= reach; d++) {
    let sum = 0;
    for (let a = from; a < to; a++) {
      const k = (vertical ? a * size + line + d : (line + d) * size + a) * 4;
      sum += brightness(data[k], data[k + 1], data[k + 2]);
    }
    lowest = Math.min(lowest, sum / (to - from));
  }
  return lowest;
}

// Is there a boundary between two neighbouring stickers: a seam darker than
// both, or a clear change of colour?
function hasSeam(data, size, samples, labs, a, b, vertical) {
  if (labDistance(labs[a], labs[b]) >= STEP_COLOR) return true;
  const cell = size / 3;
  const line = Math.round((vertical ? (a % 3) + 1 : Math.floor(a / 3) + 1) * cell);
  const start = (vertical ? Math.floor(a / 3) : a % 3) * cell;
  const level = Math.min(brightness(...samples[a]), brightness(...samples[b]));
  return seamBrightness(data, size, line, start, vertical) <= level * (1 - SEAM_DEPTH);
}

const SEAM_PAIRS = [
  [0, 1, true], [1, 2, true], [3, 4, true], [4, 5, true], [6, 7, true], [7, 8, true],
  [0, 3, false], [1, 4, false], [2, 5, false], [3, 6, false], [4, 7, false], [5, 8, false],
];

export function measureFace(data, size, samples) {
  const labs = toLabs(samples);
  let even = 0;
  for (let i = 0; i < 9; i++) {
    if (i !== 4 && cellSpread(data, size, Math.floor(i / 3), i % 3) <= MAX_SPREAD) even++;
  }
  const seams = SEAM_PAIRS.filter(([a, b, vertical]) => hasSeam(data, size, samples, labs, a, b, vertical)).length;
  const lit = samples.filter((rgb) => Math.max(...rgb) >= MIN_BRIGHT).length;
  return { seams, even, lit };
}

// data: RGBA pixels of the guide square, size x size. samples: the median
// colour of each of its nine cells.
export function looksLikeFace(data, size, samples) {
  const { seams, even, lit } = measureFace(data, size, samples);
  return seams >= MIN_SEAMS && even >= MIN_EVEN && lit >= MIN_LIT;
}

const countClose = (a, b, limit, indices) => indices.filter((i) => labDistance(a[i], b[i]) < limit).length;
const ALL = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const AROUND_CENTER = [0, 1, 2, 3, 5, 6, 7, 8];
const quarterTurn = (g) => [6, 3, 0, 7, 4, 1, 8, 5, 2].map((i) => g[i]);
const total = (samples) => samples.flat().reduce((sum, c) => sum + c, 0);

// A face is identified by its centre and the stickers around it, at any of
// the four ways it can be held. Comparing all of them rather than the centre
// alone means two faces with similar centres (red and orange) still count as
// different on a scrambled cube.
export function isSameFace(a, b) {
  const labsA = toLabs(a);
  // exposure often shifts between two looks at a face. One gain for all the
  // channels, since a gain per channel could turn red into orange.
  const gain = total(a) / total(b);
  let turned = toLabs(b.map((rgb) => rgb.map((c) => Math.min(255, c * gain))));
  if (labDistance(labsA[4], turned[4]) >= SAME_COLOR) return false;
  for (let turn = 0; turn < 4; turn++) {
    if (countClose(labsA, turned, SAME_COLOR, AROUND_CENTER) >= MIN_SAME) return true;
    turned = quarterTurn(turned);
  }
  return false;
}

// Follows the frames one at a time. update() returns the state to show:
// "search"  nothing that looks like a face in the grid
// "turn"    still looking at the face that was just captured
// "seen"    a face that's already scanned
// "hold"    a new face, holding still (progress runs from 0 to 1)
// "ready"   capture this frame
export function createFaceTracker() {
  let anchor = null; // the first frame of the current still run
  let run = 0;
  let captured = null; // blocks the next capture until the cube moves off it
  let cooldown = 0;

  const restart = (labs) => {
    anchor = labs;
    run = labs ? 1 : 0;
  };

  return {
    update(samples, isFace, known) {
      const labs = toLabs(samples);
      if (cooldown > 0) {
        cooldown--;
        restart(null);
        return { state: "search" };
      }
      if (captured) {
        if (labs.filter((c, i) => labDistance(c, captured[i]) >= MOVED_COLOR).length < MIN_MOVED) {
          return { state: "turn" };
        }
        captured = null;
      }
      if (!isFace) {
        restart(null);
        return { state: "search" };
      }
      if (anchor && countClose(labs, anchor, STILL_COLOR, ALL) >= MIN_STILL) run++;
      else restart(labs);

      if (known.some((face) => isSameFace(samples, face))) return { state: "seen" };
      if (run < HOLD_FRAMES) return { state: "hold", progress: run / HOLD_FRAMES };
      return { state: "ready" };
    },
    captured(samples) {
      captured = toLabs(samples);
      restart(null);
    },
    reset(frames = 0) {
      captured = null;
      cooldown = frames;
      restart(null);
    },
  };
}
