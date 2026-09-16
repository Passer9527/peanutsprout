/**
 * 花生苗数据库管理工具 - 表数据编辑页纯逻辑测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 本机没有任何 DOM 实现（无 jsdom / happy-dom），所以这里**不渲染组件**，
 * 只测从 TableDataPage.tsx 导出的纯函数。被盯住的正是最容易出数据事故的语义：
 *  · 定位键必须取自**原始值**（用编辑后的值去 UPDATE 会打不中行）；
 *  · diff 必须只包含真正变化的列，且区分 null 与空串、数字与字符串；
 *  · 非空列被置 NULL 时必须能在写库**之前**拦下来；
 *  · 置 NULL 的哨兵文本不能误伤数据库里本来就是字符串 "NULL" 的格子。
 *
 * 为什么单列一个文件：这些规则用组件测试很难精确定位，而它们错了就是静默改错数据。
 */
import { describe, expect, it } from 'vitest';

import {
  buildInsertValues,
  buildRowChanges,
  buildRowKey,
  cellToDraft,
  cellValueFromInput,
  changedColumnIndexes,
  countUnsavedRows,
  dirtyCellIndexes,
  draftToValueArray,
  findRequiredViolation,
  isNumericType,
  isRowDirty,
  mergedRowValues,
  newGridRow,
  nextSort,
  rowToDraft,
  sameCellValue,
  serverRowToGridRow,
  type ColumnMeta,
  type GridRow,
  type RowOrigin,
} from './TableDataPage.js';
import type { CellValue } from '../api/types.js';

/** 极简列元信息工厂：只填纯逻辑真正读的字段。 */
const col = (
  name: string,
  dataType = 'text',
  nullable = true,
  defaultValue: string | null = null,
): ColumnMeta => ({ name, dataType, nullable, defaultValue });

const gridRow = (
  origin: RowOrigin,
  original: CellValue[] | null,
  draft: Array<string | null>,
): GridRow => ({ id: 'r1', origin, original, draft });

describe('cellValueFromInput：文本 → 带类型的 CellValue', () => {
  it('空串表示空字符串，而不是 NULL', () => {
    expect(cellValueFromInput('', 'old')).toBe('');
  });

  it('原样输入哨兵 NULL 表示 SQL NULL', () => {
    expect(cellValueFromInput('NULL', 'old')).toBeNull();
  });

  it('原始值是数字时，可解析文本转成 number', () => {
    const value = cellValueFromInput('42', 7);
    expect(value).toBe(42);
    expect(typeof value).toBe('number');
  });

  it('原始值是数字但文本无法解析时保留字符串（不猜、不静默丢弃）', () => {
    expect(cellValueFromInput('abc', 7)).toBe('abc');
  });

  it('新增行按列类型推断数字', () => {
    expect(cellValueFromInput('3.5', undefined, 'decimal(10,2)')).toBe(3.5);
  });

  it('新增行的文本列不做数字推断，原样保留字符串', () => {
    expect(cellValueFromInput('42', undefined, 'varchar(10)')).toBe('42');
  });

  it('布尔列只认小写 true / false，其它原样保留', () => {
    expect(cellValueFromInput('true', undefined, 'boolean')).toBe(true);
    expect(cellValueFromInput('false', undefined, 'boolean')).toBe(false);
    expect(cellValueFromInput('TRUE', undefined, 'boolean')).toBe('TRUE');
    expect(cellValueFromInput('yes', undefined, 'boolean')).toBe('yes');
  });

  it('纯空白文本不会被数字规则吞成 0', () => {
    expect(cellValueFromInput('   ', 3)).toBe('   ');
  });
});

describe('isNumericType：类型判定', () => {
  it('识别常见数字类型（含精度、unsigned、别名）', () => {
    expect(isNumericType('INT')).toBe(true);
    expect(isNumericType('bigint')).toBe(true);
    expect(isNumericType('DECIMAL(10,2)')).toBe(true);
    expect(isNumericType('double precision')).toBe(true);
    expect(isNumericType('unsigned bigint')).toBe(true);
  });

  it('不把名字里带 int/point 的非数字类型误判成数字', () => {
    expect(isNumericType('varchar(255)')).toBe(false);
    expect(isNumericType('interval')).toBe(false);
    expect(isNumericType('point')).toBe(false);
    expect(isNumericType(undefined)).toBe(false);
  });
});

