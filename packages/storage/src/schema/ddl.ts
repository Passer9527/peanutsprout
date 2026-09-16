/**
 * 花生苗数据库管理工具 - 本地 SQLite3 权威 DDL
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 这是数据库结构的**唯一真源**。`pnpm ddl:export` 会把本文件导出为 docs/ddl.sql，
 * 请勿手工维护 docs/ddl.sql。
 */

export const BASE_DDL = /* sql */ `
-- ============================================================
-- 花生苗数据库管理工具 本地库结构 v0001_init
-- Copyright (C) 2025 飞哥 (微信 6731663)
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- 适用：SQLite3（Node 内置 node:sqlite），WAL 模式
-- ============================================================

-- ---------- 一、用户与权限 ----------

CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    display_name    TEXT,
    email           TEXT,
    phone           TEXT,
    status          INTEGER NOT NULL DEFAULT 1,  -- 1启用 0禁用
    is_admin        INTEGER NOT NULL DEFAULT 0,
    totp_secret     TEXT,
    totp_enabled    INTEGER NOT NULL DEFAULT 0,
    last_login_at   DATETIME,
    last_login_ip   TEXT,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until    DATETIME,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    is_builtin  INTEGER NOT NULL DEFAULT 0,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS permissions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT NOT NULL UNIQUE,   -- 如 conn.read, query.write
    name        TEXT NOT NULL,
    category    TEXT,
    description TEXT
);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id     INTEGER NOT NULL,
    role_id     INTEGER NOT NULL,
    PRIMARY KEY (user_id, role_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id       INTEGER NOT NULL,
    permission_id INTEGER NOT NULL,
    PRIMARY KEY (role_id, permission_id),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

-- 资源级授权（连接 / 库 / 表）
CREATE TABLE IF NOT EXISTS resource_grants (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    resource_type TEXT NOT NULL,   -- connection / schema / table
    resource_id   TEXT NOT NULL,
    actions       TEXT NOT NULL,   -- JSON 数组：["read","write"]
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_resource_grants_user ON resource_grants(user_id, resource_type);

-- 登录会话（JWT 吊销与在线会话管理）
CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,          -- 会话 UUID
    user_id     INTEGER NOT NULL,
    token_hash  TEXT NOT NULL,             -- JWT 的 sha256，落库不存明文令牌
    ip_address  TEXT,
    user_agent  TEXT,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at  DATETIME NOT NULL,
    revoked_at  DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);

-- ---------- 二、连接管理 ----------

CREATE TABLE IF NOT EXISTS connection_groups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    parent_id   INTEGER,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES connection_groups(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS connections (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    group_id        INTEGER,
    db_type         TEXT NOT NULL,       -- mysql/postgresql/sqlite/...
    host            TEXT,
    port            INTEGER,
    database_name   TEXT,
    username        TEXT,
    password_enc    BLOB,                -- AES-256-GCM 密文
    connection_url  TEXT,
    ssh_config_enc  BLOB,
    ssl_config_enc  BLOB,
    extra_params    TEXT,                -- JSON
    color_tag       TEXT,
    is_read_only    INTEGER NOT NULL DEFAULT 0,
    is_favorite     INTEGER NOT NULL DEFAULT 0,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    last_used_at    DATETIME,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES connection_groups(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_connections_group ON connections(group_id);
CREATE INDEX IF NOT EXISTS idx_connections_type ON connections(db_type);

-- 驱动注册（内置驱动与自定义驱动）
CREATE TABLE IF NOT EXISTS drivers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    db_type       TEXT NOT NULL,
    version       TEXT NOT NULL,
    jar_path      TEXT,                  -- 兼容 PRD 字段名：JDBC/ODBC 驱动包路径
    is_builtin    INTEGER NOT NULL DEFAULT 0,
    enabled       INTEGER NOT NULL DEFAULT 1,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------- 三、SQL 历史与片段 ----------

CREATE TABLE IF NOT EXISTS query_history (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    connection_id INTEGER,
    sql_text      TEXT NOT NULL,
    sql_hash      TEXT,
    status        TEXT NOT NULL,       -- success / failed / cancelled
    error_message TEXT,
    duration_ms   INTEGER,
    affected_rows INTEGER,
    result_rows   INTEGER,
    is_slow       INTEGER NOT NULL DEFAULT 0,
    executed_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_query_history_user_time ON query_history(user_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_query_history_conn ON query_history(connection_id);
CREATE INDEX IF NOT EXISTS idx_query_history_slow ON query_history(is_slow);

CREATE TABLE IF NOT EXISTS sql_snippets (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    connection_id INTEGER,
    name          TEXT NOT NULL,
    sql_text      TEXT NOT NULL,
    tags          TEXT,                -- JSON 数组
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sql_snippets_user ON sql_snippets(user_id);

-- ---------- 四、审计日志 ----------

CREATE TABLE IF NOT EXISTS audit_logs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER,
    username      TEXT,
    action        TEXT NOT NULL,       -- login / execute / migrate / ai / ...
    resource_type TEXT,
    resource_id   TEXT,
    connection_id INTEGER,
    detail        TEXT,                -- JSON
    sql_text      TEXT,
    ip_address    TEXT,
    user_agent    TEXT,
    status        TEXT NOT NULL,
    error_message TEXT,
    duration_ms   INTEGER,
    prev_hash     TEXT,
    curr_hash     TEXT,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- 哈希版本：1 = 历史格式（规范化 11 字段，null 与 '' 不可区分；只用于校验老行），
    -- 2 = 当前格式（额外纳入 ip_address / user_agent / duration_ms，并用类型前缀区分 null）。
    -- 老库由迁移 0003 用 ALTER TABLE ADD COLUMN 补上（SQLite 会追加在末尾），
    -- 所以这里也刻意放在最后一列，让新旧库的列顺序保持一致。
    hash_version  INTEGER NOT NULL DEFAULT 1
    -- 注意：这里刻意不加 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL。
    --
    -- user_id 参与哈希链计算（见 repositories/audit.ts 的 computeAuditHash），
    -- 因此任何对历史行的改写都会让链校验失败。而 ON DELETE SET NULL 恰恰会在
    -- 删除用户时把该用户所有审计行的 user_id 改成 NULL —— 结果是删一个用户就
    -- 永久打断审计链，与「哈希链可校验、可检测篡改」的核心承诺直接冲突。
    -- （已实测：删除用户后 verifyChain() 由 ok:true 变为 ok:false, brokenAt:1。）
    --
    -- 审计日志必须不可变：user_id 只作历史记录保留，不再受外键约束；
    -- 操作人身份另有 username 冗余保存在同一行，删用户不会丢失「是谁做的」。
);

CREATE INDEX IF NOT EXISTS idx_audit_user_time ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_conn ON audit_logs(connection_id);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at DESC);

-- ---------- 五、AI 配置与历史 ----------

CREATE TABLE IF NOT EXISTS ai_configs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    provider      TEXT NOT NULL,       -- openai / anthropic / ollama ...
    model_name    TEXT NOT NULL,
    api_key_enc   BLOB,
    base_url      TEXT,
    temperature   REAL NOT NULL DEFAULT 0.2,
    max_tokens    INTEGER,
    timeout_ms    INTEGER NOT NULL DEFAULT 60000,
    is_default    INTEGER NOT NULL DEFAULT 0,
    enabled       INTEGER NOT NULL DEFAULT 1,
    extra_params  TEXT,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_history (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    config_id     INTEGER,
    scene         TEXT NOT NULL,       -- nl2sql / explain / optimize ...
    prompt        TEXT,
    response      TEXT,
    tokens_input  INTEGER,
    tokens_output INTEGER,
    duration_ms   INTEGER,
    status        TEXT NOT NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (config_id) REFERENCES ai_configs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_history_user ON ai_history(user_id, created_at DESC);

-- ---------- 六、迁移与同步 ----------

CREATE TABLE IF NOT EXISTS migrations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    name            TEXT,
    source_conn_id  INTEGER NOT NULL,
    target_conn_id  INTEGER NOT NULL,
    source_schema   TEXT,
    target_schema   TEXT,
    tables          TEXT,              -- JSON 数组
    mode            TEXT NOT NULL,     -- full / incremental / sync
    status          TEXT NOT NULL,     -- pending / running / success / failed / cancelled
    precheck_result TEXT,
    total_rows      INTEGER,
    success_rows    INTEGER,
    failed_rows     INTEGER,
    skipped_rows    INTEGER,
    error_message   TEXT,
    started_at      DATETIME,
    finished_at     DATETIME,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (source_conn_id) REFERENCES connections(id),
    FOREIGN KEY (target_conn_id) REFERENCES connections(id)
);

CREATE INDEX IF NOT EXISTS idx_migrations_status ON migrations(status);
CREATE INDEX IF NOT EXISTS idx_migrations_user ON migrations(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS migration_checkpoints (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    migration_id  INTEGER NOT NULL,
    table_name    TEXT NOT NULL,
    last_key      TEXT,
    last_offset   INTEGER,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (migration_id) REFERENCES migrations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_migration_checkpoints ON migration_checkpoints(migration_id, table_name);

CREATE TABLE IF NOT EXISTS migration_errors (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    migration_id  INTEGER NOT NULL,
    table_name    TEXT,
    row_key       TEXT,
    error_message TEXT,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (migration_id) REFERENCES migrations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_migration_errors ON migration_errors(migration_id);

-- ---------- 七、看板与图表 ----------

CREATE TABLE IF NOT EXISTS dashboards (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    layout      TEXT,                  -- JSON
    is_shared   INTEGER NOT NULL DEFAULT 0,
    share_token TEXT UNIQUE,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS charts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    dashboard_id  INTEGER,
    user_id       INTEGER NOT NULL,
    name          TEXT NOT NULL,
    chart_type    TEXT NOT NULL,       -- bar / line / parallel / ...
    connection_id INTEGER,
    data_source   TEXT,                -- table / view / query
    source_ref    TEXT,
    query_sql     TEXT,
    config        TEXT NOT NULL,       -- JSON：维度、指标、聚合、样式
    refresh_mode  TEXT,                -- manual / interval / websocket
    refresh_sec   INTEGER,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_charts_dashboard ON charts(dashboard_id);
CREATE INDEX IF NOT EXISTS idx_charts_user ON charts(user_id);

-- ---------- 八、定时任务 ----------

CREATE TABLE IF NOT EXISTS schedules (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    name          TEXT NOT NULL,
    task_type     TEXT NOT NULL,       -- export / sync / report / backup
    cron_expr     TEXT NOT NULL,
    config        TEXT NOT NULL,       -- JSON
    enabled       INTEGER NOT NULL DEFAULT 1,
    last_run_at   DATETIME,
    last_status   TEXT,
    next_run_at   DATETIME,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_schedules_next ON schedules(next_run_at);

-- ---------- 九、插件与设置 ----------

CREATE TABLE IF NOT EXISTS plugins (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL UNIQUE,
    version       TEXT NOT NULL,
    type          TEXT NOT NULL,       -- driver / chart / ai / export
    path          TEXT NOT NULL,
    enabled       INTEGER NOT NULL DEFAULT 1,
    config        TEXT,
    installed_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT,
    category    TEXT,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT PRIMARY KEY,
    applied_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------- 十、updated_at 自动维护 ----------

CREATE TRIGGER IF NOT EXISTS trg_users_updated_at AFTER UPDATE ON users
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_connections_updated_at AFTER UPDATE ON connections
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE connections SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_ai_configs_updated_at AFTER UPDATE ON ai_configs
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE ai_configs SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_dashboards_updated_at AFTER UPDATE ON dashboards
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE dashboards SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_charts_updated_at AFTER UPDATE ON charts
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE charts SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_schedules_updated_at AFTER UPDATE ON schedules
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE schedules SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_sql_snippets_updated_at AFTER UPDATE ON sql_snippets
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE sql_snippets SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;
`;

