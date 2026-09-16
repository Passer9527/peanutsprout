/**
 * CLI 输出通道测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 回归点：docs/cli-reference.md §1.6 承诺"数据走 stdout，提示/进度/警告走 stderr"，
 * 警告若泄漏到 stdout 会污染 export 的 CSV 管道产物。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { printSuccessStderr, printWarn } from './format.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('输出通道', () => {
  it('printWarn 只写 stderr，不污染 stdout 数据', () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    printWarn('结果被截断，仅导出 10000 行');

    expect(out).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('结果被截断'));
  });

  it('printSuccessStderr 只写 stderr，供 export 这类 stdout 承载数据的命令使用', () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    printSuccessStderr('已导出 3 行到 out.csv');

    expect(out).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('已导出 3 行'));
  });
});