describe('cellToDraft / rowToDraft：原始值 → 编辑草稿', () => {
  it('null 与"行里缺这一列"都变成 null 草稿', () => {
    expect(cellToDraft(null)).toBeNull();
    expect(cellToDraft(undefined)).toBeNull();
  });

  it('布尔与数字保持可回读的文本形态', () => {
    expect(cellToDraft(true)).toBe('true');
    expect(cellToDraft(false)).toBe('false');
    expect(cellToDraft(0)).toBe('0');
    expect(cellToDraft('')).toBe('');
  });

  it('空表（没有列）得到空草稿数组', () => {
    expect(rowToDraft([], [])).toEqual([]);
  });
});

describe('buildRowKey：定位键必须来自原始值', () => {
  const columns = [col('id', 'integer', false), col('name')];

  it('用原始值而不是编辑后的值，且数字不被字符串化', () => {
    const row = { original: [7, 'old'] as CellValue[], draft: ['9', 'new'] };
    const key = buildRowKey(row, columns, ['id']);
    expect(key).toEqual({ id: 7 });
    expect(typeof key?.id).toBe('number');
  });

  it('原始值是 null 的键列原样保留 null（不是空串、也不丢键）', () => {
    const row = { original: [null, 'x'] as CellValue[], draft: ['', 'x'] };
    const key = buildRowKey(row, columns, ['id']);
    expect(key).not.toBeNull();
    expect(key).toEqual({ id: null });
    expect(Object.prototype.hasOwnProperty.call(key, 'id')).toBe(true);
  });

  it('复合定位键按 locator.columns 的顺序取全部列', () => {
    const composite = [col('tenant'), col('id', 'integer'), col('name')];
    const row = { original: ['acme', 42, 'x'] as CellValue[], draft: ['other', '43', 'x'] };
    expect(buildRowKey(row, composite, ['tenant', 'id'])).toEqual({ tenant: 'acme', id: 42 });
  });

  it('行比 columns 短、缺少参与定位的列时返回 null（宁可拒绝写入）', () => {
    const row = { original: ['only-id'] as CellValue[], draft: [null, 'x'] };
    expect(buildRowKey(row, columns, ['id', 'name'])).toBeNull();
  });

  it('定位列不在列元信息里时返回 null', () => {
    const row = { original: [1, 'x'] as CellValue[], draft: ['1', 'x'] };
    expect(buildRowKey(row, columns, ['missing'])).toBeNull();
  });

  it('没有定位列或还是本地新行时返回 null', () => {
    expect(buildRowKey({ original: [1, 'x'], draft: ['1', 'x'] }, columns, [])).toBeNull();
    expect(buildRowKey({ original: null, draft: ['1', 'x'] }, columns, ['id'])).toBeNull();
  });

  it('键值重复的两行会得到相同的键（本函数无法区分它们，这是服务端唯一约束的职责）', () => {
    const rowA = { original: [5, 'a'] as CellValue[], draft: ['5', 'a'] };
    const rowB = { original: [5, 'b'] as CellValue[], draft: ['5', 'b'] };
    expect(buildRowKey(rowA, columns, ['id'])).toEqual(buildRowKey(rowB, columns, ['id']));
  });
});

