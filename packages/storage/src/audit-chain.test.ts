/**
 * 花生苗数据库管理工具 - 审计日志哈希链测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 审计日志的价值全部建立在"不可篡改"上，因此这里的测试是
 * 整个项目里最不能省的一组：追加、校验、篡改检出、清理后仍可校验。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeAuditHash, openPeanutDatabase, type PeanutDatabase } from './index.js';
import { hashSecret, sha256Hex } from './crypto.js';

let pdb: PeanutDatabase;
/** audit_logs.user_id 有外键约束，因此测试里必须有一个真实用户 */
let userId: number;

beforeEach(() => {
  // 内存库：不落盘、不生成主密钥文件
  pdb = openPeanutDatabase({ memory: true });
  userId = pdb.users.create({
    username: 'audit-tester',
    passwordHash: hashSecret('Str0ng-Passw0rd!'),
    isAdmin: true,
    roles: ['admin'],
  }).id;
});

afterEach(() => {
  vi.useRealTimers();
  pdb.close();
});

function appendLogin(username = 'audit-tester'): number {
  return pdb.audit.append({
    userId,
    username,
    action: 'login',
    resourceType: 'session',
    resourceId: 'sess-1',
    status: 'success',
    ipAddress: '127.0.0.1',
  });
}

describe('哈希链完整性', () => {
  it('空库校验通过', () => {
    const result = pdb.audit.verifyChain();
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(0);
    expect(result.brokenAt).toBeNull();
  });

  it('连续追加后校验通过', () => {
    for (let i = 0; i < 25; i++) appendLogin(`user-${i}`);
    const result = pdb.audit.verifyChain();
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(25);
    expect(result.brokenAt).toBeNull();
  });

  it('每条记录都带哈希与前一跳哈希', () => {
    appendLogin('a');
    appendLogin('b');
    const rows = pdb.db.all<{ id: number; prev_hash: string | null; curr_hash: string | null }>(
      'SELECT id, prev_hash, curr_hash FROM audit_logs ORDER BY id',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.curr_hash).toMatch(/^[0-9a-f]{64}$/);
    // 第二条的 prev_hash 必须等于第一条的 curr_hash
    expect(rows[1]?.prev_hash).toBe(rows[0]?.curr_hash);
  });

  it('篡改历史记录的内容会被检出', () => {
    for (let i = 0; i < 5; i++) appendLogin(`user-${i}`);
    expect(pdb.audit.verifyChain().ok).toBe(true);

    // 直接改库：把第 2 条的用户名改掉，模拟"删库跑路前改日志"
    pdb.db.run("UPDATE audit_logs SET username = 'attacker' WHERE id = 2");

    const result = pdb.audit.verifyChain();
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  it('删除中间记录会被检出（断链）', () => {
    for (let i = 0; i < 5; i++) appendLogin(`user-${i}`);
    pdb.db.run('DELETE FROM audit_logs WHERE id = 3');

    expect(pdb.audit.verifyChain().ok).toBe(false);
  });

  it('伪造哈希被检出', () => {
    appendLogin('a');
    appendLogin('b');
    pdb.db.run("UPDATE audit_logs SET curr_hash = ? WHERE id = 1", 'f'.repeat(64));
    expect(pdb.audit.verifyChain().ok).toBe(false);
  });

  it('只改 detail 也会被检出（detail 参与哈希）', () => {
    pdb.audit.append({
      userId,
      username: 'admin',
      action: 'query_execute',
      status: 'success',
      detail: { rows: 10 },
    });
    expect(pdb.audit.verifyChain().ok).toBe(true);
    pdb.db.run('UPDATE audit_logs SET detail = ? WHERE id = 1', JSON.stringify({ rows: 999 }));
    expect(pdb.audit.verifyChain().ok).toBe(false);
  });
});

describe('审计写入与查询', () => {
  it('记录字段被正确持久化', () => {
    const id = pdb.audit.append({
      userId,
      username: 'alice',
      action: 'query_execute',
      resourceType: 'connection',
      resourceId: '3',
      connectionId: 3,
      sqlText: 'SELECT 1',
      status: 'success',
      durationMs: 12,
      ipAddress: '10.0.0.1',
      userAgent: 'vitest',
      detail: { rows: 1 },
    });
    const entry = pdb.audit.query({ userId }).items.find((e) => e.id === id);
    expect(entry).toBeDefined();
    expect(entry?.action).toBe('query_execute');
    expect(entry?.connectionId).toBe(3);
    expect(entry?.sqlText).toBe('SELECT 1');
    expect(entry?.durationMs).toBe(12);
    expect(entry?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('查询支持按动作与状态过滤', () => {
    appendLogin('a');
    pdb.audit.append({ userId, username: 'a', action: 'query_execute', status: 'failed', errorMessage: 'boom' });
    expect(pdb.audit.query({ action: 'login' }).total).toBe(1);
    expect(pdb.audit.query({ status: 'failed' }).total).toBe(1);
  });

  it('导出 CSV/JSON 不抛错且包含表头', () => {
    appendLogin('a');
    const csv = pdb.audit.exportCsv({});
    expect(csv.split('\n')[0]).toContain('id');
    const json = pdb.audit.exportJson({});
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

describe('审计清理（purge）', () => {
  /**
   * 以固定时间轴追加 count 条记录（每条相差 1 秒），返回 id 列表。
   * created_at 参与哈希计算，不能事后改写，所以这里用假时钟让每条的时间戳
   * 天然可区分，才能精确地"只清理前 k 条"。
   */
  function appendAt(baseIso: string, count: number, prefix = 'user'): number[] {
    const base = Date.parse(baseIso);
    const ids: number[] = [];
    for (let i = 0; i < count; i++) {
      vi.setSystemTime(base + i * 1000);
      ids.push(appendLogin(`${prefix}-${i}`));
    }
    return ids;
  }

  it('清理过期日志后保留可校验的链锚点', () => {
    for (let i = 0; i < 10; i++) appendLogin(`user-${i}`);

    // 清理"未来"的时间点 —— 等价于清掉全部历史（只保留边界锚点行）
    const removed = pdb.audit.purge('2999-01-01T00:00:00.000Z');
    // 过期区间里最新的一条被刻意保留为链锚点，因此实际删除 9 条而非 10 条
    expect(removed).toBe(9);

    // 清理后链条必须仍然自洽：新记录接在锚点上
    appendLogin('after-purge');
    const result = pdb.audit.verifyChain();
    expect(result.ok).toBe(true);
  });

  it('锚点被写入 settings，便于事后追溯清理边界', () => {
    appendLogin('a');
    pdb.audit.purge('2999-01-01T00:00:00.000Z');
    const anchor = pdb.settings.get('audit.chain_anchor_id');
    expect(anchor).not.toBeNull();
    // 锚点行本身必须真实存在（历史缺陷正是把它一起删掉了）
    const row = pdb.db.get<{ id: number; curr_hash: string | null }>(
      'SELECT id, curr_hash FROM audit_logs WHERE id = ?',
      Number(anchor),
    );
    expect(row).toBeDefined();
    expect(row?.curr_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('清理不存在的区间返回 0 且不影响链', () => {
    appendLogin('a');
    expect(pdb.audit.purge('1970-01-01T00:00:00.000Z')).toBe(0);
    expect(pdb.audit.verifyChain().ok).toBe(true);
  });

  it('部分清理后锚点行仍在，且其 curr_hash 与后续第一条的 prev_hash 一致', () => {
    vi.useFakeTimers();
    const ids = appendAt('2024-01-01T00:00:00.000Z', 10);

    // 时间点落在第 5 条与第 6 条之间：前 5 条过期
    const removed = pdb.audit.purge('2024-01-01T00:00:05.000Z');
    // 第 5 条被保留为锚点，只删掉它之前的 4 条
    expect(removed).toBe(4);

    const anchorId = Number(pdb.settings.get('audit.chain_anchor_id'));
    expect(anchorId).toBe(ids[4]);

    const anchor = pdb.db.get<{ id: number; curr_hash: string | null }>(
      'SELECT id, curr_hash FROM audit_logs WHERE id = ?',
      anchorId,
    );
    expect(anchor).toBeDefined();
    const firstSurvivor = pdb.db.get<{ prev_hash: string | null }>(
      'SELECT prev_hash FROM audit_logs WHERE id > ? ORDER BY id ASC LIMIT 1',
      anchorId,
    );
    expect(firstSurvivor?.prev_hash).toBe(anchor?.curr_hash);

    expect(pdb.audit.verifyChain()).toMatchObject({ ok: true, brokenAt: null });
  });

  it('连续多次清理（中途穿插新写入）后链仍然完整', () => {
    vi.useFakeTimers();
    appendAt('2024-01-01T00:00:00.000Z', 12);

    // 第一次清理：清掉前 3 条，保留第 4 条（00:00:03）作锚点
    vi.setSystemTime(Date.parse('2024-01-01T00:00:20.000Z'));
    expect(pdb.audit.purge('2024-01-01T00:00:04.000Z')).toBe(3);
    expect(pdb.audit.verifyChain().ok).toBe(true);

    // 清理之间穿插新写入
    vi.setSystemTime(Date.parse('2024-01-01T00:01:00.000Z'));
    appendLogin('mid-1');
    vi.setSystemTime(Date.parse('2024-01-01T00:01:01.000Z'));
    appendLogin('mid-2');
    expect(pdb.audit.verifyChain()).toMatchObject({ ok: true, brokenAt: null });

    // 第二次清理：跨过上一次的锚点，锚点必须迁移到新的边界
    vi.setSystemTime(Date.parse('2024-01-01T00:02:00.000Z'));
    expect(pdb.audit.purge('2024-01-01T00:00:08.000Z')).toBe(4);
    expect(pdb.audit.verifyChain()).toMatchObject({ ok: true, brokenAt: null });

    // 清理之后再写入，仍要能接上
    appendLogin('after-2');
    appendLogin('after-3');
    expect(pdb.audit.verifyChain()).toMatchObject({ ok: true, brokenAt: null });
  });

  it('整段清理时只留下边界锚点行，链依然自洽', () => {
    vi.useFakeTimers();
    const ids = appendAt('2024-01-01T00:00:00.000Z', 10);

    vi.setSystemTime(Date.parse('2024-01-01T01:00:00.000Z'));
    expect(pdb.audit.purge('2999-01-01T00:00:00.000Z')).toBe(9);

    const remaining = pdb.db.all<{ id: number }>('SELECT id FROM audit_logs ORDER BY id ASC');
    expect(remaining.map((r) => r.id)).toEqual([ids[9]]);
    expect(pdb.audit.verifyChain()).toMatchObject({ ok: true, brokenAt: null });

    appendLogin('after-full-purge');
    expect(pdb.audit.verifyChain()).toMatchObject({ ok: true, brokenAt: null });
  });

  it('清理后篡改幸存记录仍会被检出（锚点不会掩盖篡改）', () => {
    vi.useFakeTimers();
    const ids = appendAt('2024-01-01T00:00:00.000Z', 6);

    vi.setSystemTime(Date.parse('2024-01-01T00:00:30.000Z'));
    // 前 3 条过期，保留 id=ids[2] 作锚点
    expect(pdb.audit.purge('2024-01-01T00:00:03.000Z')).toBe(2);
    expect(pdb.audit.verifyChain().ok).toBe(true);

    pdb.db.run("UPDATE audit_logs SET username = 'attacker' WHERE id = ?", ids[3]);
    const result = pdb.audit.verifyChain();
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(ids[3]);
  });
});

/**
 * ════════════════════════════════════════════════════════════════════════════
 * 以下为对抗性安全验证暴露出的 4 个弱点的回归测试。
 * 每条测试都对应一次"真实可复现的篡改 / 绕过"，而不是"实现看起来对"。
 * ════════════════════════════════════════════════════════════════════════════
 */

/** v1 规范化（在测试里独立重写，**不复用被测实现**，避免"自己验自己"）。 */
function legacyCanonical(f: {
  userId: number | null;
  username: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  connectionId: number | null;
  detail: string | null;
  sqlText: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}): string {
  return JSON.stringify([
    f.userId ?? '',
    f.username ?? '',
    f.action,
    f.resourceType ?? '',
    f.resourceId ?? '',
    f.connectionId ?? '',
    f.detail ?? '',
    f.sqlText ?? '',
    f.status,
    f.errorMessage ?? '',
    f.createdAt,
  ]);
}

/**
 * 直接插入一条"升级前就已存在"的 v1 历史行。
 * 刻意不写 hash_version，让它走列的 DEFAULT 1 —— 完全模拟老库迁移后的状态。
 */
function appendLegacyLogin(username: string, createdAt: string, prevHash: string | null): string {
  const f = {
    userId,
    username,
    action: 'login',
    resourceType: 'session',
    resourceId: 'sess-legacy',
    connectionId: null,
    detail: null,
    sqlText: null,
    status: 'success',
    errorMessage: null,
    createdAt,
  };
  const currHash = sha256Hex(`${prevHash ?? 'GENESIS'}|${legacyCanonical(f)}`);
  pdb.db.run(
    `INSERT INTO audit_logs
       (user_id, username, action, resource_type, resource_id, connection_id, detail, sql_text,
        ip_address, user_agent, status, error_message, duration_ms, prev_hash, curr_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    f.userId,
    f.username,
    f.action,
    f.resourceType,
    f.resourceId,
    f.connectionId,
    f.detail,
    f.sqlText,
    '127.0.0.1',
    null,
    f.status,
    f.errorMessage,
    null,
    prevHash,
    currHash,
    f.createdAt,
  );
  return currHash;
}

const legacyTime = (i: number): string =>
  new Date(Date.UTC(2024, 0, 1, 0, 0, i)).toISOString();

describe('弱点1：ip_address / user_agent / duration_ms 参与哈希', () => {
  const tamperCases: Array<[string, string]> = [
    ['ip_address', "'9.9.9.9'"],
    ['user_agent', "'attacker-agent/1.0'"],
    ['duration_ms', '12345'],
  ];

  it.each(tamperCases)(
    '篡改 %s 会被检出（旧实现下这三列不在哈希里，改完 verifyChain 仍是 ok）',
    (column, literal) => {
      pdb.audit.append({
        userId,
        username: 'admin',
        action: 'execute',
        resourceType: 'connection',
        resourceId: '1',
        connectionId: 1,
        sqlText: 'SELECT 1',
        status: 'success',
        ipAddress: '10.0.0.1',
        userAgent: 'vitest/1.0',
        durationMs: 12,
      });
      expect(pdb.audit.verifyChain()).toMatchObject({ ok: true, anchored: true });

      // 直接改库：只动这一列，其它字段一概不变
      pdb.db.run(`UPDATE audit_logs SET ${column} = ${literal} WHERE id = 1`);

      const result = pdb.audit.verifyChain();
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('hash');
      expect(result.brokenAt).toBe(1);
    },
  );

  it('三列都被真实持久化，且新行 hash_version=2', () => {
    const id = pdb.audit.append({
      userId,
      username: 'admin',
      action: 'execute',
      status: 'success',
      ipAddress: '10.0.0.1',
      userAgent: 'vitest/1.0',
      durationMs: 12,
    });
    const row = pdb.db.get<{ ip_address: string; user_agent: string; duration_ms: number; hash_version: number }>(
      'SELECT ip_address, user_agent, duration_ms, hash_version FROM audit_logs WHERE id = ?',
      id,
    );
    expect(row).toMatchObject({
      ip_address: '10.0.0.1',
      user_agent: 'vitest/1.0',
      duration_ms: 12,
      hash_version: 2,
    });
  });
});

describe('弱点2：链尾删除检测（链尾锚）', () => {
  it('删掉最后一行会被检出（旧实现只逐行衔接，删尾后仍 ok）', () => {
    for (let i = 0; i < 5; i++) appendLogin(`user-${i}`);
    expect(pdb.audit.verifyChain()).toMatchObject({ ok: true, anchored: true });

    // 只删最后一行：剩下的 1..4 彼此衔接完好
    pdb.db.run('DELETE FROM audit_logs WHERE id = 5');

    const result = pdb.audit.verifyChain();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('anchor_id_mismatch');
    expect(result.brokenAt).toBe(4);
  });

  it('删掉最后几行也会被检出', () => {
    for (let i = 0; i < 6; i++) appendLogin(`user-${i}`);
    pdb.db.run('DELETE FROM audit_logs WHERE id IN (4, 5, 6)');
    const result = pdb.audit.verifyChain();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('anchor_id_mismatch');
    expect(result.brokenAt).toBe(3);
  });

  it('删中间一行由逐行衔接检查先报出（reason=link，与锚检查互不掩盖）', () => {
    for (let i = 0; i < 5; i++) appendLogin(`user-${i}`);
    pdb.db.run('DELETE FROM audit_logs WHERE id = 3');
    const result = pdb.audit.verifyChain();
    expect(result.ok).toBe(false);
    // 迭代到 id=4 时发现它的 prev_hash 指向已被删除的 id=3 → 衔接断裂先暴露
    expect(result.reason).toBe('link');
    expect(result.brokenAt).toBe(4);
  });

  it('每次 append 都会把链尾锚推进到新的尾行', () => {
    const first = appendLogin('a');
    expect(pdb.settings.get('audit.chain_tail')).toMatch(
      new RegExp(`^${first}:[0-9a-f]{64}:1$`),
    );
    const second = appendLogin('b');
    const raw = pdb.settings.get('audit.chain_tail') as string;
    expect(raw.startsWith(`${second}:`)).toBe(true);
    expect(raw.endsWith(':2')).toBe(true);
  });

  it('链尾锚被手动改坏时也会报出（anchor_malformed）', () => {
    appendLogin('a');
    pdb.db.run("UPDATE settings SET value = 'not-an-anchor' WHERE key = 'audit.chain_tail'");
    const result = pdb.audit.verifyChain();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('anchor_malformed');
  });
});

describe('弱点3：null 与空字符串在 v2 中不再碰撞', () => {
  const base = {
    userId: 1,
    username: 'audit-tester',
    action: 'execute',
    resourceType: 'connection',
    resourceId: '1',
    connectionId: 1,
    sqlText: null as string | null,
    status: 'success',
    errorMessage: null as string | null,
    createdAt: '2024-01-01T00:00:00.000Z',
  };

  it('v1 无法区分 null 与空串（历史弱点确实存在），v2 可以', () => {
    // v1：null 与 '' 折叠成同一个 canonical 串 → 同一个哈希（这就是弱点3）
    expect(computeAuditHash(null, { ...base, detail: null }, 1)).toBe(
      computeAuditHash(null, { ...base, detail: '' }, 1),
    );
    // v2：类型前缀让 null 与 '' 产生不同的哈希
    expect(computeAuditHash(null, { ...base, detail: null }, 2)).not.toBe(
      computeAuditHash(null, { ...base, detail: '' }, 2),
    );
    // errorMessage 同理
    expect(computeAuditHash(null, { ...base, detail: null, errorMessage: null }, 1)).toBe(
      computeAuditHash(null, { ...base, detail: null, errorMessage: '' }, 1),
    );
    expect(computeAuditHash(null, { ...base, detail: null, errorMessage: null }, 2)).not.toBe(
      computeAuditHash(null, { ...base, detail: null, errorMessage: '' }, 2),
    );
  });

  it('把已写入的 detail 从空串偷改成 NULL 会被检出（v1 下这一步改完仍完整）', () => {
    const id = pdb.audit.append({
      userId,
      username: 'a',
      action: 'execute',
      status: 'success',
      detail: '',
    });
    expect(pdb.audit.verifyChain()).toMatchObject({ ok: true, anchored: true });

    // 直接改库：'' → NULL。v1 的 `?? ''` 把两者折叠成同一个 canonical 串，
    // 所以这一步在 v1 下不会被发现；v2 的类型前缀编码必须检出。
    pdb.db.run('UPDATE audit_logs SET detail = NULL WHERE id = ?', id);

    const result = pdb.audit.verifyChain();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('hash');
    expect(result.brokenAt).toBe(id);
  });
});

describe('老库兼容：v1 历史行 + v2 新行混合链', () => {
  it('仅有 v1 历史行时校验通过，并标记为"尚未建立链尾锚"（升级不误报断链）', () => {
    let prev: string | null = null;
    for (let i = 0; i < 3; i++) prev = appendLegacyLogin(`legacy-${i}`, legacyTime(i), prev);

    const versions = pdb.db.all<{ hash_version: number }>(
      'SELECT hash_version FROM audit_logs ORDER BY id',
    );
    expect(versions.map((r) => r.hash_version)).toEqual([1, 1, 1]);

    const result = pdb.audit.verifyChain();
    expect(result).toMatchObject({ ok: true, checked: 3, brokenAt: null, anchored: false });
  });

  it('混合链整体连续：历史行按 v1、新行按 v2，各用自己的版本校验', () => {
    let prev: string | null = null;
    for (let i = 0; i < 3; i++) prev = appendLegacyLogin(`legacy-${i}`, legacyTime(i), prev);
    appendLogin('new-1');
    appendLogin('new-2');

    const versions = pdb.db.all<{ hash_version: number }>(
      'SELECT hash_version FROM audit_logs ORDER BY id',
    );
    expect(versions.map((r) => r.hash_version)).toEqual([1, 1, 1, 2, 2]);

    expect(pdb.audit.verifyChain()).toMatchObject({
      ok: true,
      checked: 5,
      brokenAt: null,
      anchored: true,
    });
  });

  it('篡改 v1 历史行的内容仍会被检出', () => {
    let prev: string | null = null;
    for (let i = 0; i < 3; i++) prev = appendLegacyLogin(`legacy-${i}`, legacyTime(i), prev);
    pdb.db.run("UPDATE audit_logs SET username = 'attacker' WHERE id = 2");
    const result = pdb.audit.verifyChain();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('hash');
    expect(result.brokenAt).toBe(2);
  });

  it('老库首次 append 补建链尾锚：补建前是盲区，补建后删尾即可检出', () => {
    let prev: string | null = null;
    for (let i = 0; i < 2; i++) prev = appendLegacyLogin(`legacy-${i}`, legacyTime(i), prev);

    // 尚未建立锚：删掉尾行后逐行衔接仍然完好 → 这个窗口内看不到（诚实记录）
    pdb.db.run('DELETE FROM audit_logs WHERE id = 2');
    expect(pdb.audit.verifyChain()).toMatchObject({ ok: true, anchored: false });

    // 下一次写入补建锚，指向新的链尾
    const id = appendLogin('after-upgrade');
    expect(pdb.audit.verifyChain()).toMatchObject({ ok: true, anchored: true });

    // 补建之后再删尾就会被检出
    pdb.db.run('DELETE FROM audit_logs WHERE id = ?', id);
    const result = pdb.audit.verifyChain();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('anchor_id_mismatch');
  });

  it('诚实记录边界：v1 历史行的 ip/user_agent/duration_ms 已无法追溯加固', () => {
    appendLegacyLogin('legacy', legacyTime(0), null);
    expect(pdb.audit.verifyChain().ok).toBe(true);
    // v1 行写入时这三列本就不在哈希里，链尾锚也只锚哈希，因此改不掉历史行为。
    // 版本化兼容老库的代价：老行只能按老规则校验。
    pdb.db.run("UPDATE audit_logs SET ip_address = '9.9.9.9', duration_ms = 999 WHERE id = 1");
    expect(pdb.audit.verifyChain().ok).toBe(true);
  });

  it('computeAuditHash 两参数调用仍按 v1 计算（外部调用方兼容）', () => {
    const payload = {
      userId: 1,
      username: 'audit-tester',
      action: 'execute',
      resourceType: 'connection',
      resourceId: '1',
      connectionId: 1,
      detail: null,
      sqlText: null,
      status: 'success',
      errorMessage: null,
      createdAt: '2024-01-01T00:00:00.000Z',
    };
    const v1Expected = sha256Hex(`GENESIS|${legacyCanonical(payload)}`);
    expect(computeAuditHash(null, payload)).toBe(v1Expected);
    expect(computeAuditHash(null, payload)).toBe(computeAuditHash(null, payload, 1));
    expect(computeAuditHash(null, payload, 2)).not.toBe(v1Expected);
  });
});

describe('purge 与链尾锚协同', () => {
  it('purge 同步刷新链尾锚，之后链仍 ok，且事后删尾可检出', () => {
    for (let i = 0; i < 8; i++) appendLogin(`user-${i}`);
    expect(pdb.audit.verifyChain()).toMatchObject({ ok: true, anchored: true });

    // 清掉全部历史：只保留边界锚点行（沿用既有语义，删 7 条）
    expect(pdb.audit.purge('2999-01-01T00:00:00.000Z')).toBe(7);

    // purge 后行数变了，锚必须同步刷新：锚点之后 0 行
    const afterPurge = pdb.settings.get('audit.chain_tail') as string;
    expect(afterPurge.endsWith(':0')).toBe(true);
    expect(pdb.audit.verifyChain()).toMatchObject({ ok: true, anchored: true, brokenAt: null });

    // purge 之后再写一条：锚指向新尾行、count=1
    const newId = appendLogin('after-purge');
    const raw = pdb.settings.get('audit.chain_tail') as string;
    expect(raw.startsWith(`${newId}:`)).toBe(true);
    expect(raw.endsWith(':1')).toBe(true);
    expect(pdb.audit.verifyChain()).toMatchObject({ ok: true, anchored: true });

    // 删掉这条新尾行 → 必须被检出（purge 之后锚依然有效）
    pdb.db.run('DELETE FROM audit_logs WHERE id = ?', newId);
    const result = pdb.audit.verifyChain();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('anchor_id_mismatch');
  });
});
