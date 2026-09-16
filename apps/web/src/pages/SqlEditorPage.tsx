import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, describeError } from '../api/client';
import { connectionsApi, queryApi } from '../api/endpoints';
import type {
  ColumnDTO,
  ConnectionDTO,
  QueryCell,
  QueryHistoryDTO,
  QueryResultDTO,
  SchemaDTO,
  TableDTO,
} from '../api/types';
import { Button, IconButton } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DataGrid } from '../components/DataGrid';
import type { DataGridColumn } from '../components/DataGrid';
import { Icon } from '../components/Icons';
import { useI18n } from '../state/i18n';
import { useToast } from '../state/toast';
import {
  buildCsv,
  buildJson,
  buildMarkdown,
  cellToText,
  classNames,
  downloadTextFile,
  formatDateTime,
  formatDuration,
  isNullCell,
  sqlPreview,
} from '../utils/format';

type ResultTab = 'result' | 'plan' | 'message';

interface ObjectTreeProps {
  connectionId: number | null;
  onInsertSql: (sql: string) => void;
  onError: (message: string) => void;
}

function ObjectTree({ connectionId, onInsertSql, onError }: ObjectTreeProps) {
  const { t, localizeError } = useI18n();
  const [schemas, setSchemas] = useState<SchemaDTO[]>([]);
  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [expandedSchema, setExpandedSchema] = useState<string | null>(null);
  const [tables, setTables] = useState<Record<string, TableDTO[]>>({});
  const [loadingTables, setLoadingTables] = useState<string | null>(null);
  const [expandedTable, setExpandedTable] = useState<string | null>(null);
  const [columns, setColumns] = useState<Record<string, ColumnDTO[]>>({});
  const [loadingColumns, setLoadingColumns] = useState<string | null>(null);

  /**
   * 连接代次。切换连接时组件实例被复用，上一个连接在途的 tables/columns
   * 请求若不作废，就会把旧连接的表结构填到新连接下（而且之后不会再刷新），
   * 用户可能对着错误的表写 SQL。每次 connectionId 变化递增代次，
   * 所有异步回调只在代次未变时落状态。
   */
  const connSeq = useRef(0);

  useEffect(() => {
    connSeq.current += 1;
    setExpandedSchema(null);
    setExpandedTable(null);
    setTables({});
    setColumns({});
    // 在途请求已被作废，加载标记必须一起清掉，否则转圈会永远停不下来
    setLoadingTables(null);
    setLoadingColumns(null);
    if (connectionId === null) {
      setSchemas([]);
      return;
    }
    let cancelled = false;
    setLoadingSchemas(true);
    connectionsApi
      .schemas(connectionId)
      .then((response) => {
        if (!cancelled) {
          setSchemas(response.items);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSchemas([]);
          onError(t('data.sql.loadSchemasFailed', { values: { message: describeError(error, { t, localizeError }) } }));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingSchemas(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, onError, t, localizeError]);

  const toggleSchema = (name: string) => {
    if (expandedSchema === name) {
      setExpandedSchema(null);
      return;
    }
    setExpandedSchema(name);
    if (connectionId === null || Object.prototype.hasOwnProperty.call(tables, name)) {
      return;
    }
    setLoadingTables(name);
    const seq = connSeq.current;
    connectionsApi
      .tables(connectionId, name)
      .then((response) => {
        if (seq !== connSeq.current) return; // 期间切换了连接，丢弃旧表列表
        setTables((current) => ({ ...current, [name]: response.items }));
      })
      .catch((error: unknown) => {
        if (seq !== connSeq.current) return;
        onError(t('data.sql.loadTablesFailed', { values: { message: describeError(error, { t, localizeError }) } }));
      })
      .finally(() => {
        if (seq === connSeq.current) setLoadingTables(null);
      });
  };

  const toggleTable = (schema: string, table: string) => {
    const key = `${schema}.${table}`;
    if (expandedTable === key) {
      setExpandedTable(null);
      return;
    }
    setExpandedTable(key);
    if (connectionId === null || Object.prototype.hasOwnProperty.call(columns, key)) {
      return;
    }
    setLoadingColumns(key);
    const seq = connSeq.current;
    connectionsApi
      .columns(connectionId, schema, table)
      .then((response) => {
        if (seq !== connSeq.current) return; // 期间切换了连接，丢弃旧列结构
        setColumns((current) => ({ ...current, [key]: response.items }));
      })
      .catch((error: unknown) => {
        if (seq !== connSeq.current) return;
        onError(t('data.sql.loadColumnsFailed', { values: { message: describeError(error, { t, localizeError }) } }));
      })
      .finally(() => {
        if (seq === connSeq.current) setLoadingColumns(null);
      });
  };

  if (connectionId === null) {
    return <p className="tree-hint">{t('data.sql.treeSelectConnection')}</p>;
  }

  return (
    <div className="tree">
      {loadingSchemas ? (
        <p className="tree-hint">
          <span className="spinner" aria-hidden="true" /> {t('data.sql.loadingSchemas')}
        </p>
      ) : null}
      {!loadingSchemas && schemas.length === 0 ? (
        <p className="tree-hint">{t('data.sql.noSchemas')}</p>
      ) : null}
      {schemas.map((schema) => {
        const schemaOpen = expandedSchema === schema.name;
        const schemaTables = tables[schema.name] ?? [];
        return (
          <div className="tree__group" key={schema.name}>
            <button
              type="button"
              className={classNames('tree__row', schemaOpen && 'tree__row--open')}
              onClick={() => {
                toggleSchema(schema.name);
              }}
            >
              <span className="tree__caret">
                <Icon name={schemaOpen ? 'chevronDown' : 'chevronRight'} size={13} />
              </span>
              <span className="tree__icon">
                <Icon name="folder" size={14} />
              </span>
              <span className="tree__label">{schema.name}</span>
            </button>

            {schemaOpen ? (
              <div className="tree__children">
                {loadingTables === schema.name ? (
                  <p className="tree-hint">
                    <span className="spinner" aria-hidden="true" /> {t('data.sql.loadingTables')}
                  </p>
                ) : null}
                {loadingTables !== schema.name && schemaTables.length === 0 ? (
                  <p className="tree-hint">{t('data.sql.noTables')}</p>
                ) : null}
                {schemaTables.map((table) => {
                  const tableKey = `${schema.name}.${table.name}`;
                  const tableOpen = expandedTable === tableKey;
                  const tableColumns = columns[tableKey] ?? [];
                  return (
                    <div className="tree__group" key={tableKey}>
                      <div className={classNames('tree__row', 'tree__row--table', tableOpen && 'tree__row--open')}>
                        <button
                          type="button"
                          className="tree__row-main"
                          onClick={() => {
                            toggleTable(schema.name, table.name);
                          }}
                          title={table.comment ?? table.name}
                        >
                          <span className="tree__caret">
                            <Icon name={tableOpen ? 'chevronDown' : 'chevronRight'} size={12} />
                          </span>
                          <span className="tree__icon">
                            <Icon name="table" size={13} />
                          </span>
                          <span className="tree__label">{table.name}</span>
                          {table.type && table.type.toLowerCase() !== 'table' ? (
                            <span className="badge badge--muted">{table.type}</span>
                          ) : null}
                        </button>
                        <IconButton
                          icon="plus"
                          label={t('data.sql.insertQuery')}
                          size={14}
                          onClick={() => {
                            onInsertSql(`SELECT * FROM ${schema.name}.${table.name} LIMIT 100;`);
                          }}
                        />
                      </div>

                      {tableOpen ? (
                        <div className="tree__children">
                          {loadingColumns === tableKey ? (
                            <p className="tree-hint">
                              <span className="spinner" aria-hidden="true" /> {t('data.sql.loadingColumns')}
                            </p>
                          ) : null}
                          {loadingColumns !== tableKey && tableColumns.length === 0 ? (
                            <p className="tree-hint">{t('data.sql.noColumns')}</p>
                          ) : null}
                          {tableColumns.map((column) => (
                            <div className="tree__column" key={`${tableKey}.${column.name}`} title={column.comment ?? ''}>
                              <span className="tree__icon">
                                <Icon name="columns" size={12} />
                              </span>
                              <span className="tree__label mono">{column.name}</span>
                              <span className="tree__meta mono">{column.dataType}</span>
                              {column.isPrimaryKey ? <span className="badge badge--warning">PK</span> : null}
                              {column.nullable ? null : <span className="badge badge--muted">NOT NULL</span>}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function historyStatusClass(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === 'success' || normalized === 'ok') {
    return 'badge badge--success';
  }
  if (normalized === 'failure' || normalized === 'failed' || normalized === 'error') {
    return 'badge badge--danger';
  }
  return 'badge badge--muted';
}

interface HistoryPanelProps {
  version: number;
  collapsed: boolean;
  onPick: (record: QueryHistoryDTO) => void;
}

function HistoryPanel({ version, collapsed, onPick }: HistoryPanelProps) {
  const toast = useToast();
  const { t, localizeError } = useI18n();
  const [items, setItems] = useState<QueryHistoryDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [manualVersion, setManualVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    queryApi
      .history(30, 0)
      .then((response) => {
        if (!cancelled) {
          setItems(response.items);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          toast.error(t('data.sql.loadHistoryFailed', { values: { message: describeError(error, { t, localizeError }) } }));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [version, manualVersion, toast, t, localizeError]);

  if (collapsed) {
    return null;
  }

  return (
    <div className="history">
      <div className="history__header">
        <span>{t('data.sql.historyTitle')}</span>
        <IconButton
          icon="refresh"
          label={t('data.sql.refreshHistory')}
          size={14}
          onClick={() => {
            setManualVersion((value) => value + 1);
          }}
        />
      </div>
      <div className="history__list">
        {loading && items.length === 0 ? (
          <p className="tree-hint">
            <span className="spinner" aria-hidden="true" /> {t('common.loading')}
          </p>
        ) : null}
        {!loading && items.length === 0 ? <p className="tree-hint">{t('data.sql.noHistory')}</p> : null}
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="history__item"
            onClick={() => {
              onPick(item);
            }}
            title={item.sqlText}
          >
            <span className="history__item-top">
              <span className={historyStatusClass(item.status)}>{item.status}</span>
              <span className="history__time mono">{formatDateTime(item.executedAt)}</span>
            </span>
            <span className="history__sql mono">{sqlPreview(item.sqlText, 60)}</span>
            <span className="history__meta">
              <span>{item.connectionName}</span>
              <span>{formatDuration(item.durationMs)}</span>
              <span>{t('common.countRows', { count: item.resultRows })}</span>
              {item.isSlow ? (
                <span className="badge badge--warning">{t('data.sql.slowQuery')}</span>
              ) : null}
            </span>
            {item.errorMessage ? <span className="history__error">{sqlPreview(item.errorMessage, 60)}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SqlEditorPage() {
  const toast = useToast();
  const { t, localizeError } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [connections, setConnections] = useState<ConnectionDTO[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [connectionId, setConnectionId] = useState<number | null>(null);
  const [sql, setSql] = useState('SELECT 1;');
  const [maxRows, setMaxRows] = useState('');
  const [timeoutMs, setTimeoutMs] = useState('');
  const [executing, setExecuting] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [result, setResult] = useState<QueryResultDTO | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ResultTab>('result');
  const [historyVersion, setHistoryVersion] = useState(0);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  /** 写语句二次确认弹框；由后端 428 CONFIRMATION_REQUIRED 错误码驱动 */
  const [confirmOpen, setConfirmOpen] = useState(false);

  const showError = useCallback(
    (message: string) => {
      toast.error(message);
    },
    [toast],
  );

  useEffect(() => {
    let cancelled = false;
    setLoadingConnections(true);
    connectionsApi
      .list()
      .then((response) => {
        if (!cancelled) {
          setConnections(response.items);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          toast.error(t('data.sql.loadConnectionsFailed', { values: { message: describeError(error, { t, localizeError }) } }));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingConnections(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [toast, t, localizeError]);

  useEffect(() => {
    if (connectionId !== null || connections.length === 0) {
      return;
    }
    const preferred = connections.find((item) => item.isFavorite) ?? connections[0];
    setConnectionId(preferred.id);
  }, [connections, connectionId]);

  useEffect(() => {
    setResult(null);
    setPlan(null);
    setErrorMessage(null);
    setActiveTab('result');
  }, [connectionId]);

  const selectedConnection = useMemo(
    () => connections.find((item) => item.id === connectionId) ?? null,
    [connections, connectionId],
  );

  const insertSql = useCallback(
    (snippet: string) => {
      const element = textareaRef.current;
      if (!element) {
        setSql((current) => (current.trim().length > 0 ? `${current}\n${snippet}` : snippet));
        return;
      }
      const start = element.selectionStart;
      const end = element.selectionEnd;
      const next = `${sql.slice(0, start)}${snippet}${sql.slice(end)}`;
      setSql(next);
      const caret = start + snippet.length;
      window.requestAnimationFrame(() => {
        element.focus();
        element.setSelectionRange(caret, caret);
      });
    },
    [sql],
  );

  const execute = useCallback(
    async (options: { confirm: boolean } = { confirm: false }) => {
      if (connectionId === null) {
        toast.error(t('data.sql.selectConnectionFirst'));
        return;
      }
      if (sql.trim().length === 0) {
        toast.error(t('data.sql.enterSqlToRun'));
        return;
      }
      const maxRowsValue = maxRows.trim().length > 0 ? Number(maxRows.trim()) : undefined;
      const timeoutValue = timeoutMs.trim().length > 0 ? Number(timeoutMs.trim()) : undefined;
      setExecuting(true);
      setErrorMessage(null);
      try {
        const response = await queryApi.execute({
          connectionId,
          sql,
          maxRows: maxRowsValue !== undefined && Number.isFinite(maxRowsValue) ? maxRowsValue : undefined,
          timeoutMs: timeoutValue !== undefined && Number.isFinite(timeoutValue) ? timeoutValue : undefined,
          // 只有用户确认后才带 confirm=true；是否为写语句由后端判定，前端不重复实现一套 SQL 判定
          ...(options.confirm ? { confirm: true } : {}),
        });
        setConfirmOpen(false);
        setResult(response);
        setPlan(null);
        setActiveTab('result');
        setHistoryVersion((value) => value + 1);
        // 截断提示复用 common.truncated，全角括号为排版符号
        // 截断提示：正文复用 common.truncated，括号格式走 data.sql.truncatedSuffix
        const truncated = response.truncated
          ? t('data.sql.truncatedSuffix', { values: { text: t('common.truncated') } })
          : '';
        toast.success(
          t('data.sql.executed', {
            values: {
              rows: t('common.countRows', { count: response.rowCount }),
              affected: t('common.countRows', { count: response.affectedRows }),
              duration: formatDuration(response.durationMs),
              suffix: truncated,
            },
          }),
        );
      } catch (error) {
        // 写语句会被后端以 428 CONFIRMATION_REQUIRED 拒绝；按错误码弹二次确认框，
        // 用户确认后用 confirm=true 原样重提交（读取当前编辑器内容）。
        if (error instanceof ApiError && error.code === 'CONFIRMATION_REQUIRED') {
          setConfirmOpen(true);
          return;
        }
        // 确认后仍然失败（如只读连接）时关闭确认框，把错误落到消息页签
        setConfirmOpen(false);
        const message = describeError(error, { t, localizeError });
        setErrorMessage(message);
        setActiveTab('message');
        setHistoryVersion((value) => value + 1);
        toast.error(t('data.sql.execFailed', { values: { message } }));
      } finally {
        setExecuting(false);
      }
    },
    [connectionId, sql, maxRows, timeoutMs, toast, t, localizeError],
  );

  const explain = useCallback(async () => {
    if (connectionId === null) {
      toast.error(t('data.sql.selectConnectionFirst'));
      return;
    }
    if (sql.trim().length === 0) {
      toast.error(t('data.sql.enterSqlToExplain'));
      return;
    }
    setExplaining(true);
    try {
      const response = await queryApi.explain(connectionId, sql);
      setPlan(response.plan.content);
      setActiveTab('plan');
    } catch (error) {
      const message = describeError(error, { t, localizeError });
      toast.error(t('data.sql.explainFailed', { values: { message } }));
    } finally {
      setExplaining(false);
    }
  }, [connectionId, sql, toast, t, localizeError]);

  const exportResult = (format: 'csv' | 'json' | 'markdown') => {
    if (!result) {
      toast.error(t('data.sql.noExportData'));
      return;
    }
    const base = `peanutsprout-${result.queryId}`;
    if (format === 'csv') {
      downloadTextFile(`${base}.csv`, buildCsv(result.columns, result.rows), 'text/csv');
    } else if (format === 'json') {
      downloadTextFile(`${base}.json`, buildJson(result.columns, result.rows), 'application/json');
    } else {
      downloadTextFile(`${base}.md`, buildMarkdown(result.columns, result.rows), 'text/markdown');
    }
    toast.success(t('data.sql.exported', { values: { format: format.toUpperCase() } }));
  };

  const resultColumns: Array<DataGridColumn<QueryCell[]>> = useMemo(() => {
    if (!result) {
      return [];
    }
    return result.columns.map((column, index) => ({
      key: `${index}-${column.name}`,
      header: (
        <span className="result-head">
          <strong>{column.name}</strong>
          <small className="mono">{column.dataType}</small>
        </span>
      ),
      render: (row) => {
        const value = row[index] ?? null;
        if (isNullCell(value)) {
          return <span className="cell-null">{t('data.grid.nullCell')}</span>;
        }
        return <span className="mono">{cellToText(value)}</span>;
      },
    }));
  }, [result, t]);

  const handleExportCopy = async () => {
    if (sql.trim().length === 0) {
      toast.error(t('data.sql.emptyEditor'));
      return;
    }
    try {
      await navigator.clipboard.writeText(sql);
      toast.success(t('data.sql.copied'));
    } catch {
      toast.error(t('data.sql.copyFailed'));
    }
  };

  return (
    <div className={classNames('sql-workspace', historyCollapsed && 'sql-workspace--collapsed')}>
      <section className="sql-tree pane">
        <div className="pane__header">
          <span>{t('data.sql.treeTitle')}</span>
        </div>
        <div className="pane__body">
          <label className="field">
            <span className="field__label">{t('data.sql.connectionLabel')}</span>
            <select
              className="select"
              value={connectionId === null ? '' : String(connectionId)}
              disabled={loadingConnections}
              onChange={(event) => {
                const value = event.target.value;
                setConnectionId(value.length === 0 ? null : Number(value));
              }}
            >
              <option value="">{loadingConnections ? t('common.loading') : t('data.sql.selectConnection')}</option>
              {connections.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.isFavorite ? '★ ' : ''}
                  {t('data.sql.connectionOption', {
                    values: { name: item.name, type: item.dbType },
                  })}
                </option>
              ))}
            </select>
          </label>

          {selectedConnection ? (
            <div className="connection-summary">
              <span className="mono">{selectedConnection.dbType}</span>
              {selectedConnection.isReadOnly ? (
                <span className="badge badge--warning">{t('connStatus.readonly')}</span>
              ) : null}
              {selectedConnection.isFavorite ? (
                <span className="badge badge--info">{t('data.conn.favoriteBadge')}</span>
              ) : null}
            </div>
          ) : null}

          <ObjectTree connectionId={connectionId} onInsertSql={insertSql} onError={showError} />
        </div>
      </section>

      <section className="sql-main pane">
        <div className="pane__header">
          <span>{t('data.sql.editorTitle')}</span>
          <div className="pane__actions">
            <Button
              size="sm"
              variant="primary"
              icon="play"
              loading={executing}
              onClick={() => void execute()}
            >
              {t('data.sql.run')}
            </Button>
            <Button size="sm" icon="file" loading={explaining} onClick={() => void explain()}>
              {t('data.sql.explain')}
            </Button>
            <IconButton
              icon="copy"
              label={t('data.sql.copySql')}
              onClick={() => {
                void handleExportCopy();
              }}
            />
            <IconButton
              icon="trash"
              label={t('data.sql.clearEditor')}
              onClick={() => {
                setSql('');
                setResult(null);
                setPlan(null);
                setErrorMessage(null);
              }}
            />
            <IconButton
              icon="panelRight"
              label={historyCollapsed ? t('data.sql.showHistory') : t('data.sql.hideHistory')}
              active={!historyCollapsed}
              onClick={() => {
                setHistoryCollapsed((value) => !value);
              }}
            />
          </div>
        </div>

        <div className="pane__body pane__body--flush">
          {selectedConnection && selectedConnection.isReadOnly ? (
            <div className="banner banner--warning">
              <Icon name="lock" size={16} />
              <span>{t('data.sql.readonlyBanner')}</span>
            </div>
          ) : null}

          <textarea
            ref={textareaRef}
            className="sql-textarea mono"
            value={sql}
            spellCheck={false}
            placeholder={t('data.sql.editorPlaceholder')}
            onChange={(event) => {
              setSql(event.target.value);
            }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                void execute();
              }
            }}
          />

          <div className="sql-options">
            <label className="sql-options__field">
              <span>{t('data.sql.maxRows')}</span>
              <input
                className="input input--sm"
                type="number"
                min={1}
                value={maxRows}
                placeholder={t('data.sql.serverDefault')}
                onChange={(event) => {
                  setMaxRows(event.target.value);
                }}
              />
            </label>
            <label className="sql-options__field">
              <span>{t('data.sql.timeoutMs')}</span>
              <input
                className="input input--sm"
                type="number"
                min={1}
                value={timeoutMs}
                placeholder={t('data.sql.serverDefault')}
                onChange={(event) => {
                  setTimeoutMs(event.target.value);
                }}
              />
            </label>
            <span className="sql-options__hint">{t('data.sql.shortcutHint')}</span>
          </div>

          <div className="result">
            <div className="result__tabs">
              <button
                type="button"
                className={classNames('tab', activeTab === 'result' && 'tab--active')}
                onClick={() => {
                  setActiveTab('result');
                }}
              >
                {t('data.sql.tabResult')}
                {result ? <span className="tab__count">{result.rowCount}</span> : null}
              </button>
              <button
                type="button"
                className={classNames('tab', activeTab === 'plan' && 'tab--active')}
                onClick={() => {
                  setActiveTab('plan');
                }}
              >
                {t('data.sql.explain')}
              </button>
              <button
                type="button"
                className={classNames('tab', activeTab === 'message' && 'tab--active')}
                onClick={() => {
                  setActiveTab('message');
                }}
              >
                {t('data.sql.tabMessage')}
                {errorMessage ? <span className="tab__count tab__count--danger">!</span> : null}
              </button>

              <span className="result__tabs-spacer" />

              <Button size="sm" icon="download" disabled={!result} onClick={() => exportResult('csv')}>
                CSV
              </Button>
              <Button size="sm" icon="download" disabled={!result} onClick={() => exportResult('json')}>
                JSON
              </Button>
              <Button size="sm" icon="download" disabled={!result} onClick={() => exportResult('markdown')}>
                Markdown
              </Button>
            </div>

            <div className="result__body">
              {activeTab === 'result' ? (
                result ? (
                  <>
                    <div className="result__meta">
                      <span className="mono">queryId: {result.queryId}</span>
                      <span>{t('data.sql.returnedRows', { count: result.rowCount })}</span>
                      <span>{t('data.sql.affectedRows', { count: result.affectedRows })}</span>
                      <span>{t('data.sql.elapsed', { values: { duration: formatDuration(result.durationMs) } })}</span>
                      {result.truncated ? (
                        <span className="badge badge--warning">{t('common.truncated')}</span>
                      ) : null}
                    </div>
                    {result.notices.length > 0 ? (
                      <div className="result__notices">
                        {result.notices.map((notice, index) => (
                          <span className="result__notice" key={`${index}-${notice}`}>
                            <Icon name="info" size={13} />
                            {notice}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {result.columns.length === 0 ? (
                      <div className="empty-state empty-state--inline">
                        <Icon name="check" size={22} />
                        <h3>{t('data.sql.successTitle')}</h3>
                        <p>{t('data.sql.successNoResult', { count: result.affectedRows })}</p>
                      </div>
                    ) : (
                      <DataGrid
                        columns={resultColumns}
                        rows={result.rows}
                        rowKey={(_row, index) => String(index)}
                        maxHeight="calc(100vh - 520px)"
                        dense
                        emptyText={t('data.sql.emptyResult')}
                        emptyHint={t('data.sql.emptyResultHint')}
                      />
                    )}
                  </>
                ) : (
                  <div className="empty-state empty-state--inline">
                    <Icon name="terminal" size={24} />
                    <h3>{t('data.sql.notExecutedTitle')}</h3>
                    <p>{t('data.sql.notExecutedHint')}</p>
                  </div>
                )
              ) : null}

              {activeTab === 'plan' ? (
                plan ? (
                  <pre className="code-block">{plan}</pre>
                ) : (
                  <div className="empty-state empty-state--inline">
                    <Icon name="file" size={24} />
                    <h3>{t('data.sql.noPlanTitle')}</h3>
                    <p>{t('data.sql.noPlanHint')}</p>
                  </div>
                )
              ) : null}

              {activeTab === 'message' ? (
                <div className="result__messages">
                  {errorMessage ? (
                    <div className="banner banner--danger">
                      <Icon name="alert" size={16} />
                      <span className="wrap-anywhere">{errorMessage}</span>
                    </div>
                  ) : (
                    <p className="text-muted">{t('data.sql.noMessages')}</p>
                  )}
                  {result && result.notices.length > 0 ? (
                    <ul className="notice-list">
                      {result.notices.map((notice, index) => (
                        <li key={`${index}-${notice}`}>{notice}</li>
                      ))}
                    </ul>
                  ) : null}
                  {result ? (
                    <p className="text-muted">
                      {t('data.sql.lastSuccess', {
                        count: result.rowCount,
                        values: { duration: formatDuration(result.durationMs) },
                      })}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className={classNames('sql-history pane', historyCollapsed && 'sql-history--collapsed')}>
        <HistoryPanel
          version={historyVersion}
          collapsed={historyCollapsed}
          onPick={(record) => {
            setSql(record.sqlText);
            const targetId = record.connectionId;
            if (typeof targetId === 'number' && targetId !== connectionId) {
              setConnectionId(targetId);
            }
          }}
        />
      </section>

      {/* 写语句二次确认：确认后带 confirm=true 重新提交，见 execute() */}
      <ConfirmDialog
        open={confirmOpen}
        title={t('common.warning')}
        message={t('error.CONFIRMATION_REQUIRED')}
        danger
        loading={executing}
        onCancel={() => {
          setConfirmOpen(false);
        }}
        onConfirm={() => {
          void execute({ confirm: true });
        }}
      />
    </div>
  );
}
