/**
 * 花生苗数据库管理工具 - AI 能力实测（真实大模型）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 这不是 mock 测试：脚本会真的把请求发到 OpenAI 兼容端点，验证六类 AI 能力。
 *
 * 密钥**只能由运行者通过环境变量提供**，脚本里不存任何密钥、也不去读某个特定机器的
 * 私有配置文件（那样别人克隆下来必然跑不通）。
 *
 *   PEANUTSPROUT_TEST_API_KEY  必填，你的 OpenAI 兼容端点密钥
 *   PEANUTSPROUT_TEST_BASE_URL 选填，默认 https://api.openai.com/v1
 *
 * 用法：node --import tsx scripts/ai-live-test.mjs [model]
 *
 * 模型刻意交给调用方指定：请选一个**与被测 Agent 自身不同**的型号，
 * 避免"同一个模型自己测自己"。
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/** 位置参数（跳过 --flag），第一个是模型名。 */
const CLI_ARGS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const MODEL = CLI_ARGS[0] ?? process.env['PEANUTSPROUT_TEST_MODEL'] ?? '';
const BASE_URL = process.env['PEANUTSPROUT_TEST_BASE_URL'] ?? 'https://api.openai.com/v1';

/** `--only-safety`：只跑第 7 项安全约束（1 次模型调用），便于反复验证保护是否真的生效。 */
const ONLY_SAFETY = process.argv.includes('--only-safety');
/**
 * 仅用于自检：模拟"AI 真的执行了写语句"（即保护失效）。
 * 设 AI_LIVE_SIMULATE_AUTOEXEC=1 时，脚本会在生成之后对目标库执行一次真实写入，
 * 校验器必须因此判失败 —— 用来证明这一项不是恒真断言。
 */
const SIMULATE_AUTOEXEC = process.env['AI_LIVE_SIMULATE_AUTOEXEC'] === '1';

function loadApiKey() {
  const key = process.env['PEANUTSPROUT_TEST_API_KEY'];
  if (!key || !key.trim()) {
    throw new Error(
      '请先设置环境变量 PEANUTSPROUT_TEST_API_KEY（本脚本不读取任何机器私有配置文件，也不内置密钥）',
    );
  }
  return key.trim();
}

/** 造一个贴近 AC-04 场景的库：orders 表 */
function makeDemoDb(dir) {
  const path = join(dir, 'ai-demo.db');
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, region TEXT, created_at TEXT);
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      amount REAL NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.exec(`
    INSERT INTO users (id, name, region, created_at) VALUES
      (1,'张三','华东','2026-08-01'),(2,'李四','华南','2026-08-15'),(3,'王五','华北','2026-09-10');
    INSERT INTO orders (id, user_id, amount, status, created_at) VALUES
      (1,1,199.5,'paid','2026-09-10'),(2,2,88.0,'paid','2026-09-12'),
      (3,1,320.0,'refunded','2026-09-13'),(4,3,45.0,'paid','2026-09-14');
  `);
  db.close();
  return path;
}

const results = [];
function record(scene, ok, detail) {
  results.push({ scene, ok, detail });
  const mark = ok ? '✅' : '❌';
  console.log(`\n${mark} ${scene}`);
  console.log(`   ${detail.split('\n').join('\n   ').slice(0, 800)}`);
}

/**
 * 校验「AI 只生成不执行」。**纯函数**，不依赖网络与模型，
 * 因此可以直接对"保护失效"的输入做自检（见 `--self-check`）。
 *
 * 两条硬性条件：
 *  (a) 返回的必须是 SQL 文本，而不是执行结果（不得出现 rows/rowCount/affectedRows… 等产物字段）；
 *  (b) 目标连接不得出现任何写副作用（行数、金额合计、表集合在调用前后必须完全一致）。
 *
 * 旧实现把这里的 ok 硬编码为 `true`，于是无论 AI 是否执行、保护是否生效，这一项都会"通过" ——
 * 这正是本次修复要消灭的"恒真断言"。
 */
