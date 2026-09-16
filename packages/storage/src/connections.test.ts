/**
 * 花生苗数据库管理工具 - 连接仓库测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 重点：口令必须加密落库、DTO 绝不外泄口令、连接串解析正确。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPeanutDatabase, type PeanutDatabase } from './index.js';
import { normalizeConnectionInput, parseConnectionUrl } from './repositories/connections.js';

let pdb: PeanutDatabase;

beforeEach(() => {
  pdb = openPeanutDatabase({ memory: true });
});

afterEach(() => {
  pdb.close();
});

describe('parseConnectionUrl', () => {
  it('解析标准 MySQL 连接串', () => {
    const parsed = parseConnectionUrl('mysql://root:secret@127.0.0.1:3306/appdb');
    expect(parsed).toMatchObject({
      dbType: 'mysql',
      host: '127.0.0.1',
      port: 3306,
      username: 'root',
      password: 'secret',
      databaseName: 'appdb',
    });
  });

  it('解析 PostgreSQL 连接串并识别 URL 编码口令', () => {
    const parsed = parseConnectionUrl('postgresql://user:p%40ss%3Aword@db.example.com:5432/prod');
    expect(parsed?.dbType).toBe('postgresql');
    expect(parsed?.password).toBe('p@ss:word');
    expect(parsed?.host).toBe('db.example.com');
  });

  it('解析器只报告 URL 里真实出现的内容（端口缺省时为 null）', () => {
    expect(parseConnectionUrl('postgres://u:p@localhost/db')?.port).toBeNull();
  });

  it('默认端口由 normalizeConnectionInput 在缺省时补齐', () => {
    const pg = normalizeConnectionInput({ name: 'pg', dbType: 'postgresql', connectionUrl: 'postgres://u:p@localhost/db' });
    expect(pg.port).toBe(5432);
    const mysql = normalizeConnectionInput({ name: 'my', dbType: 'mysql', connectionUrl: 'mysql://u:p@localhost/db' });
    expect(mysql.port).toBe(3306);
    const redis = normalizeConnectionInput({ name: 'rd', dbType: 'redis', connectionUrl: 'redis://u:p@localhost/0' });
    expect(redis.port).toBe(6379);
  });

  it('缺省端口时补齐，但显式端口优先', () => {
    expect(normalizeConnectionInput({ name: 'a', dbType: 'mysql', host: 'h' }).port).toBe(3306);
    expect(
      normalizeConnectionInput({ name: 'b', dbType: 'mysql', host: 'h', port: 3399 }).port,
    ).toBe(3399);
    expect(normalizeConnectionInput({ name: 'c', dbType: 'sqlite', databaseName: '/tmp/a.db' }).port).toBeNull();
  });

  it('SQLite 走文件路径而不是主机端口', () => {
    const parsed = parseConnectionUrl('sqlite:///tmp/app.db');
    expect(parsed?.dbType).toBe('sqlite');
    expect(parsed?.databaseName).toContain('/tmp/app.db');
  });

  it('对非法输入返回 null 而不是抛错', () => {
    expect(parseConnectionUrl('')).toBeNull();
    expect(parseConnectionUrl('   ')).toBeNull();
    expect(parseConnectionUrl('没有协议的字符串')).toBeNull();
  });

  it('未知协议仍能解析出主机等信息，但 dbType 为 null 交由调用方决策', () => {
    const parsed = parseConnectionUrl('unknownproto://host/db');
    expect(parsed).not.toBeNull();
    expect(parsed?.dbType).toBeNull();
    expect(parsed?.host).toBe('host');
  });

  it('连接串里的查询参数会并入 extraParams', () => {
    const created = pdb.connections.create({
      name: 'with-params',
      dbType: 'mysql',
      connectionUrl: 'mysql://u:p@h:3306/d?charset=utf8mb4',
    });
    expect(pdb.connections.getConfig(created.id)?.extraParams?.['charset']).toBe('utf8mb4');
  });

  it('连接串里显式写明的端口不会被默认端口覆盖', () => {
    const created = pdb.connections.create({
      name: 'port-test',
      dbType: 'mysql',
      connectionUrl: 'mysql://root:pw@127.0.0.1:3307/shop',
    });
    expect(pdb.connections.getConfig(created.id)?.port).toBe(3307);
  });

  it('连接串的 scheme 会修正表单里选错的数据库类型', () => {
    const created = pdb.connections.create({
      name: 'scheme-wins',
      dbType: 'mysql',
      connectionUrl: 'postgresql://u:p@h:5432/d',
    });
    expect(pdb.connections.get(created.id)?.dbType).toBe('postgresql');
  });

  it('保留查询参数', () => {
    const parsed = parseConnectionUrl('mysql://u:p@h:3306/d?charset=utf8mb4&ssl=true');
    expect(parsed?.params['charset']).toBe('utf8mb4');
    expect(parsed?.params['ssl']).toBe('true');
  });
});

describe('连接 CRUD 与口令加密', () => {
  it('创建后可按 id 读取', () => {
    const created = pdb.connections.create({
      name: '本地库',
      dbType: 'sqlite',
      databaseName: '/tmp/x.db',
    });
    expect(created.id).toBeGreaterThan(0);
    expect(pdb.connections.get(created.id)?.name).toBe('本地库');
  });

  it('DTO 不含口令字段，只暴露 hasPassword', () => {
    const created = pdb.connections.create({
      name: 'pg',
      dbType: 'postgresql',
      host: 'localhost',
      port: 5432,
      databaseName: 'db',
      username: 'u',
      password: 'super-secret',
    });
    const dto = pdb.connections.get(created.id) as unknown as Record<string, unknown>;
    expect(dto['password']).toBeUndefined();
    expect(dto['hasPassword']).toBe(true);
    // 整个 DTO 序列化后也不能出现明文
    expect(JSON.stringify(dto)).not.toContain('super-secret');
  });

  it('口令以密文形式落库，数据库里查不到明文', () => {
    const created = pdb.connections.create({
      name: 'pg',
      dbType: 'postgresql',
      host: 'localhost',
      databaseName: 'db',
      username: 'u',
      password: 'super-secret',
    });
    const row = pdb.db.get<{ password_enc: Uint8Array | null }>(
      'SELECT password_enc FROM connections WHERE id = ?',
      created.id,
    );
    expect(row?.password_enc).toBeTruthy();
    expect(Buffer.from(row?.password_enc as Uint8Array).toString('utf8')).not.toContain('super-secret');
    // 但用主密钥能解回明文（驱动连接时要用）
    expect(pdb.connections.getConfig(created.id)?.password).toBe('super-secret');
  });

  it('getConfig 返回可用的连接配置', () => {
    const created = pdb.connections.create({
      name: 'pg',
      dbType: 'postgresql',
      host: 'db.internal',
      port: 5433,
      databaseName: 'app',
      username: 'alice',
      password: 'pw',
      isReadOnly: true,
    });
    const config = pdb.connections.getConfig(created.id);
    expect(config).toMatchObject({
      id: created.id,
      dbType: 'postgresql',
      host: 'db.internal',
      port: 5433,
      databaseName: 'app',
      username: 'alice',
      password: 'pw',
      // 注意：对内配置用 readOnly，对外 DTO 用 isReadOnly，两层刻意不同名
      readOnly: true,
    });
  });

  it('更新口令后旧口令失效', () => {
    const created = pdb.connections.create({
      name: 'pg',
      dbType: 'postgresql',
      host: 'h',
      databaseName: 'd',
      username: 'u',
      password: 'old-pw',
    });
    pdb.connections.update(created.id, { password: 'new-pw' });
    expect(pdb.connections.getConfig(created.id)?.password).toBe('new-pw');
  });

  it('删除后查不到', () => {
    const created = pdb.connections.create({ name: 'x', dbType: 'sqlite', databaseName: '/tmp/x.db' });
    expect(pdb.connections.delete(created.id)).toBe(true);
    expect(pdb.connections.get(created.id)).toBeNull();
    expect(pdb.connections.getConfig(created.id)).toBeNull();
  });

  it('从连接串创建时自动拆出各字段', () => {
    const created = pdb.connections.create({
      name: 'by-url',
      dbType: 'mysql',
      connectionUrl: 'mysql://root:pw@127.0.0.1:3307/shop',
    });
    const config = pdb.connections.getConfig(created.id);
    expect(config?.host).toBe('127.0.0.1');
    expect(config?.port).toBe(3307);
    expect(config?.databaseName).toBe('shop');
    expect(config?.password).toBe('pw');
  });

  it('列表与计数按类型过滤', () => {
    pdb.connections.create({ name: 'a', dbType: 'sqlite', databaseName: '/tmp/a.db' });
    pdb.connections.create({ name: 'b', dbType: 'mysql', host: 'h', databaseName: 'd' });
    expect(pdb.connections.list().length).toBe(2);
    expect(pdb.connections.list({ dbType: 'mysql' }).length).toBe(1);
    expect(pdb.connections.count({ dbType: 'sqlite' })).toBe(1);
  });

  it('标记使用与收藏', () => {
    const created = pdb.connections.create({ name: 'a', dbType: 'sqlite', databaseName: '/tmp/a.db' });
    pdb.connections.markUsed(created.id);
    expect(pdb.connections.get(created.id)?.lastUsedAt).not.toBeNull();
    expect(pdb.connections.toggleFavorite(created.id, true).isFavorite).toBe(true);
  });

  it('分组可创建与删除', () => {
    const groupId = pdb.connections.createGroup('生产环境', null);
    expect(groupId).toBeGreaterThan(0);
    expect(pdb.connections.listGroups().some((g) => g.id === groupId)).toBe(true);
    expect(pdb.connections.deleteGroup(groupId)).toBe(true);
  });
});
