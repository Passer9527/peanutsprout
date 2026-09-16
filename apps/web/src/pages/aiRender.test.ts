/**
 * 花生苗数据库管理工具 - AI 结果块真实渲染测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 为什么要有这个文件：`tsc` 只保证类型对，`vite build` 只保证模块能解析，
 * 两者都**不会**发现"渲染时读到 undefined 的属性""hook 数量在两次渲染间变了"
 * 这类错误 —— 那些要真的把组件跑一遍才会暴露。
 *
 * 本机没有任何 DOM 实现（无 jsdom / happy-dom），所以走 `react-dom/server` 的
 * `renderToStaticMarkup`：它不需要 DOM，能把整棵组件树真实执行一遍。
 * 代价是 `useEffect` 不会跑（SSR 语义），因此这里覆盖的是**首屏渲染**路径 ——
 * 恰好是本轮新增的「执行 / 复制 / 导出」动作条与导出表单所在的那条路径。
 *
 * 用 `createElement` 而不是 JSX：vitest 只收集 `*.test.ts`，而 `.ts` 里不能写 JSX。
 */
import { createElement as h, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../state/i18n.js';
import { ToastProvider } from '../state/toast.js';
import { DiagnoseBlock, OptimizeBlock, SqlResultBlock } from './AiAssistantPage.js';
import type { AiDiagnoseResultDTO, AiOptimizeResultDTO, AiSqlResultDTO, ConnectionDTO } from '../api/types.js';

const wrap = (node: ReactNode) =>
  renderToStaticMarkup(h(I18nProvider, null, h(ToastProvider, null, node)));

const connections: ConnectionDTO[] = [
  { id: 1, name: '本地库', dbType: 'sqlite' },
  { id: 2, name: '生产库', dbType: 'postgresql' },
] as ConnectionDTO[];

const sqlResult: AiSqlResultDTO = {
  sql: 'SELECT id, name FROM orders WHERE amount > 100',
  explanation: '按金额过滤订单',
  confidence: 0.82,
  referencedTables: ['orders'],
  requiresConfirmation: false,
  connectionId: 1,
  historyId: 7,
};

const noopCopy = async () => {};

describe('SQL 结果块渲染（生成后由用户选择执行或复制）', () => {
  it('渲染出「执行」与「复制 SQL」两个动作 —— 也就是需求里那个二选一', () => {
    const html = wrap(
      h(SqlResultBlock, { result: sqlResult, fallbackConnectionId: 1, connections, onCopy: noopCopy }),
    );
    expect(html).toContain('执行');
    expect(html).toContain('复制 SQL');
    // 「不会自动执行」的提示必须在，且文案要指向这两个动作
    expect(html).toContain('不会自动执行');
  });

  it('渲染出导出动作（Excel 与另一个数据库）', () => {
    const html = wrap(
      h(SqlResultBlock, { result: sqlResult, fallbackConnectionId: 1, connections, onCopy: noopCopy }),
    );
    expect(html).toContain('导出 Excel');
    expect(html).toContain('导出到数据库');
  });

  it('SQL 原文被原样呈现（用户要能先看到再决定）', () => {
    const html = wrap(
      h(SqlResultBlock, { result: sqlResult, fallbackConnectionId: 1, connections, onCopy: noopCopy }),
    );
    // SQL 里的 > 会被转义成 &gt;，断言转义后的形式
    expect(html).toContain('orders WHERE amount &gt; 100');
    expect(html).toContain('82%');
    expect(html).toContain('orders');
  });

  it('没有 connectionId 也不崩（禁用态而不是抛异常）', () => {
    const result = { ...sqlResult, connectionId: undefined };
    expect(() =>
      wrap(h(SqlResultBlock, { result, fallbackConnectionId: null, connections, onCopy: noopCopy })),
    ).not.toThrow();
  });

  it('空 SQL 不会渲染出动作条（没有东西可执行）', () => {
    const result: AiSqlResultDTO = { ...sqlResult, sql: '', explanation: '模型只回了一句话' };
    const html = wrap(
      h(SqlResultBlock, { result, fallbackConnectionId: 1, connections, onCopy: noopCopy }),
    );
    expect(html).not.toContain('复制 SQL');
    expect(html).toContain('模型只回了一句话');
  });

  it('做模型返回的引用表为空时不渲染空徽标', () => {
    const result: AiSqlResultDTO = { ...sqlResult, referencedTables: [] };
    const html = wrap(
      h(SqlResultBlock, { result, fallbackConnectionId: 1, connections, onCopy: noopCopy }),
    );
    expect(html).not.toContain('涉及表');
  });

  it('SQL 里的 HTML 特殊字符必须被转义，不能被当成标签注入', () => {
    const result: AiSqlResultDTO = { ...sqlResult, sql: "SELECT '<img src=x onerror=alert(1)>' FROM t" };
    const html = wrap(
      h(SqlResultBlock, { result, fallbackConnectionId: 1, connections, onCopy: noopCopy }),
    );
    // 原样的 <img 标签绝不能出现在输出里
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('优化 / 诊断结果块渲染', () => {
  it('优化块渲染标题、严重级别与改写后的 SQL', () => {
    const result = {
      suggestions: [
        { title: '加索引', detail: '在 amount 上建索引', severity: 'warning', rewrittenSql: 'CREATE INDEX i ON orders(amount)' },
        { title: '写法建议', detail: '避免 SELECT *', severity: 'info' },
      ],
      historyId: 9,
    } as unknown as AiOptimizeResultDTO;
    const html = wrap(h(OptimizeBlock, { result, onCopy: noopCopy }));
    expect(html).toContain('加索引');
    expect(html).toContain('CREATE INDEX i ON orders(amount)');
    expect(html).toContain('警告');
    expect(html).toContain('提示');
  });

  it('优化块没有任何建议时也不崩', () => {
    const result = { suggestions: [] } as unknown as AiOptimizeResultDTO;
    expect(() => wrap(h(OptimizeBlock, { result, onCopy: noopCopy }))).not.toThrow();
  });

  it('诊断块渲染原因与建议', () => {
    const result = { cause: '列名拼错了', suggestions: ['改成 user_id'] } as unknown as AiDiagnoseResultDTO;
    const html = wrap(h(DiagnoseBlock, { result }));
    expect(html).toContain('列名拼错了');
    expect(html).toContain('改成 user_id');
  });

  it('诊断块没有建议时也不崩', () => {
    const result = { cause: '未知', suggestions: [] } as unknown as AiDiagnoseResultDTO;
    expect(() => wrap(h(DiagnoseBlock, { result }))).not.toThrow();
  });
});
