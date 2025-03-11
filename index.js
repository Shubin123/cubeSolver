// just three imports...
import * as THREE from "three";
import { Vector2 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GlitchPass } from "three/examples/jsm/postprocessing/GlitchPass.js";
import { RenderPixelatedPass } from "three/examples/jsm/postprocessing/RenderPixelatedPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

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
let renderPass;
let glitchPass;

// Cube components
let cubeGroup; // Holds the entire Rubik's cube
let layers = []; // Groups for each rotatable layer
let isSolving = false;
let isAnimating = false;
let isRotating = false;
let isBloom = false;

// Raycasting for mouse interaction
let raycaster;
let mouse;
let selectedCubie = null;
let dragStartPoint = null;
let lastClickedFace = -1;


// UI Components
let moveHistory = [];
let solveButton;
let scrambleButton;
let extraBloomButton;
let resetButton;
let rotateButton;
let historyDiv;

// Object pooling for better performance
let cubiePool = [];
let cubiesContainer;

let timeSinceStart = 0;
// Initialize everything
init();
animate();

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
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // Add event listeners
  window.addEventListener("resize", onWindowResize);
  window.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
}

function setupCamera() {
  let width = window.innerWidth;
  let height = window.innerHeight;
  let cameraScale = 800;
  // camera = new THREE.PerspectiveCamera(45, aspectRatio, 0.1, 1000);
  camera = new THREE.OrthographicCamera( width / - cameraScale, width / cameraScale, height / cameraScale, height / - cameraScale, 1, 1000 );
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
    extraBloomCallback(dl1, dl2);
  });
  uiContainer.appendChild(extraBloomButton);

  rotateButton = document.createElement("button");
  rotateButton.textContent = "Rotate";
  rotateButton.style.marginLeft = "5px";
  rotateButton.style.padding = "5px 10px";
  rotateButton.addEventListener("click", () => {
    if (isRotating != null) {
      isRotating = !isRotating;
    }
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

  const controls = document.createElement("div");
  controls.innerHTML = `
        <p>Click and drag on a face to rotate it</p>
        <p>Use mouse wheel or pinch to zoom</p>
        <p>shift-click and pan the view</p>
    `;
  uiContainer.appendChild(controls);
}

function extraBloomCallback(directionalLight, directionalLight2) {
  isBloom = !isBloom;
  directionalLight.intensity = isBloom ? 5.6 : 1.8;
  directionalLight2.intensity = isBloom ? 5.6 : 1.8;
  composer.reset();
}



let currentLayer = -1;
let currentRotation = 0;
let dragStartPosition = null;
let dragActive = false;
let activeTempLayer = null;
let layerIndex = -1;
let activeRotationAxis = null;
let accumulatedRotation = 0;
let snapThreshold = Math.PI / 4; // 45 degrees - how close to a quarter turn to snap
let isDragging = false; 

function rotateLayer(layerIndex, direction, proportionalAngle = null) {
  // For complete rotations or initial setup
  if (proportionalAngle === null) {
    // Clean up any existing drag state
    if (dragActive && activeTempLayer) {
      cubeGroup.remove(activeTempLayer);
      // Return cubies to their original container
      activeTempLayer.children.slice().forEach((cubie) => {
        if (cubie.userData.originalParent) {
          activeTempLayer.remove(cubie);
          cubie.userData.originalParent.add(cubie);
        }
      });
      
      dragActive = false;
      activeTempLayer = null;
      layerIndex = -1;
      activeRotationAxis = null;
      accumulatedRotation = 0;
    }
    
    if (isAnimating) return;
    isAnimating = true;
    
    // Map layer index to move notation
    const layerNames = ["L", "M", "R", "D", "E", "U", "B", "S", "F"];
    const moveName = layerNames[layerIndex] + (direction < 0 ? "'" : "");
    
    // Add to history
    moveHistory.push(moveName);
    
    updateMoveHistory();
    
    // Determine rotation axis
    let axis = new THREE.Vector3();
    if (layerIndex < 3) axis.set(1, 0, 0);   // X layers
    else if (layerIndex < 6) axis.set(0, 1, 0);   // Y layers
    else axis.set(0, 0, 1); // Z layers
    
    // Get cubies for this layer from the reference array
    const layerCubies = layers[layerIndex].userData.cubieRefs.slice();
    
    // Create temporary group for animation
    const tempLayer = new THREE.Group();
    cubeGroup.add(tempLayer);
    
    // Add all cubies to temporary layer for animation
    layerCubies.forEach((cubie) => {
      // Store original parent and position
      cubie.userData.originalParent = cubie.parent;
      cubie.userData.originalWorldPosition = new THREE.Vector3();
      cubie.getWorldPosition(cubie.userData.originalWorldPosition);
      
      // Add to temp layer
      cubie.parent.remove(cubie);
      tempLayer.add(cubie);
    });
    
    moveLightToFaceNormal(layerIndex, tempLayer);
    
    // Animation variables for complete rotation
    const targetAngle = (direction * Math.PI) / 2;
    const duration = 500; // ms
    const startTime = performance.now();
    
    function animateRotation() {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Ease function (cubic)
      const easeProgress = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      
      // Set rotation
      tempLayer.setRotationFromAxisAngle(axis, targetAngle * easeProgress);
      
      if (progress < 1) {
        requestAnimationFrame(animateRotation);
      } else {
        // Complete rotation and update cubie data
        completeRotation(tempLayer, axis, targetAngle);
        isAnimating = false;
      }
    }
    
    animateRotation();
  } 
  // For proportional dragging
  else {
    // Create or reuse a temporary layer group
    if (!dragActive) {
      // Clean up any existing drag state
      if (dragActive && activeTempLayer) {
        cubeGroup.remove(activeTempLayer);
        activeTempLayer.children.slice().forEach((cubie) => {
          if (cubie.userData.originalParent) {
            activeTempLayer.remove(cubie);
            cubie.userData.originalParent.add(cubie);
          }
        });
      }
      
      // Determine rotation axis
      let axis = new THREE.Vector3();
      if (layerIndex < 3) axis.set(1, 0, 0);   // X layers
      else if (layerIndex < 6) axis.set(0, 1, 0);   // Y layers
      else axis.set(0, 0, 1); // Z layers
      
      // Get cubies for this layer from the reference array
      const layerCubies = layers[layerIndex].userData.cubieRefs.slice();
      
      // Create temporary group for animation
      const tempLayer = new THREE.Group();
      cubeGroup.add(tempLayer);
      
      // Add all cubies to temporary layer for animation
      layerCubies.forEach((cubie) => {
        // Store original parent and position
        cubie.userData.originalParent = cubie.parent;
        cubie.userData.originalWorldPosition = new THREE.Vector3();
        cubie.getWorldPosition(cubie.userData.originalWorldPosition);
        
        // Add to temp layer
        cubie.parent.remove(cubie);
        tempLayer.add(cubie);
      });
      
      dragActive = true;
      activeTempLayer = tempLayer;
      // activeLayerIndex = layerIndex;
      activeRotationAxis = axis;
      accumulatedRotation = 0;
      
      moveLightToFaceNormal(layerIndex, tempLayer);
    }
    
    // Update accumulated rotation
    accumulatedRotation += proportionalAngle * direction;
    
    // Apply the rotation directly (no animation)
    activeTempLayer.setRotationFromAxisAngle(activeRotationAxis, accumulatedRotation);
  }
}
// Updated pointer callback for releasing the drag
function onPointerUp() {
  // Only proceed if we're in drag mode
  if (dragActive && activeTempLayer !== null) {
    // Determine if we need to snap to a quarter turn
    const quarterTurns = Math.round(accumulatedRotation / (Math.PI/2));
    const remainingAngle = (quarterTurns * Math.PI/2) - accumulatedRotation;
    
    // Check if we're close enough to a quarter turn to snap
    if (Math.abs(accumulatedRotation) >= snapThreshold) {
      // Animate to the nearest quarter turn
      const startRotation = accumulatedRotation;
      const targetRotation = quarterTurns * Math.PI/2;
      const startTime = performance.now();
      const duration = 200; // ms - short animation for snap
      
      isAnimating = true;
      
      function snapAnimation() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Ease out
        const easeProgress = 1 - Math.pow(1 - progress, 3);
        
        // Calculate current angle
        const currentAngle = startRotation + (targetRotation - startRotation) * easeProgress;
        
        // Apply rotation
        activeTempLayer.setRotationFromAxisAngle(activeRotationAxis, currentAngle);
        
        if (progress < 1) {
          requestAnimationFrame(snapAnimation);
        } else {
          // Complete the rotation and update cube state
          completeRotation(activeTempLayer, activeRotationAxis, targetRotation);
          
          // Reset drag state
          dragActive = false;
          activeTempLayer = null;
          // layerIndex = -1;
          activeRotationAxis = null;
          accumulatedRotation = 0;
          isAnimating = false;
          
          // Add the move to history
          const layerNames = ["L", "M", "R", "D", "E", "U", "B", "S", "F"];
          const direction = quarterTurns > 0 ? "" : "'";
          // const moveName = layerNames[layerIndex] + (direction < 0 ? "'" : "");
          console.log(layerIndex);
          const moveName = layerNames[layerIndex] + direction;
          moveHistory.push(moveName);
          console.log(moveName);
          updateMoveHistory();
        }
      }
      
      snapAnimation();
    } else {
      // If rotation is too small, animate back to starting position
      const startRotation = accumulatedRotation;
      const targetRotation = 0;
      const startTime = performance.now();
      const duration = 200; // ms - short animation for reset
      
      isAnimating = true;
      
      function resetAnimation() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Ease out
        const easeProgress = 1 - Math.pow(1 - progress, 3);
        
        // Calculate current angle
        const currentAngle = startRotation + (targetRotation - startRotation) * easeProgress;
        
        // Apply rotation
        activeTempLayer.setRotationFromAxisAngle(activeRotationAxis, currentAngle);
        
        if (progress < 1) {
          requestAnimationFrame(resetAnimation);
        } else {
          // Return cubies to original positions
          activeTempLayer.children.slice().forEach((cubie) => {
            if (cubie.userData.originalParent) {
              activeTempLayer.remove(cubie);
              cubie.userData.originalParent.add(cubie);
            }
          });
          
          cubeGroup.remove(activeTempLayer);
          
          // Reset drag state
          dragActive = false;
          activeTempLayer = null;
          layerIndex = -1;
          activeRotationAxis = null;
          accumulatedRotation = 0;
          isAnimating = false;
        }
      }
      
      resetAnimation();
    }
  }
  
  // Re-enable orbit controls
  controls.enabled = true;
  
  // Reset pointer state
  selectedCubie = null;
  dragStartPoint = null;
}

