/**
 * 花生苗数据库管理工具 - 查询与执行计划模型
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export type CellValue = string | number | null | boolean | Uint8Array;

export interface ColumnMeta {
  name: string;
  dataType: string;
}

export interface QueryResult {
  queryId: string;
  columns: ColumnMeta[];
  rows: CellValue[][];
  /** 返回的行数（受 maxRows 限制时为已返回行数） */
  rowCount: number;
  /** DML 影响行数；SELECT 为 0 */
  affectedRows: number;
  durationMs: number;
  /** 是否因为 maxRows 被截断 */
  truncated: boolean;
  notices: string[];
}

export interface QueryOptions {
  maxRows?: number;
  timeoutMs?: number;
  /**
   * 绑定参数（占位符 `?`）。数据迁移与批量写入依赖它，
   * 从而避免把值拼进 SQL —— 这是 SQL 注入防护与二进制安全的关键。
   */
  params?: CellValue[];
  /** 单次执行的审计上下文 */
  signal?: AbortSignal;
}

export interface ExecutionPlan {
  format: 'text' | 'json' | 'tree';
  content: string;
  raw?: unknown;
  /** 归一化后的节点，便于可视化耗时占比（PRD M04-08） */
  nodes?: ExecutionPlanNode[];
}

export interface ExecutionPlanNode {
  id: string;
  label: string;
  /** 该节点占总耗时的估算占比 0..1 */
  costShare?: number;
  detail?: string;
  children?: ExecutionPlanNode[];
}

export interface QueryHistoryEntry {
  id: number;
  userId: number;
  connectionId: number | null;
  connectionName: string | null;
  sqlText: string;
  status: 'success' | 'failed' | 'cancelled';
  errorMessage: string | null;
  durationMs: number | null;
  affectedRows: number | null;
  resultRows: number | null;
  isSlow: boolean;
  executedAt: string;
}

/**
 * 会改动数据或结构的动词。
 *
 * 说明：这里是**安全判定**，所以取"宁可误判为写"的保守方向。
 *
 * 关于 `into`：`SELECT ... INTO <新表>` 是 PostgreSQL 的**建表**语法（等价 DDL），
 * 它没有别的写动词，只靠 `select` 会被判成只读 —— 已实测只读账号能借此建表，
 * 因此把 `into` 也列为写标志。`INSERT INTO` 本就由 `insert` 命中，不受影响。
 */
const WRITE_VERBS = new Set([
  'insert',
  'update',
  'delete',
  'merge',
  'replace',
  'upsert',
  'into',
  'truncate',
  'drop',
  'alter',
  'create',
  'grant',
  'revoke',
  'comment',
  'rename',
  'call',
  'exec',
  'execute',
  'do',
  'vacuum',
  'attach',
  'detach',
  'pragma',
  'reindex',
  'analyze',
  'optimise',
  'optimize',
  'repair',
  'flush',
  'lock',
  'unlock',
  'kill',
  'shutdown',
  'purge',
  'install',
  'load',
  'copy',
  'import',
  'refresh',
  'reset',
  'outfile',
  'dumpfile',
  'handler',
  'begin',
  'start',
  'commit',
  'rollback',
  'savepoint',
]);

/** 明确只返回结果集的动词。不在这个白名单里的动词一律按写操作处理。 */
const READ_VERBS = new Set(['select', 'values', 'show', 'desc', 'describe', 'explain', 'table']);

/**
 * 把字符串字面量与带引号标识符的内容抹成空格。
 *
 * 目的：`SELECT 'delete from users'` 里的 delete 只是数据，不是语句动词。
 * 抹掉内容但保留引号与外层结构，既不影响括号配对，也不会让关键字漏进来。
 */
/**
 * 把字符串字面量与带引号标识符**整体**替换成占位标识符 x。
 *
 * 目的：`SELECT 'delete from users'` 里的 delete 是数据不是动词；
 * `WITH "my cte" AS (...)` 里的空格也不能干扰 CTE 解析。
 * 整体替换（含引号）比"只抹内容"更省事：后续扫描不会遇到游离引号。
 */
function blankSqlLiterals(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i]!;
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < n) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2; // 连续两个引号是转义
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      out += 'x';
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

const WORD_CHAR = /[A-Za-z0-9_$]/;

function skipSpace(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i]!)) i++;
  return i;
}

