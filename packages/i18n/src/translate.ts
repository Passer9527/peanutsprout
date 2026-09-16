/**
 * 花生苗数据库管理工具 - 翻译核心（插值 / 复数 / 回退链）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { SOURCE_LOCALE, getLocaleInfo, type LocaleCode } from './locales.js';
import { PLURAL_SUFFIXES } from './types.js';
import type { LocaleCatalogs, MessageCatalog, TranslateFn, TranslateOptions } from './types.js';

/**
 * `{name}` 形式的占位符。变量名限定为标识符，避免把文案里
 * 无意出现的花括号（如 SQL 示例 `{"a":1}`）误当成占位符。
 */
const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** 允许文案里用 `{{` / `}}` 转义出真正的花括号。 */
const ESCAPED_OPEN = '\u0000OPEN\u0000';
const ESCAPED_CLOSE = '\u0000CLOSE\u0000';

/**
 * 渲染模板：
 *   1. 先把 `{{` / `}}` 收起来，避免被当成占位符；
 *   2. 替换 `{name}`；**未提供值的占位符原样保留**，
 *      这样漏传变量能一眼看出来，而不是显示成 "undefined"；
 *   3. 还原转义的花括号。
 */
export function interpolate(template: string, values?: TranslateOptions['values']): string {
  let out = template.split('{{').join(ESCAPED_OPEN).split('}}').join(ESCAPED_CLOSE);
  out = out.replace(PLACEHOLDER, (match, name: string) => {
    if (!values || !Object.prototype.hasOwnProperty.call(values, name)) {
      return match;
    }
    const value = values[name];
    return value === undefined ? match : String(value);
  });
  return out.split(ESCAPED_OPEN).join('{').split(ESCAPED_CLOSE).join('}');
}

