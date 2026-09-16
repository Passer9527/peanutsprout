/**
 * 花生苗数据库管理工具 - i18n 引擎单元测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 重点覆盖三类容易出错的地方：
 *   1. 语言标识归一化（zh-Hant / zh_TW / en-US 这些写法）；
 *   2. 插值与复数（俄语 one/few/many 是中国开发者最容易写错的一处）；
 *   3. 回退链与缺键审计（漏译必须被报出来，不能静默显示键名）。
 */

import { describe, expect, it, vi } from 'vitest';

import { formatDateTime, formatRelativeTime, createNumberFormatter } from './format.js';
import { normalizeLocale, resolveLocale, SUPPORTED_LOCALES } from './locales.js';
import { auditCatalogs, createTranslator, extractPlaceholders, interpolate, pluralKey } from './translate.js';
import type { LocaleCatalogs } from './types.js';

const SOURCE = {
  'greet.hello': '你好 {name}',
  'count.rows': '{count} 行',
  'count.files.one': '{count} 个文件',
  'count.files.few': '{count} 个文件',
  'count.files.many': '{count} 个文件',
  'json.sample': '示例 {{"a":1}}',
} as const;

function catalogs(extra: Partial<LocaleCatalogs> = {}): LocaleCatalogs {
  return { 'zh-CN': SOURCE, ...extra } as LocaleCatalogs;
}

describe('语言标识归一化', () => {
  it('识别受支持的语言代码本身', () => {
    for (const info of SUPPORTED_LOCALES) {
      expect(normalizeLocale(info.code)).toBe(info.code);
    }
  });

  it('把中文的各种写法正确分成简繁两支', () => {
    expect(normalizeLocale('zh')).toBe('zh-CN');
    expect(normalizeLocale('zh-Hans')).toBe('zh-CN');
    expect(normalizeLocale('zh-Hans-CN')).toBe('zh-CN');
    expect(normalizeLocale('zh_CN')).toBe('zh-CN');
    expect(normalizeLocale('zh-Hant')).toBe('zh-TW');
    expect(normalizeLocale('zh-TW')).toBe('zh-TW');
    expect(normalizeLocale('zh-HK')).toBe('zh-TW');
    expect(normalizeLocale('zh-MO')).toBe('zh-TW');
  });

  it('处理带地区的其它语言', () => {
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('ru-RU')).toBe('ru');
    expect(normalizeLocale('ja-JP')).toBe('ja');
    expect(normalizeLocale('ko-KR')).toBe('ko');
  });

  it('不认识的语言返回 undefined，由调用方决定兜底', () => {
    expect(normalizeLocale('de-DE')).toBeUndefined();
    expect(normalizeLocale('')).toBeUndefined();
    expect(normalizeLocale(null)).toBeUndefined();
    expect(normalizeLocale('   ')).toBeUndefined();
  });

  it('resolveLocale 按候选顺序取第一个命中的，全不中则默认简体中文', () => {
    expect(resolveLocale('de-DE', 'ru-RU', 'en-US')).toBe('ru');
    expect(resolveLocale(null, undefined, 'ja')).toBe('ja');
    // 默认语言必须是简体中文（需求明确"默认为中文"）
    expect(resolveLocale('de-DE', 'fr')).toBe('zh-CN');
    expect(resolveLocale()).toBe('zh-CN');
  });
});

describe('插值', () => {
  it('替换变量', () => {
    expect(interpolate('你好 {name}', { name: '飞哥' })).toBe('你好 飞哥');
    expect(interpolate('{a} + {b}', { a: 1, b: 2 })).toBe('1 + 2');
  });

  it('未提供的变量原样保留，方便一眼看出漏传（而不是显示 undefined）', () => {
    expect(interpolate('你好 {name}', {})).toBe('你好 {name}');
    expect(interpolate('{a}{b}', { a: 1 })).toBe('1{b}');
  });

  it('双花括号转义成字面花括号，不当成占位符', () => {
    expect(interpolate('示例 {{"a":1}}', {})).toBe('示例 {"a":1}');
  });

  it('extractPlaceholders 列出模板引用的变量', () => {
    expect(extractPlaceholders('{a} 与 {b} 与 {a}')).toEqual(['a', 'b']);
    expect(extractPlaceholders('{{"a":1}} {b}')).toEqual(['b']);
  });
});

