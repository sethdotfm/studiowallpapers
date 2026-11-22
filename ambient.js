"use strict";
// Studio Ambient: blob and tile background loops. One full-screen fragment shader per style.
// A frame is a pure function of (settings, tau), where tau = t / loop runs 0..1. Every motion makes
// whole cycles per loop, so frame N equals frame 0 and video loops repeat with no seam.

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const frac = (x) => x - Math.floor(x);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- color (OKLCH, so random hues come out at even brightness) ----------

const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toGam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const hexRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const rgbHex = (c) => "#" + c.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, "0")).join("");

function oklchRaw(L, C, h) {
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
// Out-of-gamut colors keep their hue and lightness and lose chroma until they fit.
function oklch(L, C, h) {
  let c = oklchRaw(L, C, h);
  while (C > 0 && c.some((v) => v < -1e-4 || v > 1 + 1e-4)) { C -= 0.004; c = oklchRaw(L, Math.max(0, C), h); }
  return c.map((v) => toGam(clamp(v, 0, 1)));
}
function hexOklch(hex) {
  const [r, g, b] = hexRgb(hex).map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}

// Hue offsets from the base hue, in the order colors get added.
const HARMONY = {
  analogous: [0, 30, -30, 60, -60, 15],
  complementary: [0, 180, 25, 205, -25, 155],
  split: [0, 150, 210, 20, 170, 230],
  triadic: [0, 120, 240, 20, 140, 260],
  tetradic: [0, 90, 180, 270, 45, 225],
  mono: [0, 0, 0, 0, 0, 0],
};
// Lightness and chroma ranges per mood, plus the background.
const MOOD = {
  rich: { L: [0.55, 0.78], C: [0.12, 0.19], bgL: [0.12, 0.17], bgC: 0.035 },
  neon: { L: [0.68, 0.86], C: [0.22, 0.32], bgL: [0.07, 0.11], bgC: 0.03 },
  pastel: { L: [0.82, 0.92], C: [0.05, 0.1], bgL: [0.95, 0.98], bgC: 0.012 },
  muted: { L: [0.5, 0.72], C: [0.035, 0.08], bgL: [0.18, 0.24], bgC: 0.015 },
  deep: { L: [0.3, 0.5], C: [0.08, 0.15], bgL: [0.05, 0.08], bgC: 0.02 },
};

function makePalette(n, harmony, mood, baseHex) {
  const rnd = Math.random, M = MOOD[mood] || MOOD.rich;
  const keys = Object.keys(HARMONY);
  const off = HARMONY[harmony] || HARMONY[keys[Math.floor(rnd() * keys.length)]];
  const base = baseHex ? hexOklch(baseHex) : null;
  const H = base ? base[2] : rnd() * 360;
  const out = [];
  for (let i = 0; i < 6; i++) {
    if (i === 0 && baseHex) { out.push(baseHex); continue; }
    const mono = off === HARMONY.mono;
    // Monochrome spreads lightness evenly so the colors still read apart.
    const L = mono ? lerp(M.L[0] - 0.12, M.L[1] + 0.06, (i + rnd() * 0.5) / 6) : lerp(M.L[0], M.L[1], rnd());
    const C = lerp(M.C[0], M.C[1], rnd());
    out.push(rgbHex(oklch(clamp(L, 0.05, 0.97), C, H + off[i] + (rnd() - 0.5) * 14)));
  }
  const bgH = H + (rnd() - 0.5) * 40;
  const bg = rgbHex(oklch(lerp(M.bgL[0], M.bgL[1], rnd()), M.bgC, bgH));
  return { colors: out, bg };
}

// ---------- shaders ----------

const VS = `#version 300 es
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

const COMMON = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTau, uSeed, uGrain;
uniform vec3 uCol[6];
uniform int uN;
uniform vec3 uBg;
out vec4 o;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 pal(int i) { i = i % uN; if (i < 0) i += uN; return uCol[i]; }
// Triangular dither of about one 8-bit step stops gradient banding in video; Grain adds film noise.
vec3 finish(vec3 c) {
  vec2 q = gl_FragCoord.xy + fract(uTau * 61.0) * 917.0;
  float n = hash12(q) + hash12(q + 19.19) - 1.0;
  c += n * (1.5 / 255.0 + uGrain * 0.08);
  return clamp(c, 0.0, 1.0);
}
`;

const FS_BLOBS = COMMON + `
uniform vec4 uB[16]; // x, y (in screen heights), radius, color index
uniform int uCount;
uniform float uSoft, uSharp, uDepth, uGlow;
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uRes.y;
  float F = 0.0, wsum = 0.0;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    if (i >= uCount) break;
    vec2 d = p - uB[i].xy;
    float r = uB[i].z;
    // Compact kernel (zero past 2r), so far blobs don't add up into one mass. Scaled so a lone blob's edge is at F = 1.
    float x = dot(d, d) / (4.0 * r * r + 1e-6);
    float w = x < 1.0 ? (1.0 - x) * (1.0 - x) * (1.0 - x) * 2.370 : 0.0;
    F += w;
    float wk = pow(w + 1e-4, uSharp);
    acc += pal(int(uB[i].w)) * wk;
    wsum += wk;
  }
  vec3 c = acc / max(wsum, 1e-6);
  // Thicker field reads as the blob's core; Depth lights it and darkens the rim a little.
  c *= mix(1.0, 0.75 + 0.4 * smoothstep(1.0, 2.2, F), uDepth);
  float m = smoothstep(1.0 - uSoft, 1.0 + uSoft, F);
  vec3 bg = uBg * mix(1.2, 0.75, p.y);
  vec3 col = mix(bg, c, m);
  col += c * uGlow * 0.45 * smoothstep(0.0, 1.0, F) * (1.0 - m);
  o = vec4(finish(col), 1.0);
}`;

const FS_TILES = COMMON + `
uniform float uCell, uGap, uRound, uRamp, uRate, uScale, uAngle, uJit, uShade, uFlash;
uniform int uPat, uTrans;
float vn(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { return 0.5 * vn(p) + 0.3 * vn(p * 2.03 + 7.1) + 0.2 * vn(p * 4.01 + 13.7); }
void main() {
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 g = (fc - uRes * 0.5) / uCell;
  vec2 cell = floor(g), l = fract(g) - 0.5;
  vec2 c = (cell + 0.5) * uCell / uRes.y; // tile center in screen heights, 0 at screen center
  float h = hash12(cell + uSeed);
  int ia, ib;
  float f;
  if (uPat == 0) {
    // Random: Rate colour picks per loop, each tile staggered by Jitter.
    float x = uTau * uRate + h * uJit * uRate;
    float k = floor(x);
    f = fract(x);
    float kA = mod(k, uRate), kB = mod(k + 1.0, uRate);
    ia = int(floor(hash12(cell * 1.37 + kA * 17.13 + uSeed) * float(uN)));
    ib = int(floor(hash12(cell * 1.37 + kB * 17.13 + uSeed) * float(uN)));
  } else {
    float s, a = 6.2831853 * uTau;
    if (uPat == 1) s = dot(c, vec2(cos(uAngle), sin(uAngle))) * uScale * 0.25 - uTau * uRate;
    else if (uPat == 2) s = length(c) * uScale * 0.25 - uTau * uRate;
    else if (uPat == 3) s = atan(c.y, c.x) / 6.2831853 * max(1.0, floor(uScale / 4.0)) + length(c) * uScale * 0.15 - uTau * uRate;
    else if (uPat == 4) {
      // A circle through noise space loops; its radius is the speed.
      vec3 q = vec3(c * uScale * 0.35, 0.0) + vec3(cos(a), sin(a), sin(a) * 0.5) * (0.25 * uRate);
      s = fbm(q) * 3.0;
    }
    else if (uPat == 5) {
      float k = uScale, r = a * uRate;
      s = (sin(c.x * k + r) + sin(c.y * k * 1.3 - r) + sin((c.x + c.y) * k * 0.7 + r) + sin(length(c) * k * 1.5 - r)) * 0.3;
    }
    else {
      float hc = hash12(vec2(cell.x, 7.0) + uSeed);
      s = c.y * uScale * 0.2 - uTau * uRate * (1.0 + floor(hc * 3.0)) + hc * 4.0;
    }
    s += h * uJit;
    float pos = s * float(uN);
    float k = floor(pos);
    f = pos - k;
    ia = int(k); ib = ia + 1;
  }
  float raw = f;
  if (uTrans == 0) f = 0.0;
  else if (uTrans == 1) f = smoothstep(1.0 - uRamp, 1.0, f);
  else if (uTrans == 2) f = smoothstep(0.0, 1.0, f);
  vec3 col = mix(pal(ia), pal(ib), f);
  col *= 1.0 + (hash12(cell * 3.1 + uSeed + 5.0) - 0.5) * uShade;
  // Flash right after a change: a snap or ramp lands on the new colour, the flash fades from there.
  if (uTrans <= 1) col += uFlash * 0.6 * pow(1.0 - raw, 8.0);
  // Rounded square with the gap around it, edge antialiased to one pixel.
  float half_ = uCell * 0.5 * (1.0 - uGap);
  float rad = uRound * half_;
  vec2 q = abs(l) * uCell - (half_ - rad);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rad;
  float m = uGap <= 0.0 && uRound <= 0.0 ? 1.0 : clamp(0.5 - d, 0.0, 1.0);
  o = vec4(finish(mix(uBg, col, m)), 1.0);
}`;

function createRenderer() {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
  if (!gl) return null;
  function prog(fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name.replace("[0]", ""); u[name] = gl.getUniformLocation(p, gl.getActiveUniform(p, i).name); }
    return { p, u };
  }
  let P;
  const init = () => { P = { blobs: prog(FS_BLOBS), tiles: prog(FS_TILES) }; };
  init();
  canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
  canvas.addEventListener("webglcontextrestored", init);
  const vao = gl.createVertexArray();

  // u: uniform values by name; numbers go to 1f, ints are tagged {i}, arrays go to 3fv / 4fv.
  function render(mode, u, w, h) {
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const pr = P[mode];
    gl.viewport(0, 0, w, h);
    gl.useProgram(pr.p);
    gl.uniform2f(pr.u.uRes, w, h);
    for (const k in u) {
      const loc = pr.u[k], v = u[k];
      if (!loc) continue;
      if (typeof v === "number") gl.uniform1f(loc, v);
      else if (v.i !== undefined) gl.uniform1i(loc, v.i);
      else if (v.v3) gl.uniform3fv(loc, v.v3);
      else if (v.v4) gl.uniform4fv(loc, v.v4);
    }
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  return { canvas, render };
}

// ---------- settings ----------

const IDS = ["mode", "mood", "harmony", "ncol", "c0", "c1", "c2", "c3", "c4", "c5", "bg", "lock", "grain", "seed",
  "count", "size", "soft", "blend", "depth", "glow", "path", "speed", "wander", "breathe",
  "tile", "gap", "round", "shade", "pattern", "trans", "ramp", "rate", "scale", "angle", "jitter", "flash",
  "loop", "codec", "fps", "vbr"];
const TEXT = new Set(["mode", "mood", "harmony", "c0", "c1", "c2", "c3", "c4", "c5", "bg", "path", "codec"]);

function readSettings() {
  const [rw, rh] = $("res").value === "custom" ? [+$("w").value, +$("h").value] : $("res").value.split("x").map(Number);
  const p = { w: clamp(rw || 1920, 320, 16384), h: clamp(rh || 1080, 320, 16384), res: $("res").value };
  for (const id of IDS) p[id] = id === "lock" ? ($(id).checked ? 1 : 0) : TEXT.has(id) ? $(id).value : +$(id).value;
  return p;
}

// Blob positions for this moment, on the CPU: 16 blobs is too few to be worth doing on the GPU.
function blobUniforms(p, tau) {
  const rnd = mulberry32(p.seed), mrnd = mulberry32((p.seed ^ 0x5bd1e995) >>> 0);
  const r = (a, b) => lerp(a, b, rnd());
  const aspect = p.w / p.h, n = p.count, B = new Float32Array(64);
  const size = lerp(0.08, 0.34, p.size / 100) / Math.sqrt(n / 6);
  const wander = p.wander / 100, breathe = p.breathe / 100, sp = p.speed;
  const colorShift = Math.floor(rnd() * 6);
  for (let i = 0; i < n; i++) {
    const bx = r(0.1, 0.9) * aspect, by = r(0.12, 0.88), r0 = size * r(0.6, 1.4);
    const kx = 1 + Math.floor(mrnd() * 2), ky = 1 + Math.floor(mrnd() * 2), kb = 1 + Math.floor(mrnd() * 2), kr = 1 + Math.floor(mrnd() * 2);
    const px = mrnd() * TAU, py = mrnd() * TAU, pb = mrnd() * TAU, pr = mrnd();
    const ax = wander * 0.3 * aspect * r(0.4, 1), ay = wander * 0.3 * r(0.4, 1);
    let x = bx + ax * Math.sin(TAU * sp * kx * tau + px), y, rad = r0 * (1 + breathe * 0.35 * Math.sin(TAU * sp * kb * tau + pb));
    if (p.path === "orbit") y = by + ay * Math.cos(TAU * sp * ky * tau + py);
    else {
      // Travel past both edges and shrink to nothing at the wrap, so the jump back is never seen.
      const f = frac(sp * kr * tau + pr);
      y = p.path === "rise" ? lerp(1.35, -0.35, f) : lerp(-0.35, 1.35, f);
      rad *= smoothstep(0, 0.18, f) * (1 - smoothstep(0.82, 1, f));
    }
    B.set([x, y, rad, (i + colorShift) % p.ncol], i * 4);
  }
  return { uB: { v4: B }, uCount: { i: n }, uSoft: 0.02 + Math.pow(p.soft / 100, 2) * 0.95, uSharp: lerp(4, 0.5, p.blend / 100), uDepth: p.depth / 100, uGlow: p.glow / 100 };
}

function uniformsFor(p, tau, outH) {
  const cols = new Float32Array(18);
  for (let i = 0; i < 6; i++) cols.set(hexRgb(p["c" + i]), i * 3);
  const u = { uTau: tau, uSeed: (p.seed % 9973) * 0.731, uGrain: p.grain / 100, uCol: { v3: cols }, uN: { i: p.ncol }, uBg: { v3: new Float32Array(hexRgb(p.bg)) } };
  if (p.mode === "blobs") return Object.assign(u, blobUniforms(p, tau));
  return Object.assign(u, {
    uCell: Math.max(1, (p.tile * outH) / p.h), uGap: p.gap / 100, uRound: p.round / 100, uShade: p.shade / 100 * 0.6,
    uPat: { i: p.pattern }, uTrans: { i: p.trans }, uRamp: p.ramp / 100, uRate: p.rate, uScale: p.scale,
    uAngle: (p.angle * Math.PI) / 180, uJit: p.jitter / 100, uFlash: p.flash / 100,
  });
}

// ---------- app ----------

const R = createRenderer();
if (!R) document.body.insertAdjacentHTML("afterbegin", '<p style="position:fixed;top:8px;left:8px;color:#f88;z-index:9">WebGL 2 is not available in this browser.</p>');
const stage = $("stage");
if (R) stage.append(R.canvas);
const clock = { playing: true, t: 0, last: performance.now() };
let current = null, busy = false, queued = false;

const draw = (p, t, w, h) => R.render(p.mode, uniformsFor(p, frac(t / p.loop), h), w, h);

function layoutPreview() {
  const p = readSettings();
  const box = stage.parentElement.getBoundingClientRect(), cs = getComputedStyle(stage.parentElement);
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight), padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const fit = Math.max(0.001, Math.min((box.width - padX) / p.w, (box.height - padY) / p.h));
  const cssW = p.w * fit, cssH = p.h * fit, dpr = window.devicePixelRatio || 1;
  if (R && !document.body.classList.contains("full")) { R.canvas.style.width = cssW + "px"; R.canvas.style.height = cssH + "px"; }
  current = { p, pw: Math.max(1, Math.round(cssW * dpr)), ph: Math.max(1, Math.round(cssH * dpr)) };
  document.querySelectorAll("[data-mode]").forEach((el) => (el.hidden = el.dataset.mode !== p.mode));
  for (let i = 0; i < 6; i++) $("c" + i).hidden = i >= p.ncol;
  $("customRes").hidden = $("customLabel").hidden = p.res !== "custom";
  document.documentElement.style.setProperty("--accent", p.c0);
  history.replaceState(null, "", "#" + new URLSearchParams(Object.entries(p)).toString());
  clock.t %= p.loop;
  syncNumbers();
}

