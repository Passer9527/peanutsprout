/**
 * 花生苗数据库管理工具 - 迁移任务服务测试（并发/锁回归）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 覆盖缺陷回归：同一任务/同一目标表可并发迁移，且没有任何状态与锁保护。
 * 这里用可控的假引擎精确复现"两个 start 同时进行中"的窗口，避免依赖真实数据库时序。
 */

import { PeanutError, type MigrationRequest } from '@peanutsprout/core';
import { PeanutDatabase } from '@peanutsprout/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MigrationEngine, MigrationOutcome, TableMigrationReport } from './engine.js';
import { MigrationService } from './service.js';

let pdb: PeanutDatabase;

beforeEach(() => {
  pdb = new PeanutDatabase({ memory: true });
  // migrations 对 users 与 connections 都有外键，先准备最小可用数据
  pdb.db.run("INSERT INTO users (username, password_hash) VALUES ('u1', 'x')");
  pdb.db.run("INSERT INTO connections (id, name, db_type) VALUES (1, 'src', 'sqlite'), (2, 'dst', 'sqlite')");
});

afterEach(() => {
  pdb.close();
});

function request(overrides: Partial<MigrationRequest> = {}): MigrationRequest {
  return {
    userId: 1,
    sourceConnectionId: 1,
    targetConnectionId: 2,
    sourceSchema: 'main',
    targetSchema: 'main',
    tables: ['users'],
    mode: 'full',
    includeStructure: true,
    includeData: true,
    ...overrides,
  };
}

function outcome(status: MigrationOutcome['status'], tables: TableMigrationReport[] = []): MigrationOutcome {
  return {
    migrationId: '1',
    status,
    totalRows: 0,
    successRows: 0,
    failedRows: 0,
    skippedRows: 0,
    startedAt: null,
    finishedAt: null,
    errors: [],
    tables,
  };
}

/** 用假引擎构造 service；假引擎只实现 service 实际用到的方法。 */
function serviceWith(engine: {
  migrate: (request: MigrationRequest, onProgress?: unknown) => Promise<MigrationOutcome>;
  cancel?: (id: string) => void;
}): MigrationService {
  return new MigrationService(pdb, engine as unknown as MigrationEngine);
}

describe('并发保护（缺陷回归）', () => {
  it('并发启动同一任务只能有一个成功', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = serviceWith({
      migrate: async () => {
        await gate;
        return outcome('success');
      },
      cancel: () => undefined,
    });

    const req = request();
    const id = service.create(req);
    const first = service.start(id, req);
    const second = service.start(id, req);

    await expect(second).rejects.toMatchObject({ code: 'CONFLICT' });

    release();
    const result = await first;
    expect(result.status).toBe('success');
  });

  it('不同任务并发写同一目标表会被表级互斥挡住', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = serviceWith({
      migrate: async () => {
        await gate;
        return outcome('success');
      },
      cancel: () => undefined,
    });

    const req = request();
    const id1 = service.create(req);
    const id2 = service.create(req);
    const first = service.start(id1, req);

    await expect(service.start(id2, req)).rejects.toThrow(/占用/);

    release();
    await first;
    // id2 从未被置为 running（表锁在抢占任务之前就把请求挡住了）
    expect(service.get(id2).status).toBe('pending');
  });

  it('整库迁移（tables 为空）用通配锁，与同库单表迁移互斥', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = serviceWith({
      migrate: async () => {
        await gate;
        return outcome('success');
      },
      cancel: () => undefined,
    });

    const wildcard = service.create(request({ tables: [] }));
    const oneTable = service.create(request({ tables: ['orders'] }));

    const first = service.start(wildcard, request({ tables: [] }));
    await expect(service.start(oneTable, request({ tables: ['orders'] }))).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    release();
    await first;
  });

  it('迁移抛异常后锁会被释放，后续重跑不再被永久阻塞', async () => {
    const migrate = vi
      .fn()
      .mockRejectedValueOnce(new Error('模拟迁移异常'))
      .mockResolvedValueOnce(outcome('success'));
    const service = serviceWith({ migrate, cancel: () => undefined });

    const req = request();
    const id = service.create(req);

    await expect(service.start(id, req)).rejects.toThrow('模拟迁移异常');
    // 异常后状态落库为 failed，且锁已释放 → 允许再次启动
    expect(service.get(id).status).toBe('failed');

    const retry = await service.start(id, req);
    expect(retry.status).toBe('success');
    expect(migrate).toHaveBeenCalledTimes(2);
  });

  it('状态为 running 的任务拒绝重复启动', async () => {
    const service = serviceWith({ migrate: async () => outcome('success'), cancel: () => undefined });
    const req = request();
    const id = service.create(req);
    pdb.db.run("UPDATE migrations SET status = 'running' WHERE id = ?", id);

    await expect(service.start(id, req)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('引擎的错误码原样透传，并写入 error_message', async () => {
    const service = serviceWith({
      migrate: async () => {
        throw new PeanutError('VALIDATION_FAILED', '当前版本仅支持全量迁移（mode=full）');
      },
      cancel: () => undefined,
    });
    const req = request({ mode: 'incremental' });
    const id = service.create(req);

    await expect(service.start(id, req)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const task = service.get(id);
    expect(task.status).toBe('failed');
    expect(task.errorMessage).toMatch(/仅支持全量/);
  });
});

describe('报告中的分页方式', () => {
  it('逐表分页方式会写入检查点并能从报告读到', async () => {
    const table: TableMigrationReport = {
      table: 'users',
      pagination: 'all-columns',
      orderBy: ['name', 'email'],
      status: 'success',
      totalRows: 3,
      successRows: 3,
      skippedRows: 0,
      failedRows: 0,
    };
    const service = serviceWith({
      migrate: async () => outcome('success', [table]),
      cancel: () => undefined,
    });
    const req = request();
    const id = service.create(req);
    await service.start(id, req);

    const report = service.report(id);
    const checkpoint = report.checkpoints.find((c) => c.table === 'users');
    expect(checkpoint?.pagination?.pagination).toBe('all-columns');
    expect(checkpoint?.pagination?.orderBy).toEqual(['name', 'email']);
    expect(checkpoint?.pagination?.status).toBe('success');
  });
});
