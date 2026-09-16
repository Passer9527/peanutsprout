/**
 * 日本語 · アプリシェルとナビゲーション
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— 製品識別 ——
  'app.name': 'PeanutSprout',
  'app.fullName': 'PeanutSprout データベース管理ツール',
  'app.tagline': 'データベース統合管理クライアント',
  'app.copyright': 'AGPL-3.0 · 飞哥',
  'app.documentTitle': 'PeanutSprout · データベース統合管理クライアント',
  'app.documentDescription': 'PeanutSprout - データベース統合管理クライアント Web 管理画面',

  // —— サイドナビゲーション ——
  'nav.ariaLabel': 'メインナビゲーション',
  'nav.toggleSidebar': 'ナビゲーションの折りたたみ/展開',
  'nav.collapseSidebar': 'サイドバーを折りたたむ',
  'nav.expandSidebar': 'サイドバーを展開',
  'nav.collapseText': 'ナビゲーションを折りたたむ',
  'nav.asideDefaultTitle': '補助パネル',
  'nav.expandAside': '右側パネルを展開',
  'nav.collapseAside': '右側パネルを折りたたむ',

  // —— 各機能ページのタイトルと説明（ページタイトルとナビのツールチップ兼用）——
  'nav.connections.label': '接続管理',
  'nav.connections.description': 'データベース接続の管理、接続テスト、読み取り専用ポリシー',
  'nav.sql.label': 'SQL 開発',
  'nav.sql.description': 'オブジェクトツリーの閲覧、SQL の実行、結果のエクスポートと実行履歴',
  'nav.charts.label': 'データ可視化',
  'nav.charts.description': '棒グラフや折れ線グラフなどを作成し、リアルタイムの集計結果を確認',
  'nav.dashboards.label': 'ダッシュボード',
  'nav.dashboards.description': '複数のグラフを 1 画面のダッシュボードにまとめ、共有とグリッドレイアウトに対応',
  'nav.audit.label': '監査ログ',
  'nav.audit.description': '操作の監査追跡とハッシュチェーンの整合性検証',
  'nav.users.label': 'ユーザーと権限',
  'nav.users.description': 'アカウント、ロール、管理者権限の管理',
  'nav.settings.label': '設定',
  'nav.settings.description': 'テーマ外観、サービスアドレス、パスワード変更、このアプリについて',
  'nav.ai.label': 'AI アシスタント',
  'nav.ai.description': '自然言語から SQL 生成、解説と最適化、ドキュメント生成、結果セットへの質問',
  'nav.table.label': 'テーブルデータ',
  'nav.table.description': 'テーブルを選び、表計算のようにレコードを追加・変更・削除',
  'nav.designer.label': 'スキーマ設計',
  'nav.designer.description': 'Schema とテーブルを視覚的に設計し、実行前に DDL を確認',

  // —— トップバー ——
  'topbar.switchToLight': 'ライトテーマに切り替え',
  'topbar.switchToDark': 'ダークテーマに切り替え',
  'topbar.language': '言語',
  'topbar.switchLanguage': '表示言語を切り替え',
  'topbar.adminSuffix': ' · 管理者',
  'topbar.logout': 'ログアウト',
  'topbar.logoutConfirm': 'ログアウトしてもよろしいですか？',
  'topbar.logoutConfirmHint': 'ログアウト後はユーザー名とパスワードを再入力する必要があります。',

  // —— アプリシェルのヒント ——
  'app.checkingSession': 'ログイン状態を確認しています…',
  'app.forbiddenTitle': 'アクセス権限がありません',
  'app.forbiddenHint': 'ユーザーと権限の管理は管理者のみが利用できます。',
  'app.asideConnectionTitle': '接続の詳細',
  'app.asideConnectionEmpty': '左側のリストから接続を 1 つ選択してください',
  'app.asideConnectionEmptyHint': '接続の詳細、色マーカー、読み取り専用ポリシーを確認でき、個別に接続テストも行えます。',

  // —— 言語設定 ——
  'language.title': '表示言語',
  'language.description': '切り替えるとすぐに反映され、選択内容は記憶されます。デフォルトは簡体字中国語です。',
  'language.current': '現在の言語',
  'language.changed': '表示言語を{name}に切り替えました',
  'language.persistedNote': 'この設定はこのブラウザーに保存され、サーバーには同期されません。',
  'language.followBrowser': 'ブラウザーに従う',
};

export default messages;
