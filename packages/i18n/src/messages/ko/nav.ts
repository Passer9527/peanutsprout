/**
 * 한국어 · 앱 셸과 내비게이션
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— 제품 식별 ——
  'app.name': 'PeanutSprout',
  'app.fullName': 'PeanutSprout 데이터베이스 관리 도구',
  'app.tagline': '데이터베이스 통합 관리 클라이언트',
  'app.copyright': 'AGPL-3.0 · 飞哥',
  'app.documentTitle': 'PeanutSprout · 데이터베이스 통합 관리 클라이언트',
  'app.documentDescription': 'PeanutSprout - 데이터베이스 통합 관리 클라이언트 웹 관리 인터페이스',

  // —— 사이드 내비게이션 ——
  'nav.ariaLabel': '주 내비게이션',
  'nav.toggleSidebar': '내비게이션 접기/펼치기',
  'nav.collapseSidebar': '사이드바 접기',
  'nav.expandSidebar': '사이드바 펼치기',
  'nav.collapseText': '내비게이션 접기',
  'nav.asideDefaultTitle': '보조 패널',
  'nav.expandAside': '오른쪽 패널 펼치기',
  'nav.collapseAside': '오른쪽 패널 접기',

  // —— 기능 페이지 제목과 설명(페이지 제목과 내비게이션 툴팁에 함께 사용) ——
  'nav.connections.label': '연결 관리',
  'nav.connections.description': '데이터베이스 연결을 관리하고 연결 상태와 읽기 전용 정책을 테스트합니다',
  'nav.sql.label': 'SQL 개발',
  'nav.sql.description': '객체 트리 탐색, SQL 실행, 결과 내보내기 및 실행 기록',
  'nav.charts.label': '데이터 시각화',
  'nav.charts.description': '가로 막대형 차트, 꺾은선형 차트 등을 만들어 실시간 조회 결과를 확인합니다',
  'nav.dashboards.label': '대시보드',
  'nav.dashboards.description': '여러 차트를 한 화면 대시보드로 구성하며 공유와 그리드 레이아웃을 지원합니다',
  'nav.audit.label': '감사 로그',
  'nav.audit.description': '작업 감사 추적과 해시 체인 무결성 검증',
  'nav.users.label': '사용자 및 권한',
  'nav.users.description': '계정, 역할 및 관리자 권한 관리',
  'nav.settings.label': '설정',
  'nav.settings.description': '테마 모양, 서비스 주소, 비밀번호 변경 및 정보',
  'nav.ai.label': 'AI 어시스턴트',
  'nav.ai.description': '자연어를 SQL로 변환, 설명 및 최적화, 문서 생성, 결과 집합 질의',
  'nav.table.label': '테이블 데이터',
  'nav.table.description': '테이블을 골라 스프레드시트처럼 레코드를 추가·수정·삭제',
  'nav.designer.label': '스키마 설계',
  'nav.designer.description': 'Schema와 테이블을 시각적으로 설계하고 실행 전에 DDL 확인',

  // —— 상단 바 ——
  'topbar.switchToLight': '밝은 테마로 전환',
  'topbar.switchToDark': '어두운 테마로 전환',
  'topbar.language': '언어',
  'topbar.switchLanguage': '인터페이스 언어 전환',
  'topbar.adminSuffix': ' · 관리자',
  'topbar.logout': '로그아웃',
  'topbar.logoutConfirm': '로그아웃하시겠습니까?',
  'topbar.logoutConfirmHint': '로그아웃 후에는 계정과 비밀번호를 다시 입력해야 합니다.',

  // —— 앱 셸 안내 ——
  'app.checkingSession': '로그인 상태를 확인하는 중…',
  'app.forbiddenTitle': '접근 권한 없음',
  'app.forbiddenHint': '사용자 및 권한 관리는 관리자만 사용할 수 있습니다.',
  'app.asideConnectionTitle': '연결 상세',
  'app.asideConnectionEmpty': '왼쪽 목록에서 연결을 선택하세요',
  'app.asideConnectionEmptyHint': '연결 상세, 색상 표시 및 읽기 전용 정책을 확인하고 연결 상태를 개별적으로 테스트할 수 있습니다.',

  // —— 언어 설정 ——
  'language.title': '인터페이스 언어',
  'language.description': '전환하면 즉시 적용되고 선택한 언어가 기억됩니다. 기본값은 중국어 간체입니다.',
  'language.current': '현재 언어',
  'language.changed': '인터페이스 언어가 {name}(으)로 변경되었습니다',
  'language.persistedNote': '이 설정은 이 브라우저에 저장되며 서버에 동기화되지 않습니다.',
  'language.followBrowser': '브라우저 설정 따르기',
};

export default messages;
