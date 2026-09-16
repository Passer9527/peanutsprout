/**
 * 花生苗数据库管理工具 - 导出本地库 DDL
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 权威 DDL 只存在于 packages/storage/src/schema/ddl.ts；
 * docs/ddl.sql 由本脚本生成，**禁止手工维护**，否则文档与代码必然漂移。
 *
 * 用法：node scripts/export-ddl.mjs [输出路径]
 *       pnpm ddl:export
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

const HEADER = `-- ============================================================================
-- 花生苗数据库管理工具 · 本地库结构（SQLite3）
-- Copyright (C) 2025 飞哥 (微信 6731663)
-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- ⚠️ 本文件由 scripts/export-ddl.mjs 自动生成，请勿手工修改。
--    权威定义在 packages/storage/src/schema/ddl.ts。
--    重新生成：pnpm ddl:export
--
-- 说明：
--  - 本库仅存放"工具的自身数据"（用户、权限、连接、审计、AI 配置等），
--    不存放任何业务库数据。
--  - 审计日志表 audit_logs 通过 prev_hash/curr_hash 构成哈希链，
--    由应用层计算写入，数据库层不生成（触发器只能保证时间戳）。
-- ============================================================================

`;

/**
 * 生成 DDL 的完整内容（不写文件）。
 *
 * 刻意抽成导出函数：`scripts/verify.mjs` 的"docs/ddl.sql 是否与权威定义一致"
 * 校验必须比对**重新生成的结果**，而不是"文件里有没有某句标记" —— 后者手工
 * 改坏 DDL 也会通过（这正是曾经的缺陷）。导出与校验共用同一份生成逻辑，
 * 才不会出现"两边各写一遍、慢慢漂移"。
 */
export async function buildDdl() {
  // 通过 tsx 的 loader 直接引用 TS 源码，避免维护一份编译产物
  const { BASE_DDL, SEED_ROLES, SEED_PERMISSIONS, SEED_ROLE_PERMISSIONS, SEED_SETTINGS, MIGRATIONS } =
    await import('../packages/storage/src/schema/ddl.ts').then(async (ddl) => ({
      ...ddl,
      MIGRATIONS: (await import('../packages/storage/src/schema/migrations.ts')).MIGRATIONS,
    }));

  const parts = [HEADER];

  parts.push('-- ---------------------------------------------------------------- 结构\n\n');
  parts.push(BASE_DDL.trim());
  parts.push('\n\n-- ---------------------------------------------------------------- 迁移版本\n\n');
  for (const migration of MIGRATIONS) {
    parts.push(`-- ${migration.version}: ${migration.description}\n`);
  }

  parts.push('\n\n-- ---------------------------------------------------------------- 内置数据\n');
  for (const [label, sql] of [
    ['内置角色', SEED_ROLES],
    ['内置权限', SEED_PERMISSIONS],
    ['角色权限绑定', SEED_ROLE_PERMISSIONS],
    ['默认设置', SEED_SETTINGS],
  ]) {
    parts.push(`\n-- ${label}\n${sql.trim()}\n`);
  }

  const output = `${parts.join('')}\n`;
  const tables = (BASE_DDL.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/gi) ?? []).length;
  const indexes = (BASE_DDL.match(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS/gi) ?? []).length;
  const triggers = (BASE_DDL.match(/CREATE TRIGGER IF NOT EXISTS/gi) ?? []).length;
  return { output, tables, indexes, triggers };
}

async function main() {
  const outPath = resolve(process.argv[2] ?? resolve(REPO_ROOT, 'docs', 'ddl.sql'));
  const { output, tables, indexes, triggers } = await buildDdl();
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, output, 'utf8');

  process.stdout.write(`已生成 ${outPath}\n`);
  process.stdout.write(`  表 ${tables} 个 · 索引 ${indexes} 个 · 触发器 ${triggers} 个 · 共 ${output.length} 字节\n`);
}

// 仅在被直接执行时写文件；被 verify.mjs import 时只取 buildDdl()。
const isDirectRun = /(?:^|[/\\])export-ddl\.mjs$/.test(process.argv[1] ?? '');
if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`导出 DDL 失败：${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
