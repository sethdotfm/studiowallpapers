"use strict";
// WebGL2 renderer. Draws one view (a rect of the wall, in wall pixels) into outW×outH device pixels.
// Bloom is computed from the whole wall at low resolution and sampled by wall position, so the glow
// carries across bezels and every screen of a wall gets the same glow it would in one big render.
// Frame data comes from buildFrame() in index.html; this file only knows about buffers and shaders.
(() => {
  const HEAD = "#version 300 es\nprecision highp float;\n";

  const VS_VIEW = `#version 300 es
uniform vec4 uView;
vec4 place(vec2 p) {
  vec2 c = (p - uView.xy) / uView.zw;
  return vec4(c.x * 2.0 - 1.0, 1.0 - c.y * 2.0, 0.0, 1.0);
}`;

  const VS_RIBBON = VS_VIEW + `
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec4 aA; // across, along, phase, edge
layout(location = 2) in float aEnv;
out float vAcross, vU, vPh, vEdge, vEnv;
void main() {
  gl_Position = place(aPos);
  vAcross = aA.x; vU = aA.y; vPh = aA.z; vEdge = aA.w; vEnv = aEnv;
}`;

  // Cross-section of thick glass. Keep in step with the stop list the Canvas 2D version used:
  // hot bevel, dark core, a reflection band near the lit wall, a sheen that slides with the twist,
  // and a refracted far bevel. Side wall shows when the ribbon turns (edge != 0).
  const FS_RIBBON = HEAD + `
uniform vec3 cRimHot, cRim, cCore075, cCore1, cCore09, cCore13, cSheen, cRefract, cRefractHot, cRefl, cWall;
uniform float uBody;
uniform vec2 uRefl;
in float vAcross, vU, vPh, vEdge, vEnv;
out vec4 o;
float P[13]; vec4 C[13];
vec4 ramp(float x) {
  vec4 c = C[0];
  for (int i = 1; i < 13; i++) {
    if (x <= P[i]) { float d = P[i] - P[i - 1]; return mix(C[i - 1], C[i], d > 1e-5 ? clamp((x - P[i - 1]) / d, 0.0, 1.0) : 1.0); }
    c = C[i];
  }
  return c;
}
void main() {
  float e = vEnv;
  if (e < 0.003) discard;
  // Analytic edge coverage. The strip runs about a pixel past each edge (across < 0 or > 1 there), so
  // the edge fades by its exact distance in pixels; 4x MSAA alone steps visibly on shallow bright rims.
  float edgePx = min(vAcross, 1.0 - vAcross) / max(fwidth(vAcross), 1e-6);
  float cov = clamp(edgePx + 0.5, 0.0, 1.0);
  if (cov <= 0.0) discard;
  float ac = clamp(vAcross, 0.0, 1.0);
  bool front = cos(vPh) >= 0.0;
  float lit = front ? 1.0 : 0.7;
  float x = front ? ac : 1.0 - ac;
  float f = vEdge * (front ? 1.0 : -1.0), af = min(1.0, abs(f));
  float ea = e * uBody;
  vec4 col;
  if (af > 0.01 && (f > 0.0 ? x < af : x > 1.0 - af)) {
    float w = f > 0.0 ? x / af : (1.0 - x) / af;
    vec4 a = vec4(cRimHot, e), b = vec4(cWall, 0.9 * e), c = vec4(cRimHot, 0.85 * e);
    col = w < 0.5 ? mix(a, b, w * 2.0) : mix(b, c, w * 2.0 - 1.0);
  } else {
    float k = max(1e-4, 1.0 - af);
    float u = f > 0.0 ? (x - af) / k : x / k;
    float mirror = pow(max(0.0, sin(6.2831853 * uRefl.x * vU + uRefl.y)), 6.0) * lit * e;
    float hl = 0.62 + 0.18 * sin(vPh), hl2 = 0.22 + 0.05 * sin(vPh * 1.7);
    P[0] = 0.0;   C[0] = vec4(cRimHot, e * lit);
    P[1] = 0.012; C[1] = vec4(cRim, 0.95 * e * lit);
    P[2] = 0.05;  C[2] = vec4(cRim, 0.7 * e * lit);
    P[3] = 0.1;   C[3] = vec4(cCore075, 0.9 * ea);
    P[4] = hl2 - 0.06; C[4] = vec4(cCore1, 0.85 * ea);
    P[5] = hl2;   C[5] = vec4(cRefl, (0.15 + 0.75 * mirror) * e);
    P[6] = hl2 + 0.07; C[6] = vec4(cCore1, 0.85 * ea);
    P[7] = max(hl2 + 0.1, hl - 0.16); C[7] = vec4(cCore1, 0.85 * ea);
    P[8] = hl;    C[8] = vec4(cSheen, (0.7 + 0.3 * mirror) * ea * lit);
    P[9] = min(0.86, hl + 0.2); C[9] = vec4(cCore09, 0.85 * ea);
    P[10] = 0.9;  C[10] = vec4(cCore13, 0.9 * ea);
    P[11] = 0.96; C[11] = vec4(cRefract, 0.85 * e * lit);
    P[12] = 1.0;  C[12] = vec4(cRefractHot, e * lit);
    col = ramp(u);
  }
  col.a = clamp(col.a, 0.0, 1.0) * cov;
  o = vec4(col.rgb * col.a, col.a);
}`;

  const VS_SPEC = VS_VIEW + `
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aS; // across (-1..1), intensity
out float vX, vI;
void main() { gl_Position = place(aPos); vX = aS.x; vI = aS.y; }`;

  const FS_SPEC = HEAD + `
uniform vec3 cSpec;
uniform float uHalf, uExtent; // device px: hairline half width, strip half extent
in float vX, vI;
out vec4 o;
void main() {
  float cov = clamp(uHalf - abs(vX) * uExtent + 0.5, 0.0, 1.0);
  o = vec4(cSpec * vI * cov, 0.0);
}`;

  const VS_BITS = VS_VIEW + `
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aL;
layout(location = 2) in vec4 aC;
out vec2 vL;
out vec4 vC;
void main() { gl_Position = place(aPos); vL = aL; vC = aC; }`;

  // vL is position in half-sizes (edges at ±1, quad padded past them), so moving squares slide
  // smoothly instead of snapping a whole pixel at a time.
  const FS_BITS = HEAD + `in vec2 vL; in vec4 vC; out vec4 o;
void main() {
  vec2 d = (1.0 - abs(vL)) / max(fwidth(vL), vec2(1e-6));
  vec2 c = clamp(d + 0.5, 0.0, 1.0);
  o = vC * c.x * c.y;
}`;

  const VS_FULL = `#version 300 es
out vec2 vT;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vT = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

  // vT runs bottom-up; wall y runs top-down.
  const WALLPOS = `
uniform vec4 uView;
vec2 wallPos(vec2 t) { return vec2(uView.x + t.x * uView.z, uView.y + (1.0 - t.y) * uView.w); }`;

  const FS_BG = HEAD + WALLPOS + `
uniform vec2 uWall, uFocal;
uniform vec3 cBg0, cBg1, cBg2;
uniform float uBg;
in vec2 vT;
out vec4 o;
void main() {
  vec2 w = wallPos(vT);
  float d = length(w - uFocal) / (max(uWall.x, uWall.y) * 0.8);
  vec4 g = d < 0.5 ? mix(vec4(cBg0, 0.85 * uBg), vec4(cBg1, 0.45 * uBg), d * 2.0)
                   : mix(vec4(cBg1, 0.45 * uBg), vec4(cBg2, 0.0), clamp(d * 2.0 - 1.0, 0.0, 1.0));
  vec3 c = g.rgb * g.a;
  c *= 1.0 - 0.35 * clamp(1.0 - (w.y / uWall.y) / 0.6, 0.0, 1.0);
  o = vec4(c, 1.0);
}`;

  const FS_DOWN = HEAD + `uniform sampler2D uTex; in vec2 vT; out vec4 o; void main() { o = texture(uTex, vT); }`;
  const FS_UPADD = HEAD + `uniform sampler2D uTex; uniform float uK; in vec2 vT; out vec4 o; void main() { o = texture(uTex, vT) * uK; }`;

  // Cubic B-spline from four bilinear taps; a plain bilinear stretch of the 1/8 level shows as blocks.
  const BICUBIC = `
vec4 bicubic(sampler2D t, vec2 uv) {
  vec2 sz = vec2(textureSize(t, 0)), p = uv * sz - 0.5, f = fract(p), i = p - f;
  vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0, w1 = (4.0 - 6.0 * f * f + 3.0 * f * f * f) / 6.0;
  vec2 w3 = f * f * f / 6.0, w2 = 1.0 - w0 - w1 - w3;
  vec2 s0 = w0 + w1, s1 = w2 + w3;
  vec2 c0 = (i - 0.5 + w1 / s0) / sz, c1 = (i + 1.5 + w3 / s1) / sz;
  return s0.y * (s0.x * texture(t, vec2(c0.x, c0.y + 0.0)) + s1.x * texture(t, vec2(c1.x, c0.y)))
       + s1.y * (s0.x * texture(t, vec2(c0.x, c1.y)) + s1.x * texture(t, vec2(c1.x, c1.y)));
}`;

  const FS_FINAL = HEAD + WALLPOS + BICUBIC + `
uniform sampler2D uScene, uBloom, uOverlay;
uniform vec2 uWall, uOut;
uniform float uBloomK, uGrain, uHasBloom, uHasOverlay;
in vec2 vT;
out vec4 o;
float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
void main() {
  vec3 c = texture(uScene, vT).rgb;
  vec2 w = wallPos(vT);
  if (uHasBloom > 0.5) {
    vec3 b = bicubic(uBloom, vec2(w.x / uWall.x, 1.0 - w.y / uWall.y)).rgb;
    c = 1.0 - (1.0 - c) * (1.0 - b * uBloomK);
  }
  vec2 ctr = uWall * 0.5;
  float r0 = min(uWall.x, uWall.y) * 0.35, r1 = length(uWall) * 0.6;
  c *= 1.0 - 0.5 * clamp((length(w - ctr) - r0) / (r1 - r0), 0.0, 1.0);
  if (uGrain > 0.0) {
    float n = hash(gl_FragCoord.xy);
    vec3 ov = mix(2.0 * c * n, 1.0 - 2.0 * (1.0 - c) * (1.0 - n), step(0.5, c));
    c = mix(c, ov, uGrain);
  }
  // Static dither: dark green gradients band badly in 8-bit output and in video.
  c += (hash(gl_FragCoord.xy + 17.0) - 0.5) / 255.0;
  // Labels: premultiplied, uploaded flipped so gl_FragCoord / uOut addresses it directly.
  if (uHasOverlay > 0.5) { vec4 l = texture(uOverlay, gl_FragCoord.xy / uOut); c = c * (1.0 - l.a) + l.rgb; }
  o = vec4(c, 1.0);
}`;

  function create() {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false });
    if (!gl) return null;
    let lost = false;
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); lost = true; });
    canvas.addEventListener("webglcontextrestored", () => { lost = false; init(); });

    let P = {}, vaos = {}, vbos = {}, T = {};

    function prog(vs, fs) {
      const p = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        gl.attachShader(p, s);
      }
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
      return { p, u };
    }

    function vao(name, layout) {
      const a = gl.createVertexArray(), b = gl.createBuffer();
      gl.bindVertexArray(a);
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      const stride = layout.reduce((s, n) => s + n, 0) * 4;
      let off = 0;
      layout.forEach((n, i) => { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, n, gl.FLOAT, false, stride, off); off += n * 4; });
      gl.bindVertexArray(null);
      vaos[name] = a; vbos[name] = b;
    }

    function init() {
      P = {
        ribbon: prog(VS_RIBBON, FS_RIBBON), spec: prog(VS_SPEC, FS_SPEC), bits: prog(VS_BITS, FS_BITS),
        bg: prog(VS_FULL, FS_BG), down: prog(VS_FULL, FS_DOWN), up: prog(VS_FULL, FS_UPADD), final: prog(VS_FULL, FS_FINAL),
      };
      vaos = {}; vbos = {}; T = {};
      vao("ribbon", [2, 4, 1]);
      vao("spec", [2, 2]);
      vao("bits", [2, 2, 4]);
      vaos.empty = gl.createVertexArray();
    }
    init();

    const maxRB = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
    const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));

    function tex(w, h) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
      for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR);
      for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE);
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return { t, f, w, h };
    }
    function free(x) { if (x) { gl.deleteTexture(x.t); gl.deleteFramebuffer(x.f); if (x.rb) gl.deleteRenderbuffer(x.rb); } }

    // Multisampled target for geometry, resolved into a texture for the final pass.
    function target(key, w, h, ms) {
      const cur = T[key];
      if (cur && cur.w === w && cur.h === h) return cur;
      free(cur); if (cur && cur.ms) { gl.deleteFramebuffer(cur.ms.f); gl.deleteRenderbuffer(cur.ms.rb); }
      const t = tex(w, h);
      if (ms && samples > 1) {
        const rb = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h);
        const f = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
        t.ms = { f, rb };
      }
      T[key] = t;
      return t;
    }

    function levels(w, h, n) {
      const key = `lv${w}x${h}x${n}`;
      if (T.levels && T.levels.key === key) return T.levels.list;
      if (T.levels) T.levels.list.forEach(free);
      const list = [];
      for (let i = 0; i < n; i++) { list.push(tex(w, h)); w = Math.max(1, Math.ceil(w / 2)); h = Math.max(1, Math.ceil(h / 2)); }
      T.levels = { key, list };
      return list;
    }

    function setColors(u, pal) { for (const k in pal) if (u[k]) gl.uniform3fv(u[k], pal[k]); }

    function drawScene(frame, view, outW, outH, pxDev) {
      gl.viewport(0, 0, outW, outH);
      gl.disable(gl.BLEND);
      gl.useProgram(P.bg.p);
      const ub = P.bg.u;
      gl.uniform4fv(ub.uView, view);
      gl.uniform2f(ub.uWall, frame.W, frame.H);
      gl.uniform2fv(ub.uFocal, frame.focal);
      gl.uniform3fv(ub.cBg0, frame.bg[0]); gl.uniform3fv(ub.cBg1, frame.bg[1]); gl.uniform3fv(ub.cBg2, frame.bg[2]);
      gl.uniform1f(ub.uBg, frame.bgK);
      gl.bindVertexArray(vaos.empty);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.enable(gl.BLEND);
      for (const rb of frame.ribbons) {
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(P.ribbon.p);
        const u = P.ribbon.u;
        gl.uniform4fv(u.uView, view);
        setColors(u, rb.pal);
        gl.uniform1f(u.uBody, rb.body);
        gl.uniform2fv(u.uRefl, rb.refl);
        gl.bindVertexArray(vaos.ribbon);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbos.ribbon);
        gl.bufferData(gl.ARRAY_BUFFER, rb.strip, gl.STREAM_DRAW);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, rb.strip.length / 7);

        if (!rb.spec) continue;
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(P.spec.p);
        const us = P.spec.u;
        gl.uniform4fv(us.uView, view);
        gl.uniform3fv(us.cSpec, rb.pal.cSpec);
        // Strip geometry is sized for the main view; scale both by this pass's px (bloom runs smaller).
        gl.uniform1f(us.uHalf, (frame.hair * pxDev) / 2);
        gl.uniform1f(us.uExtent, frame.specExtent * pxDev);
        gl.bindVertexArray(vaos.spec);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbos.spec);
        for (const s of rb.spec) {
          gl.bufferData(gl.ARRAY_BUFFER, s, gl.STREAM_DRAW);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, s.length / 4);
        }
      }

      if (frame.bits && frame.bits.length) {
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(P.bits.p);
        gl.uniform4fv(P.bits.u.uView, view);
        gl.bindVertexArray(vaos.bits);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbos.bits);
        gl.bufferData(gl.ARRAY_BUFFER, frame.bits, gl.STREAM_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, frame.bits.length / 8);
      }
      gl.disable(gl.BLEND);
    }

    function fullPass(prg, dst, w, h) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst);
      gl.viewport(0, 0, w, h);
      gl.useProgram(prg.p);
      gl.bindVertexArray(vaos.empty);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // Keep in step with the Canvas 2D bloom it replaced: levels from 1/8 of the wall down, each added
    // onto the next larger at 0.8, screened over the frame at amount * 0.45.
    function bloom(frame, wallPx) {
      const W = frame.W, H = frame.H;
      // The base level is 1/8 of the wall, capped: on a wide wall exported one screen at a time, a true
      // 1/8 wall costs more than the screen itself, and past ~1.5k px the blur looks the same.
      let s8 = wallPx / 8;
      s8 = Math.min(s8, 1536 / W, 1536 / H);
      const baseW = Math.max(1, Math.ceil(W * s8)), baseH = Math.max(1, Math.ceil(H * s8));
      let mul = 2;
      while (mul > 1 && (baseW * mul > maxRB || baseH * mul > maxRB)) mul /= 2;
      const src = target("bloomSrc", baseW * mul, baseH * mul, false);
      gl.bindFramebuffer(gl.FRAMEBUFFER, src.f);
      drawScene(frame, [0, 0, W, H], src.w, src.h, s8 * mul);
      let n = 1, w = baseW, h = baseH;
      while (n < 7 && w >= 4 && h >= 4) { n++; w = Math.ceil(w / 2); h = Math.ceil(h / 2); }
      const lv = levels(baseW, baseH, n);
      // Halve from the source to the base, one 2x step at a time so each step is an exact 2x2 average.
      let prev = src;
      while (prev.w > baseW * 1.5) {
        const half = prev.w / 2 > baseW * 1.5 ? target("bloomHalf", Math.ceil(prev.w / 2), Math.ceil(prev.h / 2), false) : lv[0];
        gl.bindTexture(gl.TEXTURE_2D, prev.t);
        fullPass(P.down, half.f, half.w, half.h);
        prev = half;
      }
      if (prev !== lv[0]) { gl.bindTexture(gl.TEXTURE_2D, prev.t); fullPass(P.down, lv[0].f, lv[0].w, lv[0].h); }
      for (let i = 1; i < lv.length; i++) { gl.bindTexture(gl.TEXTURE_2D, lv[i - 1].t); fullPass(P.down, lv[i].f, lv[i].w, lv[i].h); }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(P.up.p);
      gl.uniform1f(P.up.u.uK, 0.8);
      for (let i = lv.length - 2; i >= 0; i--) { gl.bindTexture(gl.TEXTURE_2D, lv[i + 1].t); fullPass(P.up, lv[i].f, lv[i].w, lv[i].h); }
      gl.disable(gl.BLEND);
      return lv[0];
    }

    // Labels and images from the 2D overlay, as a texture laid over the output. Static per output, so
    // upload once and reuse every frame; reading the GL canvas back into 2D each frame is what was slow.
    function overlay(src) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR);
      for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE);
      return { t, free: () => gl.deleteTexture(t) };
    }

    // tiles: [{ view: [x, y, w, h] in wall px, dx, dy, w, h } in output px, top-left origin].
    // Several tiles make a span with the bezels cut out; the wall-wide bloom is computed once for all.
    function render(frame, tiles, outW, outH, ov) {
      if (lost) return false;
      outW = Math.max(1, Math.min(outW | 0, maxRB)); outH = Math.max(1, Math.min(outH | 0, maxRB));
      if (canvas.width !== outW || canvas.height !== outH) { canvas.width = outW; canvas.height = outH; }
      const pxDev = tiles[0].w / tiles[0].view[2];
      const b = frame.glow > 0 ? bloom(frame, pxDev) : null;
      for (const tl of tiles) {
        const sc = target("scene", tl.w, tl.h, true);
        gl.bindFramebuffer(gl.FRAMEBUFFER, sc.ms ? sc.ms.f : sc.f);
        drawScene(frame, tl.view, tl.w, tl.h, tl.w / tl.view[2]);
        if (sc.ms) {
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sc.ms.f);
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, sc.f);
          gl.blitFramebuffer(0, 0, tl.w, tl.h, 0, 0, tl.w, tl.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(tl.dx, outH - tl.dy - tl.h, tl.w, tl.h);
        gl.useProgram(P.final.p);
        const u = P.final.u;
        gl.uniform4fv(u.uView, tl.view);
        gl.uniform2f(u.uWall, frame.W, frame.H);
        gl.uniform2f(u.uOut, outW, outH);
        gl.uniform1f(u.uBloomK, Math.min(1, frame.glow * 0.45));
        gl.uniform1f(u.uHasBloom, b ? 1 : 0);
        gl.uniform1f(u.uHasOverlay, ov ? 1 : 0);
        gl.uniform1f(u.uGrain, frame.grain * 0.35);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sc.t); gl.uniform1i(u.uScene, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, b ? b.t : sc.t); gl.uniform1i(u.uBloom, 1);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, ov ? ov.t : sc.t); gl.uniform1i(u.uOverlay, 2);
        gl.bindVertexArray(vaos.empty);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.activeTexture(gl.TEXTURE0);
      }
      return true;
    }

    return { canvas, render, overlay, maxSize: maxRB, get lost() { return lost; } };
  }

  window.StudioGL = { create };
})();
