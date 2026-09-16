/**
 * 花生苗数据库管理工具 - 口令与字段加密测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  changeMasterPassword,
  checkPasswordStrength,
  MIN_PASSWORD_LENGTH,
  createMasterKeyFile,
  decryptString,
  decryptStringStrict,
  encryptString,
  hashSecret,
  loadMasterKey,
  verifySecret,
} from './crypto.js';
// DEFAULT_ADMIN_PASSWORD 定义在包入口（引导逻辑所在处），不在 crypto 模块
import { DEFAULT_ADMIN_PASSWORD } from './index.js';

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ps-crypto-'));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('口令哈希（scrypt）', () => {
  it('哈希后可校验通过', () => {
    const stored = hashSecret('CorrectHorse123');
    expect(verifySecret('CorrectHorse123', stored)).toBe(true);
  });

  it('错误口令校验失败', () => {
    const stored = hashSecret('CorrectHorse123');
    expect(verifySecret('correcthorse123', stored)).toBe(false);
    expect(verifySecret('', stored)).toBe(false);
    expect(verifySecret('CorrectHorse1234', stored)).toBe(false);
  });

  it('相同口令每次哈希都不同（随机盐）', () => {
    const a = hashSecret('SamePassword1');
    const b = hashSecret('SamePassword1');
    expect(a).not.toBe(b);
    expect(verifySecret('SamePassword1', a)).toBe(true);
    expect(verifySecret('SamePassword1', b)).toBe(true);
  });

  it('哈希格式包含算法与参数，便于将来平滑升级 KDF', () => {
    const stored = hashSecret('Whatever123');
    const parts = stored.split('$');
    expect(parts[0]).toBe('scrypt');
    expect(parts).toHaveLength(6);
  });

  it('对空/损坏的存储值一律拒绝（不抛异常）', () => {
    expect(verifySecret('x', null)).toBe(false);
    expect(verifySecret('x', undefined)).toBe(false);
    expect(verifySecret('x', '')).toBe(false);
    expect(verifySecret('x', 'garbage')).toBe(false);
    expect(verifySecret('x', 'scrypt$1$2$3$bad')).toBe(false);
  });
});

describe('口令强度', () => {
  it('拒绝过短口令', () => {
    expect(checkPasswordStrength('Ab1')).not.toBeNull();
    expect(checkPasswordStrength('abc12')).not.toBeNull(); // 5 位
  });

  it('接受足够长的混合口令', () => {
    expect(checkPasswordStrength('Str0ng-Passw0rd!')).toBeNull();
  });

  // 需求方指定的默认口令就是 123456。这里把它钉成测试，防止有人"顺手"把
  // 强度策略收紧回去 —— 那会导致产品默认口令被自己的校验判为非法。
  it('接受产品默认口令 123456（需求方指定）', () => {
    expect(checkPasswordStrength(DEFAULT_ADMIN_PASSWORD)).toBeNull();
  });

  it('最短长度与 Web 端文案一致（6 位）', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(6);
    expect(checkPasswordStrength('a'.repeat(6))).toBeNull();
    expect(checkPasswordStrength('a'.repeat(5))).not.toBeNull();
  });

  it('拒绝超长口令', () => {
    expect(checkPasswordStrength('a'.repeat(257))).not.toBeNull();
  });
});

describe('字段加密（AES-256-GCM）', () => {
  const key = randomBytes(32);

  it('加解密往返一致', () => {
    const secret = 'postgres://user:p@ss@localhost:5432/db';
    expect(decryptString(encryptString(secret, key), key)).toBe(secret);
  });

  it('支持中文与空串', () => {
    expect(decryptString(encryptString('中文口令🔐', key), key)).toBe('中文口令🔐');
    expect(decryptString(encryptString('', key), key)).toBe('');
  });

  it('同一明文两次加密结果不同（随机 IV）', () => {
    const a = encryptString('same', key);
    const b = encryptString('same', key);
    expect(a.equals(b)).toBe(false);
  });

  it('密文中不含明文', () => {
    const blob = encryptString('supersecretvalue', key);
    expect(blob.toString('utf8')).not.toContain('supersecretvalue');
  });

  it('密文带 PSK1 魔数与版本号', () => {
    const blob = encryptString('x', key);
    expect(blob.subarray(0, 4).toString('ascii')).toBe('PSK1');
  });

  it('空字符串可正确往返（密文长度恰好等于头部长度）', () => {
    const blob = encryptString('', key);
    expect(blob).toHaveLength(33);
    expect(decryptString(blob, key)).toBe('');
  });

  it('用错误的密钥解密拿不到任何明文（失败关闭）', () => {
    const blob = encryptString('secret', key);
    // 权威实现选择"返回 null"而不是抛错，以免单条损坏记录打挂列表接口；
    // 关键在于绝不能返回原文。
    expect(decryptString(blob, randomBytes(32))).toBeNull();
  });

  it('篡改密文不会被解出原文', () => {
    const blob = encryptString('secret', key);
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 1] ^= 0xff;
    expect(decryptString(tampered, key)).toBeNull();
    // 严格模式对篡改同样必须报错，而不是悄悄放过
    expect(() => decryptStringStrict(tampered, key)).toThrow();
  });

  it('decryptStringStrict 在主密钥不匹配时抛错，避免静默降级', () => {
    const blob = encryptString('secret', key);
    expect(() => decryptStringStrict(blob, randomBytes(32))).toThrow(/主密钥/);
  });

  it('decryptStringStrict 正常路径与宽松版一致', () => {
    const blob = encryptString('secret', key);
    expect(decryptStringStrict(blob, key)).toBe('secret');
  });

  it('null/undefined 解密为 null', () => {
    expect(decryptString(null, key)).toBeNull();
    expect(decryptString(undefined, key)).toBeNull();
    expect(decryptStringStrict(null, key)).toBeNull();
  });
});

describe('主密钥文件', () => {
  it('首次创建后可用同一密码解锁', () => {
    const path = join(tempDir(), 'master.key');
    createMasterKeyFile(path, 'master-pass-1');
    const unlocked = loadMasterKey(path, 'master-pass-1');
    expect(unlocked.key).toHaveLength(32);
    expect(unlocked.mode).toBe('password');
  });

  it('错误密码无法解锁', () => {
    const path = join(tempDir(), 'master.key');
    createMasterKeyFile(path, 'master-pass-1');
    expect(() => loadMasterKey(path, 'wrong-pass')).toThrow();
  });

  it('密钥文件权限为 0600（仅属主可读写）', () => {
    const path = join(tempDir(), 'master.key');
    createMasterKeyFile(path, 'p');
    const mode = statSync(path).mode & 0o777;
    expect(mode & 0o077).toBe(0);
  });

  it('明文模式（无主密码）也能解锁', () => {
    const path = join(tempDir(), 'master.key');
    createMasterKeyFile(path, null);
    const unlocked = loadMasterKey(path, null);
    expect(unlocked.key).toHaveLength(32);
    expect(unlocked.mode).toBe('plain');
  });

  it('更换主密码后旧密码失效、新密码可用', () => {
    const path = join(tempDir(), 'master.key');
    createMasterKeyFile(path, 'old-pass');
    changeMasterPassword(path, 'old-pass', 'new-pass');
    expect(loadMasterKey(path, 'new-pass').key).toHaveLength(32);
    expect(() => loadMasterKey(path, 'old-pass')).toThrow();
  });
});
