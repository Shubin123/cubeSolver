// just three imports...
import * as THREE from "three";
import { Vector2 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GlitchPass } from "three/examples/jsm/postprocessing/GlitchPass.js";
import { RenderPixelatedPass } from "three/examples/jsm/postprocessing/RenderPixelatedPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

import Cube from "cubejs";

import {
  onPointerDown,
  onPointerMove,
  onPointerUp,
  updateMoveHistory,
  turnLayer,
} from "./update/mouse.js";

import { updateBloomHighlight, extraBloomCallback } from "./update/light.js";
import { openScanner } from "./scan/scanner.js";
import { isSolvable, describeProblems, FACE_LETTERS } from "./scan/cubeState.js";
import { warmUpSolver, solveFacelets } from "./solver/solver.js";
import {
  FACE_LAYERS,
  moveAngle,
  invertMoves,
  simplifyMoves,
  randomScramble,
  isMove,
} from "./solver/moves.js";

// Constants for cube dimensions
const CUBE_SIZE = 3; // 3x3x3 standard Rubik's cube
const CUBIE_SIZE = 0.2; // Size of each small cube
const GAP = 0.01; // Gap between cubies

// Colors for cube faces
const COLORS = {
  WHITE: 0xffffff, // Light pastel blue (UP)
  RED: 0x6666ff, // Light blue (RIGHT)
  BLUE: 0xff9999, // Light red (FRONT)
  ORANGE: 0x99ff99, // Light green (Left)
  GREEN: 0xffcc99, // Light orange (Back)
  YELLOW: 0xffff99, // Light yellow (normalized)
  BLACK: 0x777777, // Light gray (normalized, not pure black)
};

// Rendering components
let camera;
let scene;
let renderer;
let composer;
let controls;
let bloomPass;
let glitchPass;
let pixelPass;
// let lastClickedFace = -1;

const SOLVED_STATE = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";
const DEFAULT_STATE = "FFBFULFLRBBUDRDLRFLFDLFFBRULDBUDBRLLUUUULUFBDRRRBBRDDD";
// Sticker color and position of each face, in U R F D L B order
const FACE_COLOR_NAMES = ["White", "Blue", "Red", "Yellow", "Green", "Orange"];
const FACE_POSITIONS = ["top", "right", "front", "bottom", "left", "back"];
// Sticker color of each face. Scanning a real cube swaps in its own colors
// until Reset Colors brings these back.
const DEFAULT_FACE_COLORS = {
  U: COLORS.WHITE,
  R: COLORS.RED,
  F: COLORS.BLUE,
  D: COLORS.YELLOW,
  L: COLORS.ORANGE,
  B: COLORS.GREEN,
};
// Paint buttons in palette order: white, red, blue, orange, green, yellow
const PAINT_LETTERS = ["U", "F", "R", "B", "L", "D"];

// Cube components
let cubeGroup; // Holds the entire Rubik's cube
let layers = []; // Groups for each rotatable layer
let isSolving = false; // waiting for the solver
let isScrambling = false;
let isAnimating = false; // a face turn is animating or queued
let cubiePool = [];
let cubeString = SOLVED_STATE;
let faceColors = DEFAULT_FACE_COLORS;
let faceColorNames = FACE_COLOR_NAMES;
let cubiesContainer;
let cubeGeneration = 0; // bumped on every rebuild, abandoning turns in flight
let pendingTurns = 0;
let turnQueue = Promise.resolve();

// UI Components
let moveHistory = [];
let solveButton;
let scrambleButton;
let scanButton;
let extraBloomButton;
let resetButton;
let rotateButton;
let resetColorsButton;
let historyDiv;
let colorSelect;
let paintLetter = null; // face color being painted, null in rotate mode
let paintButtons = [];
let paintStatusBadge;
let rotateModeButton;

let alertOverlay;
let alertTitleElement;
let alertBodyElement;
let alertCloseButton;

let scrubberContainer;
let scrubberSlider;
let scrubberLabel;
let scrubberPlayBtn;
let scrubberPrevBtn;
let scrubberNextBtn;
let scrubberCloseBtn;

// The solution being shown: `step` counts the moves applied or animating
const solution = { open: false, start: null, moves: [], step: 0, playing: false, history: [] };
let playToken = 0; // bumped to stop the play loop
let playbackSpeedMultiplier = 1.0;

// The facelets are the cube's state. The move history is kept alongside so
// the solver can also try undoing it.
function saveCubeStateToStorage() {
  const state = getCubeStateString();
  if (!state) return; // a turn is still settling
  localStorage.setItem("savedCubeState", state);
  localStorage.setItem("moveHistory", JSON.stringify(moveHistory));
  localStorage.removeItem("hasPainted");
}
window.saveCubeStateToStorage = saveCubeStateToStorage;

function applyMovesInstantly(moves) {
  moves.forEach((move) => {
    turnLayer(FACE_LAYERS[move[0]], moveAngle(move), 0, layers, cubeGroup, scene, cubiesContainer);
  });
}

// Animate a face turn once any turns queued before it have finished.
// Resolves false if the cube was rebuilt first, abandoning the turn.
function animateMove(move, duration) {
  const generation = cubeGeneration;
  pendingTurns++;
  isAnimating = true;
  turnQueue = turnQueue
    .then(
      () =>
        new Promise((resolve) => {
          if (generation !== cubeGeneration) return resolve(false);
          turnLayer(FACE_LAYERS[move[0]], moveAngle(move), duration, layers, cubeGroup, scene, cubiesContainer, resolve);
        })
    )
    .then((done) => {
      pendingTurns--;
      isAnimating = pendingTurns > 0;
      return done;
    });
  return turnQueue;
}

