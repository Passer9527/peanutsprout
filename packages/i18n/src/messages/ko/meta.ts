/**
 * 한국어 · 서버 열거형 표시 이름
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— 데이터베이스 종류 ——
  'dbCategory.relational': '관계형',
  'dbCategory.keyvalue': '키-값형',
  'dbCategory.document': '문서형',
  'dbCategory.columnar': '컬럼형',
  'dbCategory.timeseries': '시계열',
  'dbCategory.graph': '그래프 데이터베이스',

  // —— 드라이버 구현 상태 ——
  'driver.implemented': '구현됨',
  'driver.notImplemented': '미구현',
  'driver.notImplementedHint': '이 유형의 드라이버는 아직 구현되지 않았으며 연결 시 DRIVER_NOT_IMPLEMENTED가 반환됩니다',
  'driver.list': '지원되는 데이터베이스 유형',

  // —— 차트 유형 (AC-03이 지정한 가로 막대형/꺾은선형/평행 좌표 차트 포함) ——
  'chartType.bar': '가로 막대형 차트',
  'chartType.column': '세로 막대형 차트',
  'chartType.line': '꺾은선형 차트',
  'chartType.area': '영역형 차트',
  'chartType.pie': '원형 차트',
  'chartType.donut': '도넛형 차트',
  'chartType.scatter': '산점도',
  'chartType.bubble': '버블 차트',
  'chartType.parallel': '평행 좌표 차트',
  'chartType.heatmap': '히트맵',
  'chartType.radar': '레이더 차트',
  'chartType.sankey': '생키 차트',
  'chartType.treemap': '트리맵',
  'chartType.boxplot': '상자 수염 그림',
  'chartType.map': '지도',

  'chartTypeDesc.bar': '분류값 가로 비교',
  'chartTypeDesc.column': '분류값 세로 비교',
  'chartTypeDesc.line': '추세 변화',
  'chartTypeDesc.area': '누적 추세',
  'chartTypeDesc.pie': '비율 구성',
  'chartTypeDesc.donut': '비율 구성(가운데 비움)',
  'chartTypeDesc.scatter': '두 변수 간 상관관계',
  'chartTypeDesc.bubble': '세 변수 관계',
  'chartTypeDesc.parallel': '다차원 특성 비교',
  'chartTypeDesc.heatmap': '2차원 밀도 분포',
  'chartTypeDesc.radar': '다지표 종합 비교',
  'chartTypeDesc.sankey': '흐름과 유량 배분',
  'chartTypeDesc.treemap': '계층별 비율',
  'chartTypeDesc.boxplot': '분포와 이상값',
  'chartTypeDesc.map': '지리적 분포',

  // —— 권한 항목 ——
  'permission.conn.read': '연결 조회',
  'permission.conn.write': '연결 관리',
  'permission.query.read': '쿼리 실행',
  'permission.query.write': '쓰기 작업 실행',
  'permission.migrate.read': '마이그레이션 조회',
  'permission.migrate.write': '마이그레이션 실행',
  'permission.ai.use': 'AI 사용',
  'permission.user.manage': '사용자 관리',
  'permission.audit.read': '감사 조회',
  'permission.settings.manage': '시스템 설정',

  // —— 권한 분류 ——
  'permissionCategory.connection': '연결',
  'permissionCategory.query': '쿼리',
  'permissionCategory.migration': '마이그레이션',
  'permissionCategory.ai': 'AI',
  'permissionCategory.user': '사용자',
  'permissionCategory.audit': '감사',
  'permissionCategory.settings': '설정',

  // —— 감사 작업 ——
  'auditAction.login': '로그인',
  'auditAction.logout': '로그아웃',
  'auditAction.login_failed': '로그인 실패',
  'auditAction.connect': '연결 수립',
  'auditAction.disconnect': '연결 해제',
  'auditAction.execute': 'SQL 실행',
  'auditAction.migrate': '마이그레이션 실행',
  'auditAction.import': '데이터 가져오기',
  'auditAction.export': '데이터 내보내기',
  'auditAction.ai': 'AI 호출',
  'auditAction.user_create': '사용자 생성',
  'auditAction.user_update': '사용자 수정',
  'auditAction.user_delete': '사용자 삭제',
  'auditAction.connection_create': '연결 생성',
  'auditAction.connection_update': '연결 수정',
  'auditAction.connection_delete': '연결 삭제',
  'auditAction.settings_update': '설정 수정',
  'auditAction.audit_verify': '감사 체인 검증',

  // —— 감사 결과 ——
  'auditResult.success': '성공',
  'auditResult.failure': '실패',
  'auditResult.denied': '거부됨',

  // —— 역할 ——
  'role.admin': '관리자',
  'role.developer': '개발자',
  'role.analyst': '분석가',
  'role.auditor': '감사자',
  'role.viewer': '읽기 전용 사용자',
  'role.custom': '사용자 지정 역할',

  // —— 연결 상태 ——
  'connStatus.ok': '정상',
  'connStatus.failed': '연결 실패',
  'connStatus.untested': '테스트 안 함',
  'connStatus.testing': '테스트 중',
  'connStatus.readonly': '읽기 전용',

  // —— AI 공급자 종류 ——
  'aiProvider.openai-compatible': 'OpenAI 호환',
  'aiProvider.anthropic': 'Anthropic',
  'aiProvider.gemini': 'Google Gemini',
  'aiProvider.azure-openai': 'Azure OpenAI',
  'aiProvider.deepseek': 'DeepSeek',
  'aiProvider.qwen': 'Qwen',
  'aiProvider.zhipu': 'Zhipu AI',
  'aiProvider.moonshot': 'Moonshot AI',
  'aiProvider.ollama': 'Ollama(로컬)',

  // —— 마이그레이션 충돌 정책 ——
  'conflictStrategy.skip': '기존 항목 건너뛰기',
  'conflictStrategy.overwrite': '덮어쓰기',
  'conflictStrategy.fail': '충돌 시 중단',
  'conflictStrategy.append': '추가',
};

export default messages;
