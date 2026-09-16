/**
 * 花生苗数据库管理工具 - 可视化建库建表页
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 设计取舍：
 *  · **先预览、后执行**。`ddlApi.preview` 只生成语句、绝不执行；「执行」按钮在
 *    当前表单生成过预览之前一律禁用。表单的任何改动都会让旧预览作废
 *    （见 `specFingerprint`）—— 界面必须保证"用户看到的语句"就是"即将执行的
 *    语句"，否则预览只是一层假的安全感。
 *  · **纯逻辑外置**。校验、归一化、指纹、新列命名、排序都写成不依赖 React 的
 *    纯函数并导出，便于在没有 DOM 的测试环境里逐条覆盖
 *    （apps/web/src/pages/tableDesigner.test.ts）。
 *  · **派生不变量只做一次**。主键列强制非空、无长度类型丢掉 length、空串
 *    默认值/注释归一成 null —— 全部集中在 `normalizeSpec`，避免散落在 JSX 里
 *    导致"预览的 spec"和"执行的 spec"不是同一个东西。
 *  · **危险动作二次确认**。执行走页面内确认条（不阻塞、可读性更好）；
 *    删除表按需求固定用 `window.confirm`（不可撤销的破坏性操作，用原生弹窗拦住）。
 */
import type { MessageKey, MessageValues } from '@peanutsprout/i18n';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { describeError } from '../api/client.js';
import { connectionsApi, ddlApi } from '../api/endpoints.js';
import type {
  ColumnTypeDTO,
  ConnectionDTO,
  DdlColumnInput,
  DdlIndexInput,
  DdlTableSpec,
  SchemaDTO,
  SchemaSupportDTO,
  TableDTO,
} from '../api/types.js';
import { Button } from '../components/Button.js';
import { Icon } from '../components/Icons.js';
import { useI18n } from '../state/i18n.js';
import { useToast } from '../state/toast.js';
import type { ViewKey } from '../state/view.js';
import { classNames } from '../utils/format.js';

/* ------------------------------------------------------------------ 纯逻辑 */

/** 合法标识符：字母或下划线开头，后面只能是字母、数字、下划线。 */
export const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 表单里的一列。`length` 用字符串保存：输入框允许暂时为空，归一化时再解析。 */
export interface DesignerColumn {
  name: string;
  dataType: string;
  length: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string;
  comment: string;
}

/** 表单里的一个索引。 */
export interface DesignerIndex {
  name: string;
  columns: string[];
  unique: boolean;
}

/** 页面表单的完整快照；validate / normalize / fingerprint 都作用在它上面。 */
export interface DesignerSpec {
  connectionId: number | null;
  schema: string;
  table: string;
  columns: DesignerColumn[];
  indexes: DesignerIndex[];
  ifNotExists: boolean;
}

/** 一条待展示的校验结果：i18n 键 + 插值。 */
export interface DesignerMessage {
  key: MessageKey;
  values?: MessageValues;
}

/** 新建一列的默认值：默认可空、非主键，避免把"没填"误解成"NOT NULL"。 */
export function emptyColumn(dataType = ''): DesignerColumn {
  return {
    name: '',
    dataType,
    length: '',
    nullable: true,
    primaryKey: false,
    defaultValue: '',
    comment: '',
  };
}

export function isValidIdentifier(name: string): boolean {
  return IDENTIFIER_PATTERN.test(name.trim());
}

/**
 * 类型元信息查询：该类型是否需要长度 / 精度。
 * 查不到时返回 true（保守放行），免得元数据缺失就把用户填的长度悄悄丢掉。
 */
export function typeHasLength(types: readonly ColumnTypeDTO[], dataType: string): boolean {
  const wanted = dataType.trim().toLowerCase();
  const found = types.find((type) => type.name.toLowerCase() === wanted);
  return found ? found.hasLength : true;
}

