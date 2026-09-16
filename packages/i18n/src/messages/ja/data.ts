/**
 * 日本語 · データ（接続管理 + SQL 開発）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 「接続管理」と「SQL 開発」の 2 モジュール固有の言い回しだけを収録します：
 * 共通ボタン / ステータス / テーブルヘッダー / 件数 / 時間単位は common.* を、
 * データベース種別やドライバーの状態などのサーバー列挙は meta 名前空間
 * （dbCategory.* / driver.*）を再利用してください。
 *
 * 件数系の文言は接尾辞なしのキーで日本語の基本形を表します（日本語に複数形の変化はありません）。
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— 接続管理：フォームとタイトル ——
  'data.conn.createTitle': '接続を作成',
  'data.conn.createSubmit': '接続を作成',
  'data.conn.editAction': '接続を編集',
  'data.conn.editTitle': '接続を編集：{name}',
  'data.conn.modalDescription': '接続情報はサーバーに保存され、パスワードは暗号化して保存されるため画面には表示されません。',
  'data.conn.fieldName': '接続名 *',
  'data.conn.namePlaceholder': '例：本番受注データベース',
  'data.conn.fieldDbType': 'データベース種別 *',
  // データベース種別ドロップダウン項目の全体書式（全角括弧を含みます）
  'data.conn.dbTypeOption': '{label}（{category}）',
  'data.conn.fieldHost': 'ホスト',
  'data.conn.fieldPort': 'ポート',
  'data.conn.portPlaceholder': 'デフォルトのポート',
  'data.conn.fieldDatabase': 'データベース / スキーマ',
  'data.conn.fieldUsername': 'ユーザー名',
  'data.conn.fieldPassword': 'パスワード',
  'data.conn.passwordPlaceholderEdit': '空欄のままにすると保存済みのパスワードを変更しません',
  'data.conn.passwordPlaceholderCreate': '任意。保存後はサーバー側で暗号化して保存されます',
  'data.conn.passwordSaved': 'この接続にはパスワードが保存されています。',
  'data.conn.passwordNotSaved': 'この接続にはまだパスワードが保存されていません。',
  'data.conn.passwordSavedNoEcho': '保存済み（非表示）',
  'data.conn.notSaved': '未保存',
  'data.conn.passwordSavedTitle': 'パスワード保存済み',
  'data.conn.fieldUrl': '接続文字列（任意）',
  'data.conn.urlPlaceholder': '入力した場合は接続文字列が優先されます。例：mysql://user:pass@host:3306/db',
  'data.conn.fieldExtraParams': '追加パラメーター（JSON、任意）',
  'data.conn.extraParamsPlaceholder': '例：{"ssl": true, "charset": "utf8mb4"}',
  'data.conn.fieldColorTag': 'カラーマーカー',
  'data.conn.colorNone': 'マーカーなし',
  'data.conn.colorSwatchAria': 'カラーマーカー {color}',
  'data.conn.readonlyLabel': '読み取り専用接続',
  'data.conn.readonlyHint': '有効にすると、サーバーはこの接続での書き込み操作を拒否します。',
  'data.conn.favoriteLabel': 'お気に入りに追加',
  'data.conn.unfavoriteLabel': 'お気に入りを解除',
  'data.conn.favoritedTitle': 'お気に入り登録済み',
  'data.conn.favoriteBadge': 'お気に入り',
  'data.conn.favoriteHint': 'お気に入りの接続は一覧の上位に表示されます。',
  'data.conn.createNote': 'ヒント：接続を作成して保存すると、一覧で「接続テスト」を実行できるようになります。',
  // meta.driver.* は「実装済み / 未実装」だけを提供するため、ここで「ドライバー」を補います。
  'data.conn.driverNotImplemented': 'ドライバー{status}',

  // —— 接続管理：フォーム検証 ——
  'data.conn.errorNameRequired': '接続名を入力してください。',
  'data.conn.errorDbTypeRequired': 'データベース種別を選択してください。',
  'data.conn.errorPortNumeric': 'ポートは数値で入力してください。',
  'data.conn.errorExtraParamsObject': '追加パラメーターは JSON オブジェクトで入力してください。例：{"ssl": true}。',
  'data.conn.errorExtraParamsInvalid': '追加パラメーターが正しい JSON ではありません。形式を確認してください。',

  // —— 接続管理：一覧とツールバー ——
  'data.conn.searchPlaceholder': '名前、ホスト、データベースを検索',
  'data.conn.allTypes': 'すべての種別',
  'data.conn.favoriteOnly': 'お気に入りのみ',
  'data.conn.totalConnections': '{count} 件の接続',
  'data.conn.colName': '接続名',
  'data.conn.colAddress': 'アドレス',
  'data.conn.colLastUsed': '最終使用',
  'data.conn.colConnectivity': '接続状態',
  'data.conn.statusFailed': '失敗',
  'data.conn.testing': 'テスト中…',
  'data.conn.notTested': '未テスト',
  'data.conn.testConnection': '接続テスト',
  'data.conn.empty': 'データベース接続がまだありません',
  'data.conn.emptyHint': '右上の「接続を作成」から最初のデータソースを追加してください。',

  // —— 接続管理：詳細パネルと削除確認 ——
  'data.conn.editThis': 'この接続を編集',
  'data.conn.deleteTitle': '接続を削除',
  'data.conn.deleteConfirm': '接続「{name}」を削除してもよろしいですか？削除すると、この接続の SQL 開発と履歴からの参照は無効になります。',
  'data.conn.sessionTest': 'このセッションでのテスト',
  'data.conn.detailHint': '接続のパスワードはサーバー側で暗号化して保存されます。変更する場合は、編集ダイアログで新しいパスワードを入力して保存してください。',

  // —— 接続管理：操作フィードバック（{message} はローカライズ済みのエラー文言）——
  'data.conn.loadListFailed': '接続一覧の読み込みに失敗しました：{message}',
  'data.conn.loadDbTypesFailed': 'データベース種別の読み込みに失敗しました：{message}',
  'data.conn.created': '接続「{name}」を作成しました。',
  'data.conn.createFailed': '接続の作成に失敗しました：{message}',
  'data.conn.updated': '接続「{name}」を更新しました。',
  'data.conn.updateFailed': '接続の更新に失敗しました：{message}',
  'data.conn.testSuccess': '「{name}」に接続しました：{latency} ms{version}',
  'data.conn.testFailed': '「{name}」への接続に失敗しました：{message}',
  'data.conn.testRequestFailed': '接続テストに失敗しました：{message}',
  'data.conn.favoriteFailed': 'お気に入り状態の更新に失敗しました：{message}',
  'data.conn.deleted': '接続「{name}」を削除しました。',
  'data.conn.deleteFailed': '接続の削除に失敗しました：{message}',
  'data.conn.detailTestSuccess': '接続に成功しました：{latency} ms{version}',
  'data.conn.detailTestFailed': '接続に失敗しました：{message}',

  // —— データベース種別のブランド名（安定した code で収録。未収録のカスタム種別はサーバーの label にフォールバック）——
  'data.dbType.mysql': 'MySQL',
  'data.dbType.mariadb': 'MariaDB',
  'data.dbType.postgresql': 'PostgreSQL',
  'data.dbType.oracle': 'Oracle',
  'data.dbType.sqlserver': 'SQL Server',
  'data.dbType.sqlite': 'SQLite',
  'data.dbType.kingbase': 'KingbaseES',
  'data.dbType.dm': 'DM',
  'data.dbType.oceanbase': 'OceanBase',
  'data.dbType.tidb': 'TiDB',
  'data.dbType.redis': 'Redis',
  'data.dbType.mongodb': 'MongoDB',
  'data.dbType.clickhouse': 'ClickHouse',
  'data.dbType.influxdb': 'InfluxDB',
  'data.dbType.neo4j': 'Neo4j',

  // —— SQL 開発：オブジェクトツリー ——
  'data.sql.treeTitle': '接続とオブジェクト',
  'data.sql.connectionLabel': 'データベース接続',
  'data.sql.selectConnection': '接続を選択してください',
  // 接続ドロップダウン項目の全体書式（全角括弧を含みます）
  'data.sql.connectionOption': '{name}（{type}）',
  'data.sql.treeSelectConnection': '先にデータベース接続を選択してください。その後、その接続のスキーマとテーブルを参照できます。',
  'data.sql.loadingSchemas': 'スキーマを読み込み中…',
  'data.sql.noSchemas': 'スキーマを取得できませんでした。アカウントの権限または接続設定を確認してください。',
  'data.sql.loadingTables': 'テーブルを読み込み中…',
  'data.sql.noTables': 'このスキーマにはテーブルがありません。',
  'data.sql.loadingColumns': '列を読み込み中…',
  'data.sql.noColumns': '列情報を取得できませんでした。',
  'data.sql.insertQuery': 'クエリを挿入',
  'data.sql.loadSchemasFailed': 'スキーマの読み込みに失敗しました：{message}',
  'data.sql.loadTablesFailed': 'テーブルの読み込みに失敗しました：{message}',
  'data.sql.loadColumnsFailed': '列の読み込みに失敗しました：{message}',

  // —— SQL 開発：実行履歴 ——
  'data.sql.historyTitle': '実行履歴',
  'data.sql.refreshHistory': '実行履歴を更新',
  'data.sql.noHistory': '実行履歴はまだありません。',
  'data.sql.slowQuery': 'スロークエリ',
  'data.sql.loadHistoryFailed': '実行履歴の読み込みに失敗しました：{message}',

  // —— SQL 開発：エディターと結果欄 ——
  'data.sql.loadConnectionsFailed': '接続一覧の読み込みに失敗しました：{message}',
  'data.sql.selectConnectionFirst': '先にデータベース接続を選択してください。',
  'data.sql.enterSqlToRun': '実行する SQL 文を入力してください。',
  'data.sql.enterSqlToExplain': '分析する SQL 文を入力してください。',
  'data.sql.executed': '実行完了：{rows} · 影響 {affected} · {duration}{suffix}',
  'data.sql.execFailed': '実行に失敗しました：{message}',
  'data.sql.explainFailed': '実行計画の取得に失敗しました：{message}',
  'data.sql.editorTitle': 'SQL エディター',
  'data.sql.run': '実行',
  'data.sql.explain': '実行計画',
  'data.sql.copySql': 'SQL をコピー',
  'data.sql.clearEditor': 'エディターをクリア',
  'data.sql.showHistory': '実行履歴を表示',
  'data.sql.hideHistory': '実行履歴を隠す',
  'data.sql.readonlyBanner': 'この接続は読み取り専用モードのため、書き込み操作（INSERT / UPDATE / DELETE / DDL）はサーバー側で拒否されます。',
  'data.sql.editorPlaceholder': 'ここに SQL を入力し、Ctrl / Cmd + Enter で実行',
  'data.sql.maxRows': '最大返却行数',
  'data.sql.serverDefault': 'サーバーのデフォルト',
  'data.sql.timeoutMs': 'タイムアウト（ミリ秒）',
  'data.sql.shortcutHint': 'ショートカット：Ctrl / Cmd + Enter でエディター内の SQL を実行',
  'data.sql.tabResult': '結果',
  'data.sql.tabMessage': 'メッセージ',
  'data.sql.returnedRows': '{count} 行を返却',
  'data.sql.affectedRows': '{count} 行に影響',
  'data.sql.elapsed': '所要時間 {duration}',
  'data.sql.successTitle': 'ステートメントの実行に成功しました',
  'data.sql.successNoResult': 'このステートメントは結果セットを返しませんでした。{count} 行に影響しました。',
  'data.sql.emptyResult': '結果セットが空です',
  'data.sql.emptyResultHint': 'ステートメントは正常に実行されましたが、一致するデータがありませんでした。',
  'data.sql.notExecutedTitle': 'SQL はまだ実行されていません',
  'data.sql.notExecutedHint': '接続を選択してステートメントを入力し、Ctrl / Cmd + Enter を押すか「実行」をクリックすると結果を確認できます。',
  'data.sql.noPlanTitle': '実行計画はありません',
  'data.sql.noPlanHint': '「実行計画」ボタンをクリックすると、サーバーがこのステートメントのテキスト実行計画を返します。',
  'data.sql.noMessages': 'このセッションにはエラーメッセージはありません。',
  'data.sql.lastSuccess': '直近で成功した実行：{count} 行、所要時間 {duration}。',

  // —— SQL 開発：エクスポートとコピー ——
  // 結果が切り詰められたときの括弧で囲む書式（本文は common.truncated を再利用）
  'data.sql.truncatedSuffix': '（{text}）',
  'data.sql.noExportData': 'エクスポートできる結果セットがありません。',
  'data.sql.exported': '{format} ファイルをエクスポートしました。',
  'data.sql.emptyEditor': 'エディターに内容がありません。',
  'data.sql.copied': 'SQL をクリップボードにコピーしました。',
  'data.sql.copyFailed': 'ブラウザーがクリップボードへのアクセスを拒否しました。手動でコピーしてください。',

  // —— 結果テーブル ——
  // NULL セルの表示は固定で (NULL)。技術的な表記のため各言語で統一します。
  'data.grid.nullCell': '(NULL)',
  'data.conn.errorExtraParamsValue': '「追加パラメータ」の値は文字列である必要があります: {key}',
};

export default messages;
