import { useCallback, useState } from 'react';
import type { ConnectionDTO } from './api/types';
import { ConnectionDetail } from './components/ConnectionDetail';
import { Icon } from './components/Icons';
import { Layout } from './components/Layout';
import { AiAssistantPage } from './pages/AiAssistantPage';
import { AuditPage } from './pages/AuditPage';
import { ChartsPage } from './pages/ChartsPage';
import { ConnectionsPage } from './pages/ConnectionsPage';
import { DashboardsPage } from './pages/DashboardsPage';
import { ForcePasswordChangePage } from './pages/ForcePasswordChangePage';
import { LoginPage } from './pages/LoginPage';
import { SettingsPage } from './pages/SettingsPage';
import { SqlEditorPage } from './pages/SqlEditorPage';
import { TableDataPage } from './pages/TableDataPage';
import { TableDesignerPage } from './pages/TableDesignerPage';
import { UsersPage } from './pages/UsersPage';
import { useAuth } from './state/auth';
import { useI18n } from './state/i18n';
import type { ViewKey } from './state/view';

/**
 * 应用根组件：负责登录门禁、主导航切换与右侧辅助面板。
 * 视图切换使用本地状态而非路由库，桌面端与 Web 端共用同一套界面。
 */
export function App() {
  const { status, user, mustChangePassword } = useAuth();
  const { t } = useI18n();
  const [view, setView] = useState<ViewKey>('connections');
  const [selectedConnection, setSelectedConnection] = useState<ConnectionDTO | null>(null);
  const [editRequest, setEditRequest] = useState<{ connectionId: number; nonce: number } | null>(null);

  /** 右侧详情面板的「编辑」→ 通知连接列表打开表单弹窗 */
  const handleEditFromDetail = useCallback((connection: ConnectionDTO) => {
    setEditRequest({ connectionId: connection.id, nonce: Date.now() });
  }, []);

  if (status === 'loading') {
    return (
      <div className="app-splash">
        <span className="spinner" aria-hidden="true" />
        <p className="text-muted">{t('app.checkingSession')}</p>
      </div>
    );
  }

  if (status === 'anonymous' || !user) {
    return <LoginPage />;
  }

  // 仍在用内置默认口令时，服务端只放行改密相关接口，
  // 因此这里必须挡住整个主界面 —— 否则用户点哪都是"权限不足"。
  if (mustChangePassword) {
    return <ForcePasswordChangePage />;
  }

  const renderView = () => {
    switch (view) {
      case 'connections':
        return (
          <ConnectionsPage
            selected={selectedConnection}
            onSelect={setSelectedConnection}
            editRequest={editRequest}
          />
        );
      case 'table':
        return <TableDataPage onNavigate={setView} />;
      case 'designer':
        return <TableDesignerPage onNavigate={setView} />;
      case 'sql':
        return <SqlEditorPage />;
      case 'ai':
        return <AiAssistantPage onNavigate={setView} />;
      case 'charts':
        return <ChartsPage />;
      case 'dashboards':
        return <DashboardsPage />;
      case 'audit':
        return <AuditPage />;
      case 'users':
        if (!user.isAdmin) {
          return (
            <div className="page">
              <div className="card">
                <div className="card__header">
                  <h2 className="card__title">{t('app.forbiddenTitle')}</h2>
                  <p className="card__subtitle">{t('app.forbiddenHint')}</p>
                </div>
              </div>
            </div>
          );
        }
        return <UsersPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return null;
    }
  };

  /** 只有连接管理视图带右侧辅助面板，其余视图占满工作区 */
  const aside =
    view === 'connections' ? (
      selectedConnection ? (
        <ConnectionDetail connection={selectedConnection} onEdit={handleEditFromDetail} />
      ) : (
        <div className="empty-state empty-state--inline">
          <Icon name="connections" size={22} />
          <p>{t('app.asideConnectionEmpty')}</p>
          <p className="text-muted">{t('app.asideConnectionEmptyHint')}</p>
        </div>
      )
    ) : undefined;

  return (
    <Layout view={view} onNavigate={setView} aside={aside} asideTitle={t('app.asideConnectionTitle')}>
      {renderView()}
    </Layout>
  );
}
