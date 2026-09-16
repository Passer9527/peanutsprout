/**
 * 统一 fetch 封装：token 注入、查询串拼装、错误归一化、401 自动登出。
 *
 * 约定：所有业务接口都返回 JSON；错误响应体统一为
 *   { "error": { "code": string, "message": string, "details"?: any } }
 *
 * i18n：本模块不是 React 组件，不能使用 useI18n()，因此这里不拼任何界面文案。
 * 错误只保留稳定的 code 与服务端原文；展示层把 `t` 传给 describeError 来本地化。
 */
import type { StrictTranslateFn } from '@peanutsprout/i18n';
import type { ApiErrorBody } from './types';

export const API_BASE = '/api/v1';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  query?: Record<string, QueryValue>;
  /** 覆盖基址，默认 /api/v1；传空串表示不带前缀 */
  base?: string;
  /** 登录、健康检查等接口跳过 Authorization 注入 */
  skipAuth?: boolean;
  signal?: AbortSignal;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** 网络不可达（服务未启动 / DNS 失败等） */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

let authToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;
let passwordChangeRequiredHandler: (() => void) | null = null;

/** 由 AuthProvider 在登录 / 登出 / 启动校验时同步 token */
export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

/** 注册 401 回调，由 AuthProvider 负责清理本地登录态 */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

/**
 * 注册"必须先改密"回调。
 *
 * 服务端在仍使用内置默认口令时，会对除改密相关接口之外的一切请求返回
 * 403 PASSWORD_CHANGE_REQUIRED。这是个**状态**而不是某个页面的错误：
 * 一旦出现，界面应立刻切到强制改密页，而不是在各自页面弹一堆看不懂的提示。
 */
export function setPasswordChangeRequiredHandler(handler: (() => void) | null): void {
  passwordChangeRequiredHandler = handler;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function buildQueryString(query: Record<string, QueryValue> | undefined): string {
  if (!query) {
    return '';
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    params.set(key, String(value));
  }
  const text = params.toString();
  return text.length > 0 ? `?${text}` : '';
}

function parseJson(text: string): unknown {
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function normalizeErrorBody(payload: unknown, status: number): ApiErrorBody {
  if (isRecord(payload) && isRecord(payload.error)) {
    const raw = payload.error;
    return {
      code: typeof raw.code === 'string' ? raw.code : `http_${status}`,
      // 没有服务端 message 时留空：展示层按 code 走 error.* / common.* 词条本地化
      message:
        typeof raw.message === 'string' && raw.message.length > 0 ? raw.message : '',
      details: raw.details,
    };
  }
  if (typeof payload === 'string' && payload.trim().length > 0) {
    return { code: `http_${status}`, message: payload.slice(0, 200) };
  }
  return { code: `http_${status}`, message: '' };
}

async function send(url: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (!options.skipAuth && authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  try {
    return await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body,
      signal: options.signal,
      credentials: 'same-origin',
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw cause;
    }
    throw new ApiError(
      0,
      'network_error',
      '',
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}

/** 发起一次请求并返回已解析的响应体 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const base = options.base === undefined ? API_BASE : options.base;
  const url = `${base}${path}${buildQueryString(options.query)}`;
  const response = await send(url, options);
  const rawText = await response.text();
  const payload = parseJson(rawText);

  if (!response.ok) {
    const normalized = normalizeErrorBody(payload, response.status);
    if (response.status === 401 && !options.skipAuth) {
      authToken = null;
      unauthorizedHandler?.();
    } else if (response.status === 403 && normalized.code === 'PASSWORD_CHANGE_REQUIRED') {
      passwordChangeRequiredHandler?.();
    }
    throw new ApiError(response.status, normalized.code, normalized.message, normalized.details);
  }

  return payload as T;
}

/**
 * 下载类请求：响应体是二进制（例如导出的 .xlsx）。
 *
 * 不能复用 `request()` —— 那条路会先 `response.text()` 再按 JSON 解析，
 * 二进制内容会被破坏。这里复用同一套鉴权头与错误归一化逻辑，
 * 只把"读响应体"这一步换成 blob，避免两处各写一份鉴权导致行为漂移。
 */
export async function requestBlob(
  path: string,
  options: RequestOptions = {},
): Promise<{ blob: Blob; headers: Headers }> {
  const base = options.base === undefined ? API_BASE : options.base;
  const url = `${base}${path}${buildQueryString(options.query)}`;
  const response = await send(url, options);
  if (!response.ok) {
    const payload = parseJson(await response.text());
    const normalized = normalizeErrorBody(payload, response.status);
    if (response.status === 401 && !options.skipAuth) {
      authToken = null;
      unauthorizedHandler?.();
    } else if (response.status === 403 && normalized.code === 'PASSWORD_CHANGE_REQUIRED') {
      passwordChangeRequiredHandler?.();
    }
    throw new ApiError(response.status, normalized.code, normalized.message, normalized.details);
  }
  return { blob: await response.blob(), headers: response.headers };
}

/**
 * 展示层传入的本地化工具（结构上兼容 `useI18n()` 的返回值）。
 * 本模块不能用 React Hook，所以由调用方注入。
 */
export interface ErrorLocalizers {
  t: StrictTranslateFn;
  localizeError: (error: { code?: string; message?: string } | null | undefined) => string;
}

/**
 * 把任意异常转成可展示文案。
 *
 * i18n：本模块拿不到 React Hook，因此把本地化工具作为可选参数传入
 * （任务约定的"接受一个 t 参数"做法）：
 *   - 服务端业务错误：优先交给 `localizeError` 按稳定的 `error.<CODE>` 词条本地化，
 *     缺词条时回退服务端原文，再回退 common.serverError；
 *   - 传输层错误（网络不可达 / 401 / 403 / 超时）：没有对应错误码词条，
 *     落到 common.* 通用文案。
 * 不传本地化工具时只返回服务端原文或错误码本身，供非界面场景使用。
 */
export function describeError(error: unknown, localizers?: ErrorLocalizers): string {
  if (error instanceof ApiError) {
    if (!localizers) {
      return error.message || error.code;
    }
    const { t, localizeError } = localizers;
    if (error.isNetworkError) {
      return t('common.networkError');
    }
    if (error.status === 401) {
      return t('common.sessionExpired');
    }
    if (error.status === 403) {
      return t('common.accessDenied');
    }
    if (error.status === 408 || error.status === 504) {
      return t('common.timeoutError');
    }
    return (
      localizeError({ code: error.code, message: error.message }) ||
      error.message ||
      t('common.serverError')
    );
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
