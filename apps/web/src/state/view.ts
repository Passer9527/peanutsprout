import type { MessageKey } from '@peanutsprout/i18n';

import type { IconName } from '../components/Icons';

export type ViewKey =
  | 'connections'
  | 'table'
  | 'designer'
  | 'sql'
  | 'ai'
  | 'charts'
  | 'dashboards'
  | 'audit'
  | 'users'
  | 'settings';

/**
 * 导航项只保存**消息键**而不是文案本身。
 * 这样切换语言时导航会跟着变，而且键名写错会在编译期报错
 * （`MessageKey` 由简体中文语言包推导）。
 */
export interface NavItem {
  key: ViewKey;
  labelKey: MessageKey;
  icon: IconName;
  descriptionKey: MessageKey;
  adminOnly: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  {
    key: 'connections',
    labelKey: 'nav.connections.label',
    icon: 'connections',
    descriptionKey: 'nav.connections.description',
    adminOnly: false,
  },
  {
    key: 'table',
    labelKey: 'nav.table.label',
    icon: 'table',
    descriptionKey: 'nav.table.description',
    adminOnly: false,
  },
  {
    key: 'designer',
    labelKey: 'nav.designer.label',
    icon: 'columns',
    descriptionKey: 'nav.designer.description',
    adminOnly: false,
  },
  {
    key: 'sql',
    labelKey: 'nav.sql.label',
    icon: 'terminal',
    descriptionKey: 'nav.sql.description',
    adminOnly: false,
  },
  {
    key: 'ai',
    labelKey: 'nav.ai.label',
    icon: 'sparkles',
    descriptionKey: 'nav.ai.description',
    adminOnly: false,
  },
  {
    key: 'charts',
    labelKey: 'nav.charts.label',
    icon: 'chart',
    descriptionKey: 'nav.charts.description',
    adminOnly: false,
  },
  {
    key: 'dashboards',
    labelKey: 'nav.dashboards.label',
    icon: 'dashboard',
    descriptionKey: 'nav.dashboards.description',
    adminOnly: false,
  },
  {
    key: 'audit',
    labelKey: 'nav.audit.label',
    icon: 'shield',
    descriptionKey: 'nav.audit.description',
    adminOnly: false,
  },
  {
    key: 'users',
    labelKey: 'nav.users.label',
    icon: 'users',
    descriptionKey: 'nav.users.description',
    adminOnly: true,
  },
  {
    key: 'settings',
    labelKey: 'nav.settings.label',
    icon: 'settings',
    descriptionKey: 'nav.settings.description',
    adminOnly: false,
  },
];

export function navItemOf(key: ViewKey): NavItem {
  const found = NAV_ITEMS.find((item) => item.key === key);
  return found ?? NAV_ITEMS[0];
}
