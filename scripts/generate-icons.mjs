/**
 * 花生苗数据库管理工具 - 生成占位应用图标（纯 Node，无第三方依赖）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 为什么手写 PNG 编码器：图标只是打包链路的"占位件"，
 * 为此引入 sharp/canvas 这类重依赖（几十 MB 原生包）不划算，
 * 而 Node 自带 zlib，PNG 的 IDAT 就是 zlib 流，编码器不到 60 行。
 *
 * ⚠️ 这是**占位图**：品牌主色 #3f9c5a + 简化的"花生 + 嫩芽"造型。
 *    正式发布前请用设计稿替换 packaging/build-resources/ 下的产物，
 *    建议同时提供 icon.icns（macOS）与 icon.ico（Windows），
 *    否则 electron-builder 会用本脚本的 PNG 自动转换（转换质量一般）。
 *
 * 产物：
 *   packaging/build-resources/icon.png          1024x1024，electron-builder 默认查找的图标
 *   packaging/build-resources/icons/NxN.png     16…1024 的尺寸集，供 Linux 桌面图标（.desktop）使用
 *
 * 用法：node scripts/generate-icons.mjs
 *       pnpm icons
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const OUT_DIR = resolve(REPO_ROOT, 'packaging', 'build-resources');
const OUT_ICON = join(OUT_DIR, 'icon.png');
const OUT_SIZES = join(OUT_DIR, 'icons');
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
/** 主图标尺寸：>=512 才能让 electron-builder 生成 .icns / .ico */
const MAIN_SIZE = 1024;
/** 超采样倍数：逐像素判定会把圆角画成锯齿，2~3 倍超采样后降采样即可得到平滑边缘 */
const SUPERSAMPLE = 3;

// ---------------------------------------------------------------------------
// 极简 PNG 编码器（RGBA8，无 filter，无隔行）
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

/** rgba: Buffer，长度 width*height*4（每像素 R,G,B,A） */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: truecolor + alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // no interlace

  // 每行前置一个 filter 字节（0 = None）。不选 filter 是刻意的：
  // 图标面积小、压缩率差异可忽略，换来的是编码器足够简单可读。
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// 图形：品牌绿圆角方块 + 奶油色"花生 + 嫩芽"
// 坐标系：x,y ∈ [-1, 1]，y 轴向下，画布铺满 [-1,1]
// ---------------------------------------------------------------------------

const BRAND = [0x3f, 0x9c, 0x5a]; // 品牌主色
const BRAND_DARK = [0x33, 0x84, 0x4b];
const CREAM = [0xf7, 0xf3, 0xe6]; // 花生本体
const SPROUT = [0xe9, 0xf6, 0xec]; // 嫩芽（略偏绿的奶油色，与本体区分）

/** 圆角矩形 SDF：<0 在内部 */
function roundedRect(x, y, half, radius) {
  const dx = Math.abs(x) - (half - radius);
  const dy = Math.abs(y) - (half - radius);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius;
}

/** 旋转椭圆 SDF：<0 在内部 */
function ellipse(x, y, cx, cy, rx, ry, rotation) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const px = x - cx;
  const py = y - cy;
  const u = (px * cos + py * sin) / rx;
  const v = (-px * sin + py * cos) / ry;
  return Math.hypot(u, v) - 1;
}

/** 胶囊（线段加粗）SDF：<0 在内部 */
function capsule(x, y, ax, ay, bx, by, radius) {
  const pax = x - ax;
  const pay = y - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h) - radius;
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

/** 由 SDF 得到覆盖率：d<0 在内部。band 为过渡带宽度（取一个采样点的宽度）。 */
function coverage(distance, band) {
  return clamp01(0.5 - distance / (2 * band));
}

/** 预乘式 over 合成：src 覆盖在 dst 之上，返回 [颜色, alpha]。 */
function over(dstColor, dstAlpha, srcColor, srcAlpha) {
  const outAlpha = srcAlpha + dstAlpha * (1 - srcAlpha);
  if (outAlpha <= 0) return [[0, 0, 0], 0];
  const dstWeight = dstAlpha * (1 - srcAlpha);
  const color = [0, 1, 2].map((i) =>
    Math.round((srcColor[i] * srcAlpha + dstColor[i] * dstWeight) / outAlpha),
  );
  return [color, outAlpha];
}

/**
 * 归一化坐标处的颜色 + 覆盖（alpha）。
 * 图形按"背景 → 花生 → 嫩芽"依次 over 合成，与矢量绘制的直觉一致。
 */
function shade(x, y, band) {
  const bg = coverage(roundedRect(x, y, 1, 0.26), band);
  if (bg <= 0) return [0, 0, 0, 0];

  // 底色：上浅下深，避免纯色块显得扁平
  let color = mix(BRAND, BRAND_DARK, clamp01((y + 1) / 2));
  let alpha = bg;

  // 花生本体：两个圆叠成"8"字（雅致一点，不做写实）
  const peanut = Math.min(
    ellipse(x, y, 0, 0.4, 0.3, 0.27, 0),
    ellipse(x, y, 0, 0.04, 0.26, 0.23, 0),
  );
  [color, alpha] = over(color, alpha, CREAM, coverage(peanut, band));

  // 嫩芽：一根茎 + 两片斜叶，画在花生之上（茎根部与花生自然衔接）
  const sprout = Math.min(
    capsule(x, y, 0, -0.2, 0, -0.6, 0.032),
    ellipse(x, y, -0.235, -0.54, 0.2, 0.1, -0.62),
    ellipse(x, y, 0.235, -0.54, 0.2, 0.1, 0.62),
  );
  [color, alpha] = over(color, alpha, SPROUT, coverage(sprout, band));

  return [...color, alpha];
}

function renderIcon(size) {
  const out = Buffer.alloc(size * size * 4);
  const ss = SUPERSAMPLE;
  const samples = ss * ss;
  // 单个采样点的宽度：过渡带取它，超采样后再降采样，边缘约在一个像素内平滑过渡
  const band = 1 / (size * ss);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const x = ((px + (sx + 0.5) / ss) / size) * 2 - 1;
          const y = ((py + (sy + 0.5) / ss) / size) * 2 - 1;
          const [cr, cg, cb, ca] = shade(x, y, band);
          // 预乘累加，避免透明边缘出现黑边
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      }
      const offset = (py * size + px) * 4;
      const alpha = a / samples;
      out[offset] = alpha > 0 ? Math.round(r / a) : 0;
      out[offset + 1] = alpha > 0 ? Math.round(g / a) : 0;
      out[offset + 2] = alpha > 0 ? Math.round(b / a) : 0;
      out[offset + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, size, out);
}

function writePng(path, buffer, label) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
  process.stdout.write(
    `  · ${relative(REPO_ROOT, path).padEnd(52)} ${String(buffer.length).padStart(8)} B  ${label}\n`,
  );
}

process.stdout.write('\n生成占位图标（品牌色 #3f9c5a，正式发布请替换为设计稿）：\n');
writePng(OUT_ICON, renderIcon(MAIN_SIZE), `${MAIN_SIZE}x${MAIN_SIZE} 主图标`);
for (const size of SIZES) {
  writePng(join(OUT_SIZES, `${size}x${size}.png`), renderIcon(size), `${size}x${size}`);
}
process.stdout.write(
  '\n完成。electron-builder 会据此自动生成 .ico/.icns；\n' +
    '若要更好的效果，请直接提供 packaging/build-resources/icon.ico 与 icon.icns。\n\n',
);
