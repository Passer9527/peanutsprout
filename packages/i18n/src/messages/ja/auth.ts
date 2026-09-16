/**
 * 日本語 · 認証とユーザー
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * ログイン画面、グローバルなログイン状態（401 失効 / 起動時の検証）、ユーザー管理画面の文言です。
 * 共通ボタンやフィールド名（キャンセル、更新、ステータス、操作など）は common.* を、
 * ロールの表示名は meta.role.* を再利用し、ここには auth 固有の言い回しだけを置きます。
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— ログイン画面 · ブランド欄 ——
  // 製品名とタグラインは nav 名前空間の app.* を再利用し、ここにはログイン画面固有の紹介と署名だけを置きます
  'auth.login.highlight.drivers.title': '多様なデータベースへの統合接続',
  'auth.login.highlight.drivers.detail': 'MySQL / PostgreSQL / SQLite などのドライバーをまとめて管理し、接続設定を一元化します。',
  'auth.login.highlight.sql.title': 'SQL 開発と結果のエクスポート',
  'auth.login.highlight.sql.detail': 'オブジェクトツリーの閲覧、すばやい実行、結果テーブルと CSV / JSON / Markdown へのエクスポート。',
  'auth.login.highlight.audit.title': '監査と権限',
  'auth.login.highlight.audit.detail': 'すべての操作を記録し、ハッシュチェーンで検証。アカウントとロールをきめ細かく認可します。',
  // 作者の署名はブランド情報のため、各言語でそのまま表記します
  'auth.login.footer': '飞哥 · 微信 6731663 · AGPL-3.0',

  // —— ログイン画面 · フォーム ——
  'auth.login.title': '管理コンソールにログイン',
  'auth.login.subtitle': 'PeanutSprout サーバーのアカウントでログインします。ログイン状態はこのブラウザーに保存されます。',
  'auth.login.usernamePlaceholder': 'ユーザー名を入力',
  'auth.login.passwordPlaceholder': 'パスワードを入力',
  'auth.login.showPassword': 'パスワードを表示',
  'auth.login.hidePassword': 'パスワードを隠す',
  'auth.login.submit': 'ログイン',
  'auth.login.submitting': 'ログインしています…',
  'auth.login.hint': '初回導入時は、サーバーの初期化で生成された管理者アカウントでログインしてください。パスワードを忘れた場合は、サーバー側でリセットスクリプトを実行できます。',

  // —— 共通フィールド名（ログイン画面とユーザー管理画面で共用）——
  'auth.field.username': 'ユーザー名',
  'auth.field.password': 'パスワード',
  'auth.field.email': 'メールアドレス',
  'auth.field.roles': 'ロール',

  // —— フォーム検証 ——
  'auth.validation.usernameRequired': 'ユーザー名を入力してください。',
  'auth.validation.passwordRequired': 'パスワードを入力してください。',
  'auth.validation.passwordMinLength': '初期パスワードは 6 文字以上にしてください。',
  'auth.validation.passwordResetMinLength': 'リセット後のパスワードは 6 文字以上にしてください。空欄のままにすると変更しません。',

  // —— ログイン状態 ——
  'auth.forcePassword.title': '初期パスワードを変更してください',
  'auth.forcePassword.subtitle': 'インストール時に作成された既定のパスワードのままです。データ保護のため、変更するまで他の機能は利用できません。',
  'auth.forcePassword.warning': 'パスワードを変更するまで、サーバーは変更とログアウト以外のすべてのリクエストを拒否します。',
  'auth.forcePassword.submit': '変更して続行',
  'auth.forcePassword.submitting': '変更中…',
  'auth.session.checkFailed': 'ログイン状態の確認に失敗しました：{message}',

  // —— ユーザー管理画面 · 一覧とツールバー ——
  // 件数は count パラメーターで渡します。日本語は複数形の変化がないため基本形のみです
  'auth.users.count': '{count} 件のアカウント',
  'auth.users.empty': 'ユーザーがいません',
  'auth.users.emptyHint': '右上の「ユーザーを作成」から最初のアカウントを作成してください。',
  'auth.users.create': 'ユーザーを作成',
  'auth.users.editAction': 'ユーザーを編集',
  'auth.users.deleteAction': 'ユーザーを削除',
  'auth.users.cannotDeleteSelf': 'ログイン中のアカウントは削除できません',
  'auth.users.currentAccount': '現在のアカウント',
  'auth.users.displayName': '表示名',
  'auth.users.adminColumn': '管理者',
  'auth.users.lastLogin': '最終ログイン',

  // —— ユーザー管理画面 · フォーム ——
  'auth.users.usernamePlaceholder': 'ログインアカウント',
  'auth.users.usernameImmutable': 'ユーザー名は作成後に変更できません',
  'auth.users.initialPassword': '初期パスワード',
  'auth.users.resetPassword': 'パスワードをリセット',
  'auth.users.passwordMinPlaceholder': '6 文字以上',
  'auth.users.passwordKeepPlaceholder': '空欄のままにすると変更しません',
  'auth.users.displayNamePlaceholder': '画面表示に使用する名前',
  'auth.users.rolesPlaceholder': '複数のロールはカンマ区切り（例：dba, developer）',
  'auth.users.rolesHint': 'ロールは利用できる権限の集合を決めます。具体的な権限はサーバー側の RBAC 設定によります。',
  'auth.users.grantAdmin': '管理者権限を付与',
  'auth.users.grantAdminHint': '管理者はユーザーの管理とすべての接続の閲覧ができ、すべての権限を持ちます。',
  'auth.users.createSubmit': 'ユーザーを作成',
  'auth.users.editTitle': 'ユーザーを編集：{name}',
  'auth.users.editDescription': '表示名やロールを変更したり、パスワードをリセットできます。',
  'auth.users.createDescription': '作成すると、このアカウントで管理コンソールにログインできるようになります。',
  'auth.users.deleteConfirm': 'ユーザー「{name}」を削除してもよろしいですか？この操作は元に戻せませんが、過去の監査ログは保持されます。',

  // —— ユーザー管理画面 · 権限不足 ——
  'auth.users.adminOnlyTitle': '管理者のみアクセスできます',
  'auth.users.adminOnlyHint': '現在のアカウントにはユーザーと権限の管理権限がありません。サーバー側で isAdmin または該当するロールを付与するよう管理者にご依頼ください。',

  // —— ユーザー管理画面 · 通知とエラー（{message} はローカライズ済みのエラー説明）——
  'auth.users.loadFailed': 'ユーザー一覧の読み込みに失敗しました：{message}',
  'auth.users.createFailed': 'ユーザーの作成に失敗しました：{message}',
  'auth.users.updateFailed': 'ユーザーの更新に失敗しました：{message}',
  'auth.users.deleteFailed': 'ユーザーの削除に失敗しました：{message}',
  'auth.users.created': 'ユーザー {name} を作成しました。',
  'auth.users.updated': 'ユーザー {name} を更新しました。',
  'auth.users.deleted': 'ユーザー {name} を削除しました。',
  'auth.validation.emailInvalid': 'メールアドレスの形式が正しくありません',
};

export default messages;
