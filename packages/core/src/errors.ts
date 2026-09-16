/**
 * 花生苗数据库管理工具 - 统一错误模型
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/** 稳定的机器可读错误码（REST 层会原样返回给客户端，勿随意改名）。 */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'AUTH_REQUIRED'
  | 'AUTH_INVALID_CREDENTIALS'
  | 'AUTH_TOKEN_INVALID'
  | 'AUTH_TOKEN_EXPIRED'
  | 'AUTH_ACCOUNT_DISABLED'
  | 'AUTH_ACCOUNT_LOCKED'
  | 'AUTH_FORBIDDEN'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'READONLY_VIOLATION'
  | 'CONFIRMATION_REQUIRED'
  | 'DRIVER_NOT_IMPLEMENTED'
  | 'CONNECTION_FAILED'
  | 'QUERY_FAILED'
  | 'QUERY_TIMEOUT'
  | 'QUERY_CANCELLED'
  | 'MIGRATION_FAILED'
  | 'AI_DISABLED'
  | 'AI_PROVIDER_ERROR'
  | 'INTERNAL';

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  AUTH_REQUIRED: 401,
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_TOKEN_INVALID: 401,
  AUTH_TOKEN_EXPIRED: 401,
  AUTH_ACCOUNT_DISABLED: 403,
  AUTH_ACCOUNT_LOCKED: 423,
  AUTH_FORBIDDEN: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  READONLY_VIOLATION: 403,
  CONFIRMATION_REQUIRED: 428,
  DRIVER_NOT_IMPLEMENTED: 501,
  CONNECTION_FAILED: 502,
  QUERY_FAILED: 400,
  QUERY_TIMEOUT: 504,
  QUERY_CANCELLED: 499,
  MIGRATION_FAILED: 500,
  AI_DISABLED: 403,
  AI_PROVIDER_ERROR: 502,
  INTERNAL: 500,
};

/** 领域异常基类：所有对外可见的失败都应抛这个（或其子类）。 */
export class PeanutError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  /**
   * @param options.status 显式覆盖由 `code` 推导出的状态码。
   *   只有一种用途：把框架（Fastify）抛出的 4xx（如 413 请求体过大、415 内容类型不支持）
   *   原样透出去 —— 这类语义在 `ErrorCode` 里没有一一对应的取值，
   *   若强行归到某个 code 上就会丢掉真实状态码，客户端只能看到 400。
   *   业务代码一律不要传它。
   */
  constructor(code: ErrorCode, message: string, details?: unknown, options?: { status?: number }) {
    super(message);
    this.name = 'PeanutError';
    this.code = code;
    this.status = options?.status ?? DEFAULT_STATUS[code] ?? 500;
    this.details = details;
  }

  toJSON(): { error: { code: ErrorCode; message: string; details?: unknown } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export const isPeanutError = (e: unknown): e is PeanutError => e instanceof PeanutError;

export const validationFailed = (message: string, details?: unknown): PeanutError =>
  new PeanutError('VALIDATION_FAILED', message, details);

export const notFound = (what: string, id?: unknown): PeanutError =>
  new PeanutError('NOT_FOUND', id === undefined ? `${what}不存在` : `${what}不存在: ${String(id)}`);

export const forbidden = (message = '权限不足'): PeanutError =>
  new PeanutError('AUTH_FORBIDDEN', message);

/**
 * 把任意异常归一化为 PeanutError，便于 REST 层统一处理。
 *
 * **未预期异常绝不把堆栈或原始 message 回传给客户端**：`e.stack` 会暴露服务端
 * 源码的绝对路径与内部结构，而原生错误信息（例如 SQLite 的报错）也可能带出
 * 库文件路径或表结构。这些信息只应进服务端日志 ——
 * `apps/server/src/http.ts` 的 setErrorHandler 已经用 `req.log.error` 记下了完整错误，
 * 所以这里回一个通用文案不会丢排查线索。
 *
 * 注意：驱动层已把 SQL 错误包装成 `QUERY_FAILED` 等 PeanutError 并保留原始信息，
 * 因此走这条兜底分支的只剩"真的没预料到"的异常，用户本来也无从处理。
 */
/**
 * Fastify 自己抛出的 4xx（畸形 JSON、请求体超限、Content-Type 不支持……）。
 *
 * 这类错误带有正确的 `statusCode`，但它们不是 `PeanutError`，
 * 旧实现因此把它们一律归成 `INTERNAL`(500)：客户端收到"服务端错误"，
 * 服务端还按 5xx 打 error 级日志。于是一个**未登录**的人只要反复 POST 一个坏 JSON
 * 就能刷出大量 error 日志、污染监控与告警（放大日志写盘）。
 *
 * 这里只认 4xx：真正的 5xx 仍然走通用兜底，绝不外泄内部信息。
 */
function frameworkClientError(e: unknown): PeanutError | null {
  if (typeof e !== 'object' || e === null) return null;
  const status = (e as { statusCode?: unknown }).statusCode;
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 400 || status > 499) {
    return null;
  }
  const mapped: Record<number, { code: ErrorCode; message: string }> = {
    400: { code: 'VALIDATION_FAILED', message: '请求内容不合法' },
    401: { code: 'AUTH_REQUIRED', message: '请先登录' },
    403: { code: 'AUTH_FORBIDDEN', message: '权限不足，无法执行该操作' },
    404: { code: 'NOT_FOUND', message: '请求的资源不存在' },
    409: { code: 'CONFLICT', message: '请求与当前状态冲突' },
    413: { code: 'VALIDATION_FAILED', message: '请求体过大' },
    415: { code: 'VALIDATION_FAILED', message: '不支持的请求内容类型' },
    428: { code: 'CONFIRMATION_REQUIRED', message: '该操作需要二次确认' },
    429: { code: 'AUTH_FORBIDDEN', message: '请求过于频繁，请稍后再试' },
  };
  const hit = mapped[status] ?? { code: 'VALIDATION_FAILED' as ErrorCode, message: '请求不合法' };
  // 只回稳定标识（如 FST_ERR_CTP_INVALID_JSON_BODY），不回框架原文：
  // 原文是英文且可能带内部细节，排查线索在服务端日志里已经有了。
  const code = (e as { code?: unknown }).code;
  return new PeanutError(
    hit.code,
    hit.message,
    typeof code === 'string' ? { frameworkCode: code } : undefined,
    { status },
  );
}

export function normalizeError(e: unknown): PeanutError {
  if (isPeanutError(e)) return e;
  const framework = frameworkClientError(e);
  if (framework) return framework;
  return new PeanutError('INTERNAL', '服务内部错误，详情请查看服务端日志');
}
