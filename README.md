# cubeSolver
## Graphical Rubik's solver with three.js
### to run:
#### Open an http/https server & point to index.html.

### Solving

**Solve** reads the stickers off the 3D cube and first checks that a real cube could look like that. If it couldn't, it says why: a twisted corner, a flipped edge, two pieces swapped, or a color used the wrong number of times. The solver is Kociemba's two-phase algorithm ([cubejs](https://github.com/ldez/cubejs)) running in a Web Worker. It searches along all three axes, and also solves the inverse cube, keeping the shortest result. When the move history still describes the cube, undoing it is tried too. Solutions average about 21 moves (20.9 over 60 random cubes), usually in well under a second once the solver has started.

`node scratch/test_solver.js path/to/cubejs/lib` checks the move helpers and the worker against a local copy of cubejs.

### Scanning a real cube

Open the menu and press **📷 Scan Cube**. The camera needs the page served over HTTPS or from `localhost`.

1. Hold any face up to the camera so it fills the 3x3 guide and press **Capture** (or Space). White on top with red in front matches the app's colours.
2. Turn the whole cube a quarter turn for each of the next three sides, keeping the same face on top.
3. Turn back to the first face, tilt the top towards the camera (first face along the bottom edge of the frame), then do the same for the bottom (first face along the top edge).
4. Check the result. Tap a sticker to change its colour, or tap a centre to rescan that face. **Apply to cube**, then **Solve**.

The scanner fixes the usual slips on its own: turning the other way between sides, swapping the top and bottom, holding the top or bottom at an angle, and a single pair of similar colours (red/orange, white/yellow) read the wrong way round.

### How the scanner reads colours

`src/scan/colorModel.js` doesn't use a fixed palette or a trained classifier. It matches each sticker to one of the six centre stickers of the cube being scanned, under the constraint that every centre gets exactly nine stickers. That matching is solved exactly with the Hungarian algorithm. Each face is captured in its own frame, so the model also estimates a per-face exposure/white-balance correction and re-solves until the matching stops changing. `src/scan/cubeState.js` then checks the result against the real cube's pieces, twist, flip and parity, and searches for the smallest fix if it isn't solvable.

It runs in a few milliseconds in the browser, with no model weights to download.

**Benchmark** (`node scratch/benchmark_color_model.js`) on the dataset from *Color Recognition for Rubik's Cube Robot* ([arXiv:1901.03470](https://arxiv.org/abs/1901.03470)): 116 cube states, 6,264 labelled stickers, two cubes under five lighting conditions. The per-face drift and logo rows add the problems a handheld phone adds and the robot-captured dataset doesn't have.

| Sticker accuracy | As captured | Per-face exposure/white-balance drift | Logo on one centre |
| --- | --- | --- | --- |
| Nearest centre | 99.04% | 93.34% | 95.23% |
| Balanced matching | 99.87% | 96.44% | 98.55% |
| **Balanced + lighting correction (shipped)** | **99.87%** | **99.17%** | **98.74%** |
| Paper's best (DWLP) / their KNN baseline | 97.63% / 86.45% | | |

Five of the 116 states have inconsistent labels (a colour counted 8 or 10 times). The shipped model gets every one of the other 111 states fully right. On random cubes built from the dataset's stickers with per-face drift, 83–99% of scans come out exactly right after the repair step, depending on lighting. 0.4–1.4% come out solvable but wrong, which is what the review screen is for.

`node scratch/test_scan.js` checks the cube-state logic. Pass the path to `cubejs/lib/cube.js` to also cross-check the facelet order against the solver.

**Other resources looked at:**

- **Kaggle** has no sticker-image dataset, only tabular cube states: scramble sets and the "A Million of Rubik's Cube Best Moves" set. They're useful for solvers, not for vision.
- **[eyeeco/Rubick-s-Cube-Dataset](https://github.com/eyeeco/Rubick-s-Cube-Dataset)** is the benchmark above. It has no licence, so the benchmark downloads it at run time instead of copying it into this repo.
- **Roboflow Universe** has cube and sticker detection sets and YOLO models, such as [LazyCube](https://universe.roboflow.com/lazycube/lazycube) and [Rubik's Cube Faces Detection](https://universe.roboflow.com/tairjaa/rubik-s-cube-faces-detection). They're small (50 to a few hundred images) and would add a model runtime and several MB of weights. The guide grid already tells the scanner where the stickers are.
- **[dwalton76/rubiks-color-resolver](https://github.com/dwalton76/rubiks-color-resolver)** and **[kkoomen/qbr](https://github.com/kkoomen/qbr)** are prior art for resolving colours with cube constraints and for webcam scanning. CIEDE2000, which these projects use, scored lower than the down-weighted-lightness Lab distance here.
