import type { MessageKey } from '@peanutsprout/i18n';
import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '../api/client';
import { auditApi } from '../api/endpoints';
import type { AuditLogDTO, AuditVerifyDTO } from '../api/types';
import { Button } from '../components/Button';
import { DataGrid } from '../components/DataGrid';
import type { DataGridColumn } from '../components/DataGrid';
import { Icon } from '../components/Icons';
import { Modal } from '../components/Modal';
import { useI18n } from '../state/i18n';
import { useToast } from '../state/toast';
import { classNames, sqlPreview, truncate } from '../utils/format';

const PAGE_SIZES = [20, 50, 100];

/**
 * 服务端的审计动作是稳定 code（`action` 字段），展示名一律查 meta 的
 * `auditAction.*`，这样切换语言后动作列会跟着翻译。
 * 表里没有的 code（后续新增动作 / 自定义动作）回退到服务端原文，
 * 至少不会把键名直接显示给用户。
 */
const AUDIT_ACTION_KEYS: Record<string, MessageKey> = {
  login: 'auditAction.login',
  logout: 'auditAction.logout',
  login_failed: 'auditAction.login_failed',
  connect: 'auditAction.connect',
  disconnect: 'auditAction.disconnect',
  execute: 'auditAction.execute',
  migrate: 'auditAction.migrate',
  import: 'auditAction.import',
  export: 'auditAction.export',
  ai: 'auditAction.ai',
  user_create: 'auditAction.user_create',
  user_update: 'auditAction.user_update',
  user_delete: 'auditAction.user_delete',
  connection_create: 'auditAction.connection_create',
  connection_update: 'auditAction.connection_update',
  connection_delete: 'auditAction.connection_delete',
  settings_update: 'auditAction.settings_update',
  audit_verify: 'auditAction.audit_verify',
};

/** 审计结果是稳定 code（`status` 字段），展示名查 meta 的 `auditResult.*`。 */
const AUDIT_RESULT_KEYS: Record<string, MessageKey> = {
  success: 'auditResult.success',
  failure: 'auditResult.failure',
  denied: 'auditResult.denied',
};

function statusBadgeClass(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === 'success' || normalized === 'ok' || normalized === 'succeeded') {
    return 'badge badge--success';
  }
  if (normalized === 'failure' || normalized === 'failed' || normalized === 'error') {
    return 'badge badge--danger';
  }
  return 'badge badge--muted';
}

/** 动作 code → 当前语言展示名；未收录的 code 回退服务端原文。 */
function auditActionLabel(action: string, t: (key: MessageKey) => string): string {
  const key = AUDIT_ACTION_KEYS[action];
  return key ? t(key) : action;
}

/** 结果 code → 当前语言展示名；未收录的 code 回退服务端原文。 */
function auditResultLabel(status: string, t: (key: MessageKey) => string): string {
  const key = AUDIT_RESULT_KEYS[status.toLowerCase()];
  return key ? t(key) : status;
}

/** 把任意异常收敛成 localizeError 能识别的形状（ApiError 自带稳定 error.code）。 */
function localizable(error: unknown): { code?: string; message?: string } {
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: String(error) };
}

