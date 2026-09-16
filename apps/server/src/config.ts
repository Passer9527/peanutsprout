/**
 * 花生苗数据库管理工具 - 服务端配置
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 配置外置（PRD 5.5）：环境变量 > 默认值。所有键以 PEANUTSPROUT_ 前缀。
 */

import { resolveDataDir } from '@peanutsprout/core';

export interface ServerConfig {
  host: string;
  port: number;
  /**
   * host / port 是否由部署方**显式指定**（环境变量或 loadConfig 的 overrides）。
   *
   * 只在为 false 时，界面上的「允许局域网访问」设置才参与决定实际绑定地址。
   * 这条优先级的理由：`PEANUTSPROUT_HOST/PORT` 是 systemd/容器/桌面端主进程
   * 对"监听在哪"的硬性要求（桌面端还要靠它做实例身份校验），
   * 若能被人改一个界面开关就覆盖掉，运维的绑定策略与桌面端的端口探测都会失效。
   * 反过来说，桌面端想让界面开关生效，就得自己先读设置、再以环境变量传入。
   *
   * 为什么是可选：loadConfig 一定会填上真实取值；而单测里手写的配置字面量
   * 只关心被断言的那几个字段，强制它们写这两个开关纯属噪音。
   * 缺省（undefined）按 false 处理 —— 即"没有显式指定"，与引入本特性之前
   * 的行为一致，是这里唯一安全的默认方向。
   */
  hostExplicit?: boolean;
  portExplicit?: boolean;
  /** 数据目录 ~/.peanutsprout/ */
  dataDir: string;
  /**
   * 实例标识 nonce（可选）。
   *
   * 由**启动本服务的主进程**（如桌面端）通过 PEANUTSPROUT_INSTANCE_NONCE 传入，
   * 服务端会原样放进 /health 响应。桌面端据此确认"端口上应答的确实是我刚启动的那个
   * 子进程"，而不是恰好占用同一端口的其它程序或另一个用户的实例。
   * 普通部署不设置该变量，/health 也就不会包含它。
   */
  instanceNonce: string | null;
  /** 主密钥的主密码（可选） */
  masterPassword: string | null;
  /** 令牌有效期（秒） */
  tokenTtlSec: number;
  /** CORS 允许来源；`*` 表示全部（仅建议开发环境使用） */
  /** '*' 通配 / 明确来源列表 / true 表示反射请求来源（仅开发） */
  /** 显式配置的跨域来源；null 表示未配置，由 app.ts 回退到"仅允许本机来源"。 */
  corsOrigin: string | string[] | boolean | null;
  /** 是否托管 Web 端静态资源（桌面内嵌 / 一体化部署） */
  serveWeb: boolean;
  webDistPath: string | null;
  /** 首次启动自动创建的管理员 */
  bootstrapAdminUsername: string;
  bootstrapAdminPassword: string | null;
  /** 启动时打印的日志级别 */
  logLevel: string;
  /** HTTPS（直接终结 TLS 的场景；生产更推荐反向代理） */
  https: { keyPath: string; certPath: string } | null;
  /** 空闲连接回收阈值（毫秒），0 表示不回收 */
  idleConnectionMs: number;
  /**
   * 反向代理信任策略，直接透传给 Fastify 的 trustProxy。
   *
   * 默认 `false`：**默认不信任** X-Forwarded-*，req.ip 取 TCP 对端地址。
   * 这一默认值是安全关键——`trustProxy: true` 表示"信任任意来源的转发头"，
   * 于是任何能直连端口的人都能靠伪造 X-Forwarded-For 改掉审计里的 clientIp，
   * 也能靠不断变换该头绕过按 IP 计的登录限流（暴力破解防线）。
   * 只有**确实**部署在反向代理之后、且后端端口仅代理可达时，才应显式打开：
   *   PEANUTSPROUT_TRUST_PROXY=true                 信任全部代理（需配合仅代理可达）
   *   PEANUTSPROUT_TRUST_PROXY=10.0.0.0/8,127.0.0.1 只信任指定网段（更稳）
   */
  trustProxy: boolean | string[];
}

function envStr(key: string): string | undefined {
  const v = process.env[key];
  return v === undefined || v === '' ? undefined : v;
}

function envInt(key: string, fallback: number): number {
  const raw = envStr(key);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = envStr(key);
  if (raw === undefined) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

/**
 * 解析 PEANUTSPROUT_TRUST_PROXY。
 *
 * 接受 `true`/`1`（信任全部代理）、`false`/`0`/空（默认，不信任）、
 * 或逗号分隔的网段/地址列表（如 `10.0.0.0/8,127.0.0.1,::1`）。
 * 无法识别的值一律按"不信任"处理，并交由调用方日志提示——宁可日志里的
 * 来源 IP 是代理地址，也不能因为配置写错就变成可伪造。
 */
export function parseTrustProxy(raw: string | undefined): boolean | string[] {
  if (raw === undefined) return false;
  const v = raw.trim();
  if (v === '' || v === '0' || v.toLowerCase() === 'false') return false;
  if (v === '1' || v.toLowerCase() === 'true') return true;
  const list = v
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return list.length > 0 ? list : false;
}

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const corsRaw = envStr('PEANUTSPROUT_CORS_ORIGIN');
  const keyPath = envStr('PEANUTSPROUT_TLS_KEY');
  const certPath = envStr('PEANUTSPROUT_TLS_CERT');

  const envHost = envStr('PEANUTSPROUT_HOST');
  const envPort = envStr('PEANUTSPROUT_PORT');

  const base: ServerConfig = {
    host: envHost ?? '127.0.0.1',
    port: envInt('PEANUTSPROUT_PORT', 8787),
    // 显式指定 = 环境变量或调用方 overrides 给了值。两者都算"部署方的硬要求"，
    // 只有都没有时，界面上的局域网访问设置才能改变绑定地址。
    hostExplicit: envHost !== undefined || overrides.host !== undefined,
    portExplicit: envPort !== undefined || overrides.port !== undefined,
    dataDir: resolveDataDir(),
    masterPassword: envStr('PEANUTSPROUT_MASTER_PASSWORD') ?? null,
    instanceNonce: envStr('PEANUTSPROUT_INSTANCE_NONCE') ?? null,
    trustProxy: parseTrustProxy(envStr('PEANUTSPROUT_TRUST_PROXY')),
    tokenTtlSec: envInt('PEANUTSPROUT_TOKEN_TTL_SEC', 12 * 3600),
    corsOrigin: corsRaw ? (corsRaw === '*' ? '*' : corsRaw.split(',').map((s) => s.trim())) : null,
    serveWeb: envBool('PEANUTSPROUT_SERVE_WEB', true),
    webDistPath: envStr('PEANUTSPROUT_WEB_DIST') ?? null,
    bootstrapAdminUsername: envStr('PEANUTSPROUT_ADMIN_USERNAME') ?? 'admin',
    bootstrapAdminPassword: envStr('PEANUTSPROUT_ADMIN_PASSWORD') ?? null,
    logLevel: envStr('PEANUTSPROUT_LOG_LEVEL') ?? 'info',
    https: keyPath && certPath ? { keyPath, certPath } : null,
    idleConnectionMs: envInt('PEANUTSPROUT_IDLE_CONN_MS', 30 * 60_000),
  };

  return { ...base, ...overrides };
}
