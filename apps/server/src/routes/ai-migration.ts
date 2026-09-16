/**
 * 花生苗数据库管理工具 - AI 助手与数据迁移路由
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 安全底线（PRD 4.5 / 十一、风险）：
 *  1. AI 只负责"生成"，绝不自动执行；写操作必须由用户回到 SQL 编辑器确认；
 *  2. 生产库默认禁止 AI 写操作（assertAiWriteAllowed）；
 *  3. 结果集问答先经脱敏网关再出网；
 *  4. 所有 AI 调用与迁移动作都落审计日志。
 */

import { z } from 'zod';
import {
  PeanutError,
  isWriteStatement,
  normalizeError,
  notFound,
  type AiRequestContext,
  type MigrationRequest,
  isProductionLike,
} from '@peanutsprout/core';
import type { AiSceneHooks } from '@peanutsprout/ai';
import { assertAiWriteAllowed, assertCanWrite, assertConnectionVisible } from '@peanutsprout/auth';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { authOf, clientIp, parse, requireAuth } from '../http.js';

/**
 * 连通性测试与模型列举的公共入参。
 * 两种形态二选一：`configId` 指向已保存配置，或直接给表单临时值（保存前试连）。
 */
const probeSchema = z.object({
  configId: z.number().int().positive().optional(),
  provider: z.string().min(1).optional(),
  modelName: z.string().min(1).optional(),
  baseUrl: z.string().nullish(),
  apiKey: z.string().nullish(),
  name: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

type ProbeBody = z.infer<typeof probeSchema>;

function probeTargetOf(body: ProbeBody) {
  if (body.configId !== undefined) return { configId: body.configId };
  return {
    provider: body.provider,
    modelName: body.modelName,
    baseUrl: body.baseUrl ?? null,
    apiKey: body.apiKey ?? null,
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.timeoutMs !== undefined ? { timeoutMs: body.timeoutMs } : {}),
  };
}

/** 构造 AI 用的 schema 上下文；对表/列数量设上限，避免提示词无限膨胀。 */
async function buildSchemaContext(
  ctx: AppContext,
  connectionId: number,
  schema: string | null,
  tableNames: string[] | undefined,
): Promise<AiRequestContext> {
  const dto = ctx.pdb.connections.get(connectionId);
  if (!dto) throw notFound('连接', connectionId);
  const config = ctx.pdb.connections.getConfig(connectionId);
  if (!config) throw notFound('连接', connectionId);

  const MAX_TABLES = 50;
  const MAX_COLUMNS_PER_TABLE = 120;

  return ctx.manager.withConnection(config, async (conn) => {
    const metadata = conn.getMetadata();
    const resolvedSchema =
      schema ??
      ctx.registry.require(dto.dbType).getInfo().defaultSchema ??
      dto.databaseName ??
      '';

    let tables = await metadata.listTables(resolvedSchema);
    tables = tables.filter((t) => t.kind === 'table');
    if (tableNames && tableNames.length > 0) {
      const wanted = new Set(tableNames);
      tables = tables.filter((t) => wanted.has(t.name));
    }
    tables = tables.slice(0, MAX_TABLES);

    const columns: AiRequestContext['columns'] = {};
    for (const table of tables) {
      try {
        columns[table.name] = (await metadata.listColumns(resolvedSchema, table.name)).slice(
          0,
          MAX_COLUMNS_PER_TABLE,
        );
      } catch {
        columns[table.name] = [];
      }
    }

    return {
      dbType: dto.dbType,
      schema: resolvedSchema,
      tables,
      columns,
      // 必须用统一的 isProductionLike：Web 端的红标写的是十六进制 #d1524a，
      // 只认字面量 'red' 会让"标了红的生产库"在 AI 上下文里被当成非生产，
      // 于是 nl2sql 生成写语句时不会要求二次确认（与 /meta/production-check 判定不一致）。
      production: isProductionLike(dto.colorTag, dto.name) || dto.isReadOnly,
    } satisfies AiRequestContext;
  });
}

function contextSchema() {
  return z
    .object({
      dbType: z.string().optional(),
      schema: z.string().nullish(),
      currentSql: z.string().optional(),
    })
    .optional();
}

export async function registerAiRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const actorOf = (req: Parameters<typeof authOf>[0]) => {
    const auth = authOf(req);
    return { userId: auth.user.id, username: auth.user.username };
  };

  /**
   * 采集本次 AI 调用写入 `ai_history` 的记录 id。
   *
   * 界面上的"撤回这条消息 / 撤回到某一次操作"要能删掉服务端对应的记录，
   * 因此每个场景的响应都带上 `historyId`。用回调拿真实 id，而不是事后
   * `SELECT MAX(id)` —— 后者在同用户并发请求下会指向别人的记录。
   */
  const historyCollector = (): { hooks: AiSceneHooks; id: () => number | null } => {
    let captured: number | null = null;
    return {
      hooks: { onHistory: (historyId: number) => { captured = historyId; } },
      id: () => captured,
    };
  };

  app.get('/ai/status', { preHandler: requireAuth(ctx, 'ai.use') }, async (_req, reply) => {
    const config = ctx.ai.activeConfig();
    return reply.send({
      enabled: ctx.ai.enabled,
      configured: config !== null,
      config: config
        ? { id: config.id, name: config.name, provider: config.provider, modelName: config.modelName }
        : null,
      redactionEnabled: ctx.pdb.settings.getBoolean('ai.redaction_enabled', true),
    });
  });

  // ------------------------------------------------------------------ 模型配置

  app.get('/ai/configs', { preHandler: requireAuth(ctx, 'settings.manage') }, async (_req, reply) => {
    return reply.send({ items: ctx.pdb.aiConfigs.list() });
  });

  app.post('/ai/configs', { preHandler: requireAuth(ctx, 'settings.manage') }, async (req, reply) => {
    const auth = authOf(req);
    const body = parse(
      z.object({
        name: z.string().min(1),
        provider: z.string().min(1),
        modelName: z.string().min(1),
        apiKey: z.string().nullish(),
        baseUrl: z.string().nullish(),
        temperature: z.number().min(0).max(2).optional(),
        maxTokens: z.number().int().positive().nullish(),
        timeoutMs: z.number().int().positive().optional(),
        isDefault: z.boolean().optional(),
        enabled: z.boolean().optional(),
      }),
      req.body,
    );
    const item = ctx.pdb.aiConfigs.create(body);
    ctx.pdb.audit.append({
      userId: auth.user.id,
      username: auth.user.username,
      action: 'settings_update',
      resourceType: 'ai_config',
      resourceId: String(item.id),
      status: 'success',
      detail: { provider: item.provider, modelName: item.modelName, hasApiKey: item.hasApiKey },
      ipAddress: clientIp(req),
    });
    return reply.status(201).send({ item });
  });

  app.put('/ai/configs/:id', { preHandler: requireAuth(ctx, 'settings.manage') }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = parse(
      z.object({
        name: z.string().min(1).optional(),
        provider: z.string().min(1).optional(),
        modelName: z.string().min(1).optional(),
        apiKey: z.string().nullish(),
        baseUrl: z.string().nullish(),
        temperature: z.number().min(0).max(2).optional(),
        maxTokens: z.number().int().positive().nullish(),
        timeoutMs: z.number().int().positive().optional(),
        isDefault: z.boolean().optional(),
        enabled: z.boolean().optional(),
      }),
      req.body,
    );
    const item = ctx.pdb.aiConfigs.update(id, body);
    return reply.send({ item });
  });

  app.delete('/ai/configs/:id', { preHandler: requireAuth(ctx, 'settings.manage') }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!ctx.pdb.aiConfigs.delete(id)) throw notFound('AI 配置', id);
    return reply.send({ ok: true });
  });

  /**
   * 连通性测试：真发一次最小请求。
   *
   * 允许两种入参：`{ configId }` 测已保存配置；或给表单临时值，保存前先试连。
   * 因为要支持后者，这里**不要求 ai.enabled 已打开** —— 否则会陷入
   * 「想测试 → 必须先启用 → 启用前不敢确认能连上」的死循环。
   */
  app.post('/ai/test', { preHandler: requireAuth(ctx, 'settings.manage') }, async (req, reply) => {
    const auth = authOf(req);
    const body = parse(probeSchema, req.body);
    const started = Date.now();
    try {
      const result = await ctx.ai.testConnection(probeTargetOf(body));
      ctx.pdb.audit.append({
        userId: auth.user.id,
        username: auth.user.username,
        action: 'ai',
        resourceType: 'ai_probe',
        resourceId: 'test',
        status: 'success',
        durationMs: Date.now() - started,
        detail: { provider: result.provider, model: result.model, latencyMs: result.latencyMs },
        ipAddress: clientIp(req),
      });
      return reply.send({ result });
    } catch (e) {
      const err = normalizeError(e);
      ctx.pdb.audit.append({
        userId: auth.user.id,
        username: auth.user.username,
        action: 'ai',
        resourceType: 'ai_probe',
        resourceId: 'test',
        status: 'failed',
        errorMessage: err.message,
        durationMs: Date.now() - started,
        detail: { provider: body.provider ?? null, model: body.modelName ?? null },
        ipAddress: clientIp(req),
      });
      throw e;
    }
  });

  /**
   * 列举供应商侧可用模型（便于挑选本地已下载的模型）。
   *
   * 用 POST 而非 GET：入参可能带 API Key，放进查询串会落到访问日志和浏览器历史里。
   */
  app.post('/ai/models', { preHandler: requireAuth(ctx, 'settings.manage') }, async (req, reply) => {
    const body = parse(probeSchema, req.body);
    return reply.send(await ctx.ai.listModels(probeTargetOf(body)));
  });

  app.get('/ai/history', { preHandler: requireAuth(ctx, 'ai.use') }, async (req, reply) => {
    const auth = authOf(req);
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }), req.query);
    return reply.send({
      items: ctx.pdb.aiConfigs.listHistory(auth.user.id, limit ?? 50),
      // 真实总数：前端用它显示"最近调用 N 次"，而不是拿当页条数冒充总数
      total: ctx.pdb.aiConfigs.countHistory(auth.user.id),
    });
  });

  // ------------------------------------------------------------------ AI 能力场景

  app.post('/ai/nl2sql', { preHandler: requireAuth(ctx, 'ai.use') }, async (req, reply) => {
    const auth = authOf(req);
    const body = parse(
      z.object({
        prompt: z.string().min(1, '请输入自然语言需求').max(4000),
        connectionId: z.number().int().positive(),
        schema: z.string().nullish(),
        tables: z.array(z.string()).optional(),
      }),
      req.body,
    );
    assertConnectionVisible(auth, body.connectionId);

    const aiContext = await buildSchemaContext(ctx, body.connectionId, body.schema ?? null, body.tables);
    const history = historyCollector();
    const result = await ctx.ai.generateSql(body.prompt, aiContext, actorOf(req), history.hooks);

    // 生成的是写操作时，额外校验该连接是否允许 AI 写（生产库默认禁止）
    if (result.sql && isWriteStatement(result.sql)) {
      const dto = ctx.pdb.connections.get(body.connectionId);
      assertAiWriteAllowed(
        auth,
        dto ? { name: dto.name, colorTag: dto.colorTag, readOnly: dto.isReadOnly } : null,
        {
          productionWriteAllowed: ctx.pdb.settings.getBoolean('ai.production_write_allowed', false),
          aiEnabled: ctx.ai.enabled,
        },
      );
      // 顺带确认调用方本身有写权限，避免"AI 帮你绕过只读账号"
      if (dto) assertCanWrite(auth, body.connectionId, dto);
    }

    return reply.send({
      ...result,
      // 明确告知前端：必须人工确认后另行调用 /query/execute
      executed: false,
      connectionId: body.connectionId,
      historyId: history.id(),
    });
  });

  app.post('/ai/explain', { preHandler: requireAuth(ctx, 'ai.use') }, async (req, reply) => {
    const body = parse(z.object({ sql: z.string().min(1).max(100_000) }), req.body);
    const history = historyCollector();
    const text = await ctx.ai.explainSql(body.sql, actorOf(req), history.hooks);
    return reply.send({ text, historyId: history.id() });
  });

  app.post('/ai/optimize', { preHandler: requireAuth(ctx, 'ai.use') }, async (req, reply) => {
    const auth = authOf(req);
    const body = parse(
      z.object({
        sql: z.string().min(1).max(100_000),
        connectionId: z.number().int().positive().optional(),
      }),
      req.body,
    );

    let plan = null;
    if (body.connectionId !== undefined) {
      assertConnectionVisible(auth, body.connectionId);
      const config = ctx.pdb.connections.getConfig(body.connectionId);
      if (config) {
        try {
          plan = await ctx.manager.withConnection(config, (conn) =>
            conn.getQueryExecutor().explain(body.sql),
          );
        } catch {
          // 拿不到执行计划不影响优化建议，降级为纯 SQL 分析
          plan = null;
        }
      }
    }

    const history = historyCollector();
    const result = await ctx.ai.optimizeSql(body.sql, plan, actorOf(req), history.hooks);
    return reply.send({ ...result, plan, historyId: history.id() });
  });

  app.post('/ai/document', { preHandler: requireAuth(ctx, 'ai.use') }, async (req, reply) => {
    const body = parse(
      z.object({
        connectionId: z.number().int().positive(),
        schema: z.string().nullish(),
        tables: z.array(z.string()).optional(),
      }),
      req.body,
    );
    const auth = authOf(req);
    assertConnectionVisible(auth, body.connectionId);
    const aiContext = await buildSchemaContext(ctx, body.connectionId, body.schema ?? null, body.tables);
    const history = historyCollector();
    const markdown = await ctx.ai.generateDocumentation(aiContext, actorOf(req), history.hooks);
    return reply.send({ markdown, historyId: history.id() });
  });

  app.post('/ai/ask', { preHandler: requireAuth(ctx, 'ai.use') }, async (req, reply) => {
    const body = parse(
      z.object({
        question: z.string().min(1).max(4000),
        columns: z.array(z.object({ name: z.string(), dataType: z.string().optional() })).min(1),
        rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).max(2000),
        connectionId: z.number().int().positive().optional(),
      }),
      req.body,
    );

    const context: AiRequestContext = {
      resultColumns: body.columns.map((c) => ({ name: c.name, dataType: c.dataType ?? 'unknown' })),
      resultRows: body.rows.map((row) => row.map((cell) => cell)),
      ...(body.connectionId !== undefined ? { production: true } : {}),
    };
    // 直接采用服务回报的"实际生效值"，不再自行读设置：
    // 否则这里读到的开关可能已经和刚才发送内容时的状态不同（TOCTOU），
    // 界面就会显示"已脱敏"而模型其实收到了明文。
    const history = historyCollector();
    const result = await ctx.ai.answerQuestion(body.question, context, actorOf(req), history.hooks);
    return reply.send({
      text: result.text,
      redactionApplied: result.redactionApplied,
      redactionNotes: result.redactionNotes,
      historyId: history.id(),
    });
  });

  app.post('/ai/diagnose', { preHandler: requireAuth(ctx, 'ai.use') }, async (req, reply) => {
    const body = parse(
      z.object({ error: z.string().min(1).max(20_000), sql: z.string().max(100_000).optional() }),
      req.body,
    );
    const history = historyCollector();
    const result = await ctx.ai.diagnoseError(body.error, body.sql ?? '', actorOf(req), history.hooks);
    return reply.send({ ...result, historyId: history.id() });
  });

  // ------------------------------------------------------------------ 撤回 / 回退

  /**
   * 撤回单条调用记录。
   *
   * 仓储层用 `user_id` 限定删除范围，所以这里不需要先查归属再删 ——
   * 不是自己的记录与不存在的记录都返回 404，**不给枚举空间**。
   */
  app.delete('/ai/history/:id', { preHandler: requireAuth(ctx, 'ai.use') }, async (req, reply) => {
    const auth = authOf(req);
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
    const deleted = ctx.pdb.aiConfigs.deleteHistory(auth.user.id, id);
    if (!deleted) throw notFound('调用记录', id);
    ctx.pdb.audit.append({
      userId: auth.user.id,
      username: auth.user.username,
      action: 'ai',
      resourceType: 'ai_history',
      resourceId: String(id),
      status: 'success',
      detail: { operation: 'withdraw' },
      ipAddress: clientIp(req),
    });
    return reply.send({ ok: true, deleted: 1 });
  });

  /**
   * 撤回到指定的某一次操作：删掉这条**及其之后**的全部调用记录。
   *
   * 与界面语义一致：对话被截断到那一刻。删除条数一并返回，便于界面提示。
   */
  app.post('/ai/history/rollback', { preHandler: requireAuth(ctx, 'ai.use') }, async (req, reply) => {
    const auth = authOf(req);
    const body = parse(z.object({ historyId: z.number().int().positive() }), req.body);
    const deleted = ctx.pdb.aiConfigs.deleteHistoryFrom(auth.user.id, body.historyId);
    if (deleted === 0) throw notFound('调用记录', body.historyId);
    ctx.pdb.audit.append({
      userId: auth.user.id,
      username: auth.user.username,
      action: 'ai',
      resourceType: 'ai_history',
      resourceId: String(body.historyId),
      status: 'success',
      detail: { operation: 'rollback', deleted },
      ipAddress: clientIp(req),
    });
    return reply.send({ ok: true, deleted });
  });

  /** 清空该用户的全部调用记录（界面上的"清空对话"）。 */
  app.delete('/ai/history', { preHandler: requireAuth(ctx, 'ai.use') }, async (req, reply) => {
    const auth = authOf(req);
    const deleted = ctx.pdb.aiConfigs.clearHistory(auth.user.id);
    ctx.pdb.audit.append({
      userId: auth.user.id,
      username: auth.user.username,
      action: 'ai',
      resourceType: 'ai_history',
      resourceId: '*',
      status: 'success',
      detail: { operation: 'clear', deleted },
      ipAddress: clientIp(req),
    });
    return reply.send({ ok: true, deleted });
  });
}

