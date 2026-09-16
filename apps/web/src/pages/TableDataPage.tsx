/**
 * 花生苗数据库管理工具 - 表数据编辑页（Excel 式增删改查）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 设计取舍（安全优先）：
 *  · **尊重定位符**。UPDATE / DELETE 必须能唯一定位一行：`locator.kind === 'none'`
 *    或 `editable === false` 时只允许查看与新增，绝不渲染复选框、绝不发更新/删除。
 *    没有定位符还让人点"保存"等于允许一次改到多行，是数据事故而不是排版问题。
 *  · **INSERT 不需要定位符**，因此即使表没有主键也允许新增（服务端仍会走写闸门）。
 *  · **未保存修改会被"跨页/换表/刷新"拦一下**：这些操作会丢掉草稿，必须先确认。
 *  · 单元格编辑草稿用**字符串**保存（`draft: (string | null)[]`），保存时才转成
 *    带类型的 `CellValue`。这样才能区分"用户什么都没动"和"用户把它改成了空串"。
 *
 * 置 NULL 的方式（需求 4 的选择，二选一里选了"输入哨兵文本"）：
 *  在单元格里**原样输入 `NULL`**（区分大小写）即表示 SQL NULL；输入空串表示**空字符串**。
 *  另外输入框在草稿为 NULL 时会把 `table.cellNull` 作为 placeholder 显示出来。
 *  已知边界：如果某个单元格本身存的就是字面量字符串 `"NULL"`，那么它不会被哨兵规则误伤
 *  （diff 先用"文本是否与原始显示形态一致"短路），但也无法再通过哨兵把它改成 SQL NULL ——
 *  这是刻意的取舍：宁可少一个冷门操作，也不能在一次保存里静默改写数据。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { describeError } from '../api/client';
import { connectionsApi, tableApi } from '../api/endpoints.js';
import type {
  CellValue,
  ColumnInfoDTO,
  ConnectionDTO,
  RowKey,
  TableDTO,
  TableRowsResponse,
} from '../api/types.js';
import { Button } from '../components/Button';
import { Icon } from '../components/Icons';
import { useI18n } from '../state/i18n.js';
import { useToast } from '../state/toast.js';
import type { ViewKey } from '../state/view.js';

/* ==================================================================== 纯逻辑
 * 下面这些函数不依赖 React / DOM，全部导出以便 tableData.test.ts 直接测。
 * 表格最容易出错的就是"定位键取自谁""diff 到底算了哪些列"这类语义，
 * 把它们从组件里拆出来是让测试真的能盯住行为，而不是只跑一遍渲染。
 * ==================================================================== */

/**
 * 纯逻辑只关心这几列元信息，因此用结构化子集而不是完整 ColumnInfoDTO，
 * 测试里可以只构造需要关心字段。
 */
export type ColumnMeta = Pick<ColumnInfoDTO, 'name' | 'dataType' | 'nullable' | 'defaultValue'>;

/** 输入这个文本（区分大小写）表示"置为 SQL NULL"。 */
export const NULL_SENTINEL = 'NULL';

/** 行来源：服务端读来的，还是界面上刚新增的。 */
export type RowOrigin = 'new' | 'existing';

/** 网格里的一行。`original` 为 null 表示这是尚未写入数据库的新行。 */
export interface GridRow {
  /** 前端生成的稳定 id（React key 与选中集合都用它） */
  id: string;
  origin: RowOrigin;
  /** 服务端返回的原始值（列顺序与 columns 一致）；新行为 null */
  original: CellValue[] | null;
  /** 编辑草稿：null 表示 NULL，字符串表示用户看到/输入的原样文本 */
  draft: Array<string | null>;
}

/** 常见数字类型名（去掉精度后比较）。 */
const NUMERIC_TYPE_NAMES = new Set([
  'int',
  'integer',
  'bigint',
  'smallint',
  'tinyint',
  'mediumint',
  'int2',
  'int4',
  'int8',
  'serial',
  'bigserial',
  'smallserial',
  'number',
  'numeric',
  'decimal',
  'dec',
  'fixed',
  'float',
  'float4',
  'float8',
  'real',
  'double',
  'double precision',
  'money',
]);

/** 去掉长度/精度与数组后缀，并归一化 "unsigned" 前缀。 */
function normalizeTypeName(dataType: string | undefined): string {
  const base = (dataType ?? '').toLowerCase().split('(')[0].trim().replace(/\[\]$/, '');
  return base.replace(/^unsigned\s+/, '');
}

