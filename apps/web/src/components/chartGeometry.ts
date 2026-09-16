/**
 * 花生苗数据库管理工具 - 图表几何计算（纯函数，不依赖 React）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 为什么单独抽一层：`ChartRenderer.tsx` 只负责把这里的几何结果翻译成 SVG 元素，
 * 而坐标缩放、刻度取整、扇区路径、极坐标这些最容易算错的部分全部是无副作用纯函数，
 * 可以直接在 Node 环境跑单元测试（Web 端没有 jsdom / 浏览器测试环境）。
 *
 * 约定：所有尺寸都在 viewBox 坐标系（默认 880x420）内，组件用 preserveAspectRatio
 * 交给浏览器缩放，避免写死像素宽度。
 *
 * 另约定：本模块是**纯函数**，不得产出任何面向用户的语言文案 ——
 * 空态只返回稳定的 `ChartEmptyReason` 枚举与相关数值，格式化好的文案由
 * `ChartRenderer.tsx` 用 `t(...)` 翻译；确实需要的标签（如空字符串占位）由调用方传入。
 */

import type { QueryColumnDTO } from '../api/types';

/* ------------------------------------------------------------------ 常量与调色板 */

/** 默认 viewBox 尺寸：宽高比接近 2:1，配合 CSS width:100% 自适应容器 */
export const CHART_VIEW_WIDTH = 880;
export const CHART_VIEW_HEIGHT = 420;

/**
 * 系列配色走主题 CSS 变量（global.css 里 light/dark 各定义一份），
 * 这样深浅色主题切换时图表颜色自动跟随，无需在 TS 里判断主题。
 */
export const CHART_COLOR_VARS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
] as const;

/** 按序号取系列色，越界后循环取用 */
export function chartColor(index: number): string {
  const size = CHART_COLOR_VARS.length;
  const normalized = ((index % size) + size) % size;
  return CHART_COLOR_VARS[normalized];
}

/** 浏览器内真正实现了 SVG 渲染的图表类型 */
export const SUPPORTED_CHART_TYPES = [
  'bar',
  'column',
  'line',
  'area',
  'pie',
  'donut',
  'scatter',
  'radar',
  'parallel',
] as const;

/**
 * 暂未实现浏览器内渲染的类型。
 * 这些类型仍然可以创建、保存、取数，界面会给出明确说明 + 原始数据表，
 * 而不是画一张似是而非的图（诚实优先于"看起来支持"）。
 */
export const UNSUPPORTED_CHART_TYPES = [
  'bubble',
  'heatmap',
  'sankey',
  'treemap',
  'boxplot',
  'map',
] as const;

export function isChartTypeSupported(type: string): boolean {
  return (SUPPORTED_CHART_TYPES as readonly string[]).includes(type);
}

/* ------------------------------------------------------------------ 单元格解析 */

/**
 * 把单元格解析成有限数值：
 *  - number / bigint 直接接受；
 *  - string 仅在整体是十进制数字时才接受（避免 Number('') === 0、
 *    Number('0x10') === 16 这类宽松转换把明显非数值的文本画进图里）；
 *  - NULL / undefined / 布尔 / 对象一律返回 null（由调用方计入"已跳过"）。
 */
export function parseNumericCell(cell: unknown): number | null {
  if (typeof cell === 'number') {
    return Number.isFinite(cell) ? cell : null;
  }
  if (typeof cell === 'bigint') {
    const value = Number(cell);
    return Number.isFinite(value) ? value : null;
  }
  if (typeof cell === 'string') {
    const trimmed = cell.trim();
    if (trimmed.length === 0) {
      return null;
    }
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) {
      return null;
    }
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

/**
 * 单元格 → 分类轴标签；NULL 显式标注而不是变成空字符串。
 * 空字符串是一项**文案**，纯函数不内置中文，由调用方通过 `emptyLabel` 传入。
 */
export function cellToLabel(cell: unknown, options: { emptyLabel?: string } = {}): string {
  if (cell === null || cell === undefined) {
    return '(NULL)';
  }
  if (typeof cell === 'number') {
    return formatNumber(cell, 6);
  }
  if (typeof cell === 'string') {
    return cell.length > 0 ? cell : (options.emptyLabel ?? '');
  }
  if (typeof cell === 'boolean') {
    return cell ? 'true' : 'false';
  }
  return String(cell);
}

/* ------------------------------------------------------------------ 数值格式化 */

export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  const factor = Math.pow(10, Math.max(0, Math.min(12, decimals)));
  return Math.round(value * factor) / factor;
}

