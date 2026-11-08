// Promise interface to the solver worker. Requests run in order, so a solve
// sent while the tables are still building simply waits for them.
let worker = null;
let nextId = 0;
const pending = new Map();

function failAll(message) {
  pending.forEach(({ reject }) => reject(new Error(message)));
  pending.clear();
  worker?.terminate();
  worker = null;
}

function request(cmd, payload = {}) {
  if (!worker) {
    worker = new Worker(new URL("./worker.js", import.meta.url));
    worker.onmessage = ({ data }) => {
      const callbacks = pending.get(data.id);
      if (!callbacks) return;
      pending.delete(data.id);
      if (data.ok) callbacks.resolve(data.result);
      else callbacks.reject(new Error(data.error));
    };
    // e.g. the solver library couldn't be downloaded; the next request retries
    worker.onerror = (event) => {
      event.preventDefault();
      failAll("The solver couldn't load. Check your connection and try again.");
    };
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, cmd, ...payload });
  });
}

// Start building the solver's tables in the background
export function warmUpSolver() {
  return request("init").catch(() => {});
}

// Resolves with a solution in face-turn notation, e.g. "R U2 F'"
export function solveFacelets(facelets) {
  return request("solve", { facelets });
}