const meter = { last: 0, dt: 0, shown: 0 };
function drawPreview() {
  queued = false;
  if (!R || !current || busy) return;
  const { p } = current;
  let w = current.pw, h = current.ph;
  if (document.body.classList.contains("full")) { const dpr = window.devicePixelRatio || 1; w = Math.round(innerWidth * dpr); h = Math.round(innerHeight * dpr); }
  draw(p, clock.t, w, h);
  const now = performance.now();
  if (clock.playing && meter.last) meter.dt = meter.dt ? lerp(meter.dt, now - meter.last, 0.1) : now - meter.last;
  meter.last = clock.playing ? now : 0;
  if (now - meter.shown > 250) { meter.shown = now; $("fpsMeter").textContent = clock.playing && meter.dt ? `${Math.round(1000 / meter.dt)} fps` : "paused"; }
  if (document.activeElement !== $("scrub")) $("scrub").value = Math.round((clock.t / p.loop) * 1000);
  $("scrub").style.setProperty("--p", $("scrub").value / 10 + "%");
  $("clock").textContent = `${clock.t.toFixed(1)} / ${p.loop} s`;
}
const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(drawPreview); } };
const changed = () => { layoutPreview(); schedule(); };

function tick(now) {
  if (clock.playing && current && !busy) { clock.t = (clock.t + (now - clock.last) / 1000) % current.p.loop; drawPreview(); }
  clock.last = now;
  requestAnimationFrame(tick);
}
function setPlaying(on) {
  clock.playing = on;
  clock.last = performance.now();
  $("play").setAttribute("aria-pressed", on);
  $("play").querySelector("use").setAttribute("href", `patchbay/icons/lucide.svg#${on ? "pause" : "play"}`);
  $("play").querySelector("span").textContent = on ? "Pause" : "Play";
  schedule();
}

