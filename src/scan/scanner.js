// Camera scanner: walks the user through showing each face to the camera,
// samples the nine stickers inside a guide grid, classifies the colours with
// colorModel.js and lets the user review and fix the result before it is
// applied to the 3D cube.

import { classifyStickers, assignBalanced, rgbToLab, labDistance, solveAssignment } from "./colorModel.js";
import { isSolvable, describeProblems, repairScan, arrangeStickers, facesToString } from "./cubeState.js";
import { createFaceTracker, looksLikeFace, BACK_COOLDOWN } from "./autoCapture.js";

const U = 0, R = 1, F = 2, D = 3, L = 4, B = 5;

// Scan order. Side faces are read with the same face kept on top, the top is
// read with the front along the bottom edge and the bottom with the front
// along the top edge: Kociemba's reading order for every face. If the user
// turns the other way between sides, the repair step reorders them.
const STEPS = [
  {
    slot: F,
    title: "Front",
    text: () => [
      "Point any face at the camera and fill the grid with it. Keep the same face on top for the next three faces. White on top with red in front matches the colours in the app.",
    ],
  },
  { slot: R, title: "Side 2", text: () => ["Turn the whole cube a quarter turn so the next side faces the camera. Keep the same face on top."] },
  { slot: B, title: "Side 3", text: () => ["Another quarter turn in the same direction, same face on top."] },
  { slot: L, title: "Side 4", text: () => ["One more quarter turn in the same direction."] },
  {
    slot: U,
    title: "Top",
    text: (chip) => ["Turn back to the first face, then tilt the cube so its top faces the camera, with ", chip(F), " along the bottom edge of the frame."],
  },
  {
    slot: D,
    title: "Bottom",
    text: (chip) => ["Now the bottom face to the camera, with ", chip(F), " along the top edge of the frame."],
  },
];

const GUIDE_FRACTION = 0.6; // guide square side, relative to the shorter video side
const SAMPLE_SIZE = 150; // the guide square is downscaled to this many pixels to sample
const SAMPLE_INTERVAL = 80; // ms between samples
const HISTORY = 5; // recent samples combined into one capture
const LOW_MARGIN = 8; // Lab units; closer calls than this are flagged in the review

const AUTO_STATUS = {
  search: "Fill the grid with a face",
  hold: "Hold still…",
  ready: "Got it. Turn to the next face",
  turn: "Got it. Turn to the next face",
  seen: "That face is already scanned",
};

const NET_POSITION = [[0, 3], [3, 6], [3, 3], [6, 3], [3, 0], [3, 9]]; // [row, col] of each face in the 12x9 net
const COLOR_NAMES = ["white", "yellow", "red", "orange", "green", "blue"];
const REFERENCE_LABS = [
  [235, 235, 235], [250, 215, 40], [190, 30, 45], [250, 110, 20], [20, 160, 80], [20, 80, 190],
].map((rgb) => rgbToLab(...rgb));

let root, video, guide, guideCtx, sampleCtx, stage, message;
let scanView, stepLabel, instructions, progress, backButton, captureButton, switchButton;
let manualTab, autoTab, autoStatus;
let reviewView, net, stickerButtons, statusLine, noteLine, problemList, fixButton, applyButton;

let onApply = null;
let stream = null;
let cameraRequest = 0;
let cameraIds = [];
let rafId = 0;
let lastSample = 0;
let history = [];
let captures = [];
let step = 0;
let returnToReview = false;
let review = null;
let autoMode = localStorage.getItem("scanMode") === "auto";
const tracker = createFaceTracker();

export function openScanner(options) {
  if (!root) buildUI();
  onApply = options.onApply;
  captures = new Array(6).fill(null);
  step = 0;
  returnToReview = false;
  review = null;
  root.classList.add("show");
  showScanView();
}

