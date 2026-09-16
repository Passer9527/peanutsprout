/**
 * 花生苗数据库管理工具 - AI 配置与调用历史仓库
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * API Key 一律 AES-256-GCM 加密落库，DTO 只暴露 hasApiKey 布尔值。
 */

import { PeanutError, notFound, type AiConfig, type AiProviderKind, type AiScene } from '@peanutsprout/core';
import { decryptString, encryptString } from '../crypto.js';
import { nowIso, parseJson, toIso, type LocalDatabase } from '../database.js';

interface AiConfigRow {
  id: number;
  name: string;
  provider: string;
  model_name: string;
  api_key_enc: Uint8Array | null;
  base_url: string | null;
  temperature: number;
  max_tokens: number | null;
  timeout_ms: number;
  is_default: number;
  enabled: number;
  extra_params: string | null;
  created_at: string;
  updated_at: string;
}

export interface AiConfigInput {
  name: string;
  provider: AiProviderKind | string;
  modelName: string;
  /**
   * API Key 三态（与 REST schema 的 `z.string().nullish()`、前端 `apiKey?: string | null` 对齐）：
   *  - `undefined`：保持不变（update）／不设置（create）
   *  - `null`：清空密钥
   *  - 非空字符串：设置／替换为新的密钥
   *
   * 空串（`''`）属于**非法输入**，一律抛 `VALIDATION_FAILED`：
   * 它既可能被理解成"清空"，也可能被理解成"保持不变"，含义不唯一；
   * 从前端注释看是按"保持不变"实现的，若存储层当成"清空"就会静默删掉密钥。
   * 与其替调用方猜，不如显式拒绝（前端本来也是"留空就不传该字段"）。
   */
  apiKey?: string | null;
  baseUrl?: string | null;
  temperature?: number;
  maxTokens?: number | null;
  timeoutMs?: number;
  isDefault?: boolean;
  enabled?: boolean;
  extraParams?: Record<string, unknown> | null;
}

/** 各家大模型的默认 Base URL（PRD 4.5 接入方式）。 */
export const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  ernie: 'https://qianfan.baidubce.com/v2',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  deepseek: 'https://api.deepseek.com/v1',
  ollama: 'http://127.0.0.1:11434/v1',
  'openai-compatible': '',
};

export class AiConfigRepository {
  constructor(
    private readonly db: LocalDatabase,
    private readonly key: Buffer,
  ) {}

  private toDTO(row: AiConfigRow): AiConfig {
    return {
      id: row.id,
      name: row.name,
      provider: row.provider as AiProviderKind,
      modelName: row.model_name,
      baseUrl: row.base_url,
      temperature: Number(row.temperature),
      maxTokens: row.max_tokens === null ? null : Number(row.max_tokens),
      timeoutMs: Number(row.timeout_ms),
      isDefault: Number(row.is_default) === 1,
      enabled: Number(row.enabled) === 1,
      extraParams: parseJson<Record<string, unknown> | null>(row.extra_params, null),
      hasApiKey: row.api_key_enc !== null && row.api_key_enc !== undefined,
    };
  }

  list(): AiConfig[] {
    return this.db
      .all<AiConfigRow>('SELECT * FROM ai_configs ORDER BY is_default DESC, id ASC')
      .map((r) => this.toDTO(r));
  }

  get(id: number): AiConfig | null {
    const row = this.db.get<AiConfigRow>('SELECT * FROM ai_configs WHERE id = ?', id);
    return row ? this.toDTO(row) : null;
  }

  /** 取默认配置，附带**已解密**的 API Key，仅在真正发起请求时调用。 */
  getDefaultWithKey(): (AiConfig & { apiKey: string | null }) | null {
    const row = this.db.get<AiConfigRow>(
      'SELECT * FROM ai_configs WHERE enabled = 1 ORDER BY is_default DESC, id ASC LIMIT 1',
    );
    if (!row) return null;
    return { ...this.toDTO(row), apiKey: decryptString(row.api_key_enc, this.key) };
  }

