import type { MessageKey } from '@peanutsprout/i18n';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { API_BASE, ApiError } from '../api/client';
import { authApi, healthApi } from '../api/endpoints';
import type { HealthDTO } from '../api/types';
import { AiSettingsCard } from '../components/AiSettingsCard';
import { Button } from '../components/Button';
import { Icon } from '../components/Icons';
import { LanguageSelect } from '../components/LanguageSwitcher';
import { useAuth } from '../state/auth';
import { useI18n } from '../state/i18n';
import { useTheme } from '../state/theme';
import { useToast } from '../state/toast';
import { formatUptime } from '../utils/format';
import type { ThemeMode } from '../state/theme';

const THEME_OPTIONS: Array<{
  value: ThemeMode;
  labelKey: MessageKey;
  icon: 'sun' | 'moon';
  hintKey: MessageKey;
}> = [
  {
    value: 'light',
    labelKey: 'admin.settings.theme.light',
    icon: 'sun',
    hintKey: 'admin.settings.theme.lightHint',
  },
  {
    value: 'dark',
    labelKey: 'admin.settings.theme.dark',
    icon: 'moon',
    hintKey: 'admin.settings.theme.darkHint',
  },
];

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

export function SettingsPage() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const { t, localizeError } = useI18n();
  const toast = useToast();

  const [health, setHealth] = useState<HealthDTO | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const checkHealth = useCallback(
    async (notify: boolean) => {
      setHealthLoading(true);
      setHealthError(null);
      try {
        const result = await healthApi.check();
        setHealth(result);
        if (notify) {
          toast.success(
            t('admin.settings.service.ok', { values: { version: result.version } }),
          );
        }
      } catch (error) {
        setHealth(null);
        const message = localizeError(localizable(error));
        setHealthError(message);
        if (notify) {
          toast.error(message);
        }
      } finally {
        setHealthLoading(false);
      }
    },
    [localizeError, t, toast],
  );

  useEffect(() => {
    void checkHealth(false);
  }, [checkHealth]);

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (oldPassword.length === 0) {
      setPasswordError(t('admin.settings.password.errCurrentRequired'));
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError(t('admin.settings.password.errTooShort'));
      return;
    }
    if (newPassword === oldPassword) {
      setPasswordError(t('admin.settings.password.errSameAsCurrent'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t('admin.settings.password.errMismatch'));
      return;
    }
    setPasswordSubmitting(true);
    setPasswordError(null);
    try {
      await authApi.changePassword(oldPassword, newPassword);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success(t('admin.settings.password.success'));
    } catch (error) {
      const message = localizeError(localizable(error));
      setPasswordError(message);
      toast.error(message);
    } finally {
      setPasswordSubmitting(false);
    }
  };

  return (
    <div className="page page--narrow">
      {/* AI 配置需要 settings.manage 权限，非管理员不渲染（后端也会再挡一次） */}
      {user?.isAdmin ? <AiSettingsCard /> : null}

      <section className="card">
        <header className="card__header">
          <h2 className="card__title">{t('admin.settings.appearance.title')}</h2>
          <p className="card__subtitle">{t('admin.settings.appearance.subtitle')}</p>
        </header>
        <div className="theme-options">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`theme-option${theme === option.value ? ' theme-option--active' : ''}`}
              onClick={() => {
                setTheme(option.value);
              }}
              aria-pressed={theme === option.value}
            >
              <span className="theme-option__icon">
                <Icon name={option.icon} size={18} />
              </span>
              <span className="theme-option__text">
                <strong>{t(option.labelKey)}</strong>
                <small>{t(option.hintKey)}</small>
              </span>
              {theme === option.value ? (
                <span className="theme-option__check">
                  <Icon name="check" size={15} />
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <header className="card__header">
          <h2 className="card__title">{t('common.language')}</h2>
        </header>
        <LanguageSelect />
      </section>

      <section className="card">
        <header className="card__header">
          <h2 className="card__title">{t('admin.settings.service.title')}</h2>
          <p className="card__subtitle">
            {t('admin.settings.service.subtitle', { values: { base: API_BASE } })}
          </p>
        </header>
        <dl className="kv-list">
          <div className="kv-list__row">
            <dt>{t('admin.settings.service.apiBase')}</dt>
            <dd className="mono">{API_BASE}</dd>
          </div>
          <div className="kv-list__row">
            <dt>{t('admin.settings.service.pageOrigin')}</dt>
            <dd className="mono">
              {typeof window === 'undefined' ? t('common.dash') : window.location.origin}
            </dd>
          </div>
          <div className="kv-list__row">
            <dt>{t('admin.settings.service.authMethod')}</dt>
            <dd className="mono">Authorization: Bearer &lt;token&gt;</dd>
          </div>
          <div className="kv-list__row">
            <dt>{t('admin.settings.service.status')}</dt>
            <dd>
              {healthLoading ? (
                <span className="inline-loading">
                  <span className="spinner" aria-hidden="true" />
                  {t('admin.settings.service.checking')}
                </span>
              ) : health ? (
                <span className="badge badge--success">
                  {t('admin.settings.service.statusLine', {
                    values: {
                      status: health.status,
                      version: health.version,
                      uptime: formatUptime(health.uptimeSec, t),
                    },
                  })}
                </span>
              ) : (
                <span className="badge badge--danger">
                  {healthError ?? t('admin.settings.service.unavailable')}
                </span>
              )}
            </dd>
          </div>
        </dl>
        <div className="card__actions">
          <Button
            icon="refresh"
            loading={healthLoading}
            onClick={() => {
              void checkHealth(true);
            }}
          >
            {t('admin.settings.service.recheck')}
          </Button>
        </div>
      </section>

      <section className="card">
        <header className="card__header">
          <h2 className="card__title">{t('admin.settings.password.title')}</h2>
          <p className="card__subtitle">
            {t('admin.settings.password.currentAccount')}
            <strong>{user ? user.username : t('common.dash')}</strong>
          </p>
        </header>
        <form className="form-grid" onSubmit={handlePasswordSubmit} noValidate>
          {passwordError ? (
            <div className="banner banner--danger form-grid__full" role="alert">
              <Icon name="alert" size={16} />
              <span>{passwordError}</span>
            </div>
          ) : null}
          <label className="field form-grid__full">
            <span className="field__label">{t('admin.settings.password.current')}</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={oldPassword}
              disabled={passwordSubmitting}
              onChange={(event) => {
                setOldPassword(event.target.value);
              }}
            />
          </label>
          <label className="field">
            <span className="field__label">{t('admin.settings.password.new')}</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              disabled={passwordSubmitting}
              onChange={(event) => {
                setNewPassword(event.target.value);
              }}
            />
            <span className="field__hint">{t('admin.settings.password.newHint')}</span>
          </label>
          <label className="field">
            <span className="field__label">{t('admin.settings.password.confirm')}</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              disabled={passwordSubmitting}
              onChange={(event) => {
                setConfirmPassword(event.target.value);
              }}
            />
          </label>
          <div className="form-grid__actions form-grid__full">
            <Button type="submit" variant="primary" icon="key" loading={passwordSubmitting}>
              {t('admin.settings.password.submit')}
            </Button>
          </div>
        </form>
      </section>

      <section className="card">
        <header className="card__header">
          <h2 className="card__title">{t('admin.settings.about.title')}</h2>
          <p className="card__subtitle">{t('admin.settings.about.subtitle')}</p>
        </header>
        <dl className="kv-list">
          <div className="kv-list__row">
            <dt>{t('admin.settings.about.productName')}</dt>
            <dd>{t('admin.settings.about.productValue')}</dd>
          </div>
          <div className="kv-list__row">
            <dt>{t('common.version')}</dt>
            <dd>{t('admin.settings.about.versionValue')}</dd>
          </div>
          <div className="kv-list__row">
            <dt>{t('admin.settings.about.author')}</dt>
            <dd>{t('admin.settings.about.authorValue')}</dd>
          </div>
          <div className="kv-list__row">
            <dt>{t('admin.settings.about.license')}</dt>
            <dd>{t('admin.settings.about.licenseValue')}</dd>
          </div>
          <div className="kv-list__row">
            <dt>{t('admin.settings.about.stack')}</dt>
            <dd>{t('admin.settings.about.stackValue')}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
