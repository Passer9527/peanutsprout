/**
 * 繁體中文 · 身分驗證與使用者
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 涵蓋登入頁、全域登入狀態（401 失效 / 啟動驗證）與使用者管理頁的可見文案。
 * 通用按鈕與欄位名稱（取消、重新整理、狀態、操作等）沿用 common.*，
 * 角色顯示名稱沿用 meta.role.*，這裡只保留 auth 專屬的說法。
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— 登入頁 · 品牌區 ——
  // 品牌名稱與標語沿用 nav 命名空間的 app.*，這裡只放登入頁特有的亮點與落款
  'auth.login.highlight.drivers.title': '多資料庫統一接入',
  'auth.login.highlight.drivers.detail': 'MySQL / PostgreSQL / SQLite 等驅動程式統一管理，連線設定集中維護。',
  'auth.login.highlight.sql.title': 'SQL 開發與結果匯出',
  'auth.login.highlight.sql.detail': '物件樹瀏覽、快速執行、結果表格與 CSV / JSON / Markdown 匯出。',
  'auth.login.highlight.audit.title': '稽核與權限',
  'auth.login.highlight.audit.detail': '操作全程留痕、雜湊鏈驗證，帳號與角色細粒度授權。',
  // 作者落款屬於品牌資訊，各語言保持原樣即可（僅將字形轉為繁體）
  'auth.login.footer': '飛哥 · 微信 6731663 · AGPL-3.0',

  // —— 登入頁 · 表單 ——
  'auth.login.title': '登入管理主控台',
  'auth.login.subtitle': '使用花生苗伺服器端帳號登入，登入狀態儲存在本機瀏覽器。',
  'auth.login.usernamePlaceholder': '請輸入使用者名稱',
  'auth.login.passwordPlaceholder': '請輸入密碼',
  'auth.login.showPassword': '顯示密碼',
  'auth.login.hidePassword': '隱藏密碼',
  'auth.login.submit': '登入',
  'auth.login.submitting': '正在登入…',
  'auth.login.hint': '首次部署請使用伺服器端初始化時產生的管理員帳號登入；忘記密碼可在伺服器端執行重設指令碼。',

  // —— 通用欄位名稱（登入頁與使用者管理頁共用）——
  'auth.field.username': '使用者名稱',
  'auth.field.password': '密碼',
  'auth.field.email': '電子郵件',
  'auth.field.roles': '角色',

  // —— 表單驗證 ——
  'auth.validation.usernameRequired': '請輸入使用者名稱。',
  'auth.validation.passwordRequired': '請輸入密碼。',
  'auth.validation.passwordMinLength': '初始密碼長度至少 6 個字元。',
  'auth.validation.passwordResetMinLength': '重設密碼長度至少 6 個字元，留空表示不修改。',

  // —— 登入狀態 ——
  'auth.forcePassword.title': '請先修改初始密碼',
  'auth.forcePassword.subtitle': '目前仍在使用安裝時內建的預設密碼，為保障資料安全，必須先修改後才能使用其他功能。',
  'auth.forcePassword.warning': '在修改密碼之前，伺服端會拒絕除改密之外的所有請求。',
  'auth.forcePassword.submit': '修改並繼續',
  'auth.forcePassword.submitting': '正在修改…',
  'auth.session.checkFailed': '登入狀態驗證失敗：{message}',

  // —— 使用者管理頁 · 清單與工具列 ——
  'auth.users.count': '共 {count} 個帳號',
  'auth.users.empty': '暫無使用者',
  'auth.users.emptyHint': '點擊右上角「新增使用者」建立第一個帳號。',
  'auth.users.create': '新增使用者',
  'auth.users.editAction': '編輯使用者',
  'auth.users.deleteAction': '刪除使用者',
  'auth.users.cannotDeleteSelf': '無法刪除目前登入的帳號',
  'auth.users.currentAccount': '目前帳號',
  'auth.users.displayName': '顯示名稱',
  'auth.users.adminColumn': '管理員',
  'auth.users.lastLogin': '最近登入',

  // —— 使用者管理頁 · 表單 ——
  'auth.users.usernamePlaceholder': '登入帳號',
  'auth.users.usernameImmutable': '使用者名稱建立後不可修改',
  'auth.users.initialPassword': '初始密碼',
  'auth.users.resetPassword': '重設密碼',
  'auth.users.passwordMinPlaceholder': '至少 6 個字元',
  'auth.users.passwordKeepPlaceholder': '留空表示不修改',
  'auth.users.displayNamePlaceholder': '用於介面顯示',
  'auth.users.rolesPlaceholder': '多個角色以逗號分隔，例如 dba, developer',
  'auth.users.rolesHint': '角色決定可用的權限集合，具體權限由伺服器端 RBAC 設定決定。',
  'auth.users.grantAdmin': '授予管理員權限',
  'auth.users.grantAdminHint': '管理員可管理使用者、檢視全部連線，並擁有全部權限。',
  'auth.users.createSubmit': '建立使用者',
  'auth.users.editTitle': '編輯使用者：{name}',
  'auth.users.editDescription': '修改顯示名稱、角色或重設密碼。',
  'auth.users.createDescription': '建立後使用者即可使用此帳號登入管理主控台。',
  'auth.users.deleteConfirm': '確定要刪除使用者「{name}」嗎？此操作無法復原，其歷史稽核記錄仍會保留。',

  // —— 使用者管理頁 · 權限受限 ——
  'auth.users.adminOnlyTitle': '僅限管理員存取',
  'auth.users.adminOnlyHint': '目前帳號沒有使用者與權限管理權限，請聯絡管理員在伺服器端授予 isAdmin 或相應角色。',

  // —— 使用者管理頁 · 提示與錯誤（{message} 為已在地化的錯誤說明）——
  'auth.users.loadFailed': '載入使用者清單失敗：{message}',
  'auth.users.createFailed': '建立使用者失敗：{message}',
  'auth.users.updateFailed': '更新使用者失敗：{message}',
  'auth.users.deleteFailed': '刪除使用者失敗：{message}',
  'auth.users.created': '使用者 {name} 已建立。',
  'auth.users.updated': '使用者 {name} 已更新。',
  'auth.users.deleted': '使用者 {name} 已刪除。',
  'auth.validation.emailInvalid': '電子郵件格式不正確',
};

export default messages;
