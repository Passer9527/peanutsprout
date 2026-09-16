/**
 * 花生苗数据库管理工具 - 看板布局解析单元测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_DEFAULT_COLUMNS,
  resolveDashboardChartHeight,
  resolveDashboardColumns,
} from './dashboard';

describe('resolveDashboardColumns', () => {
  it('没有 layout 时默认 2 列', () => {
    expect(resolveDashboardColumns(null)).toBe(DASHBOARD_DEFAULT_COLUMNS);
    expect(resolveDashboardColumns(undefined)).toBe(2);
    expect(resolveDashboardColumns({})).toBe(2);
  });

  it('读取合法 columns', () => {
    expect(resolveDashboardColumns({ columns: 1 })).toBe(1);
    expect(resolveDashboardColumns({ columns: 3 })).toBe(3);
    expect(resolveDashboardColumns({ columns: '4' })).toBe(4);
  });

  it('非法值一律回退或夹取，不产生 NaN / 0 列', () => {
    expect(resolveDashboardColumns({ columns: 'abc' })).toBe(2);
    expect(resolveDashboardColumns({ columns: Number.NaN })).toBe(2);
    expect(resolveDashboardColumns({ columns: null })).toBe(2);
    expect(resolveDashboardColumns({ columns: true })).toBe(2);
    expect(resolveDashboardColumns({ columns: 0 })).toBe(1);
    expect(resolveDashboardColumns({ columns: -3 })).toBe(1);
    expect(resolveDashboardColumns({ columns: 99 })).toBe(4);
    expect(resolveDashboardColumns({ columns: 2.6 })).toBe(3);
  });
});

describe('resolveDashboardChartHeight', () => {
  it('列数多时画布更矮', () => {
    expect(resolveDashboardChartHeight(1)).toBe(340);
    expect(resolveDashboardChartHeight(2)).toBe(340);
    expect(resolveDashboardChartHeight(3)).toBe(300);
    expect(resolveDashboardChartHeight(4)).toBe(300);
  });
});
