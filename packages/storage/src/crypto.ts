/**
 * 花生苗数据库管理工具 - 加密与口令派生
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 全部基于 node:crypto，零第三方依赖：
 *  - 口令哈希：scrypt（PRD 原文为 bcrypt/argon2；scrypt 是标准库内置、
 *    抗 GPU/ASIC、无需原生编译，接口设计为可插拔以便后续接入 argon2id）
 *  - 字段加密：AES-256-GCM，每条记录独立随机 IV，认证标签随密文一起存储
 *  - 主密钥：~/.peanutsprout/master.key（0600），可选用主密码包裹
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { PeanutError } from '@peanutsprout/core';

// ---------------------------------------------------------------- 基础工具

export const sha256Hex = (input: string | Buffer): string =>
  createHash('sha256').update(input).digest('hex');

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export const newId = (): string => randomUUID();

export function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ---------------------------------------------------------------- scrypt 口令哈希

/**
 * scrypt 参数：N=2^15, r=8, p=1, keyLen=64。
 * 注意 maxmem 必须显式放大：128*N*r ≈ 33.5MB，超过 Node 默认 32MB 上限。
 */
export const SCRYPT_PARAMS = { N: 32_768, r: 8, p: 1, keyLen: 64, maxmem: 128 * 1024 * 1024 } as const;

/** 生成 `scrypt$N$r$p$saltB64$hashB64` 形态的口令哈希。 */
export function hashSecret(secret: string, params: typeof SCRYPT_PARAMS = SCRYPT_PARAMS): string {
  const salt = randomBytes(16);
  const hash = scryptSync(secret.normalize('NFKC'), salt, params.keyLen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: params.maxmem,
  });
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** 校验口令。任何格式异常都返回 false，不抛异常，避免把内部结构泄漏给调用方。 */
export function verifySecret(secret: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], 'base64');
    expected = Buffer.from(parts[5], 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  try {
    const actual = scryptSync(secret.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: Math.max(SCRYPT_PARAMS.maxmem, 128 * N * r * 2),
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * 口令最短长度。
 *
 * 取值 6 有两个原因：① 需求方指定的默认口令 `123456` 就是 6 位；
 * ② Web 端与各语言文案**早就写的是「至少 6 位」**
 * （`auth.validation.passwordMinLength`、`admin.settings.password.newHint` 等），
 * 而服务端此前校验 8 位 —— 界面说 6 位、接口却拒 6 位，属于前后端不一致的缺陷。
 * 现在统一到 6 位，以文案为准。
 */
export const MIN_PASSWORD_LENGTH = 6;

/** 口令长度上限，防止超长输入拖慢 scrypt。 */
export const MAX_PASSWORD_LENGTH = 256;

/**
 * 口令强度检查（PRD 4.6 用户体系）。返回 null 表示通过，否则返回中文错误说明。
 *
 * ⚠️ **相对 PRD 的刻意放宽**：此前的实现还要求「至少包含大写/小写/数字/符号中的两类」
 * 并拦截常见口令。但默认口令 `123456` 是纯数字、单类别，会被这两条规则同时拒绝 ——
 * 产品不能一边把 `123456` 作为默认口令发给用户，一边用自己的策略判定它非法。
 * 因此按需求方的选择放宽为**只校验长度**。
 *
 * 需要恢复严格策略时，把被注释掉的类别与常见口令两段加回来即可（并同步把
 * `MIN_PASSWORD_LENGTH` 调回 8）。
 */
export function checkPasswordStrength(password: string): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `密码长度至少 ${MIN_PASSWORD_LENGTH} 位`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `密码长度不能超过 ${MAX_PASSWORD_LENGTH} 位`;
  }
  // —— 以下为原 PRD 4.6 的严格规则，因默认口令 123456 会被其拒绝而暂不启用 ——
  // const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  // if (classes < 2) return '密码需至少包含大写字母、小写字母、数字、符号中的两类';
  // if (/^(password|admin|12345678|qwerty)/i.test(password)) return '密码过于常见，请更换';
  return null;
}

// ---------------------------------------------------------------- AES-256-GCM 字段加密

const MAGIC = Buffer.from([0x50, 0x53, 0x4b, 0x31]); // "PSK1"
const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + 1 + IV_LEN + TAG_LEN; // 33

export const AES_KEY_BYTES = 32;

/** 加密任意字符串，返回可直接写入 BLOB 列的 Buffer。 */
export function encryptString(plain: string, key: Buffer): Buffer {
  assertKey(key);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, Buffer.from([VERSION]), iv, tag, ciphertext]);
}