function trimTrailingZeros(text: string): string {
  if (!text.includes('.')) {
    return text;
  }
  return text.replace(/0+$/, '').replace(/\.$/, '');
}

function groupThousands(text: string): string {
  if (/[eE]/.test(text)) {
    return text;
  }
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  const dot = body.indexOf('.');
  const intPart = dot === -1 ? body : body.slice(0, dot);
  const fracPart = dot === -1 ? '' : body.slice(dot);
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${fracPart}`;
}

/** 通用数字格式化：去掉无意义的尾随 0，整数部分加千分位 */
export function formatNumber(value: number, maxDecimals = 4): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  const safeDecimals = Math.max(0, Math.min(12, maxDecimals));
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-6)) {
    return value.toExponential(2);
  }
  return groupThousands(trimTrailingZeros(value.toFixed(safeDecimals)));
}

// 坐标轴刻度的紧凑格式原先在这里产出「万 / 亿」单位文案；
// 单位是最典型的本地化文案，已改由组件从 useI18n() 取 formatCompactNumber。

/** 分类轴标签过长会互相压字，统一截断并给出省略号 */
export function truncateLabel(text: string, max = 12): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max)}…`;
}

/* ------------------------------------------------------------------ 刻度 */

export interface NiceScale {
  min: number;
  max: number;
  step: number;
  ticks: number[];
  decimals: number;
}

/** step 需要保留的小数位：0.5 → 1，0.05 → 2，整数 → 0 */
export function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) {
    return 0;
  }
  const exponent = Math.floor(Math.log10(step) + 1e-9);
  return exponent >= 0 ? 0 : Math.min(8, -exponent);
}

/**
 * 生成"好看"的刻度：步长收敛到 1/2/5 × 10^n，
 * 并把上下界扩到步长的整数倍，保证网格线落在整齐的数值上。
 */
export function niceTicks(rawMin: number, rawMax: number, targetCount = 5): NiceScale {
  let min = Math.min(rawMin, rawMax);
  let max = Math.max(rawMin, rawMax);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  }
  if (min === max) {
    // 所有数值相同：以该值为中心展开区间，否则柱高/折线会退化成一个点
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.5 : 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const rawStep = span / Math.max(1, targetCount);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / magnitude;
  const niceResidual = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  const step = niceResidual * magnitude;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const decimals = decimalsOf(step);
  const count = Math.max(1, Math.round((niceMax - niceMin) / step));
  const ticks: number[] = [];
  for (let index = 0; index <= count; index += 1) {
    // 浮点累加会产生 0.30000000000000004，按 step 的小数位收敛
    ticks.push(roundTo(niceMin + index * step, decimals + 2));
  }
  return { min: niceMin, max: niceMax, step, ticks, decimals };
}