function readWord(s: string, i: number): { word: string; end: number } {
  let j = i;
  while (j < s.length && WORD_CHAR.test(s[j]!)) j++;
  return { word: s.slice(i, j).toLowerCase(), end: j };
}

/** s[i] 必须是 '('；返回与之匹配的 ')' 之后的下标。 */
function skipBalanced(s: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < s.length) {
    const ch = s[j]!;
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return j + 1;
    }
    j++;
  }
  return j;
}

/** s[i] 必须是 '('；返回与之匹配的 ')' 的下标（不含）。 */
function matchingParen(s: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < s.length) {
    const ch = s[j]!;
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return j;
    }
    j++;
  }
  return s.length;
}

/**
 * 解析 `WITH [RECURSIVE] name [(cols)] AS [MATERIALIZED] ( body ) [, ...]`，
 * 返回每个 CTE 的**括号体内容**，以及主语句的起始下标。
 *
 * 为什么必须取出体内容而不能整段跳过：
 * PostgreSQL 的 CTE 体是**真正会执行的 DML**：
 *   `WITH w AS (DELETE FROM t RETURNING *) SELECT count(*) FROM w`
 * 会真的删表数据。早期实现用 skipBalanced 把体整段跳过，于是这条语句被判成只读，
 * 只读账号能借它删数据（已实测复现）。现在把每个体交回分析器递归判定。
 */
function parseWithClause(sql: string, start: number): { bodies: string[]; end: number } {
  const bodies: string[] = [];
  let i = skipSpace(sql, start);
  const recursive = readWord(sql, i);
  if (recursive.word === 'recursive') i = skipSpace(sql, recursive.end);

  for (;;) {
    // CTE 名（字面量已被替换成 x，这里只需跳过非空白/括号/逗号片段）
    while (i < sql.length && !/[\s(,]/.test(sql[i]!)) i++;
    i = skipSpace(sql, i);
    if (sql[i] === '(') i = skipSpace(sql, skipBalanced(sql, i)); // 列清单
    const asWord = readWord(sql, i);
    if (asWord.word === 'as') i = skipSpace(sql, asWord.end);
    // PostgreSQL 12+ 的 `AS [NOT] MATERIALIZED (...)`
    const mat = readWord(sql, i);
    if (mat.word === 'materialized') i = skipSpace(sql, mat.end);
    else if (mat.word === 'not') {
      const mat2 = readWord(sql, skipSpace(sql, mat.end));
      if (mat2.word === 'materialized') i = skipSpace(sql, mat2.end);
    }
    if (sql[i] === '(') {
      const close = matchingParen(sql, i);
      bodies.push(sql.slice(i + 1, close));
      i = skipSpace(sql, close + 1);
    }
    if (sql[i] === ',') {
      i = skipSpace(sql, i + 1);
      continue;
    }
    break;
  }
  return { bodies, end: i };
}

/**
 * 找出语句的"主动词"。
 *
 * `WITH` 开头的语句要先把 CTE 定义跳过去，否则会把 CTE 里的 SELECT 当成整条语句的动词，
 * 从而漏掉后面的 DELETE/UPDATE/INSERT。
 */
function findMainVerb(sql: string): string | null {
  let i = skipSpace(sql, 0);
  // 跳过前导的非单词字符：`# 注释`、`(` 等，否则读不到第一个词就会误判为只读
  while (i < sql.length && !/[A-Za-z_]/.test(sql[i]!)) i++;
  if (i >= sql.length) return null;
  const first = readWord(sql, i);
  if (first.word !== 'with') return first.word.length > 0 ? first.word : null;
  const verb = readWord(sql, parseWithClause(sql, first.end).end);
  return verb.word.length > 0 ? verb.word : null;
}

/** 收集括号深度为 0 的词（子查询、函数参数都在深度 >= 1，天然被排除）。 */
function topLevelWords(sql: string): string[] {
  const words: string[] = [];
  let depth = 0;
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i]!;
    if (ch === '(') {
      depth++;
      i++;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const { word, end } = readWord(sql, i);
      if (depth === 0) words.push(word);
      i = end;
      continue;
    }
    i++;
  }
  return words;
}

