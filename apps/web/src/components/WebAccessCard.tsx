/**
 * 设置页的「局域网访问（Web 页面）」卡片。
 *
 * 需要说明的一件事：这不是"要不要提供 Web 页面"的开关。Web 页面始终提供
 * （桌面端自己的窗口就加载 http://127.0.0.1:<port>/），这里控制的是
 * **是否允许局域网内其它设备用浏览器访问**。
 *
 * 两个容易出错、这里刻意区分开的点：
 *  · 已保存 ≠ 已生效。监听地址和端口只能在 listen 之前决定，所以改完必须重启。
 *    界面必须同时展示"当前实际生效"和"需重启"，否则用户会看到"显示已开启、
 *    实际连不上"的假象。因此数据取的是 /meta/web-access（含 effective 与
 *    restartRequired），而不是只看设置项。
 *  · 关闭状态不给局域网地址。此时地址给出去也没用，只会让人误以为能访问。
 */
import type { MessageKey } from '@peanutsprout/i18n';
import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '../api/client';
import { metaApi, settingsApi } from '../api/endpoints';
import type { WebAccessDTO, WebAccessWarning } from '../api/types';
import { Button } from '../components/Button';
import { Icon } from '../components/Icons';
import { useI18n } from '../state/i18n';
import { useToast } from '../state/toast';

/** 与后端 WRITABLE_SETTINGS 里 web.lan_port 的 min/max 保持一致 */
const PORT_MIN = 1024;
const PORT_MAX = 65535;

const PATH_KEY_LAN_ENABLED = 'web.lan_enabled';
const PATH_KEY_LAN_PORT = 'web.lan_port';

/** 风险提示 → 文案键。用 Record 约束，新增一种提示时编译期就会提醒补文案。 */
const WARNING_KEYS: Record<WebAccessWarning, MessageKey> = {
  lan_exposed: 'admin.webAccess.warn.lan_exposed',
  no_https: 'admin.webAccess.warn.no_https',
  default_password: 'admin.webAccess.warn.default_password',
};

/** 危险度高的提示用红色，其余用黄色 */
const DANGER_WARNINGS: readonly WebAccessWarning[] = ['default_password'];

