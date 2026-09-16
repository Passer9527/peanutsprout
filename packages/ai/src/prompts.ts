/**
 * 花生苗数据库管理工具 - 提示词构造
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { AiRequestContext, ExecutionPlan, RedactionRule } from '@peanutsprout/core';
import type { ChatMessage } from './provider.js';

const BASE_RULES = [
  '你是花生苗数据库管理工具内置的数据库助手。',
  '只回答与数据库、SQL、数据建模、性能优化相关的问题。',
  '不要编造不存在的表名或列名，只能使用下方给出的 schema。',
  '回答使用简体中文，SQL 使用目标数据库的方言。',
].join('\n');

export interface PromptBundle {
  messages: ChatMessage[];
  /** 便于审计：本场景发送了哪些敏感列已脱敏 */
  notes: string[];
}

function schemaBlock(context: AiRequestContext): string {
  if (!context.tables || context.tables.length === 0) return '（未提供 schema 上下文）';
  const parts: string[] = [];
  if (context.dbType) parts.push(`数据库类型：${context.dbType}`);
  if (context.schema) parts.push(`当前 schema：${context.schema}`);
  parts.push('可用对象：');
  for (const table of context.tables) {
    parts.push(`- ${table.name}${table.comment ? `（${table.comment}）` : ''}`);
    const cols = context.columns?.[table.name] ?? [];
    for (const col of cols) {
      const flags = [col.isPrimaryKey ? '主键' : null, col.nullable ? '' : '非空'].filter(Boolean).join('/');
      parts.push(`    ${col.name} ${col.dataType}${flags ? ` [${flags}]` : ''}${col.comment ? ` ${col.comment}` : ''}`);
    }
  }
  return parts.join('\n');
}

/** 自然语言转 SQL（PRD 4.5 NL2SQL）。强制返回 JSON，便于稳定解析。 */
export function nl2sqlPrompt(naturalLanguage: string, context: AiRequestContext): PromptBundle {
  const system = `${BASE_RULES}

要求：
1. 只生成一条可执行的 SQL 语句，不要生成多条，不要包含事务控制。
2. 返回严格的 JSON，不要加任何解释文字或 Markdown 代码块：
{"sql":"...","explanation":"中文说明","confidence":0.0到1.0,"referencedTables":["表名"],"requiresConfirmation":true|false}
3. 涉及 INSERT/UPDATE/DELETE/DDL 时 requiresConfirmation 必须为 true。
4. 若信息不足以生成 SQL，sql 返回空字符串，并在 explanation 中说明缺少什么。`;

  const user = `【数据库结构】
${schemaBlock(context)}

【用户需求】
${naturalLanguage}`;

  return { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], notes: [] };
}

export function explainPrompt(sql: string): PromptBundle {
  const system = `${BASE_RULES}

任务：解释给定 SQL 的业务含义与执行逻辑。
要求：先用一句话概括这条 SQL 做什么，再分点说明关键子句（表连接、过滤条件、聚合、排序、限制），最后提示潜在风险（全表扫描、隐式类型转换、缺少 LIMIT 等）。使用简体中文，不要重复粘贴整条 SQL。`;
  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `请解释以下 SQL：\n\n${sql}` },
    ],
    notes: [],
  };
}

export function optimizePrompt(sql: string, plan: ExecutionPlan | null): PromptBundle {
  const planText = plan
    ? `\n\n【执行计划】\n${plan.content.slice(0, 4000)}`
    : '\n\n（未提供执行计划）';
  const system = `${BASE_RULES}

任务：给出 SQL 优化建议，重点关注索引、连接顺序、谓词下推、聚合与排序代价。
只返回一个 JSON 对象，不要 Markdown 代码块、不要额外文字。suggestions 是建议数组：
{"suggestions":[{"title":"简短标题","detail":"中文详细说明","rewrittenSql":"可选，改写后的 SQL","severity":"info|warning|critical"}]}`;
  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `请优化以下 SQL：\n\n${sql}${planText}` },
    ],
    notes: [],
  };
}

export function documentPrompt(context: AiRequestContext): PromptBundle {
  const system = `${BASE_RULES}

任务：为给定表结构生成数据字典文档。
要求：Markdown 格式；每张表一个小节，包含表用途说明与字段表格（字段名 / 类型 / 是否可空 / 说明），最后给出索引与使用建议。不要编造未提供的字段。`;
  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `请为以下结构生成数据字典：\n\n${schemaBlock(context)}` },
    ],
    notes: [],
  };
}

/**
 * 构造结果集问答提示词。
 *
 * `redacted` 必须传**本次实际**是否做了脱敏：旧实现把「敏感列已脱敏」写死在模板里，
 * 关闭脱敏时会向模型宣称一份它其实收到的明文数据已经脱敏 —— 模型据此判断
 * 「这些不是真实数据」，回答的置信度与措辞都会跟着错。
 */
export function askPrompt(
  question: string,
  context: AiRequestContext,
  redacted = true,
): PromptBundle {
  const columns = context.resultColumns?.map((c) => c.name).join(', ') ?? '（无）';
  const preview = (context.resultRows ?? [])
    .slice(0, 50)
    .map((row) => row.map((cell) => (cell === null ? 'NULL' : String(cell))).join(' | '))
    .join('\n');
  const system = `${BASE_RULES}

任务：基于给定的查询结果回答用户问题。
要求：只依据提供的数据作答；数据不足以回答时明确说明，不要推测。涉及数值统计时给出计算过程。使用简体中文。`;
  const previewNote = redacted
    ? '最多 50 行，敏感列已脱敏'
    : '最多 50 行，未脱敏（包含真实数据，请勿在回答中复述敏感值）';
  const user = `【结果集列】${columns}
【数据预览（${previewNote}）】
${preview}

【问题】
${question}`;
  return { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], notes: [] };
}

export function diagnosePrompt(error: string, sql: string): PromptBundle {
  const system = `${BASE_RULES}

任务：诊断 SQL 报错原因并给出修复方案。
返回严格 JSON，不要 Markdown 代码块：
{"cause":"根本原因（中文）","suggestions":["修复步骤1","修复步骤2"]}`;
  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `【SQL】\n${sql}\n\n【报错信息】\n${error}` },
    ],
    notes: [],
  };
}

/** 把脱敏规则的命中情况写进提示词的说明里，便于审计追溯。 */
export function withRedactionNotes(bundle: PromptBundle, rules: readonly RedactionRule[]): PromptBundle {
  if (rules.length === 0) return bundle;
  const summary = rules.map((r) => `${r.columnPattern}:${r.strategy}`).join(', ');
  return { ...bundle, notes: [...bundle.notes, `已应用脱敏规则 → ${summary}`] };
}
