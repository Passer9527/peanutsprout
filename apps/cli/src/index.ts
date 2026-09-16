/**
 * 花生苗数据库管理工具 - CLI 主程序
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 实现范围与 docs/cli-reference.md 对齐；命令的 ✅/⬜ 状态以该文档为准。
 * 设计原则：
 *  - 参数校验在本地先做一遍，错误立刻以退出码 2 返回，不浪费一次网络往返；
 *  - 危险操作（写语句、删除连接）默认二次确认，`--yes` 跳过；
 *  - 输出格式统一由 format.ts 处理，脚本可直接消费。
 */

import { existsSync, readFileSync } from 'node:fs';
import { Command, CommanderError } from 'commander';
import { PRODUCT } from '@peanutsprout/core';
import { ensureAdminUser, MIN_PASSWORD_LENGTH, openPeanutDatabase } from '@peanutsprout/storage';
import {
  ApiClient,
  CliError,
  defaultDataDir,
  reportError,
  resolveToken,
  saveToken,
  type ClientOptions,
} from './client.js';
import { printError, printJson, printSuccess, printSuccessStderr, printTable, printWarn, toCsv } from './format.js';
import { confirm, promptHidden, resolvePassword } from './prompt.js';

interface GlobalFlags {
  server: string;
  token?: string;
  tokenFile?: string;
  dataDir: string;
  output: string;
  timeout: string;
  quiet: boolean;
  verbose: boolean;
  insecure: boolean;
  yes: boolean;
}

let QUIET = false;

function flagsOf(cmd: Command): GlobalFlags {
  return cmd.optsWithGlobals() as GlobalFlags;
}

function clientOf(cmd: Command): ApiClient {
  const flags = flagsOf(cmd);
  QUIET = Boolean(flags.quiet);
  const options: ClientOptions = {
    server: flags.server,
    token: flags.token,
    tokenFile: flags.tokenFile,
    dataDir: flags.dataDir,
    timeoutMs: Number(flags.timeout) || 30_000,
    insecure: flags.insecure,
    verbose: flags.verbose,
  };
  return new ApiClient(options);
}

/** 统一输出：table/wide/json/jsonl/csv */
function emit(rows: Array<Record<string, unknown>>, format: string, emptyHint?: string): void {
  if (format === 'json') return printJson({ items: rows, total: rows.length });
  if (format === 'jsonl') {
    for (const row of rows) process.stdout.write(`${JSON.stringify(row)}\n`);
    return;
  }
  if (format === 'csv') {
    process.stdout.write(`${toCsv(rows)}\n`);
    return;
  }
  printTable(rows, emptyHint);
}

/** 把结果集（列 + 行）转成对象数组，便于各种输出格式复用 */
function resultToRows(columns: Array<{ name: string }>, rows: unknown[][]): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col.name] = row[i];
    });
    return obj;
  });
}

/**
 * 读取 --password-stdin 传入的口令。
 * 刻意不走 promptHidden：管道输入时没有 TTY，此时必须能从 stdin 读到内容。
 * stream 参数默认 process.stdin，显式传入只是为了单元测试能喂入假数据。
 */
export async function readStdinPassword(stream: AsyncIterable<unknown> = process.stdin): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

function requireInt(value: string, what: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new CliError('VALIDATION_FAILED', `${what} 必须是正整数，收到: ${value}`);
  return n;
}

// 刻意不声明 --profile 与 --no-color：
//  - --profile 没有任何消费方（配置文件/多档位尚未落地），声明了也只会误导用户；
//  - 本 CLI 的输出完全没有 ANSI 颜色（format.ts 不产生颜色），--no-color 是纯死开关。
// 与其留着"看起来能用"的选项，不如让 commander 直接以退出码 2 明确拒绝。
const program = new Command();

program
  .name('peanutsprout')
  .description(`${PRODUCT.nameZh} 命令行工具（${PRODUCT.license}）`)
  .version(`${PRODUCT.version}`, '-V, --version', '显示版本号')
  .option('--server <url>', '服务端地址', process.env['PEANUTSPROUT_SERVER'] || 'http://127.0.0.1:8787')
  .option('--token <jwt>', '访问令牌')
  .option('--token-file <path>', '从文件读取访问令牌')
  .option('--data-dir <path>', '数据目录', defaultDataDir())
  .option('-o, --output <fmt>', '输出格式: table|wide|json|jsonl|csv', process.env['PEANUTSPROUT_OUTPUT'] || 'table')
  .option('--timeout <ms>', '请求超时（毫秒）', '30000')
  .option('-q, --quiet', '仅输出数据，不输出提示', false)
  .option('-v, --verbose', '输出调试信息', false)
  .option('--insecure', '跳过 TLS 校验（仅自签名内网）', false)
  .option('--yes', '自动确认危险操作', false);

/** 包装命令体：统一 catch 并映射退出码 */
function run<A extends unknown[]>(
  fn: (...args: A) => Promise<void> | void,
): (...args: A) => Promise<void> {
  return async (...args: A) => {
    try {
      await fn(...args);
    } catch (error) {
      process.exitCode = reportError(error, QUIET);
    }
  };
}

// ------------------------------------------------------------------ 内置命令

program
  .command('version')
  .description('显示版本与许可信息')
  .action(
    run(async () => {
      const flags = flagsOf(program);
      if (flags.output === 'json') {
        printJson({
          name: PRODUCT.nameZh,
          nameEn: PRODUCT.nameEn,
          version: PRODUCT.version,
          author: PRODUCT.author,
          wechat: PRODUCT.wechat,
          license: PRODUCT.license,
        });
        return;
      }
      process.stdout.write(`${PRODUCT.nameZh} (${PRODUCT.nameEn}) v${PRODUCT.version}\n`);
      process.stdout.write(`作者：${PRODUCT.author}  微信：${PRODUCT.wechat}\n`);
      process.stdout.write(`许可：${PRODUCT.license}\n`);
    }),
  );

program
  .command('init')
  .description('初始化本地数据目录与管理员账号（首次使用先跑这个）')
  .option('--username <name>', '管理员用户名')
  .option('--password-stdin', '从 stdin 读取管理员口令', false)
  .action(
    run(async (options: { username?: string; passwordStdin?: boolean }) => {
      const flags = flagsOf(program);
      let password: string | undefined;
      if (options.passwordStdin) {
        const piped = await readStdinPassword();
        if (piped) password = piped;
      }

      const pdb = openPeanutDatabase({
        dataDir: flags.dataDir,
        masterPassword: process.env['PEANUTSPROUT_MASTER_PASSWORD'] ?? null,
      });
      try {
        const result = ensureAdminUser(pdb, {
          ...(options.username ? { username: options.username } : {}),
          ...(password ? { password } : {}),
        });

        if (result.created) {
          printSuccess(`已初始化数据目录：${flags.dataDir}`);
          process.stdout.write(`  管理员账号：${result.username}\n`);
          if (result.initialPassword) {
            printWarn(`初始口令（仅显示这一次，请立即修改）：${result.initialPassword}`);
          }
        } else {
          printSuccess(`数据目录已初始化，管理员账号 ${result.username} 已存在（未做改动）`);
        }
        process.stdout.write(`  本地库：${pdb.dbPath}\n`);
        process.stdout.write(`  结构版本：${pdb.init.schemaVersion}\n`);
      } finally {
        pdb.close();
      }
    }),
  );

