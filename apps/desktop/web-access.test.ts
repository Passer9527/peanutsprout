/**
 * 桌面端「局域网访问」设置读取与绑定决策测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * web-access.mjs 与 apps/server/src/lib/web-access.ts 存在刻意的逻辑重复
 * （打包态没有 node_modules，桌面端无法复用 TS 源码），因此这里的取值必须
 * 与服务端那份保持一致。测试里把两边的关键常量对齐写死，任一边漂移就会红。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
// 纯 JS 辅助模块，桌面端没有 tsconfig；这里只做运行时验证
import {
  DEFAULT_LAN_PORT,
  LOOPBACK_HOST,
  WILDCARD_HOST,
  parseLanPort,
  readWebAccessSettingsFromDb,
  resolveDataDir,
  resolveDbPath,
  resolveDesktopBinding,
  resolveWebAccessSettings,
} from './web-access.mjs';

const tempDirs: string[] = [];

/** 造一个只含 settings 表的最小库，模拟真实数据目录 */
function makeDbWithSettings(rows: Array<[string, string]>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ps-webaccess-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'peanutsprout.db');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, category TEXT)');
  const insert = db.prepare('INSERT INTO settings (key, value, category) VALUES (?, ?, ?)');
  for (const [key, value] of rows) insert.run(key, value, 'web');
  db.close();
  return dbPath;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('parseLanPort：与服务端取值范围一致', () => {
  it('合法端口按原值返回', () => {
    expect(parseLanPort('8787')).toBe(8787);
    expect(parseLanPort(9000)).toBe(9000);
    expect(parseLanPort('65535')).toBe(65535);
  });

  it('越界/脏值回退默认端口', () => {
    for (const bad of [null, undefined, '', '  ', '80', '0', '65536', 'abc', '1.5']) {
      expect(parseLanPort(bad), `端口 ${String(bad)} 应回退`).toBe(DEFAULT_LAN_PORT);
    }
  });

  it('默认端口与服务端常量对齐', () => {
    expect(DEFAULT_LAN_PORT).toBe(8787);
  });
});

describe('resolveWebAccessSettings', () => {
  it('只有 true/1 算打开', () => {
    expect(resolveWebAccessSettings((k) => (k === 'web.lan_enabled' ? 'true' : null)).lanEnabled).toBe(true);
    expect(resolveWebAccessSettings((k) => (k === 'web.lan_enabled' ? '1' : null)).lanEnabled).toBe(true);
  });

  it('读不到或脏值一律按关闭（安全默认）', () => {
    for (const raw of [null, '', 'false', 'TRUE', 'yes']) {
      const get = (k: string) => (k === 'web.lan_enabled' ? raw : null);
      expect(resolveWebAccessSettings(get).lanEnabled, `值 ${String(raw)}`).toBe(false);
    }
  });
});

describe('readWebAccessSettingsFromDb', () => {
  it('从真实库里读出设置', () => {
    const dbPath = makeDbWithSettings([
      ['web.lan_enabled', 'true'],
      ['web.lan_port', '9100'],
    ]);
    expect(readWebAccessSettingsFromDb(dbPath)).toEqual({ lanEnabled: true, lanPort: 9100 });
  });

  it('键缺失时回退到默认（关闭 + 默认端口）', () => {
    const dbPath = makeDbWithSettings([['app.theme', 'dark']]);
    expect(readWebAccessSettingsFromDb(dbPath)).toEqual({
      lanEnabled: false,
      lanPort: DEFAULT_LAN_PORT,
    });
  });

  it('库文件不存在 → 关闭，而不是抛错把桌面端拖垮', () => {
    // 首次启动时服务端子进程还没建库，桌面端必须能照常起来（只是不允许局域网访问）
    expect(readWebAccessSettingsFromDb('/nonexistent/peanutsprout.db')).toEqual({
      lanEnabled: false,
      lanPort: DEFAULT_LAN_PORT,
    });
  });

  it('表结构不认识（例如旧库）→ 关闭', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ps-webaccess-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'peanutsprout.db');
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE something_else (k TEXT)');
    db.close();
    expect(readWebAccessSettingsFromDb(dbPath)).toEqual({
      lanEnabled: false,
      lanPort: DEFAULT_LAN_PORT,
    });
  });

  it('读取过程不写库（只读句柄）', () => {
    const dbPath = makeDbWithSettings([['web.lan_enabled', 'true']]);
    const before = new DatabaseSync(dbPath, { readOnly: true });
    const beforeCount = before.prepare('SELECT COUNT(*) AS n FROM settings').get() as { n: number };
    before.close();
    readWebAccessSettingsFromDb(dbPath);
    const after = new DatabaseSync(dbPath, { readOnly: true });
    const afterCount = after.prepare('SELECT COUNT(*) AS n FROM settings').get() as { n: number };
    after.close();
    expect(afterCount.n).toBe(beforeCount.n);
  });
});

