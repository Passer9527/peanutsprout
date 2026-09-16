/**
 * 花生苗数据库管理工具 - 图表与看板模型
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export type ChartType =
  | 'bar'
  | 'column'
  | 'line'
  | 'area'
  | 'pie'
  | 'donut'
  | 'scatter'
  | 'bubble'
  | 'parallel'
  | 'heatmap'
  | 'radar'
  | 'sankey'
  | 'treemap'
  | 'boxplot'
  | 'map';

export interface ChartTypeInfo {
  type: ChartType;
  label: string;
 /** 需要的维度数量与指标数量，用于界面校验 */
  minDimensions: number;
  minMetrics: number;
  description: string;
}

export const CHART_TYPES: readonly ChartTypeInfo[] = [
  { type: 'bar', label: '条形图', minDimensions: 1, minMetrics: 1, description: '横向比较分类值' },
  { type: 'column', label: '柱状图', minDimensions: 1, minMetrics: 1, description: '纵向比较分类值' },
  { type: 'line', label: '折线图', minDimensions: 1, minMetrics: 1, description: '趋势变化' },
  { type: 'area', label: '面积图', minDimensions: 1, minMetrics: 1, description: '累积趋势' },
  { type: 'pie', label: '饼图', minDimensions: 1, minMetrics: 1, description: '占比构成' },
  { type: 'donut', label: '环形图', minDimensions: 1, minMetrics: 1, description: '占比构成（中空）' },
  { type: 'scatter', label: '散点图', minDimensions: 2, minMetrics: 1, description: '两变量相关性' },
  { type: 'bubble', label: '气泡图', minDimensions: 2, minMetrics: 2, description: '三变量关系' },
  { type: 'parallel', label: '平行坐标图', minDimensions: 2, minMetrics: 1, description: '多维特征对比' },
  { type: 'heatmap', label: '热力图', minDimensions: 2, minMetrics: 1, description: '二维密度分布' },
  { type: 'radar', label: '雷达图', minDimensions: 1, minMetrics: 2, description: '多维能力画像' },
  { type: 'sankey', label: '桑基图', minDimensions: 2, minMetrics: 1, description: '流向与转化' },
  { type: 'treemap', label: '树图', minDimensions: 1, minMetrics: 1, description: '层级占比' },
  { type: 'boxplot', label: '箱线图', minDimensions: 1, minMetrics: 1, description: '分布与离群点' },
  { type: 'map', label: '地图', minDimensions: 1, minMetrics: 1, description: '地理分布（可选）' },
] as const;

export type Aggregation = 'none' | 'sum' | 'avg' | 'count' | 'count_distinct' | 'min' | 'max' | 'median';

export interface ChartField {
  column: string;
  aggregation: Aggregation;
  alias?: string;
}

export interface ChartConfig {
  dimensions: ChartField[];
  metrics: ChartField[];
  filters?: Array<{ column: string; operator: string; value: unknown }>;
  sort?: Array<{ column: string; direction: 'asc' | 'desc' }>;
  limit?: number | null;
  /** 样式（颜色、图例、标签等），前端自由解释 */
  style?: Record<string, unknown>;
}

export interface ChartDTO {
  id: number;
  dashboardId: number | null;
  userId: number;
  name: string;
  chartType: ChartType;
  connectionId: number | null;
  dataSource: 'table' | 'view' | 'query';
  sourceRef: string | null;
  querySql: string | null;
  config: ChartConfig;
  refreshMode: 'manual' | 'interval' | 'websocket';
  refreshSec: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardDTO {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  layout: Record<string, unknown> | null;
  isShared: boolean;
  shareToken: string | null;
  createdAt: string;
  updatedAt: string;
}
