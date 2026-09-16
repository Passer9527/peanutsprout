/**
 * 花生苗数据库管理工具 - 图表几何纯函数单元测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 覆盖 AC-03 里"图表能真正渲染"的几何基础：
 * 数值解析、刻度取整、空/混合数据、扇形路径、极坐标。
 * 这些断言只看数字，因此不需要 jsdom；Web 端没有浏览器测试环境，
 * 靠这一层把"坐标算错"的风险挡在提交前。
 */

import { createCompactNumberFormatter } from '@peanutsprout/i18n';
import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_CHART_TYPES,
  UNSUPPORTED_CHART_TYPES,
  buildBarGeometry,
  buildBarRects,
  buildCartesianGeometry,
  buildChartModel,
  buildColumnRects,
  buildParallelGeometry,
  buildPieGeometry,
  buildRadarGeometry,
  buildScatterGeometry,
  buildValueScale,
  cellToLabel,
  chartColor,
  formatNumber,
  isChartTypeSupported,
  niceTicks,
  parseNumericCell,
  ringPath,
  splitSegments,
  truncateLabel,
} from './chartGeometry';
import type { ChartDataInput, SeriesPoint } from './chartGeometry';

function col(name: string, dataType = 'text'): { name: string; dataType: string } {
  return { name, dataType };
}

const REGION_DATA: ChartDataInput = {
  chartType: 'column',
  columns: [col('region'), col('total', 'number')],
  rows: [
    ['华东', 150],
    ['华南', null],
    ['华北', 'N/A'],
    ['西北', 20],
  ],
};

