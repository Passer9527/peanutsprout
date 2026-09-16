/**
 * 花生苗数据库管理工具 - 环境与交付自检
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * `pnpm verify` 的实现：在**不启动服务端**的前提下，尽快回答一个问题
 * ——"这台机器上现在能跑起来吗？"
 *
 * 检查项：
 *   1. Node / SQLite 版本
 *   2. 本地库结构、审计链、管理员账号
 *   3. 各数据库驱动的真实落地情况（明确未实现，不粉饰）
 *   4. 关键文档与许可文件是否齐全
 *   5. Web 端构建产物与本地库表数量
 *
 * 退出码：0 = 全部通过；1 = 存在失败项。
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

const REQUIRED_LOCALES_FOR_AI = ['zh-CN', 'zh-TW', 'en', 'ru', 'ja', 'ko'];

let passed = 0;
let failed = 0;
const warnings = [];

function ok(label, detail = '') {
  passed += 1;
  process.stdout.write(`  ✓ ${label}${detail ? `  ${detail}` : ''}\n`);
}

function fail(label, detail = '') {
  failed += 1;
  process.stdout.write(`  ✖ ${label}${detail ? `  ${detail}` : ''}\n`);
}

function warn(label, detail = '') {
  warnings.push(`${label}${detail ? ` — ${detail}` : ''}`);
  process.stdout.write(`  ! ${label}${detail ? `  ${detail}` : ''}\n`);
}

function section(title) {
  process.stdout.write(`\n${title}\n`);
}

async function main() {
  process.stdout.write('\n花生苗数据库管理工具 · 自检报告\n');
  process.stdout.write('='.repeat(56) + '\n');

  // ---------------------------------------------------------------- 运行环境
  section('运行环境');
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  if (major > 22 || (major === 22 && minor >= 5)) {
    ok(`Node.js v${process.versions.node}`);
  } else {
    fail(`Node.js v${process.versions.node}`, '需要 >= 22.5（node:sqlite）');
  }

  let sqliteVersion = '未知';
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const probe = new DatabaseSync(':memory:');
    sqliteVersion = probe.prepare('SELECT sqlite_version() AS v').get().v;
    probe.close();
    ok(`内置 SQLite ${sqliteVersion}`, '零原生依赖');
  } catch (error) {
    fail('node:sqlite 不可用', error instanceof Error ? error.message : String(error));
  }

  // ---------------------------------------------------------------- 交付文件
  section('交付文件');
  const requiredFiles = [
    ['LICENSE', 'AGPL-3.0 许可全文'],
    ['README.md', '项目说明'],
    ['CHANGELOG.md', '变更日志'],
    ['CONTRIBUTING.md', '贡献指南'],
    ['CLA.md', '贡献者许可协议'],
    ['docs/PRD.md', '产品需求文档'],
    ['docs/architecture.md', '架构设计'],
    ['docs/api.md', 'API 契约'],
    ['docs/ddl.sql', '本地库结构'],
    ['docs/security.md', '安全说明'],
    ['docs/deployment.md', '部署指南'],
    ['docs/cli-reference.md', 'CLI 参考'],
    ['docs/modules.md', '模块清单'],
    ['docs/acceptance.md', '验收标准'],
    ['docs/roadmap.md', '路线图'],
  ];
  for (const [file, label] of requiredFiles) {
    const full = resolve(REPO_ROOT, file);
    if (!existsSync(full)) {
      fail(`${file} 缺失`, label);
      continue;
    }
    const size = statSync(full).size;
    if (size < 200) warn(`${file} 内容过短`, `${size} 字节`);
    else ok(`${file}`, `${(size / 1024).toFixed(1)} KB`);
  }

  // LICENSE 必须是 AGPL-3.0 全文而不是占位符
  const licensePath = resolve(REPO_ROOT, 'LICENSE');
  if (existsSync(licensePath)) {
    const text = readFileSync(licensePath, 'utf8');
    if (text.includes('GNU AFFERO GENERAL PUBLIC LICENSE') && text.includes('Version 3')) {
      ok('LICENSE 为 AGPL-3.0 全文', `${text.length} 字符`);
    } else {
      fail('LICENSE 内容不是 AGPL-3.0 全文');
    }
  }

  // docs/ddl.sql 必须与权威定义同步：用 scripts/export-ddl.mjs 的 buildDdl()
  // 重新生成一份，与文件逐字节比较（并给出 sha256）。只检查"有没有自动生成
  // 标记"是假校验 —— 手工改坏 DDL 也会通过。
  const ddlDoc = resolve(REPO_ROOT, 'docs', 'ddl.sql');
  if (!existsSync(ddlDoc)) {
    fail('docs/ddl.sql 缺失', '应由 scripts/export-ddl.mjs 生成');
  } else {
    const text = readFileSync(ddlDoc, 'utf8');
    // 附加项：保留原有的"自动生成"标注检查
    if (text.includes('由 scripts/export-ddl.mjs 自动生成')) ok('docs/ddl.sql 标注为自动生成');
    else warn('docs/ddl.sql 缺少"自动生成"标注', '可能被手工修改过');

    try {
      const { buildDdl } = await import(pathToFileURL(resolve(HERE, 'export-ddl.mjs')).href);
      const { output } = await buildDdl();
      const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
      if (output === text) {
        ok('docs/ddl.sql 与权威定义一致', `sha256 ${sha(output).slice(0, 12)} · ${output.length} 字节`);
      } else {
        fail(
          'docs/ddl.sql 与权威定义不一致',
          `文件 ${text.length} 字节 sha256 ${sha(text).slice(0, 12)} ≠ 重新生成 ${output.length} 字节 sha256 ${sha(output).slice(0, 12)}；请运行 pnpm ddl:export`,
        );
      }
    } catch (error) {
      fail(
        'docs/ddl.sql 一致性校验无法执行',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // ---------------------------------------------------------------- 本地库
  section('本地库（工具自身数据）');
  const dataDir = process.env['PEANUTSPROUT_HOME'] || resolve(process.env['HOME'] || '.', '.peanutsprout');
  const dbPath = resolve(dataDir, 'peanutsprout.db');

  if (!existsSync(dbPath)) {
    warn('尚未初始化本地库', `先运行 pnpm bootstrap（期望位置：${dbPath}）`);
  } else {
    const { openPeanutDatabase } = await import(
      resolve(REPO_ROOT, 'packages', 'storage', 'src', 'index.ts')
    );
    const pdb = openPeanutDatabase({ dataDir });
    try {
      ok(`本地库可打开`, dbPath);

      const tables = pdb.db.all(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      );
      if (tables.length >= 20) ok(`表结构完整`, `${tables.length} 张表`);
      else fail(`表结构不完整`, `仅 ${tables.length} 张表`);

      const chain = pdb.audit.verifyChain();
      if (chain.ok) ok(`审计哈希链完整`, `${chain.checked} 条记录`);
      else fail(`审计哈希链断裂`, `位置 #${chain.brokenAt}`);

      const userCount = pdb.users.count();
      if (userCount > 0) ok(`已存在用户`, `${userCount} 个`);
      else warn('尚无用户账号', '运行 pnpm bootstrap 创建管理员');

      ok(`主密钥模式`, pdb.masterKeyMode === 'password' ? '主密码保护' : '明文文件（0600）');
      ok(`连接配置`, `${pdb.connections.count()} 个`);

      // 强制改密标记是**按用户**存的（security.must_change_password.<userId>）。
      // 只读那个历史遗留的全局键会漏报：全局键只在管理员身上镜像，
      // 而且一旦管理员改过一次密码就再也不会回到 true。
      const { readMustChangePassword } = await import(
        resolve(REPO_ROOT, 'packages', 'storage', 'src', 'index.ts')
      );
      const pending = pdb.users
        .list()
        .filter((user) => user.isAdmin && readMustChangePassword(pdb, user.id));
      if (pending.length > 0) {
        warn(
          `管理员初始口令尚未修改（${pending.map((u) => u.username).join('、')}）`,
          '请登录后立即修改',
        );
      }
    } finally {
      pdb.close();
    }
  }

  // ---------------------------------------------------------------- 驱动落地
  section('数据库驱动落地情况');
  const { createDefaultRegistry } = await import(
    resolve(REPO_ROOT, 'packages', 'drivers', 'src', 'index.ts')
  );
  const registry = createDefaultRegistry();
  const all = registry.list();
  const implemented = all.filter((d) => d.driverImplemented);
  const planned = all.filter((d) => !d.driverImplemented);

  if (implemented.length > 0) {
    ok(`已真实实现：${implemented.map((d) => d.label).join('、')}`);
  } else {
    fail('没有任何已实现的驱动');
  }
  process.stdout.write(
    `  · 规划中（调用会明确报 DRIVER_NOT_IMPLEMENTED）：${planned.map((d) => d.label).join('、')}\n`,
  );

  // 真实连一次 SQLite，确认不是"声明已实现但跑不通"
  try {
    const driver = registry.require('sqlite');
    const conn = await driver.connect({
      id: 0,
      name: 'verify',
      dbType: 'sqlite',
      databaseName: ':memory:',
      readOnly: false,
    });
    const result = await conn.getQueryExecutor().execute('SELECT 1 AS ok');
    await conn.close();
    if (Number(result.rows[0]?.[0]) === 1) ok('SQLite 驱动实连成功', 'SELECT 1');
    else fail('SQLite 驱动返回异常结果');
  } catch (error) {
    fail('SQLite 驱动实连失败', error instanceof Error ? error.message : String(error));
  }

  // ---------------------------------------------------------------- 新增能力自检
  section('新增能力（图表看板 / CLI / 打包）');

  // 图表 SQL 生成器：真跑一次，确认生成的 SQL 带 FROM（曾经漏掉，导致图表一条都跑不通）
  try {
    const { buildChartSql } = await import(
      pathToFileURL(resolve(REPO_ROOT, 'packages', 'visualization', 'src', 'chart.ts')).href
    );
    const sql = buildChartSql(
      {
        dimensions: [{ column: 'region', aggregation: 'none' }],
        metrics: [{ column: 'amount', aggregation: 'sum', alias: 'total' }],
      },
      { table: 'orders', schema: 'main' },
    );
    if (/FROM\s+"main"\."orders"/.test(sql)) {
      ok('图表 SQL 生成器可用', sql.split('\n').join(' '));
    } else {
      fail('图表 SQL 缺少 FROM 子句', sql);
    }
    // MySQL 方言必须是反引号
    const mysqlSql = buildChartSql(
      { dimensions: [{ column: 'a', aggregation: 'none' }], metrics: [{ column: 'b', aggregation: 'sum' }] },
      { table: 't', quoteStyle: 'mysql' },
    );
    if (mysqlSql.includes('`t`')) ok('图表 SQL 支持 MySQL 反引号方言');
    else fail('图表 SQL 的 MySQL 方言引号不正确', mysqlSql);
  } catch (error) {
    fail('图表 SQL 生成器不可用', error instanceof Error ? error.message : String(error));
  }

  // CLI 子命令是否真的注册（防止文档写了、代码没有）
  try {
    const cliSrc = readFileSync(resolve(REPO_ROOT, 'apps', 'cli', 'src', 'index.ts'), 'utf8');
    const required = [
      ["command('precheck')", 'migrate precheck'],
      ["command('start')", 'migrate start'],
      ["command('status <id>')", 'migrate status'],
      ["command('cancel <id>')", 'migrate cancel'],
      ["command('explain')", 'ai explain'],
      ["command('export')", 'audit export / export'],
      ["command('import')", 'import'],
      ["command('check')", 'update check'],
    ];
    const missing = required.filter(([needle]) => !cliSrc.includes(needle)).map(([, label]) => label);
    if (missing.length === 0) ok(`CLI 子命令齐全`, `${required.length} 项`);
    else fail('CLI 缺少子命令', missing.join('、'));
  } catch (error) {
    fail('无法读取 CLI 源码', error instanceof Error ? error.message : String(error));
  }

  // 图表/看板路由是否注册
  try {
    const appSrc = readFileSync(resolve(REPO_ROOT, 'apps', 'server', 'src', 'app.ts'), 'utf8');
    if (appSrc.includes('registerVisualizationRoutes')) ok('图表/看板路由已注册');
    else fail('图表/看板路由未注册', 'apps/server/src/app.ts');
  } catch (error) {
    fail('无法读取 app.ts', error instanceof Error ? error.message : String(error));
  }

  // 打包配置：只检查"有没有真实文件"，空目录不算数
  try {
    const { readdirSync: rd } = await import('node:fs');
    const listing = rd(resolve(REPO_ROOT, 'packaging'), { withFileTypes: true, recursive: true });
    const files = listing.filter((e) => e.isFile()).map((e) => e.name);
    if (files.length > 0) {
      ok('打包目录已就位', `${files.length} 个文件`);
    } else {
      warn('打包目录为空', '尚未产出 electron-builder 配置');
    }
  } catch {
    warn('打包目录不存在', 'packaging/');
  }

  // 打包产物：如果做过 package:* ，检查包内是否真的自带服务端与 Web 资源
  try {
    const bundled = resolve(REPO_ROOT, 'release', 'linux-unpacked', 'resources', 'server', 'server.mjs');
    const bundledWeb = resolve(REPO_ROOT, 'release', 'linux-unpacked', 'resources', 'web', 'index.html');
    if (existsSync(bundled) && existsSync(bundledWeb)) {
      const sizeMb = (statSync(bundled).size / 1024 / 1024).toFixed(1);
      ok('桌面端打包产物已就位', `release/linux-unpacked（服务端单文件 ${sizeMb}MB，含 Web 资源）`);
    } else {
      process.stdout.write('  · 未发现打包产物（需要时执行 pnpm package:dir / package:linux）\n');
    }
  } catch {
    /* 打包产物可选，缺失不影响自检结论 */
  }

  // ---------------------------------------------------------------- 国际化
  section('国际化（i18n）');

  try {
    const i18n = await import(
      pathToFileURL(resolve(REPO_ROOT, 'packages', 'i18n', 'src', 'index.ts')).href
    );
    const { SUPPORTED_LOCALES, LOCALE_CODES, auditCatalogs, MESSAGES, SOURCE_MESSAGES, createI18n } = i18n;

    // 需求点名了六种语言，少一种即视为未达标
    const REQUIRED = ['zh-CN', 'zh-TW', 'en', 'ru', 'ja', 'ko'];
    const missingLocales = REQUIRED.filter((code) => !LOCALE_CODES.includes(code));
    if (missingLocales.length === 0) {
      ok('六种语言全部注册', SUPPORTED_LOCALES.map((item) => `${item.code}(${item.nativeName})`).join(' · '));
    } else {
      fail('缺少语言', missingLocales.join('、'));
    }

    // 逐语言检查漏译 / 僵尸键
    const report = auditCatalogs(MESSAGES);
    const broken = report.filter((item) => item.missing.length > 0 || item.extra.length > 0);
    const sourceKeyCount = Object.keys(SOURCE_MESSAGES).length;
    if (broken.length === 0) {
      ok('语言包无漏译', `源语言 ${sourceKeyCount} 个键 × ${LOCALE_CODES.length} 种语言`);
    } else {
      fail(
        '语言包存在漏译或僵尸键',
        broken
          .map((item) => `${item.locale}: 缺 ${item.missing.length} / 多 ${item.extra.length}`)
          .join('；'),
      );
    }

    // 真跑一次翻译，确认插值与复数在非中文语言下也正常
    const ruSample = createI18n('ru').t('common.countRows', { count: 5 });
    const enSample = createI18n('en').t('nav.connections.label');
    if (ruSample && ruSample !== 'common.countRows' && enSample && enSample !== 'nav.connections.label') {
      ok('翻译运行时可用', `en: ${enSample} · ru: ${ruSample}`);
    } else {
      fail('翻译运行时返回了键名', `en=${enSample} ru=${ruSample}`);
    }

    // 默认语言必须是简体中文
    if (i18n.DEFAULT_LOCALE === 'zh-CN') {
      ok('默认语言为简体中文', i18n.DEFAULT_LOCALE);
    } else {
      fail('默认语言不是简体中文', i18n.DEFAULT_LOCALE);
    }
  } catch (error) {
    fail('i18n 包不可用', error instanceof Error ? error.message : String(error));
  }

  // Web 端不应再残留硬编码的中文 JSX 文本（注释不算）
  try {
    const webSrc = resolve(REPO_ROOT, 'apps', 'web', 'src');
    const files = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(full);
      }
    };
    walk(webSrc);

    // 只找 JSX 文本节点里的中文： >中文< ，排除 {"字符串"} 与属性/注释
    const offenders = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      text.split('\n').forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
        if (/>[^<>{}]*[\u4e00-\u9fff][^<>{}]*</.test(line)) {
          offenders.push(`${relative(REPO_ROOT, file)}:${index + 1}`);
        }
      });
    }
    if (offenders.length === 0) {
      ok('Web 端无硬编码中文 JSX 文本', `扫描 ${files.length} 个文件`);
    } else {
      fail('Web 端仍有硬编码中文文案', `${offenders.slice(0, 6).join('、')}${offenders.length > 6 ? ` 等 ${offenders.length} 处` : ''}`);
    }
  } catch (error) {
    fail('无法扫描 Web 端文案', error instanceof Error ? error.message : String(error));
  }

  // ---------------------------------------------------------------- AI 能力
  section('AI 助手');

  try {
    // 1) 供应商与场景是否齐全（源码层面，不依赖网络）
    const providers = readFileSync(
      resolve(REPO_ROOT, 'packages', 'core', 'src', 'ai.ts'),
      'utf8',
    );
    const REQUIRED_PROVIDERS = [
      'openai',
      'anthropic',
      'google',
      'qwen',
      'ernie',
      'zhipu',
      'deepseek',
      'ollama',
      'openai-compatible',
    ];
    const missingProviders = REQUIRED_PROVIDERS.filter(
      (name) => !new RegExp(`'${name}'`).test(providers),
    );
    if (missingProviders.length === 0) {
      ok('九类大模型供应商已定义', REQUIRED_PROVIDERS.join(' · '));
    } else {
      fail('缺少供应商定义', missingProviders.join(', '));
    }

    const scenes = ['nl2sql', 'explain', 'optimize', 'document', 'ask', 'diagnose'];
    const missingScenes = scenes.filter((name) => !new RegExp(`'${name}'`).test(providers));
    if (missingScenes.length === 0) {
      ok('六个 AI 技能场景已定义', scenes.join(' · '));
    } else {
      fail('缺少 AI 场景', missingScenes.join(', '));
    }

    // 2) 只生成不执行 —— 这是 PRD 的安全红线，必须能在源码里查证
    const routes = readFileSync(
      resolve(REPO_ROOT, 'apps', 'server', 'src', 'routes', 'ai-migration.ts'),
      'utf8',
    );
    if (routes.includes("'/ai/nl2sql'") && !/generateSql\([\s\S]{0,400}?execute/.test(routes)) {
      ok('nl2sql 只生成不自动执行', '生成结果需用户回到 SQL 编辑器确认');
    } else {
      fail('nl2sql 可能自动执行了生成的 SQL', '请人工复核 apps/server/src/routes/ai-migration.ts');
    }

    // 3) 总开关必须有写入口 —— 这正是之前"实现完整却够用不上"的根因
    const meta = readFileSync(resolve(REPO_ROOT, 'apps', 'server', 'src', 'routes', 'meta.ts'), 'utf8');
    if (/app\.put\('\/meta\/settings'/.test(meta)) {
      ok('设置写入口已存在', "PUT /meta/settings（ai.enabled 等开关可开启）");
    } else {
      fail('缺少设置写入口', 'ai.enabled 将无法打开，AI 会永远返回 AI_DISABLED');
    }

    const settingsRepo = readFileSync(
      resolve(REPO_ROOT, 'packages', 'storage', 'src', 'repositories', 'sessions-settings.ts'),
      'utf8',
    );
    if (settingsRepo.includes('WRITABLE_SETTINGS')) {
      ok('设置写入受白名单约束', '白名单外的键返回 VALIDATION_FAILED');
    } else {
      fail('设置写入缺少白名单', '任意键都能写入是配置污染风险');
    }

    // 4) AI 文案六语齐全（少一种就会在界面上露出中文兜底）
    const { MESSAGES, SOURCE_MESSAGES } = await import(
      pathToFileURL(resolve(REPO_ROOT, 'packages', 'i18n', 'src', 'index.ts')).href
    );
    const aiKeys = Object.keys(SOURCE_MESSAGES).filter((key) => key.startsWith('ai.'));
    const untranslated = REQUIRED_LOCALES_FOR_AI.filter((code) => {
      const catalog = MESSAGES[code] ?? {};
      return aiKeys.some((key) => !catalog[key]);
    });
    if (aiKeys.length >= 100 && untranslated.length === 0) {
      ok('AI 文案六语齐全', `${aiKeys.length} 个键 × 6 种语言`);
    } else {
      fail('AI 文案缺失', `键数 ${aiKeys.length}，缺翻译的语言：${untranslated.join(', ') || '无'}`);
    }

    // 5) 前端确实接上了 AI（曾经后端齐全但界面完全没有入口）
    const webIndex = resolve(REPO_ROOT, 'apps', 'web', 'src', 'App.tsx');
    const appSource = readFileSync(webIndex, 'utf8');
    if (appSource.includes('AiAssistantPage')) {
      ok('Web 端已接入 AI 助手页', 'apps/web/src/pages/AiAssistantPage.tsx');
    } else {
      fail('Web 端没有 AI 入口', '后端能力将无法被用户触达');
    }
  } catch (error) {
    fail('AI 小节自检异常', error instanceof Error ? error.message : String(error));
  }

  // ---------------------------------------------------------------- 构建产物
  section('构建产物');
  const webDist = resolve(REPO_ROOT, 'apps', 'web', 'dist', 'index.html');
  if (existsSync(webDist)) {
    ok('Web 端已构建', 'apps/web/dist');
  } else {
    warn('Web 端尚未构建', '开发用 pnpm dev:web；发布用 pnpm --filter @peanutsprout/web build');
  }

  const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'));
  // 注意：这里**不要**再写 `const { readdirSync } = await import('node:fs')`。
  // 它在函数作用域内会遮蔽文件顶部的同名 import（提升到整个作用域），
  // 导致本函数内更早使用 readdirSync 的地方抛 TDZ 错误：
  //   Cannot access 'readdirSync' before initialization
  const countDirs = (rel) => {
    try {
      return readdirSync(resolve(REPO_ROOT, rel), { withFileTypes: true }).filter((e) => e.isDirectory()).length;
    } catch {
      return 0;
    }
  };
  ok(
    '工作区清单',
    `${pkg.name} v${pkg.version}（packages: ${countDirs('packages')} · apps: ${countDirs('apps')}）`,
  );

  // ---------------------------------------------------------------- 桌面端
  section('桌面端（Electron）');
  const desktopMain = resolve(REPO_ROOT, 'apps', 'desktop', 'main.mjs');
  const desktopLauncher = resolve(REPO_ROOT, 'apps', 'desktop', 'scripts', 'launch.mjs');
  if (existsSync(desktopMain) && existsSync(desktopLauncher)) ok('桌面壳与启动器就位');
  else fail('桌面端文件缺失', 'apps/desktop/main.mjs 或 scripts/launch.mjs');

  const electronPkg = resolve(REPO_ROOT, 'apps', 'desktop', 'node_modules', 'electron');
  if (!existsSync(electronPkg)) {
    warn('未安装 electron 依赖', '桌面端无法启动；执行 pnpm install');
  } else {
    // 关键：electron 包装好了不等于二进制下载成功（安装脚本可能被跳过）
    let sandboxPath = null;
    try {
      const { createRequire } = await import('node:module');
      const req = createRequire(resolve(REPO_ROOT, 'apps', 'desktop', 'package.json'));
      const entry = req.resolve('electron');
      const distDir = resolve(dirname(entry), 'dist');
      const versionFile = resolve(distDir, 'version');
      sandboxPath = resolve(distDir, 'chrome-sandbox');
      if (existsSync(versionFile)) {
        ok('Electron 二进制已下载', readFileSync(versionFile, 'utf8').trim());
      } else {
        warn(
          'Electron 二进制缺失',
          '安装脚本可能被跳过；见 docs/deployment.md §0.1（国内需配置 electron_mirror）',
        );
      }
    } catch (error) {
      warn('无法定位 Electron 二进制', error instanceof Error ? error.message : String(error));
    }

    if (process.platform === 'linux' && sandboxPath && existsSync(sandboxPath)) {
      const st = statSync(sandboxPath);
      if (st.uid === 0 && (st.mode & 0o4000) !== 0) {
        ok('chrome-sandbox 已正确配置', 'root:root 4755');
      } else {
        warn(
          'chrome-sandbox 未配置为 root:4755',
          'dev:desktop 会自动补 --no-sandbox；正式打包需修好权限',
        );
      }
    }
  }

  // ---------------------------------------------------------------- 汇总
  process.stdout.write('\n' + '='.repeat(56) + '\n');
  process.stdout.write(`通过 ${passed} 项，失败 ${failed} 项，提醒 ${warnings.length} 项\n`);
  if (warnings.length > 0) {
    process.stdout.write('\n提醒（不阻断）：\n');
    for (const w of warnings) process.stdout.write(`  · ${w}\n`);
  }
  process.stdout.write('\n');
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  process.stderr.write(`\n✖ 自检脚本异常：${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
