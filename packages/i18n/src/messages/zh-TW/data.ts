/**
 * 繁體中文 · 資料與 SQL 開發（連線管理 + SQL 開發）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 只收錄「連線管理」與「SQL 開發」兩個模組特有的說法：
 * 通用按鈕 / 狀態 / 表頭 / 計數 / 時間單位請沿用 common.*，
 * 資料庫類別、驅動程式狀態等伺服器端列舉請沿用 meta 命名空間（dbCategory.* / driver.*）。
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— 連線管理：表單與標題 ——
  'data.conn.createTitle': '新增連線',
  'data.conn.createSubmit': '建立連線',
  'data.conn.editAction': '編輯連線',
  'data.conn.editTitle': '編輯連線：{name}',
  'data.conn.modalDescription': '連線資訊儲存在伺服器端，密碼欄位會加密儲存且不會顯示原值。',
  'data.conn.fieldName': '連線名稱 *',
  'data.conn.namePlaceholder': '例如：生產訂單資料庫',
  'data.conn.fieldDbType': '資料庫類型 *',
  // 資料庫類型下拉項的整體格式（含全形括號，英文等語言應改成半形）
  'data.conn.dbTypeOption': '{label}（{category}）',
  'data.conn.fieldHost': '主機',
  'data.conn.fieldPort': '連接埠',
  'data.conn.portPlaceholder': '預設連接埠',
  'data.conn.fieldDatabase': '資料庫 / Schema',
  'data.conn.fieldUsername': '使用者名稱',
  'data.conn.fieldPassword': '密碼',
  'data.conn.passwordPlaceholderEdit': '留空表示不修改已儲存的密碼',
  'data.conn.passwordPlaceholderCreate': '選填，儲存後由伺服器端加密儲存',
  'data.conn.passwordSaved': '此連線已儲存密碼。',
  'data.conn.passwordNotSaved': '此連線尚未儲存密碼。',
  'data.conn.passwordSavedNoEcho': '已儲存（不顯示原值）',
  'data.conn.notSaved': '未儲存',
  'data.conn.passwordSavedTitle': '已儲存密碼',
  'data.conn.fieldUrl': '連線字串（選填）',
  'data.conn.urlPlaceholder': '填寫後優先使用連線字串，例如 mysql://user:pass@host:3306/db',
  'data.conn.fieldExtraParams': '額外參數（JSON，選填）',
  'data.conn.extraParamsPlaceholder': '例如 {"ssl": true, "charset": "utf8mb4"}',
  'data.conn.fieldColorTag': '顏色標記',
  'data.conn.colorNone': '無標記',
  'data.conn.colorSwatchAria': '顏色標記 {color}',
  'data.conn.readonlyLabel': '唯讀連線',
  'data.conn.readonlyHint': '開啟後伺服器端會拒絕此連線上的寫入操作。',
  'data.conn.favoriteLabel': '加入收藏',
  'data.conn.unfavoriteLabel': '取消收藏',
  'data.conn.favoritedTitle': '已收藏',
  'data.conn.favoriteBadge': '收藏',
  'data.conn.favoriteHint': '收藏的連線在清單中優先顯示。',
  'data.conn.createNote': '提示：連線建立並儲存後，才能在清單中執行「測試連線」。',
  // meta.driver.* 只提供「已實作 / 未實作」，這裡補上「驅動程式」前綴以保持原有文案。
  'data.conn.driverNotImplemented': '驅動程式{status}',

  // —— 連線管理：表單驗證 ——
  'data.conn.errorNameRequired': '請輸入連線名稱。',
  'data.conn.errorDbTypeRequired': '請選擇資料庫類型。',
  'data.conn.errorPortNumeric': '連接埠必須是數字。',
  'data.conn.errorExtraParamsObject': '額外參數必須是 JSON 物件，例如 {"ssl": true}。',
  'data.conn.errorExtraParamsInvalid': '額外參數不是合法的 JSON，請檢查格式。',

  // —— 連線管理：清單與工具列 ——
  'data.conn.searchPlaceholder': '搜尋名稱、主機、資料庫',
  'data.conn.allTypes': '全部類型',
  'data.conn.favoriteOnly': '僅顯示收藏',
  'data.conn.totalConnections': '共 {count} 個連線',
  'data.conn.colName': '連線名稱',
  'data.conn.colAddress': '位址',
  'data.conn.colLastUsed': '最近使用',
  'data.conn.colConnectivity': '連通性',
  'data.conn.statusFailed': '失敗',
  'data.conn.testing': '測試中…',
  'data.conn.notTested': '尚未測試',
  'data.conn.testConnection': '測試連線',
  'data.conn.empty': '還沒有資料庫連線',
  'data.conn.emptyHint': '點擊右上角「新增連線」新增第一個資料來源。',

  // —— 連線管理：詳細資料面板與刪除確認 ——
  'data.conn.editThis': '編輯此連線',
  'data.conn.deleteTitle': '刪除連線',
  'data.conn.deleteConfirm': '確定要刪除連線「{name}」嗎？刪除後此連線上的 SQL 開發與歷史參照將失效。',
  'data.conn.sessionTest': '本次工作階段測試',
  'data.conn.detailHint': '連線密碼由伺服器端加密儲存；如需更換密碼，請在編輯視窗中填寫新密碼後儲存。',

  // —— 連線管理：操作回饋（{message} 為已在地化的錯誤文案）——
  'data.conn.loadListFailed': '載入連線清單失敗：{message}',
  'data.conn.loadDbTypesFailed': '載入資料庫類型失敗：{message}',
  'data.conn.created': '連線「{name}」已建立。',
  'data.conn.createFailed': '建立連線失敗：{message}',
  'data.conn.updated': '連線「{name}」已更新。',
  'data.conn.updateFailed': '更新連線失敗：{message}',
  'data.conn.testSuccess': '「{name}」連線成功：{latency} ms{version}',
  'data.conn.testFailed': '「{name}」連線失敗：{message}',
  'data.conn.testRequestFailed': '測試連線失敗：{message}',
  'data.conn.favoriteFailed': '更新收藏狀態失敗：{message}',
  'data.conn.deleted': '連線「{name}」已刪除。',
  'data.conn.deleteFailed': '刪除連線失敗：{message}',
  'data.conn.detailTestSuccess': '連線成功：{latency} ms{version}',
  'data.conn.detailTestFailed': '連線失敗：{message}',

  // —— 資料庫類型品牌名稱（依穩定 code 收錄；未收錄的自訂類型回退伺服器端 label）——
  'data.dbType.mysql': 'MySQL',
  'data.dbType.mariadb': 'MariaDB',
  'data.dbType.postgresql': 'PostgreSQL',
  'data.dbType.oracle': 'Oracle',
  'data.dbType.sqlserver': 'SQL Server',
  'data.dbType.sqlite': 'SQLite',
  'data.dbType.kingbase': '金倉 KingbaseES',
  'data.dbType.dm': '達夢 DM',
  'data.dbType.oceanbase': 'OceanBase',
  'data.dbType.tidb': 'TiDB',
  'data.dbType.redis': 'Redis',
  'data.dbType.mongodb': 'MongoDB',
  'data.dbType.clickhouse': 'ClickHouse',
  'data.dbType.influxdb': 'InfluxDB',
  'data.dbType.neo4j': 'Neo4j',

  // —— SQL 開發：物件樹 ——
  'data.sql.treeTitle': '連線與物件',
  'data.sql.connectionLabel': '資料庫連線',
  'data.sql.selectConnection': '請選擇連線',
  // 連線下拉項的整體格式（含全形括號，英文等語言應改成半形）
  'data.sql.connectionOption': '{name}（{type}）',
  'data.sql.treeSelectConnection': '請先選擇資料庫連線，隨後可瀏覽此連線下的 Schema 與資料表。',
  'data.sql.loadingSchemas': '正在載入 Schema…',
  'data.sql.noSchemas': '未取得 Schema，請確認帳號權限或連線設定。',
  'data.sql.loadingTables': '載入資料表…',
  'data.sql.noTables': '此 Schema 下沒有資料表。',
  'data.sql.loadingColumns': '載入欄位…',
  'data.sql.noColumns': '未取得欄位資訊。',
  'data.sql.insertQuery': '插入查詢語句',
  'data.sql.loadSchemasFailed': '載入 Schema 失敗：{message}',
  'data.sql.loadTablesFailed': '載入資料表失敗：{message}',
  'data.sql.loadColumnsFailed': '載入欄位失敗：{message}',

  // —— SQL 開發：執行歷史 ——
  'data.sql.historyTitle': '執行歷史',
  'data.sql.refreshHistory': '重新整理執行歷史',
  'data.sql.noHistory': '暫無執行記錄。',
  'data.sql.slowQuery': '慢查詢',
  'data.sql.loadHistoryFailed': '載入執行歷史失敗：{message}',

  // —— SQL 開發：編輯器與結果區 ——
  'data.sql.loadConnectionsFailed': '載入連線清單失敗：{message}',
  'data.sql.selectConnectionFirst': '請先選擇資料庫連線。',
  'data.sql.enterSqlToRun': '請輸入要執行的 SQL 語句。',
  'data.sql.enterSqlToExplain': '請輸入要分析的 SQL 語句。',
  'data.sql.executed': '執行完成：{rows} · 影響 {affected} · {duration}{suffix}',
  'data.sql.execFailed': '執行失敗：{message}',
  'data.sql.explainFailed': '取得執行計畫失敗：{message}',
  'data.sql.editorTitle': 'SQL 編輯器',
  'data.sql.run': '執行',
  'data.sql.explain': '執行計畫',
  'data.sql.copySql': '複製 SQL',
  'data.sql.clearEditor': '清空編輯器',
  'data.sql.showHistory': '顯示執行歷史',
  'data.sql.hideHistory': '隱藏執行歷史',
  'data.sql.readonlyBanner': '目前連線為唯讀模式，寫入操作（INSERT / UPDATE / DELETE / DDL）會被伺服器端拒絕。',
  'data.sql.editorPlaceholder': '在此輸入 SQL，Ctrl / Cmd + Enter 執行',
  'data.sql.maxRows': '最大傳回列數',
  'data.sql.serverDefault': '伺服器端預設',
  'data.sql.timeoutMs': '逾時（毫秒）',
  'data.sql.shortcutHint': '快速鍵：Ctrl / Cmd + Enter 執行目前編輯器內的 SQL',
  'data.sql.tabResult': '結果',
  'data.sql.tabMessage': '訊息',
  'data.sql.returnedRows': '傳回 {count} 列',
  'data.sql.affectedRows': '影響 {count} 列',
  'data.sql.elapsed': '耗時 {duration}',
  'data.sql.successTitle': '語句執行成功',
  'data.sql.successNoResult': '此語句沒有傳回結果集，影響 {count} 列。',
  'data.sql.emptyResult': '結果集為空',
  'data.sql.emptyResultHint': '語句執行成功，但沒有符合任何資料。',
  'data.sql.notExecutedTitle': '尚未執行 SQL',
  'data.sql.notExecutedHint': '選擇連線並輸入語句後，按 Ctrl / Cmd + Enter 或點擊「執行」查看結果。',
  'data.sql.noPlanTitle': '暫無執行計畫',
  'data.sql.noPlanHint': '點擊「執行計畫」按鈕，伺服器端將傳回此語句的文字執行計畫。',
  'data.sql.noMessages': '本次工作階段暫無錯誤訊息。',
  'data.sql.lastSuccess': '最近一次成功執行：{count} 列，耗時 {duration}。',

  // —— SQL 開發：匯出與複製 ——
  // 結果被截斷時的括號包裹格式（正文沿用 common.truncated）
  'data.sql.truncatedSuffix': '（{text}）',
  'data.sql.noExportData': '暫無可匯出的結果集。',
  'data.sql.exported': '已匯出 {format} 檔案。',
  'data.sql.emptyEditor': '目前編輯器沒有內容。',
  'data.sql.copied': 'SQL 已複製到剪貼簿。',
  'data.sql.copyFailed': '瀏覽器拒絕了剪貼簿存取，請手動複製。',

  // —— 結果表格 ——
  // NULL 儲存格的顯示慣例：固定顯示 (NULL)，屬於技術寫法，各語言保持一致。
  'data.grid.nullCell': '(NULL)',
  'data.conn.errorExtraParamsValue': '「額外參數」的值必須是字串：{key}',
};

export default messages;
