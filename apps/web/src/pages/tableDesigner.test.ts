/**
 * 花生苗数据库管理工具 - 可视化建库建表页纯逻辑测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 本机没有任何 DOM 实现（无 jsdom / happy-dom），因此这里只测从
 * `TableDesignerPage.tsx` 导出的纯函数：校验、归一化、预览指纹、新列命名、重排。
 * 其中**预览指纹**是安全属性（"预览必须对应当前表单"）的基石，所以测得最密。
 */
import { describe, expect, it } from 'vitest';

import type { ColumnTypeDTO } from '../api/types.js';
import {
  emptyColumn,
  isValidIdentifier,
  moveItem,
  nextColumnName,
  normalizeSpec,
  specFingerprint,
  typeHasLength,
  validateSpec,
  type DesignerColumn,
  type DesignerSpec,
} from './TableDesignerPage.js';

/** 类型元信息：TEXT / INTEGER 不需要长度，VARCHAR / DECIMAL 需要。 */
const TYPES: ColumnTypeDTO[] = [
  { name: 'INTEGER', category: 'number', hasLength: false },
  { name: 'VARCHAR', category: 'string', hasLength: true },
  { name: 'TEXT', category: 'string', hasLength: false },
  { name: 'DECIMAL', category: 'number', hasLength: true },
];

function column(partial: Partial<DesignerColumn>): DesignerColumn {
  return { ...emptyColumn('VARCHAR'), ...partial };
}

/** 一份完全合法的表单快照；各用例只改动自己关心的那一处。 */
function baseSpec(): DesignerSpec {
  return {
    connectionId: 1,
    schema: 'public',
    table: 'orders',
    columns: [
      column({ name: 'id', dataType: 'INTEGER', primaryKey: true, nullable: false }),
      column({ name: 'amount', dataType: 'DECIMAL', length: '10', nullable: true }),
    ],
    indexes: [],
    ifNotExists: false,
  };
}

const issueKeys = (spec: DesignerSpec): string[] => validateSpec(spec).map((issue) => issue.key);

/* ------------------------------------------------------------------ validateSpec */