/** 内置角色（PRD 第八部分 十一、初始化数据）。 */
export const SEED_ROLES = /* sql */ `
INSERT OR IGNORE INTO roles (name, description, is_builtin) VALUES
('admin',     '管理员，拥有全部权限', 1),
('developer', '开发者，可读写授权连接', 1),
('readonly',  '只读用户，仅可查询', 1);
`;

/** 内置权限项。 */
export const SEED_PERMISSIONS = /* sql */ `
INSERT OR IGNORE INTO permissions (code, name, category) VALUES
('conn.read',      '查看连接',   'connection'),
('conn.write',     '管理连接',   'connection'),
('query.read',     '执行查询',   'query'),
('query.write',    '执行写操作', 'query'),
('migrate.read',   '查看迁移',   'migration'),
('migrate.write',  '执行迁移',   'migration'),
('ai.use',         '使用 AI',    'ai'),
('user.manage',    '用户管理',   'user'),
('audit.read',     '查看审计',   'audit'),
('settings.manage','系统设置',   'settings');
`;

/** 角色 -> 权限绑定。 */
export const SEED_ROLE_PERMISSIONS = /* sql */ `
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE r.name = 'admin';

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE r.name = 'developer'
  AND p.code IN ('conn.read','query.read','query.write','migrate.read','migrate.write','ai.use');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE r.name = 'readonly'
  AND p.code IN ('conn.read','query.read');
`;

/** 默认全局设置。 */
export const SEED_SETTINGS = /* sql */ `
INSERT OR IGNORE INTO settings (key, value, category) VALUES
('app.theme',              'system', 'ui'),
('app.language',           'zh-CN',  'ui'),
('query.max_rows',         '10000',  'query'),
('query.timeout_ms',       '30000',  'query'),
('query.slow_threshold_ms','1000',   'query'),
('security.readonly_default', 'false','security'),
('security.audit_retention_days', '180', 'security'),
('security.auto_lock_minutes', '30', 'security'),
('ai.enabled',             'false',  'ai'),
('ai.redaction_enabled',   'true',   'ai'),
('ai.production_write_allowed', 'false', 'ai');
`;
