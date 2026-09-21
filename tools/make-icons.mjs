/* 生成 App 图标（无第三方依赖，纯 Node + zlib）
 * 用法: node tools/make-icons.mjs
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'icons');

/* ---------------- PNG 编码 ---------------- */
let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    CRC_TABLE[n] = c;
  }
  return CRC_TABLE;
}
function crc32(buf) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // no interlace
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- 绘图 ---------------- */
const BG_TOP = [0x14, 0x3a, 0x66];
const BG_BOTTOM = [0x06, 0x11, 0x20];
const OUTER = [0x0d, 0x26, 0x43];

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/* 前山：顶点 (0.70,0.44)，左底 (0.30,0.95)，右底 (1.06,0.95) */
const F_APEX_X = 0.70, F_APEX_Y = 0.44;
const F_LX = 0.30, F_LY = 0.95;
const F_RX = 1.06, F_RY = 0.95;

/* 后山：顶点 (0.40,0.29)，左底 (-0.04,0.92)，右底 (0.86,0.92) */
const B_APEX_X = 0.40, B_APEX_Y = 0.29;

const FLAKES = [
  [0.135, 0.145, 0.0125],
  [0.255, 0.315, 0.0095],
  [0.885, 0.145, 0.0105],
  [0.545, 0.105, 0.0080],
  [0.075, 0.480, 0.0100],
  [0.930, 0.470, 0.0090],
  [0.470, 0.640, 0.0075]
];

function shade(x, y) {
  let c = mix(BG_TOP, BG_BOTTOM, clamp(x * 0.32 + y * 0.78, 0, 1));

  /* 太阳 + 光晕 */
  const sd = Math.hypot(x - 0.745, y - 0.245);
  if (sd < 0.17) c = mix(c, [0xfd, 0xe0, 0x8a], 1 - smoothstep(0.062, 0.17, sd));

  /* 雪花（只画在天空区域） */
  for (const [fx, fy, fr] of FLAKES) {
    const d = Math.hypot(x - fx, y - fy);
    if (d < fr) c = mix(c, [0xff, 0xff, 0xff], 1 - smoothstep(fr * 0.45, fr, d));
  }

  /* 后山 */
  if (inTriangle(x, y, B_APEX_X, B_APEX_Y, -0.04, 0.92, 0.86, 0.92)) {
    const depth = clamp((y - B_APEX_Y) / (0.92 - B_APEX_Y), 0, 1);
    c = mix(c, mix([0x7d, 0xd3, 0xfc], [0x1d, 0x63, 0x9e], depth), 0.94);
  }

  /* 前山 */
  if (inTriangle(x, y, F_APEX_X, F_APEX_Y, F_LX, F_LY, F_RX, F_RY)) {
    const depth = clamp((y - F_APEX_Y) / (F_LY - F_APEX_Y), 0, 1);
    c = mix([0xf6, 0xfa, 0xff], [0xa9, 0xc6, 0xe8], Math.pow(depth, 1.15));

    /* 山顶积雪线（带一点起伏） */
    const snowLine = 0.60 + 0.020 * Math.sin(x * 47.0) + 0.012 * Math.sin(x * 113.0 + 1.7);
    if (y < snowLine) c = [0xff, 0xff, 0xff];
  }

  /* 底部收边 */
  if (y > 0.95) c = mix(c, [0x06, 0x0c, 0x16], clamp((y - 0.95) / 0.05, 0, 1) * 0.85);

  return c;
}

function render(size, scale) {
  const SS = 3; // 3x3 超采样抗锯齿
  const buf = Buffer.alloc(size * size * 4);
  const inv = 1 / size;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) * inv;
          const y = (py + (sy + 0.5) / SS) * inv;
          let ax = x, ay = y;
          if (scale !== 1) {
            ax = (x - 0.5) / scale + 0.5;
            ay = (y - 0.5) / scale + 0.5;
          }
          let c;
          if (ax < 0 || ax > 1 || ay < 0 || ay > 1) {
            c = scale === 1 ? [BG_TOP[0], BG_TOP[1], BG_TOP[2]] : OUTER;
          } else {
            c = shade(ax, ay);
          }
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      buf[i] = Math.round(r / n);
      buf[i + 1] = Math.round(g / n);
      buf[i + 2] = Math.round(b / n);
      buf[i + 3] = 255;
    }
  }
  return encodePNG(size, size, buf);
}

/* ---------------- 输出 ---------------- */
fs.mkdirSync(OUT_DIR, { recursive: true });

const jobs = [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-maskable-512.png', 512, 0.76],
  ['apple-touch-icon.png', 180, 1],
  ['favicon-32.png', 32, 1]
];

for (const [name, size, scale] of jobs) {
  const png = render(size, scale);
  fs.writeFileSync(path.join(OUT_DIR, name), png);
  console.log(`✓ ${name}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
console.log('图标已生成到', OUT_DIR);
