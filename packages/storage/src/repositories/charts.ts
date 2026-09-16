/**
 * 花生苗数据库管理工具 - 图表与看板仓库
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 图表配置（维度/指标/聚合/样式）与看板布局都以 JSON 存在 TEXT 列里。
 * 读出来时做一次容错解析：历史数据可能因为早期版本写入不规范而不完整，
 * 这里不能因为一条脏配置就让整个列表接口 500。
 */

import { notFound, type ChartType } from '@peanutsprout/core';
import { nowIso, parseJson, toIso, type LocalDatabase, type Row } from '../database.js';

export interface ChartRecord {
  id: number;
  dashboardId: number | null;
  userId: number;
  name: string;
  chartType: ChartType;
  connectionId: number | null;
  dataSource: string | null;
  sourceRef: string | null;
  querySql: string | null;
  config: Record<string, unknown>;
  refreshMode: string | null;
  refreshSec: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChartInput {
  name: string;
  chartType: string;
  dashboardId?: number | null;
  connectionId?: number | null;
  dataSource?: string | null;
  sourceRef?: string | null;
  querySql?: string | null;
  config: Record<string, unknown>;
  refreshMode?: string | null;
  refreshSec?: number | null;
}

export interface DashboardRecord {
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

export interface DashboardInput {
  name: string;
  description?: string | null;
  layout?: Record<string, unknown> | null;
  isShared?: boolean;
}

/** 把可能为 null / 非对象的 JSON 列安全地读成对象。 */
function safeObject(raw: string | null): Record<string, unknown> | null {
  const parsed = parseJson<unknown>(raw, null);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return null;
}

export class ChartRepository {
  constructor(private readonly db: LocalDatabase) {}

  private toRecord(row: Row): ChartRecord {
    return {
      id: Number(row['id']),
      dashboardId: row['dashboard_id'] === null ? null : Number(row['dashboard_id']),
      userId: Number(row['user_id']),
      name: String(row['name']),
      chartType: String(row['chart_type']) as ChartType,
      connectionId: row['connection_id'] === null ? null : Number(row['connection_id']),
      dataSource: (row['data_source'] as string) ?? null,
      sourceRef: (row['source_ref'] as string) ?? null,
      querySql: (row['query_sql'] as string) ?? null,
      config: safeObject(row['config'] as string | null) ?? {},
      refreshMode: (row['refresh_mode'] as string) ?? null,
      refreshSec: row['refresh_sec'] === null ? null : Number(row['refresh_sec']),
      createdAt: toIso(row['created_at']) ?? '',
      updatedAt: toIso(row['updated_at']) ?? '',
    };
  }