function onPointerDown(event) {
  if (isAnimating || isSolving) return;

  // Disable orbit controls temporarily to allow for dragging
  //   controls.enabled = false

  // Calculate mouse position in normalized device coordinates (-1 to +1)
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  // Cast a ray from the camera to the mouse position
  raycaster.setFromCamera(mouse, camera);

  // Find all intersected objects from all cubies
  const allCubies = [];
  cubeGroup.traverse((object) => {
    if (object instanceof THREE.Mesh && object.userData.isCubie) {
      allCubies.push(object);
    }
  });

  const intersects = raycaster.intersectObjects(allCubies, false);

  if (intersects.length > 0) {
    controls.enabled = false;
    // Get the first intersected cubie
    selectedCubie = intersects[0].object;

    // Store the point of intersection for dragging calculations
    dragStartPoint = intersects[0].point.clone();

    // Store the initial position for proportional dragging
    dragStartPosition = { x: event.clientX, y: event.clientY };

    // Get the face index that was clicked
    const faceIndex =
      intersects[0].faceIndex !== undefined
        ? Math.floor(intersects[0].faceIndex / 2)
        : -1;

    if (faceIndex !== -1) {
      lastClickedFace = faceIndex;
      isDragging = true;
      currentRotation = 0;

      updateBloomHighlight();
    }
  }
}