/**
 * 判断**单条**语句的语义。
 *
 * 与旧实现（只看第一个关键字的正则）的关键区别：
 *  · `WITH x AS (SELECT 1) DELETE FROM t` —— 跳过 CTE 定义后看主语句动词；
 *  · `WITH x AS (DELETE FROM t RETURNING *) SELECT ...` —— **递归分析 CTE 体**，
 *    因为 PostgreSQL 会真的执行体里的 DML（实测可借它绕过写闸门删数据）；
 *  · `EXPLAIN ANALYZE DELETE FROM t` —— 动词是 EXPLAIN，但顶层出现写动词；
 *  · `SELECT ... INTO 新表` —— `into` 是写标志（PG 的 SELECT INTO 会建表）；
 *  · 无法识别的动词按写处理（fail-closed），新语法不会自动成为绕过通道。
 */
export function analyzeSqlStatement(statement: string): 'read' | 'write' {
  const blanked = blankSqlLiterals(stripSqlComments(statement));
  if (blanked.trim().length === 0) return 'read';

  const verb = findMainVerb(blanked);
  if (verb === 'with') {
    // 理论上不会走到（findMainVerb 已跳过 CTE），但保留以防解析退化
    return 'write';
  }
  // CTE 体：`WITH ... AS ( body )` 里的 body 会被数据库真正执行
  for (const body of cteBodies(blanked)) {
    if (analyzeBareStatement(body) === 'write') return 'write';
  }
  return analyzeBareStatement(blanked);
}

/** 取出语句里所有 CTE 体的内容（非 WITH 语句返回空数组）。 */
function cteBodies(blanked: string): string[] {
  let i = skipSpace(blanked, 0);
  while (i < blanked.length && !/[A-Za-z_]/.test(blanked[i]!)) i++;
  if (i >= blanked.length) return [];
  const first = readWord(blanked, i);
  if (first.word !== 'with') return [];
  return parseWithClause(blanked, first.end).bodies;
}

/**
 * 分析一条"没有 CTE 包装"的语句。
 *
 * 判定顺序：主动词是写动词 → 写；主动词是读动词 → 再看顶层是否混入写动词；
 * 其余（**包括解析不出动词的情况**）一律按写处理。
 */
function analyzeBareStatement(blanked: string): 'read' | 'write' {
  if (blanked.trim().length === 0) return 'read';
  const verb = findMainVerb(blanked);
  // fail-closed：解析不出动词（例如全角关键字、畸形语句）绝不能当成只读
  if (verb === null) return 'write';
  if (WRITE_VERBS.has(verb)) return 'write';
  if (!READ_VERBS.has(verb)) return 'write';
  let words = topLevelWords(blanked);
  if (verb === 'explain') {
    // `EXPLAIN ANALYZE SELECT ...` 里的 ANALYZE 是 EXPLAIN 的语法成分（表示"真的执行一遍"），
    // 不是独立的写动词。不过滤掉它会把最常见的只读排查语句误判成写。
    // 注意 `EXPLAIN ANALYZE DELETE FROM t` 仍然会因为 delete 被判为写，保护不受影响。
    words = words.filter((word) => word !== 'analyze' && word !== 'analyse');
  }
  return words.some((word) => WRITE_VERBS.has(word)) ? 'write' : 'read';
}

/**
 * 判断一段 SQL 是否属于写操作（只读保护与 AI 确认都用它）。
 *
 * **多语句脚本按"任意一条为写则整体为写"处理**：否则
 * `SELECT 1; DROP TABLE t; -- limit` 会被判为只读，从而同时绕过写权限、
 * 只读连接保护与二次确认。
 */
export function isWriteStatement(sql: string): boolean {
  const statements = splitSqlStatements(sql);
  if (statements.length === 0) {
    // 没有任何可执行语句时，退回到整体分析：
    // 避免"注释剥离把语句吃空"导致的漏判（例如只剩一条可执行注释）。
    return analyzeSqlStatement(sql) === 'write';
  }
  return statements.some((statement) => analyzeSqlStatement(statement) === 'write');
}

/** 判断是否为查询语句（会返回结果集）。 */
export function isReadStatement(sql: string): boolean {
  if (sql.trim().length === 0) return false;
  return !isWriteStatement(sql);
}