/** 迁移任务 DTO 的类型别名：沿用服务层 get() 的返回类型，避免重复声明。 */
type MigrationTaskView = ReturnType<AppContext['migration']['get']>;

/**
 * 迁移任务的归属校验。
 *
 * 对"任务不存在"与"任务存在但不属于你"返回**同一个** NOT_FOUND ——
 * 与连接可见性一致：不能让 message 差异变成"这个 id 存不存在"的探针。
 * 声明为断言函数，便于调用方在校验通过后直接使用任务对象。
 */
function assertTaskOwner(
  auth: { user: { id: number; isAdmin: boolean } },
  task: MigrationTaskView | null | undefined,
): asserts task is MigrationTaskView {
  if (!task || (task.userId !== auth.user.id && !auth.user.isAdmin)) {
    throw new PeanutError('NOT_FOUND', '迁移任务不存在');
  }
}

/**
 * 取"属于调用者"的迁移任务；"不存在"与"无权查看"从同一个出口抛出。
 *
 * 为什么不直接 `ctx.migration.get(id)`：服务层对"任务不存在"抛的是
 * `notFound('迁移任务', id)` → `迁移任务不存在: <id>`（**带 id**），
 * 而"任务存在但不属于你"由 assertTaskOwner 抛 `迁移任务不存在`（**不带 id**）。
 * 实测两条路径的 message 不同，攻击者据此仍能枚举全库任务 id。
 * 因此这里把服务层的 NOT_FOUND 归一为 null，再统一交给 assertTaskOwner 判定，
 * 使两种情况逐字节相同。（服务层 packages/migration 不在本次改动白名单内，故在路由层归一。）
 */