function onPointerMove(event) {
  if (
    !selectedCubie ||
    !dragStartPoint ||
    !isDragging ||
    isAnimating ||
    isSolving
  )
    return;

  // Calculate current mouse position for normalized coordinates
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  // Calculate drag distance in pixels
  const dragDeltaX = event.clientX - dragStartPosition.x;
  const dragDeltaY = event.clientY - dragStartPosition.y;

  // Cast a ray from the camera to the mouse position
  raycaster.setFromCamera(mouse, camera);

  // Calculate a plane perpendicular to the camera at the drag start point
  const cameraNormal = new THREE.Vector3(0, 0, -1).applyQuaternion(
    camera.quaternion
  );
  const dragPlane = new THREE.Plane(
    cameraNormal,
    -dragStartPoint.dot(cameraNormal)
  );

  // Find where the ray intersects the plane
  const dragCurrentPoint = new THREE.Vector3();
  raycaster.ray.intersectPlane(dragPlane, dragCurrentPoint);

  if (dragCurrentPoint) {
    // Calculate the drag vector
    const dragVector = dragCurrentPoint.clone().sub(dragStartPoint);

    // Skip if the drag is too small
    if (dragVector.length() < 0.05) return;

    // Determine which face was clicked based on normal
    const faceMapping = selectedCubie.userData.faceIndices;

    // Calculate layer and direction based on face and drag direction
    layerIndex = -1;
    let direction = 1;

    // Calculate proportional rotation amount based on drag distance
    // Adjust sensitivity as needed
    const sensitivity = 0.01;
    let rotationAmount =
      Math.sqrt(dragDeltaX * dragDeltaX + dragDeltaY * dragDeltaY) *
      sensitivity;

    // World direction vectors
    const worldX = new THREE.Vector3(1, 0, 0);
    const worldY = new THREE.Vector3(0, 1, 0);
    const worldZ = new THREE.Vector3(0, 0, 1);

    switch (lastClickedFace) {
      case faceMapping.right: // +X face
        if (
          Math.abs(dragVector.dot(worldY)) > Math.abs(dragVector.dot(worldZ))
        ) {
          // Vertical drag
          layerIndex = 2; // Right layer
          direction = dragVector.dot(worldY) > 0 ? 1 : -1;
        } else {
          // Horizontal drag
          layerIndex = 2; // Right layer
          direction = dragVector.dot(worldZ) > 0 ? -1 : 1;
        }
        break;

      case faceMapping.left: // -X face
        if (
          Math.abs(dragVector.dot(worldY)) > Math.abs(dragVector.dot(worldZ))
        ) {
          // Vertical drag
          layerIndex = 0; // Left layer
          direction = dragVector.dot(worldY) > 0 ? 1 : -1;
        } else {
          // Horizontal drag
          layerIndex = 0; // Left layer
          direction = dragVector.dot(worldZ) > 0 ? 1 : -1;
        }
        break;

      // ... (other cases remain the same)
      case faceMapping.top: // +Y face
        if (
          Math.abs(dragVector.dot(worldX)) > Math.abs(dragVector.dot(worldZ))
        ) {
          // Horizontal X drag
          layerIndex = 5; // Up layer
          direction = dragVector.dot(worldX) > 0 ? 1 : -1;
        } else {
          // Horizontal Z drag
          layerIndex = 5; // Up layer
          direction = dragVector.dot(worldZ) > 0 ? -1 : 1;
        }
        break;

      case faceMapping.bottom: // -Y face
        if (
          Math.abs(dragVector.dot(worldX)) > Math.abs(dragVector.dot(worldZ))
        ) {
          // Horizontal X drag
          layerIndex = 3; // Down layer
          direction = dragVector.dot(worldX) > 0 ? -1 : 1;
        } else {
          // Horizontal Z drag
          layerIndex = 3; // Down layer
          direction = dragVector.dot(worldZ) > 0 ? 1 : -1;
        }
        break;

      case faceMapping.front: // +Z face
        if (
          Math.abs(dragVector.dot(worldX)) > Math.abs(dragVector.dot(worldY))
        ) {
          // Horizontal drag
          layerIndex = 8; // Front layer
          direction = dragVector.dot(worldX) > 0 ? 1 : -1;
        } else {
          // Vertical drag
          layerIndex = 8; // Front layer
          direction = dragVector.dot(worldY) > 0 ? -1 : 1;
        }
        break;

      case faceMapping.back: // -Z face
        if (
          Math.abs(dragVector.dot(worldX)) > Math.abs(dragVector.dot(worldY))
        ) {
          // Horizontal drag
          layerIndex = 6; // Back layer
          direction = dragVector.dot(worldX) > 0 ? -1 : 1;
        } else {
          // Vertical drag
          layerIndex = 6; // Back layer
          direction = dragVector.dot(worldY) > 0 ? -1 : 1;
        }
        break;
    }

    if (layerIndex !== -1) {
      // Store the current layer for snap calculations in onPointerUp
      currentLayer = layerIndex;

      // Calculate the rotation amount
      const newRotation = rotationAmount;
      const rotationDelta = newRotation - currentRotation;

      // Update the current rotation
      currentRotation = newRotation;

      // Perform the proportional rotation
      rotateLayer(layerIndex, direction, rotationDelta);
    }
  }
}

