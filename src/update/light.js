import * as THREE from "three";
let isBloom = false;

export function updateBloomHighlight() {
  // dont need to update for now but it's still a potentially usefully callback location
  return;
}

export function extraBloomCallback(
  composer,
  directionalLight,
  directionalLight2
) {
  isBloom = !isBloom;
  directionalLight.intensity = isBloom ? 5.6 : 1.8;
  directionalLight2.intensity = isBloom ? 5.6 : 1.8;
  composer.reset();
}

export function moveLightToFaceNormal(layerIndex, scene) {
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
