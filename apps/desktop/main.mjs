/**
 * 花生苗数据库管理工具 - 桌面端主进程
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 形态：Electron 外壳 + 内嵌本地服务（PRD 3.3 双端形态之一）。
 * 为什么不直接在渲染进程里连数据库：
 *  - 保持"桌面端与 Web 端共用同一套服务端与权限模型"，避免两套逻辑分叉；
 *  - 渲染进程只通过 http://127.0.0.1:<port> 访问，天然享受同一套 JWT/审计/RBAC。
 *
 * 服务端有两种加载方式（见 resolveServerLaunch）：
 *  - 开发态：tsx 直跑 apps/server/src/main.ts，保持与 `pnpm dev:server` 完全一致；
 *  - 打包态：加载 esbuild 产物 resources/server/server.mjs。
 *    包里没有 devDependencies，也就没有 tsx，因此打包态**绝不能**再去
 *    require.resolve('tsx/cli')——那会直接抛错，表现为"桌面端起不来"。
 *    产物由 scripts/build-server.mjs 生成，清单见 apps/desktop/electron-builder.yml。
 */

import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, shell } from 'electron';
import { pickFreePort, verifyInstanceNonce } from './port-util.mjs';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
/** apps/desktop -> 仓库根 */
const REPO_ROOT = resolve(HERE, '..', '..');

const HOST = '127.0.0.1';
const HEALTH_TIMEOUT_MS = 30_000;

/** @type {import('node:child_process').ChildProcess | null} */
let serverProcess = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;
/** 由主进程向系统申请的随机空闲端口，见 port-util.mjs 的 pickFreePort */
let serverPort = 0;

/**
 * 决定服务端子进程"用什么命令、在哪个目录、托管哪份 Web 产物"。
 *
 * 三种情况：
 *  1. 环境变量 PEANUTSPROUT_SERVER_ENTRY 显式指定入口 → 直接用。
 *     用途：本地验证"打包后的产物"能否跑通（不必真的做出安装包），
 *     以及企业内网把服务端产物放到别处时覆盖路径。
 *  2. app.isPackaged → resources/server/server.mjs（electron-builder 的 extraResources）。
 *     Web 产物固定指向 resources/web，避免依赖 asar 内的相对路径猜测
 *     （app.ts 的 resolveWebDist 会先看 PEANUTSPROUT_WEB_DIST）。
 *  3. 其余 → 开发态：tsx CLI + TS 源码，与改动前逐字一致。
 */
function resolveServerLaunch() {
  const override = process.env['PEANUTSPROUT_SERVER_ENTRY']?.trim();
  if (override) {
    const entry = resolve(override);
    // 显式覆盖时不再猜 resources 路径；能读到 apps/web/dist 就顺带托管，方便本地联调。
    const devWebDist = join(REPO_ROOT, 'apps', 'web', 'dist');
    return {
      args: [entry],
      cwd: dirname(entry),
      webDist: process.env['PEANUTSPROUT_WEB_DIST'] ?? (existsSync(devWebDist) ? devWebDist : null),
    };
  }

  if (app.isPackaged) {
    const entry = join(process.resourcesPath, 'server', 'server.mjs');
    return { args: [entry], cwd: dirname(entry), webDist: join(process.resourcesPath, 'web') };
  }

  const tsxCli = require.resolve('tsx/cli');
  return {
    args: [tsxCli, join(REPO_ROOT, 'apps', 'server', 'src', 'main.ts')],
    cwd: REPO_ROOT,
    webDist: null,
  };
}

/** 把服务端以子进程方式拉起（开发态 tsx / 打包态 esbuild 产物）。 */
function startEmbeddedServer(port, launch, instanceNonce) {
  // 绝不把内嵌服务的 CORS 设成星号。
  //
  // 星号意味着用户在浏览器里打开的**任意网页**都能跨源读取本地 API 的响应，
  // 其中包括 POST /api/v1/auth/login 返回的完整 JWT（该端点还是 rateLimit:false），
  // 等于把本机数据库的登录态直接暴露给互联网上的任何页面。
  // 服务端 apps/server/src/app.ts 的默认策略只放行本机来源
  // （localhost / 127.0.0.1 / ::1，任意端口），而桌面窗口本身就用
  // http://127.0.0.1:<port>/ 同源加载，根本不需要跨域；docs/security.md 也明确禁止 `*`。
  // 因此这里**不注入** PEANUTSPROUT_CORS_ORIGIN，让服务端走默认白名单；
  // 确需显式配置时只能写精确来源（http://127.0.0.1:<port>），且绝不允许 `*`。
  // 继承自父进程环境的历史 `*` 配置也一并剔除，避免旧脚本/误配置把漏洞带回来。
  const env = { ...process.env };
  if (env['PEANUTSPROUT_CORS_ORIGIN']?.trim() === '*') delete env['PEANUTSPROUT_CORS_ORIGIN'];

  const child = spawn(process.execPath, launch.args, {
    cwd: launch.cwd,
    env: {
      ...env,
      // 关键：以 Node 身份运行，而不是再开一个 Electron 实例
      ELECTRON_RUN_AS_NODE: '1',
      PEANUTSPROUT_HOST: HOST,
      PEANUTSPROUT_PORT: String(port),
      PEANUTSPROUT_SERVE_WEB: 'true',
      // 服务端会在 /health 回显它，主进程据此确认应答者身份
      PEANUTSPROUT_INSTANCE_NONCE: instanceNonce,
      // 打包态必须显式告诉服务端 Web 产物在哪；开发态留空以保持原行为
      ...(launch.webDist ? { PEANUTSPROUT_WEB_DIST: launch.webDist } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (chunk) => {
    process.stdout.write(`[server] ${String(chunk)}`);
  });
  child.stderr?.on('data', (chunk) => {
    process.stderr.write(`[server] ${String(chunk)}`);
  });
  child.on('exit', (code, signal) => {
    process.stderr.write(`[server] 进程退出 code=${code} signal=${signal}\n`);
    // 进程已死，清空引用：before-quit 不必再对死进程补刀，
    // macOS 上之后点 Dock 图标（activate）也能重新拉起服务。
    if (serverProcess === child) serverProcess = null;
  });

  return child;
}

/** 统一收尾子进程：先 SIGTERM 优雅退出，2 秒后仍在则 SIGKILL 兜底。 */
function killServerProcess() {
  if (!serverProcess) return;
  const child = serverProcess;
  serverProcess = null;
  try {
    child.kill('SIGTERM');
  } catch {
    /* 进程可能已经退出 */
  }
  // 兜底：服务端若因为持有数据库连接等原因没能及时退出，不能让它变成
  // 退出后仍然活着的孤儿进程继续占端口、继续写数据目录。
  const forceTimer = setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      /* 同上 */
    }
  }, 2_000);
  forceTimer.unref?.();
  child.once('exit', () => clearTimeout(forceTimer));
}

