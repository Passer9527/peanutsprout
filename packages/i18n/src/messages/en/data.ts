/**
 * English · Connections & SQL editor
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— Connection management: form and titles ——
  'data.conn.createTitle': 'New connection',
  'data.conn.createSubmit': 'Create connection',
  'data.conn.editAction': 'Edit connection',
  'data.conn.editTitle': 'Edit connection: {name}',
  'data.conn.modalDescription':
    'Connection details are stored on the server; the password is encrypted at rest and never echoed back.',
  'data.conn.fieldName': 'Connection name *',
  'data.conn.namePlaceholder': 'e.g. Production orders DB',
  'data.conn.fieldDbType': 'Database type *',
  'data.conn.dbTypeOption': '{label} ({category})',
  'data.conn.fieldHost': 'Host',
  'data.conn.fieldPort': 'Port',
  'data.conn.portPlaceholder': 'Default port',
  'data.conn.fieldDatabase': 'Database / schema',
  'data.conn.fieldUsername': 'Username',
  'data.conn.fieldPassword': 'Password',
  'data.conn.passwordPlaceholderEdit': 'Leave blank to keep the saved password',
  'data.conn.passwordPlaceholderCreate': 'Optional; encrypted on the server once saved',
  'data.conn.passwordSaved': 'A password is saved for this connection.',
  'data.conn.passwordNotSaved': 'No password is saved for this connection yet.',
  'data.conn.passwordSavedNoEcho': 'Saved (not shown)',
  'data.conn.notSaved': 'Not saved',
  'data.conn.passwordSavedTitle': 'Password saved',
  'data.conn.fieldUrl': 'Connection string (optional)',
  'data.conn.urlPlaceholder':
    'When provided, the connection string takes precedence, e.g. mysql://user:pass@host:3306/db',
  'data.conn.fieldExtraParams': 'Extra parameters (JSON, optional)',
  'data.conn.extraParamsPlaceholder': 'e.g. {"ssl": true, "charset": "utf8mb4"}',
  'data.conn.fieldColorTag': 'Color tag',
  'data.conn.colorNone': 'No tag',
  'data.conn.colorSwatchAria': 'Color tag {color}',
  'data.conn.readonlyLabel': 'Read-only connection',
  'data.conn.readonlyHint':
    'When enabled, the server rejects write operations on this connection.',
  'data.conn.favoriteLabel': 'Add to favorites',
  'data.conn.unfavoriteLabel': 'Remove from favorites',
  'data.conn.favoritedTitle': 'Favorited',
  'data.conn.favoriteBadge': 'Favorite',
  'data.conn.favoriteHint': 'Favorited connections appear first in the list.',
  'data.conn.createNote':
    'Note: the connection must be created and saved before you can run "Test connection" from the list.',
  // meta.driver.* only supplies Implemented / Not implemented; the "Driver" prefix lives here
  'data.conn.driverNotImplemented': 'Driver: {status}',

  // —— Connection management: form validation ——
  'data.conn.errorNameRequired': 'Please enter a connection name.',
  'data.conn.errorDbTypeRequired': 'Please select a database type.',
  'data.conn.errorPortNumeric': 'The port must be a number.',
  'data.conn.errorExtraParamsObject':
    'Extra parameters must be a JSON object, e.g. {"ssl": true}.',
  'data.conn.errorExtraParamsInvalid':
    'Extra parameters are not valid JSON; please check the format.',

  // —— Connection management: list and toolbar ——
  'data.conn.searchPlaceholder': 'Search name, host, database',
  'data.conn.allTypes': 'All types',
  'data.conn.favoriteOnly': 'Favorites only',
  'data.conn.totalConnections': '{count} connections',
  'data.conn.totalConnections.one': '{count} connection',
  'data.conn.colName': 'Connection name',
  'data.conn.colAddress': 'Address',
  'data.conn.colLastUsed': 'Last used',
  'data.conn.colConnectivity': 'Connectivity',
  'data.conn.statusFailed': 'Failed',
  'data.conn.testing': 'Testing…',
  'data.conn.notTested': 'Not tested yet',
  'data.conn.testConnection': 'Test connection',
  'data.conn.empty': 'No database connections yet',
  'data.conn.emptyHint': 'Click "New connection" in the top right to add your first data source.',

  // —— Connection management: detail panel and delete confirmation ——
  'data.conn.editThis': 'Edit this connection',
  'data.conn.deleteTitle': 'Delete connection',
  'data.conn.deleteConfirm':
    'Delete connection "{name}"? SQL editor sessions and historical references for this connection will stop working.',
  'data.conn.sessionTest': 'Session test',
  'data.conn.detailHint':
    'Connection passwords are encrypted on the server; to change one, enter the new password in the edit dialog and save.',

  // —— Connection management: feedback ({message} is an already-localized error) ——
  'data.conn.loadListFailed': 'Failed to load the connection list: {message}',
  'data.conn.loadDbTypesFailed': 'Failed to load database types: {message}',
  'data.conn.created': 'Connection "{name}" created.',
  'data.conn.createFailed': 'Failed to create the connection: {message}',
  'data.conn.updated': 'Connection "{name}" updated.',
  'data.conn.updateFailed': 'Failed to update the connection: {message}',
  'data.conn.testSuccess': '"{name}" connected successfully: {latency} ms{version}',
  'data.conn.testFailed': '"{name}" connection failed: {message}',
  'data.conn.testRequestFailed': 'Connection test failed: {message}',
  'data.conn.favoriteFailed': 'Failed to update the favorite status: {message}',
  'data.conn.deleted': 'Connection "{name}" deleted.',
  'data.conn.deleteFailed': 'Failed to delete the connection: {message}',
  'data.conn.detailTestSuccess': 'Connected successfully: {latency} ms{version}',
  'data.conn.detailTestFailed': 'Connection failed: {message}',

  // —— Database type brand names (by stable code; unlisted custom types fall back to the server label) ——
  'data.dbType.mysql': 'MySQL',
  'data.dbType.mariadb': 'MariaDB',
  'data.dbType.postgresql': 'PostgreSQL',
  'data.dbType.oracle': 'Oracle',
  'data.dbType.sqlserver': 'SQL Server',
  'data.dbType.sqlite': 'SQLite',
  'data.dbType.kingbase': 'KingbaseES',
  'data.dbType.dm': 'Dameng DM',
  'data.dbType.oceanbase': 'OceanBase',
  'data.dbType.tidb': 'TiDB',
  'data.dbType.redis': 'Redis',
  'data.dbType.mongodb': 'MongoDB',
  'data.dbType.clickhouse': 'ClickHouse',
  'data.dbType.influxdb': 'InfluxDB',
  'data.dbType.neo4j': 'Neo4j',

  // —— SQL editor: object tree ——
  'data.sql.treeTitle': 'Connection & objects',
  'data.sql.connectionLabel': 'Database connection',
  'data.sql.selectConnection': 'Select a connection',
  'data.sql.connectionOption': '{name} ({type})',
  'data.sql.treeSelectConnection':
    'Select a database connection first, then browse its schemas and tables.',
  'data.sql.loadingSchemas': 'Loading schemas…',
  'data.sql.noSchemas': 'No schemas were returned. Check the account permissions or connection settings.',
  'data.sql.loadingTables': 'Loading tables…',
  'data.sql.noTables': 'This schema has no tables.',
  'data.sql.loadingColumns': 'Loading columns…',
  'data.sql.noColumns': 'No column information was returned.',
  'data.sql.insertQuery': 'Insert query',
  'data.sql.loadSchemasFailed': 'Failed to load schemas: {message}',
  'data.sql.loadTablesFailed': 'Failed to load tables: {message}',
  'data.sql.loadColumnsFailed': 'Failed to load columns: {message}',

  // —— SQL editor: execution history ——
  'data.sql.historyTitle': 'Execution history',
  'data.sql.refreshHistory': 'Refresh execution history',
  'data.sql.noHistory': 'No execution records yet.',
  'data.sql.slowQuery': 'Slow query',
  'data.sql.loadHistoryFailed': 'Failed to load execution history: {message}',

  // —— SQL editor: editor and results ——
  'data.sql.loadConnectionsFailed': 'Failed to load the connection list: {message}',
  'data.sql.selectConnectionFirst': 'Please select a database connection first.',
  'data.sql.enterSqlToRun': 'Enter the SQL statement to run.',
  'data.sql.enterSqlToExplain': 'Enter the SQL statement to analyze.',
  'data.sql.executed': 'Executed: {rows} · affected {affected} · {duration}{suffix}',
  'data.sql.execFailed': 'Execution failed: {message}',
  'data.sql.explainFailed': 'Failed to get the execution plan: {message}',
  'data.sql.editorTitle': 'SQL Editor',
  'data.sql.run': 'Run',
  'data.sql.explain': 'Execution plan',
  'data.sql.copySql': 'Copy SQL',
  'data.sql.clearEditor': 'Clear editor',
  'data.sql.showHistory': 'Show execution history',
  'data.sql.hideHistory': 'Hide execution history',
  'data.sql.readonlyBanner':
    'This connection is in read-only mode; write operations (INSERT / UPDATE / DELETE / DDL) are rejected by the server.',
  'data.sql.editorPlaceholder': 'Type SQL here; press Ctrl / Cmd + Enter to run',
  'data.sql.maxRows': 'Max rows returned',
  'data.sql.serverDefault': 'Server default',
  'data.sql.timeoutMs': 'Timeout (ms)',
  'data.sql.shortcutHint': 'Shortcut: Ctrl / Cmd + Enter runs the SQL in the editor',
  'data.sql.tabResult': 'Results',
  'data.sql.tabMessage': 'Messages',
  'data.sql.returnedRows': '{count} rows returned',
  'data.sql.returnedRows.one': '{count} row returned',
  'data.sql.affectedRows': '{count} rows affected',
  'data.sql.affectedRows.one': '{count} row affected',
  'data.sql.elapsed': 'Elapsed {duration}',
  'data.sql.successTitle': 'Statement executed successfully',
  'data.sql.successNoResult': 'The statement returned no result set; {count} rows affected.',
  'data.sql.successNoResult.one': 'The statement returned no result set; {count} row affected.',
  'data.sql.emptyResult': 'Empty result set',
  'data.sql.emptyResultHint': 'The statement executed successfully but matched no data.',
  'data.sql.notExecutedTitle': 'No SQL executed yet',
  'data.sql.notExecutedHint':
    'Select a connection and enter a statement, then press Ctrl / Cmd + Enter or click "Run" to see the results.',
  'data.sql.noPlanTitle': 'No execution plan yet',
  'data.sql.noPlanHint':
    'Click "Execution plan" and the server returns the text execution plan for the statement.',
  'data.sql.noMessages': 'No error messages in this session.',
  'data.sql.lastSuccess': 'Last successful execution: {count} rows in {duration}.',
  'data.sql.lastSuccess.one': 'Last successful execution: {count} row in {duration}.',

  // —— SQL editor: export and copy ——
  // Parenthesized wrapper used when the result is truncated (the body reuses common.truncated)
  'data.sql.truncatedSuffix': ' ({text})',
  'data.sql.noExportData': 'There is no result set to export.',
  'data.sql.exported': 'Exported the {format} file.',
  'data.sql.emptyEditor': 'The editor is empty.',
  'data.sql.copied': 'SQL copied to clipboard.',
  'data.sql.copyFailed': 'The browser denied clipboard access. Please copy manually.',

  // —— Result table ——
  // NULL cell display convention: always (NULL), a technical token kept identical in every language
  'data.grid.nullCell': '(NULL)',
  'data.conn.errorExtraParamsValue': 'Extra parameter values must be strings: {key}',
};

export default messages;