/** 所有系列值的实际极值；没有数值时返回 null */
export function valueExtent(values: Array<Array<number | null>>): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const series of values) {
    for (const value of series) {
      if (value === null) {
        continue;
      }
      if (value < min) {
        min = value;
      }
      if (value > max) {
        max = value;
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }
  return { min, max };
}

/** 由系列值构造数值轴刻度；includeZero 让柱/面积图始终有 0 基线 */
export function buildValueScale(
  values: Array<Array<number | null>>,
  options: { includeZero?: boolean; targetCount?: number } = {},
): NiceScale {
  const extent = valueExtent(values);
  if (!extent) {
    return niceTicks(0, 1, options.targetCount ?? 5);
  }
  let { min, max } = extent;
  if (options.includeZero !== false) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  return niceTicks(min, max, options.targetCount ?? 5);
}

/* ------------------------------------------------------------------ 数据模型 */

/**
 * 空态原因。这里只保留稳定的枚举，**不携带任何用户可见文案**；
 * 「原因 → 句子」的映射与翻译都在 `viz.ts` / `ChartRenderer.tsx` 里。
 */
export type ChartEmptyReason =
  | 'no-columns'
  | 'no-rows'
  | 'insufficient-columns'
  | 'no-numeric-metric';

export interface ChartDataInput {
  chartType: string;
  columns: QueryColumnDTO[];
  rows: Array<Array<unknown>>;
}

export interface ChartSeriesModel {
  name: string;
  columnIndex: number;
  values: Array<number | null>;
}

export interface ChartModel {
  /** 分类轴标签（来自第 0 列） */
  categories: string[];
  /** 第 0 列的列名，用作分类轴标题 */
  categoryName: string;
  series: ChartSeriesModel[];
  /** 参与判断的指标单元格总数（含被跳过的） */
  cellCount: number;
  /** NULL / 非数值而被跳过的指标单元格数 */
  skipped: number;
  emptyReason: ChartEmptyReason | null;
}

/**
 * 通用模型：第 0 列当分类轴，其余列里"至少有一个可用数值"的列当指标系列。
 * 服务端生成 SQL 时维度在前、指标在后，所以这个推断与配置一致；
 * 真正没有数值的列会被丢弃并计入 skipped，避免画出一条全空的线。
 *
 * `emptyLabel` 用于空字符串分类值的占位文案，由组件传入当前语言的说法。
 */
export function buildChartModel(
  data: ChartDataInput,
  options: { emptyLabel?: string } = {},
): ChartModel {
  const columns = data.columns ?? [];
  const rows = data.rows ?? [];
  const base: ChartModel = {
    categories: [],
    categoryName: columns.length > 0 ? columns[0].name : '',
    series: [],
    cellCount: 0,
    skipped: 0,
    emptyReason: null,
  };

  if (columns.length === 0) {
    return { ...base, emptyReason: 'no-columns' };
  }
  if (rows.length === 0) {
    return { ...base, emptyReason: 'no-rows' };
  }
  if (columns.length < 2) {
    return { ...base, emptyReason: 'insufficient-columns' };
  }

  const categories = rows.map((row) => cellToLabel(row[0], { emptyLabel: options.emptyLabel }));
  const series: ChartSeriesModel[] = [];
  let cellCount = 0;
  let skipped = 0;

  for (let columnIndex = 1; columnIndex < columns.length; columnIndex += 1) {
    const values: Array<number | null> = [];
    let numericCount = 0;
    for (const row of rows) {
      const parsed = parseNumericCell(row[columnIndex]);
      cellCount += 1;
      if (parsed === null) {
        skipped += 1;
        values.push(null);
      } else {
        numericCount += 1;
        values.push(parsed);
      }
    }
    if (numericCount > 0) {
      series.push({ name: columns[columnIndex].name, columnIndex, values });
    }
  }

  if (series.length === 0) {
    return { ...base, categories, cellCount, skipped, emptyReason: 'no-numeric-metric' };
  }
  return { ...base, categories, series, cellCount, skipped, emptyReason: null };
}

/* ------------------------------------------------------------------ 画布框架 */

export interface PlotMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PlotFrame {
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  innerWidth: number;
  innerHeight: number;
}

export const DEFAULT_PLOT_MARGINS: PlotMargins = { top: 18, right: 22, bottom: 56, left: 68 };

export function makeFrame(
  width: number,
  height: number,
  margins: PlotMargins = DEFAULT_PLOT_MARGINS,
): PlotFrame {
  return {
    width,
    height,
    left: margins.left,
    top: margins.top,
    right: width - margins.right,
    bottom: height - margins.bottom,
    innerWidth: Math.max(1, width - margins.left - margins.right),
    innerHeight: Math.max(1, height - margins.top - margins.bottom),
  };
}

/* ------------------------------------------------------------------ 竖向坐标（柱状/折线/面积） */

export interface SeriesPoint {
  x: number;
  y: number;
  value: number;
  index: number;
}

export interface BandSlot {
  label: string;
  x: number;
  width: number;
  center: number;
}

export interface CartesianSeriesGeometry {
  name: string;
  color: string;
  values: Array<number | null>;
  points: Array<SeriesPoint | null>;
}

export interface CartesianGeometry {
  frame: PlotFrame;
  scale: NiceScale;
  bands: BandSlot[];
  series: CartesianSeriesGeometry[];
  baseline: number;
  baselineY: number;
  skipped: number;
  categoryName: string;
  xFor(index: number): number;
  yToPx(value: number): number;
}

/** 把空值切成多段，折线/面积在 NULL 处断开而不是错误地连成一条直线 */
export function splitSegments(points: Array<SeriesPoint | null>): SeriesPoint[][] {
  const segments: SeriesPoint[][] = [];
  let current: SeriesPoint[] = [];
  for (const point of points) {
    if (point === null) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
      continue;
    }
    current.push(point);
  }
  if (current.length > 0) {
    segments.push(current);
  }
  return segments;
}

