/**
 * CLI 参数解析与退出码测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 回归点：
 *  - 用法错误必须是退出码 2（docs/cli-reference.md §1.7），不能是 commander 默认的 1；
 *  - --help / --version 属于正常结束（退出码 0），不能被当成用法错误；
 *  - 已移除的死选项必须被明确拒绝，而不是被静默忽略。
 */

import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main, readStdinPassword } from './index.js';

/** 阻塞 stdout/stderr，避免测试输出里混入 commander 的帮助/错误文本 */
function silenceOutput(): void {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
}

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe('commander 退出码', () => {
  it('未知全局选项 → 2', async () => {
    silenceOutput();
    await main(['node', 'peanutsprout', '--definitely-not-an-option']);
    expect(process.exitCode).toBe(2);
  });

  it('子命令缺少必填选项 → 2', async () => {
    silenceOutput();
    await main(['node', 'peanutsprout', 'conn', 'add']);
    expect(process.exitCode).toBe(2);
  });

  it('未知子命令 → 2', async () => {
    silenceOutput();
    await main(['node', 'peanutsprout', 'no-such-command']);
    expect(process.exitCode).toBe(2);
  });

  it('已移除的死选项 --profile 现在被明确拒绝 → 2', async () => {
    silenceOutput();
    await main(['node', 'peanutsprout', '--profile', 'prod', 'version']);
    expect(process.exitCode).toBe(2);
  });

  it('--help → 0（帮助属于正常结束）', async () => {
    silenceOutput();
    await main(['node', 'peanutsprout', '--help']);
    expect(process.exitCode).toBe(0);
  });
});

describe('readStdinPassword', () => {
  it('读取 stdin 并去掉结尾换行（--password-stdin 的核心行为）', async () => {
    await expect(readStdinPassword(Readable.from(['s3cret\n']))).resolves.toBe('s3cret');
  });

  it('没有结尾换行时原样返回', async () => {
    await expect(readStdinPassword(Readable.from(['s3cret']))).resolves.toBe('s3cret');
  });
});