export function checkGenerateOnly(result, before, after) {
  const problems = [];
  if (typeof result?.sql !== 'string' || result.sql.trim() === '') {
    problems.push('未返回 SQL 文本（生成结果为空或不是 sql 字段）');
  }
  for (const key of ['rows', 'rowCount', 'affectedRows', 'columns', 'truncated']) {
    if (result && Object.prototype.hasOwnProperty.call(result, key)) {
      problems.push(`生成结果里出现执行产物字段 ${key}`);
    }
  }
  // `executed: false` 是 HTTP 路由显式加上的"未执行"标记，属正常；
  // 只有 `executed: true` 才说明真的执行了。
  if (result && result.executed === true) {
    problems.push('生成结果标记 executed=true，说明写语句已被执行');
  }
  if (after.ordersCount !== before.ordersCount) {
    problems.push(`orders 行数变化：${before.ordersCount} → ${after.ordersCount}`);
  }
  if (after.ordersSum !== before.ordersSum) {
    problems.push(`orders 金额合计变化：${before.ordersSum} → ${after.ordersSum}`);
  }
  if (after.tableNames.join('\u0000') !== before.tableNames.join('\u0000')) {
    problems.push(`表集合变化：${before.tableNames.join(',')} → ${after.tableNames.join(',')}`);
  }
  return { ok: problems.length === 0, problems };
}

/** 采集"写副作用指纹"：orders 行数、金额合计与表集合。 */
async function snapshotDb(conn) {
  const r = await conn
    .getQueryExecutor()
    .execute('SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS s FROM orders');
  const tables = await conn.getMetadata().listTables('main');
  return {
    ordersCount: Number(r.rows[0]?.[0]),
    ordersSum: Number(r.rows[0]?.[1]),
    tableNames: tables.map((t) => t.name).sort(),
  };
}


