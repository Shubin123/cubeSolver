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
      return;
    }
    if (args.scramble) {
      cube = new Cube();
      cube.move(args.scramble);
    } else if (args.cube) {
      cube = new Cube(args.cube);
    }
    console.log(args);
    if (args.solveN)
    {
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
        init();
        return self.postMessage({
          cmd: "init",
          status: "ok",
        });
      case "solve":
        return self.postMessage({
          cmd: "solve",
          algorithm: solve(args)
        });
    }
  };
}).call(this);