/**
 * 繁體中文 · 圖表與看板
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 這裡只放**圖表與看板特有的說法**：
 *  - 圖表空態、未支援類型的說明、跳過統計、原始資料表；
 *  - 圖表 / 看板表單、清單、提示與錯誤前綴。
 *
 * 圖表類型的顯示名稱與描述**不在這裡**：伺服器端會帶中文 label，但用戶端依穩定的
 * `type` 取 `meta.chartType.*` / `meta.chartTypeDesc.*`，否則切換語言後圖表類型
 * 仍然是中文。只有目錄裡沒有的 type 才回退到伺服器端 label。
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— 圖表空態：純函式只回傳 reason，文案在這裡 ——
  'viz.empty.title': '暫無可繪製的資料',
  'viz.empty.noColumns': '查詢沒有傳回任何欄位，無法繪圖。',
  'viz.empty.noRows': '結果集為空（0 列），沒有可繪製的資料點。',
  'viz.empty.insufficientColumns': '至少需要 2 欄資料（1 個維度 + 1 個指標）才能繪圖。',
  'viz.empty.noNumericMetric': '指標欄位中沒有可用數值（可能全為 NULL 或文字），無法繪圖。',
  'viz.empty.pieNeedsPositive': '圓餅圖/環圈圖要求至少一個大於 0 的數值；NULL 與負數已計入跳過統計。',
  'viz.empty.scatterNeedsNumeric': '散佈圖以第 1 欄作為 X 軸、其餘數值欄作為 Y 軸；X / Y 都必須能解析為數字。',
  'viz.empty.parallelNeedsMetrics': '平行座標圖至少需要 2 個數值指標欄才能連成折線，請增加指標後重試。',
  'viz.empty.radarNeedsDimensions': '雷達圖至少需要 3 個維度取值才能圍成多邊形，請增加維度列數後重試。',

  // —— 未實作瀏覽器內渲染的類型（誠實佔位）——
  'viz.unsupported.title': '此圖表類型暫不支援瀏覽器內渲染',
  'viz.unsupported.prefix': '圖表類型「',
  'viz.unsupported.codePrefix': '」（',
  'viz.unsupported.suffix':
    '）仍然可以建立、儲存並正常取數，但目前版本尚未實作對應的 SVG 渲染，下方直接顯示伺服器端傳回的原始資料，便於核對取數結果。',

  // —— 原始資料表 ——
  'viz.table.summary': '原始資料（{count} 列）',
  'viz.table.summaryTruncated': '原始資料（{count} 列，僅顯示前 {limit} 列）',
  'viz.table.noColumns': '查詢沒有傳回任何欄位。',
  'viz.cell.emptyString': '(空字串)',

  // —— 座標軸與統計提示 ——
  'viz.axis.value': '數值',
  'viz.note.skipped': '已跳過 {count} 個 NULL / 非數值儲存格，未參與繪圖。',
  'viz.note.skippedPositive': '已跳過 {count} 個 NULL / 非數值或非正數儲存格，未參與繪圖。',
  'viz.caption.meta': '{rows} 列 · {columns} 欄 · 耗時 {duration}',
  'viz.aria.chart': '{type}：{category}',

  // —— 懸浮提示（tooltip）範本 ——
  'viz.tooltip.labelSeriesValue': '{label} · {series}：{value}',
  'viz.tooltip.seriesValue': '{series}：{value}',
  'viz.tooltip.seriesCategoryValue': '{series} · {category}：{value}',
  'viz.tooltip.slice': '{label}：{value}（{percent}%）',
  'viz.legend.sliceValue': '{value}（{percent}%）',
  'viz.donut.totalLabel': '{series} 合計',

  // —— 聚合方式 ——
  'viz.aggregation.none': '不聚合',
  'viz.aggregation.sum': '加總 SUM',
  'viz.aggregation.avg': '平均 AVG',
  'viz.aggregation.count': '計數 COUNT',
  'viz.aggregation.countDistinct': '不重複計數 COUNT DISTINCT',
  'viz.aggregation.min': '最小值 MIN',
  'viz.aggregation.max': '最大值 MAX',
  'viz.aggregation.median': '中位數 MEDIAN',

  // —— 維度 / 指標列編輯器 ——
  'viz.field.columnPlaceholder': '欄名，例如 region',
  'viz.field.aliasPlaceholder': '別名（選填）',
  'viz.field.remove': '刪除此欄位',
  'viz.field.add': '新增欄位',

  // —— 新增圖表表單 ——
  'viz.form.name': '圖表名稱 *',
  'viz.form.namePlaceholder': '例如：各縣市訂單金額分布',
  'viz.form.chartType': '圖表類型 *',
  'viz.form.typeOption': '{label}（{code}）',
  'viz.form.typeHint': '{description} · 至少 {dimensions} 個維度 / {metrics} 個指標',
  'viz.form.connection': '資料庫連線 *',
  'viz.form.connectionPlaceholder': '請選擇連線',
  'viz.form.connectionOption': '{name}（{type}）',
  'viz.form.dashboard': '所屬看板（選填）',
  'viz.form.dashboardNone': '不掛載看板',
  'viz.form.schema': '瀏覽 Schema（選填）',
  'viz.form.schemaDisabled': '選擇連線後可瀏覽',
  'viz.form.schemaPlaceholder': '請選擇 Schema',
  'viz.form.schemaHint': '僅用於挑選資料表名稱；取數 SQL 的 Schema 由伺服器端依連線預設值產生。',
  'viz.form.source': '來源表 / 檢視表 *',
  'viz.form.sourceHintCount': '目前 Schema 下有 {count} 張資料表可選，也可直接輸入資料表名稱。',
  'viz.form.sourceHint': '可直接輸入資料表名稱或檢視表名稱。',
  'viz.form.dimensions': '維度（GROUP BY）*',
  'viz.form.dimensionsHint': '維度決定分類軸；通常聚合方式選擇「不聚合」。',
  'viz.form.metrics': '指標（聚合欄）*',
  'viz.form.metricsHint': '指標決定數值軸；加總 / 平均 / 計數等聚合由伺服器端產生 SQL。',
  'viz.form.submit': '建立圖表',
  'viz.form.error.nameRequired': '請填寫圖表名稱。',
  'viz.form.error.connectionRequired': '請選擇資料庫連線，否則圖表無法取數。',
  'viz.form.error.sourceRequired': '請填寫來源表或檢視表名稱。',
  'viz.form.error.minDimensions': '{type} 至少需要 {need} 個維度（已填 {got} 個）。',
  'viz.form.error.minMetrics': '{type} 至少需要 {need} 個指標（已填 {got} 個）。',
  'viz.form.error.fieldRequired': '至少需要一個維度或指標。',

  // —— 圖表清單 / 預覽 ——
  'viz.connection.unbound': '未綁定連線',
  'viz.schemaHint.line': '{type} · 預設 Schema：{schema}',
  'viz.schemaHint.unknown': '由資料庫決定',
  'viz.source.custom': '自訂 SQL',
  'viz.list.title': '已儲存圖表',
  'viz.list.name': '圖表名稱',
  'viz.list.source': '資料來源',
  'viz.list.render': '渲染此圖表',
  'viz.list.empty': '還沒有圖表',
  'viz.list.emptyHint': '點擊右上角「新增圖表」，選擇連線、來源表與圖表類型。',
  'viz.toolbar.count': '共 {count} 張圖表',
  'viz.refreshList': '重新整理清單',
  'viz.create.title': '新增圖表',
  'viz.create.description':
    '圖表設定儲存到伺服器端；取數 SQL 由伺服器端依維度/指標/聚合產生，不接受手寫 SQL。',
  'viz.delete.title': '刪除圖表',
  'viz.delete.message': '確定要刪除圖表「{name}」嗎？此操作無法復原。',
  'viz.preview.emptyTitle': '選擇一張圖表查看渲染結果',
  'viz.preview.emptyHintPrefix': '渲染使用 ',
  'viz.preview.emptyHintSuffix': ' 傳回的真實資料，而不是本機模擬資料。',
  'viz.preview.reload': '重新取數',
  'viz.preview.loading': '正在取數並渲染…',
  'viz.preview.sqlSummary': '查看產生的 SQL',
  'viz.preview.sqlMeta': '執行耗時 {duration}，傳回 {count} 列。',
  'viz.preview.sqlMetaTruncated': '執行耗時 {duration}，傳回 {count} 列（結果已截斷）。',
  'viz.error.loadList': '載入圖表清單失敗：{message}',
  'viz.error.loadMeta': '部分圖表中繼資料載入失敗：{message}',
  'viz.error.create': '建立圖表失敗：{message}',
  'viz.error.delete': '刪除圖表失敗：{message}',
  'viz.toast.created': '圖表「{name}」已建立。',
  'viz.toast.deleted': '圖表「{name}」已刪除。',

  // —— 看板清單 / 詳細資料 ——
  'viz.dashboardList.title': '看板清單',
  'viz.dashboardList.name': '看板名稱',
  'viz.dashboardList.shared': '共享',
  'viz.dashboardList.columns': '欄數',
  'viz.dashboardList.open': '開啟看板',
  'viz.dashboardList.empty': '還沒有看板',
  'viz.dashboardList.emptyHint': '新增看板後，到「資料視覺化」建立圖表時選擇該看板即可掛載。',
  'viz.dashboardToolbar.count': '共 {count} 個看板',
  'viz.dashboardToolbar.new': '新增看板',
  'viz.dashboardPreview.emptyTitle': '選擇一個看板查看圖表',
  'viz.dashboardPreview.emptyHint': '看板詳細資料介面會一併傳回其掛載的圖表，每張圖表獨立取數並渲染。',
  'viz.dashboardPreview.refresh': '重新整理看板',
  'viz.dashboardPreview.noDescription': '暫無描述',
  'viz.dashboardPreview.noChartsTitle': '此看板還沒有圖表',
  'viz.dashboardPreview.noChartsHint': '到「資料視覺化」頁新增圖表，在「所屬看板」中選擇「{name}」即可掛載到這裡。',
  'viz.dashboardMeta': '{description} · {charts} 張圖表 · {columns} 欄網格',
  'viz.dashboardChart.refresh': '重新整理此圖表資料',
  'viz.dashboardChart.loading': '取數中…',
  'viz.dashboardCreate.description': '看板用於將多張圖表組合為單一畫面；圖表歸屬可在建立圖表時選擇。',
  'viz.dashboardDelete.title': '刪除看板',
  'viz.dashboardDelete.message': '確定要刪除看板「{name}」嗎？看板下的圖表會一併刪除（串聯刪除）。',

  // —— 新增看板表單 ——
  'viz.dashboardForm.name': '看板名稱 *',
  'viz.dashboardForm.namePlaceholder': '例如：營運日報看板',
  'viz.dashboardForm.columns': '網格欄數',
  'viz.dashboardForm.columns1': '1 欄',
  'viz.dashboardForm.columns2': '2 欄（預設）',
  'viz.dashboardForm.columns3': '3 欄',
  'viz.dashboardForm.columns4': '4 欄',
  'viz.dashboardForm.columnsHint': '儲存在 layout.columns，看板依此欄數排列圖表。',
  'viz.dashboardForm.descriptionPlaceholder': '選填：這個看板給誰看、看什麼',
  'viz.dashboardForm.shared': '共享看板',
  'viz.dashboardForm.sharedHint': '共享後其他已登入使用者可以唯讀檢視此看板。',
  'viz.dashboardForm.submit': '建立看板',
  'viz.dashboardForm.error.nameRequired': '請填寫看板名稱。',

  // —— 看板錯誤與提示 ——
  'viz.dashboardError.loadList': '載入看板清單失敗：{message}',
  'viz.dashboardError.loadDetail': '載入看板詳細資料失敗：{message}',
  'viz.dashboardError.create': '建立看板失敗：{message}',
  'viz.dashboardError.delete': '刪除看板失敗：{message}',
  'viz.dashboardToast.created': '看板「{name}」已建立。',
  'viz.dashboardToast.deleted': '看板「{name}」已刪除。',
};

export default messages;
