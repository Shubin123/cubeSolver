// Load cubejs using CDN or require if available
import Cube from 'cubejs';

const state = "FFBFULFLRBBUDRDLRFLFDLFFBRULDBUDBRLLUUUULUFBDRRRBBRDDD";
console.log("Scanned state:", state);

try {
  const cube = Cube.fromString(state);
  console.log("Cube parsed successfully.");
  Cube.initSolver();
  console.log("Solver initialized.");
  const solution = cube.solve();
  console.log("Solution found:", solution);
} catch (e) {
  console.error("Error during solve:", e);
}
