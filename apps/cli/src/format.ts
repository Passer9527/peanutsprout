/**
 * 花生苗数据库管理工具 - CLI 输出格式化
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export type Cell = unknown;

const display = (v: Cell): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Uint8Array) return `base64:${Buffer.from(v).toString('base64').slice(0, 24)}…`;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/** 计算显示宽度：中文等宽字符占 2 列。 */
function width(s: string): number {
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    w += code > 0x2e80 && code < 0xa4d0 ? 2 : 1;
  }
  return w;
}

function pad(s: string, target: number): string {
  return s + ' '.repeat(Math.max(0, target - width(s)));
}

/** 输出等宽表格；数据为空时打印提示行。 */
export function printTable(rows: Array<Record<string, Cell>>, emptyHint = '（无数据）'): void {
  if (rows.length === 0) {
    process.stdout.write(`${emptyHint}\n`);
    return;
  }
  const columns = Object.keys(rows[0] as Record<string, Cell>);
  const cells = rows.map((r) => columns.map((c) => display(r[c])));
  const widths = columns.map((c, i) =>
    Math.max(width(c), ...cells.map((row) => width(row[i] ?? ''))),
  );
  const line = (l: string, m: string, r: string): string =>
    l + widths.map((w) => '─'.repeat(w + 2)).join(m) + r;

  process.stdout.write(`${line('┌', '┬', '┐')}\n`);
  process.stdout.write(`│ ${columns.map((c, i) => pad(c, widths[i] ?? 0)).join(' │ ')} │\n`);
  process.stdout.write(`${line('├', '┼', '┤')}\n`);
  for (const row of cells) {
    process.stdout.write(`│ ${row.map((c, i) => pad(c, widths[i] ?? 0)).join(' │ ')} │\n`);
  }
  process.stdout.write(`${line('└', '┴', '┘')}\n`);
  process.stdout.write(`共 ${rows.length} 行\n`);
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printSuccess(message: string): void {
  process.stdout.write(`✅ ${message}\n`);
}

/**
 * 成功提示，但强制走 stderr。
 * 用于 stdout 已经承载机器可读数据的命令（如 export 把 CSV 写到 stdout 时），
 * 避免提示文本混进管道产物。
 */
export function printSuccessStderr(message: string): void {
  process.stderr.write(`✅ ${message}\n`);
}

/**
 * 警告走 stderr。
 * docs/cli-reference.md §1.6 承诺"数据走 stdout，提示/进度/警告走 stderr"；
 * 若警告写到 stdout，`export ... > out.csv` 得到的 CSV 末尾会多出一行警告文本，
 * 而服务端默认 query.max_rows=10000、CLI --limit 默认 100000，大表导出几乎必然触发。
 */
export function printWarn(message: string): void {
  process.stderr.write(`⚠️  ${message}\n`);
}

export function printError(message: string): void {
  process.stderr.write(`❌ ${message}\n`);
}

/** CSV 转义（导出用）。 */
export function toCsv(rows: Array<Record<string, Cell>>): string {
  if (rows.length === 0) return '';
  const columns = Object.keys(rows[0] as Record<string, Cell>);
  const esc = (v: Cell): string => {
    const s = display(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `\uFEFF${[columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\r\n')}\r\n`;
}

/** Markdown 表格导出。 */
export function toMarkdown(rows: Array<Record<string, Cell>>): string {
  if (rows.length === 0) return '';
  const columns = Object.keys(rows[0] as Record<string, Cell>);
  const head = `| ${columns.join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${columns.map((c) => display(r[c]).replace(/\|/g, '\\|')).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}
