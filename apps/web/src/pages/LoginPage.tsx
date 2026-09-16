import { useState } from 'react';
import type { FormEvent } from 'react';
import type { MessageKey } from '@peanutsprout/i18n';
import { ApiError, describeError } from '../api/client';
import { Button } from '../components/Button';
import { Icon } from '../components/Icons';
import { useAuth } from '../state/auth';
import { useI18n } from '../state/i18n';

// 亮点区只保存消息键，渲染时再取当前语言文案（键名拼错会在编译期报错）
const HIGHLIGHTS: ReadonlyArray<{ titleKey: MessageKey; detailKey: MessageKey }> = [
  { titleKey: 'auth.login.highlight.drivers.title', detailKey: 'auth.login.highlight.drivers.detail' },
  { titleKey: 'auth.login.highlight.sql.title', detailKey: 'auth.login.highlight.sql.detail' },
  { titleKey: 'auth.login.highlight.audit.title', detailKey: 'auth.login.highlight.audit.detail' },
];

export function LoginPage() {
  const { login } = useAuth();
  const { t, localizeError } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (username.trim().length === 0) {
      setErrorText(t('auth.validation.usernameRequired'));
      return;
    }
    if (password.length === 0) {
      setErrorText(t('auth.validation.passwordRequired'));
      return;
    }
    setSubmitting(true);
    setErrorText(null);
    try {
      await login(username.trim(), password);
    } catch (error) {
      // 服务端错误按 error.code 本地化；网络等非接口异常保留原始文案
      setErrorText(
        error instanceof ApiError ? localizeError(error) : describeError(error, { t, localizeError }),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="login-hero__brand">
          <span className="brand__mark brand__mark--lg" aria-hidden="true">
            <Icon name="database" size={26} />
          </span>
          <div>
            <h1>{t('app.name')}</h1>
            <p>{t('app.tagline')}</p>
          </div>
        </div>
        <ul className="login-hero__list">
          {HIGHLIGHTS.map((item) => (
            <li key={item.titleKey}>
              <span className="login-hero__check" aria-hidden="true">
                <Icon name="check" size={14} />
              </span>
              <div>
                <strong>{t(item.titleKey)}</strong>
                <p>{t(item.detailKey)}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="login-hero__footer">{t('auth.login.footer')}</p>
      </section>

      <section className="login-panel">
        <form className="login-card" onSubmit={handleSubmit} noValidate>
          <header className="login-card__header">
            <h2>{t('auth.login.title')}</h2>
            <p>{t('auth.login.subtitle')}</p>
          </header>

          {errorText ? (
            <div className="banner banner--danger" role="alert">
              <Icon name="alert" size={16} />
              <span>{errorText}</span>
            </div>
          ) : null}

          <label className="field">
            <span className="field__label">{t('auth.field.username')}</span>
            <input
              className="input"
              type="text"
              value={username}
              autoComplete="username"
              autoFocus
              placeholder={t('auth.login.usernamePlaceholder')}
              disabled={submitting}
              onChange={(event) => {
                setUsername(event.target.value);
              }}
            />
          </label>

          <label className="field">
            <span className="field__label">{t('auth.field.password')}</span>
            <span className="field__control">
              <input
                className="input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                autoComplete="current-password"
                placeholder={t('auth.login.passwordPlaceholder')}
                disabled={submitting}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
              />
              <button
                type="button"
                className="field__suffix"
                onClick={() => {
                  setShowPassword((value) => !value);
                }}
                aria-label={showPassword ? t('auth.login.hidePassword') : t('auth.login.showPassword')}
                title={showPassword ? t('auth.login.hidePassword') : t('auth.login.showPassword')}
              >
                <Icon name="eye" size={16} />
              </button>
            </span>
          </label>

          <Button type="submit" variant="primary" block loading={submitting} icon="logout">
            {submitting ? t('auth.login.submitting') : t('auth.login.submit')}
          </Button>

          <p className="login-card__hint">{t('auth.login.hint')}</p>
        </form>
      </section>
    </div>
  );
}