function setCubeState(stateStr) {
  createRubiksCube();
  applySavedCubeState(stateStr);
}

function inputLocked() {
  return isSolving || isScrambling || solution.open;
}

function updateButtons() {
  const locked = inputLocked();
  solveButton.disabled = locked;
  scrambleButton.disabled = locked;
  solveButton.textContent = isSolving ? "Solving…" : "Solve";
}

function applySavedCubeState(stateStr) {
  const faces = [
    { name: "U", dir: new THREE.Vector3(0, 1, 0), getCoords: (i) => ({ gx: i % 3, gy: 2, gz: Math.floor(i / 3) }) },
    { name: "R", dir: new THREE.Vector3(1, 0, 0), getCoords: (i) => ({ gx: 2, gy: 2 - Math.floor(i / 3), gz: 2 - (i % 3) }) },
    { name: "F", dir: new THREE.Vector3(0, 0, 1), getCoords: (i) => ({ gx: i % 3, gy: 2 - Math.floor(i / 3), gz: 2 }) },
    { name: "D", dir: new THREE.Vector3(0, -1, 0), getCoords: (i) => ({ gx: i % 3, gy: 0, gz: 2 - Math.floor(i / 3) }) },
    { name: "L", dir: new THREE.Vector3(-1, 0, 0), getCoords: (i) => ({ gx: 0, gy: 2 - Math.floor(i / 3), gz: i % 3 }) },
    { name: "B", dir: new THREE.Vector3(0, 0, -1), getCoords: (i) => ({ gx: 2 - (i % 3), gy: 2 - Math.floor(i / 3), gz: 0 }) }
  ];

  let charIdx = 0;
  for (const face of faces) {
    for (let i = 0; i < 9; i++) {
      const char = stateStr[charIdx++];
      const colorHex = faceColors[char] !== undefined ? faceColors[char] : COLORS.BLACK;
      
      const { gx, gy, gz } = face.getCoords(i);
      const cubie = getCubieAt(gx, gy, gz);
      if (cubie) {
        const mat = getFaceletColor(cubie, face.dir);
        if (mat) {
          mat.color.set(colorHex);
        }
      }
    }
  }
}

// A 54-letter facelet string from the camera scanner replaces the cube, the
// same way a painted cube is stored, and the real cube's colors replace the
// sticker colors
function applyScannedState(stateStr, scannedColors) {
  if (isSolving || isScrambling) return false;
  if (solution.open) {
    hideScrubber();
  }

  moveHistory = [];
  updateMoveHistory(historyDiv, moveHistory);
  setFaceColors(scannedPalette(scannedColors.rgbs), scannedColors.names);
  setCubeState(stateStr);
  saveCubeStateToStorage();
  return true;
}

// Stickers are told apart by their exact color, so each face needs its own
// hex value, different from the inside of the cube
function scannedPalette(rgbs) {
  const used = new Set([COLORS.BLACK]);
  const colors = {};
  rgbs.forEach(([r, g, b], f) => {
    let hex = (r << 16) | (g << 8) | b;
    while (used.has(hex)) hex = (hex + 1) % 0x1000000;
    used.add(hex);
    colors[FACE_LETTERS[f]] = hex;
  });
  return colors;
}

// Repaint the stickers in new colors without touching the cube's state,
// including cubies in a layer that is mid-turn
function setFaceColors(colors, names) {
  const swap = new Map(FACE_LETTERS.split("").map((letter) => [faceColors[letter], colors[letter]]));
  cubeGroup.traverse((object) => {
    if (!object.userData.isCubie) return;
    object.material.forEach((material) => {
      const hex = swap.get(material.color.getHex());
      if (hex !== undefined) material.color.set(hex);
    });
  });
  faceColors = colors;
  faceColorNames = names;
  if (colors === DEFAULT_FACE_COLORS) localStorage.removeItem("faceColors");
  else localStorage.setItem("faceColors", JSON.stringify({ colors, names }));
  updatePaintColors();
}

function loadFaceColorsFromStorage() {
  try {
    const saved = JSON.parse(localStorage.getItem("faceColors"));
    if (saved && FACE_LETTERS.split("").every((letter) => Number.isInteger(saved.colors[letter])) && saved.names.length === 6) {
      faceColors = saved.colors;
      faceColorNames = saved.names;
    }
  } catch (e) {
    // unreadable colors, keep the defaults
  }
}

function loadCubeStateFromStorage() {
  let savedHistory = [];
  try {
    savedHistory = JSON.parse(localStorage.getItem("moveHistory")) || [];
  } catch (e) {
    // unreadable history, start without one
  }
  if (!Array.isArray(savedHistory) || !savedHistory.every(isMove)) savedHistory = [];
  const savedCubeState = localStorage.getItem("savedCubeState");
  // older saves kept either the moves made since the cube was solved or,
  // once it had been painted, only the stickers
  const legacyMode = localStorage.getItem("hasPainted");

  if (legacyMode === "false") {
    applyMovesInstantly(savedHistory);
  } else if (savedCubeState && savedCubeState.length === 54) {
    if (legacyMode === "true") savedHistory = [];
    applySavedCubeState(savedCubeState);
  } else {
    savedHistory = [];
    applySavedCubeState(DEFAULT_STATE);
  }
  moveHistory = savedHistory;
  updateMoveHistory(historyDiv, moveHistory);
  saveCubeStateToStorage();
}

