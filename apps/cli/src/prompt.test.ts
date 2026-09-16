/**
 * CLI 交互确认测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 回归点：非 TTY 下不能让危险操作"既不执行也不报错、退出码还是 0"。
 */

import { describe, expect, it } from 'vitest';
import { CliError } from './client.js';
import { confirm } from './prompt.js';

describe('confirm', () => {
  it('非 TTY 且未给 --yes 时抛 CONFIRMATION_REQUIRED（退出码 9）', async () => {
    // vitest 进程的 stdin 不是 TTY，正好覆盖 CI/管道场景
    expect(process.stdin.isTTY).toBeFalsy();
    await expect(confirm('确认删除连接？')).rejects.toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
      exitCode: 9,
    });
  });

  it('抛出的确实是 CliError，reportError 才能映射退出码', async () => {
    await confirm('确认删除连接？').catch((error: unknown) => {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).message).toContain('--yes');
    });
  });

  it('assumeYes=true 直接放行，不读 stdin', async () => {
    await expect(confirm('确认删除连接？', true)).resolves.toBe(true);
  });
});
