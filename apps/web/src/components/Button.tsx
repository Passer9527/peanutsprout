import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { classNames } from '../utils/format';
import { Icon } from './Icons';
import type { IconName } from './Icons';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  block?: boolean;
  icon?: IconName;
  className?: string;
  children?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  block = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const iconSize = size === 'sm' ? 14 : 16;
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled === true || loading}
      className={classNames('btn', `btn--${variant}`, `btn--${size}`, block && 'btn--block', className)}
    >
      {loading ? (
        <span className="spinner" aria-hidden="true" />
      ) : icon ? (
        <Icon name={icon} size={iconSize} />
      ) : null}
      {children === undefined || children === null ? null : <span className="btn__label">{children}</span>}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'title'> {
  icon: IconName;
  label: string;
  size?: number;
  className?: string;
  active?: boolean;
  variant?: 'default' | 'danger';
}

export function IconButton({
  icon,
  label,
  size = 16,
  className,
  active = false,
  variant = 'default',
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      title={label}
      aria-label={label}
      className={classNames(
        'icon-btn',
        variant === 'danger' && 'icon-btn--danger',
        active && 'icon-btn--active',
        className,
      )}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}
