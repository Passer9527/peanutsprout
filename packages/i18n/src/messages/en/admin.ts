/**
 * English · Audit log & settings
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— Audit log: filter toolbar ——
  'admin.audit.action': 'Action',
  'admin.audit.actionPlaceholder': 'e.g. login / query.execute',
  'admin.audit.filterUserId': 'User ID',
  'admin.audit.pageSize': 'Per page',
  'admin.audit.pageSizeOption': '{count} entries',
  'admin.audit.pageSizeOption.one': '{count} entry',
  'admin.audit.query': 'Query',
  'admin.audit.verifyChain': 'Verify hash chain',

  // —— Audit log: table columns ——
  'admin.audit.column.time': 'Time',
  'admin.audit.column.user': 'User',
  'admin.audit.column.resource': 'Resource',
  'admin.audit.column.connection': 'Connection',
  'admin.audit.column.sqlDetail': 'SQL / details',
  'admin.audit.column.ip': 'Source IP',
  'admin.audit.column.hash': 'Hash',
  'admin.audit.anonymous': 'Anonymous',
  'admin.audit.viewDetail': 'View details',
  'admin.audit.noHash': 'No hash',
  'admin.audit.noExtraInfo': 'No extra information',

  // —— Audit log: feedback ({message} is a localized error, {position} is the break location) ——
  'admin.audit.loadFailed': 'Failed to load the audit log: {message}',
  'admin.audit.verifyOk': 'Hash chain verified; {count} log entries checked.',
  'admin.audit.verifyOk.one': 'Hash chain verified; {count} log entry checked.',
  'admin.audit.verifyFailed': 'Hash chain verification failed: {message}',
  'admin.audit.verifyBroken':
    'Hash chain verification failed; first break at position {position}',
  'admin.audit.bannerOk':
    'Hash chain verified: {count} log entries checked, no tampering found.',
  'admin.audit.bannerOk.one':
    'Hash chain verified: {count} log entry checked, no tampering found.',
  'admin.audit.bannerBroken':
    'Hash chain verification failed: {count} log entries checked, first break at position {position}.',
  'admin.audit.bannerBroken.one':
    'Hash chain verification failed: {count} log entry checked, first break at position {position}.',

  // —— Audit log: empty state and pagination ——
  'admin.audit.empty': 'No audit log entries match',
  'admin.audit.emptyHint':
    'Adjust the filters and try again, or make sure auditing is enabled on the server.',
  'admin.audit.pager': '{total} entries · page {page} / {totalPages}',
  'admin.audit.prevPage': 'Previous page',
  'admin.audit.nextPage': 'Next page',

  // —— Audit log: detail dialog ——
  'admin.audit.detailTitle': 'Audit details',
  'admin.audit.errorMessage': 'Error message',
  'admin.audit.currentHash': 'Current hash',

  // —— Settings: appearance ——
  'admin.settings.appearance.title': 'Appearance',
  'admin.settings.appearance.subtitle':
    'Your theme preference is saved in this browser and takes effect immediately.',
  'admin.settings.theme.light': 'Light',
  'admin.settings.theme.lightHint': 'The default look in bright environments',
  'admin.settings.theme.dark': 'Dark',
  'admin.settings.theme.darkHint': 'Easier on the eyes in low light',

  // —— Settings: service and API ——
  'admin.settings.service.title': 'Service & API',
  'admin.settings.service.subtitle':
    'The web client reaches the PeanutSprout server REST API through {base}.',
  'admin.settings.service.apiBase': 'API base URL',
  'admin.settings.service.pageOrigin': 'Current page origin',
  'admin.settings.service.authMethod': 'Authentication',
  'admin.settings.service.status': 'Service status',
  'admin.settings.service.checking': 'Checking…',
  'admin.settings.service.statusLine': '{status} · v{version} · up {uptime}',
  'admin.settings.service.unavailable': 'Unable to get the service status',
  'admin.settings.service.recheck': 'Check again',
  'admin.settings.service.ok': 'Service is healthy: version {version}',

  // —— Settings: change password ——
  'admin.settings.password.title': 'Change password',
  'admin.settings.password.currentAccount': 'Current account: ',
  'admin.settings.password.current': 'Current password',
  'admin.settings.password.new': 'New password',
  'admin.settings.password.confirm': 'Confirm new password',
  'admin.settings.password.newHint': 'At least 6 characters',
  'admin.settings.password.submit': 'Update password',
  'admin.settings.password.errCurrentRequired': 'Please enter your current password.',
  'admin.settings.password.errTooShort': 'The new password must be at least 6 characters.',
  'admin.settings.password.errSameAsCurrent':
    'The new password cannot be the same as the current password.',
  'admin.settings.password.errMismatch': 'The two new passwords do not match.',
  'admin.settings.password.success':
    'Password updated. Use the new password the next time you sign in.',

  // —— Settings: about ——
  'admin.settings.about.title': 'About PeanutSprout',
  'admin.settings.about.subtitle': 'Cross-platform unified database management client',
  'admin.settings.about.productName': 'Product name',
  'admin.settings.about.productValue': 'PeanutSprout',
  'admin.settings.about.versionValue': '0.1.0',
  'admin.settings.about.author': 'Author',
  'admin.settings.about.authorValue': '飞哥 · 微信 6731663',
  'admin.settings.about.license': 'License',
  'admin.settings.about.licenseValue': 'AGPL-3.0-or-later',
  'admin.settings.about.stack': 'Web stack',
  'admin.settings.about.stackValue':
    'React 19 · TypeScript 5.9 · Vite 7 (no third-party UI / state / routing / chart libraries)',

  // —— Toast ——
  'admin.toast.close': 'Dismiss notification',
};

export default messages;
