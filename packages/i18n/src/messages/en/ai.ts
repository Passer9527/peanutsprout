/**
 * English · AI assistant (provider config / assistant page)
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This namespace is the authoritative key set of the source language: the other
 * five languages must match it, and a single missing key is reported by
 * catalogs.test.ts.
 *
 * Terminology:
 *  · "provider" means a service such as OpenAI / Anthropic / Ollama;
 *  · "model" means a concrete model name (modelName);
 *  · "skill" means one of the six use cases such as nl2sql / explain (scene).
 * Common buttons (cancel, close, delete) reuse common and are not defined again here.
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— Provider display names ——
  'ai.provider.openai': 'OpenAI',
  'ai.provider.anthropic': 'Anthropic',
  'ai.provider.google': 'Google Gemini',
  'ai.provider.qwen': 'Qwen',
  'ai.provider.ernie': 'ERNIE',
  'ai.provider.zhipu': 'Zhipu AI',
  'ai.provider.deepseek': 'DeepSeek',
  'ai.provider.ollama': 'Ollama (local)',
  'ai.provider.openaiCompatible': 'OpenAI-compatible service (vLLM / LM Studio / self-hosted)',

  // —— Settings page: AI card ——
  'ai.settings.title': 'AI Assistant',
  'ai.settings.subtitle':
    'Configure large model providers. API keys are encrypted with AES-256-GCM and stored in the local database; they are never written to disk in plain text.',
  'ai.settings.master.label': 'Enable AI features',
  'ai.settings.master.hint':
    'Master switch. When off, every AI skill returns "AI features are not enabled" directly and no external request is sent.',
  'ai.settings.redaction.label': 'Sensitive data redaction',
  'ai.settings.redaction.hint':
    'Before a result set is sent to the model, columns such as phone numbers, national IDs, email addresses and bank cards are replaced with masks automatically.',
  'ai.settings.prodWrite.label': 'Allow AI to generate write statements for production databases',
  'ai.settings.prodWrite.hint':
    'Off by default. Even when generated, SQL is executed only after you confirm it in the editor.',
  'ai.settings.serverWriteNote': 'These switches are stored on the server and apply to all users.',

  // —— Configuration list ——
  'ai.settings.list.title': 'Model configurations',
  'ai.settings.list.empty': 'No large model is configured yet',
  'ai.settings.list.emptyHint':
    'Click "Add configuration" to connect a cloud API, or enter a local model address (such as Ollama) for offline use.',
  'ai.settings.list.colName': 'Name',
  'ai.settings.list.colProvider': 'Provider',
  'ai.settings.list.colModel': 'Model',
  'ai.settings.list.colBaseUrl': 'Endpoint URL',
  'ai.settings.list.colStatus': 'Status',
  'ai.settings.badge.default': 'Default',
  'ai.settings.badge.enabled': 'Enabled',
  'ai.settings.badge.disabled': 'Disabled',
  'ai.settings.badge.hasKey': 'Key configured',
  'ai.settings.badge.noKey': 'No key required',

  // —— List actions ——
  'ai.settings.action.add': 'Add configuration',
  'ai.settings.action.edit': 'Edit',
  'ai.settings.action.delete': 'Delete',
  'ai.settings.action.setDefault': 'Set as default',
  'ai.settings.action.test': 'Test connectivity',
  'ai.settings.action.openAssistant': 'Open AI Assistant',

  // —— Form ——
  'ai.settings.form.createTitle': 'Add model configuration',
  'ai.settings.form.editTitle': 'Edit model configuration',
  'ai.settings.field.name': 'Configuration name',
  'ai.settings.field.namePlaceholder': 'e.g. Local Ollama',
  'ai.settings.field.provider': 'Provider',
  'ai.settings.field.model': 'Model name',
  'ai.settings.field.modelPlaceholder': 'e.g. qwen2.5-coder:7b',
  'ai.settings.field.modelLoad': 'Fetch from server',
  'ai.settings.field.modelLoading': 'Fetching…',
  'ai.settings.field.modelLoaded': 'Fetched {count} models; filled into the dropdown',
  'ai.settings.field.modelEmpty': 'The server returned no models',
  'ai.settings.field.baseUrl': 'Endpoint URL (Base URL)',
  'ai.settings.field.baseUrlPlaceholder': 'Leave empty to use the provider default',
  'ai.settings.field.apiKey': 'API Key',
  'ai.settings.field.apiKeyPlaceholder': 'Usually empty for local models',
  'ai.settings.field.apiKeyKeep': 'Leave empty to keep the saved key unchanged',
  'ai.settings.field.apiKeyStored': 'A key is already saved; re-enter it to replace it',
  'ai.settings.field.temperature': 'Temperature (0-2)',
  'ai.settings.field.maxTokens': 'Max output tokens',
  'ai.settings.field.maxTokensHint': 'Leave empty to let the server decide',
  'ai.settings.field.timeout': 'Timeout (ms)',
  'ai.settings.field.isDefault': 'Set as the default model',
  'ai.settings.field.enabled': 'Enable this configuration',
  'ai.settings.form.testHint':
    'Test connectivity first to make sure the URL and key are correct before saving.',
  'ai.settings.form.save': 'Save configuration',

  // —— Test results ——
  'ai.settings.test.testing': 'Testing…',
  'ai.settings.test.ok': 'Connectivity OK, took {ms} ms',
  'ai.settings.test.reply': 'Model reply: {reply}',
  'ai.settings.test.failed': 'Connectivity test failed',

  // —— Delete confirmation ——
  'ai.settings.delete.title': 'Delete model configuration',
  'ai.settings.delete.body':
    'Delete "{name}"? This action cannot be undone, but it does not affect call history that already exists.',

  // —— Toasts ——
  'ai.settings.toast.created': 'Model configuration created',
  'ai.settings.toast.updated': 'Model configuration updated',
  'ai.settings.toast.deleted': 'Model configuration deleted',
  'ai.settings.toast.defaultSet': 'Set as the default model',
  'ai.settings.toast.settingSaved': 'Settings saved',
  'ai.settings.toast.autosaved': 'Settings saved automatically',

  // —— Errors ——
  'ai.settings.err.nameRequired': 'Please enter a configuration name.',
  'ai.settings.err.modelRequired': 'Please enter a model name.',
  'ai.settings.err.providerRequired': 'Please select a provider.',
  'ai.settings.err.loadFailed': 'Failed to load the AI configuration: {message}',
  'ai.settings.err.saveFailed': 'Failed to save: {message}',
  'ai.settings.err.deleteFailed': 'Failed to delete: {message}',
  'ai.settings.err.testFailed': 'Test failed: {message}',
  'ai.settings.err.modelsFailed': 'Failed to fetch the model list: {message}',
  'ai.settings.err.defaultFailed': 'Failed to set the default model: {message}',

  // —— AI Assistant page ——
  'ai.assistant.title': 'AI Assistant',
  'ai.assistant.subtitle':
    'Work with the database in natural language. AI only generates; it never executes for you.',
  'ai.assistant.sceneLabel': 'Skill',
  'ai.assistant.connectionLabel': 'Target connection',
  'ai.assistant.connectionPlaceholder': 'Select a connection',
  'ai.assistant.connectionHint': 'Used to provide the table schema to the model as context',
  'ai.assistant.rowsLabel': 'Result data',
  'ai.assistant.rowsPlaceholder': 'Paste the result set: first line is the header, tab or comma separated',
  'ai.assistant.rowsHint': 'Sensitive columns are redacted automatically before being sent',
  'ai.assistant.inputPlaceholder': 'e.g. Top 10 users by order amount in the last 7 days',
  'ai.assistant.sendHint': 'Ctrl / Cmd + Enter to send',
  'ai.assistant.inputLabel': 'Your question',
  'ai.assistant.sqlLabel': 'SQL to process',
  'ai.assistant.sqlPlaceholder':
    'Paste a piece of SQL and AI will explain it or suggest optimizations',
  'ai.assistant.errorLabel': 'Error message',
  'ai.assistant.errorPlaceholder': 'Paste the error returned by the database',
  'ai.assistant.send': 'Send',
  'ai.assistant.sending': 'Generating…',
  'ai.assistant.clear': 'Clear chat',
  'ai.assistant.emptyTitle': 'Start a conversation with AI',
  'ai.assistant.emptyHint': 'Select a skill on the left, fill in the input and click "Send".',
  'ai.assistant.you': 'You',
  'ai.assistant.model': 'AI',
  'ai.assistant.copy': 'Copy',
  'ai.assistant.copied': 'Copied to the clipboard',
  'ai.assistant.copyFailed': 'Copy failed; select the text manually',
  'ai.assistant.useInEditor': 'Copy SQL',
  'ai.assistant.noExecuteWarning': 'The AI only writes SQL; it never runs it. Review it, then choose Execute or Copy.',
  'ai.assistant.exportNeedTable': 'Enter a target table name',
  'ai.assistant.exportNeedConnection': 'Select a target connection',
  'ai.assistant.exportToDbDone': 'Wrote {count} row(s) into {table}',
  'ai.assistant.exportRun': 'Start export',
  'ai.assistant.exportReplaceWarning': 'Replace drops the target table first. All existing rows are lost and cannot be recovered.',
  'ai.assistant.exportModeReplace': 'Replace (drops the table first)',
  'ai.assistant.exportModeAppend': 'Append to existing table',
  'ai.assistant.exportModeCreate': 'Create table (fails if it exists)',
  'ai.assistant.exportMode': 'Write mode',
  'ai.assistant.exportTargetTablePlaceholder': 'e.g. user_summary',
  'ai.assistant.exportTargetTable': 'Target table',
  'ai.assistant.exportTargetConnection': 'Target connection',
  'ai.assistant.exportToDb': 'Export to database',
  'ai.assistant.exportTruncated': 'The result exceeded the row limit; only the first part was exported',
  'ai.assistant.exportFailed': 'Export failed: {message}',
  'ai.assistant.exportDone': 'Exported {name}',
  'ai.assistant.exportExcel': 'Export to Excel',
  'ai.assistant.clearDone': 'Cleared {count} call record(s)',
  'ai.assistant.rollbackDone': 'Rolled back; {count} call record(s) deleted',
  'ai.assistant.rollbackHint': 'Return to this point; later messages are deleted and the inputs are restored',
  'ai.assistant.rollbackHere': 'Roll back to here',
  'ai.assistant.withdrawFailed': 'Could not withdraw: {message}',
  'ai.assistant.withdrawDone': 'Withdrawn',
  'ai.assistant.withdrawHint': 'Withdraw this message (a user message takes its reply with it)',
  'ai.assistant.withdraw': 'Withdraw',
  'ai.assistant.noConnection': 'No connection selected. Pick a target connection above first.',
  'ai.assistant.executeTruncated': 'Result truncated',
  'ai.assistant.executeRows': '{count} row(s) returned',
  'ai.assistant.executeAffected': '{count} row(s) affected',
  'ai.assistant.executeFailed': 'Execution failed: {message}',
  'ai.assistant.executeConfirmYes': 'Yes, execute',
  'ai.assistant.executeConfirm': 'This statement writes data. Continue?',
  'ai.assistant.copySql': 'Copy SQL',
  'ai.assistant.executing': 'Executing…',
  'ai.assistant.execute': 'Execute',
  // —— Skill names and descriptions ——
  'ai.scene.nl2sql': 'Natural language to SQL',
  'ai.scene.nl2sqlHint':
    'Describe what you need in natural language and generate an executable SELECT statement',
  'ai.scene.explain': 'Explain SQL',
  'ai.scene.explainHint': 'Explain what a piece of SQL does, clause by clause',
  'ai.scene.optimize': 'Optimize SQL',
  'ai.scene.optimizeHint': 'Suggest performance improvements such as indexes and rewrites',
  'ai.scene.document': 'Generate documentation',
  'ai.scene.documentHint': 'Generate field documentation from the table schema',
  'ai.scene.ask': 'Ask about result sets',
  'ai.scene.askHint':
    'Ask questions about the current result data; redaction runs automatically before it leaves the network',
  'ai.scene.diagnose': 'Diagnose errors',
  'ai.scene.diagnoseHint': 'Analyze the cause of an error and suggest a fix',

  // —— Generated result display ——
  'ai.result.generatedSql': 'Generated SQL',
  'ai.result.explanation': 'Explanation',
  'ai.result.confidence': 'Confidence',
  'ai.result.tables': 'Tables involved',
  'ai.result.suggestions': 'Suggestions',
  'ai.result.cause': 'Possible causes',
  'ai.result.severity.critical': 'Critical',
  'ai.result.severity.warning': 'Warning',
  'ai.result.severity.info': 'Info',
  'ai.result.tokens': 'Input {input} / output {output} tokens',

  // —— Unavailable states ——
  'ai.disabled.title': 'AI features are not enabled',
  'ai.disabled.hint': 'Go to "Settings → AI Assistant" and turn on the master switch first.',
  'ai.disabled.action': 'Go to Settings',
  'ai.notConfigured.title': 'No model is available yet',
  'ai.notConfigured.hint':
    'Go to "Settings → AI Assistant" and add a large model configuration; a local model (Ollama) works too.',
  'ai.notConfigured.action': 'Go to configurations',

  // —— Call history ——
  'ai.history.title': 'Recent calls',
  'ai.history.empty': 'No call records yet',
  'ai.history.failed': 'Failed',
  'ai.history.success': 'Succeeded',
};

export default messages;
