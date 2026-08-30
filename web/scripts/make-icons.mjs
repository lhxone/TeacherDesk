/**
 * Generates the PWA PNG icons without pulling in an image dependency.
 * Writes a minimal, valid PNG (solid brand background + white mortarboard)
 * by hand-encoding IHDR/IDAT/IEND chunks with zlib.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../public');
mkdirSync(outDir, { recursive: true });

const BRAND = [59, 130, 246];
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Point-in-polygon for the mortarboard top. */
function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function makePng(size) {
  const s = size / 64;
  const cap = [
    [32 * s, 14 * s],
    [54 * s, 24 * s],
    [32 * s, 34 * s],
    [10 * s, 24 * s],
  ];

  const raw = Buffer.alloc((size * 3 + 1) * size);
  let p = 0;

  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let color = BRAND;

      if (inPoly(x, y, cap)) {
        color = WHITE;
      } else {
        // The U-shaped body under the cap.
        const cx = 32 * s;
        const cy = 39 * s;
        const rx = 14 * s;
        const ry = 9 * s;
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const d = dx * dx + dy * dy;
        if (y > 29 * s && d < 1 && d > 0.45) color = WHITE;

        // Tassel on the right.
        if (Math.abs(x - 54 * s) < 1.6 * s && y > 24 * s && y < 35 * s) color = WHITE;
        if ((x - 54 * s) ** 2 + (y - 24 * s) ** 2 < (3 * s) ** 2) color = WHITE;
      }

      raw[p++] = color[0];
      raw[p++] = color[1];
      raw[p++] = color[2];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  const file = resolve(outDir, `pwa-${size}.png`);
  writeFileSync(file, makePng(size));
  console.log(`wrote ${file}`);
}
