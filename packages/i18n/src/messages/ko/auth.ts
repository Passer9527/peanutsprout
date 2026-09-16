/**
 * 한국어 · 인증 및 사용자
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 로그인 페이지, 전역 로그인 상태(401 만료 / 시작 시 검증)와 사용자 관리 페이지의
 * 화면 문구를 담습니다. 공통 버튼과 필드 이름(취소, 새로 고침, 상태, 작업 등)은
 * common.*, 역할 표시 이름은 meta.role.* 을 재사용하고 여기에는 auth 전용 표현만 둡니다.
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— 로그인 페이지 · 브랜드 영역 ——
  // 브랜드 이름과 슬로건은 nav 네임스페이스의 app.* 을 재사용하고, 여기에는 로그인 페이지 전용 강조 문구와 서명만 둡니다
  'auth.login.highlight.drivers.title': '다중 데이터베이스 통합 연결',
  'auth.login.highlight.drivers.detail': 'MySQL / PostgreSQL / SQLite 등 드라이버를 통합 관리하고 연결 설정을 한곳에서 유지합니다.',
  'auth.login.highlight.sql.title': 'SQL 개발 및 결과 내보내기',
  'auth.login.highlight.sql.detail': '객체 트리 탐색, 빠른 실행, 결과 표와 CSV / JSON / Markdown 내보내기를 지원합니다.',
  'auth.login.highlight.audit.title': '감사 및 권한',
  'auth.login.highlight.audit.detail': '모든 작업을 기록하고 해시 체인으로 검증하며, 계정과 역할에 권한을 세분화하여 부여합니다.',
  // 작성자 서명은 브랜드 정보이므로 모든 언어에서 그대로 유지합니다
  'auth.login.footer': '飞哥 · 微信 6731663 · AGPL-3.0',

  // —— 로그인 페이지 · 양식 ——
  'auth.login.title': '관리 콘솔 로그인',
  'auth.login.subtitle': 'PeanutSprout 서버 계정으로 로그인하며, 로그인 상태는 이 브라우저에 저장됩니다.',
  'auth.login.usernamePlaceholder': '사용자 이름을 입력하세요',
  'auth.login.passwordPlaceholder': '비밀번호를 입력하세요',
  'auth.login.showPassword': '비밀번호 표시',
  'auth.login.hidePassword': '비밀번호 숨기기',
  'auth.login.submit': '로그인',
  'auth.login.submitting': '로그인 중…',
  'auth.login.hint': '최초 배포 시에는 서버 초기화 시 생성된 관리자 계정으로 로그인하세요. 비밀번호를 잊은 경우 서버에서 재설정 스크립트를 실행할 수 있습니다.',

  // —— 공통 필드 이름(로그인 페이지와 사용자 관리 페이지에서 공용) ——
  'auth.field.username': '사용자 이름',
  'auth.field.password': '비밀번호',
  'auth.field.email': '이메일',
  'auth.field.roles': '역할',

  // —— 양식 검증 ——
  'auth.validation.usernameRequired': '사용자 이름을 입력하세요.',
  'auth.validation.passwordRequired': '비밀번호를 입력하세요.',
  'auth.validation.passwordMinLength': '초기 비밀번호는 6자 이상이어야 합니다.',
  'auth.validation.passwordResetMinLength': '재설정 비밀번호는 6자 이상이어야 하며, 비워 두면 변경하지 않습니다.',

  // —— 로그인 상태 ——
  'auth.forcePassword.title': '초기 비밀번호를 먼저 변경하세요',
  'auth.forcePassword.subtitle': '설치 시 만들어진 기본 비밀번호를 그대로 사용 중입니다. 데이터 보호를 위해 변경해야 다른 기능을 사용할 수 있습니다.',
  'auth.forcePassword.warning': '비밀번호를 변경하기 전까지 서버는 변경과 로그아웃 외의 모든 요청을 거부합니다.',
  'auth.forcePassword.submit': '변경하고 계속',
  'auth.forcePassword.submitting': '변경 중…',
  'auth.session.checkFailed': '로그인 상태 확인에 실패했습니다: {message}',

  // —— 사용자 관리 페이지 · 목록과 도구 모음 ——
  // 개수는 count 매개변수로 처리합니다. 한국어는 단일 복수형만 사용하므로 접미사 키를 추가하지 않습니다
  'auth.users.count': '계정 {count}개',
  'auth.users.empty': '사용자가 없습니다',
  'auth.users.emptyHint': '오른쪽 위의 「새 사용자」를 클릭하여 첫 계정을 만드세요.',
  'auth.users.create': '새 사용자',
  'auth.users.editAction': '사용자 편집',
  'auth.users.deleteAction': '사용자 삭제',
  'auth.users.cannotDeleteSelf': '현재 로그인한 계정은 삭제할 수 없습니다',
  'auth.users.currentAccount': '현재 계정',
  'auth.users.displayName': '표시 이름',
  'auth.users.adminColumn': '관리자',
  'auth.users.lastLogin': '최근 로그인',

  // —— 사용자 관리 페이지 · 양식 ——
  'auth.users.usernamePlaceholder': '로그인 계정',
  'auth.users.usernameImmutable': '사용자 이름은 생성 후 변경할 수 없습니다',
  'auth.users.initialPassword': '초기 비밀번호',
  'auth.users.resetPassword': '비밀번호 재설정',
  'auth.users.passwordMinPlaceholder': '6자 이상',
  'auth.users.passwordKeepPlaceholder': '비워 두면 변경하지 않음',
  'auth.users.displayNamePlaceholder': '인터페이스 표시에 사용',
  'auth.users.rolesPlaceholder': '여러 역할은 쉼표로 구분합니다(예: dba, developer)',
  'auth.users.rolesHint': '역할은 사용 가능한 권한 집합을 결정하며, 구체적인 권한은 서버의 RBAC 설정에 따릅니다.',
  'auth.users.grantAdmin': '관리자 권한 부여',
  'auth.users.grantAdminHint': '관리자는 사용자를 관리하고 모든 연결을 조회할 수 있으며 모든 권한을 가집니다.',
  'auth.users.createSubmit': '사용자 만들기',
  'auth.users.editTitle': '사용자 편집: {name}',
  'auth.users.editDescription': '표시 이름이나 역할을 수정하거나 비밀번호를 재설정합니다.',
  'auth.users.createDescription': '생성 후 사용자는 해당 계정으로 관리 콘솔에 로그인할 수 있습니다.',
  'auth.users.deleteConfirm': '사용자 「{name}」을(를) 삭제하시겠습니까? 이 작업은 되돌릴 수 없으며, 기존 감사 기록은 그대로 유지됩니다.',

  // —— 사용자 관리 페이지 · 권한 제한 ——
  'auth.users.adminOnlyTitle': '관리자만 접근할 수 있습니다',
  'auth.users.adminOnlyHint': '현재 계정에는 사용자 및 권한 관리 권한이 없습니다. 서버에서 isAdmin 또는 해당 역할을 부여하도록 관리자에게 요청하세요.',

  // —— 사용자 관리 페이지 · 알림과 오류({message}는 이미 지역화된 오류 설명) ——
  'auth.users.loadFailed': '사용자 목록을 불러오지 못했습니다: {message}',
  'auth.users.createFailed': '사용자 생성에 실패했습니다: {message}',
  'auth.users.updateFailed': '사용자 수정에 실패했습니다: {message}',
  'auth.users.deleteFailed': '사용자 삭제에 실패했습니다: {message}',
  'auth.users.created': '사용자 {name}이(가) 생성되었습니다.',
  'auth.users.updated': '사용자 {name}이(가) 수정되었습니다.',
  'auth.users.deleted': '사용자 {name}이(가) 삭제되었습니다.',
  'auth.validation.emailInvalid': '이메일 형식이 올바르지 않습니다',
};

export default messages;
