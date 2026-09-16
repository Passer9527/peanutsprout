import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { MessageKey } from '@peanutsprout/i18n';
import { ApiError, describeError } from '../api/client';
import { usersApi } from '../api/endpoints';
import type { CreateUserInput, UpdateUserInput, UserDTO } from '../api/types';
import { Button, IconButton } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DataGrid } from '../components/DataGrid';
import type { DataGridColumn } from '../components/DataGrid';
import { Icon } from '../components/Icons';
import { Modal } from '../components/Modal';
import { useAuth } from '../state/auth';
import { useI18n } from '../state/i18n';
import { useToast } from '../state/toast';
import { classNames, formatDateTime, optionalText, parseListInput } from '../utils/format';

/**
 * 邮箱格式校验：与服务端用户路由的 `z.string().email()`（见 apps/server 的
 * audit-users.ts）对齐。表单是 noValidate、且 type=email 的原生校验被关闭，
 * 不显式检查的话用户只能拿到笼统的 VALIDATION_FAILED。
 * 刻意"宁松勿严"：本地误杀合法邮箱比放过个别非法邮箱更糟，最终仍以服务端为准。
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface UserFormState {
  username: string;
  password: string;
  displayName: string;
  email: string;
  isAdmin: boolean;
  roles: string;
}

function emptyForm(): UserFormState {
  return { username: '', password: '', displayName: '', email: '', isAdmin: false, roles: '' };
}

function formOf(user: UserDTO): UserFormState {
  return {
    username: user.username,
    password: '',
    displayName: user.displayName ?? '',
    email: user.email ?? '',
    isAdmin: user.isAdmin,
    roles: user.roles.join(', '),
  };
}

interface UserFormProps {
  mode: 'create' | 'edit';
  /** 编辑时传入的原始用户，仅用于初始化表单 */
  initial: UserDTO | null;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (state: UserFormState) => void;
}

