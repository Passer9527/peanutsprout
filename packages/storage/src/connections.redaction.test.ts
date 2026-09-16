/**
 * 花生苗数据库管理工具 - 连接口令泄漏回归测试（对抗性安全验证）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 覆盖四类实测复现的泄漏：
 *  1. 口令含 `/`：`new URL()` 解析失败 → 脱敏被跳过 → 原文进入 DTO；
 *  2. 口令写在查询串：`?password=` 原样保留，且从不被抽取成凭据；
 *  3. 无 scheme 的 DSN：解析失败 + 兜底正则不匹配 → 原文回传；
 *  4. 审计日志 / 导出：errorMessage 原文落库。
 *
 * 以及两条配套要求：
 *  5. query 里的口令必须被抽进 password_enc（hasPassword 不能撒谎）；
 *  6. 审计 append 必须做通用凭据清洗（最后一道防线）。
 *
 * 测试里全部使用明显的假值，不含任何真实密钥。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPeanutDatabase, type PeanutDatabase } from './index.js';
import { redactConnectionUrl, normalizeConnectionInput } from './repositories/connections.js';

/** 明显的假口令，故意带 `/`，用来打穿兜底正则的 `[^/@]*` */
const SLASH_PW = 'Sl/ash-S3cret-Like-Value';
/** 查询串形式的口令 */
const QUERY_PW = 'Query-Pass-Like-Value';
/** 无 scheme DSN 形式的口令 */
const NO_SCHEME_PW = 'NoScheme-Pass-Like-Value';
/** 含 `@` 的口令 */
const AT_PW = 'p@ss-Like-Value';

let pdb: PeanutDatabase;

beforeEach(() => {
  pdb = openPeanutDatabase({ memory: true });
});

afterEach(() => {
  pdb.close();
});

describe('redactConnectionUrl：脱敏与「能否解析」解耦（回归）', () => {
  it('口令含 `/` 时也必须清除，绝不能原样返回', () => {
    const out = redactConnectionUrl(`postgres://postgres:${SLASH_PW}@127.0.0.1:1/app`);
    expect(out).not.toBeNull();
    expect(out as string).not.toContain(SLASH_PW);
    expect(out as string).not.toContain('Sl/ash');
    // 主机与库名保留，方便定位
    expect(out as string).toContain('127.0.0.1:1/app');
  });

  it('口令含 `@` 时按最后一个 `@` 切分，保留用户名而不是切错', () => {
    const out = redactConnectionUrl(`mysql://user:${AT_PW}@db.example.com:3306/app`);
    expect(out as string).not.toContain(AT_PW);
    expect(out as string).not.toContain('p@ss');
    expect(out as string).toContain('user@db.example.com:3306/app');
  });

  it('percent-encoded 口令被清除且不误伤主机', () => {
    const out = redactConnectionUrl('postgresql://user:p%40ss%3Aword@db.example.com:5432/prod');
    expect(out as string).not.toContain('p%40ss');
    expect(out as string).toContain('db.example.com:5432/prod');
  });

  it('查询串里的口令被清除（password/passwd/pwd，大小写不敏感，含 ; 分隔）', () => {
    for (const url of [
      `postgresql://127.0.0.1:1/app?password=${QUERY_PW}`,
      `postgresql://127.0.0.1:1/app?PASSWORD=${QUERY_PW}`,
      `postgresql://127.0.0.1:1/app?passwd=${QUERY_PW}`,
      `postgresql://127.0.0.1:1/app?pwd=${QUERY_PW}`,
      `postgresql://127.0.0.1:1/app?charset=utf8;password=${QUERY_PW}`,
    ]) {
      const out = redactConnectionUrl(url) as string;
      expect(out, url).not.toContain(QUERY_PW);
      expect(out, url).not.toContain('password=');
    }
  });

  it('正常查询参数不被误删', () => {
    const out = redactConnectionUrl('mysql://u:p@h:3306/d?charset=utf8mb4&ssl=true') as string;
    expect(out).toContain('charset=utf8mb4');
    expect(out).toContain('ssl=true');
  });

  it('token / auth / api_key 形态也被清除，但 sslkey 这类合法参数保留', () => {
    const out = redactConnectionUrl(
      'redis://h:6379/0?token=Token-Like-Secret&auth=Auth-Like-Secret&sslkey=/etc/k.pem',
    ) as string;
    expect(out).not.toContain('Token-Like-Secret');
    expect(out).not.toContain('Auth-Like-Secret');
    expect(out).toContain('sslkey=/etc/k.pem');
    // 非口令参数仍会保留在 extraParams 里，驱动拿得到
    const v = normalizeConnectionInput({
      name: 'token-param',
      dbType: 'redis',
      connectionUrl: 'redis://h:6379/0?token=Token-Like-Secret&sslkey=/etc/k.pem',
    });
    expect(JSON.stringify(v.extraParams ?? {})).toContain('/etc/k.pem');
    expect(JSON.stringify(v.extraParams ?? {})).not.toContain('Token-Like-Secret');
  });

  it('无 scheme 的 DSN 也必须清除口令', () => {
    const out = redactConnectionUrl(`postgres_user:${NO_SCHEME_PW}@127.0.0.1:1/app`);
    expect(out as string).not.toContain(NO_SCHEME_PW);
    expect(out as string).toContain('127.0.0.1:1/app');
  });

  it('解析不了也不能原样返回：残留的凭据形态要被兜底清掉', () => {
    const out = redactConnectionUrl(`  postgres://u:${SLASH_PW}@h/db  `);
    expect(out as string).not.toContain(SLASH_PW);
    expect(out as string).not.toContain('S3cret');
  });

  it('sqlite 文件路径不会被误伤', () => {
    expect(redactConnectionUrl('sqlite:///tmp/a.db')).toBe('sqlite:///tmp/a.db');
  });
});

