/**
 * 花生苗数据库管理工具 - 图表 SVG 渲染器
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 设计取舍（AC-03）：
 *  1. 不引入 echarts / chart.js 等运行时依赖，全部用内联 SVG + React 手写，
 *     打包体积与许可风险都可控（AGPL 项目对第三方渲染库的许可尤其敏感）；
 *  2. 几何计算全部委托给 chartGeometry.ts 的纯函数 —— 组件只做"翻译成元素"，
 *     这样坐标与刻度逻辑能在 Node 里单测，而不是只能靠肉眼看图；
 *     纯函数不产出任何用户可见文案，空态原因、坐标数值等都在这里用 t() 翻译；
 *  3. 只渲染真正实现了的类型，其余类型显示明确说明 + 原始数据表，
 *     不做"看起来很厉害其实画错了"的假渲染。
 */

import type { MessageKey, StrictTranslateFn } from '@peanutsprout/i18n';
import { useMemo } from 'react';
import type { ChartDataDTO, QueryCell, QueryColumnDTO } from '../api/types';
import { useI18n } from '../state/i18n';
import { formatDuration } from '../utils/format';
import {
  CHART_VIEW_HEIGHT,
  CHART_VIEW_WIDTH,
  buildBarGeometry,
  buildBarRects,
  buildCartesianGeometry,
  buildChartModel,
  buildColumnRects,
  buildPieGeometry,
  buildParallelGeometry,
  buildRadarGeometry,
  buildScatterGeometry,
  cellToLabel,
  chartColor,
  isChartTypeSupported,
  splitSegments,
  truncateLabel,
} from './chartGeometry';
import type {
  ChartEmptyReason,
  ChartModel,
  CartesianGeometry,
  HorizontalBarGeometry,
  PieGeometry,
  RadarGeometry,
  ParallelGeometry,
  ScatterGeometry,
} from './chartGeometry';
import { Icon } from './Icons';

/**
 * 图表类型展示名：按稳定的 type 取 `meta.chartType.*`，**绝不直接显示服务端的中文 label**。
 * 目录里没有该 type 时（例如服务端新增了类型、客户端语言包还没跟上），
 * 回退到调用方给的服务端 label，再回退到 type 本身 —— 至少让用户看到稳定的代码。
 */
export function chartTypeLabel(t: StrictTranslateFn, type: string, serverLabel?: string): string {
  return t(`chartType.${type}` as MessageKey, { defaultValue: serverLabel ?? type });
}

/**
 * 图表类型描述：按 type 取 `meta.chartTypeDesc.*`，回退到服务端 description。
 * 同样不直接显示服务端下发的中文文案。
 */
export function chartTypeDescription(
  t: StrictTranslateFn,
  type: string,
  serverDescription?: string,
): string {
  return t(`chartTypeDesc.${type}` as MessageKey, { defaultValue: serverDescription ?? '' });
}

/** 空态原因 → 语言包键；纯模块只给 reason，句子在这里落到 viz.ts */
const EMPTY_MESSAGE_KEYS: Record<ChartEmptyReason, MessageKey> = {
  'no-columns': 'viz.empty.noColumns',
  'no-rows': 'viz.empty.noRows',
  'insufficient-columns': 'viz.empty.insufficientColumns',
  'no-numeric-metric': 'viz.empty.noNumericMetric',
};

export interface ChartRendererProps {
  data: ChartDataDTO;
  /** viewBox 高度（宽度固定 880），看板里可以用更矮的画布 */
  height?: number;
}

/* ------------------------------------------------------------------ 图例 / 表格 / 空态 */

interface LegendItem {
  label: string;
  color: string;
  value?: string;
}