function setupScrubber() {
  scrubberContainer = document.createElement("div");
  scrubberContainer.className = "scrubber-panel hidden";
  
  const title = document.createElement("div");
  title.className = "scrubber-title";
  title.textContent = "Solution Steps";
  scrubberContainer.appendChild(title);
  
  scrubberLabel = document.createElement("div");
  scrubberLabel.className = "scrubber-label";
  scrubberLabel.textContent = "Step 0 / 0: Scrambled State";
  scrubberContainer.appendChild(scrubberLabel);
  
  const sliderRow = document.createElement("div");
  sliderRow.className = "slider-row";
  
  scrubberSlider = document.createElement("input");
  scrubberSlider.type = "range";
  scrubberSlider.className = "scrubber-slider";
  scrubberSlider.min = 0;
  scrubberSlider.max = 0;
  scrubberSlider.value = 0;
  sliderRow.appendChild(scrubberSlider);
  scrubberContainer.appendChild(sliderRow);
  
  const settingsRow = document.createElement("div");
  settingsRow.className = "settings-row";
  
  const speedLabel = document.createElement("span");
  speedLabel.className = "speed-label";
  speedLabel.textContent = "Speed: ";
  settingsRow.appendChild(speedLabel);
  
  const speedSelect = document.createElement("select");
  speedSelect.className = "speed-select";
  
  const speeds = [
    { name: "0.25x (Very Slow)", val: 4.0 },
    { name: "0.5x (Slow)", val: 2.0 },
    { name: "1x (Normal)", val: 1.0 },
    { name: "2x (Fast)", val: 0.5 },
    { name: "4x (Very Fast)", val: 0.25 }
  ];
  
  speeds.forEach(speed => {
    const opt = document.createElement("option");
    opt.value = speed.val;
    opt.textContent = speed.name;
    if (speed.val === 1.0) opt.selected = true;
    speedSelect.appendChild(opt);
  });
  
  speedSelect.addEventListener("change", (e) => {
    playbackSpeedMultiplier = parseFloat(e.target.value);
  });
  
  settingsRow.appendChild(speedSelect);
  scrubberContainer.appendChild(settingsRow);
  
  const controlsRow = document.createElement("div");
  controlsRow.className = "controls-row";
  
  const firstBtn = document.createElement("button");
  firstBtn.className = "scrubber-btn";
  firstBtn.innerHTML = "⏮️ First";
  firstBtn.addEventListener("click", () => seekToStep(0));
  controlsRow.appendChild(firstBtn);
  
  scrubberPrevBtn = document.createElement("button");
  scrubberPrevBtn.className = "scrubber-btn";
  scrubberPrevBtn.innerHTML = "◀️ Prev";
  scrubberPrevBtn.addEventListener("click", () => stepSolution(-1));
  controlsRow.appendChild(scrubberPrevBtn);
  
  scrubberPlayBtn = document.createElement("button");
  scrubberPlayBtn.className = "scrubber-btn play-btn";
  scrubberPlayBtn.innerHTML = "▶️ Play";
  scrubberPlayBtn.addEventListener("click", togglePlaySolution);
  controlsRow.appendChild(scrubberPlayBtn);
  
  scrubberNextBtn = document.createElement("button");
  scrubberNextBtn.className = "scrubber-btn";
  scrubberNextBtn.innerHTML = "Next ▶️";
  scrubberNextBtn.addEventListener("click", () => stepSolution(1));
  controlsRow.appendChild(scrubberNextBtn);
  
  const lastBtn = document.createElement("button");
  lastBtn.className = "scrubber-btn";
  lastBtn.innerHTML = "Last ⏭️";
  lastBtn.addEventListener("click", () => seekToStep(solution.moves.length));
  controlsRow.appendChild(lastBtn);
  
  scrubberContainer.appendChild(controlsRow);
  
  scrubberCloseBtn = document.createElement("button");
  scrubberCloseBtn.className = "scrubber-close-btn";
  scrubberCloseBtn.textContent = "✕ Close Solution";
  scrubberCloseBtn.addEventListener("click", hideScrubber);
  scrubberContainer.appendChild(scrubberCloseBtn);
  
  document.body.appendChild(scrubberContainer);
  
  scrubberSlider.addEventListener("input", (e) => {
    const val = parseInt(e.target.value, 10);
    seekToStep(val);
  });
}

function showScrubber(start, moves) {
  solution.open = true;
  solution.start = start;
  solution.moves = moves;
  solution.history = moveHistory.slice();
  scrubberSlider.max = moves.length;
  scrubberContainer.classList.remove("hidden");
  updateButtons();
  seekToStep(0);
  onWindowResize();
}

// Closing keeps whatever step is shown
function hideScrubber() {
  pauseSolution();
  const state = stateAtStep(solution.step);
  setCubeState(state); // settles a turn still in flight
  moveHistory =
    state === SOLVED_STATE ? [] : [...solution.history, ...solution.moves.slice(0, solution.step)];
  updateMoveHistory(historyDiv, moveHistory);
  solution.open = false;
  scrubberContainer.classList.add("hidden");
  updateButtons();
  onWindowResize();
  saveCubeStateToStorage();
}

function stateAtStep(step) {
  return Cube.fromString(solution.start).move(solution.moves.slice(0, step).join(" ")).asString();
}

// Jump straight to a step, rebuilding the cube there
function seekToStep(step) {
  if (step < 0 || step > solution.moves.length) return;
  pauseSolution();
  solution.step = step;
  setCubeState(stateAtStep(step));
  updateScrubber();
}

// Prev/Next animate the one move, queued after any turn still finishing
function stepSolution(delta) {
  const target = solution.step + delta;
  if (target < 0 || target > solution.moves.length) return;
  pauseSolution();
  const move = delta > 0 ? solution.moves[solution.step] : invertMoves([solution.moves[target]])[0];
  solution.step = target;
  updateScrubber();
  animateMove(move, turnDuration(move));
}

