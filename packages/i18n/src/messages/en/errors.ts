/**
 * English · Error code messages
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * The server's `error.message` is available in Chinese only. The client looks
 * up the message for the current language by the stable `error.code` in this
 * table, so **error messages follow the interface language too**.
 * The original server text is not lost: it is still shown under "original
 * message" in the error details, which makes troubleshooting easier
 * (technical details are not machine-translated).
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  'error.VALIDATION_FAILED': 'The submitted data is invalid',
  'error.AUTH_REQUIRED': 'Please sign in first',
  'error.AUTH_INVALID_CREDENTIALS': 'Incorrect username or password',
  'error.AUTH_TOKEN_INVALID': 'Invalid sign-in credentials. Please sign in again',
  'error.AUTH_TOKEN_EXPIRED': 'Your session has expired. Please sign in again',
  'error.AUTH_ACCOUNT_DISABLED': 'This account has been disabled. Please contact an administrator',
  'error.AUTH_ACCOUNT_LOCKED': 'The account was temporarily locked after multiple failed sign-in attempts. Please try again later',
  'error.AUTH_FORBIDDEN': 'Insufficient permissions to perform this operation',
  'error.PASSWORD_CHANGE_REQUIRED': 'You are still using the initial password. Please change it first.',
  'error.NOT_FOUND': 'The requested resource does not exist',
  'error.CONFLICT': 'Conflicts with existing data',
  'error.READONLY_VIOLATION': 'This connection is in read-only mode; the write operation was rejected',
  'error.CONFIRMATION_REQUIRED': 'This operation requires confirmation before it can proceed',
  'error.DRIVER_NOT_IMPLEMENTED': 'The driver for this database type is not implemented yet',
  'error.CONNECTION_FAILED': 'Failed to connect to the database. Check the address, port and credentials',
  'error.QUERY_FAILED': 'SQL execution failed',
  'error.QUERY_TIMEOUT': 'The query timed out. Optimize the statement or narrow the data range',
  'error.QUERY_CANCELLED': 'The query was cancelled',
  'error.MIGRATION_FAILED': 'Migration failed',
  'error.AI_DISABLED': 'AI features are not enabled. Configure a provider in Settings first',
  'error.AI_PROVIDER_ERROR': 'The AI provider returned an error. Check the API key and quota',
  'error.INTERNAL': 'Internal server error',

  // Error detail section
  'error.details': 'Error details',
  'error.code': 'Error code',
  'error.originalMessage': 'Original message (server)',
  'error.retryHint': 'You can fix the problem and retry, or give the error code and original message to an administrator.',
};

export default messages;
