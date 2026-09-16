/**
 * 花生苗数据库管理工具 - SQL 标识符安全拼装
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 表名/列名无法用绑定参数占位，只能拼进 SQL。为了让拼接是安全的，
 * 这里对标识符做白名单校验（字母/数字/下划线/$，支持中文），
 * 再做方言引号包裹并转义引号字符。任何非法标识符直接拒绝。
 */

import { PeanutError } from '@peanutsprout/core';

const IDENT_RE = /^[\p{L}_][\p{L}\p{N}_$]*$/u;

export function isSafeIdentifier(name: string): boolean {
  return typeof name === 'string' && name.length > 0 && name.length <= 128 && IDENT_RE.test(name);
}

export function assertSafeIdentifier(name: string, what = '标识符'): string {
  if (!isSafeIdentifier(name)) {
    throw new PeanutError('VALIDATION_FAILED', `非法${what}: ${JSON.stringify(name)}`, {
      hint: '标识符只能包含字母、数字、下划线、$，且不能以数字开头',
    });
  }
  return name;
}

/** 用双引号包裹标识符（SQL 标准，SQLite/PostgreSQL/Oracle/达梦等通用）。 */
export function quoteIdent(name: string): string {
  assertSafeIdentifier(name);
  return `"${name.replace(/"/g, '""')}"`;
}

/** MySQL/MariaDB/TiDB/OceanBase 用反引号。 */
export function quoteIdentBacktick(name: string): string {
  assertSafeIdentifier(name);
  return `\`${name.replace(/`/g, '``')}\``;
}

/** SQL Server 用方括号。 */
export function quoteIdentBracket(name: string): string {
  assertSafeIdentifier(name);
  return `[${name.replace(/]/g, ']]')}]`;
}

/** `schema.table` 形式的限定名。 */
export function quoteQualified(schema: string | null | undefined, name: string, quote = quoteIdent): string {
  return schema ? `${quote(schema)}.${quote(name)}` : quote(name);
}
