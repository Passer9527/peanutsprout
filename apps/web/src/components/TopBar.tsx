import type { AuthUserDTO } from '../api/types';
import { useI18n } from '../state/i18n';
import { useTheme } from '../state/theme';
import { IconButton } from './Button';
import { Icon } from './Icons';
import { LanguageMenu } from './LanguageSwitcher';

export interface TopBarProps {
  title: string;
  description: string;
  user: AuthUserDTO | null;
  asideAvailable: boolean;
  asideCollapsed: boolean;
  onToggleSidebar: () => void;
  onToggleAside: () => void;
  onLogout: () => void;
}

export function TopBar({
  title,
  description,
  user,
  asideAvailable,
  asideCollapsed,
  onToggleSidebar,
  onToggleAside,
  onLogout,
}: TopBarProps) {
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();

  // display_name 在数据库里可为空（后端原样返回 null），统一回退到用户名，
  // 避免对 null 调用 slice() 导致整棵 React 树崩溃白屏。
  const displayName = user ? (user.displayName ?? user.username) : '';

  return (
    <header className="topbar">
      <div className="topbar__left">
        <IconButton icon="menu" label={t('nav.toggleSidebar')} onClick={onToggleSidebar} />
        <div className="topbar__titles">
          <h1 className="topbar__title">{title}</h1>
          <p className="topbar__desc">{description}</p>
        </div>
      </div>

      <div className="topbar__right">
        <IconButton
          icon={theme === 'dark' ? 'sun' : 'moon'}
          label={theme === 'dark' ? t('topbar.switchToLight') : t('topbar.switchToDark')}
          onClick={toggleTheme}
        />
        <LanguageMenu />
        {asideAvailable ? (
          <IconButton
            icon="panelRight"
            label={asideCollapsed ? t('nav.expandAside') : t('nav.collapseAside')}
            active={!asideCollapsed}
            onClick={onToggleAside}
          />
        ) : null}
        <div className="user-chip" title={user ? `${displayName}（${user.username}）` : ''}>
          <span className="user-chip__avatar" aria-hidden="true">
            {user ? displayName.slice(0, 1) : '?'}
          </span>
          <span className="user-chip__text">
            <strong>{user ? displayName : t('common.notLoggedIn')}</strong>
            <small>
              {user ? user.username : ''}
              {user && user.isAdmin ? t('topbar.adminSuffix') : ''}
            </small>
          </span>
        </div>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onLogout}>
          <Icon name="logout" size={15} />
          <span className="btn__label">{t('topbar.logout')}</span>
        </button>
      </div>
    </header>
  );
}
