/**
 * 日本語 · ai 名前空間（AI プロバイダー設定 / AI アシスタント）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 本名前空間は**源言語の権威あるキー集合**です：他の 5 言語はこれを基準とし、
 * キーが 1 つでも欠けると catalogs.test.ts が検出します。
 *
 * 用語の取り決め：
 *  · 「プロバイダー」は OpenAI / Anthropic / Ollama などのサービス提供者（provider）を指します；
 *  · 「モデル」は具体的な型番（modelName）を指します；
 *  · 「スキル」は nl2sql / explain などの 6 種類の用途（scene）を指します。
 * 共通ボタン（キャンセル、閉じる、削除）は common を再利用し、ここでは重複定義しません。
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— プロバイダー表示名 ——
  'ai.provider.openai': 'OpenAI',
  'ai.provider.anthropic': 'Anthropic',
  'ai.provider.google': 'Google Gemini',
  'ai.provider.qwen': 'Qwen',
  'ai.provider.ernie': 'ERNIE',
  'ai.provider.zhipu': 'Zhipu AI',
  'ai.provider.deepseek': 'DeepSeek',
  'ai.provider.ollama': 'Ollama（ローカル）',
  'ai.provider.openaiCompatible': 'OpenAI 互換サービス（vLLM / LM Studio / 自前構築）',

  // —— 設定ページ：AI カード ——
  'ai.settings.title': 'AI アシスタント',
  'ai.settings.subtitle': '大規模モデルのプロバイダーを設定します。API キーは AES-256-GCM で暗号化してローカル DB に保存され、平文でディスクに書き込まれることはありません。',
  'ai.settings.master.label': 'AI 機能を有効化',
  'ai.settings.master.hint': '全体スイッチ。オフにするとすべての AI スキルが「AI 機能が有効になっていません」を返し、外部リクエストは一切送信されません。',
  'ai.settings.redaction.label': '機密データのマスキング',
  'ai.settings.redaction.hint': '結果セットをモデルに送信する前に、電話番号・ID 番号・メールアドレス・銀行カード番号などの列を自動でマスクに置き換えます。',
  'ai.settings.prodWrite.label': 'AI による本番 DB への書き込み文の生成を許可',
  'ai.settings.prodWrite.hint': 'デフォルトはオフ。生成された場合でも、SQL はエディターで確認した後にのみ実行されます。',
  'ai.settings.serverWriteNote': '上記のスイッチはサーバー側に保存され、すべてのユーザーに適用されます。',

  // —— 設定一覧 ——
  'ai.settings.list.title': 'モデル設定',
  'ai.settings.list.empty': '大規模モデルがまだ 1 つも設定されていません',
  'ai.settings.list.emptyHint': '「設定を追加」からクラウド API に接続するか、ローカルモデルのアドレス（Ollama など）を入力してオフラインで利用できます。',
  'ai.settings.list.colName': '名前',
  'ai.settings.list.colProvider': 'プロバイダー',
  'ai.settings.list.colModel': 'モデル',
  'ai.settings.list.colBaseUrl': 'API エンドポイント',
  'ai.settings.list.colStatus': 'ステータス',
  'ai.settings.badge.default': 'デフォルト',
  'ai.settings.badge.enabled': '有効',
  'ai.settings.badge.disabled': '無効',
  'ai.settings.badge.hasKey': 'キー設定済み',
  'ai.settings.badge.noKey': 'キー不要',

  // —— 一覧の操作 ——
  'ai.settings.action.add': '設定を追加',
  'ai.settings.action.edit': '編集',
  'ai.settings.action.delete': '削除',
  'ai.settings.action.setDefault': 'デフォルトに設定',
  'ai.settings.action.test': '接続テスト',
  'ai.settings.action.openAssistant': 'AI アシスタントを開く',

  // —— フォーム ——
  'ai.settings.form.createTitle': 'モデル設定を追加',
  'ai.settings.form.editTitle': 'モデル設定を編集',
  'ai.settings.field.name': '設定名',
  'ai.settings.field.namePlaceholder': '例：ローカル Ollama',
  'ai.settings.field.provider': 'プロバイダー',
  'ai.settings.field.model': 'モデル名',
  'ai.settings.field.modelPlaceholder': '例：qwen2.5-coder:7b',
  'ai.settings.field.modelLoad': 'サーバーから取得',
  'ai.settings.field.modelLoading': '取得中…',
  'ai.settings.field.modelLoaded': '{count} 個のモデルを取得し、ドロップダウンに反映しました',
  'ai.settings.field.modelEmpty': 'サーバーがモデルを返しませんでした',
  'ai.settings.field.baseUrl': 'API エンドポイント（Base URL）',
  'ai.settings.field.baseUrlPlaceholder': '空欄の場合はこのプロバイダーのデフォルトアドレスを使用します',
  'ai.settings.field.apiKey': 'API キー',
  'ai.settings.field.apiKeyPlaceholder': 'ローカルモデルでは通常空欄にします',
  'ai.settings.field.apiKeyKeep': '空欄のままにすると保存済みのキーは変更されません',
  'ai.settings.field.apiKeyStored': 'キーは保存済みです。変更する場合は再入力してください',
  'ai.settings.field.temperature': '温度（0〜2）',
  'ai.settings.field.maxTokens': '最大出力トークン数',
  'ai.settings.field.maxTokensHint': '空欄の場合はサーバー側で決定されます',
  'ai.settings.field.timeout': 'タイムアウト（ミリ秒）',
  'ai.settings.field.isDefault': 'デフォルトモデルに設定',
  'ai.settings.field.enabled': 'この設定を有効化',
  'ai.settings.form.testHint': '保存する前に「接続テスト」でアドレスとキーに誤りがないことを確認することをおすすめします。',
  'ai.settings.form.save': '設定を保存',

  // —— テスト結果 ——
  'ai.settings.test.testing': 'テスト中…',
  'ai.settings.test.ok': '接続は正常です（所要時間 {ms} ms）',
  'ai.settings.test.reply': 'モデルの応答：{reply}',
  'ai.settings.test.failed': '接続に失敗しました',

  // —— 削除の確認 ——
  'ai.settings.delete.title': 'モデル設定の削除',
  'ai.settings.delete.body': '「{name}」を削除してもよろしいですか？この操作は元に戻せませんが、すでに発生した呼び出し履歴には影響しません。',

  // —— トースト通知 ——
  'ai.settings.toast.created': 'モデル設定を作成しました',
  'ai.settings.toast.updated': 'モデル設定を更新しました',
  'ai.settings.toast.deleted': 'モデル設定を削除しました',
  'ai.settings.toast.defaultSet': 'デフォルトモデルに設定しました',
  'ai.settings.toast.settingSaved': '設定を保存しました',
  'ai.settings.toast.autosaved': '設定は自動保存されました',

  // —— エラー ——
  'ai.settings.err.nameRequired': '設定名を入力してください',
  'ai.settings.err.modelRequired': 'モデル名を入力してください',
  'ai.settings.err.providerRequired': 'プロバイダーを選択してください',
  'ai.settings.err.loadFailed': 'AI 設定の読み込みに失敗しました：{message}',
  'ai.settings.err.saveFailed': '保存に失敗しました：{message}',
  'ai.settings.err.deleteFailed': '削除に失敗しました：{message}',
  'ai.settings.err.testFailed': 'テストに失敗しました：{message}',
  'ai.settings.err.modelsFailed': 'モデル一覧の取得に失敗しました：{message}',
  'ai.settings.err.defaultFailed': 'デフォルトモデルの設定に失敗しました：{message}',

  // —— AI アシスタント画面 ——
  'ai.assistant.title': 'AI アシスタント',
  'ai.assistant.subtitle': '自然言語でデータベースを操作します。AI は生成のみを担当し、実行を代行することはありません。',
  'ai.assistant.sceneLabel': 'スキル',
  'ai.assistant.connectionLabel': '対象の接続',
  'ai.assistant.connectionPlaceholder': '接続を選択してください',
  'ai.assistant.connectionHint': 'テーブル構造をコンテキストとしてモデルに渡すために使用します',
  'ai.assistant.rowsLabel': '結果データ',
  'ai.assistant.rowsPlaceholder': '結果セットを貼り付け：1 行目が列名、タブまたはカンマ区切り',
  'ai.assistant.rowsHint': '送信前に機密列は自動でマスキングされます',
  'ai.assistant.inputPlaceholder': '例：直近 7 日の注文金額が多いユーザー上位 10 件',
  'ai.assistant.sendHint': 'Ctrl / ⌘ + Enter で送信',
  'ai.assistant.inputLabel': '質問',
  'ai.assistant.sqlLabel': '処理する SQL',
  'ai.assistant.sqlPlaceholder': 'SQL を貼り付けると、AI が解説または最適化案を提示します',
  'ai.assistant.errorLabel': 'エラー情報',
  'ai.assistant.errorPlaceholder': 'データベースが返したエラーを貼り付けてください',
  'ai.assistant.send': '送信',
  'ai.assistant.sending': '生成中…',
  'ai.assistant.clear': '会話をクリア',
  'ai.assistant.emptyTitle': 'AI との会話を始める',
  'ai.assistant.emptyHint': '左側でスキルを選び、入力して「送信」をクリックするだけです。',
  'ai.assistant.you': 'あなた',
  'ai.assistant.model': 'AI',
  'ai.assistant.copy': 'コピー',
  'ai.assistant.copied': 'クリップボードにコピーしました',
  'ai.assistant.copyFailed': 'コピーに失敗しました。テキストを手動で選択してください',
  'ai.assistant.useInEditor': 'SQL をコピー',
  'ai.assistant.noExecuteWarning': 'AI は SQL を生成するだけで、自動実行はしません。内容を確認して「実行」か「コピー」を選んでください。',
  'ai.assistant.exportNeedTable': '対象テーブル名を入力してください',
  'ai.assistant.exportNeedConnection': '対象接続を選択してください',
  'ai.assistant.exportToDbDone': '{table} に {count} 行を書き込みました',
  'ai.assistant.exportRun': 'エクスポート開始',
  'ai.assistant.exportReplaceWarning': '上書きは対象テーブルを先に削除します。既存データはすべて失われ、元に戻せません。',
  'ai.assistant.exportModeReplace': '上書き（先に削除）',
  'ai.assistant.exportModeAppend': '既存テーブルに追加',
  'ai.assistant.exportModeCreate': '新規作成（既存ならエラー）',
  'ai.assistant.exportMode': '書き込み方法',
  'ai.assistant.exportTargetTablePlaceholder': '例：user_summary',
  'ai.assistant.exportTargetTable': '対象テーブル名',
  'ai.assistant.exportTargetConnection': '対象接続',
  'ai.assistant.exportToDb': 'データベースにエクスポート',
  'ai.assistant.exportTruncated': '結果が行数上限を超えたため、先頭部分のみエクスポートしました',
  'ai.assistant.exportFailed': 'エクスポートに失敗しました：{message}',
  'ai.assistant.exportDone': '{name} をエクスポートしました',
  'ai.assistant.exportExcel': 'Excel にエクスポート',
  'ai.assistant.clearDone': '呼び出し記録を {count} 件消去しました',
  'ai.assistant.rollbackDone': '戻しました。呼び出し記録を {count} 件削除しました',
  'ai.assistant.rollbackHint': 'この操作まで戻ります。以降の会話は削除され、入力内容は復元されます',
  'ai.assistant.rollbackHere': 'ここまで戻す',
  'ai.assistant.withdrawFailed': '取り消しに失敗しました：{message}',
  'ai.assistant.withdrawDone': '取り消しました',
  'ai.assistant.withdrawHint': 'このメッセージを取り消します（ユーザーの発言はその返信ごと取り消します）',
  'ai.assistant.withdraw': '取り消す',
  'ai.assistant.noConnection': '利用できる接続がありません。上で対象接続を選んでください。',
  'ai.assistant.executeTruncated': '結果は切り詰められました',
  'ai.assistant.executeRows': '{count} 行を返しました',
  'ai.assistant.executeAffected': '{count} 行に影響',
  'ai.assistant.executeFailed': '実行に失敗しました：{message}',
  'ai.assistant.executeConfirmYes': '実行する',
  'ai.assistant.executeConfirm': 'これは書き込み操作です。実行するとデータが変更されます。続行しますか？',
  'ai.assistant.copySql': 'SQL をコピー',
  'ai.assistant.executing': '実行中…',
  'ai.assistant.execute': '実行',
  // —— 各スキルの名称と説明 ——
  'ai.scene.nl2sql': '自然言語から SQL へ',
  'ai.scene.nl2sqlHint': '自然言語で要件を説明すると、実行可能な SELECT 文を生成します',
  'ai.scene.explain': 'SQL を解説',
  'ai.scene.explainHint': 'SQL が何をしているかを段落ごとに説明します',
  'ai.scene.optimize': 'SQL を最適化',
  'ai.scene.optimizeHint': 'インデックスや書き換えなどのパフォーマンス改善案を提示します',
  'ai.scene.document': 'ドキュメントを生成',
  'ai.scene.documentHint': 'テーブル構造からフィールド説明ドキュメントを生成します',
  'ai.scene.ask': '結果セットへの質問',
  'ai.scene.askHint': '現在の結果データについて質問できます。送信前に自動でマスキングされます',
  'ai.scene.diagnose': 'エラー診断',
  'ai.scene.diagnoseHint': 'エラーの原因を分析し、修正案を提示します',

  // —— 生成結果の表示 ——
  'ai.result.generatedSql': '生成された SQL',
  'ai.result.explanation': '説明',
  'ai.result.confidence': '信頼度',
  'ai.result.tables': '関連テーブル',
  'ai.result.suggestions': '最適化の提案',
  'ai.result.cause': '考えられる原因',
  'ai.result.severity.critical': '重大',
  'ai.result.severity.warning': '警告',
  'ai.result.severity.info': '情報',
  'ai.result.tokens': '入力 {input} / 出力 {output} トークン',

  // —— 利用不可の状態 ——
  'ai.disabled.title': 'AI 機能が有効になっていません',
  'ai.disabled.hint': '「設定 → AI アシスタント」で全体スイッチをオンにしてから使用してください。',
  'ai.disabled.action': '設定へ移動',
  'ai.notConfigured.title': '利用可能なモデルがありません',
  'ai.notConfigured.hint': '「設定 → AI アシスタント」で大規模モデルの設定を追加してください。ローカルモデル（Ollama）も利用できます。',
  'ai.notConfigured.action': '設定へ移動',

  // —— 呼び出し履歴 ——
  'ai.history.title': '最近の呼び出し',
  'ai.history.empty': '呼び出し履歴はありません',
  'ai.history.failed': '失敗',
  'ai.history.success': '成功',
};

export default messages;
