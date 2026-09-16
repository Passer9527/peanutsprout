/**
 * 花生苗数据库管理工具 - 连接颜色标记与"生产库识别"的契约测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 回归：生产库识别曾只认 'red'/'prod'/'production' 这类符号值，而 Web 端
 * 颜色选择器写入的是十六进制色值，导致"界面上标红的生产库"永远识别不到。
 * 这里直接拿**界面真实色值**去跑服务端的 isProductionLike，任何一侧漂移都会红。
 *
 * 说明：通过相对路径 import core 的源码，是因为 apps/web 不依赖 @peanutsprout/core
 * （纯前端包），而这条断言必须同时对"界面调色板"和"服务端识别集合"求值。
 */

import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_COLOR_TAGS,
  isProductionLike,
} from '../../../../packages/core/src/paths.js';
import { COLOR_TAGS, PRODUCTION_COLOR_TAG } from './connectionColors';

describe('连接颜色与生产库识别契约', () => {
  it('界面调色板里的红色确实被服务端识别为生产库', () => {
    // 调色板必须真的包含这个红，否则下面的断言是空转
    expect(COLOR_TAGS).toContain(PRODUCTION_COLOR_TAG);
    expect(PRODUCTION_COLOR_TAGS).toContain(PRODUCTION_COLOR_TAG);
    // 用真实 UI 值走一遍服务端判定
    expect(isProductionLike(PRODUCTION_COLOR_TAG, null)).toBe(true);
    expect(isProductionLike(PRODUCTION_COLOR_TAG.toUpperCase(), null)).toBe(true);
  });

  it('调色板里其它颜色不会被误判为生产库', () => {
    for (const color of COLOR_TAGS) {
      if (color === PRODUCTION_COLOR_TAG) continue;
      expect(isProductionLike(color, null), `${color} 不应被识别为生产库`).toBe(false);
    }
  });

  it('历史符号值仍被兼容（老数据不能失守）', () => {
    expect(isProductionLike('red', null)).toBe(true);
    expect(isProductionLike('production', null)).toBe(true);
  });
});
