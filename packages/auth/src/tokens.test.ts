/**
 * 花生苗数据库管理工具 - JWT 令牌测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 手写 JWT 的风险集中在这里，所以重点覆盖：
 * 算法混淆（alg=none）、签名篡改、过期、issuer 校验、密钥轮换。
 */

import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { JWT_ISSUER, deriveJwtSecret, signToken, verifyToken } from './tokens.js';

const SECRET = deriveJwtSecret(randomBytes(32));
const CLAIMS = { sub: 1, sid: 'session-abc', username: 'admin' };

const b64url = (input: string): string => Buffer.from(input).toString('base64url');

describe('signToken / verifyToken', () => {
  it('签发的令牌可校验并还原载荷', () => {
    const token = signToken(CLAIMS, SECRET, 3600);
    const result = verifyToken(token, SECRET);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.sub).toBe(1);
    expect(result.payload.sid).toBe('session-abc');
    expect(result.payload.username).toBe('admin');
    expect(result.payload.iss).toBe(JWT_ISSUER);
    expect(result.payload.exp - result.payload.iat).toBe(3600);
  });

  it('令牌由三段组成', () => {
    expect(signToken(CLAIMS, SECRET, 60).split('.')).toHaveLength(3);
  });

  it('换一把密钥即失效（主密钥轮换 = 全量令牌失效）', () => {
    const token = signToken(CLAIMS, SECRET, 3600);
    const other = deriveJwtSecret(randomBytes(32));
    const result = verifyToken(token, other);
    expect(result).toEqual({ ok: false, reason: 'bad-signature' });
  });
});

describe('令牌攻击面', () => {
  it('alg=none 被拒绝（算法混淆攻击）', () => {
    const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const payload = b64url(
      JSON.stringify({ ...CLAIMS, iat: 1, exp: 9999999999, iss: JWT_ISSUER }),
    );
    const forged = `${header}.${payload}.`;
    expect(verifyToken(forged, SECRET)).toEqual({ ok: false, reason: 'bad-alg' });
  });

  it('把 HS256 改成 HS512 也被拒绝', () => {
    const header = b64url(JSON.stringify({ alg: 'HS512', typ: 'JWT' }));
    const payload = b64url(
      JSON.stringify({ ...CLAIMS, iat: 1, exp: 9999999999, iss: JWT_ISSUER }),
    );
    const data = `${header}.${payload}`;
    const sig = createHmac('sha512', SECRET).update(data).digest('base64url');
    expect(verifyToken(`${data}.${sig}`, SECRET)).toEqual({ ok: false, reason: 'bad-alg' });
  });

  it('篡改载荷后签名不匹配', () => {
    const token = signToken(CLAIMS, SECRET, 3600);
    const [header, , signature] = token.split('.') as [string, string, string];
    const evilPayload = b64url(
      JSON.stringify({ sub: 999, sid: 'x', username: 'root', iat: 1, exp: 9999999999, iss: JWT_ISSUER }),
    );
    expect(verifyToken(`${header}.${evilPayload}.${signature}`, SECRET)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('签名长度不同也安全拒绝（不会因长度比较提前返回）', () => {
    const token = signToken(CLAIMS, SECRET, 3600);
    const [header, payload] = token.split('.') as [string, string, string];
    expect(verifyToken(`${header}.${payload}.short`, SECRET)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('过期令牌被识别为 expired', () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    const token = signToken(CLAIMS, SECRET, 3600, past);
    expect(verifyToken(token, SECRET)).toEqual({ ok: false, reason: 'expired' });
  });

  it('边界：恰好到期的令牌视为过期', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signToken(CLAIMS, SECRET, 100, now);
    expect(verifyToken(token, SECRET, now + 100)).toEqual({ ok: false, reason: 'expired' });
    expect(verifyToken(token, SECRET, now + 99).ok).toBe(true);
  });

  it('结构非法直接拒绝', () => {
    expect(verifyToken('', SECRET)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyToken('a.b', SECRET)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyToken('a.b.c.d', SECRET)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyToken('not-base64.%%%.zzz', SECRET)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('issuer 不匹配被拒绝', () => {
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64url(
      JSON.stringify({ ...CLAIMS, iat: 1, exp: 9999999999, iss: 'evil-issuer' }),
    );
    const data = `${header}.${payload}`;
    const sig = createHmac('sha256', SECRET).update(data).digest('base64url');
    expect(verifyToken(`${data}.${sig}`, SECRET)).toEqual({ ok: false, reason: 'invalid-payload' });
  });

  it('缺少 sub/exp 等必需字段被拒绝', () => {
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64url(JSON.stringify({ iss: JWT_ISSUER, iat: 1, exp: 9999999999 }));
    const data = `${header}.${payload}`;
    const sig = createHmac('sha256', SECRET).update(data).digest('base64url');
    expect(verifyToken(`${data}.${sig}`, SECRET)).toEqual({ ok: false, reason: 'invalid-payload' });
  });
});

describe('deriveJwtSecret', () => {
  it('同一主密钥派生结果稳定', () => {
    const key = randomBytes(32);
    expect(deriveJwtSecret(key)).toBe(deriveJwtSecret(key));
  });

  it('不同主密钥派生结果不同', () => {
    expect(deriveJwtSecret(randomBytes(32))).not.toBe(deriveJwtSecret(randomBytes(32)));
  });

  it('派生的密钥不直接等于主密钥（域分离）', () => {
    const key = randomBytes(32);
    expect(deriveJwtSecret(key)).not.toBe(key.toString('base64url'));
  });
});
