// Checks for the move helpers (src/solver/moves.js) and the solver worker
// (src/solver/worker.js), run against a local copy of cubejs.
//
//   node scratch/test_solver.js path/to/cubejs/lib
//
// The directory needs cubejs's cube.js and solve.js.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { invertMoves, simplifyMoves, randomScramble, isMove, moveAngle } from "../src/solver/moves.js";

const lib = process.argv[2];
if (!lib) {
  console.error("usage: node scratch/test_solver.js path/to/cubejs/lib");
  process.exit(1);
}
const require = createRequire(import.meta.url);
const Cube = require(path.resolve(lib, "cube.js"));
require(path.resolve(lib, "solve.js"));

const stateAfter = (moves, start = new Cube()) => start.clone().move(moves.join(" ")).asString();
const randomMoves = (n) =>
  Array.from({ length: n }, () => "URFDLB"[Math.floor(Math.random() * 6)] + ["", "2", "'"][Math.floor(Math.random() * 3)]);

// inverting and simplifying keep the moves' effect
for (let i = 0; i < 2000; i++) {
  const moves = randomMoves(1 + Math.floor(Math.random() * 30));
  const start = Cube.random();
  assert.ok(start.clone().move(moves.join(" ")).move(invertMoves(moves).join(" ")).asString() === start.asString());
  const simple = simplifyMoves(moves);
  assert.equal(stateAfter(simple, start), stateAfter(moves, start));
  assert.ok(simple.length <= moves.length && simple.every(isMove));
}
assert.deepEqual(simplifyMoves(["R", "L", "R'"]), ["L"]);
assert.deepEqual(simplifyMoves(["R", "U", "U'", "R'"]), []);
assert.deepEqual(simplifyMoves(["F", "F", "F"]), ["F'"]);
assert.deepEqual(invertMoves(["R", "U2", "F'"]), ["F", "U2", "R'"]);

// scrambles never turn a face twice in a row, or face/opposite/face
for (let i = 0; i < 500; i++) {
  const moves = randomScramble();
  assert.equal(moves.length, 20);
  assert.ok(moves.every(isMove));
  assert.deepEqual(simplifyMoves(moves), moves);
}

// half turns are half turns, and a face's clockwise turns go one way
assert.equal(Math.abs(moveAngle("R2")), Math.PI);
for (const face of "URFDLB") {
  assert.equal(moveAngle(face), -moveAngle(face + "'"));
  assert.equal(Math.sign(moveAngle(face)), "RUF".includes(face) ? -1 : 1);
}

// the worker, loaded as a classic script with importScripts pointed at cubejs
const worker = { postMessage: (message) => replies.push(message) };
const replies = [];
const context = vm.createContext({
  self: worker,
  importScripts: (...urls) => urls.forEach((url) => vm.runInContext(fs.readFileSync(path.resolve(lib, path.basename(url)), "utf8"), context)),
});
const workerFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/solver/worker.js");
vm.runInContext(fs.readFileSync(workerFile, "utf8"), context);
const solve = (facelets) => {
  worker.onmessage({ data: { id: replies.length, cmd: "solve", facelets } });
  return replies[replies.length - 1];
};

let total = 0;
const count = 60;
for (let i = 0; i < count; i++) {
  const cube = Cube.random();
  const reply = solve(cube.asString());
  assert.ok(reply.ok, reply.error);
  const moves = reply.result.split(" ");
  assert.ok(moves.every(isMove));
  assert.ok(cube.clone().move(reply.result).isSolved());
  assert.ok(moves.length <= 22);
  total += moves.length;
}
const short = Cube.fromString(stateAfter(["R", "U", "F'"]));
assert.ok(solve(short.asString()).result.split(" ").length <= 3);
assert.equal(solve("not a cube").ok, false);

console.log(`all solver checks passed (mean solution ${(total / count).toFixed(1)} moves)`);
