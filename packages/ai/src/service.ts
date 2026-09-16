/**
 * 花生苗数据库管理工具 - AI 助手服务
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 统一编排：开关检查 → 取配置/密钥 → 脱敏 → 调用模型 → 解析 → 记录历史与审计。
 * 所有场景都会写 ai_history 与 audit_logs（PRD 4.5「所有 AI 操作记入操作日志」）。
 */

import {
  PeanutError,
  normalizeError,
  type AiConfig,
  type AiProviderKind,
  type AiAnswerResult,
  type AiRequestContext,
  type AiScene,
  type DiagnosisResult,
  type ExecutionPlan,
  type OptimizationResult,
  type SqlGenerationResult,
} from '@peanutsprout/core';
import { DEFAULT_BASE_URLS, type PeanutDatabase } from '@peanutsprout/storage';
import { RedactionGateway } from './redaction.js';
import { chat, extractJson, listModels, type ChatMessage, type ChatResponse, type FetchLike } from './provider.js';
import {
  askPrompt,
  diagnosePrompt,
  documentPrompt,
  explainPrompt,
  nl2sqlPrompt,
  optimizePrompt,
  type PromptBundle,
} from './prompts.js';

export interface AiActor {
  userId: number;
  username: string;
}

export interface AiServiceOptions {
  pdb: PeanutDatabase;
  fetchImpl?: FetchLike;
  redaction?: RedactionGateway;
}

/**
 * `/ai/ask` 的结果。类型直接复用 `@peanutsprout/core` 的契约定义，
 * 避免这里和 core 各写一份、日后漂移。
 */
export type AskResult = AiAnswerResult;

/**
 * 场景调用钩子：把本次写入 `ai_history` 的记录 id 回传给调用方。
 *
 * 为什么需要它：界面上的"撤回这条消息 / 撤回到某一次操作"必须能定位到
 * 服务端那条调用记录并删除，否则撤回只改了本地气泡、历史列表里还留着。
 * 用回调而不是"事后查最大 id"：后者在同用户并发请求时会把别人的记录删掉。
 */
export interface AiSceneHooks {
  onHistory?: (historyId: number) => void;
}

export class AiService {
  private readonly pdb: PeanutDatabase;
  private readonly fetchImpl: FetchLike;
  readonly redaction: RedactionGateway;

  constructor(options: AiServiceOptions) {
    this.pdb = options.pdb;
    this.fetchImpl = options.fetchImpl ?? fetch;
    // 注意：**不在这里读取 `ai.redaction_enabled`**。该设置是运行时可写的，
    // 若在构造时读一次并固化成 RedactionGateway 的 enabled，之后管理员打开开关
    // 也不会生效，但 /ai/status 与 /ai/ask 的 redactionApplied 读的是实时值，
    // 于是界面/审计会误报"已脱敏"而数据其实明文出网。
    // 是否脱敏改由 `redactionEnabled` 在每次调用时读取，见 answerQuestion。
    this.redaction = options.redaction ?? new RedactionGateway();
  }

  /**
   * 脱敏开关的**实时**状态：每次都重新读设置。
   * 与 apps/server 的 `/ai/status`、`/ai/ask` 里 `redactionApplied` 读的是同一个键，
   * 保证"实际行为"和"回报给用户/审计的状态"一致。
   */
  get redactionEnabled(): boolean {
    return this.pdb.settings.getBoolean('ai.redaction_enabled', true);
  }

  get enabled(): boolean {
    return this.pdb.settings.getBoolean('ai.enabled', false);
  }

  /** 未配置任何模型时不报错，仅返回 null，让界面提示"请先配置 AI"。 */
  activeConfig(): AiConfig | null {
    return this.pdb.aiConfigs.getDefaultWithKey();
  }

  private assertReady(): AiConfig & { apiKey: string | null } {
    if (!this.enabled) {
      throw new PeanutError('AI_DISABLED', 'AI 功能当前已关闭，可在「设置 → AI」中启用');
    }
    const config = this.pdb.aiConfigs.getDefaultWithKey();
    if (!config) {
      throw new PeanutError('AI_PROVIDER_ERROR', '尚未配置任何可用的大模型，请先在「设置 → AI」中添加');
    }
    return config;
  }

