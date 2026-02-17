/**
 * Generates 192x192 and 512x512 PNG icons for Jim-Jam PWA.
 * Uses only built-in Node.js modules (zlib + fs) — no npm packages needed.
 */
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ===== CRC32 (required by PNG spec) =====
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  crcTable[i] = c;
}
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const lenBuf  = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf  = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// ===== Draw icon pixels =====
function drawIcon(size) {
  const pixels = new Uint8Array(size * size * 4);
  const half   = size / 2;
  const radius = size * 0.215; // ~110px on 512
  const corner = size * 0.164; // rounded rect corner radius

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      // ---- Rounded rect mask ----
      const cx = x - half + 0.5;
      const cy = y - half + 0.5;
      const innerX = Math.abs(cx) - (half - corner);
      const innerY = Math.abs(cy) - (half - corner);
      let alpha = 255;
      if (innerX > 0 && innerY > 0 && Math.sqrt(innerX * innerX + innerY * innerY) > corner) {
        alpha = 0;
      }
      if (alpha === 0) { pixels[i+3] = 0; continue; }

      // ---- Purple→pink gradient background ----
      const t = (x + y) / (2 * (size - 1));
      const r = Math.round(168 + (236 - 168) * t); // #a855f7 → #ec4899
      const g = Math.round(85  + (72  - 85)  * t);
      const b = Math.round(247 + (153 - 247) * t);

      pixels[i]   = r;
      pixels[i+1] = g;
      pixels[i+2] = b;
      pixels[i+3] = alpha;
    }
  }

  // ---- Draw music note ----
  const s = size / 512; // scale factor

  // Helper: filled circle
  function circle(cx, cy, r, fr, fg, fb) {
    const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r);
    const y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        if (px < 0 || px >= size || py < 0 || py >= size) continue;
        const dx = px - cx, dy = py - cy;
        if (dx * dx + dy * dy <= r * r) {
          const i = (py * size + px) * 4;
          if (pixels[i+3] === 0) continue;
          pixels[i] = fr; pixels[i+1] = fg; pixels[i+2] = fb; pixels[i+3] = 255;
        }
      }
    }
  }

  // Helper: filled rect (rotated 0)
  function rect(x, y, w, h, fr, fg, fb) {
    for (let py = Math.floor(y); py < Math.ceil(y + h); py++) {
      for (let px = Math.floor(x); px < Math.ceil(x + w); px++) {
        if (px < 0 || px >= size || py < 0 || py >= size) continue;
        const i = (py * size + px) * 4;
        if (pixels[i+3] === 0) continue;
        pixels[i] = fr; pixels[i+1] = fg; pixels[i+2] = fb; pixels[i+3] = 255;
      }
    }
  }

  const w = 255, a = 255; // white, full opacity

  // Stem (vertical bar)
  rect(284 * s, 140 * s, 28 * s, 180 * s, w, w, w);
  // Flag / beam (diagonal top)
  rect(284 * s, 140 * s, 100 * s, 22 * s, w, w, w);
  // Top-right circle of beam
  circle(350 * s, 162 * s, 18 * s, w, w, w);
  // Note head (bottom of stem)
  circle(270 * s, 320 * s, 38 * s, w, w, w);

  return pixels;
}

// ===== Encode pixels to PNG =====
function encodePNG(size, pixels) {
  // Build raw scanlines: 1 filter byte (0=None) + RGBA per row
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = y * (size * 4 + 1) + 1 + x * 4;
      raw[dst]   = pixels[src];
      raw[dst+1] = pixels[src+1];
      raw[dst+2] = pixels[src+2];
      raw[dst+3] = pixels[src+3];
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0); // width
  ihdrData.writeUInt32BE(size, 4); // height
  ihdrData[8]  = 8; // bit depth
  ihdrData[9]  = 6; // RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter method
  ihdrData[12] = 0; // interlace

  const sig  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = pngChunk('IHDR', ihdrData);
  const idat = pngChunk('IDAT', compressed);
  const iend = pngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

// ===== Generate + save =====
const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

for (const size of [192, 512]) {
  const pixels = drawIcon(size);
  const png    = encodePNG(size, pixels);
  const file   = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, png);
  console.log(`✓ Generated ${file} (${png.length} bytes)`);
}

console.log('Done! PNG icons ready for PWA.');
