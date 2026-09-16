/**
 * 花生苗数据库管理工具 - 一键初始化
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * `pnpm bootstrap` 的实现：
 *   1. 校验 Node 版本（依赖内置 node:sqlite，需 >= 22.5，推荐 24+）
 *   2. 初始化本地库结构并创建管理员，打印**仅此一次**的初始口令
 *   3. 打印下一步该做什么
 *
 * 幂等：重复执行不会覆盖已有数据与账号。
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

const MIN_NODE = [22, 5, 0];

function checkNodeVersion() {
  const current = process.versions.node.split('.').map(Number);
  const [maj = 0, min = 0, pat = 0] = current;
  const [rMaj = 0, rMin = 0, rPat = 0] = MIN_NODE;
  const ok =
    maj > rMaj || (maj === rMaj && (min > rMin || (min === rMin && pat >= rPat)));
  if (!ok) {
    process.stderr.write(
      `✖ Node 版本过低：当前 v${process.versions.node}，需要 >= ${MIN_NODE.join('.')}\n` +
        '  原因：本工具依赖 Node 内置的 node:sqlite（无需任何原生编译）。\n' +
        '  建议使用 nvm：nvm install 24 && nvm use 24\n',
    );
    process.exit(1);
  }
  return process.versions.node;
}

async function main() {
  process.stdout.write('\n花生苗数据库管理工具 · 初始化\n');
  process.stdout.write('='.repeat(52) + '\n\n');

  const nodeVersion = checkNodeVersion();
  process.stdout.write(`✓ Node v${nodeVersion}（内置 node:sqlite 可用）\n`);

  // 确认 node:sqlite 真的能加载，避免"版本号够但特性被裁剪"的情况
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const probe = new DatabaseSync(':memory:');
    const row = probe.prepare('SELECT sqlite_version() AS v').get();
    probe.close();
    process.stdout.write(`✓ SQLite ${row.v}（内存库自检通过）\n`);
  } catch (error) {
    process.stderr.write(
      `✖ 无法加载 node:sqlite：${error instanceof Error ? error.message : String(error)}\n` +
        '  请升级到 Node 22.5+（推荐 24 LTS）。\n',
    );
    process.exit(1);
  }

  const dataDir = process.env['PEANUTSPROUT_HOME'] || resolve(process.env['HOME'] || '.', '.peanutsprout');
  process.stdout.write(`\n数据目录：${dataDir}\n`);

  // 用相对路径引用源码：根目录没有链接 workspace 包，
  // 而 packages/storage 自己的依赖（@peanutsprout/core）会在其自身目录下正确解析。
  const { openPeanutDatabase, ensureAdminUser } = await import(
    resolve(REPO_ROOT, 'packages', 'storage', 'src', 'index.ts')
  );

  const pdb = openPeanutDatabase({
    dataDir,
    masterPassword: process.env['PEANUTSPROUT_MASTER_PASSWORD'] ?? null,
  });

  try {
    const admin = ensureAdminUser(pdb, {
      username: process.env['PEANUTSPROUT_ADMIN_USERNAME'] || 'admin',
      ...(process.env['PEANUTSPROUT_ADMIN_PASSWORD']
        ? { password: process.env['PEANUTSPROUT_ADMIN_PASSWORD'] }
        : {}),
    });

    process.stdout.write(`✓ 本地库已就绪：${pdb.dbPath}\n`);
    process.stdout.write(`✓ 结构版本：${pdb.init.schemaVersion}`);
    if (pdb.init.applied.length > 0) process.stdout.write(`（本次应用迁移：${pdb.init.applied.join(', ')}）`);
    process.stdout.write('\n');
    process.stdout.write(`✓ 主密钥模式：${pdb.masterKeyMode === 'password' ? '主密码保护' : '明文文件（0600）'}\n`);

    if (admin.created) {
      process.stdout.write(`✓ 已创建管理员账号：${admin.username}\n`);
      if (admin.initialPassword) {
        process.stdout.write('\n' + '─'.repeat(52) + '\n');
        process.stdout.write('  初始口令（仅显示这一次，请立即保存并修改）：\n\n');
        process.stdout.write(`      ${admin.initialPassword}\n\n`);
        process.stdout.write('─'.repeat(52) + '\n');
      }
    } else {
      process.stdout.write(`· 管理员账号 ${admin.username} 已存在，未做改动\n`);
    }

    const tables = pdb.db.all(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    process.stdout.write(`✓ 已创建 ${tables.length} 张表\n`);

    // 审计链自检：第一次启动就应能通过
    const chain = pdb.audit.verifyChain();
    process.stdout.write(
      chain.ok
        ? `✓ 审计哈希链校验通过（${chain.checked} 条记录）\n`
        : `✖ 审计哈希链异常，断裂于 #${chain.brokenAt}\n`,
    );
    if (!chain.ok) process.exitCode = 1;
  } finally {
    pdb.close();
  }

  const webDist = resolve(REPO_ROOT, 'apps', 'web', 'dist', 'index.html');
  process.stdout.write('\n下一步：\n');
  process.stdout.write('  1. 启动服务端      pnpm dev:server\n');
  process.stdout.write('  2. 启动 Web 开发端  pnpm dev:web    （浏览器打开 http://127.0.0.1:5173）\n');
  if (existsSync(webDist)) {
    process.stdout.write('  3. 或直接访问服务端托管的已构建界面 http://127.0.0.1:8787\n');
  } else {
    process.stdout.write('  3. 构建 Web 界面后可由服务端直接托管：pnpm --filter @peanutsprout/web build\n');
  }
  process.stdout.write('  4. 命令行登录      pnpm cli login\n\n');
}

main().catch((error) => {
  process.stderr.write(`\n✖ 初始化失败：${error instanceof Error ? error.message : String(error)}\n`);
  if (error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
