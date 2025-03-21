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
  cubeGroup
) {
  if (isAnimating || isSolving) return;

  // Calculate mouse position
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  // Find all cubies
  const allCubies = [];
  cubeGroup.traverse((object) => {
    if (object instanceof THREE.Mesh && object.userData.isCubie) {
      allCubies.push(object);
    }
  });

  const intersects = raycaster.intersectObjects(allCubies, false);

  if (intersects.length > 0) {
    controls.enabled = false;
    selectedCubie = intersects[0].object;
    dragStartPoint = intersects[0].point.clone();
    dragStartPosition = { x: event.clientX, y: event.clientY };

    // Get the normal of the clicked face in world space
    const faceNormal = intersects[0].face.normal.clone();
    faceNormal.transformDirection(selectedCubie.matrixWorld);

    // Determine which global face was clicked based on normal
    const absX = Math.abs(faceNormal.x);
    const absY = Math.abs(faceNormal.y);
    const absZ = Math.abs(faceNormal.z);

    // Find the dominant axis
    if (absX > absY && absX > absZ) {
      // X-axis is dominant
      if (faceNormal.x > 0) {
        lastClickedFace = "right"; // +X face
      } else {
        lastClickedFace = "left"; // -X face
      }
    } else if (absY > absX && absY > absZ) {
      // Y-axis is dominant
      if (faceNormal.y > 0) {
        lastClickedFace = "top"; // +Y face
      } else {
        lastClickedFace = "bottom"; // -Y face
      }
    } else {
      // Z-axis is dominant
      if (faceNormal.z > 0) {
        lastClickedFace = "front"; // +Z face
      } else {
        lastClickedFace = "back"; // -Z face
      }
    }

    isDragging = true;
    currentRotation = 0;
    updateBloomHighlight();
  }
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
    const transformedRight = transformToCameraSpace(dragVector, camera);
    if (Math.abs(transformedRight.dot(worldY)) > Math.abs(transformedRight.dot(worldZ))) {
      // Vertical drag (Y axis)
      layerIndex = 2; // Right layer
      direction = transformedRight.dot(worldY) > 0 ? 1 : -1;
    } else {
      // Horizontal drag (Z axis)
      layerIndex = 2; // Right layer
      direction = transformedRight.dot(worldZ) > 0 ? -1 : 1;
    }
    break;

  case "left": // -X face
    const transformedLeft = transformToCameraSpace(dragVector, camera);
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
    const transformedTop = transformToCameraSpace(dragVector, camera);
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
    const transformedBottom = transformToCameraSpace(dragVector, camera);
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
    const transformedFront = transformToCameraSpace(dragVector, camera);
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
    const transformedBack = transformToCameraSpace(dragVector, camera);
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

 // Function to transform world space drag vector into camera's local space
 function transformToCameraSpace(dragVector, camera) {
  const cameraMatrix = camera.matrixWorld; // The camera's world matrix

  // Invert the matrix to transform into camera space (world -> camera space)
  const inverseMatrix = new THREE.Matrix4().copy(cameraMatrix).invert();
  
  // Transform the drag vector into the camera's local space
  const transformedVector = dragVector.clone().applyMatrix4(inverseMatrix);
  
  return transformedVector;
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

    // Check if we're close enough to a quarter turn to snap
    if (Math.abs(accumulatedRotation) >= snapThreshold) {
      // Animate to the nearest quarter turn
      const startRotation = accumulatedRotation;
      const targetRotation = (quarterTurns * Math.PI) / 2;
      const startTime = performance.now();
      const duration = 200; // ms - short animation for snap

      isAnimating = true;

      function snapAnimation() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Ease out
        const easeProgress = 1 - Math.pow(1 - progress, 3);

        // Calculate current angle
        const currentAngle =
          startRotation + (targetRotation - startRotation) * easeProgress;

        // Apply rotation
        activeTempLayer.setRotationFromAxisAngle(
          activeRotationAxis,
          currentAngle
        );

        if (progress < 1) {
          requestAnimationFrame(snapAnimation);
        } else {
          // Complete the rotation and update cube state

          completeRotation(
            activeTempLayer,
            activeRotationAxis,
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

          // Add the move to history
          // const layerNames = ["L", "M", "R", "D", "E", "U", "B", "S", "F"];
          // console.log(quarterTurns)
          // const direction = quarterTurns === 1 ? "" : quarterTurns === 2 ? "2" : "'";
          // const moveName = layerNames[layerIndex] + direction;
          const moveName = getMoveName(layerIndex, quarterTurns);
          console.log(moveName);
          moveHistory.push(moveName);

          updateMoveHistory(historyDiv, moveHistory);
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
        const currentAngle =
          startRotation + (targetRotation - startRotation) * easeProgress;

        // Apply rotation
        activeTempLayer.setRotationFromAxisAngle(
          activeRotationAxis,
          currentAngle
        );

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
    moveHistory.push(moveName);

    updateMoveHistory(historyDiv, moveHistory);

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

function completeRotation(
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
