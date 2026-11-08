// Face-turn notation helpers shared by the solver, scrambler and playback.
// Moves are strings like "R", "R'" and "R2".

const OPPOSITE = { U: "D", D: "U", R: "L", L: "R", F: "B", B: "F" };
const SUFFIX = ["", "", "2", "'"];

// Index of each face's layer in the 3D model (see createRubiksCube)
export const FACE_LAYERS = { L: 0, R: 2, D: 3, U: 5, B: 6, F: 8 };

export function isMove(move) {
  return typeof move === "string" && /^[URFDLB]['2]?$/.test(move);
}

// Clockwise quarter turns: R = 1, R2 = 2, R' = 3
function quarterTurns(move) {
  return move[1] === "2" ? 2 : move[1] === "'" ? 3 : 1;
}

// Rotation of the face's layer about the model's +x, +y or +z axis. Seen from
// outside, clockwise is negative for R, U and F, positive for L, D and B.
export function moveAngle(move) {
  const clockwise = "RUF".includes(move[0]) ? -1 : 1;
  const turns = { 1: 1, 2: 2, 3: -1 }[quarterTurns(move)];
  return (clockwise * turns * Math.PI) / 2;
}

export function invertMoves(moves) {
  return moves
    .slice()
    .reverse()
    .map((move) => move[0] + SUFFIX[4 - quarterTurns(move)]);
}

// Merge turns of the same face, looking past turns of the opposite face
// (they commute), and drop the ones that cancel out
export function simplifyMoves(moves) {
  const out = [];
  for (const move of moves) {
    const face = move[0];
    let i = out.length - 1;
    if (i >= 0 && out[i].face === OPPOSITE[face]) i--;
    if (i >= 0 && out[i].face === face) {
      out[i].turns = (out[i].turns + quarterTurns(move)) % 4;
      if (out[i].turns === 0) out.splice(i, 1);
    } else {
      out.push({ face, turns: quarterTurns(move) });
    }
  }
  return out.map(({ face, turns }) => face + SUFFIX[turns]);
}

// Random-turn scramble with no face turned twice in a row and no
// face/opposite-face/face runs, which would partly cancel
export function randomScramble(length = 20, rand = Math.random) {
  const moves = [];
  while (moves.length < length) {
    const face = "URFDLB"[Math.floor(rand() * 6)];
    const last = moves[moves.length - 1]?.[0];
    const beforeLast = moves[moves.length - 2]?.[0];
    if (face === last || (face === beforeLast && last === OPPOSITE[face])) continue;
    moves.push(face + SUFFIX[1 + Math.floor(rand() * 3)]);
  }
  return moves;
}
