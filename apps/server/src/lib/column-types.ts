/**
 * 花生苗数据库管理工具 - 可视化建库建表的列类型目录
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 这是给界面下拉框用的**建议类型清单**，不是"该库支持的全部类型"。
 * 数据库的类型系统远比一个下拉框能表达的多（数组、区间、自定义域、枚举…），
 * 所以界面同时允许手填类型名，这个清单只负责让最常用的那些能点出来、
 * 并且能正确判断"要不要显示长度输入框"。
 */

export interface ColumnTypeInfo {
  name: string;
  /** 归类，界面可以分组显示 */
  category: string;
  /** 是否接受 `(n)` 或 `(p,s)` 后缀 */
  hasLength: boolean;
}

/** 关系型库里最常用的一批类型，按"整数/小数/文本/时间/其他"分组。 */
const NUMERIC_TYPES: ColumnTypeInfo[] = [
  { name: 'tinyint', category: 'numeric', hasLength: false },
  { name: 'smallint', category: 'numeric', hasLength: false },
  { name: 'integer', category: 'numeric', hasLength: false },
  { name: 'bigint', category: 'numeric', hasLength: false },
  { name: 'decimal', category: 'numeric', hasLength: true },
  { name: 'numeric', category: 'numeric', hasLength: true },
  { name: 'real', category: 'numeric', hasLength: false },
  { name: 'double precision', category: 'numeric', hasLength: false },
  { name: 'float', category: 'numeric', hasLength: false },
  { name: 'double', category: 'numeric', hasLength: false },
];

const TEXT_TYPES: ColumnTypeInfo[] = [
  { name: 'char', category: 'text', hasLength: true },
  { name: 'varchar', category: 'text', hasLength: true },
  { name: 'text', category: 'text', hasLength: false },
  { name: 'tinytext', category: 'text', hasLength: false },
  { name: 'mediumtext', category: 'text', hasLength: false },
  { name: 'longtext', category: 'text', hasLength: false },
];

const TEMPORAL_TYPES: ColumnTypeInfo[] = [
  { name: 'date', category: 'temporal', hasLength: false },
  { name: 'time', category: 'temporal', hasLength: false },
  { name: 'datetime', category: 'temporal', hasLength: false },
  { name: 'timestamp', category: 'temporal', hasLength: false },
];

const OTHER_TYPES: ColumnTypeInfo[] = [
  { name: 'boolean', category: 'other', hasLength: false },
  { name: 'blob', category: 'other', hasLength: false },
  { name: 'json', category: 'other', hasLength: false },
];

const NUMERIC_ORDER = ['tinyint', 'smallint', 'integer', 'bigint', 'decimal', 'numeric', 'real', 'double precision', 'float', 'double'];
const TEXT_ORDER = ['char', 'varchar', 'text', 'tinytext', 'mediumtext', 'longtext'];
const TEMPORAL_ORDER = ['date', 'time', 'datetime', 'timestamp'];
const OTHER_ORDER = ['boolean', 'blob', 'json'];
const PG_ONLY = ['serial', 'bigserial', 'uuid', 'jsonb', 'bytea', 'timestamptz'];
const MYSQL_ONLY = ['mediumint', 'year', 'binary', 'varbinary', 'enum', 'set'];

function pick(all: ColumnTypeInfo[], order: string[]): ColumnTypeInfo[] {
  return order.flatMap((name) => {
    const item = all.find((t) => t.name === name);
    return item ? [item] : [];
  });
}

/**
 * 按数据库类型给出建议类型清单。
 *
 * 三个方言族分开，是因为把 `jsonb` 摆到 MySQL 的下拉里、或者把 `mediumint`
 * 摆到 PostgreSQL 的下拉里，用户点了就会拿到一条语法错误 —— 与其让他在报错里
 * 自己猜，不如一开始就不显示。
 */
