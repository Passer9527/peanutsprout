/**
 * 设置页的「AI 助手」卡片：总开关 + 模型配置的增删改查 + 连通性测试。
 *
 * 为什么单独成组件：设置页本身已经很长，而这一块的逻辑（配置列表、弹窗表单、
 * 试连、模型列举、三个服务端开关）足够独立，拆出来更好维护。
 *
 * 安全要点：
 *  · 后端**从不回传** API Key，只给 hasApiKey 布尔值；因此编辑时密钥框默认留空，
 *    留空即"不修改已保存的密钥"（避免把掩码当成真实密钥写回去）。
 *  · 每个开关和每次配置变更后端都写审计，界面这里只负责触发。
 */
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { ApiError } from '../api/client';
import { aiApi, settingsApi } from '../api/endpoints';
import type { AiConfigDTO, AiConfigInput, AiProbeInput, AiProbeResultDTO, WritableSettingDTO } from '../api/types';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DataGrid } from '../components/DataGrid';
import { Icon } from '../components/Icons';
import { Modal } from '../components/Modal';
import { useI18n } from '../state/i18n';
import { useToast } from '../state/toast';

/** 供应商下拉项：value 与后端 AiProviderKind 一致 */
const PROVIDERS = [
  { value: 'openai', labelKey: 'ai.provider.openai' },
  { value: 'anthropic', labelKey: 'ai.provider.anthropic' },
  { value: 'google', labelKey: 'ai.provider.google' },
  { value: 'qwen', labelKey: 'ai.provider.qwen' },
  { value: 'ernie', labelKey: 'ai.provider.ernie' },
  { value: 'zhipu', labelKey: 'ai.provider.zhipu' },
  { value: 'deepseek', labelKey: 'ai.provider.deepseek' },
  { value: 'ollama', labelKey: 'ai.provider.ollama' },
  { value: 'openai-compatible', labelKey: 'ai.provider.openaiCompatible' },
] as const;

/** 与后端 DEFAULT_BASE_URLS 保持一致的前端镜像，仅用于**占位提示**，不参与提交 */
const BASE_URL_HINTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  ernie: 'https://qianfan.baidubce.com/v2',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  deepseek: 'https://api.deepseek.com/v1',
  ollama: 'http://127.0.0.1:11434/v1',
  'openai-compatible': '',
};

/** 三个服务端开关的键 + 文案键 */
const TOGGLES = [
  { key: 'ai.enabled', labelKey: 'ai.settings.master.label', hintKey: 'ai.settings.master.hint' },
  { key: 'ai.redaction_enabled', labelKey: 'ai.settings.redaction.label', hintKey: 'ai.settings.redaction.hint' },
  {
    key: 'ai.production_write_allowed',
    labelKey: 'ai.settings.prodWrite.label',
    hintKey: 'ai.settings.prodWrite.hint',
  },
] as const;