function updateBloomHighlight() {
  // dont need to update for now but it's still a potentially usefully callback location
  return;
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

function moveLightToFaceNormal(layerIndex, tempLayer) {
  // Get the spotlight that we want to move
  // const spotLight = scene.children.find((child) => child instanceof THREE.SpotLight);
  const spotLight = scene.children.find(
    (child) => child instanceof THREE.DirectionalLight
  );

  if (!spotLight) return;

  // Map layer index to cube face normal
  let normal = new THREE.Vector3();
  let lightDist = 100;
  // Determine which face is being rotated and its normal
  if (layerIndex === 0) normal.set(-lightDist, 0, 0);
  // Left face
  else if (layerIndex === 2) normal.set(lightDist, 0, 0);
  // Right face
  else if (layerIndex === 3) normal.set(0, -lightDist, 0);
  // Down face
  else if (layerIndex === 5) normal.set(0, lightDist, 0);
  // Up face
  else if (layerIndex === 6) normal.set(0, 0, -lightDist);
  // Back face
  else if (layerIndex === 8) normal.set(0, 0, lightDist);
  // Front face
  // Middle layers don't have a specific face normal, so we won't move the light
  else return;

  // Scale the normal to determine how far from the cube the light should be
  const distance = 5;
  const lightPosition = normal.clone().multiplyScalar(distance);

  // Position the light
  // spotLight.position.copy(lightPosition);
  animateLightToPosition(spotLight, lightPosition);

  // Point the light toward the center of the cube
  spotLight.target.position.set(0, 0, 0);
  // console.log(spotLight.position);
}
// Optional: Add a smooth transition for the light movement
function animateLightToPosition(light, targetPosition, duration = 300) {
  const startPosition = light.position.clone();
  const startTime = performance.now();

function updateLightPosition() {
  const elapsed = performance.now() - startTime;
  const progress = Math.min(elapsed / duration, 1);

  // Use ease-out cubic
  const easeProgress = 1 - Math.pow(1 - progress, 3);

  // Interpolate position
  light.position.lerpVectors(startPosition, targetPosition, easeProgress);

  if (progress < 1) {
    requestAnimationFrame(updateLightPosition);
  }
}

  updateLightPosition();
}

function completeRotation(tempLayer, axis, angle) {
  // Get matrix for final rotation
  const rotationMatrix = new THREE.Matrix4().makeRotationAxis(axis, angle);

  // Find the cubies container
  // let cubiesContainerr = cubeGroup.children.find(child =>  child.userData && child.userData.isCubiesContainer);

  // Process each cubie in the temporary layer
  tempLayer.children.slice().forEach((cubie) => {
    if (cubie instanceof THREE.Mesh && cubie.userData.isCubie) {
      // Remove from temp layer
      tempLayer.remove(cubie);

      // Add back to cubies container

      cubiesContainer.add(cubie);

      // Apply final rotation to position and orientation
      cubie.position.applyMatrix4(rotationMatrix);
      cubie.quaternion.premultiply(
        new THREE.Quaternion().setFromAxisAngle(axis, angle)
      );

      // Update grid position
      const gridPos = calculateGridPosition(cubie);

      // Update layer assignments
      const newLayerIndices = [gridPos.x, gridPos.y + 3, gridPos.z + 6];
      cubie.userData.layerIndices = newLayerIndices;
    }
  });

  // Remove temporary layer
  cubeGroup.remove(tempLayer);

  // Rebuild all layer references
  rebuildLayerReferences();
}

function rebuildLayerReferences() {
  // Clear all layer references
  for (let i = 0; i < 9; i++) {
    layers[i].userData.cubieRefs = [];
  }

  // Find the cubies container
  // const cubiesContainer = cubeGroup.children.find(child =>
  //   child.userData && child.userData.isCubiesContainer);

  // Rebuild layer references
  cubiesContainer.children.forEach((cubie) => {
    if (cubie.userData && cubie.userData.isCubie) {
      const layerIndices = cubie.userData.layerIndices;
      if (layerIndices) {
        layerIndices.forEach((index) => {
          if (index >= 0 && index < 9) {
            layers[index].userData.cubieRefs.push(cubie);
          }
        });
      }
    }
  });
}

function calculateGridPosition(cubie) {
  const pos = new THREE.Vector3();
  pos.copy(cubie.position);

  // Get offset and gap values
  const offset = ((CUBE_SIZE - 1) / 2) * (CUBIE_SIZE + GAP);

  // Convert from world position to grid position
  pos.x = Math.round((pos.x + offset) / (CUBIE_SIZE + GAP));
  pos.y = Math.round((pos.y + offset) / (CUBIE_SIZE + GAP));
  pos.z = Math.round((pos.z + offset) / (CUBIE_SIZE + GAP));

  // Ensure values are in valid range (0-2)
  pos.x = Math.max(0, Math.min(2, pos.x));
  pos.y = Math.max(0, Math.min(2, pos.y));
  pos.z = Math.max(0, Math.min(2, pos.z));

  return pos;
}

function scrambleCube() {
  if (isAnimating || isSolving) return;
  glitchPass = new GlitchPass(1);
  composer.addPass(glitchPass);

  // Reset history
  moveHistory = [];
  updateMoveHistory();

  const moves = 10;
  const layerIndices = [0, 2, 3, 5, 6, 8]; // Only outer layers: L, R, D, U, B, F

  let i = 0;
  function doNextMove() {
    if (i >= moves) {
      return;
    }
    const layerIndex = layerIndices[Math.floor(Math.random() * layerIndices.length)];
    const direction = Math.random() > 0.5 ? 1 : -1;

    rotateLayer(layerIndex, direction);

    // Wait for animation to complete before next move
    setTimeout(() => {
      i++;
      composer.removePass(glitchPass);
      doNextMove();
    }, 600);
  }

  doNextMove();
}

function updateMoveHistory() {
  historyDiv.innerHTML = "";

  // Display in reverse order (newest first)
  for (let i = moveHistory.length - 1; i >= 0; i--) {
    const moveItem = document.createElement("div");
    moveItem.textContent = `${i + 1}. ${moveHistory[i]}`;
    historyDiv.appendChild(moveItem);
  }
}

function solveCube() {
  if (isAnimating || isSolving || moveHistory.length === 0) return;

  isSolving = true;
  solveButton.disabled = true;
  scrambleButton.disabled = true;

  // Reverse all moves
  const reverseMoves = moveHistory
    .slice()
    .reverse()
    .map((move) => {
      // If move ends with ', remove it; otherwise add it
      return move.endsWith("'") ? move.slice(0, -1) : move + "'";
    });

  let i = 0;
  function doNextMove() {
    if (i >= reverseMoves.length) {
      isSolving = false;
      solveButton.disabled = false;
      scrambleButton.disabled = false;
      moveHistory = [];
      updateMoveHistory();
      return;
    }

    const move = reverseMoves[i];
    const layerName = move.charAt(0);
    // FIXED: The direction should be -1 if it includes ' (prime) and 1 otherwise
    const direction = move.includes("'") ? -1 : 1;

    // Map move notation to layer index
    const layerMap = {
      F: 8,
      S: 7,
      B: 6,
      U: 5,
      E: 4,
      D: 3,
      R: 2,
      M: 1,
      L: 0,
    };

    rotateLayer(layerMap[layerName], direction);

    // Wait for animation to complete before next move
    setTimeout(() => {
      i++;
      doNextMove();
    }, 600);
  }

  doNextMove();
}

function resetCube() {
  if (isAnimating || isSolving) return;

  // Reset history
  moveHistory = [];
  updateMoveHistory();

  // Reset bloom
  lastClickedFace = -1;
  updateBloomHighlight();

  // Recreate the cube from scratch
  createRubiksCube();
}

function onWindowResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const cameraScale=800;

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

  // Add subtle rotation to the entire cube for display
  if (isRotating) {
    cubeGroup.rotation.y =2*Math.sin(timeSinceStart);
    timeSinceStart += 0.01;  
    // cubeGroup.rotation.x = Math.sin(-timeSinceStart);
  }

  // Render scene
  composer.render();
  
}

