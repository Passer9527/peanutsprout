import type { MessageKey } from '@peanutsprout/i18n';

import type { QueryCell, QueryColumnDTO } from '../api/types';

/** 组合 className，过滤假值 */
export function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0).join(' ');
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** 格式化为 YYYY-MM-DD HH:mm:ss（本地时区）；空值显示破折号 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  );
}

/** 毫秒耗时展示：小于 1 秒用 ms，否则用 s */
export function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  if (value < 1000) {
    return `${value} ms`;
  }
  return `${(value / 1000).toFixed(2)} s`;
}

/**
 * 秒级运行时长展示：1 天 2 小时 3 分 4 秒。
 * 单位文案由语言包提供，所以必须把翻译函数传进来 —— 这个模块本身保持无状态，
 * 便于在非 React 环境（如测试）里复用。
 */
export function formatUptime(
  seconds: number | null | undefined,
  t: (key: MessageKey, options?: { count?: number }) => string,
): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds) || seconds < 0) {
    return '—';
  }
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days} ${t('time.unit.day')}`);
  }
  if (hours > 0) {
    parts.push(`${hours} ${t('time.unit.hour')}`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} ${t('time.unit.minute')}`);
  }
  parts.push(`${rest} ${t('time.unit.second')}`);
  return parts.join(' ');
}

/** 单元格文本化，NULL 显示为 (NULL) */
export function cellToText(value: QueryCell): string {
  if (value === null) {
    return '(NULL)';
  }
  return String(value);
}

/** 是否应当以 NULL 样式渲染 */
export function isNullCell(value: QueryCell): boolean {
  return value === null;
}

export function truncate(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max)}…`;
}

/** SQL 单行预览 */
export function sqlPreview(sql: string | null, max = 90): string {
  if (!sql || sql.trim().length === 0) {
    return '—';
  }
  return truncate(sql, max);
}

export function buildConnectionAddress(parts: {
  host: string | null;
  port: number | null;
  databaseName: string | null;
  connectionUrl: string | null;
}): string {
  if (parts.connectionUrl && parts.connectionUrl.length > 0) {
    return parts.connectionUrl;
  }
  if (!parts.host) {
    return '—';
  }
  const port = parts.port === null ? '' : `:${parts.port}`;
  const database = parts.databaseName ? `/${parts.databaseName}` : '';
  return `${parts.host}${port}${database}`;
}

/** 触发浏览器下载（客户端导出，不经过服务端） */
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

function escapeDelimited(value: QueryCell, quote: string, separator: string): string {
  if (value === null) {
    return '';
  }
  const text = String(value);
  const needsQuote = text.includes(quote) || text.includes(separator) || text.includes('\n') || text.includes('\r');
  const escaped = text.split(quote).join(quote + quote);
  return needsQuote ? `${quote}${escaped}${quote}` : escaped;
}

/** 导出 CSV（带 BOM，便于 Excel 正确识别中文） */
export function buildCsv(columns: QueryColumnDTO[], rows: QueryCell[][]): string {
  const separator = ',';
  const quote = '"';
  const header = columns.map((column) => escapeDelimited(column.name, quote, separator)).join(separator);
  const body = rows.map((row) =>
    columns.map((_column, index) => escapeDelimited(row[index] ?? null, quote, separator)).join(separator),
  );
  return `\ufeff${[header, ...body].join('\r\n')}\r\n`;
}

/** 导出 JSON：对象数组，保留列顺序 */
export function buildJson(columns: QueryColumnDTO[], rows: QueryCell[][]): string {
  const objects = rows.map((row) => {
    const record: Record<string, QueryCell> = {};
    columns.forEach((column, index) => {
      record[column.name] = row[index] ?? null;
    });
    return record;
  });
  return JSON.stringify(objects, null, 2);
}

function escapeMarkdown(value: QueryCell): string {
  if (value === null) {
    return 'NULL';
  }
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

/** 导出 Markdown 表格 */
export function buildMarkdown(columns: QueryColumnDTO[], rows: QueryCell[][]): string {
  const header = `| ${columns.map((column) => escapeMarkdown(column.name)).join(' | ')} |`;
  const divider = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map(
    (row) => `| ${columns.map((_column, index) => escapeMarkdown(row[index] ?? null)).join(' | ')} |`,
  );
  return [header, divider, ...body].join('\n');
}

/** 解析逗号 / 换行分隔的角色列表 */
export function parseListInput(value: string): string[] {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** 空字符串转 undefined，便于省略可选请求字段 */
export function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
