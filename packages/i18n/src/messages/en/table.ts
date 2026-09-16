/**
 * 花生苗数据库管理工具 - 表数据编辑器文案（en）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 表数据编辑器（Excel 式增删改查）的界面文案。键名以 table. 开头。
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  'table.title': 'Table data',
  'table.subtitle': 'View and edit records like a spreadsheet: insert, update, delete — no SQL required',
  'table.selectConnection': 'Connection',
  'table.selectTable': 'Table',
  'table.pickTable': 'Pick a table',
  'table.noTableTitle': 'No table selected',
  'table.noTableHint': 'Choose a table on the left; its rows appear here and can be edited directly.',
  'table.refresh': 'Refresh',
  'table.addRow': 'Add row',
  'table.deleteRows': 'Delete selected ({count})',
  'table.save': 'Save changes ({count})',
  'table.discard': 'Discard changes',
  'table.pageSize': '{size} rows/page',
  'table.prev': 'Previous',
  'table.next': 'Next',
  'table.pageInfo': 'Page {page} of {total}',
  'table.totalRows': '{count} rows total',
  'table.totalUnknown': 'Row count unknown (table too large or not countable)',
  'table.loading': 'Loading…',
  'table.empty': 'This table has no rows yet',
  'table.emptyHint': 'Click "Add row" to insert the first record.',
  'table.rowNew': 'New',
  'table.rowEdited': 'Edited',
  'table.rowDeleted': 'To delete',
  'table.selectRow': 'Select row {index}',
  'table.selectAll': 'Select all on this page',
  'table.cellNull': 'NULL',
  'table.cellEdited': 'This cell has been edited',
  'table.locatorPrimary': 'Located by primary key {columns}',
  'table.locatorUnique': 'Located by unique index {name} ({columns})',
  'table.locatorNone': 'No row locator',
  'table.readonlyNoKey': 'This table has no primary key and no usable unique index, so a single row cannot be identified safely. To avoid updating many rows by accident, only viewing and inserting are allowed here.',
  'table.readonlyNoPermission': 'Your account has no write permission; view only.',
  'table.readonlyConnection': 'This connection has read-only protection enabled; view only.',
  'table.readonlyBanner': 'Read-only: {reason}',
  'table.errLoad': 'Failed to load data: {message}',
  'table.errSave': 'Failed to save: {message}',
  'table.errNoChanges': 'There are no changes to save',
  'table.errRequired': 'Column {column} may not be null',
  'table.errIdentifier': 'Invalid table or column name',
  'table.confirmDelete': 'Delete the {count} selected row(s)? This writes to the database immediately and cannot be undone.',
  'table.confirmDiscard': 'Discard all unsaved changes?',
  'table.saveDone': 'Saved: {inserted} inserted / {updated} updated / {deleted} deleted',
  'table.unsaved': '{count} change(s) not saved yet',
  'table.sortHint': 'Click a column header to sort',
  'table.newRowHint': 'New rows are appended at the end and written to the database only after saving',
  'table.pkMissing': 'This table has no primary key: you can insert rows, but existing records cannot be updated or deleted safely.',
};

export default messages;
