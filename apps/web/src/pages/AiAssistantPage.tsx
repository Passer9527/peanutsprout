/**
 * AI 助手对话页。
 *
 * 设计取舍：
 *  · **不做自由聊天**。这里的每一轮都绑定一个明确的"技能"（nl2sql / 解释 / 优化 /
 *    文档 / 结果集问答 / 报错诊断），因为每个技能的提示词、需要的上下文和结果
 *    结构都不一样；做成一个通用输入框反而会让用户不知道该往里写什么。
 *  · **AI 只生成、不执行**。AI 生成 SQL 后**不会自己跑**，而是把「执行」和「复制」
 *    两个选择明确摆给用户；点「执行」也要走与 SQL 开发页完全相同的写闸门
 *    （写语句缺 confirm 会被后端以 428 拦下，界面再确认一次）。
 *  · **每一轮都可撤回**。撤回不只是清空气泡：它会连同服务端 `ai_history` 里
 *    对应的调用记录一起删掉，因此右侧"已调用 N 次"与历史列表会同步变小。
 *  · **发送后清空输入框**。已经发出去的内容不该在输入框里留着 —— 既容易
 *    误发第二遍，也会让人以为"还没发出去"。
 *  · 未启用 / 未配置时给出**可点的下一步**（跳到设置页），而不是只显示一行错误。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { ApiError } from '../api/client';
import { aiApi, connectionsApi, dataApi, queryApi } from '../api/endpoints';
import type {
  AiConfigDTO,
  AiDiagnoseResultDTO,
  AiOptimizeResultDTO,
  AiSqlResultDTO,
  AiStatusDTO,
  ConnectionDTO,
  QueryResultDTO,
} from '../api/types';
import { Button } from '../components/Button';
import { Icon } from '../components/Icons';
import {
  inputsAfterSend,
  planRollbackAnchor,
  planWithdraw,
  snapshotForRollback,
  type ComposerSnapshot,
  type SceneKey,
} from './aiConversation.js';
import { useI18n } from '../state/i18n';
import { useToast } from '../state/toast';
import type { ViewKey } from '../state/view';

/** 六个技能。`needs` 描述该技能需要哪些输入，界面按此渲染。 */
interface SceneSpec {
  key: SceneKey;
  labelKey: `ai.scene.${SceneKey}`;
  hintKey: `ai.scene.${SceneKey}Hint`;
  icon: 'sparkles' | 'file' | 'terminal' | 'search' | 'alert' | 'table';
  /** 需要的输入控件 */
  needs: Array<'connection' | 'question' | 'sql' | 'error' | 'rows'>;
}

const SCENES: SceneSpec[] = [
  { key: 'nl2sql', labelKey: 'ai.scene.nl2sql', hintKey: 'ai.scene.nl2sqlHint', icon: 'sparkles', needs: ['connection', 'question'] },
  { key: 'explain', labelKey: 'ai.scene.explain', hintKey: 'ai.scene.explainHint', icon: 'search', needs: ['sql'] },
  { key: 'optimize', labelKey: 'ai.scene.optimize', hintKey: 'ai.scene.optimizeHint', icon: 'terminal', needs: ['sql', 'connection'] },
  { key: 'document', labelKey: 'ai.scene.document', hintKey: 'ai.scene.documentHint', icon: 'file', needs: ['connection'] },
  { key: 'ask', labelKey: 'ai.scene.ask', hintKey: 'ai.scene.askHint', icon: 'table', needs: ['rows', 'question', 'connection'] },
  { key: 'diagnose', labelKey: 'ai.scene.diagnose', hintKey: 'ai.scene.diagnoseHint', icon: 'alert', needs: ['error', 'sql'] },
];

/** 一条对话记录。assistant 的 payload 按技能不同而不同，因此用联合类型。 */
type Turn =
  | { id: string; role: 'user'; text: string; snapshot: ComposerSnapshot }
  | { id: string; role: 'assistant'; scene: SceneKey; kind: 'text'; text: string; historyId: number | null }
  | { id: string; role: 'assistant'; scene: SceneKey; kind: 'sql'; result: AiSqlResultDTO; historyId: number | null }
  | {
      id: string;
      role: 'assistant';
      scene: SceneKey;
      kind: 'optimize';
      result: AiOptimizeResultDTO;
      historyId: number | null;
    }
  | {
      id: string;
      role: 'assistant';
      scene: SceneKey;
      kind: 'diagnose';
      result: AiDiagnoseResultDTO;
      historyId: number | null;
    }
  | { id: string; role: 'assistant'; scene: SceneKey; kind: 'error'; text: string; historyId: number | null };