export function buildCartesianGeometry(
  model: ChartModel,
  options: { width?: number; height?: number; includeZero?: boolean; margins?: PlotMargins } = {},
): CartesianGeometry {
  const frame = makeFrame(
    options.width ?? CHART_VIEW_WIDTH,
    options.height ?? CHART_VIEW_HEIGHT,
    options.margins ?? DEFAULT_PLOT_MARGINS,
  );
  const scale = buildValueScale(
    model.series.map((item) => item.values),
    { includeZero: options.includeZero !== false },
  );
  const span = scale.max - scale.min || 1;
  const yToPx = (value: number): number => frame.top + frame.innerHeight * (1 - (value - scale.min) / span);
  const count = Math.max(1, model.categories.length);
  const bandWidth = frame.innerWidth / count;
  const bands: BandSlot[] = model.categories.map((label, index) => {
    const x = frame.left + index * bandWidth;
    return { label, x, width: bandWidth, center: x + bandWidth / 2 };
  });
  const xFor = (index: number): number => {
    const band = bands[index];
    return band ? band.center : frame.left;
  };
  const baseline = Math.min(Math.max(0, scale.min), scale.max);
  const baselineY = yToPx(baseline);

  const series: CartesianSeriesGeometry[] = model.series.map((item, seriesIndex) => ({
    name: item.name,
    color: chartColor(seriesIndex),
    values: item.values,
    points: item.values.map((value, index) =>
      value === null ? null : { x: xFor(index), y: yToPx(value), value, index },
    ),
  }));

  return {
    frame,
    scale,
    bands,
    series,
    baseline,
    baselineY,
    skipped: model.skipped,
    categoryName: model.categoryName,
    xFor,
    yToPx,
  };
}

export interface BarRect {
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
  categoryIndex: number;
  seriesIndex: number;
  color: string;
  label: string;
  seriesName: string;
}

/** 竖向柱状图的分组柱体矩形：同一分类内的多指标并排 */
export function buildColumnRects(
  geometry: CartesianGeometry,
  groupRatio = 0.72,
): BarRect[] {
  const rects: BarRect[] = [];
  const seriesCount = Math.max(1, geometry.series.length);
  geometry.bands.forEach((band, categoryIndex) => {
    const groupWidth = band.width * groupRatio;
    const barWidth = Math.max(1, groupWidth / seriesCount);
    const offset = band.x + (band.width - groupWidth) / 2;
    geometry.series.forEach((series, seriesIndex) => {
      const point = series.points[categoryIndex];
      if (!point) {
        return;
      }
      const top = Math.min(point.y, geometry.baselineY);
      const height = Math.max(0, Math.abs(point.y - geometry.baselineY));
      rects.push({
        x: offset + seriesIndex * barWidth,
        y: top,
        width: barWidth,
        height,
        value: point.value,
        categoryIndex,
        seriesIndex,
        color: series.color,
        label: band.label,
        seriesName: series.name,
      });
    });
  });
  return rects;
}

/* ------------------------------------------------------------------ 横向坐标（条形图） */

export interface HorizontalBand {
  label: string;
  y: number;
  height: number;
  center: number;
}

export interface HorizontalBarGeometry {
  frame: PlotFrame;
  scale: NiceScale;
  bands: HorizontalBand[];
  series: CartesianSeriesGeometry[];
  baseline: number;
  baselineX: number;
  skipped: number;
  categoryName: string;
  yFor(index: number): number;
  xToPx(value: number): number;
}

export function buildBarGeometry(
  model: ChartModel,
  options: { width?: number; height?: number; includeZero?: boolean; margins?: PlotMargins } = {},
): HorizontalBarGeometry {
  const frame = makeFrame(
    options.width ?? CHART_VIEW_WIDTH,
    options.height ?? CHART_VIEW_HEIGHT,
    options.margins ?? DEFAULT_PLOT_MARGINS,
  );
  const scale = buildValueScale(
    model.series.map((item) => item.values),
    { includeZero: options.includeZero !== false },
  );
  const span = scale.max - scale.min || 1;
  const xToPx = (value: number): number => frame.left + frame.innerWidth * ((value - scale.min) / span);
  const count = Math.max(1, model.categories.length);
  const bandHeight = frame.innerHeight / count;
  const bands: HorizontalBand[] = model.categories.map((label, index) => {
    const y = frame.top + index * bandHeight;
    return { label, y, height: bandHeight, center: y + bandHeight / 2 };
  });
  const yFor = (index: number): number => {
    const band = bands[index];
    return band ? band.center : frame.top;
  };
  const baseline = Math.min(Math.max(0, scale.min), scale.max);
  const baselineX = xToPx(baseline);

  const series: CartesianSeriesGeometry[] = model.series.map((item, seriesIndex) => ({
    name: item.name,
    color: chartColor(seriesIndex),
    values: item.values,
    points: item.values.map((value, index) =>
      value === null ? null : { x: xToPx(value), y: yFor(index), value, index },
    ),
  }));

  return {
    frame,
    scale,
    bands,
    series,
    baseline,
    baselineX,
    skipped: model.skipped,
    categoryName: model.categoryName,
    yFor,
    xToPx,
  };
}

