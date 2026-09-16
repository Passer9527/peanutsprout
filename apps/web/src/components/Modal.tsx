import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useI18n } from '../state/i18n';
import { classNames } from '../utils/format';
import { IconButton } from './Button';

export interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** 弹窗最大宽度（px） */
  width?: number;
  className?: string;
}

export function Modal({ open, title, description, onClose, children, footer, width = 620, className }: ModalProps) {
  const { t } = useI18n();
  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={classNames('modal', className)}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ maxWidth: `${width}px` }}
      >
        <header className="modal__header">
          <div>
            <h2 className="modal__title">{title}</h2>
            {description ? <p className="modal__description">{description}</p> : null}
          </div>
          <IconButton icon="close" label={t('common.close')} onClick={onClose} />
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
