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
} from "./update/mouse.js";

import { updateBloomHighlight, extraBloomCallback } from "./update/light.js";

// Constants for cube dimensions
const CUBE_SIZE = 3; // 3x3x3 standard Rubik's cube
const CUBIE_SIZE = 0.2; // Size of each small cube
const GAP = 0.01; // Gap between cubies

// Colors for cube faces
const COLORS = {
  WHITE: 0xffffff, // Light pastel blue (normalized white)
  RED: 0xff9999, // Light red (normalized)
  BLUE: 0x66666ff, // Light blue (normalized)
  ORANGE: 0xffcc99, // Light orange (normalized)
  GREEN: 0x99ff99, // Light green (normalized)
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
// let lastClickedFace = -1;

// Cube components
let cubeGroup; // Holds the entire Rubik's cube
let layers = []; // Groups for each rotatable layer
let isSolving = false;
let isAnimating = false;
let cubiePool = [];
let cubiesContainer;

// UI Components
let moveHistory = [];
let solveButton;
let scrambleButton;
let extraBloomButton;
let resetButton;
let rotateButton;
let historyDiv;

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

  // Add event listeners
  window.addEventListener("resize", onWindowResize);
  window.addEventListener("pointerdown", (event) => {
    onPointerDown(
      event,
      raycaster,
      mouse,
      controls,
      isAnimating,
      isSolving,
      camera,
      cubeGroup
    );
  });
  window.addEventListener("pointermove", (event) => {
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
  });
  window.addEventListener("pointerup", (event) => {
    onPointerUp(
      controls,
      historyDiv,
      moveHistory,
      isAnimating,
      cubeGroup,
      cubiesContainer,
      layers
    );
  });
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
  composer.addPass(new RenderPixelatedPass(pixelFactor, scene, camera));
  bloomPass = new UnrealBloomPass(screenResolution, 0.2, 0.1, 0.5);
  composer.addPass(bloomPass);

  //   composer.addPass(new PixelatePass(renderResolution))
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

function setupUI(dl1, dl2) {
  const uiContainer = document.createElement("div");
  uiContainer.style.position = "absolute";
  uiContainer.style.top = "10px";
  uiContainer.style.left = "10px";
  uiContainer.style.padding = "10px";
  uiContainer.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
  uiContainer.style.borderRadius = "5px";
  uiContainer.style.color = "white";
  document.body.appendChild(uiContainer);

  // Title
  const title = document.createElement("h2");
  title.textContent = "Rubik's Cube Solver";
  title.style.margin = "0 0 10px 0";
  uiContainer.appendChild(title);

  // Buttons
  scrambleButton = document.createElement("button");
  scrambleButton.textContent = "Scramble";
  scrambleButton.style.marginRight = "5px";
  scrambleButton.style.padding = "5px 10px";
  scrambleButton.addEventListener("click", scrambleCube);
  uiContainer.appendChild(scrambleButton);

  solveButton = document.createElement("button");
  solveButton.textContent = "Solve";
  solveButton.style.marginRight = "5px";
  solveButton.style.padding = "5px 10px";
  solveButton.addEventListener("click", solveCube);
  uiContainer.appendChild(solveButton);

  resetButton = document.createElement("button");
  resetButton.textContent = "Reset";
  resetButton.style.padding = "5px 10px";
  resetButton.addEventListener("click", resetCube);
  uiContainer.appendChild(resetButton);

  extraBloomButton = document.createElement("button");
  extraBloomButton.textContent = "TOOMUCH bloom";
  extraBloomButton.style.marginLeft = "5px";
  extraBloomButton.style.padding = "5px 10px";
  extraBloomButton.addEventListener("click", () => {
    extraBloomCallback(composer, dl1, dl2);
  });
  uiContainer.appendChild(extraBloomButton);

  rotateButton = document.createElement("button");
  rotateButton.textContent = "Rotate";
  rotateButton.style.marginLeft = "5px";
  rotateButton.style.padding = "5px 10px";
  rotateButton.addEventListener("click", () => {
    controls.autoRotate = !controls.autoRotate;
  });
  uiContainer.appendChild(rotateButton);

  // Move history section
  const historyTitle = document.createElement("h3");
  historyTitle.textContent = "Move History:";
  historyTitle.style.margin = "10px 0 5px 0";
  uiContainer.appendChild(historyTitle);

  historyDiv = document.createElement("div");
  historyDiv.style.maxHeight = "200px";
  historyDiv.style.overflowY = "auto";
  historyDiv.style.fontFamily = "monospace";
  uiContainer.appendChild(historyDiv);

  // Controls info
  const controlsTitle = document.createElement("h3");
  controlsTitle.textContent = "Controls:";
  controlsTitle.style.margin = "10px 0 5px 0";
  uiContainer.appendChild(controlsTitle);

  const controlsText = document.createElement("div");
  controlsText.innerHTML = `
        <p>Click and drag on a face to rotate it</p>
        <p>Use mouse wheel or pinch to zoom</p>
        <p>shift-click and pan the view</p>
    `;
  uiContainer.appendChild(controlsText);
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
  glitchPass = new GlitchPass(1);
  composer.addPass(glitchPass);

  // Reset history

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

  doNextMove();
}
let cubeInstance;


async function solveCube() {
  if (isAnimating || isSolving || moveHistory.length === 0) return;
  
  isSolving = true;
  solveButton.disabled = true;
  scrambleButton.disabled = true;
  
  // Create a new Cube instance for solving
  cubeInstance = new Cube();
  console.log("Fresh cube state:", JSON.stringify(cubeInstance.toJSON()));
  
  // Apply all previous moves to reach current state
  const cubeState = moveHistory.join(" ");
  console.log("Applying scramble:", cubeState);
  cubeInstance.move(cubeState);
  console.log("After scramble:", JSON.stringify(cubeInstance.toJSON()));
  
  // Get the solution
  await Cube._asyncSolve(cubeInstance, null, (algorithm) => {
    console.log("Received solution:", algorithm);

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
    
    // Reset cube instance for animation
    cubeInstance = new Cube();
    
    cubeInstance.move(cubeState);
    
    // Start animation
    let i = 0;
    animateSequence(fsolution, i);
  });
}

function animateSequence(solution, i) {
  if (cubeInstance.isSolved()) {
    endSequence();
    return;
  }


  // Check if we've completed all moves
  if (i >= solution.length) {
    console.log("ci:final", cubeInstance.toJSON());
    
    // Final verification
    if (!cubeInstance.isSolved()) {
      console.error("Error: Cube is not solved after applying all moves!");
    } else {
      console.log("Cube successfully solved!");
    }
    
    endSequence();
    return;
  }
  
  // Apply the current move to the model
  const move = solution[i];
  cubeInstance.move(move);
  // console.log("ci:during", cubeInstance.toJSON());
  
  // Map move notation to layer index
  const layerName = move.charAt(0);

  let direction = move.includes("'") ? 1 : -1;
 if (layerName.includes('B') || layerName.includes('L') || layerName.includes('D')) {
    direction = -direction;  // Invert the direction for these faces
  }
  
  const layerMap = {
    F: 8,
    B: 6,
    U: 5,
    D: 3,
    R: 2,
    L: 0,
  };
  
  // const layerMap = {
  //   F: 2,
  //   S: 7,
  //   B: 0,
  //   U: 5,
  //   E: 4,
  //   D: 3,
  //   R: 6,
  //   M: 1,
  //   L: 8,
  // };

  // Animate the visual representation
  let animationTime = 100;
  let waitTime = 300;
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
    animationTime
  );
  
  // Wait for animation to complete before next move
  setTimeout(() => {
    i++;
    animateSequence(solution, i);
  }, waitTime);
}

function endSequence() {
  isSolving = false;
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
  requestAnimationFrame(animate);

  // Update controls
  controls.update();

  // Render scene
  composer.render();
}
