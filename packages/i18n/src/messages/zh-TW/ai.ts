/**
 * 繁體中文 · ai 命名空間（AI 供應商設定 / AI 助手）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 本命名空間是**來源語言的權威鍵集合**：其餘五種語言必須以它為準，
 * 少一個鍵都會被 catalogs.test.ts 報出來。
 *
 * 用詞約定：
 *  · 「供應商」指 OpenAI / Anthropic / Ollama 這類服務方（provider）；
 *  · 「模型」指具體型號（modelName）；
 *  · 「場景」指 nl2sql / explain / 等六種用法（scene）。
 * 通用按鈕（取消、關閉、刪除）沿用 common，不在這裡重複定義。
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— 供應商顯示名稱 ——
  'ai.provider.openai': 'OpenAI',
  'ai.provider.anthropic': 'Anthropic',
  'ai.provider.google': 'Google Gemini',
  'ai.provider.qwen': '通義千問',
  'ai.provider.ernie': '文心一言',
  'ai.provider.zhipu': '智譜 AI',
  'ai.provider.deepseek': 'DeepSeek',
  'ai.provider.ollama': 'Ollama（本機）',
  'ai.provider.openaiCompatible': 'OpenAI 相容服務（vLLM / LM Studio / 自建）',

  // —— 設定頁：AI 卡片 ——
  'ai.settings.title': 'AI 助手',
  'ai.settings.subtitle': '設定大模型供應商。API Key 經 AES-256-GCM 加密後存入本機資料庫，不會以明文落盤。',
  'ai.settings.master.label': '啟用 AI 功能',
  'ai.settings.master.hint': '總開關。關閉時所有 AI 場景直接回傳「AI 功能未啟用」，不會發出任何外部請求。',
  'ai.settings.redaction.label': '敏感資料去識別化',
  'ai.settings.redaction.hint': '將結果集傳送給模型前，自動把行動電話號碼、身分證字號、電子郵件、金融卡號等欄位取代為遮罩。',
  'ai.settings.prodWrite.label': '允許 AI 對正式環境資料庫產生寫入語句',
  'ai.settings.prodWrite.hint': '預設關閉。即使產生，SQL 也必須由你在編輯器中確認後才會執行。',
  'ai.settings.serverWriteNote': '以上開關儲存在伺服器端，對所有使用者生效。',

  // —— 設定清單 ——
  'ai.settings.list.title': '模型設定',
  'ai.settings.list.empty': '還沒有設定任何大模型',
  'ai.settings.list.emptyHint': '點「新增設定」連接雲端 API，或填寫本機模型位址（如 Ollama）離線使用。',
  'ai.settings.list.colName': '名稱',
  'ai.settings.list.colProvider': '供應商',
  'ai.settings.list.colModel': '模型',
  'ai.settings.list.colBaseUrl': '介面位址',
  'ai.settings.list.colStatus': '狀態',
  'ai.settings.badge.default': '預設',
  'ai.settings.badge.enabled': '已啟用',
  'ai.settings.badge.disabled': '已停用',
  'ai.settings.badge.hasKey': '已設定金鑰',
  'ai.settings.badge.noKey': '免金鑰',

  // —— 清單操作 ——
  'ai.settings.action.add': '新增設定',
  'ai.settings.action.edit': '編輯',
  'ai.settings.action.delete': '刪除',
  'ai.settings.action.setDefault': '設為預設',
  'ai.settings.action.test': '測試連線',
  'ai.settings.action.openAssistant': '開啟 AI 助手',

  // —— 表單 ——
  'ai.settings.form.createTitle': '新增模型設定',
  'ai.settings.form.editTitle': '編輯模型設定',
  'ai.settings.field.name': '設定名稱',
  'ai.settings.field.namePlaceholder': '例如：本機 Ollama',
  'ai.settings.field.provider': '供應商',
  'ai.settings.field.model': '模型名稱',
  'ai.settings.field.modelPlaceholder': '例如：qwen2.5-coder:7b',
  'ai.settings.field.modelLoad': '從伺服器端拉取',
  'ai.settings.field.modelLoading': '正在拉取…',
  'ai.settings.field.modelLoaded': '拉取到 {count} 個模型，已填入下拉式選單',
  'ai.settings.field.modelEmpty': '伺服器端沒有回傳任何模型',
  'ai.settings.field.baseUrl': '介面位址（Base URL）',
  'ai.settings.field.baseUrlPlaceholder': '留空則使用該供應商的預設位址',
  'ai.settings.field.apiKey': 'API Key',
  'ai.settings.field.apiKeyPlaceholder': '本機模型通常留空',
  'ai.settings.field.apiKeyKeep': '留空表示不修改已儲存的金鑰',
  'ai.settings.field.apiKeyStored': '已儲存金鑰，如需更換請重新填寫',
  'ai.settings.field.temperature': '溫度（0~2）',
  'ai.settings.field.maxTokens': '最大輸出 token',
  'ai.settings.field.maxTokensHint': '留空表示由伺服器端決定',
  'ai.settings.field.timeout': '逾時（毫秒）',
  'ai.settings.field.isDefault': '設為預設模型',
  'ai.settings.field.enabled': '啟用此設定',
  'ai.settings.form.testHint': '建議先「測試連線」，確認位址與金鑰無誤再儲存。',
  'ai.settings.form.save': '儲存設定',

  // —— 測試結果 ——
  'ai.settings.test.testing': '正在測試…',
  'ai.settings.test.ok': '連線正常，耗時 {ms} ms',
  'ai.settings.test.reply': '模型回執：{reply}',
  'ai.settings.test.failed': '連線失敗',

  // —— 刪除確認 ——
  'ai.settings.delete.title': '刪除模型設定',
  'ai.settings.delete.body': '確定刪除「{name}」嗎？此操作不可復原，但不會影響已經產生的呼叫歷史。',

  // —— 提示 ——
  'ai.settings.toast.created': '模型設定已建立',
  'ai.settings.toast.updated': '模型設定已更新',
  'ai.settings.toast.deleted': '模型設定已刪除',
  'ai.settings.toast.defaultSet': '已設為預設模型',
  'ai.settings.toast.settingSaved': '設定已儲存',
  'ai.settings.toast.autosaved': '設定已自動儲存',

  // —— 錯誤 ——
  'ai.settings.err.nameRequired': '請填寫設定名稱',
  'ai.settings.err.modelRequired': '請填寫模型名稱',
  'ai.settings.err.providerRequired': '請選擇供應商',
  'ai.settings.err.loadFailed': '載入 AI 設定失敗：{message}',
  'ai.settings.err.saveFailed': '儲存失敗：{message}',
  'ai.settings.err.deleteFailed': '刪除失敗：{message}',
  'ai.settings.err.testFailed': '測試失敗：{message}',
  'ai.settings.err.modelsFailed': '拉取模型清單失敗：{message}',
  'ai.settings.err.defaultFailed': '設定預設模型失敗：{message}',

  // —— AI 助手頁 ——
  'ai.assistant.title': 'AI 助手',
  'ai.assistant.subtitle': '用自然語言操作資料庫。AI 只負責產生，絕不會替你執行。',
  'ai.assistant.sceneLabel': '技能',
  'ai.assistant.connectionLabel': '目標連線',
  'ai.assistant.connectionPlaceholder': '請選擇連線',
  'ai.assistant.connectionHint': '用於把資料表結構作為上下文提供給模型',
  'ai.assistant.rowsLabel': '結果資料',
  'ai.assistant.rowsPlaceholder': '貼上結果集：第一列為欄名，以定位字元或逗號分隔',
  'ai.assistant.rowsHint': '送出前會依去識別化規則自動處理敏感欄位',
  'ai.assistant.inputPlaceholder': '例如：查最近 7 天訂單金額前 10 的使用者',
  'ai.assistant.sendHint': 'Ctrl / ⌘ + Enter 送出',
  'ai.assistant.inputLabel': '你的問題',
  'ai.assistant.sqlLabel': '要處理的 SQL',
  'ai.assistant.sqlPlaceholder': '貼上一段 SQL，AI 會解釋或給出最佳化建議',
  'ai.assistant.errorLabel': '錯誤訊息',
  'ai.assistant.errorPlaceholder': '貼上資料庫回傳的錯誤訊息',
  'ai.assistant.send': '傳送',
  'ai.assistant.sending': '產生中…',
  'ai.assistant.clear': '清空對話',
  'ai.assistant.emptyTitle': '開始和 AI 對話',
  'ai.assistant.emptyHint': '左側選擇技能、填好輸入，點「傳送」即可。',
  'ai.assistant.you': '你',
  'ai.assistant.model': 'AI',
  'ai.assistant.copy': '複製',
  'ai.assistant.copied': '已複製到剪貼簿',
  'ai.assistant.copyFailed': '複製失敗，請手動選取文字',
  'ai.assistant.useInEditor': '複製 SQL',
  'ai.assistant.noExecuteWarning': 'AI 只產生 SQL，不會自動執行。請確認無誤後再點「執行」或「複製」。',
  'ai.assistant.exportNeedTable': '請填寫目標表名',
  'ai.assistant.exportNeedConnection': '請選擇目標連線',
  'ai.assistant.exportToDbDone': '已寫入 {table}，共 {count} 列',
  'ai.assistant.exportRun': '開始匯出',
  'ai.assistant.exportReplaceWarning': '覆蓋會先刪除目標表，表內原有資料會全部遺失，且無法復原。',
  'ai.assistant.exportModeReplace': '覆蓋（先刪表）',
  'ai.assistant.exportModeAppend': '附加到既有表',
  'ai.assistant.exportModeCreate': '新建表（表已存在則報錯）',
  'ai.assistant.exportMode': '寫入方式',
  'ai.assistant.exportTargetTablePlaceholder': '例如 user_summary',
  'ai.assistant.exportTargetTable': '目標表名',
  'ai.assistant.exportTargetConnection': '目標連線',
  'ai.assistant.exportToDb': '匯出到資料庫',
  'ai.assistant.exportTruncated': '結果超過匯出列數上限，只匯出了前面部分',
  'ai.assistant.exportFailed': '匯出失敗：{message}',
  'ai.assistant.exportDone': '已匯出 {name}',
  'ai.assistant.exportExcel': '匯出 Excel',
  'ai.assistant.clearDone': '已清空 {count} 筆呼叫記錄',
  'ai.assistant.rollbackDone': '已回退，刪除了 {count} 筆呼叫記錄',
  'ai.assistant.rollbackHint': '回到這一次操作，之後的對話都會被刪除，輸入內容會還原',
  'ai.assistant.rollbackHere': '回退到這裡',
  'ai.assistant.withdrawFailed': '撤回失敗：{message}',
  'ai.assistant.withdrawDone': '已撤回',
  'ai.assistant.withdrawHint': '撤回這一則（使用者訊息會連同它的回覆一起撤回）',
  'ai.assistant.withdraw': '撤回',
  'ai.assistant.noConnection': '沒有可用的連線，請先在上方選擇一個目標連線',
  'ai.assistant.executeTruncated': '結果已截斷',
  'ai.assistant.executeRows': '回傳 {count} 列',
  'ai.assistant.executeAffected': '影響 {count} 列',
  'ai.assistant.executeFailed': '執行失敗：{message}',
  'ai.assistant.executeConfirmYes': '確認執行',
  'ai.assistant.executeConfirm': '這是寫入操作，執行後會修改資料，確定要繼續嗎？',
  'ai.assistant.copySql': '複製 SQL',
  'ai.assistant.executing': '執行中…',
  'ai.assistant.execute': '執行',
  // —— 各技能名稱與說明 ——
  'ai.scene.nl2sql': '自然語言轉 SQL',
  'ai.scene.nl2sqlHint': '用中文描述需求，產生可執行的 SELECT 語句',
  'ai.scene.explain': '解釋 SQL',
  'ai.scene.explainHint': '逐段說明一段 SQL 在做什麼',
  'ai.scene.optimize': '最佳化 SQL',
  'ai.scene.optimizeHint': '給出索引、改寫等效能建議',
  'ai.scene.document': '產生文件',
  'ai.scene.documentHint': '根據資料表結構產生欄位說明文件',
  'ai.scene.ask': '結果集問答',
  'ai.scene.askHint': '就目前結果資料提問，出網前自動去識別化',
  'ai.scene.diagnose': '錯誤診斷',
  'ai.scene.diagnoseHint': '分析錯誤原因並給出修復建議',

  // —— 產生結果顯示 ——
  'ai.result.generatedSql': '產生的 SQL',
  'ai.result.explanation': '說明',
  'ai.result.confidence': '信心度',
  'ai.result.tables': '涉及資料表',
  'ai.result.suggestions': '最佳化建議',
  'ai.result.cause': '可能原因',
  'ai.result.severity.critical': '嚴重',
  'ai.result.severity.warning': '警告',
  'ai.result.severity.info': '提示',
  'ai.result.tokens': '輸入 {input} / 輸出 {output} token',

  // —— 不可用狀態 ——
  'ai.disabled.title': 'AI 功能未啟用',
  'ai.disabled.hint': '請到「設定 → AI 助手」開啟總開關後再使用。',
  'ai.disabled.action': '前往設定',
  'ai.notConfigured.title': '還沒有可用的模型',
  'ai.notConfigured.hint': '請到「設定 → AI 助手」新增一個大模型設定，本機模型（Ollama）也可以。',
  'ai.notConfigured.action': '前往設定',

  // —— 呼叫歷史 ——
  'ai.history.title': '最近呼叫',
  'ai.history.empty': '暫無呼叫記錄',
  'ai.history.failed': '失敗',
  'ai.history.success': '成功',
};

export default messages;
