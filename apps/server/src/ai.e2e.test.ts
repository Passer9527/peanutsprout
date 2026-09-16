/**
 * 花生苗数据库管理工具 - AI 配置与助手接口端到端测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 这组测试存在的理由，是一个**真实出现过的缺陷**：
 * 后端 AI 能力（9 类供应商、7 个场景、脱敏、历史、审计）全都写好了，
 * 但 `ai.enabled` 这道总开关**没有任何写入口** —— 于是所有 AI 调用永远返回
 * AI_DISABLED，功能等于不存在。这里把「开关能打开」和「打开后真的能调通」
 * 都钉成测试，防止再次出现"实现完整却够不着"。
 *
 * 为了让「真的能调通」是真验证而不是打桩，这里起一个**真实的** HTTP 服务
 * 充当 OpenAI 兼容供应商（随机端口），全程走 fetch + 真实 HTTP。
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './app.js';
import { createContext, disposeContext, type AppContext } from './context.js';
import type { ServerConfig } from './config.js';

let app: FastifyInstance;
let ctx: AppContext;
let dir: string;
let token = '';
let mock: Server;
let mockBase = '';
let targetDbPath = '';

const ADMIN = 'admin';
const ADMIN_PASSWORD = 'Adm1n-Passw0rd!';

function testConfig(): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    dataDir: dir,
    masterPassword: null,
    tokenTtlSec: 3600,
    corsOrigin: true,
    serveWeb: false,
    webDistPath: null,
    bootstrapAdminUsername: ADMIN,
    bootstrapAdminPassword: ADMIN_PASSWORD,
    logLevel: 'silent',
    https: null,
    idleConnectionMs: 0,
    instanceNonce: null,
    trustProxy: false,
  };
}

function auth(): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** 假供应商：实现 /v1/models 与 /v1/chat/completions 两个最小接口。 */
function startMockProvider(): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const url = req.url ?? '';
        const send = (code: number, payload: unknown) => {
          res.writeHead(code, { 'content-type': 'application/json' });
          res.end(JSON.stringify(payload));
        };
        if (url.endsWith('/models')) {
          send(200, { object: 'list', data: [{ id: 'mock-coder-7b' }, { id: 'mock-chat-13b' }] });
          return;
        }
        if (url.endsWith('/chat/completions')) {
          const parsed = JSON.parse(body || '{}') as { model?: string; messages?: Array<{ content?: string }> };
          const prompt = (parsed.messages ?? []).map((m) => m.content ?? '').join('\n');
          // 提示词里出现 "JSON" 就按结构化结果返回（nl2sql / optimize / diagnose 走这条）
          const content = /JSON/.test(prompt)
            ? JSON.stringify({
                sql: 'SELECT id, name FROM users LIMIT 10',
                explanation: '取前 10 个用户',
                confidence: 0.9,
                referencedTables: ['users'],
                requiresConfirmation: true,
              })
            : `MOCK-REPLY(${parsed.model ?? 'unknown'})`;
          send(200, {
            id: 'chatcmpl-mock',
            object: 'chat.completion',
            model: parsed.model,
            choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 42, completion_tokens: 17 },
          });
          return;
        }
        send(404, { error: { message: `unexpected ${url}` } });
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, base: `http://127.0.0.1:${port}/v1` });
    });
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ps-ai-'));
  targetDbPath = join(dir, 'target.db');
  const started = await startMockProvider();
  mock = started.server;
  mockBase = started.base;

  ctx = createContext({ config: testConfig(), memory: true });
  app = await buildServer(ctx, { quiet: true });
  await app.ready();

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: ADMIN, password: ADMIN_PASSWORD },
  });
  expect(login.statusCode).toBe(200);
  token = login.json().token;
});

afterAll(async () => {
  await app.close();
  await disposeContext(ctx);
  await new Promise<void>((resolve) => {
    mock.close(() => {
      resolve();
    });
  });
  rmSync(dir, { recursive: true, force: true });
});

