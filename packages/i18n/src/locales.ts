/**
 * 花生苗数据库管理工具 - 支持的语言清单
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/** 受支持的语言代码（BCP-47，用于 Intl 与持久化）。 */
export type LocaleCode = 'zh-CN' | 'zh-TW' | 'en' | 'ru' | 'ja' | 'ko';

export interface LocaleInfo {
  code: LocaleCode;
  /** 该语言的自称（用它自己的语言书写），语言切换器里显示这个 */
  nativeName: string;
  /** 简体中文名，便于中文用户在日志/文档里辨认 */
  zhName: string;
  /** 传给 Intl 的标签（数字/日期/复数规则都靠它） */
  intlTag: string;
  dir: 'ltr' | 'rtl';
}

/**
 * 语言清单。顺序即语言切换器里的显示顺序：
 * 源语言简体中文在最前，其余按"使用者规模 + 与中文的相关度"排列。
 */
export const SUPPORTED_LOCALES: readonly LocaleInfo[] = [
  { code: 'zh-CN', nativeName: '简体中文', zhName: '简体中文', intlTag: 'zh-CN', dir: 'ltr' },
  { code: 'zh-TW', nativeName: '繁體中文', zhName: '繁体中文', intlTag: 'zh-TW', dir: 'ltr' },
  { code: 'en', nativeName: 'English', zhName: '英文', intlTag: 'en', dir: 'ltr' },
  { code: 'ru', nativeName: 'Русский', zhName: '俄语', intlTag: 'ru', dir: 'ltr' },
  { code: 'ja', nativeName: '日本語', zhName: '日语', intlTag: 'ja', dir: 'ltr' },
  { code: 'ko', nativeName: '한국어', zhName: '韩语', intlTag: 'ko', dir: 'ltr' },
] as const;

/**
 * 源语言 = 简体中文。所有其它语言包都以它为基准做键完整性校验，
 * 缺键时也回退到它（而不是回退到英文）—— 因为需求明确"默认为中文"。
 */
export const SOURCE_LOCALE: LocaleCode = 'zh-CN';

export const DEFAULT_LOCALE: LocaleCode = 'zh-CN';

export const LOCALE_CODES: readonly LocaleCode[] = SUPPORTED_LOCALES.map((item) => item.code);

export function isLocaleCode(value: unknown): value is LocaleCode {
  return typeof value === 'string' && (LOCALE_CODES as readonly string[]).includes(value);
}

export function getLocaleInfo(code: LocaleCode): LocaleInfo {
  const found = SUPPORTED_LOCALES.find((item) => item.code === code);
  if (!found) {
    throw new Error(`未知语言代码: ${code}`);
  }
  return found;
}

/**
 * 把任意来源的语言标识归一化到受支持的语言。
 * 处理 `zh-Hans-CN` / `zh_CN` / `zh` / `en-US` / `ru-RU` 等写法，
 * 并让 `zh-Hant` / `zh-TW` / `zh-HK` 落到繁体，其余中文变体落到简体。
 * 无法识别时返回 undefined，由调用方决定用默认语言还是跟随浏览器。
 */
export function normalizeLocale(input: string | null | undefined): LocaleCode | undefined {
  if (!input) return undefined;
  const raw = input.trim().replace(/_/g, '-');
  if (raw.length === 0) return undefined;
  if (isLocaleCode(raw)) return raw;

  const lower = raw.toLowerCase();
  const parts = lower.split('-');
  const language = parts[0] ?? '';

  if (language === 'zh') {
    // 繁体优先判定：Hant 脚本或台/港/澳地区
    const isTraditional =
      lower.includes('hant') ||
      parts.some((part) => part === 'tw' || part === 'hk' || part === 'mo');
    return isTraditional ? 'zh-TW' : 'zh-CN';
  }
  if (language === 'en') return 'en';
  if (language === 'ru') return 'ru';
  if (language === 'ja') return 'ja';
  if (language === 'ko') return 'ko';
  return undefined;
}

/**
 * 在候选列表里挑一个受支持的语言，按顺序取第一个命中的。
 * 用于「用户显式设置 → localStorage → navigator.languages → 默认中文」这条链。
 */
export function resolveLocale(...candidates: Array<string | null | undefined>): LocaleCode {
  for (const candidate of candidates) {
    const normalized = normalizeLocale(candidate);
    if (normalized) return normalized;
  }
  return DEFAULT_LOCALE;
}
