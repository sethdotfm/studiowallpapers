"use strict";
// H.264 MP4 export with WebCodecs. Frames are rendered and encoded one at a time from a frame index,
// never from wall-clock time, so a loop of N frames is exactly N frames and repeats without a seam.
// The muxer writes one video track, one chunk: ftyp, mdat, moov.
(() => {
  // Highest level first; hardware encoders often reject large frames at lower levels and vice versa.
  const CODECS = ["avc1.640034", "avc1.640033", "avc1.640032", "avc1.64002A", "avc1.640028", "avc1.4D0034", "avc1.4D0028", "avc1.42E034", "avc1.42E028"];
  const TIMESCALE = 90000; // divisible by 24, 25, 30, 50 and 60

  async function pick(width, height, fps, bitrate) {
    if (!("VideoEncoder" in window)) return null;
    for (const codec of CODECS) {
      for (const hardwareAcceleration of ["prefer-hardware", "no-preference"]) {
        const config = { codec, width, height, bitrate, framerate: fps, avc: { format: "avc" }, latencyMode: "quality", bitrateMode: "variable", hardwareAcceleration };
        try {
          const r = await VideoEncoder.isConfigSupported(config);
          if (r.supported) return r.config;
        } catch { /* try the next one */ }
      }
    }
    return null;
  }

  // renderFrame(i) returns a canvas holding frame i. Resolves to an MP4 Blob.
  async function encode({ config, fps, frames, renderFrame, onProgress, signal }) {
    const chunks = [];
    let description = null, failure = null;
    const enc = new VideoEncoder({
      output(chunk, meta) {
        if (!description && meta && meta.decoderConfig && meta.decoderConfig.description) {
          const d = meta.decoderConfig.description;
          description = new Uint8Array(d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
        }
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        chunks.push({ data, key: chunk.type === "key", ts: chunk.timestamp });
      },
      error(e) { failure = e; },
    });
    enc.configure(config);
    const us = 1e6 / fps, gop = Math.max(1, Math.round(fps * 2));
    try {
      for (let i = 0; i < frames; i++) {
        if (failure) throw failure;
        if (signal && signal.aborted) throw new DOMException("Cancelled", "AbortError");
        const canvas = renderFrame(i);
        const vf = new VideoFrame(canvas, { timestamp: Math.round(i * us), duration: Math.round(us) });
        enc.encode(vf, { keyFrame: i % gop === 0 });
        vf.close();
        while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 0));
        if (onProgress && (i % 4 === 0 || i === frames - 1)) { onProgress((i + 1) / frames); await new Promise((r) => setTimeout(r, 0)); }
      }
      await enc.flush();
    } finally {
      if (enc.state !== "closed") enc.close();
    }
    if (failure) throw failure;
    if (!description) throw new Error("Encoder returned no H.264 configuration");
    return mux({ width: config.width, height: config.height, fps, chunks, description });
  }

  const enc = new TextEncoder();
  const u8 = (...a) => new Uint8Array(a);
  const u16 = (v) => u8((v >> 8) & 255, v & 255);
  const u32 = (v) => u8((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  const i32 = (v) => u32(v >>> 0);
  const zeros = (n) => new Uint8Array(n);
  function cat(parts) {
    const n = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  const box = (type, ...parts) => { const body = cat(parts); return cat([u32(body.length + 8), enc.encode(type), body]); };
  const full = (type, ver, flags, ...parts) => box(type, u8(ver, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255), ...parts);
  const MATRIX = cat([0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000].map(u32));

  function mux({ width, height, fps, chunks, description }) {
    const n = chunks.length, dur = TIMESCALE / fps, total = n * dur, ms = Math.round((n * 1000) / fps);
    const ftyp = box("ftyp", enc.encode("isom"), u32(0x200), enc.encode("isomiso2avc1mp41"));
    const dataLen = chunks.reduce((s, c) => s + c.data.length, 0);
    if (dataLen + 8 > 0xffffffff) throw new Error("Video over 4 GB; lower the bitrate or length");
    const mdatHead = cat([u32(dataLen + 8), enc.encode("mdat")]);
    const offset = ftyp.length + mdatHead.length;

    // Presentation offsets, only if the encoder reordered frames (B-frames).
    const order = chunks.map((c) => Math.round((c.ts * fps) / 1e6));
    const reordered = order.some((v, i) => v !== i);
    const ctts = reordered ? full("ctts", 1, 0, u32(n), ...order.map((v, i) => cat([u32(1), i32((v - i) * dur)]))) : new Uint8Array(0);

    const keys = [];
    chunks.forEach((c, i) => { if (c.key) keys.push(i + 1); });
    const avc1 = box("avc1",
      zeros(6), u16(1), zeros(16), u16(width), u16(height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(0x18), u16(0xffff),
      box("avcC", description),
      box("colr", enc.encode("nclx"), u16(1), u16(1), u16(1), u8(0)),
      box("pasp", u32(1), u32(1)));
    const stbl = box("stbl",
      full("stsd", 0, 0, u32(1), avc1),
      full("stts", 0, 0, u32(1), u32(n), u32(dur)),
      ctts,
      full("stss", 0, 0, u32(keys.length), ...keys.map(u32)),
      full("stsc", 0, 0, u32(1), u32(1), u32(n), u32(1)),
      full("stsz", 0, 0, u32(0), u32(n), ...chunks.map((c) => u32(c.data.length))),
      full("stco", 0, 0, u32(1), u32(offset)));
    const moov = box("moov",
      full("mvhd", 0, 0, u32(0), u32(0), u32(1000), u32(ms), u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(2)),
      box("trak",
        full("tkhd", 0, 3, u32(0), u32(0), u32(1), u32(0), u32(ms), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(width << 16), u32(height << 16)),
        box("mdia",
          full("mdhd", 0, 0, u32(0), u32(0), u32(TIMESCALE), u32(total), u16(0x55c4), u16(0)),
          full("hdlr", 0, 0, u32(0), enc.encode("vide"), zeros(12), enc.encode("VideoHandler\0")),
          box("minf",
            full("vmhd", 0, 1, zeros(8)),
            box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1))),
            stbl))));
    return new Blob([ftyp, mdatHead, ...chunks.map((c) => c.data), moov], { type: "video/mp4" });
  }

  window.StudioMP4 = { pick, encode, supported: "VideoEncoder" in window };
})();
