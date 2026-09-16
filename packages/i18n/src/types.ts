/**
 * 花生苗数据库管理工具 - i18n 类型契约
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { LocaleCode } from './locales.js';

/**
 * 消息键。
 *
 * 键名形如 `命名空间.语义名`，采用**扁平点号**而不是嵌套对象，原因有三：
 *   1. 语言包可以直接 `satisfies Partial<Record<MessageKey, string>>`，
 *      **拼错键名会在编译期报错**，而不是等到运行时把键名当文案显示出来；
 *   2. 键完整性校验（各语言是否漏译）只需比较两个字符串数组；
 *   3. 译者拿到的是扁平表，不用在嵌套结构里找位置。
 *
 * 复数形式用**后缀**表示：`xxx.one` / `xxx.few` / `xxx.many`，
 * 无后缀的 `xxx` 即 `other`（也是中文、日文、韩文唯一需要的形式）。
 */
export type MessageKey = string;

/** 单个语言包：键 → 文案模板。 */
export type MessageCatalog = Readonly<Record<string, string>>;

/** 插值变量。值会被 `String()` 化后再替换。 */
export type MessageValues = Readonly<Record<string, string | number>>;

export interface TranslateOptions {
  /** 插值变量，模板里写 `{name}` */
  values?: MessageValues;
  /**
   * 复数数量。给了它就会按语言的复数规则去挑 `key.one` / `key.few` /
   * `key.many`，都找不到时回退到无后缀的 `key`。
   */
  count?: number;
  /** 键在目标语言里缺失时用的兜底文案（不给则回退到源语言，再不行返回键名） */
  defaultValue?: string;
}

export type TranslateFn = (key: MessageKey, options?: TranslateOptions) => string;

/** 复数形式后缀，顺序与 Intl.PluralRules 的类别一致。 */
export const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
export type PluralSuffix = (typeof PLURAL_SUFFIXES)[number];

export type LocaleCatalogs = Readonly<Record<LocaleCode, MessageCatalog>>;
