/**
 * make-splash.mjs
 * ---------------------------------------------------------------------
 * Writes the startup screens iOS shows while the installed app opens:
 * one per iPhone screen size, in light and dark. Each is a single flat
 * colour, the page's --bg, because the launch mark starts on that same
 * background and then draws itself, so a mark here would appear to jump.
 *
 *   node scripts/dashboard/make-splash.mjs
 *
 * Only needed when --bg changes or a new iPhone size appears. A new size
 * also needs its two <link rel="apple-touch-startup-image"> in index.html.
 * ---------------------------------------------------------------------
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../dashboard/icons/splash');

// --bg in dashboard/css/styles.css.
const THEMES = { light: [0xe9, 0xec, 0xe6], dark: [0x09, 0x0e, 0x0d] };

// Screen sizes in pixels, portrait.
const SIZES = [
  [1125, 2436], // 375×812 @3x: X, XS, 11 Pro, 12/13 mini
  [1170, 2532], // 390×844 @3x: 12, 13, 14
  [1179, 2556], // 393×852 @3x: 14 Pro, 15, 16
  [1206, 2622], // 402×874 @3x: 16 Pro, 17, 17 Pro
  [828, 1792], //  414×896 @2x: XR, 11
  [1242, 2688], // 414×896 @3x: XS Max, 11 Pro Max
  [1260, 2736], // 420×912 @3x: Air
  [1284, 2778], // 428×926 @3x: 12/13 Pro Max, 14 Plus
  [1290, 2796], // 430×932 @3x: 14/15 Pro Max, 15/16 Plus
  [1320, 2868], // 440×956 @3x: 16/17 Pro Max
];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** One PNG chunk: length, type, data, checksum. */
function chunk(type, data) {
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, checksum]);
}

/** A flat-colour RGB PNG. */
function flatPng(width, height, [r, g, b]) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3); // each row starts with its filter byte (0: none)
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(pixels, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(OUT, { recursive: true });
for (const [width, height] of SIZES) {
  for (const [theme, colour] of Object.entries(THEMES)) {
    fs.writeFileSync(path.join(OUT, `${width}x${height}-${theme}.png`), flatPng(width, height, colour));
  }
}
console.log(`Wrote ${SIZES.length * 2} startup screens to ${path.relative(process.cwd(), OUT)}`);
