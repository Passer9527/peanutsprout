/**
 * 简体中文（源语言）· viz 命名空间（图表 / 看板）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 这里只放**图表与看板特有的说法**：
 *  - 图表空态、未支持类型的说明、跳过统计、原始数据表；
 *  - 图表 / 看板表单、列表、提示与错误前缀。
 *
 * 图表类型的展示名与描述**不在这里**：服务端会带中文 label，但客户端按稳定的
 * `type` 取 `meta.chartType.*` / `meta.chartTypeDesc.*`，否则切换语言后图表类型
 * 仍然是中文。只有目录里没有的 type 才回退到服务端 label。
 */
export default {
  // —— 图表空态：纯函数只返回 reason，文案在这里 ——
  'viz.empty.title': '暂无可绘制的数据',
  'viz.empty.noColumns': '查询没有返回任何列，无法绘图。',
  'viz.empty.noRows': '结果集为空（0 行），没有可绘制的数据点。',
  'viz.empty.insufficientColumns': '至少需要 2 列数据（1 个维度 + 1 个指标）才能绘图。',
  'viz.empty.noNumericMetric': '指标列中没有可用数值（可能全为 NULL 或文本），无法绘图。',
  'viz.empty.pieNeedsPositive': '饼图/环形图要求至少一个大于 0 的数值；NULL 与负数已计入跳过统计。',
  'viz.empty.scatterNeedsNumeric': '散点图以第 1 列作为 X 轴、其余数值列作为 Y 轴；X / Y 都必须能解析为数字。',
  'viz.empty.parallelNeedsMetrics': '平行坐标图至少需要 2 个数值指标列才能连成折线，请增加指标后重试。',
  'viz.empty.radarNeedsDimensions': '雷达图至少需要 3 个维度取值才能围成多边形，请增加维度行数后重试。',

  // —— 未实现浏览器内渲染的类型（诚实占位）——
  'viz.unsupported.title': '该图表类型暂不支持浏览器内渲染',
  'viz.unsupported.prefix': '图表类型「',
  'viz.unsupported.codePrefix': '」（',
  'viz.unsupported.suffix':
    '）仍然可以创建、保存并正常取数，但当前版本尚未实现对应的 SVG 渲染，下方直接展示服务端返回的原始数据，便于核对取数结果。',

  // —— 原始数据表 ——
  'viz.table.summary': '原始数据（{count} 行）',
  'viz.table.summaryTruncated': '原始数据（{count} 行，仅显示前 {limit} 行）',
  'viz.table.noColumns': '查询没有返回任何列。',
  'viz.cell.emptyString': '(空字符串)',

  // —— 坐标轴与统计提示 ——
  'viz.axis.value': '数值',
  'viz.note.skipped': '已跳过 {count} 个 NULL / 非数值单元格，未参与绘图。',
  'viz.note.skippedPositive': '已跳过 {count} 个 NULL / 非数值或非正数单元格，未参与绘图。',
  'viz.caption.meta': '{rows} 行 · {columns} 列 · 耗时 {duration}',
  'viz.aria.chart': '{type}：{category}',

  // —— 悬浮提示（tooltip）模板 ——
  'viz.tooltip.labelSeriesValue': '{label} · {series}：{value}',
  'viz.tooltip.seriesValue': '{series}：{value}',
  'viz.tooltip.seriesCategoryValue': '{series} · {category}：{value}',
  'viz.tooltip.slice': '{label}：{value}（{percent}%）',
  'viz.legend.sliceValue': '{value}（{percent}%）',
  'viz.donut.totalLabel': '{series} 合计',

  // —— 聚合方式 ——
  'viz.aggregation.none': '不聚合',
  'viz.aggregation.sum': '求和 SUM',
  'viz.aggregation.avg': '平均 AVG',
  'viz.aggregation.count': '计数 COUNT',
  'viz.aggregation.countDistinct': '去重计数 COUNT DISTINCT',
  'viz.aggregation.min': '最小值 MIN',
  'viz.aggregation.max': '最大值 MAX',
  'viz.aggregation.median': '中位数 MEDIAN',

  // —— 维度 / 指标行编辑器 ——
  'viz.field.columnPlaceholder': '列名，如 region',
  'viz.field.aliasPlaceholder': '别名（可选）',
  'viz.field.remove': '删除该字段',
  'viz.field.add': '添加字段',

  // —— 新建图表表单 ——
  'viz.form.name': '图表名称 *',
  'viz.form.namePlaceholder': '如：各省订单额分布',
  'viz.form.chartType': '图表类型 *',
  'viz.form.typeOption': '{label}（{code}）',
  'viz.form.typeHint': '{description} · 至少 {dimensions} 个维度 / {metrics} 个指标',
  'viz.form.connection': '数据库连接 *',
  'viz.form.connectionPlaceholder': '请选择连接',
  'viz.form.connectionOption': '{name}（{type}）',
  'viz.form.dashboard': '所属看板（可选）',
  'viz.form.dashboardNone': '不挂载看板',
  'viz.form.schema': '浏览 Schema（可选）',
  'viz.form.schemaDisabled': '选择连接后可浏览',
  'viz.form.schemaPlaceholder': '请选择 Schema',
  'viz.form.schemaHint': '仅用于挑选表名；取数 SQL 的 Schema 由服务端按连接默认值生成。',
  'viz.form.source': '来源表 / 视图 *',
  'viz.form.sourceHintCount': '当前 Schema 下有 {count} 张表可选，也可直接输入表名。',
  'viz.form.sourceHint': '可直接输入表名或视图名。',
  'viz.form.dimensions': '维度（GROUP BY）*',
  'viz.form.dimensionsHint': '维度决定分类轴；通常聚合方式选择「不聚合」。',
  'viz.form.metrics': '指标（聚合列）*',
  'viz.form.metricsHint': '指标决定数值轴；求和 / 平均 / 计数等聚合由服务端生成 SQL。',
  'viz.form.submit': '创建图表',
  'viz.form.error.nameRequired': '请填写图表名称。',
  'viz.form.error.connectionRequired': '请选择数据库连接，否则图表无法取数。',
  'viz.form.error.sourceRequired': '请填写来源表或视图名。',
  'viz.form.error.minDimensions': '{type} 至少需要 {need} 个维度（已填 {got} 个）。',
  'viz.form.error.minMetrics': '{type} 至少需要 {need} 个指标（已填 {got} 个）。',
  'viz.form.error.fieldRequired': '至少需要一个维度或指标。',

  // —— 图表列表 / 预览 ——
  'viz.connection.unbound': '未绑定连接',
  'viz.schemaHint.line': '{type} · 默认 Schema：{schema}',
  'viz.schemaHint.unknown': '由数据库决定',
  'viz.source.custom': '自定义 SQL',
  'viz.list.title': '已保存图表',
  'viz.list.name': '图表名称',
  'viz.list.source': '数据来源',
  'viz.list.render': '渲染该图表',
  'viz.list.empty': '还没有图表',
  'viz.list.emptyHint': '点击右上角「新建图表」，选择连接、来源表与图表类型。',
  'viz.toolbar.count': '共 {count} 张图表',
  'viz.refreshList': '刷新列表',
  'viz.create.title': '新建图表',
  'viz.create.description':
    '图表配置保存到服务端；取数 SQL 由服务端按维度/指标/聚合生成，不接受手写 SQL。',
  'viz.delete.title': '删除图表',
  'viz.delete.message': '确定要删除图表「{name}」吗？该操作不可撤销。',
  'viz.preview.emptyTitle': '选择一张图表查看渲染结果',
  'viz.preview.emptyHintPrefix': '渲染使用 ',
  'viz.preview.emptyHintSuffix': ' 返回的真实数据，而不是本地模拟数据。',
  'viz.preview.reload': '重新取数',
  'viz.preview.loading': '正在取数并渲染…',
  'viz.preview.sqlSummary': '查看生成的 SQL',
  'viz.preview.sqlMeta': '执行耗时 {duration}，返回 {count} 行。',
  'viz.preview.sqlMetaTruncated': '执行耗时 {duration}，返回 {count} 行（结果已截断）。',
  'viz.error.loadList': '加载图表列表失败：{message}',
  'viz.error.loadMeta': '部分图表元数据加载失败：{message}',
  'viz.error.create': '创建图表失败：{message}',
  'viz.error.delete': '删除图表失败：{message}',
  'viz.toast.created': '图表「{name}」已创建。',
  'viz.toast.deleted': '图表「{name}」已删除。',

  // —— 看板列表 / 详情 ——
  'viz.dashboardList.title': '看板列表',
  'viz.dashboardList.name': '看板名称',
  'viz.dashboardList.shared': '共享',
  'viz.dashboardList.columns': '列数',
  'viz.dashboardList.open': '打开看板',
  'viz.dashboardList.empty': '还没有看板',
  'viz.dashboardList.emptyHint': '新建看板后，到「数据可视化」创建图表时选择该看板即可挂载。',
  'viz.dashboardToolbar.count': '共 {count} 个看板',
  'viz.dashboardToolbar.new': '新建看板',
  'viz.dashboardPreview.emptyTitle': '选择一个看板查看图表',
  'viz.dashboardPreview.emptyHint': '看板详情接口会一并返回其挂载的图表，每张图表独立取数并渲染。',
  'viz.dashboardPreview.refresh': '刷新看板',
  'viz.dashboardPreview.noDescription': '暂无描述',
  'viz.dashboardPreview.noChartsTitle': '该看板还没有图表',
  'viz.dashboardPreview.noChartsHint': '到「数据可视化」页新建图表，在「所属看板」里选择「{name}」即可挂载到这里。',
  'viz.dashboardMeta': '{description} · {charts} 张图表 · {columns} 列网格',
  'viz.dashboardChart.refresh': '刷新该图表数据',
  'viz.dashboardChart.loading': '取数中…',
  'viz.dashboardCreate.description': '看板用于把多张图表组合成一屏；图表归属可在创建图表时选择。',
  'viz.dashboardDelete.title': '删除看板',
  'viz.dashboardDelete.message': '确定要删除看板「{name}」吗？看板下的图表会一并删除（级联）。',

  // —— 新建看板表单 ——
  'viz.dashboardForm.name': '看板名称 *',
  'viz.dashboardForm.namePlaceholder': '如：运营日报看板',
  'viz.dashboardForm.columns': '网格列数',
  'viz.dashboardForm.columns1': '1 列',
  'viz.dashboardForm.columns2': '2 列（默认）',
  'viz.dashboardForm.columns3': '3 列',
  'viz.dashboardForm.columns4': '4 列',
  'viz.dashboardForm.columnsHint': '保存在 layout.columns，看板按此列数排布图表。',
  'viz.dashboardForm.descriptionPlaceholder': '可选：这个看板给谁看、看什么',
  'viz.dashboardForm.shared': '共享看板',
  'viz.dashboardForm.sharedHint': '共享后其他登录用户可以只读查看该看板。',
  'viz.dashboardForm.submit': '创建看板',
  'viz.dashboardForm.error.nameRequired': '请填写看板名称。',

  // —— 看板错误与提示 ——
  'viz.dashboardError.loadList': '加载看板列表失败：{message}',
  'viz.dashboardError.loadDetail': '加载看板详情失败：{message}',
  'viz.dashboardError.create': '创建看板失败：{message}',
  'viz.dashboardError.delete': '删除看板失败：{message}',
  'viz.dashboardToast.created': '看板「{name}」已创建。',
  'viz.dashboardToast.deleted': '看板「{name}」已删除。',
} as const;