  /** 统一执行入口：负责历史、审计、错误归一化。 */
  private async runScene(
    scene: AiScene,
    actor: AiActor,
    bundle: PromptBundle,
    config: AiConfig & { apiKey: string | null },
    hooks?: AiSceneHooks,
  ): Promise<ChatResponse> {
    const started = Date.now();
    const promptText = bundle.messages.map((m) => `${m.role}: ${m.content}`).join('\n\n');
    try {
      const response = await chat(
        {
          provider: config.provider as AiProviderKind,
          model: config.modelName,
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          messages: bundle.messages,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          timeoutMs: config.timeoutMs,
          extraParams: config.extraParams,
        },
        this.fetchImpl,
      );

      const historyId = this.pdb.aiConfigs.appendHistory({
        userId: actor.userId,
        configId: config.id,
        scene,
        prompt: promptText.slice(0, 20_000),
        response: response.text.slice(0, 20_000),
        tokensInput: response.tokensInput,
        tokensOutput: response.tokensOutput,
        durationMs: Date.now() - started,
        status: 'success',
      });
      hooks?.onHistory?.(historyId);
      this.pdb.audit.append({
        userId: actor.userId,
        username: actor.username,
        action: 'ai',
        resourceType: 'ai_scene',
        resourceId: scene,
        status: 'success',
        durationMs: Date.now() - started,
        detail: {
          provider: config.provider,
          model: config.modelName,
          tokensInput: response.tokensInput,
          tokensOutput: response.tokensOutput,
          redactionNotes: bundle.notes,
        },
      });
      return response;
    } catch (e) {
      const err = normalizeError(e);
      const historyId = this.pdb.aiConfigs.appendHistory({
        userId: actor.userId,
        configId: config.id,
        scene,
        prompt: promptText.slice(0, 20_000),
        response: null,
        durationMs: Date.now() - started,
        status: 'failed',
      });
      hooks?.onHistory?.(historyId);
      this.pdb.audit.append({
        userId: actor.userId,
        username: actor.username,
        action: 'ai',
        resourceType: 'ai_scene',
        resourceId: scene,
        status: 'failed',
        errorMessage: err.message,
        durationMs: Date.now() - started,
        detail: { provider: config.provider, model: config.modelName },
      });
      throw err;
    }
  }

  /** 自然语言转 SQL。生成结果**不会**自动执行，必须由用户确认后走 /query/execute。 */
  async generateSql(
    naturalLanguage: string,
    context: AiRequestContext,
    actor: AiActor,
    hooks?: AiSceneHooks,
  ): Promise<SqlGenerationResult> {
    if (!naturalLanguage.trim()) throw new PeanutError('VALIDATION_FAILED', '请输入自然语言需求');
    const config = this.assertReady();
    const response = await this.runScene('nl2sql', actor, nl2sqlPrompt(naturalLanguage, context), config, hooks);

    const parsed = extractJson<{
      sql?: string;
      explanation?: string;
      confidence?: number;
      referencedTables?: string[];
      requiresConfirmation?: boolean;
    }>(response.text);

    if (!parsed) {
      // 模型没按 JSON 返回时，退化为"把整段输出当作解释 + 提取 SQL 代码块"
      const fenced = /```(?:sql)?\s*([\s\S]*?)```/i.exec(response.text);
      const sql = fenced?.[1]?.trim() ?? '';
      return {
        sql,
        explanation: response.text,
        confidence: sql ? 0.4 : 0,
        referencedTables: [],
        // 解析失败意味着不可信，一律要求人工确认
        requiresConfirmation: true,
        raw: response.text,
      };
    }

    const sql = (parsed.sql ?? '').trim();
    return {
      sql,
      explanation: parsed.explanation ?? '',
      confidence: typeof parsed.confidence === 'number' ? Math.min(Math.max(parsed.confidence, 0), 1) : 0.5,
      referencedTables: Array.isArray(parsed.referencedTables) ? parsed.referencedTables.map(String) : [],
      requiresConfirmation: parsed.requiresConfirmation ?? true,
      raw: response.text,
    };
  }

  async explainSql(sql: string, actor: AiActor, hooks?: AiSceneHooks): Promise<string> {
    if (!sql.trim()) throw new PeanutError('VALIDATION_FAILED', '请提供要解释的 SQL');
    const config = this.assertReady();
    const response = await this.runScene('explain', actor, explainPrompt(sql), config, hooks);
    return response.text;
  }