function loadOwnedTask(
  ctx: AppContext,
  auth: { user: { id: number; isAdmin: boolean } },
  id: number,
): MigrationTaskView {
  let task: MigrationTaskView | null;
  try {
    task = ctx.migration.get(id);
  } catch (e) {
    // 只归一"任务不存在"；数据库故障等其它异常必须原样上抛，不能被吞成 404
    if (!(e instanceof PeanutError) || e.code !== 'NOT_FOUND') throw e;
    task = null;
  }
  assertTaskOwner(auth, task);
  return task;
}

export async function registerMigrationRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const requestSchema = z.object({
    name: z.string().max(128).optional(),
    sourceConnectionId: z.number().int().positive(),
    targetConnectionId: z.number().int().positive(),
    sourceSchema: z.string().nullish(),
    targetSchema: z.string().nullish(),
    tables: z.array(z.string()).default([]),
    mode: z.enum(['full', 'incremental', 'sync']).default('full'),
    includeStructure: z.boolean().default(true),
    includeData: z.boolean().default(true),
    conflictStrategy: z.enum(['overwrite', 'skip', 'error', 'manual']).default('skip'),
    batchSize: z.number().int().min(1).max(100_000).optional(),
    dryRun: z.boolean().optional(),
  });

  const toRequest = (userId: number, body: z.infer<typeof requestSchema>): MigrationRequest => ({
    userId,
    name: body.name,
    sourceConnectionId: body.sourceConnectionId,
    targetConnectionId: body.targetConnectionId,
    sourceSchema: body.sourceSchema ?? null,
    targetSchema: body.targetSchema ?? null,
    tables: body.tables,
    mode: body.mode,
    includeStructure: body.includeStructure,
    includeData: body.includeData,
    conflictStrategy: body.conflictStrategy,
    ...(body.batchSize !== undefined ? { batchSize: body.batchSize } : {}),
    ...(body.dryRun !== undefined ? { dryRun: body.dryRun } : {}),
  });

  app.post('/migration/precheck', { preHandler: requireAuth(ctx, 'migrate.read') }, async (req, reply) => {
    const auth = authOf(req);
    const body = parse(requestSchema, req.body);
    for (const id of [body.sourceConnectionId, body.targetConnectionId]) {
      assertConnectionVisible(auth, id);
    }
    const taskId = ctx.migration.create(toRequest(auth.user.id, body));
    const result = await ctx.migration.precheck(taskId, toRequest(auth.user.id, body));
    ctx.pdb.audit.append({
      userId: auth.user.id,
      username: auth.user.username,
      action: 'migrate',
      resourceType: 'migration',
      resourceId: String(taskId),
      connectionId: body.sourceConnectionId,
      status: result.ok ? 'success' : 'failed',
      detail: { phase: 'precheck', issues: result.issues.length, estimatedRows: result.estimatedRows },
      ipAddress: clientIp(req),
    });
    return reply.send({ taskId, ...result });
  });

  app.post('/migration/start', { preHandler: requireAuth(ctx, 'migrate.write') }, async (req, reply) => {
    const auth = authOf(req);
    const body = parse(requestSchema.extend({ taskId: z.number().int().positive().optional() }), req.body);

    // 迁移是"读源库 + 写目标库"，两端的资源授权都必须校验。
    // 早期只有 /migration/precheck 做了这件事，而真正搬数据的 /migration/start 没有 ——
    // 于是只要持有 migrate.write，就能把任意（包括未授权的）源库整表搬到自己的库，
    // 或用 overwrite 策略把未授权目标库的同名表 DROP 重建。
    const sourceDto = ctx.pdb.connections.get(body.sourceConnectionId);
    if (!sourceDto) throw notFound('连接', body.sourceConnectionId);
    const targetDto = ctx.pdb.connections.get(body.targetConnectionId);
    if (!targetDto) throw notFound('连接', body.targetConnectionId);
    assertConnectionVisible(auth, sourceDto.id);
    assertConnectionVisible(auth, targetDto.id);
    // 目标库是写入方：沿用与 SQL 执行同一套写闸门（权限 + 只读连接 + 资源写授权）
    assertCanWrite(auth, targetDto.id, targetDto);

    const request = toRequest(auth.user.id, body);

    let taskId: number;
    if (body.taskId === undefined) {
      taskId = ctx.migration.create(request);
    } else {
      // 复用已有任务时必须确认归属：否则可以借他人的任务 id 续写/覆盖其迁移记录。
      // 注意必须走 loadOwnedTask：服务层 get() 对"不存在"抛的消息带 id，
      // 直接用它会让这个接口变成迁移任务 id 的枚举探针。
      loadOwnedTask(ctx, auth, body.taskId);
      taskId = body.taskId;
    }

    const result = await ctx.migration.start(taskId, request);
    ctx.pdb.audit.append({
      userId: auth.user.id,
      username: auth.user.username,
      action: 'migrate',
      resourceType: 'migration',
      resourceId: String(taskId),
      connectionId: body.sourceConnectionId,
      status: result.status === 'success' ? 'success' : 'failed',
      errorMessage: result.errorMessage ?? null,
      detail: {
        mode: request.mode,
        tables: request.tables,
        successRows: result.successRows,
        failedRows: result.failedRows,
        skippedRows: result.skippedRows,
      },
      ipAddress: clientIp(req),
    });
    return reply.send(result);
  });

  app.get('/migration/tasks', { preHandler: requireAuth(ctx, 'migrate.read') }, async (req, reply) => {
    const auth = authOf(req);
    const query = parse(
      z.object({
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        allUsers: z.union([z.literal('true'), z.literal('false')]).optional(),
      }),
      req.query,
    );
    const allUsers = query.allUsers === 'true' && auth.user.isAdmin;
    const items = ctx.migration.list({
      ...(allUsers ? {} : { userId: auth.user.id }),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.offset !== undefined ? { offset: query.offset } : {}),
    });
    return reply.send({ items, total: items.length });
  });

  // 以下三个接口都按主键取任务，因此必须逐个校验归属。
  // 迁移详情里有连接 id、schema、表清单、错误明细与检查点，报告里的 rowKey
  // 甚至是失败行的首个列值（可能是业务数据）；不校验归属就只是"把 id 递增"
  // 就能读遍全系统，还能取消别人正在跑的迁移。
  // 三个接口统一走 loadOwnedTask：不用它而直接 get()，"不存在"会带 id、
  // "他人任务"不带 id，message 差异本身就是枚举探针。
  app.get('/migration/:id', { preHandler: requireAuth(ctx, 'migrate.read') }, async (req, reply) => {
    const auth = authOf(req);
    const id = Number((req.params as { id: string }).id);
    return reply.send({ task: loadOwnedTask(ctx, auth, id) });
  });

  app.get('/migration/:id/report', { preHandler: requireAuth(ctx, 'migrate.read') }, async (req, reply) => {
    const auth = authOf(req);
    const id = Number((req.params as { id: string }).id);
    loadOwnedTask(ctx, auth, id);
    return reply.send(ctx.migration.report(id));
  });

  app.post('/migration/:id/cancel', { preHandler: requireAuth(ctx, 'migrate.write') }, async (req, reply) => {
    const auth = authOf(req);
    const id = Number((req.params as { id: string }).id);
    loadOwnedTask(ctx, auth, id);
    ctx.migration.cancel(id);
    return reply.send({ ok: true, task: ctx.migration.get(id) });
  });
}

export { contextSchema };
