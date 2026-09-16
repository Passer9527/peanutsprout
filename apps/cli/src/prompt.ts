/**
 * 花生苗数据库管理工具 - CLI 交互式口令输入
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 口令优先级：命令行参数 > 环境变量 PEANUTSPROUT_PASSWORD > 交互式隐藏输入。
 * 交互输入时关闭回显，且不把口令写入任何日志或 shell 历史。
 */

import { createInterface } from 'node:readline';
import { CliError } from './client.js';

export async function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    // 提示里必须写真实存在的选项：CLI 从来没有 --password（避免进程列表泄露口令），
    // 只有 --password-stdin 与环境变量 PEANUTSPROUT_PASSWORD，写错会让人白折腾。
    throw new Error('非交互式环境请通过 --password-stdin 或环境变量 PEANUTSPROUT_PASSWORD 提供口令');
  }
  return new Promise<string>((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const stdin = process.stdin;
    const originalWrite = (rl as unknown as { _writeToOutput?: (s: string) => void })._writeToOutput;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = function (s: string) {
      // 只回显提示语，屏蔽用户输入
      if (s.includes(question)) process.stdout.write(question);
    };
    rl.question(question, (answer) => {
      if (originalWrite) (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = originalWrite;
      rl.close();
      stdin.pause();
      process.stdout.write('\n');
      resolve(answer);
    });
    rl.on('error', reject);
  });
}

export async function resolvePassword(
  provided: string | undefined,
  prompt: string,
): Promise<string> {
  if (provided !== undefined && provided !== '') return provided;
  const fromEnv = process.env['PEANUTSPROUT_PASSWORD'];
  if (fromEnv) return fromEnv;
  return promptHidden(prompt);
}

export async function confirm(question: string, assumeYes = false): Promise<boolean> {
  if (assumeYes) return true;
  if (!process.stdin.isTTY) {
    // 非交互环境不能把"没问过"当作"用户取消"：那样危险操作既不执行、退出码还是 0，
    // 自动化脚本会误判为成功（例如 CI 里以为迁移/删除已经做完）。
    // docs/cli-reference.md §1.7 为这种情况保留退出码 9（CONFIRMATION_REQUIRED），
    // 因此这里明确抛出，由 run()/reportError 统一映射；想跳过确认必须显式 --yes。
    throw new CliError(
      'CONFIRMATION_REQUIRED',
      `${question}\n当前不是交互式终端，无法询问确认；请为危险操作显式加上 --yes 后重试`,
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(`${question} [y/N] `, resolve));
  rl.close();
  // 只有交互式下用户明确回答 n 才返回 false，由调用方以退出码 0 正常结束
  return /^y(es)?$/i.test(answer.trim());
}
