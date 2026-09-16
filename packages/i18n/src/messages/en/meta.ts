/**
 * English · Display names for server-side enums
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * The server sends a Chinese `label` in its responses. The client does **not**
 * display the server-provided label directly; instead it looks up the display
 * name for the current language by the stable `code`/`type` in this table.
 * Otherwise database types, permission entries and similar values would stay
 * Chinese after a language switch and the interface would mix languages.
 * Only when a code is missing from this table does it fall back to the label
 * supplied by the server (for example custom roles).
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— Database categories ——
  'dbCategory.relational': 'Relational',
  'dbCategory.keyvalue': 'Key-value',
  'dbCategory.document': 'Document',
  'dbCategory.columnar': 'Columnar',
  'dbCategory.timeseries': 'Time series',
  'dbCategory.graph': 'Graph',

  // —— Driver implementation status ——
  'driver.implemented': 'Implemented',
  'driver.notImplemented': 'Not implemented',
  'driver.notImplementedHint': 'The driver for this database type is not implemented yet; connecting will explicitly return DRIVER_NOT_IMPLEMENTED',
  'driver.list': 'Supported database types',

  // —— Chart types (including the bar / line / parallel coordinates charts named in AC-03) ——
  'chartType.bar': 'Bar chart',
  'chartType.column': 'Column chart',
  'chartType.line': 'Line chart',
  'chartType.area': 'Area chart',
  'chartType.pie': 'Pie chart',
  'chartType.donut': 'Donut chart',
  'chartType.scatter': 'Scatter chart',
  'chartType.bubble': 'Bubble chart',
  'chartType.parallel': 'Parallel coordinates chart',
  'chartType.heatmap': 'Heatmap',
  'chartType.radar': 'Radar chart',
  'chartType.sankey': 'Sankey diagram',
  'chartType.treemap': 'Treemap',
  'chartType.boxplot': 'Box plot',
  'chartType.map': 'Map',

  'chartTypeDesc.bar': 'Compare categorical values horizontally',
  'chartTypeDesc.column': 'Compare categorical values vertically',
  'chartTypeDesc.line': 'Trends over time',
  'chartTypeDesc.area': 'Cumulative trend',
  'chartTypeDesc.pie': 'Proportion breakdown',
  'chartTypeDesc.donut': 'Proportion breakdown (hollow center)',
  'chartTypeDesc.scatter': 'Correlation between two variables',
  'chartTypeDesc.bubble': 'Relationship among three variables',
  'chartTypeDesc.parallel': 'Multidimensional feature comparison',
  'chartTypeDesc.heatmap': 'Two-dimensional density distribution',
  'chartTypeDesc.radar': 'Combined comparison across metrics',
  'chartTypeDesc.sankey': 'Flow direction and volume distribution',
  'chartTypeDesc.treemap': 'Hierarchical proportion',
  'chartTypeDesc.boxplot': 'Distribution and outliers',
  'chartTypeDesc.map': 'Geographic distribution',

  // —— Permission entries ——
  'permission.conn.read': 'View connections',
  'permission.conn.write': 'Manage connections',
  'permission.query.read': 'Run queries',
  'permission.query.write': 'Run write operations',
  'permission.migrate.read': 'View migrations',
  'permission.migrate.write': 'Run migrations',
  'permission.ai.use': 'Use AI',
  'permission.user.manage': 'User management',
  'permission.audit.read': 'View audit log',
  'permission.settings.manage': 'System settings',

  // —— Permission categories ——
  'permissionCategory.connection': 'Connection',
  'permissionCategory.query': 'Query',
  'permissionCategory.migration': 'Migration',
  'permissionCategory.ai': 'AI',
  'permissionCategory.user': 'User',
  'permissionCategory.audit': 'Audit',
  'permissionCategory.settings': 'Settings',

  // —— Audit actions ——
  'auditAction.login': 'Login',
  'auditAction.logout': 'Logout',
  'auditAction.login_failed': 'Login failed',
  'auditAction.connect': 'Connect',
  'auditAction.disconnect': 'Disconnect',
  'auditAction.execute': 'Execute SQL',
  'auditAction.migrate': 'Run migration',
  'auditAction.import': 'Import data',
  'auditAction.export': 'Export data',
  'auditAction.ai': 'AI invocation',
  'auditAction.user_create': 'Create user',
  'auditAction.user_update': 'Update user',
  'auditAction.user_delete': 'Delete user',
  'auditAction.connection_create': 'Create connection',
  'auditAction.connection_update': 'Update connection',
  'auditAction.connection_delete': 'Delete connection',
  'auditAction.settings_update': 'Update settings',
  'auditAction.audit_verify': 'Verify audit chain',

  // —— Audit results ——
  'auditResult.success': 'Success',
  'auditResult.failure': 'Failure',
  'auditResult.denied': 'Denied',

  // —— Roles ——
  'role.admin': 'Administrator',
  'role.developer': 'Developer',
  'role.analyst': 'Analyst',
  'role.auditor': 'Auditor',
  'role.viewer': 'Read-only user',
  'role.custom': 'Custom role',

  // —— Connection health status ——
  'connStatus.ok': 'Healthy',
  'connStatus.failed': 'Connection failed',
  'connStatus.untested': 'Not tested',
  'connStatus.testing': 'Testing',
  'connStatus.readonly': 'Read-only',

  // —— AI provider categories ——
  'aiProvider.openai-compatible': 'OpenAI-compatible',
  'aiProvider.anthropic': 'Anthropic',
  'aiProvider.gemini': 'Google Gemini',
  'aiProvider.azure-openai': 'Azure OpenAI',
  'aiProvider.deepseek': 'DeepSeek',
  'aiProvider.qwen': 'Qwen',
  'aiProvider.zhipu': 'Zhipu AI',
  'aiProvider.moonshot': 'Moonshot AI',
  'aiProvider.ollama': 'Ollama (local)',

  // —— Migration conflict strategies ——
  'conflictStrategy.skip': 'Skip existing',
  'conflictStrategy.overwrite': 'Overwrite',
  'conflictStrategy.fail': 'Stop on conflict',
  'conflictStrategy.append': 'Append',
};

export default messages;
