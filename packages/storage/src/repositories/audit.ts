/**
 * 花生苗数据库管理工具 - 审计日志仓库（哈希链防篡改）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * curr_hash = sha256(prev_hash + '|' + canonical(event))
 * 规范化字段顺序固定，保证任何时候重算都得到同一结果；
 * created_at 由应用层生成并显式写入，避免依赖数据库时钟导致不可复现。
 *
 * ── 哈希版本（hash_version）与向后兼容 ──────────────────────────────────
 * 审计链一旦写入就不能改动历史行的哈希。修复「三列不参与哈希」「null 与 ''
 * 无法区分」这两个问题时，如果直接改规范化算法，**所有历史行都会校验失败**，
 * 等于把用户已有的审计链永久打断。因此引入 `audit_logs.hash_version`：
 *
 *   v1：历史格式，只有 11 个字段，缺失值一律用 '' 代替（null 与 '' 不可区分）。
 *       只用于**校验**历史行，绝不再用于新写入。
 *   v2：新格式，额外把 ip_address / user_agent / duration_ms 纳入哈希，并用
 *       带类型前缀的编码区分 null / 数字 / 字符串（null 不再等价于 ''）。
 *
 * verifyChain() 逐行按该行自己的 hash_version 选择算法；prev_hash 照旧串联，
 * 因此「老行用 v1、新行用 v2」的混合链整体仍然连续可校验。
 *
 * ── 链尾锚（audit.chain_tail）──────────────────────────────────────────
 * 只逐行校验衔接无法发现「把链尾整行删掉」：剩下的链依然首尾相接。因此每次
 * append / purge 都会在**同一个事务**里把链尾状态写入 settings：
 *     audit.chain_tail = `${尾行 id}:${尾行 curr_hash}:${锚点之后的行数}`
 * verifyChain() 除逐行校验外，还断言实际链尾与锚一致。老库没有这个设置项时
 * 视为「尚未建立锚」（ok=true, anchored=false），并在下一次 append 时补建，
 * 避免一升级就误报断链。
 */

import { sha256Hex } from '../crypto.js';
import { nowIso, toIso, type LocalDatabase, type SqlParam } from '../database.js';
import { scrubCredentialText } from '../redact.js';
import type { AuditEvent, AuditLogEntry, AuditQuery } from '@peanutsprout/core';

interface AuditRow {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  connection_id: number | null;
  detail: string | null;
  sql_text: string | null;
  ip_address: string | null;
  user_agent: string | null;
  status: string;
  error_message: string | null;
  duration_ms: number | null;
  prev_hash: string | null;
  curr_hash: string | null;
  created_at: string;
  /** 该行写入时使用的哈希版本；老库迁移后历史行为 1。 */
  hash_version: number;
}

/** 当前写入使用的哈希版本。 */
export const AUDIT_HASH_VERSION = 2;
/** 历史哈希版本：只用于校验老行，绝不再用于新写入。 */
export const AUDIT_HASH_VERSION_V1 = 1;

/** 参与哈希的字段，顺序即规范顺序，**不可调整**。 */
interface HashPayload {
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
  /** 以下三个字段自 v2 起参与哈希；v1 忽略它们（历史行为不可变）。 */
  ipAddress?: string | null;
  userAgent?: string | null;
  durationMs?: number | null;
}

/**
 * v1 规范化：历史格式，**不可修改**，否则老库历史行全部校验失败。
 * null 与 '' 在这里都会被折叠成 ''（这正是 v1 的已知弱点，只在 v2 修复）。
 */
const canonicalV1 = (p: HashPayload): string =>
  JSON.stringify([
    p.userId ?? '',
    p.username ?? '',
    p.action,
    p.resourceType ?? '',
    p.resourceId ?? '',
    p.connectionId ?? '',
    p.detail ?? '',
    p.sqlText ?? '',
    p.status,
    p.errorMessage ?? '',
    p.createdAt,
  ]);

/**
 * v2 类型前缀编码：用一个不可能出现在普通文本开头的私有标记（U+0000）区分类型。
 *
 *   null / undefined → "\u0000null"
 *   数字 n           → "\u0000num:<n>"
 *   字符串 s         → "\u0000str:<s>"（空串是 "\u0000str:"）
 *
 * 该编码是单射：null ≠ 空串，数字 5 ≠ 字符串 "5"，且任何真实字符串都带
 * "\u0000str:" 前缀，不会与 null / 数字的编码相等。于是 null 与 '' 产生不同
 * 的 canonical 串，消除了 v1 的构造性碰撞空间。
 */
