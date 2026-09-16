/**
 * 花生苗数据库管理工具 - 连接串 / 自由文本凭据清洗
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 设计原则（来自一次真实复现的口令泄漏）：
 *
 *   1. **脱敏必须与「能否解析」解耦**。此前 `redactConnectionUrl` 先 `new URL()`，
 *      解析失败就退回一条 `[^/@]*` 的正则；口令里只要带一个 `/`
 *      （`postgres://u:Sl/ash@h/db`）两个分支都会失效，原文（含口令）原样回传。
 *      这里改成纯字符串扫描，不依赖 URL 构造器成功与否 ——
 *      **宁可把连接串写坏一点，也绝不把口令写出去**。
 *
 *   2. userinfo 按**最后一个 `@`** 切分，因此口令里含 `@`（`user:p@ss@host`）
 *      或含 `/`（`user:Sl/ash@host`）都不会切错。
 *
 *   3. 查询串里的 `password/passwd/pwd/...` 一律抹掉；提取口令交给调用方
 *      （见 `extractPasswordFromParams`），因为它要加密进 `password_enc`。
 */

/** 查询串里名字像「口令」的参数（大小写不敏感；允许 `sslpassword` 这类前缀）。 */
export function isPasswordParamName(name: string | null | undefined): boolean {
  const lower = String(name ?? '').toLowerCase();
  if (!lower) return false;
  return lower === 'pass' || /(password|passwd|pwd)/.test(lower);
}

/**
 * 连接串/自由文本里必须抹掉的 query 参数名。比 `isPasswordParamName` 略宽：
 * 自由文本与 URL 里出现的 `secret` 也一并清掉（审计是最后一道防线，宁可多清）。
 * 刻意不泛匹配 `key`，否则会误伤 `sslkey` 这类证书路径参数。
 */
export function isCredentialQueryParam(name: string | null | undefined): boolean {
  const lower = String(name ?? '').trim().toLowerCase();
  if (!lower) return false;
  if (isPasswordParamName(lower)) return true;
  if (/secret/.test(lower)) return true;
  // 以分隔符包起来的 key/token/auth，覆盖 api_key / x-api-key / access_token / client_assertion
  return /(?:^|[_.-])(?:key|token|auth)(?:$|[_.-])/.test(lower);
}

/** `decodeURIComponent` 的安全版：非法编码时原样返回，绝不抛错。 */
export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** 查询串分量解码：与 WHATWG URL 一致，把 `+` 当成空格。 */
export function decodeQueryComponent(value: string): string {
  const plusDecoded = value.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(plusDecoded);
  } catch {
    return plusDecoded;
  }
}

/** 解析 `a=1&b=2;c=3` 形式的查询串（同时支持 `&` 与 `;` 分隔，大小写不敏感）。 */
export function parseQueryParams(rawQuery: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (!rawQuery) return params;
  for (const pair of rawQuery.split(/[&;]/)) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = decodeQueryComponent(eq >= 0 ? pair.slice(0, eq) : pair).trim();
    if (!key) continue;
    params[key] = eq >= 0 ? decodeQueryComponent(pair.slice(eq + 1)) : '';
  }
  return params;
}

/**
 * 从已解析的参数里挑出口令参数：返回口令与「不含凭据的其余参数」。
 *
 * - 口令形态（`?password=` ...）会被抽成凭据；
 * - 其余凭据形态（`token`/`secret`/`auth`/`api_key` ...）直接**丢弃**：
 *   `extra_params` 是明文 JSON 列，绝不能让凭据落进去；
 * - 普通参数（charset/ssl/sslmode/...）原样保留。
 */
export function extractPasswordFromParams(params: Record<string, string>): {
  password: string | null;
  rest: Record<string, string>;
} {
  let password: string | null = null;
  const rest: Record<string, string> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (isPasswordParamName(key)) {
      password ??= value || null;
    } else if (!isCredentialQueryParam(key)) {
      rest[key] = value;
    }
  }
  return { password, rest };
}

