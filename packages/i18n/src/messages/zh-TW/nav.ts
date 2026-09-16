/**
 * 繁體中文 · 應用程式外框與導覽
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— 產品標識 ——
  'app.name': '花生苗',
  'app.fullName': '花生苗資料庫管理工具',
  'app.tagline': '資料庫統一管理用戶端',
  'app.copyright': 'AGPL-3.0 · 飛哥',
  'app.documentTitle': '花生苗 · 資料庫統一管理用戶端',
  'app.documentDescription': '花生苗 - 資料庫統一管理用戶端 Web 管理介面',

  // —— 側邊導覽 ——
  'nav.ariaLabel': '主導覽',
  'nav.toggleSidebar': '收合/展開導覽',
  'nav.collapseSidebar': '收合側邊欄',
  'nav.expandSidebar': '展開側邊欄',
  'nav.collapseText': '收合導覽',
  'nav.asideDefaultTitle': '輔助面板',
  'nav.expandAside': '展開右側面板',
  'nav.collapseAside': '收合右側面板',

  // —— 各功能頁標題與說明（同時用於頁面標題與導覽懸浮說明）——
  'nav.connections.label': '連線管理',
  'nav.connections.description': '維護資料庫連線、測試連通性與唯讀策略',
  'nav.sql.label': 'SQL 開發',
  'nav.sql.description': '物件樹瀏覽、SQL 執行、結果匯出與執行歷史',
  'nav.charts.label': '資料視覺化',
  'nav.charts.description': '建立長條圖、折線圖等圖表並檢視即時取數結果',
  'nav.dashboards.label': '看板',
  'nav.dashboards.description': '將多張圖表組合成一螢幕看板，支援共享與網格版面',
  'nav.audit.label': '稽核日誌',
  'nav.audit.description': '操作稽核追溯與雜湊鏈完整性驗證',
  'nav.users.label': '使用者與權限',
  'nav.users.description': '帳號、角色與管理員權限管理',
  'nav.settings.label': '設定',
  'nav.settings.description': '佈景主題外觀、服務位址、修改密碼與關於',
  'nav.ai.label': 'AI 助手',
  'nav.ai.description': '自然語言轉 SQL、解釋與優化、產生文件、結果集問答',
  'nav.table.label': '資料表資料',
  'nav.table.description': '選取一張表，像操作試算表一樣增刪改查記錄',
  'nav.designer.label': '建庫建表',
  'nav.designer.description': '視覺化設計 Schema 與資料表結構，執行前可預覽 DDL',

  // —— 頂欄 ——
  'topbar.switchToLight': '切換為淺色佈景主題',
  'topbar.switchToDark': '切換為深色佈景主題',
  'topbar.language': '語言',
  'topbar.switchLanguage': '切換介面語言',
  'topbar.adminSuffix': ' · 管理員',
  'topbar.logout': '登出',
  'topbar.logoutConfirm': '確定要登出嗎？',
  'topbar.logoutConfirmHint': '登出後需要重新輸入帳號密碼。',

  // —— 應用程式外框提示 ——
  'app.checkingSession': '正在驗證登入狀態…',
  'app.forbiddenTitle': '無權存取',
  'app.forbiddenHint': '使用者與權限管理僅開放給管理員。',
  'app.asideConnectionTitle': '連線詳細資料',
  'app.asideConnectionEmpty': '在左側清單中選擇一個連線',
  'app.asideConnectionEmptyHint': '可檢視連線詳細資料、顏色標記與唯讀策略，並單獨測試連通性。',

  // —— 語言設定 ——
  'language.title': '介面語言',
  'language.description': '切換後立即生效，並記住你的選擇。預設簡體中文。',
  'language.current': '目前語言',
  'language.changed': '介面語言已切換為{name}',
  'language.persistedNote': '此偏好設定儲存在本機瀏覽器中，不會同步到伺服器。',
  'language.followBrowser': '跟隨瀏覽器',
};

export default messages;