  getWithKey(id: number): (AiConfig & { apiKey: string | null }) | null {
    const row = this.db.get<AiConfigRow>('SELECT * FROM ai_configs WHERE id = ?', id);
    if (!row) return null;
    return { ...this.toDTO(row), apiKey: decryptString(row.api_key_enc, this.key) };
  }

  /**
   * 校验并加密 API Key。
   *
   * 三态语义见 `AiConfigInput.apiKey` 的注释；这里刻意**先判空再加密**，
   * 绝不把 `null` 强转成 `string` 传给 `encryptString`（否则 cipher.update(null)
   * 会抛 TypeError，最终变成 500 INTERNAL 而不是可理解的校验错误）。
   */
  private encryptApiKey(value: string | null | undefined): Uint8Array | null {
    if (value === undefined || value === null) return null;
    if (value === '') {
      throw new PeanutError(
        'VALIDATION_FAILED',
        'apiKey 不能为空串：undefined 表示保持不变，null 表示清空密钥',
      );
    }
    return encryptString(value, this.key);
  }

  create(input: AiConfigInput): AiConfig {
    const name = input.name?.trim();
    if (!name) throw new PeanutError('VALIDATION_FAILED', 'AI 配置名称不能为空');
    if (!input.modelName?.trim()) throw new PeanutError('VALIDATION_FAILED', '模型名称不能为空');
    const baseUrl = input.baseUrl?.trim() || DEFAULT_BASE_URLS[String(input.provider)] || null;
    // 新建没有"保持不变"的语义：null/undefined 都表示不设密钥，空串仍按非法处理。
    const apiKeyEnc = this.encryptApiKey(input.apiKey);

    const id = this.db.transaction(() => {
      if (input.isDefault) this.db.run('UPDATE ai_configs SET is_default = 0');
      const r = this.db.run(
        `INSERT INTO ai_configs
           (name, provider, model_name, api_key_enc, base_url, temperature, max_tokens,
            timeout_ms, is_default, enabled, extra_params)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        name,
        String(input.provider),
        input.modelName.trim(),
        apiKeyEnc,
        baseUrl,
        input.temperature ?? 0.2,
        input.maxTokens ?? null,
        input.timeoutMs ?? 60_000,
        input.isDefault ? 1 : 0,
        input.enabled === false ? 0 : 1,
        input.extraParams ? JSON.stringify(input.extraParams) : null,
      );
      return r.lastInsertRowid;
    });
    return this.get(id) as AiConfig;
  }

  update(id: number, patch: Partial<AiConfigInput>): AiConfig {
    const existing = this.get(id);
    if (!existing) throw notFound('AI 配置', id);
    const sets: string[] = [];
    const params: Array<string | number | Uint8Array | null> = [];
    const push = (col: string, value: string | number | Uint8Array | null): void => {
      sets.push(`${col} = ?`);
      params.push(value);
    };
    if (patch.name !== undefined) push('name', patch.name.trim());
    if (patch.provider !== undefined) push('provider', String(patch.provider));
    if (patch.modelName !== undefined) push('model_name', patch.modelName.trim());
    if (patch.baseUrl !== undefined) push('base_url', patch.baseUrl?.trim() || null);
    if (patch.temperature !== undefined) push('temperature', patch.temperature);
    if (patch.maxTokens !== undefined) push('max_tokens', patch.maxTokens ?? null);
    if (patch.timeoutMs !== undefined) push('timeout_ms', patch.timeoutMs);
    if (patch.enabled !== undefined) push('enabled', patch.enabled ? 1 : 0);
    if (patch.extraParams !== undefined) {
      push('extra_params', patch.extraParams ? JSON.stringify(patch.extraParams) : null);
    }
    // apiKey 三态：undefined 不变、null 清空、非空字符串替换；空串非法（抛 VALIDATION_FAILED）。
    // 旧实现把 '' 当"清空"，与界面注释"空串=保持原密钥不变"正好相反，
    // 任何按界面语义实现的客户端提交 '' 都会静默删掉已保存的密钥，因此这里显式拒绝。
    if (patch.apiKey !== undefined) {
      push('api_key_enc', this.encryptApiKey(patch.apiKey));
    }
    if (sets.length > 0) {
      this.db.run(`UPDATE ai_configs SET ${sets.join(', ')} WHERE id = ?`, ...params, id);
    }
    if (patch.isDefault) this.setDefault(id);
    return this.get(id) as AiConfig;
  }

  setDefault(id: number): void {
    if (!this.get(id)) throw notFound('AI 配置', id);
    this.db.transaction(() => {
      this.db.run('UPDATE ai_configs SET is_default = 0');
      this.db.run('UPDATE ai_configs SET is_default = 1 WHERE id = ?', id);
    });
  }

  delete(id: number): boolean {
    return this.db.run('DELETE FROM ai_configs WHERE id = ?', id).changes > 0;
  }

  // ------------------------------------------------------------ 调用历史

  appendHistory(input: {
    userId: number;
    configId: number | null;
    scene: AiScene | string;
    prompt?: string | null;
    response?: string | null;
    tokensInput?: number | null;
    tokensOutput?: number | null;
    durationMs?: number | null;
    status: string;
  }): number {
    return this.db.run(
      `INSERT INTO ai_history
         (user_id, config_id, scene, prompt, response, tokens_input, tokens_output, duration_ms, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.userId,
      input.configId,
      String(input.scene),
      input.prompt ?? null,
      input.response ?? null,
      input.tokensInput ?? null,
      input.tokensOutput ?? null,
      input.durationMs ?? null,
      input.status,
      nowIso(),
    ).lastInsertRowid;
  }

  /**
   * 统计某个用户的调用历史总条数。
   *
   * 为什么单独给一个 count：前端原先只能拿 `listHistory(limit).length` 当"总数"，
   * 那个值最大就是 limit，永远偏小；界面要么显示 0/1，要么在够到上限时被迫隐藏计数。
   * 有了真实总数，界面就能诚实地显示"已调用 N 次"。
   */
  countHistory(userId: number): number {
    const row = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_history WHERE user_id = ?', userId);
    return row?.n ?? 0;
  }

  /**
   * 撤回**一条**调用记录。
   *
   * 必须限定 `user_id`：否则任何人拿到一个递增 id 就能删掉别人的调用历史
   * （典型的 IDOR）。返回是否真的删到了行，让路由能区分"不存在"与"不是我的"。
   */
  deleteHistory(userId: number, id: number): boolean {
    return this.db.run('DELETE FROM ai_history WHERE id = ? AND user_id = ?', id, userId).changes > 0;
  }

  /**
   * 撤回到指定的一次操作：删掉这条**及其之后的全部**记录。
   *
   * 语义与界面上的"回退到这里"一致：对话被截断到那一刻，之后发生过的
   * 调用不再留在历史里。同样以 `user_id` 限定，避免跨用户删除。
   * 返回实际删除的行数。
   */
  deleteHistoryFrom(userId: number, id: number): number {
    // 先确认这条记录确实属于该用户，避免"用别人的 id 当水位线"删掉自己的记录
    const owned = this.db.get<{ id: number }>(
      'SELECT id FROM ai_history WHERE id = ? AND user_id = ?',
      id,
      userId,
    );
    if (!owned) return 0;
    return this.db.run('DELETE FROM ai_history WHERE user_id = ? AND id >= ?', userId, id).changes;
  }

  /** 撤回该用户的全部调用记录（界面上的"清空对话"）。返回删除行数。 */
  clearHistory(userId: number): number {
    return this.db.run('DELETE FROM ai_history WHERE user_id = ?', userId).changes;
  }

  listHistory(userId: number, limit = 50): Array<Record<string, unknown>> {
    return this.db
      .all<Record<string, unknown>>(
        `SELECT id, config_id, scene, prompt, response, tokens_input, tokens_output, duration_ms, status, created_at
         FROM ai_history WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
        userId,
        Math.min(Math.max(limit, 1), 500),
      )
      .map((r) => ({
        id: r['id'],
        configId: r['config_id'],
        scene: r['scene'],
        prompt: r['prompt'],
        response: r['response'],
        tokensInput: r['tokens_input'],
        tokensOutput: r['tokens_output'],
        durationMs: r['duration_ms'],
        status: r['status'],
        createdAt: toIso(r['created_at']) ?? '',
      }));
  }
}
