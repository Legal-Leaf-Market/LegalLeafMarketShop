/* tools/make-icons.mjs — writes public/icon-192.png and icon-512.png with no
   dependencies: a hand-rolled PNG encoder (zlib is in node) drawing the same
   rising line as icon.svg. Android's install prompt wants a raster icon. */
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) { const [r, g, b] = pixel(x, y); const o = y * (size * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
// distance from point to segment, in icon units (64 grid)
function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
  const t = Math.max(0, Math.min(1, (vx * wx + vy * wy) / (vx * vx + vy * vy)));
  const dx = px - (ax + t * vx), dy = py - (ay + t * vy);
  return Math.sqrt(dx * dx + dy * dy);
}
const SEGS = [[12, 44, 24, 30], [24, 30, 32, 38], [32, 38, 52, 16], [40, 16, 52, 16], [52, 16, 52, 28]];
for (const size of [192, 512]) {
  const buf = png(size, (x, y) => {
    const u = (x + 0.5) / size * 64, v = (y + 0.5) / size * 64;
    const d = Math.min(...SEGS.map(s => segDist(u, v, ...s)));
    const w = 3.2, aa = Math.max(0, Math.min(1, (w - d) * (size / 64) * 0.8));
    const bg = [11, 15, 20], fg = [34, 197, 94];
    return bg.map((c, i) => Math.round(c + (fg[i] - c) * aa));
  });
  writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), buf);
  console.log(`icon-${size}.png ${buf.length} bytes`);
}
