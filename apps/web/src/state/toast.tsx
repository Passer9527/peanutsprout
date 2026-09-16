import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from '../components/Icons';
import { useT } from '../state/i18n';
import { classNames } from '../utils/format';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  push: (kind: ToastKind, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 4200;

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(1);
  const timersRef = useRef<number[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextIdRef.current;
      nextIdRef.current += 1;
      setToasts((current) => [...current, { id, kind, message }]);
      const timer = window.setTimeout(() => {
        dismiss(id);
        timersRef.current = timersRef.current.filter((value) => value !== timer);
      }, AUTO_DISMISS_MS);
      timersRef.current.push(timer);
    },
    [dismiss],
  );

  useEffect(() => {
    const timers = timersRef;
    return () => {
      for (const timer of timers.current) {
        window.clearTimeout(timer);
      }
      timers.current = [];
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      dismiss,
      success: (message: string) => {
        push('success', message);
      },
      error: (message: string) => {
        push('error', message);
      },
      info: (message: string) => {
        push('info', message);
      },
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={classNames('toast', `toast--${toast.kind}`)}>
            <span className="toast__icon">
              <Icon
                name={toast.kind === 'success' ? 'check' : toast.kind === 'error' ? 'alert' : 'info'}
                size={16}
              />
            </span>
            <span className="toast__message">{toast.message}</span>
            <button
              type="button"
              className="toast__close"
              aria-label={t('admin.toast.close')}
              onClick={() => {
                dismiss(toast.id);
              }}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast 必须在 ToastProvider 内部使用');
  }
  return context;
}
