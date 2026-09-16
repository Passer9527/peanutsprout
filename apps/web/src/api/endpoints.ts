/**
 * 冻结 REST 契约的强类型封装（基址 /api/v1）。
 * 页面只调用这里的方法，不直接拼 URL。
 */
import { ApiError, request, requestBlob } from './client';
import type {
  AiConfigDTO,
  AiConfigInput,
  AiDiagnoseResultDTO,
  AiHistoryDTO,
  AiModelsDTO,
  AiOptimizeResultDTO,
  AiProbeInput,
  AiProbeResultDTO,
  AiSqlResultDTO,
  AiStatusDTO,
  AuditLogDTO,
  AuditLogQuery,
  AuditVerifyDTO,
  AuthUserResponse,
  ChartDTO,
  ChartDataDTO,
  ChartInput,
  ChartListQuery,
  ChartTypeInfoDTO,
  CellValue,
  ColumnDTO,
  ColumnTypesResponse,
  DdlCreateSchemaInput,
  DdlDropTableInput,
  DdlExecuteInput,
  DdlTableSpec,
  RowKey,
  SchemaSupportDTO,
  TableColumnsResponse,
  TableRowsInput,
  TableRowsResponse,
  ConnectionDTO,
  ConnectionFilter,
  ConnectionInput,
  ConnectionTestResult,
  CreateUserInput,
  DashboardDTO,
  DashboardDetailDTO,
  DashboardInput,
  DbTypeDTO,
  ExecuteQueryInput,
  ExplainPlanDTO,
  HealthDTO,
  ItemResponse,
  ItemsResponse,
  LoginResponse,
  OkResponse,
  QueryHistoryDTO,
  QueryResultDTO,
  SchemaDTO,
  SettingItemDTO,
  TableDTO,
  UpdateUserInput,
  UserDTO,
  WebAccessDTO,
  WritableSettingDTO,
} from './types';

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

export const authApi = {
  login(username: string, password: string): Promise<LoginResponse> {
    return request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { username, password },
      skipAuth: true,
    });
  },
  logout(): Promise<OkResponse> {
    return request<OkResponse>('/auth/logout', { method: 'POST' });
  },
  me(): Promise<AuthUserResponse> {
    return request<AuthUserResponse>('/auth/me');
  },
  changePassword(oldPassword: string, newPassword: string): Promise<OkResponse> {
    return request<OkResponse>('/auth/change-password', {
      method: 'POST',
      body: { oldPassword, newPassword },
    });
  },
};

export const connectionsApi = {
  list(filter: ConnectionFilter = {}): Promise<ItemsResponse<ConnectionDTO>> {
    return request<ItemsResponse<ConnectionDTO>>('/connections', {
      query: {
        search: filter.search,
        dbType: filter.dbType,
        favorite: filter.favorite === undefined ? undefined : filter.favorite,
      },
    });
  },
  get(id: number): Promise<ItemResponse<ConnectionDTO>> {
    return request<ItemResponse<ConnectionDTO>>(`/connections/${id}`);
  },
  create(input: ConnectionInput): Promise<ItemResponse<ConnectionDTO>> {
    return request<ItemResponse<ConnectionDTO>>('/connections', { method: 'POST', body: input });
  },
  update(id: number, input: Partial<ConnectionInput>): Promise<ItemResponse<ConnectionDTO>> {
    return request<ItemResponse<ConnectionDTO>>(`/connections/${id}`, {
      method: 'PUT',
      body: input,
    });
  },
  remove(id: number): Promise<OkResponse> {
    return request<OkResponse>(`/connections/${id}`, { method: 'DELETE' });
  },
  test(id: number): Promise<ConnectionTestResult> {
    return request<ConnectionTestResult>(`/connections/${id}/test`, { method: 'POST' });
  },
  schemas(id: number): Promise<ItemsResponse<SchemaDTO>> {
    return request<ItemsResponse<SchemaDTO>>(`/connections/${id}/schemas`);
  },
  tables(id: number, schema: string): Promise<ItemsResponse<TableDTO>> {
    return request<ItemsResponse<TableDTO>>(
      `/connections/${id}/schemas/${encodeSegment(schema)}/tables`,
    );
  },
  columns(id: number, schema: string, table: string): Promise<ItemsResponse<ColumnDTO>> {
    return request<ItemsResponse<ColumnDTO>>(
      `/connections/${id}/schemas/${encodeSegment(schema)}/tables/${encodeSegment(table)}/columns`,
    );
  },
};