program
  .command('login')
  .description('登录并把令牌保存到数据目录，后续命令免输密码')
  .option('--username <name>', '用户名')
  .option('--password-stdin', '从 stdin 读取口令', false)
  .action(
    run(async (options: { username?: string; passwordStdin?: boolean }) => {
      const client = clientOf(program);
      const flags = flagsOf(program);
      const username = options.username ?? process.env['PEANUTSPROUT_USER'] ?? 'admin';
      // 与 init / conn add 保持同一套写法：声明了 --password-stdin 就必须真的消费它，
      // 否则 `echo secret | peanutsprout login --password-stdin` 会在非 TTY 下
      // 落到 promptHidden 并直接失败（退出码 1），非交互登录根本不可能成功。
      let provided: string | undefined;
      if (options.passwordStdin) {
        const piped = await readStdinPassword();
        if (piped) provided = piped;
      }
      const password = await resolvePassword(provided, `用户 ${username} 的口令: `);

      const { data } = await client.post<{
        token: string;
        user: { username: string; isAdmin: boolean };
        mustChangePassword?: boolean;
      }>(
        '/auth/login',
        { username, password },
      );
      const path = saveToken(flags.dataDir, data.token);
      printSuccess(`登录成功：${data.user.username}${data.user.isAdmin ? '（管理员）' : ''}`);
      process.stdout.write(`  令牌已保存到 ${path}（0600）\n`);
      // 登录接口不受强制改密闸门限制，所以这里必须主动提示，否则用户会以为
      // 后续命令的 403 是权限配置问题，而不是"默认口令还没改"。
      if (data.mustChangePassword) {
        printWarn('当前仍在使用初始口令，其它命令会被拒绝；请先执行：peanutsprout passwd');
      }
    }),
  );

program
  .command('logout')
  .description('登出当前会话')
  .action(
    run(async () => {
      const client = clientOf(program);
      await client.post('/auth/logout');
      printSuccess('已登出');
    }),
  );

program
  .command('whoami')
  .description('显示当前登录身份')
  .action(
    run(async () => {
      const client = clientOf(program);
      const { data } = await client.get<{ user: Record<string, unknown>; permissions: string[] }>('/auth/me');
      if (flagsOf(program).output === 'json') return printJson(data);
      printTable([data.user as Record<string, unknown>]);
      process.stdout.write(`权限：${data.permissions.join(', ')}\n`);
    }),
  );

/**
 * 修改**自己**的口令：走 POST /auth/change-password。
 *
 * 为什么必须有这条命令：服务端对"仍在使用内置默认口令"的账号启用了强制改密闸门
 * （apps/server/src/http.ts 的 PASSWORD_CHANGE_REQUIRED），除改密/登出/续签/查看自身
 * 以外的接口一律 403。全新安装时 login 能成功、但之后每条命令都被拦，而旧版 CLI
 * 唯一的改密入口 user passwd 走的是 PUT /users/:id（同样被闸门拦截），
 * 于是默认口令用户会被彻底锁死——连"改密自救"都做不到。
 * 这里直接对接白名单里的 change-password 接口，保证始终有一条可用的改密路径。
 */
program
  .command('passwd')
  .description('修改当前登录用户的口令（首次使用默认口令时必须先执行，新口令至少 6 位）')
  .option('--old <password>', '当前口令；缺省交互式输入（也可用 PEANUTSPROUT_PASSWORD）')
  .option('--new <password>', '新口令；缺省交互式输入')
  .option('--password-stdin', '从 stdin 读取新口令（非交互场景推荐）', false)
  .action(
    run(async (options: { old?: string; new?: string; passwordStdin?: boolean }) => {
      const client = clientOf(program);

      // 当前口令：--old > PEANUTSPROUT_PASSWORD > 交互输入。
      // 非交互环境下没有 --old 就没有任何来源，提前给出可操作的错误而不是落到
      // promptHidden 抛出的通用错误（那条提示只讲"提供口令"，没讲清楚是哪个口令）。
      if (!options.old && !process.env['PEANUTSPROUT_PASSWORD'] && !process.stdin.isTTY) {
        throw new CliError('VALIDATION_FAILED', '非交互式环境请用 --old 提供当前口令');
      }
      const oldPassword = await resolvePassword(options.old, '当前口令: ');

      // 新口令：--password-stdin > --new > 交互输入。
      // 这里刻意**不**复用 resolvePassword：它会回退到 PEANUTSPROUT_PASSWORD，
      // 而那个环境变量装的是"当前口令"，当成新口令提交会导致永远改不动密码。
      let newPassword = options.new ?? '';
      if (options.passwordStdin) {
        const piped = await readStdinPassword();
        if (piped) newPassword = piped;
        else throw new CliError('VALIDATION_FAILED', '--password-stdin 没有从 stdin 读到新口令');
      }
      // 非交互环境没有新口令来源时直接报错，而不是落到 promptHidden 的通用提示
      // （那条提示会建议 PEANUTSPROUT_PASSWORD，但该变量在这里装的是当前口令）
      if (!newPassword && !process.stdin.isTTY) {
        throw new CliError('VALIDATION_FAILED', '非交互式环境请用 --new 或 --password-stdin 提供新口令');
      }
      if (!newPassword) newPassword = await promptHidden('新口令: ');

      // 与服务端 changePasswordSchema 保持一致的长度校验，避免白跑一次网络往返
      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        throw new CliError('VALIDATION_FAILED', `新口令至少 ${MIN_PASSWORD_LENGTH} 位`);
      }
      if (newPassword.length > 256) {
        throw new CliError('VALIDATION_FAILED', '新口令不能超过 256 位');
      }

      await client.post('/auth/change-password', { oldPassword, newPassword });
      // 服务端改密后会强制其它会话下线、只保留当前令牌，所以这里不要误导用户
      printSuccess('口令已修改，其它已登录会话已下线（当前令牌仍有效）');
    }),
  );

// ------------------------------------------------------------------ serve

