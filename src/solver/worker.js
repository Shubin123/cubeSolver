(function () {
  var init, initialized, solve;

  importScripts(
    "https://cdn.jsdelivr.net/npm/cubejs@1.3.2/lib/cube.js",
    "https://cdn.jsdelivr.net/npm/cubejs@1.3.2/lib/solve.js"
  );

  initialized = false;

  init = function () {
    if (initialized) {
      return;
    }
    Cube.initSolver();
    return (initialized = true);
  };

  solve = function (args) {
    var cube;
    if (!initialized) {
      throw new Error("Solver not initialized");
    }
    if (args.scramble) {
      cube = new Cube();
      cube.move(args.scramble);
    } else if (args.cube) {
      cube = new Cube(args.cube);
    } else {
      throw new Error("No cube state provided to solver");
    }
    console.log(args);
    if (args.solveN) {
      console.log("solving with", args.solveN);
      return cube.solve(args.solveN);
    } else {
      return cube.solve();
    }
  };

  self.onmessage = function (event) {
    var args;
    args = event.data;
    switch (args.cmd) {
      case "init":
        try {
          init();
          return self.postMessage({
            cmd: "init",
            status: "ok",
          });
        } catch (error) {
          return self.postMessage({
            cmd: "init",
            status: "error",
            error: error.message
          });
        }
      case "solve":
        try {
          var algorithm = solve(args);
          return self.postMessage({
            cmd: "solve",
            status: "ok",
            algorithm: algorithm
          });
        } catch (error) {
          return self.postMessage({
            cmd: "solve",
            status: "error",
            error: error.message
          });
        }
    }
  };
}).call(this);