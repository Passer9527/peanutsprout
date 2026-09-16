/**
 * 花生苗数据库管理工具 - AI 助手模型
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { ColumnInfo, TableInfo } from './connection.js';
import type { CellValue, ColumnMeta } from './query.js';

export type AiProviderKind =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'qwen'
  | 'ernie'
  | 'zhipu'
  | 'deepseek'
  | 'ollama'
  | 'openai-compatible';

export type AiScene =
  | 'nl2sql'
  | 'explain'
  | 'optimize'
  | 'document'
  | 'ask'
  | 'diagnose'
  | 'object_manage';

export interface AiConfig {
  id: number;
  name: string;
  provider: AiProviderKind;
  modelName: string;
  baseUrl: string | null;
  temperature: number;
  maxTokens: number | null;
  timeoutMs: number;
  isDefault: boolean;
  enabled: boolean;
  extraParams: Record<string, unknown> | null;
  hasApiKey: boolean;
}

/** 发送给大模型的 schema 上下文；敏感字段应先经过脱敏网关。 */
export interface AiRequestContext {
  dbType?: string;
  schema?: string | null;
  tables?: TableInfo[];
  columns?: Record<string, ColumnInfo[]>;
  /** 结果集问答场景 */
  resultColumns?: ColumnMeta[];
  resultRows?: CellValue[][];
  /** 用户已经输入/选中的 SQL */
  currentSql?: string;
  /** 是否处于生产库（生产库默认禁止 AI 直接执行写操作） */
  production?: boolean;
  maxContextChars?: number;
}

export interface SqlGenerationResult {
  sql: string;
  explanation: string;
  /** 模型自评的置信度 0..1，低置信度界面要显著提示 */
  confidence: number;
  /** 生成过程中引用的表 */
  referencedTables: string[];
  /** 是否需要写操作确认 */
  requiresConfirmation: boolean;
  raw?: string;
}

export interface OptimizationResult {
  suggestions: Array<{
    title: string;
    detail: string;
    /** 建议改写后的 SQL（可选） */
    rewrittenSql?: string;
    severity: 'info' | 'warning' | 'critical';
  }>;
  raw?: string;
}

export interface DiagnosisResult {
  cause: string;
  suggestions: string[];
  raw?: string;
}

/** 脱敏规则：把敏感字段值替换为占位符后再出网。 */
export interface RedactionRule {
  /** 匹配列名（不区分大小写，支持 * 通配） */
  columnPattern: string;
  strategy: 'mask' | 'hash' | 'null' | 'partial';
  /** partial 策略下保留的首尾字符数 */
  keepStart?: number;
  keepEnd?: number;
}

export const DEFAULT_REDACTION_RULES: readonly RedactionRule[] = [
  { columnPattern: '*password*', strategy: 'null' },
  { columnPattern: '*passwd*', strategy: 'null' },
  { columnPattern: '*secret*', strategy: 'null' },
  { columnPattern: '*token*', strategy: 'null' },
  { columnPattern: '*id_card*', strategy: 'partial', keepStart: 3, keepEnd: 2 },
  { columnPattern: '*idcard*', strategy: 'partial', keepStart: 3, keepEnd: 2 },
  { columnPattern: '*phone*', strategy: 'partial', keepStart: 3, keepEnd: 2 },
  { columnPattern: '*mobile*', strategy: 'partial', keepStart: 3, keepEnd: 2 },
  { columnPattern: '*email*', strategy: 'mask' },
  { columnPattern: '*bank*card*', strategy: 'partial', keepStart: 4, keepEnd: 4 },
];

/**
 * 简单的列名通配匹配（大小写不敏感），用于脱敏规则。
 * 只支持 `*` 通配符，够用且不会有正则注入风险。
 */
export function matchColumnPattern(pattern: string, column: string): boolean {
  const p = pattern.toLowerCase();
  const c = column.toLowerCase();
  if (p === '*') return true;
  const parts = p.split('*').filter((s) => s.length > 0);
  if (parts.length === 0) return true;
  let idx = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const found = c.indexOf(part, idx);
    if (found === -1) return false;
    if (i === 0 && !p.startsWith('*') && found !== 0) return false;
    idx = found + part.length;
  }
  const last = parts[parts.length - 1];
  if (!p.endsWith('*') && !c.endsWith(last)) return false;
  return true;
}

/** 按规则脱敏单个值。 */
export function redactValue(value: CellValue, rule: RedactionRule): CellValue {
  // NULL 本身不含敏感信息，且把它替换成占位符会歪曲数据分布
  // （例如让模型误以为"这一列都有值"），因此一律原样保留。
  if (value === null || value === undefined) return null;

  switch (rule.strategy) {
    case 'null':
      return null;
    case 'hash':
      // 不用真哈希，避免给出可枚举空间下的反推便利；仅保留长度特征
      return `[hashed:${String(value).length}]`;
    case 'mask':
      return '***';
    case 'partial': {
      const s = String(value ?? '');
      const keepStart = rule.keepStart ?? 0;
      const keepEnd = rule.keepEnd ?? 0;
      if (s.length <= keepStart + keepEnd) return '***';
      return `${s.slice(0, keepStart)}${'*'.repeat(Math.min(s.length - keepStart - keepEnd, 8))}${s.slice(s.length - keepEnd)}`;
    }
    default:
      return value;
  }
}