program
  .command('serve')
  .description('启动服务端（默认同时托管已构建的 Web 界面）')
  .option('--host <host>', '监听地址')
  .option('--port <port>', '监听端口')
  .option('--no-web', '不托管 Web 静态资源')
  .action(
    run(async (options: { host?: string; port?: string; web?: boolean }) => {
      if (options.host) process.env['PEANUTSPROUT_HOST'] = options.host;
      if (options.port) process.env['PEANUTSPROUT_PORT'] = options.port;
      if (options.web === false) process.env['PEANUTSPROUT_SERVE_WEB'] = 'false';
      process.env['PEANUTSPROUT_HOME'] = flagsOf(program).dataDir;

      const { startServer } = await import('@peanutsprout/server');
      await startServer();
    }),
  );

// ------------------------------------------------------------------ conn

const conn = program.command('conn').description('连接管理');

conn
  .command('list')
  .description('列出连接')
  .option('--type <dbType>', '按数据库类型过滤')
  .option('--search <kw>', '按名称搜索')
  .option('--favorite', '只看收藏', false)
  .action(
    run(async (options: { type?: string; search?: string; favorite?: boolean }) => {
      const client = clientOf(program);
      const params = new URLSearchParams();
      if (options.type) params.set('dbType', options.type);
      if (options.search) params.set('search', options.search);
      if (options.favorite) params.set('favorite', 'true');
      const qs = params.toString();
      const { data } = await client.get<{ items: Array<Record<string, unknown>> }>(
        `/connections${qs ? `?${qs}` : ''}`,
      );

      const rows = data.items.map((item) => ({
        ID: item['id'],
        名称: item['name'],
        类型: item['dbType'],
        主机: item['host'] ?? '-',
        端口: item['port'] ?? '-',
        数据库: item['databaseName'] ?? '-',
        只读: item['isReadOnly'] ? '是' : '否',
        收藏: item['isFavorite'] ? '★' : '',
        最近使用: item['lastUsedAt'] ?? '-',
      }));
      emit(rows, flagsOf(program).output, '（暂无连接，可用 peanutsprout conn add 创建）');
    }),
  );

conn
  .command('add')
  .description('新增连接（口令推荐用 --password-stdin，避免进入 shell 历史）')
  .requiredOption('--type <dbType>', '数据库类型，如 sqlite/mysql/postgresql')
  .option('--name <name>', '显示名称')
  .option('--host <host>', '主机')
  .option('--port <port>', '端口')
  .option('--database <name>', '数据库名')
  .option('--file <path>', 'SQLite 文件路径')
  .option('--user <user>', '用户名')
  .option('--password-stdin', '从 stdin 读取口令', false)
  .option('--connection-url <url>', '直接给连接串')
  .option('--read-only', '开启只读保护', false)
  .option('--color <tag>', '颜色标识（red/prod 会触发生产库识别）')
  .option('--favorite', '标记收藏', false)
  .action(
    run(
      async (options: {
        type: string;
        name?: string;
        host?: string;
        port?: string;
        database?: string;
        file?: string;
        user?: string;
        passwordStdin?: boolean;
        connectionUrl?: string;
        readOnly?: boolean;
        color?: string;
        favorite?: boolean;
      }) => {
        const client = clientOf(program);
        const payload: Record<string, unknown> = {
          name: options.name ?? `${options.type}${options.host ? `@${options.host}` : ''}`,
          dbType: options.type,
        };
        if (options.file) payload['databaseName'] = options.file;
        if (options.database) payload['databaseName'] = options.database;
        if (options.host) payload['host'] = options.host;
        if (options.port) payload['port'] = Number(options.port);
        if (options.user) payload['username'] = options.user;
        if (options.connectionUrl) payload['connectionUrl'] = options.connectionUrl;
        if (options.readOnly) payload['isReadOnly'] = true;
        if (options.color) payload['colorTag'] = options.color;
        if (options.favorite) payload['isFavorite'] = true;
        if (options.passwordStdin) {
          const password = await readStdinPassword();
          if (password) payload['password'] = password;
        }

        const { data } = await client.post<{ item: Record<string, unknown> }>('/connections', payload);
        const item = data.item;

        // 建完立刻测一次连通性，给用户即时反馈
        let testLine = '';
        try {
          const test = await client.post<{ ok: boolean; latencyMs: number; message: string }>(
            `/connections/${String(item['id'])}/test`,
          );
          testLine = test.data.ok
            ? `连接正常（${test.data.latencyMs}ms）`
            : `连接失败：${test.data.message}`;
        } catch (e) {
          testLine = `连通性测试未通过：${e instanceof Error ? e.message : String(e)}`;
        }

        if (flagsOf(program).output === 'json') return printJson({ item, test: testLine });
        printSuccess(`已创建连接 #${String(item['id'])} ${String(item['name'])}`);
        process.stdout.write(`  ${testLine}\n`);
      },
    ),
  );

conn
  .command('test <id>')
  .description('测试连接连通性')
  .action(
    run(async (id: string) => {
      const client = clientOf(program);
      const connId = requireInt(id, '连接 id');
      const { data } = await client.post<{ ok: boolean; latencyMs: number; serverVersion: string | null; message: string }>(
        `/connections/${connId}/test`,
      );
      if (flagsOf(program).output === 'json') return printJson(data);
      if (data.ok) printSuccess(`${data.message}（${data.latencyMs}ms）${data.serverVersion ? ` · ${data.serverVersion}` : ''}`);
      else {
        printError(data.message);
        process.exitCode = 8;
      }
    }),
  );

conn
  .command('remove <id>')
  .description('删除连接')
  .action(
    run(async (id: string) => {
      const client = clientOf(program);
      const flags = flagsOf(program);
      const connId = requireInt(id, '连接 id');
      const ok = await confirm(`确认删除连接 #${connId}？该操作不可撤销`, flags.yes);
      if (!ok) {
        printWarn('已取消');
        return;
      }
      await client.delete(`/connections/${connId}`);
      printSuccess(`已删除连接 #${connId}`);
    }),
  );