/** 条形图的分组条体矩形（横向） */
export function buildBarRects(geometry: HorizontalBarGeometry, groupRatio = 0.72): BarRect[] {
  const rects: BarRect[] = [];
  const seriesCount = Math.max(1, geometry.series.length);
  geometry.bands.forEach((band, categoryIndex) => {
    const groupHeight = band.height * groupRatio;
    const barHeight = Math.max(1, groupHeight / seriesCount);
    const offset = band.y + (band.height - groupHeight) / 2;
    geometry.series.forEach((series, seriesIndex) => {
      const point = series.points[categoryIndex];
      if (!point) {
        return;
      }
      const left = Math.min(point.x, geometry.baselineX);
      const width = Math.max(0, Math.abs(point.x - geometry.baselineX));
      rects.push({
        x: left,
        y: offset + seriesIndex * barHeight,
        width,
        height: barHeight,
        value: point.value,
        categoryIndex,
        seriesIndex,
        color: series.color,
        label: band.label,
        seriesName: series.name,
      });
    });
  });
  return rects;
}

/* ------------------------------------------------------------------ 饼图 / 环形图 */

const TAU = Math.PI * 2;

function polarPoint(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

function coord(value: number): string {
  return String(roundTo(value, 3));
}

function pointAttr(point: { x: number; y: number }): string {
  return `${coord(point.x)} ${coord(point.y)}`;
}

/**
 * 环形/扇形路径。整圆必须拆成两条半弧：SVG 的 A 指令在起点与终点重合时
 * 不会绘制任何东西（这是"只有一个扇区时饼图空白"的经典原因）。
 */
export function ringPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startAngle: number,
  endAngle: number,
): string {
  const sweep = endAngle - startAngle;
  if (!(sweep > 1e-9) || !(rOuter > 0)) {
    return '';
  }
  if (sweep >= TAU - 1e-6) {
    const mid = startAngle + Math.PI;
    return `${ringPath(cx, cy, rOuter, rInner, startAngle, mid)} ${ringPath(
      cx,
      cy,
      rOuter,
      rInner,
      mid,
      startAngle + TAU,
    )}`;
  }
  const largeArc = sweep > Math.PI ? 1 : 0;
  const outerStart = polarPoint(cx, cy, rOuter, startAngle);
  const outerEnd = polarPoint(cx, cy, rOuter, endAngle);
  if (rInner <= 0) {
    return `M ${coord(cx)} ${coord(cy)} L ${pointAttr(outerStart)} A ${coord(rOuter)} ${coord(
      rOuter,
    )} 0 ${largeArc} 1 ${pointAttr(outerEnd)} Z`;
  }
  const innerEnd = polarPoint(cx, cy, rInner, endAngle);
  const innerStart = polarPoint(cx, cy, rInner, startAngle);
  return [
    `M ${pointAttr(outerStart)}`,
    `A ${coord(rOuter)} ${coord(rOuter)} 0 ${largeArc} 1 ${pointAttr(outerEnd)}`,
    `L ${pointAttr(innerEnd)}`,
    `A ${coord(rInner)} ${coord(rInner)} 0 ${largeArc} 0 ${pointAttr(innerStart)}`,
    'Z',
  ].join(' ');
}

export interface PieSlice {
  label: string;
  value: number;
  percent: number;
  startAngle: number;
  endAngle: number;
  path: string;
  color: string;
}

export interface PieGeometry {
  cx: number;
  cy: number;
  rOuter: number;
  rInner: number;
  total: number;
  slices: PieSlice[];
  /** NULL 或非正数被跳过的扇区数 */
  skipped: number;
  seriesName: string;
}