function ChartLegend({ items }: { items: LegendItem[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <ul className="chart-legend">
      {items.map((item, index) => (
        <li key={`${index}-${item.label}`} className="chart-legend__item">
          <span className="chart-legend__swatch" style={{ backgroundColor: item.color }} aria-hidden="true" />
          <span className="chart-legend__label">{item.label}</span>
          {item.value === undefined ? null : <span className="chart-legend__value mono">{item.value}</span>}
        </li>
      ))}
    </ul>
  );
}

interface ChartDataTableProps {
  columns: QueryColumnDTO[];
  rows: QueryCell[][];
  defaultOpen: boolean;
}

/** 原始数据表：既是"取数是否正确"的核对手段，也是未支持类型的兜底展示 */
function ChartDataTable({ columns, rows, defaultOpen }: ChartDataTableProps) {
  const { t } = useI18n();
  const limit = 200;
  const visible = rows.slice(0, limit);
  const summary =
    rows.length > limit
      ? t('viz.table.summaryTruncated', { count: rows.length, values: { limit } })
      : t('viz.table.summary', { count: rows.length });
  return (
    <details className="chart-table" open={defaultOpen}>
      <summary>{summary}</summary>
      <div className="chart-table__scroll">
        {columns.length === 0 ? (
          <p className="text-muted">{t('viz.table.noColumns')}</p>
        ) : (
          <table className="chart-table__table">
            <thead>
              <tr>
                {columns.map((column, index) => (
                  <th key={`${index}-${column.name}`}>
                    <span className="mono">{column.name}</span>
                    <small>{column.dataType}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {columns.map((_column, columnIndex) => {
                    const cell = row[columnIndex] ?? null;
                    return (
                      <td key={columnIndex} className="mono">
                        {cell === null ? (
                          <span className="cell-null">(NULL)</span>
                        ) : (
                          cellToLabel(cell, { emptyLabel: t('viz.cell.emptyString') })
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </details>
  );
}

function EmptyPanel({ reason, hintKey }: { reason: ChartEmptyReason; hintKey?: MessageKey }) {
  const { t } = useI18n();
  return (
    <div className="chart-empty">
      <Icon name="info" size={22} />
      <h3>{t('viz.empty.title')}</h3>
      <p>{t(EMPTY_MESSAGE_KEYS[reason])}</p>
      {hintKey ? <p className="text-muted">{t(hintKey)}</p> : null}
    </div>
  );
}

function UnsupportedPanel({ chartType }: { chartType: string }) {
  const { t } = useI18n();
  return (
    <div className="chart-placeholder">
      <Icon name="alert" size={22} />
      <h3>{t('viz.unsupported.title')}</h3>
      <p>
        {t('viz.unsupported.prefix')}
        {chartTypeLabel(t, chartType)}
        {t('viz.unsupported.codePrefix')}
        <span className="mono">{chartType}</span>
        {t('viz.unsupported.suffix')}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ 坐标轴公共片段 */

function GridLines({
  ticks,
  yToPx,
  left,
  right,
}: {
  ticks: number[];
  yToPx: (value: number) => number;
  left: number;
  right: number;
}) {
  const { formatCompactNumber } = useI18n();
  return (
    <>
      {ticks.map((tick) => {
        const y = yToPx(tick);
        return (
          <g key={`grid-${tick}`}>
            <line className="chart-grid" x1={left} y1={y} x2={right} y2={y} />
            <text className="chart-tick" x={left - 8} y={y} textAnchor="end" dominantBaseline="middle">
              {formatCompactNumber(tick)}
            </text>
          </g>
        );
      })}
    </>
  );
}

function VerticalGridLines({
  ticks,
  xToPx,
  top,
  bottom,
}: {
  ticks: number[];
  xToPx: (value: number) => number;
  top: number;
  bottom: number;
}) {
  const { formatCompactNumber } = useI18n();
  return (
    <>
      {ticks.map((tick) => {
        const x = xToPx(tick);
        return (
          <g key={`vgrid-${tick}`}>
            <line className="chart-grid" x1={x} y1={top} x2={x} y2={bottom} />
            <text className="chart-tick" x={x} y={bottom + 18} textAnchor="middle">
              {formatCompactNumber(tick)}
            </text>
          </g>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ 柱状 / 折线 / 面积 */

function CartesianChart({
  model,
  geometry,
  variant,
}: {
  model: ChartModel;
  geometry: CartesianGeometry;
  variant: 'column' | 'line' | 'area';
}) {
  const { t, formatNumber } = useI18n();
  const rects = useMemo(
    () => (variant === 'column' ? buildColumnRects(geometry) : []),
    [geometry, variant],
  );
  const { frame, scale } = geometry;
  // 分类过多时每隔 n 个显示一个标签，避免文字互相压盖
  const labelStep = Math.max(1, Math.ceil(geometry.bands.length / 24));
  const yTitle = model.series.length === 1 ? model.series[0].name : t('viz.axis.value');
  const showPoints = variant !== 'column' && geometry.bands.length <= 60;

  return (
    <>
      <GridLines ticks={scale.ticks} yToPx={geometry.yToPx} left={frame.left} right={frame.right} />

      <line className="chart-axis" x1={frame.left} y1={frame.bottom} x2={frame.right} y2={frame.bottom} />
      <line className="chart-axis" x1={frame.left} y1={frame.top} x2={frame.left} y2={frame.bottom} />

      {geometry.bands.map((band, index) =>
        index % labelStep === 0 ? (
          <text
            key={`band-${index}-${band.label}`}
            className="chart-tick"
            x={band.center}
            y={frame.bottom + 18}
            textAnchor="middle"
          >
            {truncateLabel(band.label, 10)}
          </text>
        ) : null,
      )}

      {rects.map((rect, index) => (
        <rect
          key={`bar-${rect.seriesIndex}-${rect.categoryIndex}-${index}`}
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          fill={rect.color}
          rx={2}
        >
          <title>
            {t('viz.tooltip.labelSeriesValue', {
              values: { label: rect.label, series: rect.seriesName, value: formatNumber(rect.value) },
            })}
          </title>
        </rect>
      ))}

      {variant !== 'column'
        ? geometry.series.map((series) =>
            splitSegments(series.points).map((segment, segmentIndex) => {
              if (variant === 'area') {
                const first = segment[0];
                const last = segment[segment.length - 1];
                const areaPath = [
                  `M ${first.x} ${geometry.baselineY}`,
                  ...segment.map((point) => `L ${point.x} ${point.y}`),
                  `L ${last.x} ${geometry.baselineY}`,
                  'Z',
                ].join(' ');
                return (
                  <path
                    key={`area-${series.name}-${segmentIndex}`}
                    d={areaPath}
                    fill={series.color}
                    fillOpacity={0.18}
                    stroke="none"
                  />
                );
              }
              return (
                <polyline
                  key={`line-${series.name}-${segmentIndex}`}
                  className="chart-line"
                  points={segment.map((point) => `${point.x},${point.y}`).join(' ')}
                  fill="none"
                  stroke={series.color}
                />
              );
            }),
          )
        : null}

      {showPoints
        ? geometry.series.map((series) =>
            series.points.map((point, index) =>
              point === null ? null : (
                <circle
                  key={`dot-${series.name}-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r={2.8}
                  fill={series.color}
                >
                  <title>
                    {t('viz.tooltip.labelSeriesValue', {
                      values: {
                        label: geometry.bands[index]?.label ?? '',
                        series: series.name,
                        value: formatNumber(point.value),
                      },
                    })}
                  </title>
                </circle>
              ),
            ),
          )
        : null}

      <text
        className="chart-axis-title"
        x={(frame.left + frame.right) / 2}
        y={frame.height - 10}
        textAnchor="middle"
      >
        {geometry.categoryName}
      </text>
      <text
        className="chart-axis-title"
        transform={`rotate(-90 14 ${(frame.top + frame.bottom) / 2})`}
        x={14}
        y={(frame.top + frame.bottom) / 2}
        textAnchor="middle"
      >
        {yTitle}
      </text>
    </>
  );
}

/* ------------------------------------------------------------------ 条形图（横向） */

function HorizontalBarChart({ model, geometry }: { model: ChartModel; geometry: HorizontalBarGeometry }) {
  const { t, formatNumber } = useI18n();
  const rects = useMemo(() => buildBarRects(geometry), [geometry]);
  const { frame, scale } = geometry;
  const labelStep = Math.max(1, Math.ceil(geometry.bands.length / 20));

  return (
    <>
      <VerticalGridLines ticks={scale.ticks} xToPx={geometry.xToPx} top={frame.top} bottom={frame.bottom} />

      {geometry.bands.map((band, index) =>
        index % labelStep === 0 ? (
          <text
            key={`hband-${index}-${band.label}`}
            className="chart-tick"
            x={frame.left - 8}
            y={band.center}
            textAnchor="end"
            dominantBaseline="middle"
          >
            {truncateLabel(band.label, 10)}
          </text>
        ) : null,
      )}

      <line className="chart-axis" x1={frame.left} y1={frame.top} x2={frame.left} y2={frame.bottom} />
      <line className="chart-axis" x1={frame.left} y1={frame.bottom} x2={frame.right} y2={frame.bottom} />

      {rects.map((rect, index) => (
        <rect
          key={`hbar-${rect.seriesIndex}-${rect.categoryIndex}-${index}`}
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          fill={rect.color}
          rx={2}
        >
          <title>
            {t('viz.tooltip.labelSeriesValue', {
              values: { label: rect.label, series: rect.seriesName, value: formatNumber(rect.value) },
            })}
          </title>
        </rect>
      ))}

      <text
        className="chart-axis-title"
        x={(frame.left + frame.right) / 2}
        y={frame.height - 10}
        textAnchor="middle"
      >
        {model.series.length === 1 ? model.series[0].name : t('viz.axis.value')}
      </text>
      <text
        className="chart-axis-title"
        transform={`rotate(-90 14 ${(frame.top + frame.bottom) / 2})`}
        x={14}
        y={(frame.top + frame.bottom) / 2}
        textAnchor="middle"
      >
        {model.categoryName}
      </text>
    </>
  );
}

/* ------------------------------------------------------------------ 饼图 / 环形图 */

/** 百分比统一保留 2 位小数后再交给本地化数字格式化，避免出现 33.333333% */
function formatPercent(ratio: number, formatNumber: (value: number) => string): string {
  return formatNumber(Number((ratio * 100).toFixed(2)));
}

function PieChart({ geometry, donut }: { geometry: PieGeometry; donut: boolean }) {
  const { t, formatNumber, formatCompactNumber } = useI18n();
  return (
    <>
      {geometry.slices.map((slice) => (
        <path
          key={`slice-${slice.label}-${slice.startAngle}`}
          d={slice.path}
          fill={slice.color}
          stroke="var(--color-surface)"
          strokeWidth={1.5}
        >
          <title>
            {t('viz.tooltip.slice', {
              values: {
                label: slice.label,
                value: formatNumber(slice.value),
                percent: formatPercent(slice.percent, formatNumber),
              },
            })}
          </title>
        </path>
      ))}
      {donut ? (
        <>
          <text className="chart-donut-total" x={geometry.cx} y={geometry.cy - 2} textAnchor="middle">
            {formatCompactNumber(geometry.total)}
          </text>
          <text className="chart-donut-label" x={geometry.cx} y={geometry.cy + 18} textAnchor="middle">
            {t('viz.donut.totalLabel', { values: { series: geometry.seriesName } })}
          </text>
        </>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ 散点图 */

function ScatterChart({ model, geometry }: { model: ChartModel; geometry: ScatterGeometry }) {
  const { t, formatNumber } = useI18n();
  const { frame, xScale, yScale } = geometry;
  return (
    <>
      <GridLines ticks={yScale.ticks} yToPx={geometry.yToPx} left={frame.left} right={frame.right} />
      <VerticalGridLines ticks={xScale.ticks} xToPx={geometry.xToPx} top={frame.top} bottom={frame.bottom} />

      <line className="chart-axis" x1={frame.left} y1={frame.bottom} x2={frame.right} y2={frame.bottom} />
      <line className="chart-axis" x1={frame.left} y1={frame.top} x2={frame.left} y2={frame.bottom} />

      {geometry.series.map((series) =>
        series.points.map((point, index) => (
          <circle
            key={`scatter-${series.name}-${index}`}
            cx={point.x}
            cy={point.y}
            r={3.4}
            fill={series.color}
            fillOpacity={0.78}
          >
            <title>
              {t('viz.tooltip.seriesValue', {
                values: { series: series.name, value: formatNumber(point.value) },
              })}
            </title>
          </circle>
        )),
      )}

      <text
        className="chart-axis-title"
        x={(frame.left + frame.right) / 2}
        y={frame.height - 10}
        textAnchor="middle"
      >
        {geometry.xName}
      </text>
      <text
        className="chart-axis-title"
        transform={`rotate(-90 14 ${(frame.top + frame.bottom) / 2})`}
        x={14}
        y={(frame.top + frame.bottom) / 2}
        textAnchor="middle"
      >
        {model.series.length === 1 ? model.series[0].name : t('viz.axis.value')}
      </text>
    </>
  );
}

/* ------------------------------------------------------------------ 雷达图 */

function RadarChart({ model, geometry }: { model: ChartModel; geometry: RadarGeometry }) {
  const { t, formatNumber } = useI18n();
  const { cx, cy } = geometry;
  const labelRadius = geometry.radius + 16;

  return (
    <>
      {geometry.rings.map((ring) => (
        <polygon key={`ring-${ring.value}`} className="chart-grid-fill" points={ring.points} />
      ))}
      {geometry.indicators.map((indicator) => {
        const angle = indicator.angle;
        const lx = cx + labelRadius * Math.cos(angle);
        const ly = cy + labelRadius * Math.sin(angle);
        const anchor = Math.abs(lx - cx) < 1 ? 'middle' : lx > cx ? 'start' : 'end';
        return (
          <g key={`indicator-${indicator.label}`}>
            <line className="chart-grid" x1={cx} y1={cy} x2={indicator.x} y2={indicator.y} />
            <text className="chart-tick" x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle">
              {truncateLabel(indicator.label, 8)}
            </text>
          </g>
        );
      })}

      {geometry.series.map((series) => (
        <g key={`radar-${series.name}`}>
          {series.vertices.length >= 3 ? (
            <polygon
              points={series.points}
              fill={series.color}
              fillOpacity={0.16}
              stroke={series.color}
              strokeWidth={1.8}
            />
          ) : null}
          {series.vertices.map((vertex) => (
            <circle
              key={`radar-dot-${series.name}-${vertex.index}`}
              cx={vertex.x}
              cy={vertex.y}
              r={2.6}
              fill={series.color}
            >
              <title>
                {t('viz.tooltip.seriesCategoryValue', {
                  values: {
                    series: series.name,
                    category: model.categories[vertex.index] ?? '',
                    value: formatNumber(vertex.value),
                  },
                })}
              </title>
            </circle>
          ))}
        </g>
      ))}
    </>
  );
}

/**
 * 平行坐标图：每根竖直轴是一个指标列（各自归一化），每行数据是一条折线。
 * 缺值处断线而不是跨过缺值直连 —— 后者会画出并不存在的趋势。
 */
function ParallelChart({ geometry }: { geometry: ParallelGeometry }) {
  const { t, formatCompactNumber, formatNumber } = useI18n();
  const first = geometry.axes[0];
  const last = geometry.axes[geometry.axes.length - 1];
  const top = first && last ? Math.min(...geometry.axes.flatMap((axis) => axis.ticks.map((tick) => tick.y))) : 0;

  return (
    <>
      {geometry.axes.map((axis) => (
        <g key={`axis-${axis.name}`}>
          <line
            className="chart-axis"
            x1={axis.x}
            y1={top - 6}
            x2={axis.x}
            y2={Math.max(...axis.ticks.map((tick) => tick.y)) + 6}
          />
          {axis.ticks.map((tick) => (
            <g key={`tick-${axis.name}-${tick.value}`}>
              <line className="chart-grid" x1={axis.x - 4} y1={tick.y} x2={axis.x + 4} y2={tick.y} />
              <text className="chart-tick" x={axis.x} y={tick.y} textAnchor="middle" dominantBaseline="middle">
                {formatCompactNumber(tick.value)}
              </text>
            </g>
          ))}
          <text className="chart-axis-label" x={axis.x} y={CHART_VIEW_HEIGHT - 30} textAnchor="middle">
            {truncateLabel(axis.name, 10)}
          </text>
        </g>
      ))}

      {geometry.lines.map((line, index) => (
        <g key={`parallel-${index}`}>
          {line.segments.map((points, segmentIndex) => (
            <polyline
              key={`seg-${index}-${segmentIndex}`}
              className="chart-parallel-line"
              points={points}
              stroke={line.color}
              strokeWidth={1.6}
              fill="none"
              strokeOpacity={0.72}
            >
              <title>{line.label}</title>
            </polyline>
          ))}
          {/* 顶点单独画：某个轴缺值导致无法连线时，该行在这根轴上的值仍然可见 */}
          {line.vertices.map((vertex) => (
            <circle
              key={`pv-${index}-${vertex.axisIndex}`}
              cx={vertex.x}
              cy={vertex.y}
              r={2.2}
              fill={line.color}
              fillOpacity={0.85}
            >
              <title>
                {t('viz.tooltip.labelSeriesValue', {
                  values: {
                    label: line.label,
                    series: geometry.axes[vertex.axisIndex]?.name ?? '',
                    value: formatNumber(vertex.value),
                  },
                })}
              </title>
            </circle>
          ))}
        </g>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ 几何预计算 */

interface GeometryBundle {
  model: ChartModel;
  cartesian: CartesianGeometry | null;
  horizontal: HorizontalBarGeometry | null;
  pie: PieGeometry | null;
  scatter: ScatterGeometry | null;
  radar: RadarGeometry | null;
  parallel: ParallelGeometry | null;
}

/**
 * 一次性算出当前图表类型需要的几何，供"是否为空"判定与实际渲染共用，
 * 避免同一份数据被重复计算，也让空态判定集中在主组件里。
 * `emptyLabel` 是空字符串分类值的占位文案，由组件从语言包传入。
 */
function computeGeometry(data: ChartDataDTO, emptyLabel: string): GeometryBundle {
  const model = buildChartModel(data, { emptyLabel });
  const usable = model.emptyReason === null;
  const type = data.chartType;
  if (!usable) {
    return { model, cartesian: null, horizontal: null, pie: null, scatter: null, radar: null, parallel: null };
  }
  return {
    model,
    cartesian:
      type === 'column' || type === 'line' || type === 'area' ? buildCartesianGeometry(model) : null,
    horizontal: type === 'bar' ? buildBarGeometry(model) : null,
    pie:
      type === 'pie' || type === 'donut'
        ? buildPieGeometry(model, {
            rInner: type === 'donut' ? Math.max(12, Math.min(CHART_VIEW_WIDTH, CHART_VIEW_HEIGHT) / 2 - 26) * 0.58 : 0,
          })
        : null,
    scatter: type === 'scatter' ? buildScatterGeometry(data) : null,
    radar: type === 'radar' ? buildRadarGeometry(model) : null,
    parallel: type === 'parallel' ? buildParallelGeometry(model) : null,
  };
}

interface EmptyDescriptor {
  reason: ChartEmptyReason;
  /** 类型特有的补充说明，指向语言包键；具体句子在 viz.ts */
  hintKey?: MessageKey;
}

/** 类型特有的空态（如只有一个扇区、雷达维度不足）在这里统一判定 */
function emptyDescriptorFor(bundle: GeometryBundle): EmptyDescriptor | null {
  if (bundle.model.emptyReason !== null) {
    return { reason: bundle.model.emptyReason };
  }
  if (bundle.pie && bundle.pie.slices.length === 0) {
    return { reason: 'no-numeric-metric', hintKey: 'viz.empty.pieNeedsPositive' };
  }
  if (bundle.scatter && bundle.scatter.pointCount === 0) {
    return { reason: 'no-numeric-metric', hintKey: 'viz.empty.scatterNeedsNumeric' };
  }
  if (bundle.parallel && bundle.parallel.axes.length < 2) {
    return { reason: 'insufficient-columns', hintKey: 'viz.empty.parallelNeedsMetrics' };
  }
  if (bundle.radar && bundle.radar.indicators.length < 3) {
    return { reason: 'insufficient-columns', hintKey: 'viz.empty.radarNeedsDimensions' };
  }
  return null;
}

function legendFor(
  data: ChartDataDTO,
  bundle: GeometryBundle,
  t: StrictTranslateFn,
  formatNumber: (value: number) => string,
): LegendItem[] {
  const { model } = bundle;
  if (data.chartType === 'pie' || data.chartType === 'donut') {
    const series = model.series[0];
    const total = bundle.pie ? bundle.pie.total : 0;
    if (!series || total <= 0) {
      return [];
    }
    const items: LegendItem[] = [];
    series.values.forEach((value, index) => {
      if (value === null || value <= 0) {
        return;
      }
      items.push({
        label: model.categories[index] ?? `#${index + 1}`,
        color: chartColor(items.length),
        value: t('viz.legend.sliceValue', {
          values: { value: formatNumber(value), percent: formatPercent(value / total, formatNumber) },
        }),
      });
    });
    return items;
  }
  if (bundle.scatter) {
    return bundle.scatter.series.map((series) => ({ label: series.name, color: series.color }));
  }
  if (bundle.parallel) {
    // 平行坐标图的"图例"是各根轴（颜色按行区分，行数太多时列颜色没有意义）
    return bundle.parallel.axes.map((axis, index) => ({
      label: axis.name,
      color: chartColor(index),
    }));
  }
  return model.series.map((series, index) => ({ label: series.name, color: chartColor(index) }));
}

function skippedFor(data: ChartDataDTO, bundle: GeometryBundle): number {
  if (data.chartType === 'pie' || data.chartType === 'donut') {
    const series = bundle.model.series[0];
    if (!series) {
      return 0;
    }
    return series.values.filter((value) => value === null || value <= 0).length;
  }
  if (bundle.scatter) {
    return bundle.scatter.skipped;
  }
  if (bundle.parallel) {
    return bundle.parallel.skippedRows + bundle.model.skipped;
  }
  return bundle.model.skipped;
}

/* ------------------------------------------------------------------ 主组件 */

export function ChartRenderer({ data, height = CHART_VIEW_HEIGHT }: ChartRendererProps) {
  const { t, formatNumber } = useI18n();
  const bundle = useMemo(() => computeGeometry(data, t('viz.cell.emptyString')), [data, t]);
  const supported = isChartTypeSupported(data.chartType);
  const empty = supported ? emptyDescriptorFor(bundle) : null;
  const canDraw = supported && empty === null;
  const legend = canDraw ? legendFor(data, bundle, t, formatNumber) : [];
  const skipped = canDraw ? skippedFor(data, bundle) : 0;
  const needsPositiveNote = data.chartType === 'pie' || data.chartType === 'donut';

  const renderSvgChildren = () => {
    switch (data.chartType) {
      case 'column':
        return bundle.cartesian ? (
          <CartesianChart model={bundle.model} geometry={bundle.cartesian} variant="column" />
        ) : null;
      case 'line':
        return bundle.cartesian ? (
          <CartesianChart model={bundle.model} geometry={bundle.cartesian} variant="line" />
        ) : null;
      case 'area':
        return bundle.cartesian ? (
          <CartesianChart model={bundle.model} geometry={bundle.cartesian} variant="area" />
        ) : null;
      case 'bar':
        return bundle.horizontal ? (
          <HorizontalBarChart model={bundle.model} geometry={bundle.horizontal} />
        ) : null;
      case 'pie':
        return bundle.pie ? <PieChart geometry={bundle.pie} donut={false} /> : null;
      case 'donut':
        return bundle.pie ? <PieChart geometry={bundle.pie} donut /> : null;
      case 'scatter':
        return bundle.scatter ? <ScatterChart model={bundle.model} geometry={bundle.scatter} /> : null;
      case 'radar':
        return bundle.radar ? <RadarChart model={bundle.model} geometry={bundle.radar} /> : null;
      case 'parallel':
        return bundle.parallel ? <ParallelChart geometry={bundle.parallel} /> : null;
      default:
        return null;
    }
  };

  return (
    <figure className="chart-figure">
      <figcaption className="chart-figure__caption">
        <span className="badge badge--info">{chartTypeLabel(t, data.chartType)}</span>
        <span className="chart-figure__meta">
          {t('viz.caption.meta', {
            values: {
              rows: data.rowCount,
              columns: data.columns.length,
              duration: formatDuration(data.durationMs),
            },
          })}
        </span>
        {data.truncated ? <span className="badge badge--warning">{t('common.truncated')}</span> : null}
      </figcaption>

      {!supported ? <UnsupportedPanel chartType={data.chartType} /> : null}

      {supported && empty ? <EmptyPanel reason={empty.reason} hintKey={empty.hintKey} /> : null}

      {canDraw ? (
        <div className="chart-canvas">
          <svg
            className="chart-svg"
            viewBox={`0 0 ${CHART_VIEW_WIDTH} ${height}`}
            role="img"
            aria-label={t('viz.aria.chart', {
              values: { type: chartTypeLabel(t, data.chartType), category: bundle.model.categoryName },
            })}
            preserveAspectRatio="xMidYMid meet"
          >
            {renderSvgChildren()}
          </svg>
        </div>
      ) : null}

      {canDraw ? <ChartLegend items={legend} /> : null}

      {canDraw && skipped > 0 ? (
        <p className="chart-note">
          <Icon name="info" size={13} />{' '}
          {t(needsPositiveNote ? 'viz.note.skippedPositive' : 'viz.note.skipped', { count: skipped })}
        </p>
      ) : null}

      <ChartDataTable
        columns={data.columns}
        rows={data.rows}
        defaultOpen={!supported || empty !== null}
      />
    </figure>
  );
}