export const queryApi = {
  execute(input: ExecuteQueryInput): Promise<QueryResultDTO> {
    return request<QueryResultDTO>('/query/execute', { method: 'POST', body: input });
  },
  explain(connectionId: number, sql: string): Promise<{ plan: ExplainPlanDTO }> {
    return request<{ plan: ExplainPlanDTO }>('/query/explain', {
      method: 'POST',
      body: { connectionId, sql },
    });
  },
  history(limit = 50, offset = 0): Promise<ItemsResponse<QueryHistoryDTO>> {
    return request<ItemsResponse<QueryHistoryDTO>>('/query/history', {
      query: { limit, offset },
    });
  },
};

export const metaApi = {
  dbTypes(): Promise<ItemsResponse<DbTypeDTO>> {
    return request<ItemsResponse<DbTypeDTO>>('/meta/db-types');
  },
  /**
   * Web 页面（局域网）访问状态。
   *
   * 与设置项分开取：设置项只有"用户存了什么"，而这里额外给出
   * **本次进程实际绑定到哪**、需不需要重启、以及可以贴给别人的地址。
   * 只依赖 settingsApi 会让界面无法区分"已保存"和"已生效"。
   */
  webAccess(): Promise<WebAccessDTO> {
    return request<WebAccessDTO>('/meta/web-access');
  },
};

/**
 * 设置项读写。
 *
 * 后端只接受白名单里的键（`GET /meta/settings/writable` 可查），
 * 提交白名单外的键会返回 VALIDATION_FAILED —— 这是有意的，
 * 避免把界面上的笔误变成一条谁也读不懂的幽灵配置。
 */
export const settingsApi = {
  list(): Promise<ItemsResponse<SettingItemDTO>> {
    return request<ItemsResponse<SettingItemDTO>>('/meta/settings');
  },
  writable(): Promise<ItemsResponse<WritableSettingDTO>> {
    return request<ItemsResponse<WritableSettingDTO>>('/meta/settings/writable');
  },
  update(
    items: Array<{ key: string; value: string | number | boolean }>,
  ): Promise<{ items: SettingItemDTO[]; changes: Array<{ key: string; oldValue: string | null; newValue: string }> }> {
    return request('/meta/settings', { method: 'PUT', body: { items } });
  },
};

/**
 * AI 助手接口。
 *
 * 两条安全约定在类型层面就体现出来：
 *  · 配置的 apiKey **只进不出** —— AiConfigDTO 里没有 apiKey 字段；
 *  · nl2sql 返回的是生成结果，`executed` 恒为 false，绝不自动执行。
 */