function closeScanner() {
  stopCamera();
  root.classList.remove("show");
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, onClick) {
  const node = el("button", className, text);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

function buildUI() {
  root = el("div", "scan-overlay");
  // The cube's drag and paint handlers listen on window; keep the scanner's
  // pointer events from reaching them
  ["pointerdown", "pointermove", "pointerup", "wheel"].forEach((type) =>
    root.addEventListener(type, (e) => e.stopPropagation())
  );

  const dialog = el("div", "scan-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", "Scan cube");
  root.appendChild(dialog);

  const header = el("div", "scan-header");
  header.appendChild(el("div", "scan-title", "Scan Cube"));
  stepLabel = el("div", "scan-step");
  header.appendChild(stepLabel);
  const closeButton = button("scan-close", "✕", closeScanner);
  closeButton.setAttribute("aria-label", "Close scanner");
  header.appendChild(closeButton);
  dialog.appendChild(header);

  // Camera view
  scanView = el("div", "scan-view");
  stage = el("div", "scan-stage");
  video = el("video");
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  guide = el("canvas", "scan-guide");
  guideCtx = guide.getContext("2d");
  message = el("div", "scan-message");
  autoStatus = el("div", "scan-auto-status");
  autoStatus.setAttribute("role", "status");
  const modeSwitch = el("div", "scan-mode");
  manualTab = button("", "Manual", () => setMode(false));
  autoTab = button("", "Auto", () => setMode(true));
  autoTab.title = "Capture each face by itself when it's held still";
  modeSwitch.append(manualTab, autoTab);
  stage.append(video, guide, message, autoStatus, modeSwitch);
  scanView.appendChild(stage);

  instructions = el("p", "scan-instructions");
  scanView.appendChild(instructions);
  progress = el("div", "scan-progress");
  scanView.appendChild(progress);

  const scanActions = el("div", "scan-actions");
  backButton = button("scan-btn", "Back", goBack);
  captureButton = button("scan-btn primary", "Capture", capture);
  switchButton = button("scan-btn", "Switch camera", switchCamera);
  scanActions.append(backButton, captureButton, switchButton);
  scanView.appendChild(scanActions);
  dialog.appendChild(scanView);

  // Review view
  reviewView = el("div", "scan-review hidden");
  net = el("div", "scan-net");
  stickerButtons = [];
  for (let i = 0; i < 54; i++) {
    const face = Math.floor(i / 9);
    const [row, col] = NET_POSITION[face];
    const sticker = button("scan-sticker", "", () => onStickerClick(i));
    sticker.style.gridRow = String(row + Math.floor((i % 9) / 3) + 1);
    sticker.style.gridColumn = String(col + (i % 3) + 1);
    if (i % 9 === 4) sticker.classList.add("center");
    net.appendChild(sticker);
    stickerButtons.push(sticker);
  }
  reviewView.appendChild(net);
  statusLine = el("div", "scan-status");
  noteLine = el("div", "scan-note");
  problemList = el("ul", "scan-problems");
  reviewView.append(
    statusLine,
    noteLine,
    problemList,
    el("p", "scan-hint", "Tap a sticker to change its colour. Tap a centre to rescan that face. Dashed outlines are close calls worth checking.")
  );
  const reviewActions = el("div", "scan-actions");
  fixButton = button("scan-btn", "Auto-fix", () => {
    autoFix();
    renderReview();
  });
  applyButton = button("scan-btn primary", "Apply to cube", applyScan);
  reviewActions.append(button("scan-btn", "Start over", () => openScanner({ onApply })), fixButton, applyButton);
  reviewView.appendChild(reviewActions);
  dialog.appendChild(reviewView);

  const sampleCanvas = el("canvas");
  sampleCanvas.width = SAMPLE_SIZE;
  sampleCanvas.height = SAMPLE_SIZE;
  sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });

  window.addEventListener("keydown", (e) => {
    if (!root.classList.contains("show")) return;
    if (e.key === "Escape") {
      closeScanner();
    } else if ((e.key === " " || e.key === "Enter") && !review && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      capture();
    }
  });

  renderMode();
  document.body.appendChild(root);
}

// ---- Camera ---------------------------------------------------------------

function showMessage(text) {
  message.textContent = text;
  message.classList.toggle("hidden", !text);
}

function cameraErrorText(err) {
  switch (err && err.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera access was blocked. Allow the camera for this site in your browser settings, then reopen the scanner.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera was found on this device.";
    case "NotReadableError":
      return "The camera is busy in another app. Close it there and reopen the scanner.";
    default:
      return `Could not start the camera${err && err.message ? `: ${err.message}` : "."}`;
  }
}

