/**
 * 한국어 · 오류 코드 문구
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  'error.VALIDATION_FAILED': '제출한 내용이 올바르지 않습니다',
  'error.AUTH_REQUIRED': '먼저 로그인하세요',
  'error.AUTH_INVALID_CREDENTIALS': '사용자 이름 또는 비밀번호가 잘못되었습니다',
  'error.AUTH_TOKEN_INVALID': '로그인 자격 증명이 유효하지 않습니다. 다시 로그인하세요',
  'error.AUTH_TOKEN_EXPIRED': '로그인이 만료되었습니다. 다시 로그인하세요',
  'error.AUTH_ACCOUNT_DISABLED': '계정이 비활성화되었습니다. 관리자에게 문의하세요',
  'error.AUTH_ACCOUNT_LOCKED': '로그인 실패가 여러 번 발생하여 계정이 일시적으로 잠겼습니다. 잠시 후 다시 시도하세요',
  'error.AUTH_FORBIDDEN': '권한이 부족하여 이 작업을 수행할 수 없습니다',
  'error.PASSWORD_CHANGE_REQUIRED': '아직 초기 비밀번호를 사용 중입니다. 먼저 비밀번호를 변경하세요.',
  'error.NOT_FOUND': '요청한 리소스가 존재하지 않습니다',
  'error.CONFLICT': '기존 데이터와 충돌합니다',
  'error.READONLY_VIOLATION': '현재 연결이 읽기 전용 모드이므로 쓰기 작업이 거부되었습니다',
  'error.CONFIRMATION_REQUIRED': '이 작업은 2차 확인을 거쳐야 실행할 수 있습니다',
  'error.DRIVER_NOT_IMPLEMENTED': '이 데이터베이스 유형의 드라이버는 아직 구현되지 않았습니다',
  'error.CONNECTION_FAILED': '데이터베이스 연결에 실패했습니다. 주소, 포트 및 자격 증명을 확인하세요',
  'error.QUERY_FAILED': 'SQL 실행에 실패했습니다',
  'error.QUERY_TIMEOUT': '쿼리 시간이 초과되었습니다. 문을 최적화하거나 데이터 범위를 좁히세요',
  'error.QUERY_CANCELLED': '쿼리가 취소되었습니다',
  'error.MIGRATION_FAILED': '마이그레이션 실행에 실패했습니다',
  'error.AI_DISABLED': 'AI 기능이 활성화되지 않았습니다. 먼저 설정에서 공급자를 구성하세요',
  'error.AI_PROVIDER_ERROR': 'AI 공급자가 오류를 반환했습니다. 키와 할당량을 확인하세요',
  'error.INTERNAL': '서버 내부 오류',

  // 오류 상세 영역
  'error.details': '오류 상세',
  'error.code': '오류 코드',
  'error.originalMessage': '원본 메시지(서버)',
  'error.retryHint': '수정한 후 다시 시도하거나 오류 코드와 원본 메시지를 관리자에게 전달하세요.',
};

export default messages;
