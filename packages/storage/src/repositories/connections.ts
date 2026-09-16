/**
 * 花生苗数据库管理工具 - 数据库连接配置仓库
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 口令、SSH、SSL 配置一律 AES-256-GCM 加密后落库；对外 DTO 绝不包含口令。
 */

import {
  PeanutError,
  getDbTypeInfo,
  isDatabaseType,
  notFound,
  type ConnectionConfig,
  type ConnectionDTO,
  type DatabaseType,
  type SshTunnelConfig,
  type SslConfig,
} from '@peanutsprout/core';
import { decryptJson, decryptString, encryptJson, encryptString } from '../crypto.js';
import { nowIso, parseJson, toIso, type LocalDatabase } from '../database.js';
import {
  extractPasswordFromParams,
  parseQueryParams,
  redactConnectionUrl,
  safeDecode,
  stripCredentialParams,
} from '../redact.js';

// 脱敏的唯一真相来源在 `../redact.ts`；这里再导出一次，保持既有引用路径可用。
export { redactConnectionUrl };

interface ConnectionRow {
  id: number;
  name: string;
  group_id: number | null;
  db_type: string;
  host: string | null;
  port: number | null;
  database_name: string | null;
  username: string | null;
  password_enc: Uint8Array | null;
  connection_url: string | null;
  ssh_config_enc: Uint8Array | null;
  ssl_config_enc: Uint8Array | null;
  extra_params: string | null;
  color_tag: string | null;
  is_read_only: number;
  is_favorite: number;
  sort_order: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConnectionInput {
  name: string;
  dbType: DatabaseType | string;
  host?: string | null;
  port?: number | null;
  databaseName?: string | null;
  username?: string | null;
  password?: string | null;
  connectionUrl?: string | null;
  colorTag?: string | null;
  isReadOnly?: boolean;
  isFavorite?: boolean;
  groupId?: number | null;
  extraParams?: Record<string, string> | null;
  sshTunnel?: SshTunnelConfig | null;
  ssl?: SslConfig | null;
}

export interface ConnectionListFilter {
  search?: string;
  dbType?: string;
  favorite?: boolean;
  groupId?: number | null;
  limit?: number;
  offset?: number;
}

/** 输入校验 + 连接串解析（PRD 4.1「连接串 URL 直接粘贴解析」）。 */
export function normalizeConnectionInput(input: ConnectionInput): ConnectionInput {
  const name = input.name?.trim();
  if (!name) throw new PeanutError('VALIDATION_FAILED', '连接名称不能为空');
  if (!isDatabaseType(input.dbType)) {
    throw new PeanutError('VALIDATION_FAILED', `不支持的数据库类型: ${String(input.dbType)}`);
  }

  const merged: ConnectionInput = { ...input, name, dbType: input.dbType };

  // 先解析连接串：URL 是机器生成的精确输入，必须先于"默认值填充"生效。
  // 反例（修复前的真实缺陷）：mysql://u:p@h:3307/db 会先被填成默认端口 3306，
  // 随后的 `??=` 再也覆盖不了它，导致连到错误的实例却毫无提示。
  if (merged.connectionUrl) {
    const parsed = parseConnectionUrl(merged.connectionUrl);
    if (parsed) {
      merged.host ??= parsed.host ?? undefined;
      merged.port ??= parsed.port ?? undefined;
      merged.databaseName ??= parsed.databaseName ?? undefined;
      merged.username ??= parsed.username ?? undefined;
      merged.password ??= parsed.password ?? undefined;
      // 连接串里的 scheme 比表单里的下拉选择更可靠（用户常常忘了改下拉框）
      if (parsed.dbType && isDatabaseType(parsed.dbType)) merged.dbType = parsed.dbType;

      // 口令也可能写在查询串里（`?password=` / `?pwd=` ...）。
      // 它必须被当成凭据抽取出来加密落库，否则 hasPassword 会撒谎、驱动拿不到口令；
      // 同时绝不能留在 extraParams —— 那一列是明文 JSON。
      const { password: queryPassword, rest: safeParams } = extractPasswordFromParams(parsed.params);
      if (!merged.password && queryPassword) merged.password = queryPassword;
      // 查询参数（charset/ssl 等）此前被解析后直接丢弃，现并入 extraParams；
      // 显式填写的 extraParams 优先级更高。
      if (Object.keys(safeParams).length > 0) {
        merged.extraParams = { ...safeParams, ...(merged.extraParams ?? {}) };
      }
    }
    // 关键：清洗与"能否解析"**解耦**。无论 parseConnectionUrl 成功与否，
    // 这里都必须把连接串里的凭据抹掉 —— 宁可把连接串写坏一点，也不能把口令写出去。
    // 此前这行被包在 `if (parsed)` 里，口令含 '/' 时解析失败就直接原文落库。
    merged.connectionUrl = redactConnectionUrl(merged.connectionUrl);
  }

  const info = getDbTypeInfo(merged.dbType);

  if (info.networked) {
    if (!merged.connectionUrl && !merged.host) {
      throw new PeanutError('VALIDATION_FAILED', `${info.label} 需要填写主机地址或连接串`);
    }
    // 到这里仍未指定端口，才回退到该数据库的默认端口
    if (merged.port === undefined || merged.port === null || merged.port === 0) {
      merged.port = info.defaultPort;
    }
    if (merged.port !== null && (merged.port < 1 || merged.port > 65535)) {
      throw new PeanutError('VALIDATION_FAILED', `端口非法: ${String(merged.port)}`);
    }
  } else {
    // 文件型数据库（SQLite）用 databaseName 存文件路径
    if (!merged.databaseName && !merged.connectionUrl) {
      throw new PeanutError('VALIDATION_FAILED', `${info.label} 需要填写数据库文件路径`);
    }
    merged.port = null;
    merged.host = null;
  }

  return merged;
}

export interface ParsedConnectionUrl {
  dbType: string | null;
  host: string | null;
  port: number | null;
  databaseName: string | null;
  username: string | null;
  password: string | null;
  params: Record<string, string>;
}

/** scheme → 数据库类型。手工回退解析与 WHATWG 解析共用，避免两份表漂移。 */
const URL_SCHEME_MAP: Record<string, string> = {
  mysql: 'mysql',
  mariadb: 'mariadb',
  postgres: 'postgresql',
  postgresql: 'postgresql',
  kingbase8: 'kingbase',
  dm: 'dm',
  oracle: 'oracle',
  sqlserver: 'sqlserver',
  mssql: 'sqlserver',
  tidb: 'tidb',
  redis: 'redis',
  mongodb: 'mongodb',
  mongodb_srv: 'mongodb',
  clickhouse: 'clickhouse',
  http: 'clickhouse',
  https: 'clickhouse',
  influxdb: 'influxdb',
  neo4j: 'neo4j',
  bolt: 'neo4j',
  file: 'sqlite',
  sqlite: 'sqlite',
};

/**
 * 不依赖 `new URL()` 的尽力解析。
 *
 * `new URL()` 对两类**真实用户输入**会直接抛错：口令含 `/`、
 * 以及不带 scheme 的 DSN（`user:pass@host/db`）。此前这种情况一律返回 null，
 * 于是口令既没被抽出来（hasPassword=false），脱敏也被跳过。
 * 这里手工拆一遍：能抽多少抽多少，抽不出来也至少保证字段为 null 而不是丢给"原文回传"。
 */
function parseConnectionUrlManually(trimmed: string): ParsedConnectionUrl | null {
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(trimmed);
  const scheme = schemeMatch?.[1]?.toLowerCase() ?? null;
  let rest = schemeMatch ? trimmed.slice(schemeMatch[0].length) : trimmed;
  // 没有 scheme 时至少要含 '@' 才当作 DSN，避免把普通字符串误判成连接串
  if (!schemeMatch && !rest.includes('@')) return null;

  let fragment = '';
  const hashIdx = rest.indexOf('#');
  if (hashIdx >= 0) {
    fragment = rest.slice(hashIdx);
    rest = rest.slice(0, hashIdx);
  }
  let rawQuery = '';
  const queryIdx = rest.indexOf('?');
  if (queryIdx >= 0) {
    rawQuery = rest.slice(queryIdx + 1);
    rest = rest.slice(0, queryIdx);
  }

  // userinfo 取最后一个 '@'：口令里可能含 '/' 甚至 '@'
  const at = rest.lastIndexOf('@');
  const userinfo = at >= 0 ? rest.slice(0, at) : '';
  const hostAndPath = at >= 0 ? rest.slice(at + 1) : rest;

  let username: string | null = null;
  let password: string | null = null;
  if (userinfo) {
    const colon = userinfo.indexOf(':');
    if (colon >= 0) {
      username = safeDecode(userinfo.slice(0, colon)) || null;
      password = safeDecode(userinfo.slice(colon + 1)) || null;
    } else {
      username = safeDecode(userinfo) || null;
    }
  }

  const slashIdx = hostAndPath.indexOf('/');
  const authority = slashIdx >= 0 ? hostAndPath.slice(0, slashIdx) : hostAndPath;
  const rawPath = slashIdx >= 0 ? hostAndPath.slice(slashIdx) : '';

  // IPv6 主机用 [] 包裹，端口在 ']' 之后
  let host = '';
  let port: number | null = null;
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']');
    if (end >= 0) {
      host = authority.slice(0, end + 1);
      const tail = authority.slice(end + 1);
      if (tail.startsWith(':') && /^\d+$/.test(tail.slice(1))) port = Number(tail.slice(1));
    } else {
      host = authority;
    }
  } else {
    const colon = authority.lastIndexOf(':');
    if (colon >= 0 && /^\d+$/.test(authority.slice(colon + 1))) {
      host = authority.slice(0, colon);
      port = Number(authority.slice(colon + 1));
    } else {
      host = authority;
    }
  }

  // 文件型数据库的路径必须保留前导斜杠（sqlite:///tmp/a.db）
  const isFileScheme = scheme === 'file' || scheme === 'sqlite';
  const databaseName = isFileScheme
    ? safeDecode(rawPath) || null
    : safeDecode(rawPath.replace(/^\//, '')) || null;

  return {
    dbType: scheme ? (URL_SCHEME_MAP[scheme] ?? null) : null,
    host: host || null,
    port,
    databaseName,
    username,
    password,
    params: parseQueryParams(rawQuery),
  };
}

export function parseConnectionUrl(raw: string): ParsedConnectionUrl | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.includes('://')) {
    try {
      const url = new URL(trimmed);
      const scheme = url.protocol.replace(':', '').toLowerCase();
      const params: Record<string, string> = {};
      url.searchParams.forEach((v, k) => {
        params[k] = v;
      });

      // 文件型数据库的路径必须保留前导斜杠，否则 `sqlite:///tmp/a.db`
      // 会被解析成相对路径 `tmp/a.db`，导入后指向完全错误的位置。
      const isFileScheme = scheme === 'file' || scheme === 'sqlite';
      const dbName = isFileScheme
        ? url.hostname && url.hostname !== 'localhost'
          ? `//${url.hostname}${url.pathname}`
          : url.pathname
        : url.pathname.replace(/^\//, '');

      return {
        dbType: URL_SCHEME_MAP[scheme] ?? null,
        host: url.hostname || null,
        port: url.port ? Number(url.port) : null,
        databaseName: dbName ? decodeURIComponent(dbName) : null,
        username: url.username ? decodeURIComponent(url.username) : null,
        password: url.password ? decodeURIComponent(url.password) : null,
        params,
      };
    } catch {
      // 落到手工解析（典型：口令含 '/' 让 WHATWG 解析失败）
    }
  }
  // 无 scheme 的 DSN（user:pass@host/db）也走手工解析：只有含 '@' 才认。
  return trimmed.includes('@') ? parseConnectionUrlManually(trimmed) : null;
}