/**
 * 解密 BLOB。密文为空/格式不合法/密钥不匹配时返回 null 而不是抛异常，
 * 这样单个损坏的连接记录不会让整个列表接口 500。
 *
 * 注意：空字符串的密文长度恰好等于 HEADER_LEN，因此长度判断必须是 `<`，
 * 用 `<=` 会把"空口令"误判成"没有口令"。
 * 需要区分"没有值"与"解不开"的场景请用 decryptStringStrict。
 */
export function decryptString(blob: Buffer | Uint8Array | null | undefined, key: Buffer): string | null {
  if (!blob || blob.length < HEADER_LEN) return null;
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) return null;
  if (buf[MAGIC.length] !== VERSION) return null;
  const iv = buf.subarray(MAGIC.length + 1, MAGIC.length + 1 + IV_LEN);
  const tag = buf.subarray(MAGIC.length + 1 + IV_LEN, HEADER_LEN);
  const ciphertext = buf.subarray(HEADER_LEN);
  try {
    assertKey(key);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** 加密结构化数据（JSON）。 */
export function encryptJson(value: unknown, key: Buffer): Buffer {
  return encryptString(JSON.stringify(value ?? null), key);
}

/**
 * 严格解密：解不开就抛错，用于"静默降级会造成误导"的场景。
 * 典型例子是取连接口令——若主密钥不匹配，静默返回 null 会让用户
 * 看到"数据库认证失败"，而真正的原因是本机主密钥变了，极难排查。
 */
export function decryptStringStrict(blob: Buffer | Uint8Array | null | undefined, key: Buffer): string | null {
  if (!blob || blob.length < HEADER_LEN) return null;
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) return null;
  if (buf[MAGIC.length] !== VERSION) return null;

  const iv = buf.subarray(MAGIC.length + 1, MAGIC.length + 1 + IV_LEN);
  const tag = buf.subarray(MAGIC.length + 1 + IV_LEN, HEADER_LEN);
  const ciphertext = buf.subarray(HEADER_LEN);
  try {
    assertKey(key);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (e) {
    throw new PeanutError(
      'INTERNAL',
      '解密本机敏感字段失败：主密钥与数据不匹配（可能更换过 ~/.peanutsprout/master.key），请恢复原密钥或重新录入相关口令',
      { reason: e instanceof Error ? e.message : String(e) },
    );
  }
}

export function decryptJson<T = unknown>(blob: Buffer | Uint8Array | null | undefined, key: Buffer): T | null {
  const s = decryptString(blob, key);
  if (s === null) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== AES_KEY_BYTES) {
    throw new Error(`AES 主密钥必须是 ${AES_KEY_BYTES} 字节 Buffer，当前非法`);
  }
}

// ---------------------------------------------------------------- 主密钥管理

export type MasterKeyMode = 'plain' | 'password';

export interface MasterKeyFile {
  version: 1;
  mode: MasterKeyMode;
  /** mode=plain 时的原始密钥（base64） */
  key?: string;
  /** mode=password 时包裹密钥用的 KDF 参数与密文 */
  kdf?: { salt: string; N: number; r: number; p: number };
  wrapped?: string;
  createdAt: string;
}

