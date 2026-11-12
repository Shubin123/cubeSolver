// The small cube in the corner of the camera view. It turns to show which
// face to hold up next, the way the camera should see it, and colours each
// face in with the captured stickers, in a shower of sparks, as it's scanned.

const U = 0, R = 1, F = 2, D = 3, L = 4, B = 5;
const X = [1, 0, 0], Y = [0, 1, 0];

// Each face as [normal, right, down] in cube space (x right, y up, z towards
// the viewer), so the stickers land in the order they're captured: row by row
// with the face held up to the camera
const FACES = [
  [[0, 1, 0], [1, 0, 0], [0, 0, 1]],
  [[1, 0, 0], [0, 0, -1], [0, -1, 0]],
  [[0, 0, 1], [1, 0, 0], [0, -1, 0]],
  [[0, -1, 0], [1, 0, 0], [0, 0, -1]],
  [[-1, 0, 0], [0, 0, 1], [0, -1, 0]],
  [[0, 0, -1], [-1, 0, 0], [0, -1, 0]],
];

// How the cube is turned to show each face: the sides a quarter turn at a
// time from the first face, the top and bottom tilted towards the viewer
const TURNS = [
  quat(X, Math.PI / 2),
  quat(Y, -Math.PI / 2),
  [0, 0, 0, 1],
  quat(X, -Math.PI / 2),
  quat(Y, Math.PI / 2),
  quat(Y, Math.PI),
];

const VIEW_DISTANCE = 7; // camera distance from the cube's centre, in stickers
const FOCAL = 0.74; // projection scale, relative to the canvas size
const TILT = 0.5; // radians the cube is tipped towards the viewer, to show its top
const SWAY = 0.55, SWAY_CENTER = -0.2, SWAY_PERIOD = 6500; // slow side to side turn, so the sides show
const TURN_TIME = 700; // ms per turn
const HOLD_TIME = 650; // ms a newly coloured face stays in view before the cube turns on
const STAGGER = 70; // ms between the centre, edges and corners colouring in
const POP_TIME = 260;
const GLOW_TIME = 450;
const PULSE_PERIOD = 1400;
const RING = [2, 1, 2, 1, 0, 1, 2, 1, 2];

const BODY = [20, 22, 40];
const EMPTY = [58, 62, 92];
const ACCENT = [99, 102, 241];
const SPARK_WHITE = [255, 244, 214];
const LIGHT = normalize([-0.35, 0.75, 0.55]);

