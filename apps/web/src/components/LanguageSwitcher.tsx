/**
 * 花生苗数据库管理工具 - 语言切换器
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 两个形态共用同一个状态源：
 *   · variant="select" —— 设置页里的下拉框（带说明文字）
 *   · variant="compact" —— 顶栏的图标按钮 + 弹出列表
 * 语言自称（简体中文 / English / Русский…）永远用它自己的语言书写，
 * 这样用户即使误切到看不懂的语言，也能找回自己那一项。
 */

import type { LocaleCode } from '@peanutsprout/i18n';
import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../state/i18n';
import { useToast } from '../state/toast';
import { Icon } from './Icons';

export function LanguageSelect() {
  const { locale, setLocale, locales, t } = useI18n();
  const toast = useToast();

  return (
    <div className="field">
      <label className="field__label" htmlFor="locale-select">
        {t('language.title')}
      </label>
      <select
        id="locale-select"
        className="input"
        value={locale}
        onChange={(event) => {
          const next = event.target.value as LocaleCode;
          setLocale(next);
          const info = locales.find((item) => item.code === next);
          toast.success(t('language.changed', { values: { name: info?.nativeName ?? next } }));
        }}
      >
        {locales.map((info) => (
          <option key={info.code} value={info.code}>
            {info.nativeName}
            {info.code === locale ? '' : `（${info.zhName}）`}
          </option>
        ))}
      </select>
      <p className="field__hint">{t('language.description')}</p>
      <p className="field__hint">{t('language.persistedNote')}</p>
    </div>
  );
}

export function LanguageMenu() {
  const { locale, setLocale, locales, t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocumentClick = (event: MouseEvent): void => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocumentClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocumentClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const current = locales.find((item) => item.code === locale);

  return (
    <div className="lang-menu" ref={wrapperRef}>
      <button
        type="button"
        className="icon-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('topbar.switchLanguage')}
        title={t('topbar.switchLanguage')}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="globe" />
        <span className="lang-menu__code">{locale}</span>
      </button>
      {open ? (
        <ul className="lang-menu__list" role="listbox" aria-label={t('topbar.switchLanguage')}>
          {locales.map((info) => (
            <li key={info.code}>
              <button
                type="button"
                role="option"
                aria-selected={info.code === locale}
                className={info.code === locale ? 'lang-menu__item lang-menu__item--active' : 'lang-menu__item'}
                onClick={() => {
                  setLocale(info.code);
                  setOpen(false);
                }}
              >
                <span className="lang-menu__native">{info.nativeName}</span>
                <span className="lang-menu__zh">{info.code === 'zh-CN' ? info.code : info.zhName}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <span className="sr-only">{current?.nativeName ?? locale}</span>
    </div>
  );
}
