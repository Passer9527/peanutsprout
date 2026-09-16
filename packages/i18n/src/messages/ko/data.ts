/**
 * 한국어 · 연결 관리와 SQL 개발
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 「연결 관리」와 「SQL 개발」 두 모듈에 고유한 표현만 담습니다.
 * 공통 버튼 / 상태 / 표 머리글 / 개수 / 시간 단위는 common.* 을,
 * 데이터베이스 종류와 드라이버 상태 같은 서버 열거형은 meta 네임스페이스를 재사용합니다.
 *
 * 개수 문구는 접미사 없는 키로 한국어의 단일 복수형을 담습니다. 한국어는
 * Intl.PluralRules 상 `other` 하나만 사용하므로 .one / .few / .many 를 추가하지 않습니다.
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— 연결 관리: 양식과 제목 ——
  'data.conn.createTitle': '새 연결',
  'data.conn.createSubmit': '연결 만들기',
  'data.conn.editAction': '연결 편집',
  'data.conn.editTitle': '연결 편집: {name}',
  'data.conn.modalDescription': '연결 정보는 서버에 저장되며, 비밀번호 필드는 암호화되어 저장되고 다시 표시되지 않습니다.',
  'data.conn.fieldName': '연결 이름 *',
  'data.conn.namePlaceholder': '예: 운영 주문 데이터베이스',
  'data.conn.fieldDbType': '데이터베이스 유형 *',
  // 데이터베이스 유형 드롭다운 항목의 전체 형식(한국어는 반각 괄호 사용)
  'data.conn.dbTypeOption': '{label} ({category})',
  'data.conn.fieldHost': '호스트',
  'data.conn.fieldPort': '포트',
  'data.conn.portPlaceholder': '기본 포트',
  'data.conn.fieldDatabase': '데이터베이스 / 스키마',
  'data.conn.fieldUsername': '사용자 이름',
  'data.conn.fieldPassword': '비밀번호',
  'data.conn.passwordPlaceholderEdit': '비워 두면 저장된 비밀번호를 변경하지 않습니다',
  'data.conn.passwordPlaceholderCreate': '선택 사항이며, 저장 후 서버에서 암호화합니다',
  'data.conn.passwordSaved': '이 연결에는 비밀번호가 저장되어 있습니다.',
  'data.conn.passwordNotSaved': '이 연결에는 아직 비밀번호가 저장되지 않았습니다.',
  'data.conn.passwordSavedNoEcho': '저장됨(표시 안 함)',
  'data.conn.notSaved': '저장되지 않음',
  'data.conn.passwordSavedTitle': '비밀번호 저장됨',
  'data.conn.fieldUrl': '연결 문자열(선택 사항)',
  'data.conn.urlPlaceholder': '입력하면 연결 문자열을 우선 사용합니다(예: mysql://user:pass@host:3306/db)',
  'data.conn.fieldExtraParams': '추가 매개변수(JSON, 선택 사항)',
  'data.conn.extraParamsPlaceholder': '예: {"ssl": true, "charset": "utf8mb4"}',
  'data.conn.fieldColorTag': '색상 표시',
  'data.conn.colorNone': '표시 없음',
  'data.conn.colorSwatchAria': '색상 표시 {color}',
  'data.conn.readonlyLabel': '읽기 전용 연결',
  'data.conn.readonlyHint': '활성화하면 서버가 이 연결의 쓰기 작업을 거부합니다.',
  'data.conn.favoriteLabel': '즐겨찾기 추가',
  'data.conn.unfavoriteLabel': '즐겨찾기 해제',
  'data.conn.favoritedTitle': '즐겨찾기됨',
  'data.conn.favoriteBadge': '즐겨찾기',
  'data.conn.favoriteHint': '즐겨찾기한 연결은 목록에서 우선 표시됩니다.',
  'data.conn.createNote': '안내: 연결을 만들고 저장한 뒤에 목록에서 「연결 테스트」를 실행할 수 있습니다.',
  // meta.driver.* 는 「구현됨/미구현」만 제공하므로, 기존 문구를 유지하도록 여기에서 「드라이버」 접두사를 붙입니다.
  'data.conn.driverNotImplemented': '드라이버 {status}',

  // —— 연결 관리: 양식 검증 ——
  'data.conn.errorNameRequired': '연결 이름을 입력하세요.',
  'data.conn.errorDbTypeRequired': '데이터베이스 유형을 선택하세요.',
  'data.conn.errorPortNumeric': '포트는 숫자여야 합니다.',
  'data.conn.errorExtraParamsObject': '추가 매개변수는 JSON 객체여야 합니다(예: {"ssl": true}).',
  'data.conn.errorExtraParamsInvalid': '추가 매개변수가 올바른 JSON이 아닙니다. 형식을 확인하세요.',

  // —— 연결 관리: 목록과 도구 모음 ——
  'data.conn.searchPlaceholder': '이름, 호스트, 데이터베이스 검색',
  'data.conn.allTypes': '전체 유형',
  'data.conn.favoriteOnly': '즐겨찾기만 보기',
  'data.conn.totalConnections': '연결 {count}개',
  'data.conn.colName': '연결 이름',
  'data.conn.colAddress': '주소',
  'data.conn.colLastUsed': '최근 사용',
  'data.conn.colConnectivity': '연결 상태',
  'data.conn.statusFailed': '실패',
  'data.conn.testing': '테스트 중…',
  'data.conn.notTested': '아직 테스트하지 않음',
  'data.conn.testConnection': '연결 테스트',
  'data.conn.empty': '아직 데이터베이스 연결이 없습니다',
  'data.conn.emptyHint': '오른쪽 위의 「새 연결」을 클릭하여 첫 데이터 소스를 추가하세요.',

  // —— 연결 관리: 상세 패널과 삭제 확인 ——
  'data.conn.editThis': '이 연결 편집',
  'data.conn.deleteTitle': '연결 삭제',
  'data.conn.deleteConfirm': '연결 「{name}」을(를) 삭제하시겠습니까? 삭제 후에는 이 연결의 SQL 개발과 기록 참조가 더 이상 유효하지 않습니다.',
  'data.conn.sessionTest': '이번 세션 테스트',
  'data.conn.detailHint': '연결 비밀번호는 서버에서 암호화하여 저장합니다. 비밀번호를 바꾸려면 편집 창에서 새 비밀번호를 입력하고 저장하세요.',

  // —— 연결 관리: 작업 피드백({message}는 이미 지역화된 오류 문구) ——
  'data.conn.loadListFailed': '연결 목록을 불러오지 못했습니다: {message}',
  'data.conn.loadDbTypesFailed': '데이터베이스 유형을 불러오지 못했습니다: {message}',
  'data.conn.created': '연결 「{name}」이(가) 생성되었습니다.',
  'data.conn.createFailed': '연결 생성에 실패했습니다: {message}',
  'data.conn.updated': '연결 「{name}」이(가) 수정되었습니다.',
  'data.conn.updateFailed': '연결 수정에 실패했습니다: {message}',
  'data.conn.testSuccess': '「{name}」 연결 성공: {latency} ms{version}',
  'data.conn.testFailed': '「{name}」 연결 실패: {message}',
  'data.conn.testRequestFailed': '연결 테스트에 실패했습니다: {message}',
  'data.conn.favoriteFailed': '즐겨찾기 상태를 변경하지 못했습니다: {message}',
  'data.conn.deleted': '연결 「{name}」이(가) 삭제되었습니다.',
  'data.conn.deleteFailed': '연결 삭제에 실패했습니다: {message}',
  'data.conn.detailTestSuccess': '연결 성공: {latency} ms{version}',
  'data.conn.detailTestFailed': '연결 실패: {message}',

  // —— 데이터베이스 유형 브랜드 이름(안정적인 code 기준이며, 목록에 없는 사용자 지정 유형은 서버 label로 대체) ——
  'data.dbType.mysql': 'MySQL',
  'data.dbType.mariadb': 'MariaDB',
  'data.dbType.postgresql': 'PostgreSQL',
  'data.dbType.oracle': 'Oracle',
  'data.dbType.sqlserver': 'SQL Server',
  'data.dbType.sqlite': 'SQLite',
  'data.dbType.kingbase': 'KingbaseES',
  'data.dbType.dm': 'DM',
  'data.dbType.oceanbase': 'OceanBase',
  'data.dbType.tidb': 'TiDB',
  'data.dbType.redis': 'Redis',
  'data.dbType.mongodb': 'MongoDB',
  'data.dbType.clickhouse': 'ClickHouse',
  'data.dbType.influxdb': 'InfluxDB',
  'data.dbType.neo4j': 'Neo4j',

  // —— SQL 개발: 객체 트리 ——
  'data.sql.treeTitle': '연결 및 객체',
  'data.sql.connectionLabel': '데이터베이스 연결',
  'data.sql.selectConnection': '연결을 선택하세요',
  // 연결 드롭다운 항목의 전체 형식(한국어는 반각 괄호 사용)
  'data.sql.connectionOption': '{name} ({type})',
  'data.sql.treeSelectConnection': '먼저 데이터베이스 연결을 선택하면 해당 연결의 스키마와 데이터 테이블을 탐색할 수 있습니다.',
  'data.sql.loadingSchemas': '스키마를 불러오는 중…',
  'data.sql.noSchemas': '스키마를 가져오지 못했습니다. 계정 권한 또는 연결 설정을 확인하세요.',
  'data.sql.loadingTables': '데이터 테이블을 불러오는 중…',
  'data.sql.noTables': '이 스키마에 데이터 테이블이 없습니다.',
  'data.sql.loadingColumns': '필드를 불러오는 중…',
  'data.sql.noColumns': '필드 정보를 가져오지 못했습니다.',
  'data.sql.insertQuery': '쿼리 문 삽입',
  'data.sql.loadSchemasFailed': '스키마를 불러오지 못했습니다: {message}',
  'data.sql.loadTablesFailed': '데이터 테이블을 불러오지 못했습니다: {message}',
  'data.sql.loadColumnsFailed': '필드를 불러오지 못했습니다: {message}',

  // —— SQL 개발: 실행 기록 ——
  'data.sql.historyTitle': '실행 기록',
  'data.sql.refreshHistory': '실행 기록 새로 고침',
  'data.sql.noHistory': '실행 기록이 없습니다.',
  'data.sql.slowQuery': '느린 쿼리',
  'data.sql.loadHistoryFailed': '실행 기록을 불러오지 못했습니다: {message}',

  // —— SQL 개발: 편집기와 결과 영역 ——
  'data.sql.loadConnectionsFailed': '연결 목록을 불러오지 못했습니다: {message}',
  'data.sql.selectConnectionFirst': '먼저 데이터베이스 연결을 선택하세요.',
  'data.sql.enterSqlToRun': '실행할 SQL 문을 입력하세요.',
  'data.sql.enterSqlToExplain': '분석할 SQL 문을 입력하세요.',
  'data.sql.executed': '실행 완료: {rows} · 영향 {affected} · {duration}{suffix}',
  'data.sql.execFailed': '실행에 실패했습니다: {message}',
  'data.sql.explainFailed': '실행 계획을 가져오지 못했습니다: {message}',
  'data.sql.editorTitle': 'SQL 편집기',
  'data.sql.run': '실행',
  'data.sql.explain': '실행 계획',
  'data.sql.copySql': 'SQL 복사',
  'data.sql.clearEditor': '편집기 지우기',
  'data.sql.showHistory': '실행 기록 펼치기',
  'data.sql.hideHistory': '실행 기록 접기',
  'data.sql.readonlyBanner': '현재 연결이 읽기 전용 모드이므로 쓰기 작업(INSERT / UPDATE / DELETE / DDL)은 서버에서 거부됩니다.',
  'data.sql.editorPlaceholder': '여기에 SQL을 입력하고 Ctrl / Cmd + Enter로 실행하세요',
  'data.sql.maxRows': '최대 반환 행 수',
  'data.sql.serverDefault': '서버 기본값',
  'data.sql.timeoutMs': '제한 시간(밀리초)',
  'data.sql.shortcutHint': '단축키: Ctrl / Cmd + Enter로 현재 편집기의 SQL을 실행합니다',
  'data.sql.tabResult': '결과',
  'data.sql.tabMessage': '메시지',
  'data.sql.returnedRows': '{count}행 반환',
  'data.sql.affectedRows': '{count}행 영향',
  'data.sql.elapsed': '소요 시간 {duration}',
  'data.sql.successTitle': '문 실행 성공',
  'data.sql.successNoResult': '이 문은 결과 집합을 반환하지 않았으며 {count}행에 영향을 주었습니다.',
  'data.sql.emptyResult': '결과 집합이 비어 있습니다',
  'data.sql.emptyResultHint': '문이 성공적으로 실행되었지만 일치하는 데이터가 없습니다.',
  'data.sql.notExecutedTitle': '아직 SQL을 실행하지 않음',
  'data.sql.notExecutedHint': '연결을 선택하고 문을 입력한 뒤 Ctrl / Cmd + Enter를 누르거나 「실행」을 클릭하여 결과를 확인하세요.',
  'data.sql.noPlanTitle': '실행 계획 없음',
  'data.sql.noPlanHint': '「실행 계획」 버튼을 클릭하면 서버가 해당 문의 텍스트 실행 계획을 반환합니다.',
  'data.sql.noMessages': '이번 세션에는 오류 메시지가 없습니다.',
  'data.sql.lastSuccess': '최근 성공 실행: {count}행, 소요 시간 {duration}.',

  // —— SQL 개발: 내보내기와 복사 ——
  // 결과가 잘렸을 때의 괄호 형식(본문은 common.truncated 재사용)
  'data.sql.truncatedSuffix': '({text})',
  'data.sql.noExportData': '내보낼 결과 집합이 없습니다.',
  'data.sql.exported': '{format} 파일을 내보냈습니다.',
  'data.sql.emptyEditor': '현재 편집기에 내용이 없습니다.',
  'data.sql.copied': 'SQL이 클립보드에 복사되었습니다.',
  'data.sql.copyFailed': '브라우저가 클립보드 접근을 거부했습니다. 직접 복사하세요.',

  // —— 결과 표 ——
  // NULL 셀 표시 규칙: 항상 (NULL) 로 고정하며 기술 표기이므로 모든 언어에서 동일하게 유지합니다.
  'data.grid.nullCell': '(NULL)',
  'data.conn.errorExtraParamsValue': '추가 파라미터 값은 문자열이어야 합니다: {key}',
};

export default messages;