conn
  .command('tables <id>')
  .description('列出连接中的表')
  .option('--schema <name>', 'schema 名称；缺省用该连接的第一个 schema（SQLite 为 main）')
  .action(
    run(async (id: string, options: { schema?: string }) => {
      const client = clientOf(program);
      const connId = requireInt(id, '连接 id');

      // 表清单接口是 /connections/:id/schemas/:schema/tables，
      // 因此未指定 --schema 时先问一次服务端有哪些 schema，再取默认的那个。
      let schema = options.schema ?? '';
      if (!schema) {
        const { data: schemas } = await client.get<{ items: Array<{ name: string }> }>(
          `/connections/${connId}/schemas`,
        );
        schema = schemas.items[0]?.name ?? '';
        if (!schema) throw new CliError('NOT_FOUND', `连接 #${connId} 没有可用的 schema`);
      }

      const { data } = await client.get<{ items: Array<Record<string, unknown>> }>(
        `/connections/${connId}/schemas/${encodeURIComponent(schema)}/tables`,
      );
      const rows = data.items.map((t) => ({ 表名: t['name'], 类型: t['kind'], 注释: t['comment'] ?? '' }));
      if (!flagsOf(program).quiet && flagsOf(program).output === 'table') {
        process.stderr.write(`schema: ${schema}\n`);
      }
      emit(rows, flagsOf(program).output, '（该 schema 下没有表）');
    }),
  );

// ------------------------------------------------------------------ query

const query = program.command('query').description('SQL 执行');

query
  .command('execute')
  .description('执行 SQL（写操作需 --yes 确认）')
  .requiredOption('--conn <id>', '连接 id')
  .option('--sql <sql>', '内联 SQL')
  .option('--file <path>', 'SQL 文件，- 表示从 stdin 读取')
  .option('--max-rows <n>', '结果集行数上限')
  .option('--timeout <ms>', '查询超时（毫秒）')
  .action(
    run(async (options: { conn: string; sql?: string; file?: string; maxRows?: string; timeout?: string }) => {
      const client = clientOf(program);
      const flags = flagsOf(program);
      const connId = requireInt(options.conn, '连接 id');

      let sql = options.sql ?? '';
      if (!sql && options.file) {
        sql =
          options.file === '-'
            ? readFileSync(0, 'utf8')
            : existsSync(options.file)
              ? readFileSync(options.file, 'utf8')
              : '';
        if (!sql) throw new CliError('VALIDATION_FAILED', `SQL 文件不存在或为空: ${options.file}`);
      }
      if (!sql.trim()) throw new CliError('VALIDATION_FAILED', '必须提供 --sql 或 --file');

      const payload: Record<string, unknown> = { connectionId: connId, sql };
      if (options.maxRows) payload['maxRows'] = requireInt(options.maxRows, 'maxRows');
      if (options.timeout) payload['timeoutMs'] = requireInt(options.timeout, 'timeout');
      // --yes 表示用户已明确知情，服务端才接受写操作
      if (flags.yes) payload['confirm'] = true;

      const { data } = await client.post<{
        columns: Array<{ name: string }>;
        rows: unknown[][];
        rowCount: number;
        affectedRows: number;
        durationMs: number;
        truncated: boolean;
        isSlow: boolean;
        notices: string[];
      }>('/query/execute', payload);

      const rows = resultToRows(data.columns, data.rows);
      const format = flags.output;
      if (format === 'csv') {
        if (rows.length > 0) process.stdout.write(`${toCsv(rows)}\n`);
      } else if (format === 'wide') {
        printTable(rows, '（查询成功，无返回行）');
      } else {
        emit(rows, format, '（查询成功，无返回行）');
      }

      if (!flags.quiet) {
        const parts = [`rowCount=${data.rowCount}`, `affectedRows=${data.affectedRows}`, `durationMs=${data.durationMs}`];
        if (data.truncated) parts.push('已截断（请提高 --max-rows）');
        if (data.isSlow) parts.push('慢查询');
        process.stderr.write(`${parts.join('  ')}\n`);
        for (const notice of data.notices ?? []) process.stderr.write(`提示：${notice}\n`);
      }
    }),
  );

query
  .command('explain')
  .description('查看执行计划')
  .requiredOption('--conn <id>', '连接 id')
  .requiredOption('--sql <sql>', 'SQL 语句')
  .action(
    run(async (options: { conn: string; sql: string }) => {
      const client = clientOf(program);
      const connId = requireInt(options.conn, '连接 id');
      const { data } = await client.post<{ plan: { content: string } }>('/query/explain', {
        connectionId: connId,
        sql: options.sql,
      });
      if (flagsOf(program).output === 'json') return printJson(data);
      process.stdout.write(`${data.plan.content}\n`);
    }),
  );

query
  .command('history')
  .description('查看查询历史')
  .option('--limit <n>', '返回条数', '20')
  .action(
    run(async (options: { limit?: string }) => {
      const client = clientOf(program);
      const { data } = await client.get<{ items: Array<Record<string, unknown>> }>(
        `/query/history?limit=${requireInt(options.limit ?? '20', 'limit')}`,
      );
      const rows = data.items.map((h) => ({
        时间: h['createdAt'],
        连接: h['connectionId'],
        状态: h['status'],
        耗时: h['durationMs'] ?? '-',
        SQL: String(h['sqlText'] ?? '').slice(0, 80),
      }));
      emit(rows, flagsOf(program).output, '（暂无查询历史）');
    }),
  );

// ------------------------------------------------------------------ user

const user = program.command('user').description('用户与权限');

user
  .command('list')
  .description('列出用户')
  .action(
    run(async () => {
      const client = clientOf(program);
      const { data } = await client.get<{ items: Array<Record<string, unknown>> }>('/users');
      const rows = data.items.map((u) => ({
        ID: u['id'],
        用户名: u['username'],
        显示名: u['displayName'] ?? '',
        管理员: u['isAdmin'] ? '是' : '否',
        状态: Number(u['status']) === 1 ? '启用' : '禁用',
        最近登录: u['lastLoginAt'] ?? '-',
      }));
      emit(rows, flagsOf(program).output, '（暂无用户）');
    }),
  );

user
  .command('add <username>')
  .description('新增用户')
  .option('--display-name <name>', '显示名')
  .option('--email <email>', '邮箱')
  .option('--admin', '授予管理员', false)
  .option('--role <role...>', '角色列表')
  .option('--password-stdin', '从 stdin 读取口令', false)
  .action(
    run(
      async (
        username: string,
        options: { displayName?: string; email?: string; admin?: boolean; role?: string[]; passwordStdin?: boolean },
      ) => {
        const client = clientOf(program);
        // 同 login：--password-stdin 必须真正从 stdin 读，否则非交互创建用户必然失败
        let provided: string | undefined;
        if (options.passwordStdin) {
          const piped = await readStdinPassword();
          if (piped) provided = piped;
        }
        const password = await resolvePassword(provided, `新用户 ${username} 的口令: `);
        const payload: Record<string, unknown> = { username, password };
        if (options.displayName) payload['displayName'] = options.displayName;
        if (options.email) payload['email'] = options.email;
        if (options.admin) payload['isAdmin'] = true;
        if (options.role) payload['roles'] = options.role;
        const { data } = await client.post<{ item: Record<string, unknown> }>('/users', payload);
        printSuccess(`已创建用户 ${username}（id=${String(data.item['id'])}）`);
      },
    ),
  );

