/**
 * 花生苗数据库管理工具 - 桌面端：局域网访问设置的读取与绑定决策
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 为什么桌面端要自己读数据库设置：
 *   "是否允许局域网访问"决定了两件事 —— 绑哪个地址、绑哪个端口。
 *   桌面端必须在 spawn 服务端子进程**之前**知道端口（它要拿这个端口去
 *   轮询 /api/v1/health、再让窗口加载该地址），所以不能等服务端启动后回传。
 *   服务端那边同样实现了"按设置解析绑定"（apps/server/src/lib/web-access.ts），
 *   但那只在**部署方没有显式指定** host/port 时生效；桌面端属于"显式指定"，
 *   因此由这里先把设置读出来、再以环境变量传给子进程。
 *
 * 本文件与 apps/server/src/lib/web-access.ts 存在刻意的逻辑重复
 * （parseLanPort 的取值范围、默认端口、安全默认值）：
 *   打包态只带 Electron 外壳，没有任何 node_modules，本文件必须零 npm 依赖，
 *   无法复用 TS 源码。改动其一时请同步改另一处，两边的单测都覆盖了这些取值。
 *
 * 失败策略：**任何异常都退回"不允许局域网访问"**。
 *   读不到库、表不存在、被主密码保护、条目是脏值 —— 一律按关闭处理。
 *   理由：这是安全开关，出错时倒向"更封闭"永远不会造成事故；
 *   倒向"更开放"则可能把数据库管理工具静默暴露到整个局域网。
 */

import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** 局域网访问的默认端口（与 apps/server/src/lib/web-access.ts 保持一致） */
export const DEFAULT_LAN_PORT = 8787;
export const LOOPBACK_HOST = '127.0.0.1';
export const WILDCARD_HOST = '0.0.0.0';
export const SETTING_LAN_ENABLED = 'web.lan_enabled';
export const SETTING_LAN_PORT = 'web.lan_port';

/**
 * 复刻 packages/core/src/paths.ts 的 resolveDataDir / resolveDbPath。
 * 同样是因为打包态没有 node_modules，无法 import @peanutsprout/core。
 * 环境变量名必须与 core 一字不差（PEANUTSPROUT_HOME / PEANUTSPROUT_DB），
 * 否则服务端子进程与桌面端会读到**两个不同的库**，表现为设置改了没反应。
 */
export function resolveDataDir(env = process.env) {
  const fromEnv = env['PEANUTSPROUT_HOME'];
  if (fromEnv && fromEnv.trim()) return resolve(fromEnv.trim());
  return join(homedir(), '.peanutsprout');
}

export function resolveDbPath(dataDir, env = process.env) {
  const fromEnv = env['PEANUTSPROUT_DB'];
  if (fromEnv && fromEnv.trim()) return resolve(fromEnv.trim());
  return join(dataDir, 'peanutsprout.db');
}

/** 端口取值校验：与存储层白名单同样的 1024..65535，非法值回退默认端口。 */
export function parseLanPort(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return DEFAULT_LAN_PORT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) return DEFAULT_LAN_PORT;
  return n;
}

/**
 * 从"按键取设置值"的访问器解析出开关与端口。纯函数，便于单测。
 * 只有 'true'/'1' 视为打开 —— 脏值必须落到"关闭"。
 */
export function resolveWebAccessSettings(getSetting) {
  const raw = getSetting(SETTING_LAN_ENABLED);
  return {
    lanEnabled: raw === 'true' || raw === '1',
    lanPort: parseLanPort(getSetting(SETTING_LAN_PORT)),
  };
}

/**
 * 从本地库读取设置。
 *
 * 以**只读**方式打开：桌面端只是读两个键，不该有创建库文件、加锁写库或
 * 触发迁移的副作用（此时服务端子进程还没起来，真让它写库会与服务端抢锁）。
 * 用动态 import 包住：万一某个 Electron 版本的 Node 未启用 node:sqlite，
 * 也只是回退到"关闭"，不会让整个桌面端启动失败。
 */
export function readWebAccessSettingsFromDb(dbPath) {
  let db = null;
  try {
    // createRequire 而不是顶层 import：本文件是 ESM，且若某个 Electron 版本的
    // Node 未启用 node:sqlite，顶层 import 会让整个桌面端**加载即失败**；
    // 放在 try 里则只回退到"关闭局域网访问"，应用照常可用。
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
    db = new DatabaseSync(dbPath, { readOnly: true });
    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    const getSetting = (key) => {
      const row = stmt.get(key);
      return row === undefined || row === null ? null : String(row.value);
    };
    return resolveWebAccessSettings(getSetting);
  } catch {
    return { lanEnabled: false, lanPort: DEFAULT_LAN_PORT };
  } finally {
    try {
      db?.close();
    } catch {
      /* 关闭失败无需处理：只读句柄，进程退出即释放 */
    }
  }
}

/**
 * 决定内嵌服务绑定到哪。
 *
 *  - 关闭局域网访问：绑回环 + **每次启动随机端口**（沿用原有行为，避免与
 *    别的实例撞端口，也不会让本机其他程序猜到地址）。
 *  - 打开局域网访问：绑通配 + **固定端口**。这里刻意不"端口被占就换一个"：
 *    用户拿到的访问地址是要发给自己手机/同事的，端口若悄悄变化，
 *    对方就打不开而且看不出原因。宁可启动失败并明确报"端口被占用，请改端口"。
 */
export async function resolveDesktopBinding(options) {
  const {
    settings,
    freePortPicker,
    host = LOOPBACK_HOST,
    fallbackPort,
  } = options;

  if (settings.lanEnabled) {
    return { host: WILDCARD_HOST, port: settings.lanPort, lanEnabled: true };
  }
  const port = fallbackPort ?? (await freePortPicker(host));
  return { host, port, lanEnabled: false };
}
