/**
 * 繁體中文 · 稽核與設定
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 稽核動作 / 稽核結果 / 權限 / 角色的顯示名稱統一放在 meta 命名空間，這裡只放
 * 稽核日誌與設定頁面**特有的措辭**：篩選工具列、表頭、空態、分頁、詳細資料彈出
 * 視窗、外觀佈景主題、服務與介面、修改密碼、關於、語言卡片等。
 * 通用按鈕（重設）、狀態（狀態）、佔位（—）、未知等一律沿用 common / nav。
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— 稽核日誌：篩選工具列 ——
  'admin.audit.action': '動作',
  'admin.audit.actionPlaceholder': '例如 login / query.execute',
  'admin.audit.filterUserId': '使用者 ID',
  'admin.audit.pageSize': '每頁',
  'admin.audit.pageSizeOption': '{count} 筆',
  'admin.audit.query': '查詢',
  'admin.audit.verifyChain': '驗證雜湊鏈',

  // —— 稽核日誌：表格欄位 ——
  'admin.audit.column.time': '時間',
  'admin.audit.column.user': '使用者',
  'admin.audit.column.resource': '資源',
  'admin.audit.column.connection': '連線',
  'admin.audit.column.sqlDetail': 'SQL / 詳細資料',
  'admin.audit.column.ip': '來源 IP',
  'admin.audit.column.hash': '雜湊',
  'admin.audit.anonymous': '匿名',
  'admin.audit.viewDetail': '查看詳細資料',
  'admin.audit.noHash': '無雜湊',
  'admin.audit.noExtraInfo': '無附加資訊',

  // —— 稽核日誌：操作回饋（{message} 為在地化後的錯誤原文，{position} 為斷鏈位置）——
  'admin.audit.loadFailed': '載入稽核日誌失敗：{message}',
  'admin.audit.verifyOk': '雜湊鏈驗證通過，共驗證 {count} 筆日誌。',
  'admin.audit.verifyFailed': '雜湊鏈驗證失敗：{message}',
  'admin.audit.verifyBroken': '雜湊鏈驗證失敗，首個斷鏈位置：{position}',
  'admin.audit.bannerOk': '雜湊鏈驗證通過：共驗證 {count} 筆日誌，未發現篡改。',
  'admin.audit.bannerBroken': '雜湊鏈驗證未通過：共驗證 {count} 筆日誌，首個斷鏈位置 {position}。',

  // —— 稽核日誌：空態與分頁 ——
  'admin.audit.empty': '沒有符合條件的稽核日誌',
  'admin.audit.emptyHint': '調整篩選條件後重試，或確認伺服器端稽核功能已啟用。',
  'admin.audit.pager': '共 {total} 筆 · 第 {page} / {totalPages} 頁',
  'admin.audit.prevPage': '上一頁',
  'admin.audit.nextPage': '下一頁',

  // —— 稽核日誌：詳細資料彈出視窗 ——
  'admin.audit.detailTitle': '稽核詳細資料',
  'admin.audit.errorMessage': '錯誤資訊',
  'admin.audit.currentHash': '目前雜湊',

  // —— 設定：外觀佈景主題 ——
  'admin.settings.appearance.title': '外觀佈景主題',
  'admin.settings.appearance.subtitle': '佈景主題偏好儲存在本機瀏覽器，切換後即時生效。',
  'admin.settings.theme.light': '淺色',
  'admin.settings.theme.lightHint': '明亮環境下的預設外觀',
  'admin.settings.theme.dark': '深色',
  'admin.settings.theme.darkHint': '暗光環境更護眼',

  // —— 設定：服務與介面 ——
  'admin.settings.service.title': '服務與介面',
  'admin.settings.service.subtitle': 'Web 端透過 {base} 存取花生苗伺服器端 REST 介面。',
  'admin.settings.service.apiBase': 'API 基底位址',
  'admin.settings.service.pageOrigin': '目前頁面位址',
  'admin.settings.service.authMethod': '驗證方式',
  'admin.settings.service.status': '服務狀態',
  'admin.settings.service.checking': '檢測中…',
  'admin.settings.service.statusLine': '{status} · v{version} · 運作 {uptime}',
  'admin.settings.service.unavailable': '無法取得服務狀態',
  'admin.settings.service.recheck': '重新檢測',
  'admin.settings.service.ok': '服務正常：版本 {version}',

  // —— 設定：修改密碼 ——
  'admin.settings.password.title': '修改密碼',
  'admin.settings.password.currentAccount': '目前帳號：',
  'admin.settings.password.current': '目前密碼',
  'admin.settings.password.new': '新密碼',
  'admin.settings.password.confirm': '確認新密碼',
  'admin.settings.password.newHint': '至少 6 個字元',
  'admin.settings.password.submit': '更新密碼',
  'admin.settings.password.errCurrentRequired': '請輸入目前密碼。',
  'admin.settings.password.errTooShort': '新密碼長度至少 6 個字元。',
  'admin.settings.password.errSameAsCurrent': '新密碼不能與目前密碼相同。',
  'admin.settings.password.errMismatch': '兩次輸入的新密碼不一致。',
  'admin.settings.password.success': '密碼已更新，下次登入請使用新密碼。',

  // —— 設定：關於 ——
  'admin.settings.about.title': '關於花生苗',
  'admin.settings.about.subtitle': '跨平台資料庫統一管理用戶端',
  'admin.settings.about.productName': '產品名稱',
  'admin.settings.about.productValue': '花生苗（PeanutSprout）',
  'admin.settings.about.versionValue': '0.1.0',
  'admin.settings.about.author': '作者',
  'admin.settings.about.authorValue': '飛哥 · 微信 6731663',
  'admin.settings.about.license': '開源授權',
  'admin.settings.about.licenseValue': 'AGPL-3.0-or-later',
  'admin.settings.about.stack': 'Web 技術堆疊',
  'admin.settings.about.stackValue': 'React 19 · TypeScript 5.9 · Vite 7（無第三方 UI / 狀態 / 路由 / 圖表庫）',

  // —— 設定：區域網路存取（Web 頁面）——
  'admin.webAccess.title': '區域網路存取（Web 頁面）',
  'admin.webAccess.subtitle':
    '開啟後，同一區域網路內的其他裝置可以直接用瀏覽器存取本工具；關閉時只監聽 127.0.0.1，僅本機可用。',
  'admin.webAccess.toggle.label': '允許區域網路存取',
  'admin.webAccess.toggle.hint': '關閉時只綁定 127.0.0.1，其他機器無法連線。',
  'admin.webAccess.port.label': '存取連接埠',
  'admin.webAccess.port.hint': '範圍 1024–65535。開啟後連接埠固定不變，分享出去的網址才長期有效。',
  'admin.webAccess.port.err': '連接埠需為 1024–65535 之間的整數。',
  'admin.webAccess.save': '儲存設定',
  'admin.webAccess.saving': '儲存中…',
  'admin.webAccess.current.title': '目前實際生效',
  'admin.webAccess.current.on': '已開放區域網路 · {host}:{port}',
  'admin.webAccess.current.off': '僅本機可存取 · {host}:{port}',
  'admin.webAccess.restart.title': '需要重新啟動後生效',
  'admin.webAccess.restart.body':
    '監聽位址與連接埠只在程式啟動時決定。設定已儲存，重新啟動花生苗後新的位址才會生效。',
  'admin.webAccess.url.title': '可用存取網址',
  'admin.webAccess.url.empty': '未偵測到區域網路位址，請檢查網路連線。',
  'admin.webAccess.copy': '複製',
  'admin.webAccess.copied': '網址已複製到剪貼簿。',
  'admin.webAccess.embedded':
    '桌面端視窗一律透過 127.0.0.1 存取，不受此開關影響；這裡控制的是「是否允許區域網路內其他裝置存取」。',
  'admin.webAccess.warn.lan_exposed':
    '區域網路存取已開放：同一網路內的任何人都能開啟登入頁。請確認帳號密碼足夠強，並只在自己信任的網路裡開啟。',
  'admin.webAccess.warn.no_https':
    '目前使用 HTTP 明文傳輸，登入密碼與查詢結果在區域網路內可能被竊聽，建議僅在可信任的內網使用。',
  'admin.webAccess.warn.default_password':
    '仍有帳號在使用初始密碼。請先修改這些帳號的密碼，再開放區域網路存取。',
  'admin.webAccess.err.load': '讀取區域網路設定失敗：{message}',
  'admin.webAccess.err.save': '儲存區域網路設定失敗：{message}',
  'admin.webAccess.err.copy': '複製失敗，請手動選取網址後複製。',

  // —— 提示條（toast）——
  'admin.toast.close': '關閉提示',
};

export default messages;
