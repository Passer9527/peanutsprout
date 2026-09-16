/**
 * 花生苗数据库管理工具 - 连接管理器测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 重点验证 `acquire` 的并发竞态：旧实现「查 map → await connect → set」
 * 在 await 处会让并发首连各建一条连接，后者覆盖前者、前者永不关闭。
 */

import {
  DEFAULT_CAPABILITIES,
  getDbTypeInfo,
  type ConnectionConfig,
  type DatabaseDriver,
  type DatabaseType,
  type DbTypeInfo,
  type DriverConnection,
} from '@peanutsprout/core';
import { describe, expect, it } from 'vitest';
import { ConnectionManager, DriverRegistry } from './registry.js';

interface FakeConn {
  id: string;
  closed: boolean;
  close(): Promise<void>;
}

/** 构造一个只关心 connect 次数的假驱动。 */
function fakeDriver(connectDelayMs = 20): {
  driver: DatabaseDriver;
  connects: ConnectionConfig[];
  conns: FakeConn[];
} {
  const connects: ConnectionConfig[] = [];
  const conns: FakeConn[] = [];
  const driver: DatabaseDriver = {
    dbType: 'sqlite' as DatabaseType,
    name: 'fake',
    version: '0.0.0',
    implemented: true,
    capabilities: { ...DEFAULT_CAPABILITIES },
    getInfo: (): DbTypeInfo => getDbTypeInfo('sqlite'),
    connect: async (config: ConnectionConfig): Promise<DriverConnection> => {
      connects.push(config);
      await new Promise((resolve) => setTimeout(resolve, connectDelayMs));
      const conn: FakeConn = {
        id: `fake-${connects.length}`,
        closed: false,
        close: async () => {
          conn.closed = true;
        },
      };
      conns.push(conn);
      return conn as unknown as DriverConnection;
    },
    testConnection: async () => ({ ok: true, latencyMs: 0, serverVersion: null, message: 'ok' }),
  };
  return { driver, connects, conns };
}

function config(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 1,
    name: 'fake',
    dbType: 'sqlite',
    databaseName: ':memory:',
    readOnly: false,
    ...overrides,
  } as ConnectionConfig;
}

function managerWith(driver: DatabaseDriver): ConnectionManager {
  const registry = new DriverRegistry();
  registry.register(driver);
  return new ConnectionManager(registry);
}

describe('ConnectionManager.acquire 并发竞态', () => {
  it('并发首连只建立一条连接，且两个调用拿到同一个会话', async () => {
    const { driver, connects, conns } = fakeDriver();
    const manager = managerWith(driver);

    const [a, b] = await Promise.all([manager.acquire(config()), manager.acquire(config())]);

    expect(connects).toHaveLength(1);
    expect(conns).toHaveLength(1);
    expect(a).toBe(b);
    expect(manager.size).toBe(1);
  });

  it('10 个并发 acquire 也只建一条连接（旧实现会建 10 条并泄漏 9 条）', async () => {
    const { driver, connects } = fakeDriver(30);
    const manager = managerWith(driver);

    const all = await Promise.all(Array.from({ length: 10 }, () => manager.acquire(config())));
    expect(connects).toHaveLength(1);
    expect(new Set(all).size).toBe(1);
  });

  it('连接失败后不缓存失败 Promise，下一次 acquire 会重试', async () => {
    const { driver } = fakeDriver();
    let failNext = true;
    const flaky: DatabaseDriver = {
      ...driver,
      connect: async (cfg) => {
        if (failNext) {
          failNext = false;
          throw new Error('第一次连接失败');
        }
        return driver.connect(cfg);
      },
    };
    const manager = managerWith(flaky);

    await expect(manager.acquire(config())).rejects.toThrow();
    const conn = await manager.acquire(config());
    expect(conn).toBeTruthy();
    expect(manager.size).toBe(1);
    await manager.release(1);
  });

  it('只读标记变化时丢弃旧会话，重新建立连接', async () => {
    const { driver, connects, conns } = fakeDriver(0);
    const manager = managerWith(driver);

    await manager.acquire(config({ readOnly: false }));
    await manager.acquire(config({ readOnly: true }));

    expect(connects).toHaveLength(2);
    expect(conns[0]?.closed).toBe(true);
    expect(manager.size).toBe(1);
    await manager.releaseAll();
  });
});