  async optimizeSql(
    sql: string,
    plan: ExecutionPlan | null,
    actor: AiActor,
    hooks?: AiSceneHooks,
  ): Promise<OptimizationResult> {
    if (!sql.trim()) throw new PeanutError('VALIDATION_FAILED', '请提供要优化的 SQL');
    const config = this.assertReady();
    const response = await this.runScene('optimize', actor, optimizePrompt(sql, plan), config, hooks);
    type SuggestionShape = { title?: string; detail?: string; rewrittenSql?: string; severity?: string };
    const parsed = extractJson<{ suggestions?: SuggestionShape[] } | SuggestionShape[]>(response.text);
    // 模型有时会直接返回裸数组，有时会包一层 { suggestions: [...] }，两种都接受
    const list = Array.isArray(parsed) ? parsed : parsed?.suggestions;
    if (!Array.isArray(list) || list.length === 0) {
      return { suggestions: [{ title: '模型输出', detail: response.text, severity: 'info' }], raw: response.text };
    }
    return {
      suggestions: list.map((s) => ({
        title: s.title ?? '优化建议',
        detail: s.detail ?? '',
        ...(s.rewrittenSql ? { rewrittenSql: s.rewrittenSql } : {}),
        severity: (s.severity === 'critical' || s.severity === 'warning' ? s.severity : 'info') as
          | 'info'
          | 'warning'
          | 'critical',
      })),
      raw: response.text,
    };
  }

  async generateDocumentation(context: AiRequestContext, actor: AiActor, hooks?: AiSceneHooks): Promise<string> {
    const config = this.assertReady();
    const response = await this.runScene('document', actor, documentPrompt(context), config, hooks);
    return response.text;
  }

  /**
   * 结果集问答：先把结果集按脱敏规则处理，再发送。
   *
   * 返回值里带上 `redactionApplied`，是**本次实际生效**的开关状态。
   * 调用方（HTTP 路由）不要再去读一次设置：两次读之间管理员可能刚好改了开关，
   * 那样"回报给用户的状态"就会和"真正发出去的内容"不一致 ——
   * 一个声称已脱敏、实际发了明文的响应，比不报告更危险。
   */
  async answerQuestion(
    question: string,
    context: AiRequestContext,
    actor: AiActor,
    hooks?: AiSceneHooks,
  ): Promise<AskResult> {
    if (!question.trim()) throw new PeanutError('VALIDATION_FAILED', '请输入问题');
    const config = this.assertReady();

    let safeContext = context;
    const notes: string[] = [];
    // 发送前读取一次当前设置，让"是否脱敏"随设置页的改动即时生效。
    const redactionEnabled = this.redactionEnabled;
    if (context.resultColumns && context.resultRows) {
      const { rows, report } = this.redaction.redactRows(
        context.resultColumns,
        context.resultRows,
        redactionEnabled,
      );
      safeContext = { ...context, resultRows: rows };
      if (!redactionEnabled) {
        // 关键：把"本次未脱敏"写进审计，避免事后看到记录却误以为结果集已脱敏
        notes.push('脱敏已关闭：结果集未做脱敏处理');
      } else if (report.redactedCells > 0) {
        notes.push(
          `已脱敏 ${report.redactedCells} 个单元格，涉及列：${report.matchedColumns.join(', ')}`,
        );
      } else {
        notes.push('脱敏已开启，但未命中敏感列');
      }
    }

    const bundle = askPrompt(question, safeContext, redactionEnabled);
    const response = await this.runScene('ask', actor, { ...bundle, notes }, config, hooks);
    return {
      text: response.text,
      redactionApplied: redactionEnabled,
      redactionNotes: notes,
    };
  }

  async diagnoseError(error: string, sql: string, actor: AiActor, hooks?: AiSceneHooks): Promise<DiagnosisResult> {
    const config = this.assertReady();
    const response = await this.runScene('diagnose', actor, diagnosePrompt(error, sql), config, hooks);
    const parsed = extractJson<{ cause?: string; suggestions?: string[] }>(response.text);
    return {
      cause: parsed?.cause ?? response.text,
      suggestions: Array.isArray(parsed?.suggestions) ? parsed.suggestions.map(String) : [],
      raw: response.text,
    };
  }

  /** 供界面在发送前预览将要使用的消息（不含密钥），便于用户知情。 */
  previewMessages(scene: AiScene, payload: unknown): ChatMessage[] {
    switch (scene) {
      case 'nl2sql':
        return nl2sqlPrompt(String((payload as { prompt?: string })?.prompt ?? ''), (payload as AiRequestContext) ?? {}).messages;
      case 'explain':
        return explainPrompt(String((payload as { sql?: string })?.sql ?? '')).messages;
      default:
        return [];
    }
  }