describe('validateSpec：客户端校验（预览之前先拦住）', () => {
  it('合法表单返回空问题列表', () => {
    expect(validateSpec(baseSpec())).toEqual([]);
  });

  it('没有选择连接时报 errNoConnection', () => {
    expect(issueKeys({ ...baseSpec(), connectionId: null })).toEqual(['designer.errNoConnection']);
  });

  it('表名为空（含纯空格）时报 errNoTableName', () => {
    expect(issueKeys({ ...baseSpec(), table: '   ' })).toEqual(['designer.errNoTableName']);
  });

  it('一列都没有时报 errNoColumns', () => {
    expect(issueKeys({ ...baseSpec(), columns: [] })).toEqual(['designer.errNoColumns']);
  });

  it('有列但列名为空时报 errEmptyColumnName', () => {
    const spec = baseSpec();
    spec.columns[1] = column({ name: '  ' });
    expect(issueKeys(spec)).toEqual(['designer.errEmptyColumnName']);
  });

  it('多个空列名只报一条 errEmptyColumnName（同一句话不刷屏）', () => {
    const spec = baseSpec();
    spec.columns = [column({ name: '' }), column({ name: ' ' }), column({ name: 'ok' })];
    expect(issueKeys(spec)).toEqual(['designer.errEmptyColumnName']);
  });

  it('列名重复时带出重复的那个名字', () => {
    const spec = baseSpec();
    spec.columns[1] = column({ name: 'amount' });
    spec.columns.push(column({ name: 'amount' }));
    const issues = validateSpec(spec);
    expect(issues.map((issue) => issue.key)).toEqual(['designer.errDuplicateColumn']);
    expect(issues[0].values).toEqual({ name: 'amount' });
  });

  it('列名重复判定大小写不敏感（Id 与 id 是同一列）', () => {
    const spec = baseSpec();
    spec.columns[0] = column({ name: 'id' });
    spec.columns[1] = column({ name: 'ID' });
    const issues = validateSpec(spec);
    expect(issues.map((issue) => issue.key)).toEqual(['designer.errDuplicateColumn']);
    expect(issues[0].values).toEqual({ name: 'ID' });
  });

  it('索引名重复时报 errDuplicateIndex 并带出名字', () => {
    const spec = baseSpec();
    spec.indexes = [
      { name: 'idx_amount', columns: ['amount'], unique: false },
      { name: 'idx_amount', columns: ['id'], unique: true },
    ];
    const issues = validateSpec(spec);
    expect(issues.map((issue) => issue.key)).toEqual(['designer.errDuplicateIndex']);
    expect(issues[0].values).toEqual({ name: 'idx_amount' });
  });

  it('索引没有选任何列时报 errIndexNoColumns 并带出名字', () => {
    const spec = baseSpec();
    spec.indexes = [{ name: 'idx_amount', columns: [], unique: false }];
    const issues = validateSpec(spec);
    expect(issues.map((issue) => issue.key)).toEqual(['designer.errIndexNoColumns']);
    expect(issues[0].values).toEqual({ name: 'idx_amount' });
  });

  it('索引的"列"全是空白字符串时同样算没选列', () => {
    const spec = baseSpec();
    spec.indexes = [{ name: 'idx_amount', columns: ['   '], unique: false }];
    expect(issueKeys(spec)).toEqual(['designer.errIndexNoColumns']);
  });

  it('表名不合法时报 errInvalidName', () => {
    expect(issueKeys({ ...baseSpec(), table: '1orders' })).toEqual(['designer.errInvalidName']);
  });

  it('列名不合法时报 errInvalidName', () => {
    const spec = baseSpec();
    spec.columns[1] = column({ name: 'amount total' });
    expect(issueKeys(spec)).toEqual(['designer.errInvalidName']);
  });

  it('索引名不合法时报 errInvalidName', () => {
    const spec = baseSpec();
    spec.indexes = [{ name: 'idx-amount', columns: ['amount'], unique: false }];
    expect(issueKeys(spec)).toEqual(['designer.errInvalidName']);
  });

  it('schema 非空但不合法时报 errInvalidName', () => {
    expect(issueKeys({ ...baseSpec(), schema: 'my schema' })).toEqual(['designer.errInvalidName']);
  });

  it('schema 允许为空（SQLite 这类没有 schema 概念的库）', () => {
    expect(validateSpec({ ...baseSpec(), schema: '' })).toEqual([]);
  });

  it('多处非法标识符只报一条 errInvalidName', () => {
    const spec = baseSpec();
    spec.table = '1orders';
    spec.columns[1] = column({ name: 'bad name' });
    spec.indexes = [{ name: 'bad-index', columns: ['id'], unique: false }];
    expect(issueKeys(spec).filter((key) => key === 'designer.errInvalidName')).toHaveLength(1);
  });

  it('一次把所有问题都报出来，而不是遇到第一个就停', () => {
    const spec = baseSpec();
    spec.table = '';
    spec.columns = [];
    expect(issueKeys(spec)).toEqual(['designer.errNoTableName', 'designer.errNoColumns']);
  });

  it('没有连接的多个问题可同时出现（连接错误排在最前）', () => {
    const spec = baseSpec();
    spec.connectionId = null;
    spec.table = '';
    expect(issueKeys(spec)).toEqual([
      'designer.errNoConnection',
      'designer.errNoTableName',
    ]);
  });
});

/* ------------------------------------------------------------------ normalizeSpec */