describe('buildRowChanges：只包含真正变化的列', () => {
  it('完全没改动的行得到空对象（no changes）', () => {
    const columns = [col('n', 'integer'), col('s'), col('t')];
    const changes = buildRowChanges([1, 'a', null], ['1', 'a', null], columns);
    expect(changes).toEqual({});
    expect(Object.keys(changes)).toHaveLength(0);
  });

  it('null ↔ 空串是真实变化，两个方向都要报出来', () => {
    expect(buildRowChanges([null], [''], [col('s')])).toEqual({ s: '' });
    expect(buildRowChanges([''], [null], [col('s')])).toEqual({ s: null });
  });

  it('输入哨兵 NULL 会把已有值改成 SQL NULL', () => {
    expect(buildRowChanges(['abc'], ['NULL'], [col('s')])).toEqual({ s: null });
  });

  it('字面量字符串 "NULL" 的格子没被动过时不算变化（哨兵不能误伤数据）', () => {
    expect(buildRowChanges(['NULL', 'NULL'], ['NULL', 'NULL'], [col('a'), col('b')])).toEqual({});
  });

  it('数字列的变化结果是 number，不是字符串', () => {
    const changes = buildRowChanges([1], ['2'], [col('n', 'integer')]);
    expect(changes).toEqual({ n: 2 });
    expect(typeof changes.n).toBe('number');
  });

  it('数值等价但写法不同的输入不产生变化（1 与 1.0 视作同一数字）', () => {
    expect(buildRowChanges([1], ['1.0'], [col('n', 'integer')])).toEqual({});
  });

  it('文本列即使内容像数字也保持字符串', () => {
    const changes = buildRowChanges(['1'], ['2'], [col('c', 'varchar(5)')]);
    expect(changes).toEqual({ c: '2' });
    expect(typeof changes.c).toBe('string');
  });

  it('数字 1 与字符串 "1" 不被视为同一个值', () => {
    expect(sameCellValue(1, '1')).toBe(false);
    expect(sameCellValue(1, 1)).toBe(true);
    expect(sameCellValue(null, '')).toBe(false);
    expect(sameCellValue(null, undefined)).toBe(true);
  });

  it('行比 columns 短：缺失的格子按 NULL 处理，没填就不算变化', () => {
    const columns = [col('a'), col('b')];
    expect(buildRowChanges(['a1'], ['a1', null], columns)).toEqual({});
    expect(buildRowChanges(['a1'], ['a1', 'x'], columns)).toEqual({ b: 'x' });
  });

  it('草稿比 columns 短：缺的格子按 NULL，会让原本有值的列变成 null', () => {
    expect(buildRowChanges(['a1', 'b1'], ['a1'], [col('a'), col('b')])).toEqual({ b: null });
  });

  it('多列里只报被改的那一列', () => {
    const columns = [col('n', 'integer'), col('x'), col('y')];
    expect(buildRowChanges([1, 'keep', 'edit'], ['1', 'keep', 'changed'], columns)).toEqual({
      y: 'changed',
    });
  });

  it('空表（没有列）diff 出空对象', () => {
    expect(buildRowChanges([], [], [])).toEqual({});
    expect(changedColumnIndexes(null, [], [])).toEqual([]);
  });
});

describe('isRowDirty / dirtyCellIndexes / countUnsavedRows', () => {
  const columns = [col('a'), col('b')];

  it('已有行没改动不算脏，改了一格就算脏', () => {
    expect(isRowDirty(gridRow('existing', ['x', 'y'], ['x', 'y']), columns)).toBe(false);
    expect(isRowDirty(gridRow('existing', ['x', 'y'], ['x', 'z']), columns)).toBe(true);
  });

  it('已有行把值清成空串也算脏', () => {
    expect(isRowDirty(gridRow('existing', [null, 'y'], ['', 'y']), columns)).toBe(true);
  });

  it('新行全空（没填过）不算脏，填了空串或哨兵就算脏', () => {
    expect(isRowDirty(gridRow('new', null, [null, null]), columns)).toBe(false);
    expect(isRowDirty(gridRow('new', null, ['', null]), columns)).toBe(true);
    expect(isRowDirty(gridRow('new', null, ['NULL', null]), columns)).toBe(true);
  });

  it('dirtyCellIndexes 只给出被改动/已填写过的下标', () => {
    expect(dirtyCellIndexes(gridRow('existing', ['a', 'b'], ['a', 'B']), columns)).toEqual([1]);
    expect(dirtyCellIndexes(gridRow('new', null, [null, 'x', '']), columns)).toEqual([1, 2]);
  });

  it('countUnsavedRows 统计整页未保存的行数（空页为 0）', () => {
    const rows = [
      gridRow('existing', ['x', 'y'], ['x', 'y']),
      gridRow('existing', ['x', 'y'], ['x', 'z']),
      gridRow('new', null, [null, null]),
      gridRow('new', null, ['v', null]),
    ];
    expect(countUnsavedRows(rows, columns)).toBe(2);
    expect(countUnsavedRows([], columns)).toBe(0);
  });
});

describe('findRequiredViolation：写库前拦下非空列的 NULL', () => {
  const columns = [col('id', 'integer', false), col('name', 'text', true)];

  it('非空列是 null 时报出列名', () => {
    expect(findRequiredViolation([null, 'x'], columns)).toEqual({ column: 'id' });
  });

  it('非空列有值、其它列可空时通过', () => {
    expect(findRequiredViolation([1, null], columns)).toBeNull();
  });

  it('空串是合法值，不算"该填没填"', () => {
    expect(findRequiredViolation([''], [col('name', 'text', false)])).toBeNull();
  });

  it('行里缺这一格（undefined）同样算违规', () => {
    expect(findRequiredViolation([undefined], [col('name', 'text', false)])).toEqual({
      column: 'name',
    });
  });

  it('有数据库默认值的非空列在新增行里留空不算错误，但已有行的显式 NULL 仍要拦', () => {
    const created = [col('created_at', 'text', false, 'now()')];
    expect(findRequiredViolation([null], created, { skipColumnsWithDefault: true })).toBeNull();
    expect(findRequiredViolation([null], created)).toEqual({ column: 'created_at' });
  });

  it('多列违规时报第一个违规列', () => {
    const both = [col('a', 'text', false), col('b', 'text', false)];
    expect(findRequiredViolation([null, null], both)).toEqual({ column: 'a' });
    expect(findRequiredViolation([null, null], [])).toBeNull();
  });
});

