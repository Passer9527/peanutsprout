/**
 * 花生苗数据库管理工具 - 图表管理页
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 页面职责：
 *  1. 列出已保存图表，选中后调用 `GET /charts/:id/data` 拉取真实数据并渲染；
 *  2. 通过表单创建图表（连接 → 来源表 → 图表类型 → 维度/指标/聚合）；
 *  3. 展示服务端生成的取数 SQL —— 图表配置最终会变成什么 SQL，用户有权看到。
 *
 * 注意：图表 SQL 由服务端按结构化配置生成（字段名白名单 + 聚合枚举），
 * 前端不做任何 SQL 拼接，避免把注入面搬到浏览器里。
 */

import type { MessageKey } from '@peanutsprout/i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, describeError } from '../api/client';
import { chartApi, connectionsApi, dashboardApi, metaApi } from '../api/endpoints';
import type {
  ChartAggregation,
  ChartConfigDTO,
  ChartDTO,
  ChartDataDTO,
  ChartFieldDTO,
  ChartInput,
  ChartTypeInfoDTO,
  ConnectionDTO,
  DashboardDTO,
  DbTypeDTO,
  SchemaDTO,
  TableDTO,
} from '../api/types';
import { Button, IconButton } from '../components/Button';
import { ChartRenderer, chartTypeDescription, chartTypeLabel } from '../components/ChartRenderer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DataGrid } from '../components/DataGrid';
import type { DataGridColumn } from '../components/DataGrid';
import { Icon } from '../components/Icons';
import { Modal } from '../components/Modal';
import { useI18n } from '../state/i18n';
import { useToast } from '../state/toast';
import { formatDuration, optionalText, sqlPreview } from '../utils/format';
const AGGREGATIONS: Array<{ value: ChartAggregation; labelKey: MessageKey }> = [
  { value: 'none', labelKey: 'viz.aggregation.none' },
  { value: 'sum', labelKey: 'viz.aggregation.sum' },
  { value: 'avg', labelKey: 'viz.aggregation.avg' },
  { value: 'count', labelKey: 'viz.aggregation.count' },
  { value: 'count_distinct', labelKey: 'viz.aggregation.countDistinct' },
  { value: 'min', labelKey: 'viz.aggregation.min' },
  { value: 'max', labelKey: 'viz.aggregation.max' },
  // 不再提供「中位数」：服务端尚未实现 median（旧版会用 AVG 冒充），
  // 选了只会得到错误数据，因此从下拉项中移除；服务端校验也会明确拒绝。
];

interface FieldRow {
  column: string;
  aggregation: ChartAggregation;
  alias: string;
}

interface ChartFormState {
  name: string;
  chartType: string;
  connectionId: string;
  schema: string;
  sourceRef: string;
  dashboardId: string;
  dimensions: FieldRow[];
  metrics: FieldRow[];
}

function emptyField(aggregation: ChartAggregation): FieldRow {
  return { column: '', aggregation, alias: '' };
}

function emptyChartForm(): ChartFormState {
  return {
    name: '',
    chartType: 'column',
    connectionId: '',
    schema: '',
    sourceRef: '',
    dashboardId: '',
    dimensions: [emptyField('none')],
    metrics: [emptyField('sum')],
  };
}

/** 把表单字段转成契约要求的 ChartFieldDTO，丢掉空列名与空别名 */
function toChartFields(rows: FieldRow[]): ChartFieldDTO[] {
  const fields: ChartFieldDTO[] = [];
  for (const row of rows) {
    const column = row.column.trim();
    if (column.length === 0) {
      continue;
    }
    const alias = optionalText(row.alias);
    fields.push(alias === undefined ? { column, aggregation: row.aggregation } : { column, aggregation: row.aggregation, alias });
  }
  return fields;
}

interface FieldRowsEditorProps {
  title: string;
  hint: string;
  rows: FieldRow[];
  addAggregation: ChartAggregation;
  disabled: boolean;
  onChange: (rows: FieldRow[]) => void;
}

