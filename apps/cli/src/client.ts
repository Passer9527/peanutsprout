/**
 * 花生苗数据库管理工具 - CLI HTTP 客户端
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 与 docs/cli-reference.md §1 保持一致：
 *  - 令牌解析优先级：--token > --token-file > PEANUTSPROUT_TOKEN > CLI 令牌文件
 *  - 领域错误码 → 退出码（§1.7），便于脚本编排
 *  - 只依赖内置 fetch，不引第三方 HTTP 库
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chmodSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ErrorCode } from '@peanutsprout/core';

/** 与 docs/cli-reference.md §1.7 一一对应 */
const EXIT_CODES: Partial<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 2,
  NOT_FOUND: 3,
  DRIVER_NOT_IMPLEMENTED: 4,
  AUTH_FORBIDDEN: 5,
  READONLY_VIOLATION: 5,
  AI_DISABLED: 5,
  AUTH_REQUIRED: 6,
  AUTH_INVALID_CREDENTIALS: 6,
  AUTH_TOKEN_INVALID: 6,
  AUTH_TOKEN_EXPIRED: 6,
  CONFLICT: 7,
  CONNECTION_FAILED: 8,
  QUERY_TIMEOUT: 8,
  CONFIRMATION_REQUIRED: 9,
  AUTH_ACCOUNT_DISABLED: 10,
  AUTH_ACCOUNT_LOCKED: 10,
  MIGRATION_FAILED: 11,
  AI_PROVIDER_ERROR: 12,
  QUERY_CANCELLED: 130,
  // 默认口令强制改密闸门（HTTP 403）。docs/cli-reference.md §1.7 没有单列该码，
  // 归入既有语义最接近的"权限不足（5）"；CLI 另外会打印可操作的修复指引。
  PASSWORD_CHANGE_REQUIRED: 5,
};

export interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
  code?: string;
  message?: string;
}

export class CliError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.exitCode = EXIT_CODES[code as ErrorCode] ?? 1;
    this.details = details;
  }
}

export interface ClientOptions {
  server: string;
  token?: string | undefined;
  tokenFile?: string | undefined;
  dataDir: string;
  timeoutMs: number;
  insecure?: boolean;
  verbose?: boolean;
}

export interface ApiResponse<T> {
  status: number;
  data: T;
}

/** --insecure 的警告只打印一次，避免每个请求都刷屏。 */
let insecureWarned = false;

/**
 * --insecure 的兜底实现：仅当目标是 https 时走 node:https 并关闭证书校验。
 *
 * 为什么不用 undici 的 Agent({ connect: { rejectUnauthorized: false } })：
 * apps/cli 刻意不新增任何运行依赖，而 Node 内置的 fetch 只接受 undici Dispatcher，
 * 在不 import 'undici' 的情况下拿不到 Agent 类。node:https 同样能精确做到
 * "只跳过证书校验"这一件事，而且不会像 NODE_TLS_REJECT_UNAUTHORIZED=0 那样
 * 污染整个进程的 TLS 行为。非 https/未开 --insecure 时仍走内置 fetch，行为不变。
 */
function insecureHttpsRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; text: () => Promise<string> }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { method, headers, rejectUnauthorized: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk as Uint8Array)));
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ ok: status >= 200 && status < 300, status, text: async () => text });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`请求超时（${timeoutMs}ms）`)));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** 解析令牌：命令行 > 令牌文件 > 环境变量 > 数据目录下的 cli-token */
export function resolveToken(options: ClientOptions): string | null {
  if (options.token) return options.token.trim();
  if (options.tokenFile) {
    if (!existsSync(options.tokenFile)) {
      throw new CliError('VALIDATION_FAILED', `令牌文件不存在: ${options.tokenFile}`);
    }
    return readFileSync(options.tokenFile, 'utf8').trim();
  }
  const fromEnv = process.env['PEANUTSPROUT_TOKEN'];
  if (fromEnv) return fromEnv.trim();
  const stored = join(options.dataDir, 'cli-token');
  if (existsSync(stored)) return readFileSync(stored, 'utf8').trim();
  return null;
}