function updateScrubber() {
  const { step, moves } = solution;
  scrubberSlider.value = step;
  let text = moves[step - 1];
  if (step === 0) text = "Scrambled State";
  else if (step === moves.length) text = "Solved!";
  scrubberLabel.textContent = `Step ${step} / ${moves.length}: ${text}`;
  scrubberPlayBtn.innerHTML = solution.playing ? "⏸️ Pause" : "▶️ Play";
  scrubberPlayBtn.classList.toggle("paused", solution.playing);
}

function turnDuration(move) {
  return Math.round((move[1] === "2" ? 550 : 380) * playbackSpeedMultiplier);
}

function togglePlaySolution() {
  if (solution.playing) {
    pauseSolution();
  } else {
    playSolution();
  }
}

async function playSolution() {
  if (solution.step >= solution.moves.length) {
    seekToStep(0);
  }
  const token = ++playToken;
  solution.playing = true;
  updateScrubber();

  while (solution.step < solution.moves.length) {
    const move = solution.moves[solution.step++];
    updateScrubber();
    // false: a seek rebuilt the cube mid-turn and took over
    if (!(await animateMove(move, turnDuration(move)))) return;
    if (token !== playToken) return;
    await new Promise((resolve) => setTimeout(resolve, 220 * playbackSpeedMultiplier));
    if (token !== playToken) return;
  }
  solution.playing = false;
  updateScrubber();
}

// The turn in flight still finishes; the loop stops after it
function pauseSolution() {
  playToken++;
  if (solution.playing) {
    solution.playing = false;
    updateScrubber();
  }
}

// Initialize everything
init();
animate();
warmUpSolver();

function init() {
  // Set up scene first
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x151729);

  // Set up camera
  setupCamera();

  // Set up rendering - must come after camera is defined
  setupRenderer();

  // Set up lighting
  let directionalLights = setupLights();

  // Create Rubik's Cube
  loadFaceColorsFromStorage();
  createRubiksCube();

  // Set up UI
  setupUI(directionalLights[0], directionalLights[1]);

  // Set up raycaster for mouse interaction
  let raycaster = new THREE.Raycaster();
  let mouse = new THREE.Vector2();

  // Remove existing listeners first to prevent duplicates (important for HMR/refresh)
  if (window._onPointerDown) window.removeEventListener("pointerdown", window._onPointerDown);
  if (window._onPointerMove) window.removeEventListener("pointermove", window._onPointerMove);
  if (window._onPointerUp) window.removeEventListener("pointerup", window._onPointerUp);
  if (window._onResize) window.removeEventListener("resize", window._onResize);

  window._onPointerDown = (event) => {
    // taps on the panels and buttons aren't meant for the cube behind them
    if (event.target !== renderer.domElement) return;
    onPointerDown(
      event,
      raycaster,
      mouse,
      controls,
      isAnimating,
      inputLocked(),
      camera,
      cubeGroup,
      cubeString,
      colorSelect
    );
  };
  window._onPointerMove = (event) => {
    onPointerMove(
      event,
      raycaster,
      mouse,
      isAnimating,
      inputLocked(),
      camera,
      layers,
      moveHistory,
      historyDiv,
      cubeGroup,
      cubiesContainer,
      scene
    );
  };
  window._onPointerUp = (event) => {
    onPointerUp(
      controls,
      historyDiv,
      moveHistory,
      isAnimating,
      cubeGroup,
      cubiesContainer,
      layers
    );
  };
  window._onResize = onWindowResize;

  // Add event listeners
  window.addEventListener("resize", window._onResize);
  window.addEventListener("pointerdown", window._onPointerDown);
  window.addEventListener("pointermove", window._onPointerMove);
  window.addEventListener("pointerup", window._onPointerUp);

  // Setup solution scrubber widget
  setupScrubber();

  // Load saved state or default scramble
  loadCubeStateFromStorage();
}

// Twice the pixels per world unit. Small screens zoom out so the cube (about
// 1.1 units across from any angle) clears the edges and the controls.
function getCameraScale(width, height) {
  return Math.min(800, (2 * width) / 1.5, (2 * height) / 1.6);
}

function setupCamera() {
  let width = window.innerWidth;
  let height = window.innerHeight;
  let cameraScale = getCameraScale(width, height);
  // camera = new THREE.PerspectiveCamera(45, aspectRatio, 0.1, 1000);
  camera = new THREE.OrthographicCamera(
    width / -cameraScale,
    width / cameraScale,
    height / cameraScale,
    height / -cameraScale,
    1,
    1000
  );
  camera.position.set(2, 2, 2);
}

function setupRenderer() {
  let pixelFactor = 2; // originally 6
  let screenResolution = new Vector2(window.innerWidth, window.innerHeight);
  let renderResolution = screenResolution.clone().divideScalar(pixelFactor);
  renderResolution.x |= 0;
  renderResolution.y |= 0;

  renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.shadowMap.enabled = true;
  renderer.setSize(screenResolution.x, screenResolution.y);
  document.body.appendChild(renderer.domElement);

  // Controls - must be after renderer is set up
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.target.set(0, 0, 0);
  controls.autoRotateSpeed = 10;

  // Post-processing
  composer = new EffectComposer(renderer);
  pixelPass = new RenderPixelatedPass(2, scene, camera);
  composer.addPass(pixelPass);
  bloomPass = new UnrealBloomPass(screenResolution, 0.2, 0.1, 0.5);
  composer.addPass(bloomPass);
}