/** 维度/指标行编辑器：列名 + 聚合方式 + 可选别名 */
function FieldRowsEditor({ title, hint, rows, addAggregation, disabled, onChange }: FieldRowsEditorProps) {
  const { t } = useI18n();
  return (
    <div className="field form-grid__full">
      <span className="field__label">{title}</span>
      <span className="field__hint">{hint}</span>
      <div className="field-rows">
        {rows.map((row, index) => (
          <div className="field-row" key={`${title}-${index}`}>
            <input
              className="input input--sm mono"
              type="text"
              value={row.column}
              disabled={disabled}
              placeholder={t('viz.field.columnPlaceholder')}
              onChange={(event) => {
                const next = rows.slice();
                next[index] = { ...row, column: event.target.value };
                onChange(next);
              }}
            />
            <select
              className="select input--sm"
              value={row.aggregation}
              disabled={disabled}
              onChange={(event) => {
                const next = rows.slice();
                next[index] = { ...row, aggregation: event.target.value as ChartAggregation };
                onChange(next);
              }}
            >
              {AGGREGATIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {t(item.labelKey)}
                </option>
              ))}
            </select>
            <input
              className="input input--sm mono"
              type="text"
              value={row.alias}
              disabled={disabled}
              placeholder={t('viz.field.aliasPlaceholder')}
              onChange={(event) => {
                const next = rows.slice();
                next[index] = { ...row, alias: event.target.value };
                onChange(next);
              }}
            />
            <IconButton
              icon="trash"
              label={t('viz.field.remove')}
              disabled={disabled || rows.length <= 1}
              onClick={() => {
                onChange(rows.filter((_item, rowIndex) => rowIndex !== index));
              }}
            />
          </div>
        ))}
      </div>
      <div>
        <Button
          size="sm"
          icon="plus"
          disabled={disabled}
          onClick={() => {
            onChange([...rows, emptyField(addAggregation)]);
          }}
        >
          {t('viz.field.add')}
        </Button>
      </div>
    </div>
  );
}

interface ChartFormProps {
  types: ChartTypeInfoDTO[];
  connections: ConnectionDTO[];
  dashboards: DashboardDTO[];
  saving: boolean;
  onCancel: () => void;
  onSubmit: (state: ChartFormState) => void;
}

