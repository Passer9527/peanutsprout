/**
 * 花生苗 Web 端 DTO 类型定义。
 *
 * 严格对应后端冻结的 REST 契约（基址 /api/v1），新增字段需同步后端契约。
 */

/** 执行结果单元格：契约只允许字符串、数字或 NULL */
export type QueryCell = string | number | null;

/** 后端统一错误响应体：{ error: { code, message, details? } } */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

/** 用户管理接口（GET /users 等）返回的用户 */
export interface UserDTO {
  id: number;
  username: string;
  /** 数据库中 display_name 可为空（后端原样返回 null），展示层需回退到 username */
  displayName: string | null;
  email: string | null;
  status: string;
  isAdmin: boolean;
  roles: string[];
  lastLoginAt: string | null;
  createdAt: string;
}

/** 登录与 /auth/me 返回的当前用户，附带权限清单 */
export interface AuthUserDTO {
  id: number;
  username: string;
  /** 同 UserDTO：可为 null，界面需回退到 username */
  displayName: string | null;
  email: string | null;
  isAdmin: boolean;
  roles: string[];
  permissions: string[];
  status?: string;
  lastLoginAt?: string | null;
  createdAt?: string;
}

export interface ConnectionDTO {
  id: number;
  name: string;
  groupId: number | null;
  dbType: string;
  host: string | null;
  port: number | null;
  databaseName: string | null;
  username: string | null;
  hasPassword: boolean;
  connectionUrl: string | null;
  colorTag: string | null;
  isReadOnly: boolean;
  isFavorite: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogDTO {
  id: number;
  username: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  connectionId: number | null;
  sqlText: string | null;
  status: string;
  errorMessage: string | null;
  ipAddress: string | null;
  createdAt: string;
  currHash: string | null;
}

export interface LoginResponse {
  token: string;
  expiresIn: number;
  user: AuthUserDTO;
  /** 仍在使用内置默认口令时为 true：此时除改密相关接口外一律会被服务端拒绝 */
  mustChangePassword: boolean;
}

export interface ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  serverVersion: string | null;
  message: string;
}

export interface SchemaDTO {
  name: string;
}

export interface TableDTO {
  name: string;
  type: string;
  comment: string | null;
}

export interface ColumnDTO {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  comment: string | null;
  isPrimaryKey: boolean;
  ordinal: number;
}

export interface QueryColumnDTO {
  name: string;
  dataType: string;
}

export interface QueryResultDTO {
  queryId: string;
  columns: QueryColumnDTO[];
  rows: QueryCell[][];
  rowCount: number;
  affectedRows: number;
  durationMs: number;
  truncated: boolean;
  notices: string[];
}

export interface ExplainPlanDTO {
  format: 'text';
  content: string;
}

export interface QueryHistoryDTO {
  id: number;
  connectionId: number;
  connectionName: string;
  sqlText: string;
  status: string;
  durationMs: number;
  affectedRows: number;
  resultRows: number;
  isSlow: boolean;
  executedAt: string;
  errorMessage: string | null;
}

/** 驱动能力声明（与 packages/core 的 DriverCapabilities 一致） */
export interface DriverCapabilitiesDTO {
  schemas: boolean;
  transactions: boolean;
  explain: boolean;
  streaming: boolean;
  serverSidePagination: boolean;
  cdc: boolean;
  ddl: boolean;
}

/**
 * GET /meta/db-types 的元素。
 *
 * 后端直接返回 `ctx.registry.list()`（即 DriverDescriptor），字段名是 `dbType`
 * 而不是 `code`；这里必须严格对齐，否则下拉框的 value 会变成 undefined，
 * 提交体里缺少 dbType 而被后端以 400 拒绝。
 */
export interface DbTypeDTO {
  dbType: string;
  label: string;
  category: string;
  defaultPort: number | null;
  networkRequired: boolean;
  driverImplemented: boolean;
  driverName: string;
  driverVersion: string;
  capabilities: DriverCapabilitiesDTO;
}

export interface HealthDTO {
  status: string;
  version: string;
  uptimeSec: number;
}

export interface AuditVerifyDTO {
  ok: boolean;
  checked: number;
  brokenAt: number | null;
}

export interface OkResponse {
  ok: boolean;
}

export interface ItemResponse<T> {
  item: T;
}

export interface ItemsResponse<T> {
  items: T[];
  /** 服务端给出的真实总数（可选：只有分页接口会返回，且总是精确值而非当页条数） */
  total?: number;
}

