"use strict";
// Per-screen label overlay: one text layer and one image layer, laid out once
// on a mini editor (screen 0) and replayed on every screen in virtual pixels.
(() => {
  const KEY = "studioOverlay.v1";
  const FONT = '"Studio Segoe", "Segoe UI", system-ui, -apple-system, sans-serif'; // Studio Segoe: @font-face in index.html
  const MAX_SAVED_IMAGE = 1.5e6; // chars of data URL; keeps well under the ~5MB origin quota

  const DEF = {
    text: { on: false, series: "UTILITY PC", style: "num", start: "1", x: 0.5, y: 0.88, size: 0.05, weight: 600, spacing: 0.08, opacity: 0.9, color: "#ffffff", useAccent: false, align: "center" },
    image: { on: false, src: "", name: "", x: 0.5, y: 0.12, size: 0.15, opacity: 1 },
  };
  const LIMITS = {
    x: [0, 1], y: [0, 1], size: [0.01, 1], weight: [100, 900], spacing: [-0.05, 0.5], opacity: [0, 1],
  };

  const S = JSON.parse(JSON.stringify(DEF));
  const img = new Image();
  let imgReady = false;
  let host = null, el = {}, cb = {};
  let previewCanvas = null;
  let snap = null, snapScreen = null; // clean crop of screen 0, taken before overlays are drawn
  let active = "text";
  let headless = null; // { accent } when driven from a kiosk URL with no panel mounted
  const scratch = document.createElement("canvas").getContext("2d");

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const num = (v, d, k) => (Number.isFinite(+v) && v !== "" && v !== null ? clamp(+v, ...LIMITS[k]) : d);

  // ---------- labels ----------

  const decodeAlpha = (s) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1; // A=0, AA=26
  function encodeAlpha(n) {
    let s = "";
    for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  }
  function modifier(i) {
    const raw = String(S.text.start).trim().toUpperCase();
    const isAlpha = /^[A-Z]+$/.test(raw);
    if (S.text.style === "none") return "";
    if (S.text.style === "alpha") {
      const base = isAlpha ? decodeAlpha(raw) : /^-?\d+$/.test(raw) ? Math.max(0, +raw - 1) : 0;
      return encodeAlpha(base + i);
    }
    const base = /^-?\d+$/.test(raw) ? +raw : isAlpha ? decodeAlpha(raw) + 1 : 1;
    return String(base + i);
  }
  const labelFor = (i) => [S.text.series.trim(), modifier(i)].filter(Boolean).join(" ");
  const inReadingOrder = (screens) => screens.slice().sort((a, b) => a.row - b.row || a.col - b.col);

  // ---------- drawing ----------

  function setFont(ctx, h) {
    const t = S.text, px = t.size * h;
    ctx.font = `${Math.round(t.weight)} ${px}px ${FONT}`;
    // letterSpacing adds a trailing gap; callers offset for it
    if ("letterSpacing" in ctx) ctx.letterSpacing = t.spacing * px + "px";
    return px;
  }

  function textBounds(ctx, w, h, label) {
    const t = S.text, px = setFont(ctx, h);
    const tw = ctx.measureText(label).width;
    const x0 = t.align === "left" ? t.x * w : t.align === "right" ? t.x * w - tw : t.x * w - tw / 2;
    return { x0, y0: t.y * h - px * 0.6, x1: x0 + tw, y1: t.y * h + px * 0.6 };
  }

  function imageBounds(w, h) {
    const i = S.image, iw = i.size * w;
    const ih = iw * ((img.naturalHeight || 1) / (img.naturalWidth || 1));
    return { x0: i.x * w - iw / 2, y0: i.y * h - ih / 2, x1: i.x * w + iw / 2, y1: i.y * h + ih / 2, iw, ih };
  }

  function drawLayers(ctx, w, h, label, accent) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    ctx.globalCompositeOperation = "source-over";
    if (S.image.on && imgReady) {
      const b = imageBounds(w, h);
      ctx.globalAlpha = S.image.opacity;
      ctx.drawImage(img, b.x0, b.y0, b.iw, b.ih);
    }
    if (S.text.on && label) {
      const t = S.text;
      const px = setFont(ctx, h);
      const ls = "letterSpacing" in ctx ? t.spacing * px : 0;
      ctx.globalAlpha = t.opacity;
      ctx.fillStyle = t.useAccent ? accent : t.color;
      ctx.textAlign = t.align;
      ctx.textBaseline = "middle";
      const shift = t.align === "center" ? ls / 2 : t.align === "right" ? ls : 0;
      ctx.fillText(label, t.x * w + shift, t.y * h);
    }
    ctx.restore();
  }

  function accentColour() {
    if (headless) return headless.accent;
    try { return cb.getPreview().settings.accent || "#7fd321"; } catch { return "#7fd321"; }
  }

  function draw(ctx, screens) {
    if (!screens || !screens.length) return;
    const ordered = inReadingOrder(screens);
    if (ctx.canvas === previewCanvas) {
      const s = ordered[0], k = ctx.getTransform().a;
      snapScreen = { w: s.w, h: s.h };
      const sw = Math.max(1, Math.round(s.w * k)), sh = Math.max(1, Math.round(s.h * k));
      snap ||= document.createElement("canvas");
      if (snap.width !== sw || snap.height !== sh) { snap.width = sw; snap.height = sh; }
      const c = snap.getContext("2d");
      c.clearRect(0, 0, sw, sh);
      c.drawImage(ctx.canvas, Math.round(s.x * k), Math.round(s.y * k), sw, sh, 0, 0, sw, sh);
    }
    if ((S.text.on || S.image.on) && (host || headless)) {
      const accent = S.text.useAccent ? accentColour() : "#fff";
      ordered.forEach((s, i) => {
        ctx.save();
        ctx.translate(s.x, s.y);
        drawLayers(ctx, s.w, s.h, labelFor(i), accent);
        ctx.restore();
      });
    }
    refreshEditor();
  }

  // ---------- editor ----------

  function screenSize() {
    if (snapScreen) return snapScreen;
    try { const { settings } = cb.getPreview(); return { w: settings.w, h: settings.h }; } catch { return { w: 1920, h: 1080 }; }
  }

  function refreshEditor() {
    const cv = el.canvas;
    if (!cv || !cv.clientWidth) return;
    const { w, h } = screenSize();
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(cv.clientWidth * dpr), ch = Math.max(1, Math.round((cw * h) / w));
    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    cv.style.aspectRatio = `${w} / ${h}`;
    const ctx = cv.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#1b1f1b";
    ctx.fillRect(0, 0, cw, ch);
    if (snap) ctx.drawImage(snap, 0, 0, cw, ch);
    const k = cw / w;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    drawLayers(ctx, w, h, labelFor(0), accentColour());
    const layer = S[active];
    if (layer.on) {
      const b = active === "text" ? textBounds(ctx, w, h, labelFor(0) || " ") : imageBounds(w, h);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = "#7fd321";
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(b.x0 * k) + 0.5, Math.round(b.y0 * k) + 0.5, Math.round((b.x1 - b.x0) * k), Math.round((b.y1 - b.y0) * k));
      ctx.setLineDash([]);
    }
  }

  function hit(px, py, w, h) {
    const inside = (b) => b && px >= b.x0 - 6 && px <= b.x1 + 6 && py >= b.y0 - 6 && py <= b.y1 + 6;
    if (S.text.on && labelFor(0) && inside(textBounds(scratch, w, h, labelFor(0)))) return "text";
    if (S.image.on && imgReady && inside(imageBounds(w, h))) return "image";
    return null;
  }

  function bindDrag() {
    const cv = el.canvas;
    let drag = null;
    const pos = (e) => {
      const r = cv.getBoundingClientRect(), { w, h } = screenSize();
      return { px: ((e.clientX - r.left) / r.width) * w, py: ((e.clientY - r.top) / r.height) * h, w, h };
    };
    cv.addEventListener("pointerdown", (e) => {
      const p = pos(e), which = hit(p.px, p.py, p.w, p.h);
      if (!which) return;
      active = which;
      const L = S[which];
      drag = { which, dx: L.x * p.w - p.px, dy: L.y * p.h - p.py };
      cv.setPointerCapture(e.pointerId);
      cv.focus();
      refreshEditor();
    });
    cv.addEventListener("pointermove", (e) => {
      const p = pos(e);
      if (!drag) { cv.style.cursor = hit(p.px, p.py, p.w, p.h) ? "grab" : "default"; return; }
      cv.style.cursor = "grabbing";
      const L = S[drag.which];
      L.x = clamp((p.px + drag.dx) / p.w, 0, 1);
      L.y = clamp((p.py + drag.dy) / p.h, 0, 1);
      changed();
    });
    const end = () => { drag = null; };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    cv.addEventListener("keydown", (e) => {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!d) return;
      e.preventDefault();
      const L = S[active], step = e.shiftKey ? 0.05 : 0.005;
      L.x = clamp(L.x + d[0] * step, 0, 1);
      L.y = clamp(L.y + d[1] * step, 0, 1);
      changed();
    });
  }

  // ---------- panel ----------

  const pct = (v) => Math.round(v * 100) + "%";
  const RANGES = [
    ["text", "size", "Size", 0.01, 0.3, 0.001, (v) => (v * 100).toFixed(1) + "%"],
    ["text", "weight", "Weight", 100, 900, 100, (v) => v],
    ["text", "spacing", "Spacing", -0.05, 0.5, 0.01, (v) => v.toFixed(2)],
    ["text", "opacity", "Opacity", 0, 1, 0.01, pct],
    ["text", "x", "Position X", 0, 1, 0.001, pct],
    ["text", "y", "Position Y", 0, 1, 0.001, pct],
    ["image", "size", "Size", 0.02, 1, 0.001, pct],
    ["image", "opacity", "Opacity", 0, 1, 0.01, pct],
    ["image", "x", "Position X", 0, 1, 0.001, pct],
    ["image", "y", "Position Y", 0, 1, 0.001, pct],
  ];
  // Rows for a pb-form; the page turns each range's <output> into a number field.
  const rangeHtml = (layer) => RANGES.filter((r) => r[0] === layer).map(([l, k, label, min, max, step]) => `
      <span class="pb-form__label">${label}</span>
      <div class="pb-form__field pb-row"><input type="range" class="pb-range pb-grow" aria-label="${label}" data-l="${l}" data-k="${k}" min="${min}" max="${max}" step="${step}" data-scale="${max <= 1 && k !== "spacing" ? 100 : 1}"><output></output></div>`).join("");

  function build() {
    host.insertAdjacentHTML("beforeend", `
<div class="ov">
  <canvas class="ov__edit" tabindex="0" aria-label="Label position on screen 1. Drag, or use arrow keys."></canvas>
  <p class="pb-note">Drag in the preview of screen 1. Every screen gets its own label in the same spot.</p>

  <section class="pb-section">
    <label class="pb-check"><input type="checkbox" role="switch" class="pb-switch__input" data-l="text" data-k="on"><span class="pb-check__label">Text label</span></label>
    <div class="pb-form">
      <label class="pb-form__label" for="ov-series">Series</label>
      <div class="pb-form__field"><input type="text" class="pb-input" id="ov-series" data-l="text" data-k="series" maxlength="60" autocomplete="off" spellcheck="false" placeholder="UTILITY PC"></div>
      <label class="pb-form__label" for="ov-style">Modifier</label>
      <div class="pb-form__field"><span class="pb-select-wrap"><select class="pb-select" id="ov-style" data-l="text" data-k="style">
        <option value="num">Numbers 1, 2, 3…</option>
        <option value="alpha">Letters A, B, C…</option>
        <option value="none">None</option>
      </select></span></div>
      <label class="pb-form__label" for="ov-start">Start at</label>
      <div class="pb-form__field"><input type="text" class="pb-input pb-w-sm" id="ov-start" data-l="text" data-k="start" maxlength="3" autocomplete="off" spellcheck="false"></div>
      ${rangeHtml("text")}
      <label class="pb-form__label" for="ov-align">Align</label>
      <div class="pb-form__field"><span class="pb-select-wrap"><select class="pb-select" id="ov-align" data-l="text" data-k="align"><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select></span></div>
      <label class="pb-form__label" for="ov-color">Colour</label>
      <div class="pb-form__field pb-row">
        <input type="color" class="pb-input" id="ov-color" data-l="text" data-k="color">
        <label class="pb-check"><input type="checkbox" class="pb-check__input" data-l="text" data-k="useAccent"><span class="pb-check__label">Use accent</span></label>
      </div>
    </div>
    <div class="pb-row"><button type="button" class="pb-btn pb-btn--sm" data-act="reset-text">Reset text</button></div>
  </section>

  <section class="pb-section">
    <label class="pb-check"><input type="checkbox" role="switch" class="pb-switch__input" data-l="image" data-k="on"><span class="pb-check__label">Image (PNG or SVG)</span></label>
    <div class="pb-row pb-row--wrap">
      <input type="file" class="ov__file" accept="image/png,image/svg+xml" aria-label="Upload PNG or SVG">
      <button type="button" class="pb-btn pb-btn--sm" data-act="clear-image">Remove</button>
    </div>
    <p class="pb-note ov__name"></p>
    <div class="pb-form">${rangeHtml("image")}</div>
  </section>
</div>`);
    el.canvas = host.querySelector(".ov__edit");
    el.file = host.querySelector(".ov__file");
    el.name = host.querySelector(".ov__name");
    el.accent = host.querySelector('[data-k="useAccent"]');
  }

  const field = (n) => host.querySelector(`[data-l="${n.l}"][data-k="${n.k}"]`);

  function syncUI() {
    host.querySelectorAll("[data-l]").forEach((n) => {
      const v = S[n.dataset.l][n.dataset.k];
      if (n.type === "checkbox") n.checked = !!v;
      else if (document.activeElement !== n) n.value = v;
    });
    field({ l: "text", k: "color" }).disabled = S.text.useAccent;
    field({ l: "text", k: "start" }).disabled = S.text.style === "none";
    field({ l: "text", k: "start" }).placeholder = S.text.style === "alpha" ? "A" : "1";
    el.name.textContent = S.image.src ? (S.image.name || "Image loaded") : "No image yet.";
  }

  function onInput(e) {
    const n = e.target, l = n.dataset.l, k = n.dataset.k;
    if (!l) return;
    if (n.type === "checkbox") S[l][k] = n.checked;
    else if (n.type === "range") S[l][k] = num(n.value, DEF[l][k], k);
    else S[l][k] = n.value;
    if (k !== "on" && k !== "useAccent") active = l;
    if (k === "on" && n.checked) active = l;
    changed();
  }

  function changed() {
    syncUI();
    refreshEditor();
    save();
    cb.onChange && cb.onChange();
  }

  // ---------- image loading ----------

  function setImageSrc(src, name) {
    return new Promise((resolve, reject) => {
      const next = new Image();
      next.onload = () => {
        img.src = src;
        imgReady = true;
        S.image.src = src;
        S.image.name = name || "";
        // SVGs with no intrinsic size report 0; give them a sane box
        if (!next.naturalWidth) img.width = 300, img.height = 150;
        const done = () => resolve(true);
        img.decode ? img.decode().then(done, done) : done();
      };
      next.onerror = () => reject(new Error("Could not read image"));
      next.src = src;
    });
  }

  async function loadImage(file) {
    if (!file || !/^image\/(png|svg\+xml)$/.test(file.type)) throw new Error("PNG or SVG only");
    const src = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
    await setImageSrc(src, file.name || "");
    S.image.on = true;
    active = "image";
    changed();
  }

  function clearImage() {
    S.image.src = ""; S.image.name = ""; S.image.on = false;
    imgReady = false;
    img.removeAttribute("src");
    el.file.value = "";
    changed();
  }

  // ---------- storage ----------

  function save() {
    try {
      const out = JSON.parse(JSON.stringify(S));
      if (out.image.src.length > MAX_SAVED_IMAGE) { out.image.src = ""; out.image.on = false; }
      localStorage.setItem(KEY, JSON.stringify(out));
    } catch { /* storage blocked or full; the session still works */ }
  }

  function load() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { /* ignore */ }
    if (!saved || typeof saved !== "object") return Promise.resolve();
    for (const l of ["text", "image"]) {
      const src = saved[l];
      if (!src || typeof src !== "object") continue;
      for (const k of Object.keys(DEF[l])) {
        if (!(k in src)) continue;
        const d = DEF[l][k];
        if (typeof d === "number") S[l][k] = num(src[k], d, k);
        else if (typeof d === "boolean") S[l][k] = !!src[k];
        else if (typeof src[k] === "string") S[l][k] = src[k];
      }
    }
    if (!["num", "alpha", "none"].includes(S.text.style)) S.text.style = "num";
    if (!["left", "center", "right"].includes(S.text.align)) S.text.align = "center";
    if (!/^#[0-9a-f]{6}$/i.test(S.text.color)) S.text.color = "#ffffff";
    if (/^data:image\/(png|svg\+xml)[;,]/.test(S.image.src)) return setImageSrc(S.image.src, S.image.name).catch(() => { S.image.src = ""; S.image.on = false; });
    S.image.src = ""; S.image.on = false;
    return Promise.resolve();
  }

  // ---------- public ----------

  function mount(panel, hooks) {
    host = panel;
    cb = hooks || {};
    try { previewCanvas = cb.getPreview().canvas; } catch { previewCanvas = null; }
    build();
    bindDrag();
    host.addEventListener("input", onInput);
    host.addEventListener("change", onInput);
    // The page binds Space and S globally; typing a series must not reroll the seed
    host.addEventListener("keydown", (e) => { if (e.target.matches("input[type=text]")) e.stopPropagation(); });
    host.addEventListener("click", (e) => {
      const a = e.target.dataset && e.target.dataset.act;
      if (a === "clear-image") clearImage();
      if (a === "reset-text") { Object.assign(S.text, DEF.text); changed(); }
    });
    el.file.addEventListener("change", () => {
      const f = el.file.files[0];
      if (f) loadImage(f).catch((err) => { el.name.textContent = err.message; });
    });
    if ("ResizeObserver" in window) new ResizeObserver(refreshEditor).observe(el.canvas);
    syncUI();
    load().then(() => { syncUI(); refreshEditor(); cb.onChange && cb.onChange(); });
  }

  // Kiosk pages carry the text layer in the URL; images stay on the machine that loaded them.
  function useText(text, accent) {
    headless = { accent: accent || "#7fd321" };
    if (text && typeof text === "object") {
      for (const k of Object.keys(DEF.text)) {
        if (!(k in text)) continue;
        const d = DEF.text[k];
        if (typeof d === "number") S.text[k] = num(text[k], d, k);
        else if (typeof d === "boolean") S.text[k] = !!text[k];
        else if (typeof text[k] === "string") S.text[k] = text[k];
      }
    }
  }

  window.StudioOverlay = { mount, draw, loadImage, useText, getState: () => JSON.parse(JSON.stringify(S)), labelFor };
})();