function setupLights() {
  // Ambient light
  scene.add(new THREE.AmbientLight(0x2d3645, 3.5));

  // Directional light for shadows
  // define these intensity changed in the extraBloom callback
  const directionalLight = new THREE.DirectionalLight(0xfffc9c);
  const directionalLight2 = new THREE.DirectionalLight(0xfffc9c);
  directionalLight.intensity = 1.8;
  directionalLight2.intensity = 1.8;

  directionalLight.position.set(5, 5, 5);
  directionalLight2.position.set(-5, -5, -5);
  directionalLight.castShadow = true;
  directionalLight2.castShadow = true;
  directionalLight.shadow.mapSize.set(1024, 1024);
  scene.add(directionalLight);
  scene.add(directionalLight2);

  // Spot light for highlights
  const spotLight = new THREE.SpotLight(
    0xff8800,
    0.8,
    10,
    Math.PI / 16,
    0.02,
    2
  );
  spotLight.position.set(0, 0, 0);
  spotLight.castShadow = true;
  // scene.add(spotLight);

  const target = spotLight.target;
  scene.add(target);
  target.position.set(0, 0, 0);
  return [directionalLight, directionalLight2];
}

function createFaceMaterial(color) {
  return new THREE.MeshPhongMaterial({
    color: color,
    shininess: 80,
    specular: 0x333333,
  });
}

function setupAlert() {
  alertOverlay = document.createElement("div");
  alertOverlay.className = "alert-overlay";
  
  const dialog = document.createElement("div");
  dialog.className = "alert-dialog";
  
  const icon = document.createElement("div");
  icon.className = "alert-icon";
  icon.textContent = "⚠️";
  
  alertTitleElement = document.createElement("div");
  alertTitleElement.className = "alert-title";
  
  alertBodyElement = document.createElement("div");
  alertBodyElement.className = "alert-body";
  
  alertCloseButton = document.createElement("button");
  alertCloseButton.className = "alert-btn";
  alertCloseButton.textContent = "Dismiss";
  alertCloseButton.addEventListener("click", () => {
    alertOverlay.classList.remove("show");
  });
  
  dialog.appendChild(icon);
  dialog.appendChild(alertTitleElement);
  dialog.appendChild(alertBodyElement);
  dialog.appendChild(alertCloseButton);
  alertOverlay.appendChild(dialog);
  document.body.appendChild(alertOverlay);
}

function showAlert(title, body, isSuccess = false) {
  alertTitleElement.textContent = title;
  alertBodyElement.textContent = body;
  
  const dialog = alertOverlay.querySelector(".alert-dialog");
  const icon = alertOverlay.querySelector(".alert-icon");
  
  if (isSuccess) {
    dialog.classList.add("success");
    icon.textContent = "🎉";
    alertCloseButton.textContent = "Awesome";
  } else {
    dialog.classList.remove("success");
    icon.textContent = "⚠️";
    alertCloseButton.textContent = "Dismiss";
  }
  
  alertOverlay.classList.add("show");
}

function setupUI(dl1, dl2) {
  // Main Panel
  const uiContainer = document.createElement("div");
  uiContainer.className = "ui-panel";
  document.body.appendChild(uiContainer);

  // Hamburger menu button
  const hamburgerMenuButton = document.createElement("button");
  hamburgerMenuButton.className = "menu-toggle";
  hamburgerMenuButton.textContent = "☰";
  document.body.appendChild(hamburgerMenuButton);

  hamburgerMenuButton.addEventListener("click", () => {
    uiContainer.classList.toggle("show");
  });

  // Title
  const title = document.createElement("h2");
  title.textContent = "Rubik's Cube Solver";
  uiContainer.appendChild(title);

  // Buttons Container
  const btnGroup = document.createElement("div");
  btnGroup.className = "btn-group";
  uiContainer.appendChild(btnGroup);

  const row1 = document.createElement("div");
  row1.className = "btn-row";
  btnGroup.appendChild(row1);

  scrambleButton = document.createElement("button");
  scrambleButton.id = "btn-scramble";
  scrambleButton.textContent = "Scramble";
  scrambleButton.addEventListener("click", scrambleCube);
  row1.appendChild(scrambleButton);

  solveButton = document.createElement("button");
  solveButton.id = "btn-solve";
  solveButton.textContent = "Solve";
  solveButton.addEventListener("click", solveCube);
  row1.appendChild(solveButton);

  scanButton = document.createElement("button");
  scanButton.id = "btn-scan";
  scanButton.textContent = "📷 Scan Cube";
  scanButton.addEventListener("click", () => {
    if (isSolving || isScrambling) return;
    openScanner({ onApply: applyScannedState });
  });
  btnGroup.appendChild(scanButton);

  const row2 = document.createElement("div");
  row2.className = "btn-row";
  btnGroup.appendChild(row2);

  resetButton = document.createElement("button");
  resetButton.textContent = "Clear State";
  resetButton.addEventListener("click", resetCube);
  row2.appendChild(resetButton);

  extraBloomButton = document.createElement("button");
  extraBloomButton.textContent = "Extra Bloom";
  extraBloomButton.addEventListener("click", () => {
    extraBloomCallback(composer, dl1, dl2);
  });
  row2.appendChild(extraBloomButton);

  const row3 = document.createElement("div");
  row3.className = "btn-row";
  btnGroup.appendChild(row3);

  rotateButton = document.createElement("button");
  rotateButton.textContent = "Auto Rotate";
  rotateButton.addEventListener("click", () => {
    controls.autoRotate = !controls.autoRotate;
  });
  row3.appendChild(rotateButton);

  // shown while the cube wears a scanned cube's colors
  resetColorsButton = document.createElement("button");
  resetColorsButton.textContent = "Reset Colors";
  resetColorsButton.title = "Go back to the app's colors";
  resetColorsButton.addEventListener("click", () => {
    setFaceColors(DEFAULT_FACE_COLORS, FACE_COLOR_NAMES);
  });
  row3.appendChild(resetColorsButton);

  // Move history section
  const historyTitle = document.createElement("div");
  historyTitle.className = "section-title";
  historyTitle.textContent = "Move History";
  uiContainer.appendChild(historyTitle);

  historyDiv = document.createElement("div");
  historyDiv.className = "history-box";
  uiContainer.appendChild(historyDiv);

  // Controls info
  const controlsTitle = document.createElement("div");
  controlsTitle.className = "section-title";
  controlsTitle.textContent = "Controls";
  uiContainer.appendChild(controlsTitle);

  const controlsText = document.createElement("div");
  controlsText.className = "controls-info";
  controlsText.innerHTML = `
        <p>• Drag on a face to rotate it</p>
        <p>• Scan Cube reads a real cube and its colors with your camera</p>
        <p>• Select a color to enter Paint Mode</p>
        <p>• Drag background to orbit view</p>
        <p>• Scroll or pinch to zoom</p>
        <p>• Shift-drag or two-finger drag to pan the view</p>
    `;
  uiContainer.appendChild(controlsText);

  // Setup other custom widgets
  setupColorPicker();
  setupAlert();
}

