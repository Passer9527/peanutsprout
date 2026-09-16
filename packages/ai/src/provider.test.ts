/**
 * 花生苗数据库管理工具 - 大模型接入测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 安全回归：
 *  1. Google 的 apiKey 只走 `x-goog-api-key` 请求头，绝不拼进 URL 查询串；
 *  2. 所有 provider 的错误详情（url / body / raw / message）统一脱敏，
 *     密钥一旦被回显也必须变成 `***` —— 因为 details 会原样回传客户端。
 */

import { describe, expect, it } from 'vitest';
import { PeanutError } from '@peanutsprout/core';
import { chat, listModels, redactSecrets, type ChatRequest, type FetchLike } from './provider.js';

const GOOGLE_KEY = 'AIzaSyFAKE-google-key-1234567890';
const OPENAI_KEY = 'sk-fake-openai-key-abcdefghijklmnop';

function baseRequest(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    provider: 'openai',
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.example.test/v1',
    apiKey: OPENAI_KEY,
    messages: [{ role: 'user', content: 'hi' }],
    temperature: 0,
    maxTokens: 8,
    timeoutMs: 5_000,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function captureError(promise: Promise<unknown>): Promise<PeanutError> {
  try {
    await promise;
  } catch (e) {
    return e as PeanutError;
  }
  throw new Error('预期抛错，但调用成功了');
}

describe('redactSecrets（错误详情统一脱敏）', () => {
  it('URL 查询串里的密钥被替换成 ***', () => {
    const out = String(
      redactSecrets(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent?key=${GOOGLE_KEY}`,
      ),
    );
    expect(out).not.toContain(GOOGLE_KEY);
    expect(out).toContain('key=***');
  });

  it('Authorization / x-api-key / x-goog-api-key 头被替换成 ***', () => {
    expect(String(redactSecrets(`Authorization: Bearer ${OPENAI_KEY}`))).not.toContain(OPENAI_KEY);
    expect(String(redactSecrets(`x-goog-api-key: ${GOOGLE_KEY}`))).not.toContain(GOOGLE_KEY);
    expect(String(redactSecrets(`x-api-key: ${OPENAI_KEY}`))).not.toContain(OPENAI_KEY);
  });

  it('JSON 请求体里以密钥命名的字段被替换成 ***', () => {
    const out = String(redactSecrets(`{"model":"gpt","apiKey":"${OPENAI_KEY}"}`));
    expect(out).not.toContain(OPENAI_KEY);
    expect(out).toContain('"apiKey":"***"');
  });

  it('已知密钥出现在任意文本/嵌套对象里也会被字面替换', () => {
    const out = redactSecrets(
      {
        url: 'https://x/y',
        nested: { echo: `bad key ${OPENAI_KEY} oops`, list: [OPENAI_KEY] },
      },
      [OPENAI_KEY],
    );
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain(OPENAI_KEY);
    expect(serialized).toContain('***');
  });

  it('拿不到密钥值时也能靠结构化规则遮蔽令牌', () => {
    const out = String(redactSecrets('Authorization: Bearer unknown-token-value'));
    expect(out).not.toContain('unknown-token-value');
  });

  it('非字符串值原样保留', () => {
    expect(redactSecrets({ n: 1, b: true, nil: null }, [])).toEqual({ n: 1, b: true, nil: null });
  });
});

describe('Google 供应商 · 密钥只走请求头', () => {
  it('不再把 apiKey 拼进 URL 查询串，改用 x-goog-api-key 头', async () => {
    const captured: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl: FetchLike = async (input, init) => {
      captured.push({
        url: String(input),
        headers: (init?.headers ?? {}) as unknown as Record<string, string>,
      });
      return jsonResponse({ candidates: [{ content: { parts: [{ text: '你好' }] } }] });
    };

    const result = await chat(
      baseRequest({
        provider: 'google',
        model: 'gemini-1.5-pro',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: GOOGLE_KEY,
      }),
      fetchImpl,
    );

    expect(result.text).toBe('你好');
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).not.toContain(GOOGLE_KEY);
    expect(captured[0]?.url).not.toContain('key=');
    expect(captured[0]?.headers['x-goog-api-key']).toBe(GOOGLE_KEY);
  });

  it('返回非 2xx 且响应体回显密钥时，错误详情与消息都不含密钥', async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({ error: { message: `API key not valid: ${GOOGLE_KEY}` } }, 400);

    const err = await captureError(
      chat(
        baseRequest({
          provider: 'google',
          model: 'gemini-1.5-pro',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          apiKey: GOOGLE_KEY,
        }),
        fetchImpl,
      ),
    );

    expect(err).toBeInstanceOf(PeanutError);
    expect(err.code).toBe('AI_PROVIDER_ERROR');
    const serialized = JSON.stringify({ message: err.message, details: err.details });
    expect(serialized).not.toContain(GOOGLE_KEY);
    expect(serialized).toContain('***');
  });

  it('网络异常信息里带出密钥时，错误详情与消息都不含密钥', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error(`connect ECONNREFUSED https://x/v1beta?key=${GOOGLE_KEY}`);
    };

    const err = await captureError(
      chat(
        baseRequest({
          provider: 'google',
          model: 'gemini-1.5-pro',
          baseUrl: 'https://x/v1beta',
          apiKey: GOOGLE_KEY,
        }),
        fetchImpl,
      ),
    );

    const serialized = JSON.stringify({ message: err.message, details: err.details });
    expect(serialized).not.toContain(GOOGLE_KEY);
    expect(serialized).toContain('***');
  });
});

describe('各 provider 错误详情统一脱敏', () => {
  it('OpenAI 兼容协议：密钥放在 Authorization 头，URL 不带密钥', async () => {
    const captured: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl: FetchLike = async (input, init) => {
      captured.push({
        url: String(input),
        headers: (init?.headers ?? {}) as unknown as Record<string, string>,
      });
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    };

    await chat(baseRequest(), fetchImpl);
    expect(captured[0]?.url).not.toContain(OPENAI_KEY);
    expect(captured[0]?.headers['authorization']).toBe(`Bearer ${OPENAI_KEY}`);
  });

  it('OpenAI 兼容协议返回非 2xx 且回显密钥时，详情已脱敏', async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({ error: { message: `Incorrect API key provided: ${OPENAI_KEY}` } }, 401);

    const err = await captureError(chat(baseRequest(), fetchImpl));
    const serialized = JSON.stringify({ message: err.message, details: err.details });
    expect(serialized).not.toContain(OPENAI_KEY);
    expect(serialized).toContain('***');
  });

  it('响应缺少内容时，raw 回显里的密钥也会被脱敏', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ echoKey: OPENAI_KEY });

    const err = await captureError(chat(baseRequest(), fetchImpl));
    expect(JSON.stringify(err.details)).not.toContain(OPENAI_KEY);
  });

  it('Anthropic 返回非 2xx 时详情已脱敏', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ error: `bad ${OPENAI_KEY}` }, 403);

    const err = await captureError(chat(baseRequest({ provider: 'anthropic' }), fetchImpl));
    expect(JSON.stringify({ message: err.message, details: err.details })).not.toContain(OPENAI_KEY);
  });

  it('列举模型失败时详情不含密钥', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ error: `bad ${OPENAI_KEY}` }, 500);

    const err = await captureError(
      listModels(
        { provider: 'openai', baseUrl: 'https://api.example.test/v1', apiKey: OPENAI_KEY },
        fetchImpl,
      ),
    );
    expect(JSON.stringify({ message: err.message, details: err.details })).not.toContain(OPENAI_KEY);
  });
});
