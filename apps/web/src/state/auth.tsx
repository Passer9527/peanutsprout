import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ApiError,
  describeError,
  setAuthToken,
  setPasswordChangeRequiredHandler,
  setUnauthorizedHandler,
} from '../api/client';
import { authApi } from '../api/endpoints';
import type { AuthUserDTO } from '../api/types';
import { useI18n } from './i18n';
import { useToast } from './toast';

const TOKEN_KEY = 'peanutsprout.token';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  user: AuthUserDTO | null;
  token: string | null;
  status: AuthStatus;
  /**
   * 服务端要求先改密（仍在使用内置默认口令）。
   *
   * 为 true 时除改密相关接口外的一切请求都会拿到 403，
   * 因此 App 会直接渲染强制改密页，而不是渲染主界面。
   */
  mustChangePassword: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredToken(): string | null {
  try {
    const stored = window.localStorage.getItem(TOKEN_KEY);
    return stored && stored.length > 0 ? stored : null;
  } catch {
    return null;
  }
}

function writeStoredToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // 存储失败时仅本次会话有效
  }
}

function clearStoredToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // 忽略
  }
}

/** 模块初始化时把持久化 token 注入 fetch 层，保证首屏请求即携带凭证 */
const initialToken = readStoredToken();
setAuthToken(initialToken);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [user, setUser] = useState<AuthUserDTO | null>(null);
  const [status, setStatus] = useState<AuthStatus>(initialToken ? 'loading' : 'anonymous');
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const bootstrappedRef = useRef(false);
  const toast = useToast();
  const { t, localizeError } = useI18n();

  // 服务端错误按 error.code 本地化；网络等非接口异常保留原始信息
  const describeLocalized = useCallback(
    (error: unknown): string => (error instanceof ApiError ? localizeError(error) : describeError(error)),
    [localizeError],
  );

  const clearSession = useCallback(() => {
    clearStoredToken();
    setAuthToken(null);
    setToken(null);
    setUser(null);
    setMustChangePassword(false);
    setStatus('anonymous');
  }, []);

  // 401 统一处理：清空登录态并回到登录页
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearSession();
      toast.info(t('common.sessionExpired'));
    });
    return () => {
      setUnauthorizedHandler(null);
    };
  }, [clearSession, toast, t]);

  // 任意请求撞上"必须先改密"时，立刻切到强制改密页。
  // 这样用户不会在别的页面看到一串莫名其妙的"权限不足"。
  useEffect(() => {
    setPasswordChangeRequiredHandler(() => {
      setMustChangePassword(true);
      setStatus('authenticated');
    });
    return () => {
      setPasswordChangeRequiredHandler(null);
    };
  }, []);

  /**
   * 启动时用持久化 token 调用 /auth/me 校验。
   *
   * StrictMode 下 effect 会「挂载 → 清理 → 再挂载」：旧实现首挂载就把
   * bootstrappedRef 置为 true，二次挂载因此直接 return；而首挂载的响应
   * 又落在已清理的闭包里（cancelled=true）被丢弃 —— 带着 token 刷新页面
   * 就会永久停在 loading。现在 bootstrappedRef 只在**拿到终态结果后**才置位，
   * 并用请求序号丢弃过期响应：二次挂载会补发请求，最终一定落到
   * authenticated 或 anonymous，不会悬挂在加载态。
   */
  const bootstrapSeq = useRef(0);
  useEffect(() => {
    if (bootstrappedRef.current) {
      return;
    }
    const seq = (bootstrapSeq.current += 1);
    const stored = readStoredToken();
    if (!stored) {
      bootstrappedRef.current = true;
      setStatus('anonymous');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    authApi
      .me()
      .then((response) => {
        if (cancelled || seq !== bootstrapSeq.current) {
          return;
        }
        bootstrappedRef.current = true;
        setUser(response.user);
        setMustChangePassword(response.mustChangePassword === true);
        setStatus('authenticated');
      })
      .catch((error: unknown) => {
        if (cancelled || seq !== bootstrapSeq.current) {
          return;
        }
        bootstrappedRef.current = true;
        clearSession();
        if (!(error instanceof ApiError && error.isUnauthorized)) {
          toast.error(t('auth.session.checkFailed', { values: { message: describeLocalized(error) } }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [clearSession, toast, t, describeLocalized]);

  const login = useCallback(async (username: string, password: string) => {
    const response = await authApi.login(username, password);
    writeStoredToken(response.token);
    setAuthToken(response.token);
    setToken(response.token);
    setUser(response.user);
    setMustChangePassword(response.mustChangePassword === true);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // 登出接口失败也要清理本地登录态
    }
    clearSession();
  }, [clearSession]);

  const refresh = useCallback(async () => {
    const response = await authApi.me();
    setUser(response.user);
    setMustChangePassword(response.mustChangePassword === true);
  }, []);

  /**
   * 改密成功后服务端会清掉 must_change_password 开关，
   * 本地也随之解除闸门（否则界面会一直停在强制改密页）。
   */
  const changePassword = useCallback(async (oldPassword: string, newPassword: string) => {
    await authApi.changePassword(oldPassword, newPassword);
    setMustChangePassword(false);
  }, []);

  const hasPermission = useCallback(
    (permission: string) => {
      if (!user) {
        return false;
      }
      if (user.isAdmin) {
        return true;
      }
      return user.permissions.includes(permission);
    },
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      status,
      mustChangePassword,
      login,
      logout,
      refresh,
      changePassword,
      hasPermission,
    }),
    [user, token, status, mustChangePassword, login, logout, refresh, changePassword, hasPermission],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth 必须在 AuthProvider 内部使用');
  }
  return context;
}