function ChartForm({ types, connections, dashboards, saving, onCancel, onSubmit }: ChartFormProps) {
  const { t } = useI18n();
  const [form, setForm] = useState<ChartFormState>(emptyChartForm);
  const [error, setError] = useState<string | null>(null);
  const [schemas, setSchemas] = useState<SchemaDTO[]>([]);
  const [tables, setTables] = useState<TableDTO[]>([]);

  const update = (patch: Partial<ChartFormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const selectedType = useMemo(
    () => types.find((item) => item.type === form.chartType) ?? null,
    [types, form.chartType],
  );

  // 切换连接后重新读取 Schema；Schema 只用于浏览表名，取数 SQL 的 Schema 由服务端决定
  useEffect(() => {
    const raw = form.connectionId;
    if (raw.length === 0) {
      setSchemas([]);
      setTables([]);
      return;
    }
    let cancelled = false;
    connectionsApi
      .schemas(Number(raw))
      .then((response) => {
        if (!cancelled) {
          setSchemas(response.items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSchemas([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [form.connectionId]);

  // 选定 Schema 后拉表名，供 datalist 选择；也允许直接手输表名
  useEffect(() => {
    const connectionRaw = form.connectionId;
    const schema = form.schema;
    if (connectionRaw.length === 0 || schema.length === 0) {
      setTables([]);
      return;
    }
    let cancelled = false;
    connectionsApi
      .tables(Number(connectionRaw), schema)
      .then((response) => {
        if (!cancelled) {
          setTables(response.items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTables([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [form.connectionId, form.schema]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (form.name.trim().length === 0) {
      setError(t('viz.form.error.nameRequired'));
      return;
    }
    if (form.connectionId.length === 0) {
      setError(t('viz.form.error.connectionRequired'));
      return;
    }
    if (form.sourceRef.trim().length === 0) {
      setError(t('viz.form.error.sourceRequired'));
      return;
    }
    const dimensions = toChartFields(form.dimensions);
    const metrics = toChartFields(form.metrics);
    if (selectedType) {
      const typeLabel = chartTypeLabel(t, selectedType.type, selectedType.label);
      if (dimensions.length < selectedType.minDimensions) {
        setError(
          t('viz.form.error.minDimensions', {
            values: { type: typeLabel, need: selectedType.minDimensions, got: dimensions.length },
          }),
        );
        return;
      }
      if (metrics.length < selectedType.minMetrics) {
        setError(
          t('viz.form.error.minMetrics', {
            values: { type: typeLabel, need: selectedType.minMetrics, got: metrics.length },
          }),
        );
        return;
      }
    } else if (dimensions.length === 0 && metrics.length === 0) {
      setError(t('viz.form.error.fieldRequired'));
      return;
    }
    setError(null);
    onSubmit(form);
  };

  return (
    <form className="form-grid" onSubmit={handleSubmit} noValidate>
      {error ? (
        <div className="banner banner--danger form-grid__full" role="alert">
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      <label className="field">
        <span className="field__label">{t('viz.form.name')}</span>
        <input
          className="input"
          type="text"
          value={form.name}
          disabled={saving}
          placeholder={t('viz.form.namePlaceholder')}
          onChange={(event) => {
            update({ name: event.target.value });
          }}
        />
      </label>

      <label className="field">
        <span className="field__label">{t('viz.form.chartType')}</span>
        <select
          className="select"
          value={form.chartType}
          disabled={saving}
          onChange={(event) => {
            update({ chartType: event.target.value });
          }}
        >
          {types.length === 0 ? <option value={form.chartType}>{form.chartType}</option> : null}
          {types.map((item) => (
            <option key={item.type} value={item.type}>
              {t('viz.form.typeOption', {
                values: { label: chartTypeLabel(t, item.type, item.label), code: item.type },
              })}
            </option>
          ))}
        </select>
        {selectedType ? (
          <span className="field__hint">
            {t('viz.form.typeHint', {
              values: {
                description: chartTypeDescription(t, selectedType.type, selectedType.description),
                dimensions: selectedType.minDimensions,
                metrics: selectedType.minMetrics,
              },
            })}
          </span>
        ) : null}
      </label>

      <label className="field">
        <span className="field__label">{t('viz.form.connection')}</span>
        <select
          className="select"
          value={form.connectionId}
          disabled={saving}
          onChange={(event) => {
            update({ connectionId: event.target.value, schema: '', sourceRef: '' });
          }}
        >
          <option value="">{t('viz.form.connectionPlaceholder')}</option>
          {connections.map((item) => (
            <option key={item.id} value={item.id}>
              {t('viz.form.connectionOption', { values: { name: item.name, type: item.dbType } })}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field__label">{t('viz.form.dashboard')}</span>
        <select
          className="select"
          value={form.dashboardId}
          disabled={saving}
          onChange={(event) => {
            update({ dashboardId: event.target.value });
          }}
        >
          <option value="">{t('viz.form.dashboardNone')}</option>
          {dashboards.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field__label">{t('viz.form.schema')}</span>
        <select
          className="select"
          value={form.schema}
          disabled={saving || schemas.length === 0}
          onChange={(event) => {
            update({ schema: event.target.value });
          }}
        >
          <option value="">
            {schemas.length === 0 ? t('viz.form.schemaDisabled') : t('viz.form.schemaPlaceholder')}
          </option>
          {schemas.map((item) => (
            <option key={item.name} value={item.name}>
              {item.name}
            </option>
          ))}
        </select>
        <span className="field__hint">{t('viz.form.schemaHint')}</span>
      </label>

      <label className="field">
        <span className="field__label">{t('viz.form.source')}</span>
        <input
          className="input mono"
          type="text"
          list="chart-source-tables"
          value={form.sourceRef}
          disabled={saving}
          placeholder="orders"
          onChange={(event) => {
            update({ sourceRef: event.target.value });
          }}
        />
        <datalist id="chart-source-tables">
          {tables.map((item) => (
            <option key={item.name} value={item.name}>
              {item.type}
              {item.comment ? ` · ${item.comment}` : ''}
            </option>
          ))}
        </datalist>
        <span className="field__hint">
          {tables.length > 0
            ? t('viz.form.sourceHintCount', { count: tables.length })
            : t('viz.form.sourceHint')}
        </span>
      </label>

      <FieldRowsEditor
        title={t('viz.form.dimensions')}
        hint={t('viz.form.dimensionsHint')}
        rows={form.dimensions}
        addAggregation="none"
        disabled={saving}
        onChange={(rows) => {
          update({ dimensions: rows });
        }}
      />

      <FieldRowsEditor
        title={t('viz.form.metrics')}
        hint={t('viz.form.metricsHint')}
        rows={form.metrics}
        addAggregation="sum"
        disabled={saving}
        onChange={(rows) => {
          update({ metrics: rows });
        }}
      />

      <div className="form-grid__actions form-grid__full">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" loading={saving} icon="check">
          {t('viz.form.submit')}
        </Button>
      </div>
    </form>
  );
}

/** 把表单状态收敛成 POST /charts 的请求体 */
function buildChartInput(state: ChartFormState): ChartInput {
  const config: ChartConfigDTO = {
    dimensions: toChartFields(state.dimensions),
    metrics: toChartFields(state.metrics),
  };
  const input: ChartInput = {
    name: state.name.trim(),
    chartType: state.chartType,
    connectionId: Number(state.connectionId),
    dataSource: 'table',
    sourceRef: state.sourceRef.trim(),
    config,
  };
  if (state.dashboardId.length > 0) {
    input.dashboardId = Number(state.dashboardId);
  }
  return input;
}

export function ChartsPage() {
  const toast = useToast();
  const { t, formatDateTime, localizeError } = useI18n();
  const [items, setItems] = useState<ChartDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [data, setData] = useState<ChartDataDTO | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const [types, setTypes] = useState<ChartTypeInfoDTO[]>([]);
  const [connections, setConnections] = useState<ConnectionDTO[]>([]);
  const [dashboards, setDashboards] = useState<DashboardDTO[]>([]);
  const [dbTypes, setDbTypes] = useState<DbTypeDTO[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ChartDTO | null>(null);
  const [deleting, setDeleting] = useState(false);

  /** 服务端错误优先按 error.code 本地化，其余异常沿用 describeError 的原文 */
  const errorText = useCallback(
    (error: unknown): string =>
      error instanceof ApiError ? localizeError(error) : describeError(error, { t, localizeError }),
    [localizeError],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await chartApi.list();
      setItems(response.items);
    } catch (error) {
      toast.error(t('viz.error.loadList', { values: { message: errorText(error) } }));
    } finally {
      setLoading(false);
    }
  }, [toast, t, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    // 四个接口相互独立：用 allSettled，避免其中一个失败导致整个新建表单不可用
    const loadMeta = async () => {
      const results = await Promise.allSettled([
        chartApi.types(),
        connectionsApi.list(),
        dashboardApi.list(),
        metaApi.dbTypes(),
      ]);
      if (cancelled) {
        return;
      }
      const [typeResult, connectionResult, dashboardResult, dbTypeResult] = results;
      if (typeResult.status === 'fulfilled') {
        setTypes(typeResult.value.items);
      }
      if (connectionResult.status === 'fulfilled') {
        setConnections(connectionResult.value.items);
      }
      if (dashboardResult.status === 'fulfilled') {
        setDashboards(dashboardResult.value.items);
      }
      if (dbTypeResult.status === 'fulfilled') {
        setDbTypes(dbTypeResult.value.items);
      }
      const failed = results.find((result) => result.status === 'rejected');
      if (failed && failed.status === 'rejected') {
        toast.error(
          t('viz.error.loadMeta', { values: { message: errorText(failed.reason as unknown) } }),
        );
      }
    };
    void loadMeta();
    return () => {
      cancelled = true;
    };
  }, [toast, t, errorText]);

  /**
   * 取数请求序号：快速切换图表时，旧请求可能后返回并覆盖新图的数据/错误，
   * 出现"界面显示的图与当前选择不符"。只用最后一次请求的响应收尾。
   */
  const dataSeq = useRef(0);

  const loadData = useCallback(
    async (id: number) => {
      const seq = (dataSeq.current += 1);
      setDataLoading(true);
      setDataError(null);
      try {
        const response = await chartApi.data(id);
        if (seq !== dataSeq.current) return; // 已切换到别的图表，丢弃过期数据
        setData(response);
      } catch (error) {
        if (seq !== dataSeq.current) return;
        setData(null);
        setDataError(errorText(error));
      } finally {
        // loading 由最新一次请求负责收尾，避免旧请求提前关掉转圈
        if (seq === dataSeq.current) setDataLoading(false);
      }
    },
    [errorText],
  );

  useEffect(() => {
    if (selectedId === null) {
      // 作废在途取数，否则已清空的预览会被旧响应重新填上
      dataSeq.current += 1;
      setData(null);
      setDataError(null);
      setDataLoading(false);
      return;
    }
    void loadData(selectedId);
  }, [selectedId, loadData]);

  // 列表刷新后同步选中项：被删掉的图表要清空预览
  useEffect(() => {
    if (selectedId !== null && !items.some((item) => item.id === selectedId)) {
      setSelectedId(null);
    }
  }, [items, selectedId]);

  const connectionNameOf = useCallback(
    (id: number | null): string => {
      if (id === null) {
        return t('viz.connection.unbound');
      }
      const found = connections.find((item) => item.id === id);
      return found ? found.name : `#${id}`;
    },
    [connections, t],
  );

  const typeLabelOf = useCallback(
    (type: string): string => {
      const found = types.find((item) => item.type === type);
      return chartTypeLabel(t, type, found?.label);
    },
    [types, t],
  );

  const defaultSchemaHint = useMemo(() => {
    if (selectedId === null) {
      return null;
    }
    const chart = items.find((item) => item.id === selectedId);
    if (!chart || chart.connectionId === null) {
      return null;
    }
    const connection = connections.find((item) => item.id === chart.connectionId);
    if (!connection) {
      return null;
    }
    const info = dbTypes.find((item) => item.dbType === connection.dbType);
    // 后端 /meta/db-types 不下发 defaultSchema（DriverDescriptor 没有该字段），
    // 因此优先用连接自身的库名作为 Schema 提示，取不到时回退到「由数据库决定」。
    return t('viz.schemaHint.line', {
      values: {
        type: info?.label ?? connection.dbType,
        schema: connection.databaseName ?? t('viz.schemaHint.unknown'),
      },
    });
  }, [selectedId, items, connections, dbTypes, t]);

  const handleCreate = async (state: ChartFormState) => {
    setSaving(true);
    try {
      const created = await chartApi.create(buildChartInput(state));
      toast.success(t('viz.toast.created', { values: { name: created.name } }));
      setModalOpen(false);
      await load();
      setSelectedId(created.id);
    } catch (error) {
      toast.error(t('viz.error.create', { values: { message: errorText(error) } }));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    setDeleting(true);
    try {
      await chartApi.remove(deleteTarget.id);
      toast.success(t('viz.toast.deleted', { values: { name: deleteTarget.name } }));
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast.error(t('viz.error.delete', { values: { message: errorText(error) } }));
    } finally {
      setDeleting(false);
    }
  };

  const columns: Array<DataGridColumn<ChartDTO>> = [
    {
      key: 'name',
      header: t('viz.list.name'),
      render: (row) => (
        <span className="cell-stack">
          <strong>{row.name}</strong>
          <small className="text-muted">{typeLabelOf(row.chartType)}</small>
        </span>
      ),
    },
    {
      key: 'source',
      header: t('viz.list.source'),
      width: '180px',
      render: (row) => (
        <span className="cell-stack">
          <span className="mono truncate-cell" title={row.sourceRef ?? row.querySql ?? ''}>
            {row.sourceRef ?? sqlPreview(row.querySql, 24)}
          </span>
          <small className="text-muted">{connectionNameOf(row.connectionId)}</small>
        </span>
      ),
    },
    {
      key: 'updatedAt',
      header: t('common.updatedAt'),
      width: '150px',
      render: (row) => <span className="mono">{formatDateTime(row.updatedAt)}</span>,
    },
    {
      key: 'actions',
      header: t('common.actions'),
      width: '96px',
      align: 'right',
      render: (row) => (
        <span className="row-actions">
          <IconButton
            icon="play"
            label={t('viz.list.render')}
            active={selectedId === row.id}
            onClick={(event) => {
              event.stopPropagation();
              setSelectedId(row.id);
            }}
          />
          <IconButton
            icon="trash"
            label={t('viz.delete.title')}
            variant="danger"
            onClick={(event) => {
              event.stopPropagation();
              setDeleteTarget(row);
            }}
          />
        </span>
      ),
    },
  ];

  const selectedChart = items.find((item) => item.id === selectedId) ?? null;

  return (
    <div className="page">
      <section className="toolbar">
        <div className="toolbar__group">
          <span className="toolbar__count">{t('viz.toolbar.count', { count: items.length })}</span>
        </div>
        <div className="toolbar__group">
          <Button icon="refresh" disabled={loading} onClick={() => void load()}>
            {t('viz.refreshList')}
          </Button>
          <Button
            icon="plus"
            variant="primary"
            onClick={() => {
              setModalOpen(true);
            }}
          >
            {t('viz.create.title')}
          </Button>
        </div>
      </section>

      <div className="charts-layout">
        <section className="pane charts-layout__list">
          <div className="pane__header">
            <span>{t('viz.list.title')}</span>
            <span>{items.length}</span>
          </div>
          <div className="pane__body pane__body--flush">
            <DataGrid
              columns={columns}
              rows={items}
              loading={loading}
              rowKey={(row) => String(row.id)}
              onRowClick={(row) => {
                setSelectedId(row.id);
              }}
              selectedKey={selectedId === null ? null : String(selectedId)}
              maxHeight="calc(100vh - 280px)"
              emptyText={t('viz.list.empty')}
              emptyHint={t('viz.list.emptyHint')}
            />
          </div>
        </section>

        <section className="card charts-layout__preview">
          {selectedChart === null ? (
            <div className="empty-state">
              <Icon name="chart" size={26} />
              <h3>{t('viz.preview.emptyTitle')}</h3>
              <p>
                {t('viz.preview.emptyHintPrefix')}
                <span className="mono">GET /charts/:id/data</span>
                {t('viz.preview.emptyHintSuffix')}
              </p>
            </div>
          ) : (
            <>
              <div className="chart-preview__header">
                <div>
                  <h2 className="card__title">{selectedChart.name}</h2>
                  <p className="card__subtitle">
                    {typeLabelOf(selectedChart.chartType)} · {selectedChart.sourceRef ?? t('viz.source.custom')} ·{' '}
                    {connectionNameOf(selectedChart.connectionId)}
                    {defaultSchemaHint ? ` · ${defaultSchemaHint}` : ''}
                  </p>
                </div>
                <div className="card__actions">
                  <Button
                    size="sm"
                    icon="refresh"
                    loading={dataLoading}
                    onClick={() => {
                      if (selectedId !== null) {
                        void loadData(selectedId);
                      }
                    }}
                  >
                    {t('viz.preview.reload')}
                  </Button>
                </div>
              </div>

              {dataError ? (
                <div className="banner banner--danger" role="alert">
                  <Icon name="alert" size={16} />
                  <span className="wrap-anywhere">{dataError}</span>
                </div>
              ) : null}

              {dataLoading && data === null ? (
                <div className="chart-loading">
                  <span className="spinner" aria-hidden="true" />
                  <span>{t('viz.preview.loading')}</span>
                </div>
              ) : null}

              {data ? <ChartRenderer data={data} /> : null}

              {data ? (
                <details className="chart-sql">
                  <summary>{t('viz.preview.sqlSummary')}</summary>
                  <pre className="code-block">{data.sql}</pre>
                  <p className="field__hint">
                    {data.truncated
                      ? t('viz.preview.sqlMetaTruncated', {
                          values: { duration: formatDuration(data.durationMs), count: data.rowCount },
                        })
                      : t('viz.preview.sqlMeta', {
                          values: { duration: formatDuration(data.durationMs), count: data.rowCount },
                        })}
                  </p>
                </details>
              ) : null}
            </>
          )}
        </section>
      </div>

      <Modal
        open={modalOpen}
        title={t('viz.create.title')}
        description={t('viz.create.description')}
        onClose={() => {
          setModalOpen(false);
        }}
        width={860}
      >
        {modalOpen ? (
          <ChartForm
            types={types}
            connections={connections}
            dashboards={dashboards}
            saving={saving}
            onCancel={() => {
              setModalOpen(false);
            }}
            onSubmit={(state) => {
              void handleCreate(state);
            }}
          />
        ) : null}
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('viz.delete.title')}
        message={
          deleteTarget ? t('viz.delete.message', { values: { name: deleteTarget.name } }) : ''
        }
        confirmText={t('common.delete')}
        danger
        loading={deleting}
        onCancel={() => {
          setDeleteTarget(null);
        }}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
