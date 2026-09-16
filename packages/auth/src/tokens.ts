/**
 * 花生苗数据库管理工具 - JWT（HS256）签发与校验
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 自行实现而不引入第三方 JWT 库，理由：
 *  1) 只用到 HS256 一种算法，实现面极小、可完整审计；
 *  2) 减少运行时依赖，契合「零环境依赖」目标。
 * 安全要点：严格校验 alg（拒绝 none/RS256 混淆攻击）、恒定时间比较签名、强制 exp。
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const JWT_ALG = 'HS256';
export const JWT_ISSUER = 'peanutsprout';

export interface JwtPayload {
  /** 用户 id */
  sub: number;
  /** 会话 id，用于吊销 */
  sid: string;
  username: string;
  /** 签发时间（秒） */
  iat: number;
  /** 过期时间（秒） */
  exp: number;
  iss: string;
}

export type VerifyResult =
  | { ok: true; payload: JwtPayload }
  | { ok: false; reason: 'malformed' | 'bad-alg' | 'bad-signature' | 'expired' | 'invalid-payload' };

const b64url = (buf: Buffer | string): string => Buffer.from(buf).toString('base64url');

const sign = (data: string, secret: string): string =>
  createHmac('sha256', secret).update(data).digest('base64url');

export function signToken(
  payload: Omit<JwtPayload, 'iat' | 'exp' | 'iss'>,
  secret: string,
  ttlSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const full: JwtPayload = {
    ...payload,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
    iss: JWT_ISSUER,
  };
  const header = b64url(JSON.stringify({ alg: JWT_ALG, typ: 'JWT' }));
  const body = b64url(JSON.stringify(full));
  const data = `${header}.${body}`;
  return `${data}.${sign(data, secret)}`;
}

export function verifyToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): VerifyResult {
  if (typeof token !== 'string') return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [headerB64, bodyB64, signature] = parts as [string, string, string];

  let header: { alg?: string; typ?: string };
  let payload: JwtPayload;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  // 关键：先校验算法再验签，杜绝 alg=none / 算法混淆
  if (header.alg !== JWT_ALG || header.typ !== 'JWT') return { ok: false, reason: 'bad-alg' };

  const expected = sign(`${headerB64}.${bodyB64}`, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad-signature' };

  if (
    typeof payload?.sub !== 'number' ||
    typeof payload?.sid !== 'string' ||
    typeof payload?.exp !== 'number' ||
    typeof payload?.iat !== 'number'
  ) {
    return { ok: false, reason: 'invalid-payload' };
  }
  if (payload.iss !== JWT_ISSUER) return { ok: false, reason: 'invalid-payload' };
  if (payload.exp <= nowSeconds) return { ok: false, reason: 'expired' };

  return { ok: true, payload };
}

/** 从主密钥派生 JWT 签名密钥；主密钥轮换即等价于全量令牌失效。 */
export function deriveJwtSecret(masterKey: Buffer): string {
  return createHmac('sha256', masterKey).update('peanutsprout/jwt/hs256/v1').digest('base64url');
}
