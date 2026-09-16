/**
 * 花生苗数据库管理工具 - 语言包完整性测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 这道测试的作用是**让"漏译"无法悄悄上线**：
 *   · 每种受支持语言都必须覆盖源语言（简体中文）的每一个键；
 *   · 不允许出现源语言里已经没有的"僵尸键"；
 *   · 每条文案里的插值变量必须与源语言一致（漏掉 {count} 会导致运行时
 *     显示成字面 "{count}"，或数量干脆不显示 —— 这是 i18n 最常见的线上事故）；
 *   · 复数形式必须按语言的真实规则成套出现（俄语缺 few 会显示错误的量词）。
 *
 * 它同时充当"语言包是否真的注册进来了"的哨兵：只要有人在 messages/index.ts
 * 里漏掉一种语言，这里立刻会红。
 */

import { describe, expect, it } from 'vitest';

import { LOCALE_CODES, SOURCE_LOCALE, SUPPORTED_LOCALES, type LocaleCode } from './locales.js';
import { MESSAGES, SOURCE_MESSAGES } from './messages/index.js';
import { auditCatalogs, extractPlaceholders, pluralBaseOf } from './translate.js';
import type { LocaleCatalogs } from './types.js';

const catalogs = MESSAGES as LocaleCatalogs;

/** 复数后缀，与 Intl.PluralRules 的类别对应 */
const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

function splitPluralKey(key: string): { base: string; suffix: string | null } {
  const dot = key.lastIndexOf('.');
  if (dot === -1) return { base: key, suffix: null };
  const maybe = key.slice(dot + 1);
  if ((PLURAL_SUFFIXES as readonly string[]).includes(maybe)) {
    return { base: key.slice(0, dot), suffix: maybe };
  }
  return { base: key, suffix: null };
}

const sourceKeys = Object.keys(SOURCE_MESSAGES);

describe('语言包注册', () => {
  it('需求要求的六种语言全部注册：简中、繁中、英、俄、日、韩', () => {
    // 这条断言把"需求清单"钉在测试里，删语言会红
    expect([...LOCALE_CODES].sort()).toEqual(['en', 'ja', 'ko', 'ru', 'zh-CN', 'zh-TW']);
  });

  it('SUPPORTED_LOCALES 与 LOCALE_CODES 一致，且元信息完整', () => {
    expect(SUPPORTED_LOCALES.map((item) => item.code)).toEqual([...LOCALE_CODES]);
    for (const info of SUPPORTED_LOCALES) {
      expect(info.nativeName.length, `${info.code} 缺少 nativeName`).toBeGreaterThan(0);
      expect(info.intlTag.length, `${info.code} 缺少 intlTag`).toBeGreaterThan(0);
      // nativeName 必须是"用它自己的语言书写"。
      // 注意：**日语的自称本来就是汉字「日本語」**，所以不能用"含汉字即判错"
      // 这种偷懒规则（最早就是这么写的，结果把正确的日语误判成不合格）。
      // 这里只对书写系统明确的语言做检查：英文用拉丁字母、俄语用西里尔字母、
      // 韩语用谚文；日语单独要求"不能只有简体特有的字形"。
      if (info.code === 'en') {
        expect(/^[A-Za-z ]+$/.test(info.nativeName), 'en 的 nativeName 不是拉丁字母').toBe(true);
      }
      if (info.code === 'ru') {
        expect(/[\u0400-\u04FF]/.test(info.nativeName), 'ru 的 nativeName 不含西里尔字母').toBe(true);
      }
      if (info.code === 'ko') {
        expect(/[\uAC00-\uD7AF]/.test(info.nativeName), 'ko 的 nativeName 不含谚文').toBe(true);
      }
      if (info.code === 'ja') {
        // 日语自称「日本語」是汉字，合法；但不应出现简体专有字形
        expect(info.nativeName, 'ja 的 nativeName 含简体专有字形').not.toMatch(/[语书词汇连设]/);
      }
    }
  });

  it('每种语言都注册了语言包', () => {
    for (const info of SUPPORTED_LOCALES) {
      expect(catalogs[info.code], `${info.code} 没有注册语言包`).toBeDefined();
    }
  });
});

describe('源语言（简体中文）', () => {
  it('是权威键集合，且自身没有 missing/extra', () => {
    const report = auditCatalogs(catalogs);
    const source = report.find((item) => item.locale === SOURCE_LOCALE);
    expect(source).toBeDefined();
    expect(source!.missing).toEqual([]);
    expect(source!.extra).toEqual([]);
  });

  it('键数达到可用规模（防止误删语言包）', () => {
    expect(sourceKeys.length).toBeGreaterThan(300);
  });

  it('默认语言是简体中文（需求明确"默认为中文"）', async () => {
    const { DEFAULT_LOCALE, resolveLocale } = await import('./locales.js');
    expect(DEFAULT_LOCALE).toBe('zh-CN');
    // 一个不受支持的语言环境不能把默认语言带偏
    expect(resolveLocale('de-DE')).toBe('zh-CN');
  });
});