describe('normalizeConnectionInput：连接串口令抽取与清洗（回归）', () => {
  it('口令含 `/` 时也要抽到 password 字段，并把连接串洗干净', () => {
    const v = normalizeConnectionInput({
      name: 'slash',
      dbType: 'postgresql',
      connectionUrl: `postgres://postgres:${SLASH_PW}@127.0.0.1:1/app`,
    });
    expect(v.password).toBe(SLASH_PW);
    expect(v.connectionUrl as string).not.toContain(SLASH_PW);
    expect(v.host).toBe('127.0.0.1');
    expect(v.databaseName).toBe('app');
  });

  it('查询串里的口令被抽成 password，且不残留在 extraParams', () => {
    const v = normalizeConnectionInput({
      name: 'query',
      dbType: 'postgresql',
      connectionUrl: `postgresql://127.0.0.1:1/app?password=${QUERY_PW}&charset=utf8`,
    });
    expect(v.password).toBe(QUERY_PW);
    expect(v.connectionUrl as string).not.toContain(QUERY_PW);
    expect(v.extraParams?.['charset']).toBe('utf8');
    expect(JSON.stringify(v.extraParams ?? {})).not.toContain(QUERY_PW);
  });

  it('无 scheme 的 DSN 被尽力解析并清洗', () => {
    const v = normalizeConnectionInput({
      name: 'noscheme',
      dbType: 'postgresql',
      connectionUrl: `postgres_user:${NO_SCHEME_PW}@127.0.0.1:1/app`,
    });
    expect(v.password).toBe(NO_SCHEME_PW);
    expect(v.connectionUrl as string).not.toContain(NO_SCHEME_PW);
  });
});

