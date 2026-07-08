// just three imports...
import * as THREE from "three";
import { Vector2 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GlitchPass } from "three/examples/jsm/postprocessing/GlitchPass.js";
import { RenderPixelatedPass } from "three/examples/jsm/postprocessing/RenderPixelatedPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

import Cube from "cubejs";
// Attach Cube to window for async.js
window.Cube = Cube;

import {
  onPointerDown,
  onPointerMove,
  onPointerUp,
  rotateLayer,
  updateMoveHistory,
  completeRotation,
} from "./update/mouse.js";

import { updateBloomHighlight, extraBloomCallback } from "./update/light.js";

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

// Cube components
let cubeGroup; // Holds the entire Rubik's cube
let layers = []; // Groups for each rotatable layer
let isSolving = false;
let isAnimating = false;
let cubiePool = [];
let cubeString = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";
let cubiesContainer;
let cubeInstance;

// UI Components
let moveHistory = [];
let solveButton;
let scrambleButton;
let extraBloomButton;
let resetButton;
let rotateButton;
let historyDiv;
let colorSelect;

let alertOverlay;
let alertTitleElement;
let alertBodyElement;
let alertCloseButton;

window.hasPainted = false;
window.isSolving = false;

let scrubberContainer;
let scrubberSlider;
let scrubberLabel;
let scrubberPlayBtn;
let scrubberPrevBtn;
let scrubberNextBtn;
let scrubberCloseBtn;

let solutionMoves = [];
let solutionCurrentStep = 0;
let isPlayingSolution = false;
let playTimeoutId = null;
let initialCubeState = null;
let initialHasPainted = false;

function saveCubeStateToStorage() {
  localStorage.setItem("hasPainted", window.hasPainted ? "true" : "false");
  if (window.hasPainted) {
    const scannedState = getCubeStateString();
    localStorage.setItem("savedCubeState", scannedState);
  } else {
    localStorage.setItem("moveHistory", JSON.stringify(moveHistory));
  }
}
window.saveCubeStateToStorage = saveCubeStateToStorage;

