/**
 * 花生苗数据库管理工具 - 看板页
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 页面职责：
 *  1. 列出 / 新建 / 删除看板；
 *  2. 打开看板时调用 `GET /dashboards/:id`，该接口会一并返回挂载的图表列表；
 *  3. 看板内每张图表各自调用 `GET /charts/:id/data` 取数并独立渲染，
 *     某张图失败不会影响其余图表（错误只在该卡片内展示）。
 */

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, describeError } from '../api/client';
import { chartApi, dashboardApi } from '../api/endpoints';
import type {
  ChartDTO,
  ChartDataDTO,
  DashboardDTO,
  DashboardDetailDTO,
  DashboardInput,
} from '../api/types';
import { Button, IconButton } from '../components/Button';
import { ChartRenderer, chartTypeLabel } from '../components/ChartRenderer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DataGrid } from '../components/DataGrid';
import type { DataGridColumn } from '../components/DataGrid';
import { Icon } from '../components/Icons';
import { Modal } from '../components/Modal';
import { useI18n } from '../state/i18n';
import { useToast } from '../state/toast';
import { resolveDashboardChartHeight, resolveDashboardColumns } from '../utils/dashboard';
import { optionalText } from '../utils/format';

/** 单张看板卡片：自己取数、自己报错，互不阻塞 */
function DashboardChartCard({ chart, height }: { chart: ChartDTO; height: number }) {
  const { t, localizeError } = useI18n();
  const [data, setData] = useState<ChartDataDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await chartApi.data(chart.id);
      setData(response);
    } catch (caught) {
      setData(null);
      setError(
        caught instanceof ApiError ? localizeError(caught) : describeError(caught, { t, localizeError }),
      );
    } finally {
      setLoading(false);
    }
  }, [chart.id, localizeError]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="card dashboard-chart">
      <div className="dashboard-chart__header">
        <div>
          <h3 className="card__title">{chart.name}</h3>
          <p className="card__subtitle">
            {chartTypeLabel(t, chart.chartType)} · {chart.sourceRef ?? t('viz.source.custom')}
          </p>
        </div>
        <IconButton
          icon="refresh"
          label={t('viz.dashboardChart.refresh')}
          disabled={loading}
          onClick={() => {
            void load();
          }}
        />
      </div>

      {error ? (
        <div className="banner banner--danger" role="alert">
          <Icon name="alert" size={16} />
          <span className="wrap-anywhere">{error}</span>
        </div>
      ) : null}

      {loading && data === null && !error ? (
        <div className="chart-loading">
          <span className="spinner" aria-hidden="true" />
          <span>{t('viz.dashboardChart.loading')}</span>
        </div>
      ) : null}

      {data ? <ChartRenderer data={data} height={height} /> : null}
    </section>
  );
}

interface DashboardFormProps {
  saving: boolean;
  onCancel: () => void;
  onSubmit: (input: DashboardInput) => void;
}

function DashboardForm({ saving, onCancel, onSubmit }: DashboardFormProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [columns, setColumns] = useState('2');
  const [isShared, setIsShared] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name.trim().length === 0) {
      setError(t('viz.dashboardForm.error.nameRequired'));
      return;
    }
    setError(null);
    const trimmedDescription = optionalText(description);
    onSubmit({
      name: name.trim(),
      description: trimmedDescription ?? null,
      layout: { columns: Number(columns) },
      isShared,
    });
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
        <span className="field__label">{t('viz.dashboardForm.name')}</span>
        <input
          className="input"
          type="text"
          value={name}
          disabled={saving}
          placeholder={t('viz.dashboardForm.namePlaceholder')}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </label>

      <label className="field">
        <span className="field__label">{t('viz.dashboardForm.columns')}</span>
        <select
          className="select"
          value={columns}
          disabled={saving}
          onChange={(event) => {
            setColumns(event.target.value);
          }}
        >
          <option value="1">{t('viz.dashboardForm.columns1')}</option>
          <option value="2">{t('viz.dashboardForm.columns2')}</option>
          <option value="3">{t('viz.dashboardForm.columns3')}</option>
          <option value="4">{t('viz.dashboardForm.columns4')}</option>
        </select>
        <span className="field__hint">{t('viz.dashboardForm.columnsHint')}</span>
      </label>

      <label className="field form-grid__full">
        <span className="field__label">{t('common.description')}</span>
        <textarea
          className="textarea"
          rows={2}
          value={description}
          disabled={saving}
          placeholder={t('viz.dashboardForm.descriptionPlaceholder')}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
      </label>

      <label className="field field--inline">
        <input
          type="checkbox"
          className="checkbox"
          checked={isShared}
          disabled={saving}
          onChange={(event) => {
            setIsShared(event.target.checked);
          }}
        />
        <span>
          {t('viz.dashboardForm.shared')}
          <small>{t('viz.dashboardForm.sharedHint')}</small>
        </span>
      </label>

      <div className="form-grid__actions form-grid__full">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" loading={saving} icon="check">
          {t('viz.dashboardForm.submit')}
        </Button>
      </div>
    </form>
  );
}