/** 保存令牌到数据目录（0600），供后续命令免密使用 */
export function saveToken(dataDir: string, token: string): string {
  const path = join(dataDir, 'cli-token');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, token, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* Windows 等平台忽略 */
  }
  return path;
}

export function defaultDataDir(): string {
  return process.env['PEANUTSPROUT_HOME'] || join(homedir(), '.peanutsprout');
}

export class ApiClient {
  constructor(private readonly options: ClientOptions) {}

  private url(path: string): string {
    const base = this.options.server.replace(/\/+$/, '');
    return `${base}/api/v1${path.startsWith('/') ? path : `/${path}`}`;
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    init: { raw?: boolean } = {},
  ): Promise<ApiResponse<T>> {
    const token = resolveToken(this.options);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers['authorization'] = `Bearer ${token}`;

    const url = this.url(path);
    // --insecure 只对 https 有意义；对 http 目标保持静默，避免误导。
    // 自签名证书场景下 fetch 会直接抛 UNABLE_TO_VERIFY_LEAF_SIGNATURE，
    // 必须换用关闭校验的 node:https 才能真正连上。
    const useInsecure = this.options.insecure === true && url.startsWith('https:');
    if (useInsecure && !insecureWarned) {
      insecureWarned = true;
      process.stderr.write('⚠️  已启用 --insecure：本次连接跳过 TLS 证书校验，仅应用于可信内网的自签名服务端\n');
    }
    if (this.options.verbose && !useInsecure) {
      // 调试日志只打印方法/URL/状态与耗时，绝不打印 Authorization 头或请求体，
      // 否则 --verbose 会把令牌和口令写进终端与 CI 日志。
      process.stderr.write(`[debug] ${method} ${url}\n`);
    }

    const startedAt = Date.now();
    let response: { ok: boolean; status: number; text: () => Promise<string> };
    try {
      response = useInsecure
        ? await insecureHttpsRequest(
            url,
            method,
            headers,
            body !== undefined ? JSON.stringify(body) : undefined,
            this.options.timeoutMs,
          )
        : await fetch(url, {
            method,
            headers,
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(this.options.timeoutMs),
          });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      throw new CliError(
        'CONNECTION_FAILED',
        `无法连接服务端 ${this.options.server}：${reason}\n提示：先执行 peanutsprout serve 启动服务端，或用 --server 指定地址`,
      );
    }

    if (this.options.verbose) {
      process.stderr.write(`[debug] ${method} ${url} -> ${response.status} (${Date.now() - startedAt}ms)\n`);
    }

    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!response.ok) {
      const err = (payload ?? {}) as ApiErrorBody;
      const code = err.error?.code ?? err.code ?? 'INTERNAL';
      const message = err.error?.message ?? err.message ?? `HTTP ${response.status}`;
      throw new CliError(code, message, err.error?.details);
    }

    if (init.raw) return { status: response.status, data: text as unknown as T };
    return { status: response.status, data: payload as T };
  }

  get<T = unknown>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path);
  }

  post<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, body);
  }

  put<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('PUT', path, body);
  }

  delete<T = unknown>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', path);
  }
}

/** 把错误统一转成退出码与 stderr 输出 */
export function reportError(error: unknown, quiet = false): number {
  if (error instanceof CliError) {
    if (!quiet) process.stderr.write(`✖ ${error.message}\n`);
    else process.stderr.write(`${error.message}\n`);
    if (error.details !== undefined && !quiet) {
      process.stderr.write(`  详情：${JSON.stringify(error.details)}\n`);
    }
    // 默认口令闸门必须给出可执行的下一步，否则用户只看到"权限不足"会以为是权限配置问题；
    // 登录接口本身不受闸门限制，所以用户完全可能已经登录却什么也做不了。
    if (error.code === 'PASSWORD_CHANGE_REQUIRED') {
      process.stderr.write('提示：当前仍在使用初始口令，请先执行：peanutsprout passwd\n');
    }
    return error.exitCode;
  }
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`✖ ${message}\n`);
  return 1;
}
