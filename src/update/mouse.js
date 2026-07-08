import * as THREE from "three";
// Raycasting for mouse interaction
import { updateBloomHighlight, moveLightToFaceNormal } from "./light.js";

// mouse components
let currentRotation = 0;
let dragStartPosition = null;
let dragActive = false;
let activeTempLayer = null;
let layerIndex = -1;
let activeRotationAxis = null;
let accumulatedRotation = 0;
let snapThreshold = Math.PI / 4; // 45 degrees - how close to a quarter turn to snap
let isDragging = false;
let currentLayer = -1;

let selectedCubie = null;
let dragStartPoint = null;
let lastClickedFace = -1;

const CUBIE_SIZE = 0.2; // Size of each small cube
const GAP = 0.01; // Gap between cubies

export function onPointerDown(
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
) {
  if (isAnimating || isSolving) return;

  // Calculate mouse position
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects(cubeGroup.children, true);
  
  if (intersects.length > 0) {
    controls.enabled = false;
    selectedCubie = intersects[0].object;
    dragStartPoint = intersects[0].point.clone();
    dragStartPosition = { x: event.clientX, y: event.clientY };

    // Get the normal of the clicked face in world space
    const faceNormal = intersects[0].face.normal.clone();
    faceNormal.transformDirection(selectedCubie.matrixWorld);

    // Determine the clicked face normal
    const absX = Math.abs(faceNormal.x);
    const absY = Math.abs(faceNormal.y);
    const absZ = Math.abs(faceNormal.z);

    if (absX > absY && absX > absZ) {
      lastClickedFace = faceNormal.x > 0 ? "right" : "left";
    } else if (absY > absX && absY > absZ) {
      lastClickedFace = faceNormal.y > 0 ? "top" : "bottom";
    } else {
      lastClickedFace = faceNormal.z > 0 ? "front" : "back";
    }

    // Get the clicked material
    const materialIndex = intersects[0].face.materialIndex;
    const clickedMaterial = Array.isArray(selectedCubie.material) ? 
      selectedCubie.material[materialIndex] : selectedCubie.material;
    
    // If in paint mode, color the facelet and return early
    if (colorSelect && colorSelect[0] !== undefined) {
      console.log(`Painting facelet to color hex: #${colorSelect[0].toString(16)}`);
      clickedMaterial.color.set(colorSelect[0]);
      window.hasPainted = true;
      if (window.saveCubeStateToStorage) {
        window.saveCubeStateToStorage();
      }
      return;
    }
    
    isDragging = true;
    currentRotation = 0;
    updateBloomHighlight();
  }
}