describe('ConnectionRepository：DTO 绝不回传连接串口令（回归）', () => {
  const leakyUrls = [
    { label: '口令含 /', url: `postgres://postgres:${SLASH_PW}@127.0.0.1:1/app`, pw: SLASH_PW },
    { label: '查询串口令', url: `postgresql://127.0.0.1:1/app?password=${QUERY_PW}`, pw: QUERY_PW },
    { label: '无 scheme DSN', url: `postgres_user:${NO_SCHEME_PW}@127.0.0.1:1/app`, pw: NO_SCHEME_PW },
  ];

  for (const { label, url, pw } of leakyUrls) {
    it(`创建/详情/列表/更新都不回传口令：${label}`, () => {
      const created = pdb.connections.create({ name: label, dbType: 'postgresql', connectionUrl: url });
      expect(JSON.stringify(created)).not.toContain(pw);

      const detail = pdb.connections.get(created.id);
      expect(JSON.stringify(detail)).not.toContain(pw);

      const list = pdb.connections.list();
      expect(JSON.stringify(list)).not.toContain(pw);

      const updated = pdb.connections.update(created.id, { colorTag: 'red' });
      expect(JSON.stringify(updated)).not.toContain(pw);

      // 口令必须真的被当凭据保存下来
      expect(detail?.hasPassword).toBe(true);
      expect(pdb.connections.getConfig(created.id)?.password).toBe(pw);
    });
  }

  it('更新时再次粘贴含口令连接串也不泄漏', () => {
    const created = pdb.connections.create({
      name: 'update-again',
      dbType: 'postgresql',
      host: 'old',
      databaseName: 'd',
    });
    const updated = pdb.connections.update(created.id, {
      connectionUrl: `postgres://postgres:${SLASH_PW}@127.0.0.1:1/app`,
    });
    expect(JSON.stringify(updated)).not.toContain(SLASH_PW);
    expect(pdb.connections.getConfig(created.id)?.password).toBe(SLASH_PW);
  });

  it('历史遗留的脏数据在读取时也会被清洗，但驱动仍拿得到口令', () => {
    // 模拟修复前落库的行：连接串原文带口令，password_enc 为空
    pdb.db.run(
      'INSERT INTO connections (name, db_type, connection_url) VALUES (?, ?, ?)',
      'legacy',
      'postgresql',
      `postgres://postgres:${SLASH_PW}@127.0.0.1:1/app`,
    );
    const legacyId = pdb.db.get<{ id: number }>(
      'SELECT id FROM connections WHERE name = ?',
      'legacy',
    )?.id as number;

    const dto = pdb.connections.get(legacyId);
    expect(JSON.stringify(dto)).not.toContain(SLASH_PW);
    expect(JSON.stringify(pdb.connections.list())).not.toContain(SLASH_PW);

    // 驱动视角：连接串已清洗，但口令仍能从 URL 里兜出来（旧行没有 password_enc）
    const config = pdb.connections.getConfig(legacyId);
    expect(config?.connectionUrl as string).not.toContain(SLASH_PW);
    expect(config?.password).toBe(SLASH_PW);
  });
});

describe('AuditRepository：凭据形态的自由文本在落库前被清洗（回归）', () => {
  function appendRaw(message: string): void {
    pdb.audit.append({
      userId: null,
      username: 'tester',
      action: 'connect',
      resourceType: 'connection',
      resourceId: '1',
      connectionId: 1,
      status: 'failed',
      errorMessage: message,
    });
  }

  it('errorMessage 里的连接串口令（含 / 与无 scheme）不会进入审计与导出', () => {
    appendRaw(`无法解析 PostgreSQL 连接串: postgres://postgres:${SLASH_PW}@127.0.0.1:1/app`);
    appendRaw(`无法识别 PostgreSQL 连接串的协议头: postgres_user:${NO_SCHEME_PW}@127.0.0.1:1/app`);
    appendRaw(`认证失败 password=${QUERY_PW}`);

    const asJson = JSON.stringify(pdb.audit.query().items);
    expect(asJson).not.toContain(SLASH_PW);
    expect(asJson).not.toContain(NO_SCHEME_PW);
    expect(asJson).not.toContain(QUERY_PW);

    const csv = pdb.audit.exportCsv();
    expect(csv).not.toContain(SLASH_PW);
    expect(csv).not.toContain(NO_SCHEME_PW);
    expect(csv).not.toContain(QUERY_PW);

    const json = pdb.audit.exportJson();
    expect(json).not.toContain(SLASH_PW);
    expect(json).not.toContain(NO_SCHEME_PW);
    expect(json).not.toContain(QUERY_PW);
  });

  it('清洗发生在哈希之前，哈希链依然自洽', () => {
    appendRaw(`无法解析连接串: postgres://postgres:${SLASH_PW}@127.0.0.1:1/app`);
    appendRaw('ok');
    expect(pdb.audit.verifyChain().ok).toBe(true);
  });

  it('普通错误信息不被误伤', () => {
    appendRaw('连接超时：ECONNREFUSED');
    expect(pdb.audit.query().items[0]?.errorMessage).toBe('连接超时：ECONNREFUSED');
  });
});