user
  .command('passwd <id>')
  .description('重置用户口令')
  .action(
    run(async (id: string) => {
      const client = clientOf(program);
      const userId = requireInt(id, '用户 id');
      const password = await resolvePassword(undefined, '新口令: ');
      await client.put(`/users/${userId}`, { password });
      printSuccess(`已重置用户 #${userId} 的口令`);
    }),
  );

// ------------------------------------------------------------------ audit

const audit = program.command('audit').description('审计日志');

audit
  .command('query')
  .description('查询审计日志')
  .option('--user <name>', '按用户名过滤')
  .option('--action <action>', '按动作过滤')
  .option('--status <status>', '按状态过滤')
  .option('--limit <n>', '返回条数', '50')
  .action(
    run(async (options: { user?: string; action?: string; status?: string; limit?: string }) => {
      const client = clientOf(program);
      const params = new URLSearchParams();
      if (options.user) params.set('username', options.user);
      if (options.action) params.set('action', options.action);
      if (options.status) params.set('status', options.status);
      params.set('limit', String(requireInt(options.limit ?? '50', 'limit')));

      const { data } = await client.get<{ items: Array<Record<string, unknown>> }>(
        `/audit/logs?${params.toString()}`,
      );
      const rows = data.items.map((l) => ({
        ID: l['id'],
        时间: l['createdAt'],
        用户: l['username'] ?? '-',
        动作: l['action'],
        状态: l['status'],
        资源: `${String(l['resourceType'] ?? '')}${l['resourceId'] ? `#${String(l['resourceId'])}` : ''}`,
        IP: l['ipAddress'] ?? '-',
      }));
      emit(rows, flagsOf(program).output, '（没有匹配的审计记录）');
    }),
  );

audit
  .command('verify')
  .description('校验审计日志哈希链完整性')
  .action(
    run(async () => {
      const client = clientOf(program);
      const { data } = await client.get<{ ok: boolean; checked: number; brokenAt: number | null }>(
        '/audit/verify',
      );
      if (flagsOf(program).output === 'json') return printJson(data);
      if (data.ok) {
        printSuccess(`哈希链完整，已校验 ${data.checked} 条记录`);
      } else {
        printError(`哈希链在记录 #${String(data.brokenAt)} 处断裂（已校验 ${data.checked} 条）`);
        process.exitCode = 1;
      }
    }),
  );

audit
  .command('stats')
  .description('审计统计概览')
  .action(
    run(async () => {
      const client = clientOf(program);
      const { data } = await client.get<Record<string, unknown>>('/audit/stats');
      if (flagsOf(program).output === 'json') return printJson(data);
      printJson(data);
    }),
  );

// ------------------------------------------------------------------ ai

const ai = program.command('ai').description('AI 助手');

ai
  .command('status')
  .description('查看 AI 是否启用与已配置模型')
  .action(
    run(async () => {
      const client = clientOf(program);
      const { data } = await client.get<Record<string, unknown>>('/ai/status');
      if (flagsOf(program).output === 'json') return printJson(data);
      printTable([
        {
          已启用: data['enabled'] ? '是' : '否',
          已配置模型: data['configured'] ? '是' : '否',
          当前模型: (data['config'] as { modelName?: string } | null)?.modelName ?? '-',
          脱敏: data['redactionEnabled'] ? '开启' : '关闭',
        },
      ]);
      if (!data['enabled']) {
        process.stderr.write('提示：AI 默认关闭，请在 Web 界面「设置 → AI」中启用并配置模型\n');
      }
    }),
  );

ai
  .command('nl2sql')
  .description('自然语言转 SQL（只生成，不会自动执行）')
  .requiredOption('--conn <id>', '连接 id')
  .requiredOption('--prompt <text>', '自然语言需求')
  .action(
    run(async (options: { conn: string; prompt: string }) => {
      const client = clientOf(program);
      const connId = requireInt(options.conn, '连接 id');
      const { data } = await client.post<{
        sql: string;
        explanation: string;
        confidence: number;
        requiresConfirmation: boolean;
      }>('/ai/nl2sql', { connectionId: connId, prompt: options.prompt });

      if (flagsOf(program).output === 'json') return printJson(data);
      process.stdout.write(`${data.sql || '（模型未能生成 SQL）'}\n`);
      if (data.explanation) process.stderr.write(`\n说明：${data.explanation}\n`);
      process.stderr.write(`置信度：${(data.confidence * 100).toFixed(0)}%\n`);
      if (data.requiresConfirmation) {
        process.stderr.write('该语句可能修改数据，请人工确认后再用 query execute 执行\n');
      }
    }),
  );

// ------------------------------------------------------------------ migrate

const migrate = program.command('migrate').description('数据迁移');

migrate
  .command('precheck')
  .description('迁移预检（不写入任何数据）')
  .requiredOption('--source <id>', '源连接 id')
  .requiredOption('--target <id>', '目标连接 id')
  .option('--tables <names>', '逗号分隔的表名，缺省为整库')
  .action(
    run(async (options: { source: string; target: string; tables?: string }) => {
      const client = clientOf(program);
      const payload: Record<string, unknown> = {
        sourceConnectionId: requireInt(options.source, '源连接 id'),
        targetConnectionId: requireInt(options.target, '目标连接 id'),
        tables: options.tables ? options.tables.split(',').map((t) => t.trim()) : [],
      };
      const { data } = await client.post<{
        taskId: number;
        ok: boolean;
        issues: Array<{ level: string; table?: string; message: string; suggestion?: string }>;
        tableMappings: Array<{ sourceTable: string; columnMappings: Array<{ lossy: boolean }> }>;
        estimatedRows: number;
      }>('/migration/precheck', payload);

      if (flagsOf(program).output === 'json') return printJson(data);

      const rows = data.issues.map((i) => ({
        级别: i.level,
        表: i.table ?? '-',
        说明: i.message,
        建议: i.suggestion ?? '',
      }));
      if (rows.length > 0) printTable(rows, '（预检未发现问题）');
      else printSuccess('预检未发现问题');

      process.stdout.write(`\n预计迁移行数：${data.estimatedRows}\n`);
      printSuccess(data.ok ? `预检通过，任务 id=${data.taskId}` : '预检未通过，请先处理 error 级问题');
      if (!data.ok) process.exitCode = 11;
    }),
  );

