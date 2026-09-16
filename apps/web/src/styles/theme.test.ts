/**
 * 花生苗数据库管理工具 - 主题（深浅皮肤）一致性回归
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 这个文件来自一个真实缺陷：**AI 助手页在深色皮肤下不跟随换肤**。
 *
 * 根因不是"少写了一处深色样式"，而是那一整块 CSS 引用了 8 个**从未定义过**的
 * 变量名（`--surface-1` / `--border-1` / `--accent-1` …，与本项目真正使用的
 * `--color-*` 命名体系是两套）。CSS 里 `var(--不存在, #fff)` 不会报错，
 * 它会**静默使用括号里的浅色回退值** —— 于是深色主题下依然渲染出白底黑字，
 * 而且 tsc、vite build、皮肤切换全都不报任何错。
 *
 * 所以这里用静态检查把三类问题钉死：
 *  ① 引用了不存在的变量（就是上面这个 bug）；
 *  ② 主题相关变量只在浅色里定义、忘了深色（同样会静默回退）；
 *  ③ 主题块之外写死颜色字面量（绕过整套变量体系，换肤必然失效）。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS_PATH = join(process.cwd(), 'apps', 'web', 'src', 'styles', 'global.css');
const css = readFileSync(CSS_PATH, 'utf8');

/** 去掉注释：注释里出现的 `var(--chart-N)` 之类说明文字不该被当成真实引用。 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 取某个选择器块的声明体。 */
function blockOf(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css);
  expect(match, `找不到 ${selector} 块`).not.toBeNull();
  return match![1]!;
}

function definedIn(body: string): Set<string> {
  return new Set([...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!));
}

/** 主题切换必须跟着变的变量族；只有这些强制要求深浅各定义一次。 */
const THEMED_PREFIXES = ['--color-', '--chart-', '--shadow-'];

const rootVars = definedIn(blockOf(':root'));
const darkVars = definedIn(blockOf("[data-theme='dark']"));

/** 引用处所在的 CSS 变量名（不含 `var(--chart-${i})` 这类运行时拼出来的名字）。 */
function referencedVars(text: string): Map<string, number[]> {
  const found = new Map<string, number[]>();
  const lines = stripComments(text).split('\n');
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/var\((--[a-z0-9-]+)/g)) {
      const name = match[1]!;
      // 拼出来的名字在源码里以 `-${` 结尾会被正则截断，这里显式放行
      if (line.includes(`var(${name}$`) || line.includes(`var(${name}-$`)) continue;
      const list = found.get(name) ?? [];
      list.push(index + 1);
      found.set(name, list);
    }
  });
  return found;
}

describe('主题变量：引用必须存在', () => {
  const referenced = referencedVars(css);

  it('CSS 里引用的每个变量都在 :root 里有定义', () => {
    const missing = [...referenced.entries()]
      .filter(([name]) => !rootVars.has(name))
      .map(([name, lines]) => `${name}（第 ${lines.join(', ')} 行）`);
    // 这条断言就是那个深色皮肤 bug 的守卫：一旦有人再写 var(--不存在的名字, #fff)，
    // 这里会直接失败，而不是等到用户切到深色主题才发现。
    expect(missing, `引用了未定义的变量：\n${missing.join('\n')}`).toEqual([]);
  });

  it('确实扫到了变量引用（防止正则失效导致恒真）', () => {
    // 没有这条，上面那个 toEqual([]) 在"一个引用都没扫到"时也会通过
    expect(referenced.size).toBeGreaterThan(30);
    expect(rootVars.size).toBeGreaterThan(30);
  });

  it('每个被引用的变量都能在 :root 或深色块里解析出值', () => {
    for (const [name] of referenced) {
      expect(rootVars.has(name) || darkVars.has(name), `${name} 两处都没有定义`).toBe(true);
    }
  });
});

