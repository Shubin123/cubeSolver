// Checks for the scanner's auto-capture decisions (src/scan/autoCapture.js)
// on drawn guide squares and scripted frame sequences.
//
//   node scratch/test_auto_capture.js

import assert from "node:assert/strict";
import { looksLikeFace, isSameFace, createFaceTracker, BACK_COOLDOWN } from "../src/scan/autoCapture.js";

const SIZE = 150;
const WHITE = [232, 232, 228], YELLOW = [245, 210, 20], RED = [190, 25, 45];
const ORANGE = [250, 100, 15], GREEN = [10, 155, 75], BLUE = [15, 75, 180];
const COLORS = [WHITE, YELLOW, RED, ORANGE, GREEN, BLUE];
const SCRAMBLED = [RED, WHITE, BLUE, GREEN, YELLOW, ORANGE, BLUE, RED, GREEN];
const OTHER = [ORANGE, GREEN, WHITE, YELLOW, BLUE, RED, WHITE, YELLOW, ORANGE];
const solved = (color) => new Array(9).fill(color);
const turn = (g) => [6, 3, 0, 7, 4, 1, 8, 5, 2].map((i) => g[i]);

function blank(color) {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let k = 0; k < data.length; k += 4) [data[k], data[k + 1], data[k + 2], data[k + 3]] = [...color, 255];
  return data;
}

// A face drawn into the guide square: gap is the seam width in cells, seam its
// colour; offset, scale and background move the cube inside the square
function drawFace(nine, { gap = 0.12, seam = [18, 18, 18], offset = 0, scale = 1, background = [120, 110, 100], logo = false, noise = 8 } = {}) {
  const data = blank(background);
  const pitch = (SIZE / 3) * scale;
  const origin = SIZE / 2 - 1.5 * pitch + offset * (SIZE / 3);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = (x + 0.5 - origin) / pitch;
      const v = (y + 0.5 - origin) / pitch;
      if (u < 0 || v < 0 || u >= 3 || v >= 3) continue;
      const i = Math.floor(v) * 3 + Math.floor(u);
      const fu = u % 1, fv = v % 1;
      const onSeam = Math.min(fu, 1 - fu, fv, 1 - fv) < gap / 2;
      const isLogo = logo && i === 4 && Math.hypot(fu - 0.5, fv - 0.5) < 0.18;
      const color = onSeam ? seam : isLogo ? [30, 30, 30] : nine[i];
      const k = (y * SIZE + x) * 4;
      for (let ch = 0; ch < 3; ch++) data[k + ch] = color[ch];
    }
  }
  for (let k = 0; k < data.length; k += 4) {
    const n = (Math.random() - 0.5) * noise;
    for (let ch = 0; ch < 3; ch++) data[k + ch] += n;
  }
  return data;
}

const isFace = (data, nine) => looksLikeFace(data, SIZE, nine);

// what counts as a face
assert.ok(isFace(drawFace(SCRAMBLED), SCRAMBLED), "black-plastic cube");
assert.ok(isFace(drawFace(SCRAMBLED, { logo: true }), SCRAMBLED), "logo on the centre");
for (const color of COLORS) assert.ok(isFace(drawFace(solved(color)), solved(color)), "solved face");
assert.ok(isFace(drawFace(SCRAMBLED, { offset: 0.1 }), SCRAMBLED), "slightly off-centre");
assert.ok(isFace(drawFace(SCRAMBLED, { scale: 1.05 }), SCRAMBLED), "slightly too close");
// stickerless: neighbours differ, and the seam is only a thin shadow
const faint = { gap: 0.03, seam: [150, 150, 150] };
assert.ok(isFace(drawFace(SCRAMBLED, faint), SCRAMBLED), "stickerless, scrambled");

// and what doesn't
const wall = (color) => [blank(color), solved(color)];
assert.ok(!isFace(...wall([225, 225, 220])), "plain white wall");
assert.ok(!isFace(...wall(RED)), "plain coloured wall");
assert.ok(!isFace(...wall([12, 12, 12])), "dark room");
const gradient = blank([0, 0, 0]);
for (let k = 0; k < gradient.length; k += 4) gradient.fill(90 + (k / gradient.length) * 150, k, k + 3);
const gradientSamples = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
  const level = 90 + (((i - (i % 3)) / 3 + 0.5) / 3) * 150;
  return [level, level, level];
});
assert.ok(!isFace(gradient, gradientSamples), "smooth shading");
const speckle = blank([0, 0, 0]);
for (let k = 0; k < speckle.length; k += 4) speckle.fill(Math.random() * 255, k, k + 3);
assert.ok(!isFace(speckle, solved([128, 128, 128])), "busy texture");
const small = drawFace(SCRAMBLED, { scale: 0.7, background: [120, 110, 100] });
assert.ok(!isFace(small, [...new Array(3).fill([120, 110, 100]), [120, 110, 100], SCRAMBLED[4], [120, 110, 100], ...new Array(3).fill([120, 110, 100])]), "cube far too small");