function UserForm({ mode, initial, saving, onCancel, onSubmit }: UserFormProps) {
  const { t } = useI18n();
  const [form, setForm] = useState<UserFormState>(() => (initial ? formOf(initial) : emptyForm()));
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<UserFormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === 'create' && form.username.trim().length === 0) {
      setError(t('auth.validation.usernameRequired'));
      return;
    }
    if (mode === 'create' && form.password.length < 6) {
      setError(t('auth.validation.passwordMinLength'));
      return;
    }
    if (mode === 'edit' && form.password.length > 0 && form.password.length < 6) {
      setError(t('auth.validation.passwordResetMinLength'));
      return;
    }
    // 邮箱可留空；填了就按后端同款规则校验
    const email = form.email.trim();
    if (email.length > 0 && !EMAIL_PATTERN.test(email)) {
      // 语言包里暂无 emailInvalid 词条（packages/i18n 不在本次改动范围），
      // 用「字段名 + 取值不合法」两个既有词条拼出明确提示，避免只提示"提交失败"。
      setError(t('auth.validation.emailInvalid'));
      return;
    }
    setError(null);
    onSubmit(form);
  };

  return (
    <form className="form-grid" onSubmit={handleSubmit} noValidate>
      {error ? (
        <div className="banner banner--danger form-grid__full" role="alert">
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      <label className="field">
        <span className="field__label">{t('auth.field.username')} *</span>
        <input
          className="input"
          type="text"
          value={form.username}
          disabled={mode === 'edit' || saving}
          placeholder={t('auth.users.usernamePlaceholder')}
          onChange={(event) => {
            update({ username: event.target.value });
          }}
        />
        {mode === 'edit' ? <span className="field__hint">{t('auth.users.usernameImmutable')}</span> : null}
      </label>

      <label className="field">
        <span className="field__label">
          {mode === 'create' ? `${t('auth.users.initialPassword')} *` : t('auth.users.resetPassword')}
        </span>
        <input
          className="input"
          type="password"
          value={form.password}
          autoComplete="new-password"
          disabled={saving}
          placeholder={
            mode === 'create' ? t('auth.users.passwordMinPlaceholder') : t('auth.users.passwordKeepPlaceholder')
          }
          onChange={(event) => {
            update({ password: event.target.value });
          }}
        />
      </label>

      <label className="field">
        <span className="field__label">{t('auth.users.displayName')}</span>
        <input
          className="input"
          type="text"
          value={form.displayName}
          disabled={saving}
          placeholder={t('auth.users.displayNamePlaceholder')}
          onChange={(event) => {
            update({ displayName: event.target.value });
          }}
        />
      </label>

      <label className="field">
        <span className="field__label">{t('auth.field.email')}</span>
        <input
          className="input"
          type="email"
          value={form.email}
          disabled={saving}
          placeholder="name@example.com"
          onChange={(event) => {
            update({ email: event.target.value });
          }}
        />
      </label>

      <label className="field form-grid__full">
        <span className="field__label">{t('auth.field.roles')}</span>
        <input
          className="input"
          type="text"
          value={form.roles}
          disabled={saving}
          placeholder={t('auth.users.rolesPlaceholder')}
          onChange={(event) => {
            update({ roles: event.target.value });
          }}
        />
        <span className="field__hint">{t('auth.users.rolesHint')}</span>
      </label>

      <label className="field field--inline form-grid__full">
        <input
          type="checkbox"
          className="checkbox"
          checked={form.isAdmin}
          disabled={saving}
          onChange={(event) => {
            update({ isAdmin: event.target.checked });
          }}
        />
        <span>
          {t('auth.users.grantAdmin')}
          <small>{t('auth.users.grantAdminHint')}</small>
        </span>
      </label>

      <div className="form-grid__actions form-grid__full">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" loading={saving} icon="check">
          {mode === 'create' ? t('auth.users.createSubmit') : t('common.saveChanges')}
        </Button>
      </div>
    </form>
  );
}

export function UsersPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { t, localizeError } = useI18n();
  const [items, setItems] = useState<UserDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UserDTO | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserDTO | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isAdmin = user !== null && user.isAdmin;
  const currentUserId = user === null ? null : user.id;

  // 服务端错误按 error.code 本地化；网络等非接口异常保留原始信息
  const describeLocalized = useCallback(
    (error: unknown): string => (error instanceof ApiError ? localizeError(error) : describeError(error)),
    [localizeError],
  );

  const load = useCallback(async () => {
    if (!isAdmin) {
      return;
    }
    setLoading(true);
    try {
      const response = await usersApi.list();
      setItems(response.items);
    } catch (error) {
      toast.error(t('auth.users.loadFailed', { values: { message: describeLocalized(error) } }));
    } finally {
      setLoading(false);
    }
  }, [isAdmin, toast, t, describeLocalized]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (state: UserFormState) => {
    const payload: CreateUserInput = {
      username: state.username.trim(),
      password: state.password,
      displayName: optionalText(state.displayName),
      email: optionalText(state.email),
      isAdmin: state.isAdmin,
      roles: parseListInput(state.roles),
    };
    setSaving(true);
    try {
      await usersApi.create(payload);
      toast.success(t('auth.users.created', { values: { name: payload.username } }));
      setModalOpen(false);
      await load();
    } catch (error) {
      toast.error(t('auth.users.createFailed', { values: { message: describeLocalized(error) } }));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (target: UserDTO, state: UserFormState) => {
    const payload: UpdateUserInput = {
      displayName: optionalText(state.displayName),
      email: optionalText(state.email),
      isAdmin: state.isAdmin,
      roles: parseListInput(state.roles),
    };
    if (state.password.length > 0) {
      payload.password = state.password;
    }
    setSaving(true);
    try {
      const response = await usersApi.update(target.id, payload);
      toast.success(t('auth.users.updated', { values: { name: response.item.username } }));
      setModalOpen(false);
      setEditing(null);
      await load();
    } catch (error) {
      toast.error(t('auth.users.updateFailed', { values: { message: describeLocalized(error) } }));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    setDeleting(true);
    try {
      await usersApi.remove(deleteTarget.id);
      toast.success(t('auth.users.deleted', { values: { name: deleteTarget.username } }));
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast.error(t('auth.users.deleteFailed', { values: { message: describeLocalized(error) } }));
    } finally {
      setDeleting(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="page">
        <div className="empty-state">
          <Icon name="lock" size={28} />
          <h2>{t('auth.users.adminOnlyTitle')}</h2>
          <p>{t('auth.users.adminOnlyHint')}</p>
        </div>
      </div>
    );
  }

  const columns: Array<DataGridColumn<UserDTO>> = [
    {
      key: 'username',
      header: t('auth.field.username'),
      width: '160px',
      render: (row) => (
        <span className="cell-stack">
          <strong>{row.username}</strong>
          {row.id === currentUserId ? (
            <span className="badge badge--muted">{t('auth.users.currentAccount')}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'displayName',
      header: t('auth.users.displayName'),
      width: '150px',
      render: (row) => row.displayName || <span className="text-muted">{t('common.dash')}</span>,
    },
    {
      key: 'email',
      header: t('auth.field.email'),
      width: '200px',
      render: (row) => <span className="mono">{row.email ?? t('common.dash')}</span>,
    },
    {
      key: 'roles',
      header: t('auth.field.roles'),
      render: (row) =>
        row.roles.length === 0 ? (
          <span className="text-muted">{t('common.dash')}</span>
        ) : (
          <span className="badge-group">
            {row.roles.map((role) => (
              <span key={role} className="badge badge--info">
                {/* 角色展示名按稳定 code 取 meta 表；自定义角色查不到时回退原始 code */}
                {t(`role.${role}` as MessageKey, { defaultValue: role })}
              </span>
            ))}
          </span>
        ),
    },
    {
      key: 'isAdmin',
      header: t('auth.users.adminColumn'),
      width: '90px',
      align: 'center',
      render: (row) =>
        row.isAdmin ? (
          <span className="badge badge--success">{t('common.yes')}</span>
        ) : (
          <span className="text-muted">{t('common.no')}</span>
        ),
    },
    {
      key: 'status',
      header: t('common.status'),
      width: '100px',
      render: (row) => (
        <span className={classNames('badge', row.status === 'active' ? 'badge--success' : 'badge--muted')}>
          {row.status}
        </span>
      ),
    },
    {
      key: 'lastLoginAt',
      header: t('auth.users.lastLogin'),
      width: '170px',
      render: (row) => <span className="mono">{formatDateTime(row.lastLoginAt)}</span>,
    },
    {
      key: 'createdAt',
      header: t('common.createdAt'),
      width: '170px',
      render: (row) => <span className="mono">{formatDateTime(row.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: t('common.actions'),
      width: '110px',
      align: 'right',
      render: (row) => (
        <span className="row-actions">
          <IconButton
            icon="settings"
            label={t('auth.users.editAction')}
            onClick={() => {
              setEditing(row);
              setModalOpen(true);
            }}
          />
          <IconButton
            icon="trash"
            label={row.id === currentUserId ? t('auth.users.cannotDeleteSelf') : t('auth.users.deleteAction')}
            variant="danger"
            disabled={row.id === currentUserId}
            onClick={() => {
              setDeleteTarget(row);
            }}
          />
        </span>
      ),
    },
  ];

  return (
    <div className="page">
      <section className="toolbar">
        <div className="toolbar__group">
          <span className="toolbar__count">{t('auth.users.count', { count: items.length })}</span>
        </div>
        <div className="toolbar__group">
          <Button icon="refresh" disabled={loading} onClick={() => void load()}>
            {t('common.refresh')}
          </Button>
          <Button
            icon="plus"
            variant="primary"
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            {t('auth.users.create')}
          </Button>
        </div>
      </section>

      <DataGrid
        columns={columns}
        rows={items}
        loading={loading}
        rowKey={(row) => String(row.id)}
        maxHeight="calc(100vh - 300px)"
        emptyText={t('auth.users.empty')}
        emptyHint={t('auth.users.emptyHint')}
      />

      <Modal
        open={modalOpen}
        title={
          editing
            ? t('auth.users.editTitle', { values: { name: editing.username } })
            : t('auth.users.create')
        }
        description={editing ? t('auth.users.editDescription') : t('auth.users.createDescription')}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        width={620}
      >
        {modalOpen ? (
          <UserForm
            key={editing ? `edit-${editing.id}` : 'create'}
            mode={editing ? 'edit' : 'create'}
            initial={editing}
            saving={saving}
            onCancel={() => {
              setModalOpen(false);
              setEditing(null);
            }}
            onSubmit={(state) => {
              if (editing) {
                void handleUpdate(editing, state);
              } else {
                void handleCreate(state);
              }
            }}
          />
        ) : null}
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('auth.users.deleteAction')}
        message={
          deleteTarget
            ? t('auth.users.deleteConfirm', { values: { name: deleteTarget.username } })
            : ''
        }
        confirmText={t('common.delete')}
        danger
        loading={deleting}
        onCancel={() => {
          setDeleteTarget(null);
        }}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
