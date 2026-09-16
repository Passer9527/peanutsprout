/**
 * English · Authentication & users
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— Sign-in page · brand panel ——
  'auth.login.highlight.drivers.title': 'Unified access to multiple databases',
  'auth.login.highlight.drivers.detail':
    'MySQL / PostgreSQL / SQLite and other drivers are managed uniformly, with connection settings kept in one place.',
  'auth.login.highlight.sql.title': 'SQL development and result export',
  'auth.login.highlight.sql.detail':
    'Browse the object tree, run statements quickly, and export result tables as CSV / JSON / Markdown.',
  'auth.login.highlight.audit.title': 'Audit and permissions',
  'auth.login.highlight.audit.detail':
    'Every operation is recorded, the hash chain can be verified, and accounts and roles get fine-grained authorization.',
  'auth.login.footer': '飞哥 · 微信 6731663 · AGPL-3.0',

  // —— Sign-in page · form ——
  'auth.login.title': 'Sign in to the management console',
  'auth.login.subtitle':
    'Sign in with your PeanutSprout server account; your sign-in state is kept in this browser.',
  'auth.login.usernamePlaceholder': 'Enter your username',
  'auth.login.passwordPlaceholder': 'Enter your password',
  'auth.login.showPassword': 'Show password',
  'auth.login.hidePassword': 'Hide password',
  'auth.login.submit': 'Sign in',
  'auth.login.submitting': 'Signing in…',
  'auth.login.hint':
    'On first deployment, sign in with the administrator account generated when the server was initialized; if you forget the password, run the reset script on the server.',

  // —— Shared field names (sign-in page and user management) ——
  'auth.field.username': 'Username',
  'auth.field.password': 'Password',
  'auth.field.email': 'Email',
  'auth.field.roles': 'Roles',

  // —— Form validation ——
  'auth.validation.usernameRequired': 'Please enter a username.',
  'auth.validation.passwordRequired': 'Please enter a password.',
  'auth.validation.passwordMinLength': 'The initial password must be at least 6 characters.',
  'auth.validation.passwordResetMinLength':
    'The reset password must be at least 6 characters; leave blank to keep the current password.',

  // —— Sign-in state ——
  'auth.forcePassword.title': 'Change the initial password first',
  'auth.forcePassword.subtitle': 'You are still using the default password created at install time. For data safety you must change it before anything else can be used.',
  'auth.forcePassword.warning': 'Until the password is changed, the server rejects every request except password change and sign-out.',
  'auth.forcePassword.submit': 'Change and continue',
  'auth.forcePassword.submitting': 'Changing…',
  'auth.session.checkFailed': 'Failed to verify sign-in status: {message}',

  // —— User management · list and toolbar ——
  // {count} drives the plural form: the base key is `other`, `.one` is the singular
  'auth.users.count': '{count} accounts',
  'auth.users.count.one': '{count} account',
  'auth.users.empty': 'No users yet',
  'auth.users.emptyHint': 'Click "New user" in the top right to create the first account.',
  'auth.users.create': 'New user',
  'auth.users.editAction': 'Edit user',
  'auth.users.deleteAction': 'Delete user',
  'auth.users.cannotDeleteSelf': 'You cannot delete the account you are signed in with',
  'auth.users.currentAccount': 'Current account',
  'auth.users.displayName': 'Display name',
  'auth.users.adminColumn': 'Administrator',
  'auth.users.lastLogin': 'Last sign-in',

  // —— User management · form ——
  'auth.users.usernamePlaceholder': 'Sign-in username',
  'auth.users.usernameImmutable': 'The username cannot be changed after creation',
  'auth.users.initialPassword': 'Initial password',
  'auth.users.resetPassword': 'Reset password',
  'auth.users.passwordMinPlaceholder': 'At least 6 characters',
  'auth.users.passwordKeepPlaceholder': 'Leave blank to keep unchanged',
  'auth.users.displayNamePlaceholder': 'Shown in the interface',
  'auth.users.rolesPlaceholder': 'Separate multiple roles with commas, e.g. dba, developer',
  'auth.users.rolesHint':
    'Roles determine the available permission set; the exact permissions come from the server-side RBAC configuration.',
  'auth.users.grantAdmin': 'Grant administrator rights',
  'auth.users.grantAdminHint':
    'Administrators can manage users, view all connections, and hold all permissions.',
  'auth.users.createSubmit': 'Create user',
  'auth.users.editTitle': 'Edit user: {name}',
  'auth.users.editDescription': 'Change the display name or roles, or reset the password.',
  'auth.users.createDescription':
    'Once created, the user can sign in to the management console with this account.',
  'auth.users.deleteConfirm':
    'Delete user "{name}"? This cannot be undone; the historical audit records are kept.',

  // —— User management · restricted access ——
  'auth.users.adminOnlyTitle': 'Administrators only',
  'auth.users.adminOnlyHint':
    'This account cannot manage users and permissions. Ask an administrator to grant isAdmin or the appropriate role on the server.',

  // —— User management · feedback and errors ({message} is an already-localized error) ——
  'auth.users.loadFailed': 'Failed to load the user list: {message}',
  'auth.users.createFailed': 'Failed to create the user: {message}',
  'auth.users.updateFailed': 'Failed to update the user: {message}',
  'auth.users.deleteFailed': 'Failed to delete the user: {message}',
  'auth.users.created': 'User {name} created.',
  'auth.users.updated': 'User {name} updated.',
  'auth.users.deleted': 'User {name} deleted.',
  'auth.validation.emailInvalid': 'Invalid email format',
};

export default messages;