function localizable(error: unknown): { code?: string; message?: string } {
  if (error instanceof ApiError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { message: error.message };
  return { message: String(error) };
}

interface FormState {
  name: string;
  provider: string;
  modelName: string;
  baseUrl: string;
  apiKey: string;
  temperature: string;
  maxTokens: string;
  timeoutMs: string;
  isDefault: boolean;
  enabled: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  provider: 'ollama',
  modelName: '',
  baseUrl: '',
  apiKey: '',
  temperature: '0.2',
  maxTokens: '',
  timeoutMs: '60000',
  isDefault: true,
  enabled: true,
};

function formOf(config: AiConfigDTO): FormState {
  return {
    name: config.name,
    provider: config.provider,
    modelName: config.modelName,
    baseUrl: config.baseUrl ?? '',
    apiKey: '',
    temperature: String(config.temperature),
    maxTokens: config.maxTokens === null ? '' : String(config.maxTokens),
    timeoutMs: String(config.timeoutMs),
    isDefault: config.isDefault,
    enabled: config.enabled,
  };
}

export function AiSettingsCard() {
  const { t, localizeError } = useI18n();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configs, setConfigs] = useState<AiConfigDTO[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [writable, setWritable] = useState<WritableSettingDTO[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [editing, setEditing] = useState<AiConfigDTO | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiProbeResultDTO | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const [removing, setRemoving] = useState<AiConfigDTO | null>(null);
  const [removingBusy, setRemovingBusy] = useState(false);

  const load = useCallback(
    async (notify: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const [configList, settings, writableList] = await Promise.all([
          aiApi.listConfigs(),
          settingsApi.list(),
          settingsApi.writable(),
        ]);
        setConfigs(configList.items);
        const map: Record<string, string> = {};
        for (const item of settings.items) {
          if (item.value !== null) map[item.key] = item.value;
        }
        setValues(map);
        setWritable(writableList.items);
        if (notify) toast.success(t('common.reload'));
      } catch (e) {
        const message = localizeError(localizable(e));
        setError(t('ai.settings.err.loadFailed', { values: { message } }));
      } finally {
        setLoading(false);
      }
    },
    [localizeError, t, toast],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  /** 开关：乐观更新，失败则回滚并提示 */
  const toggleSetting = async (key: string, next: boolean) => {
    const previous = values[key];
    setValues((cur) => ({ ...cur, [key]: String(next) }));
    setBusyKey(key);
    try {
      await settingsApi.update([{ key, value: next }]);
      toast.success(t('ai.settings.toast.autosaved'));
    } catch (e) {
      setValues((cur) => {
        const rolled = { ...cur };
        if (previous === undefined) delete rolled[key];
        else rolled[key] = previous;
        return rolled;
      });
      toast.error(localizeError(localizable(e)));
    } finally {
      setBusyKey(null);
    }
  };

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setTestResult(null);
    setModels([]);
    setEditing('new');
  };

  const openEdit = (config: AiConfigDTO) => {
    setForm(formOf(config));
    setFormError(null);
    setTestResult(null);
    setModels([]);
    setEditing(config);
  };

  /**
   * 把表单收成接口入参。
   *
   * 密钥三态由**是否携带该字段**表达，而不是靠空串：
   * 留空 → 整个字段不传（后端视为 `undefined`，保持原密钥不变）；
   * 传入非空串 → 替换密钥；显式传 `null` → 清空密钥。
   * 后端把空串视为非法输入并报 VALIDATION_FAILED，因此这里绝不要传空串。
   */
  const buildInput = (): AiConfigInput => {
    const trimmedKey = form.apiKey.trim();
    const trimmedBase = form.baseUrl.trim();
    return {
      name: form.name.trim(),
      provider: form.provider,
      modelName: form.modelName.trim(),
      ...(trimmedKey.length > 0 ? { apiKey: trimmedKey } : {}),
      baseUrl: trimmedBase.length > 0 ? trimmedBase : null,
      temperature: Number(form.temperature),
      maxTokens: form.maxTokens.trim().length > 0 ? Number(form.maxTokens) : null,
      timeoutMs: Number(form.timeoutMs),
      isDefault: form.isDefault,
      enabled: form.enabled,
    };
  };

  const validate = (): string | null => {
    if (form.name.trim().length === 0) return t('ai.settings.err.nameRequired');
    if (form.provider.trim().length === 0) return t('ai.settings.err.providerRequired');
    if (form.modelName.trim().length === 0) return t('ai.settings.err.modelRequired');
    return null;
  };

  /**
   * 试连 / 列举模型的入参。
   *
   * 编辑已保存配置且密钥框留空时**必须带 configId**：后端从不回传密钥，
   * 内联探测拿到的是 apiKey=null，云端供应商必然 401 —— 用户会误以为
   * "刚保存的配置连不上"。带 configId 后由后端取出库里已保存的密钥探测。
   * 只有新增配置、或用户重新输入了密钥时，才走内联表单值（这样才能测到新密钥）。
   * 注意：configId 分支会把已保存的其余字段一并采用，改了 provider/模型但
   * 未重输密钥时，测的是已保存的那份配置。
   */
  const probeInputOf = (): AiProbeInput => {
    const input = buildInput();
    const savedId = editing !== 'new' && editing !== null ? editing.id : undefined;
    if (savedId !== undefined && input.apiKey === undefined) {
      return { configId: savedId };
    }
    const modelName = input.modelName.trim();
    return {
      provider: input.provider,
      // 列举模型时模型名可以留空；后端 schema 是 min(1) 的可选字段，
      // 传空串会被判非法，所以留空时整个字段不传（沿用原实现的语义）
      ...(modelName.length > 0 ? { modelName } : {}),
      baseUrl: input.baseUrl ?? null,
      ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    };
  };

  const handleTest = async () => {
    const invalid = validate();
    if (invalid) {
      setFormError(invalid);
      return;
    }
    setTesting(true);
    setFormError(null);
    setTestResult(null);
    try {
      // 把 API Key 一起发过去，才能"保存前试连"；后端不会把它写库。
      // 已保存配置且未重输密钥时改为传 configId，由后端取用库里的密钥。
      const { result } = await aiApi.test(probeInputOf());
      setTestResult(result);
    } catch (e) {
      const message = localizeError(localizable(e));
      setFormError(t('ai.settings.err.testFailed', { values: { message } }));
    } finally {
      setTesting(false);
    }
  };

  const handleLoadModels = async () => {
    setLoadingModels(true);
    setFormError(null);
    try {
      const result = await aiApi.models(probeInputOf());
      setModels(result.models);
      if (result.models.length === 0) {
        setFormError(t('ai.settings.field.modelEmpty'));
      } else {
        toast.success(t('ai.settings.field.modelLoaded', { count: result.models.length }));
      }
    } catch (e) {
      const message = localizeError(localizable(e));
      setFormError(t('ai.settings.err.modelsFailed', { values: { message } }));
    } finally {
      setLoadingModels(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const invalid = validate();
    if (invalid) {
      setFormError(invalid);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const input = buildInput();
      if (editing === 'new') {
        await aiApi.createConfig(input);
        toast.success(t('ai.settings.toast.created'));
      } else if (editing) {
        await aiApi.updateConfig(editing.id, input);
        toast.success(t('ai.settings.toast.updated'));
      }
      setEditing(null);
      await load(false);
    } catch (e) {
      const message = localizeError(localizable(e));
      setFormError(t('ai.settings.err.saveFailed', { values: { message } }));
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (config: AiConfigDTO) => {
    setBusyKey(`default-${config.id}`);
    try {
      await aiApi.updateConfig(config.id, { isDefault: true, enabled: true });
      toast.success(t('ai.settings.toast.defaultSet'));
      await load(false);
    } catch (e) {
      const message = localizeError(localizable(e));
      toast.error(t('ai.settings.err.defaultFailed', { values: { message } }));
    } finally {
      setBusyKey(null);
    }
  };

  const handleDelete = async () => {
    if (!removing) return;
    setRemovingBusy(true);
    try {
      await aiApi.removeConfig(removing.id);
      toast.success(t('ai.settings.toast.deleted'));
      setRemoving(null);
      await load(false);
    } catch (e) {
      const message = localizeError(localizable(e));
      toast.error(t('ai.settings.err.deleteFailed', { values: { message } }));
    } finally {
      setRemovingBusy(false);
    }
  };

  const writableKeys = new Set(writable.map((item) => item.key));

  return (
    <section className="card">
      <header className="card__header">
        <h2 className="card__title">{t('ai.settings.title')}</h2>
        <p className="card__subtitle">{t('ai.settings.subtitle')}</p>
      </header>

      {error ? (
        <div className="banner banner--danger" role="alert">
          <Icon name="alert" size={16} />
          <span>{error}</span>
          <Button
            size="sm"
            icon="refresh"
            onClick={() => {
              void load(false);
            }}
          >
            {t('common.retry')}
          </Button>
        </div>
      ) : null}

      {/* —— 服务端开关 —— */}
      <div className="toggle-list">
        {TOGGLES.filter((item) => writableKeys.size === 0 || writableKeys.has(item.key)).map((item) => {
          const current = values[item.key] === 'true' || values[item.key] === '1';
          return (
            <label className="toggle-row" key={item.key}>
              <input
                type="checkbox"
                className="toggle-row__input"
                checked={current}
                disabled={loading || busyKey === item.key}
                onChange={(event) => {
                  void toggleSetting(item.key, event.target.checked);
                }}
              />
              <span className="toggle-row__text">
                <strong>{t(item.labelKey)}</strong>
                <small>{t(item.hintKey)}</small>
              </span>
            </label>
          );
        })}
      </div>
      <p className="field__hint">{t('ai.settings.serverWriteNote')}</p>

      {/* —— 配置列表 —— */}
      <div className="card__section-header">
        <h3 className="card__subtitle-strong">{t('ai.settings.list.title')}</h3>
        <div className="card__section-actions">
          <Button size="sm" icon="sparkles" onClick={openCreate}>
            {t('ai.settings.action.add')}
          </Button>
        </div>
      </div>

      <DataGrid
        rows={configs}
        rowKey={(config) => String(config.id)}
        loading={loading}
        emptyText={t('ai.settings.list.empty')}
        emptyHint={t('ai.settings.list.emptyHint')}
        maxHeight="320px"
        columns={[
          {
            key: 'name',
            header: t('ai.settings.list.colName'),
            width: '180px',
            render: (config) => (
              <span className="cell-stack">
                <strong>{config.name}</strong>
                <span className="badge-group">
                  {config.isDefault ? (
                    <span className="badge badge--info">{t('ai.settings.badge.default')}</span>
                  ) : null}
                  <span className={`badge badge--${config.enabled ? 'success' : 'muted'}`}>
                    {config.enabled ? t('ai.settings.badge.enabled') : t('ai.settings.badge.disabled')}
                  </span>
                  <span className={`badge badge--${config.hasApiKey ? 'info' : 'muted'}`}>
                    {config.hasApiKey ? t('ai.settings.badge.hasKey') : t('ai.settings.badge.noKey')}
                  </span>
                </span>
              </span>
            ),
          },
          {
            key: 'provider',
            header: t('ai.settings.list.colProvider'),
            width: '150px',
            render: (config) => t(`ai.provider.${providerKeyOf(config.provider)}` as never),
          },
          {
            key: 'model',
            header: t('ai.settings.list.colModel'),
            render: (config) => <span className="mono">{config.modelName}</span>,
          },
          {
            key: 'actions',
            header: t('common.actions'),
            width: '260px',
            render: (config) => (
              <div className="row-actions">
                {!config.isDefault ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="star"
                    loading={busyKey === `default-${config.id}`}
                    onClick={() => {
                      void handleSetDefault(config);
                    }}
                  >
                    {t('ai.settings.action.setDefault')}
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" icon="pencil" onClick={() => openEdit(config)}>
                  {t('common.edit')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  onClick={() => {
                    setRemoving(config);
                  }}
                >
                  {t('common.delete')}
                </Button>
              </div>
            ),
          },
        ]}
      />

      {/* —— 新增 / 编辑弹窗 —— */}
      <Modal
        open={editing !== null}
        title={editing === 'new' ? t('ai.settings.form.createTitle') : t('ai.settings.form.editTitle')}
        onClose={() => {
          setEditing(null);
        }}
        footer={
          <>
            <Button
              onClick={() => {
                setEditing(null);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="ai-config-form" variant="primary" loading={saving}>
              {t('ai.settings.form.save')}
            </Button>
          </>
        }
      >
        <form id="ai-config-form" className="form-grid" onSubmit={handleSubmit} noValidate>
          {formError ? (
            <div className="banner banner--danger form-grid__full" role="alert">
              <Icon name="alert" size={16} />
              <span>{formError}</span>
            </div>
          ) : null}

          <label className="field">
            <span className="field__label">{t('ai.settings.field.name')}</span>
            <input
              className="input"
              value={form.name}
              placeholder={t('ai.settings.field.namePlaceholder')}
              disabled={saving}
              onChange={(event) => {
                setForm({ ...form, name: event.target.value });
              }}
            />
          </label>

          <label className="field">
            <span className="field__label">{t('ai.settings.field.provider')}</span>
            <select
              className="input"
              value={form.provider}
              disabled={saving}
              onChange={(event) => {
                setForm({ ...form, provider: event.target.value });
              }}
            >
              {PROVIDERS.map((provider) => (
                <option key={provider.value} value={provider.value}>
                  {t(provider.labelKey)}
                </option>
              ))}
            </select>
          </label>

          <label className="field form-grid__full">
            <span className="field__label">{t('ai.settings.field.baseUrl')}</span>
            <input
              className="input"
              value={form.baseUrl}
              placeholder={BASE_URL_HINTS[form.provider] || t('ai.settings.field.baseUrlPlaceholder')}
              disabled={saving}
              onChange={(event) => {
                setForm({ ...form, baseUrl: event.target.value });
              }}
            />
            <span className="field__hint">
              {form.provider === 'ollama'
                ? t('ai.provider.ollama')
                : t('ai.settings.field.baseUrlPlaceholder')}
            </span>
          </label>

          <label className="field">
            <span className="field__label">{t('ai.settings.field.model')}</span>
            <input
              className="input"
              value={form.modelName}
              placeholder={t('ai.settings.field.modelPlaceholder')}
              disabled={saving}
              list="ai-model-options"
              onChange={(event) => {
                setForm({ ...form, modelName: event.target.value });
              }}
            />
            <datalist id="ai-model-options">
              {models.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </label>

          <div className="field">
            <span className="field__label">{t('ai.settings.field.modelLoad')}</span>
            <Button size="sm" icon="refresh" loading={loadingModels} onClick={() => void handleLoadModels()}>
              {loadingModels ? t('ai.settings.field.modelLoading') : t('ai.settings.field.modelLoad')}
            </Button>
          </div>

          <label className="field form-grid__full">
            <span className="field__label">{t('ai.settings.field.apiKey')}</span>
            <input
              className="input"
              type="password"
              autoComplete="off"
              value={form.apiKey}
              placeholder={t('ai.settings.field.apiKeyPlaceholder')}
              disabled={saving}
              onChange={(event) => {
                setForm({ ...form, apiKey: event.target.value });
              }}
            />
            <span className="field__hint">
              {editing !== 'new' && editing && editing.hasApiKey
                ? t('ai.settings.field.apiKeyStored')
                : t('ai.settings.field.apiKeyKeep')}
            </span>
          </label>

          <label className="field">
            <span className="field__label">{t('ai.settings.field.temperature')}</span>
            <input
              className="input"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={form.temperature}
              disabled={saving}
              onChange={(event) => {
                setForm({ ...form, temperature: event.target.value });
              }}
            />
          </label>

          <label className="field">
            <span className="field__label">{t('ai.settings.field.maxTokens')}</span>
            <input
              className="input"
              type="number"
              min={1}
              value={form.maxTokens}
              disabled={saving}
              onChange={(event) => {
                setForm({ ...form, maxTokens: event.target.value });
              }}
            />
            <span className="field__hint">{t('ai.settings.field.maxTokensHint')}</span>
          </label>

          <label className="field">
            <span className="field__label">{t('ai.settings.field.timeout')}</span>
            <input
              className="input"
              type="number"
              min={1000}
              step={1000}
              value={form.timeoutMs}
              disabled={saving}
              onChange={(event) => {
                setForm({ ...form, timeoutMs: event.target.value });
              }}
            />
          </label>

          <div className="field form-grid__full checkbox-row">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.isDefault}
                disabled={saving}
                onChange={(event) => {
                  setForm({ ...form, isDefault: event.target.checked });
                }}
              />
              <span>{t('ai.settings.field.isDefault')}</span>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.enabled}
                disabled={saving}
                onChange={(event) => {
                  setForm({ ...form, enabled: event.target.checked });
                }}
              />
              <span>{t('ai.settings.field.enabled')}</span>
            </label>
          </div>

          {testResult ? (
            <div className="banner banner--success form-grid__full" role="status">
              <Icon name="check" size={16} />
              <span>
                {t('ai.settings.test.ok', { values: { ms: testResult.latencyMs } })}
                <br />
                {t('ai.settings.test.reply', { values: { reply: testResult.reply } })}
              </span>
            </div>
          ) : null}

          <div className="form-grid__actions form-grid__full">
            <Button icon="play" loading={testing} onClick={() => void handleTest()}>
              {testing ? t('ai.settings.test.testing') : t('ai.settings.action.test')}
            </Button>
            <span className="field__hint">{t('ai.settings.form.testHint')}</span>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={removing !== null}
        title={t('ai.settings.delete.title')}
        message={t('ai.settings.delete.body', { values: { name: removing?.name ?? '' } })}
        danger
        loading={removingBusy}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          setRemoving(null);
        }}
      />
    </section>
  );
}

/** `openai-compatible` 在下拉里是连字符，而消息键用的是驼峰 */
function providerKeyOf(provider: string): string {
  return provider === 'openai-compatible' ? 'openaiCompatible' : provider;
}