export interface UnlockedMasterKey {
  key: Buffer;
  mode: MasterKeyMode;
}

/** 从主密码派生包裹密钥。 */
function deriveWrappingKey(
  password: string,
  salt: Buffer,
  params: { N: number; r: number; p: number },
): Buffer {
  return scryptSync(password.normalize('NFKC'), salt, AES_KEY_BYTES, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 128 * 1024 * 1024,
  });
}

function writeKeyFile(path: string, content: MasterKeyFile): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(content, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    /* Windows 上忽略 */
  }
}

function readKeyFile(path: string): MasterKeyFile {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as MasterKeyFile;
  if (parsed.version !== 1) throw new Error(`不支持的主密钥文件版本: ${String(parsed.version)}`);
  return parsed;
}

export function masterKeyExists(path: string): boolean {
  return existsSync(path);
}

/**
 * 创建主密钥文件。password 为空表示明文模式（密钥直接落盘，权限 0600）。
 * 传了 password 则用主密码包裹，文件泄露也无法直接解密连接口令。
 */
export function createMasterKeyFile(path: string, password?: string | null): UnlockedMasterKey {
  const key = randomBytes(AES_KEY_BYTES);
  if (password && password.length > 0) {
    const salt = randomBytes(16);
    const params = { N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p };
    const wrappingKey = deriveWrappingKey(password, salt, params);
    writeKeyFile(path, {
      version: 1,
      mode: 'password',
      kdf: { salt: salt.toString('base64'), ...params },
      wrapped: encryptString(key.toString('base64'), wrappingKey).toString('base64'),
      createdAt: new Date().toISOString(),
    });
    return { key, mode: 'password' };
  }
  writeKeyFile(path, {
    version: 1,
    mode: 'plain',
    key: key.toString('base64'),
    createdAt: new Date().toISOString(),
  });
  return { key, mode: 'plain' };
}

/** 读取并解锁主密钥；文件不存在时按需创建。 */
export function loadMasterKey(path: string, password?: string | null): UnlockedMasterKey {
  if (!masterKeyExists(path)) return createMasterKeyFile(path, password);
  const file = readKeyFile(path);
  if (file.mode === 'plain') {
    if (!file.key) throw new Error('主密钥文件损坏：缺少 key 字段');
    return { key: Buffer.from(file.key, 'base64'), mode: 'plain' };
  }
  if (!file.kdf || !file.wrapped) throw new Error('主密钥文件损坏：缺少 kdf/wrapped 字段');
  if (!password) {
    throw new Error('主密钥已用主密码保护，请提供主密码（PEANUTSPROUT_MASTER_PASSWORD 或交互输入）');
  }
  const wrappingKey = deriveWrappingKey(password, Buffer.from(file.kdf.salt, 'base64'), file.kdf);
  const raw = decryptString(Buffer.from(file.wrapped, 'base64'), wrappingKey);
  if (!raw) throw new Error('主密码错误，无法解锁主密钥');
  return { key: Buffer.from(raw, 'base64'), mode: 'password' };
}

/** 修改主密码：把主密钥重新包裹一次，连接口令无需重新加密。 */
export function changeMasterPassword(path: string, currentPassword: string | null, newPassword: string): void {
  const { key } = loadMasterKey(path, currentPassword);
  if (!newPassword) {
    writeKeyFile(path, {
      version: 1,
      mode: 'plain',
      key: key.toString('base64'),
      createdAt: new Date().toISOString(),
    });
    return;
  }
  const salt = randomBytes(16);
  const params = { N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p };
  const wrappingKey = deriveWrappingKey(newPassword, salt, params);
  writeKeyFile(path, {
    version: 1,
    mode: 'password',
    kdf: { salt: salt.toString('base64'), ...params },
    wrapped: encryptString(key.toString('base64'), wrappingKey).toString('base64'),
    createdAt: new Date().toISOString(),
  });
}