describe('resolveDataDir / resolveDbPath：必须与服务端读同一个库', () => {
  it('环境变量名与 core/paths.ts 保持一致', () => {
    // 若这里写成另一个变量名，桌面端与服务端子进程会读**两个不同的库**，
    // 表现为"设置改了没反应"，且极难排查。
    expect(resolveDataDir({ PEANUTSPROUT_HOME: '/tmp/custom-home' })).toBe('/tmp/custom-home');
    expect(resolveDataDir({ PEANUTSPROUT_HOME: '   ' })).toMatch(/\.peanutsprout$/);
    expect(resolveDataDir({})).toMatch(/\.peanutsprout$/);

    expect(resolveDbPath('/data', {})).toBe('/data/peanutsprout.db');
    expect(resolveDbPath('/data', { PEANUTSPROUT_DB: '/tmp/x.db' })).toBe('/tmp/x.db');
    expect(resolveDbPath('/data', { PEANUTSPROUT_DB: '  ' })).toBe('/data/peanutsprout.db');
  });

  it('相对路径必须解析成绝对路径', () => {
    // 这条是"父子进程读同一个库"的关键：桌面端读设置时按**自己的 cwd** 解析，
    // 而它 spawn 的服务端子进程 cwd 是 launch.cwd（打包态 resources/server、
    // 开发态仓库根），两者不同。若这里把相对路径原样传下去，同一个
    // PEANUTSPROUT_HOME 会被两边解析成两个不同的目录，表现为
    // "界面上改了设置却毫无反应"。因此 resolveDataDir 必须给出绝对路径，
    // main.mjs 再把该绝对路径显式传给子进程。
    const dir = resolveDataDir({ PEANUTSPROUT_HOME: './relative-data' });
    expect(isAbsolute(dir), `应返回绝对路径，实际 ${dir}`).toBe(true);
    expect(dir.endsWith('relative-data')).toBe(true);

    const db = resolveDbPath('/data', { PEANUTSPROUT_DB: './relative.db' });
    expect(isAbsolute(db), `应返回绝对路径，实际 ${db}`).toBe(true);
    expect(db.endsWith('relative.db')).toBe(true);
  });
});

describe('resolveDesktopBinding', () => {
  it('关闭局域网 → 回环 + 随机端口（沿用原有行为）', async () => {
    const picker = vi.fn(async () => 54321);
    const binding = await resolveDesktopBinding({
      settings: { lanEnabled: false, lanPort: 8787 },
      freePortPicker: picker,
    });
    expect(binding).toEqual({ host: LOOPBACK_HOST, port: 54321, lanEnabled: false });
    expect(picker).toHaveBeenCalledTimes(1);
  });

  it('打开局域网 → 通配 + 固定端口，且**不**去申请随机端口', async () => {
    const picker = vi.fn(async () => 54321);
    const binding = await resolveDesktopBinding({
      settings: { lanEnabled: true, lanPort: 9100 },
      freePortPicker: picker,
    });
    expect(binding).toEqual({ host: WILDCARD_HOST, port: 9100, lanEnabled: true });
    // 关键：开启后端口必须稳定，否则用户发出去的网址下次打开就失效
    expect(picker).not.toHaveBeenCalled();
  });

  it('固定端口被占用时**不**静默换端口，而是把错误交给上层报出来', async () => {
    // 若这里改成"占用就换一个"，用户拿到的地址会悄悄变化，对方打不开且看不出原因。
    // 本函数只在关闭局域网时才调用 picker，因此"占用"根本不会走到换端口逻辑。
    const picker = vi.fn(async () => {
      throw Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
    });
    const binding = await resolveDesktopBinding({
      settings: { lanEnabled: true, lanPort: 9100 },
      freePortPicker: picker,
    });
    expect(binding.port).toBe(9100);
    expect(picker).not.toHaveBeenCalled();
  });
});
