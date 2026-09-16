/**
 * 花生苗数据库管理工具 - Web 端国际化上下文
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 语言优先级：用户显式选择（localStorage）→ 浏览器偏好 → 默认简体中文。
 * 需求明确"默认为中文"，所以浏览器偏好只有在它能映射到受支持语言时才生效，
 * 例如德语环境会落到简体中文，而不是变成英文。
 */

import {
  createI18n,
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  resolveLocale,
  type I18n,
  type LocaleCode,
  type MessageKey,
  type TranslateOptions,
} from '@peanutsprout/i18n';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

const STORAGE_KEY = 'peanutsprout.locale';

export interface I18nContextValue extends I18n {
  setLocale: (locale: LocaleCode) => void;
  /** 已注册语言清单（用于语言切换器） */
  locales: typeof SUPPORTED_LOCALES;
  /**
   * 把服务端错误本地化：按稳定的 error.code 取当前语言文案。
   * 服务端 message 只有中文，所以只作为"原始信息"保留，不做展示主文案。
   */
  localizeError: (error: { code?: string; message?: string } | null | undefined) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/** 读取浏览器偏好列表（部分老浏览器只有 navigator.language）。 */
function browserLocales(): string[] {
  if (typeof navigator === 'undefined') return [];
  const list = navigator.languages;
  if (Array.isArray(list) && list.length > 0) return [...list];
  return navigator.language ? [navigator.language] : [];
}

export function readStoredLocale(): LocaleCode | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      // 存进去的一定是受支持的代码，但万一被手工改过也要能收敛
      return resolveLocale(stored) ?? null;
    }
  } catch {
    // 隐私模式下 localStorage 可能不可用
  }
  return null;
}

export function detectInitialLocale(): LocaleCode {
  return readStoredLocale() ?? resolveLocale(...browserLocales());
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleCode>(() => detectInitialLocale());

  const i18n = useMemo(() => createI18n(locale), [locale]);

  useEffect(() => {
    // 让浏览器/读屏软件知道当前语言，也便于 CSS 按语言微调字体
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
    // 标签页标题与 SEO 描述也跟着切；不切的话切到日语后标题仍是中文
    document.title = i18n.t('app.documentTitle');
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', i18n.t('app.documentDescription'));
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // 存储失败不影响本次会话生效
    }
  }, [locale, i18n]);

  const setLocale = useCallback((next: LocaleCode) => {
    setLocaleState(next);
  }, []);

  const localizeError = useCallback(
    (error: { code?: string; message?: string } | null | undefined): string => {
      if (!error) return '';
      const code = error.code;
      if (code) {
        // 错误码是本表里的受控键；未收录的码会回退到服务端原文
        return i18n.t(`error.${code}` as MessageKey, { defaultValue: error.message ?? code });
      }
      return error.message ?? '';
    },
    [i18n],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ ...i18n, setLocale, locales: SUPPORTED_LOCALES, localizeError }),
    [i18n, setLocale, localizeError],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n 必须在 I18nProvider 内部使用');
  }
  return context;
}

/**
 * 只取翻译函数的轻量 hook。
 * 大量组件只需要 t，用它可以让意图更清楚：
 * `const t = useT();`
 */
export function useT(): (key: MessageKey, options?: TranslateOptions) => string {
  return useI18n().t;
}

export { DEFAULT_LOCALE };