  create(userId: number, input: ChartInput): ChartRecord {
    const now = nowIso();
    const id = this.db.run(
      `INSERT INTO charts
         (dashboard_id, user_id, name, chart_type, connection_id, data_source, source_ref,
          query_sql, config, refresh_mode, refresh_sec, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.dashboardId ?? null,
      userId,
      input.name,
      input.chartType,
      input.connectionId ?? null,
      input.dataSource ?? null,
      input.sourceRef ?? null,
      input.querySql ?? null,
      JSON.stringify(input.config ?? {}),
      input.refreshMode ?? 'manual',
      input.refreshSec ?? null,
      now,
      now,
    ).lastInsertRowid;
    return this.get(id);
  }

  get(id: number): ChartRecord {
    const row = this.db.get<Row>('SELECT * FROM charts WHERE id = ?', id);
    if (!row) throw notFound('图表', id);
    return this.toRecord(row);
  }

  find(id: number): ChartRecord | null {
    const row = this.db.get<Row>('SELECT * FROM charts WHERE id = ?', id);
    return row ? this.toRecord(row) : null;
  }

  /** 列出图表。userId 为 null 表示不按用户过滤（管理员场景）。 */
  list(userId: number | null, dashboardId?: number | null): ChartRecord[] {
    const clauses: string[] = [];
    const params: Array<number | null> = [];
    if (userId !== null) {
      clauses.push('user_id = ?');
      params.push(userId);
    }
    if (dashboardId !== undefined) {
      if (dashboardId === null) {
        clauses.push('dashboard_id IS NULL');
      } else {
        clauses.push('dashboard_id = ?');
        params.push(dashboardId);
      }
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    return this.db
      .all<Row>(`SELECT * FROM charts${where} ORDER BY id DESC`, ...params)
      .map((r) => this.toRecord(r));
  }

  update(id: number, userId: number, patch: Partial<ChartInput>): ChartRecord {
    this.get(id);
    const sets: string[] = [];
    const params: Array<string | number | null> = [];
    const push = (column: string, value: string | number | null): void => {
      sets.push(`${column} = ?`);
      params.push(value);
    };
    if (patch.name !== undefined) push('name', patch.name);
    if (patch.chartType !== undefined) push('chart_type', patch.chartType);
    if (patch.dashboardId !== undefined) push('dashboard_id', patch.dashboardId);
    if (patch.connectionId !== undefined) push('connection_id', patch.connectionId);
    if (patch.dataSource !== undefined) push('data_source', patch.dataSource);
    if (patch.sourceRef !== undefined) push('source_ref', patch.sourceRef);
    if (patch.querySql !== undefined) push('query_sql', patch.querySql);
    if (patch.config !== undefined) push('config', JSON.stringify(patch.config));
    if (patch.refreshMode !== undefined) push('refresh_mode', patch.refreshMode);
    if (patch.refreshSec !== undefined) push('refresh_sec', patch.refreshSec);
    if (sets.length > 0) {
      sets.push('updated_at = ?');
      params.push(nowIso());
      this.db.run(`UPDATE charts SET ${sets.join(', ')} WHERE id = ?`, ...params, id);
    }
    void userId; // 归属校验由路由层负责，仓库只做数据访问
    return this.get(id);
  }

  remove(id: number): void {
    this.get(id);
    this.db.run('DELETE FROM charts WHERE id = ?', id);
  }

  countByUser(userId: number): number {
    return this.db.count('SELECT COUNT(*) AS c FROM charts WHERE user_id = ?', userId);
  }
}

export class DashboardRepository {
  constructor(private readonly db: LocalDatabase) {}

  private toRecord(row: Row): DashboardRecord {
    return {
      id: Number(row['id']),
      userId: Number(row['user_id']),
      name: String(row['name']),
      description: (row['description'] as string) ?? null,
      layout: safeObject(row['layout'] as string | null),
      isShared: Number(row['is_shared']) === 1,
      shareToken: (row['share_token'] as string) ?? null,
      createdAt: toIso(row['created_at']) ?? '',
      updatedAt: toIso(row['updated_at']) ?? '',
    };
  }

  create(userId: number, input: DashboardInput): DashboardRecord {
    const now = nowIso();
    const id = this.db.run(
      `INSERT INTO dashboards (user_id, name, description, layout, is_shared, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      userId,
      input.name,
      input.description ?? null,
      input.layout ? JSON.stringify(input.layout) : null,
      input.isShared ? 1 : 0,
      now,
      now,
    ).lastInsertRowid;
    return this.get(id);
  }

  get(id: number): DashboardRecord {
    const row = this.db.get<Row>('SELECT * FROM dashboards WHERE id = ?', id);
    if (!row) throw notFound('看板', id);
    return this.toRecord(row);
  }

  find(id: number): DashboardRecord | null {
    const row = this.db.get<Row>('SELECT * FROM dashboards WHERE id = ?', id);
    return row ? this.toRecord(row) : null;
  }

  list(userId: number): DashboardRecord[] {
    return this.db
      .all<Row>('SELECT * FROM dashboards WHERE user_id = ? ORDER BY id DESC', userId)
      .map((r) => this.toRecord(r));
  }

  update(id: number, patch: Partial<DashboardInput>): DashboardRecord {
    this.get(id);
    const sets: string[] = [];
    const params: Array<string | number | null> = [];
    if (patch.name !== undefined) {
      sets.push('name = ?');
      params.push(patch.name);
    }
    if (patch.description !== undefined) {
      sets.push('description = ?');
      params.push(patch.description);
    }
    if (patch.layout !== undefined) {
      sets.push('layout = ?');
      params.push(patch.layout ? JSON.stringify(patch.layout) : null);
    }
    if (patch.isShared !== undefined) {
      sets.push('is_shared = ?');
      params.push(patch.isShared ? 1 : 0);
    }
    if (sets.length > 0) {
      sets.push('updated_at = ?');
      params.push(nowIso());
      this.db.run(`UPDATE dashboards SET ${sets.join(', ')} WHERE id = ?`, ...params, id);
    }
    return this.get(id);
  }

  remove(id: number): void {
    this.get(id);
    this.db.run('DELETE FROM dashboards WHERE id = ?', id);
  }
}
