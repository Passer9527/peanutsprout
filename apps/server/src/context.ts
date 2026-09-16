/**
 * 花生苗数据库管理工具 - 服务端运行时上下文
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  ConnectionManager,
  createDefaultRegistry,
  type DriverRegistry,
} from '@peanutsprout/drivers';
import { AuthService } from '@peanutsprout/auth';
import { AiService } from '@peanutsprout/ai';
import { MigrationEngine, MigrationService } from '@peanutsprout/migration';
import { ensureAdminUser, openPeanutDatabase, type PeanutDatabase } from '@peanutsprout/storage';
import type { ServerConfig } from './config.js';

export interface AppContext {
  config: ServerConfig;
  pdb: PeanutDatabase;
  auth: AuthService;
  registry: DriverRegistry;
  manager: ConnectionManager;
  /** AI 助手（未配置模型时调用会抛 AI_PROVIDER_ERROR，界面据此引导配置） */
  ai: AiService;
  /** 数据迁移任务（引擎 + 落库报告） */
  migration: MigrationService;
  /** 首次启动是否创建了管理员，以及初始口令（仅内存中保留一次） */
  bootstrap: { created: boolean; username: string; initialPassword: string | null };
  /**
   * 空闲会话回收定时器（`config.idleConnectionMs > 0` 时存在）。
   * 必须在 disposeContext 里 clearInterval，否则测试进程会被它拖住不退出。
   */
  idleReaper: NodeJS.Timeout | null;
  startedAt: number;
}

export interface CreateContextOptions {
  config: ServerConfig;
  /** 内存库（测试） */
  memory?: boolean;
  dbPath?: string;
}

export function createContext(options: CreateContextOptions): AppContext {
  const { config } = options;
  const pdb = openPeanutDatabase({
    dataDir: config.dataDir,
    masterPassword: config.masterPassword,
    ...(options.memory ? { memory: true } : {}),
    ...(options.dbPath ? { dbPath: options.dbPath } : {}),
  });

  const bootstrap = ensureAdminUser(pdb, {
    username: config.bootstrapAdminUsername,
    ...(config.bootstrapAdminPassword ? { password: config.bootstrapAdminPassword } : {}),
  });

  const registry = createDefaultRegistry();
  const manager = new ConnectionManager(registry);
  // 长连接守护：ConnectionManager 会按连接 id 永久缓存会话，
  // 没有这一步的话，访问过 N 个连接就会一直持有 N 条数据库会话/连接池/SSH 隧道，
  // config.idleConnectionMs（默认 30 分钟）形同虚设 —— 它此前从未被任何代码读取。
  const idleReaper =
    config.idleConnectionMs > 0
      ? setInterval(() => {
          void manager.releaseIdle(config.idleConnectionMs).catch(() => undefined);
        }, Math.max(1000, Math.floor(config.idleConnectionMs / 4)))
      : null;
  // unref：回收器不应阻止进程退出（服务端正常关闭另有 disposeContext 负责）
  idleReaper?.unref?.();
  const auth = new AuthService(pdb, { tokenTtlSec: config.tokenTtlSec });

  const ai = new AiService({ pdb });
  const migration = new MigrationService(
    pdb,
    new MigrationEngine({
      resolveDriver: (dbType) => registry.require(dbType),
      resolveConfig: (id) => pdb.connections.getConfig(id),
    }),
  );

  // 启动本身也要留痕，便于排查"谁在什么时候启过服务"
  pdb.audit.append({
    userId: null,
    username: 'system',
    action: 'settings_update',
    resourceType: 'system',
    resourceId: 'server_start',
    status: 'success',
    detail: {
      port: config.port,
      schemaVersion: pdb.init.schemaVersion,
      appliedMigrations: pdb.init.applied,
      driverImplemented: registry.implementedTypes(),
    },
  });

  return {
    config,
    pdb,
    auth,
    registry,
    manager,
    ai,
    migration,
    bootstrap,
    idleReaper,
    startedAt: Date.now(),
  };
}

export async function disposeContext(ctx: AppContext): Promise<void> {
  if (ctx.idleReaper) {
    clearInterval(ctx.idleReaper);
    ctx.idleReaper = null;
  }
  await ctx.manager.releaseAll().catch(() => undefined);
  // 关闭前再记一条，保证审计链完整覆盖进程生命周期
  try {
    ctx.pdb.audit.append({
      userId: null,
      username: 'system',
      action: 'settings_update',
      resourceType: 'system',
      resourceId: 'server_stop',
      status: 'success',
      detail: { uptimeMs: Date.now() - ctx.startedAt },
    });
  } catch {
    /* 关闭阶段不再抛错 */
  }
  ctx.pdb.close();
}