async function startCamera(deviceId) {
  stopCamera();
  const request = ++cameraRequest;
  captureButton.disabled = true;
  autoStatus.textContent = "";
  showMessage("Starting camera…");

  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showMessage("The camera needs this page to be opened over HTTPS or from localhost.");
    return;
  }

  const constraints = { width: { ideal: 1280 }, height: { ideal: 720 } };
  if (deviceId) constraints.deviceId = { exact: deviceId };
  else constraints.facingMode = { ideal: "environment" };

  let media;
  try {
    media = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
  } catch (err) {
    if (request === cameraRequest) showMessage(cameraErrorText(err));
    return;
  }
  // closed, moved to the review or switched camera while waiting for permission
  if (request !== cameraRequest) {
    media.getTracks().forEach((t) => t.stop());
    return;
  }

  stream = media;
  video.srcObject = media;
  try {
    await video.play();
  } catch (err) {
    // autoplay of a muted stream is allowed everywhere we care about
  }
  if (!video.videoWidth) await new Promise((resolve) => video.addEventListener("loadedmetadata", resolve, { once: true }));
  if (request !== cameraRequest) return;

  const settings = media.getVideoTracks()[0].getSettings();
  // front cameras (and laptop webcams, which report no facing mode) are shown
  // mirrored like a selfie view; the pixels are still read unmirrored
  stage.classList.toggle("mirrored", settings.facingMode !== "environment");
  stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
  guide.width = video.videoWidth;
  guide.height = video.videoHeight;
  showMessage("");
  captureButton.disabled = false;

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    cameraIds = devices.filter((d) => d.kind === "videoinput" && d.deviceId).map((d) => d.deviceId);
  } catch (err) {
    cameraIds = [];
  }
  switchButton.hidden = cameraIds.length < 2;
  switchButton.dataset.current = settings.deviceId || "";

  history = [];
  tracker.reset();
  rafId = requestAnimationFrame(tick);
}

function stopCamera() {
  cameraRequest++;
  cancelAnimationFrame(rafId);
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  if (video) video.srcObject = null;
}

function switchCamera() {
  if (cameraIds.length < 2) return;
  const current = cameraIds.indexOf(switchButton.dataset.current);
  startCamera(cameraIds[(current + 1) % cameraIds.length]);
}

function tick(now) {
  rafId = requestAnimationFrame(tick);
  if (!stream || video.readyState < 2 || now - lastSample < SAMPLE_INTERVAL) return;
  lastSample = now;
  const samples = sampleGrid();
  history.push(samples);
  if (history.length > HISTORY) history.shift();
  const status = autoMode ? trackFace(samples) : null;
  if (status?.state === "ready") capture();
  else drawGuide(samples, status);
}

function trackFace(samples) {
  const { data } = sampleCtx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  // a face being rescanned is allowed to match its old capture
  const known = captures.filter((c, slot) => c && slot !== STEPS[step].slot);
  const status = tracker.update(samples, looksLikeFace(data, SAMPLE_SIZE, samples), known);
  const text = AUTO_STATUS[status.state];
  if (autoStatus.textContent !== text) autoStatus.textContent = text;
  return status;
}

function setMode(auto) {
  autoMode = auto;
  localStorage.setItem("scanMode", auto ? "auto" : "manual");
  tracker.reset();
  renderMode();
}

function renderMode() {
  manualTab.setAttribute("aria-pressed", String(!autoMode));
  autoTab.setAttribute("aria-pressed", String(autoMode));
  captureButton.textContent = autoMode ? "Capture now" : "Capture";
  autoStatus.textContent = "";
}

function guideRect() {
  const w = video.videoWidth;
  const h = video.videoHeight;
  const size = Math.round(Math.min(w, h) * GUIDE_FRACTION);
  return { x: Math.round((w - size) / 2), y: Math.round((h - size) / 2), size };
}

function median(values) {
  values.sort((a, b) => a - b);
  return values[values.length >> 1];
}