function setupColorPicker() {
  const widget = document.createElement("div");
  widget.className = "color-picker-widget";
  
  const title = document.createElement("div");
  title.className = "picker-title";
  title.textContent = "Paint Tool";
  widget.appendChild(title);
  
  const palette = document.createElement("div");
  palette.className = "color-palette";
  widget.appendChild(palette);
  
  paintStatusBadge = document.createElement("div");
  paintStatusBadge.className = "status-badge";
  widget.appendChild(paintStatusBadge);

  rotateModeButton = document.createElement("button");
  rotateModeButton.className = "btn-rotate-mode";
  rotateModeButton.innerHTML = '🔄 Rotate<span class="rotate-mode-suffix"> Mode</span>';
  rotateModeButton.addEventListener("click", () => selectPaint(null));
  widget.appendChild(rotateModeButton);

  paintButtons = PAINT_LETTERS.map((letter) => {
    const colorBtn = document.createElement("button");
    colorBtn.className = "color-btn";
    colorBtn.addEventListener("click", () => selectPaint(letter));
    palette.appendChild(colorBtn);
    return colorBtn;
  });

  document.body.appendChild(widget);
  updatePaintColors();
}

function paintName(letter) {
  return faceColorNames[FACE_LETTERS.indexOf(letter)].toUpperCase();
}

// Paint with one face's color, or go back to rotating with null
function selectPaint(letter) {
  paintLetter = letter;
  colorSelect = letter ? [faceColors[letter], paintName(letter)] : null;
  paintButtons.forEach((btn, i) => btn.classList.toggle("active", PAINT_LETTERS[i] === letter));
  rotateModeButton.classList.toggle("active", !letter);
  paintStatusBadge.className = letter ? "status-badge paint" : "status-badge";
  paintStatusBadge.textContent = letter ? `Paint: ${paintName(letter)}` : "Mode: Rotate";
}

function updatePaintColors() {
  paintButtons.forEach((btn, i) => {
    const letter = PAINT_LETTERS[i];
    const css = `#${faceColors[letter].toString(16).padStart(6, '0')}`;
    btn.style.color = css;
    btn.style.backgroundColor = css;
    btn.title = `Paint ${paintName(letter)}`;
  });
  selectPaint(paintLetter);
  resetColorsButton.hidden = faceColors === DEFAULT_FACE_COLORS;
}

function createRubiksCube() {
  // Create or clear the cube group
  if (cubeGroup) {
    // Return every cubie to the pool, including any in a layer mid-turn
    cubeGroup.traverse((object) => {
      if (object.userData.isCubie && !cubiePool.includes(object)) {
        cubiePool.push(object);
      }
    });
    cubeGroup.clear();
  } else {
    cubeGroup = new THREE.Group();
    scene.add(cubeGroup);
  }
  cubeGeneration++;

  // Create main cubies container
  cubiesContainer = new THREE.Group();
  cubeGroup.add(cubiesContainer);

  // Initialize layer groups with empty cubie arrays
  layers = [];
  for (let i = 0; i < 9; i++) {
    const layer = new THREE.Group();
    layer.userData = { cubieRefs: [] }; // Store references, not actual children
    layers.push(layer);
    cubeGroup.add(layer);
  }

  // Create cubies
  const offset = (CUBE_SIZE - 1) / 2;

  for (let x = 0; x < CUBE_SIZE; x++) {
    for (let y = 0; y < CUBE_SIZE; y++) {
      for (let z = 0; z < CUBE_SIZE; z++) {
        // Skip center piece (invisible)
        if (x === 1 && y === 1 && z === 1) continue;

        // Get cubie from pool or create new one
        const cubie = createCubie(x, y, z);

        // Position the cubie
        cubie.position.set(
          (x - offset) * (CUBIE_SIZE + GAP),
          (y - offset) * (CUBIE_SIZE + GAP),
          (z - offset) * (CUBIE_SIZE + GAP)
        );

        // Add to main cubies container
        cubiesContainer.add(cubie);

        // Store the layer assignments for this cubie
        const layerIndices = [x, y + 3, z + 6];
        cubie.userData.layerIndices = layerIndices;

        // Add cubie reference to each layer it belongs to
        layerIndices.forEach((layerIndex) => {
          layers[layerIndex].userData.cubieRefs.push(cubie);
        });
      }
    }
  }
}