migrate
  .command('tasks')
  .description('列出迁移任务')
  .action(
    run(async () => {
      const client = clientOf(program);
      const { data } = await client.get<{ items: Array<Record<string, unknown>> }>('/migration/tasks');
      const rows = data.items.map((t) => ({
        ID: t['id'],
        名称: t['name'] ?? '-',
        模式: t['mode'],
        状态: t['status'],
        成功行: t['successRows'] ?? '-',
        失败行: t['failedRows'] ?? '-',
        开始: t['startedAt'] ?? '-',
      }));
      emit(rows, flagsOf(program).output, '（暂无迁移任务）');
    }),
  );

// ------------------------------------------------------------------ diagnose

program
  .command('diagnose')
  .description('导出诊断信息（不含任何口令与密文）')
  .option('--out <path>', '输出文件；缺省打印到 stdout')
  .action(
    run(async (options: { out?: string }) => {
      const client = clientOf(program);
      const { data } = await client.get<Record<string, unknown>>('/meta/diagnostics');
      const text = JSON.stringify(data, null, 2);
      if (options.out) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(options.out, text, 'utf8');
        printSuccess(`诊断信息已写入 ${options.out}`);
      } else {
        process.stdout.write(`${text}\n`);
      }
    }),
  );

migrate
  .command('start')
  .description('创建并执行迁移任务（真实写入目标库，默认 skip 冲突策略）')
  .requiredOption('--source <id>', '源连接 id')
  .requiredOption('--target <id>', '目标连接 id')
  .option('--name <name>', '任务名称')
  .option('--tables <names>', '逗号分隔的表名，缺省为整库')
  .option('--mode <mode>', 'full / incremental / sync', 'full')
  .option('--conflict <strategy>', 'overwrite / skip / error / manual', 'skip')
  .option('--batch <n>', '批量提交行数')
  .option('--no-structure', '不迁移表结构')
  .option('--no-data', '不迁移数据（只建表）')
  .option('--dry-run', '只走一遍流程，不真正写入')
  .action(
    run(async (options: Record<string, unknown>) => {
      const client = clientOf(program);
      const payload: Record<string, unknown> = {
        sourceConnectionId: requireInt(String(options['source']), '源连接 id'),
        targetConnectionId: requireInt(String(options['target']), '目标连接 id'),
        tables: options['tables'] ? String(options['tables']).split(',').map((t) => t.trim()) : [],
        mode: String(options['mode'] ?? 'full'),
        conflictStrategy: String(options['conflict'] ?? 'skip'),
        includeStructure: options['structure'] !== false,
        includeData: options['data'] !== false,
      };
      if (options['name']) payload['name'] = String(options['name']);
      if (options['batch']) payload['batchSize'] = requireInt(String(options['batch']), '批量行数');
      if (options['dryRun']) payload['dryRun'] = true;

      // 真迁移会写目标库，必须显式确认
      if (!flagsOf(program).yes && payload['dryRun'] !== true) {
        const ok = await confirm(
          `即将把连接 #${String(payload['sourceConnectionId'])} 的数据写入连接 #${String(payload['targetConnectionId'])}，继续？`,
        );
        if (!ok) {
          printWarn('已取消');
          return;
        }
      }

      // 注意：该端点返回的是 MigrationResult（字段名 migrationId），
      // 与 /migration/precheck 返回的 taskId 并不一致，这里按真实契约取字段。
      const { data } = await client.post<{
        migrationId: number;
        status: string;
        totalRows: number;
        successRows: number;
        failedRows: number;
        skippedRows: number;
        errorMessage?: string | null;
      }>('/migration/start', payload);

      if (flagsOf(program).output === 'json') return printJson(data);

      printTable([
        {
          任务: data.migrationId,
          状态: data.status,
          总行数: data.totalRows,
          成功: data.successRows,
          失败: data.failedRows,
          跳过: data.skippedRows,
        },
      ]);
      if (data.status === 'success') {
        printSuccess(`迁移完成：任务 ${data.migrationId}，成功 ${data.successRows} 行`);
      } else {
        printError(`迁移结束但状态为 ${data.status}${data.errorMessage ? `：${data.errorMessage}` : ''}`);
        process.exitCode = 12;
      }
      process.stderr.write(`用 peanutsprout migrate status ${data.migrationId} --report 查看逐表明细\n`);
    }),
  );

