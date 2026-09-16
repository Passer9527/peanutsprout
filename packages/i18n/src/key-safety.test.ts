/**
 * 花生苗数据库管理工具 - 键名编译期约束的"哨兵"测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 背景：曾经 `zhCN` 被标注为 `MessageCatalog`，TS 因此把它放宽成
 * `Record<string, string>`，`MessageKey` 退化成 `string` —— 于是
 * "键名写错会编译失败"这句话**是假的**，`t('随便什么')` 也能通过。
 * 这个文件用类型层面的断言把该行为钉死：一旦有人重新加上会放宽类型的
 * 标注，`pnpm typecheck` 立刻失败，而不是等到线上界面显示出键名。
 */

import { describe, expect, it } from 'vitest';

import { createI18n, SOURCE_MESSAGES } from './index.js';
import type { MessageKey, MessageKeyWithPlurals } from './index.js';

/** 若 T 是宽泛的 string（而非字面量联合），返回 true */
type WidenedToString<T> = [string] extends [T] ? true : false;

// 这两行是**编译期**断言：不成立就 typecheck 失败。
const MESSAGE_KEY_IS_LITERAL_UNION: WidenedToString<MessageKey> = false;
const PLURAL_KEY_IS_LITERAL_UNION: WidenedToString<MessageKeyWithPlurals> = false;

describe('键名类型约束', () => {
  it('MessageKey 是字面量联合，而不是退化成 string', () => {
    // 运行期断言上面那两个编译期常量的值，失败信息里能直接看出原因
    expect(MESSAGE_KEY_IS_LITERAL_UNION).toBe(false);
    expect(PLURAL_KEY_IS_LITERAL_UNION).toBe(false);
  });

  it('一个真实存在的键能通过编译并取到译文', () => {
    const known: MessageKey = 'nav.connections.label';
    const { t } = createI18n('zh-CN');
    expect(t(known)).toBe('连接管理');
  });

  it('允许目标语言补充复数形式（如俄语的 .few）', () => {
    const withPlural: MessageKeyWithPlurals = 'common.countRows.few';
    expect(String(withPlural)).toContain('common.countRows');
  });

  it('源语言包确实拥有大量键（否则上面的联合类型没有意义）', () => {
    expect(Object.keys(SOURCE_MESSAGES).length).toBeGreaterThan(300);
  });
});
