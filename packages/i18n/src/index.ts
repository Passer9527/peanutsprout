/**
 * 花生苗数据库管理工具 - i18n 公共入口
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 用法（Web / 桌面端 / CLI 共用）：
 *
 * ```ts
 * import { createI18n } from '@peanutsprout/i18n';
 * const i18n = createI18n('zh-CN');
 * i18n.t('nav.connections.label');            // '连接管理'
 * i18n.t('common.countRows', { count: 3 });   // '3 行'（俄语会自动选 few 形式）
 * ```
 */
import { DEFAULT_LOCALE, isLocaleCode, type LocaleCode } from './locales.js';
import { MESSAGES, SOURCE_MESSAGES, type MessageKey } from './messages/index.js';
import {
  createCompactNumberFormatter,
  createNumberFormatter,
  formatDate,
  formatDateTime,
  formatRelativeTime,
} from './format.js';
import { createTranslator, type Translator } from './translate.js';
import type { LocaleCatalogs, TranslateOptions } from './types.js';

export * from './locales.js';
export * from './format.js';
export * from './translate.js';
export * from './types.js';
export { MESSAGES, SOURCE_MESSAGES, mergeCatalog } from './messages/index.js';
export type { MessageKey, MessageKeyWithPlurals } from './messages/index.js';

/**
 * 强类型翻译函数：键名受源语言包约束，拼错在编译期就会失败。
 * 引擎内部按字符串查找（它需要同时服务"缺键回退"这条路径），
 * 这里做一次收窄断言 —— 断言成立的前提是语言包通过键完整性测试。
 */
export type StrictTranslateFn = (key: MessageKey, options?: TranslateOptions) => string;

export interface I18n {
  readonly locale: LocaleCode;
  /** 翻译（带插值与复数） */
  readonly t: StrictTranslateFn;
  /** 该语言相对源语言缺失的键（正常情况下应为空数组） */
  readonly missingKeys: readonly string[];
  /** 本地化数字：英文 1,234.5 / 俄语 1 234,5 */
  readonly formatNumber: (value: number) => string;
  /** 大数字紧凑写法：1.2万 / 12K */
  readonly formatCompactNumber: (value: number) => string;
  /** 日期时间（刻意保持可排序的 ISO 风格，见 format.ts 说明） */
  readonly formatDateTime: typeof formatDateTime;
  readonly formatDate: typeof formatDate;
  /** 相对时间：'3 分钟前' */
  readonly formatRelativeTime: (value: string | number | Date | null | undefined) => string;
}

const catalogCache = new Map<LocaleCode, LocaleCatalogs>();

/** 把已注册的语言包与源语言一起组装成 catalogs（源语言永远可用作回退）。 */
function catalogsFor(locale: LocaleCode): LocaleCatalogs {
  const cached = catalogCache.get(locale);
  if (cached) return cached;
  const catalogs = {
    ...MESSAGES,
    'zh-CN': SOURCE_MESSAGES,
    [locale]: MESSAGES[locale] ?? SOURCE_MESSAGES,
  } as LocaleCatalogs;
  catalogCache.set(locale, catalogs);
  return catalogs;
}

/** 缺键上报钩子（生产环境可用于打点；测试用它断言"一个都没漏"）。 */
let missingKeyReporter: ((key: string, locale: LocaleCode) => void) | undefined;

export function setMissingKeyReporter(
  reporter: ((key: string, locale: LocaleCode) => void) | undefined,
): void {
  missingKeyReporter = reporter;
}

export function createI18n(
  localeInput: string | null | undefined = DEFAULT_LOCALE,
): I18n & { translator: Translator } {
  const locale: LocaleCode = isLocaleCode(localeInput) ? localeInput : DEFAULT_LOCALE;
  const translator = createTranslator({
    locale,
    catalogs: catalogsFor(locale),
    onMissing: missingKeyReporter,
  });

  const numberFormatter = createNumberFormatter(locale);
  const compactFormatter = createCompactNumberFormatter(locale);

  return {
    locale,
    // 收窄到 MessageKey：引擎按 string 查找，对外暴露权威键类型
    t: translator.t as StrictTranslateFn,
    missingKeys: translator.missingKeys,
    formatNumber: numberFormatter,
    formatCompactNumber: compactFormatter,
    formatDateTime,
    formatDate,
    formatRelativeTime: (value) => formatRelativeTime(value, translator.t),
    translator,
  };
}

/** 便捷单例：不需要切换语言时（如 CLI）可直接用默认语言的翻译。 */
export const defaultI18n: I18n = createI18n(DEFAULT_LOCALE);
