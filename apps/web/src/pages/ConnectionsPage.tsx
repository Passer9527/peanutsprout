import type { MessageKey, StrictTranslateFn } from '@peanutsprout/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { describeError } from '../api/client';
import { connectionsApi, metaApi } from '../api/endpoints';
import type {
  ConnectionDTO,
  ConnectionInput,
  ConnectionTestResult,
  DbTypeDTO,
} from '../api/types';
import { Button, IconButton } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DataGrid } from '../components/DataGrid';
import type { DataGridColumn } from '../components/DataGrid';
import { Icon } from '../components/Icons';
import { Modal } from '../components/Modal';
import { useI18n } from '../state/i18n';
import { useToast } from '../state/toast';
import {
  buildConnectionAddress,
  classNames,
  formatDateTime,
  formatDuration,
  optionalText,
} from '../utils/format';
// 调色板抽到 utils：其中红色必须与服务端的生产库识别集合保持一致（见该模块注释）
import { COLOR_TAGS } from '../utils/connectionColors';

/**
 * 数据库类别 code → meta 词条键。
 * 服务端给的是稳定的类别 code（relational / keyvalue / …），不直接显示；
 * 表里没有该 code（例如未来新增的自定义类别）时回退显示原始 code。
 */
const DB_CATEGORY_KEYS: Readonly<Record<string, MessageKey>> = {
  relational: 'dbCategory.relational',
  keyvalue: 'dbCategory.keyvalue',
  document: 'dbCategory.document',
  columnar: 'dbCategory.columnar',
  timeseries: 'dbCategory.timeseries',
  graph: 'dbCategory.graph',
};

/**
 * 数据库类型 code → 展示名词条。
 * meta.ts 目前只收录了类别（dbCategory.*）与驱动状态（driver.*），
 * 品牌名按稳定 code 收录在 data 命名空间；
 * code 未收录（服务端新增的自定义类型）时回退到服务端返回的 label。
 */
const DB_TYPE_KEYS: Readonly<Record<string, MessageKey>> = {
  mysql: 'data.dbType.mysql',
  mariadb: 'data.dbType.mariadb',
  postgresql: 'data.dbType.postgresql',
  oracle: 'data.dbType.oracle',
  sqlserver: 'data.dbType.sqlserver',
  sqlite: 'data.dbType.sqlite',
  kingbase: 'data.dbType.kingbase',
  dm: 'data.dbType.dm',
  oceanbase: 'data.dbType.oceanbase',
  tidb: 'data.dbType.tidb',
  redis: 'data.dbType.redis',
  mongodb: 'data.dbType.mongodb',
  clickhouse: 'data.dbType.clickhouse',
  influxdb: 'data.dbType.influxdb',
  neo4j: 'data.dbType.neo4j',
};

/** 取数据库类型的展示名；未收录的 code 回退服务端 label。 */
function dbTypeLabel(t: StrictTranslateFn, item: DbTypeDTO): string {
  const key = DB_TYPE_KEYS[item.dbType];
  return key === undefined ? item.label : t(key);
}

/** 取数据库类别的展示名；未收录的 code 回退原始 code。 */
function dbCategoryLabel(t: StrictTranslateFn, code: string): string {
  const key = DB_CATEGORY_KEYS[code];
  return key === undefined ? code : t(key);
}

interface ConnectionFormState {
  name: string;
  dbType: string;
  host: string;
  port: string;
  databaseName: string;
  username: string;
  password: string;
  connectionUrl: string;
  colorTag: string;
  isReadOnly: boolean;
  isFavorite: boolean;
  extraParams: string;
}

function emptyConnectionForm(dbTypes: DbTypeDTO[]): ConnectionFormState {
  const first = dbTypes.length > 0 ? dbTypes[0] : null;
  return {
    name: '',
    dbType: first ? first.dbType : 'mysql',
    host: '',
    port: first && first.defaultPort !== null ? String(first.defaultPort) : '',
    databaseName: '',
    username: '',
    password: '',
    connectionUrl: '',
    colorTag: '',
    isReadOnly: false,
    isFavorite: false,
    extraParams: '',
  };
}

