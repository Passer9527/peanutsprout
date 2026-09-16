/**
 * 花生苗数据库管理工具 - 存储层入口
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 一个进程只应存在一个 PeanutDatabase 实例（SQLite 单写者模型）。
 */

import {
  ensureDataDir,
  resolveDataDir,
  resolveDbPath,
  resolveMasterKeyPath,
} from '@peanutsprout/core';
import { randomBytes } from 'node:crypto';
import { hashSecret, loadMasterKey, type MasterKeyMode } from './crypto.js';
import { LocalDatabase } from './database.js';
import { initializeSchema, type InitResult } from './schema/migrations.js';
import { UserRepository } from './repositories/users.js';
import { ConnectionRepository } from './repositories/connections.js';
import { AuditRepository } from './repositories/audit.js';
import { SessionRepository, SettingsRepository } from './repositories/sessions-settings.js';
import { QueryHistoryRepository } from './repositories/query-history.js';
import { AiConfigRepository } from './repositories/ai-configs.js';
import { ChartRepository, DashboardRepository } from './repositories/charts.js';

export * from './crypto.js';
export * from './database.js';
export * from './schema/ddl.js';
export * from './schema/migrations.js';
export * from './repositories/users.js';
export * from './repositories/connections.js';
export * from './repositories/audit.js';
export * from './repositories/sessions-settings.js';
export * from './repositories/query-history.js';
export * from './repositories/ai-configs.js';
export * from './repositories/charts.js';

export interface PeanutDatabaseOptions {
  dataDir?: string;
  dbPath?: string;
  /** 内存库（测试用），不落盘、不生成主密钥文件 */
  memory?: boolean;
  /** 主密钥的主密码；未设置时明文模式（0600 文件） */
  masterPassword?: string | null;
}

/** 本地库门面：数据库连接 + 解密主密钥 + 各仓库。 */
export class PeanutDatabase {
  readonly db: LocalDatabase;
  readonly users: UserRepository;
  readonly connections: ConnectionRepository;
  readonly audit: AuditRepository;
  readonly sessions: SessionRepository;
  readonly settings: SettingsRepository;
  readonly queryHistory: QueryHistoryRepository;
  readonly aiConfigs: AiConfigRepository;
  readonly charts: ChartRepository;
  readonly dashboards: DashboardRepository;
  readonly init: InitResult;
  readonly masterKeyMode: MasterKeyMode;
  readonly dbPath: string;

  /** 主密钥。加密字段的解密都依赖它，不对外暴露写权限。 */
  private readonly masterKey: Buffer;

  constructor(options: PeanutDatabaseOptions = {}) {
    const dataDir = options.dataDir ?? resolveDataDir();
    if (!options.memory) ensureDataDir(dataDir);

    this.db = new LocalDatabase({
      memory: options.memory,
      ...(options.dbPath ? { dbPath: options.dbPath } : {}),
      dataDir,
    });
    this.dbPath = this.db.path;

    if (options.memory) {
      this.masterKey = randomBytes(32);
      this.masterKeyMode = 'plain';
    } else {
      const unlocked = loadMasterKey(resolveMasterKeyPath(dataDir), options.masterPassword ?? null);
      this.masterKey = unlocked.key;
      this.masterKeyMode = unlocked.mode;
    }

    this.init = initializeSchema(this.db);

    this.users = new UserRepository(this.db);
    this.connections = new ConnectionRepository(this.db, this.masterKey);
    this.audit = new AuditRepository(this.db);
    this.sessions = new SessionRepository(this.db);
    this.settings = new SettingsRepository(this.db);
    this.queryHistory = new QueryHistoryRepository(this.db);
    this.aiConfigs = new AiConfigRepository(this.db, this.masterKey);
    this.charts = new ChartRepository(this.db);
    this.dashboards = new DashboardRepository(this.db);

    // 打开数据库时就把老库的全局「强制改密」键迁移成按用户的标记。
    // 放在这里而不是只放在 ensureAdminUser：已有库不会再走"首次引导"分支，
    // 那样升级后闸门会因为读不到本用户的键而静默失效（实测过）。
    migrateLegacyMustChangePassword(this);
  }

  /** 供驱动/迁移等需要使用主密钥做字段加密的模块调用。 */
  getKey(): Buffer {
    return this.masterKey;
  }

  close(): void {
    this.db.close();
  }
}

export function openPeanutDatabase(options: PeanutDatabaseOptions = {}): PeanutDatabase {
  return new PeanutDatabase(options);
}

export interface EnsureAdminResult {
  created: boolean;
  username: string;
  /** 仅在本次创建时返回明文初始口令，用于首启提示；后续无法再取回 */
  initialPassword: string | null;
}

/**
 * 首次引导管理员的**默认口令**。
 *
 * 这里刻意用固定值而不是随机值：需求方明确要求「默认用户名 admin、默认密码 123456」，
 * 以便安装后无需翻找首启日志即可登录。
 *
 * 安全代价是已知且被接受的：这个口令很弱，因此引导时会同时置
 * `security.must_change_password = true`，强制首次登录后立即改密。
 * 若部署方希望恢复随机口令，设置环境变量 `PEANUTSPROUT_ADMIN_PASSWORD`
 * （或 CLI 的 `--password-stdin`）即可覆盖本默认值。
 */