describe('parseNumericCell', () => {
  it('接受数字与纯数字字符串', () => {
    expect(parseNumericCell(42)).toBe(42);
    expect(parseNumericCell('42.5')).toBe(42.5);
    expect(parseNumericCell(' 7 ')).toBe(7);
    expect(parseNumericCell('-3')).toBe(-3);
    expect(parseNumericCell('1e3')).toBe(1000);
    expect(parseNumericCell(10n)).toBe(10);
  });

  it('拒绝 NULL、布尔与晦涩的数字字面量', () => {
    expect(parseNumericCell(null)).toBeNull();
    expect(parseNumericCell(undefined)).toBeNull();
    expect(parseNumericCell('')).toBeNull();
    expect(parseNumericCell('   ')).toBeNull();
    expect(parseNumericCell('abc')).toBeNull();
    // Number('0x10') === 16、Number('1,000') === NaN：前者必须被拒绝，后者自然为 null
    expect(parseNumericCell('0x10')).toBeNull();
    expect(parseNumericCell('1,000')).toBeNull();
    expect(parseNumericCell(true)).toBeNull();
    expect(parseNumericCell(Number.NaN)).toBeNull();
    expect(parseNumericCell(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('niceTicks', () => {
  it('把 0..100 收敛成步长 20 的整齐刻度', () => {
    const scale = niceTicks(0, 100, 5);
    expect(scale.min).toBe(0);
    expect(scale.max).toBe(100);
    expect(scale.step).toBe(20);
    expect(scale.ticks).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it('上界会扩展到步长整数倍', () => {
    const scale = niceTicks(0, 97, 5);
    expect(scale.step).toBe(20);
    expect(scale.max).toBe(100);
    expect(scale.ticks[scale.ticks.length - 1]).toBe(100);
  });

  it('负值区间同时扩展上下界', () => {
    const scale = niceTicks(-5, 5, 5);
    expect(scale.min).toBe(-6);
    expect(scale.max).toBe(6);
    expect(scale.ticks[0]).toBe(-6);
  });

  it('所有值相同时不会退化成长度为 1 的刻度', () => {
    const flat = niceTicks(3, 3, 5);
    expect(flat.max).toBeGreaterThan(flat.min);
    expect(flat.ticks.length).toBeGreaterThanOrEqual(2);
    const zero = niceTicks(0, 0, 5);
    expect(zero.min).toBeLessThan(0);
    expect(zero.max).toBeGreaterThan(0);
  });

  it('刻度严格单调递增且没有浮点毛刺', () => {
    const scale = niceTicks(0, 1, 5);
    for (let index = 1; index < scale.ticks.length; index += 1) {
      expect(scale.ticks[index]).toBeGreaterThan(scale.ticks[index - 1]);
    }
    // 步长收敛到 0.2，且 3 * 0.2 不能留下 0.6000000000000001
    expect(scale.step).toBeCloseTo(0.2, 9);
    expect(scale.ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(scale.ticks[3]).toBe(0.6);
  });

  it('非有限输入回退到 0..1', () => {
    const scale = niceTicks(Number.NaN, Number.POSITIVE_INFINITY, 5);
    expect(Number.isFinite(scale.min)).toBe(true);
    expect(Number.isFinite(scale.max)).toBe(true);
  });
});

describe('formatNumber / 本地化紧凑数字', () => {
  it('加千分位并去掉无意义尾零', () => {
    expect(formatNumber(1234567.891)).toBe('1,234,567.891');
    expect(formatNumber(1000000)).toBe('1,000,000');
    expect(formatNumber(-0.5)).toBe('-0.5');
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(12.5)).toBe('12.5');
  });

  it('紧凑数字的 万 / 亿 单位改由 i18n 提供，纯模块不再产出', () => {
    // 纯模块只给数值；单位是本地化文案，组件从 useI18n() 取。
    const compact = createCompactNumberFormatter('zh-CN');
    expect(compact(15000)).toBe('1.5万');
    expect(compact(200000000)).toBe('2亿');
    expect(compact(123)).toBe('123');
    expect(compact(0.5)).toBe('0.5');
  });

  it('截断过长分类标签', () => {
    expect(truncateLabel('short', 10)).toBe('short');
    expect(truncateLabel('这是一个非常长的分类名称', 6)).toBe('这是一个非常…');
  });
});

describe('buildChartModel', () => {
  it('无列 / 无行 / 只有一列时给出明确的空态原因', () => {
    expect(
      buildChartModel({ chartType: 'column', columns: [], rows: [] }).emptyReason,
    ).toBe('no-columns');
    expect(
      buildChartModel({ chartType: 'column', columns: [col('a'), col('b')], rows: [] }).emptyReason,
    ).toBe('no-rows');
    expect(
      buildChartModel({ chartType: 'column', columns: [col('a')], rows: [['x']] }).emptyReason,
    ).toBe('insufficient-columns');
  });

  it('NULL 与非数值计入 skipped，且不进入系列值', () => {
    const model = buildChartModel(REGION_DATA);
    expect(model.emptyReason).toBeNull();
    expect(model.categories).toEqual(['华东', '华南', '华北', '西北']);
    expect(model.series).toHaveLength(1);
    expect(model.series[0].values).toEqual([150, null, null, 20]);
    expect(model.skipped).toBe(2);
    expect(model.cellCount).toBe(4);
  });

  it('全无数值的指标列被丢弃，并报告 no-numeric-metric', () => {
    const model = buildChartModel({
      chartType: 'column',
      columns: [col('region'), col('note')],
      rows: [
        ['华东', '好'],
        ['华南', '一般'],
      ],
    });
    expect(model.emptyReason).toBe('no-numeric-metric');
    expect(model.series).toHaveLength(0);
    expect(model.skipped).toBe(2);
  });

  it('多指标保留所有有数值的列，无值列被丢弃但计入 skipped', () => {
    const model = buildChartModel({
      chartType: 'column',
      columns: [col('region'), col('amount', 'number'), col('empty'), col('qty', 'number')],
      rows: [
        ['华东', 10, null, 1],
        ['华南', 20, null, 2],
      ],
    });
    expect(model.series.map((series) => series.name)).toEqual(['amount', 'qty']);
    // empty 列的 2 个 NULL 也计入跳过
    expect(model.skipped).toBe(2);
    expect(model.cellCount).toBe(6);
  });

  it('NULL 分类标签显式标注为 (NULL)', () => {
    const model = buildChartModel({
      chartType: 'column',
      columns: [col('region'), col('total')],
      rows: [[null, 5]],
    });
    expect(model.categories).toEqual(['(NULL)']);
    expect(cellToLabel(null)).toBe('(NULL)');
  });
});

describe('buildValueScale', () => {
  it('柱状图强制包含 0 基线', () => {
    const scale = buildValueScale([[100, 200]], { includeZero: true });
    expect(scale.min).toBe(0);
    expect(scale.max).toBe(200);
  });

  it('负值区间包含 0 且扩展到整齐步长', () => {
    const scale = buildValueScale([[-30, 80]], { includeZero: true });
    expect(scale.min).toBeLessThanOrEqual(-30);
    expect(scale.max).toBeGreaterThanOrEqual(80);
    expect(scale.ticks).toContain(0);
  });

  it('散点图可以不从 0 起', () => {
    const scale = buildValueScale([[100, 110]], { includeZero: false });
    expect(scale.min).toBeGreaterThan(0);
  });

  it('全空系列回退到 0..1', () => {
    const scale = buildValueScale([[null, null]], { includeZero: true });
    expect(Number.isFinite(scale.min)).toBe(true);
    expect(scale.max).toBeGreaterThanOrEqual(scale.min);
  });
});

describe('buildCartesianGeometry', () => {
  const model = buildChartModel({
    chartType: 'column',
    columns: [col('region'), col('total')],
    rows: [
      ['A', 10],
      ['B', 30],
    ],
  });
  const geometry = buildCartesianGeometry(model);

  it('0 落在基线上，最大值落在绘图区顶部', () => {
    expect(geometry.baselineY).toBeCloseTo(geometry.frame.bottom, 6);
    expect(geometry.yToPx(geometry.scale.max)).toBeCloseTo(geometry.frame.top, 6);
  });

  it('分类带按顺序等宽排布且中心点递增', () => {
    expect(geometry.bands).toHaveLength(2);
    expect(geometry.bands[0].width).toBeCloseTo(geometry.frame.innerWidth / 2, 6);
    expect(geometry.bands[1].center).toBeGreaterThan(geometry.bands[0].center);
    expect(geometry.bands[0].x).toBeCloseTo(geometry.frame.left, 6);
    expect(geometry.bands[0].center).toBeCloseTo(geometry.xFor(0), 6);
  });

  it('数据点 X 对齐分类中心，Y 随数值线性映射', () => {
    const first = geometry.series[0].points[0];
    const second = geometry.series[0].points[1];
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) {
      return;
    }
    expect(first.x).toBeCloseTo(geometry.bands[0].center, 6);
    expect(second.x).toBeCloseTo(geometry.bands[1].center, 6);
    // 值越大 Y 越小（屏幕坐标向下为正）
    expect(second.y).toBeLessThan(first.y);
  });

  it('NULL 点保持为 null，折线据此断开', () => {
    const withGap = buildCartesianGeometry(buildChartModel(REGION_DATA));
    const points = withGap.series[0].points;
    expect(points[1]).toBeNull();
    expect(points[2]).toBeNull();
    expect(splitSegments(points)).toHaveLength(2);
  });
});

describe('柱体 / 条体矩形', () => {
  const model = buildChartModel({
    chartType: 'column',
    columns: [col('region'), col('total')],
    rows: [
      ['A', 10],
      ['B', 30],
    ],
  });

  it('单系列柱体贴合分类带且高度与数值成比例', () => {
    const geometry = buildCartesianGeometry(model);
    const rects = buildColumnRects(geometry);
    expect(rects).toHaveLength(2);
    const [first, second] = rects;
    expect(first.value).toBe(10);
    expect(first.width).toBeCloseTo(geometry.bands[0].width * 0.72, 6);
    // 基线与数据点之间的高度
    const point = geometry.series[0].points[0];
    if (!point) {
      throw new Error('缺少数据点');
    }
    expect(first.height).toBeCloseTo(geometry.baselineY - point.y, 6);
    expect(second.height).toBeGreaterThan(first.height);
    expect(first.x).toBeGreaterThanOrEqual(geometry.frame.left);
  });

  it('横向条形图的 X 映射从 0 基线开始', () => {
    const geometry = buildBarGeometry(model);
    expect(geometry.xToPx(0)).toBeCloseTo(geometry.frame.left, 6);
    const rects = buildBarRects(geometry);
    expect(rects).toHaveLength(2);
    if (!rects[1] || !rects[0]) {
      throw new Error('缺少条体');
    }
    expect(rects[1].width).toBeGreaterThan(rects[0].width);
  });
});

describe('ringPath / buildPieGeometry', () => {
  it('零角度不产生路径，整圆拆成两条弧', () => {
    expect(ringPath(0, 0, 10, 0, 1, 1)).toBe('');
    // 实心扇形：每条半圆 1 条弧，共 2 条
    expect(ringPath(100, 100, 50, 0, 0, Math.PI * 2).split('A').length - 1).toBe(2);
    // 圆环：每条半环 2 条弧（外弧 + 内弧反向），共 4 条
    expect(ringPath(100, 100, 50, 20, 0, Math.PI * 2).split('A').length - 1).toBe(4);
    // 普通扇区只需要 1 条外弧
    expect(ringPath(100, 100, 50, 0, 0, 1).split('A').length - 1).toBe(1);
  });

  it('扇区角度按数值占比分配', () => {
    const model = buildChartModel({
      chartType: 'pie',
      columns: [col('region'), col('total')],
      rows: [
        ['A', 50],
        ['B', 50],
        ['C', 100],
      ],
    });
    const pie = buildPieGeometry(model);
    expect(pie.slices).toHaveLength(3);
    expect(pie.total).toBe(200);
    expect(pie.slices[0].percent).toBeCloseTo(0.25, 6);
    expect(pie.slices[2].percent).toBeCloseTo(0.5, 6);
    expect(pie.slices[0].path.startsWith('M')).toBe(true);
    // 最后一个扇区应正好回到起点角度 + 2π
    expect(pie.slices[2].endAngle - pie.slices[0].startAngle).toBeCloseTo(Math.PI * 2, 6);
  });

  it('NULL 与非正数扇区被跳过并计数', () => {
    const model = buildChartModel({
      chartType: 'donut',
      columns: [col('region'), col('total')],
      rows: [
        ['A', 10],
        ['B', null],
        ['C', -5],
        ['D', 10],
      ],
    });
    const pie = buildPieGeometry(model, { rInner: 40 });
    expect(pie.slices).toHaveLength(2);
    expect(pie.skipped).toBe(2);
    expect(pie.total).toBe(20);
  });

  it('只有一个扇区时仍能画出完整圆环', () => {
    const model = buildChartModel({
      chartType: 'donut',
      columns: [col('region'), col('total')],
      rows: [['唯一', 42]],
    });
    const pie = buildPieGeometry(model, { rInner: 40 });
    expect(pie.slices).toHaveLength(1);
    const arcCount = pie.slices[0].path.split('A').length - 1;
    expect(arcCount).toBe(4); // 外弧两条 + 内弧两条（整圆拆半）
  });

  it('没有任何正数时 slices 为空', () => {
    const model = buildChartModel({
      chartType: 'pie',
      columns: [col('region'), col('total')],
      rows: [
        ['A', 0],
        ['B', null],
      ],
    });
    expect(buildPieGeometry(model).slices).toHaveLength(0);
  });
});

describe('buildScatterGeometry', () => {
  it('第 0 列作 X，其余数值列作 Y，非数值计入 skipped', () => {
    const geometry = buildScatterGeometry({
      chartType: 'scatter',
      columns: [col('x'), col('y')],
      rows: [
        [1, 2],
        [2, 4],
        [null, 6],
        ['bad', 8],
      ],
    });
    expect(geometry.series).toHaveLength(1);
    expect(geometry.series[0].points).toHaveLength(2);
    expect(geometry.pointCount).toBe(2);
    expect(geometry.skipped).toBe(2);
    expect(geometry.xScale.min).toBeLessThanOrEqual(1);
    expect(geometry.xScale.max).toBeGreaterThanOrEqual(2);
  });

  it('Y 非数值的点被跳过但不影响 X 统计', () => {
    const geometry = buildScatterGeometry({
      chartType: 'scatter',
      columns: [col('x'), col('y')],
      rows: [
        [1, 2],
        [2, null],
        [3, 6],
      ],
    });
    expect(geometry.pointCount).toBe(2);
    expect(geometry.skipped).toBe(1);
  });

  it('全空数据不产生点', () => {
    const geometry = buildScatterGeometry({
      chartType: 'scatter',
      columns: [col('x'), col('y')],
      rows: [[null, null]],
    });
    expect(geometry.pointCount).toBe(0);
    expect(geometry.series).toHaveLength(0);
  });

  it('X 列出现非数值后，后续合法点仍保留且 X 不错位（回归）', () => {
    // 旧实现只在 X 可解析时 push xValues，而 yValues 每行都 push，
    // 两者下标错位：value=3 被画到 x=4 的坐标，(4,4) 整行丢失，实际只有 2 个点。
    const geometry = buildScatterGeometry({
      chartType: 'scatter',
      columns: [col('x'), col('y')],
      rows: [
        [1, 1],
        [null, 9],
        [3, 3],
        [4, 4],
      ],
    });
    expect(geometry.pointCount).toBe(3);
    const points = geometry.series[0].points;
    expect(points.map((point) => point.value)).toEqual([1, 3, 4]);
    // 像素 X 必须等于按各自真实 X 值换算的结果：value=3 对应 x=3
    expect(points.map((point) => point.x)).toEqual([1, 3, 4].map((value) => geometry.xToPx(value)));
    // X 非数值的那一行整行无法定位，只计一次 skipped
    expect(geometry.skipped).toBe(1);
  });

  it('多系列共用同一行下标，不会被 X 空洞顶偏', () => {
    const geometry = buildScatterGeometry({
      chartType: 'scatter',
      columns: [col('x'), col('a'), col('b')],
      rows: [
        [1, 10, 100],
        ['bad', 20, 200],
        [3, 30, 300],
      ],
    });
    expect(geometry.series.map((s) => s.points.length)).toEqual([2, 2]);
    expect(geometry.series[0].points.map((p) => p.value)).toEqual([10, 30]);
    expect(geometry.series[1].points.map((p) => p.value)).toEqual([100, 300]);
    for (const s of geometry.series) {
      expect(s.points[1].x).toBe(geometry.xToPx(3));
    }
  });
});

describe('buildRadarGeometry', () => {
  it('每个维度对应一条指标轴，每个数值列对应一条折线', () => {
    const model = buildChartModel({
      chartType: 'radar',
      columns: [col('subject'), col('score'), col('rank')],
      rows: [
        ['数学', 90, 1],
        ['语文', 70, 2],
        ['英语', 80, 3],
        ['物理', 60, 4],
      ],
    });
    const radar = buildRadarGeometry(model);
    expect(radar.indicators).toHaveLength(4);
    expect(radar.series).toHaveLength(2);
    expect(radar.series[0].vertices).toHaveLength(4);
    expect(radar.rings.length).toBeGreaterThan(0);
    expect(radar.scale.min).toBe(0);
  });

  it('NULL 顶点被跳过并计数', () => {
    const model = buildChartModel({
      chartType: 'radar',
      columns: [col('subject'), col('score')],
      rows: [
        ['数学', 90],
        ['语文', null],
        ['英语', 80],
        ['物理', 60],
      ],
    });
    const radar = buildRadarGeometry(model);
    expect(radar.series[0].vertices).toHaveLength(3);
    expect(radar.skipped).toBe(1);
  });
});

describe('辅助函数', () => {
  it('系列配色循环取用主题变量', () => {
    expect(chartColor(0)).toBe('var(--chart-1)');
    expect(chartColor(7)).toBe('var(--chart-8)');
    expect(chartColor(8)).toBe('var(--chart-1)');
    expect(chartColor(-1)).toBe('var(--chart-8)');
  });

  it('已实现类型与占位类型互不重叠', () => {
    expect(isChartTypeSupported('bar')).toBe(true);
    expect(isChartTypeSupported('column')).toBe(true);
    expect(isChartTypeSupported('line')).toBe(true);
    expect(isChartTypeSupported('area')).toBe(true);
    expect(isChartTypeSupported('pie')).toBe(true);
    expect(isChartTypeSupported('donut')).toBe(true);
    expect(isChartTypeSupported('scatter')).toBe(true);
    expect(isChartTypeSupported('radar')).toBe(true);
    // AC-03 点名的三种图（折线/条形/平行坐标）必须都能渲染
    expect(isChartTypeSupported('line')).toBe(true);
    expect(isChartTypeSupported('bar')).toBe(true);
    expect(isChartTypeSupported('parallel')).toBe(true);
    // 明确不假装支持的六种
    for (const type of ['bubble', 'heatmap', 'sankey', 'treemap', 'boxplot', 'map']) {
      expect(isChartTypeSupported(type)).toBe(false);
    }
  });

  it('splitSegments 在空值处断开', () => {
    const point = (x: number): SeriesPoint => ({ x, y: 0, value: 1, index: x });
    expect(splitSegments([point(0), null, point(2), point(3), null])).toHaveLength(2);
    expect(splitSegments([null, null])).toHaveLength(0);
    expect(splitSegments([])).toHaveLength(0);
  });
});

describe('buildParallelGeometry（平行坐标图，AC-03 点名的第三种图）', () => {
  const data: ChartDataInput = {
    chartType: 'parallel',
    columns: [col('order_no'), col('amount', 'numeric'), col('discount', 'numeric'), col('qty', 'numeric')],
    rows: [
      ['A-1', 100, 0.1, 3],
      ['A-2', 900, 0.5, 12],
      ['A-3', 500, 0.3, 7],
    ],
  };

  it('每根轴独立归一化（这是平行坐标图能比较不同量纲字段的关键）', () => {
    const geometry = buildParallelGeometry(buildChartModel(data));
    expect(geometry.axes.map((axis) => axis.name)).toEqual(['amount', 'discount', 'qty']);
    // amount 值域 100~900，discount 仅 0.1~0.5：各自归一化后都应铺满绘图高度
    const amount = geometry.axes[0]!;
    const discount = geometry.axes[1]!;
    expect(amount.scale.max).toBeGreaterThan(amount.scale.min);
    expect(discount.scale.max).toBeGreaterThan(discount.scale.min);
    expect(discount.scale.max).toBeLessThanOrEqual(1);
  });

  it('每行数据连成一条穿过所有轴的折线', () => {
    const geometry = buildParallelGeometry(buildChartModel(data));
    expect(geometry.lines.length).toBe(3);
    for (const line of geometry.lines) {
      expect(line.segments.length).toBe(1);
      // 3 根轴 → 每条折线 3 个点
      expect(line.segments[0]!.split(' ').length).toBe(6);
    }
    expect(geometry.skippedRows).toBe(0);
    expect(geometry.truncatedRows).toBe(0);
  });

  it('轴的 x 坐标从左到右等距分布', () => {
    const geometry = buildParallelGeometry(buildChartModel(data));
    const [a, b, c] = geometry.axes;
    expect(a!.x).toBeLessThan(b!.x);
    expect(b!.x).toBeLessThan(c!.x);
    expect(Math.abs(b!.x - a!.x - (c!.x - b!.x))).toBeLessThan(0.001);
  });

  it('某轴上缺值时该行断开，而不是跨过缺值连成误导性的直线', () => {
    // 注意：b 列必须至少有一个非空值，否则 buildChartModel 会把整列丢弃，
    // 就测不到"断线"逻辑了（这正是下面这行数据同时包含 r2 的原因）
    const withGap: ChartDataInput = {
      chartType: 'parallel',
      columns: [col('id'), col('a', 'numeric'), col('b', 'numeric'), col('c', 'numeric')],
      rows: [
        ['r1', 1, null, 3],
        ['r2', 4, 5, 6],
      ],
    };
    const geometry = buildParallelGeometry(buildChartModel(withGap));
    expect(geometry.axes.length).toBe(3);

    // r1 的 b 为空 → 不能跨过缺值把 a 和 c 直连（相邻轴才连线）
    const r1 = geometry.lines.find((line) => line.label === 'r1')!;
    expect(r1.segments.length).toBe(0);
    // 但两个顶点仍要画出来，否则这行会整个消失
    expect(r1.vertices.map((vertex) => vertex.axisIndex)).toEqual([0, 2]);
    expect(r1.vertices.map((vertex) => vertex.value)).toEqual([1, 3]);

    // r2 三个值齐全 → 一条完整的 3 点折线 + 3 个顶点
    const r2 = geometry.lines.find((line) => line.label === 'r2')!;
    expect(r2.segments.length).toBe(1);
    expect(r2.segments[0]!.split(' ').length).toBe(6);
    expect(r2.vertices.length).toBe(3);
    expect(geometry.skippedRows).toBe(0);
  });

  it('行数超过上限时截断并如实上报截断数量（避免上万条折线卡死浏览器）', () => {
    const many: ChartDataInput = {
      chartType: 'parallel',
      columns: [col('id'), col('a', 'numeric'), col('b', 'numeric')],
      rows: Array.from({ length: 50 }, (_, i) => [`r${i}`, i, i * 2] as unknown[]),
    };
    const geometry = buildParallelGeometry(buildChartModel(many), { maxLines: 10 });
    expect(geometry.lines.length).toBe(10);
    expect(geometry.truncatedRows).toBe(40);
  });

  it('已被登记为支持渲染的类型', () => {
    expect(isChartTypeSupported('parallel')).toBe(true);
  });
});

/**
 * 纯模块的架构约束：不得产出任何面向用户的语言文案。
 * 空态只给稳定的 reason 枚举，格式化好的句子、单位、占位符都在 viz.ts / 组件里。
 */
describe('纯模块不产出面向用户的语言文案', () => {
  const PARALLEL_DATA: ChartDataInput = {
    chartType: 'parallel',
    columns: [col('id'), col('a', 'numeric'), col('b', 'numeric')],
    rows: [
      ['r1', 1, 2],
      ['r2', 3, 4],
    ],
  };

  it('空态只返回稳定的 reason 枚举，而不是中文句子', () => {
    expect(
      buildChartModel({ chartType: 'column', columns: [], rows: [] }).emptyReason,
    ).toBe('no-columns');
    expect(
      buildChartModel({ chartType: 'column', columns: [col('a'), col('b')], rows: [] }).emptyReason,
    ).toBe('no-rows');
    expect(
      buildChartModel({ chartType: 'column', columns: [col('a')], rows: [['x']] }).emptyReason,
    ).toBe('insufficient-columns');
    expect(
      buildChartModel({ chartType: 'column', columns: [col('a'), col('b')], rows: [['x', 'y']] })
        .emptyReason,
    ).toBe('no-numeric-metric');
  });

  it('支持 / 占位类型清单精确列出（parallel 可渲染，六种诚实占位）', () => {
    expect(SUPPORTED_CHART_TYPES).toEqual([
      'bar',
      'column',
      'line',
      'area',
      'pie',
      'donut',
      'scatter',
      'radar',
      'parallel',
    ]);
    expect(UNSUPPORTED_CHART_TYPES).toEqual([
      'bubble',
      'heatmap',
      'sankey',
      'treemap',
      'boxplot',
      'map',
    ]);
    for (const type of UNSUPPORTED_CHART_TYPES) {
      expect(isChartTypeSupported(type)).toBe(false);
    }
  });

  it('平行坐标轴的刻度只带数值与坐标，不再内嵌格式化文案', () => {
    const geometry = buildParallelGeometry(buildChartModel(PARALLEL_DATA));
    for (const axis of geometry.axes) {
      expect(axis.ticks.length).toBeGreaterThan(0);
      for (const tick of axis.ticks) {
        expect(Object.keys(tick).sort()).toEqual(['value', 'y']);
        expect(typeof tick.value).toBe('number');
        expect(typeof tick.y).toBe('number');
      }
    }
  });

  it('空字符串分类值的占位文案由调用方传入，纯函数不内置中文', () => {
    // 不传时不再内置中文占位，交给组件本地化
    expect(cellToLabel('')).toBe('');
    expect(cellToLabel('', { emptyLabel: '(空字符串)' })).toBe('(空字符串)');
    const model = buildChartModel(
      { chartType: 'column', columns: [col('a'), col('b')], rows: [['', 1]] },
      { emptyLabel: '(空字符串)' },
    );
    expect(model.categories).toEqual(['(空字符串)']);
  });
});