export function buildPieGeometry(
  model: ChartModel,
  options: { width?: number; height?: number; rOuter?: number; rInner?: number } = {},
): PieGeometry {
  const width = options.width ?? CHART_VIEW_WIDTH;
  const height = options.height ?? CHART_VIEW_HEIGHT;
  const cx = width / 2;
  const cy = height / 2;
  const rOuter = options.rOuter ?? Math.max(12, Math.min(width, height) / 2 - 26);
  const rInner = options.rInner ?? 0;

  // 饼图/环形图只取第一个指标系列：多个指标叠加成扇区没有数学意义
  const series = model.series[0];
  const slices: PieSlice[] = [];
  let total = 0;
  let skipped = 0;

  if (series) {
    for (const value of series.values) {
      // NULL 与非正数都无法映射成扇区角度，明确跳过并计数
      if (value === null || value <= 0) {
        skipped += 1;
        continue;
      }
      total += value;
    }
    if (total > 0) {
      let angle = -Math.PI / 2;
      series.values.forEach((value, index) => {
        if (value === null || value <= 0) {
          return;
        }
        const endAngle = angle + (value / total) * TAU;
        slices.push({
          label: model.categories[index] ?? `#${index + 1}`,
          value,
          percent: value / total,
          startAngle: angle,
          endAngle,
          path: ringPath(cx, cy, rOuter, rInner, angle, endAngle),
          color: chartColor(slices.length),
        });
        angle = endAngle;
      });
    }
  }

  return { cx, cy, rOuter, rInner, total, slices, skipped, seriesName: series ? series.name : '' };
}

/* ------------------------------------------------------------------ 散点图 */

export interface ScatterPoint {
  x: number;
  y: number;
  value: number;
}

export interface ScatterSeriesGeometry {
  name: string;
  color: string;
  points: ScatterPoint[];
}

export interface ScatterGeometry {
  frame: PlotFrame;
  xScale: NiceScale;
  yScale: NiceScale;
  series: ScatterSeriesGeometry[];
  xName: string;
  pointCount: number;
  /** X 或 Y 非数值而被跳过的点（或整行）数 */
  skipped: number;
  xToPx(value: number): number;
  yToPx(value: number): number;
}

/**
 * 散点图：第 0 列作 X 轴，其余数值列各自成为一个 Y 系列。
 * 这样"2 个维度 + 1 个指标"的配置会画成一条 Y 系列，多指标时自动叠加。
 */
export function buildScatterGeometry(
  data: ChartDataInput,
  options: { width?: number; height?: number; margins?: PlotMargins } = {},
): ScatterGeometry {
  const frame = makeFrame(
    options.width ?? CHART_VIEW_WIDTH,
    options.height ?? CHART_VIEW_HEIGHT,
    options.margins ?? DEFAULT_PLOT_MARGINS,
  );
  const columns = data.columns ?? [];
  const rows = data.rows ?? [];
  const xName = columns.length > 0 ? columns[0].name : '';
  const seriesNames: string[] = [];
  for (let index = 1; index < columns.length; index += 1) {
    seriesNames.push(columns[index].name);
  }

  // xValues 与 yValues 必须**逐行对齐**（长度都等于 rows.length）。
  // 旧实现只在 X 可解析时才 push，导致 xValues 与 yValues 的下标语义错位：
  // 点会被画到错误的 X 上，X 非数值行之后的数据还会被整段丢弃。
  const xValues: Array<number | null> = [];
  const yValues: Array<Array<number | null>> = seriesNames.map(() => []);
  let skipped = 0;

  for (const row of rows) {
    const xv = parseNumericCell(row[0]);
    // 先占位再判空：无论 X 是否可解析都 push 一个位置，保证下标一致
    xValues.push(xv);
    if (xv === null) {
      // X 非数值则整行都无法定位，按一次跳过计数
      skipped += 1;
      for (const bucket of yValues) {
        bucket.push(null);
      }
      continue;
    }
    seriesNames.forEach((_name, seriesIndex) => {
      const yv = parseNumericCell(row[seriesIndex + 1]);
      if (yv === null) {
        skipped += 1;
      }
      yValues[seriesIndex].push(yv);
    });
  }

  const numericX = xValues.filter((value): value is number => value !== null);
  const xScale = numericX.length > 0 ? niceTicks(Math.min(...numericX), Math.max(...numericX)) : niceTicks(0, 1);
  const yScale = buildValueScale(yValues, { includeZero: false });
  const xSpan = xScale.max - xScale.min || 1;
  const ySpan = yScale.max - yScale.min || 1;
  const xToPx = (value: number): number => frame.left + frame.innerWidth * ((value - xScale.min) / xSpan);
  const yToPx = (value: number): number => frame.top + frame.innerHeight * (1 - (value - yScale.min) / ySpan);

  let pointCount = 0;
  const series: ScatterSeriesGeometry[] = [];
  seriesNames.forEach((name, seriesIndex) => {
    const points: ScatterPoint[] = [];
    yValues[seriesIndex].forEach((value, rowIndex) => {
      const x = xValues[rowIndex];
      // xValues 与各行等长，rowIndex 语义一致；X 为 null 才跳过
      if (value === null || x === null) {
        return;
      }
      points.push({ x: xToPx(x), y: yToPx(value), value });
    });
    if (points.length > 0) {
      pointCount += points.length;
      series.push({ name, color: chartColor(series.length), points });
    }
  });

  return { frame, xScale, yScale, series, xName, pointCount, skipped, xToPx, yToPx };
}