// Function to create a mapping between materials and cubeString indices
function createMaterialMapping(cubeGroup) {
  const materialMap = new Map();
  
  // Standard order of faces in cubeString: U, R, F, D, L, B
  const faceToLetter = {
    "top": "U",
    "right": "R",
    "front": "F",
    "bottom": "D",
    "left": "L",
    "back": "B"
  };
  
  // Start indices for each face in the cubeString
  const faceIndices = {
    "U": 0,
    "R": 9,
    "F": 18,
    "D": 27,
    "L": 36,
    "B": 45
  };

  // Process each cubie
  let facelets = [];
  cubeGroup.traverse((object) => {
    if (object instanceof THREE.Mesh && object.userData.isCubie) {
      if (Array.isArray(object.material)) {
        // For each material (facelet) on this cubie
        object.material.forEach((material, matIndex) => {
          if (!material.userData) material.userData = {};
          material.userData.cubie = object;
          material.userData.faceIndex = matIndex;
          facelets.push(material);
        });
      }
    }
  });
  
  // Now organize facelets by their global position
  for (let i = 0; i < facelets.length; i++) {
    const material = facelets[i];
    const cubie = material.userData.cubie;
    const localFaceIndex = material.userData.faceIndex;
    
    // Get cubie position in grid coordinates (-1, 0, 1) by dividing by 0.21
    const position = cubie.position.clone();
    const gridX = Math.round(position.x / 0.21);
    const gridY = Math.round(position.y / 0.21);
    const gridZ = Math.round(position.z / 0.21);
    
    // Determine which face this facelet belongs to
    let face;
    let positionInFace;
    
    switch (localFaceIndex) {
      case 0: // +X face
        face = "right";
        positionInFace = (1 - gridY) * 3 + (1 - gridZ); // Convert to 0-8 index
        break;
      case 1: // -X face
        face = "left";
        positionInFace = (1 - gridY) * 3 + (1 + gridZ);
        break;
      case 2: // +Y face
        face = "top";
        positionInFace = (1 - gridZ) * 3 + (1 + gridX);
        break;
      case 3: // -Y face
        face = "bottom";
        positionInFace = (1 + gridZ) * 3 + (1 + gridX);
        break;
      case 4: // +Z face
        face = "front";
        positionInFace = (1 - gridY) * 3 + (1 + gridX);
        break;
      case 5: // -Z face
        face = "back";
        positionInFace = (1 - gridY) * 3 + (1 - gridX);
        break;
    }
    
    // Make sure the position is within bounds
    positionInFace = Math.max(0, Math.min(8, positionInFace));
    
    // Get the letter for this face
    const faceLetter = faceToLetter[face];
    
    // Calculate the index in the cubeString
    if (faceLetter) {
      const startIndex = faceIndices[faceLetter];
      const stringIndex = startIndex + positionInFace;
      
      // Store in the map
      materialMap.set(material.uuid, stringIndex);
    }
  }
  
  return materialMap;
}

// Helper function to determine position within a face (0-8) based on cubie position
function getPositionInFace(cubiePosition, face) {
  // Convert cubie position to grid coordinates (0,1,2) for each axis
  // Assuming cube is centered at origin and has size 3 units, cubie step size is 0.21
  const gridX = Math.round(cubiePosition.x / 0.21) + 1; // -1,0,1 → 0,1,2
  const gridY = Math.round(cubiePosition.y / 0.21) + 1; // -1,0,1 → 0,1,2
  const gridZ = Math.round(cubiePosition.z / 0.21) + 1; // -1,0,1 → 0,1,2
  
  // Map grid coordinates to face position (0-8)
  switch (face) {
    case "top": // U - Looking down at top face
      return (2 - gridZ) * 3 + gridX; // Top left is (0,1,-1) → position 0
    case "bottom": // D - Looking up at bottom face
      return gridZ * 3 + gridX; // Bottom left is (0,-1,-1) → position 0
    case "left": // L - Looking at left face
      return (2 - gridY) * 3 + gridZ; // Top left is (-1,1,-1) → position 0
    case "right": // R - Looking at right face
      return (2 - gridY) * 3 + (2 - gridZ); // Top left is (1,1,1) → position 0
    case "front": // F - Looking at front face
      return (2 - gridY) * 3 + gridX; // Top left is (0,1,1) → position 0
    case "back": // B - Looking at back face
      return (2 - gridY) * 3 + (2 - gridX); // Top left is (0,1,-1) → position 0
    default:
      return 0;
  }
}

function hexToRGB(hex) {
  // Remove # if present
  hex = hex.toString(16)

  // Parse the hex value
  const bigint = parseInt(hex, 16);

  // Extract RGB components
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;

  return { r, g, b };
}


