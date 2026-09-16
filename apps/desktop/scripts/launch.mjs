/**
 * 花生苗数据库管理工具 - 桌面端启动器
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 为什么不直接在 package.json 里写 `electron .`：
 * Linux 上 Electron 依赖一个 root 所有且权限为 4755 的 chrome-sandbox 辅助程序。
 * 开发态（尤其是容器内或普通用户安装）通常不具备该权限，Electron 会在启动瞬间
 * 直接 abort，且报错与业务无关，容易让人误以为项目坏了。
 * 这里先探测沙箱是否可用，**只在确实不可用时**才补 --no-sandbox，并明确告知用户，
 * 而不是无条件关闭沙箱——那会削弱渲染进程的隔离能力。
 */

import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIR = resolve(HERE, '..');

/** 判断 Linux 上 chrome-sandbox 是否已正确配置（root 所有 + setuid 位） */
function chromiumSandboxUsable() {
  if (process.platform !== 'linux') return true;
  try {
    const electronDir = dirname(require.resolve('electron'));
    const sandboxPath = join(electronDir, 'dist', 'chrome-sandbox');
    const st = statSync(sandboxPath);
    return st.uid === 0 && (st.mode & 0o4000) !== 0;
  } catch {
    // 探测不了就不擅自关沙箱，交给 Electron 自己报错
    return true;
  }
}

const electronBin = require('electron');
const args = [DESKTOP_DIR];

if (
  process.platform === 'linux' &&
  process.env['PEANUTSPROUT_NO_SANDBOX'] !== '1' &&
  !chromiumSandboxUsable()
) {
  process.stderr.write(
    '\n⚠️  Linux 沙箱辅助程序 chrome-sandbox 未正确配置（需 root 所有且权限 4755）。\n' +
      '   本次将以 --no-sandbox 启动，仅建议在开发环境这样做。\n' +
      '   正式使用请用以下任一方式修好沙箱，不要长期关闭：\n' +
      '     sudo chown root:root <electron>/dist/chrome-sandbox\n' +
      '     sudo chmod 4755 <electron>/dist/chrome-sandbox\n' +
      '   若已明确知晓风险，可设 PEANUTSPROUT_NO_SANDBOX=1 跳过本提示。\n\n',
  );
  args.unshift('--no-sandbox');
}

const child = spawn(electronBin, args, { stdio: 'inherit', cwd: DESKTOP_DIR });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