/** 供测试与调试用：列出模板引用了哪些变量。 */
export function extractPlaceholders(template: string): string[] {
  const out: string[] = [];
  const cleaned = template.split('{{').join('').split('}}').join('');
  for (const match of cleaned.matchAll(PLACEHOLDER)) {
    const name = match[1];
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * `Intl.PluralRules` 的构造开销不小，而列表渲染里每次插值都要用它，
 * 因此按语言标签缓存实例（这是实测出来的热点，不是过早优化）。
 */
const pluralRulesCache = new Map<string, Intl.PluralRules | null>();

function pluralCategoryOf(intlTag: string, count: number): string {
  let rules = pluralRulesCache.get(intlTag);
  if (rules === undefined) {
    try {
      rules = new Intl.PluralRules(intlTag);
    } catch {
      // 运行环境缺少该语言的复数规则数据时退回 other
      rules = null;
    }
    pluralRulesCache.set(intlTag, rules);
  }
  return rules ? rules.select(count) : 'other';
}

/**
 * 按语言的复数规则挑键。中文/日文/韩文永远只有 `other`（即无后缀键），
 * 俄语有 one/few/many，英文有 one/other —— 这正是必须走
 * `Intl.PluralRules` 而不是自己写 `count > 1` 的原因。
 */
export function pluralKey(
  key: string,
  count: number,
  intlTag: string,
  catalog: MessageCatalog,
): string {
  const category = pluralCategoryOf(intlTag, count);
  const candidates = [`${key}.${category}`, `${key}.other`, key];
  for (const candidate of candidates) {
    if (catalog[candidate] !== undefined) return candidate;
  }
  return key;
}

export interface CreateTranslatorOptions {
  locale: LocaleCode;
  catalogs: LocaleCatalogs;
  /** 缺键时回退到哪个语言，默认源语言（简体中文） */
  fallbackLocale?: LocaleCode;
  /**
   * 缺键时的回调。生产环境用于打点/上报，测试用于断言"一个都没漏"。
   * 不在回退链里静默吞掉缺失，是这套实现刻意的设计。
   */
  onMissing?: (key: string, locale: LocaleCode) => void;
}

export interface Translator {
  locale: LocaleCode;
  t: TranslateFn;
  /** 该语言是否**完整**覆盖了源语言的全部键 */
  missingKeys: string[];
}

export function createTranslator(options: CreateTranslatorOptions): Translator {
  const { locale, catalogs } = options;
  const fallbackLocale = options.fallbackLocale ?? SOURCE_LOCALE;
  const catalog = catalogs[locale] ?? {};
  const fallback = catalogs[fallbackLocale] ?? {};
  const intlTag = getLocaleInfo(locale).intlTag;

  const missing = new Set<string>();
  const sourceKeys = Object.keys(catalogs[SOURCE_LOCALE] ?? {});
  for (const key of sourceKeys) {
    if (catalog[key] === undefined) missing.add(key);
  }

  const t: TranslateFn = (key, translateOptions) => {
    const count = translateOptions?.count;
    const lookupKey =
      count === undefined ? key : pluralKey(key, count, intlTag, catalog);

    let template: string | undefined = catalog[lookupKey];
    if (template === undefined && count !== undefined) {
      // 该语言没有复数变体时，用源语言按自己的规则再挑一次，
      // 避免"俄语漏了 few 形式"就直接掉到最泛的 other
      const fallbackKey = pluralKey(key, count, intlTag, fallback);
      template = fallback[fallbackKey];
    }
    if (template === undefined) {
      template = fallback[key];
    }
    if (template === undefined) {
      template = translateOptions?.defaultValue;
    }
    if (template === undefined) {
      missing.add(key);
      options.onMissing?.(key, locale);
      // 缺键时返回键名本身：宁可让界面显示一眼可见的键名，
      // 也不返回空串让用户以为"这里本来就没内容"
      return key;
    }
    const values =
      count === undefined
        ? translateOptions?.values
        : { count, ...(translateOptions?.values ?? {}) };
    return interpolate(template, values);
  };

  return { locale, t, missingKeys: [...missing] };
}

const PLURAL_SUFFIX_SET = new Set<string>(PLURAL_SUFFIXES);

/** `xxx.few` → `xxx`；不是复数后缀则返回 null。 */
export function pluralBaseOf(key: string): string | null {
  const dot = key.lastIndexOf('.');
  if (dot === -1) return null;
  const suffix = key.slice(dot + 1);
  return PLURAL_SUFFIX_SET.has(suffix) ? key.slice(0, dot) : null;
}

/**
 * 同时检查所有语言的键完整性。测试用它把"漏译"挡在提交前；
 * `pnpm verify` 也会调用，避免语言包被改坏却没人发现。
 *
 * 关于 `extra`：**目标语言"多出来"的复数形式不算多余键**。
 * 源语言是中文，中文只有 `other` 一种形式，所以简体中文包里根本没有
 * `common.countRows.few`；而俄语必须提供它。因此判定"僵尸键"时，
 * 允许 `xxx.<复数类别>` 这种形式，只要 `xxx` 本身在源语言里存在。
 */
export function auditCatalogs(catalogs: LocaleCatalogs): Array<{
  locale: LocaleCode;
  missing: string[];
  extra: string[];
}> {
  const sourceKeys = Object.keys(catalogs[SOURCE_LOCALE] ?? {});
  const sourceSet = new Set(sourceKeys);
  return (Object.keys(catalogs) as LocaleCode[]).map((locale) => {
    const keys = Object.keys(catalogs[locale] ?? {});
    const keySet = new Set(keys);
    const extra =
      locale === SOURCE_LOCALE
        ? []
        : keys.filter((key) => {
            if (sourceSet.has(key)) return false;
            const base = pluralBaseOf(key);
            return base === null || !sourceSet.has(base);
          });
    return {
      locale,
      missing: sourceKeys.filter((key) => !keySet.has(key)),
      extra,
    };
  });
}