export const aiApi = {
  status(): Promise<AiStatusDTO> {
    return request<AiStatusDTO>('/ai/status');
  },
  listConfigs(): Promise<ItemsResponse<AiConfigDTO>> {
    return request<ItemsResponse<AiConfigDTO>>('/ai/configs');
  },
  createConfig(input: AiConfigInput): Promise<ItemResponse<AiConfigDTO>> {
    return request<ItemResponse<AiConfigDTO>>('/ai/configs', { method: 'POST', body: input });
  },
  updateConfig(id: number, input: Partial<AiConfigInput>): Promise<ItemResponse<AiConfigDTO>> {
    return request<ItemResponse<AiConfigDTO>>(`/ai/configs/${id}`, { method: 'PUT', body: input });
  },
  removeConfig(id: number): Promise<OkResponse> {
    return request<OkResponse>(`/ai/configs/${id}`, { method: 'DELETE' });
  },
  /** 连通性测试：`configId` 测已保存的，或传表单临时值在保存前试连 */
  test(input: AiProbeInput): Promise<{ result: AiProbeResultDTO }> {
    return request<{ result: AiProbeResultDTO }>('/ai/test', { method: 'POST', body: input });
  },
  models(input: AiProbeInput): Promise<AiModelsDTO> {
    return request<AiModelsDTO>('/ai/models', { method: 'POST', body: input });
  },
  history(limit = 20): Promise<ItemsResponse<AiHistoryDTO>> {
    return request<ItemsResponse<AiHistoryDTO>>('/ai/history', { query: { limit } });
  },
  /** 撤回单条调用记录（只影响自己的记录；不是自己的返回 404） */
  withdrawHistory(id: number): Promise<OkResponse> {
    return request<OkResponse>(`/ai/history/${id}`, { method: 'DELETE' });
  },
  /**
   * 撤回到指定的某一次操作：删掉这条**及其之后**的全部调用记录。
   * 返回实际删除条数，界面据此提示"已回退 N 条"。
   */
  rollbackHistory(historyId: number): Promise<{ ok: boolean; deleted: number }> {
    return request<{ ok: boolean; deleted: number }>('/ai/history/rollback', {
      method: 'POST',
      body: { historyId },
    });
  },
  clearHistory(): Promise<{ ok: boolean; deleted: number }> {
    return request<{ ok: boolean; deleted: number }>('/ai/history', { method: 'DELETE' });
  },
  nl2sql(prompt: string, connectionId: number, tables?: string[]): Promise<AiSqlResultDTO> {
    return request<AiSqlResultDTO>('/ai/nl2sql', {
      method: 'POST',
      body: { prompt, connectionId, ...(tables && tables.length > 0 ? { tables } : {}) },
    });
  },
  explain(sql: string): Promise<{ text: string; historyId?: number | null }> {
    return request<{ text: string; historyId?: number | null }>('/ai/explain', {
      method: 'POST',
      body: { sql },
    });
  },
  /** 给了 connectionId 时后端会先跑 EXPLAIN 拿到执行计划再交给模型 */
  optimize(sql: string, connectionId?: number): Promise<AiOptimizeResultDTO> {
    return request<AiOptimizeResultDTO>('/ai/optimize', {
      method: 'POST',
      body: { sql, ...(connectionId !== undefined ? { connectionId } : {}) },
    });
  },
  /** 后端返回 `{ markdown }`（apps/server/src/routes/ai-migration.ts），不是 text */
  document(connectionId: number, tables?: string[]): Promise<{ markdown: string; historyId?: number | null }> {
    return request<{ markdown: string; historyId?: number | null }>('/ai/document', {
      method: 'POST',
      body: { connectionId, ...(tables && tables.length > 0 ? { tables } : {}) },
    });
  },
  /**
   * 结果集问答。
   * 契约要求**真的带上结果数据**（columns + rows），而不是一段 SQL ——
   * 因此界面里必须先把结果集读出来再问，不能凭空发问。
   */
  ask(
    question: string,
    columns: Array<{ name: string; dataType?: string }>,
    rows: Array<Array<string | number | boolean | null>>,
    connectionId?: number,
  ): Promise<{ text: string; historyId?: number | null }> {
    return request<{ text: string; historyId?: number | null }>('/ai/ask', {
      method: 'POST',
      body: { question, columns, rows, ...(connectionId !== undefined ? { connectionId } : {}) },
    });
  },
  diagnose(error: string, sql: string): Promise<AiDiagnoseResultDTO> {
    return request<AiDiagnoseResultDTO>('/ai/diagnose', { method: 'POST', body: { error, sql } });
  },
};

/**
 * 数据导出。
 *
 * `exportXlsx` 是**下载**而非 JSON 接口，因此不走 `request()`（那条路会把响应体
 * 当 JSON 解析）。这里用 fetch 拿 blob，再从 content-disposition 里取服务端给的
 * 文件名 —— 文件名由服务端清洗过，比前端自己拼更可靠。
 */
/**
 * 数据导出。
 *
 * `exportXlsx` 是**下载**而非 JSON 接口，因此走 `requestBlob()`（`request()` 会把
 * 二进制当 JSON 解析）。文件名优先取服务端 `content-disposition` 里的
 * `filename*=UTF-8''…`（RFC 5987，中文文件名必须这样编码，否则 HTTP 头直接非法）；
 * 拿不到才退回一个默认名。
 */
