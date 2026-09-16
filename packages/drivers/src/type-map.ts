/**
 * 花生苗数据库管理工具 - 跨库类型映射
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * PRD 十一、风险与约束：跨库类型映射无法 100% 完美，
 * 因此这里明确采用「尽力映射 + 标记 lossy + 人工确认」策略：
 * mapType() 返回的 lossy=true 会被迁移预检收集成 warning，交由用户确认。
 */

import type { DatabaseType, TypeMapper } from '@peanutsprout/core';

/** 归一化后的类型词汇，用于结构对比与映射。 */
export type CanonicalType =
  | 'boolean'
  | 'tinyint'
  | 'smallint'
  | 'int'
  | 'bigint'
  | 'decimal'
  | 'float'
  | 'double'
  | 'char'
  | 'varchar'
  | 'text'
  | 'binary'
  | 'date'
  | 'time'
  | 'datetime'
  | 'timestamp'
  | 'json'
  | 'uuid'
  | 'enum'
  | 'geometry'
  | 'array'
  | 'unknown';

const CANONICAL_PATTERNS: ReadonlyArray<[RegExp, CanonicalType]> = [
  [/^(bool|boolean|bit)$/i, 'boolean'],
  [/^(tinyint)$/i, 'tinyint'],
  [/^(smallint|int2|smallserial)$/i, 'smallint'],
  [/^(int|integer|int4|mediumint|serial)$/i, 'int'],
  [/^(bigint|int8|bigserial|long)$/i, 'bigint'],
  [/^(decimal|numeric|number|money|smallmoney)$/i, 'decimal'],
  [/^(real|float4)$/i, 'float'],
  [/^(double|float8|double precision|float)$/i, 'double'],
  [/^(char|character|nchar|bpchar)$/i, 'char'],
  [/^(varchar|varchar2|nvarchar|nvarchar2|character varying|string)$/i, 'varchar'],
  [/^(text|tinytext|mediumtext|longtext|clob|nclob|ntext)$/i, 'text'],
  [/^(blob|binary|varbinary|tinyblob|mediumblob|longblob|bytea|raw|image)$/i, 'binary'],
  [/^(date)$/i, 'date'],
  [/^(time|timetz|time with(out)? time zone)$/i, 'time'],
  [/^(datetime|datetime2|smalldatetime)$/i, 'datetime'],
  [/^(timestamp|timestamptz|timestamp with(out)? time zone)$/i, 'timestamp'],
  [/^(json|jsonb)$/i, 'json'],
  [/^(uuid|uniqueidentifier)$/i, 'uuid'],
  [/^(enum|set)$/i, 'enum'],
  [/^(geometry|geography|point|polygon)$/i, 'geometry'],
  [/^(array|\[\])$/i, 'array'],
];

/** 去掉长度/精度后缀：`varchar(255)` -> `varchar`。 */
export function baseTypeName(rawType: string): string {
  return rawType
    .trim()
    .replace(/\(.*\)$/, '')
    .replace(/\s+unsigned$/i, '')
    .replace(/\s+zerofill$/i, '')
    .trim();
}

export function normalizeTypeName(rawType: string): CanonicalType {
  const base = baseTypeName(rawType);
  for (const [re, canonical] of CANONICAL_PATTERNS) {
    if (re.test(base)) return canonical;
  }
  if (/\[\]$/.test(rawType.trim())) return 'array';
  return 'unknown';
}

/** 提取长度/精度信息，如 `varchar(255)` -> 255。 */
export function typeLength(rawType: string): { length: number | null; scale: number | null } {
  const m = /\((\d+)(?:\s*,\s*(\d+))?\)/.exec(rawType);
  if (!m) return { length: null, scale: null };
  return { length: Number(m[1]), scale: m[2] ? Number(m[2]) : null };
}

type TargetMap = Partial<Record<DatabaseType, string>>;

