import { useI18n } from '../state/i18n';
import { NAV_ITEMS } from '../state/view';
import type { ViewKey } from '../state/view';
import { classNames } from '../utils/format';
import { Icon } from './Icons';

export interface SidebarProps {
  current: ViewKey;
  onNavigate: (view: ViewKey) => void;
  collapsed: boolean;
  isAdmin: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({ current, onNavigate, collapsed, isAdmin, onToggleCollapse }: SidebarProps) {
  const { t } = useI18n();
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  return (
    <aside className={classNames('sidebar', collapsed && 'sidebar--collapsed')}>
      <div className="sidebar__brand">
        <span className="brand__mark" aria-hidden="true">
          <Icon name="database" size={18} />
        </span>
        <span className="brand__text">
          <strong>{t('app.name')}</strong>
          <small>{t('app.tagline')}</small>
        </span>
      </div>

      <nav className="sidebar__nav" aria-label={t('nav.ariaLabel')}>
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            className={classNames('nav-item', current === item.key && 'nav-item--active')}
            onClick={() => {
              onNavigate(item.key);
            }}
            title={collapsed ? t(item.labelKey) : t(item.descriptionKey)}
            aria-current={current === item.key ? 'page' : undefined}
          >
            <span className="nav-item__icon">
              <Icon name={item.icon} size={17} />
            </span>
            <span className="nav-item__text">
              <span className="nav-item__label">{t(item.labelKey)}</span>
              <span className="nav-item__desc">{t(item.descriptionKey)}</span>
            </span>
          </button>
        ))}
      </nav>

      <div className="sidebar__footer">
        <button
          type="button"
          className="sidebar__collapse"
          onClick={onToggleCollapse}
          title={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
        >
          <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={15} />
          <span className="sidebar__collapse-text">{t('nav.collapseText')}</span>
        </button>
        <p className="sidebar__meta">
          <span>v0.1.0</span>
          <span>{t('app.copyright')}</span>
        </p>
      </div>
    </aside>
  );
}