export const DEFAULT_ADMIN_USERNAME = 'admin';
export const DEFAULT_ADMIN_PASSWORD = '123456';

/**
 * 「仍在使用内置默认口令、必须先改密」这个标记，按**用户**存。
 *
 * 为什么不能只用全局键（`security.must_change_password`）：
 * 那个键的含义其实是"**引导管理员**还在用默认口令"，但全局键只有一个。
 * 实测过的真实缺陷：任意其它用户修改自己的口令时也会把它清成 false，
 * 于是"默认口令的 admin"被别人的一次改密顺带解除了强制改密 —— 闸门形同虚设。
 * 改为按用户存之后，每个用户的标记只由他自己的改密动作清除。
 *
 * 兼容：老库里只有全局键。启动时会把全局键迁移成本用户的标记（见 ensureAdminUser），
 * 并继续镜像维护全局键，供 `pnpm verify` 之类的"整机体检"读取。
 */
export function mustChangePasswordKey(userId: number): string {
  return `security.must_change_password.${userId}`;
}

/**
 * 读取某个用户是否处于「必须先改密」状态。
 *
 * 兜底：老库只有全局键，且升级后未必立刻走过迁移（例如只跑 `pnpm verify`
 * 而不启动服务）。此时若本用户没有按用户的标记，就退回读全局键 ——
 * 但**只对管理员生效**，否则全局键会把"管理员还没改密"错误地传染给所有普通用户。
 */
export function readMustChangePassword(pdb: PeanutDatabase, userId: number): boolean {
  const per = pdb.settings.get(mustChangePasswordKey(userId));
  if (per !== null) return per === 'true';
  if (pdb.settings.get('security.must_change_password') !== 'true') return false;
  return pdb.users.findById(userId)?.isAdmin === true;
}

/**
 * 把老库的全局「强制改密」键迁移成按用户的标记（幂等）。
 *
 * 刻意独立成一个函数并在**打开数据库时**调用，而不是塞在 `ensureAdminUser` 里：
 * 只在"首次引导"路径迁移是不够的 —— 已有库永远不会再走那条分支，
 * 于是升级后闸门会因为读不到本用户的键而静默失效（实测过）。
 */
export function migrateLegacyMustChangePassword(pdb: PeanutDatabase): boolean {
  if (pdb.settings.get('security.must_change_password') !== 'true') return false;
  const admin = pdb.users.findByUsername(DEFAULT_ADMIN_USERNAME);
  if (!admin) return false;
  if (pdb.settings.get(mustChangePasswordKey(admin.id)) !== null) return false;
  pdb.settings.set(mustChangePasswordKey(admin.id), 'true', 'security');
  return true;
}

/**
 * 设置某个用户的「必须先改密」标记。
 *
 * 同时镜像全局键：全局键只反映**管理员**的状态（verify 的体检项按它提示），
 * 非管理员用户不参与镜像，避免再次出现"别人的状态覆盖管理员状态"的问题。
 */
export function writeMustChangePassword(
  pdb: PeanutDatabase,
  userId: number,
  required: boolean,
  options: { mirrorGlobal?: boolean } = {},
): void {
  pdb.settings.set(mustChangePasswordKey(userId), required ? 'true' : 'false', 'security');
  if (options.mirrorGlobal !== false) {
    const admin = pdb.users.findByUsername(DEFAULT_ADMIN_USERNAME);
    if (admin && admin.id === userId) {
      pdb.settings.set('security.must_change_password', required ? 'true' : 'false', 'security');
    }
  }
}

/**
 * 首次启动时创建管理员账号（PRD 5.3 首次启动完成初始化）。
 * 已存在任意用户时不做任何事，避免覆盖生产库里的账号。
 */
export function ensureAdminUser(
  pdb: PeanutDatabase,
  options: { username?: string; password?: string } = {},
): EnsureAdminResult {
  const username = (options.username ?? DEFAULT_ADMIN_USERNAME).trim();
  if (pdb.users.count() > 0) {
    // 老库只有全局键 `security.must_change_password`。把它迁移成"按用户"的标记，
    // 否则升级后闸门会因为读不到本用户的键而失效（等于悄悄关掉了强制改密）。
    // 迁移是幂等的：只在"全局键为 true 且本用户还没有标记"时写一次。
    migrateLegacyMustChangePassword(pdb);
    return { created: false, username, initialPassword: null };
  }
  const password = options.password ?? DEFAULT_ADMIN_PASSWORD;
  pdb.users.create({
    username,
    passwordHash: hashSecret(password),
    displayName: '系统管理员',
    isAdmin: true,
    roles: ['admin'],
  });
  // 只有**真的用了内置默认口令**才要求强制改密。
  // 旧实现无条件写 'true'，于是部署方明明通过 PEANUTSPROUT_ADMIN_PASSWORD
  // 设了强口令、仍被要求改密 —— 一个说不通的提示会让这个开关失去意义。
  const admin = pdb.users.findByUsername(username);
  if (!admin) throw new Error('管理员创建后未能读取，数据可能损坏');
  writeMustChangePassword(pdb, admin.id, password === DEFAULT_ADMIN_PASSWORD);
  return { created: true, username, initialPassword: password };
}