export interface AuthUserResponse {
  user: AuthUserDTO;
  /** 刷新页面后仍要能恢复"必须先改密"的状态 */
  mustChangePassword: boolean;
}

/** 连接列表查询条件，对应 GET /connections?search=&dbType=&favorite= */
export interface ConnectionFilter {
  search?: string;
  dbType?: string;
  favorite?: boolean;
}

/** 新建 / 更新连接请求体；更新时省略 password 表示不修改密码 */
export interface ConnectionInput {
  name: string;
  dbType: string;
  host?: string;
  port?: number;
  databaseName?: string;
  username?: string;
  password?: string;
  connectionUrl?: string;
  colorTag?: string;
  isReadOnly?: boolean;
  isFavorite?: boolean;
  groupId?: number;
  extraParams?: Record<string, unknown>;
}

export interface CreateUserInput {
  username: string;
  password: string;
  displayName?: string;
  email?: string;
  isAdmin?: boolean;
  roles?: string[];
}

/** 更新用户；password 省略表示不重置密码 */
export interface UpdateUserInput {
  displayName?: string;
  email?: string;
  isAdmin?: boolean;
  roles?: string[];
  password?: string;
}

export interface ExecuteQueryInput {
  connectionId: number;
  sql: string;
  maxRows?: number;
  timeoutMs?: number;
  /** 写语句必须显式二次确认；后端未收到 confirm=true 时返回 428 CONFIRMATION_REQUIRED */
  confirm?: boolean;
}

export interface AuditLogQuery {
  limit?: number;
  offset?: number;
  action?: string;
  userId?: number;
}

/* ------------------------------------------------------------------ 图表与看板 */

/**
 * 图表类型标识。后端 core 的 CHART_TYPES 是唯一口径，
 * 这里保留 string 兜底以兼容未来新增类型（前端按类型白名单决定能否渲染）。
 */
export type ChartTypeKey =
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

/**
 * 图表聚合方式（core 的 Aggregation 中**已真正实现**的子集）。
 * 刻意不含 'median'：服务端没有可靠的中位数实现，旧版曾把它映射成 AVG，
 * 界面选「中位数」拿到的却是平均值。这里移除该选项，避免用户再次踩到静默错误；
 * 服务端也会对 median 明确返回 VALIDATION_FAILED（见 visualization 的校验）。
 */
export type ChartAggregation =
  | 'none'
  | 'sum'
  | 'avg'
  | 'count'
  | 'count_distinct'
  | 'min'
  | 'max';

/** 与 packages/visualization 的 CHART_FILTER_OPERATORS 严格一致 */
export type ChartFilterOperator =
  | '='
  | '!='
  | '<>'
  | '>'
  | '>='
  | '<'
  | '<='
  | 'in'
  | 'like'
  | 'is null'
  | 'is not null';

export type ChartDataSource = 'table' | 'view' | 'query';
export type ChartRefreshMode = 'manual' | 'interval' | 'websocket';

/** GET /charts/types 的元素 */
export interface ChartTypeInfoDTO {
  type: string;
  label: string;
  minDimensions: number;
  minMetrics: number;
  description: string;
}

export interface ChartFieldDTO {
  column: string;
  aggregation: ChartAggregation;
  alias?: string;
}

export interface ChartFilterDTO {
  column: string;
  operator: ChartFilterOperator;
  value: unknown;
}

export interface ChartSortDTO {
  column: string;
  direction: 'asc' | 'desc';
}

export interface ChartConfigDTO {
  dimensions: ChartFieldDTO[];
  metrics: ChartFieldDTO[];
  filters?: ChartFilterDTO[];
  sort?: ChartSortDTO[];
  limit?: number | null;
  style?: Record<string, unknown>;
}

/** 图表记录；POST/GET/PATCH /charts 直接返回该对象（没有 item 包装） */
export interface ChartDTO {
  id: number;
  dashboardId: number | null;
  userId: number;
  name: string;
  chartType: string;
  connectionId: number | null;
  dataSource: string | null;
  sourceRef: string | null;
  querySql: string | null;
  config: ChartConfigDTO;
  refreshMode: string | null;
  refreshSec: number | null;
  createdAt: string;
  updatedAt: string;
}

/** 新建 / 更新图表的请求体 */
export interface ChartInput {
  name: string;
  chartType: string;
  dashboardId?: number | null;
  connectionId?: number | null;
  dataSource?: ChartDataSource;
  sourceRef?: string | null;
  querySql?: string | null;
  config: ChartConfigDTO;
  refreshMode?: ChartRefreshMode | null;
  refreshSec?: number | null;
}