export function AuditPage() {
  const { t, formatDateTime, formatNumber, localizeError } = useI18n();
  const toast = useToast();
  const [items, setItems] = useState<AuditLogDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [actionInput, setActionInput] = useState('');
  const [userIdInput, setUserIdInput] = useState('');
  const [appliedAction, setAppliedAction] = useState('');
  const [appliedUserId, setAppliedUserId] = useState('');
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);

  const [verifyResult, setVerifyResult] = useState<AuditVerifyDTO | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [detail, setDetail] = useState<AuditLogDTO | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const userId = appliedUserId.trim().length > 0 ? Number(appliedUserId.trim()) : undefined;
      const response = await auditApi.logs({
        limit,
        offset,
        action: appliedAction.trim().length > 0 ? appliedAction.trim() : undefined,
        userId: userId !== undefined && Number.isFinite(userId) ? userId : undefined,
      });
      setItems(response.items);
      setTotal(typeof response.total === 'number' ? response.total : response.items.length);
    } catch (error) {
      toast.error(
        t('admin.audit.loadFailed', { values: { message: localizeError(localizable(error)) } }),
      );
    } finally {
      setLoading(false);
    }
  }, [appliedAction, appliedUserId, limit, offset, localizeError, t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const result = await auditApi.verify();
      setVerifyResult(result);
      if (result.ok) {
        toast.success(t('admin.audit.verifyOk', { count: result.checked }));
      } else {
        toast.error(
          t('admin.audit.verifyBroken', {
            values: { position: result.brokenAt ?? t('common.unknown') },
          }),
        );
      }
    } catch (error) {
      toast.error(
        t('admin.audit.verifyFailed', { values: { message: localizeError(localizable(error)) } }),
      );
    } finally {
      setVerifying(false);
    }
  };

  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const canPrev = offset > 0 && !loading;
  const canNext = offset + limit < total && !loading;

  const columns: Array<DataGridColumn<AuditLogDTO>> = [
    {
      key: 'createdAt',
      header: t('admin.audit.column.time'),
      width: '170px',
      render: (row) => <span className="mono">{formatDateTime(row.createdAt)}</span>,
    },
    {
      key: 'username',
      header: t('admin.audit.column.user'),
      width: '120px',
      render: (row) =>
        row.username ?? <span className="text-muted">{t('admin.audit.anonymous')}</span>,
    },
    {
      key: 'action',
      header: t('admin.audit.action'),
      width: '150px',
      render: (row) => <span className="badge badge--info">{auditActionLabel(row.action, t)}</span>,
    },
    {
      key: 'resource',
      header: t('admin.audit.column.resource'),
      width: '160px',
      render: (row) =>
        row.resourceType ? (
          <span className="mono">
            {row.resourceType}
            {row.resourceId ? `#${row.resourceId}` : ''}
          </span>
        ) : (
          <span className="text-muted">{t('common.dash')}</span>
        ),
    },
    {
      key: 'connectionId',
      header: t('admin.audit.column.connection'),
      width: '80px',
      align: 'right',
      render: (row) =>
        row.connectionId === null ? (
          <span className="text-muted">{t('common.dash')}</span>
        ) : (
          `#${row.connectionId}`
        ),
    },
    {
      key: 'status',
      header: t('common.status'),
      width: '100px',
      render: (row) => (
        <span className={statusBadgeClass(row.status)}>{auditResultLabel(row.status, t)}</span>
      ),
    },
    {
      key: 'sqlText',
      header: t('admin.audit.column.sqlDetail'),
      render: (row) => (
        <button
          type="button"
          className={classNames('link-btn', !row.sqlText && 'link-btn--muted')}
          onClick={() => {
            setDetail(row);
          }}
          title={row.sqlText ?? row.errorMessage ?? t('admin.audit.noExtraInfo')}
        >
          {row.sqlText
            ? sqlPreview(row.sqlText, 70)
            : row.errorMessage
              ? truncate(row.errorMessage, 70)
              : t('admin.audit.viewDetail')}
        </button>
      ),
    },
    {
      key: 'ipAddress',
      header: t('admin.audit.column.ip'),
      width: '130px',
      render: (row) => <span className="mono">{row.ipAddress ?? t('common.dash')}</span>,
    },
    {
      key: 'currHash',
      header: t('admin.audit.column.hash'),
      width: '110px',
      render: (row) => (
        <span className="mono text-muted" title={row.currHash ?? t('admin.audit.noHash')}>
          {row.currHash ? `${row.currHash.slice(0, 10)}…` : t('common.dash')}
        </span>
      ),
    },
  ];

  return (
    <div className="page">
      <section className="toolbar">
        <div className="toolbar__group">
          <label className="toolbar__field">
            <span>{t('admin.audit.action')}</span>
            <input
              className="input input--sm"
              type="text"
              value={actionInput}
              placeholder={t('admin.audit.actionPlaceholder')}
              onChange={(event) => {
                setActionInput(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setAppliedAction(actionInput);
                  setAppliedUserId(userIdInput);
                  setOffset(0);
                }
              }}
            />
          </label>
          <label className="toolbar__field">
            <span>{t('admin.audit.filterUserId')}</span>
            <input
              className="input input--sm"
              type="number"
              min={1}
              value={userIdInput}
              placeholder={t('common.all')}
              onChange={(event) => {
                setUserIdInput(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setAppliedAction(actionInput);
                  setAppliedUserId(userIdInput);
                  setOffset(0);
                }
              }}
            />
          </label>
          <label className="toolbar__field">
            <span>{t('admin.audit.pageSize')}</span>
            <select
              className="select input--sm"
              value={limit}
              onChange={(event) => {
                setLimit(Number(event.target.value));
                setOffset(0);
              }}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {t('admin.audit.pageSizeOption', { count: size })}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="toolbar__group">
          <Button
            icon="search"
            variant="primary"
            onClick={() => {
              setAppliedAction(actionInput);
              setAppliedUserId(userIdInput);
              setOffset(0);
            }}
          >
            {t('admin.audit.query')}
          </Button>
          <Button
            icon="refresh"
            onClick={() => {
              setActionInput('');
              setUserIdInput('');
              setAppliedAction('');
              setAppliedUserId('');
              setOffset(0);
            }}
          >
            {t('common.reset')}
          </Button>
          <Button icon="shield" loading={verifying} onClick={() => void handleVerify()}>
            {t('admin.audit.verifyChain')}
          </Button>
        </div>
      </section>

      {verifyResult ? (
        <div className={classNames('banner', verifyResult.ok ? 'banner--success' : 'banner--danger')}>
          <Icon name={verifyResult.ok ? 'check' : 'alert'} size={16} />
          <span>
            {verifyResult.ok
              ? t('admin.audit.bannerOk', { count: verifyResult.checked })
              : t('admin.audit.bannerBroken', {
                  values: {
                    count: verifyResult.checked,
                    position: verifyResult.brokenAt ?? t('common.unknown'),
                  },
                })}
          </span>
        </div>
      ) : null}

      <DataGrid
        columns={columns}
        rows={items}
        loading={loading}
        rowKey={(row) => String(row.id)}
        maxHeight="calc(100vh - 330px)"
        emptyText={t('admin.audit.empty')}
        emptyHint={t('admin.audit.emptyHint')}
        footer={
          <div className="pager">
            <span className="pager__info">
              {t('admin.audit.pager', {
                values: { total: formatNumber(total), page, totalPages },
              })}
            </span>
            <div className="pager__actions">
              <Button
                size="sm"
                disabled={!canPrev}
                onClick={() => {
                  setOffset(Math.max(0, offset - limit));
                }}
              >
                {t('admin.audit.prevPage')}
              </Button>
              <Button
                size="sm"
                disabled={!canNext}
                onClick={() => {
                  setOffset(offset + limit);
                }}
              >
                {t('admin.audit.nextPage')}
              </Button>
            </div>
          </div>
        }
      />

      <Modal
        open={detail !== null}
        title={t('admin.audit.detailTitle')}
        onClose={() => {
          setDetail(null);
        }}
        width={680}
      >
        {detail ? (
          <dl className="kv-list">
            <div className="kv-list__row">
              <dt>{t('admin.audit.column.time')}</dt>
              <dd className="mono">{formatDateTime(detail.createdAt)}</dd>
            </div>
            <div className="kv-list__row">
              <dt>{t('admin.audit.column.user')}</dt>
              <dd>{detail.username ?? t('admin.audit.anonymous')}</dd>
            </div>
            <div className="kv-list__row">
              <dt>{t('admin.audit.action')}</dt>
              <dd>
                <span className="badge badge--info">{auditActionLabel(detail.action, t)}</span>
              </dd>
            </div>
            <div className="kv-list__row">
              <dt>{t('admin.audit.column.resource')}</dt>
              <dd className="mono">
                {detail.resourceType ?? t('common.dash')}
                {detail.resourceId ? `#${detail.resourceId}` : ''}
              </dd>
            </div>
            <div className="kv-list__row">
              <dt>{t('admin.audit.column.connection')}</dt>
              <dd>
                {detail.connectionId === null ? t('common.dash') : `#${detail.connectionId}`}
              </dd>
            </div>
            <div className="kv-list__row">
              <dt>{t('common.status')}</dt>
              <dd>
                <span className={statusBadgeClass(detail.status)}>
                  {auditResultLabel(detail.status, t)}
                </span>
              </dd>
            </div>
            <div className="kv-list__row">
              <dt>{t('admin.audit.column.ip')}</dt>
              <dd className="mono">{detail.ipAddress ?? t('common.dash')}</dd>
            </div>
            <div className="kv-list__row kv-list__row--block">
              <dt>SQL</dt>
              <dd>
                <pre className="code-block">{detail.sqlText ?? t('common.dash')}</pre>
              </dd>
            </div>
            {detail.errorMessage ? (
              <div className="kv-list__row kv-list__row--block">
                <dt>{t('admin.audit.errorMessage')}</dt>
                <dd>
                  <pre className="code-block code-block--danger">{detail.errorMessage}</pre>
                </dd>
              </div>
            ) : null}
            <div className="kv-list__row kv-list__row--block">
              <dt>{t('admin.audit.currentHash')}</dt>
              <dd className="mono wrap-anywhere">{detail.currHash ?? t('common.dash')}</dd>
            </div>
          </dl>
        ) : null}
      </Modal>
    </div>
  );
}