/* ------------------------------------------------------------------ 雷达图 */

export interface RadarIndicator {
  label: string;
  angle: number;
  x: number;
  y: number;
}

export interface RadarGridRing {
  value: number;
  points: string;
}

export interface RadarSeriesGeometry {
  name: string;
  color: string;
  /** 至少 3 个顶点才构成多边形 */
  points: string;
  vertices: Array<{ x: number; y: number; value: number; index: number }>;
}

export interface RadarGeometry {
  cx: number;
  cy: number;
  radius: number;
  scale: NiceScale;
  indicators: RadarIndicator[];
  rings: RadarGridRing[];
  series: RadarSeriesGeometry[];
  skipped: number;
}

/**
 * 雷达图：分类是环形上的指标轴，每个数值列是一条折线。
 * 数值域固定从 0 起（雷达图的"面积"代表量级，负值没有几何意义），
 * NULL 顶点跳过并计入 skipped。
 */
export function buildRadarGeometry(
  model: ChartModel,
  options: { width?: number; height?: number; radius?: number } = {},
): RadarGeometry {
  const width = options.width ?? CHART_VIEW_WIDTH;
  const height = options.height ?? CHART_VIEW_HEIGHT;
  const cx = width / 2;
  const cy = height / 2 + 4;
  const radius = options.radius ?? Math.max(24, Math.min(width, height) / 2 - 62);

  const count = model.categories.length;
  const scale = buildValueScale(
    model.series.map((item) => item.values),
    { includeZero: true, targetCount: 4 },
  );
  const span = scale.max - scale.min || 1;
  const radiusFor = (value: number): number => radius * Math.max(0, (value - scale.min) / span);

  const indicators: RadarIndicator[] = model.categories.map((label, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(1, count)) * TAU;
    const point = polarPoint(cx, cy, radius, angle);
    return { label, angle, x: point.x, y: point.y };
  });

  const rings: RadarGridRing[] = scale.ticks
    .filter((tick) => tick > 0)
    .map((tick) => {
      const ringRadius = radiusFor(tick);
      const points = indicators
        .map((indicator) => pointAttr(polarPoint(cx, cy, ringRadius, indicator.angle)))
        .join(' ');
      return { value: tick, points };
    });

  let skipped = 0;
  const series: RadarSeriesGeometry[] = model.series.map((item, seriesIndex) => {
    const vertices: Array<{ x: number; y: number; value: number; index: number }> = [];
    item.values.forEach((value, index) => {
      if (value === null) {
        skipped += 1;
        return;
      }
      const point = polarPoint(cx, cy, radiusFor(value), indicators[index]?.angle ?? 0);
      vertices.push({ x: point.x, y: point.y, value, index });
    });
    return {
      name: item.name,
      color: chartColor(seriesIndex),
      points: vertices.map((vertex) => pointAttr(vertex)).join(' '),
      vertices,
    };
  });

  return { cx, cy, radius, scale, indicators, rings, series, skipped };
}

/* ------------------------------------------------------------------ 平行坐标图 */

export interface ParallelAxis {
  /** 指标列名，也是轴标题 */
  name: string;
  /** 轴自身的数值区间（每根轴独立归一化，这是平行坐标图的关键语义） */
  scale: NiceScale;
  x: number;
  /** 刻度线（含 y 坐标）；数值本身不带格式化文案，展示时由组件本地化 */
  ticks: Array<{ value: number; y: number }>;
}

export interface ParallelVertex {
  x: number;
  y: number;
  /** 对应第几根轴（也等于第几个指标列） */
  axisIndex: number;
  value: number;
}

