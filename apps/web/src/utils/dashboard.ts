/**
 * 花生苗数据库管理工具 - 看板布局解析
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 看板 `layout` 是自由 JSON（服务端不校验结构），因此这里必须容错：
 * 拿不到合法的 columns 就退回默认 2 列，而不是把网格渲染成 0 列或 NaN 列。
 */

export const DASHBOARD_DEFAULT_COLUMNS = 2;
export const DASHBOARD_MIN_COLUMNS = 1;
export const DASHBOARD_MAX_COLUMNS = 4;

/** 看板网格列数：layout.columns 合法时取整并夹到 1..4，否则默认 2 */
export function resolveDashboardColumns(layout: Record<string, unknown> | null | undefined): number {
  if (!layout) {
    return DASHBOARD_DEFAULT_COLUMNS;
  }
  const raw = layout.columns;
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DASHBOARD_DEFAULT_COLUMNS;
  }
  const rounded = Math.round(parsed);
  return Math.min(DASHBOARD_MAX_COLUMNS, Math.max(DASHBOARD_MIN_COLUMNS, rounded));
}

/** 列数越多单图越窄，画布相应变矮，避免看板出现大片空白 */
export function resolveDashboardChartHeight(columns: number): number {
  return columns >= 3 ? 300 : 340;
}
