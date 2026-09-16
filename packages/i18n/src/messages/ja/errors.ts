/**
 * 日本語 · エラーコード文言
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * サーバーの `error.message` は中国語のみです。クライアントは安定した `error.code` で本表から
 * 現在の言語の文言を取るため、**言語を切り替えるとエラー表示も追随します**。
 * サーバーの原文は失われません：エラー詳細の「元のメッセージ」にそのまま表示されるので、
 * 調査の役に立ちます（技術的な詳細は機械翻訳しません）。
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  'error.VALIDATION_FAILED': '送信された内容が不正です',
  'error.AUTH_REQUIRED': '先にログインしてください',
  'error.AUTH_INVALID_CREDENTIALS': 'ユーザー名またはパスワードが正しくありません',
  'error.AUTH_TOKEN_INVALID': 'ログイン情報が無効です。再度ログインしてください',
  'error.AUTH_TOKEN_EXPIRED': 'ログインの有効期限が切れました。再度ログインしてください',
  'error.AUTH_ACCOUNT_DISABLED': 'アカウントが無効になっています。管理者にお問い合わせください',
  'error.AUTH_ACCOUNT_LOCKED': 'ログイン失敗が続いたためアカウントが一時的にロックされました。しばらくしてから再試行してください',
  'error.AUTH_FORBIDDEN': '権限が不足しているため、この操作を実行できません',
  'error.PASSWORD_CHANGE_REQUIRED': '初期パスワードのままです。先にパスワードを変更してください。',
  'error.NOT_FOUND': '要求されたリソースが存在しません',
  'error.CONFLICT': '既存のデータと競合しています',
  'error.READONLY_VIOLATION': '現在の接続は読み取り専用モードのため、書き込み操作を拒否しました',
  'error.CONFIRMATION_REQUIRED': 'この操作は再確認したうえで実行する必要があります',
  'error.DRIVER_NOT_IMPLEMENTED': 'このデータベース種別のドライバーはまだ実装されていません',
  'error.CONNECTION_FAILED': 'データベースへの接続に失敗しました。アドレス、ポート、認証情報を確認してください',
  'error.QUERY_FAILED': 'SQL の実行に失敗しました',
  'error.QUERY_TIMEOUT': 'クエリがタイムアウトしました。クエリを最適化するか対象データを絞ってください',
  'error.QUERY_CANCELLED': 'クエリはキャンセルされました',
  'error.MIGRATION_FAILED': 'マイグレーションの実行に失敗しました',
  'error.AI_DISABLED': 'AI 機能が有効になっていません。先に設定でプロバイダーを構成してください',
  'error.AI_PROVIDER_ERROR': 'AI プロバイダーがエラーを返しました。API キーとクォータを確認してください',
  'error.INTERNAL': 'サーバー内部エラー',

  // エラー詳細セクション
  'error.details': 'エラーの詳細',
  'error.code': 'エラーコード',
  'error.originalMessage': '元のメッセージ（サーバー）',
  'error.retryHint': '修正して再試行するか、エラーコードと元のメッセージを管理者に伝えてください。',
};

export default messages;