describe.each(SUPPORTED_LOCALES.filter((info) => info.code !== SOURCE_LOCALE).map((i) => [i.code, i] as const))(
  '语言包完整性：%s',
  (code: LocaleCode) => {
    const catalog = catalogs[code];

    it('没有漏译（覆盖源语言全部键）', () => {
      const report = auditCatalogs(catalogs).find((item) => item.locale === code)!;
      // 报出前若干个缺键，便于直接定位
      expect(report.missing.slice(0, 15), `${code} 漏译 ${report.missing.length} 个键`).toEqual([]);
    });

    it('没有源语言已删除的僵尸键', () => {
      const report = auditCatalogs(catalogs).find((item) => item.locale === code)!;
      expect(report.extra.slice(0, 15), `${code} 有 ${report.extra.length} 个多余键`).toEqual([]);
    });

    it('没有空文案', () => {
      const empty = Object.entries(catalog)
        .filter(([, value]) => typeof value !== 'string' || value.trim().length === 0)
        .map(([key]) => key);
      expect(empty.slice(0, 15)).toEqual([]);
    });

    it('插值变量与源语言完全一致（漏掉 {count} 是最常见的线上事故）', () => {
      const mismatched: string[] = [];
      for (const [key, template] of Object.entries(catalog)) {
        // 目标语言可以补 `xxx.few` 这类源语言没有的复数形式，
        // 这种键就拿它的基准键 `xxx` 去比对变量
        const base = pluralBaseOf(key);
        const source = SOURCE_MESSAGES[key] ?? (base ? SOURCE_MESSAGES[base] : undefined);
        if (typeof source !== 'string') continue;
        const want = [...extractPlaceholders(source)].sort();
        const got = [...extractPlaceholders(template as string)].sort();
        if (want.join(',') !== got.join(',')) {
          mismatched.push(`${key}: 期望 {${want.join('} {')}} 实际 {${got.join('} {')}}`);
        }
      }
      expect(mismatched.slice(0, 15)).toEqual([]);
    });

    it('复数形式成套提供（该语言用到的类别一个都不能少）', () => {
      // 找出源语言里带复数后缀的键族，检查目标语言是否提供了该语言实际需要的类别
      const bases = new Set<string>();
      for (const key of sourceKeys) {
        const { base, suffix } = splitPluralKey(key);
        if (suffix) bases.add(base);
      }
      const problems: string[] = [];
      for (const base of bases) {
        // 该语言对这个基准键实际会用到哪些复数类别
        const needed = new Set<string>();
        for (const count of [0, 1, 2, 3, 5, 7, 11, 21, 101]) {
          needed.add(new Intl.PluralRules(code).select(count));
        }
        for (const category of needed) {
          const hasCategory = catalog[`${base}.${category}`] !== undefined || catalog[base] !== undefined;
          if (!hasCategory) problems.push(`${base} 缺少 ${category} 形式`);
        }
      }
      expect(problems.slice(0, 15)).toEqual([]);
    });
  },
);

describe('语言包内容抽查', () => {
  it('繁体中文确实使用繁体字（不是简体的复制粘贴）', () => {
    const zhTW = catalogs['zh-TW'] ?? {};
    const text = Object.values(zhTW).join('');
    // 这些字在繁体里必然写成另一种形式；若一个都没出现，说明根本没转换
    expect(/[連設資數]/.test(text), 'zh-TW 看起来是简体中文的副本').toBe(true);
  });

  it('俄语使用西里尔字母', () => {
    expect(/[\u0400-\u04FF]/.test(Object.values(catalogs.ru ?? {}).join(''))).toBe(true);
  });

  it('日语使用假名', () => {
    expect(/[\u3040-\u30FF]/.test(Object.values(catalogs.ja ?? {}).join(''))).toBe(true);
  });

  it('韩语使用谚文', () => {
    expect(/[\uAC00-\uD7AF]/.test(Object.values(catalogs.ko ?? {}).join(''))).toBe(true);
  });

  it('英文语言包里不应残留中文（专有名词除外）', () => {
    const en = catalogs.en ?? {};
    const leftovers = Object.entries(en)
      .filter(([, value]) => /[\u4e00-\u9fff]/.test(value as string))
      // 允许保留的：产品名/作者等专有名词
      .filter(([, value]) => !/花生苗|飞哥|微信/.test(value as string))
      .map(([key, value]) => `${key}: ${String(value)}`);
    expect(leftovers.slice(0, 10)).toEqual([]);
  });
});
