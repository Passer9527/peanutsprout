/**
 * 花生苗数据库管理工具 - 桌面端内嵌服务启动辅助
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 为什么把这些逻辑单独放一个文件而不是塞进 main.mjs：
 *   main.mjs 顶部就 import electron，一旦被 vitest 之类的测试进程加载，
 *   在没有 Electron 运行时的环境下会直接失败——这些纯 Node 的端口/路径判断
 *   就永远没法做单元测试了。抽出来之后 main.mjs 只负责 Electron 生命周期。
 *
 * 本文件只依赖 node: 内置模块，禁止引入任何 npm 依赖（打包态没有 node_modules）。
 */

import { homedir } from 'node:os';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

/**
 * 让操作系统分配一个空闲端口，随后立即释放并返回端口号。
 *
 * 为什么不再固定用 8787：固定端口会与"另一个用户/另一个实例占用的 8787"撞车，
 * 而占用者同样可能在 /api/v1/health 上返回 200，主进程就会把窗口交给别人的服务。
 * 改为每次启动都向系统要一个空闲端口，从根上消除"端口被陌生人占着"的场景。
 *
 * 注意：从"选中端口"到"子进程真正 listen"之间存在极小的竞争窗口，
 * 若期间被别的进程抢走，子进程会以 EADDRINUSE 退出，主进程据"子进程提前退出"
 * 立即报错，而不是继续用 200 健康检查放行。
 */
export async function pickFreePort(host = '127.0.0.1') {
  return await new Promise((resolvePromise, reject) => {
    const probe = createServer();
    // 探测用的监听不参与事件循环保活，避免探测失败时把桌面端"钉"住
    probe.unref();
    probe.on('error', reject);
    probe.listen({ host, port: 0, exclusive: true }, () => {
      const address = probe.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      probe.close((closeError) => {
        if (closeError) reject(closeError);
        else if (!port) reject(new Error('无法向操作系统申请空闲端口'));
        else resolvePromise(port);
      });
    });
  });
}

/**
 * 校验 /api/v1/health 的应答者确实是"我这次启动的那个服务端"。
 *
 * 健康检查的 HTTP 200 只能证明"端口上有人活着"，证明不了"活着的是我 spawn 的子进程"：
 * 上一实例的孤儿服务端、或另一个用户的实例都可能正好占着这个端口并返回 200，
 * 主进程若据此创建窗口，用户就会连到别人的数据目录。
 *
 * 早期实现是拿 /api/v1/meta/info 的 dataDir 做比对，但那个字段本身是信息泄漏
 * （未鉴权接口暴露服务端绝对路径），已被移除，因此改为**一次性 nonce**：
 * 主进程生成随机 nonce，通过 PEANUTSPROUT_INSTANCE_NONCE 传给子进程，
 * 服务端在 /health 里原样回显（见 apps/server/src/routes/meta.ts）。
 * nonce 每次启动都不同、不落盘、不出现在任何其它接口，别人无法伪造。
 * 未传 nonce 的普通部署不会回显该字段，因此这条校验只在桌面端生效。
 */
export function verifyInstanceNonce(health, expectedNonce) {
  if (!health || typeof health !== 'object') return false;
  if (typeof expectedNonce !== 'string' || expectedNonce.length === 0) return false;
  const actual = health.instanceNonce;
  return typeof actual === 'string' && actual === expectedNonce;
}