/** GET /charts/:id/data —— 渲染图表唯一的数据来源 */
export interface ChartDataDTO {
  chartId: number;
  chartType: string;
  sql: string;
  columns: QueryColumnDTO[];
  rows: QueryCell[][];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
}

/** 看板记录；GET /dashboards/:id 会在其上附加 charts 数组 */
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

export interface DashboardDetailDTO extends DashboardDTO {
  charts: ChartDTO[];
}

export interface DashboardInput {
  name: string;
  description?: string | null;
  layout?: Record<string, unknown> | null;
  isShared?: boolean;
}

export interface ChartListQuery {
  dashboardId?: number;
  allUsers?: boolean;
}

// ---------------------------------------------------------------- AI 助手

/** 供应商种类（与后端 AiProviderKind 一致） */
export type AiProviderKind =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'qwen'
  | 'ernie'
  | 'zhipu'
  | 'deepseek'
  | 'ollama'
  | 'openai-compatible';

/** AI 技能场景（与后端 AiScene 一致；object_manage 暂无界面入口） */
export type AiScene = 'nl2sql' | 'explain' | 'optimize' | 'document' | 'ask' | 'diagnose';

/**
 * 模型配置。
 * 注意**没有** apiKey 字段：后端只回传 hasApiKey 布尔值，密钥永不回到浏览器。
 */
