/**
 * 花生苗数据库管理工具 - 本地化格式化（数字 / 日期 / 相对时间）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { getLocaleInfo, type LocaleCode } from './locales.js';
import type { TranslateFn } from './types.js';

/** 本地化的千分位/小数分隔符：英文 1,234.5 而俄语是 1 234,5。 */
export function createNumberFormatter(
  locale: LocaleCode,
  options: Intl.NumberFormatOptions = {},
): (value: number) => string {
  const tag = getLocaleInfo(locale).intlTag;
  let formatter: Intl.NumberFormat | null = null;
  try {
    formatter = new Intl.NumberFormat(tag, options);
  } catch {
    formatter = null;
  }
  return (value: number) => {
    if (!Number.isFinite(value)) return String(value);
    return formatter ? formatter.format(value) : String(value);
  };
}

/**
 * 大数字紧凑写法（1.2万 / 1.2万 / 12K）。
 * 中文用 `万/亿`，其它语言交给 Intl 的 notation: 'compact'。
 */
export function createCompactNumberFormatter(locale: LocaleCode): (value: number) => string {
  const tag = getLocaleInfo(locale).intlTag;
  let formatter: Intl.NumberFormat | null = null;
  try {
    formatter = new Intl.NumberFormat(tag, { notation: 'compact', maximumFractionDigits: 1 });
  } catch {
    formatter = null;
  }
  return (value: number) => {
    if (!Number.isFinite(value)) return String(value);
    return formatter ? formatter.format(value) : String(value);
  };
}

/**
 * 日期时间格式化。
 *
 * **刻意保持 `YYYY-MM-DD HH:mm:ss` 这一 ISO 风格**，而不是跟随语言变成
 * `16/09/2025` 或 `2025年9月16日`：这是数据库管理工具，审计日志、连接
 * 列表里的时间戳必须**无歧义且可排序** —— 同一列里混着 `03/04/2025`
 * 这种美/欧含义相反的顺序，比"不够本地化"危险得多。数字与文案仍然照常本地化。
 */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** 仅日期部分，同样保持 ISO 风格（可排序）。 */
export function formatDate(value: string | number | Date | null | undefined): string {
  const full = formatDateTime(value);
  return full === '—' ? full : full.slice(0, 10);
}

/** 相对时间（"3 分钟前"），文案取自语言包，单位由 Intl 的阈值决定。 */
export function formatRelativeTime(
  value: string | number | Date | null | undefined,
  t: TranslateFn,
  now: number = Date.now(),
): string {
  if (value === null || value === undefined || value === '') return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const diffSeconds = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(diffSeconds);
  const suffix = diffSeconds < 0 ? 'past' : 'future';

  const units: Array<{ limit: number; div: number; unit: string }> = [
    { limit: 60, div: 1, unit: 'second' },
    { limit: 3600, div: 60, unit: 'minute' },
    { limit: 86400, div: 3600, unit: 'hour' },
    { limit: 2592000, div: 86400, unit: 'day' },
    { limit: 31536000, div: 2592000, unit: 'month' },
  ];

  for (const { limit, div, unit } of units) {
    if (abs < limit) {
      const count = Math.max(1, Math.floor(abs / div));
      return t(`time.${suffix}.${unit}`, { count });
    }
  }
  const years = Math.max(1, Math.floor(abs / 31536000));
  return t(`time.${suffix}.year`, { count: years });
}