function localizable(error: unknown): { code?: string; message?: string } {
  if (error instanceof ApiError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { message: error.message };
  return { message: String(error) };
}

/** 把 Blob 存成文件。下载走的是浏览器原生机制，不经过任何服务端中转。 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 立刻 revoke 在部分浏览器会让下载中断，交给下一轮宏任务
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * 把用户粘贴的表格文本解析成 columns + rows。
 * 支持制表符 / 逗号分隔，首行视为表头。空行忽略。
 */
function parsePastedTable(input: string): {
  columns: Array<{ name: string }>;
  rows: Array<Array<string | number | null>>;
} | null {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) return null;
  const split = (line: string): string[] => (line.includes('\t') ? line.split('\t') : line.split(','));
  const header = split(lines[0]!).map((name) => name.trim());
  if (header.length === 0 || header.some((name) => name.length === 0)) return null;
  const rows = lines.slice(1).map((line) =>
    split(line).map((cell) => {
      const trimmed = cell.trim();
      if (trimmed === '' || trimmed.toUpperCase() === 'NULL') return null;
      // 纯数字转成 number，便于模型理解为数值列
      if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
      return trimmed;
    }),
  );
  return { columns: header.map((name) => ({ name })), rows };
}

export function AiAssistantPage({ onNavigate }: { onNavigate: (view: ViewKey) => void }) {
  const { t, localizeError } = useI18n();
  const toast = useToast();

  const [status, setStatus] = useState<AiStatusDTO | null>(null);
  const [configs, setConfigs] = useState<AiConfigDTO[]>([]);
  const [connections, setConnections] = useState<ConnectionDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [scene, setScene] = useState<SceneKey>('nl2sql');
  const [connectionId, setConnectionId] = useState<number | ''>('');
  const [question, setQuestion] = useState('');
  const [sql, setSql] = useState('');
  const [errorText, setErrorText] = useState('');
  const [rowsText, setRowsText] = useState('');
  const [sending, setSending] = useState(false);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [historyCount, setHistoryCount] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  /** 自增 id：用它做 React key，撤回/回退时组件实例不会串位 */
  const turnSeq = useRef(0);

  const spec = useMemo(() => SCENES.find((item) => item.key === scene) ?? SCENES[0]!, [scene]);
  const needs = useCallback((what: SceneSpec['needs'][number]) => spec.needs.includes(what), [spec]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [aiStatus, configList, connList] = await Promise.all([
        aiApi.status(),
        aiApi.listConfigs().catch(() => ({ items: [] as AiConfigDTO[] })),
        connectionsApi.list(),
      ]);
      setStatus(aiStatus);
      setConfigs(configList.items);
      setConnections(connList.items);
      // 只有一个连接时预先选上，省一次点击
      if (connList.items.length === 1 && connList.items[0]) setConnectionId(connList.items[0].id);
    } catch (e) {
      setLoadError(localizeError(localizable(e)));
    } finally {
      setLoading(false);
    }
  }, [localizeError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, sending]);

  const nextTurnId = () => `t${++turnSeq.current}`;

  const missingInput = (): string | null => {
    if (needs('connection') && connectionId === '') {
      // 优化/问答里连接是可选的，只有 nl2sql 与文档必须有连接
      if (scene === 'nl2sql' || scene === 'document') return t('ai.assistant.connectionLabel');
    }
    if (needs('question') && question.trim().length === 0) return t('ai.assistant.inputLabel');
    if (needs('sql') && sql.trim().length === 0) return t('ai.assistant.sqlLabel');
    if (needs('error') && errorText.trim().length === 0) return t('ai.assistant.errorLabel');
    if (needs('rows') && parsePastedTable(rowsText) === null) return t('ai.assistant.rowsLabel');
    return null;
  };

  /** 把这一轮的输入回显成用户气泡 */
  function userEchoOf(from: ComposerSnapshot): string {
    switch (from.scene) {
      case 'nl2sql':
      case 'ask':
        return from.question.trim();
      case 'explain':
      case 'optimize':
        return from.sql.trim();
      case 'document':
        return t('ai.scene.document');
      case 'diagnose':
        return from.errorText.trim();
    }
  }

  /**
   * 发送后清空输入框（需求：「已经发送的信息不要保留在输入框中」）。
   * 具体清哪些字段由 `inputsAfterSend()` 决定，那里有单测钉住边界。
   */
  function clearSentInputs(sent: ComposerSnapshot): void {
    const next = inputsAfterSend(sent.scene, { question, sql, errorText, rowsText });
    if (next.question !== question) setQuestion(next.question);
    if (next.sql !== sql) setSql(next.sql);
    if (next.errorText !== errorText) setErrorText(next.errorText);
    if (next.rowsText !== rowsText) setRowsText(next.rowsText);
  }

  const handleSend = async () => {
    const missing = missingInput();
    if (missing) {
      toast.error(t('common.requiredField') + ': ' + missing);
      return;
    }
    const snapshot: ComposerSnapshot = { scene, connectionId, question, sql, errorText, rowsText };
    setSending(true);
    setTurns((cur) => [...cur, { id: nextTurnId(), role: 'user', text: userEchoOf(snapshot), snapshot }]);
    // 立刻清空：内容已经进了对话区，留在输入框里只会让人误以为没发出去
    clearSentInputs(snapshot);
    try {
      switch (scene) {
        case 'nl2sql': {
          const result = await aiApi.nl2sql(question.trim(), Number(connectionId));
          setTurns((cur) => [
            ...cur,
            { id: nextTurnId(), role: 'assistant', scene, kind: 'sql', result, historyId: result.historyId ?? null },
          ]);
          break;
        }
        case 'explain': {
          const { text, historyId } = await aiApi.explain(snapshot.sql);
          setTurns((cur) => [
            ...cur,
            { id: nextTurnId(), role: 'assistant', scene, kind: 'text', text, historyId: historyId ?? null },
          ]);
          break;
        }
        case 'optimize': {
          const result = await aiApi.optimize(snapshot.sql, connectionId === '' ? undefined : Number(connectionId));
          setTurns((cur) => [
            ...cur,
            {
              id: nextTurnId(),
              role: 'assistant',
              scene,
              kind: 'optimize',
              result,
              historyId: result.historyId ?? null,
            },
          ]);
          break;
        }
        case 'document': {
          // 后端该接口返回 { markdown }（apps/server/src/routes/ai-migration.ts）
          const { markdown, historyId } = await aiApi.document(Number(connectionId));
          setTurns((cur) => [
            ...cur,
            { id: nextTurnId(), role: 'assistant', scene, kind: 'text', text: markdown, historyId: historyId ?? null },
          ]);
          break;
        }
        case 'ask': {
          const table = parsePastedTable(snapshot.rowsText);
          if (!table) throw new ApiError(0, 'VALIDATION_FAILED', t('ai.assistant.rowsLabel'));
          const { text, historyId } = await aiApi.ask(
            snapshot.question.trim(),
            table.columns,
            table.rows,
            connectionId === '' ? undefined : Number(connectionId),
          );
          setTurns((cur) => [
            ...cur,
            { id: nextTurnId(), role: 'assistant', scene, kind: 'text', text, historyId: historyId ?? null },
          ]);
          break;
        }
        case 'diagnose': {
          const result = await aiApi.diagnose(snapshot.errorText.trim(), snapshot.sql);
          setTurns((cur) => [
            ...cur,
            {
              id: nextTurnId(),
              role: 'assistant',
              scene,
              kind: 'diagnose',
              result,
              historyId: result.historyId ?? null,
            },
          ]);
          break;
        }
      }
      void refreshHistoryCount();
    } catch (e) {
      const message = localizeError(localizable(e));
      setTurns((cur) => [
        ...cur,
        { id: nextTurnId(), role: 'assistant', scene, kind: 'error', text: message, historyId: null },
      ]);
    } finally {
      setSending(false);
    }
  };

  /** 右侧"最近调用"计数：后端返回真实 total，撤回后会同步变小。 */
  const refreshHistoryCount = async () => {
    try {
      const history = await aiApi.history(1);
      setHistoryCount(history.total ?? history.items.length);
    } catch {
      setHistoryCount(null);
    }
  };

  // ------------------------------------------------------------ 撤回 / 回退

  /** 删掉服务端记录（失败不阻断本地撤回，但会提示，避免"以为删干净了"）。 */
  const withdrawServerRecord = async (historyId: number | null): Promise<boolean> => {
    if (historyId === null) return true;
    try {
      await aiApi.withdrawHistory(historyId);
      return true;
    } catch (e) {
      toast.error(t('ai.assistant.withdrawFailed', { values: { message: localizeError(localizable(e)) } }));
      return false;
    }
  };

  /** 撤回单条：用户消息会连同紧随其后的那条 AI 回复一起撤掉。 */
  const handleWithdraw = async (index: number) => {
    const plan = planWithdraw(turns, index);
    if (plan.removeCount === 0) return;
    for (const id of plan.historyIds) await withdrawServerRecord(id);
    setTurns((cur) => cur.filter((_, i) => i < index || i >= index + plan.removeCount));
    void refreshHistoryCount();
    toast.success(t('ai.assistant.withdrawDone'));
  };

  /**
   * 回退到某一次操作：截断该轮之后的全部对话，把当时的输入放回输入框，
   * 并删掉服务端这条及其之后的调用记录。
   */
  const handleRollback = async (index: number) => {
    const turn = turns[index];
    if (!turn) return;
    // 这一轮真正产生的那次调用（带单测钉住：不会误取到下一条提问的记录）
    const anchor = planRollbackAnchor(turns, index);
    if (anchor !== null) {
      try {
        const { deleted } = await aiApi.rollbackHistory(anchor);
        toast.success(t('ai.assistant.rollbackDone', { values: { count: deleted } }));
      } catch (e) {
        toast.error(t('ai.assistant.withdrawFailed', { values: { message: localizeError(localizable(e)) } }));
        return;
      }
    }
    setTurns((cur) => cur.slice(0, index));
    const snapshot = snapshotForRollback(turn);
    if (snapshot) {
      setScene(snapshot.scene);
      setConnectionId(snapshot.connectionId);
      setQuestion(snapshot.question);
      setSql(snapshot.sql);
      setErrorText(snapshot.errorText);
      setRowsText(snapshot.rowsText);
    }
    void refreshHistoryCount();
  };

  const handleClearAll = async () => {
    try {
      const { deleted } = await aiApi.clearHistory();
      if (deleted > 0) toast.success(t('ai.assistant.clearDone', { values: { count: deleted } }));
    } catch (e) {
      toast.error(t('ai.assistant.withdrawFailed', { values: { message: localizeError(localizable(e)) } }));
      return;
    }
    setTurns([]);
    setHistoryCount(0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd + Enter 发送，普通回车换行（提示词经常要多行）
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void handleSend();
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('ai.assistant.copied'));
    } catch {
      toast.error(t('ai.assistant.copyFailed'));
    }
  };

  // ------------------------------------------------------------ 不可用状态

  if (loading) {
    return (
      <div className="page">
        <p className="inline-loading">
          <span className="spinner" aria-hidden="true" />
          {t('common.loading')}
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="page">
        <div className="card">
          <div className="banner banner--danger" role="alert">
            <Icon name="alert" size={16} />
            <span>{loadError}</span>
            <Button size="sm" icon="refresh" onClick={() => void load()}>
              {t('common.retry')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (status && !status.enabled) {
    return (
      <div className="page">
        <div className="card">
          <div className="card__header">
            <h2 className="card__title">{t('ai.disabled.title')}</h2>
            <p className="card__subtitle">{t('ai.disabled.hint')}</p>
          </div>
          <div className="card__actions">
            <Button variant="primary" icon="settings" onClick={() => onNavigate('settings')}>
              {t('ai.disabled.action')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (status && !status.configured && configs.length === 0) {
    return (
      <div className="page">
        <div className="card">
          <div className="card__header">
            <h2 className="card__title">{t('ai.notConfigured.title')}</h2>
            <p className="card__subtitle">{t('ai.notConfigured.hint')}</p>
          </div>
          <div className="card__actions">
            <Button variant="primary" icon="settings" onClick={() => onNavigate('settings')}>
              {t('ai.notConfigured.action')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------ 正常界面

  return (
    <div className="page page--ai">
      <div className="ai-layout">
        <aside className="ai-scenes">
          <h2 className="ai-scenes__title">{t('ai.assistant.sceneLabel')}</h2>
          {SCENES.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`ai-scene${scene === item.key ? ' ai-scene--active' : ''}`}
              onClick={() => {
                setScene(item.key);
              }}
              aria-pressed={scene === item.key}
            >
              <span className="ai-scene__icon">
                <Icon name={item.icon} size={16} />
              </span>
              <span className="ai-scene__text">
                <strong>{t(item.labelKey)}</strong>
                <small>{t(item.hintKey)}</small>
              </span>
            </button>
          ))}

          {status?.config ? (
            <div className="ai-scenes__model">
              <span className="badge badge--info">{status.config.name}</span>
              <small className="mono">{status.config.modelName}</small>
            </div>
          ) : null}
        </aside>

        <section className="ai-main">
          <header className="ai-main__header">
            <div>
              <h1 className="ai-main__title">{t('ai.assistant.title')}</h1>
              <p className="ai-main__subtitle">{t(spec.hintKey)}</p>
            </div>
            {turns.length > 0 ? (
              <Button size="sm" variant="ghost" icon="trash" onClick={() => void handleClearAll()}>
                {t('ai.assistant.clear')}
              </Button>
            ) : null}
          </header>

          <div className="ai-thread">
            {turns.length === 0 ? (
              <div className="empty-state">
                <Icon name="sparkles" size={24} />
                <p>{t('ai.assistant.emptyTitle')}</p>
                <p className="text-muted">{t('ai.assistant.emptyHint')}</p>
              </div>
            ) : (
              turns.map((turn, index) => (
                <div key={turn.id} className={`ai-turn ai-turn--${turn.role}`}>
                  <div className="ai-turn__role">
                    <span>{turn.role === 'user' ? t('ai.assistant.you') : t('ai.assistant.model')}</span>
                    <span className="ai-turn__tools">
                      <button
                        type="button"
                        className="link-button"
                        title={t('ai.assistant.withdrawHint')}
                        onClick={() => void handleWithdraw(index)}
                      >
                        {t('ai.assistant.withdraw')}
                      </button>
                      <button
                        type="button"
                        className="link-button"
                        title={t('ai.assistant.rollbackHint')}
                        onClick={() => void handleRollback(index)}
                      >
                        {t('ai.assistant.rollbackHere')}
                      </button>
                    </span>
                  </div>
                  <div className="ai-turn__body">
                    {turn.role === 'user' ? (
                      <p className="ai-turn__text">{turn.text}</p>
                    ) : turn.kind === 'error' ? (
                      <div className="banner banner--danger" role="alert">
                        <Icon name="alert" size={16} />
                        <span>{turn.text}</span>
                      </div>
                    ) : turn.kind === 'sql' ? (
                      <SqlResultBlock
                        result={turn.result}
                        fallbackConnectionId={connectionId === '' ? null : Number(connectionId)}
                        connections={connections}
                        onCopy={copyText}
                      />
                    ) : turn.kind === 'optimize' ? (
                      <OptimizeBlock result={turn.result} onCopy={copyText} />
                    ) : turn.kind === 'diagnose' ? (
                      <DiagnoseBlock result={turn.result} />
                    ) : (
                      <>
                        <pre className="ai-pre">{turn.text}</pre>
                        <Button size="sm" variant="ghost" icon="copy" onClick={() => void copyText(turn.text)}>
                          {t('common.copy')}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
            {sending ? (
              <div className="ai-turn ai-turn--assistant">
                <div className="ai-turn__role">{t('ai.assistant.model')}</div>
                <div className="ai-turn__body">
                  <span className="inline-loading">
                    <span className="spinner" aria-hidden="true" />
                    {t('ai.assistant.sending')}
                  </span>
                </div>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>

          {/* —— 输入区 —— */}
          <div className="ai-composer">
            {needs('connection') ? (
              <label className="field">
                <span className="field__label">
                  {t('ai.assistant.connectionLabel')}
                  {scene === 'nl2sql' || scene === 'document' ? null : (
                    <small className="text-muted"> · {t('common.optional')}</small>
                  )}
                </span>
                <select
                  className="input"
                  value={connectionId}
                  disabled={sending}
                  onChange={(event) => {
                    setConnectionId(event.target.value === '' ? '' : Number(event.target.value));
                  }}
                >
                  <option value="">{t('ai.assistant.connectionPlaceholder')}</option>
                  {connections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.name} · {connection.dbType}
                    </option>
                  ))}
                </select>
                <span className="field__hint">{t('ai.assistant.connectionHint')}</span>
              </label>
            ) : null}

            {needs('rows') ? (
              <label className="field">
                <span className="field__label">{t('ai.assistant.rowsLabel')}</span>
                <textarea
                  className="input ai-textarea ai-textarea--sm"
                  value={rowsText}
                  placeholder={t('ai.assistant.rowsPlaceholder')}
                  disabled={sending}
                  onChange={(event) => {
                    setRowsText(event.target.value);
                  }}
                />
                <span className="field__hint">{t('ai.assistant.rowsHint')}</span>
              </label>
            ) : null}

            {needs('sql') ? (
              <label className="field">
                <span className="field__label">{t('ai.assistant.sqlLabel')}</span>
                <textarea
                  className="input ai-textarea"
                  value={sql}
                  placeholder={t('ai.assistant.sqlPlaceholder')}
                  disabled={sending}
                  onChange={(event) => {
                    setSql(event.target.value);
                  }}
                  onKeyDown={handleKeyDown}
                />
              </label>
            ) : null}

            {needs('error') ? (
              <label className="field">
                <span className="field__label">{t('ai.assistant.errorLabel')}</span>
                <textarea
                  className="input ai-textarea ai-textarea--sm"
                  value={errorText}
                  placeholder={t('ai.assistant.errorPlaceholder')}
                  disabled={sending}
                  onChange={(event) => {
                    setErrorText(event.target.value);
                  }}
                />
              </label>
            ) : null}

            {needs('question') ? (
              <label className="field">
                <span className="field__label">{t('ai.assistant.inputLabel')}</span>
                <textarea
                  className="input ai-textarea"
                  value={question}
                  placeholder={t('ai.assistant.inputPlaceholder')}
                  disabled={sending}
                  onChange={(event) => {
                    setQuestion(event.target.value);
                  }}
                  onKeyDown={handleKeyDown}
                />
              </label>
            ) : null}

            <div className="ai-composer__actions">
              <Button variant="primary" icon="play" loading={sending} onClick={() => void handleSend()}>
                {sending ? t('ai.assistant.sending') : t('ai.assistant.send')}
              </Button>
              <span className="field__hint">
                {t('ai.assistant.sendHint')}
                {historyCount !== null ? ` · ${t('ai.history.title')}: ${historyCount}` : ''}
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

type ExecuteState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'needConfirm' }
  | { status: 'done'; result: QueryResultDTO }
  | { status: 'error'; message: string };

type ExportState =
  | { status: 'idle' }
  | { status: 'busy' }
  | { status: 'form'; targetConnectionId: number | ''; targetTable: string; mode: 'create' | 'append' | 'replace' }
  | { status: 'error'; message: string };

/**
 * nl2sql 结果块：SQL + 说明 + 置信度 + 涉及表，并提供「执行 / 复制 / 导出」。
 *
 * 为什么不自动执行：AI 生成的 SQL 可能误删数据。这里把"执行"做成一个
 * 需要用户主动点的动作，写语句还要再过一次确认 —— 与 SQL 开发页同一套闸门。
 */
export function SqlResultBlock({
  result,
  fallbackConnectionId,
  connections,
  onCopy,
}: {
  result: AiSqlResultDTO;
  fallbackConnectionId: number | null;
  connections: ConnectionDTO[];
  onCopy: (text: string) => Promise<void>;
}) {
  const { t, localizeError } = useI18n();
  const toast = useToast();
  const [execute, setExecute] = useState<ExecuteState>({ status: 'idle' });
  const [exportState, setExportState] = useState<ExportState>({ status: 'idle' });

  // 后端在 nl2sql 响应里带了 connectionId；没有就退回当前选中的连接
  const connectionId = result.connectionId ?? fallbackConnectionId;
  const connectionName = connections.find((c) => c.id === connectionId)?.name ?? '';

  const runExecute = async (confirm: boolean) => {
    if (connectionId === null) {
      toast.error(t('ai.assistant.noConnection'));
      return;
    }
    setExecute({ status: 'running' });
    try {
      const queryResult = await queryApi.execute({
        connectionId,
        sql: result.sql,
        ...(confirm ? { confirm: true } : {}),
      });
      setExecute({ status: 'done', result: queryResult });
    } catch (e) {
      // 写语句缺确认时后端返回 428：这不是失败，而是"再确认一次"
      if (e instanceof ApiError && e.code === 'CONFIRMATION_REQUIRED') {
        setExecute({ status: 'needConfirm' });
        return;
      }
      setExecute({ status: 'error', message: localizeError(localizable(e)) });
    }
  };

  const doExportXlsx = async () => {
    if (connectionId === null) {
      toast.error(t('ai.assistant.noConnection'));
      return;
    }
    setExportState({ status: 'busy' });
    try {
      const { blob, filename, truncated } = await dataApi.exportXlsx({ connectionId, sql: result.sql });
      downloadBlob(blob, filename);
      toast.success(t('ai.assistant.exportDone', { values: { name: filename } }));
      if (truncated) toast.info(t('ai.assistant.exportTruncated'));
      setExportState({ status: 'idle' });
    } catch (e) {
      const message = localizeError(localizable(e));
      setExportState({ status: 'error', message });
      toast.error(t('ai.assistant.exportFailed', { values: { message } }));
    }
  };

  const submitExportToDb = async () => {
    if (exportState.status !== 'form') return;
    const { targetConnectionId, targetTable, mode } = exportState;
    if (connectionId === null) {
      toast.error(t('ai.assistant.noConnection'));
      return;
    }
    if (targetConnectionId === '') {
      toast.error(t('ai.assistant.exportNeedConnection'));
      return;
    }
    if (targetTable.trim().length === 0) {
      toast.error(t('ai.assistant.exportNeedTable'));
      return;
    }
    setExportState({ status: 'busy' });
    try {
      const res = await dataApi.exportToConnection({
        sourceConnectionId: connectionId,
        sql: result.sql,
        targetConnectionId: Number(targetConnectionId),
        targetTable: targetTable.trim(),
        mode,
      });
      toast.success(
        t('ai.assistant.exportToDbDone', { values: { table: res.targetTable, count: res.rows } }),
      );
      if (res.truncated) toast.info(t('ai.assistant.exportTruncated'));
      setExportState({ status: 'idle' });
    } catch (e) {
      const message = localizeError(localizable(e));
      setExportState({ status: 'error', message });
      toast.error(t('ai.assistant.exportFailed', { values: { message } }));
    }
  };

  const busy = exportState.status === 'busy';

  return (
    <div className="ai-result">
      <div className="banner banner--info" role="note">
        <Icon name="info" size={16} />
        <span>{t('ai.assistant.noExecuteWarning')}</span>
      </div>
      {result.sql ? (
        <>
          <div className="ai-result__label">{t('ai.result.generatedSql')}</div>
          <pre className="ai-pre ai-pre--sql">{result.sql}</pre>
        </>
      ) : null}
      {result.explanation ? (
        <>
          <div className="ai-result__label">{t('ai.result.explanation')}</div>
          <p>{result.explanation}</p>
        </>
      ) : null}
      <div className="ai-result__meta">
        <span className="badge badge--muted">
          {t('ai.result.confidence')}: {Math.round(result.confidence * 100)}%
        </span>
        {result.referencedTables.length > 0 ? (
          <span className="badge badge--muted">
            {t('ai.result.tables')}: {result.referencedTables.join(', ')}
          </span>
        ) : null}
        {connectionName ? <span className="badge badge--muted">{connectionName}</span> : null}
      </div>

      {result.sql ? (
        <>
          <div className="ai-result__actions">
            <Button
              size="sm"
              variant="primary"
              icon="play"
              loading={execute.status === 'running'}
              onClick={() => void runExecute(false)}
            >
              {execute.status === 'running' ? t('ai.assistant.executing') : t('ai.assistant.execute')}
            </Button>
            <Button size="sm" icon="copy" onClick={() => void onCopy(result.sql)}>
              {t('ai.assistant.copySql')}
            </Button>
            <Button size="sm" icon="download" loading={busy} onClick={() => void doExportXlsx()}>
              {t('ai.assistant.exportExcel')}
            </Button>
            <Button
              size="sm"
              icon="database"
              disabled={busy}
              onClick={() =>
                setExportState(
                  exportState.status === 'form'
                    ? { status: 'idle' }
                    : { status: 'form', targetConnectionId: '', targetTable: '', mode: 'create' },
                )
              }
            >
              {t('ai.assistant.exportToDb')}
            </Button>
          </div>

          {/* —— 写操作二次确认 —— */}
          {execute.status === 'needConfirm' ? (
            <div className="banner banner--warning" role="alert">
              <Icon name="alert" size={16} />
              <span>{t('ai.assistant.executeConfirm')}</span>
              <Button size="sm" variant="danger" onClick={() => void runExecute(true)}>
                {t('ai.assistant.executeConfirmYes')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setExecute({ status: 'idle' })}>
                {t('common.cancel')}
              </Button>
            </div>
          ) : null}

          {execute.status === 'error' ? (
            <div className="banner banner--danger" role="alert">
              <Icon name="alert" size={16} />
              <span>{t('ai.assistant.executeFailed', { values: { message: execute.message } })}</span>
            </div>
          ) : null}

          {execute.status === 'done' ? (
            <div className="ai-execute-result">
              <div className="ai-result__meta">
                <span className="badge badge--success">
                  {execute.result.affectedRows > 0
                    ? t('ai.assistant.executeAffected', { values: { count: execute.result.affectedRows } })
                    : t('ai.assistant.executeRows', { values: { count: execute.result.rowCount } })}
                </span>
                <span className="badge badge--muted">{execute.result.durationMs} ms</span>
                {execute.result.truncated ? (
                  <span className="badge badge--warning">{t('ai.assistant.executeTruncated')}</span>
                ) : null}
              </div>
              {execute.result.rows.length > 0 ? (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        {execute.result.columns.map((column) => (
                          <th key={column.name}>{column.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {/* 只渲染前 50 行：AI 对话区不是数据浏览器，看个样子就够了 */}
                      {execute.result.rows.slice(0, 50).map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {row.map((cell, cellIndex) => (
                            <td key={cellIndex}>
                              {cell === null ? <span className="text-muted">NULL</span> : String(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* —— 导出到数据库 —— */}
          {exportState.status === 'form' || exportState.status === 'busy' ? (
            <div className="ai-export-form">
              <div className="ai-result__label">{t('ai.assistant.exportToDb')}</div>
              <div className="ai-export-form__row">
                <label className="field">
                  <span className="field__label">{t('ai.assistant.exportTargetConnection')}</span>
                  <select
                    className="input"
                    value={exportState.status === 'form' ? exportState.targetConnectionId : ''}
                    disabled={busy}
                    onChange={(event) =>
                      setExportState((cur) =>
                        cur.status === 'form'
                          ? {
                              ...cur,
                              targetConnectionId:
                                event.target.value === '' ? '' : Number(event.target.value),
                            }
                          : cur,
                      )
                    }
                  >
                    <option value="">{t('ai.assistant.connectionPlaceholder')}</option>
                    {/* 源连接自己不能当目标：后端也会拒绝，这里先从列表里去掉 */}
                    {connections
                      .filter((c) => c.id !== connectionId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} · {c.dbType}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">{t('ai.assistant.exportTargetTable')}</span>
                  <input
                    className="input"
                    value={exportState.status === 'form' ? exportState.targetTable : ''}
                    disabled={busy}
                    placeholder={t('ai.assistant.exportTargetTablePlaceholder')}
                    onChange={(event) =>
                      setExportState((cur) =>
                        cur.status === 'form' ? { ...cur, targetTable: event.target.value } : cur,
                      )
                    }
                  />
                </label>
                <label className="field">
                  <span className="field__label">{t('ai.assistant.exportMode')}</span>
                  <select
                    className="input"
                    value={exportState.status === 'form' ? exportState.mode : 'create'}
                    disabled={busy}
                    onChange={(event) =>
                      setExportState((cur) =>
                        cur.status === 'form'
                          ? { ...cur, mode: event.target.value as 'create' | 'append' | 'replace' }
                          : cur,
                      )
                    }
                  >
                    <option value="create">{t('ai.assistant.exportModeCreate')}</option>
                    <option value="append">{t('ai.assistant.exportModeAppend')}</option>
                    <option value="replace">{t('ai.assistant.exportModeReplace')}</option>
                  </select>
                </label>
              </div>
              {exportState.status === 'form' && exportState.mode === 'replace' ? (
                <div className="banner banner--warning" role="alert">
                  <Icon name="alert" size={16} />
                  <span>{t('ai.assistant.exportReplaceWarning')}</span>
                </div>
              ) : null}
              <div className="ai-result__actions">
                <Button
                  size="sm"
                  variant="primary"
                  loading={busy}
                  onClick={() => void submitExportToDb()}
                >
                  {t('ai.assistant.exportRun')}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setExportState({ status: 'idle' })}>
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          ) : null}

          {exportState.status === 'error' ? (
            <div className="banner banner--danger" role="alert">
              <Icon name="alert" size={16} />
              <span>{t('ai.assistant.exportFailed', { values: { message: exportState.message } })}</span>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function OptimizeBlock({
  result,
  onCopy,
}: {
  result: AiOptimizeResultDTO;
  onCopy: (text: string) => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <div className="ai-result">
      <div className="ai-result__label">{t('ai.result.suggestions')}</div>
      <ul className="ai-suggestions">
        {result.suggestions.map((suggestion, index) => (
          <li key={index} className="ai-suggestion">
            <div className="ai-suggestion__head">
              <strong>{suggestion.title}</strong>
              <span className={`badge badge--${severityBadge(suggestion.severity)}`}>
                {t(`ai.result.severity.${suggestion.severity}` as never)}
              </span>
            </div>
            {suggestion.detail ? <p>{suggestion.detail}</p> : null}
            {suggestion.rewrittenSql ? (
              <>
                <pre className="ai-pre ai-pre--sql">{suggestion.rewrittenSql}</pre>
                <Button size="sm" variant="ghost" icon="copy" onClick={() => void onCopy(suggestion.rewrittenSql!)}>
                  {t('common.copy')}
                </Button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DiagnoseBlock({ result }: { result: AiDiagnoseResultDTO }) {
  const { t } = useI18n();
  return (
    <div className="ai-result">
      <div className="ai-result__label">{t('ai.result.cause')}</div>
      <p>{result.cause}</p>
      {result.suggestions.length > 0 ? (
        <>
          <div className="ai-result__label">{t('ai.result.suggestions')}</div>
          <ul className="ai-suggestions">
            {result.suggestions.map((suggestion, index) => (
              <li key={index} className="ai-suggestion">
                <p>{suggestion}</p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function severityBadge(severity: 'info' | 'warning' | 'critical'): string {
  if (severity === 'critical') return 'danger';
  if (severity === 'warning') return 'warning';
  return 'muted';
}