export interface ParallelLine {
  /** 相邻两轴都有值时才连线；缺值处会断成多段 */
  segments: string[];
  /**
   * 该行所有可用的顶点。即使某个轴缺值导致无法连线，顶点本身仍然画出来 ——
   * 否则"只有一个轴有值"的行会整个消失，用户会以为数据丢了。
   */
  vertices: ParallelVertex[];
  /** 用于 tooltip/图例的行标识（取第一个分类列的值） */
  label: string;
  color: string;
}

export interface ParallelGeometry {
  axes: ParallelAxis[];
  lines: ParallelLine[];
  /** 因非数值或缺值而无法连成线的行数 */
  skippedRows: number;
  /** 因超过绘制上限而未画出的行数（避免上万个多边形卡死浏览器） */
  truncatedRows: number;
}

/**
 * 平行坐标图：每根竖直轴对应一个数值列，每行数据是一条穿过所有轴的折线。
 * 与雷达图不同，**每根轴各自归一化到自己的 min/max** —— 这正是平行坐标图
 * 能同时比较量纲差异很大的字段的原因（例如"金额"与"折扣率"）。
 * 某行在任意轴上缺值时，该行会从缺值处断开，而不是把 NULL 当成 0 画过去。
 */
export function buildParallelGeometry(
  model: ChartModel,
  options: {
    width?: number;
    height?: number;
    margins?: PlotMargins;
    maxLines?: number;
  } = {},
): ParallelGeometry {
  const width = options.width ?? CHART_VIEW_WIDTH;
  const height = options.height ?? CHART_VIEW_HEIGHT;
  const frame = makeFrame(width, height, options.margins ?? { ...DEFAULT_PLOT_MARGINS, left: 56, right: 56 });
  const maxLines = options.maxLines ?? 200;

  const metricCount = model.series.length;
  const usableWidth = frame.right - frame.left;
  const gap = metricCount > 1 ? usableWidth / (metricCount - 1) : 0;

  // 每根轴独立归一化：先收集该列所有非空数值
  const axes: ParallelAxis[] = model.series.map((item, index) => {
    const values = item.values.filter((value): value is number => value !== null);
    const scale = buildValueScale([values.length > 0 ? values : [0, 1]], {
      includeZero: false,
      targetCount: 4,
    });
    const span = scale.max - scale.min || 1;
    const x = frame.left + (metricCount > 1 ? index * gap : usableWidth / 2);
    const ticks = scale.ticks.map((tick) => ({
      value: tick,
      y: frame.bottom - ((tick - scale.min) / span) * (frame.bottom - frame.top),
    }));
    return { name: item.name, scale, x, ticks };
  });

  let skippedRows = 0;
  const allLines: ParallelLine[] = [];

  const rowCount = model.categories.length;
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const points: Array<{ x: number; y: number } | null> = axes.map((axis, axisIndex) => {
      const value = model.series[axisIndex]?.values[rowIndex] ?? null;
      if (value === null) return null;
      const span = axis.scale.max - axis.scale.min || 1;
      const ratio = (value - axis.scale.min) / span;
      return { x: axis.x, y: frame.bottom - ratio * (frame.bottom - frame.top) };
    });

    if (points.every((point) => point === null)) {
      skippedRows += 1;
      continue;
    }
    // 缺值处断开，而不是跨过缺值连成一条误导性的直线
    const runs: Array<Array<{ x: number; y: number }>> = [];
    let current: Array<{ x: number; y: number }> = [];
    for (const point of points) {
      if (point === null) {
        if (current.length > 0) runs.push(current);
        current = [];
      } else {
        current.push(point);
      }
    }
    if (current.length > 0) runs.push(current);

    const vertices: ParallelVertex[] = [];
    points.forEach((point, axisIndex) => {
      if (point !== null) {
        vertices.push({ x: point.x, y: point.y, axisIndex, value: model.series[axisIndex]!.values[rowIndex]! });
      }
    });

    allLines.push({
      segments: runs
        .filter((run) => run.length > 1)
        .map((run) => run.map((point) => pointAttr(point)).join(' ')),
      vertices,
      label: model.categories[rowIndex] ?? `#${rowIndex + 1}`,
      color: chartColor(rowIndex),
    });
  }

  const lines = allLines.slice(0, maxLines);
  return { axes, lines, skippedRows, truncatedRows: Math.max(0, allLines.length - lines.length) };
}