// ---------- randomizers ----------

const pickInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function newColors() {
  const pl = makePalette(+$("ncol").value, $("harmony").value, $("mood").value, $("lock").checked ? $("c0").value : null);
  pl.colors.forEach((c, i) => ($("c" + i).value = c));
  $("bg").value = pl.bg;
  changed();
}
function newSeed() { $("seed").value = Math.floor(Math.random() * 1e9); changed(); }
function shuffle() {
  if ($("mode").value === "blobs") {
    $("count").value = pickInt(3, 12);
    for (const id of ["size", "blend", "depth", "glow", "wander", "breathe"]) $(id).value = pickInt(10, 90);
    $("soft").value = pick([pickInt(0, 30), pickInt(0, 30), pickInt(40, 100)]);
    $("path").value = pick(["orbit", "orbit", "rise", "sink"]);
    $("speed").value = pickInt(1, 2);
  } else {
    $("tile").value = pick([pickInt(16, 60), pickInt(60, 160), pickInt(160, 360)]);
    $("gap").value = pick([0, pickInt(2, 12), pickInt(10, 30)]);
    $("round").value = pick([0, pickInt(5, 30), pickInt(40, 100)]);
    $("shade").value = pickInt(0, 50);
    $("pattern").value = pickInt(0, 6);
    $("trans").value = pickInt(0, 3);
    $("ramp").value = pickInt(10, 80);
    $("rate").value = $("pattern").value === "0" ? pickInt(2, 16) : pickInt(1, 3);
    $("scale").value = pickInt(2, 20);
    $("angle").value = pickInt(-180, 180);
    $("jitter").value = pick([0, pickInt(5, 40), pickInt(40, 100)]);
    $("flash").value = pick([0, 0, pickInt(10, 60)]);
  }
  newSeed();
}

