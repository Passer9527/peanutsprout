/**
 * 花生苗数据库管理工具 - 服务端启动入口
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PRODUCT } from '@peanutsprout/core';
import { buildServer } from './app.js';
import { loadConfig, type ServerConfig } from './config.js';
import { createContext, disposeContext, type AppContext } from './context.js';
import { WILDCARD_HOST } from './lib/web-access.js';

export interface StartServerResult {
  app: Awaited<ReturnType<typeof buildServer>>;
  ctx: AppContext;
  url: string;
  close: () => Promise<void>;
}

function banner(ctx: AppContext, url: string): string {
  const lines = [
    '',
    '  ┌──────────────────────────────────────────────────────────────┐',
    `  │  ${PRODUCT.nameZh}  v${PRODUCT.version}`,
    '  │  花生苗 —— 扎根数据土壤，破土而出，茁壮成长',
    '  ├──────────────────────────────────────────────────────────────┤',
    `  │  API      : ${url}/api/v1`,
    `  │  数据目录 : ${ctx.config.dataDir}`,
    `  │  本地库   : ${ctx.pdb.dbPath}`,
    `  │  主密钥   : ${ctx.pdb.masterKeyMode === 'password' ? '主密码保护' : '明文文件（0600）'}`,
    `  │  已实现驱动: ${ctx.registry.implementedTypes().join(', ') || '（无）'}`,
    '  ├──────────────────────────────────────────────────────────────┤',
    `  │  作者：${PRODUCT.author}   微信：${PRODUCT.wechat}`,
    `  │  开源协议：${PRODUCT.licenseFull}`,
    '  │  Copyright (C) 2025 飞哥。保留所有权利。',
    '  └──────────────────────────────────────────────────────────────┘',
  ];
  if (ctx.bootstrap.created) {
    lines.push(
      '',
      '  ⚠ 首次启动已创建管理员账号，请立即登录并修改密码：',
      `     用户名：${ctx.bootstrap.username}`,
      `     初始密码：${ctx.bootstrap.initialPassword}`,
      '    （该密码只显示这一次，未修改前请勿暴露服务端口）',
      '',
    );
  }
  return lines.join('\n');
}

export async function startServer(overrides: Partial<ServerConfig> = {}): Promise<StartServerResult> {
  const config = loadConfig(overrides);
  const ctx = createContext({ config });
  const app = await buildServer(ctx);

  try {
    // 监听地址取自 ctx.binding 而不是 config：config 是"请求绑到哪"，
    // binding 已经把界面上的「允许局域网访问」设置解析进去（见 lib/web-access.ts）。
    await app.listen({ host: ctx.binding.host, port: ctx.binding.port });
  } catch (e) {
    await disposeContext(ctx);
    throw e;
  }

  // 端口传 0 时由系统分配，只有 listen 成功后才能拿到真实值。
  // 界面要显示"现在能从哪里访问"，必须回填，否则会显示 :0。
  const address = app.server.address();
  if (address !== null && typeof address === 'object') {
    ctx.binding = { ...ctx.binding, port: address.port };
  }

  const scheme = config.https ? 'https' : 'http';
  // 通配绑定时对外地址不能写成 0.0.0.0（那不是一个可访问的地址）
  const displayHost = ctx.binding.host === '0.0.0.0' ? '127.0.0.1' : ctx.binding.host;
  const url = `${scheme}://${displayHost}:${ctx.binding.port}`;
  app.log.info(banner(ctx, url));
  app.log.info(
    ctx.binding.lanEnabled
      ? `已允许局域网访问：监听 ${WILDCARD_HOST}:${ctx.binding.port}，同网段的设备可用浏览器访问本机 IP 的该端口`
      : `仅本机可访问：监听 ${ctx.binding.host}:${ctx.binding.port}（如需手机/其他电脑访问，在「设置 → Web 页面访问」中开启局域网访问并重启）`,
  );

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await app.close();
    await disposeContext(ctx);
  };

  return { app, ctx, url, close };
}

/** 独立运行时（tsx src/main.ts）的入口。 */
async function main(): Promise<void> {
  const server = await startServer();
  /**
   * 优雅关闭，但**必须有兜底**。
   *
   * 旧实现只写 `void server.close().then(() => process.exit(0))`：
   * close() 内部会依次 app.close() → disposeContext()（其中 pdb.close() 可能抛错），
   * 任一步 reject 就既不会 exit、也没有 catch；而 SIGINT/SIGTERM 的默认退出行为
   * 已经被这个监听器接管，进程于是永远挂着，只能等 SIGKILL。
   * 另外 Fastify 的 close() 会等待在途请求结束，而单条查询的超时上限是 1 小时，
   * 关闭时若正好有长查询/迁移在跑，就会拖很久。
   *
   * 这里加两重保险：失败也退出（带非零码），以及超时后强制退出。
   */
  const FORCE_EXIT_MS = 10_000;
  const shutdown = (signal: string, exitCode = 0): void => {
    server.app.log.info(`收到 ${signal}，正在优雅关闭…`);
    const forceTimer = setTimeout(() => {
      server.app.log.warn(`优雅关闭超过 ${FORCE_EXIT_MS}ms，强制退出`);
      process.exit(exitCode === 0 ? 0 : exitCode);
    }, FORCE_EXIT_MS);
    // unref 不必要：这个定时器就是用来兜底的，退出前必须保持有效
    forceTimer.unref?.();
    server
      .close()
      .then(() => {
        clearTimeout(forceTimer);
        process.exit(exitCode);
      })
      .catch((err: unknown) => {
        clearTimeout(forceTimer);
        server.app.log.error({ err }, '优雅关闭失败，强制退出');
        process.exit(exitCode === 0 ? 1 : exitCode);
      });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    server.app.log.error({ err }, 'uncaughtException');
    shutdown('uncaughtException', 1);
  });
  process.on('unhandledRejection', (reason) => {
    server.app.log.error({ reason }, 'unhandledRejection');
  });
}

/**
 * 仅在被直接执行时启动，被 import 时不自动监听。
 *
 * 为什么不继续只用 `argv[1]` 的文件名正则：打包产物是 esbuild 生成的单文件
 * （scripts/build-server.mjs -> build/server.mjs），文件名不再叫 main.ts/js，
 * 靠后缀匹配会在打包后**静默失效**——进程正常退出、端口没人监听，
 * 桌面端只会报"等待本地服务就绪超时"，排查成本极高。
 *
 * 改为与 `import.meta.url` 比较，三种场景都成立：
 *   1. tsx 直跑源码：argv[1] 与 import.meta.url 都指向 main.ts；
 *   2. 打包产物：本模块被内联进 build/server.mjs，import.meta.url 就是产物自身；
 *   3. 被测试或其它模块 import：argv[1] 是 vitest/父进程入口，不相等 → 不监听。
 * 保留旧的 main.ts/js 后缀判断作为兜底（个别启动器会改写 argv[1] 形式）。
 */
const entryArg = process.argv[1];
const isDirectRun =
  entryArg !== undefined &&
  (pathToFileURL(resolve(entryArg)).href === import.meta.url ||
    /(?:^|[\\/])main\.(?:ts|js)$/.test(entryArg));
if (isDirectRun) {
  await main();
}
