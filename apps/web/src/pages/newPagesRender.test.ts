/**
 * 花生苗数据库管理工具 - 表数据编辑器 / 建库建表页 真实渲染测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * `tsc` 只保证类型对，`vite build` 只保证模块能解析 —— 两者都不会发现
 * "渲染时读到 undefined 的属性"这类错误，那要真的把组件跑一遍才会暴露。
 * 本机没有任何 DOM 实现（无 jsdom / happy-dom），所以走 `react-dom/server`
 * 的 `renderToStaticMarkup`：不需要 DOM，能把整棵组件树真实执行一遍。
 *
 * ## 这个文件覆盖到哪、没覆盖到什么（务必如实理解）
 *
 * `renderToStaticMarkup` 是 SSR 语义，**`useEffect` 不会执行**。两个页面的
 * 连接/表列表都在 effect 里加载，所以：
 *
 *  · 表数据编辑器首屏不经过 loading 门 —— 它的空态、工具栏、下拉框是
 *    真实渲染出来的，本文件确实覆盖了这些；
 *  · 建库建表页首屏停在 `loading` 分支（只有一个加载指示器），
 *    **标签页/列定义表单/DDL 预览这些加载后才出现的结构，本文件没有覆盖**。
 *    那些结构目前只有三道保证：tsc 类型检查、vite 构建、以及
 *    `tableDesigner.test.ts` 里 79 个纯逻辑用例（校验、归一化、预览指纹、
 *    列名生成、排序）。**没有一条是在真实 DOM 里点出来的** —— 这是本环境
 *    的真实边界，不要把它读成"界面已经验证过了"。
 *
 * 用 `createElement` 而不是 JSX：vitest 只收集 `*.test.ts`，`.ts` 里不能写 JSX。
 */
import { createElement as h, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../state/i18n.js';
import { ToastProvider } from '../state/toast.js';
import { TableDataPage } from './TableDataPage.js';
import { TableDesignerPage } from './TableDesignerPage.js';

const wrap = (node: ReactNode) => renderToStaticMarkup(h(I18nProvider, null, h(ToastProvider, null, node)));

const noopNavigate = () => {};

describe('表数据编辑器 · 真实渲染（首屏 = 空态，不经 loading 门）', () => {
  it('能渲染出来，并且给出「还没选择表」的空态而不是白屏', () => {
    const html = wrap(h(TableDataPage, { onNavigate: noopNavigate }));
    expect(html).toContain('table-data');
    expect(html).toContain('还没选择表');
  });

  it('空态里带上「连接管理」入口，让用户知道下一步该做什么', () => {
    const html = wrap(h(TableDataPage, { onNavigate: noopNavigate }));
    expect(html).toContain('连接管理');
  });

  it('渲染出的 i18n 文案是中文而不是键名（出现键名说明用错了键）', () => {
    const html = wrap(h(TableDataPage, { onNavigate: noopNavigate }));
    expect(html).not.toMatch(/\btable\.[a-zA-Z]/);
  });

  it('不会渲染出 undefined / NaN（渲染期读到缺失属性会在这里现形）', () => {
    const html = wrap(h(TableDataPage, { onNavigate: noopNavigate }));
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
    expect(html.length).toBeGreaterThan(200);
  });
});

describe('建库建表页 · 真实渲染（首屏 = loading 分支）', () => {
  it('能渲染出来，标题与副标题都是真实翻译', () => {
    const html = wrap(h(TableDesignerPage, { onNavigate: noopNavigate }));
    expect(html).toContain('designer');
    expect(html).toContain('可视化建库建表');
    // 副标题要说明"执行前可先看到将运行的语句"这个核心承诺
    expect(html).toContain('执行前');
  });

  it('连接未加载完时显示加载指示器，而不是显示一个点了没反应的执行按钮', () => {
    const html = wrap(h(TableDesignerPage, { onNavigate: noopNavigate }));
    expect(html).toContain('加载中');
    // loading 分支里不能出现任何按钮 —— 连接都没加载出来，
    // 这时渲染出的按钮必然是点了没反应的死按钮
    expect(html).not.toContain('<button');
  });

  it('渲染出的 i18n 文案是中文而不是键名（含无点号的 designer.ifNotExists）', () => {
    const html = wrap(h(TableDesignerPage, { onNavigate: noopNavigate }));
    expect(html).not.toMatch(/\bdesigner\.[a-zA-Z]/);
  });

  it('不会渲染出 undefined / NaN / object Object', () => {
    const html = wrap(h(TableDesignerPage, { onNavigate: noopNavigate }));
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('object Object');
  });

  it('锁定当前行为：首屏就是 loading 分支（若将来改成不 gate，这条会失败并提醒更新上面的注释）', () => {
    // 这条断言的作用不是"验证功能"，而是**钉住本文件的覆盖边界**：
    // 一旦建库建表页的首屏不再停在 loading，就说明可以在这里加
    // 标签页/表单/预览的真实渲染断言了 —— 那时这条失败是好事。
    const html = wrap(h(TableDesignerPage, { onNavigate: noopNavigate }));
    expect(html).toContain('inline-loading');
    expect(html).not.toContain('designer__tabs');
  });
});
