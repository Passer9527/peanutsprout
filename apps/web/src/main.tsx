import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './state/auth';
import { I18nProvider } from './state/i18n';
import { ThemeProvider } from './state/theme';
import { ToastProvider } from './state/toast';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('未找到 #root 挂载点，请检查 index.html');
}

// Provider 顺序有依赖：
//   · AuthProvider 内部会调用 useToast，因此必须位于 ToastProvider 之内；
//   · I18nProvider 放在最外层，因为主题、提示、登录态都会用到文案。
createRoot(container).render(
  <StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </I18nProvider>
  </StrictMode>,
);