// Median colour of each of the nine cells, read from the middle of the cell
// so a slightly misaligned cube still samples the right sticker
function sampleGrid() {
  const { x, y, size } = guideRect();
  sampleCtx.drawImage(video, x, y, size, size, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  const { data } = sampleCtx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  const cell = SAMPLE_SIZE / 3;
  const samples = [];
  for (let i = 0; i < 9; i++) {
    const cx = ((i % 3) + 0.5) * cell;
    const cy = (Math.floor(i / 3) + 0.5) * cell;
    // centre stickers often carry a logo, so read a ring around the middle
    const [inner, outer] = i === 4 ? [0.27, 0.42] : [0, 0.25];
    const r = [], g = [], b = [];
    for (let py = Math.floor(cy - outer * cell); py < cy + outer * cell; py++) {
      for (let px = Math.floor(cx - outer * cell); px < cx + outer * cell; px++) {
        const d = Math.max(Math.abs(px + 0.5 - cx), Math.abs(py + 0.5 - cy)) / cell;
        if (d < inner || d > outer) continue;
        const k = (py * SAMPLE_SIZE + px) * 4;
        r.push(data[k]);
        g.push(data[k + 1]);
        b.push(data[k + 2]);
      }
    }
    samples.push([median(r), median(g), median(b)]);
  }
  return samples;
}

function drawGuide(samples, status) {
  const { x, y, size } = guideRect();
  const ctx = guideCtx;
  const cell = size / 3;
  ctx.clearRect(0, 0, guide.width, guide.height);

  ctx.fillStyle = "rgba(8, 10, 22, 0.55)";
  ctx.beginPath();
  ctx.rect(0, 0, guide.width, guide.height);
  ctx.rect(x, y, size, size);
  ctx.fill("evenodd");

  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.lineWidth = Math.max(2, size / 160);
  ctx.strokeRect(x, y, size, size);
  ctx.beginPath();
  for (let k = 1; k < 3; k++) {
    ctx.moveTo(x + k * cell, y);
    ctx.lineTo(x + k * cell, y + size);
    ctx.moveTo(x, y + k * cell);
    ctx.lineTo(x + size, y + k * cell);
  }
  ctx.stroke();

  // live reading of each cell, in its corner so the sticker stays visible
  samples.forEach(([r, g, b], i) => {
    ctx.beginPath();
    ctx.arc(x + ((i % 3) + 0.2) * cell, y + (Math.floor(i / 3) + 0.2) * cell, cell * 0.1, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fill();
    ctx.stroke();
  });

  // Auto mode: the rim fills in while a new face holds still, and turns amber
  // on a face that's already scanned
  if (status?.state === "hold" || status?.state === "seen") {
    ctx.save();
    ctx.lineWidth = Math.max(4, size / 70);
    ctx.strokeStyle = status.state === "hold" ? "#34d399" : "#fbbf24";
    if (status.state === "hold") ctx.setLineDash([4 * size * status.progress, 4 * size]);
    ctx.strokeRect(x, y, size, size);
    ctx.restore();
  }
}

// ---- Scanning steps -------------------------------------------------------

function rgbCss([r, g, b]) {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

function chip(slot) {
  const capture = captures[slot];
  if (!capture) return "the first face";
  const node = el("span", "scan-chip");
  node.style.background = rgbCss(capture[4]);
  node.title = "the first face you scanned";
  return node;
}

function showScanView() {
  review = null;
  reviewView.classList.add("hidden");
  scanView.classList.remove("hidden");
  renderStep();
  startCamera();
}

function renderStep() {
  const current = STEPS[step];
  stepLabel.textContent = returnToReview ? `Rescan: ${current.title}` : `Face ${step + 1} of 6 · ${current.title}`;
  instructions.replaceChildren(...current.text(chip));
  backButton.textContent = returnToReview ? "Back to review" : "Back";
  backButton.disabled = !returnToReview && step === 0;

  progress.replaceChildren(
    ...STEPS.map((s, index) => {
      const thumb = el("div", "scan-thumb");
      thumb.classList.toggle("active", index === step);
      const capture = captures[s.slot];
      for (let i = 0; i < 9; i++) {
        const cell = el("span");
        if (capture) cell.style.background = rgbCss(capture[i]);
        thumb.appendChild(cell);
      }
      thumb.title = s.title;
      return thumb;
    })
  );
}

function capture() {
  if (!stream || history.length === 0) return;
  // per-channel median over the last few samples smooths out sensor noise
  const samples = history[0].map((_, i) => [0, 1, 2].map((ch) => median(history.map((h) => h[i][ch]))));
  captures[STEPS[step].slot] = samples;
  history = [];
  tracker.captured(samples);

  stage.classList.remove("flash");
  void stage.offsetWidth;
  stage.classList.add("flash");

  if (returnToReview || captures.every(Boolean)) {
    returnToReview = false;
    showReview();
    return;
  }
  step = STEPS.findIndex((s) => !captures[s.slot]);
  renderStep();
}

function goBack() {
  if (returnToReview) {
    returnToReview = false;
    showReview();
    return;
  }
  if (step === 0) return;
  step--;
  captures[STEPS[step].slot] = null;
  tracker.reset(BACK_COOLDOWN);
  renderStep();
}

// ---- Review ---------------------------------------------------------------

function showReview() {
  stopCamera();
  scanView.classList.add("hidden");
  reviewView.classList.remove("hidden");
  stepLabel.textContent = "Check the scan";

  const rgbs = captures.flat();
  const { faces, margins, distances } = classifyStickers(rgbs);
  // pins: stickers the user corrected by hand (index -> face)
  review = { rgbs, faces, margins, distances, pins: new Map(), changed: new Set(), note: "" };
  if (!isSolvable(faces)) autoFix();
  renderReview();
}

// Colour names for the six centres, matched one-to-one to typical sticker
// colours (only used for wording; classification never relies on them)
function centerNames() {
  const centers = [0, 1, 2, 3, 4, 5].map((f) => rgbToLab(...review.rgbs[f * 9 + 4]));
  const assignment = solveAssignment(centers.map((lab) => REFERENCE_LABS.map((ref) => labDistance(lab, ref))));
  return Array.from(assignment, (k) => COLOR_NAMES[k]);
}

function autoFix() {
  const before = review.faces;

  // Re-solve the colours around the user's corrections first: fixing one
  // sticker usually means another one was misread the opposite way
  if (review.pins.size) {
    const rebalanced = assignBalanced(review.distances, review.pins);
    if (isSolvable(rebalanced)) {
      review.faces = rebalanced;
      review.changed = new Set(rebalanced.map((f, i) => (f !== before[i] ? i : -1)).filter((i) => i >= 0));
      review.note = review.changed.size ? "Adjusted the highlighted stickers to fit your corrections." : "";
      return;
    }
  }

  const fix = repairScan(review.faces, review.distances);
  if (!fix) {
    review.note = "Couldn't fix this automatically. Check the outlined stickers, or tap a centre to rescan that face.";
    return;
  }
  const notes = [];
  if (fix.perm[R] !== R) notes.push("The side faces were scanned turning the other way, so they were reordered.");
  if (fix.perm[U] !== U) notes.push("The top and bottom were swapped, so they were reordered.");

  // move the captured colours the same way so everything stays aligned
  const moved = fix.perm.some((p, f) => p !== f) || fix.rotations.some(Boolean);
  if (moved) {
    review.rgbs = arrangeStickers(review.rgbs, fix);
    for (let f = 0; f < 6; f++) captures[f] = review.rgbs.slice(f * 9, f * 9 + 9);
    const reclassified = classifyStickers(review.rgbs);
    review.margins = reclassified.margins;
    review.distances = reclassified.distances;
    review.pins = new Map();
  }
  review.faces = fix.faces;

  const names = centerNames();
  fix.rotations.forEach((turns, f) => {
    if (turns) notes.push(`Turned the ${names[f]} face ${turns === 2 ? "180°" : "90°"} to match its neighbours.`);
  });
  if (fix.swapped.length) notes.push(`Swapped ${fix.swapped.length} similar-looking stickers (highlighted).`);
  review.changed = new Set(fix.swapped);
  review.note = notes.join(" ");
}

function renderReview() {
  const { faces, margins, rgbs, changed } = review;
  const names = centerNames();
  const solvable = isSolvable(faces);
  const problems = solvable ? [] : describeProblems(faces, names);
  const problemStickers = new Set(problems.flatMap((p) => p.stickers));

  stickerButtons.forEach((sticker, i) => {
    const face = faces[i];
    sticker.style.background = rgbCss(rgbs[face * 9 + 4]);
    const isCenter = i % 9 === 4;
    sticker.classList.toggle("low", !isCenter && margins[i] < LOW_MARGIN);
    sticker.classList.toggle("changed", changed.has(i));
    sticker.classList.toggle("problem", problemStickers.has(i));
    sticker.title = isCenter ? `Rescan the ${names[face]} face` : `${names[face]} (tap to change)`;
    sticker.setAttribute("aria-label", sticker.title);
  });

  statusLine.className = `scan-status ${solvable ? "ok" : "bad"}`;
  statusLine.textContent = solvable ? "✓ Valid cube, ready to apply" : "This isn't a valid cube yet";
  noteLine.textContent = review.note;
  noteLine.classList.toggle("hidden", !review.note);
  problemList.replaceChildren(...problems.slice(0, 4).map((p) => el("li", "", p.message)));
  fixButton.hidden = solvable;
  applyButton.disabled = !solvable;
}

function onStickerClick(i) {
  const face = Math.floor(i / 9);
  if (i % 9 === 4) {
    returnToReview = true;
    step = STEPS.findIndex((s) => s.slot === face);
    showScanView();
    return;
  }
  // cycle through the colours from most to least likely for this sticker
  const order = [0, 1, 2, 3, 4, 5].sort((a, b) => review.distances[i][a] - review.distances[i][b]);
  review.faces[i] = order[(order.indexOf(review.faces[i]) + 1) % 6];
  review.pins.set(i, review.faces[i]);
  review.changed.delete(i);
  review.note = "";
  renderReview();
}

function applyScan() {
  if (!review || !isSolvable(review.faces)) return;
  if (onApply(facesToString(review.faces)) !== false) closeScanner();
}
