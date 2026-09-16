/**
 * 繁體中文 · 伺服器端列舉的顯示名稱
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 伺服器端會在回應中帶上中文 `label`。用戶端**不直接顯示伺服器端的 label**，
 * 而是依穩定的 `code`/`type` 在本表中取目前語言的顯示名稱 ——
 * 否則切換語言後，資料庫類型、權限項目這些仍然是中文，介面會中英混雜。
 * 表中找不到對應 code 時才回退到伺服器端提供的 label（自訂角色等情境）。
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— 資料庫類別 ——
  'dbCategory.relational': '關聯式',
  'dbCategory.keyvalue': '鍵值式',
  'dbCategory.document': '文件式',
  'dbCategory.columnar': '欄式',
  'dbCategory.timeseries': '時序',
  'dbCategory.graph': '圖形資料庫',

  // —— 驅動程式落地狀態 ——
  'driver.implemented': '已實作',
  'driver.notImplemented': '未實作',
  'driver.notImplementedHint': '此類型的驅動程式尚未實作，連線時會明確回應 DRIVER_NOT_IMPLEMENTED',
  'driver.list': '支援的資料庫類型',

  // —— 圖表類型（AC-03 點名的長條圖/折線圖/平行座標圖都在其中）——
  'chartType.bar': '長條圖',
  'chartType.column': '直條圖',
  'chartType.line': '折線圖',
  'chartType.area': '區域圖',
  'chartType.pie': '圓餅圖',
  'chartType.donut': '環圈圖',
  'chartType.scatter': '散佈圖',
  'chartType.bubble': '泡泡圖',
  'chartType.parallel': '平行座標圖',
  'chartType.heatmap': '熱區圖',
  'chartType.radar': '雷達圖',
  'chartType.sankey': '桑基圖',
  'chartType.treemap': '矩形樹狀圖',
  'chartType.boxplot': '盒鬚圖',
  'chartType.map': '地圖',

  'chartTypeDesc.bar': '橫向比較類別值',
  'chartTypeDesc.column': '縱向比較類別值',
  'chartTypeDesc.line': '趨勢變化',
  'chartTypeDesc.area': '累積趨勢',
  'chartTypeDesc.pie': '佔比組成',
  'chartTypeDesc.donut': '佔比組成（中空）',
  'chartTypeDesc.scatter': '兩變數相關性',
  'chartTypeDesc.bubble': '三變數關係',
  'chartTypeDesc.parallel': '多維特徵比較',
  'chartTypeDesc.heatmap': '二維密度分布',
  'chartTypeDesc.radar': '多指標綜合比較',
  'chartTypeDesc.sankey': '流向與流量分配',
  'chartTypeDesc.treemap': '層級佔比',
  'chartTypeDesc.boxplot': '分布與離群值',
  'chartTypeDesc.map': '地理分布',

  // —— 權限項目 ——
  'permission.conn.read': '檢視連線',
  'permission.conn.write': '管理連線',
  'permission.query.read': '執行查詢',
  'permission.query.write': '執行寫入操作',
  'permission.migrate.read': '檢視移轉',
  'permission.migrate.write': '執行移轉',
  'permission.ai.use': '使用 AI',
  'permission.user.manage': '使用者管理',
  'permission.audit.read': '檢視稽核',
  'permission.settings.manage': '系統設定',

  // —— 權限分類 ——
  'permissionCategory.connection': '連線',
  'permissionCategory.query': '查詢',
  'permissionCategory.migration': '移轉',
  'permissionCategory.ai': 'AI',
  'permissionCategory.user': '使用者',
  'permissionCategory.audit': '稽核',
  'permissionCategory.settings': '設定',

  // —— 稽核動作 ——
  'auditAction.login': '登入',
  'auditAction.logout': '登出',
  'auditAction.login_failed': '登入失敗',
  'auditAction.connect': '建立連線',
  'auditAction.disconnect': '中斷連線',
  'auditAction.execute': '執行 SQL',
  'auditAction.migrate': '執行移轉',
  'auditAction.import': '匯入資料',
  'auditAction.export': '匯出資料',
  'auditAction.ai': '呼叫 AI',
  'auditAction.user_create': '建立使用者',
  'auditAction.user_update': '修改使用者',
  'auditAction.user_delete': '刪除使用者',
  'auditAction.connection_create': '建立連線',
  'auditAction.connection_update': '修改連線',
  'auditAction.connection_delete': '刪除連線',
  'auditAction.settings_update': '修改設定',
  'auditAction.audit_verify': '驗證稽核鏈',

  // —— 稽核結果 ——
  'auditResult.success': '成功',
  'auditResult.failure': '失敗',
  'auditResult.denied': '已拒絕',

  // —— 角色 ——
  'role.admin': '管理員',
  'role.developer': '開發人員',
  'role.analyst': '分析師',
  'role.auditor': '稽核員',
  'role.viewer': '唯讀使用者',
  'role.custom': '自訂角色',

  // —— 連線健康狀態 ——
  'connStatus.ok': '正常',
  'connStatus.failed': '連線失敗',
  'connStatus.untested': '未測試',
  'connStatus.testing': '測試中',
  'connStatus.readonly': '唯讀',

  // —— AI 供應商類別 ——
  'aiProvider.openai-compatible': 'OpenAI 相容',
  'aiProvider.anthropic': 'Anthropic',
  'aiProvider.gemini': 'Google Gemini',
  'aiProvider.azure-openai': 'Azure OpenAI',
  'aiProvider.deepseek': 'DeepSeek',
  'aiProvider.qwen': '通義千問',
  'aiProvider.zhipu': '智譜 AI',
  'aiProvider.moonshot': '月之暗面',
  'aiProvider.ollama': 'Ollama（本機）',

  // —— 移轉衝突策略 ——
  'conflictStrategy.skip': '略過已存在',
  'conflictStrategy.overwrite': '覆寫',
  'conflictStrategy.fail': '遇衝突即停止',
  'conflictStrategy.append': '附加',
};

export default messages;