// ---------- slider number fields and wheel (same behaviour as index.html) ----------

function showNumber(n) { n.value = +(+n._range.value).toFixed(2); }
function syncNumbers() { document.querySelectorAll("input.num").forEach((n) => { if (document.activeElement !== n) showNumber(n); }); }
function numberFields(root) {
  root.querySelectorAll("input[type=range]").forEach((r) => {
    const out = r.nextElementSibling;
    if (!out || out.tagName !== "OUTPUT") return;
    const n = document.createElement("input"), wrap = document.createElement("span");
    wrap.className = "pb-number-wrap pb-w-sm";
    wrap.append(n);
    n.type = "number"; n.className = "pb-input num";
    n.min = r.min; n.max = r.max; n.step = r.step || 1;
    n.setAttribute("aria-label", document.querySelector(`label[for="${r.id}"]`)?.textContent.trim() || "Value");
    n._range = r;
    n.addEventListener("input", () => {
      if (n.value === "" || !isFinite(+n.value)) return;
      r.value = clamp(+n.value, +r.min, +r.max);
      r.dispatchEvent(new Event("input", { bubbles: true }));
    });
    n.addEventListener("change", () => showNumber(n));
    r.addEventListener("input", () => { if (document.activeElement !== n) showNumber(n); });
    out.replaceWith(wrap);
    showNumber(n);
  });
}
function wheelRanges() {
  let lastScroll = 0, acc = 0, accFor = null;
  addEventListener("scroll", () => { lastScroll = performance.now(); }, { capture: true, passive: true });
  addEventListener("wheel", (e) => {
    const r = e.target.closest?.("input[type=range]");
    if (!r || r.disabled || performance.now() - lastScroll < 300) return;
    e.preventDefault();
    if (accFor !== r) { acc = 0; accFor = r; }
    acc += (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? -e.deltaY : e.deltaX) * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1);
    const units = Math.trunc(acc / 25);
    if (!units) return;
    acc -= units * 25;
    const step = +r.step || 1, unit = Math.max(step, Math.round((r.max - r.min) / 100 / step) * step);
    const next = clamp(+r.value + units * unit, +r.min, +r.max);
    if (next === +r.value) return;
    r.value = next;
    r.dispatchEvent(new Event("input", { bubbles: true }));
  }, { passive: false });
}
function bindTabs() {
  const tabs = [...document.querySelectorAll('.app-side [role="tab"]')];
  const select = (t) => tabs.forEach((x) => { const on = x === t; x.setAttribute("aria-selected", on); x.tabIndex = on ? 0 : -1; $(x.getAttribute("aria-controls")).classList.toggle("active", on); });
  for (const t of tabs) {
    t.addEventListener("click", () => select(t));
    t.addEventListener("keydown", (e) => {
      const n = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!n) return;
      e.preventDefault();
      const next = tabs[(tabs.indexOf(t) + n + tabs.length) % tabs.length];
      select(next); next.focus();
    });
  }
}

