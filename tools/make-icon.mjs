#!/usr/bin/env node
// Generates the placeholder application icon (D-262, D-291): `apps/desktop/build/icon.ico`, drawn in code (no external
// resource, no dependency). Replace the file with the real icon when there is one; run again to regenerate this one.
//   node tools/make-icon.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

const out = path.resolve(import.meta.dirname, '../apps/desktop/build/icon.ico');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const BG = [24, 78, 98];
const BG2 = [18, 52, 72];
const INK = [244, 247, 250];
const ACCENT = [255, 190, 70];

/** Signed distance to a rounded square centered in the unit square (negative inside). */
const roundRect = (x, y, half, r) => {
  const qx = Math.abs(x - 0.5) - (half - r);
  const qy = Math.abs(y - 0.5) - (half - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const dist = (x, y, cx, cy) => Math.hypot(x - cx, y - cy);
/** Distance from a point to the segment a-b. */
const seg = (x, y, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return dist(x, y, ax + t * dx, ay + t * dy);
};

// A small network of three linked nodes on a rounded dark tile: documents and the links between them.
const NODES = [
  [0.3, 0.68],
  [0.5, 0.3],
  [0.72, 0.62],
];

/** Color of one sample (r, g, b, a in 0..1) at unit coordinates. */
function sample(x, y) {
  if (roundRect(x, y, 0.46, 0.2) > 0) return [0, 0, 0, 0];
  const t = y;
  let c = BG.map((v, i) => v * (1 - t) + BG2[i] * t);
  for (const [a, b] of [[0, 1], [1, 2], [0, 2]]) {
    if (seg(x, y, NODES[a][0], NODES[a][1], NODES[b][0], NODES[b][1]) < 0.022) c = INK;
  }
  NODES.forEach(([cx, cy], i) => {
    const d = dist(x, y, cx, cy);
    if (d < 0.095) c = i === 1 ? ACCENT : INK;
    else if (d < 0.115) c = BG2;
  });
  return [c[0], c[1], c[2], 255];
}

function render(size) {
  const ss = 3; // supersampling per axis
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const [cr, cg, cb, ca] = sample((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round(a / (ss * ss));
    }
  }
  return png(size, raw);
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

function png(size, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const images = SIZES.map((s) => ({ size: s, data: render(s) }));
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const entries = images.map(({ size, data }) => {
  const e = Buffer.alloc(16);
  e[0] = size >= 256 ? 0 : size;
  e[1] = size >= 256 ? 0 : size;
  e.writeUInt16LE(1, 4); // planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(data.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += data.length;
  return e;
});
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([header, ...entries, ...images.map((i) => i.data)]));
console.log(`wrote ${path.relative(process.cwd(), out)} (${offset} bytes, sizes ${SIZES.join(', ')})`);
