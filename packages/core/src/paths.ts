/**
 * 花生苗数据库管理工具 - 路径与产品元信息
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { existsSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const PRODUCT = {
  nameZh: '花生苗数据库管理工具',
  nameEn: 'PeanutSprout DB Manager',
  short: '花生苗',
  author: '飞哥',
  wechat: '6731663',
  license: 'AGPL-3.0-or-later',
  licenseFull: 'GNU Affero General Public License v3.0',
  version: '0.1.0',
  homepage: 'https://github.com/peanutsprout/peanutsprout',
} as const;

export const APP_ID = 'peanutsprout';
export const DB_FILENAME = 'peanutsprout.db';
export const MASTER_KEY_FILENAME = 'master.key';
export const LOG_DIR = 'logs';
export const BACKUP_DIR = 'backups';

/** 配置目录：~/.peanutsprout/ （PRD 第六部分命名规范）。 */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env['PEANUTSPROUT_HOME'];
  if (fromEnv && fromEnv.trim()) return resolve(fromEnv.trim());
  return join(homedir(), '.peanutsprout');
}

export function resolveDbPath(dataDir?: string): string {
  const dir = dataDir ?? resolveDataDir();
  const fromEnv = process.env['PEANUTSPROUT_DB'];
  if (fromEnv && fromEnv.trim()) return resolve(fromEnv.trim());
  return join(dir, DB_FILENAME);
}

export function resolveMasterKeyPath(dataDir?: string): string {
  const dir = dataDir ?? resolveDataDir();
  const fromEnv = process.env['PEANUTSPROUT_MASTER_KEY'];
  if (fromEnv && fromEnv.trim()) return resolve(fromEnv.trim());
  return join(dir, MASTER_KEY_FILENAME);
}

/**
 * 创建数据目录并收紧权限（0700）。本地 SQLite 与其主密钥都放在这里，
 * 权限过宽等于把加密连接配置直接暴露给同机其他用户。
 */
export function ensureDataDir(dataDir?: string): string {
  const dir = dataDir ?? resolveDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Windows 上 chmod 基本无效，忽略即可（ACL 由安装程序负责）
  }
  return dir;
}

/**
 * 被视为「生产环境」的颜色标记集合。
 *
 * 契约：Web 端连接表单的颜色选择器写入的是**十六进制色值**而不是符号名
 * （见 apps/web/src/pages/ConnectionsPage.tsx 的 COLOR_TAGS），红色为 '#d1524a'。
 * 早期这里只认 'red' / 'prod' / 'production'，于是用户在界面上把生产库标红后
 * isProductionLike 恒为 false —— AI 生成写语句时不要求二次确认，
 * /meta/production-check 也返回 production:false，安全闸门被静默绕过。
 *
 * 为保证历史数据（符号值）与旧版本写入的值继续有效，两套写法都保留；
 * 比较前统一 trim + toLowerCase，兼容 '#D1524A' 之类的大小写差异。
 * apps/web/src/utils/connectionColors.test.ts 会断言界面里的红色色值确实在集合内，
 * 防止将来换了主色而这里忘记同步。
 */
export const PRODUCTION_COLOR_TAGS: readonly string[] = [
  'red',
  'prod',
  'production',
  '#d1524a',
];

export function isProductionLike(colorTag?: string | null, name?: string | null): boolean {
  const tag = (colorTag ?? '').trim().toLowerCase();
  if (PRODUCTION_COLOR_TAGS.includes(tag)) return true;
  const n = (name ?? '').toLowerCase();
  return /(^|[^a-z])(prod|production|线上|生产)([^a-z]|$)/.test(n);
}