// ---------- export ----------

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const fileBase = (p) => `ambient-${p.mode}-${p.seed}-${p.w}x${p.h}`;

async function exportPNG() {
  const p = readSettings();
  busy = true;
  try {
    draw(p, clock.t, p.w, p.h);
    // Copy in the same task as the draw, before the browser clears the drawing buffer.
    const c = document.createElement("canvas");
    c.width = p.w; c.height = p.h;
    c.getContext("2d").drawImage(R.canvas, 0, 0);
    download(await new Promise((r) => c.toBlob(r, "image/png")), fileBase(p) + ".png");
  } finally { busy = false; changed(); }
}

let videoAbort = null;
const even = (n) => n - (n % 2);
async function exportVideo() {
  const p = readSettings(), info = $("videoInfo"), bar = $("videoProgress");
  if (!window.StudioMP4?.supported) { info.textContent = "This browser has no WebCodecs video encoder. Use Chrome or Edge."; return; }
  const w = even(p.w), h = even(p.h), fps = p.fps, frames = Math.round(p.loop * fps), bitrate = p.vbr * 1e6;
  let config = await StudioMP4.pick(p.codec, w, h, fps, bitrate), note = "";
  if (!config) {
    const other = p.codec === "hevc" ? "avc" : "hevc";
    config = await StudioMP4.pick(other, w, h, fps, bitrate);
    if (config) note = ` ${p.codec === "hevc" ? "HEVC" : "H.264"} refused ${w}×${h}, so this file is ${other === "hevc" ? "HEVC" : "H.264"}.`;
  }
  if (!config) { info.textContent = `No HEVC or H.264 encoder here for ${w}×${h} at ${fps} fps.`; return; }
  busy = true;
  videoAbort = new AbortController();
  $("video").disabled = true; $("videoCancel").hidden = false; bar.hidden = false;
  const t0 = performance.now();
  try {
    const blob = await StudioMP4.encode({
      config, fps, frames, signal: videoAbort.signal,
      renderFrame(i) { draw(p, i / fps, w, h); return R.canvas; },
      onProgress(f) {
        bar.firstElementChild.style.width = Math.round(f * 100) + "%";
        const left = f > 0 ? ((performance.now() - t0) / f) * (1 - f) / 1000 : 0;
        info.textContent = `Encoding ${frames} frames: ${Math.round(f * 100)}% · about ${Math.ceil(left)} s left`;
      },
    });
    download(blob, `${fileBase(p)}-${p.loop}s-${fps}fps.mp4`);
    info.textContent = `Saved ${(blob.size / 1e6).toFixed(1)} MB, ${frames} frames (${config.codec}) in ${((performance.now() - t0) / 1000).toFixed(1)} s.${note}`;
  } catch (e) {
    info.textContent = e.name === "AbortError" ? "Canceled." : `Export failed: ${e.message}`;
  } finally {
    busy = false; videoAbort = null;
    $("video").disabled = false; $("videoCancel").hidden = true; bar.hidden = true;
    changed();
  }
}