const V2_NULL = '\u0000null';
const V2_NUM = '\u0000num:';
const V2_STR = '\u0000str:';

function encodeV2(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return V2_NULL;
  if (typeof value === 'number') return `${V2_NUM}${value}`;
  return `${V2_STR}${value}`;
}

/**
 * v2 规范化：在 v1 十一个字段的基础上，把 ip_address / user_agent / duration_ms
 * 也纳入哈希（这样直接改这三列会被检出），并用类型前缀区分 null 与 ''。
 * 字段顺序固定，**一旦发布不可再调整**。
 */
const canonicalV2 = (p: HashPayload): string =>
  JSON.stringify([
    encodeV2(p.userId),
    encodeV2(p.username),
    encodeV2(p.action),
    encodeV2(p.resourceType),
    encodeV2(p.resourceId),
    encodeV2(p.connectionId),
    encodeV2(p.detail),
    encodeV2(p.sqlText),
    encodeV2(p.ipAddress ?? null),
    encodeV2(p.userAgent ?? null),
    encodeV2(p.status),
    encodeV2(p.errorMessage ?? null),
    encodeV2(p.durationMs ?? null),
    encodeV2(p.createdAt),
  ]);

/**
 * 计算审计哈希。
 *
 * @param version 规范化算法版本，默认 **1**：保持导出函数的旧行为不变，避免
 *   任何外部调用方（2 参数调用）因为本次修复而静默换算法。仓库内部写入/校验
 *   都会显式传入行自己的版本号。
 */
export function computeAuditHash(
  prevHash: string | null,
  payload: HashPayload,
  version: number = AUDIT_HASH_VERSION_V1,
): string {
  const canonical = version >= AUDIT_HASH_VERSION ? canonicalV2(payload) : canonicalV1(payload);
  return sha256Hex(`${prevHash ?? 'GENESIS'}|${canonical}`);
}

/** 链清理锚点：purge 后链的起点行 id（该行被刻意保留）。 */
const CHAIN_ANCHOR_SETTING = 'audit.chain_anchor_id';
/** 链尾锚：`${尾行 id}:${尾行 curr_hash}:${锚点之后的行数}`。 */
const CHAIN_TAIL_SETTING = 'audit.chain_tail';

/** 断裂原因，用于在 UI / 日志里定位是「衔接断了」还是「链尾被删」。 */
export type ChainBreakReason =
  | 'link' // 某行的 prev_hash 与前一跳不一致
  | 'hash' // 某行的 curr_hash 重算不一致
  | 'unknown_hash_version' // 行里的 hash_version 无法识别
  | 'anchor_malformed' // 链尾锚格式损坏
  | 'anchor_id_mismatch' // 实际尾行 id 与锚记录不一致（尾部被删 / 被加）
  | 'anchor_count_mismatch' // 实际行数与锚记录不一致（中间或尾部被删）
  | 'anchor_hash_mismatch'; // 尾行哈希与锚记录不一致（尾部被改写 / 整链重算）

export interface ChainVerifyResult {
  ok: boolean;
  checked: number;
  brokenAt: number | null;
  /** 是否已建立链尾锚。老库首次升级、下一次写入之前为 false。 */
  anchored: boolean;
  reason?: ChainBreakReason;
}

export class AuditRepository {
  constructor(private readonly db: LocalDatabase) {}