describe('normalizeSpec：派生不变量与空值归一', () => {
  it('主键列强制 nullable=false（即使表单里是可空）', () => {
    const spec = baseSpec();
    spec.columns[0] = column({ name: 'id', dataType: 'INTEGER', primaryKey: true, nullable: true });
    const out = normalizeSpec(spec, TYPES);
    expect(out.columns[0].nullable).toBe(false);
  });

  it('非主键列保留表单里的 nullable', () => {
    const spec = baseSpec();
    spec.columns[1] = column({ name: 'amount', dataType: 'DECIMAL', primaryKey: false, nullable: true });
    expect(normalizeSpec(spec, TYPES).columns[1].nullable).toBe(true);
  });

  it('类型不需要长度时把 length 丢成 null', () => {
    const spec = baseSpec();
    spec.columns[1] = column({ name: 'note', dataType: 'TEXT', length: '255' });
    expect(normalizeSpec(spec, TYPES).columns[1].length).toBeNull();
  });

  it('类型需要长度时把长度解析成数字', () => {
    const spec = baseSpec();
    spec.columns[1] = column({ name: 'amount', dataType: 'DECIMAL', length: ' 12 ' });
    expect(normalizeSpec(spec, TYPES).columns[1].length).toBe(12);
  });

  it('长度为空 / 非数字 / 0 / 负数都归一成 null', () => {
    const spec = baseSpec();
    spec.columns = [
      column({ name: 'a', dataType: 'VARCHAR', length: '   ' }),
      column({ name: 'b', dataType: 'VARCHAR', length: 'abc' }),
      column({ name: 'c', dataType: 'VARCHAR', length: '0' }),
      column({ name: 'd', dataType: 'VARCHAR', length: '-5' }),
    ];
    const out = normalizeSpec(spec, TYPES);
    expect(out.columns.map((item) => item.length)).toEqual([null, null, null, null]);
  });

  it('元信息里查不到的类型不丢长度（元数据缺失时保守放行）', () => {
    const spec = baseSpec();
    spec.columns[1] = column({ name: 'payload', dataType: 'MYSTERY_TYPE', length: '7' });
    expect(normalizeSpec(spec, TYPES).columns[1].length).toBe(7);
  });

  it('表名 / schema / 列名 / 索引名都去掉首尾空格', () => {
    const spec = baseSpec();
    spec.table = ' orders ';
    spec.schema = ' public ';
    spec.columns[0] = column({ name: ' id ', dataType: 'INTEGER' });
    spec.indexes = [{ name: ' idx_id ', columns: [' id '], unique: false }];
    const out = normalizeSpec(spec, TYPES);
    expect(out.table).toBe('orders');
    expect(out.schema).toBe('public');
    expect(out.columns[0].name).toBe('id');
    expect(out.indexes[0].name).toBe('idx_id');
  });

  it('默认值 / 注释为空串或纯空格时归一成 null', () => {
    const spec = baseSpec();
    spec.columns[1] = column({ name: 'amount', dataType: 'DECIMAL', defaultValue: '   ', comment: '' });
    const out = normalizeSpec(spec, TYPES);
    expect(out.columns[1].defaultValue).toBeNull();
    expect(out.columns[1].comment).toBeNull();
  });

  it('非空的默认值 / 注释去空格后保留', () => {
    const spec = baseSpec();
    spec.columns[1] = column({
      name: 'amount',
      dataType: 'DECIMAL',
      defaultValue: ' 0 ',
      comment: ' 金额 ',
    });
    const out = normalizeSpec(spec, TYPES);
    expect(out.columns[1].defaultValue).toBe('0');
    expect(out.columns[1].comment).toBe('金额');
  });

  it('索引列去空格并丢掉空列名，unique 原样保留', () => {
    const spec = baseSpec();
    spec.indexes = [{ name: 'idx_a', columns: [' id ', '   ', 'amount'], unique: true }];
    const out = normalizeSpec(spec, TYPES);
    expect(out.indexes[0].columns).toEqual(['id', 'amount']);
    expect(out.indexes[0].unique).toBe(true);
  });

  it('connectionId 为 null 时归一成 0（校验会先拦下，这里只保证类型合法）', () => {
    expect(normalizeSpec({ ...baseSpec(), connectionId: null }, TYPES).connectionId).toBe(0);
  });

  it('ifNotExists 原样带到 spec', () => {
    expect(normalizeSpec({ ...baseSpec(), ifNotExists: true }, TYPES).ifNotExists).toBe(true);
    expect(normalizeSpec(baseSpec(), TYPES).ifNotExists).toBe(false);
  });
});