export class ConnectionRepository {
  constructor(
    private readonly db: LocalDatabase,
    private readonly key: Buffer,
  ) {}

  private toDTO(row: ConnectionRow): ConnectionDTO {
    return {
      id: row.id,
      name: row.name,
      groupId: row.group_id,
      dbType: row.db_type as DatabaseType,
      host: row.host,
      port: row.port === null ? null : Number(row.port),
      databaseName: row.database_name,
      username: row.username,
      hasPassword: row.password_enc !== null && row.password_enc !== undefined,
      // 再清洗一次：本改动之前落库的连接串里可能仍带着明文口令
      connectionUrl: redactConnectionUrl(row.connection_url),
      colorTag: row.color_tag,
      isReadOnly: Number(row.is_read_only) === 1,
      isFavorite: Number(row.is_favorite) === 1,
      lastUsedAt: toIso(row.last_used_at),
      createdAt: toIso(row.created_at) ?? '',
      updatedAt: toIso(row.updated_at) ?? '',
    };
  }

  create(input: ConnectionInput): ConnectionDTO {
    const v = normalizeConnectionInput(input);
    const id = this.db.transaction(() => {
      const r = this.db.run(
        `INSERT INTO connections
           (name, group_id, db_type, host, port, database_name, username, password_enc,
            connection_url, ssh_config_enc, ssl_config_enc, extra_params, color_tag,
            is_read_only, is_favorite)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        v.name,
        v.groupId ?? null,
        String(v.dbType),
        v.host ?? null,
        v.port ?? null,
        v.databaseName ?? null,
        v.username ?? null,
        v.password ? encryptString(v.password, this.key) : null,
        v.connectionUrl ?? null,
        v.sshTunnel ? encryptJson(v.sshTunnel, this.key) : null,
        v.ssl ? encryptJson(v.ssl, this.key) : null,
        v.extraParams ? JSON.stringify(v.extraParams) : null,
        v.colorTag ?? null,
        v.isReadOnly ? 1 : 0,
        v.isFavorite ? 1 : 0,
      );
      return r.lastInsertRowid;
    });
    return this.get(id) as ConnectionDTO;
  }

  get(id: number): ConnectionDTO | null {
    const row = this.db.get<ConnectionRow>('SELECT * FROM connections WHERE id = ?', id);
    return row ? this.toDTO(row) : null;
  }

  /** 领域层配置：包含**已解密**的口令，仅供驱动建立连接时短暂使用。 */
  getConfig(id: number): ConnectionConfig | null {
    const row = this.db.get<ConnectionRow>('SELECT * FROM connections WHERE id = ?', id);
    if (!row) return null;
    return this.rowToConfig(row);
  }

  private rowToConfig(row: ConnectionRow): ConnectionConfig {
    // 历史遗留的脏数据里 connection_url 可能仍带明文口令。
    // 交给驱动前先清洗（驱动那些 `无法解析连接串: <原文>` 的错误文案就会是安全的），
    // 但为了不打断连接：若 password_enc 为空，就从旧 URL 里把口令兜出来。
    const storedUrl = row.connection_url;
    const parsedStored = storedUrl ? parseConnectionUrl(storedUrl) : null;
    const fallbackPassword = parsedStored
      ? (parsedStored.password ?? extractPasswordFromParams(parsedStored.params).password)
      : null;
    return {
      id: row.id,
      name: row.name,
      dbType: row.db_type as DatabaseType,
      host: row.host,
      port: row.port === null ? null : Number(row.port),
      databaseName: row.database_name,
      username: row.username,
      password: decryptString(row.password_enc, this.key) ?? fallbackPassword,
      connectionUrl: redactConnectionUrl(storedUrl),
      sshTunnel: decryptJson<SshTunnelConfig>(row.ssh_config_enc, this.key),
      ssl: decryptJson<SslConfig>(row.ssl_config_enc, this.key),
      extraParams: stripCredentialParams(parseJson<Record<string, string> | null>(row.extra_params, null)),
      readOnly: Number(row.is_read_only) === 1,
      colorTag: row.color_tag,
    };
  }

  list(filter: ConnectionListFilter = {}): ConnectionDTO[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (filter.search && filter.search.trim()) {
      where.push('(name LIKE ? OR host LIKE ? OR database_name LIKE ? OR username LIKE ?)');
      const like = `%${filter.search.trim()}%`;
      params.push(like, like, like, like);
    }
    if (filter.dbType) {
      where.push('db_type = ?');
      params.push(filter.dbType);
    }
    if (filter.favorite) where.push('is_favorite = 1');
    if (filter.groupId !== undefined && filter.groupId !== null) {
      where.push('group_id = ?');
      params.push(filter.groupId);
    }
    const limit = Math.min(Math.max(filter.limit ?? 500, 1), 2000);
    const offset = Math.max(filter.offset ?? 0, 0);
    const sql = `SELECT * FROM connections
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY is_favorite DESC, sort_order ASC, id ASC
      LIMIT ? OFFSET ?`;
    return this.db.all<ConnectionRow>(sql, ...params, limit, offset).map((r) => this.toDTO(r));
  }

  count(filter: ConnectionListFilter = {}): number {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (filter.search && filter.search.trim()) {
      where.push('(name LIKE ? OR host LIKE ? OR database_name LIKE ? OR username LIKE ?)');
      const like = `%${filter.search.trim()}%`;
      params.push(like, like, like, like);
    }
    if (filter.dbType) {
      where.push('db_type = ?');
      params.push(filter.dbType);
    }
    return this.db.count(
      `SELECT COUNT(*) AS c FROM connections ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
      ...params,
    );
  }

  update(id: number, patch: Partial<ConnectionInput>): ConnectionDTO {
    const current = this.db.get<ConnectionRow>('SELECT * FROM connections WHERE id = ?', id);
    if (!current) throw notFound('连接', id);

    // 先合并成完整输入再校验，保证「只改端口」这类局部更新也走同一套规则
    const currentConfig = this.rowToConfig(current);
    const merged: ConnectionInput = normalizeConnectionInput({
      name: patch.name ?? currentConfig.name,
      dbType: patch.dbType ?? currentConfig.dbType,
      host: patch.host !== undefined ? patch.host : currentConfig.host,
      port: patch.port !== undefined ? patch.port : currentConfig.port,
      databaseName: patch.databaseName !== undefined ? patch.databaseName : currentConfig.databaseName,
      username: patch.username !== undefined ? patch.username : currentConfig.username,
      connectionUrl: patch.connectionUrl !== undefined ? patch.connectionUrl : currentConfig.connectionUrl,
      colorTag: patch.colorTag !== undefined ? patch.colorTag : currentConfig.colorTag,
      isReadOnly: patch.isReadOnly ?? currentConfig.readOnly,
      isFavorite: patch.isFavorite ?? Number(current.is_favorite) === 1,
      groupId: patch.groupId !== undefined ? patch.groupId : current.group_id,
      extraParams: patch.extraParams !== undefined ? patch.extraParams : currentConfig.extraParams,
      sshTunnel: patch.sshTunnel !== undefined ? patch.sshTunnel : currentConfig.sshTunnel,
      ssl: patch.ssl !== undefined ? patch.ssl : currentConfig.ssl,
    });

    // 口令三态：undefined=不变，''=清空，非空=替换。
    // 例外：本次**重新粘贴了连接串**且其中带口令时，用连接串里抽出来的口令，
    // 否则「粘贴新连接串」会静默丢掉口令（hasPassword 撒谎、驱动连不上）。
    const passwordEnc =
      patch.password === undefined
        ? patch.connectionUrl !== undefined && merged.password
          ? encryptString(merged.password, this.key)
          : (current.password_enc as Uint8Array | null)
        : patch.password === ''
          ? null
          : encryptString(patch.password as string, this.key);

    this.db.run(
      `UPDATE connections SET
         name = ?, group_id = ?, db_type = ?, host = ?, port = ?, database_name = ?,
         username = ?, password_enc = ?, connection_url = ?, ssh_config_enc = ?, ssl_config_enc = ?,
         extra_params = ?, color_tag = ?, is_read_only = ?, is_favorite = ?
       WHERE id = ?`,
      merged.name,
      merged.groupId ?? null,
      String(merged.dbType),
      merged.host ?? null,
      merged.port ?? null,
      merged.databaseName ?? null,
      merged.username ?? null,
      passwordEnc,
      merged.connectionUrl ?? null,
      merged.sshTunnel ? encryptJson(merged.sshTunnel, this.key) : null,
      merged.ssl ? encryptJson(merged.ssl, this.key) : null,
      merged.extraParams ? JSON.stringify(merged.extraParams) : null,
      merged.colorTag ?? null,
      merged.isReadOnly ? 1 : 0,
      merged.isFavorite ? 1 : 0,
      id,
    );
    return this.get(id) as ConnectionDTO;
  }

  delete(id: number): boolean {
    return this.db.run('DELETE FROM connections WHERE id = ?', id).changes > 0;
  }

  markUsed(id: number): void {
    this.db.run('UPDATE connections SET last_used_at = ? WHERE id = ?', nowIso(), id);
  }

  toggleFavorite(id: number, favorite: boolean): ConnectionDTO {
    this.db.run('UPDATE connections SET is_favorite = ? WHERE id = ?', favorite ? 1 : 0, id);
    const dto = this.get(id);
    if (!dto) throw notFound('连接', id);
    return dto;
  }

  // ------------------------------------------------------------ 分组

  listGroups(): Array<{ id: number; name: string; parentId: number | null; sortOrder: number }> {
    return this.db
      .all<{ id: number; name: string; parent_id: number | null; sort_order: number }>(
        'SELECT id, name, parent_id, sort_order FROM connection_groups ORDER BY sort_order, id',
      )
      .map((r) => ({ id: r.id, name: r.name, parentId: r.parent_id, sortOrder: Number(r.sort_order) }));
  }

  createGroup(name: string, parentId: number | null = null): number {
    const trimmed = name?.trim();
    if (!trimmed) throw new PeanutError('VALIDATION_FAILED', '分组名称不能为空');
    return this.db.run(
      'INSERT INTO connection_groups (name, parent_id) VALUES (?, ?)',
      trimmed,
      parentId,
    ).lastInsertRowid;
  }

  deleteGroup(id: number): boolean {
    return this.db.run('DELETE FROM connection_groups WHERE id = ?', id).changes > 0;
  }
}