describe('AI 总开关必须真的能打开（回归：曾经没有写入口）', () => {
  it('默认是关闭的，AI 调用返回 AI_DISABLED', async () => {
    const status = await app.inject({ method: 'GET', url: '/api/v1/ai/status', headers: auth() });
    expect(status.json().enabled).toBe(false);

    const explain = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/explain',
      headers: auth(),
      payload: { sql: 'SELECT 1' },
    });
    expect(explain.statusCode).toBe(403);
    expect(explain.json().error.code).toBe('AI_DISABLED');
  });

  it('通过 PUT /meta/settings 打开开关，并写入审计（含旧值→新值）', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/meta/settings',
      headers: auth(),
      payload: { items: [{ key: 'ai.enabled', value: true }] },
    });
    expect(res.statusCode).toBe(200);
    const change = res.json().changes[0];
    expect(change).toMatchObject({ key: 'ai.enabled', oldValue: 'false', newValue: 'true' });

    const logs = await app.inject({
      method: 'GET',
      url: '/api/v1/audit/logs?action=settings_update&limit=5',
      headers: auth(),
    });
    const entry = logs.json().items.find((item: { resourceId: string }) => item.resourceId === 'ai.enabled');
    expect(entry).toBeDefined();
    // DTO 里的 detail 是 JSON 字符串（落库就是这么存的），断言前先解析
    const detail = typeof entry.detail === 'string' ? JSON.parse(entry.detail) : entry.detail;
    expect(detail).toMatchObject({ oldValue: 'false', newValue: 'true' });

    const status = await app.inject({ method: 'GET', url: '/api/v1/ai/status', headers: auth() });
    expect(status.json().enabled).toBe(true);
  });

  it('白名单之外的键必须被拒绝，且不能写进库', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/meta/settings',
      headers: auth(),
      payload: { items: [{ key: 'evil.injected', value: 'x' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');

    const all = await app.inject({ method: 'GET', url: '/api/v1/meta/settings', headers: auth() });
    const keys = all.json().items.map((item: { key: string }) => item.key);
    expect(keys).not.toContain('evil.injected');
  });

  it('越界值被拒绝（query.max_rows 有上限）', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/meta/settings',
      headers: auth(),
      payload: { items: [{ key: 'query.max_rows', value: 99_999_999 }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('不能大于');
  });

  it('批量写入里只要有一项非法，整批回滚（不能改一半）', async () => {
    const before = await app.inject({ method: 'GET', url: '/api/v1/meta/settings', headers: auth() });
    const beforeValue = before
      .json()
      .items.find((item: { key: string }) => item.key === 'query.timeout_ms').value;

    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/meta/settings',
      headers: auth(),
      payload: {
        items: [
          { key: 'query.timeout_ms', value: 12345 },
          { key: 'not.writable', value: 'x' },
        ],
      },
    });
    expect(res.statusCode).toBe(400);

    const after = await app.inject({ method: 'GET', url: '/api/v1/meta/settings', headers: auth() });
    const afterValue = after
      .json()
      .items.find((item: { key: string }) => item.key === 'query.timeout_ms').value;
    expect(afterValue).toBe(beforeValue);
  });

  it('可写设置清单与后端白名单一致，界面不必自己抄一份', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/meta/settings/writable', headers: auth() });
    expect(res.statusCode).toBe(200);
    const keys = res.json().items.map((item: { key: string }) => item.key);
    expect(keys).toContain('ai.enabled');
    expect(keys).toContain('ai.redaction_enabled');
    expect(keys).toContain('ai.production_write_allowed');
  });
});