/* ------------------------------------------------------------------ specFingerprint */

describe('specFingerprint：预览新鲜度指纹（安全属性的基石）', () => {
  it('内容相同的两份表单指纹相同', () => {
    const a = baseSpec();
    const b = baseSpec();
    expect(specFingerprint(a)).toBe(specFingerprint(b));
  });

  it('对象字面量书写顺序不同不影响指纹', () => {
    const spec = baseSpec();
    const reordered: DesignerSpec = {
      ifNotExists: spec.ifNotExists,
      indexes: spec.indexes,
      columns: spec.columns,
      table: spec.table,
      schema: spec.schema,
      connectionId: spec.connectionId,
    };
    expect(specFingerprint(reordered)).toBe(specFingerprint(spec));
  });

  it('重新设置同一个值不算变化（不产生无谓的预览作废）', () => {
    const spec = baseSpec();
    const same = {
      ...spec,
      columns: spec.columns.map((item) => ({ ...item, name: item.name, dataType: item.dataType })),
      indexes: spec.indexes.map((item) => ({ ...item, columns: [...item.columns] })),
    };
    expect(specFingerprint(same)).toBe(specFingerprint(spec));
  });

  it('新增一列会改变指纹', () => {
    const spec = baseSpec();
    const changed = { ...spec, columns: [...spec.columns, column({ name: 'note' })] };
    expect(specFingerprint(changed)).not.toBe(specFingerprint(spec));
  });

  it('删掉一列会改变指纹', () => {
    const spec = baseSpec();
    const changed = { ...spec, columns: spec.columns.slice(0, 1) };
    expect(specFingerprint(changed)).not.toBe(specFingerprint(spec));
  });

  it('重命名列会改变指纹', () => {
    const spec = baseSpec();
    const changed = {
      ...spec,
      columns: spec.columns.map((item, index) => (index === 0 ? { ...item, name: 'order_id' } : item)),
    };
    expect(specFingerprint(changed)).not.toBe(specFingerprint(spec));
  });

  it('切换列的 nullable 会改变指纹', () => {
    const spec = baseSpec();
    const changed = {
      ...spec,
      columns: spec.columns.map((item, index) => (index === 1 ? { ...item, nullable: false } : item)),
    };
    expect(specFingerprint(changed)).not.toBe(specFingerprint(spec));
  });

  it('切换列的主键标记会改变指纹', () => {
    const spec = baseSpec();
    const changed = {
      ...spec,
      columns: spec.columns.map((item, index) => (index === 1 ? { ...item, primaryKey: true } : item)),
    };
    expect(specFingerprint(changed)).not.toBe(specFingerprint(spec));
  });

  it('改列类型会改变指纹', () => {
    const spec = baseSpec();
    const changed = {
      ...spec,
      columns: spec.columns.map((item, index) => (index === 1 ? { ...item, dataType: 'TEXT' } : item)),
    };
    expect(specFingerprint(changed)).not.toBe(specFingerprint(spec));
  });

  it('改列长度会改变指纹', () => {
    const spec = baseSpec();
    const changed = {
      ...spec,
      columns: spec.columns.map((item, index) => (index === 1 ? { ...item, length: '20' } : item)),
    };
    expect(specFingerprint(changed)).not.toBe(specFingerprint(spec));
  });

  it('改列默认值会改变指纹', () => {
    const spec = baseSpec();
    const changed = {
      ...spec,
      columns: spec.columns.map((item, index) =>
        index === 1 ? { ...item, defaultValue: '0' } : item,
      ),
    };
    expect(specFingerprint(changed)).not.toBe(specFingerprint(spec));
  });

  it('改列注释会改变指纹', () => {
    const spec = baseSpec();
    const changed = {
      ...spec,
      columns: spec.columns.map((item, index) => (index === 1 ? { ...item, comment: '金额' } : item)),
    };
    expect(specFingerprint(changed)).not.toBe(specFingerprint(spec));
  });

  it('列顺序变化会改变指纹（列顺序就是 DDL 里的顺序）', () => {
    const spec = baseSpec();
    const changed = { ...spec, columns: [spec.columns[1], spec.columns[0]] };
    expect(specFingerprint(changed)).not.toBe(specFingerprint(spec));
  });

  it('新增索引会改变指纹', () => {
    const spec = baseSpec();
    const changed = {
      ...spec,
      indexes: [{ name: 'idx_amount', columns: ['amount'], unique: false }],
    };
    expect(specFingerprint(changed)).not.toBe(specFingerprint(spec));
  });

  it('改索引包含列会改变指纹', () => {
    const spec = baseSpec();
    const before = { ...spec, indexes: [{ name: 'idx_a', columns: ['id'], unique: false }] };
    const after = { ...spec, indexes: [{ name: 'idx_a', columns: ['amount'], unique: false }] };
    expect(specFingerprint(after)).not.toBe(specFingerprint(before));
  });

  it('索引列顺序变化会改变指纹', () => {
    const spec = baseSpec();
    const before = { ...spec, indexes: [{ name: 'idx_a', columns: ['id', 'amount'], unique: false }] };
    const after = { ...spec, indexes: [{ name: 'idx_a', columns: ['amount', 'id'], unique: false }] };
    expect(specFingerprint(after)).not.toBe(specFingerprint(before));
  });

  it('切换索引唯一性会改变指纹', () => {
    const spec = baseSpec();
    const before = { ...spec, indexes: [{ name: 'idx_a', columns: ['id'], unique: false }] };
    const after = { ...spec, indexes: [{ name: 'idx_a', columns: ['id'], unique: true }] };
    expect(specFingerprint(after)).not.toBe(specFingerprint(before));
  });

  it('切换 IF NOT EXISTS 会改变指纹', () => {
    const spec = baseSpec();
    expect(specFingerprint({ ...spec, ifNotExists: true })).not.toBe(specFingerprint(spec));
  });

  it('换连接 / 改 schema / 改表名都会改变指纹', () => {
    const spec = baseSpec();
    const fingerprint = specFingerprint(spec);
    expect(specFingerprint({ ...spec, connectionId: 2 })).not.toBe(fingerprint);
    expect(specFingerprint({ ...spec, schema: 'analytics' })).not.toBe(fingerprint);
    expect(specFingerprint({ ...spec, table: 'orders_v2' })).not.toBe(fingerprint);
  });

  it('连接从有到无也会改变指纹（不会让旧预览在换连接后残留）', () => {
    const spec = baseSpec();
    expect(specFingerprint({ ...spec, connectionId: null })).not.toBe(specFingerprint(spec));
  });

  it('指纹只来自表单本身：改一处只影响这一处的指纹', () => {
    const spec = baseSpec();
    const withColumn = { ...spec, columns: [...spec.columns, column({ name: 'note' })] };
    const withIfNotExists = { ...spec, ifNotExists: true };
    expect(specFingerprint(withColumn)).not.toBe(specFingerprint(withIfNotExists));
  });
});