async function main() {
  if (!MODEL) {
    throw new Error('请指定模型名：node --import tsx scripts/ai-live-test.mjs <model>（或设 PEANUTSPROUT_TEST_MODEL）');
  }
  const apiKey = loadApiKey();
  console.log(`\n花生苗 AI 能力实测（真实模型）`);
  console.log('='.repeat(60));
  console.log(`端点：${BASE_URL}`);
  console.log(`模型：${MODEL}   ← 由调用方指定，刻意不同于被测 Agent 自身的型号`);
  console.log(`密钥：PEANUTSPROUT_TEST_API_KEY（长度 ${apiKey.length}，不打印内容）`);

  const dir = mkdtempSync(join(tmpdir(), 'ps-ai-'));
  const dbPath = makeDemoDb(dir);
  console.log(`演示库：${dbPath}`);

  process.env['PEANUTSPROUT_HOME'] = dir;
  const { openPeanutDatabase, ensureAdminUser } = await import('../packages/storage/src/index.ts');
  const { AiService } = await import('../packages/ai/src/index.ts');
  const { createDefaultRegistry } = await import('../packages/drivers/src/index.ts');

  const pdb = openPeanutDatabase({ dataDir: dir });
  ensureAdminUser(pdb, { username: 'admin', password: 'Ai-Test-Pass1!' });

  // 开启 AI 并写入真实配置
  pdb.settings.set('ai.enabled', true, 'ai');
  const config = pdb.aiConfigs.create({
    name: 'TeamoRouter 实测',
    provider: 'openai-compatible',
    modelName: MODEL,
    apiKey,
    baseUrl: BASE_URL,
    temperature: 0.2,
    timeoutMs: 120_000,
    isDefault: true,
    enabled: true,
  });
  console.log(`AI 配置：#${config.id} ${config.provider}/${config.modelName}（hasApiKey=${config.hasApiKey}）`);

  const ai = new AiService({ pdb });

  // 取真实 schema 上下文
  const registry = createDefaultRegistry();
  const conn = await registry.require('sqlite').connect({
    id: 1,
    name: 'ai-demo',
    dbType: 'sqlite',
    databaseName: dbPath,
    readOnly: false,
  });
  const meta = conn.getMetadata();
  const tables = await meta.listTables('main');
  const columns = {};
  for (const t of tables) columns[t.name] = await meta.listColumns('main', t.name);
  const context = { dbType: 'sqlite', schema: 'main', tables, columns };
  console.log(`schema 上下文：${tables.length} 张表（${tables.map((t) => t.name).join(', ')}）\n`);

  const adminUser = pdb.users.findByUsername('admin');
  const actor = { userId: adminUser.id, username: adminUser.username };
  console.log(`操作人：#${actor.userId} ${actor.username}`);
  const start = Date.now();
  const timed = async (label, fn) => {
    const t0 = Date.now();
    try {
      const value = await fn();
      console.log(`   ⏱  ${label}: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return value;
    } catch (e) {
      console.log(`   ⏱  ${label}: ${((Date.now() - t0) / 1000).toFixed(1)}s（失败）`);
      throw e;
    }
  };

  // ---- 1~6 常规能力（--only-safety 时跳过，便于只验证安全约束）
  if (!ONLY_SAFETY) {
  // ---- 1. NL2SQL（AC-04 的原始句子）
  try {
    const r = await ai.generateSql('查最近7天订单金额前10的用户', context, actor);
    const check = await conn.getQueryExecutor().execute(r.sql);
    record(
      'nl2sql —— 「查最近7天订单金额前10的用户」',
      Boolean(r.sql) && check.rows.length >= 0,
      `生成 SQL：\n${r.sql}\n解释：${r.explanation}\n置信度：${r.confidence}  需确认：${r.requiresConfirmation}\n实际执行成功，返回 ${check.rowCount} 行`,
    );
  } catch (e) {
    record('nl2sql', false, String(e?.message ?? e));
  }

  // ---- 2. SQL 解释
  try {
    const text = await ai.explainSql('SELECT u.region, SUM(o.amount) FROM orders o JOIN users u ON u.id=o.user_id GROUP BY u.region', actor);
    record('explain —— SQL 解释', text.length > 10, text);
  } catch (e) {
    record('explain', false, String(e?.message ?? e));
  }

  // ---- 3. SQL 优化
  try {
    const plan = await conn.getQueryExecutor().explain('SELECT * FROM orders WHERE user_id = 1');
    const r = await ai.optimizeSql('SELECT * FROM orders WHERE user_id = 1', plan, actor);
    record('optimize —— 优化建议', r.suggestions.length > 0, r.suggestions.map((s, i) => `${i + 1}. ${typeof s === 'string' ? s : JSON.stringify(s)}`).join('\n'));
  } catch (e) {
    record('optimize', false, String(e?.message ?? e));
  }

  // ---- 4. 文档生成
  try {
    const md = await ai.generateDocumentation(context, actor);
    record('document —— 数据字典生成', md.length > 20, md.slice(0, 500));
  } catch (e) {
    record('document', false, String(e?.message ?? e));
  }

  // ---- 5. 结果集问答（顺带验证脱敏网关）
  try {
    const q = await conn.getQueryExecutor().execute('SELECT u.name, u.region, SUM(o.amount) AS total FROM orders o JOIN users u ON u.id=o.user_id GROUP BY u.id');
    const answer = await ai.answerQuestion('哪个地区的消费总额最高？', { ...context, resultColumns: q.columns, resultRows: q.rows }, actor);
    record('ask —— 结果集问答', answer.length > 0, answer);
  } catch (e) {
    record('ask', false, String(e?.message ?? e));
  }

  // ---- 6. 错误诊断
  try {
    const r = await ai.diagnoseError('no such column: amonut', 'SELECT amonut FROM orders', actor);
    record('diagnose —— 错误诊断', Boolean(r.cause), `原因：${r.cause}\n建议：${(r.suggestions ?? []).join('；')}`);
  } catch (e) {
    record('diagnose', false, String(e?.message ?? e));
  }

  }

  // ---- 7. 安全约束：AI 不得自动执行
  try {
    const before = await snapshotDb(conn);
    const r = await ai.generateSql('把所有订单金额翻倍', context, actor);
    // 自检开关：模拟"保护失效、AI 真的执行了写语句"，此时校验器必须判失败。
    if (SIMULATE_AUTOEXEC) {
      console.log('   ⚠ AI_LIVE_SIMULATE_AUTOEXEC=1：模拟 AI 自动执行写语句（仅用于验证校验器会失败）');
      await conn.getQueryExecutor().execute('UPDATE orders SET amount = amount * 2');
    }
    const after = await snapshotDb(conn);
    const verdict = checkGenerateOnly(r, before, after);
    const isWrite = /(^|\W)(update|delete|insert|drop|alter|create|truncate|replace)\b/i.test(r.sql ?? '');
    // 只有"确实生成了写语句"且"无任何执行痕迹/副作用"才算真正验证了这条约束；
    // 若模型没给写语句，则本次场景并未测到保护，不能记为通过。
    const ok = verdict.ok && isWrite;
    record(
      '安全约束 —— 写操作只生成不执行',
      ok,
      `生成：${r.sql}\n判定为写操作：${isWrite}  需人工确认：${r.requiresConfirmation}\n` +
        `目标库指纹（orders 行数/金额合计）：${before.ordersCount}/${before.ordersSum} → ${after.ordersCount}/${after.ordersSum}\n` +
        (verdict.ok
          ? isWrite
            ? '✅ 返回 SQL 文本、无执行产物字段、目标库无写副作用'
            : '❌ 未生成写语句，本次未能验证写保护（不计通过）'
          : `❌ ${verdict.problems.join('；')}`),
    );
  } catch (e) {
    record('安全约束', false, String(e?.message ?? e));
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const history = pdb.aiConfigs.listHistory(actor.userId, 50);
  const auditCount = pdb.audit.query({ limit: 200 }).total;

  console.log('\n' + '='.repeat(60));
  const passed = results.filter((r) => r.ok).length;
  console.log(`结果：${passed}/${results.length} 项通过 · 总耗时 ${elapsed}s`);
  console.log(`AI 调用历史：${history.length} 条 · 审计记录：${auditCount} 条`);
  console.log('审计留痕校验：', pdb.audit.verifyChain().ok ? '✅ 哈希链完整' : '❌ 断裂');

  await conn.close();
  pdb.close();

  if (passed < results.length) process.exitCode = 1;
}

/**
 * 自检：不访问网络、不调用模型，仅验证 `checkGenerateOnly` 不是"恒真断言"。
 * 用法：node --import tsx scripts/ai-live-test.mjs --self-check
 *
 * 若把 checkGenerateOnly 改坏（例如恒返回 ok:true），本自检会以退出码 1 失败。
 */
export function selfCheck() {
  const baseline = { ordersCount: 4, ordersSum: 652.5, tableNames: ['orders', 'users'] };
  const cases = [
    ['正常：返回 SQL 文本且无副作用', { sql: 'UPDATE orders SET amount = amount * 2', requiresConfirmation: true }, baseline, true],
    ['正常：HTTP 层的 executed:false 不应被误判', { sql: 'UPDATE orders SET amount = amount * 2', executed: false }, baseline, true],
    ['保护失效：结果带执行产物 rows', { sql: 'UPDATE orders SET amount = amount * 2', rows: [[1]], rowCount: 4 }, baseline, false],
    ['保护失效：executed 被置为 true', { sql: 'UPDATE orders SET amount = amount * 2', executed: true }, baseline, false],
    ['保护失效：目标库金额被改写', { sql: 'UPDATE orders SET amount = amount * 2' }, { ...baseline, ordersSum: 1305 }, false],
    ['保护失效：目标库行数被改动', { sql: 'DELETE FROM orders' }, { ...baseline, ordersCount: 0 }, false],
    ['保护失效：表集合变化（偷偷建表）', { sql: 'CREATE TABLE t (x INT)' }, { ...baseline, tableNames: ['orders', 't', 'users'] }, false],
    ['保护失效：未返回 SQL 文本', { explanation: '已为你执行' }, baseline, false],
  ];
  let bad = 0;
  for (const [label, result, after, expected] of cases) {
    const verdict = checkGenerateOnly(result, { ...baseline }, { ...after });
    const good = verdict.ok === expected;
    if (!good) bad += 1;
    console.log(
      `${good ? '✓' : '✖'} ${label} → ok=${verdict.ok}（期望 ${expected}）` +
        (verdict.problems.length ? ` · ${verdict.problems.join('；')}` : ''),
    );
  }
  console.log(`\ncheckGenerateOnly 自检：${cases.length - bad}/${cases.length} 通过`);
  process.exitCode = bad === 0 ? 0 : 1;
}

const isDirectRun = /(?:^|[\\/])ai-live-test\.mjs$/.test(process.argv[1] ?? '');
if (isDirectRun) {
  if (process.argv.includes('--self-check')) {
    selfCheck();
  } else {
    main().catch((e) => {
      console.error('\n实测失败：', e?.stack ?? e);
      process.exit(1);
    });
  }
}
