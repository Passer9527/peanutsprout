/**
 * 繁體中文 · 錯誤碼文案
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 伺服器端的 `error.message` 只有中文。用戶端依穩定的 `error.code` 在本表取
 * 目前語言的文案，因此**切換語言後錯誤提示也會跟著改變**。
 * 伺服器端原文不會遺失：它仍然顯示在錯誤詳細資料的「原始資訊」裡，
 * 方便排查（技術細節不做機器翻譯）。
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  'error.VALIDATION_FAILED': '送出的內容不合法',
  'error.AUTH_REQUIRED': '請先登入',
  'error.AUTH_INVALID_CREDENTIALS': '使用者名稱或密碼錯誤',
  'error.AUTH_TOKEN_INVALID': '登入憑證無效，請重新登入',
  'error.AUTH_TOKEN_EXPIRED': '登入已過期，請重新登入',
  'error.AUTH_ACCOUNT_DISABLED': '帳號已被停用，請聯絡管理員',
  'error.AUTH_ACCOUNT_LOCKED': '帳號因多次登入失敗已被暫時鎖定，請稍後再試',
  'error.AUTH_FORBIDDEN': '權限不足，無法執行此操作',
  'error.PASSWORD_CHANGE_REQUIRED': '目前仍在使用初始密碼，請先修改密碼',
  'error.NOT_FOUND': '請求的資源不存在',
  'error.CONFLICT': '與現有資料衝突',
  'error.READONLY_VIOLATION': '目前連線為唯讀模式，已拒絕寫入操作',
  'error.CONFIRMATION_REQUIRED': '此操作需要二次確認後才能執行',
  'error.DRIVER_NOT_IMPLEMENTED': '此資料庫類型的驅動程式尚未實作',
  'error.CONNECTION_FAILED': '連線資料庫失敗，請檢查位址、連接埠與憑證',
  'error.QUERY_FAILED': 'SQL 執行失敗',
  'error.QUERY_TIMEOUT': '查詢逾時，請最佳化語句或縮小資料範圍',
  'error.QUERY_CANCELLED': '查詢已取消',
  'error.MIGRATION_FAILED': '移轉執行失敗',
  'error.AI_DISABLED': 'AI 功能未啟用，請先在設定中完成供應商設定',
  'error.AI_PROVIDER_ERROR': 'AI 供應商傳回錯誤，請檢查金鑰與配額',
  'error.INTERNAL': '伺服器內部錯誤',

  // 錯誤詳細資料區
  'error.details': '錯誤詳細資料',
  'error.code': '錯誤碼',
  'error.originalMessage': '原始資訊（伺服器端）',
  'error.retryHint': '你可以修正後重試，或將錯誤碼與原始資訊提供給管理員。',
};

export default messages;
