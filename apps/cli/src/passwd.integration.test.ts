/**
 * 默认口令强制改密闸门的 CLI 集成测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 走真实 Fastify（app.listen 到随机端口）+ 真实内存库 + 真实 HTTP 客户端，
 * 覆盖"默认口令用户被锁死"这一回归：
 *   登录成功但业务命令 403 → logout 仍可用 → 用 passwd 改密 → 业务命令恢复。
 *
 * 之所以放在 apps/cli 下：本次改动范围限定在 CLI，且这样验证的正是用户真正
 * 执行的命令行路径，而不是服务端内部调用。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildServer, createContext, disposeContext, type AppContext } from '@peanutsprout/server';
import { main } from './index.js';

const stdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin')!;

let dir: string;
// 直接用 buildServer 的返回值推断类型，避免从 apps/cli 直接 import fastify
// （pnpm 的严格依赖隔离下 apps/cli 并没有 fastify 依赖）
let app: Awaited<ReturnType<typeof buildServer>>;
let ctx: AppContext;
let base: string;

/** 模拟 `echo <text> | peanutsprout ...`：把 process.stdin 换成一次性可读流 */
function feedStdin(text: string): void {
  Object.defineProperty(process, 'stdin', {
    value: Readable.from([text]),
    configurable: true,
    enumerable: true,
  });
}

/** 执行一次真实 CLI；全局选项放在子命令之前，与 commander 的解析规则一致 */
async function runCli(args: string[]): Promise<{ code: typeof process.exitCode; stderr: string }> {
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  process.exitCode = undefined;
  await main(['node', 'peanutsprout', '--server', base, '--data-dir', dir, ...args]);
  const code = process.exitCode;
  const stderr = errSpy.mock.calls.map((call) => String(call[0])).join('');
  vi.restoreAllMocks();
  return { code, stderr };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ps-cli-pw-'));
  ctx = createContext({
    // bootstrapAdminPassword 置空 → 服务端用内置默认口令 123456 引导，
    // 并打开"必须先改密"的强制闸门（与全新安装的真实场景一致）
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir: dir,
      masterPassword: null,
      tokenTtlSec: 3600,
      corsOrigin: null,
      serveWeb: false,
      webDistPath: null,
      bootstrapAdminUsername: 'admin',
      bootstrapAdminPassword: null,
      logLevel: 'silent',
      https: null,
      idleConnectionMs: 0,
    instanceNonce: null,
    trustProxy: false,
    },
    memory: true,
  });
  app = await buildServer(ctx, { quiet: true });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app.close();
  await disposeContext(ctx);
  rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  Object.defineProperty(process, 'stdin', stdinDescriptor);
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe('默认口令下的改密自救链路', () => {
  it('业务命令被闸门拒绝 → logout 可用 → passwd 改密 → 业务恢复', async () => {
    // 默认口令登录：登录接口不受闸门限制，但响应会带上 mustChangePassword
    feedStdin('123456\n');
    const login = await runCli(['login', '--username', 'admin', '--password-stdin']);
    expect(login.code).toBeFalsy();
    expect(login.stderr).toContain('peanutsprout passwd');

    // (a) 未改密：任意业务命令被 403 PASSWORD_CHANGE_REQUIRED 拦下（这里归入退出码 5）
    const blocked = await runCli(['conn', 'list']);
    expect(blocked.code).toBe(5);
    expect(blocked.stderr).toContain('peanutsprout passwd');

    // (4) logout 在闸门白名单里，必须始终可用
    const logout = await runCli(['logout']);
    expect(logout.code).toBeFalsy();

    // logout 已吊销旧令牌，重新登录拿到新令牌
    feedStdin('123456\n');
    const relogin = await runCli(['login', '--username', 'admin', '--password-stdin']);
    expect(relogin.code).toBeFalsy();

    // (b) 新命令 passwd 直接对接白名单接口，完成自救
    feedStdin('Brand-New-Pass!9\n');
    const passwd = await runCli(['passwd', '--old', '123456', '--password-stdin']);
    expect(passwd.code).toBeFalsy();

    // 闸门解除，业务命令恢复可用
    const after = await runCli(['conn', 'list']);
    expect(after.code).toBeFalsy();
    expect(after.stderr).not.toContain('peanutsprout passwd');

    // 旧口令确实已失效（AUTH_INVALID_CREDENTIALS → 退出码 6）
    feedStdin('123456\n');
    const oldLogin = await runCli(['login', '--username', 'admin', '--password-stdin']);
    expect(oldLogin.code).toBe(6);
  });
});
