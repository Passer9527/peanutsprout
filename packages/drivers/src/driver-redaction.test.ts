/**
 * 花生苗数据库管理工具 - 驱动层错误消息脱敏回归
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 背景：`resolvePostgresTarget` / `resolveMysqlTarget` 在解析失败时，
 * 会把**原始连接串**拼进错误消息（`无法解析 PostgreSQL 连接串: ${url}`）。
 * 这条消息会一路冒到 HTTP 响应体、审计日志和终端输出 ——
 * 连接串里含口令，等于把口令回显给了每个能看到错误的人。
 *
 * 存储层现在交出的 URL 已经脱敏，所以这是**纵深防御**：
 * 即使将来某个调用方直接拿原始连接串调驱动，驱动自己也不能吐出口令。
 */

import { describe, expect, it } from 'vitest';
import { resolvePostgresTarget } from './postgresql.js';
import { resolveMysqlTarget } from './mysql.js';

/** 这些连接串都含口令，且都无法被 URL 解析器正常处理。 */
const LEAKY_URLS = [
  // 协议头不认识 → 走"无法识别的协议头"分支
  'weird://app:S3cr3t-Pass@db.example.com:5432/prod',
  // 协议头正确但内容无法解析 → 走"无法解析"分支
  'postgres://app:S3cr3t-Pass@[::bad::]:5432/prod',
  // 口令里含 `/` 与 `@`（真实复现过的绕过形态）
  'postgres://app:Sl/ash@P@ss@db.example.com:5432/prod',
];

describe('驱动错误消息不回显连接串里的口令（纵深防御）', () => {
  it.each(LEAKY_URLS)('PostgreSQL 解析失败消息已脱敏: %s', (url) => {
    let message = '';
    try {
      resolvePostgresTarget({ dbType: 'postgresql', connectionUrl: url } as never);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message, '应当抛出错误').not.toBe('');
    expect(message, `错误消息里含口令: ${message}`).not.toContain('S3cr3t-Pass');
    expect(message, `错误消息里含口令: ${message}`).not.toContain('Sl/ash');
    expect(message, `错误消息里含口令: ${message}`).not.toContain('P@ss');
  });

  it.each(LEAKY_URLS)('MySQL 解析失败消息已脱敏: %s', (url) => {
    let message = '';
    try {
      resolveMysqlTarget({ dbType: 'mysql', connectionUrl: url } as never);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message, '应当抛出错误').not.toBe('');
    expect(message, `错误消息里含口令: ${message}`).not.toContain('S3cr3t-Pass');
    expect(message, `错误消息里含口令: ${message}`).not.toContain('Sl/ash');
    expect(message, `错误消息里含口令: ${message}`).not.toContain('P@ss');
  });

  it('错误消息仍然保留了可用于排查的部分（不是整条抹成空）', () => {
    const messageOf = (url: string): string => {
      try {
        resolvePostgresTarget({ dbType: 'postgresql', connectionUrl: url } as never);
      } catch (e) {
        return (e as Error).message;
      }
      return '';
    };

    // 协议头不认识：不整条回显连接串，只说清是哪个协议头不被接受
    const schemeMsg = messageOf('weird://app:S3cr3t-Pass@db.example.com:5432/prod');
    expect(schemeMsg).toContain('weird://');
    expect(schemeMsg).toContain('postgresql');

    // 无法解析：主机名不是密钥，保留它用户才排得了错；口令必须已被抹掉
    const parseMsg = messageOf('postgres://app:Sl/ash@P@ss@db.example.com:5432/prod');
    expect(parseMsg).toContain('db.example.com');
    expect(parseMsg).toContain('app@'); // 用户名保留（用户名不视为密钥）
    expect(parseMsg).not.toContain('Sl/ash');
  });
});