describe('主题变量：深色必须覆盖主题相关变量', () => {
  it('--color-* / --chart-* / --shadow-* 在深浅两套里都定义了', () => {
    const themed = [...rootVars].filter((name) => THEMED_PREFIXES.some((p) => name.startsWith(p)));
    expect(themed.length, '居然没扫到主题相关变量，检查前缀配置').toBeGreaterThan(20);
    const missing = themed.filter((name) => !darkVars.has(name));
    // 只在浅色定义的变量，在深色下会静默沿用浅色的值 —— 与"括号回退值"是同一类 bug
    expect(missing, `这些变量只在浅色里定义，深色主题会沿用浅色值：${missing.join(', ')}`).toEqual([]);
  });

  it('深色块没有定义孤立的 --color-* 变量（拼错名字也查得出来）', () => {
    const orphans = [...darkVars]
      .filter((name) => THEMED_PREFIXES.some((p) => name.startsWith(p)))
      .filter((name) => !rootVars.has(name));
    expect(orphans, `深色里定义了但浅色没有（多半是名字写错）：${orphans.join(', ')}`).toEqual([]);
  });

  it(':root 里 --color-* 与深色块里 --color-* 的数量一致', () => {
    const inRoot = [...rootVars].filter((n) => n.startsWith('--color-')).length;
    const inDark = [...darkVars].filter((n) => n.startsWith('--color-')).length;
    expect(inDark).toBe(inRoot);
  });
});

describe('主题块之外不得出现颜色字面量', () => {
  /** 把 :root 与深色块的行号区间算出来，其余地方就是"业务样式"。 */
  function themedLineRanges(): Array<[number, number]> {
    const lines = css.split('\n');
    const ranges: Array<[number, number]> = [];
    for (const selector of [':root', "[data-theme='dark']"]) {
      const start = lines.findIndex((l) => l.trim().startsWith(selector));
      const end = lines.findIndex((l, i) => i > start && l.trim() === '}');
      ranges.push([start, end]);
    }
    return ranges;
  }

  it('业务样式里没有硬编码的 #rrggbb 颜色', () => {
    const ranges = themedLineRanges();
    const offenders: string[] = [];
    css.split('\n').forEach((line, index) => {
      if (ranges.some(([s, e]) => index >= s && index <= e)) return;
      const trimmed = line.trim();
      if (trimmed.startsWith('/*') || trimmed.startsWith('*')) return;
      const stripped = stripComments(line);
      const found = stripped.match(/#[0-9a-fA-F]{3,8}\b/g);
      if (found) offenders.push(`第 ${index + 1} 行：${trimmed} → ${found.join(', ')}`);
    });
    // 写死颜色就绕过了整套变量体系，切皮肤必然不生效。
    // 需要新颜色时请到 :root 与 [data-theme='dark'] 里各加一个变量。
    expect(offenders, `主题块之外出现了硬编码颜色：\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('对照色可读性', () => {
  /** sRGB 相对亮度（WCAG 2.1 定义）。 */
  function luminance(hex: string): number {
    const value = hex.replace('#', '');
    const full =
      value.length === 3
        ? value
            .split('')
            .map((c) => c + c)
            .join('')
        : value;
    const channels = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
    const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  }

  function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  }

  function valueOf(body: string, name: string): string | null {
    const match = new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})`).exec(body);
    return match ? match[1]! : null;
  }

  it('每个 --color-X-contrast 与对应的 --color-X 对比度不低于 3:1', () => {
    const rootBody = blockOf(':root');
    const darkBody = blockOf("[data-theme='dark']");
    const pairs = [...rootVars]
      .filter((n) => n.endsWith('-contrast'))
      .map((n) => n.replace(/-contrast$/, ''));
    expect(pairs.length, '没有找到任何对照色变量对').toBeGreaterThanOrEqual(3);

    for (const [label, body] of [
      ['浅色', rootBody],
      ['深色', darkBody],
    ] as const) {
      for (const base of pairs) {
        const bg = valueOf(body, base);
        const fg = valueOf(body, `${base}-contrast`);
        if (!bg || !fg) continue;
        const ratio = contrast(bg, fg);
        // 3:1 是 WCAG AA 对图形/大字号的底线。本项目品牌绿上的白字是 3.43:1，
        // 未达 AA 对正文的 4.5:1 —— 那是飞哥指定的品牌色，不擅自改；
        // 这里守住"不至于看不清"的底线，并把这个已知取舍写在测试里。
        expect(ratio, `${label}主题 ${base} 上的文字对比度仅 ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