/* ------------------------------------------------------------------ nextColumnName */

describe('nextColumnName：新列默认名避开占用', () => {
  it('没有任何列时从 column_1 开始', () => {
    expect(nextColumnName([])).toBe('column_1');
  });

  it('column_1 被占用时给出 column_2', () => {
    expect(nextColumnName([{ name: 'column_1' }])).toBe('column_2');
  });

  it('跳过不连续的占用（column_1、column_3 已占，给出 column_2）', () => {
    expect(nextColumnName([{ name: 'column_1' }, { name: 'column_3' }])).toBe('column_2');
  });

  it('占用判定大小写不敏感且忽略首尾空格', () => {
    expect(nextColumnName([{ name: 'COLUMN_1' }, { name: ' Column_2 ' }])).toBe('column_3');
  });

  it('其他名字不影响默认名', () => {
    expect(nextColumnName([{ name: 'id' }, { name: 'amount' }])).toBe('column_1');
  });

  it('空列名不算占用', () => {
    expect(nextColumnName([{ name: '' }, { name: '   ' }])).toBe('column_1');
  });
});

/* ------------------------------------------------------------------ moveItem */

describe('moveItem：列表重排的边界处理', () => {
  it('第一项上移是空操作', () => {
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
  });

  it('最后一项下移是空操作', () => {
    expect(moveItem([1, 2, 3], 2, 3)).toEqual([1, 2, 3]);
  });

  it('from 越界是空操作', () => {
    expect(moveItem([1, 2, 3], 5, 0)).toEqual([1, 2, 3]);
  });

  it('to 越界是空操作', () => {
    expect(moveItem([1, 2, 3], 0, 5)).toEqual([1, 2, 3]);
  });

  it('负数下标是空操作', () => {
    expect(moveItem([1, 2, 3], -1, 0)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], 1, -2)).toEqual([1, 2, 3]);
  });

  it('非整数下标是空操作', () => {
    expect(moveItem([1, 2, 3], 1.5, 2)).toEqual([1, 2, 3]);
  });

  it('空列表永不崩', () => {
    expect(moveItem([], 0, 0)).toEqual([]);
  });

  it('原地移动返回等值拷贝', () => {
    expect(moveItem([1, 2, 3], 1, 1)).toEqual([1, 2, 3]);
  });

  it('中间项下移会真正换位', () => {
    expect(moveItem([1, 2, 3], 1, 2)).toEqual([1, 3, 2]);
  });

  it('末项移到最前', () => {
    expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
  });

  it('首项移到中间', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('不修改传入的数组', () => {
    const original = [1, 2, 3];
    const moved = moveItem(original, 0, 2);
    expect(original).toEqual([1, 2, 3]);
    expect(moved).toEqual([2, 3, 1]);
  });

  it('返回的永远是新的数组引用（React setState 才会重渲染）', () => {
    const original = [1, 2, 3];
    expect(moveItem(original, 0, 0)).not.toBe(original);
    expect(moveItem(original, 0, 2)).not.toBe(original);
  });
});

