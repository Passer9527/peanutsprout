/**
 * CLI HTTP 客户端测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 回归点：--insecure 必须真的生效（自签名证书默认失败、开了才通过），
 * 且只打印一次警告；否则文档承诺的"跳过 TLS 校验"就是一纸空文。
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiClient, CliError } from './client.js';

/** 没有 openssl 的平台直接跳过，避免把环境问题伪装成代码失败 */
const hasOpenssl = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

let server: ReturnType<typeof createServer>;
let base = '';
let dir = '';

beforeAll(async () => {
  if (!hasOpenssl) return;
  dir = mkdtempSync(join(tmpdir(), 'ps-tls-'));
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  // 一次性自签名证书：只用于验证"默认拒绝、--insecure 放行"
  execFileSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=127.0.0.1'],
    { stdio: 'ignore' },
  );
  server = createServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'ok' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  base = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeClient(insecure: boolean): ApiClient {
  return new ApiClient({ server: base, dataDir: dir, timeoutMs: 5_000, insecure });
}

describe.skipIf(!hasOpenssl)('--insecure', () => {
  it('默认拒绝自签名证书', async () => {
    await expect(makeClient(false).get('/health')).rejects.toBeInstanceOf(CliError);
  });

  it('开启 --insecure 后放行，并在 stderr 打印且仅打印一次警告', async () => {
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const response = await makeClient(true).get<{ status: string }>('/health');
    expect(response.data.status).toBe('ok');

    // 再发一次，确认警告不会每个请求都刷一遍
    await makeClient(true).get<{ status: string }>('/health');

    const warnings = errSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('--insecure'));
    expect(warnings).toHaveLength(1);
  });
});
