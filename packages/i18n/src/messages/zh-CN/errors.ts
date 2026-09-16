/**
 * 简体中文（源语言）· 错误码文案
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 服务端的 `error.message` 只有中文。客户端按稳定的 `error.code` 在本表取
 * 当前语言的文案，因此**切换语言后错误提示也会跟着变**。
 * 服务端原文不会丢：它仍然显示在错误详情的「原始信息」里，
 * 便于排查（技术细节不做机器翻译）。
 */
export default {
  'error.VALIDATION_FAILED': '提交的内容不合法',
  'error.AUTH_REQUIRED': '请先登录',
  'error.AUTH_INVALID_CREDENTIALS': '用户名或密码错误',
  'error.AUTH_TOKEN_INVALID': '登录凭证无效，请重新登录',
  'error.AUTH_TOKEN_EXPIRED': '登录已过期，请重新登录',
  'error.AUTH_ACCOUNT_DISABLED': '账号已被禁用，请联系管理员',
  'error.AUTH_ACCOUNT_LOCKED': '账号因多次登录失败已被临时锁定，请稍后再试',
  'error.AUTH_FORBIDDEN': '权限不足，无法执行该操作',
  'error.PASSWORD_CHANGE_REQUIRED': '当前仍在使用初始口令，请先修改密码',
  'error.NOT_FOUND': '请求的资源不存在',
  'error.CONFLICT': '与现有数据冲突',
  'error.READONLY_VIOLATION': '当前连接为只读模式，已拒绝写操作',
  'error.CONFIRMATION_REQUIRED': '该操作需要二次确认后才能执行',
  'error.DRIVER_NOT_IMPLEMENTED': '该数据库类型的驱动尚未实现',
  'error.CONNECTION_FAILED': '连接数据库失败，请检查地址、端口与凭据',
  'error.QUERY_FAILED': 'SQL 执行失败',
  'error.QUERY_TIMEOUT': '查询超时，请优化语句或缩小数据范围',
  'error.QUERY_CANCELLED': '查询已被取消',
  'error.MIGRATION_FAILED': '迁移执行失败',
  'error.AI_DISABLED': 'AI 功能未启用，请先在设置中配置供应商',
  'error.AI_PROVIDER_ERROR': 'AI 供应商返回错误，请检查密钥与配额',
  'error.INTERNAL': '服务器内部错误',

  // 错误详情区
  'error.details': '错误详情',
  'error.code': '错误码',
  'error.originalMessage': '原始信息（服务端）',
  'error.retryHint': '你可以修正后重试，或把错误码与原始信息提供给管理员。',
} as const;