/** 该列是否需要按数字解析用户输入。 */
export function isNumericType(dataType: string | undefined): boolean {
  return NUMERIC_TYPE_NAMES.has(normalizeTypeName(dataType));
}

/** 该列是否需要按布尔解析用户输入。 */
export function isBooleanType(dataType: string | undefined): boolean {
  const base = normalizeTypeName(dataType);
  return base === 'bool' || base === 'boolean';
}

/**
 * 把单元格的显示值转成编辑草稿文本。
 *  · null / 行里缺这一列（undefined）→ 草稿 null（界面显示 NULL placeholder）
 *  · boolean → 'true' / 'false'
 *  · 其它 → String(value)；数字**不做四舍五入或补零**，保持原样
 */
export function cellToDraft(value: CellValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/** 把一整行原始值转成草稿数组。 */
export function rowToDraft(
  values: CellValue[] | null,
  columns: ColumnMeta[],
): Array<string | null> {
  return columns.map((_column, index) => cellToDraft(values ? values[index] : undefined));
}

/**
 * 把输入框文本转成带类型的 CellValue。
 *
 * 规则（刻意保守，宁可交给数据库报错也不猜）：
 *  1. 文本恰好是 `NULL` → SQL NULL；
 *  2. 空串 → **空字符串**（不是 NULL，需求 4 明确要求）；
 *  3. 布尔列 / 原始值是布尔：只认 'true' / 'false'，其它原样保留为字符串；
 *  4. 原始值是数字，或该列类型是数字：文本是有限数字则转 number，否则**保留字符串**
 *     （不猜、不截断；服务端/数据库要么接受要么明确报错）；
 *  5. 其余一律原样字符串。
 */
export function cellValueFromInput(
  text: string,
  original: CellValue | undefined,
  dataType?: string,
): CellValue {
  if (text === NULL_SENTINEL) return null;
  if (typeof original === 'boolean' || isBooleanType(dataType)) {
    if (text === 'true') return true;
    if (text === 'false') return false;
    return text;
  }
  const numeric = typeof original === 'number' || (original === undefined && isNumericType(dataType));
  if (numeric && text.trim() !== '') {
    const parsed = Number(text);
    if (Number.isFinite(parsed)) return parsed;
  }
  return text;
}

/**
 * 两个单元格值是否相同。
 * 规则：先按"行里缺这一列"归一成 null，再比较；`null` 与 `''` 不同，
 * 类型也必须一致（数字 1 与字符串 '1' **不同**）——避免把用户的类型改动悄悄吃掉。
 */
export function sameCellValue(a: CellValue | undefined, b: CellValue | undefined): boolean {
  const left = a === undefined ? null : a;
  const right = b === undefined ? null : b;
  if (left === null || right === null) return left === right;
  return typeof left === typeof right && left === right;
}

/**
 * 逐列比较草稿与原始值，返回**真正发生变化**的列下标。
 *
 * 「列在 columns 里但这一行没这一格」（原始数组比 columns 短）按 NULL 处理；
 * 「草稿比 columns 短」同样按 NULL 处理。
 * 文本与原始显示形态一致时直接短路：既省一次转换，也避免字面量字符串 "NULL"
 * 被哨兵规则误判成"要置空"。
 */
export function changedColumnIndexes(
  original: CellValue[] | null,
  draft: Array<string | null>,
  columns: ColumnMeta[],
): number[] {
  const indexes: number[] = [];
  columns.forEach((column, index) => {
    const originalValue: CellValue | undefined = original ? original[index] : undefined;
    const text = draft[index] ?? null;
    if (text === cellToDraft(originalValue)) return;
    const next = text === null ? null : cellValueFromInput(text, originalValue, column.dataType);
    if (!sameCellValue(originalValue, next)) indexes.push(index);
  });
  return indexes;
}

/** 生成 UPDATE 的 `changes`：只包含真正变化的列。 */
export function buildRowChanges(
  original: CellValue[] | null,
  draft: Array<string | null>,
  columns: ColumnMeta[],
): Record<string, CellValue> {
  const changes: Record<string, CellValue> = {};
  for (const index of changedColumnIndexes(original, draft, columns)) {
    const column = columns[index];
    if (!column) continue;
    const originalValue: CellValue | undefined = original ? original[index] : undefined;
    const text = draft[index] ?? null;
    changes[column.name] =
      text === null ? null : cellValueFromInput(text, originalValue, column.dataType);
  }
  return changes;
}

/**
 * 该行是否有未保存的修改。
 *  · 新行：只要有任意一格不是 NULL 草稿（包括显式空串）就算有内容；
 *  · 已有行：diff 出至少一列变化才算。
 */
export function isRowDirty(row: GridRow, columns: ColumnMeta[]): boolean {
  if (row.origin === 'new') return row.draft.some((text) => text !== null);
  return changedColumnIndexes(row.original, row.draft, columns).length > 0;
}

/** 该行里被改动过的单元格下标（用于 is-dirty 高亮）。 */
export function dirtyCellIndexes(row: GridRow, columns: ColumnMeta[]): number[] {
  if (row.origin === 'new') {
    const indexes: number[] = [];
    row.draft.forEach((text, index) => {
      if (text !== null) indexes.push(index);
    });
    return indexes;
  }
  return changedColumnIndexes(row.original, row.draft, columns);
}

/** 当前页未保存的修改条数（按行计）。 */
export function countUnsavedRows(rows: GridRow[], columns: ColumnMeta[]): number {
  return rows.filter((row) => isRowDirty(row, columns)).length;
}

/**
 * 由**原始值**构造 UPDATE / DELETE 的定位键。
 *
 * 关键点：绝不读取草稿（草稿是用户改过的值，用它定位会找不到行、甚至改错行）；
 * 数字保持 number，`null` 原样保留。任一参与定位的列不在元信息里、或这一行缺该列
 * （行比 columns 短）时返回 null —— 宁可拒绝这次写入，也不构造一个不完整的键。
 * 复合键若在数据里重复（没有唯一约束的表/视图），本函数无能为力：返回的键相同，
 * 服务端会拒绝或一次改到多行，这正是 `locator` 只认主键/唯一索引的原因。
 */
export function buildRowKey(
  row: Pick<GridRow, 'original' | 'draft'>,
  columns: ColumnMeta[],
  locatorColumns: string[],
): RowKey | null {
  if (row.original === null || locatorColumns.length === 0) return null;
  const key: RowKey = {};
  for (const name of locatorColumns) {
    const index = columns.findIndex((column) => column.name === name);
    if (index < 0 || index >= row.original.length) return null;
    key[name] = row.original[index] ?? null;
  }
  return key;
}

/**
 * 校验"非空列被置成 NULL"。
 * `values` 与 `columns` 同序（调用方先把草稿转成完整一行）。
 * `skipColumnsWithDefault` 用于新行：有数据库默认值的列留空不该算错误（不提交即可）。
 * 返回第一个违规列，没问题返回 null。
 */
export function findRequiredViolation(
  values: Array<CellValue | undefined>,
  columns: Array<Pick<ColumnMeta, 'name' | 'nullable' | 'defaultValue'>>,
  options: { skipColumnsWithDefault?: boolean } = {},
): { column: string } | null {
  for (let index = 0; index < columns.length; index += 1) {
    const column = columns[index];
    if (!column || column.nullable) continue;
    if (options.skipColumnsWithDefault === true && column.defaultValue !== null) continue;
    const value = values[index];
    if (value === null || value === undefined) return { column: column.name };
  }
  return null;
}

/** 把草稿数组转成与 columns 同序的 CellValue 数组（null 保留为 null）。 */
export function draftToValueArray(
  draft: Array<string | null>,
  columns: ColumnMeta[],
  original: CellValue[] | null = null,
): Array<CellValue | undefined> {
  return columns.map((column, index) => {
    const text = draft[index] ?? null;
    if (text === null) return null;
    return cellValueFromInput(text, original ? original[index] : undefined, column.dataType);
  });
}

/**
 * 校验已有行的非空约束时用的"整行值"：改过的列取转换后的新值，
 * **没改的列直接用原始值**，而不是把草稿文本再转换一遍。
 * 后者会把原始值里的字面量字符串 "NULL" 重新解释成 SQL NULL，
 * 导致"我根本没动那一格，保存却被拦下"。
 */
export function mergedRowValues(
  original: CellValue[] | null,
  draft: Array<string | null>,
  columns: ColumnMeta[],
): Array<CellValue | undefined> {
  const changes = buildRowChanges(original, draft, columns);
  return columns.map((column, index) => {
    if (Object.prototype.hasOwnProperty.call(changes, column.name)) return changes[column.name];
    return original ? original[index] : null;
  });
}

/**
 * 生成 INSERT 的 values：**只提交用户填过的列**。
 * 草稿为 null（没动过）的列直接省略，交给数据库默认值 / 自增；
 * 显式输入 `NULL` 的列会带上 `null`；显式空串会带上 `''`。
 */
export function buildInsertValues(
  draft: Array<string | null>,
  columns: ColumnMeta[],
): Record<string, CellValue> {
  const values: Record<string, CellValue> = {};
  columns.forEach((column, index) => {
    const text = draft[index] ?? null;
    if (text === null) return;
    values[column.name] = cellValueFromInput(text, undefined, column.dataType);
  });
  return values;
}

/** 排序状态；点列头时在 asc / desc 之间切换。 */
export interface SortState {
  orderBy: string | null;
  orderDir: 'asc' | 'desc';
}

/** 点列头：换列 → 升序；同一列 → 切换方向。 */
export function nextSort(current: SortState, column: string): SortState {
  if (current.orderBy !== column) return { orderBy: column, orderDir: 'asc' };
  return { orderBy: column, orderDir: current.orderDir === 'asc' ? 'desc' : 'asc' };
}

/** 服务端一行 → 网格行。 */
export function serverRowToGridRow(
  values: CellValue[],
  columns: ColumnMeta[],
  id: string,
): GridRow {
  return { id, origin: 'existing', original: [...values], draft: rowToDraft(values, columns) };
}

/** 新增一个空行（草稿全 NULL，保存时只提交填过的列）。 */
export function newGridRow(columns: ColumnMeta[], id: string): GridRow {
  return { id, origin: 'new', original: null, draft: columns.map(() => null) };
}

/* ==================================================================== 组件 */

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

export function TableDataPage({ onNavigate }: { onNavigate: (view: ViewKey) => void }) {
  const { t, localizeError } = useI18n();
  const toast = useToast();

  const [connections, setConnections] = useState<ConnectionDTO[]>([]);
  const [connectionId, setConnectionId] = useState<number | null>(null);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [schema, setSchema] = useState('');
  const [tables, setTables] = useState<TableDTO[]>([]);
  const [tableName, setTableName] = useState('');

  const [data, setData] = useState<TableRowsResponse | null>(null);
  const [rows, setRows] = useState<GridRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [sort, setSort] = useState<SortState>({ orderBy: null, orderDir: 'asc' });

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 自上次保存以来已删除的行数，用于保存提示里的 {deleted} */
  const [deletedSinceSave, setDeletedSinceSave] = useState(0);

  /** 在途请求代次：换表 / 翻页后旧响应必须作废，否则会把旧表数据填进新表 */
  const requestSeq = useRef(0);
  const rowSeq = useRef(0);

  const formatError = useCallback(
    (error: unknown): string => describeError(error, { t, localizeError }),
    [t, localizeError],
  );

  const makeRowId = useCallback((): string => {
    rowSeq.current += 1;
    return `row-${rowSeq.current}`;
  }, []);

  const columns = useMemo<ColumnMeta[]>(() => data?.columns ?? [], [data]);
  const readOnly = data !== null && (!data.editable || data.locator.kind === 'none');
  const unsavedCount = useMemo(() => countUnsavedRows(rows, columns), [rows, columns]);
  const dirtyMap = useMemo(() => {
    const map = new Map<string, Set<number>>();
    for (const row of rows) map.set(row.id, new Set(dirtyCellIndexes(row, columns)));
    return map;
  }, [rows, columns]);

  /* ---------------------------------------------------------- 数据加载 */

  useEffect(() => {
    let cancelled = false;
    connectionsApi
      .list()
      .then((response) => {
        if (!cancelled) setConnections(response.items);
      })
      .catch((error: unknown) => {
        if (!cancelled) toast.error(t('table.errLoad', { values: { message: formatError(error) } }));
      });
    return () => {
      cancelled = true;
    };
    // toast 的实现是稳定的 useMemo 值，这里只需在语言变化时重跑
  }, [t, formatError, toast]);

  // 连接变化 → 拉 schema 列表，并默认选中第一个
  useEffect(() => {
    if (connectionId === null) {
      setSchemas([]);
      setSchema('');
      return;
    }
    let cancelled = false;
    connectionsApi
      .schemas(connectionId)
      .then((response) => {
        if (cancelled) return;
        const names = response.items.map((item) => item.name);
        setSchemas(names);
        setSchema(names[0] ?? '');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSchemas([]);
        setSchema('');
        toast.error(t('table.errLoad', { values: { message: formatError(error) } }));
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, t, formatError, toast]);

  // schema 变化 → 拉表列表
  useEffect(() => {
    if (connectionId === null || schema === '') {
      setTables([]);
      return;
    }
    let cancelled = false;
    connectionsApi
      .tables(connectionId, schema)
      .then((response) => {
        if (!cancelled) setTables(response.items);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setTables([]);
          toast.error(t('table.errLoad', { values: { message: formatError(error) } }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, schema, t, formatError, toast]);

  const loadRows = useCallback(async (): Promise<void> => {
    if (connectionId === null || schema === '' || tableName === '') return;
    requestSeq.current += 1;
    const seq = requestSeq.current;
    setLoading(true);
    setLoadError(null);
    try {
      const response = await tableApi.rows({
        connectionId,
        schema,
        table: tableName,
        page,
        pageSize,
        orderBy: sort.orderBy,
        orderDir: sort.orderDir,
      });
      if (seq !== requestSeq.current) return;
      setData(response);
      setRows(
        response.rows.map((values) => serverRowToGridRow(values, response.columns, makeRowId())),
      );
      setSelectedIds(new Set());
    } catch (error: unknown) {
      if (seq !== requestSeq.current) return;
      setData(null);
      setRows([]);
      setSelectedIds(new Set());
      setLoadError(formatError(error));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [connectionId, schema, tableName, page, pageSize, sort, makeRowId, formatError]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  /* ---------------------------------------------------------- 未保存拦截 */

  /** 会丢弃草稿的动作前先问一句；用户点取消就什么都不做。 */
  const confirmDiscardIfNeeded = useCallback((): boolean => {
    if (unsavedCount === 0) return true;
    return window.confirm(t('table.confirmDiscard'));
  }, [unsavedCount, t]);

  const resetSelection = useCallback((): void => {
    setData(null);
    setRows([]);
    setSelectedIds(new Set());
    setLoadError(null);
  }, []);

  const handleConnectionChange = (value: string): void => {
    if (!confirmDiscardIfNeeded()) return;
    setConnectionId(value === '' ? null : Number(value));
    setSchema('');
    setTableName('');
    setTables([]);
    setPage(1);
    setSort({ orderBy: null, orderDir: 'asc' });
    resetSelection();
  };

  const handleSchemaChange = (value: string): void => {
    if (!confirmDiscardIfNeeded()) return;
    setSchema(value);
    setTableName('');
    setPage(1);
    setSort({ orderBy: null, orderDir: 'asc' });
    resetSelection();
  };

  const handleTablePick = (name: string): void => {
    if (name === tableName) return;
    if (!confirmDiscardIfNeeded()) return;
    setTableName(name);
    setPage(1);
    setSort({ orderBy: null, orderDir: 'asc' });
    resetSelection();
  };

  const handleRefresh = (): void => {
    if (!confirmDiscardIfNeeded()) return;
    void loadRows();
  };

  const handlePageSizeChange = (value: string): void => {
    if (!confirmDiscardIfNeeded()) return;
    setPageSize(Number(value));
    setPage(1);
  };

  const handlePageChange = (next: number): void => {
    if (next < 1) return;
    if (!confirmDiscardIfNeeded()) return;
    setPage(next);
  };

  const handleSort = (name: string): void => {
    if (!confirmDiscardIfNeeded()) return;
    setSort((current) => nextSort(current, name));
    setPage(1);
  };

  /* ---------------------------------------------------------- 编辑动作 */

  const handleCellChange = (rowId: string, index: number, text: string): void => {
    setRows((current) =>
      current.map((row) => {
        if (row.id !== rowId) return row;
        const draft = row.draft.slice();
        // 哨兵文本立即坍缩成 null：输入框随 placeholder 显示 NULL，用户马上看到结果
        draft[index] = text === NULL_SENTINEL ? null : text;
        return { ...row, draft };
      }),
    );
  };

  const handleAddRow = (): void => {
    if (data === null) return;
    setRows((current) => [...current, newGridRow(data.columns, makeRowId())]);
  };

  const handleDiscard = (): void => {
    if (unsavedCount === 0) return;
    void loadRows();
  };

  const toggleRow = (rowId: string, checked: boolean): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  };

  const toggleAll = (checked: boolean): void => {
    setSelectedIds(checked ? new Set(rows.map((row) => row.id)) : new Set());
  };

  /* ---------------------------------------------------------- 保存 */

  const handleSave = async (): Promise<void> => {
    if (data === null || connectionId === null || schema === '' || tableName === '') return;
    const dirtyRows = rows.filter((row) => isRowDirty(row, columns));
    if (dirtyRows.length === 0) {
      toast.info(t('table.errNoChanges'));
      return;
    }

    // 先整体校验再写：避免"前几行写成功、后一行校验失败"的半截保存
    for (const row of dirtyRows) {
      const violation =
        row.origin === 'new'
          ? findRequiredViolation(draftToValueArray(row.draft, data.columns), data.columns, {
              skipColumnsWithDefault: true,
            })
          : findRequiredViolation(mergedRowValues(row.original, row.draft, data.columns), data.columns);
      if (violation) {
        toast.error(t('table.errRequired', { values: { column: violation.column } }));
        return;
      }
    }

    setSaving(true);
    let inserted = 0;
    let updated = 0;
    try {
      for (const row of dirtyRows) {
        if (row.origin === 'new') {
          const response = await tableApi.insert({
            connectionId,
            schema,
            table: tableName,
            values: buildInsertValues(row.draft, data.columns),
          });
          inserted += response.inserted;
        } else {
          const key = buildRowKey(row, data.columns, data.locator.columns);
          if (key === null) {
            toast.error(
              t('table.errSave', { values: { message: t('table.errIdentifier') } }),
            );
            return;
          }
          const response = await tableApi.update({
            connectionId,
            schema,
            table: tableName,
            key,
            changes: buildRowChanges(row.original, row.draft, data.columns),
          });
          updated += response.updated;
        }
      }
      // 删除是即时生效的（见 handleDelete），这里把它的计数一起报给用户，
      // 保证 saveDone 的三个占位符都有真实数字，而不是恒为 0 的摆设。
      toast.success(
        t('table.saveDone', { values: { inserted, updated, deleted: deletedSinceSave } }),
      );
      setDeletedSinceSave(0);
      await loadRows();
    } catch (error: unknown) {
      toast.error(t('table.errSave', { values: { message: formatError(error) } }));
    } finally {
      setSaving(false);
    }
  };

  /* ---------------------------------------------------------- 删除 */

  const handleDelete = async (): Promise<void> => {
    if (data === null || readOnly || selectedIds.size === 0) return;
    if (connectionId === null || schema === '' || tableName === '') return;
    const selected = rows.filter((row) => selectedIds.has(row.id));
    if (selected.length === 0) return;
    if (!window.confirm(t('table.confirmDelete', { values: { count: selected.length } }))) return;

    // 界面上刚新增、还没写库的行没有 key，直接从本地抹掉即可，不必也不能删库
    const existing = selected.filter((row) => row.origin === 'existing');
    if (existing.length > 0) {
      const keys: RowKey[] = [];
      for (const row of existing) {
        const key = buildRowKey(row, data.columns, data.locator.columns);
        if (key === null) {
          toast.error(t('table.errSave', { values: { message: t('table.errIdentifier') } }));
          return;
        }
        keys.push(key);
      }
      setSaving(true);
      try {
        const response = await tableApi.remove({
          connectionId,
          schema,
          table: tableName,
          keys,
        });
        setDeletedSinceSave((current) => current + response.deleted);
      } catch (error: unknown) {
        toast.error(t('table.errSave', { values: { message: formatError(error) } }));
        return;
      } finally {
        setSaving(false);
      }
    }
    toast.success(t('common.deleteSuccess'));
    await loadRows();
  };

  /* ---------------------------------------------------------- 渲染辅助 */

  const locatorText = ((): string => {
    if (data === null) return '';
    if (data.locator.kind === 'primary_key') {
      return t('table.locatorPrimary', { values: { columns: data.locator.columns.join(', ') } });
    }
    if (data.locator.kind === 'unique_index') {
      return t('table.locatorUnique', {
        values: {
          name: data.locator.indexName ?? '',
          columns: data.locator.columns.join(', '),
        },
      });
    }
    return t('table.locatorNone');
  })();

  const readOnlyReasonText = ((): string => {
    if (data === null) return '';
    if (data.readOnlyReason === 'no_permission') return t('table.readonlyNoPermission');
    if (data.readOnlyReason === 'connection_readonly') return t('table.readonlyConnection');
    return t('table.readonlyNoKey');
  })();

  const totalPages =
    data === null
      ? 1
      : data.total === null
        ? data.page
        : Math.max(1, Math.ceil(data.total / data.pageSize));
  const canGoNext =
    data !== null &&
    (data.total === null ? data.rows.length >= data.pageSize : data.page * data.pageSize < data.total);
  const allSelected = rows.length > 0 && selectedIds.size === rows.length;

  return (
    <div className="page table-data">
      <div className="card">
        <div className="card__header">
          <div>
            <h2 className="card__title">{t('table.title')}</h2>
            <p className="card__subtitle">{t('table.subtitle')}</p>
          </div>
        </div>

        <section className="toolbar table-data__toolbar">
          <div className="toolbar__group">
            <label className="toolbar__field">
              <span>{t('table.selectConnection')}</span>
              <select
                className="select input--sm"
                value={connectionId === null ? '' : String(connectionId)}
                onChange={(event) => {
                  handleConnectionChange(event.target.value);
                }}
              >
                <option value="">{t('table.selectConnection')}</option>
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name}
                  </option>
                ))}
              </select>
            </label>

            {schemas.length > 1 ? (
              <label className="toolbar__field">
                <span>{t('common.name')}</span>
                <select
                  className="select input--sm"
                  value={schema}
                  onChange={(event) => {
                    handleSchemaChange(event.target.value);
                  }}
                >
                  {schemas.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="toolbar__field">
              <span>{t('table.pageSize', { values: { size: pageSize } })}</span>
              <select
                className="select input--sm"
                value={pageSize}
                onChange={(event) => {
                  handlePageSizeChange(event.target.value);
                }}
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="toolbar__group">
            {tableName !== '' ? (
              <span className="toolbar__count mono">{tableName}</span>
            ) : null}
            {unsavedCount > 0 ? (
              <span className="badge badge--warning">
                {t('table.unsaved', { values: { count: unsavedCount } })}
              </span>
            ) : null}
            {data !== null ? <span className="text-muted">{t('table.sortHint')}</span> : null}
          </div>

          <div className="toolbar__group">
            <Button
              size="sm"
              variant="secondary"
              icon="refresh"
              loading={loading}
              disabled={tableName === ''}
              onClick={handleRefresh}
            >
              {t('table.refresh')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="plus"
              disabled={data === null}
              onClick={handleAddRow}
            >
              {t('table.addRow')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon="trash"
              disabled={readOnly || selectedIds.size === 0}
              onClick={() => {
                void handleDelete();
              }}
            >
              {t('table.deleteRows', { values: { count: selectedIds.size } })}
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon="check"
              loading={saving}
              disabled={unsavedCount === 0}
              onClick={() => {
                void handleSave();
              }}
            >
              {t('table.save', { values: { count: unsavedCount } })}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={unsavedCount === 0}
              onClick={handleDiscard}
            >
              {t('table.discard')}
            </Button>
          </div>
        </section>
      </div>

      <div className="table-data__body">
        {connections.length === 0 ? (
          <div className="empty-state empty-state--inline">
            <Icon name="connections" size={22} />
            <p>{t('table.noTableTitle')}</p>
            <p className="text-muted">{t('table.noTableHint')}</p>
            <Button
              size="sm"
              variant="secondary"
              icon="connections"
              onClick={() => {
                onNavigate('connections');
              }}
            >
              {t('nav.connections.label')}
            </Button>
          </div>
        ) : (
          <div className="card table-data__tables">
            <div className="card__header">
              <h3 className="card__title">{t('table.selectTable')}</h3>
            </div>
            {tables.length === 0 ? (
              <p className="text-muted">{t('table.pickTable')}</p>
            ) : (
              <div className="table-data__table-list">
                {tables.map((table) => (
                  <Button
                    key={`${schema}.${table.name}`}
                    size="sm"
                    block
                    variant={table.name === tableName ? 'primary' : 'ghost'}
                    icon="table"
                    onClick={() => {
                      handleTablePick(table.name);
                    }}
                  >
                    {table.name}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="table-data__main">
          {loadError !== null ? (
            <div className="banner banner--danger" role="alert">
              {t('table.errLoad', { values: { message: loadError } })}
            </div>
          ) : null}

          {loading ? (
            <div className="inline-loading">
              <span className="spinner" aria-hidden="true" />
              <span>{t('table.loading')}</span>
            </div>
          ) : null}

          {data === null && !loading && loadError === null ? (
            <div className="empty-state empty-state--inline">
              <Icon name="table" size={22} />
              <p>{t('table.noTableTitle')}</p>
              <p className="text-muted">{t('table.noTableHint')}</p>
            </div>
          ) : null}

          {data !== null ? (
            <>
              {readOnly ? (
                <div className="banner banner--warning" role="alert">
                  <div>
                    {t('table.readonlyBanner', { values: { reason: readOnlyReasonText } })}
                  </div>
                  {data.readOnlyReason === 'no_primary_key' ? (
                    <div className="text-muted">{t('table.pkMissing')}</div>
                  ) : null}
                </div>
              ) : null}

              <div className="table-data__meta">
                <span className="badge badge--muted">{locatorText}</span>
                <span className="text-muted">
                  {data.total === null
                    ? t('table.totalUnknown')
                    : t('table.totalRows', { values: { count: data.total } })}
                </span>
                {rows.some((row) => row.origin === 'new') ? (
                  <span className="text-muted">{t('table.newRowHint')}</span>
                ) : null}
              </div>

              <div className="table-data__scroll">
                <table className="table-data__table">
                  <thead>
                    <tr>
                      {readOnly ? null : (
                        <th className="table-data__th">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            aria-label={t('table.selectAll')}
                            onChange={(event) => {
                              toggleAll(event.target.checked);
                            }}
                          />
                        </th>
                      )}
                      {data.columns.map((column) => {
                        const sorted = sort.orderBy === column.name;
                        return (
                          <th key={column.name} className="table-data__th">
                            <Button
                              size="sm"
                              variant={sorted ? 'primary' : 'ghost'}
                              icon={
                                sorted
                                  ? sort.orderDir === 'asc'
                                    ? 'chevronRight'
                                    : 'chevronDown'
                                  : undefined
                              }
                              title={t('table.sortHint')}
                              onClick={() => {
                                handleSort(column.name);
                              }}
                            >
                              {column.name}
                            </Button>
                            <span className="text-muted mono">{column.dataType}</span>
                          </th>
                        );
                      })}
                      <th className="table-data__th">{t('common.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td
                          className="table-data__state"
                          colSpan={data.columns.length + (readOnly ? 1 : 2)}
                        >
                          <span className="empty-state">
                            <span>{t('table.empty')}</span>
                            <span className="text-muted">{t('table.emptyHint')}</span>
                          </span>
                        </td>
                      </tr>
                    ) : (
                      rows.map((row, rowIndex) => {
                        const dirty = dirtyMap.get(row.id) ?? new Set<number>();
                        const markedForDeletion = selectedIds.has(row.id);
                        const rowClass = markedForDeletion
                          ? 'is-deleted'
                          : row.origin === 'new'
                            ? 'is-new'
                            : dirty.size > 0
                              ? 'is-edited'
                              : 'is-clean';
                        return (
                          <tr key={row.id} className={`table-data__row ${rowClass}`}>
                            {readOnly ? null : (
                              <td className="table-data__td">
                                <input
                                  type="checkbox"
                                  checked={markedForDeletion}
                                  aria-label={t('table.selectRow', {
                                    values: { index: rowIndex + 1 },
                                  })}
                                  onChange={(event) => {
                                    toggleRow(row.id, event.target.checked);
                                  }}
                                />
                              </td>
                            )}
                            {data.columns.map((column, index) => {
                              const text = row.draft[index] ?? null;
                              const isDirty = dirty.has(index);
                              return (
                                <td
                                  key={column.name}
                                  className={`table-data__td${isDirty ? ' is-dirty' : ''}`}
                                >
                                  <input
                                    className={`input input--sm table-data__cell${isDirty ? ' is-dirty' : ''}`}
                                    type="text"
                                    value={text === null ? '' : text}
                                    placeholder={text === null ? t('table.cellNull') : undefined}
                                    readOnly={readOnly}
                                    title={isDirty ? t('table.cellEdited') : undefined}
                                    aria-label={column.name}
                                    onChange={(event) => {
                                      handleCellChange(row.id, index, event.target.value);
                                    }}
                                  />
                                </td>
                              );
                            })}
                            <td className="table-data__td">
                              {markedForDeletion ? (
                                <span className="badge badge--danger">{t('table.rowDeleted')}</span>
                              ) : row.origin === 'new' ? (
                                <span className="badge badge--info">{t('table.rowNew')}</span>
                              ) : dirty.size > 0 ? (
                                <span className="badge badge--warning">{t('table.rowEdited')}</span>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="pager">
                <span className="pager__info">
                  {t('table.pageInfo', { values: { page: data.page, total: totalPages } })}
                </span>
                <div className="pager__actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={data.page <= 1}
                    onClick={() => {
                      handlePageChange(data.page - 1);
                    }}
                  >
                    {t('table.prev')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!canGoNext}
                    onClick={() => {
                      handlePageChange(data.page + 1);
                    }}
                  >
                    {t('table.next')}
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
