import { useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '../state/auth';
import { useI18n } from '../state/i18n';
import { navItemOf } from '../state/view';
import type { ViewKey } from '../state/view';
import { classNames } from '../utils/format';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export interface LayoutProps {
  view: ViewKey;
  onNavigate: (view: ViewKey) => void;
  /** 右侧辅助面板内容；不传则隐藏面板与切换按钮 */
  aside?: ReactNode;
  asideTitle?: string;
  children: ReactNode;
}

/**
 * 应用外壳，遵循 PRD 4.7：左侧导航 + 中间主工作区 + 右侧辅助面板，均可折叠。
 */
export function Layout({ view, onNavigate, aside, asideTitle, children }: LayoutProps) {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [asideCollapsed, setAsideCollapsed] = useState(false);
  const nav = navItemOf(view);
  const asideAvailable = aside !== undefined && aside !== null;

  const handleLogout = () => {
    void logout();
  };

  return (
    <div
      className={classNames(
        'app-shell',
        sidebarCollapsed && 'app-shell--sidebar-collapsed',
        asideAvailable && !asideCollapsed && 'app-shell--aside-open',
      )}
    >
      <Sidebar
        current={view}
        onNavigate={onNavigate}
        collapsed={sidebarCollapsed}
        isAdmin={user !== null && user.isAdmin}
        onToggleCollapse={() => {
          setSidebarCollapsed((value) => !value);
        }}
      />

      <div className="app-main">
        <TopBar
          title={t(nav.labelKey)}
          description={t(nav.descriptionKey)}
          user={user}
          asideAvailable={asideAvailable}
          asideCollapsed={asideCollapsed}
          onToggleSidebar={() => {
            setSidebarCollapsed((value) => !value);
          }}
          onToggleAside={() => {
            setAsideCollapsed((value) => !value);
          }}
          onLogout={handleLogout}
        />

        <div className="app-body">
          <main className="app-content">{children}</main>
          {asideAvailable ? (
            <aside className={classNames('app-aside', asideCollapsed && 'app-aside--collapsed')}>
              <div className="app-aside__header">
                <span>{asideTitle ?? t('nav.asideDefaultTitle')}</span>
              </div>
              <div className="app-aside__body">{aside}</div>
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}
