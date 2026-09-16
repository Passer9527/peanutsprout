/**
 * 한국어 · 감사 로그와 설정
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 감사 동작 / 감사 결과 / 권한 / 역할의 표시 이름은 meta 네임스페이스에 두고,
 * 여기에는 감사 로그와 설정 페이지에 고유한 표현만 담습니다: 필터 도구 모음, 표 머리글,
 * 빈 상태, 페이지 이동, 상세 창, 테마 모양, 서비스와 인터페이스, 비밀번호 변경, 정보,
 * 언어 카드 등. 공통 버튼(초기화), 상태(상태), 자리 표시(—), 알 수 없음 등은 common / nav 를 재사용합니다.
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— 감사 로그: 필터 도구 모음 ——
  'admin.audit.action': '동작',
  'admin.audit.actionPlaceholder': '예: login / query.execute',
  'admin.audit.filterUserId': '사용자 ID',
  'admin.audit.pageSize': '페이지당',
  'admin.audit.pageSizeOption': '{count}개',
  'admin.audit.query': '조회',
  'admin.audit.verifyChain': '해시 체인 검증',

  // —— 감사 로그: 표 열 ——
  'admin.audit.column.time': '시간',
  'admin.audit.column.user': '사용자',
  'admin.audit.column.resource': '리소스',
  'admin.audit.column.connection': '연결',
  'admin.audit.column.sqlDetail': 'SQL / 상세',
  'admin.audit.column.ip': '출처 IP',
  'admin.audit.column.hash': '해시',
  'admin.audit.anonymous': '익명',
  'admin.audit.viewDetail': '상세 보기',
  'admin.audit.noHash': '해시 없음',
  'admin.audit.noExtraInfo': '추가 정보 없음',

  // —— 감사 로그: 작업 피드백({message}는 지역화된 오류 원문, {position}은 단절 위치) ——
  'admin.audit.loadFailed': '감사 로그를 불러오지 못했습니다: {message}',
  'admin.audit.verifyOk': '해시 체인 검증을 통과했습니다. 로그 {count}건을 검증했습니다.',
  'admin.audit.verifyFailed': '해시 체인 검증에 실패했습니다: {message}',
  'admin.audit.verifyBroken': '해시 체인 검증에 실패했습니다. 첫 번째 단절 위치: {position}',
  'admin.audit.bannerOk': '해시 체인 검증 통과: 로그 {count}건을 검증했으며 변조가 발견되지 않았습니다.',
  'admin.audit.bannerBroken': '해시 체인 검증 실패: 로그 {count}건을 검증했으며 첫 번째 단절 위치는 {position}입니다.',

  // —— 감사 로그: 빈 상태와 페이지 이동 ——
  'admin.audit.empty': '조건에 맞는 감사 로그가 없습니다',
  'admin.audit.emptyHint': '필터 조건을 조정한 후 다시 시도하거나, 서버의 감사 기능이 활성화되어 있는지 확인하세요.',
  'admin.audit.pager': '총 {total}건 · {page} / {totalPages} 페이지',
  'admin.audit.prevPage': '이전 페이지',
  'admin.audit.nextPage': '다음 페이지',

  // —— 감사 로그: 상세 창 ——
  'admin.audit.detailTitle': '감사 상세',
  'admin.audit.errorMessage': '오류 메시지',
  'admin.audit.currentHash': '현재 해시',

  // —— 설정: 테마 모양 ——
  'admin.settings.appearance.title': '테마 모양',
  'admin.settings.appearance.subtitle': '테마 설정은 이 브라우저에 저장되며 전환하면 즉시 적용됩니다.',
  'admin.settings.theme.light': '밝은 테마',
  'admin.settings.theme.lightHint': '밝은 환경에서의 기본 모양',
  'admin.settings.theme.dark': '어두운 테마',
  'admin.settings.theme.darkHint': '어두운 환경에서 눈이 더 편안합니다',

  // —— 설정: 서비스와 인터페이스 ——
  'admin.settings.service.title': '서비스와 인터페이스',
  'admin.settings.service.subtitle': 'Web은 {base}를 통해 PeanutSprout 서버의 REST 인터페이스에 접근합니다.',
  'admin.settings.service.apiBase': 'API 기본 주소',
  'admin.settings.service.pageOrigin': '현재 페이지 주소',
  'admin.settings.service.authMethod': '인증 방식',
  'admin.settings.service.status': '서비스 상태',
  'admin.settings.service.checking': '확인 중…',
  'admin.settings.service.statusLine': '{status} · v{version} · 실행 {uptime}',
  'admin.settings.service.unavailable': '서비스 상태를 가져올 수 없습니다',
  'admin.settings.service.recheck': '다시 확인',
  'admin.settings.service.ok': '서비스 정상: 버전 {version}',

  // —— 설정: 비밀번호 변경 ——
  'admin.settings.password.title': '비밀번호 변경',
  'admin.settings.password.currentAccount': '현재 계정:',
  'admin.settings.password.current': '현재 비밀번호',
  'admin.settings.password.new': '새 비밀번호',
  'admin.settings.password.confirm': '새 비밀번호 확인',
  'admin.settings.password.newHint': '6자 이상',
  'admin.settings.password.submit': '비밀번호 변경',
  'admin.settings.password.errCurrentRequired': '현재 비밀번호를 입력하세요.',
  'admin.settings.password.errTooShort': '새 비밀번호는 6자 이상이어야 합니다.',
  'admin.settings.password.errSameAsCurrent': '새 비밀번호는 현재 비밀번호와 같을 수 없습니다.',
  'admin.settings.password.errMismatch': '입력한 새 비밀번호가 서로 일치하지 않습니다.',
  'admin.settings.password.success': '비밀번호가 변경되었습니다. 다음 로그인부터 새 비밀번호를 사용하세요.',

  // —— 설정: 정보 ——
  'admin.settings.about.title': 'PeanutSprout 정보',
  'admin.settings.about.subtitle': '크로스 플랫폼 데이터베이스 통합 관리 클라이언트',
  'admin.settings.about.productName': '제품 이름',
  'admin.settings.about.productValue': 'PeanutSprout(피넛스프라우트)',
  'admin.settings.about.versionValue': '0.1.0',
  'admin.settings.about.author': '제작자',
  'admin.settings.about.authorValue': '飞哥 · 微信 6731663',
  'admin.settings.about.license': '오픈 소스 라이선스',
  'admin.settings.about.licenseValue': 'AGPL-3.0-or-later',
  'admin.settings.about.stack': 'Web 기술 스택',
  'admin.settings.about.stackValue': 'React 19 · TypeScript 5.9 · Vite 7(서드파티 UI / 상태 / 라우팅 / 차트 라이브러리 미사용)',

  // —— 알림 표시줄(toast) ——
  'admin.toast.close': '알림 닫기',
};

export default messages;
