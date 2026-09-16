/**
 * 日本語 · サーバー側列挙の表示名
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * サーバーはレスポンスに中国語の `label` を含めます。クライアントは**サーバーの label をそのまま表示せず**、
 * 安定した `code`/`type` で本表から現在の言語の表示名を取ります ——
 * そうしないと言語を切り替えてもデータベース種別や権限項目が中国語のままになり、画面が混在します。
 * 表に対応する code がない場合のみ、サーバーが返した label にフォールバックします（カスタムロールなど）。
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— データベース種別 ——
  'dbCategory.relational': 'リレーショナル',
  'dbCategory.keyvalue': 'キー・バリュー型',
  'dbCategory.document': 'ドキュメント型',
  'dbCategory.columnar': 'カラム型',
  'dbCategory.timeseries': '時系列',
  'dbCategory.graph': 'グラフデータベース',

  // —— ドライバーの実装状況 ——
  'driver.implemented': '実装済み',
  'driver.notImplemented': '未実装',
  'driver.notImplementedHint': 'この種別のドライバーはまだ実装されておらず、接続時に DRIVER_NOT_IMPLEMENTED を明示的に返します',
  'driver.list': '対応データベース種別',

  // —— グラフ種別（AC-03 が名指しした横棒グラフ/折れ線グラフ/平行座標グラフを含む）——
  'chartType.bar': '横棒グラフ',
  'chartType.column': '縦棒グラフ',
  'chartType.line': '折れ線グラフ',
  'chartType.area': '面グラフ',
  'chartType.pie': '円グラフ',
  'chartType.donut': 'ドーナツグラフ',
  'chartType.scatter': '散布図',
  'chartType.bubble': 'バブルチャート',
  'chartType.parallel': '平行座標グラフ',
  'chartType.heatmap': 'ヒートマップ',
  'chartType.radar': 'レーダーチャート',
  'chartType.sankey': 'サンキー図',
  'chartType.treemap': 'ツリーマップ',
  'chartType.boxplot': '箱ひげ図',
  'chartType.map': '地図',

  'chartTypeDesc.bar': '分類値を横方向に比較',
  'chartTypeDesc.column': '分類値を縦方向に比較',
  'chartTypeDesc.line': 'トレンドの変化',
  'chartTypeDesc.area': '累積トレンド',
  'chartTypeDesc.pie': '構成比',
  'chartTypeDesc.donut': '構成比（中央が空洞）',
  'chartTypeDesc.scatter': '2 変数の相関',
  'chartTypeDesc.bubble': '3 変数の関係',
  'chartTypeDesc.parallel': '多次元特徴の比較',
  'chartTypeDesc.heatmap': '2 次元の密度分布',
  'chartTypeDesc.radar': '多指標の総合比較',
  'chartTypeDesc.sankey': '流向と流量の配分',
  'chartTypeDesc.treemap': '階層ごとの構成比',
  'chartTypeDesc.boxplot': '分布と外れ値',
  'chartTypeDesc.map': '地理的分布',

  // —— 権限項目 ——
  'permission.conn.read': '接続の閲覧',
  'permission.conn.write': '接続の管理',
  'permission.query.read': 'クエリの実行',
  'permission.query.write': '書き込み操作の実行',
  'permission.migrate.read': 'マイグレーションの閲覧',
  'permission.migrate.write': 'マイグレーションの実行',
  'permission.ai.use': 'AI の利用',
  'permission.user.manage': 'ユーザー管理',
  'permission.audit.read': '監査の閲覧',
  'permission.settings.manage': 'システム設定',

  // —— 権限カテゴリ ——
  'permissionCategory.connection': '接続',
  'permissionCategory.query': 'クエリ',
  'permissionCategory.migration': 'マイグレーション',
  'permissionCategory.ai': 'AI',
  'permissionCategory.user': 'ユーザー',
  'permissionCategory.audit': '監査',
  'permissionCategory.settings': '設定',

  // —— 監査アクション ——
  'auditAction.login': 'ログイン',
  'auditAction.logout': 'ログアウト',
  'auditAction.login_failed': 'ログイン失敗',
  'auditAction.connect': '接続の確立',
  'auditAction.disconnect': '接続の切断',
  'auditAction.execute': 'SQL の実行',
  'auditAction.migrate': 'マイグレーションの実行',
  'auditAction.import': 'データのインポート',
  'auditAction.export': 'データのエクスポート',
  'auditAction.ai': 'AI の呼び出し',
  'auditAction.user_create': 'ユーザーの作成',
  'auditAction.user_update': 'ユーザーの変更',
  'auditAction.user_delete': 'ユーザーの削除',
  'auditAction.connection_create': '接続の作成',
  'auditAction.connection_update': '接続の変更',
  'auditAction.connection_delete': '接続の削除',
  'auditAction.settings_update': '設定の変更',
  'auditAction.audit_verify': '監査チェーンの検証',

  // —— 監査結果 ——
  'auditResult.success': '成功',
  'auditResult.failure': '失敗',
  'auditResult.denied': '拒否',

  // —— ロール ——
  'role.admin': '管理者',
  'role.developer': '開発者',
  'role.analyst': 'アナリスト',
  'role.auditor': '監査担当者',
  'role.viewer': '読み取り専用ユーザー',
  'role.custom': 'カスタムロール',

  // —— 接続のヘルス状態 ——
  'connStatus.ok': '正常',
  'connStatus.failed': '接続失敗',
  'connStatus.untested': '未テスト',
  'connStatus.testing': 'テスト中',
  'connStatus.readonly': '読み取り専用',

  // —— AI プロバイダー種別 ——
  'aiProvider.openai-compatible': 'OpenAI 互換',
  'aiProvider.anthropic': 'Anthropic',
  'aiProvider.gemini': 'Google Gemini',
  'aiProvider.azure-openai': 'Azure OpenAI',
  'aiProvider.deepseek': 'DeepSeek',
  'aiProvider.qwen': 'Qwen',
  'aiProvider.zhipu': 'Zhipu AI',
  'aiProvider.moonshot': 'Moonshot AI',
  'aiProvider.ollama': 'Ollama（ローカル）',

  // —— マイグレーションの競合ポリシー ——
  'conflictStrategy.skip': '既存をスキップ',
  'conflictStrategy.overwrite': '上書き',
  'conflictStrategy.fail': '競合時に停止',
  'conflictStrategy.append': '追加',
};

export default messages;