  /**
   * 解析「连通性测试 / 列举模型」的目标配置。
   *
   * **刻意不走 `assertReady()`**：`assertReady` 会先检查 `ai.enabled`，而联调时
   * 用户正是"还没启用、想先测一下能不能连通"，若复用就会陷入
   * 「想测试 → 必须先启用 → 启用前不敢确认能连通」的死循环。
   * 因此这里只要求给得出配置，不看总开关。
   */
  private resolveProbeTarget(
    target: AiProbeTarget,
    // 列举模型时还不知道模型叫什么都正常，因此把这条要求做成可关的
    options: { requireModel?: boolean } = {},
  ): AiConfig & { apiKey: string | null } {
    const requireModel = options.requireModel ?? true;
    if ('configId' in target && target.configId !== undefined) {
      const found = this.pdb.aiConfigs.getWithKey(target.configId);
      if (!found) throw new PeanutError('NOT_FOUND', `AI 配置不存在: ${target.configId}`);
      return found;
    }
    const inline = target as AiInlineProbe;
    if (!inline.provider) throw new PeanutError('VALIDATION_FAILED', '请提供 provider');
    if (requireModel && !inline.modelName?.trim()) {
      throw new PeanutError('VALIDATION_FAILED', '请提供模型名称');
    }
    return {
      id: 0,
      name: inline.name ?? '（未保存）',
      provider: inline.provider as AiProviderKind,
      modelName: inline.modelName ?? '',
      // 没填 baseUrl 时回退到该供应商的默认地址，与保存时的行为保持一致
      baseUrl: inline.baseUrl?.trim() || DEFAULT_BASE_URLS[String(inline.provider)] || null,
      temperature: inline.temperature ?? 0.2,
      maxTokens: null,
      timeoutMs: inline.timeoutMs && inline.timeoutMs > 0 ? inline.timeoutMs : 20_000,
      isDefault: false,
      enabled: true,
      // 未保存的表单值没有落库，直接用"是否填了 key"表达
      hasApiKey: Boolean(inline.apiKey),
      extraParams: inline.extraParams ?? null,
      apiKey: inline.apiKey ?? null,
    };
  }

  /**
   * 连通性测试：真发一次最小请求，返回耗时与模型回执。
   * 失败时抛 `AI_PROVIDER_ERROR`（带 url / 响应体片段），由调用方转成界面提示。
   */
  async testConnection(target: AiProbeTarget): Promise<AiProbeResult> {
    const config = this.resolveProbeTarget(target);
    const started = Date.now();
    const response = await chat(
      {
        provider: config.provider as AiProviderKind,
        model: config.modelName,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        // 用最小 token 数试探，避免真的花掉一次完整生成的钱
        messages: [{ role: 'user', content: 'ping' }],
        temperature: 0,
        maxTokens: 8,
        timeoutMs: config.timeoutMs,
        extraParams: config.extraParams,
      },
      this.fetchImpl,
    );
    return {
      ok: true,
      latencyMs: Date.now() - started,
      provider: String(config.provider),
      model: config.modelName,
      reply: response.text.slice(0, 200),
    };
  }

  /** 列举供应商侧可用模型（用于下拉选择本地已下载的模型）。 */
  async listModels(target: AiProbeTarget): Promise<{ models: string[]; provider: string; baseUrl: string | null }> {
    const config = this.resolveProbeTarget(target, { requireModel: false });
    const models = await listModels(
      {
        provider: config.provider as AiProviderKind,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        timeoutMs: config.timeoutMs,
      },
      this.fetchImpl,
    );
    return { models, provider: String(config.provider), baseUrl: config.baseUrl };
  }
}

/** 连通性测试的目标：要么指向一条已保存配置，要么是表单里的临时值（保存前试连）。 */
export type AiProbeTarget = { configId: number } | AiInlineProbe;

export interface AiInlineProbe {
  provider?: string;
  modelName?: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  name?: string;
  temperature?: number;
  timeoutMs?: number;
  extraParams?: Record<string, unknown> | null;
}

export interface AiProbeResult {
  ok: true;
  latencyMs: number;
  provider: string;
  model: string;
  reply: string;
}