describe('buildInsertValues：只提交用户填过的列', () => {
  it('没动过的 NULL 草稿被省略，显式空串照常提交', () => {
    const columns = [col('id', 'integer'), col('name'), col('note')];
    const values = buildInsertValues([null, 'bob', ''], columns);
    expect(values).toEqual({ name: 'bob', note: '' });
    expect(Object.prototype.hasOwnProperty.call(values, 'id')).toBe(false);
  });

  it('显式输入哨兵 NULL 的列会带上 null（与"省略"不同）', () => {
    const values = buildInsertValues(['NULL'], [col('name')]);
    expect(Object.prototype.hasOwnProperty.call(values, 'name')).toBe(true);
    expect(values).toEqual({ name: null });
  });

  it('按列类型把数字文本转成 number', () => {
    const values = buildInsertValues(['42'], [col('n', 'integer')]);
    expect(values).toEqual({ n: 42 });
    expect(typeof values.n).toBe('number');
  });

  it('没有列的新行得到空对象', () => {
    expect(buildInsertValues([], [])).toEqual({});
  });
});

describe('draftToValueArray：草稿 → 与 columns 同序的完整一行', () => {
  it('按原始值的类型解释用户输入，null 保持 null', () => {
    const columns = [col('n', 'integer'), col('s')];
    expect(draftToValueArray(['42', null], columns, [7, 'old'])).toEqual([42, null]);
  });
});

describe('mergedRowValues：已有行校验用整行值', () => {
  it('没改动的列直接用原始值，字面量字符串 "NULL" 不会被误判成非空违规', () => {
    const columns = [col('s', 'text', false), col('t')];
    const values = mergedRowValues(['NULL', 'keep'], ['NULL', 'changed'], columns);
    expect(values).toEqual(['NULL', 'changed']);
    expect(findRequiredViolation(values, columns)).toBeNull();
  });

  it('改动过的列用转换后的新值，置 NULL 会触发非空违规', () => {
    const columns = [col('s', 'text', false)];
    const values = mergedRowValues(['x'], ['NULL'], columns);
    expect(values).toEqual([null]);
    expect(findRequiredViolation(values, columns)).toEqual({ column: 's' });
  });

  it('没有原始值（新行）时未填的列取 null', () => {
    expect(mergedRowValues(null, [null, 'a'], [col('a'), col('b')])).toEqual([null, 'a']);
  });
});

describe('nextSort：列头排序切换', () => {
  it('换一列从升序开始，同一列在升/降之间切换', () => {
    expect(nextSort({ orderBy: null, orderDir: 'asc' }, 'a')).toEqual({
      orderBy: 'a',
      orderDir: 'asc',
    });
    expect(nextSort({ orderBy: 'a', orderDir: 'asc' }, 'a')).toEqual({
      orderBy: 'a',
      orderDir: 'desc',
    });
    expect(nextSort({ orderBy: 'a', orderDir: 'desc' }, 'a')).toEqual({
      orderBy: 'a',
      orderDir: 'asc',
    });
    expect(nextSort({ orderBy: 'a', orderDir: 'asc' }, 'b')).toEqual({
      orderBy: 'b',
      orderDir: 'asc',
    });
  });
});

describe('行构造：服务端行与本地新行', () => {
  it('服务端行保留原始值副本，草稿与原始值对应', () => {
    const columns = [col('id', 'integer'), col('name')];
    const row = serverRowToGridRow([1, 'a'], columns, 'r1');
    expect(row.origin).toBe('existing');
    expect(row.original).toEqual([1, 'a']);
    expect(row.draft).toEqual(['1', 'a']);
    expect(isRowDirty(row, columns)).toBe(false);
  });

  it('新行草稿全为 null，且不会立刻算作未保存修改', () => {
    const columns = [col('id', 'integer'), col('name')];
    const row = newGridRow(columns, 'r2');
    expect(row.origin).toBe('new');
    expect(row.original).toBeNull();
    expect(row.draft).toEqual([null, null]);
    expect(isRowDirty(row, columns)).toBe(false);
  });
});
