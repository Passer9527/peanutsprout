/**
 * 花生苗数据库管理工具 - AI 配置仓库测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 重点覆盖 apiKey 的三态语义：
 *  - undefined = 保持不变
 *  - null      = 清空
 *  - 非空串    = 替换
 *  - 空串      = 非法（VALIDATION_FAILED），绝不能静默清空密钥
 *
 * 这是一条安全相关的回归：曾经 '空串' 会被当成"清空"，而界面注释把它理解成
 * "保持原密钥不变"，两者相反，按界面语义实现的客户端会把已保存的密钥删掉。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PeanutError } from '@peanutsprout/core';
import { openPeanutDatabase, type PeanutDatabase } from './index.js';

let pdb: PeanutDatabase;

beforeEach(() => {
  pdb = openPeanutDatabase({ memory: true });
});

afterEach(() => {
  pdb.close();
});

function createConfig(apiKey?: string | null): number {
  return pdb.aiConfigs.create({
    name: '测试配置',
    provider: 'openai',
    modelName: 'gpt-4o-mini',
    apiKey,
  }).id;
}

function storedKey(id: number): string | null {
  return pdb.aiConfigs.getWithKey(id)?.apiKey ?? null;
}

describe('AI 配置 · apiKey 三态语义', () => {
  it('create：非空字符串会被加密保存，并能解出原文', () => {
    const id = createConfig('sk-create-secret');
    expect(pdb.aiConfigs.get(id)?.hasApiKey).toBe(true);
    expect(storedKey(id)).toBe('sk-create-secret');
    // 落库必须是密文，不能是明文
    const row = pdb.db.get<{ api_key_enc: Uint8Array | null }>(
      'SELECT api_key_enc FROM ai_configs WHERE id = ?',
      id,
    );
    expect(row?.api_key_enc).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(row?.api_key_enc ?? []).toString('utf8')).not.toContain('sk-create-secret');
  });

  it('create：null / undefined 都表示不设置密钥', () => {
    expect(pdb.aiConfigs.get(createConfig(null))?.hasApiKey).toBe(false);
    expect(pdb.aiConfigs.get(createConfig(undefined))?.hasApiKey).toBe(false);
    expect(storedKey(1)).toBeNull();
    expect(storedKey(2)).toBeNull();
  });

  it('create：空串视为非法，抛 VALIDATION_FAILED', () => {
    expect(() => createConfig('')).toThrowError(PeanutError);
    expect(() => createConfig('')).toThrowError(/空串/);
    // 非法输入不应留下任何半成品配置
    expect(pdb.aiConfigs.list()).toHaveLength(0);
  });

  it('update(undefined)：保持原密钥不变', () => {
    const id = createConfig('sk-keep-me');
    pdb.aiConfigs.update(id, { name: '改名', apiKey: undefined });
    expect(pdb.aiConfigs.get(id)?.name).toBe('改名');
    expect(storedKey(id)).toBe('sk-keep-me');
    expect(pdb.aiConfigs.get(id)?.hasApiKey).toBe(true);
  });

  it('update(null)：清空密钥', () => {
    const id = createConfig('sk-to-clear');
    pdb.aiConfigs.update(id, { apiKey: null });
    expect(pdb.aiConfigs.get(id)?.hasApiKey).toBe(false);
    expect(storedKey(id)).toBeNull();
  });

  it('update(非空串)：替换为新密钥', () => {
    const id = createConfig('sk-old');
    pdb.aiConfigs.update(id, { apiKey: 'sk-new' });
    expect(storedKey(id)).toBe('sk-new');
    expect(pdb.aiConfigs.get(id)?.hasApiKey).toBe(true);
  });

  it('update(空串)：抛 VALIDATION_FAILED，且绝不能把已有密钥静默删掉', () => {
    const id = createConfig('sk-must-survive');
    expect(() => pdb.aiConfigs.update(id, { apiKey: '' })).toThrowError(/空串/);
    // 关键回归：空串既不是"清空"也不是"替换"，原密钥必须原封不动
    expect(storedKey(id)).toBe('sk-must-survive');
    expect(pdb.aiConfigs.get(id)?.hasApiKey).toBe(true);
  });

  it('update：非法 apiKey 与其它字段混在一起时整体不落库（不产生半更新）', () => {
    const id = createConfig('sk-original');
    expect(() => pdb.aiConfigs.update(id, { name: '不该生效的名字', apiKey: '' })).toThrowError(
      /空串/,
    );
    const after = pdb.aiConfigs.get(id);
    expect(after?.name).toBe('测试配置');
    expect(storedKey(id)).toBe('sk-original');
  });

  it('update(undefined)：完全没有 apiKey 字段时同样不动密钥', () => {
    const id = createConfig('sk-untouched');
    pdb.aiConfigs.update(id, { temperature: 0.9 });
    expect(storedKey(id)).toBe('sk-untouched');
  });
});
