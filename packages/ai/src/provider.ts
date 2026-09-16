/**
 * 花生苗数据库管理工具 - 大模型接入
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 仅用内置 fetch，不引入各家 SDK：
 *  - OpenAI 兼容协议覆盖 OpenAI / DeepSeek / 通义千问(兼容模式) / 智谱 / 文心 / Ollama 等
 *  - Anthropic Messages API 单独适配
 *  - Google Gemini 走 generateContent
 */

import { PeanutError, type AiProviderKind } from '@peanutsprout/core';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  provider: AiProviderKind | string;
  model: string;
  baseUrl: string | null;
  apiKey: string | null;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number | null;
  timeoutMs: number;
  extraParams?: Record<string, unknown> | null;
}

export interface ChatResponse {
  text: string;
  tokensInput: number | null;
  tokensOutput: number | null;
  raw: unknown;
}

export type FetchLike = typeof fetch;

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * 查询串里名字带 key/token/secret/password/auth 的参数一律视为敏感；
 * 另外补齐短名 `k`（Google 风格 `?k=`，以及各类自建网关）与 `;` 分隔形式。
 * 之前 `?k=<凭据>` 不在名单里，错误 `details.url` 会把凭据明文回传客户端。
 */
const SENSITIVE_QUERY_PARAM =
  /([?&;])((?:[^=&#\s;]*(?:key|token|secret|password|passwd|pwd|auth)[^=&#\s;]*)|(?:k))=([^&#\s;]*)/gi;
/** 常见鉴权头 / 密钥头：Authorization、x-api-key、x-goog-api-key ... */
const SENSITIVE_HEADER =
  /\b(authorization|x-api-key|x-goog-api-key|api-key|api_key|apikey)\b(\s*[:=]\s*)([^\r\n,;{}"']+)/gi;
/** 任意位置出现的 Bearer / Basic 令牌。 */
const BEARER_TOKEN = /\b(Bearer\s+|Basic\s+)[A-Za-z0-9._~+/=-]+/gi;
/** JSON 里以密钥命名的字段（请求体或回显体）。 */
const JSON_SECRET_FIELD =
  /("(?:api[_-]?key|access[_-]?token|token|secret|password|authorization)"\s*:\s*")([^"]*)(")/gi;

function scrubString(text: string, secrets: string[]): string {
  let out = text;
  // 先按已知密钥做字面替换：密钥出现在 URL 之外（请求体、供应商报错回显）也能兜住。
  for (const secret of secrets) {
    out = out.split(secret).join('***');
  }
  // 再做结构化匹配，兜住"不知道密钥具体值"的场景（例如只看到一段 header 文本）。
  return out
    .replace(SENSITIVE_QUERY_PARAM, '$1$2=***')
    .replace(SENSITIVE_HEADER, '$1$2***')
    .replace(BEARER_TOKEN, '$1***')
    .replace(JSON_SECRET_FIELD, '$1***$3');
}

function scrubDeep(value: unknown, secrets: string[]): unknown {
  if (typeof value === 'string') return scrubString(value, secrets);
  if (Array.isArray(value)) return value.map((item) => scrubDeep(item, secrets));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[scrubString(key, secrets)] = scrubDeep(item, secrets);
    }
    return out;
  }
  return value;
}

/**
 * 错误详情统一脱敏：URL 查询串、Authorization 头、请求体/响应体里出现的密钥都会被
 * 替换成 `***`。
 *
 * 服务端错误处理器会把 `PeanutError.details` 原样回传客户端（还可能落进反代日志），
 * 因此任何可能夹带密钥的字符串在交给 PeanutError 之前都**必须**先过这里。
 * `secrets` 传入本次请求实际用到的密钥：拿得到就做字面替换，拿不到也能靠结构化规则遮蔽。
 */
export function redactSecrets(value: unknown, secrets: Array<string | null | undefined> = []): unknown {
  const known = [
    ...new Set(secrets.filter((s): s is string => typeof s === 'string' && s.length > 0)),
  ].sort((a, b) => b.length - a.length);
  return scrubDeep(value, known);
}

/** 详情对象脱敏（保持 Record 类型，便于直接交给 `PeanutError.details`）。 */
function safeDetails(
  details: Record<string, unknown>,
  secrets: string[],
): Record<string, unknown> {
  return redactSecrets(details, secrets) as Record<string, unknown>;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function requireBaseUrl(request: ChatRequest): string {
  if (!request.baseUrl) {
    throw new PeanutError('AI_PROVIDER_ERROR', `${request.provider} 未配置 baseUrl，无法发起请求`);
  }
  return request.baseUrl;
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
  fetchImpl: FetchLike,
  secrets: string[] = [],
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS),
    });
  } catch (e) {
    // 网络层异常信息里也可能带上 URL/密钥，先脱敏再拼进 message
    const reason = scrubString(e instanceof Error ? e.message : String(e), secrets);
    throw new PeanutError(
      'AI_PROVIDER_ERROR',
      `调用大模型失败：${reason}`,
      safeDetails({ url }, secrets),
    );
  }

  const text = await response.text();
  if (!response.ok) {
    // 截断错误体，避免把超长响应塞进日志/审计；同时脱敏，防止供应商回显密钥
    throw new PeanutError(
      'AI_PROVIDER_ERROR',
      `大模型返回 HTTP ${response.status}`,
      safeDetails({ url, body: text.slice(0, 800) }, secrets),
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PeanutError(
      'AI_PROVIDER_ERROR',
      '大模型返回的不是合法 JSON',
      safeDetails({ body: text.slice(0, 800) }, secrets),
    );
  }
}

async function chatOpenAiCompatible(
  request: ChatRequest,
  fetchImpl: FetchLike,
): Promise<ChatResponse> {
  const base = requireBaseUrl(request);
  const payload: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    temperature: request.temperature,
    stream: false,
    ...(request.extraParams ?? {}),
  };
  if (request.maxTokens !== null) payload['max_tokens'] = request.maxTokens;

  const headers: Record<string, string> = {};
  if (request.apiKey) headers['authorization'] = `Bearer ${request.apiKey}`;
  const secrets = request.apiKey ? [request.apiKey] : [];

  const data = (await postJson(
    joinUrl(base, 'chat/completions'),
    payload,
    headers,
    request.timeoutMs,
    fetchImpl,
    secrets,
  )) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || text.length === 0) {
    throw new PeanutError('AI_PROVIDER_ERROR', '大模型返回内容为空', safeDetails({ raw: data }, secrets));
  }
  return {
    // 供应商可能把密钥回显进**成功**响应（例如"你的 key 是 sk-..."）。
    // 该 content 会被 /ai/test 原样转发给客户端，因此转发前同样要过一遍脱敏。
    text: scrubString(text, secrets),
    tokensInput: data.usage?.prompt_tokens ?? null,
    tokensOutput: data.usage?.completion_tokens ?? null,
    raw: data,
  };
}

