import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, describeError } from '../api/client';
import { Button } from '../components/Button';
import { Icon } from '../components/Icons';
import { useAuth } from '../state/auth';
import { useI18n } from '../state/i18n';

/**
 * 强制改密页。
 *
 * 触发条件：服务端 `security.must_change_password` 仍为 true，
 * 也就是管理员账号还在用安装时内置的默认口令。
 * 此时服务端只放行改密相关接口，其余一律 403 PASSWORD_CHANGE_REQUIRED，
 * 所以这里**必须是不可绕过的**：不渲染主导航，也不给"稍后再说"按钮。
 * 唯一出口是改密成功，或主动退出登录重新登录。
 *
 * 样式与登录页保持同一套类名，避免为一次性页面新增 CSS。
 */
export function ForcePasswordChangePage() {
  const { user, changePassword, logout } = useAuth();
  const { t, localizeError } = useI18n();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (oldPassword.length === 0) {
      setErrorText(t('admin.settings.password.errCurrentRequired'));
      return;
    }
    if (newPassword.length < 6) {
      setErrorText(t('admin.settings.password.errTooShort'));
      return;
    }
    if (newPassword === oldPassword) {
      setErrorText(t('admin.settings.password.errSameAsCurrent'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorText(t('admin.settings.password.errMismatch'));
      return;
    }
    setSubmitting(true);
    setErrorText(null);
    try {
      await changePassword(oldPassword, newPassword);
      // 成功后 mustChangePassword 变为 false，App 自动切回主界面
    } catch (error) {
      setErrorText(error instanceof ApiError ? localizeError(error) : describeError(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <section className="login-panel">
        <form className="login-card" onSubmit={handleSubmit} noValidate>
          <header className="login-card__header">
            <h2>{t('auth.forcePassword.title')}</h2>
            <p>{t('auth.forcePassword.subtitle')}</p>
          </header>

          <div className="banner banner--warning" role="alert">
            <Icon name="alert" size={16} />
            <span>{t('auth.forcePassword.warning')}</span>
          </div>

          <p className="login-card__hint">
            {t('admin.settings.password.currentAccount')}
            <strong>{user?.username ?? ''}</strong>
          </p>

          <label className="field">
            <span className="field__label">{t('admin.settings.password.current')}</span>
            <span className="field__control">
              <input
                className="input"
                type={showPassword ? 'text' : 'password'}
                value={oldPassword}
                autoComplete="current-password"
                autoFocus
                onChange={(event) => setOldPassword(event.target.value)}
              />
              <button
                type="button"
                className="field__suffix"
                onClick={() => setShowPassword((previous) => !previous)}
                aria-label={
                  showPassword ? t('auth.login.hidePassword') : t('auth.login.showPassword')
                }
              >
                <Icon name="eye" size={16} />
              </button>
            </span>
          </label>

          <label className="field">
            <span className="field__label">{t('admin.settings.password.new')}</span>
            <input
              className="input"
              type={showPassword ? 'text' : 'password'}
              value={newPassword}
              autoComplete="new-password"
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>

          <label className="field">
            <span className="field__label">{t('admin.settings.password.confirm')}</span>
            <input
              className="input"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              autoComplete="new-password"
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
            <span className="field__hint">{t('admin.settings.password.newHint')}</span>
          </label>

          {errorText ? (
            <div className="banner banner--danger" role="alert">
              <Icon name="alert" size={16} />
              <span>{errorText}</span>
            </div>
          ) : null}

          <Button type="submit" variant="primary" block loading={submitting} icon="key">
            {submitting ? t('auth.forcePassword.submitting') : t('auth.forcePassword.submit')}
          </Button>
          <Button type="button" block onClick={() => void logout()}>
            {t('topbar.logout')}
          </Button>
        </form>
      </section>
    </div>
  );
}