/**
 * 判断 `--` 是否构成行注释。
 *
 * MySQL / MariaDB 要求第二个 `-` 之后必须是空白、控制字符或行尾才算注释。
 * 这一点是安全相关的：`SELECT 1--1; DROP TABLE t` 在 MySQL 里是
 * `SELECT 1-(-1)` 后面跟一条**真的 DROP**；若把 `--1` 当成注释吃掉整行，
 * 写闸门就会漏判这条 DROP（已实测的绕过手法）。
 *
 * 代价：PostgreSQL 允许 `--注释`（无空格），此处会把它当成普通文本。
 * 若注释内容里含写动词，会被保守地判为写 —— 这是"宁可误拦"的方向，可以接受。
 */
function isDashComment(sql: string, i: number): boolean {
  const after = i + 2 < sql.length ? sql[i + 2]! : '';
  return after === '' || /\s/.test(after);
}

/** 判断 `/*` 处的注释是否是可执行版本注释（MySQL `/*!` / MariaDB `/*M!`）。 */
function isExecutableComment(sql: string, i: number): boolean {
  return sql[i + 2] === '!' || (sql[i + 2] === 'M' && sql[i + 3] === '!');
}

/**
 * 去掉 SQL 注释，避免 `-- delete everything` 这类注释干扰写操作判定。
 * 对字符串字面量做保守处理：遇到引号就原样保留直到闭合。
 *
 * **可执行版本注释不是注释**：MySQL 会执行 `/*!50000 DROP TABLE t *​/` 里的 SQL。
 * 这里只剥掉可执行注释的起始标记与紧随的版本号，把内部语句留在结果里交给判定器，
 * 否则它会变成一条"什么都不含"的只读语句（已实测的绕过手法）。
 */
export function stripSqlComments(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === '-' && next === '-' && isDashComment(sql, i)) {
      while (i < n && sql[i] !== '\n') i++;
      out += ' ';
      continue;
    }
    if (ch === '/' && next === '*') {
      if (isExecutableComment(sql, i)) {
        // 只跳过 `/*!` 或 `/*M!` 及其版本号，内部 SQL 继续参与分析；
        // 结尾的 `*/` 作为普通字符留下（它不含单词，不影响判定）
        let j = i + (sql[i + 2] === '!' ? 3 : 4);
        while (j < n && /[0-9]/.test(sql[j]!)) j++;
        i = j;
        continue;
      }
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
      continue;
    }
    // MySQL 的 `#` 行注释。只在行首（前面只有空白）时生效，
    // 因为 PostgreSQL 里 `#` 是合法运算符（如 `data #> '{a}'`），不能一律当注释吃掉。
    if (ch === '#') {
      let back = i - 1;
      while (back >= 0 && (sql[back] === ' ' || sql[back] === '\t' || sql[back] === '\r')) back--;
      if (back < 0 || sql[back] === '\n') {
        while (i < n && sql[i] !== '\n') i++;
        out += ' ';
        continue;
      }
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i++;
      while (i < n) {
        out += sql[i];
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            out += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * 拆分多语句脚本（用于 SQL 文件导入）。忽略注释与字符串中的分号。
 *
 * 注意：**可执行版本注释原样保留**（连可执行注释的起始标记与结束标记一起），
 * 因为拆分结果会被真正执行 —— 剥掉包裹会让 SQL 变成非法语句。
 * 判定器在分析时自己会剥掉外层标记，因此分类仍然正确。
 */
export function splitSqlStatements(script: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  const n = script.length;
  while (i < n) {
    const ch = script[i];
    const next = script[i + 1];
    if (ch === '-' && next === '-' && isDashComment(script, i)) {
      while (i < n && script[i] !== '\n') i++;
      current += ' ';
      continue;
    }
    if (ch === '/' && next === '*') {
      if (isExecutableComment(script, i)) {
        // 原样保留整段（含 `/*!` 与 `*/`），保证执行时不缺字符；
        // 其中的 `;` 仍按普通字符处理（可执行注释内部不允许再分句）
        while (i < n && !(script[i] === '*' && script[i + 1] === '/')) {
          current += script[i];
          i++;
        }
        current += '*/';
        i += 2;
        continue;
      }
      i += 2;
      while (i < n && !(script[i] === '*' && script[i + 1] === '/')) i++;
      i += 2;
      current += ' ';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      current += ch;
      i++;
      while (i < n) {
        current += script[i];
        if (script[i] === quote) {
          if (script[i + 1] === quote) {
            current += script[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}
