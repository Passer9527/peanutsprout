/**
 * 花生苗数据库管理工具 - 服务端产物打包（esbuild）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 为什么要打这个包，而不是把 TS 源码直接塞进安装包：
 *   1. 安装包里**不能有 TypeScript 运行时**。正式包里没有 devDependencies，
 *      而 `require.resolve('tsx/cli')` 在 asar/打包环境下的解析规则与开发态不同，
 *      一旦失败，用户看到的只是"桌面端起不来"。所以服务端必须以普通 JS 形态入包。
 *   2. 把 apps/server 与 packages/* 的 TS 源码、以及 fastify/zod 等运行时依赖
 *      全部内联成**一个文件**，安装包就不必携带 node_modules：
 *      electron-builder 顺着 pnpm 的符号链接展开 .pnpm store 既慢又容易出错，
 *      而内联产物在目标机上不会出现"找不到模块"。
 *   3. 产物只有一个入口，`files`/`extraResources` 的清单足够简单，可人工审计。
 *
 * 产物：build/server.mjs（ESM + sourcemap），由 apps/desktop/main.mjs 以
 *       ELECTRON_RUN_AS_NODE 子进程方式拉起（见 desktop 的 startEmbeddedServer）。
 *
 * 用法：
 *   node scripts/build-server.mjs               # 默认输出 build/server.mjs
 *   node scripts/build-server.mjs --minify      # 体积优先（不推荐发布排障用）
 *   node scripts/build-server.mjs --no-sourcemap
 *   node scripts/build-server.mjs --outfile /tmp/server.mjs
 *   pnpm build:server
 *
 * 约定与坑：
 *   - **必须输出 ESM**：apps/server/src/main.ts 用了顶层 await，CJS 承载不了；
 *   - target 与 Electron 38 内置的 Node 22 对齐，避免产出 Electron 跑不动的语法；
 *   - 不把任何依赖标成 external：漏包的代价是"到了用户机器上才炸"，
 *     宁可让这里构建失败。真需要外置时必须同时改 extraResources 清单。
 */

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/** 唯一入口：服务端独立运行的启动文件（与 pnpm dev:server 用的是同一个）。 */
const ENTRY = resolve(REPO_ROOT, 'apps', 'server', 'src', 'main.ts');
const DEFAULT_OUTFILE = resolve(REPO_ROOT, 'build', 'server.mjs');

/** Electron 38 内置 Node 22.x；target 取 node22，避免输出更高版本才有的语法。 */
const TARGET = ['node22'];

function parseArgs(argv) {
  const options = { outfile: DEFAULT_OUTFILE, minify: false, sourcemap: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--minify') options.minify = true;
    else if (arg === '--no-sourcemap') options.sourcemap = false;
    else if (arg === '--outfile') {
      const next = argv[i + 1];
      if (!next) throw new Error('--outfile 需要一个路径参数');
      options.outfile = resolve(process.cwd(), next);
      i += 1;
    } else if (arg.startsWith('--outfile=')) {
      options.outfile = resolve(process.cwd(), arg.slice('--outfile='.length));
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        '用法：node scripts/build-server.mjs [--minify] [--no-sourcemap] [--outfile <path>]\n',
      );
      process.exit(0);
    } else {
      throw new Error(`未知参数：${arg}（用 --help 查看用法）`);
    }
  }
  return options;
}

/**
 * 从 metafile 里归纳出被内联的第三方包名，便于人工核对"到底包了什么"。
 * pnpm 的真实路径形如 node_modules/.pnpm/fastify@5.12.4/node_modules/fastify/…，
 * 因此取**最后一段** node_modules/ 之后的目录名，而不是第一个（那是 .pnpm）。
 */
function bundledPackages(metafile) {
  const names = new Set();
  const pattern = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//g;
  for (const input of Object.keys(metafile.inputs)) {
    let last = null;
    for (const match of input.matchAll(pattern)) last = match[1] ?? null;
    if (last && last !== '.pnpm') names.add(last);
  }
  return [...names].sort();
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  // 产物入包前会被 electron-builder 复制，先清掉上一次的残留，避免"改了源码但包里还是旧文件"
  rmSync(options.outfile, { force: true });
  rmSync(`${options.outfile}.map`, { force: true });
  mkdirSync(dirname(options.outfile), { recursive: true });

  const result = await build({
    entryPoints: [ENTRY],
    outfile: options.outfile,
    bundle: true,
    platform: 'node',
    // 顶层 await（main.ts 末尾的 `await main()`）要求 ESM
    format: 'esm',
    target: TARGET,
    minify: options.minify,
    sourcemap: options.sourcemap,
    charset: 'utf8',
    metafile: true,
    logLevel: 'warning',
    // 内联的 CJS 依赖（fastify 等）仍可能走运行时的动态 require；
    // ESM 里没有 require，这里用 createRequire 补一个模块级绑定，
    // 否则会在运行时报 "Dynamic require of ... is not supported"。
    banner: {
      js: [
        "import { createRequire as __peanutsproutCreateRequire } from 'node:module';",
        'const require = __peanutsproutCreateRequire(import.meta.url);',
      ].join('\n'),
    },
  });

  if (result.warnings.length > 0) {
    for (const warning of result.warnings) {
      process.stderr.write(`[build:server] 警告：${warning.text}\n`);
    }
  }

  const stat = statSync(options.outfile);
  const sha256 = createHash('sha256').update(readFileSync(options.outfile)).digest('hex');
  const packages = bundledPackages(result.metafile);

  if (packages.includes('tsx')) {
    throw new Error(
      '产物里出现了 tsx：说明有源码在运行时 import tsx。正式包不提供 TypeScript 运行时，必须去掉。',
    );
  }

  process.stdout.write(
    [
      '',
      '  ┌─ 服务端产物已生成 ────────────────────────────────────────────',
      `  │  入口   : ${relative(REPO_ROOT, ENTRY)}`,
      `  │  产物   : ${relative(REPO_ROOT, options.outfile)}（${formatSize(stat.size)}）`,
      `  │  sourcemap: ${options.sourcemap ? '已生成' : '未生成'}`,
      `  │  sha256 : ${sha256}`,
      `  │  内联模块: ${Object.keys(result.metafile.inputs).length} 个文件`,
      `  │  内联依赖: ${packages.join(', ') || '（无第三方依赖）'}`,
      '  └───────────────────────────────────────────────────────────────',
      '',
    ].join('\n'),
  );
}

main().catch((error) => {
  process.stderr.write(
    `\n[build:server] 打包失败：${error instanceof Error ? error.message : String(error)}\n` +
      '  排查建议：确认已执行 pnpm install，且 apps/server、packages/* 的源码可编译。\n\n',
  );
  process.exit(1);
});
