/**
 * 한국어 · 차트와 대시보드
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 차트와 대시보드에 고유한 표현만 담습니다.
 *  - 차트 빈 상태, 지원되지 않는 유형 안내, 건너뛴 통계, 원본 데이터 표;
 *  - 차트 / 대시보드 양식, 목록, 알림과 오류 접두사.
 *
 * 차트 유형의 표시 이름과 설명은 여기 두지 않습니다. 클라이언트는 안정적인
 * `type` 으로 meta.chartType.* / meta.chartTypeDesc.* 를 조회하며,
 * 디렉터리에 없는 type 만 서버 label 로 대체합니다.
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— 차트 빈 상태: 순수 함수는 reason 만 반환하고 문구는 여기에서 정의 ——
  'viz.empty.title': '그릴 수 있는 데이터가 없습니다',
  'viz.empty.noColumns': '쿼리가 열을 반환하지 않아 차트를 그릴 수 없습니다.',
  'viz.empty.noRows': '결과 집합이 비어 있어(0행) 그릴 수 있는 데이터 포인트가 없습니다.',
  'viz.empty.insufficientColumns': '차트를 그리려면 최소 2개 열(차원 1개 + 지표 1개)이 필요합니다.',
  'viz.empty.noNumericMetric': '지표 열에 사용할 수 있는 숫자가 없습니다(모두 NULL 또는 텍스트일 수 있음). 차트를 그릴 수 없습니다.',
  'viz.empty.pieNeedsPositive': '원형 차트/도넛형 차트는 0보다 큰 값이 최소 하나 필요합니다. NULL과 음수는 건너뛴 통계에 포함되었습니다.',
  'viz.empty.scatterNeedsNumeric': '산점도는 첫 번째 열을 X축, 나머지 숫자 열을 Y축으로 사용합니다. X / Y 모두 숫자로 변환할 수 있어야 합니다.',
  'viz.empty.parallelNeedsMetrics': '평행 좌표 차트는 꺾은선을 만들기 위해 숫자 지표 열이 최소 2개 필요합니다. 지표를 추가한 후 다시 시도하세요.',
  'viz.empty.radarNeedsDimensions': '레이더 차트는 다각형을 만들기 위해 차원 값이 최소 3개 필요합니다. 차원 행을 추가한 후 다시 시도하세요.',

  // —— 브라우저 내 렌더링이 구현되지 않은 유형(솔직한 안내) ——
  'viz.unsupported.title': '이 차트 유형은 아직 브라우저 내 렌더링을 지원하지 않습니다',
  'viz.unsupported.prefix': '차트 유형 「',
  'viz.unsupported.codePrefix': '」(',
  'viz.unsupported.suffix':
    ') — 이 유형은 생성, 저장 및 정상적인 데이터 조회를 지원하지만 현재 버전에는 해당 SVG 렌더링이 아직 구현되지 않았습니다. 아래에는 서버가 반환한 원본 데이터를 그대로 표시하여 데이터 조회 결과를 확인할 수 있습니다.',

  // —— 원본 데이터 표 ——
  'viz.table.summary': '원본 데이터({count}행)',
  'viz.table.summaryTruncated': '원본 데이터({count}행, 처음 {limit}행만 표시)',
  'viz.table.noColumns': '쿼리가 열을 반환하지 않았습니다.',
  'viz.cell.emptyString': '(빈 문자열)',

  // —— 좌표축과 통계 안내 ——
  'viz.axis.value': '값',
  'viz.note.skipped': 'NULL / 숫자가 아닌 셀 {count}개를 건너뛰어 차트에 포함하지 않았습니다.',
  'viz.note.skippedPositive': 'NULL / 숫자가 아니거나 0 이하인 셀 {count}개를 건너뛰어 차트에 포함하지 않았습니다.',
  'viz.caption.meta': '{rows}행 · {columns}열 · 소요 시간 {duration}',
  'viz.aria.chart': '{type}: {category}',

  // —— 툴팁(tooltip) 템플릿 ——
  'viz.tooltip.labelSeriesValue': '{label} · {series}: {value}',
  'viz.tooltip.seriesValue': '{series}: {value}',
  'viz.tooltip.seriesCategoryValue': '{series} · {category}: {value}',
  'viz.tooltip.slice': '{label}: {value}({percent}%)',
  'viz.legend.sliceValue': '{value}({percent}%)',
  'viz.donut.totalLabel': '{series} 합계',

  // —— 집계 방식 ——
  'viz.aggregation.none': '집계 안 함',
  'viz.aggregation.sum': '합계 SUM',
  'viz.aggregation.avg': '평균 AVG',
  'viz.aggregation.count': '개수 COUNT',
  'viz.aggregation.countDistinct': '중복 제거 개수 COUNT DISTINCT',
  'viz.aggregation.min': '최솟값 MIN',
  'viz.aggregation.max': '최댓값 MAX',
  'viz.aggregation.median': '중앙값 MEDIAN',

  // —— 차원 / 지표 행 편집기 ——
  'viz.field.columnPlaceholder': '열 이름(예: region)',
  'viz.field.aliasPlaceholder': '별칭(선택 사항)',
  'viz.field.remove': '이 필드 삭제',
  'viz.field.add': '필드 추가',

  // —— 새 차트 양식 ——
  'viz.form.name': '차트 이름 *',
  'viz.form.namePlaceholder': '예: 지역별 주문 금액 분포',
  'viz.form.chartType': '차트 유형 *',
  'viz.form.typeOption': '{label} ({code})',
  'viz.form.typeHint': '{description} · 최소 {dimensions}개 차원 / {metrics}개 지표',
  'viz.form.connection': '데이터베이스 연결 *',
  'viz.form.connectionPlaceholder': '연결을 선택하세요',
  'viz.form.connectionOption': '{name} ({type})',
  'viz.form.dashboard': '소속 대시보드(선택 사항)',
  'viz.form.dashboardNone': '대시보드에 연결 안 함',
  'viz.form.schema': '스키마 탐색(선택 사항)',
  'viz.form.schemaDisabled': '연결을 선택하면 탐색할 수 있습니다',
  'viz.form.schemaPlaceholder': '스키마를 선택하세요',
  'viz.form.schemaHint': '테이블 이름을 고르는 용도로만 사용합니다. 데이터 조회 SQL의 스키마는 서버가 연결 기본값에 따라 생성합니다.',
  'viz.form.source': '원본 테이블 / 뷰 *',
  'viz.form.sourceHintCount': '현재 스키마에서 테이블 {count}개를 선택할 수 있으며, 테이블 이름을 직접 입력할 수도 있습니다.',
  'viz.form.sourceHint': '테이블 이름 또는 뷰 이름을 직접 입력할 수 있습니다.',
  'viz.form.dimensions': '차원(GROUP BY) *',
  'viz.form.dimensionsHint': '차원은 분류 축을 결정하며, 보통 집계 방식은 「집계 안 함」을 선택합니다.',
  'viz.form.metrics': '지표(집계 열) *',
  'viz.form.metricsHint': '지표는 숫자 축을 결정하며, 합계 / 평균 / 개수 등의 집계 SQL은 서버가 생성합니다.',
  'viz.form.submit': '차트 만들기',
  'viz.form.error.nameRequired': '차트 이름을 입력하세요.',
  'viz.form.error.connectionRequired': '데이터베이스 연결을 선택해야 차트가 데이터를 조회할 수 있습니다.',
  'viz.form.error.sourceRequired': '원본 테이블 또는 뷰 이름을 입력하세요.',
  'viz.form.error.minDimensions': '{type}의 차원은 최소 {need}개가 필요합니다(현재 {got}개 입력됨).',
  'viz.form.error.minMetrics': '{type}의 지표는 최소 {need}개가 필요합니다(현재 {got}개 입력됨).',
  'viz.form.error.fieldRequired': '차원 또는 지표가 최소 하나 필요합니다.',

  // —— 차트 목록 / 미리 보기 ——
  'viz.connection.unbound': '연결이 바인딩되지 않음',
  'viz.schemaHint.line': '{type} · 기본 스키마: {schema}',
  'viz.schemaHint.unknown': '데이터베이스가 결정',
  'viz.source.custom': '사용자 지정 SQL',
  'viz.list.title': '저장된 차트',
  'viz.list.name': '차트 이름',
  'viz.list.source': '데이터 원본',
  'viz.list.render': '이 차트 렌더링',
  'viz.list.empty': '아직 차트가 없습니다',
  'viz.list.emptyHint': '오른쪽 위의 「새 차트」를 클릭하고 연결, 원본 테이블과 차트 유형을 선택하세요.',
  'viz.toolbar.count': '차트 {count}개',
  'viz.refreshList': '목록 새로 고침',
  'viz.create.title': '새 차트',
  'viz.create.description':
    '차트 설정은 서버에 저장됩니다. 데이터 조회 SQL은 서버가 차원/지표/집계에 따라 생성하며, 직접 작성한 SQL은 받지 않습니다.',
  'viz.delete.title': '차트 삭제',
  'viz.delete.message': '차트 「{name}」을(를) 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.',
  'viz.preview.emptyTitle': '차트를 선택하여 렌더링 결과 확인',
  'viz.preview.emptyHintPrefix': '렌더링에는 ',
  'viz.preview.emptyHintSuffix': ' 엔드포인트가 반환한 실제 데이터가 사용되며, 로컬 모의 데이터는 사용되지 않습니다.',
  'viz.preview.reload': '데이터 다시 조회',
  'viz.preview.loading': '데이터를 조회하여 렌더링하는 중…',
  'viz.preview.sqlSummary': '생성된 SQL 보기',
  'viz.preview.sqlMeta': '실행에 {duration} 소요, {count}행 반환.',
  'viz.preview.sqlMetaTruncated': '실행에 {duration} 소요, {count}행 반환(결과 잘림).',
  'viz.error.loadList': '차트 목록을 불러오지 못했습니다: {message}',
  'viz.error.loadMeta': '일부 차트 메타데이터를 불러오지 못했습니다: {message}',
  'viz.error.create': '차트 생성에 실패했습니다: {message}',
  'viz.error.delete': '차트 삭제에 실패했습니다: {message}',
  'viz.toast.created': '차트 「{name}」이(가) 생성되었습니다.',
  'viz.toast.deleted': '차트 「{name}」이(가) 삭제되었습니다.',

  // —— 대시보드 목록 / 상세 ——
  'viz.dashboardList.title': '대시보드 목록',
  'viz.dashboardList.name': '대시보드 이름',
  'viz.dashboardList.shared': '공유',
  'viz.dashboardList.columns': '열 수',
  'viz.dashboardList.open': '대시보드 열기',
  'viz.dashboardList.empty': '아직 대시보드가 없습니다',
  'viz.dashboardList.emptyHint': '대시보드를 만든 뒤 「데이터 시각화」에서 차트를 만들 때 해당 대시보드를 선택하면 연결됩니다.',
  'viz.dashboardToolbar.count': '대시보드 {count}개',
  'viz.dashboardToolbar.new': '새 대시보드',
  'viz.dashboardPreview.emptyTitle': '대시보드를 선택하여 차트 확인',
  'viz.dashboardPreview.emptyHint': '대시보드 상세 인터페이스는 연결된 차트도 함께 반환하며, 각 차트는 개별적으로 데이터를 조회하여 렌더링합니다.',
  'viz.dashboardPreview.refresh': '대시보드 새로 고침',
  'viz.dashboardPreview.noDescription': '설명 없음',
  'viz.dashboardPreview.noChartsTitle': '이 대시보드에는 아직 차트가 없습니다',
  'viz.dashboardPreview.noChartsHint': '「데이터 시각화」 페이지에서 새 차트를 만들고 「소속 대시보드」에서 「{name}」을(를) 선택하면 여기에 연결됩니다.',
  'viz.dashboardMeta': '{description} · 차트 {charts}개 · {columns}열 그리드',
  'viz.dashboardChart.refresh': '이 차트의 데이터 새로 고침',
  'viz.dashboardChart.loading': '데이터 조회 중…',
  'viz.dashboardCreate.description': '대시보드는 여러 차트를 한 화면으로 구성합니다. 차트 소속은 차트를 만들 때 선택할 수 있습니다.',
  'viz.dashboardDelete.title': '대시보드 삭제',
  'viz.dashboardDelete.message': '대시보드 「{name}」을(를) 삭제하시겠습니까? 대시보드의 차트도 함께 삭제됩니다(연쇄 삭제).',

  // —— 새 대시보드 양식 ——
  'viz.dashboardForm.name': '대시보드 이름 *',
  'viz.dashboardForm.namePlaceholder': '예: 운영 일일 보고 대시보드',
  'viz.dashboardForm.columns': '그리드 열 수',
  'viz.dashboardForm.columns1': '1열',
  'viz.dashboardForm.columns2': '2열(기본)',
  'viz.dashboardForm.columns3': '3열',
  'viz.dashboardForm.columns4': '4열',
  'viz.dashboardForm.columnsHint': 'layout.columns 에 저장되며, 대시보드는 이 열 수에 따라 차트를 배치합니다.',
  'viz.dashboardForm.descriptionPlaceholder': '선택 사항: 이 대시보드를 누구에게 보여 주고 무엇을 볼지',
  'viz.dashboardForm.shared': '대시보드 공유',
  'viz.dashboardForm.sharedHint': '공유하면 다른 로그인 사용자가 이 대시보드를 읽기 전용으로 볼 수 있습니다.',
  'viz.dashboardForm.submit': '대시보드 만들기',
  'viz.dashboardForm.error.nameRequired': '대시보드 이름을 입력하세요.',

  // —— 대시보드 오류와 알림 ——
  'viz.dashboardError.loadList': '대시보드 목록을 불러오지 못했습니다: {message}',
  'viz.dashboardError.loadDetail': '대시보드 상세를 불러오지 못했습니다: {message}',
  'viz.dashboardError.create': '대시보드 생성에 실패했습니다: {message}',
  'viz.dashboardError.delete': '대시보드 삭제에 실패했습니다: {message}',
  'viz.dashboardToast.created': '대시보드 「{name}」이(가) 생성되었습니다.',
  'viz.dashboardToast.deleted': '대시보드 「{name}」이(가) 삭제되었습니다.',
};

export default messages;