function parseLength(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function optionalField(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * 客户端校验：返回全部问题（不是遇到第一个就返回），
 * 这样用户一次就能看到所有要改的地方。
 */
export function validateSpec(spec: DesignerSpec): DesignerMessage[] {
  const issues: DesignerMessage[] = [];

  if (spec.connectionId === null) {
    issues.push({ key: 'designer.errNoConnection' });
  }

  // errInvalidName 没有插值，多处非法时只报一条，避免同一句话刷屏
  let reportedInvalidName = false;
  const reportInvalidName = (): void => {
    if (reportedInvalidName) return;
    reportedInvalidName = true;
    issues.push({ key: 'designer.errInvalidName' });
  };

  const table = spec.table.trim();
  if (table.length === 0) {
    issues.push({ key: 'designer.errNoTableName' });
  } else if (!isValidIdentifier(table)) {
    reportInvalidName();
  }

  // schema 允许为空（SQLite 这类没有 schema 概念），非空时必须是合法标识符
  const schema = spec.schema.trim();
  if (schema.length > 0 && !isValidIdentifier(schema)) {
    reportInvalidName();
  }

  if (spec.columns.length === 0) {
    issues.push({ key: 'designer.errNoColumns' });
  }

  const seenColumns = new Set<string>();
  let reportedEmptyColumn = false;
  for (const column of spec.columns) {
    const name = column.name.trim();
    if (name.length === 0) {
      if (!reportedEmptyColumn) {
        reportedEmptyColumn = true;
        issues.push({ key: 'designer.errEmptyColumnName' });
      }
      continue;
    }
    if (!isValidIdentifier(name)) {
      reportInvalidName();
    }
    // 列名大小写不敏感：`Id` 与 `id` 在多数数据库里是同一列
    const lowered = name.toLowerCase();
    if (seenColumns.has(lowered)) {
      issues.push({ key: 'designer.errDuplicateColumn', values: { name } });
    } else {
      seenColumns.add(lowered);
    }
  }

  const seenIndexes = new Set<string>();
  for (const index of spec.indexes) {
    const name = index.name.trim();
    if (name.length === 0) {
      // 索引没有名字同样无法执行，算非法标识符
      reportInvalidName();
    } else {
      if (!isValidIdentifier(name)) {
        reportInvalidName();
      }
      const lowered = name.toLowerCase();
      if (seenIndexes.has(lowered)) {
        issues.push({ key: 'designer.errDuplicateIndex', values: { name } });
      } else {
        seenIndexes.add(lowered);
      }
    }
    const usable = index.columns.filter((column) => column.trim().length > 0);
    if (usable.length === 0) {
      issues.push({ key: 'designer.errIndexNoColumns', values: { name } });
    }
  }

  return issues;
}

/**
 * 归一化成真正发给服务端的 spec，负责所有"派生不变量"：
 *  · 主键列强制 `nullable: false`（服务端也会做，界面不能显示相反的东西）；
 *  · 类型不需要长度时把 `length` 丢掉（返回 null），否则用户改完类型
 *    旧长度还会被带进 DDL；
 *  · 名称去首尾空格；空的 length / defaultValue / comment 归一成 null。
 */
export function normalizeSpec(spec: DesignerSpec, types: readonly ColumnTypeDTO[]): DdlTableSpec {
  const columns: DdlColumnInput[] = spec.columns.map((column) => {
    const dataType = column.dataType.trim();
    return {
      name: column.name.trim(),
      dataType,
      length: typeHasLength(types, dataType) ? parseLength(column.length) : null,
      nullable: column.primaryKey ? false : column.nullable,
      primaryKey: column.primaryKey,
      defaultValue: optionalField(column.defaultValue),
      comment: optionalField(column.comment),
    };
  });

  const indexes: DdlIndexInput[] = spec.indexes.map((index) => ({
    name: index.name.trim(),
    columns: index.columns.map((column) => column.trim()).filter((column) => column.length > 0),
    unique: index.unique,
  }));

  return {
    connectionId: spec.connectionId ?? 0,
    schema: spec.schema.trim(),
    table: spec.table.trim(),
    columns,
    indexes,
    ifNotExists: spec.ifNotExists,
  };
}

/**
 * 预览新鲜度指纹：表单里**每个会影响 DDL 的字段**都要参与，
 * 一旦用户改了任何一处，指纹就变，旧预览随即作废。
 *
 * 刻意用原始值（不做 trim / 不先 normalize）：宁可多作废一次预览，
 * 也不要让一份和界面对不上的语句被当成"最新"。
 * 也刻意不用对象字面量拼 JSON —— 键顺序无关，只有值本身变化才会变。
 */
export function specFingerprint(spec: DesignerSpec): string {
  return JSON.stringify([
    spec.connectionId,
    spec.schema,
    spec.table,
    spec.ifNotExists,
    spec.columns.map((column) => [
      column.name,
      column.dataType,
      column.length,
      column.nullable,
      column.primaryKey,
      column.defaultValue,
      column.comment,
    ]),
    spec.indexes.map((index) => [index.name, index.unique, index.columns]),
  ]);
}

/** 新列的默认名：`column_1`、`column_2`……跳过已被占用的（大小写不敏感）。 */
export function nextColumnName(columns: readonly { name: string }[]): string {
  const taken = new Set(columns.map((column) => column.name.trim().toLowerCase()));
  let index = 1;
  while (taken.has(`column_${index}`)) {
    index += 1;
  }
  return `column_${index}`;
}

/**
 * 列表重排：返回**新数组**，不修改入参。
 * 越界 / 非整数 / 原地移动都返回一份等值拷贝（调用方 setState 不会丢渲染）。
 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = list.slice();
  if (!Number.isInteger(from) || !Number.isInteger(to)) return next;
  if (from < 0 || from >= next.length) return next;
  if (to < 0 || to >= next.length) return next;
  if (from === to) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/* ------------------------------------------------------------------ 页面组件 */

type DesignerTab = 'schema' | 'table' | 'manage';

export function TableDesignerPage({ onNavigate }: { onNavigate: (view: ViewKey) => void }) {
  const { t, localizeError } = useI18n();
  const toast = useToast();

  // 连接与元数据
  const [connections, setConnections] = useState<ConnectionDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connectionId, setConnectionId] = useState<number | null>(null);
  const [schemas, setSchemas] = useState<SchemaDTO[]>([]);
  const [schemaSupport, setSchemaSupport] = useState<SchemaSupportDTO | null>(null);
  const [columnTypes, setColumnTypes] = useState<ColumnTypeDTO[]>([]);
  const [metaLoading, setMetaLoading] = useState(false);

  const [tab, setTab] = useState<DesignerTab>('schema');

  // 建库表单
  const [newSchemaName, setNewSchemaName] = useState('');
  const [creatingSchema, setCreatingSchema] = useState(false);

  // 建表表单
  const [schema, setSchema] = useState('');
  const [table, setTable] = useState('');
  const [columns, setColumns] = useState<DesignerColumn[]>([emptyColumn()]);
  const [indexes, setIndexes] = useState<DesignerIndex[]>([]);
  const [ifNotExists, setIfNotExists] = useState(false);
  const [issues, setIssues] = useState<DesignerMessage[]>([]);

  // 预览 / 执行
  const [preview, setPreview] = useState<{ fingerprint: string; statements: string[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmingExecute, setConfirmingExecute] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);

  // 已有表
  const [tables, setTables] = useState<TableDTO[]>([]);
  const [columnCounts, setColumnCounts] = useState<Record<string, number>>({});
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tablesError, setTablesError] = useState<string | null>(null);

  const spec: DesignerSpec = { connectionId, schema, table, columns, indexes, ifNotExists };
  const fingerprint = specFingerprint(spec);
  const previewFresh = preview !== null && preview.fingerprint === fingerprint;

  const defaultType = columnTypes[0]?.name ?? '';
  const schemaSupported = schemaSupport?.supported === true;
  const connectionName = connections.find((item) => item.id === connectionId)?.name ?? '';

  // 1) 连接清单
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    connectionsApi
      .list()
      .then((response) => {
        if (cancelled) return;
        setConnections(response.items);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(describeError(error, { t, localizeError }));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t, localizeError]);

  // 2) 连接变化：拉 schema 清单 / 建库支持 / 列类型
  useEffect(() => {
    // 换连接后旧的预览、报错都作废
    setPreview(null);
    setPreviewError(null);
    setExecuteError(null);
    setIssues([]);
    setTables([]);
    setColumnCounts({});
    setTablesError(null);

    if (connectionId === null) {
      setSchemas([]);
      setSchemaSupport(null);
      setColumnTypes([]);
      setSchema('');
      return;
    }

    let cancelled = false;
    setMetaLoading(true);
    Promise.all([
      connectionsApi.schemas(connectionId),
      ddlApi.schemaSupport(connectionId),
      ddlApi.columnTypes(connectionId),
    ])
      .then(([schemaResponse, support, typesResponse]) => {
        if (cancelled) return;
        setSchemas(schemaResponse.items);
        setSchemaSupport(support);
        setColumnTypes(typesResponse.types);
        const firstSchema = schemaResponse.items[0]?.name ?? '';
        setSchema((current) => (current.length > 0 ? current : firstSchema));
        const fallbackType = typesResponse.types[0]?.name ?? '';
        // 还没选类型的列补上第一个类型，避免下拉是空的
        setColumns((current) =>
          current.map((column) =>
            column.dataType.length > 0 ? column : { ...column, dataType: fallbackType },
          ),
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSchemas([]);
        setSchemaSupport(null);
        setColumnTypes([]);
        setLoadError(describeError(error, { t, localizeError }));
      })
      .finally(() => {
        if (!cancelled) setMetaLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [connectionId, t, localizeError]);

  // 3) 表单指纹一变，旧预览立刻作废 —— 这是"预览必须对应当前表单"的硬保证
  useEffect(() => {
    if (preview !== null && preview.fingerprint !== fingerprint) {
      setPreview(null);
      setConfirmingExecute(false);
    }
  }, [fingerprint, preview]);

  // 4) 已有表清单（含每张表的列数；单表取列失败不影响整表列出）
  const loadTables = useCallback(async () => {
    if (connectionId === null) {
      setTables([]);
      setColumnCounts({});
      return;
    }
    setTablesLoading(true);
    setTablesError(null);
    try {
      const response = await connectionsApi.tables(connectionId, schema);
      setTables(response.items);
      const counted = await Promise.allSettled(
        response.items.map(async (item) => {
          const columnResponse = await connectionsApi.columns(connectionId, schema, item.name);
          return [item.name, columnResponse.items.length] as const;
        }),
      );
      const nextCounts: Record<string, number> = {};
      for (const result of counted) {
        if (result.status === 'fulfilled') {
          nextCounts[result.value[0]] = result.value[1];
        }
      }
      setColumnCounts(nextCounts);
    } catch (error) {
      setTables([]);
      setColumnCounts({});
      setTablesError(describeError(error, { t, localizeError }));
    } finally {
      setTablesLoading(false);
    }
  }, [connectionId, schema, t, localizeError]);

  useEffect(() => {
    if (tab === 'manage') {
      void loadTables();
    }
  }, [tab, loadTables]);

  /* -------------------------------------------------- 动作 */

  const createSchema = async (): Promise<void> => {
    if (connectionId === null) {
      toast.error(t('designer.errNoConnection'));
      return;
    }
    const name = newSchemaName.trim();
    if (name.length === 0) {
      toast.error(t('designer.errNoName'));
      return;
    }
    if (!isValidIdentifier(name)) {
      toast.error(t('designer.errInvalidName'));
      return;
    }
    setCreatingSchema(true);
    try {
      // 「创建」按钮本身就是用户的明确动作，因此在这里带上 confirm
      await ddlApi.createSchema({ connectionId, name, confirm: true });
      toast.success(t('designer.schemaCreated', { values: { name } }));
      setNewSchemaName('');
      const response = await connectionsApi.schemas(connectionId);
      setSchemas(response.items);
      setSchema(name);
    } catch (error) {
      toast.error(describeError(error, { t, localizeError }));
    } finally {
      setCreatingSchema(false);
    }
  };

  const generatePreview = async (): Promise<void> => {
    const found = validateSpec(spec);
    setIssues(found);
    setExecuteError(null);
    setConfirmingExecute(false);
    if (found.length > 0) {
      // 表单不合法就不生成预览：预览只描述"能执行"的语句
      setPreview(null);
      return;
    }
    const requested = specFingerprint(spec);
    setPreviewing(true);
    setPreviewError(null);
    try {
      const response = await ddlApi.preview(normalizeSpec(spec, columnTypes));
      setPreview({ fingerprint: requested, statements: response.statements });
    } catch (error) {
      setPreview(null);
      setPreviewError(describeError(error, { t, localizeError }));
    } finally {
      setPreviewing(false);
    }
  };

  const execute = async (): Promise<void> => {
    // 双保险：不新鲜的预览绝不允许执行（即使按钮状态被绕过也拦得住）
    if (!previewFresh) return;
    // 执行前再校验一次：能走到这里理论上一定合法（预览生成时校验过同一指纹），
    // 但"执行"这条路径自己也要能独立说清门槛，不依赖上游的隐式保证
    const found = validateSpec(spec);
    if (found.length > 0) {
      setIssues(found);
      setConfirmingExecute(false);
      setPreview(null);
      return;
    }
    setConfirmingExecute(false);
    setExecuting(true);
    setExecuteError(null);
    try {
      // 只有走到这里（预览新鲜 + 用户在确认条上点过「确认执行」）才带 confirm，
      // 其余任何路径都不带 —— 服务端对缺少 confirm 的请求返回 428
      const result = await ddlApi.execute({
        ...normalizeSpec(spec, columnTypes),
        confirm: true,
      });
      toast.success(t('designer.executeDone', { values: { count: result.executed } }));
      // 执行成功后作废预览：同一条 DDL 不允许在没重新预览前再跑一遍
      setPreview(null);
      setIssues([]);
      setTab('manage');
      await loadTables();
    } catch (error) {
      setExecuteError(describeError(error, { t, localizeError }));
    } finally {
      setExecuting(false);
    }
  };

  const dropTable = async (name: string): Promise<void> => {
    if (connectionId === null) {
      toast.error(t('designer.errNoConnection'));
      return;
    }
    // 删除表不可撤销：按需求固定用 window.confirm 的原生弹窗再拦一道
    if (!window.confirm(t('designer.dropTableConfirm', { values: { table: name } }))) {
      return;
    }
    try {
      // 已在 window.confirm 里得到用户确认，这里才带 confirm
      await ddlApi.dropTable({ connectionId, schema, table: name, confirm: true });
      toast.success(t('designer.dropTableDone', { values: { table: name } }));
      await loadTables();
    } catch (error) {
      toast.error(describeError(error, { t, localizeError }));
    }
  };

  const updateColumn = (index: number, patch: Partial<DesignerColumn>): void => {
    setColumns((current) => current.map((column, i) => (i === index ? { ...column, ...patch } : column)));
  };

  const renameColumn = (index: number, name: string): void => {
    const previous = columns[index]?.name.trim() ?? '';
    updateColumn(index, { name });
    const next = name.trim();
    // 列改名时同步索引引用，否则索引会指向一个不存在的列
    if (previous.length > 0 && previous !== next) {
      setIndexes((current) =>
        current.map((item) => ({
          ...item,
          columns: item.columns.map((column) => (column === previous ? next : column)),
        })),
      );
    }
  };

  const removeColumn = (index: number): void => {
    setColumns((current) => current.filter((_, i) => i !== index));
  };

  const updateIndex = (index: number, patch: Partial<DesignerIndex>): void => {
    setIndexes((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const togglePrimaryKey = (index: number, primaryKey: boolean): void => {
    const column = columns[index];
    if (!column) return;
    // 主键列必须非空：服务端也会强制，界面不能显示相反的状态
    updateColumn(index, { primaryKey, nullable: primaryKey ? false : column.nullable });
  };

  const changeColumnType = (index: number, dataType: string): void => {
    // 新类型不需要长度时清掉旧长度，避免界面显示一个不会生效的值
    updateColumn(index, typeHasLength(columnTypes, dataType) ? { dataType } : { dataType, length: '' });
  };

  const knownTypes = useMemo(() => new Set(columnTypes.map((type) => type.name)), [columnTypes]);

  const issueList = issues.length > 0 ? (
    <div className="banner banner--danger" role="alert">
      <Icon name="alert" size={16} />
      <ul className="designer__issues">
        {issues.map((issue, index) => (
          <li key={`${issue.key}-${index}`}>
            {t(issue.key, issue.values ? { values: issue.values } : undefined)}
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  /* -------------------------------------------------- 渲染 */

  return (
    <div className="page designer">
      <header className="designer__header">
        <div>
          <h1 className="designer__title">{t('designer.title')}</h1>
          <p className="text-muted">{t('designer.subtitle')}</p>
        </div>
      </header>

      {loading ? (
        <p className="inline-loading">
          <span className="spinner" aria-hidden="true" />
          {t('designer.loading')}
        </p>
      ) : (
        <div className="designer__layout">
          <section className="card designer__form">
            <label className="field">
              <span className="field__label">{t('designer.connectionLabel')}</span>
              <select
                className="select"
                value={connectionId === null ? '' : String(connectionId)}
                onChange={(event) => {
                  const value = event.target.value;
                  setConnectionId(value === '' ? null : Number(value));
                }}
              >
                <option value="">{t('designer.schemaPick')}</option>
                {connections.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>

            {loadError ? (
              <div className="banner banner--danger" role="alert">
                <Icon name="alert" size={16} />
                <span>{loadError}</span>
              </div>
            ) : null}
            {!loadError && connections.length === 0 ? (
              <p className="text-muted">{t('designer.errNoConnection')}</p>
            ) : null}

            <div className="designer__tabs">
              <button
                type="button"
                className={classNames('tab', tab === 'schema' && 'tab--active')}
                onClick={() => {
                  setTab('schema');
                }}
              >
                {t('designer.tabSchema')}
              </button>
              <button
                type="button"
                className={classNames('tab', tab === 'table' && 'tab--active')}
                onClick={() => {
                  setTab('table');
                }}
              >
                {t('designer.tabTable')}
              </button>
              <button
                type="button"
                className={classNames('tab', tab === 'manage' && 'tab--active')}
                onClick={() => {
                  setTab('manage');
                }}
              >
                {t('designer.tabManage')}
              </button>
            </div>

            {metaLoading ? (
              <p className="inline-loading">
                <span className="spinner" aria-hidden="true" />
                {t('designer.loading')}
              </p>
            ) : null}

            {/* ---------------- 建库 / Schema ---------------- */}
            {tab === 'schema' ? (
              <div className="designer__panel">
                {schemaSupport && !schemaSupport.supported ? (
                  <div className="banner banner--warning" role="alert">
                    <Icon name="alert" size={16} />
                    <span>
                      {t('designer.schemaUnsupported', { values: { dbType: schemaSupport.dbType } })}
                    </span>
                  </div>
                ) : (
                  <>
                    <h2 className="card__title">{t('designer.schemaLabel')}</h2>
                    <label className="field">
                      <span className="field__label">{t('designer.schemaName')}</span>
                      <input
                        className="input mono"
                        type="text"
                        value={newSchemaName}
                        placeholder={t('designer.schemaNamePlaceholder')}
                        disabled={connectionId === null || creatingSchema}
                        onChange={(event) => {
                          setNewSchemaName(event.target.value);
                        }}
                      />
                      <span className="field__hint">{t('designer.schemaHint')}</span>
                    </label>
                    <div className="designer__actions">
                      <Button
                        variant="primary"
                        icon="plus"
                        loading={creatingSchema}
                        disabled={!schemaSupported || connectionId === null}
                        onClick={() => {
                          void createSchema();
                        }}
                      >
                        {t('designer.schemaCreate')}
                      </Button>
                    </div>
                  </>
                )}

                <div className="designer__existing">
                  <h3 className="card__subtitle">{t('designer.schemaExisting')}</h3>
                  {schemas.length === 0 ? (
                    <p className="text-muted">{t('common.empty')}</p>
                  ) : (
                    <div className="badge-group">
                      {schemas.map((item) => (
                        <span className="badge" key={item.name}>
                          {item.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {/* ---------------- 建表 ---------------- */}
            {tab === 'table' ? (
              <div className="designer__panel">
                <div className="form-grid">
                  <label className="field">
                    <span className="field__label">{t('designer.tableName')}</span>
                    <input
                      className="input mono"
                      type="text"
                      value={table}
                      placeholder={t('designer.tableNamePlaceholder')}
                      onChange={(event) => {
                        setTable(event.target.value);
                      }}
                    />
                  </label>

                  <label className="field">
                    <span className="field__label">{t('designer.tableSchema')}</span>
                    {schemas.length > 0 ? (
                      <select
                        className="select"
                        value={schema}
                        onChange={(event) => {
                          setSchema(event.target.value);
                        }}
                      >
                        <option value="">{t('designer.schemaPick')}</option>
                        {schemas.map((item) => (
                          <option key={item.name} value={item.name}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="input mono"
                        type="text"
                        value={schema}
                        onChange={(event) => {
                          setSchema(event.target.value);
                        }}
                      />
                    )}
                  </label>
                </div>

                <div className="designer__section">
                  <div className="toolbar">
                    <span className="card__subtitle-strong">{t('designer.columnsTitle')}</span>
                    <span className="field__hint">{t('designer.columnsHint')}</span>
                    <span className="designer__spacer" />
                    <Button
                      size="sm"
                      icon="plus"
                      onClick={() => {
                        setColumns((current) => [...current, emptyColumn(defaultType)]);
                      }}
                    >
                      {t('designer.addColumn')}
                    </Button>
                  </div>

                  {columns.map((column, index) => {
                    const lengthEnabled = typeHasLength(columnTypes, column.dataType);
                    return (
                      <div className="designer__column" key={`column-${index}`}>
                        <div className="designer__column-head">
                          <span className="badge badge--muted">{index + 1}</span>
                          <span className="designer__spacer" />
                          <Button
                            size="sm"
                            disabled={index === 0}
                            onClick={() => {
                              setColumns(moveItem(columns, index, index - 1));
                            }}
                          >
                            {t('designer.moveUp')}
                          </Button>
                          <Button
                            size="sm"
                            disabled={index === columns.length - 1}
                            onClick={() => {
                              setColumns(moveItem(columns, index, index + 1));
                            }}
                          >
                            {t('designer.moveDown')}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            icon="trash"
                            onClick={() => {
                              removeColumn(index);
                            }}
                          >
                            {t('designer.removeColumn')}
                          </Button>
                        </div>

                        <div className="form-grid">
                          <label className="field">
                            <span className="field__label">{t('designer.colName')}</span>
                            <input
                              className="input input--sm mono"
                              type="text"
                              value={column.name}
                              onChange={(event) => {
                                renameColumn(index, event.target.value);
                              }}
                            />
                          </label>

                          <label className="field">
                            <span className="field__label">{t('designer.colType')}</span>
                            <select
                              className="select"
                              value={column.dataType}
                              onChange={(event) => {
                                changeColumnType(index, event.target.value);
                              }}
                            >
                              {column.dataType.length > 0 && !knownTypes.has(column.dataType) ? (
                                <option value={column.dataType}>{column.dataType}</option>
                              ) : null}
                              {columnTypes.map((type) => (
                                <option key={type.name} value={type.name}>
                                  {type.name}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="field">
                            <span className="field__label">{t('designer.colLength')}</span>
                            <input
                              className="input input--sm"
                              type="number"
                              min={1}
                              value={column.length}
                              disabled={!lengthEnabled}
                              placeholder={lengthEnabled ? '' : t('common.dash')}
                              onChange={(event) => {
                                updateColumn(index, { length: event.target.value });
                              }}
                            />
                          </label>

                          <label className="field">
                            <span className="field__label">{t('designer.colDefault')}</span>
                            <input
                              className="input input--sm mono"
                              type="text"
                              value={column.defaultValue}
                              onChange={(event) => {
                                updateColumn(index, { defaultValue: event.target.value });
                              }}
                            />
                          </label>

                          <label className="field">
                            <span className="field__label">{t('designer.colComment')}</span>
                            <input
                              className="input input--sm"
                              type="text"
                              value={column.comment}
                              onChange={(event) => {
                                updateColumn(index, { comment: event.target.value });
                              }}
                            />
                          </label>

                          <div className="field">
                            <span className="field__label">{t('designer.columnsTitle')}</span>
                            <div className="checkbox-row">
                              <label className="checkbox">
                                <input
                                  type="checkbox"
                                  checked={column.primaryKey ? false : column.nullable}
                                  disabled={column.primaryKey}
                                  onChange={(event) => {
                                    updateColumn(index, { nullable: event.target.checked });
                                  }}
                                />
                                <span>{t('designer.colNullable')}</span>
                              </label>
                              <label className="checkbox">
                                <input
                                  type="checkbox"
                                  checked={column.primaryKey}
                                  onChange={(event) => {
                                    togglePrimaryKey(index, event.target.checked);
                                  }}
                                />
                                <span>{t('designer.colPrimaryKey')}</span>
                              </label>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="designer__section">
                  <div className="toolbar">
                    <span className="card__subtitle-strong">{t('designer.indexesTitle')}</span>
                    <span className="designer__spacer" />
                    <Button
                      size="sm"
                      icon="plus"
                      onClick={() => {
                        setIndexes((current) => [...current, { name: '', columns: [], unique: false }]);
                      }}
                    >
                      {t('designer.addIndex')}
                    </Button>
                  </div>

                  {indexes.map((item, index) => (
                    <div className="designer__index" key={`index-${index}`}>
                      <div className="form-grid">
                        <label className="field">
                          <span className="field__label">{t('designer.indexName')}</span>
                          <input
                            className="input input--sm mono"
                            type="text"
                            value={item.name}
                            onChange={(event) => {
                              updateIndex(index, { name: event.target.value });
                            }}
                          />
                        </label>

                        <label className="field">
                          <span className="field__label">{t('designer.indexColumns')}</span>
                          <select
                            className="select"
                            multiple
                            size={Math.max(3, Math.min(6, columns.length))}
                            value={item.columns}
                            onChange={(event) => {
                              const selected = Array.from(
                                event.target.selectedOptions,
                                (option) => option.value,
                              );
                              updateIndex(index, { columns: selected });
                            }}
                          >
                            {columns
                              .filter((column) => column.name.trim().length > 0)
                              .map((column) => (
                                <option key={column.name} value={column.name.trim()}>
                                  {column.name.trim()}
                                </option>
                              ))}
                          </select>
                        </label>

                        <div className="field">
                          <span className="field__label">{t('designer.indexUnique')}</span>
                          <div className="checkbox-row">
                            <label className="checkbox">
                              <input
                                type="checkbox"
                                checked={item.unique}
                                onChange={(event) => {
                                  updateIndex(index, { unique: event.target.checked });
                                }}
                              />
                              <span>{t('designer.indexUnique')}</span>
                            </label>
                          </div>
                        </div>
                      </div>
                      <div className="designer__actions">
                        <Button
                          size="sm"
                          variant="danger"
                          icon="trash"
                          onClick={() => {
                            setIndexes((current) => current.filter((_, i) => i !== index));
                          }}
                        >
                          {t('designer.removeIndex')}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={ifNotExists}
                    onChange={(event) => {
                      setIfNotExists(event.target.checked);
                    }}
                  />
                  <span>{t('designer.ifNotExists')}</span>
                </label>
              </div>
            ) : null}

            {/* ---------------- 已有表 ---------------- */}
            {tab === 'manage' ? (
              <div className="designer__panel">
                <div className="toolbar">
                  <span className="card__subtitle-strong">{t('designer.tablesTitle')}</span>
                  <span className="designer__spacer" />
                  <Button
                    size="sm"
                    icon="refresh"
                    loading={tablesLoading}
                    onClick={() => {
                      void loadTables();
                    }}
                  >
                    {t('common.refresh')}
                  </Button>
                </div>

                {tablesError ? (
                  <div className="banner banner--danger" role="alert">
                    <Icon name="alert" size={16} />
                    <span>{tablesError}</span>
                  </div>
                ) : null}

                {tablesLoading && tables.length === 0 ? (
                  <p className="inline-loading">
                    <span className="spinner" aria-hidden="true" />
                    {t('designer.loading')}
                  </p>
                ) : tables.length === 0 ? (
                  <div className="empty-state">
                    <p className="text-muted">{t('designer.tablesEmpty')}</p>
                  </div>
                ) : (
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>{t('designer.tableName')}</th>
                          <th>{t('common.type')}</th>
                          <th>{t('common.columns')}</th>
                          <th>{t('common.actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tables.map((item) => {
                          const count = columnCounts[item.name];
                          return (
                            <tr key={item.name}>
                              <td className="mono">{item.name}</td>
                              <td>
                                <span className="badge badge--muted">{item.type}</span>
                              </td>
                              <td>
                                {count === undefined
                                  ? t('common.dash')
                                  : t('designer.tableColumnsCount', { values: { count } })}
                              </td>
                              <td>
                                <div className="row-actions">
                                  <Button
                                    size="sm"
                                    icon="eye"
                                    onClick={() => {
                                      // 需求指定：跳转到该表的数据页
                                      onNavigate('table');
                                    }}
                                  >
                                    {t('designer.viewData')}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="danger"
                                    icon="trash"
                                    onClick={() => {
                                      void dropTable(item.name);
                                    }}
                                  >
                                    {t('designer.dropTable')}
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}
          </section>

          <aside className="card designer__preview">
            <div className="card__header">
              <h2 className="card__title">{t('designer.previewTitle')}</h2>
            </div>

            {/* 这句提示必须一直在：预览本身永远不执行任何语句 */}
            <p className="text-muted designer__note">{t('designer.previewNotExecuted')}</p>

            {issueList}

            {previewError ? (
              <div className="banner banner--danger" role="alert">
                <Icon name="alert" size={16} />
                <span>
                  {t('designer.previewFailed', { values: { message: previewError } })}
                </span>
              </div>
            ) : null}

            {executeError ? (
              <div className="banner banner--danger" role="alert">
                <Icon name="alert" size={16} />
                <span>
                  {t('designer.executeFailed', { values: { message: executeError } })}
                </span>
              </div>
            ) : null}

            {preview === null ? (
              <div className="empty-state">
                <p className="text-muted">{t('designer.previewEmpty')}</p>
              </div>
            ) : (
              <>
                <p className="designer__count">
                  {t('designer.previewStatements', { values: { count: preview.statements.length } })}
                </p>
                <pre className="mono designer__statements">{preview.statements.join('\n\n')}</pre>
              </>
            )}

            {confirmingExecute && previewFresh ? (
              <div className="banner banner--warning" role="alert">
                <Icon name="alert" size={16} />
                <span>
                  {t('designer.executeConfirm', {
                    values: {
                      connection: connectionName,
                      count: preview?.statements.length ?? 0,
                    },
                  })}
                </span>
                <div className="designer__actions">
                  <Button
                    size="sm"
                    variant="primary"
                    icon="play"
                    loading={executing}
                    onClick={() => {
                      void execute();
                    }}
                  >
                    {t('designer.executeConfirmYes')}
                  </Button>
                  <Button
                    size="sm"
                    disabled={executing}
                    onClick={() => {
                      setConfirmingExecute(false);
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="designer__actions">
              <Button
                icon="refresh"
                loading={previewing}
                onClick={() => {
                  void generatePreview();
                }}
              >
                {t('designer.previewRefresh')}
              </Button>
              {/* 只有「当前表单已经生成过预览」时才允许进入执行确认 */}
              <Button
                variant="primary"
                icon="play"
                disabled={!previewFresh || executing}
                loading={executing}
                onClick={() => {
                  setConfirmingExecute(true);
                }}
              >
                {t('designer.execute')}
              </Button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