function localizable(error: unknown): { code?: string; message?: string } {
  if (error instanceof ApiError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { message: error.message };
  return { message: String(error) };
}

/**
 * 复制到剪贴板。
 *
 * 为什么不用 navigator.clipboard 一把梭：Clipboard API 只在**安全上下文**
 * （https 或 localhost）可用，而这一页恰恰是在 http://192.168.x.x 这类
 * 非安全上下文里被使用的场景 —— 直接调用会抛错，用户点了"复制"却没反应。
 * 所以先试 Clipboard API，失败再退回临时 textarea + execCommand。
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 落到下面的兜底方案
  }
  try {
    if (typeof document === 'undefined') return false;
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    // 放到视口外，避免复制瞬间页面跳动
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export function WebAccessCard() {
  const { t, localizeError } = useI18n();
  const toast = useToast();

  const [data, setData] = useState<WebAccessDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 表单态：以"用户当前想保存的值"为准，与 data.saved 分离，便于算脏
  const [lanEnabled, setLanEnabled] = useState(false);
  const [portText, setPortText] = useState('');
  const [portError, setPortError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await metaApi.webAccess();
      setData(result);
      setLanEnabled(result.saved.lanEnabled);
      setPortText(String(result.saved.lanPort));
      setError(null);
    } catch (e) {
      setError(t('admin.webAccess.err.load', { values: { message: localizeError(localizable(e)) } }));
    } finally {
      setLoading(false);
    }
  }, [localizeError, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const parsedPort = Number.parseInt(portText.trim(), 10);
  const portValid =
    /^\d+$/.test(portText.trim()) && parsedPort >= PORT_MIN && parsedPort <= PORT_MAX;
  const dirty =
    data !== null &&
    (lanEnabled !== data.saved.lanEnabled || (portValid && parsedPort !== data.saved.lanPort));

  const onSave = async () => {
    if (!portValid) {
      setPortError(t('admin.webAccess.port.err'));
      return;
    }
    setPortError(null);
    setSaving(true);
    try {
      await settingsApi.update([
        { key: PATH_KEY_LAN_ENABLED, value: lanEnabled },
        { key: PATH_KEY_LAN_PORT, value: parsedPort },
      ]);
      toast.success(t('ai.settings.toast.autosaved'));
      await load();
    } catch (e) {
      toast.error(
        t('admin.webAccess.err.save', { values: { message: localizeError(localizable(e)) } }),
      );
    } finally {
      setSaving(false);
    }
  };

  const onCopy = async (url: string) => {
    const ok = await copyText(url);
    if (ok) toast.success(t('admin.webAccess.copied'));
    else toast.error(t('admin.webAccess.err.copy'));
  };

  const effective = data?.effective;

  return (
    <section className="card">
      <h2 className="card__title">{t('admin.webAccess.title')}</h2>
      <p className="card__subtitle">{t('admin.webAccess.subtitle')}</p>

      {loading ? (
        <p className="field__hint">{t('common.loading')}</p>
      ) : error ? (
        <div className="banner banner--danger" role="alert">
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </div>
      ) : data && effective ? (
        <>
          {/* 当前实际生效：与"已保存"分开显示，避免改完没重启却以为已生效 */}
          <dl className="kv-list">
            <div className="kv-list__row">
              <dt>{t('admin.webAccess.current.title')}</dt>
              <dd>
                <span
                  className={
                    effective.lanEnabled ? 'badge badge--warning' : 'badge badge--success'
                  }
                >
                  {effective.lanEnabled
                    ? t('admin.webAccess.current.on', {
                        values: { host: effective.host, port: effective.port },
                      })
                    : t('admin.webAccess.current.off', {
                        values: { host: effective.host, port: effective.port },
                      })}
                </span>
                {data.restartRequired ? (
                  <span className="badge badge--info">{t('admin.webAccess.restart.title')}</span>
                ) : null}
              </dd>
            </div>
          </dl>

          {data.restartRequired ? (
            <p className="field__hint">{t('admin.webAccess.restart.body')}</p>
          ) : null}

          <div className="toggle-list">
            <label className="toggle-row">
              <input
                type="checkbox"
                className="toggle-row__input"
                checked={lanEnabled}
                onChange={(event) => setLanEnabled(event.target.checked)}
              />
              <span className="toggle-row__text">
                <strong>{t('admin.webAccess.toggle.label')}</strong>
                <span className="field__hint">{t('admin.webAccess.toggle.hint')}</span>
              </span>
            </label>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="peanutsprout-lan-port">
              {t('admin.webAccess.port.label')}
            </label>
            <input
              id="peanutsprout-lan-port"
              className="input"
              inputMode="numeric"
              value={portText}
              // 关闭状态也允许改端口：先配好再打开是常见操作，禁掉反而别扭
              onChange={(event) => {
                setPortText(event.target.value);
                setPortError(null);
              }}
              aria-invalid={portError !== null}
            />
            <span className="field__hint">
              {portError ?? t('admin.webAccess.port.hint')}
            </span>
          </div>

          <div className="card__actions">
            <Button
              variant="primary"
              loading={saving}
              disabled={saving || !dirty || !portValid}
              onClick={() => void onSave()}
            >
              {saving ? t('admin.webAccess.saving') : t('admin.webAccess.save')}
            </Button>
            <Button variant="ghost" icon="refresh" onClick={() => void load()}>
              {t('common.refresh')}
            </Button>
          </div>

          {/* 风险提示：只在真正对外暴露时才有意义，关闭局域网时后端不会下发 */}
          {data.warnings.map((warning) => (
            <div
              key={warning}
              className={
                DANGER_WARNINGS.includes(warning)
                  ? 'banner banner--danger'
                  : 'banner banner--warning'
              }
              role="alert"
            >
              <Icon name="alert" size={16} />
              <span>{t(WARNING_KEYS[warning])}</span>
            </div>
          ))}

          {/* 可用地址：关闭局域网时只会有回环地址，这是有意的 */}
          <div className="field">
            <span className="field__label">{t('admin.webAccess.url.title')}</span>
            {data.urls.length === 0 ? (
              <span className="field__hint">{t('admin.webAccess.url.empty')}</span>
            ) : (
              <ul className="notice-list">
                {data.urls.map((url) => (
                  <li key={url}>
                    <code>{url}</code>{' '}
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="copy"
                      onClick={() => void onCopy(url)}
                    >
                      {t('admin.webAccess.copy')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {data.embedded ? (
            <p className="field__hint">{t('admin.webAccess.embedded')}</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