/** 子进程提前退出时立刻失败，避免把"启动失败"拖成 30 秒超时。 */
function waitForChildExit(child) {
  return new Promise((_resolve, reject) => {
    child.once('exit', (code, signal) => {
      reject(new Error(`内嵌服务进程在就绪前退出（code=${code} signal=${signal}），请查看上方 [server] 日志`));
    });
    child.once('error', (error) => reject(error));
  });
}

/**
 * 轮询健康检查直到服务可用，避免窗口打开时白屏。
 *
 * 为什么只看 HTTP 200 不够：任意占用该端口的进程都可能返回 200，主进程就会把
 * 窗口交给别人的服务。这里用**一次性 nonce** 做身份确认（详见 port-util.mjs 的
 * verifyInstanceNonce）：nonce 由主进程随机生成、经环境变量传给子进程，
 * 服务端在 /health 中原样回显，因此只有"我这次启动的那个服务端"能给出正确值。
 */
async function waitForHealth(port, timeoutMs, expectedNonce) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '未知错误';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${HOST}:${port}/api/v1/health`);
      if (response.ok) {
        const health = await response.json();
        if (verifyInstanceNonce(health, expectedNonce)) return health;
        lastError = `端口 ${port} 上应答的服务不是本实例（实例标识不匹配），拒绝使用`;
      } else {
        lastError = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  throw new Error(`等待本地服务就绪超时（${timeoutMs}ms）：${lastError}`);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#f4f7f4',
    title: '花生苗数据库管理工具',
    webPreferences: {
      // 界面只通过 HTTP 与本地服务通信，不暴露 Node 能力给渲染进程
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // 窗口销毁后必须清空引用：否则 second-instance 聚焦时会对已销毁的窗口
  // 调用 isMinimized()/focus() 而抛错。
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 外部链接交给系统浏览器，避免应用内被导航走
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  return mainWindow;
}

async function bootstrap() {
  const diagnostics = [];
  // 服务只启动一次：macOS 上关闭全部窗口后点 Dock 图标会触发 activate，
  // 若这里无脑再 spawn 一个，第二个服务会覆盖 serverProcess，前一个就变成
  // 孤儿进程继续占着端口、继续写数据目录，退出时也杀不掉。
  if (!serverProcess) {
    try {
      const launch = resolveServerLaunch();
      // 端口由系统随机分配，避免与"别的用户已经占用的 8787"撞车后把窗口交给别人的服务
      const port = await pickFreePort(HOST);
      // 每次启动生成一次性实例标识，用于确认端口上应答的是本次启动的子进程
      const instanceNonce = randomBytes(24).toString('hex');

      const child = startEmbeddedServer(port, launch, instanceNonce);
      serverProcess = child;
      serverPort = port;

      const health = await Promise.race([
        waitForHealth(port, HEALTH_TIMEOUT_MS, instanceNonce),
        waitForChildExit(child),
      ]);
      diagnostics.push(`服务已就绪：${health.product} v${health.version}（${HOST}:${port}）`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const hint = app.isPackaged
        ? '安装包可能不完整：请确认 resources/server/server.mjs 与 resources/web 存在，并查看系统日志中的 [server] 输出。'
        : '请确认依赖已安装（pnpm install）与服务端源码可编译，或查看终端中的 [server] 日志。';
      killServerProcess();
      dialog.showErrorBox('花生苗启动失败', `${message}\n\n${hint}`);
      app.quit();
      return;
    }
  }

  const win = createWindow();
  await win.loadURL(`http://${HOST}:${serverPort}/`);
  for (const line of diagnostics) process.stdout.write(`${line}\n`);
}

// 单实例锁：两个桌面端进程同时写同一个 SQLite 数据目录会互相破坏，
// 也会各自拉起一个内嵌服务。拿不到锁就立刻退出，由已有实例聚焦窗口。
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 用户再次启动时聚焦已有窗口，而不是再开一个实例
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(bootstrap).catch((error) => {
    dialog.showErrorBox('花生苗启动异常', String(error));
    app.quit();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    // 服务由 bootstrap 内部保证只启动一次，这里只负责在没有窗口时重建窗口
    if (BrowserWindow.getAllWindows().length === 0) {
      void bootstrap();
    }
  });

  app.on('before-quit', () => {
    killServerProcess();
  });
}
