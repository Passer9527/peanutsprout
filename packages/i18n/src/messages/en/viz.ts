/**
 * English · Charts & dashboards
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— Chart empty states: the pure function only returns a reason, the copy lives here ——
  'viz.empty.title': 'No data to plot',
  'viz.empty.noColumns': 'The query returned no columns, so there is nothing to plot.',
  'viz.empty.noRows': 'The result set is empty (0 rows); there are no data points to plot.',
  'viz.empty.insufficientColumns':
    'At least 2 columns (1 dimension + 1 metric) are required to draw a chart.',
  'viz.empty.noNumericMetric':
    'The metric columns contain no usable numbers (they may be all NULL or text), so the chart cannot be drawn.',
  'viz.empty.pieNeedsPositive':
    'Pie and donut charts require at least one value greater than 0; NULLs and negative numbers are counted as skipped.',
  'viz.empty.scatterNeedsNumeric':
    'A scatter chart uses the first column as the X axis and the remaining numeric columns as the Y axis; both X and Y must parse as numbers.',
  'viz.empty.parallelNeedsMetrics':
    'A parallel coordinates chart needs at least 2 numeric metric columns to form a line; add more metrics and try again.',
  'viz.empty.radarNeedsDimensions':
    'A radar chart needs at least 3 dimension values to form a polygon; add more dimension rows and try again.',

  // —— Types without in-browser rendering (an honest placeholder) ——
  'viz.unsupported.title': 'This chart type is not rendered in the browser yet',
  'viz.unsupported.prefix': 'Chart type "',
  'viz.unsupported.codePrefix': '" (',
  'viz.unsupported.suffix':
    ') can still be created, saved and queried normally, but this version does not implement its SVG rendering yet. The raw data returned by the server is shown below so you can verify the query results.',

  // —— Raw data table ——
  'viz.table.summary': 'Raw data ({count} rows)',
  'viz.table.summary.one': 'Raw data ({count} row)',
  'viz.table.summaryTruncated': 'Raw data ({count} rows, showing the first {limit})',
  'viz.table.summaryTruncated.one': 'Raw data ({count} row, showing the first {limit})',
  'viz.table.noColumns': 'The query returned no columns.',
  'viz.cell.emptyString': '(empty string)',

  // —— Axis and statistics notes ——
  'viz.axis.value': 'Value',
  'viz.note.skipped': 'Skipped {count} NULL / non-numeric cells; they were not plotted.',
  'viz.note.skipped.one': 'Skipped {count} NULL / non-numeric cell; it was not plotted.',
  'viz.note.skippedPositive':
    'Skipped {count} NULL / non-numeric or non-positive cells; they were not plotted.',
  'viz.note.skippedPositive.one':
    'Skipped {count} NULL / non-numeric or non-positive cell; it was not plotted.',
  'viz.caption.meta': '{rows} rows · {columns} columns · {duration}',
  'viz.aria.chart': '{type}: {category}',

  // —— Tooltip templates ——
  'viz.tooltip.labelSeriesValue': '{label} · {series}: {value}',
  'viz.tooltip.seriesValue': '{series}: {value}',
  'viz.tooltip.seriesCategoryValue': '{series} · {category}: {value}',
  'viz.tooltip.slice': '{label}: {value} ({percent}%)',
  'viz.legend.sliceValue': '{value} ({percent}%)',
  'viz.donut.totalLabel': '{series} total',

  // —— Aggregation ——
  'viz.aggregation.none': 'No aggregation',
  'viz.aggregation.sum': 'Sum (SUM)',
  'viz.aggregation.avg': 'Average (AVG)',
  'viz.aggregation.count': 'Count (COUNT)',
  'viz.aggregation.countDistinct': 'Distinct count (COUNT DISTINCT)',
  'viz.aggregation.min': 'Minimum (MIN)',
  'viz.aggregation.max': 'Maximum (MAX)',
  'viz.aggregation.median': 'Median (MEDIAN)',

  // —— Dimension / metric row editor ——
  'viz.field.columnPlaceholder': 'Column name, e.g. region',
  'viz.field.aliasPlaceholder': 'Alias (optional)',
  'viz.field.remove': 'Remove this field',
  'viz.field.add': 'Add field',

  // —— New chart form ——
  'viz.form.name': 'Chart name *',
  'viz.form.namePlaceholder': 'e.g. Order amount by province',
  'viz.form.chartType': 'Chart type *',
  'viz.form.typeOption': '{label} ({code})',
  'viz.form.typeHint': '{description} · at least {dimensions} dimensions / {metrics} metrics',
  'viz.form.connection': 'Database connection *',
  'viz.form.connectionPlaceholder': 'Select a connection',
  'viz.form.connectionOption': '{name} ({type})',
  'viz.form.dashboard': 'Dashboard (optional)',
  'viz.form.dashboardNone': 'Not attached to a dashboard',
  'viz.form.schema': 'Browse schemas (optional)',
  'viz.form.schemaDisabled': 'Select a connection to browse',
  'viz.form.schemaPlaceholder': 'Select a schema',
  'viz.form.schemaHint':
    'Used only to pick table names; the schema in the generated query SQL comes from the connection default on the server.',
  'viz.form.source': 'Source table / view *',
  'viz.form.sourceHintCount':
    'The current schema has {count} tables to choose from; you can also type a table name.',
  'viz.form.sourceHintCount.one':
    'The current schema has {count} table to choose from; you can also type a table name.',
  'viz.form.sourceHint': 'You can type a table or view name directly.',
  'viz.form.dimensions': 'Dimensions (GROUP BY) *',
  'viz.form.dimensionsHint':
    'Dimensions define the category axis; usually set the aggregation to "No aggregation".',
  'viz.form.metrics': 'Metrics (aggregated columns) *',
  'viz.form.metricsHint':
    'Metrics define the value axis; the server generates SQL for sum / average / count and other aggregations.',
  'viz.form.submit': 'Create chart',
  'viz.form.error.nameRequired': 'Please enter a chart name.',
  'viz.form.error.connectionRequired':
    'Please select a database connection, or the chart cannot query data.',
  'viz.form.error.sourceRequired': 'Please enter a source table or view name.',
  'viz.form.error.minDimensions': '{type} needs at least {need} dimensions ({got} provided).',
  'viz.form.error.minMetrics': '{type} needs at least {need} metrics ({got} provided).',
  'viz.form.error.fieldRequired': 'At least one dimension or metric is required.',

  // —— Chart list / preview ——
  'viz.connection.unbound': 'No connection bound',
  'viz.schemaHint.line': '{type} · default schema: {schema}',
  'viz.schemaHint.unknown': 'Determined by the database',
  'viz.source.custom': 'Custom SQL',
  'viz.list.title': 'Saved charts',
  'viz.list.name': 'Chart name',
  'viz.list.source': 'Data source',
  'viz.list.render': 'Render this chart',
  'viz.list.empty': 'No charts yet',
  'viz.list.emptyHint':
    'Click "New chart" in the top right, then choose a connection, source table and chart type.',
  'viz.toolbar.count': '{count} charts',
  'viz.toolbar.count.one': '{count} chart',
  'viz.refreshList': 'Refresh list',
  'viz.create.title': 'New chart',
  'viz.create.description':
    'Chart settings are saved on the server; the query SQL is generated there from the dimensions, metrics and aggregation, and handwritten SQL is not accepted.',
  'viz.delete.title': 'Delete chart',
  'viz.delete.message': 'Delete chart "{name}"? This cannot be undone.',
  'viz.preview.emptyTitle': 'Select a chart to view its rendering',
  'viz.preview.emptyHintPrefix': 'Rendering uses ',
  'viz.preview.emptyHintSuffix': ' real data returned by this endpoint, not locally simulated data.',
  'viz.preview.reload': 'Re-query',
  'viz.preview.loading': 'Querying and rendering…',
  'viz.preview.sqlSummary': 'View generated SQL',
  'viz.preview.sqlMeta': 'Executed in {duration}; {count} rows returned.',
  'viz.preview.sqlMeta.one': 'Executed in {duration}; {count} row returned.',
  'viz.preview.sqlMetaTruncated': 'Executed in {duration}; {count} rows returned (results truncated).',
  'viz.preview.sqlMetaTruncated.one': 'Executed in {duration}; {count} row returned (results truncated).',
  'viz.error.loadList': 'Failed to load the chart list: {message}',
  'viz.error.loadMeta': 'Some chart metadata failed to load: {message}',
  'viz.error.create': 'Failed to create the chart: {message}',
  'viz.error.delete': 'Failed to delete the chart: {message}',
  'viz.toast.created': 'Chart "{name}" created.',
  'viz.toast.deleted': 'Chart "{name}" deleted.',

  // —— Dashboard list / detail ——
  'viz.dashboardList.title': 'Dashboard list',
  'viz.dashboardList.name': 'Dashboard name',
  'viz.dashboardList.shared': 'Shared',
  'viz.dashboardList.columns': 'Columns',
  'viz.dashboardList.open': 'Open dashboard',
  'viz.dashboardList.empty': 'No dashboards yet',
  'viz.dashboardList.emptyHint':
    'After creating a dashboard, select it when creating a chart in "Data Visualization" to attach the chart.',
  'viz.dashboardToolbar.count': '{count} dashboards',
  'viz.dashboardToolbar.count.one': '{count} dashboard',
  'viz.dashboardToolbar.new': 'New dashboard',
  'viz.dashboardPreview.emptyTitle': 'Select a dashboard to view its charts',
  'viz.dashboardPreview.emptyHint':
    'The dashboard detail endpoint also returns its attached charts; each chart queries and renders independently.',
  'viz.dashboardPreview.refresh': 'Refresh dashboard',
  'viz.dashboardPreview.noDescription': 'No description',
  'viz.dashboardPreview.noChartsTitle': 'This dashboard has no charts yet',
  'viz.dashboardPreview.noChartsHint':
    'Create a chart on the "Data Visualization" page and select "{name}" under "Dashboard" to attach it here.',
  'viz.dashboardMeta': '{description} · {charts} charts · {columns}-column grid',
  'viz.dashboardChart.refresh': 'Refresh this chart’s data',
  'viz.dashboardChart.loading': 'Querying…',
  'viz.dashboardCreate.description':
    'A dashboard combines multiple charts on a single screen; you choose the dashboard when creating a chart.',
  'viz.dashboardDelete.title': 'Delete dashboard',
  'viz.dashboardDelete.message':
    'Delete dashboard "{name}"? Its charts are deleted as well (cascade).',

  // —— New dashboard form ——
  'viz.dashboardForm.name': 'Dashboard name *',
  'viz.dashboardForm.namePlaceholder': 'e.g. Daily operations dashboard',
  'viz.dashboardForm.columns': 'Grid columns',
  'viz.dashboardForm.columns1': '1 column',
  'viz.dashboardForm.columns2': '2 columns (default)',
  'viz.dashboardForm.columns3': '3 columns',
  'viz.dashboardForm.columns4': '4 columns',
  'viz.dashboardForm.columnsHint':
    'Stored in layout.columns; the dashboard arranges charts in this many columns.',
  'viz.dashboardForm.descriptionPlaceholder':
    'Optional: who this dashboard is for and what it shows',
  'viz.dashboardForm.shared': 'Share dashboard',
  'viz.dashboardForm.sharedHint':
    'Once shared, other signed-in users can view this dashboard in read-only mode.',
  'viz.dashboardForm.submit': 'Create dashboard',
  'viz.dashboardForm.error.nameRequired': 'Please enter a dashboard name.',

  // —— Dashboard errors and toasts ——
  'viz.dashboardError.loadList': 'Failed to load the dashboard list: {message}',
  'viz.dashboardError.loadDetail': 'Failed to load dashboard details: {message}',
  'viz.dashboardError.create': 'Failed to create the dashboard: {message}',
  'viz.dashboardError.delete': 'Failed to delete the dashboard: {message}',
  'viz.dashboardToast.created': 'Dashboard "{name}" created.',
  'viz.dashboardToast.deleted': 'Dashboard "{name}" deleted.',
};

export default messages;
