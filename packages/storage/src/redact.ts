/**
 * 花生苗数据库管理工具 - 连接串 / 自由文本凭据清洗（转发）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 实现已移到 `@peanutsprout/core`：驱动层（packages/drivers）也需要在同一处
 * 做错误信息的凭据清洗，而 drivers **不应该反向依赖存储层**（那会把
 * 持久化/主密钥那一整条依赖链拖进纯协议驱动里）。core 无任何依赖，
 * 是这类"每个数据出口都必须过一遍"的纯工具最合适的位置。
 *
 * 这里保留同路径转发，是为了不让既有调用方（connections.ts、audit.ts 等）
 * 因为搬家而被迫改动。
 */
export {
  isPasswordParamName,
  isCredentialQueryParam,
  safeDecode,
  decodeQueryComponent,
  parseQueryParams,
  extractPasswordFromParams,
  stripCredentialParams,
  isConnectionCredentialParam,
  stripUrlCredentials,
  redactConnectionUrl,
  scrubCredentialText,
} from '@peanutsprout/core';