describe('AI 供应商配置与连通性测试', () => {
  let configId = 0;

  it('未配置模型时提示先配置（AI_PROVIDER_ERROR）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/explain',
      headers: auth(),
      payload: { sql: 'SELECT 1' },
    });
    expect(res.json().error.code).toBe('AI_PROVIDER_ERROR');
  });

  it('保存前就能试连（不要求总开关/不要求已保存）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/test',
      headers: auth(),
      payload: { provider: 'openai-compatible', modelName: 'mock-coder-7b', baseUrl: mockBase },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.ok).toBe(true);
    expect(res.json().result.reply).toContain('MOCK-REPLY');
  });

  it('连不通时返回 AI_PROVIDER_ERROR，并带上 URL 便于排查', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/test',
      headers: auth(),
      payload: {
        provider: 'openai-compatible',
        modelName: 'nope',
        baseUrl: 'http://127.0.0.1:9/v1',
        timeoutMs: 3000,
      },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('AI_PROVIDER_ERROR');
    expect(res.json().error.details.url).toContain('/chat/completions');
  });

  it('列举模型：成功返回去重排序后的列表', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/models',
      headers: auth(),
      payload: { provider: 'openai-compatible', baseUrl: mockBase },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().models).toEqual(['mock-chat-13b', 'mock-coder-7b']);
  });

  it('不提供列表接口的供应商要明说，而不是返回空数组', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/models',
      headers: auth(),
      payload: { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.message).toContain('不提供模型列表接口');
  });

  it('创建配置后 /ai/status 显示已配置，且**不回传密钥**', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/configs',
      headers: auth(),
      payload: {
        name: '假模型',
        provider: 'openai-compatible',
        modelName: 'mock-coder-7b',
        baseUrl: mockBase,
        apiKey: 'sk-secret-should-never-come-back',
        isDefault: true,
        enabled: true,
      },
    });
    expect(created.statusCode).toBe(201);
    configId = created.json().item.id;
    expect(created.json().item.hasApiKey).toBe(true);
    // 密钥绝不能出现在响应体里
    expect(JSON.stringify(created.json())).not.toContain('sk-secret-should-never-come-back');

    const status = await app.inject({ method: 'GET', url: '/api/v1/ai/status', headers: auth() });
    expect(status.json().configured).toBe(true);
    expect(status.json().config.modelName).toBe('mock-coder-7b');

    const list = await app.inject({ method: 'GET', url: '/api/v1/ai/configs', headers: auth() });
    expect(JSON.stringify(list.json())).not.toContain('sk-secret-should-never-come-back');
  });

  it('用已保存的配置按 id 试连', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/test',
      headers: auth(),
      payload: { configId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.model).toBe('mock-coder-7b');
  });
});

describe('AI 各技能场景真的能调通（走真实 HTTP）', () => {
  it('解释 SQL 返回模型文本', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/explain',
      headers: auth(),
      payload: { sql: 'SELECT 1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().text).toContain('MOCK-REPLY');
  });

  it('自然语言转 SQL 返回结构化结果，且 executed 恒为 false', async () => {
    const conn = await app.inject({
      method: 'POST',
      url: '/api/v1/connections',
      headers: auth(),
      payload: { name: '目标库', dbType: 'sqlite', databaseName: targetDbPath },
    });
    expect(conn.statusCode).toBe(201);
    const connectionId = conn.json().item.id;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/nl2sql',
      headers: auth(),
      payload: { prompt: '查前 10 个用户', connectionId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sql).toContain('SELECT');
    expect(body.referencedTables).toContain('users');
    expect(body.requiresConfirmation).toBe(true);
    // 关键红线：AI 只生成，绝不自动执行
    expect(body.executed).toBe(false);
  });

  it('调用历史落库（成功与失败都记）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/ai/history?limit=20', headers: auth() });
    expect(res.statusCode).toBe(200);
    const scenes = res.json().items.map((item: { scene: string }) => item.scene);
    expect(scenes).toContain('explain');
    expect(scenes).toContain('nl2sql');
  });

  it('AI 调用写入审计日志（action=ai）', async () => {
    const logs = await app.inject({
      method: 'GET',
      url: '/api/v1/audit/logs?action=ai&limit=20',
      headers: auth(),
    });
    expect(logs.json().total).toBeGreaterThan(0);
  });

  it('调用结束后审计哈希链仍然完整', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/audit/verify', headers: auth() });
    expect(res.json()).toMatchObject({ ok: true });
  });
});