/* ------------------------------------------------------------------ 小工具 */

describe('isValidIdentifier：名字白名单', () => {
  it('字母 / 下划线开头，后接字母数字下划线都合法', () => {
    expect(isValidIdentifier('orders')).toBe(true);
    expect(isValidIdentifier('_tmp')).toBe(true);
    expect(isValidIdentifier('a1_b2')).toBe(true);
  });

  it('首尾空格会被忽略后再判断', () => {
    expect(isValidIdentifier('  orders  ')).toBe(true);
  });

  it('数字开头不合法', () => {
    expect(isValidIdentifier('1orders')).toBe(false);
  });

  it('空格 / 连字符 / 引号 / 空串不合法', () => {
    expect(isValidIdentifier('bad name')).toBe(false);
    expect(isValidIdentifier('bad-name')).toBe(false);
    expect(isValidIdentifier("o'brien")).toBe(false);
    expect(isValidIdentifier('')).toBe(false);
    expect(isValidIdentifier('   ')).toBe(false);
  });
});

describe('typeHasLength：类型元信息查询', () => {
  it('VARCHAR / DECIMAL 需要长度', () => {
    expect(typeHasLength(TYPES, 'VARCHAR')).toBe(true);
    expect(typeHasLength(TYPES, 'DECIMAL')).toBe(true);
  });

  it('TEXT / INTEGER 不需要长度', () => {
    expect(typeHasLength(TYPES, 'TEXT')).toBe(false);
    expect(typeHasLength(TYPES, 'INTEGER')).toBe(false);
  });

  it('查询大小写不敏感并忽略空格', () => {
    expect(typeHasLength(TYPES, ' varchar ')).toBe(true);
    expect(typeHasLength(TYPES, 'text')).toBe(false);
  });

  it('查不到的类型返回 true（元数据缺失时不悄悄丢长度）', () => {
    expect(typeHasLength(TYPES, 'MYSTERY')).toBe(true);
    expect(typeHasLength([], 'VARCHAR')).toBe(true);
  });
});