function connectionFormOf(connection: ConnectionDTO): ConnectionFormState {
  return {
    name: connection.name,
    dbType: connection.dbType,
    host: connection.host ?? '',
    port: connection.port === null ? '' : String(connection.port),
    databaseName: connection.databaseName ?? '',
    username: connection.username ?? '',
    password: '',
    connectionUrl: connection.connectionUrl ?? '',
    colorTag: connection.colorTag ?? '',
    isReadOnly: connection.isReadOnly,
    isFavorite: connection.isFavorite,
    extraParams: '',
  };
}

function parseExtraParams(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 表单已做校验，这里兜底忽略
  }
  return undefined;
}

function buildConnectionInput(state: ConnectionFormState): ConnectionInput {
  const input: ConnectionInput = {
    name: state.name.trim(),
    dbType: state.dbType,
    isReadOnly: state.isReadOnly,
    isFavorite: state.isFavorite,
  };
  const host = optionalText(state.host);
  if (host !== undefined) {
    input.host = host;
  }
  const portText = state.port.trim();
  if (portText.length > 0) {
    const port = Number(portText);
    if (Number.isFinite(port)) {
      input.port = port;
    }
  }
  const databaseName = optionalText(state.databaseName);
  if (databaseName !== undefined) {
    input.databaseName = databaseName;
  }
  const username = optionalText(state.username);
  if (username !== undefined) {
    input.username = username;
  }
  const connectionUrl = optionalText(state.connectionUrl);
  if (connectionUrl !== undefined) {
    input.connectionUrl = connectionUrl;
  }
  const colorTag = optionalText(state.colorTag);
  if (colorTag !== undefined) {
    input.colorTag = colorTag;
  }
  if (state.password.length > 0) {
    input.password = state.password;
  }
  const extraParams = parseExtraParams(state.extraParams);
  if (extraParams !== undefined) {
    input.extraParams = extraParams;
  }
  return input;
}

interface ConnectionFormProps {
  mode: 'create' | 'edit';
  initial: ConnectionDTO | null;
  dbTypes: DbTypeDTO[];
  saving: boolean;
  onCancel: () => void;
  onSubmit: (state: ConnectionFormState) => void;
}