// recognising a face seen before
const dim = (nine, gain) => nine.map((rgb) => rgb.map((c) => c * gain));
let view = SCRAMBLED;
for (let t = 0; t < 4; t++) {
  assert.ok(isSameFace(view, SCRAMBLED), "same face at any rotation");
  assert.ok(isSameFace(dim(view, 0.75), SCRAMBLED), "same face, darker exposure");
  view = turn(view);
}
assert.ok(!isSameFace(OTHER, SCRAMBLED), "different faces");
assert.ok(!isSameFace(solved(WHITE), solved(YELLOW)), "solved white and yellow");
assert.ok(!isSameFace(solved(RED), solved(ORANGE)), "solved red and orange");
// similar centres alone don't make two scrambled faces the same
assert.ok(!isSameFace([...OTHER.slice(0, 4), RED, ...OTHER.slice(5)], SCRAMBLED));

// the tracker
const STILL_FRAMES = 7;
function hold(tracker, nine, frames, known = [], face = true) {
  const states = [];
  for (let i = 0; i < frames; i++) states.push(tracker.update(nine, face, known).state);
  return states;
}

{
  const t = createFaceTracker();
  assert.deepEqual(hold(t, SCRAMBLED, 3, [], false), ["search", "search", "search"]);
  assert.deepEqual(hold(t, SCRAMBLED, STILL_FRAMES), [...new Array(STILL_FRAMES - 1).fill("hold"), "ready"]);

  // progress climbs through the hold
  const p = createFaceTracker();
  const progress = [1, 2, 3].map(() => p.update(SCRAMBLED, true, []).progress);
  assert.ok(progress[0] < progress[1] && progress[1] < progress[2]);

  // the same face isn't taken twice, even if it stops looking like one for a moment
  t.captured(SCRAMBLED);
  assert.ok(hold(t, SCRAMBLED, 30, [SCRAMBLED]).every((s) => s === "turn"));
  assert.ok(hold(t, SCRAMBLED, 5, [SCRAMBLED], false).every((s) => s === "turn"));

  // a new face after the cube has moved
  assert.deepEqual(hold(t, OTHER, STILL_FRAMES, [SCRAMBLED]), [...new Array(STILL_FRAMES - 1).fill("hold"), "ready"]);
  t.captured(OTHER);

  // coming back to an already scanned face, at any rotation, is refused
  assert.ok(hold(t, turn(SCRAMBLED), 30, [SCRAMBLED, OTHER]).every((s) => s === "seen"));
  assert.notEqual(hold(t, solved(RED), STILL_FRAMES, [SCRAMBLED, OTHER]).pop(), "seen");
}

{
  // a moving cube restarts the hold, one flickering sticker doesn't
  const t = createFaceTracker();
  hold(t, SCRAMBLED, STILL_FRAMES - 2);
  assert.notEqual(t.update(OTHER, true, []).state, "ready");
  assert.deepEqual(hold(t, OTHER, STILL_FRAMES - 1), [...new Array(STILL_FRAMES - 2).fill("hold"), "ready"]);

  const g = createFaceTracker();
  hold(g, SCRAMBLED, STILL_FRAMES - 2);
  const glare = SCRAMBLED.slice();
  glare[0] = [255, 255, 255];
  assert.equal(g.update(glare, true, []).state, "hold");
  assert.equal(g.update(SCRAMBLED, true, []).state, "ready");
}

{
  // losing the face restarts the hold
  const t = createFaceTracker();
  hold(t, SCRAMBLED, STILL_FRAMES - 1);
  assert.equal(t.update(SCRAMBLED, false, []).state, "search");
  assert.deepEqual(hold(t, SCRAMBLED, STILL_FRAMES).pop(), "ready");
}

{
  // Back waits before taking the face that is still being held
  const t = createFaceTracker();
  hold(t, SCRAMBLED, STILL_FRAMES);
  t.captured(SCRAMBLED);
  t.reset(BACK_COOLDOWN);
  assert.ok(hold(t, SCRAMBLED, BACK_COOLDOWN).every((s) => s === "search"));
  assert.equal(hold(t, SCRAMBLED, STILL_FRAMES).pop(), "ready");
}

console.log("all auto-capture checks passed");
