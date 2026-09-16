/**
 * 日本語 · 管理（監査ログ / 設定）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 監査アクション / 監査結果 / 権限 / ロールの表示名は meta 名前空間に集約し、ここには
 * 監査ログと設定ページ**固有の言い回し**だけを置きます：フィルターツールバー、テーブルヘッダー、
 * 空状態、ページング、詳細ダイアログ、外観テーマ、サービスと API、パスワード変更、このアプリについて、
 * 言語カードなど。
 * 共通ボタン（リセット）、ステータス（ステータス）、プレースホルダー（—）、不明などは common / nav を再利用します。
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— 監査ログ：フィルターツールバー ——
  'admin.audit.action': '操作',
  'admin.audit.actionPlaceholder': '例：login / query.execute',
  'admin.audit.filterUserId': 'ユーザー ID',
  'admin.audit.pageSize': '1 ページあたり',
  'admin.audit.pageSizeOption': '{count} 件',
  'admin.audit.query': '検索',
  'admin.audit.verifyChain': 'ハッシュチェーンを検証',

  // —— 監査ログ：テーブル列 ——
  'admin.audit.column.time': '時刻',
  'admin.audit.column.user': 'ユーザー',
  'admin.audit.column.resource': 'リソース',
  'admin.audit.column.connection': '接続',
  'admin.audit.column.sqlDetail': 'SQL / 詳細',
  'admin.audit.column.ip': '送信元 IP',
  'admin.audit.column.hash': 'ハッシュ',
  'admin.audit.anonymous': '匿名',
  'admin.audit.viewDetail': '詳細を表示',
  'admin.audit.noHash': 'ハッシュなし',
  'admin.audit.noExtraInfo': '追加情報なし',

  // —— 監査ログ：操作フィードバック（{message} はローカライズ済みのエラー原文、{position} は断絶位置）——
  'admin.audit.loadFailed': '監査ログの読み込みに失敗しました：{message}',
  'admin.audit.verifyOk': 'ハッシュチェーンの検証に成功しました。{count} 件のログを検証しました。',
  'admin.audit.verifyFailed': 'ハッシュチェーンの検証に失敗しました：{message}',
  'admin.audit.verifyBroken': 'ハッシュチェーンの検証に失敗しました。最初の断絶位置：{position}',
  'admin.audit.bannerOk': 'ハッシュチェーンの検証に成功しました：{count} 件のログを検証し、改ざんは見つかりませんでした。',
  'admin.audit.bannerBroken': 'ハッシュチェーンの検証に失敗しました：{count} 件のログを検証し、最初の断絶位置は {position} です。',

  // —— 監査ログ：空状態とページング ——
  'admin.audit.empty': '条件に一致する監査ログがありません',
  'admin.audit.emptyHint': 'フィルター条件を変更して再試行するか、サーバー側で監査機能が有効になっているか確認してください。',
  'admin.audit.pager': '全 {total} 件 · {page} / {totalPages} ページ',
  'admin.audit.prevPage': '前のページ',
  'admin.audit.nextPage': '次のページ',

  // —— 監査ログ：詳細ダイアログ ——
  'admin.audit.detailTitle': '監査の詳細',
  'admin.audit.errorMessage': 'エラーメッセージ',
  'admin.audit.currentHash': '現在のハッシュ',

  // —— 設定：外観テーマ ——
  'admin.settings.appearance.title': '外観テーマ',
  'admin.settings.appearance.subtitle': 'テーマの設定はこのブラウザーに保存され、切り替えるとすぐに反映されます。',
  'admin.settings.theme.light': 'ライト',
  'admin.settings.theme.lightHint': '明るい環境でのデフォルトの外観',
  'admin.settings.theme.dark': 'ダーク',
  'admin.settings.theme.darkHint': '暗い環境で目にやさしい表示',

  // —— 設定：サービスと API ——
  'admin.settings.service.title': 'サービスと API',
  'admin.settings.service.subtitle': 'Web クライアントは {base} 経由で PeanutSprout サーバーの REST API にアクセスします。',
  'admin.settings.service.apiBase': 'API ベース URL',
  'admin.settings.service.pageOrigin': '現在のページ URL',
  'admin.settings.service.authMethod': '認証方式',
  'admin.settings.service.status': 'サービス状態',
  'admin.settings.service.checking': '確認中…',
  'admin.settings.service.statusLine': '{status} · v{version} · 稼働 {uptime}',
  'admin.settings.service.unavailable': 'サービス状態を取得できません',
  'admin.settings.service.recheck': '再確認',
  'admin.settings.service.ok': 'サービスは正常です：バージョン {version}',

  // —— 設定：パスワードの変更 ——
  'admin.settings.password.title': 'パスワードの変更',
  'admin.settings.password.currentAccount': '現在のアカウント：',
  'admin.settings.password.current': '現在のパスワード',
  'admin.settings.password.new': '新しいパスワード',
  'admin.settings.password.confirm': '新しいパスワード（確認）',
  'admin.settings.password.newHint': '6 文字以上',
  'admin.settings.password.submit': 'パスワードを更新',
  'admin.settings.password.errCurrentRequired': '現在のパスワードを入力してください。',
  'admin.settings.password.errTooShort': '新しいパスワードは 6 文字以上にしてください。',
  'admin.settings.password.errSameAsCurrent': '新しいパスワードは現在のパスワードと同じにできません。',
  'admin.settings.password.errMismatch': '入力した新しいパスワードが一致しません。',
  'admin.settings.password.success': 'パスワードを更新しました。次回のログインから新しいパスワードを使用してください。',

  // —— 設定：このアプリについて ——
  'admin.settings.about.title': 'PeanutSprout について',
  'admin.settings.about.subtitle': 'クロスプラットフォームのデータベース統合管理クライアント',
  'admin.settings.about.productName': '製品名',
  'admin.settings.about.productValue': 'PeanutSprout（ピーナッツスプラウト）',
  'admin.settings.about.versionValue': '0.1.0',
  'admin.settings.about.author': '作者',
  'admin.settings.about.authorValue': '飞哥 · 微信 6731663',
  'admin.settings.about.license': 'オープンソースライセンス',
  'admin.settings.about.licenseValue': 'AGPL-3.0-or-later',
  'admin.settings.about.stack': 'Web 技術スタック',
  'admin.settings.about.stackValue': 'React 19 · TypeScript 5.9 · Vite 7（サードパーティ製の UI / 状態管理 / ルーティング / グラフライブラリなし）',

  // —— 設定：LAN アクセス（Web ページ）——
  'admin.webAccess.title': 'LAN アクセス（Web ページ）',
  'admin.webAccess.subtitle':
    '有効にすると、同じ LAN 上の他の端末からブラウザで本ツールにアクセスできます。無効の場合は 127.0.0.1 のみを待ち受け、本機からのみ利用できます。',
  'admin.webAccess.toggle.label': 'LAN アクセスを許可',
  'admin.webAccess.toggle.hint': 'オフのときは 127.0.0.1 のみにバインドし、他の端末から接続できません。',
  'admin.webAccess.port.label': 'アクセスポート',
  'admin.webAccess.port.hint':
    '範囲は 1024–65535。有効にするとポートが固定されるため、共有した URL が使われ続けます。',
  'admin.webAccess.port.err': 'ポートは 1024〜65535 の整数で指定してください。',
  'admin.webAccess.save': '設定を保存',
  'admin.webAccess.saving': '保存中…',
  'admin.webAccess.current.title': '現在有効な設定',
  'admin.webAccess.current.on': 'LAN に公開中 · {host}:{port}',
  'admin.webAccess.current.off': '本機のみ · {host}:{port}',
  'admin.webAccess.restart.title': '再起動後に有効になります',
  'admin.webAccess.restart.body':
    '待ち受けアドレスとポートは起動時に確定します。設定は保存済みです。新しいアドレスを有効にするには花生苗を再起動してください。',
  'admin.webAccess.url.title': '利用可能なアクセス先',
  'admin.webAccess.url.empty': 'LAN アドレスが検出できません。ネットワーク接続を確認してください。',
  'admin.webAccess.copy': 'コピー',
  'admin.webAccess.copied': 'アドレスをクリップボードにコピーしました。',
  'admin.webAccess.embedded':
    'デスクトップ版のウィンドウは常に 127.0.0.1 経由でアクセスするため、このスイッチの影響を受けません。ここで制御するのは「LAN 上の他の端末からのアクセスを許可するか」です。',
  'admin.webAccess.warn.lan_exposed':
    'LAN アクセスが開放されています。同じネットワーク上の誰でもログイン画面を開けます。パスワードが十分に強いことを確認し、信頼できるネットワークでのみ有効にしてください。',
  'admin.webAccess.warn.no_https':
    '現在は HTTP の平文通信です。ログインパスワードやクエリ結果が LAN 上で盗聴される可能性があるため、信頼できるイントラネットでのみ使用してください。',
  'admin.webAccess.warn.default_password':
    '初期パスワードのままのアカウントがあります。LAN アクセスを開放する前に、これらのパスワードを変更してください。',
  'admin.webAccess.err.load': 'LAN 設定の読み込みに失敗しました：{message}',
  'admin.webAccess.err.save': 'LAN 設定の保存に失敗しました：{message}',
  'admin.webAccess.err.copy': 'コピーに失敗しました。アドレスを選択して手動でコピーしてください。',

  // —— 通知（toast）——
  'admin.toast.close': '通知を閉じる',
};

export default messages;
