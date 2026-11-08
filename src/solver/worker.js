// Solver worker: cubejs's Kociemba two-phase solver. Building its tables
// takes about a second, so it runs here, off the page's thread.
importScripts(
  "https://cdn.jsdelivr.net/npm/cubejs@1.3.2/lib/cube.js",
  "https://cdn.jsdelivr.net/npm/cubejs@1.3.2/lib/solve.js"
);

const FACES = "URFDLB";
let initialized = false;

function init() {
  if (initialized) return;
  Cube.initSolver();
  initialized = true;
}

const moveCount = (alg) => alg.split(" ").filter(Boolean).length;

// The cube turned whole by `rotation` and relabelled so its centres are
// standard again, plus the original face now at each position
function viewAlong(cube, rotation) {
  const turned = cube.clone().move(rotation).asString();
  const faceAt = [...FACES].map((_, f) => turned[9 * f + 4]);
  const relabel = {};
  faceAt.forEach((face, f) => (relabel[face] = FACES[f]));
  return { view: Cube.fromString([...turned].map((c) => relabel[c]).join("")), faceAt };
}

function inverseCube(cube) {
  const { cp, co, ep, eo } = cube.toJSON();
  const inverse = new Cube();
  for (let i = 0; i < 8; i++) {
    inverse.cp[cp[i]] = i;
    inverse.co[cp[i]] = (3 - co[i]) % 3;
  }
  for (let i = 0; i < 12; i++) {
    inverse.ep[ep[i]] = i;
    inverse.eo[ep[i]] = eo[i];
  }
  return inverse;
}

// Two-phase search finds a different solution depending on which axis it
// treats as up/down, and for the inverse cube. Search along all three axes,
// both ways, and keep the shortest: about a move shorter on average.
function solveShortest(facelets) {
  const cube = Cube.fromString(facelets);
  if (cube.asString() !== facelets) throw new Error("Not a valid cube state");
  let best = null;
  for (const rotation of ["", "x", "z"]) {
    const { view, faceAt } = viewAlong(cube, rotation);
    const toOriginal = (alg) =>
      alg.split(" ").filter(Boolean).map((m) => faceAt[FACES.indexOf(m[0])] + m.slice(1)).join(" ");
    for (const solveView of [() => view.solve(), () => Cube.inverse(inverseCube(view).solve())]) {
      const alg = toOriginal(solveView());
      if (!cube.clone().move(alg).isSolved()) continue;
      if (best === null || moveCount(alg) < moveCount(best)) best = alg;
    }
  }
  if (best === null) throw new Error("No solution found");
  return best;
}

self.onmessage = ({ data }) => {
  try {
    init();
    const result = data.cmd === "solve" ? solveShortest(data.facelets) : null;
    self.postMessage({ id: data.id, ok: true, result });
  } catch (error) {
    self.postMessage({ id: data.id, ok: false, error: error.message });
  }
};