export function createScanCube(canvas) {
  const ctx = canvas.getContext("2d");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  // filledAt: when the face was coloured in (0 if it just appeared);
  // sparked: bits for the stickers, plus bit 9 for the whole face, that
  // have thrown their sparks
  let faces = FACES.map(() => ({ colors: null, filledAt: 0, sparked: 0 }));
  let target = F;
  let shown = F; // face the cube is turned to, or turning to
  let orientation = TURNS[F];
  let turn = null;
  let holdUntil = 0;
  let sparks = [];
  let rafId = 0;
  let last = 0;

  // Match the captures (null for a face still to scan) and point at `slot`
  function show(captures, slot) {
    faces = faces.map((face, f) => (face.colors === captures[f] ? face : { colors: captures[f], filledAt: 0, sparked: 0 }));
    target = slot;
  }

  function colorIn(slot, colors) {
    const now = performance.now();
    faces[slot] = { colors, filledAt: now, sparked: 0, finale: faces.every((face, f) => f === slot || face.colors) };
    holdUntil = now + HOLD_TIME;
  }

  function start() {
    if (rafId) return;
    last = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    cancelAnimationFrame(rafId);
    rafId = 0;
    sparks = [];
  }

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const size = canvas.clientWidth;
    if (!size) return;
    const dpr = window.devicePixelRatio || 1;
    const pixels = Math.round(size * dpr);
    if (canvas.width !== pixels || canvas.height !== pixels) canvas.width = canvas.height = pixels;
    ctx.setTransform(pixels / size, 0, 0, pixels / size, 0, 0);
    ctx.clearRect(0, 0, size, size);

    advanceTurn(now);
    const still = reducedMotion.matches;
    const phase = (now / SWAY_PERIOD) * Math.PI * 2;
    const yaw = SWAY_CENTER + (still ? 0 : SWAY * Math.sin(phase));
    const pitch = TILT + (still ? 0 : 0.08 * Math.sin(phase * 0.5));
    drawCube(toMatrix(multiply(quat(X, pitch), multiply(quat(Y, yaw), orientation))), now, size);
    drawSparks(dt, size);
  }

  function advanceTurn(now) {
    if (!turn && now >= holdUntil && shown !== target) {
      // as the instructions say: back round to the first face before tilting
      // to the top or bottom
      const viaFront = (target === U || target === D) && (shown === R || shown === B || shown === L);
      shown = viaFront ? F : target;
      turn = { from: orientation, to: TURNS[shown], start: now };
    }
    if (turn) {
      const t = Math.min(1, (now - turn.start) / TURN_TIME);
      orientation = slerp(turn.from, turn.to, easeInOut(t));
      if (t === 1) turn = null;
    }
  }

  function drawCube(m, now, size) {
    const scale = size * FOCAL;
    const project = ([x, y, z]) => {
      const s = scale / (VIEW_DISTANCE - z);
      return [size / 2 + x * s, size / 2 - y * s];
    };
    const pulse = 0.5 + 0.5 * Math.sin((now / PULSE_PERIOD) * Math.PI * 2);
    let outline = null;

    FACES.forEach((axes, f) => {
      const [n, u, v] = axes.map((axis) => apply(m, axis));
      // in perspective a face can be seen while it's turned a little away
      if (n[2] * VIEW_DISTANCE <= 1.5) return;
      const shade = 0.6 + 0.45 * Math.max(0, dot(n, LIGHT));
      const point = (a, b) => project([0, 1, 2].map((k) => 1.5 * n[k] + a * u[k] + b * v[k]));
      const square = (a, b, half) => [point(a - half, b - half), point(a + half, b - half), point(a + half, b + half), point(a - half, b + half)];
      const face = faces[f];
      const empty = f === target && !face.colors ? mix(EMPTY, ACCENT, 0.3 + 0.4 * pulse) : EMPTY;

      const body = square(0, 0, 1.5);
      fillPath(body, rgba(BODY, shade));
      ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
      ctx.lineWidth = 1;
      ctx.stroke();

      for (let i = 0; i < 9; i++) {
        const a = (i % 3) - 1, b = Math.floor(i / 3) - 1;
        const appear = face.filledAt + RING[i] * STAGGER;
        if (!face.colors || now < appear) {
          fillPath(square(a, b, 0.42), rgba(empty, shade));
          continue;
        }
        const t = (now - appear) / POP_TIME;
        if (t < 1) fillPath(square(a, b, 0.42), rgba(EMPTY, shade));
        fillPath(square(a, b, 0.42 * popScale(t)), rgba(face.colors[i], Math.min(1.1, shade + 0.1)));
        if (!(face.sparked & (1 << i))) {
          face.sparked |= 1 << i;
          if (t < 0.4) emit(point(a, b), face.colors[i], 4, size * 0.8, size);
        }
      }

      // the finished face flashes and bursts
      const done = face.filledAt + 2 * STAGGER + POP_TIME;
      if (face.colors && now >= done) {
        if (!(face.sparked & (1 << 9))) {
          face.sparked |= 1 << 9;
          if (now - done < 100) emit(point(0, 0), SPARK_WHITE, face.finale ? 40 : 20, size * (face.finale ? 1.5 : 1.15), size);
        }
        const glow = 1 - (now - done) / GLOW_TIME;
        if (glow > 0) fillPath(body, `rgba(255, 255, 255, ${0.5 * glow})`);
      }
      if (f === target) outline = body;
    });

    // drawn last so the neighbouring faces don't cover half of it
    if (outline) {
      ctx.save();
      path(outline);
      ctx.strokeStyle = rgba([165, 180, 252], 1, 0.55 + 0.45 * pulse);
      ctx.lineWidth = Math.max(1.5, size / 55);
      ctx.lineJoin = "round";
      ctx.shadowColor = rgba(ACCENT, 1, 0.9);
      ctx.shadowBlur = size / 14;
      ctx.stroke();
      ctx.restore();
    }
  }

  function emit([x, y], color, count, speed, size) {
    if (reducedMotion.matches) return;
    const dx = x - size / 2, dy = y - size / 2;
    const away = Math.hypot(dx, dy) || 1;
    const bright = mix(color, [255, 255, 255], 0.45);
    for (let k = 0; k < count; k++) {
      const angle = Math.random() * Math.PI * 2;
      const v = speed * (0.35 + Math.random() * 0.75);
      sparks.push({
        x,
        y,
        vx: Math.cos(angle) * v + (dx / away) * speed * 0.35,
        vy: Math.sin(angle) * v + (dy / away) * speed * 0.35 - speed * 0.4,
        age: 0,
        life: 0.4 + Math.random() * 0.5,
        color: Math.random() < 0.35 ? SPARK_WHITE : bright,
      });
    }
  }

  function drawSparks(dt, size) {
    if (!sparks.length) return;
    const drag = Math.exp(-3 * dt);
    sparks = sparks.filter((s) => (s.age += dt) < s.life);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const s of sparks) {
      s.vx *= drag;
      s.vy = s.vy * drag + size * 2.2 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const fade = 1 - s.age / s.life;
      ctx.strokeStyle = rgba(s.color, 1, fade);
      ctx.lineWidth = Math.max(1, size / 80) * (0.4 + 0.8 * fade);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - s.vx * 0.04, s.y - s.vy * 0.04);
      ctx.stroke();
    }
    ctx.restore();
  }

  function path(points) {
    ctx.beginPath();
    points.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  }

  function fillPath(points, style) {
    path(points);
    ctx.fillStyle = style;
    ctx.fill();
  }

  return { show, colorIn, start, stop };
}

// ---- Small vector helpers ---------------------------------------------------

function quat(axis, angle) {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

// a then b turns as one: b first, then a
function multiply([ax, ay, az, aw], [bx, by, bz, bw]) {
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function slerp(a, b, t) {
  let cos = a.reduce((acc, v, i) => acc + v * b[i], 0);
  if (cos < 0) {
    b = b.map((v) => -v);
    cos = -cos;
  }
  if (cos > 0.9995) return normalize(a.map((v, i) => v + (b[i] - v) * t));
  const angle = Math.acos(cos);
  const wa = Math.sin((1 - t) * angle) / Math.sin(angle);
  const wb = Math.sin(t * angle) / Math.sin(angle);
  return a.map((v, i) => v * wa + b[i] * wb);
}

function toMatrix([x, y, z, w]) {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

function apply(m, [x, y, z]) {
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v) {
  const length = Math.hypot(...v);
  return v.map((x) => x / length);
}

function mix(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}

function rgba(rgb, shade, alpha = 1) {
  const [r, g, b] = rgb.map((v) => Math.min(255, Math.round(v * shade)));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

// grows from nothing with a little overshoot
function popScale(t) {
  if (t >= 1) return 1;
  const k = 1.70158;
  return 1 + (k + 1) * (t - 1) ** 3 + k * (t - 1) ** 2;
}