/** 归一化类型 -> 各目标库的具体类型。 */
const TARGET_TYPES: Record<Exclude<CanonicalType, 'unknown'>, TargetMap> = {
  boolean: { mysql: 'TINYINT(1)', mariadb: 'TINYINT(1)', postgresql: 'BOOLEAN', oracle: 'NUMBER(1)', sqlserver: 'BIT', sqlite: 'INTEGER', kingbase: 'BOOLEAN', dm: 'BIT', oceanbase: 'TINYINT(1)', tidb: 'TINYINT(1)', clickhouse: 'UInt8' },
  tinyint: { mysql: 'TINYINT', mariadb: 'TINYINT', postgresql: 'SMALLINT', oracle: 'NUMBER(3)', sqlserver: 'TINYINT', sqlite: 'INTEGER', kingbase: 'SMALLINT', dm: 'TINYINT', oceanbase: 'TINYINT', tidb: 'TINYINT', clickhouse: 'Int8' },
  smallint: { mysql: 'SMALLINT', mariadb: 'SMALLINT', postgresql: 'SMALLINT', oracle: 'NUMBER(5)', sqlserver: 'SMALLINT', sqlite: 'INTEGER', kingbase: 'SMALLINT', dm: 'SMALLINT', oceanbase: 'SMALLINT', tidb: 'SMALLINT', clickhouse: 'Int16' },
  int: { mysql: 'INT', mariadb: 'INT', postgresql: 'INTEGER', oracle: 'NUMBER(10)', sqlserver: 'INT', sqlite: 'INTEGER', kingbase: 'INTEGER', dm: 'INT', oceanbase: 'INT', tidb: 'INT', clickhouse: 'Int32' },
  bigint: { mysql: 'BIGINT', mariadb: 'BIGINT', postgresql: 'BIGINT', oracle: 'NUMBER(19)', sqlserver: 'BIGINT', sqlite: 'INTEGER', kingbase: 'BIGINT', dm: 'BIGINT', oceanbase: 'BIGINT', tidb: 'BIGINT', clickhouse: 'Int64' },
  decimal: { mysql: 'DECIMAL', mariadb: 'DECIMAL', postgresql: 'NUMERIC', oracle: 'NUMBER', sqlserver: 'DECIMAL', sqlite: 'NUMERIC', kingbase: 'NUMERIC', dm: 'DECIMAL', oceanbase: 'DECIMAL', tidb: 'DECIMAL', clickhouse: 'Decimal(18,4)' },
  float: { mysql: 'FLOAT', mariadb: 'FLOAT', postgresql: 'REAL', oracle: 'BINARY_FLOAT', sqlserver: 'REAL', sqlite: 'REAL', kingbase: 'REAL', dm: 'REAL', oceanbase: 'FLOAT', tidb: 'FLOAT', clickhouse: 'Float32' },
  double: { mysql: 'DOUBLE', mariadb: 'DOUBLE', postgresql: 'DOUBLE PRECISION', oracle: 'BINARY_DOUBLE', sqlserver: 'FLOAT', sqlite: 'REAL', kingbase: 'DOUBLE PRECISION', dm: 'DOUBLE', oceanbase: 'DOUBLE', tidb: 'DOUBLE', clickhouse: 'Float64' },
  char: { mysql: 'CHAR', mariadb: 'CHAR', postgresql: 'CHAR', oracle: 'CHAR', sqlserver: 'NCHAR', sqlite: 'TEXT', kingbase: 'CHAR', dm: 'CHAR', oceanbase: 'CHAR', tidb: 'CHAR', clickhouse: 'FixedString' },
  varchar: { mysql: 'VARCHAR', mariadb: 'VARCHAR', postgresql: 'VARCHAR', oracle: 'VARCHAR2', sqlserver: 'NVARCHAR', sqlite: 'TEXT', kingbase: 'VARCHAR', dm: 'VARCHAR', oceanbase: 'VARCHAR', tidb: 'VARCHAR', clickhouse: 'String' },
  text: { mysql: 'TEXT', mariadb: 'TEXT', postgresql: 'TEXT', oracle: 'CLOB', sqlserver: 'NVARCHAR(MAX)', sqlite: 'TEXT', kingbase: 'TEXT', dm: 'CLOB', oceanbase: 'TEXT', tidb: 'TEXT', clickhouse: 'String' },
  binary: { mysql: 'BLOB', mariadb: 'BLOB', postgresql: 'BYTEA', oracle: 'BLOB', sqlserver: 'VARBINARY(MAX)', sqlite: 'BLOB', kingbase: 'BYTEA', dm: 'BLOB', oceanbase: 'BLOB', tidb: 'BLOB', clickhouse: 'String' },
  date: { mysql: 'DATE', mariadb: 'DATE', postgresql: 'DATE', oracle: 'DATE', sqlserver: 'DATE', sqlite: 'TEXT', kingbase: 'DATE', dm: 'DATE', oceanbase: 'DATE', tidb: 'DATE', clickhouse: 'Date' },
  time: { mysql: 'TIME', mariadb: 'TIME', postgresql: 'TIME', oracle: 'VARCHAR2(8)', sqlserver: 'TIME', sqlite: 'TEXT', kingbase: 'TIME', dm: 'TIME', oceanbase: 'TIME', tidb: 'TIME', clickhouse: 'String' },
  datetime: { mysql: 'DATETIME', mariadb: 'DATETIME', postgresql: 'TIMESTAMP', oracle: 'TIMESTAMP', sqlserver: 'DATETIME2', sqlite: 'TEXT', kingbase: 'TIMESTAMP', dm: 'DATETIME', oceanbase: 'DATETIME', tidb: 'DATETIME', clickhouse: 'DateTime' },
  timestamp: { mysql: 'TIMESTAMP', mariadb: 'TIMESTAMP', postgresql: 'TIMESTAMPTZ', oracle: 'TIMESTAMP WITH TIME ZONE', sqlserver: 'DATETIMEOFFSET', sqlite: 'TEXT', kingbase: 'TIMESTAMPTZ', dm: 'TIMESTAMP', oceanbase: 'TIMESTAMP', tidb: 'TIMESTAMP', clickhouse: 'DateTime' },
  json: { mysql: 'JSON', mariadb: 'JSON', postgresql: 'JSONB', oracle: 'CLOB', sqlserver: 'NVARCHAR(MAX)', sqlite: 'TEXT', kingbase: 'JSONB', dm: 'CLOB', oceanbase: 'JSON', tidb: 'JSON', clickhouse: 'String' },
  uuid: { mysql: 'CHAR(36)', mariadb: 'CHAR(36)', postgresql: 'UUID', oracle: 'RAW(16)', sqlserver: 'UNIQUEIDENTIFIER', sqlite: 'TEXT', kingbase: 'UUID', dm: 'VARCHAR(36)', oceanbase: 'CHAR(36)', tidb: 'CHAR(36)', clickhouse: 'UUID' },
  enum: { mysql: 'VARCHAR(64)', mariadb: 'VARCHAR(64)', postgresql: 'VARCHAR(64)', oracle: 'VARCHAR2(64)', sqlserver: 'NVARCHAR(64)', sqlite: 'TEXT', kingbase: 'VARCHAR(64)', dm: 'VARCHAR(64)', oceanbase: 'VARCHAR(64)', tidb: 'VARCHAR(64)', clickhouse: 'String' },
  geometry: { mysql: 'GEOMETRY', mariadb: 'GEOMETRY', postgresql: 'GEOMETRY', oracle: 'SDO_GEOMETRY', sqlserver: 'GEOGRAPHY', sqlite: 'BLOB', kingbase: 'GEOMETRY', dm: 'BLOB', oceanbase: 'GEOMETRY', tidb: 'GEOMETRY', clickhouse: 'String' },
  array: { mysql: 'JSON', mariadb: 'JSON', postgresql: 'TEXT[]', oracle: 'CLOB', sqlserver: 'NVARCHAR(MAX)', sqlite: 'TEXT', kingbase: 'TEXT[]', dm: 'CLOB', oceanbase: 'JSON', tidb: 'JSON', clickhouse: 'Array(String)' },
};