export const dataApi = {
  async exportXlsx(input: {
    connectionId: number;
    sql: string;
    sheetName?: string;
    fileName?: string;
    maxRows?: number;
  }): Promise<{ blob: Blob; filename: string; truncated: boolean }> {
    const { blob, headers } = await requestBlob('/data/export/xlsx', {
      method: 'POST',
      body: input,
    });
    return {
      blob,
      filename: filenameFromDisposition(headers.get('content-disposition')) ?? 'export.xlsx',
      truncated: headers.get('x-export-truncated') === 'true',
    };
  },
  /** 把查询结果写进另一个数据库连接的表 */
  exportToConnection(input: {
    sourceConnectionId: number;
    sql: string;
    targetConnectionId: number;
    targetSchema?: string | null;
    targetTable: string;
    mode: 'create' | 'append' | 'replace';
    maxRows?: number;
  }): Promise<{
    ok: boolean;
    rows: number;
    targetTable: string;
    mode: string;
    truncated: boolean;
    warnings?: string[];
  }> {
    return request('/data/export/to-connection', { method: 'POST', body: input });
  },
};

/**
 * 从 content-disposition 里取文件名。
 * 优先 `filename*=UTF-8''…`（RFC 5987），其次 `filename="…"`。
 */
function filenameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  const extended = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1]);
    } catch {
      // 编码损坏时退回 basic 形式
    }
  }
  const basic = /filename="([^"]+)"/i.exec(disposition);
  return basic?.[1] ?? null;
}

/**
 * 表数据编辑器（Excel 式增删改查）。
 *
 * 读走 `conn.read`，写走与 SQL 开发页**完全相同**的写闸门；
 * 更新/删除必须带 `key`（主键或唯一索引的值），服务端据此定位单行 ——
 * 界面不提供"按整行内容猜"的更新方式，避免一次改到多行。
 */
export const tableApi = {
  /** 列元信息 + 可写性判定（不懂数据，用于先渲染表头与只读提示） */
  columns(connectionId: number, schema: string, table: string): Promise<TableColumnsResponse> {
    return request<TableColumnsResponse>('/data/table/columns', {
      method: 'POST',
      body: { connectionId, schema, table },
    });
  },
  rows(input: TableRowsInput): Promise<TableRowsResponse> {
    return request<TableRowsResponse>('/data/table/rows', { method: 'POST', body: input });
  },
  insert(input: {
    connectionId: number;
    schema: string;
    table: string;
    values: Record<string, CellValue>;
  }): Promise<{ ok: boolean; inserted: number }> {
    return request('/data/table/insert', { method: 'POST', body: input });
  },
  update(input: {
    connectionId: number;
    schema: string;
    table: string;
    key: RowKey;
    changes: Record<string, CellValue>;
  }): Promise<{ ok: boolean; updated: number }> {
    return request('/data/table/update', { method: 'POST', body: input });
  },
  remove(input: {
    connectionId: number;
    schema: string;
    table: string;
    keys: RowKey[];
  }): Promise<{ ok: boolean; deleted: number }> {
    return request('/data/table/delete', { method: 'POST', body: input });
  },
};

/**
 * 可视化建库建表。
 *
 * `preview` **只生成语句、绝不执行** —— 界面必须先展示将要跑什么，
 * 用户确认后才调 `execute`（服务端仍会再走一次写闸门）。
 */
export const ddlApi = {
  columnTypes(connectionId: number): Promise<ColumnTypesResponse> {
    return request<ColumnTypesResponse>(`/ddl/column-types/${connectionId}`);
  },
  schemaSupport(connectionId: number): Promise<SchemaSupportDTO> {
    return request<SchemaSupportDTO>(`/ddl/schema-support/${connectionId}`);
  },
  preview(spec: DdlTableSpec): Promise<{ statements: string[] }> {
    return request<{ statements: string[] }>('/ddl/preview', { method: 'POST', body: spec });
  },
  /**
   * 真正执行建表。
   *
   * `confirm` **由调用方在用户确认之后显式传入**（与 `queryApi.execute` 同一约定），
   * 不在这里写死 true —— 服务端对不带 confirm 的请求返回 428，
   * 这道关卡的意义就是"调用方必须明确表示知道自己在改结构"。
   * 在这里替调用方表态，等于把这道关卡废掉。
   */
  execute(input: DdlExecuteInput): Promise<{ ok: boolean; statements: string[]; executed: number }> {
    return request('/ddl/execute', { method: 'POST', body: input });
  },
  createSchema(input: DdlCreateSchemaInput): Promise<{ ok: boolean; statement: string }> {
    return request('/ddl/create-schema', { method: 'POST', body: input });
  },
  dropTable(input: DdlDropTableInput): Promise<{ ok: boolean; statement: string }> {
    return request('/ddl/drop-table', { method: 'POST', body: input });
  },
};