function createCubie(x, y, z) {
  let cubie;

  // Try to reuse a cubie from the pool
  if (cubiePool.length > 0) {
    cubie = cubiePool.pop();

    // Update materials for each face
    const materials = cubie.material;
    materials[0].color.set(x === 2 ? faceColors.R : COLORS.BLACK);
    materials[1].color.set(x === 0 ? faceColors.L : COLORS.BLACK);
    materials[2].color.set(y === 2 ? faceColors.U : COLORS.BLACK);
    materials[3].color.set(y === 0 ? faceColors.D : COLORS.BLACK);
    materials[4].color.set(z === 2 ? faceColors.F : COLORS.BLACK);
    materials[5].color.set(z === 0 ? faceColors.B : COLORS.BLACK);
  } else {
    // Create new cubie if none available in pool
    const geometry = new THREE.BoxGeometry(CUBIE_SIZE, CUBIE_SIZE, CUBIE_SIZE);

    // Get materials for each face
    const materials = [
      createFaceMaterial(x === 2 ? faceColors.R : COLORS.BLACK), // Right face (+X)
      createFaceMaterial(x === 0 ? faceColors.L : COLORS.BLACK), // Left face (-X)
      createFaceMaterial(y === 2 ? faceColors.U : COLORS.BLACK), // Top face (+Y)
      createFaceMaterial(y === 0 ? faceColors.D : COLORS.BLACK), // Bottom face (-Y)
      createFaceMaterial(z === 2 ? faceColors.F : COLORS.BLACK), // Front face (+Z)
      createFaceMaterial(z === 0 ? faceColors.B : COLORS.BLACK), // Back face (-Z)
    ];

    cubie = new THREE.Mesh(geometry, materials);
    cubie.castShadow = true;
    cubie.receiveShadow = true;
  }

  // Reset rotation and scale
  cubie.rotation.set(0, 0, 0);
  cubie.scale.set(1, 1, 1);

  // Store position info for solving
  cubie.userData = {
    originalPosition: new THREE.Vector3(x, y, z),
    isCubie: true,
    faceIndices: {
      right: 0, // +X
      left: 1, // -X
      top: 2, // +Y
      bottom: 3, // -Y
      front: 4, // +Z
      back: 5, // -Z
    },
  };

  return cubie;
}

// Start from solved and animate a random 20-turn scramble
async function scrambleCube() {
  if (isAnimating || inputLocked()) return;
  isScrambling = true;
  updateButtons();
  glitchPass = new GlitchPass(1);
  composer.addPass(glitchPass);

  createRubiksCube();
  moveHistory = [];
  updateMoveHistory(historyDiv, moveHistory);
  for (const move of randomScramble()) {
    if (!(await animateMove(move, 110))) break;
    moveHistory.push(move);
    updateMoveHistory(historyDiv, moveHistory);
  }

  composer.removePass(glitchPass);
  isScrambling = false;
  updateButtons();
  saveCubeStateToStorage();
}

function calculateGridPosition(cubie) {
  const pos = new THREE.Vector3();
  pos.copy(cubie.position);
  const offset = 0.21; // offset = ((3 - 1) / 2) * 0.21 = 0.21
  
  pos.x = Math.round((pos.x + offset) / 0.21);
  pos.y = Math.round((pos.y + offset) / 0.21);
  pos.z = Math.round((pos.z + offset) / 0.21);
  
  pos.x = Math.max(0, Math.min(2, pos.x));
  pos.y = Math.max(0, Math.min(2, pos.y));
  pos.z = Math.max(0, Math.min(2, pos.z));
  
  return pos;
}

function getCubieAt(gx, gy, gz) {
  for (let i = 0; i < cubiesContainer.children.length; i++) {
    const cubie = cubiesContainer.children[i];
    if (cubie.userData && cubie.userData.isCubie) {
      const pos = calculateGridPosition(cubie);
      if (pos.x === gx && pos.y === gy && pos.z === gz) {
        return cubie;
      }
    }
  }
  return null;
}

function getFaceletColor(cubie, worldDirection) {
  if (!cubie) return null;
  const localDirections = [
    new THREE.Vector3(1, 0, 0),  // 0: Right (+X)
    new THREE.Vector3(-1, 0, 0), // 1: Left (-X)
    new THREE.Vector3(0, 1, 0),  // 2: Top (+Y)
    new THREE.Vector3(0, -1, 0), // 3: Bottom (-Y)
    new THREE.Vector3(0, 0, 1),  // 4: Front (+Z)
    new THREE.Vector3(0, 0, -1)  // 5: Back (-Z)
  ];
  
  for (let i = 0; i < 6; i++) {
    const dir = localDirections[i].clone().applyQuaternion(cubie.quaternion);
    if (dir.dot(worldDirection) > 0.9) {
      return Array.isArray(cubie.material) ? cubie.material[i] : cubie.material;
    }
  }
  return null;
}

function matchColorToLetter(color) {
  let bestMatch = null;
  let minDiff = Infinity;
  const tempColor = new THREE.Color();
  
  for (const [letter, val] of Object.entries(faceColors)) {
    tempColor.set(val);
    const diff = Math.pow(color.r - tempColor.r, 2) +
                 Math.pow(color.g - tempColor.g, 2) +
                 Math.pow(color.b - tempColor.b, 2);
    if (diff < minDiff) {
      minDiff = diff;
      bestMatch = letter;
    }
  }
  
  return bestMatch;
}

