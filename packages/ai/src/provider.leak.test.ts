/**
 * 花生苗数据库管理工具 - AI 侧密钥泄漏回归测试（对抗性安全验证）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 覆盖两处实测复现的次级破绽：
 *  1. 供应商返回 200 且 content 里回显密钥时，`/ai/test` 会把 content 原样转发；
 *  2. `baseUrl` 形如 `https://host/v1?k=<凭据>` 时，错误 details.url 明文回传
 *     （参数名不在敏感名单里，且 apiKey 未传）。
 *
 * 测试里全部使用明显的假值。
 */

import { describe, expect, it } from 'vitest';
import { PeanutError } from '@peanutsprout/core';
import { chat, redactSecrets, type ChatRequest, type FetchLike } from './provider.js';

const FAKE_KEY = 'sk-fake-like-value-0123456789';

function baseRequest(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    provider: 'openai',
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.example.test/v1',
    apiKey: FAKE_KEY,
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

describe('成功响应 content 回显密钥时必须脱敏（回归）', () => {
  it('OpenAI 兼容协议：200 且 content 含密钥，转发前变成 ***', async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({ choices: [{ message: { content: `你的密钥是 ${FAKE_KEY}，请妥善保管` } }] });

    const result = await chat(baseRequest(), fetchImpl);
    expect(result.text).not.toContain(FAKE_KEY);
    expect(result.text).toContain('***');
  });

  it('Anthropic：200 且 content 含密钥，转发前变成 ***', async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({ content: [{ type: 'text', text: `echo ${FAKE_KEY}` }] });

    const result = await chat(baseRequest({ provider: 'anthropic' }), fetchImpl);
    expect(result.text).not.toContain(FAKE_KEY);
  });

  it('Google：200 且 content 含密钥，转发前变成 ***', async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({ candidates: [{ content: { parts: [{ text: `echo ${FAKE_KEY}` }] } }] });

    const result = await chat(
      baseRequest({ provider: 'google', baseUrl: 'https://generativelanguage.test/v1beta' }),
      fetchImpl,
    );
    expect(result.text).not.toContain(FAKE_KEY);
  });
});

describe('redactSecrets：敏感 query 参数名单扩充（回归）', () => {
  it('`?k=` 这种短参数名也要被识别', () => {
    const out = String(redactSecrets('https://host/v1?k=Bearer-Like-Secret-Value'));
    expect(out).not.toContain('Bearer-Like-Secret-Value');
    expect(out).toContain('k=***');
  });

  it('api_key / apikey / api-key / access_token / token / password / secret 全部覆盖且大小写不敏感', () => {
    const names = ['key', 'api_key', 'apikey', 'api-key', 'access_token', 'token', 'password', 'secret'];
    const value = 'Sensitive-Like-Value';
    for (const name of names) {
      const out = String(redactSecrets(`https://host/v1?${name}=${value}`));
      expect(out, name).not.toContain(value);
      expect(out, name).toContain('***');
      // 大小写混写
      const upper = String(redactSecrets(`https://host/v1?${name.toUpperCase()}=${value}`));
      expect(upper, name).not.toContain(value);
    }
  });
});

describe('错误 details 里的 URL 也必须脱敏（回归）', () => {
  it('baseUrl 带 ?k= 且未传 apiKey 时，details.url 不含凭据', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ error: 'unauthorized' }, 401);

    const err = await captureError(
      chat(
        baseRequest({
          baseUrl: 'https://host.example.test/v1?k=Url-Embedded-Like-Secret',
          apiKey: null,
        }),
        fetchImpl,
      ),
    );

    const serialized = JSON.stringify({ message: err.message, details: err.details });
    expect(serialized).not.toContain('Url-Embedded-Like-Secret');
    expect(serialized).toContain('k=***');
  });

  it('网络异常时 details.url 同样不含 ?k= 凭据', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('connect ECONNREFUSED');
    };

    const err = await captureError(
      chat(
        baseRequest({
          baseUrl: 'https://host.example.test/v1?access_token=Network-Like-Secret',
          apiKey: null,
        }),
        fetchImpl,
      ),
    );

    expect(JSON.stringify(err.details)).not.toContain('Network-Like-Secret');
  });
});