async function chatAnthropic(request: ChatRequest, fetchImpl: FetchLike): Promise<ChatResponse> {
  const base = requireBaseUrl(request);
  const system = request.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const messages = request.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));
  const secrets = request.apiKey ? [request.apiKey] : [];

  const data = (await postJson(
    joinUrl(base, 'messages'),
    {
      model: request.model,
      max_tokens: request.maxTokens ?? 2048,
      temperature: request.temperature,
      ...(system ? { system } : {}),
      messages,
      ...(request.extraParams ?? {}),
    },
    {
      'x-api-key': request.apiKey ?? '',
      'anthropic-version': '2023-06-01',
    },
    request.timeoutMs,
    fetchImpl,
    secrets,
  )) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const text = (data.content ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('');
  if (!text) throw new PeanutError('AI_PROVIDER_ERROR', '大模型返回内容为空', safeDetails({ raw: data }, secrets));
  return {
    // 成功响应同样可能回显密钥，转发前必须脱敏
    text: scrubString(text, secrets),
    tokensInput: data.usage?.input_tokens ?? null,
    tokensOutput: data.usage?.output_tokens ?? null,
    raw: data,
  };
}

async function chatGoogle(request: ChatRequest, fetchImpl: FetchLike): Promise<ChatResponse> {
  const base = requireBaseUrl(request);
  const url = joinUrl(base, `models/${encodeURIComponent(request.model)}:generateContent`);
  // Google 官方支持用 `x-goog-api-key` 请求头传密钥。**绝不**把 key 拼进 URL 查询串：
  // 一旦 fetch 失败或返回非 2xx，含明文密钥的 url 会被塞进 PeanutError.details，
  // 而服务端会把 details 原样回传客户端，还可能随反代日志落地。
  const headers: Record<string, string> = {};
  if (request.apiKey) headers['x-goog-api-key'] = request.apiKey;
  const secrets = request.apiKey ? [request.apiKey] : [];

  const data = (await postJson(
    url,
    {
      contents: request.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      ...(request.messages.some((m) => m.role === 'system')
        ? {
            systemInstruction: {
              parts: [
                {
                  text: request.messages
                    .filter((m) => m.role === 'system')
                    .map((m) => m.content)
                    .join('\n\n'),
                },
              ],
            },
          }
        : {}),
      generationConfig: {
        temperature: request.temperature,
        ...(request.maxTokens !== null ? { maxOutputTokens: request.maxTokens } : {}),
      },
    },
    headers,
    request.timeoutMs,
    fetchImpl,
    secrets,
  )) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  if (!text) throw new PeanutError('AI_PROVIDER_ERROR', '大模型返回内容为空', safeDetails({ raw: data }, secrets));
  return {
    // 成功响应同样可能回显密钥，转发前必须脱敏
    text: scrubString(text, secrets),
    tokensInput: data.usageMetadata?.promptTokenCount ?? null,
    tokensOutput: data.usageMetadata?.candidatesTokenCount ?? null,
    raw: data,
  };
}