export interface AiConfigDTO {
  id: number;
  name: string;
  provider: string;
  modelName: string;
  baseUrl: string | null;
  temperature: number;
  maxTokens: number | null;
  timeoutMs: number;
  isDefault: boolean;
  enabled: boolean;
  hasApiKey: boolean;
  extraParams: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AiConfigInput {
  name: string;
  provider: string;
  modelName: string;
  apiKey?: string | null;
  baseUrl?: string | null;
  temperature?: number;
  maxTokens?: number | null;
  timeoutMs?: number;
  isDefault?: boolean;
  enabled?: boolean;
}

/** GET /ai/status */
export interface AiStatusDTO {
  enabled: boolean;
  configured: boolean;
  config: { id: number; name: string; provider: string; modelName: string } | null;
  redactionEnabled: boolean;
}

/** 连通性测试 / 模型列举的入参：指向已保存配置，或直接给表单临时值 */
export interface AiProbeInput {
  configId?: number;
  provider?: string;
  modelName?: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  name?: string;
  temperature?: number;
  timeoutMs?: number;
}

export interface AiProbeResultDTO {
  ok: true;
  latencyMs: number;
  provider: string;
  model: string;
  reply: string;
}

export interface AiModelsDTO {
  models: string[];
  provider: string;
  baseUrl: string | null;
}

/** 可写设置项（GET /meta/settings/writable） */
export interface WritableSettingDTO {
  key: string;
  category: string;
  type: 'boolean' | 'integer' | 'enum';
  min?: number;
  max?: number;
  values?: readonly string[];
  note: string;
}

export interface SettingItemDTO {
  key: string;
  value: string | null;
  category: string | null;
  updatedAt: string;
}

/** Web 页面访问风险提示（GET /meta/web-access） */
export type WebAccessWarning = 'lan_exposed' | 'no_https' | 'default_password';

/**
 * Web 页面访问状态（GET /meta/web-access）。
 *
 * `saved` 是设置里存下来的值，`effective` 是**本次进程启动时实际生效**的值：
 * 绑定地址必须在 listen 之前决定，所以保存后要重启才生效。
 * 界面必须把两者分开展示，否则会出现"显示已开启、实际连不上"的假象。
 */
export interface WebAccessDTO {
  saved: { lanEnabled: boolean; lanPort: number };
  effective: { lanEnabled: boolean; host: string; port: number; scheme: string };
  restartRequired: boolean;
  /** 可直接贴给别人的访问地址（关闭局域网时只有回环地址） */
  urls: string[];
  /** 本机所有可用的 IPv4 局域网地址 */
  lanAddresses: string[];
  warnings: WebAccessWarning[];
  /** 是否运行在桌面端内嵌服务里（桌面窗口始终走 127.0.0.1，不受该开关影响） */
  embedded: boolean;
}

export interface AiHistoryDTO {
  id: number;
  scene: string;
  status: string;
  prompt: string | null;
  response: string | null;
  tokensInput: number | null;
  tokensOutput: number | null;
  durationMs: number | null;
  createdAt: string;
}

/** nl2sql 结果（后端 SqlGenerationResult） */
export interface AiSqlResultDTO {
  sql: string;
  explanation: string;
  confidence: number;
  referencedTables: string[];
  requiresConfirmation: boolean;
  raw?: string;
  executed?: boolean;
  /** 本次调用写入 ai_history 的记录 id；撤回/回退靠它定位服务端记录 */
  historyId?: number | null;
  /** 后端回显的生成目标连接（执行 / 导出时用，省得界面再猜一次） */
  connectionId?: number;
}

/** 每个 AI 场景的响应都带 historyId，撤回/回退据此定位服务端记录。 */
export interface WithHistoryId {
  historyId?: number | null;
}

export interface AiSuggestionDTO {
  title: string;
  detail: string;
  rewrittenSql?: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface AiOptimizeResultDTO extends WithHistoryId {
  suggestions: AiSuggestionDTO[];
  raw?: string;
}

export interface AiDiagnoseResultDTO extends WithHistoryId {
  cause: string;
  suggestions: string[];
  raw?: string;
}

/* ------------------------------------------------------------------ 表数据编辑器 */

/** 单元格值：与后端 `CellValue` 对齐 */
export type CellValue = string | number | boolean | null;

/** 一行记录在界面上的定位符（主键或唯一索引） */
export type RowLocatorKind = 'primary_key' | 'unique_index' | 'none';

export interface RowLocatorDTO {
  kind: RowLocatorKind;
  /** 参与定位的列（按序） */
  columns: string[];
  /** kind 为 unique_index 时有值 */
  indexName?: string;
}

/** 只读原因。null 表示可写。 */
export type TableReadOnlyReason = 'no_primary_key' | 'no_permission' | 'connection_readonly' | null;

export interface TableColumnsResponse {
  columns: ColumnInfoDTO[];
  locator: RowLocatorDTO;
  editable: boolean;
  readOnlyReason: TableReadOnlyReason;
}

export interface TableRowsResponse extends TableColumnsResponse {
  rows: CellValue[][];
  /** 无法统计（表过大等）时为 null，界面应显示"行数未知"而不是 0 */
  total: number | null;
  page: number;
  pageSize: number;
}

export interface TableRowsInput {
  connectionId: number;
  schema: string;
  table: string;
  page?: number;
  pageSize?: number;
  orderBy?: string | null;
  orderDir?: 'asc' | 'desc';
}

/** 一行的定位键值：列名 → 值。必须覆盖 locator.columns 的全部列。 */
export type RowKey = Record<string, CellValue>;

/* ------------------------------------------------------------------ 可视化建库建表 */

export interface DdlColumnInput {
  name: string;
  dataType: string;
  /** 长度 / 精度；不填则用类型默认 */
  length?: number | null;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue?: string | null;
  comment?: string | null;
}

export interface DdlIndexInput {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface DdlTableSpec {
  connectionId: number;
  schema: string;
  table: string;
  columns: DdlColumnInput[];
  indexes: DdlIndexInput[];
  ifNotExists?: boolean;
}

export interface SchemaSupportDTO {
  dbType: string;
  supported: boolean;
  /** 支持的库返回 'SCHEMA' 或 'DATABASE'，用于提示将执行哪种语句 */
  keyword: 'SCHEMA' | 'DATABASE' | null;
}

export interface ColumnTypeDTO {
  name: string;
  category: string;
  hasLength: boolean;
}

export interface ColumnTypesResponse {
  dbType: string;
  types: ColumnTypeDTO[];
}

/** 列元信息（与后端 `ColumnInfo` 对齐，界面只用到其中一部分） */
export interface ColumnInfoDTO {
  schema: string;
  table: string;
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  comment: string | null;
  isPrimaryKey: boolean;
  ordinal: number;
}

/**
 * DDL 执行的入参。`confirm` 由界面在用户确认之后显式传 true；
 * 服务端对缺少 confirm 的请求返回 428（与 `/query/execute` 的写操作同一约定）。
 */
export interface DdlExecuteInput extends DdlTableSpec {
  confirm?: boolean;
}

export interface DdlCreateSchemaInput {
  connectionId: number;
  name: string;
  confirm?: boolean;
}

export interface DdlDropTableInput {
  connectionId: number;
  schema: string;
  table: string;
  confirm?: boolean;
}