function applyInitialMoves(moves) {
  const layerMap = {
    L: 0, M: 1, R: 2, D: 3, E: 4, U: 5, B: 6, S: 7, F: 8
  };
  
  moves.forEach(move => {
    const layerName = move.charAt(0);
    let direction = move.includes("'") ? 1 : -1;
    if (layerName.includes('B') || layerName.includes('L') || layerName.includes('D')) {
      direction = -direction;
    }
    const layerIndex = layerMap[layerName];
    if (layerIndex === undefined) return;
    
    const axis = new THREE.Vector3();
    if (layerIndex < 3) axis.set(1, 0, 0);
    else if (layerIndex < 6) axis.set(0, 1, 0);
    else axis.set(0, 0, 1);
    
    const layerCubies = layers[layerIndex].userData.cubieRefs.slice();
    const tempLayer = new THREE.Group();
    cubeGroup.add(tempLayer);
    
    layerCubies.forEach((cubie) => {
      cubie.parent.remove(cubie);
      tempLayer.add(cubie);
    });
    
    const targetAngle = (direction * Math.PI) / 2;
    
    completeRotation(
      tempLayer,
      axis,
      targetAngle,
      cubiesContainer,
      cubeGroup,
      layers
    );
  });
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
  
  const charToColor = {
    U: COLORS.WHITE,
    R: COLORS.RED,
    F: COLORS.BLUE,
    D: COLORS.YELLOW,
    L: COLORS.ORANGE,
    B: COLORS.GREEN
  };
  
  let charIdx = 0;
  for (const face of faces) {
    for (let i = 0; i < 9; i++) {
      const char = stateStr[charIdx++];
      const colorHex = charToColor[char] !== undefined ? charToColor[char] : COLORS.BLACK;
      
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

function applyDefaultScramble() {
  const initialScannedState = "FFBFULFLRBBUDRDLRFLFDLFFBRULDBUDBRLLUUUULUFBDRRRBBRDDD";
  window.hasPainted = true;
  applySavedCubeState(initialScannedState);
  saveCubeStateToStorage();
}

function loadCubeStateFromStorage() {
  const savedHasPainted = localStorage.getItem("hasPainted");
  if (savedHasPainted === "true") {
    const savedCubeState = localStorage.getItem("savedCubeState");
    if (savedCubeState && savedCubeState.length === 54) {
      applySavedCubeState(savedCubeState);
      window.hasPainted = true;
    } else {
      applyDefaultScramble();
    }
  } else {
    const savedHistoryStr = localStorage.getItem("moveHistory");
    if (savedHistoryStr) {
      try {
        const savedHistory = JSON.parse(savedHistoryStr);
        if (Array.isArray(savedHistory)) {
          moveHistory = savedHistory;
          updateMoveHistory(historyDiv, moveHistory);
          applyInitialMoves(moveHistory);
        } else {
          applyDefaultScramble();
        }
      } catch (e) {
        applyDefaultScramble();
      }
    } else {
      applyDefaultScramble();
    }
  }
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
  scrubberPrevBtn.addEventListener("click", () => seekToStep(solutionCurrentStep - 1));
  controlsRow.appendChild(scrubberPrevBtn);
  
  scrubberPlayBtn = document.createElement("button");
  scrubberPlayBtn.className = "scrubber-btn play-btn";
  scrubberPlayBtn.innerHTML = "▶️ Play";
  scrubberPlayBtn.addEventListener("click", togglePlaySolution);
  controlsRow.appendChild(scrubberPlayBtn);
  
  scrubberNextBtn = document.createElement("button");
  scrubberNextBtn.className = "scrubber-btn";
  scrubberNextBtn.innerHTML = "Next ▶️";
  scrubberNextBtn.addEventListener("click", () => seekToStep(solutionCurrentStep + 1));
  controlsRow.appendChild(scrubberNextBtn);
  
  const lastBtn = document.createElement("button");
  lastBtn.className = "scrubber-btn";
  lastBtn.innerHTML = "Last ⏭️";
  lastBtn.addEventListener("click", () => seekToStep(solutionMoves.length));
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

function showScrubber() {
  scrubberSlider.max = solutionMoves.length;
  scrubberSlider.value = 0;
  solutionCurrentStep = 0;
  
  scrubberLabel.textContent = "Step 0 / " + solutionMoves.length + ": Scrambled State";
  
  scrubberContainer.classList.remove("hidden");
  
  solveButton.disabled = true;
  scrambleButton.disabled = true;
  
  isPlayingSolution = false;
  scrubberPlayBtn.innerHTML = "▶️ Play";
  scrubberPlayBtn.classList.remove("paused");
  
  resetCubeModelToInitial();
  
  cubeInstance = initialHasPainted ? Cube.fromString(initialCubeState) : new Cube();
  if (!initialHasPainted) {
    cubeInstance.move(initialCubeState.join(" "));
  }
}

function hideScrubber() {
  pauseSolution();
  scrubberContainer.classList.add("hidden");
  
  solveButton.disabled = false;
  scrambleButton.disabled = false;
  
  resetCube();
}

function seekToStep(step) {
  if (step < 0 || step > solutionMoves.length) return;
  
  if (isPlayingSolution) {
    pauseSolution();
  }
  
  solutionCurrentStep = step;
  scrubberSlider.value = step;
  
  resetCubeModelToInitial();
  
  const movesToApply = solutionMoves.slice(0, step);
  applyInitialMoves(movesToApply);
  
  cubeInstance = initialHasPainted ? Cube.fromString(initialCubeState) : new Cube();
  if (!initialHasPainted) {
    cubeInstance.move(initialCubeState.join(" "));
  }
  movesToApply.forEach(move => {
    cubeInstance.move(move);
  });
  
  if (step === 0) {
    scrubberLabel.textContent = "Step 0 / " + solutionMoves.length + ": Scrambled State";
  } else if (step === solutionMoves.length) {
    scrubberLabel.textContent = "Step " + step + " / " + solutionMoves.length + ": Solved!";
  } else {
    scrubberLabel.textContent = "Step " + step + " / " + solutionMoves.length + ": " + solutionMoves[step - 1];
  }
}

function resetCubeModelToInitial() {
  if (cubeGroup) {
    while (cubeGroup.children.length > 0) {
      const child = cubeGroup.children[0];
      cubeGroup.remove(child);
    }
    
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh && object.userData.isCubie) {
        if (object.parent) {
          object.parent.remove(object);
        }
        if (!cubiePool.includes(object)) {
          cubiePool.push(object);
        }
      }
    });
  }
  
  createRubiksCube();
  
  if (initialHasPainted) {
    applySavedCubeState(initialCubeState);
  } else {
    applyInitialMoves(initialCubeState);
  }
}

function togglePlaySolution() {
  if (isPlayingSolution) {
    pauseSolution();
  } else {
    playSolution();
  }
}

function playSolution() {
  if (solutionCurrentStep >= solutionMoves.length) {
    solutionCurrentStep = 0;
  }
  
  isPlayingSolution = true;
  scrubberPlayBtn.innerHTML = "⏸️ Pause";
  scrubberPlayBtn.classList.add("paused");
  
  playNextStep();
}

function pauseSolution() {
  isPlayingSolution = false;
  scrubberPlayBtn.innerHTML = "▶️ Play";
  scrubberPlayBtn.classList.remove("paused");
  if (playTimeoutId) {
    clearTimeout(playTimeoutId);
    playTimeoutId = null;
  }
}

function playNextStep() {
  if (!isPlayingSolution) return;
  
  if (solutionCurrentStep >= solutionMoves.length) {
    pauseSolution();
    return;
  }
  
  const move = solutionMoves[solutionCurrentStep];
  cubeInstance.move(move);
  
  const layerName = move.charAt(0);
  let direction = move.includes("'") ? 1 : -1;
  if (layerName.includes('B') || layerName.includes('L') || layerName.includes('D')) {
    direction = -direction;
  }
  
  const layerMap = { F: 8, B: 6, U: 5, D: 3, R: 2, L: 0 };
  
  isAnimating = true;
  rotateLayer(
    layerMap[layerName],
    direction,
    layers,
    isAnimating,
    moveHistory,
    historyDiv,
    cubeGroup,
    scene,
    cubiesContainer,
    400
  );
  
  solutionCurrentStep++;
  scrubberSlider.value = solutionCurrentStep;
  
  if (solutionCurrentStep === solutionMoves.length) {
    scrubberLabel.textContent = "Step " + solutionCurrentStep + " / " + solutionMoves.length + ": Solved!";
  } else {
    scrubberLabel.textContent = "Step " + solutionCurrentStep + " / " + solutionMoves.length + ": " + solutionMoves[solutionCurrentStep - 1];
  }
  
  playTimeoutId = setTimeout(() => {
    isAnimating = false;
    playNextStep();
  }, 800);
}

// Initialize everything
init();
animate();
initSolver();

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
    onPointerDown(
      event,
      raycaster,
      mouse,
      controls,
      isAnimating,
      isSolving,
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
      isSolving,
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

function setupCamera() {
  let width = window.innerWidth;
  let height = window.innerHeight;
  let cameraScale = 800;
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

  rotateButton = document.createElement("button");
  rotateButton.textContent = "Auto Rotate";
  rotateButton.addEventListener("click", () => {
    controls.autoRotate = !controls.autoRotate;
  });
  btnGroup.appendChild(rotateButton);

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
        <p>• Click and drag on a face to rotate it</p>
        <p>• Select a color to enter Paint Mode</p>
        <p>• Drag background to orbit view</p>
        <p>• Use mouse wheel to zoom</p>
        <p>• Shift-click to pan the view</p>
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
  
  const statusBadge = document.createElement("div");
  statusBadge.className = "status-badge";
  statusBadge.textContent = "Mode: Rotate";
  widget.appendChild(statusBadge);
  
  const rotateModeBtn = document.createElement("button");
  rotateModeBtn.className = "btn-rotate-mode active";
  rotateModeBtn.innerHTML = "🔄 Rotate Mode";
  widget.appendChild(rotateModeBtn);
  
  const colorButtons = [];
  
  const validColors = {
    WHITE: COLORS.WHITE,
    RED: COLORS.BLUE,
    BLUE: COLORS.RED,
    ORANGE: COLORS.GREEN,
    GREEN: COLORS.ORANGE,
    YELLOW: COLORS.YELLOW
  };
  
  Object.keys(validColors).forEach((colorName) => {
    const colorBtn = document.createElement("button");
    colorBtn.className = "color-btn";
    colorBtn.style.color = `#${validColors[colorName].toString(16).padStart(6, '0')}`;
    colorBtn.style.backgroundColor = `#${validColors[colorName].toString(16).padStart(6, '0')}`;
    colorBtn.title = `Paint ${colorName}`;
    
    colorBtn.addEventListener("click", () => {
      rotateModeBtn.classList.remove("active");
      colorButtons.forEach(btn => btn.classList.remove("active"));
      colorBtn.classList.add("active");
      
      colorSelect = [validColors[colorName], colorName];
      
      statusBadge.className = "status-badge paint";
      statusBadge.textContent = `Paint: ${colorName}`;
    });
    
    palette.appendChild(colorBtn);
    colorButtons.push(colorBtn);
  });
  
  rotateModeBtn.addEventListener("click", () => {
    rotateModeBtn.classList.add("active");
    colorButtons.forEach(btn => btn.classList.remove("active"));
    colorSelect = null;
    
    statusBadge.className = "status-badge";
    statusBadge.textContent = "Mode: Rotate";
  });
  
  document.body.appendChild(widget);
}

function createRubiksCube() {
  // Create or clear the cube group
  if (cubeGroup) {
    // Clear existing structure
    while (cubeGroup.children.length > 0) {
      const child = cubeGroup.children[0];
      cubeGroup.remove(child);
    }

    // Return all cubes to the pool
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh && object.userData.isCubie) {
        if (object.parent) {
          object.parent.remove(object);
        }
        if (!cubiePool.includes(object)) {
          cubiePool.push(object);
        }
      }
    });
  } else {
    cubeGroup = new THREE.Group();
    scene.add(cubeGroup);
  }

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
    materials[0].color.set(x === 2 ? COLORS.RED : COLORS.BLACK);
    materials[1].color.set(x === 0 ? COLORS.ORANGE : COLORS.BLACK);
    materials[2].color.set(y === 2 ? COLORS.WHITE : COLORS.BLACK);
    materials[3].color.set(y === 0 ? COLORS.YELLOW : COLORS.BLACK);
    materials[4].color.set(z === 2 ? COLORS.BLUE : COLORS.BLACK);
    materials[5].color.set(z === 0 ? COLORS.GREEN : COLORS.BLACK);
  } else {
    // Create new cubie if none available in pool
    const geometry = new THREE.BoxGeometry(CUBIE_SIZE, CUBIE_SIZE, CUBIE_SIZE);

    // Get materials for each face
    const materials = [
      createFaceMaterial(x === 2 ? COLORS.RED : COLORS.BLACK), // Right face (+X)
      createFaceMaterial(x === 0 ? COLORS.ORANGE : COLORS.BLACK), // Left face (-X)
      createFaceMaterial(y === 2 ? COLORS.WHITE : COLORS.BLACK), // Top face (+Y)
      createFaceMaterial(y === 0 ? COLORS.YELLOW : COLORS.BLACK), // Bottom face (-Y)
      createFaceMaterial(z === 2 ? COLORS.BLUE : COLORS.BLACK), // Front face (+Z)
      createFaceMaterial(z === 0 ? COLORS.GREEN : COLORS.BLACK), // Back face (-Z)
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

function scrambleCube() {
  if (isAnimating || isSolving) return;
  window.hasPainted = false;
  glitchPass = new GlitchPass(1);
  composer.addPass(glitchPass);

  // Reset history
  moveHistory = [];
  updateMoveHistory(historyDiv, moveHistory);

  const moves = 10;
  const layerIndices = [0, 2, 3, 5, 6, 8]; // Only outer layers: L, R, D, U, B, F

  let i = 0;
  function doNextMove() {
    if (i >= moves) {
      return;
    }
    const layerIndex =
      layerIndices[Math.floor(Math.random() * layerIndices.length)];
    const direction = Math.random() > 0.5 ? 1 : -1;

    rotateLayer(
      layerIndex,
      direction,
      layers,
      isAnimating,
      moveHistory,
      historyDiv,
      cubeGroup,
      scene,
      cubiesContainer
    );

    // Wait for animation to complete before next move
    setTimeout(() => {
      i++;
      composer.removePass(glitchPass);
      doNextMove();
    }, 600);
  }
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
  const matchColors = {
    "U": COLORS.WHITE,
    "R": COLORS.RED,
    "F": COLORS.BLUE,
    "D": COLORS.YELLOW,
    "L": COLORS.ORANGE,
    "B": COLORS.GREEN
  };
  
  let bestMatch = null;
  let minDiff = Infinity;
  const tempColor = new THREE.Color();
  
  for (const [letter, val] of Object.entries(matchColors)) {
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
      if (!cubie) {
        console.error(`Missing cubie at: ${gx}, ${gy}, ${gz}`);
        stateStr += "?";
        continue;
      }
      const mat = getFaceletColor(cubie, face.dir);
      if (!mat) {
        console.error(`Could not find material for: ${gx}, ${gy}, ${gz}`);
        stateStr += "?";
        continue;
      }
      const letter = matchColorToLetter(mat.color);
      console.log(`Scan: Face=${face.name}, index=${i}, grid=(${gx},${gy},${gz}), color=(r=${mat.color.r.toFixed(3)},g=${mat.color.g.toFixed(3)},b=${mat.color.b.toFixed(3)}) hex=#${mat.color.getHexString()} -> letter=${letter}`);
      stateStr += letter;
    }
  }
  
  return stateStr;
}

function getInverseMoves(moves) {
  const inverseMoves = [];
  for (let i = moves.length - 1; i >= 0; i--) {
    const move = moves[i];
    if (move === "") continue;
    if (move.endsWith("'")) {
      inverseMoves.push(move.slice(0, -1));
    } else if (move.endsWith("2")) {
      inverseMoves.push(move);
    } else {
      inverseMoves.push(move + "'");
    }
  }
  return inverseMoves;
}

async function solveCube() {
  if (isAnimating || isSolving) return;
  
  // Fast Path: If user hasn't custom-painted facelets, solve instantly by reversing moveHistory!
  if (!window.hasPainted) {
    const inverseMoves = getInverseMoves(moveHistory);
    if (inverseMoves.length === 0) {
      showAlert("Cube Solved", "The cube is already in a solved state!", true);
      return;
    }
    
    // Save current state for scrubbing resets
    initialHasPainted = false;
    initialCubeState = [...moveHistory];
    
    solutionMoves = [...inverseMoves];
    solutionCurrentStep = 0;
    
    showScrubber();
    return;
  }
  
  // Custom painted state: Scan 3D model
  const scannedState = getCubeStateString();
  console.log("Scanned state:", scannedState);
  
  // Basic validation check: 6 colors each have 9 quads
  const counts = { U: 0, R: 0, F: 0, D: 0, L: 0, B: 0 };
  for (let i = 0; i < scannedState.length; i++) {
    const char = scannedState[i];
    if (counts[char] !== undefined) {
      counts[char]++;
    }
  }
  
  const colorNames = {
    U: "White (Up)",
    R: "Blue (Right)",
    F: "Red (Front)",
    D: "Yellow (Down)",
    L: "Green (Left)",
    B: "Orange (Back)"
  };
  
  let invalidCounts = [];
  for (const [letter, count] of Object.entries(counts)) {
    if (count !== 9) {
      invalidCounts.push(`• ${colorNames[letter]}: ${count} (expected 9)`);
    }
  }
  
  if (invalidCounts.length > 0) {
    showAlert(
      "Unfeasible Cube State",
      `Each of the 6 colors must have exactly 9 facelets. Current counts:\n\n${invalidCounts.join("\n")}\n\nPlease paint the cube correctly before solving.`,
      false
    );
    return;
  }
  
  isSolving = true;
  window.isSolving = true;
  solveButton.disabled = true;
  scrambleButton.disabled = true;
  
  cubeInstance = Cube.fromString(scannedState);
  
  // Get the solution, passing 22 as solveN to limit depth and prevent infinite worker hangs
  await Cube._asyncSolve(cubeInstance, 22, (error, algorithm) => {
    if (error) {
      console.error("Solver error:", error);
      showAlert(
        "Invalid Cube State",
        `The color combination is mathematically impossible to solve: ${error}\n\nCheck that corner and edge piece color combinations are correct.`,
        false
      );
      isSolving = false;
      window.isSolving = false;
      solveButton.disabled = false;
      scrambleButton.disabled = false;
      return;
    }
    
    console.log("Received solution:", algorithm);
    
    if (algorithm === "") {
      showAlert("Cube Solved", "The cube is already in a solved state!", true);
      solveButton.disabled = false;
      scrambleButton.disabled = false;
      isSolving = false;
      window.isSolving = false;
      return;
    }

    // Proceed with animation...
    let solution = algorithm.split(" ");
    let fsolution = [];
    solution.forEach((move) => {
      if (move.includes("2")) {
        fsolution.push(move[0], move[0]);
      } else {
        fsolution.push(move);
      }
    });
    
    // Save current state for scrubbing resets
    initialHasPainted = true;
    initialCubeState = scannedState; // 54-char string
    
    solutionMoves = fsolution;
    solutionCurrentStep = 0;
    
    showScrubber();
  });
}



function endSequence() {
  isSolving = false;
  window.isSolving = false;
  solveButton.disabled = false;
  scrambleButton.disabled = false;
  // Clear move history after solving
  
  console.log(moveHistory);
  moveHistory = [];
  updateMoveHistory(historyDiv,moveHistory);
}

async function initSolver() {
  // Load async.js dynamically
  const asyncScript = document.createElement("script");
  asyncScript.src = "./src/solver/async.js";
  document.body.appendChild(asyncScript);

  asyncScript.onload = () => {
    // console.log('async.js loaded');

    // Fetch worker.js content and create a Blob URL
    fetch("./src/solver/worker.js")
      .then((response) => response.text())
      .then((workerCode) => {
        const blob = new Blob([workerCode], { type: "application/javascript" });
        const workerURL = URL.createObjectURL(blob);
        // console.log("Before:", Cube.moveTables, Cube.pruningTables);

        // console.log("After:", Cube.moveTables, Cube.pruningTables);

        Cube.asyncInit(workerURL, function () {
          // console.log("solver loaded");
        });
      })
      .catch((error) => console.error("Failed to load worker:", error));
  };
}

function resetCube() {
  if (isAnimating || isSolving) return;
  window.hasPainted = false;

  // Clear localStorage saved state!
  localStorage.removeItem("hasPainted");
  localStorage.removeItem("savedCubeState");
  localStorage.removeItem("moveHistory");

  // Reset history
  moveHistory = [];
  updateMoveHistory(historyDiv, moveHistory);

  // Reset bloom
  updateBloomHighlight();

  // Recreate the cube from scratch
  createRubiksCube();
}

function onWindowResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const cameraScale = 800;

  const aspectRatio = width / height;

  camera.aspect = aspectRatio;
  camera.updateProjectionMatrix();

  let screenResolution = new Vector2(width, height);
  let renderResolution = screenResolution.clone().divideScalar(6);
  renderResolution.x |= 0;
  renderResolution.y |= 0;

  camera.left = width / -cameraScale;
  camera.right = width / cameraScale;
  camera.top = height / cameraScale;
  camera.bottom = height / -cameraScale;
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