/** 按 provider 分发；Ollama 与国产兼容模式都走 OpenAI 协议。 */
export async function chat(request: ChatRequest, fetchImpl: FetchLike = fetch): Promise<ChatResponse> {
  switch (request.provider) {
    case 'anthropic':
      return chatAnthropic(request, fetchImpl);
    case 'google':
      return chatGoogle(request, fetchImpl);
    case 'openai':
    case 'deepseek':
    case 'qwen':
    case 'ernie':
    case 'zhipu':
    case 'ollama':
    case 'openai-compatible':
      return chatOpenAiCompatible(request, fetchImpl);
    default:
      throw new PeanutError('AI_PROVIDER_ERROR', `暂不支持的大模型提供方: ${String(request.provider)}`);
  }
}

/**
 * 列举供应商可用模型。
 *
 * 只有走 OpenAI 兼容协议的那些家（OpenAI / DeepSeek / 通义 / 智谱 / 文心 /
 * Ollama / 自建兼容服务）有 `GET {base}/models` 这个约定；Anthropic 与 Google
 * 没有对应的公开列表接口，此时**明确报"不支持自动列举"**，而不是返回空数组
 * 让界面显示成"没有模型"——那会把"不支持"误传成"你一个模型都没装"。
 */
export async function listModels(
  request: { provider: AiProviderKind | string; baseUrl: string | null; apiKey: string | null; timeoutMs?: number },
  fetchImpl: FetchLike = fetch,
): Promise<string[]> {
  const timeoutMs = request.timeoutMs && request.timeoutMs > 0 ? request.timeoutMs : DEFAULT_TIMEOUT_MS;
  const base = request.baseUrl?.replace(/\/+$/, '');
  if (!base) throw new PeanutError('AI_PROVIDER_ERROR', `${request.provider} 未配置 baseUrl，无法列举模型`);

  switch (request.provider) {
    case 'anthropic':
    case 'google':
      throw new PeanutError(
        'AI_PROVIDER_ERROR',
        `${request.provider} 不提供模型列表接口，请手动填写模型名称`,
      );
    default:
      break;
  }

  const headers: Record<string, string> = {};
  if (request.apiKey) headers['authorization'] = `Bearer ${request.apiKey}`;
  const secrets = request.apiKey ? [request.apiKey] : [];

  let response: Response;
  try {
    response = await fetchImpl(joinUrl(base, 'models'), {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const reason = scrubString(e instanceof Error ? e.message : String(e), secrets);
    throw new PeanutError(
      'AI_PROVIDER_ERROR',
      `列举模型失败：${reason}`,
      safeDetails({ url: joinUrl(base, 'models') }, secrets),
    );
  }

  const text = await response.text();
  if (!response.ok) {
    throw new PeanutError(
      'AI_PROVIDER_ERROR',
      `列举模型返回 HTTP ${response.status}`,
      safeDetails({ url: joinUrl(base, 'models'), body: text.slice(0, 800) }, secrets),
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    throw new PeanutError(
      'AI_PROVIDER_ERROR',
      '模型列表不是合法 JSON',
      safeDetails({ body: text.slice(0, 800) }, secrets),
    );
  }

  // OpenAI 风格：{ data: [{ id }] }；Ollama 原生 /api/tags 风格：{ models: [{ name }] }
  const asRecord = data as { data?: unknown; models?: unknown };
  const rawList = Array.isArray(asRecord.data)
    ? asRecord.data
    : Array.isArray(asRecord.models)
      ? asRecord.models
      : [];
  const ids = rawList
    .map((entry) => {
      const e = entry as { id?: unknown; name?: unknown; model?: unknown };
      const id = e.id ?? e.name ?? e.model;
      return typeof id === 'string' ? id : null;
    })
    .filter((id): id is string => id !== null);
  return [...new Set(ids)].sort();
}

/**
 * 从模型输出中提取 JSON。模型经常把 JSON 包在 ```json 代码块里，
 * 或在前后加解释文字，这里做容错提取。
 */
export function extractJson<T = unknown>(text: string): T | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fenced?.[1], text].filter((s): s is string => typeof s === 'string');
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      // 退一步：截取第一个 { 到最后一个 } 之间的内容
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start !== -1 && end > start) {
        try {
          return JSON.parse(trimmed.slice(start, end + 1)) as T;
        } catch {
          /* 继续尝试下一个候选 */
        }
      }
    }
  }
  return null;
}