/** 这些映射是"有损"的：目标类型无法完整表达源类型语义。 */
const LOSSY_NOTES: Partial<Record<CanonicalType, string>> = {
  json: '目标库无原生 JSON 类型时降级为文本，将失去 JSON 函数与索引能力',
  enum: '目标库无枚举类型，降级为变长字符串，约束需由应用层保证',
  array: '目标库不支持数组类型，降级为文本/JSON 存储',
  uuid: '目标库无 UUID 类型，降级为定长字符串或二进制',
  geometry: '空间类型跨库映射通常不可靠，建议人工确认或跳过该列',
  timestamp: '时区语义可能丢失，建议统一按 UTC 存储',
  binary: '二进制大字段跨库迁移可能触发长度上限',
  decimal: '精度与标度需人工确认，避免静默截断',
  tinyint: '目标库无 tinyint 时上溯为更大整型',
};

export class BaseTypeMapper implements TypeMapper {
  /**
   * @param sourceDbType 本驱动所属的数据库类型。用于识别"同构迁移"：
   *   同一种数据库之间搬运数据是忠实复制，不应产生 lossy 警告，
   *   否则预检会在最安全的场景里报出满屏警告，反而让真正的风险被淹没。
   */
  constructor(private readonly sourceDbType?: DatabaseType) {}

  normalizeType(rawType: string): string {
    return normalizeTypeName(rawType);
  }

  mapType(sourceType: string, target: DatabaseType): { type: string; lossy: boolean; note?: string } {
    // 同构迁移：原样保留类型定义（含长度/精度），无任何损失
    if (this.sourceDbType !== undefined && this.sourceDbType === target) {
      return { type: sourceType, lossy: false };
    }

    const canonical = normalizeTypeName(sourceType);
    if (canonical === 'unknown') {
      return {
        type: 'TEXT',
        lossy: true,
        note: `无法识别源类型 "${sourceType}"，已降级为 TEXT，请人工确认`,
      };
    }
    const targetMap = TARGET_TYPES[canonical];
    const mapped = targetMap[target];
    if (!mapped) {
      return {
        type: 'TEXT',
        lossy: true,
        note: `目标库 ${target} 暂无 ${canonical} 的映射规则，已降级为 TEXT`,
      };
    }
    const { length, scale } = typeLength(sourceType);
    let type = mapped;
    // 长度可继承时继承，保证 varchar(255) 迁移后仍是 varchar(255) 而不是默认长度
    if (length !== null && /^(VARCHAR|CHAR|NVARCHAR|NCHAR|VARCHAR2|DECIMAL|NUMERIC|FixedString)$/i.test(mapped)) {
      type = scale === null ? `${mapped}(${length})` : `${mapped}(${length},${scale})`;
    }
    const note = LOSSY_NOTES[canonical];
    return note ? { type, lossy: true, note } : { type, lossy: false };
  }
}

export const typeMapper = new BaseTypeMapper();