// Full window: the canvas moves to <body> and fills it. Escape or double-click returns.
function setFull(on) {
  document.body.classList.toggle("full", on);
  if (on) { document.body.append(R.canvas); R.canvas.style.width = R.canvas.style.height = ""; document.documentElement.requestFullscreen?.().catch(() => {}); }
  else { stage.append(R.canvas); if (document.fullscreenElement) document.exitFullscreen(); }
  changed();
}

// ---------- wiring ----------

const params = new URLSearchParams(location.hash.slice(1));
for (const [k, v] of params) {
  if (k === "lock") $("lock").checked = v === "1";
  else if ((k === "res" || k === "w" || k === "h" || IDS.includes(k)) && $(k)) $(k).value = v;
}
if (!params.has("seed")) $("seed").value = Math.floor(Math.random() * 1e9);
if (!params.has("c0")) { const pl = makePalette(4, "auto", "rich", null); pl.colors.forEach((c, i) => ($("c" + i).value = c)); $("bg").value = pl.bg; }
if (params.has("full")) document.body.classList.add("full");

document.querySelectorAll("aside input, aside select, #mode").forEach((el) => el.addEventListener("input", changed));
// Fewer colors than the palette has: refill from the generator so every swatch shown is intentional.
$("harmony").addEventListener("change", newColors);
$("mood").addEventListener("change", newColors);
bindTabs();
numberFields(document.querySelector("aside"));
wheelRanges();
$("scrub").addEventListener("input", () => { if (current) clock.t = ($("scrub").value / 1000) * current.p.loop; setPlaying(false); });
$("play").onclick = () => setPlaying(!clock.playing);
$("newColors").onclick = newColors;
$("shuffle").onclick = shuffle;
$("reseed").onclick = newSeed;
$("exportPng").onclick = exportPNG;
$("video").onclick = exportVideo;
$("videoCancel").onclick = () => videoAbort?.abort();
$("fullBtn").onclick = () => setFull(true);
addEventListener("dblclick", (e) => { if (document.body.classList.contains("full")) setFull(false); else if (e.target === R?.canvas) setFull(true); });
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && document.body.classList.contains("full")) setFull(false); });
addEventListener("resize", changed);
addEventListener("keydown", (e) => {
  if (e.target.matches("input[type=number], input[type=text], select")) return;
  if (e.key === "Escape" && document.body.classList.contains("full")) setFull(false);
  if (e.code === "Space" && e.target.matches("button, [role=tab], a")) return;
  if (e.code === "Space") { e.preventDefault(); setPlaying(!clock.playing); }
  const k = e.key.toLowerCase();
  if (k === "p") setPlaying(!clock.playing);
  if (k === "n") newSeed();
  if (k === "s") shuffle();
  if (k === "c") newColors();
  if (k === "f") setFull(!document.body.classList.contains("full"));
});
if (!isSecureContext || !window.StudioMP4?.supported) {
  $("video").disabled = true;
  $("videoInfo").textContent = !isSecureContext ? "Video export needs a secure page: open it as http://localhost:8931 or over https." : "This browser has no WebCodecs video encoder. Use Chrome or Edge.";
}
if (document.body.classList.contains("full") && R) { document.body.append(R.canvas); }
layoutPreview();
drawPreview();
requestAnimationFrame(tick);