migrate
  .command('status <id>')
  .description('查看迁移任务进度与逐表报告')
  .option('--report', '同时输出逐表行数报告')
  .option('--watch', '每 2 秒刷新一次，直到任务结束')
  .action(
    run(async (idArg: string, options: { report?: boolean; watch?: boolean }) => {
      const client = clientOf(program);
      const id = requireInt(idArg, '任务 id');
      const json = flagsOf(program).output === 'json';

      const render = async (): Promise<string> => {
        const { data } = await client.get<{ task: Record<string, unknown> }>(`/migration/${id}`);
        const t = data.task;
        if (json) {
          printJson(options.report ? { task: t, report: await fetchReport(client, id) } : t);
          return String(t['status']);
        }
        printTable([
          {
            ID: t['id'],
            名称: t['name'] ?? '-',
            模式: t['mode'],
            状态: t['status'],
            总行数: t['totalRows'] ?? '-',
            成功: t['successRows'] ?? '-',
            失败: t['failedRows'] ?? '-',
            跳过: t['skippedRows'] ?? '-',
          },
        ]);
        if (t['errorMessage']) printError(String(t['errorMessage']));
        return String(t['status']);
      };

      if (!options.watch) {
        await render();
        if (options.report) printJson(await fetchReport(client, id));
        return;
      }

      // watch 模式：终态退出，避免脚本里无限挂住
      for (;;) {
        const status = await render();
        if (['success', 'failed', 'cancelled'].includes(status)) {
          if (options.report) printJson(await fetchReport(client, id));
          if (status !== 'success') process.exitCode = 12;
          return;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }),
  );

migrate
  .command('cancel <id>')
  .description('取消进行中的迁移任务')
  .action(
    run(async (idArg: string) => {
      const client = clientOf(program);
      const id = requireInt(idArg, '任务 id');
      const { data } = await client.post<Record<string, unknown>>(`/migration/${id}/cancel`, {});
      if (flagsOf(program).output === 'json') return printJson(data);
      printSuccess(`任务 #${id} 已请求取消`);
    }),
  );

/** 拉取逐表迁移报告；失败时返回 null，不让报告缺失影响主流程输出。 */
async function fetchReport(client: ApiClient, id: number): Promise<unknown> {
  try {
    const { data } = await client.get<Record<string, unknown>>(`/migration/${id}/report`);
    return data;
  } catch {
    return null;
  }
}

ai
  .command('explain')
  .description('用 AI 解释一段 SQL（只读，不会执行）')
  .requiredOption('--sql <sql>', '要解释的 SQL；也可用 - 从 stdin 读取')
  .action(
    run(async (options: { sql: string }) => {
      const client = clientOf(program);
      const sql = options.sql === '-' ? await readStdinPassword() : options.sql;
      const { data } = await client.post<{ text: string }>('/ai/explain', { sql });
      if (flagsOf(program).output === 'json') return printJson(data);
      process.stdout.write(`${data.text || '（模型未返回解释）'}\n`);
    }),
  );

audit
  .command('export')
  .description('导出审计日志到文件（服务端生成 CSV/JSON，同时自身也会留痕）')
  .option('--out <path>', '输出文件路径（缺省 audit-<时间戳>.<格式>）')
  .option('--format <format>', 'csv 或 json', 'csv')
  .option('--user <name>', '按用户名过滤')
  .option('--action <action>', '按动作过滤')
  .option('--status <status>', '按状态过滤')
  .option('--limit <n>', '最多导出条数', '10000')
  .action(
    run(async (options: { out?: string; format?: string; user?: string; action?: string; status?: string; limit?: string }) => {
      const client = clientOf(program);
      const format = (options.format ?? 'csv').toLowerCase();
      if (format !== 'csv' && format !== 'json') {
        throw new CliError('VALIDATION_FAILED', `--format 只能是 csv 或 json，收到: ${format}`);
      }
      const params = new URLSearchParams();
      params.set('format', format);
      if (options.user) params.set('username', options.user);
      if (options.action) params.set('action', options.action);
      if (options.status) params.set('status', options.status);
      params.set('limit', String(requireInt(options.limit ?? '10000', 'limit')));

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const out = options.out ?? `audit-${stamp}.${format}`;
      // 导出端点是附件下载，响应体是 CSV/JSON 原文而非 JSON 包装，故用 raw 模式
      const { data: text } = await client.request<string>('GET', `/audit/logs/export?${params.toString()}`, undefined, { raw: true });

      const { writeFileSync } = await import('node:fs');
      writeFileSync(out, text, 'utf8');
      printSuccess(`审计日志已导出到 ${out}（${format.toUpperCase()}，${text.split('\n').length - 1} 行）`);
    }),
  );

// ------------------------------------------------------------------ 数据导入导出

program
  .command('export')
  .description('把一张表导出为 CSV（走只读查询，不落服务端文件）')
  .requiredOption('--conn <id>', '连接 id')
  .requiredOption('--table <name>', '表名')
  .option('--schema <name>', 'schema 名')
  .option('--out <path>', '输出文件；缺省打印到 stdout')
  .option('--limit <n>', '最多导出行数', '100000')
  .action(
    run(async (options: { conn: string; table: string; schema?: string; out?: string; limit?: string }) => {
      const client = clientOf(program);
      const connId = requireInt(options.conn, '连接 id');
      const limit = requireInt(options.limit ?? '100000', 'limit');
      // 表名会拼进 SQL，这里做一次严格白名单校验（与驱动侧同一套规则）
      assertSimpleIdentifier(options.table, '表名');
      if (options.schema) assertSimpleIdentifier(options.schema, 'schema 名');
      const qualified = options.schema ? `${options.schema}.${options.table}` : options.table;
      const sql = `SELECT * FROM ${qualified} LIMIT ${limit}`;

      const { data } = await client.post<{
        columns: Array<{ name: string }>;
        rows: unknown[][];
        truncated: boolean;
      }>('/query/execute', { connectionId: connId, sql });

      const rows = resultToRows(data.columns, data.rows);
      const csv = toCsv(rows);
      if (options.out) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(options.out, `${csv}\n`, 'utf8');
        // 该命令的 stdout 是"数据通道"（--out 缺省时 CSV 直接写 stdout），
        // 因此成功/警告提示必须走 stderr，保证 stdout 只有数据、管道产物不被污染。
        printSuccessStderr(`已导出 ${rows.length} 行到 ${options.out}`);
      } else {
        process.stdout.write(`${csv}\n`);
      }
      if (data.truncated) printWarn(`结果被截断，仅导出 ${rows.length} 行，请用 --limit 调整`);
    }),
  );

program
  .command('import')
  .description('把 CSV 导入到一张表（生成 INSERT，写操作需要 --yes 确认）')
  .requiredOption('--conn <id>', '连接 id')
  .requiredOption('--table <name>', '目标表名')
  .requiredOption('--file <path>', 'CSV 文件路径；- 表示 stdin')
  .option('--schema <name>', 'schema 名')
  .option('--batch <n>', '每条 INSERT 包含的行数', '200')
  .option('--has-header', '首行是列名（默认视为有表头）', true)
  .option('--null-token <token>', '把与该值完全相同的字段写成 NULL（例如 --null-token \\N）；缺省时所有字段都按字符串处理')
  .action(
    run(async (options: { conn: string; table: string; file: string; schema?: string; batch?: string; hasHeader?: boolean; nullToken?: string }) => {
      const client = clientOf(program);
      const connId = requireInt(options.conn, '连接 id');
      const batchSize = requireInt(options.batch ?? '200', '批量行数');
      assertSimpleIdentifier(options.table, '表名');
      if (options.schema) assertSimpleIdentifier(options.schema, 'schema 名');

      const raw =
        options.file === '-'
          ? await readStdinPassword()
          : readFileSync(options.file, 'utf8');
      const table = parseCsv(raw);
      if (table.length === 0) throw new CliError('VALIDATION_FAILED', 'CSV 内容为空');

      // 表头：列名同样要过白名单，否则等于把注入权交给了 CSV 文件
      const header = options.hasHeader === false ? null : table[0];
      const dataRows = header ? table.slice(1) : table;
      if (header) for (const h of header) assertSimpleIdentifier(h, '列名');
      if (dataRows.length === 0) throw new CliError('VALIDATION_FAILED', 'CSV 只有表头，没有数据行');

      const qualified = options.schema ? `${options.schema}.${options.table}` : options.table;
      const columnsSql = header ? ` (${header.join(', ')})` : '';
      const statements: string[] = [];
      for (let i = 0; i < dataRows.length; i += batchSize) {
        const chunk = dataRows.slice(i, i + batchSize);
        const valuesSql = chunk
          .map((row) => `(${row.map((cell) => sqlLiteral(cell, options.nullToken)).join(', ')})`)
          .join(', ');
        statements.push(`INSERT INTO ${qualified}${columnsSql} VALUES ${valuesSql}`);
      }

      if (!flagsOf(program).yes) {
        const ok = await confirm(
          `将向 ${qualified} 插入 ${dataRows.length} 行（拆成 ${statements.length} 条 INSERT），继续？`,
        );
        if (!ok) {
          printWarn('已取消');
          return;
        }
      }

      let inserted = 0;
      for (const sql of statements) {
        await client.post('/query/execute', { connectionId: connId, sql, confirm: true });
        inserted += 1;
      }
      if (flagsOf(program).output === 'json') {
        return printJson({ table: qualified, rows: dataRows.length, statements: inserted });
      }
      printSuccess(`已导入 ${dataRows.length} 行到 ${qualified}（${inserted} 条 INSERT）`);
    }),
  );

// ------------------------------------------------------------------ 更新检查

program
  .command('update')
  .description('检查新版本')
  .command('check')
  .description('对比本地版本与更新清单（未配置更新源时如实告知，不会假装已是最新）')
  .action(
    run(async () => {
      const flags = flagsOf(program);
      const manifestUrl = process.env['PEANUTSPROUT_UPDATE_MANIFEST'] ?? '';
      const checkedAt = new Date().toISOString();

      if (!manifestUrl) {
        const payload = {
          currentVersion: PRODUCT.version,
          updateAvailable: null,
          manifestUrl: null,
          checkedAt,
          message: '未配置更新源（环境变量 PEANUTSPROUT_UPDATE_MANIFEST 为空），无法判断是否有新版本',
        };
        if (flags.output === 'json') return printJson(payload);
        printWarn(payload.message);
        process.stderr.write('离线环境下可直接到发布页查看最新版本\n');
        return;
      }

      // 更新清单是外部内容，只按数据解析，绝不执行其中任何内容
      let res: Response;
      try {
        res = await fetch(manifestUrl, { signal: AbortSignal.timeout(10_000) });
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        throw new CliError(
          'CONNECTION_FAILED',
          `无法拉取更新清单 ${manifestUrl}：${reason}\n提示：内网/离线环境可不设置 PEANUTSPROUT_UPDATE_MANIFEST`,
        );
      }
      if (!res.ok) throw new CliError('CONNECTION_FAILED', `更新清单拉取失败：HTTP ${res.status} ${manifestUrl}`);
      const manifest = (await res.json()) as { version?: string; notes?: string; url?: string };
      const latest = String(manifest.version ?? '').trim();
      if (!latest) throw new CliError('VALIDATION_FAILED', '更新清单缺少 version 字段');

      const updateAvailable = compareVersions(latest, PRODUCT.version) > 0;
      const payload = {
        currentVersion: PRODUCT.version,
        latestVersion: latest,
        updateAvailable,
        notes: manifest.notes ?? null,
        url: manifest.url ?? null,
        manifestUrl,
        checkedAt,
      };
      if (flags.output === 'json') return printJson(payload);
      if (updateAvailable) {
        printWarn(`发现新版本 ${latest}（当前 ${PRODUCT.version}）`);
        if (manifest.url) process.stdout.write(`下载：${manifest.url}\n`);
        process.exitCode = 13;
      } else {
        printSuccess(`已是最新版本（${PRODUCT.version}）`);
      }
    }),
  );

/** 标识符白名单：只允许常规字母/数字/下划线/$，且不以数字开头。 */
function assertSimpleIdentifier(value: string, what: string): void {
  if (!/^[\p{L}_][\p{L}\p{N}_$]*$/u.test(value)) {
    throw new CliError('VALIDATION_FAILED', `${what}含非法字符: ${JSON.stringify(value)}`);
  }
}

/**
 * SQL 字面量转义。
 *
 * 为什么不再按内容猜类型：导入路径拿不到目标列类型，任何"看起来像数字/布尔"的
 * 猜测都会造成静默数据损坏——前导零（01234 → 1234）、超过 2^53 的大整数
 * （98765432109876543210 → 9.8765432109876544e+19）、文本 "true" → 1 都会被改写；
 * 空字段写成 NULL 还会把"空字符串"和"未提供"混为一谈。
 * 因此默认把每个字段都当作字符串（单引号包裹、内部单引号翻倍），空字段写成空字符串
 * ''，把类型转换交给数据库列类型。确需 NULL 时由调用方显式传入 nullToken
 * （例如 --null-token '\N'）作为约定，绝不再默认把空字段变成 NULL。
 *
 * 这里导出仅为便于单元测试直接覆盖转义规则。
 */
export function sqlLiteral(value: string, nullToken?: string): string {
  if (nullToken !== undefined && nullToken !== '' && value === nullToken) return 'NULL';
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * 极简 CSV 解析：支持双引号包裹、字段内逗号/换行、以及 "" 转义。
 * 刻意不引第三方依赖 —— 导入是低频操作，够用即可，行为可预期更重要。
 * 导出仅为便于单元测试直接覆盖解析规则。
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      // 跳过完全空白的行，避免文件尾换行产生一条假记录
      if (!(row.length === 1 && row[0] === '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
  }
  return rows;
}

/** 语义化版本比较：a > b 返回正数，相等返回 0。 */
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ------------------------------------------------------------------ 入口

/**
 * commander 默认在用法错误时直接 process.exit(1)，与 docs/cli-reference.md §1.7
 * 承诺的"用法/参数校验失败 → 退出码 2"不一致，脚本就没法区分"参数写错"和"内部错误"。
 * exitOverride() 让 commander 改为抛 CommanderError，由 main() 统一映射成退出码 2；
 * 子命令各自持有自己的 exit 回调，所以必须递归设置到每一级。
 */
function applyExitOverride(cmd: Command): void {
  cmd.exitOverride();
  for (const sub of cmd.commands) applyExitOverride(sub);
}
applyExitOverride(program);

export async function main(argv: string[] = process.argv): Promise<void> {
  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      // --help / --version 也走 CommanderError，但它们携带 exitCode=0，
      // 属于"正常结束"，绝不能当成用法错误报退出码 2。
      if (error.exitCode === 0) {
        process.exitCode = 0;
        return;
      }
      // commander 已经把 "error: ..." 写到 stderr，这里不再重复打印，只把退出码统一为 2
      process.exitCode = 2;
      return;
    }
    process.exitCode = reportError(error, QUIET);
    return;
  }

  // 缺少令牌时给出可操作的提示，而不是让用户面对一堆 401
  const flags = flagsOf(program);
  if (!['version', 'help', 'init', 'login', 'serve'].includes(program.args[0] ?? '')) {
    try {
      if (!resolveToken({ ...flags, timeoutMs: Number(flags.timeout) || 30_000 })) {
        process.stderr.write('提示：尚未登录，先执行 peanutsprout login，或用 --token 指定令牌\n');
      }
    } catch {
      /* 令牌文件问题留给具体请求报错 */
    }
  }
}

const isDirectRun = /(?:^|[/\\])index\.(ts|js)$/.test(process.argv[1] ?? '');
if (isDirectRun) {
  void main();
}

export { program };