describe('复数', () => {
  it('中文/日文/韩文只有 other 形式', () => {
    // 中文的 Intl.PluralRules 对任何数量都只返回 other，所以即使源语言包里
    // 同时存在 count.files.one / .few / .many，中文也永远命中无后缀键 ——
    // 这几行同时验证了"中文不会错用俄语那套复数形式"。
    expect(new Intl.PluralRules('zh-CN').select(1)).toBe('other');
    expect(pluralKey('count.files', 1, 'zh-CN', SOURCE)).toBe('count.files');
    expect(pluralKey('count.files', 3, 'zh-CN', SOURCE)).toBe('count.files');
    expect(pluralKey('count.rows', 1, 'zh-CN', SOURCE)).toBe('count.rows');
    expect(pluralKey('count.rows', 5, 'zh-CN', SOURCE)).toBe('count.rows');
    expect(pluralKey('count.rows', 5, 'ja', SOURCE)).toBe('count.rows');
    expect(pluralKey('count.rows', 5, 'ko', SOURCE)).toBe('count.rows');
  });

  it('俄语按 Intl 规则选 one / few / many —— 这正是不能自己写 count > 1 的原因', () => {
    const rules = new Intl.PluralRules('ru');
    expect(rules.select(1)).toBe('one');
    expect(rules.select(2)).toBe('few');
    expect(rules.select(5)).toBe('many');
    // 源语言包同时提供 one/few/many，俄语应各自命中
    expect(pluralKey('count.files', 1, 'ru', SOURCE)).toBe('count.files.one');
    expect(pluralKey('count.files', 3, 'ru', SOURCE)).toBe('count.files.few');
    expect(pluralKey('count.files', 7, 'ru', SOURCE)).toBe('count.files.many');
  });

  it('t() 会注入 count 变量并按数量挑形式', () => {
    const ru = { 'count.files.one': '{count} файл', 'count.files.few': '{count} файла', 'count.files.many': '{count} файлов' };
    const { t } = createTranslator({ locale: 'ru', catalogs: catalogs({ ru } as Partial<LocaleCatalogs>) });
    expect(t('count.files', { count: 1 })).toBe('1 файл');
    expect(t('count.files', { count: 3 })).toBe('3 файла');
    expect(t('count.files', { count: 7 })).toBe('7 файлов');
  });
});

describe('回退链', () => {
  it('目标语言缺键时回退到源语言简体中文（而不是英文）', () => {
    const en = { 'greet.hello': 'Hello {name}' };
    const { t } = createTranslator({ locale: 'en', catalogs: catalogs({ en } as Partial<LocaleCatalogs>) });
    expect(t('greet.hello', { values: { name: 'Feige' } })).toBe('Hello Feige');
    // en 没译 count.rows → 回退中文
    expect(t('count.rows', { count: 2 })).toBe('2 行');
  });

  it('源语言也没有该键时返回键名本身，并触发 onMissing 上报', () => {
    const onMissing = vi.fn();
    const { t } = createTranslator({ locale: 'en', catalogs: catalogs(), onMissing });
    // 键名不在类型约束里，这里刻意绕过类型来验证运行期兜底
    expect(t('does.not.exist')).toBe('does.not.exist');
    expect(onMissing).toHaveBeenCalledWith('does.not.exist', 'en');
  });

  it('defaultValue 优先于返回键名', () => {
    const { t } = createTranslator({ locale: 'en', catalogs: catalogs() });
    expect(t('missing.key', { defaultValue: '回退文案' })).toBe('回退文案');
  });

  it('missingKeys 列出该语言相对源语言缺了哪些键', () => {
    const en = { 'greet.hello': 'Hello {name}' };
    const { missingKeys } = createTranslator({ locale: 'en', catalogs: catalogs({ en } as Partial<LocaleCatalogs>) });
    expect(missingKeys).toContain('count.rows');
    expect(missingKeys).not.toContain('greet.hello');
  });
});

describe('auditCatalogs 键完整性审计', () => {
  it('报出漏译（missing）与僵尸键（extra）', () => {
    const en = { 'greet.hello': 'Hello', 'count.rows': 'rows', 'ghost.key': 'ghost' };
    const report = auditCatalogs(catalogs({ en } as Partial<LocaleCatalogs>));
    const enReport = report.find((item) => item.locale === 'en')!;
    expect(enReport.missing).toContain('count.files.many');
    expect(enReport.missing).not.toContain('count.rows');
    expect(enReport.extra).toEqual(['ghost.key']);
  });

  it('源语言自身没有 missing/extra', () => {
    const report = auditCatalogs(catalogs());
    const source = report.find((item) => item.locale === 'zh-CN')!;
    expect(source.missing).toEqual([]);
    expect(source.extra).toEqual([]);
  });
});

describe('本地化数字与日期', () => {
  it('千分位与小数分隔符随语言变化', () => {
    expect(createNumberFormatter('en')(1234.5)).toBe('1,234.5');
    // 俄语用不换行空格分组、逗号作小数分隔符
    expect(createNumberFormatter('ru')(1234.5)).not.toBe('1,234.5');
    expect(createNumberFormatter('ru')(1234.5)).toContain('234');
  });

  it('日期时间保持可排序的 ISO 风格（数据库工具刻意如此，避免 03/04 歧义）', () => {
    const value = new Date(2025, 8, 16, 9, 5, 3);
    expect(formatDateTime(value)).toBe('2025-09-16 09:05:03');
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
  });

  it('相对时间用语言包文案', () => {
    const { t } = createTranslator({ locale: 'zh-CN', catalogs: catalogs() });
    const now = Date.now();
    const source = { ...SOURCE, 'time.past.hour': '{count} 小时前', 'time.past.minute': '{count} 分钟前' };
    const { t: t2 } = createTranslator({
      locale: 'zh-CN',
      catalogs: { 'zh-CN': source } as unknown as LocaleCatalogs,
    });
    expect(formatRelativeTime(now - 3 * 3600 * 1000, t2, now)).toBe('3 小时前');
    expect(formatRelativeTime(now - 5 * 60 * 1000, t2, now)).toBe('5 分钟前');
    expect(formatRelativeTime(null, t)).toBe('—');
  });
});