function ConnectionForm({ mode, initial, dbTypes, saving, onCancel, onSubmit }: ConnectionFormProps) {
  const { t } = useI18n();
  const [form, setForm] = useState<ConnectionFormState>(() =>
    initial ? connectionFormOf(initial) : emptyConnectionForm(dbTypes),
  );
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<ConnectionFormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const handleDbTypeChange = (code: string) => {
    const meta = dbTypes.find((item) => item.dbType === code);
    const shouldFillPort = form.port.trim().length === 0 && meta !== undefined && meta.defaultPort !== null;
    update({
      dbType: code,
      port: shouldFillPort && meta && meta.defaultPort !== null ? String(meta.defaultPort) : form.port,
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (form.name.trim().length === 0) {
      setError(t('data.conn.errorNameRequired'));
      return;
    }
    if (form.dbType.trim().length === 0) {
      setError(t('data.conn.errorDbTypeRequired'));
      return;
    }
    if (form.port.trim().length > 0 && !Number.isFinite(Number(form.port.trim()))) {
      setError(t('data.conn.errorPortNumeric'));
      return;
    }
    const extra = form.extraParams.trim();
    if (extra.length > 0) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(extra);
      } catch {
        setError(t('data.conn.errorExtraParamsInvalid'));
        return;
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setError(t('data.conn.errorExtraParamsObject'));
        return;
      }
      // 后端 schema 是 z.record(z.string(), z.string())：除了必须是对象，
      // **每个值都必须是字符串**。旧实现只校验"是对象"，填数字/嵌套对象时
      // 前端放行、后端拒绝，用户只能拿到笼统失败提示。
      // 语言包里暂无"值必须是字符串"的专用词条（packages/i18n 不在本次范围），
      // 这里用既有词条指出具体是哪个键不合法；补词条需求已写入报告。
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value !== 'string') {
          setError(t('data.conn.errorExtraParamsValue', { values: { key } }));
          return;
        }
      }
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
        <span className="field__label">{t('data.conn.fieldName')}</span>
        <input
          className="input"
          type="text"
          value={form.name}
          disabled={saving}
          placeholder={t('data.conn.namePlaceholder')}
          onChange={(event) => {
            update({ name: event.target.value });
          }}
        />
      </label>

      <label className="field">
        <span className="field__label">{t('data.conn.fieldDbType')}</span>
        <select
          className="select"
          value={form.dbType}
          disabled={saving}
          onChange={(event) => {
            handleDbTypeChange(event.target.value);
          }}
        >
          {dbTypes.length === 0 ? <option value={form.dbType}>{form.dbType}</option> : null}
          {dbTypes.map((item) => (
            <option key={item.dbType} value={item.dbType}>
              {t('data.conn.dbTypeOption', {
                values: { label: dbTypeLabel(t, item), category: dbCategoryLabel(t, item.category) },
              })}
              {/* 驱动状态复用 meta.driver.*；「驱动」前缀放在 data 词条里以保持原有文案 */}
              {item.driverImplemented
                ? ''
                : ` · ${t('data.conn.driverNotImplemented', {
                    values: { status: t('driver.notImplemented') },
                  })}`}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field__label">{t('data.conn.fieldHost')}</span>
        <input
          className="input"
          type="text"
          value={form.host}
          disabled={saving}
          placeholder="127.0.0.1"
          onChange={(event) => {
            update({ host: event.target.value });
          }}
        />
      </label>

      <label className="field">
        <span className="field__label">{t('data.conn.fieldPort')}</span>
        <input
          className="input"
          type="number"
          min={1}
          max={65535}
          value={form.port}
          disabled={saving}
          placeholder={t('data.conn.portPlaceholder')}
          onChange={(event) => {
            update({ port: event.target.value });
          }}
        />
      </label>

      <label className="field">
        <span className="field__label">{t('data.conn.fieldDatabase')}</span>
        <input
          className="input"
          type="text"
          value={form.databaseName}
          disabled={saving}
          placeholder={t('common.optional')}
          onChange={(event) => {
            update({ databaseName: event.target.value });
          }}
        />
      </label>

      <label className="field">
        <span className="field__label">{t('data.conn.fieldUsername')}</span>
        <input
          className="input"
          type="text"
          autoComplete="off"
          value={form.username}
          disabled={saving}
          placeholder={t('common.optional')}
          onChange={(event) => {
            update({ username: event.target.value });
          }}
        />
      </label>

      <label className="field form-grid__full">
        <span className="field__label">{t('data.conn.fieldPassword')}</span>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          value={form.password}
          disabled={saving}
          placeholder={
            mode === 'edit' ? t('data.conn.passwordPlaceholderEdit') : t('data.conn.passwordPlaceholderCreate')
          }
          onChange={(event) => {
            update({ password: event.target.value });
          }}
        />
        {mode === 'edit' ? (
          <span className="field__hint">
            {initial && initial.hasPassword ? t('data.conn.passwordSaved') : t('data.conn.passwordNotSaved')}
          </span>
        ) : null}
      </label>

      <label className="field form-grid__full">
        <span className="field__label">{t('data.conn.fieldUrl')}</span>
        <input
          className="input mono"
          type="text"
          value={form.connectionUrl}
          disabled={saving}
          placeholder={t('data.conn.urlPlaceholder')}
          onChange={(event) => {
            update({ connectionUrl: event.target.value });
          }}
        />
      </label>

      <label className="field form-grid__full">
        <span className="field__label">{t('data.conn.fieldExtraParams')}</span>
        <textarea
          className="textarea mono"
          rows={3}
          value={form.extraParams}
          disabled={saving}
          placeholder={t('data.conn.extraParamsPlaceholder')}
          onChange={(event) => {
            update({ extraParams: event.target.value });
          }}
        />
      </label>

      <div className="field form-grid__full">
        <span className="field__label">{t('data.conn.fieldColorTag')}</span>
        <div className="color-picker">
          <button
            type="button"
            className={classNames('color-swatch color-swatch--none', form.colorTag === '' && 'color-swatch--active')}
            onClick={() => {
              update({ colorTag: '' });
            }}
            title={t('data.conn.colorNone')}
          >
            <Icon name="close" size={12} />
          </button>
          {COLOR_TAGS.map((color) => (
            <button
              key={color}
              type="button"
              className={classNames('color-swatch', form.colorTag === color && 'color-swatch--active')}
              style={{ backgroundColor: color }}
              title={color}
              aria-label={t('data.conn.colorSwatchAria', { values: { color } })}
              onClick={() => {
                update({ colorTag: color });
              }}
            />
          ))}
        </div>
      </div>

      <label className="field field--inline">
        <input
          type="checkbox"
          className="checkbox"
          checked={form.isReadOnly}
          disabled={saving}
          onChange={(event) => {
            update({ isReadOnly: event.target.checked });
          }}
        />
        <span>
          {t('data.conn.readonlyLabel')}
          <small>{t('data.conn.readonlyHint')}</small>
        </span>
      </label>

      <label className="field field--inline">
        <input
          type="checkbox"
          className="checkbox"
          checked={form.isFavorite}
          disabled={saving}
          onChange={(event) => {
            update({ isFavorite: event.target.checked });
          }}
        />
        <span>
          {t('data.conn.favoriteLabel')}
          <small>{t('data.conn.favoriteHint')}</small>
        </span>
      </label>

      <div className="form-grid__actions form-grid__full">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" loading={saving} icon="check">
          {mode === 'create' ? t('data.conn.createSubmit') : t('common.saveChanges')}
        </Button>
      </div>

      {mode === 'create' ? (
        <p className="form-grid__note form-grid__full">{t('data.conn.createNote')}</p>
      ) : null}
    </form>
  );
}

export interface ConnectionsPageProps {
  /** 当前选中的连接（由 App 持有，用于右侧详情面板） */
  selected: ConnectionDTO | null;
  onSelect: (connection: ConnectionDTO | null) => void;
  /** 由右侧详情面板发起的「编辑」请求；nonce 变化即触发一次 */
  editRequest?: { connectionId: number; nonce: number } | null;
}

export function ConnectionsPage({ selected, onSelect, editRequest }: ConnectionsPageProps) {
  const toast = useToast();
  const { t, localizeError } = useI18n();
  const [items, setItems] = useState<ConnectionDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [dbTypeFilter, setDbTypeFilter] = useState('');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [dbTypes, setDbTypes] = useState<DbTypeDTO[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ConnectionDTO | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ConnectionDTO | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, ConnectionTestResult>>({});

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [searchInput]);

  /**
   * 列表请求序号：搜索/筛选变化会取消上一个 300ms 防抖并立即发新请求，
   * 但网络返回顺序不保证与发出顺序一致（快速键入 a、ab，或改搜索词后立刻
   * 勾选「仅收藏」时尤其明显）。旧请求后到会覆盖新条件的结果，
   * 出现"列表与筛选条件对不上"。这里只接受最后一次请求的响应与 loading 状态。
   */
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = (loadSeq.current += 1);
    setLoading(true);
    try {
      const response = await connectionsApi.list({
        search: search.length > 0 ? search : undefined,
        dbType: dbTypeFilter.length > 0 ? dbTypeFilter : undefined,
        favorite: favoriteOnly ? true : undefined,
      });
      if (seq !== loadSeq.current) return; // 已有更新的请求，丢弃这份过期结果
      setItems(response.items);
    } catch (error) {
      if (seq !== loadSeq.current) return; // 过期请求的报错同样不该打扰用户
      toast.error(t('data.conn.loadListFailed', { values: { message: describeError(error, { t, localizeError }) } }));
    } finally {
      // loading 只由最新一次请求负责收尾，避免旧请求提前把转圈关掉
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [search, dbTypeFilter, favoriteOnly, toast, t, localizeError]);

  useEffect(() => {
    void load();
  }, [load]);

  // 列表刷新后把右侧详情面板同步为最新数据
  useEffect(() => {
    if (!selected) {
      return;
    }
    const fresh = items.find((item) => item.id === selected.id);
    if (!fresh) {
      onSelect(null);
      return;
    }
    if (fresh !== selected) {
      onSelect(fresh);
    }
  }, [items, selected, onSelect]);

  // 右侧详情面板点击「编辑」时打开表单弹窗
  useEffect(() => {
    if (!editRequest) {
      return;
    }
    const target = items.find((item) => item.id === editRequest.connectionId);
    if (target) {
      setEditing(target);
      setModalOpen(true);
    }
  }, [editRequest, items]);

  useEffect(() => {
    let cancelled = false;
    metaApi
      .dbTypes()
      .then((response) => {
        if (!cancelled) {
          setDbTypes(response.items);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          toast.error(t('data.conn.loadDbTypesFailed', { values: { message: describeError(error, { t, localizeError }) } }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [toast, t, localizeError]);

  const handleCreate = async (state: ConnectionFormState) => {
    setSaving(true);
    try {
      const response = await connectionsApi.create(buildConnectionInput(state));
      toast.success(t('data.conn.created', { values: { name: response.item.name } }));
      setModalOpen(false);
      await load();
    } catch (error) {
      toast.error(t('data.conn.createFailed', { values: { message: describeError(error, { t, localizeError }) } }));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (target: ConnectionDTO, state: ConnectionFormState) => {
    setSaving(true);
    try {
      const response = await connectionsApi.update(target.id, buildConnectionInput(state));
      toast.success(t('data.conn.updated', { values: { name: response.item.name } }));
      setModalOpen(false);
      setEditing(null);
      await load();
    } catch (error) {
      toast.error(t('data.conn.updateFailed', { values: { message: describeError(error, { t, localizeError }) } }));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (connection: ConnectionDTO) => {
    setTestingId(connection.id);
    try {
      const result = await connectionsApi.test(connection.id);
      setTestResults((current) => ({ ...current, [connection.id]: result }));
      if (result.ok) {
        const version = result.serverVersion ? ` · ${result.serverVersion}` : '';
        toast.success(
          t('data.conn.testSuccess', {
            values: { name: connection.name, latency: result.latencyMs, version },
          }),
        );
      } else {
        toast.error(
          t('data.conn.testFailed', { values: { name: connection.name, message: result.message } }),
        );
      }
    } catch (error) {
      toast.error(t('data.conn.testRequestFailed', { values: { message: describeError(error, { t, localizeError }) } }));
    } finally {
      setTestingId(null);
    }
  };

  const handleToggleFavorite = async (connection: ConnectionDTO) => {
    try {
      const response = await connectionsApi.update(connection.id, {
        name: connection.name,
        dbType: connection.dbType,
        isFavorite: !connection.isFavorite,
      });
      setItems((current) => current.map((item) => (item.id === response.item.id ? response.item : item)));
    } catch (error) {
      toast.error(t('data.conn.favoriteFailed', { values: { message: describeError(error, { t, localizeError }) } }));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    setDeleting(true);
    try {
      await connectionsApi.remove(deleteTarget.id);
      toast.success(t('data.conn.deleted', { values: { name: deleteTarget.name } }));
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast.error(t('data.conn.deleteFailed', { values: { message: describeError(error, { t, localizeError }) } }));
    } finally {
      setDeleting(false);
    }
  };

  const columns: Array<DataGridColumn<ConnectionDTO>> = [
    {
      key: 'name',
      header: t('data.conn.colName'),
      width: '240px',
      render: (row) => (
        <span className="cell-stack cell-stack--row">
          {row.colorTag ? (
            <span className="color-dot" style={{ backgroundColor: row.colorTag }} aria-hidden="true" />
          ) : (
            <span className="color-dot color-dot--empty" aria-hidden="true" />
          )}
          <strong>{row.name}</strong>
          {row.isFavorite ? (
            <span className="text-primary" title={t('data.conn.favoritedTitle')}>
              <Icon name="starFilled" size={13} />
            </span>
          ) : null}
          {row.isReadOnly ? (
            <span className="badge badge--warning" title={t('data.conn.readonlyLabel')}>
              {t('connStatus.readonly')}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'dbType',
      header: t('common.type'),
      width: '110px',
      render: (row) => <span className="badge badge--info">{row.dbType}</span>,
    },
    {
      key: 'address',
      header: t('data.conn.colAddress'),
      render: (row) => (
        <span className="mono truncate-cell" title={buildConnectionAddress(row)}>
          {buildConnectionAddress(row)}
        </span>
      ),
    },
    {
      key: 'username',
      header: t('data.conn.fieldUsername'),
      width: '120px',
      render: (row) => <span className="mono">{row.username ?? t('common.dash')}</span>,
    },
    {
      key: 'hasPassword',
      header: t('data.conn.fieldPassword'),
      width: '90px',
      render: (row) =>
        row.hasPassword ? (
          <span className="text-muted" title={t('data.conn.passwordSavedTitle')}>
            <Icon name="lock" size={14} />
          </span>
        ) : (
          <span className="text-muted">{t('data.conn.notSaved')}</span>
        ),
    },
    {
      key: 'lastUsedAt',
      header: t('data.conn.colLastUsed'),
      width: '170px',
      render: (row) => <span className="mono">{formatDateTime(row.lastUsedAt)}</span>,
    },
    {
      key: 'test',
      header: t('data.conn.colConnectivity'),
      width: '140px',
      render: (row) => {
        if (testingId === row.id) {
          return (
            <span className="inline-loading">
              <span className="spinner" aria-hidden="true" />
              {t('data.conn.testing')}
            </span>
          );
        }
        const result = testResults[row.id];
        if (!result) {
          return <span className="text-muted">{t('connStatus.untested')}</span>;
        }
        return result.ok ? (
          <span className="badge badge--success">
            {t('connStatus.ok')} · {formatDuration(result.latencyMs)}
          </span>
        ) : (
          <span className="badge badge--danger" title={result.message}>
            {t('data.conn.statusFailed')}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: t('common.actions'),
      width: '160px',
      align: 'right',
      render: (row) => (
        <span className="row-actions">
          <Button
            size="sm"
            icon="play"
            disabled={testingId !== null}
            onClick={(event) => {
              event.stopPropagation();
              void handleTest(row);
            }}
          >
            {t('common.test')}
          </Button>
          <IconButton
            icon={row.isFavorite ? 'starFilled' : 'star'}
            label={row.isFavorite ? t('data.conn.unfavoriteLabel') : t('data.conn.favoriteLabel')}
            active={row.isFavorite}
            onClick={(event) => {
              event.stopPropagation();
              void handleToggleFavorite(row);
            }}
          />
          <IconButton
            icon="settings"
            label={t('data.conn.editAction')}
            onClick={(event) => {
              event.stopPropagation();
              setEditing(row);
              setModalOpen(true);
            }}
          />
          <IconButton
            icon="trash"
            label={t('data.conn.deleteTitle')}
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

  return (
    <div className="page">
      <section className="toolbar">
        <div className="toolbar__group">
          <span className="search-box">
            <Icon name="search" size={15} />
            <input
              className="input input--sm"
              type="search"
              value={searchInput}
              placeholder={t('data.conn.searchPlaceholder')}
              onChange={(event) => {
                setSearchInput(event.target.value);
              }}
            />
          </span>
          <select
            className="select input--sm"
            value={dbTypeFilter}
            onChange={(event) => {
              setDbTypeFilter(event.target.value);
            }}
          >
            <option value="">{t('data.conn.allTypes')}</option>
            {dbTypes.map((item) => (
              <option key={item.dbType} value={item.dbType}>
                {dbTypeLabel(t, item)}
              </option>
            ))}
          </select>
          <label className="toolbar__toggle">
            <input
              type="checkbox"
              className="checkbox"
              checked={favoriteOnly}
              onChange={(event) => {
                setFavoriteOnly(event.target.checked);
              }}
            />
            <span>{t('data.conn.favoriteOnly')}</span>
          </label>
        </div>
        <div className="toolbar__group">
          <span className="toolbar__count">
            {t('data.conn.totalConnections', { count: items.length })}
          </span>
          <Button icon="refresh" disabled={loading} onClick={() => void load()}>
            {t('common.refresh')}
          </Button>
          <Button
            icon="plus"
            variant="primary"
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            {t('data.conn.createTitle')}
          </Button>
        </div>
      </section>

      <DataGrid
        columns={columns}
        rows={items}
        loading={loading}
        rowKey={(row) => String(row.id)}
        onRowClick={onSelect}
        selectedKey={selected ? String(selected.id) : null}
        maxHeight="calc(100vh - 300px)"
        emptyText={t('data.conn.empty')}
        emptyHint={t('data.conn.emptyHint')}
      />

      <Modal
        open={modalOpen}
        title={editing ? t('data.conn.editTitle', { values: { name: editing.name } }) : t('data.conn.createTitle')}
        description={t('data.conn.modalDescription')}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        width={720}
      >
        {modalOpen ? (
          <ConnectionForm
            key={editing ? `edit-${editing.id}` : 'create'}
            mode={editing ? 'edit' : 'create'}
            initial={editing}
            dbTypes={dbTypes}
            saving={saving}
            onCancel={() => {
              setModalOpen(false);
              setEditing(null);
            }}
            onSubmit={(state) => {
              if (editing) {
                void handleUpdate(editing, state);
              } else {
                void handleCreate(state);
              }
            }}
          />
        ) : null}
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('data.conn.deleteTitle')}
        message={
          deleteTarget
            ? t('data.conn.deleteConfirm', { values: { name: deleteTarget.name } })
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