export const auditApi = {
  logs(query: AuditLogQuery = {}): Promise<{ items: AuditLogDTO[]; total: number }> {
    return request<{ items: AuditLogDTO[]; total: number }>('/audit/logs', {
      query: {
        limit: query.limit,
        offset: query.offset,
        action: query.action,
        userId: query.userId,
      },
    });
  },
  verify(): Promise<AuditVerifyDTO> {
    return request<AuditVerifyDTO>('/audit/verify');
  },
};

export const usersApi = {
  list(): Promise<ItemsResponse<UserDTO>> {
    return request<ItemsResponse<UserDTO>>('/users');
  },
  create(input: CreateUserInput): Promise<ItemResponse<UserDTO>> {
    return request<ItemResponse<UserDTO>>('/users', { method: 'POST', body: input });
  },
  update(id: number, input: UpdateUserInput): Promise<ItemResponse<UserDTO>> {
    return request<ItemResponse<UserDTO>>(`/users/${id}`, { method: 'PUT', body: input });
  },
  remove(id: number): Promise<OkResponse> {
    return request<OkResponse>(`/users/${id}`, { method: 'DELETE' });
  },
};

export const healthApi = {
  /**
   * 契约中健康检查为 GET /health；不同部署可能挂在 v1 下，
   * 因此先试 /api/v1/health，仅在 404 时回退到 /health。
   */
  async check(): Promise<HealthDTO> {
    try {
      return await request<HealthDTO>('/health', { base: '/api/v1', skipAuth: true });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return await request<HealthDTO>('/health', { base: '', skipAuth: true });
      }
      throw error;
    }
  },
};

/**
 * 图表接口。
 *
 * 注意：/charts 系列路由直接返回图表记录本身，**没有** `{ item }` 包装
 * （见 apps/server/src/routes/visualization.ts 的 reply.send(chart)），
 * 因此这里不能套用 ItemResponse，否则会在运行时访问到 undefined。
 */
export const chartApi = {
  types(): Promise<ItemsResponse<ChartTypeInfoDTO>> {
    return request<ItemsResponse<ChartTypeInfoDTO>>('/charts/types');
  },
  list(query: ChartListQuery = {}): Promise<ItemsResponse<ChartDTO>> {
    return request<ItemsResponse<ChartDTO>>('/charts', {
      query: {
        dashboardId: query.dashboardId,
        allUsers: query.allUsers === undefined ? undefined : query.allUsers,
      },
    });
  },
  get(id: number): Promise<ChartDTO> {
    return request<ChartDTO>(`/charts/${id}`);
  },
  create(input: ChartInput): Promise<ChartDTO> {
    return request<ChartDTO>('/charts', { method: 'POST', body: input });
  },
  update(id: number, input: Partial<ChartInput>): Promise<ChartDTO> {
    return request<ChartDTO>(`/charts/${id}`, { method: 'PATCH', body: input });
  },
  remove(id: number): Promise<OkResponse> {
    return request<OkResponse>(`/charts/${id}`, { method: 'DELETE' });
  },
  /** 取图表数据：渲染的唯一数据来源，SQL 由服务端按结构化配置生成 */
  data(id: number, options: { limit?: number; maxRows?: number } = {}): Promise<ChartDataDTO> {
    return request<ChartDataDTO>(`/charts/${id}/data`, {
      query: { limit: options.limit, maxRows: options.maxRows },
    });
  },
};

/** 看板接口；GET /dashboards/:id 返回记录本身并附带 charts 数组（同样无 item 包装） */
export const dashboardApi = {
  list(): Promise<ItemsResponse<DashboardDTO>> {
    return request<ItemsResponse<DashboardDTO>>('/dashboards');
  },
  get(id: number): Promise<DashboardDetailDTO> {
    return request<DashboardDetailDTO>(`/dashboards/${id}`);
  },
  create(input: DashboardInput): Promise<DashboardDTO> {
    return request<DashboardDTO>('/dashboards', { method: 'POST', body: input });
  },
  update(id: number, input: Partial<DashboardInput>): Promise<DashboardDTO> {
    return request<DashboardDTO>(`/dashboards/${id}`, { method: 'PATCH', body: input });
  },
  remove(id: number): Promise<OkResponse> {
    return request<OkResponse>(`/dashboards/${id}`, { method: 'DELETE' });
  },
};