/** 去掉参数表里所有凭据形态的键（读取历史脏数据时用；`sslkey` 这类不算凭据）。 */
export function stripCredentialParams(
  params: Record<string, string> | null | undefined,
): Record<string, string> | null {
  if (!params) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (isCredentialQueryParam(key)) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * 连接串里必须从 query 抹掉的参数名：口令形态 + `secret`/`token`/`auth` 形态。
 *
 * 采用与审计文本相同的宽判定（`isCredentialQueryParam`）：凭据一旦出现在
 * query 里就绝不能随 DTO 回传。会误伤 `sslkey=...` 吗？不会 —— 该判定要求
 * `key` 前面是分隔符或串首，`sslkey` 的 `key` 前面是字母 `l`，保持不动。
 * 被误删风险最高的裸 `key=` 其实也不会丢：非口令参数仍会保留在 extraParams 里
 * （见 `normalizeConnectionInput`），驱动需要的参数照样拿得到。
 */
export function isConnectionCredentialParam(name: string | null | undefined): boolean {
  return isCredentialQueryParam(name);
}

/** 在任意位置查找 `scheme://`（宽容前缀文本，例如 `连接串: postgres://...`）。 */
function findScheme(input: string): { index: number; scheme: string } | null {
  const m = /[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.exec(input);
  return m ? { index: m.index, scheme: m[0] } : null;
}

/**
 * 纯字符串版的连接串清洗：清除 userinfo 里的口令与查询串里的凭据参数。
 *
 * 与 `new URL()` 完全解耦 —— 任何输入都一定能返回一个「不含口令」的字符串，
 * 最坏情况是把连接串写坏（丢掉路径/参数），也不会原样返回。
 *
 * @param paramPredicate 判断某个 query 参数名是否属于凭据。连接串默认只清
 *   口令形态；审计文本清洗会传入更宽的判定。
 */
export function stripUrlCredentials(
  input: string,
  paramPredicate: (name: string) => boolean = isCredentialQueryParam,
): string {
  const scheme = findScheme(input);
  const start = scheme ? scheme.index : 0;
  const head = input.slice(0, start) + (scheme ? scheme.scheme : '');
  let body = input.slice(start + (scheme ? scheme.scheme.length : 0));

  // 先摘掉 fragment / query：它们里面的 '@' 不能干扰 userinfo 的判定
  let fragment = '';
  const hashIdx = body.indexOf('#');
  if (hashIdx >= 0) {
    fragment = body.slice(hashIdx);
    body = body.slice(0, hashIdx);
  }
  let query = '';
  const queryIdx = body.indexOf('?');
  if (queryIdx >= 0) {
    query = body.slice(queryIdx + 1);
    body = body.slice(0, queryIdx);
  }

  // userinfo：取**最后一个** '@'。口令里可能含 '/'（Sl/ash）甚至 '@'（p@ss），
  // 用第一个 '/' 或第一个 '@' 切都会切错。
  const at = body.lastIndexOf('@');
  if (at >= 0) {
    const userinfo = body.slice(0, at);
    const hostPart = body.slice(at + 1);
    // 只丢掉口令，保留用户名（首个 ':' 之前的部分）
    const colon = userinfo.indexOf(':');
    const username = colon >= 0 ? userinfo.slice(0, colon) : userinfo;
    body = username ? `${username}@${hostPart}` : hostPart;
  }

  const keptParams = query
    ? query.split(/[&;]/).filter((pair) => {
        if (!pair) return false;
        const eq = pair.indexOf('=');
        const name = decodeQueryComponent(eq >= 0 ? pair.slice(0, eq) : pair);
        return !paramPredicate(name);
      })
    : [];
  const queryPart = keptParams.length > 0 ? `?${keptParams.join('&')}` : '';

  return `${head}${body}${queryPart}${fragment}`;
}

/**
 * 去掉连接串里的用户名与口令，只保留 `scheme://host:port/db?params`。
 *
 * 写入时清洗（保证新数据干净）+ 读取时再清洗（兜住历史遗留的旧数据）。
 * 解析不了也绝不回退成原文：见 `stripUrlCredentials` 的设计原则。
 */
export function redactConnectionUrl(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const stripped = stripUrlCredentials(trimmed, isConnectionCredentialParam);
  return stripped.length > 0 ? stripped : null;
}

/** `password=xxx` 形态（自由文本里最常见的凭据落法）。 */
const PASSWORD_ASSIGN =
  /((?:[A-Za-z0-9_.-]*(?:password|passwd|pwd)[A-Za-z0-9_.-]*|pass)\s*=)([^\s&;"'`]*)/gi;
/** JSON 里以密钥命名的字段（审计 detail 可能整段 JSON 落库）。 */
const JSON_SECRET_FIELD =
  /("(?:password|passwd|pwd|api[_-]?key|apikey|access[_-]?token|token|secret|authorization)"\s*:\s*")([^"]*)(")/gi;

/**
 * 自由文本（审计 errorMessage / detail）的通用凭据清洗：**最后一道防线**。
 *
 * 即使上游某处漏了脱敏，只要口令以 `scheme://user:PASS@host`、
 * 无 scheme 的 `user:PASS@host` 或 `password=xxx` 的形态出现在文本里，
 * 落库前都会被抹掉。审计是不可变的历史，写进去就晚了。
 */
export function scrubCredentialText(text: string): string {
  if (!text) return text;
  let out = text
    // password=xxx / sslpassword=xxx / pwd=xxx（大小写不敏感）
    .replace(PASSWORD_ASSIGN, '$1***')
    .replace(JSON_SECRET_FIELD, '$1***$3');

  // URL / DSN 形态：按「非空白片段」逐个清洗，避免误伤整段中文描述。
  out = out.replace(/[^\s"'`<>]+/g, (token) => {
    if (!token.includes('@') && !token.includes('://')) return token;
    return stripUrlCredentials(token, isCredentialQueryParam);
  });
  return out;
}
