import { useEffect, useRef, useState } from 'react';
import { describeError } from '../api/client';
import { connectionsApi } from '../api/endpoints';
import type { ConnectionDTO, ConnectionTestResult } from '../api/types';
import { useI18n } from '../state/i18n';
import { useToast } from '../state/toast';
import { buildConnectionAddress, classNames, formatDateTime, formatDuration } from '../utils/format';
import { Button } from './Button';

export interface ConnectionDetailProps {
  connection: ConnectionDTO;
  /** 在列表弹窗中编辑该连接 */
  onEdit: (connection: ConnectionDTO) => void;
}

/**
 * 连接详情：作为 Layout 右侧辅助面板的内容，可独立测试连通性。
 */
export function ConnectionDetail({ connection, onEdit }: ConnectionDetailProps) {
  const toast = useToast();
  const { t, localizeError } = useI18n();
  const [testing, setTesting] = useState(false);
  /**
   * 连通性结果连同它所属的连接 id 一起存：渲染时只认当前连接的结果。
   * 仅靠 effect 清空会有一帧的窗口期（effect 在绘制后执行），
   * 带着 id 判断可以从根上杜绝"上一个连接的结果显示在新连接上"。
   */
  const [result, setResult] = useState<{ connectionId: number; data: ConnectionTestResult } | null>(null);

  /**
   * 测试请求序号。切换连接时组件实例会被复用，旧实现既不清空上一个连接的
   * 连通性结果，也不作废在途请求 —— 会出现"A 的结果显示在 B 上"，或 B 正在
   * 测试时却被 A 的响应把状态改掉。切换时递增序号、清空状态即可隔离两者。
   */
  const testSeq = useRef(0);

  useEffect(() => {
    testSeq.current += 1;
    setResult(null);
    setTesting(false);
  }, [connection.id]);

  const handleTest = async () => {
    const seq = (testSeq.current += 1);
    const targetId = connection.id;
    setTesting(true);
    try {
      const response = await connectionsApi.test(targetId);
      if (seq !== testSeq.current) return; // 已切换连接或又发起了新测试，丢弃
      setResult({ connectionId: targetId, data: response });
      if (response.ok) {
        const version = response.serverVersion ? ` · ${response.serverVersion}` : '';
        toast.success(
          t('data.conn.detailTestSuccess', { values: { latency: response.latencyMs, version } }),
        );
      } else {
        toast.error(t('data.conn.detailTestFailed', { values: { message: response.message } }));
      }
    } catch (error) {
      if (seq !== testSeq.current) return;
      toast.error(t('data.conn.testRequestFailed', { values: { message: describeError(error, { t, localizeError }) } }));
    } finally {
      if (seq === testSeq.current) setTesting(false);
    }
  };

  return (
    <div className="detail-panel">
      <dl className="kv-list">
        <div className="kv-list__row">
          <dt>{t('common.name')}</dt>
          <dd>
            {connection.name}
            {connection.isReadOnly ? (
              <span className="badge badge--warning">{t('connStatus.readonly')}</span>
            ) : null}
          </dd>
        </div>
        <div className="kv-list__row">
          <dt>{t('common.type')}</dt>
          <dd className="mono">{connection.dbType}</dd>
        </div>
        <div className="kv-list__row">
          <dt>{t('data.conn.colAddress')}</dt>
          <dd className="mono wrap-anywhere">{buildConnectionAddress(connection)}</dd>
        </div>
        <div className="kv-list__row">
          <dt>{t('data.conn.fieldUsername')}</dt>
          <dd className="mono">{connection.username ?? t('common.dash')}</dd>
        </div>
        <div className="kv-list__row">
          <dt>{t('data.conn.fieldPassword')}</dt>
          <dd>
            {connection.hasPassword ? t('data.conn.passwordSavedNoEcho') : t('data.conn.notSaved')}
          </dd>
        </div>
        <div className="kv-list__row">
          <dt>{t('data.conn.favoriteBadge')}</dt>
          <dd>{connection.isFavorite ? t('common.yes') : t('common.no')}</dd>
        </div>
        <div className="kv-list__row">
          <dt>{t('data.conn.colLastUsed')}</dt>
          <dd className="mono">{formatDateTime(connection.lastUsedAt)}</dd>
        </div>
        <div className="kv-list__row">
          <dt>{t('common.createdAt')}</dt>
          <dd className="mono">{formatDateTime(connection.createdAt)}</dd>
        </div>
        <div className="kv-list__row">
          <dt>{t('common.updatedAt')}</dt>
          <dd className="mono">{formatDateTime(connection.updatedAt)}</dd>
        </div>
        <div className="kv-list__row kv-list__row--block">
          <dt>{t('data.conn.sessionTest')}</dt>
          <dd>
            {testing ? (
              <span className="inline-loading">
                <span className="spinner" aria-hidden="true" />
                {t('data.conn.testing')}
              </span>
            ) : result && result.connectionId === connection.id ? (
              <span className={classNames('badge', result.data.ok ? 'badge--success' : 'badge--danger')}>
                {/* 失败时展示服务端返回的原始 message（数据，非界面硬编码文案） */}
                {result.data.ok
                  ? `${t('connStatus.ok')} · ${formatDuration(result.data.latencyMs)}`
                  : result.data.message}
              </span>
            ) : (
              <span className="text-muted">{t('data.conn.notTested')}</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="detail-panel__actions">
        <Button icon="play" variant="primary" loading={testing} block onClick={() => void handleTest()}>
          {t('data.conn.testConnection')}
        </Button>
        <Button
          icon="settings"
          block
          onClick={() => {
            onEdit(connection);
          }}
        >
          {t('data.conn.editThis')}
        </Button>
      </div>

      <p className="detail-panel__hint">{t('data.conn.detailHint')}</p>
    </div>
  );
}