function getCubeStateString() {
  const faces = [
    {
      name: "U",
      dir: new THREE.Vector3(0, 1, 0),
      getCoords: (i) => ({
        gx: i % 3,
        gy: 2,
        gz: Math.floor(i / 3)
      })
    },
    {
      name: "R",
      dir: new THREE.Vector3(1, 0, 0),
      getCoords: (i) => ({
        gx: 2,
        gy: 2 - Math.floor(i / 3),
        gz: 2 - (i % 3)
      })
    },
    {
      name: "F",
      dir: new THREE.Vector3(0, 0, 1),
      getCoords: (i) => ({
        gx: i % 3,
        gy: 2 - Math.floor(i / 3),
        gz: 2
      })
    },
    {
      name: "D",
      dir: new THREE.Vector3(0, -1, 0),
      getCoords: (i) => ({
        gx: i % 3,
        gy: 0,
        gz: 2 - Math.floor(i / 3)
      })
    },
    {
      name: "L",
      dir: new THREE.Vector3(-1, 0, 0),
      getCoords: (i) => ({
        gx: 0,
        gy: 2 - Math.floor(i / 3),
        gz: i % 3
      })
    },
    {
      name: "B",
      dir: new THREE.Vector3(0, 0, -1),
      getCoords: (i) => ({
        gx: 2 - (i % 3),
        gy: 2 - Math.floor(i / 3),
        gz: 0
      })
    }
  ];
  
  let stateStr = "";
  
  for (const face of faces) {
    for (let i = 0; i < 9; i++) {
      const { gx, gy, gz } = face.getCoords(i);
      const cubie = getCubieAt(gx, gy, gz);
      // missing while a layer is mid-turn
      const mat = cubie && getFaceletColor(cubie, face.dir);
      if (!mat) return null;
      stateStr += matchColorToLetter(mat.color);
    }
  }
  
  return stateStr;
}

// Why the stickers can't be solved, or null if they can
function findStateProblem(state) {
  for (let f = 0; f < 6; f++) {
    if (state[9 * f + 4] !== FACE_LETTERS[f]) {
      return `The ${FACE_POSITIONS[f]} center is painted ${faceColorNames[FACE_LETTERS.indexOf(state[9 * f + 4])].toLowerCase()}. Centers can't move on a real cube, so it has to stay ${faceColorNames[f].toLowerCase()}.`;
    }
  }
  const faces = [...state].map((letter) => FACE_LETTERS.indexOf(letter));
  if (isSolvable(faces)) return null;
  const problems = describeProblems(faces, faceColorNames).map((p) => `• ${p.message}`);
  return `No real cube has these colors:\n\n${problems.join("\n")}\n\nRepaint those stickers or scan the cube again.`;
}

// Undoing the move history solves the cube whenever the history still
// describes it, i.e. nothing was painted or scanned since it was solved
function undoHistory(state) {
  if (!moveHistory.length || !moveHistory.every(isMove)) return null;
  const undo = simplifyMoves(invertMoves(moveHistory));
  return solves(state, undo) ? undo : null;
}

function solves(state, moves) {
  return moves.every(isMove) && Cube.fromString(state).move(moves.join(" ")).isSolved();
}

async function solveCube() {
  if (isAnimating || inputLocked()) return;
  const state = getCubeStateString();
  if (!state) return;

  const problem = findStateProblem(state);
  if (problem) {
    showAlert("Unsolvable Cube State", problem);
    return;
  }
  if (state === SOLVED_STATE) {
    showAlert("Cube Solved", "The cube is already in a solved state!", true);
    return;
  }

  isSolving = true;
  updateButtons();
  const candidates = [];
  const undo = undoHistory(state);
  if (undo) candidates.push(undo);
  let solverError = null;
  try {
    const moves = (await solveFacelets(state)).split(" ").filter(Boolean);
    if (solves(state, moves)) candidates.push(moves);
  } catch (error) {
    solverError = error;
  }
  isSolving = false;
  updateButtons();

  if (!candidates.length) {
    showAlert("Solver Unavailable", solverError ? solverError.message : "The solver returned a wrong solution. Please try again.");
    return;
  }
  const best = candidates.reduce((a, b) => (b.length < a.length ? b : a));
  showScrubber(state, best);
}

function resetCube() {
  if (isAnimating || isSolving || isScrambling) return;
  if (solution.open) {
    pauseSolution();
    solution.open = false;
    scrubberContainer.classList.add("hidden");
    updateButtons();
    onWindowResize();
  }

  // Reset history
  moveHistory = [];
  updateMoveHistory(historyDiv, moveHistory);

  // Reset bloom
  updateBloomHighlight();

  // Recreate the cube from scratch
  createRubiksCube();
  saveCubeStateToStorage();
}

// Also called when the solution bar opens or closes: while it's open the cube
// is fitted into the space above it
function onWindowResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const free = solution.open ? scrubberContainer.offsetTop : height;
  const cameraScale = getCameraScale(width, free);

  const aspectRatio = width / height;

  camera.aspect = aspectRatio;
  camera.updateProjectionMatrix();

  let screenResolution = new Vector2(width, height);
  let renderResolution = screenResolution.clone().divideScalar(6);
  renderResolution.x |= 0;
  renderResolution.y |= 0;

  camera.left = width / -cameraScale;
  camera.right = width / cameraScale;
  camera.top = free / cameraScale;
  camera.bottom = (free - 2 * height) / cameraScale;
  camera.updateProjectionMatrix();

  // camera.right = 1/aspectRatio;
  renderer.setSize(screenResolution.x, screenResolution.y);
  composer.setSize(screenResolution.x, screenResolution.y);
}

function animate() {
  
  // Update controls
  controls.update();

  // Render scene
  composer.render();
  
  requestAnimationFrame(animate);
}