  /** 追加一条审计记录，返回新记录 id。整个「读链尾 + 写新记录」在同一事务内完成。 */
  append(event: AuditEvent): number {
    const createdAt = nowIso();
    const detail =
      event.detail === undefined || event.detail === null
        ? null
        : typeof event.detail === 'string'
          ? event.detail
          : JSON.stringify(event.detail);

    // 审计是不可变的历史，写进去就晚了：落库前对自由文本做一次通用凭据清洗，
    // 兜住任何上游漏写（`scheme://user:PASS@`、无 scheme 的 `user:PASS@`、
    // `password=xxx`）。清洗发生在计算哈希之前，因此哈希链仍然自洽。
    const safeDetail = detail === null ? null : scrubCredentialText(detail);
    const safeErrorMessage =
      event.errorMessage === undefined || event.errorMessage === null
        ? (event.errorMessage ?? null)
        : scrubCredentialText(String(event.errorMessage));

    return this.db.transaction(() => {
      const last = this.db.get<{ id: number; curr_hash: string | null }>(
        'SELECT id, curr_hash FROM audit_logs ORDER BY id DESC LIMIT 1',
      );
      const prevHash = last?.curr_hash ?? null;
      const payload: HashPayload = {
        userId: event.userId ?? null,
        username: event.username ?? null,
        action: String(event.action),
        resourceType: event.resourceType ?? null,
        resourceId: event.resourceId ?? null,
        connectionId: event.connectionId ?? null,
        detail: safeDetail,
        sqlText: event.sqlText ?? null,
        // v2 起这三列也参与哈希：审计里「谁在什么 IP、用什么客户端做了什么、
        // 耗时多久」不再是可以随手改掉而不被发现的自由字段。
        ipAddress: event.ipAddress ?? null,
        userAgent: event.userAgent ?? null,
        status: event.status,
        errorMessage: safeErrorMessage,
        durationMs: event.durationMs ?? null,
        createdAt,
      };
      const currHash = computeAuditHash(prevHash, payload, AUDIT_HASH_VERSION);
      const r = this.db.run(
        `INSERT INTO audit_logs
           (user_id, username, action, resource_type, resource_id, connection_id, detail, sql_text,
            ip_address, user_agent, status, error_message, duration_ms, prev_hash, curr_hash, created_at,
            hash_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        payload.userId,
        payload.username,
        payload.action,
        payload.resourceType,
        payload.resourceId,
        payload.connectionId,
        payload.detail,
        payload.sqlText,
        payload.ipAddress,
        payload.userAgent,
        payload.status,
        payload.errorMessage,
        payload.durationMs,
        prevHash,
        currHash,
        createdAt,
        AUDIT_HASH_VERSION,
      );
      // 链尾锚必须与链尾数据在**同一事务**里更新，否则崩溃或并发会留下
      // 「锚比链尾旧」的中间态，被 verifyChain 误判成篡改。
      this.writeTailAnchor(r.lastInsertRowid, currHash);
      return r.lastInsertRowid;
    });
  }

  /** 读取链清理锚点（purge 后保留的起点行 id）；未设置时为 0。 */
  private purgeAnchorId(): number {
    const row = this.db.get<{ value: string | null }>(
      'SELECT value FROM settings WHERE key = ?',
      CHAIN_ANCHOR_SETTING,
    );
    const id = row?.value ? Number(row.value) : 0;
    return Number.isFinite(id) && id > 0 ? id : 0;
  }

  /**
   * 写入链尾锚。`count` 是「清理锚点之后」的行数，因此 purge 之后行数变化
   * 也必须同步刷新（见 purge）。
   */
  private writeTailAnchor(tailId: number, tailHash: string | null): void {
    const count = this.db.count(
      'SELECT COUNT(*) AS c FROM audit_logs WHERE id > ?',
      this.purgeAnchorId(),
    );
    this.db.run(
      `INSERT INTO settings (key, value, category, updated_at) VALUES (?, ?, 'security', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      CHAIN_TAIL_SETTING,
      `${tailId}:${tailHash ?? ''}:${count}`,
      nowIso(),
    );
  }

  /** 读取并解析链尾锚；未建立或格式损坏时分别返回 null / 'malformed'。 */
  private readTailAnchor(): { id: number; hash: string; count: number } | 'malformed' | null {
    const row = this.db.get<{ value: string | null }>(
      'SELECT value FROM settings WHERE key = ?',
      CHAIN_TAIL_SETTING,
    );
    const raw = row?.value;
    if (raw === null || raw === undefined) return null;
    const first = raw.indexOf(':');
    const last = raw.lastIndexOf(':');
    if (first < 0 || last <= first) return 'malformed';
    const id = Number(raw.slice(0, first));
    const count = Number(raw.slice(last + 1));
    const hash = raw.slice(first + 1, last);
    if (!Number.isInteger(id) || !Number.isInteger(count) || id < 0 || count < 0) {
      return 'malformed';
    }
    return { id, hash, count };
  }

  /** 把一行审计记录转成哈希载荷（校验路径）。 */
  private payloadOf(row: AuditRow): HashPayload {
    return {
      userId: row.user_id,
      username: row.username,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      connectionId: row.connection_id,
      detail: row.detail,
      sqlText: row.sql_text,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      status: row.status,
      errorMessage: row.error_message,
      durationMs: row.duration_ms,
      createdAt: row.created_at,
    };
  }

  private buildWhere(query: AuditQuery): { sql: string; params: SqlParam[] } {
    const where: string[] = [];
    const params: SqlParam[] = [];
    if (query.userId !== undefined) {
      where.push('user_id = ?');
      params.push(query.userId);
    }
    if (query.username) {
      where.push('username = ?');
      params.push(query.username);
    }
    if (query.action) {
      where.push('action = ?');
      params.push(query.action);
    }
    if (query.connectionId !== undefined) {
      where.push('connection_id = ?');
      params.push(query.connectionId);
    }
    if (query.status) {
      where.push('status = ?');
      params.push(query.status);
    }
    if (query.from) {
      where.push('created_at >= ?');
      params.push(query.from);
    }
    if (query.to) {
      where.push('created_at <= ?');
      params.push(query.to);
    }
    return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
  }

  /**
   * 按 id 游标分批读取审计日志，供**流式导出**使用。
   *
   * 导出走 queryAll 会把最多 10 万行一次性物化成数组再 join 成字符串：
   * sql_text 单行上限 8000 字符，10 万行足以产生上百 MB 的中间数组 + 最终字符串，
   * 而且整个过程是同步的、事件循环被完全阻塞。
   * 改成按 id 递增分批读，配合响应流，峰值内存就只有一批的大小。
   *
   * @param afterId 只取 id 大于该值的记录；首次调用传 0。
   */
  queryBatch(query: AuditQuery, afterId: number, limit: number): AuditLogEntry[] {
    const { sql: whereSql, params } = this.buildWhere(query);
    const conditions = whereSql ? [whereSql.slice('WHERE '.length)] : [];
    const cursor = afterId > 0;
    if (cursor) conditions.push('id > ?');
    const clause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const bound: SqlParam[] = cursor ? [...params, afterId, limit] : [...params, limit];
    const rows = this.db.all<AuditRow>(
      `SELECT * FROM audit_logs ${clause} ORDER BY id ASC LIMIT ?`,
      ...bound,
    );
    return rows.map(rowToEntry);
  }

  query(query: AuditQuery = {}): { items: AuditLogEntry[]; total: number } {
    const { sql: whereSql, params } = this.buildWhere(query);
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 1000);
    const offset = Math.max(query.offset ?? 0, 0);
    const total = this.db.count(`SELECT COUNT(*) AS c FROM audit_logs ${whereSql}`, ...params);
    const rows = this.db.all<AuditRow>(
      `SELECT * FROM audit_logs ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    );
    return { items: rows.map(rowToEntry), total };
  }

  /** 取全量（用于导出/归档），带上限保护，避免一次性拉爆内存。 */
  queryAll(query: AuditQuery = {}, hardLimit = 100_000): AuditLogEntry[] {
    const { sql: whereSql, params } = this.buildWhere(query);
    const rows = this.db.all<AuditRow>(
      `SELECT * FROM audit_logs ${whereSql} ORDER BY id ASC LIMIT ?`,
      ...params,
      hardLimit,
    );
    return rows.map(rowToEntry);
  }

  /**
   * 校验哈希链完整性。检查分两层：
   *
   *  1. 逐行衔接：按每行自己的 hash_version 重算 curr_hash，并比对 prev_hash。
   *     能发现内容被改写、哈希被伪造、中间行被删。
   *  2. 链尾锚：把实际尾行 id / 行数 / 尾哈希与 `audit.chain_tail` 记录比对。
   *     能发现「把链尾整行删掉」这种逐行衔接检查看不见的篡改。
   *
   * 若曾执行过归档清理（purge），以清理时写入的锚点记录为起点，锚点之前的链
   * 按设计已不存在，不算断裂；清理逻辑必须保留锚点行实体（见 purge）。
   *
   * 老库（升级前写入）没有链尾锚：此时不判失败，返回 ok=true, anchored=false，
   * 并在下一次 append 时补建锚（见 writeTailAnchor）。
   */
  verifyChain(): ChainVerifyResult {
    const anchorId = this.purgeAnchorId();

    let prevHash: string | null = null;
    if (anchorId > 0) {
      const anchor = this.db.get<{ curr_hash: string | null }>(
        'SELECT curr_hash FROM audit_logs WHERE id = ?',
        anchorId,
      );
      prevHash = anchor?.curr_hash ?? null;
    }

    const rows = this.db.all<AuditRow>(
      'SELECT * FROM audit_logs WHERE id > ? ORDER BY id ASC',
      anchorId,
    );

    // ---- 第一层：逐行衔接 + 按行版本重算 ----
    // 链尾锚是否存在要在这一层之前就读出来：即使用户看到的是「某行哈希不对」，
    // anchored 也应如实反映链尾锚是否已建立，而不是因为提前 return 就变成 false。
    const tailAnchor = this.readTailAnchor();
    const anchored = tailAnchor !== null && tailAnchor !== 'malformed';

    let checked = 0;
    for (const row of rows) {
      const version = Number(row.hash_version ?? AUDIT_HASH_VERSION_V1);
      if (version !== AUDIT_HASH_VERSION_V1 && version !== AUDIT_HASH_VERSION) {
        return { ok: false, checked, brokenAt: row.id, anchored, reason: 'unknown_hash_version' };
      }
      const expected = computeAuditHash(prevHash, this.payloadOf(row), version);
      if (row.prev_hash !== prevHash) {
        return { ok: false, checked, brokenAt: row.id, anchored, reason: 'link' };
      }
      if (row.curr_hash !== expected) {
        return { ok: false, checked, brokenAt: row.id, anchored, reason: 'hash' };
      }
      prevHash = row.curr_hash;
      checked++;
    }

    // ---- 第二层：链尾锚 ----
    if (tailAnchor === null) {
      // 老库尚未建立链尾锚：只逐行校验，不能凭空判失败（升级不能报假断链）。
      return { ok: true, checked, brokenAt: null, anchored: false };
    }
    if (tailAnchor === 'malformed') {
      return { ok: false, checked, brokenAt: null, anchored: false, reason: 'anchor_malformed' };
    }

    // 实际链尾：链内最后一行；链为空（只剩 purge 锚点行）时就是锚点行本身。
    const lastInChain = rows.length > 0 ? rows[rows.length - 1] : undefined;
    const actualTail =
      lastInChain ??
      (anchorId > 0
        ? this.db.get<{ id: number; curr_hash: string | null }>(
            'SELECT id, curr_hash FROM audit_logs WHERE id = ?',
            anchorId,
          )
        : undefined);
    const actualTailId = actualTail ? Number(actualTail.id) : null;
    const actualTailHash = actualTail?.curr_hash ?? null;
    const actualCount = rows.length;

    // 尾部被删时，实际尾行会退化成前一行，MAX(id) 随之变小 —— 这里先暴露。
    const maxRow = this.db.get<{ max_id: number | bigint | null }>(
      'SELECT MAX(id) AS max_id FROM audit_logs',
    );
    const actualMaxId =
      maxRow?.max_id === null || maxRow?.max_id === undefined ? null : Number(maxRow.max_id);
    if (actualTailId === null || actualMaxId !== actualTailId || tailAnchor.id !== actualTailId) {
      return { ok: false, checked, brokenAt: actualTailId, anchored: true, reason: 'anchor_id_mismatch' };
    }
    if (tailAnchor.count !== actualCount) {
      return { ok: false, checked, brokenAt: actualTailId, anchored: true, reason: 'anchor_count_mismatch' };
    }
    if (tailAnchor.hash !== (actualTailHash ?? '')) {
      return { ok: false, checked, brokenAt: actualTailId, anchored: true, reason: 'anchor_hash_mismatch' };
    }
    return { ok: true, checked, brokenAt: null, anchored: true };
  }

  /**
   * 归档清理：删除 before 之前的记录，并保留/更新链锚点，保证后续校验仍然有效。
   *
   * 关键不变量：**锚点行必须真实存在**。verifyChain 从锚点行的 curr_hash 出发，
   * 去比对后续第一条的 prev_hash；如果连锚点行一起删掉，那个基准就没了，
   * 之后 `verifyChain()` 会永远返回断裂（这正是本方法此前的缺陷）。
   *
   * 因此清理的语义是：「过期区间里最新的那一条」作为边界被**刻意保留**下来当锚点，
   * 只删除它之前的记录。返回值是实际删除的行数（不含保留下来的锚点行）。
   * 想彻底清空时，锚点行会作为唯一的幸存者留下——这是哈希链可校验所必需的代价。
   */
  purge(before: string): number {
    return this.db.transaction(() => {
      // 过期区间里 id 最大的一条，就是清理后要保留的锚点行。
      const boundary = this.db.get<{ id: number }>(
        'SELECT id FROM audit_logs WHERE created_at < ? ORDER BY id DESC LIMIT 1',
        before,
      );
      // 没有任何过期记录：不删行、也不改动既有锚点，链保持原样。
      if (!boundary) return 0;

      // 只删锚点之前的记录，锚点行本身必须留下（见上文不变量）。
      const deleted = this.db.run('DELETE FROM audit_logs WHERE id < ?', boundary.id).changes;
      this.db.run(
        `INSERT INTO settings (key, value, category, updated_at) VALUES (?, ?, 'security', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        CHAIN_ANCHOR_SETTING,
        String(boundary.id),
        nowIso(),
      );
      // 删了行，链的行数就变了：链尾锚必须同步刷新，否则 purge 之后
      // verifyChain 会把「锚记录的行数」当成被删证据，误报断链。
      const tail = this.db.get<{ id: number; curr_hash: string | null }>(
        'SELECT id, curr_hash FROM audit_logs ORDER BY id DESC LIMIT 1',
      );
      if (tail) this.writeTailAnchor(Number(tail.id), tail.curr_hash);
      return deleted;
    });
  }

  /** CSV 列顺序（导出与流式导出共用，保证两者一致）。 */
  static readonly CSV_HEADER = [
    'id',
    'created_at',
    'username',
    'action',
    'resource_type',
    'resource_id',
    'connection_id',
    'status',
    'error_message',
    'duration_ms',
    'ip_address',
    'sql_text',
    'prev_hash',
    'curr_hash',
  ] as const;

  /** CSV 单元格转义：含逗号/引号/换行时用双引号包裹并把内部引号翻倍。 */
  static csvEscape(value: unknown): string {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  /** 把一条审计记录渲染成一行 CSV（不含换行符）。 */
  static csvLine(entry: AuditLogEntry): string {
    return [
      entry.id,
      entry.createdAt,
      entry.username,
      entry.action,
      entry.resourceType,
      entry.resourceId,
      entry.connectionId,
      entry.status,
      entry.errorMessage,
      entry.durationMs,
      entry.ipAddress,
      entry.sqlText,
      entry.prevHash,
      entry.currHash,
    ]
      .map((v) => AuditRepository.csvEscape(v))
      .join(',');
  }

  /** 导出为 CSV 文本（含哈希列，便于离线校验）。 */
  exportCsv(query: AuditQuery = {}): string {
    const items = this.queryAll(query);
    const header = [
      'id',
      'created_at',
      'username',
      'action',
      'resource_type',
      'resource_id',
      'connection_id',
      'status',
      'error_message',
      'duration_ms',
      'ip_address',
      'sql_text',
      'prev_hash',
      'curr_hash',
    ];
    const esc = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(',')];
    for (const it of items) {
      lines.push(
        [
          it.id,
          it.createdAt,
          it.username,
          it.action,
          it.resourceType,
          it.resourceId,
          it.connectionId,
          it.status,
          it.errorMessage,
          it.durationMs,
          it.ipAddress,
          it.sqlText,
          it.prevHash,
          it.currHash,
        ]
          .map(esc)
          .join(','),
      );
    }
    // 加 BOM，Excel 打开中文不乱码
    return `\uFEFF${lines.join('\r\n')}\r\n`;
  }

  exportJson(query: AuditQuery = {}): string {
    return JSON.stringify(this.queryAll(query), null, 2);
  }
}

function rowToEntry(row: AuditRow): AuditLogEntry {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    connectionId: row.connection_id,
    detail: row.detail,
    sqlText: row.sql_text,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    status: row.status,
    errorMessage: row.error_message,
    durationMs: row.duration_ms,
    prevHash: row.prev_hash,
    currHash: row.curr_hash,
    createdAt: toIso(row.created_at) ?? '',
  };
}
