/**
 * English · Application shell and navigation
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— Product identity ——
  'app.name': 'PeanutSprout',
  'app.fullName': 'PeanutSprout Database Manager',
  'app.tagline': 'Unified database management client',
  'app.copyright': 'AGPL-3.0 · 飞哥',
  'app.documentTitle': 'PeanutSprout · Unified Database Management Client',
  'app.documentDescription': 'PeanutSprout - Web management interface for the unified database management client',

  // —— Side navigation ——
  'nav.ariaLabel': 'Main navigation',
  'nav.toggleSidebar': 'Collapse/expand navigation',
  'nav.collapseSidebar': 'Collapse sidebar',
  'nav.expandSidebar': 'Expand sidebar',
  'nav.collapseText': 'Collapse navigation',
  'nav.asideDefaultTitle': 'Side panel',
  'nav.expandAside': 'Expand right panel',
  'nav.collapseAside': 'Collapse right panel',

  // —— Feature page titles and descriptions (used for both page titles and nav tooltips) ——
  'nav.connections.label': 'Connections',
  'nav.connections.description': 'Manage database connections, test connectivity and read-only policy',
  'nav.sql.label': 'SQL Editor',
  'nav.sql.description': 'Browse the object tree, run SQL, export results and review execution history',
  'nav.charts.label': 'Data Visualization',
  'nav.charts.description': 'Create bar charts, line charts and more, and view live query results',
  'nav.dashboards.label': 'Dashboards',
  'nav.dashboards.description': 'Combine multiple charts into a single-screen dashboard with sharing and grid layout',
  'nav.audit.label': 'Audit Log',
  'nav.audit.description': 'Operation audit trail and hash chain integrity verification',
  'nav.users.label': 'Users & Permissions',
  'nav.users.description': 'Accounts, roles and administrator permission management',
  'nav.settings.label': 'Settings',
  'nav.settings.description': 'Theme and appearance, service address, password change and about',
  'nav.ai.label': 'AI Assistant',
  'nav.ai.description': 'Natural language to SQL, explain & optimize, generate docs, ask about result sets',
  'nav.table.label': 'Table data',
  'nav.table.description': 'Pick a table and edit its records like a spreadsheet',
  'nav.designer.label': 'Schema designer',
  'nav.designer.description': 'Design schemas and tables visually, with a DDL preview before running',

  // —— Top bar ——
  'topbar.switchToLight': 'Switch to light theme',
  'topbar.switchToDark': 'Switch to dark theme',
  'topbar.language': 'Language',
  'topbar.switchLanguage': 'Switch interface language',
  'topbar.adminSuffix': ' · Admin',
  'topbar.logout': 'Sign out',
  'topbar.logoutConfirm': 'Sign out?',
  'topbar.logoutConfirmHint': 'You will need to enter your username and password again.',

  // —— Application shell hints ——
  'app.checkingSession': 'Checking sign-in status…',
  'app.forbiddenTitle': 'Access denied',
  'app.forbiddenHint': 'Users & Permissions is available to administrators only.',
  'app.asideConnectionTitle': 'Connection details',
  'app.asideConnectionEmpty': 'Select a connection from the list on the left',
  'app.asideConnectionEmptyHint': 'View connection details, color tags and read-only policy, and test connectivity separately.',

  // —— Language settings ——
  'language.title': 'Interface language',
  'language.description': 'Takes effect immediately and remembers your choice. Defaults to Simplified Chinese.',
  'language.current': 'Current language',
  'language.changed': 'Interface language changed to {name}',
  'language.persistedNote': 'This preference is stored in this browser only and is not synced to the server.',
  'language.followBrowser': 'Follow browser',
};

export default messages;