export function onPointerMove(
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
) {
  if (
    !selectedCubie ||
    !dragStartPoint ||
    !isDragging ||
    isAnimating ||
    isSolving
  )
    return;

  // Calculate current mouse position
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  // Calculate drag distance
  const dragDeltaX = event.clientX - dragStartPosition.x;
  const dragDeltaY = event.clientY - dragStartPosition.y;

  // Get the current mouse position in 3D space
  raycaster.setFromCamera(mouse, camera);
  const cameraNormal = new THREE.Vector3(0, 0, -1).applyQuaternion(
    camera.quaternion
  );
  const dragPlane = new THREE.Plane(
    cameraNormal,
    -dragStartPoint.dot(cameraNormal)
  );
  const dragCurrentPoint = new THREE.Vector3();
  raycaster.ray.intersectPlane(dragPlane, dragCurrentPoint);

  if (dragCurrentPoint) {
    // Calculate the drag vector
    const dragVector = dragCurrentPoint.clone().sub(dragStartPoint);

    // Skip if the drag is too small
    if (dragVector.length() < 0.05) return;

    // World direction vectors
    const worldX = new THREE.Vector3(1, 0, 0);
    const worldY = new THREE.Vector3(0, 1, 0);
    const worldZ = new THREE.Vector3(0, 0, 1);

    // Calculate layer and direction based on which face was clicked
    layerIndex = -1;
    let direction = 1;

    // Calculate proportional rotation amount
    const sensitivity = 0.01;
    let rotationAmount =
      Math.sqrt(dragDeltaX * dragDeltaX + dragDeltaY * dragDeltaY) *
      sensitivity;

   
switch (lastClickedFace) {
  case "right": // +X face
    const transformedRight = dragVector; // dont transform non rotating axis
    if (Math.abs(transformedRight.dot(worldY)) > Math.abs(transformedRight.dot(worldZ))) {
      // Vertical drag (Y axis)
      layerIndex = 2; // Right layer
      direction = transformedRight.dot(worldY) > 0 ? 1 : -1;
    } else {
      // Horizontal drag (Z axis)
      layerIndex = 2; // Right layer
      direction = transformedRight.dot(worldZ) > 0 ? 1 : -1;
    }
    break;

  case "left": // -X face
    const transformedLeft = dragVector; // dont transform non rotating axis
    if (Math.abs(transformedLeft.dot(worldY)) > Math.abs(transformedLeft.dot(worldZ))) {
      // Vertical drag (Y axis)
      layerIndex = 0; // Left layer
      direction = transformedLeft.dot(worldY) > 0 ? -1 : 1;
    } else {
      // Horizontal drag (Z axis)
      layerIndex = 0; // Left layer
      direction = transformedLeft.dot(worldZ) > 0 ? 1 : -1;
    }
    break;

  case "top": // +Y face
    const transformedTop = dragVector
    if (Math.abs(transformedTop.dot(worldX)) > Math.abs(transformedTop.dot(worldZ))) {
      // Horizontal drag (X axis)
      layerIndex = 5; // Up layer
      direction = transformedTop.dot(worldX) > 0 ? 1 : -1;
    } else {
      // Vertical drag (Z axis)
      layerIndex = 5; // Up layer
      direction = transformedTop.dot(worldZ) > 0 ? -1 : 1;
    }
    break;

  case "bottom": // -Y face
    const transformedBottom = dragVector
    if (Math.abs(transformedBottom.dot(worldX)) > Math.abs(transformedBottom.dot(worldZ))) {
      // Horizontal drag (X axis)
      layerIndex = 3; // Down layer
      direction = transformedBottom.dot(worldX) > 0 ? -1 : 1;
    } else {
      // Vertical drag (Z axis)
      layerIndex = 3; // Down layer
      direction = transformedBottom.dot(worldZ) > 0 ? 1 : -1;
    }
    break;

  case "front": // +Z face
    const transformedFront = dragVector;
    if (Math.abs(transformedFront.dot(worldX)) > Math.abs(transformedFront.dot(worldY))) {
      // Horizontal drag (X axis)
      layerIndex = 8; // Front layer
      direction = transformedFront.dot(worldX) > 0 ? 1 : -1;
    } else {
      // Vertical drag (Y axis)
      layerIndex = 8; // Front layer
      direction = transformedFront.dot(worldY) > 0 ? 1 : -1;
    }
    break;

  case "back": // -Z face
    const transformedBack = dragVector;
    if (Math.abs(transformedBack.dot(worldX)) > Math.abs(transformedBack.dot(worldY))) {
      // Horizontal drag (X axis)
      layerIndex = 6; // Back layer
      direction = transformedBack.dot(worldX) > 0 ? -1 : 1;
    } else {
      // Vertical drag (Y axis)
      layerIndex = 6; // Back layer
      direction = transformedBack.dot(worldY) > 0 ? -1 : 1;
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
      rotateLayer(
        layerIndex,
        direction,
        layers,
        isAnimating,
        moveHistory,
        historyDiv,
        cubeGroup,
        scene,
        cubiesContainer,
        null,rotationDelta
      );
    }
  }
}

export function updateMoveHistory(historyDiv, moveHistory) {
  historyDiv.innerHTML = "";

  // Display in reverse order (newest first)
  for (let i = moveHistory.length - 1; i >= 0; i--) {
    const moveItem = document.createElement("div");
    moveItem.textContent = `${i + 1}. ${moveHistory[i]}`;
    historyDiv.appendChild(moveItem);
  }
}

export function onPointerUp(
  controls,
  historyDiv,
  moveHistory,
  isAnimating,
  cubeGroup,
  cubiesContainer,
  layers
) {
  // Only proceed if we're in drag mode
  if (dragActive && activeTempLayer !== null) {
    // Determine if we need to snap to a quarter turn
    const quarterTurns = Math.round(accumulatedRotation / (Math.PI / 2));
    const remainingAngle = (quarterTurns * Math.PI) / 2 - accumulatedRotation;

    // Capture references locally to prevent async null pointer crashes if globals are reset
    const animTempLayer = activeTempLayer;
    const animRotationAxis = activeRotationAxis;

    // Check if we're close enough to a quarter turn to snap
    if (Math.abs(accumulatedRotation) >= snapThreshold) {
      // Animate to the nearest quarter turn
      const startRotation = accumulatedRotation;
      const targetRotation = (quarterTurns * Math.PI) / 2;
      const startTime = performance.now();
      const duration = 200; // ms - short animation for snap

      isAnimating = true;

      function snapAnimation() {
        if (!animTempLayer) return;
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Ease out
        const easeProgress = 1 - Math.pow(1 - progress, 3);

        // Calculate current angle
        const currentAngle =
          startRotation + (targetRotation - startRotation) * easeProgress;

        // Apply rotation
        animTempLayer.setRotationFromAxisAngle(
          animRotationAxis,
          currentAngle
        );

        if (progress < 1) {
          requestAnimationFrame(snapAnimation);
        } else {
          // Complete the rotation and update cube state
          completeRotation(
            animTempLayer,
            animRotationAxis,
            targetRotation,
            cubiesContainer,
            cubeGroup,
            layers
          );

          // Reset drag state
          dragActive = false;
          activeTempLayer = null;
          activeRotationAxis = null;
          accumulatedRotation = 0;
          isAnimating = false;

          const moveName = getMoveName(layerIndex, quarterTurns);
          if (moveName) {
            console.log(moveName);
            moveHistory.push(moveName);
            updateMoveHistory(historyDiv, moveHistory);
          }
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
        if (!animTempLayer) return;
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Ease out
        const easeProgress = 1 - Math.pow(1 - progress, 3);

        // Calculate current angle
        const currentAngle =
          startRotation + (targetRotation - startRotation) * easeProgress;

        // Apply rotation
        animTempLayer.setRotationFromAxisAngle(
          animRotationAxis,
          currentAngle
        );

        if (progress < 1) {
          requestAnimationFrame(resetAnimation);
        } else {
          // Return cubies to original positions
          animTempLayer.children.slice().forEach((cubie) => {
            if (cubie.userData.originalParent) {
              animTempLayer.remove(cubie);
              cubie.userData.originalParent.add(cubie);
            }
          });

          cubeGroup.remove(animTempLayer);

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
  isDragging = false;
}

function getMoveName(layerIndex, quarterTurns) {
  // Adjust layerNames to match the expected notation for a typical cube.
  // Your layerNames object was incorrect, so we need to fix it.
  const layerNames = {0: "L", 6: "B", 8: "F", 3: "D", 2: "R", 5: "U"};

  // Ensure layerIndex is within valid bounds
  if (!(layerIndex in layerNames)) {
    throw new Error("Invalid layer index: " + layerIndex);
  }

  const layer = layerNames[layerIndex];

  // Wrap quarter turns to stay between 0 and 3 (inclusive)
  const wrappedTurns = ((quarterTurns % 4) + 4) % 4; // Ensure positive values

  // Handle different cases based on the number of quarter turns
  switch (wrappedTurns) {
    case 0:
      return ""; // No move (0 turns)
    case 1:
      // For B, L, D faces, we reverse the direction (as the CCW move is represented as CW internally)
      if (layer === "B" || layer === "L" || layer === "D") {
        return layer;
      }
      return layer + "'"; // For others (U, R, F), it's CCW (indicated by the prime notation)
    case 2:
      return layer + "2"; // For 180-degree turns (e.g., U2, R2, F2)
    case 3:
      // For a CCW turn, we return the standard move (e.g., U, R, F, etc.)
      if (layer === "B" || layer === "L" || layer === "D") {
        return layer + "'";
      }
      return layer; // CCW moves are represented as the regular move name
    default:
      throw new Error("Unexpected quarter turn value: " + wrappedTurns);
  }
}


export function rotateLayer(
  layerIndex,
  direction,
  layers,
  isAnimating,
  moveHistory,
  historyDiv,
  cubeGroup,
  scene,
  cubiesContainer,
  animationTime = null, // used for buttons
  proportionalAngle = null // used for pointer
) {
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
    if (!window.isSolving) {
      moveHistory.push(moveName);
      updateMoveHistory(historyDiv, moveHistory);
    }

    // Determine rotation axis
    let axis = new THREE.Vector3();
    if (layerIndex < 3) axis.set(1, 0, 0); // X layers
    else if (layerIndex < 6) axis.set(0, 1, 0); // Y layers
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

    moveLightToFaceNormal(layerIndex, scene);

    // Animation variables for complete rotation
    const targetAngle = (direction * Math.PI) / 2;
    
    let duration = 100; // ms
    if (animationTime){ duration += animationTime;}
    const startTime = performance.now();

    function animateRotation() {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease function (cubic)
      const easeProgress =
        progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      // Set rotation
      tempLayer.setRotationFromAxisAngle(axis, targetAngle * easeProgress);

      if (progress < 1) {
        requestAnimationFrame(animateRotation);
      } else {
        // Complete rotation and update cubie data

        completeRotation(
          tempLayer,
          axis,
          targetAngle,
          cubiesContainer,
          cubeGroup,
          layers
        );
        isAnimating = false;
      }
    }

    animateRotation(cubiesContainer);
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
      if (layerIndex < 3) axis.set(1, 0, 0); // X layers
      else if (layerIndex < 6) axis.set(0, 1, 0); // Y layers
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

      moveLightToFaceNormal(layerIndex, scene);
    }

    // Update accumulated rotation
    accumulatedRotation += proportionalAngle * direction *0.69;

    // Apply the rotation directly (no animation)
    activeTempLayer.setRotationFromAxisAngle(
      activeRotationAxis,
      accumulatedRotation
    );
  }
}

export function completeRotation(
  tempLayer,
  axis,
  angle,
  cubiesContainer,
  cubeGroup,
  layers
) {
  // Get matrix for final rotation
  const rotationMatrix = new THREE.Matrix4().makeRotationAxis(axis, angle);

  // Find the cubies container
  // let cubiesContainer = cubeGroup.children.find(child =>  child.userData && child.userData.isCubiesContainer);

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
  rebuildLayerReferences(layers, cubiesContainer);

  if (window.saveCubeStateToStorage && !window.isSolving) {
    window.saveCubeStateToStorage();
  }
}

function rebuildLayerReferences(layers, cubiesContainer) {
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
  const CUBE_SIZE = 3; // 3x3x3 standard Rubik's cube
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