export function columnTypesFor(dbType: string): ColumnTypeInfo[] {
  const numeric = pick(NUMERIC_TYPES, NUMERIC_ORDER);
  const text = pick(TEXT_TYPES, TEXT_ORDER);
  const temporal = pick(TEMPORAL_TYPES, TEMPORAL_ORDER);
  const other = pick(OTHER_TYPES, OTHER_ORDER);

  switch (dbType) {
    case 'sqlite':
      // SQLite 用的是"类型亲和性"，下面这些名字都能建表；它没有真正的
      // 布尔/日期类型，但接受这些声明名（并分别归到 NUMERIC / TEXT 亲和性）。
      return [...numeric, ...text, ...temporal, ...other];
    case 'postgresql':
    case 'kingbase':
      return [
        ...numeric,
        { name: 'serial', category: 'numeric', hasLength: false },
        { name: 'bigserial', category: 'numeric', hasLength: false },
        ...text,
        ...temporal,
        { name: 'timestamptz', category: 'temporal', hasLength: false },
        { name: 'boolean', category: 'other', hasLength: false },
        { name: 'uuid', category: 'other', hasLength: false },
        { name: 'json', category: 'other', hasLength: false },
        { name: 'jsonb', category: 'other', hasLength: false },
        { name: 'bytea', category: 'other', hasLength: false },
      ];
    case 'mysql':
    case 'mariadb':
    case 'tidb':
    case 'oceanbase':
      return [
        ...numeric,
        { name: 'mediumint', category: 'numeric', hasLength: false },
        ...text,
        { name: 'binary', category: 'text', hasLength: true },
        { name: 'varbinary', category: 'text', hasLength: true },
        ...temporal,
        { name: 'year', category: 'temporal', hasLength: false },
        ...other,
        { name: 'enum', category: 'other', hasLength: true },
        { name: 'set', category: 'other', hasLength: true },
      ];
    default:
      // 未实现的驱动：给一份通用清单，用户仍可手填类型名
      return [...numeric, ...text, ...temporal, ...other];
  }
}

/** 该方言族"创建 Schema/数据库"用哪个关键字；null = 不支持。 */
export function schemaKeywordFor(dbType: string): 'SCHEMA' | 'DATABASE' | null {
  switch (dbType) {
    case 'postgresql':
    case 'kingbase':
      return 'SCHEMA';
    case 'mysql':
    case 'mariadb':
    case 'tidb':
    case 'oceanbase':
      return 'DATABASE';
    // SQLite 的"库"就是文件本身：CREATE SCHEMA/DATABASE 都不支持，
    // 换库要靠 ATTACH DATABASE 挂载另一个文件，属于连接层面的事。
    case 'sqlite':
      return null;
    default:
      return null;
  }
}

/** 该方言是否支持 `CREATE TABLE IF NOT EXISTS`。 */
export function supportsIfNotExists(dbType: string): boolean {
  // SQL Server 的建表语句没有 IF NOT EXISTS（只有 DROP 有），它是唯一例外；
  // 其余已实现方言都支持。这里显式列出支持的，未知的一律当作不支持。
  return ['sqlite', 'postgresql', 'kingbase', 'mysql', 'mariadb', 'tidb', 'oceanbase'].includes(dbType);
}

/**
 * 校验一个 DDL 里要用的**默认值**表达式。
 *
 * 为什么需要这个：DDL 语句在任何数据库里都**不支持绑定参数**
 * （`DEFAULT ?` 是语法错误），所以默认值只能拼进 SQL 文本。驱动层的
 * `DdlGenerator` 也是这么设计的（`defaultValue` 原样输出）。
 * 既然无法参数化，这里就只能用白名单把它限制在"字面量或几个标准函数"里，
 * 挡住 `0; DROP TABLE x --` 这种靠在默认值里塞第二条语句的写法。
 *
 * 返回 true 表示可以原样拼进 SQL。
 */
export function isSafeDefaultExpression(raw: string): boolean {
  const value = raw.trim();
  if (value.length === 0) return true;
  // 数字（含小数、正负号、科学计数）
  if (/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(value)) return true;
  // 单引号字符串；允许 SQL 标准的 '' 转义，不允许反斜杠转义（各家语义不一致）
  if (/^'(?:[^']|'')*'$/.test(value)) return true;
  // 布尔字面量
  if (/^(true|false|TRUE|FALSE)$/.test(value)) return true;
  // NULL
  if (/^null$/i.test(value)) return true;
  // 少数标准函数/关键字（不带括号，避免出现任意函数调用）
  if (/^(CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME|LOCALTIMESTAMP)$/i.test(value)) return true;
  // 带精度的 CURRENT_TIMESTAMP(6)
  if (/^CURRENT_TIMESTAMP\(\d\)$/i.test(value)) return true;
  return false;
}
