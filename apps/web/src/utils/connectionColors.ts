/**
 * 花生苗数据库管理工具 - 连接颜色标记调色板
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 契约：这里的色值会被原样写进连接的 color_tag，服务端判定"生产库"时
 * （packages/core/src/paths.ts 的 PRODUCTION_COLOR_TAGS）必须认识其中的红色，
 * 否则界面上标红的生产库不会触发 AI 写操作二次确认、/meta/production-check
 * 也会返回 production:false —— 安全闸门被静默绕过。
 * 因此把调色板抽成模块常量，并由 connectionColors.test.ts 与 core 的常量
 * 做交叉断言，避免"界面换了主色、服务端还在认旧色值"这类漂移。
 */

export const COLOR_TAGS = [
  '#3f9c5a',
  '#2f7fd6',
  '#c9922b',
  '#d1524a',
  '#7a5af0',
  '#1f9d9a',
  '#6b7280',
] as const;

/**
 * 调色板里的"生产"红。
 * 服务端 isProductionLike 必须能识别这个值（见 core 的 PRODUCTION_COLOR_TAGS）。
 */
export const PRODUCTION_COLOR_TAG = '#d1524a';