export function DashboardsPage() {
  const toast = useToast();
  const { t, formatDateTime, localizeError } = useI18n();
  const [items, setItems] = useState<DashboardDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DashboardDetailDTO | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DashboardDTO | null>(null);
  const [deleting, setDeleting] = useState(false);

  /** 服务端错误优先按 error.code 本地化，其余异常沿用 describeError 的原文 */
  const errorText = useCallback(
    (error: unknown): string =>
      error instanceof ApiError ? localizeError(error) : describeError(error, { t, localizeError }),
    [localizeError, t],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await dashboardApi.list();
      setItems(response.items);
    } catch (error) {
      toast.error(t('viz.dashboardError.loadList', { values: { message: errorText(error) } }));
    } finally {
      setLoading(false);
    }
  }, [toast, t, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDetail = useCallback(
    async (id: number) => {
      setDetailLoading(true);
      try {
        const response = await dashboardApi.get(id);
        setDetail(response);
      } catch (error) {
        setDetail(null);
        toast.error(t('viz.dashboardError.loadDetail', { values: { message: errorText(error) } }));
      } finally {
        setDetailLoading(false);
      }
    },
    [toast, t, errorText],
  );

  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  // 看板被删除后清理选中态，避免详情区停留在已不存在的看板
  useEffect(() => {
    if (selectedId !== null && !items.some((item) => item.id === selectedId)) {
      setSelectedId(null);
    }
  }, [items, selectedId]);

  const handleCreate = async (input: DashboardInput) => {
    setSaving(true);
    try {
      const created = await dashboardApi.create(input);
      toast.success(t('viz.dashboardToast.created', { values: { name: created.name } }));
      setModalOpen(false);
      await load();
      setSelectedId(created.id);
    } catch (error) {
      toast.error(t('viz.dashboardError.create', { values: { message: errorText(error) } }));
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
      await dashboardApi.remove(deleteTarget.id);
      toast.success(t('viz.dashboardToast.deleted', { values: { name: deleteTarget.name } }));
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast.error(t('viz.dashboardError.delete', { values: { message: errorText(error) } }));
    } finally {
      setDeleting(false);
    }
  };

  const columns: Array<DataGridColumn<DashboardDTO>> = [
    {
      key: 'name',
      header: t('viz.dashboardList.name'),
      render: (row) => (
        <span className="cell-stack cell-stack--row">
          <strong>{row.name}</strong>
          {row.isShared ? <span className="badge badge--info">{t('viz.dashboardList.shared')}</span> : null}
        </span>
      ),
    },
    {
      key: 'description',
      header: t('common.description'),
      render: (row) => (
        <span className="truncate-cell" title={row.description ?? ''}>
          {row.description ?? t('common.dash')}
        </span>
      ),
    },
    {
      key: 'layout',
      header: t('viz.dashboardList.columns'),
      width: '80px',
      render: (row) => <span className="mono">{resolveDashboardColumns(row.layout)}</span>,
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
            label={t('viz.dashboardList.open')}
            active={selectedId === row.id}
            onClick={(event) => {
              event.stopPropagation();
              setSelectedId(row.id);
            }}
          />
          <IconButton
            icon="trash"
            label={t('viz.dashboardDelete.title')}
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

  const gridColumns = detail ? resolveDashboardColumns(detail.layout) : 2;
  const chartHeight = resolveDashboardChartHeight(gridColumns);

  return (
    <div className="page">
      <section className="toolbar">
        <div className="toolbar__group">
          <span className="toolbar__count">
            {t('viz.dashboardToolbar.count', { count: items.length })}
          </span>
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
            {t('viz.dashboardToolbar.new')}
          </Button>
        </div>
      </section>

      <div className="charts-layout">
        <section className="pane charts-layout__list">
          <div className="pane__header">
            <span>{t('viz.dashboardList.title')}</span>
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
              emptyText={t('viz.dashboardList.empty')}
              emptyHint={t('viz.dashboardList.emptyHint')}
            />
          </div>
        </section>

        <section className="dashboards-detail">
          {detail === null ? (
            <div className="card">
              <div className="empty-state">
                <Icon name="dashboard" size={26} />
                <h3>{t('viz.dashboardPreview.emptyTitle')}</h3>
                <p>{t('viz.dashboardPreview.emptyHint')}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="card dashboard-detail__header">
                <div>
                  <h2 className="card__title">
                    {detail.name}
                    {detail.isShared ? (
                      <span className="badge badge--info">{t('viz.dashboardList.shared')}</span>
                    ) : null}
                  </h2>
                  <p className="card__subtitle">
                    {t('viz.dashboardMeta', {
                      values: {
                        description: detail.description ?? t('viz.dashboardPreview.noDescription'),
                        charts: detail.charts.length,
                        columns: gridColumns,
                      },
                    })}
                  </p>
                </div>
                <div className="card__actions">
                  <Button
                    size="sm"
                    icon="refresh"
                    loading={detailLoading}
                    onClick={() => {
                      if (selectedId !== null) {
                        void loadDetail(selectedId);
                      }
                    }}
                  >
                    {t('viz.dashboardPreview.refresh')}
                  </Button>
                </div>
              </div>

              {detail.charts.length === 0 ? (
                <div className="card">
                  <div className="empty-state">
                    <Icon name="chart" size={26} />
                    <h3>{t('viz.dashboardPreview.noChartsTitle')}</h3>
                    <p>{t('viz.dashboardPreview.noChartsHint', { values: { name: detail.name } })}</p>
                  </div>
                </div>
              ) : (
                <div
                  className="dashboard-grid"
                  style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}
                >
                  {detail.charts.map((chart) => (
                    <DashboardChartCard key={chart.id} chart={chart} height={chartHeight} />
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <Modal
        open={modalOpen}
        title={t('viz.dashboardToolbar.new')}
        description={t('viz.dashboardCreate.description')}
        onClose={() => {
          setModalOpen(false);
        }}
        width={620}
      >
        {modalOpen ? (
          <DashboardForm
            saving={saving}
            onCancel={() => {
              setModalOpen(false);
            }}
            onSubmit={(input) => {
              void handleCreate(input);
            }}
          />
        ) : null}
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('viz.dashboardDelete.title')}
        message={
          deleteTarget
            ? t('viz.dashboardDelete.message', { values: { name: deleteTarget.name } })
            : ''
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
