/**
 * 花生苗数据库管理工具 - 迁移引擎
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 引擎**只依赖驱动 SPI**，不依赖任何具体数据库，因此新增一种数据库时
 * 迁移能力会自动获得（PRD M05-06 异构迁移、M05-07 预检、M05-08 报告）。
 *
 * 安全与正确性约束：
 *  - 插入一律使用绑定参数（? 占位符），绝不拼接值；
 *  - 表名/列名经驱动侧标识符校验后再拼进 DDL，杜绝标识符注入；
 *  - 预检把 lossy 类型映射收集成 warning，交由人工确认（PRD 十一、风险）；
 *  - 已在目标库存在的表默认不覆盖（除非 conflictStrategy=overwrite）。
 */

import { quoteIdent, quoteIdentBacktick } from '@peanutsprout/drivers';
import {
  PeanutError,
  notFound,
  splitSqlStatements,
  validationFailed,
  type CellValue,
  type ColumnInfo,
  type ConnectionConfig,
  type DatabaseDriver,
  type DriverConnection,
  type MigrationIssue,
  type MigrationMode,
  type MigrationPrecheckResult,
  type MigrationRequest,
  type MigrationResult,
  type QueryResult,
  type SyncRequest,
  type ProgressCallback,
} from '@peanutsprout/core';

export interface MigrationEngineDeps {
  /** 按 dbType 解析驱动 */
  resolveDriver: (dbType: string) => DatabaseDriver;
  /** 按连接 id 取（已解密的）连接配置 */
  resolveConfig: (connectionId: number) => ConnectionConfig | null;
}

export interface MigrationEngineOptions {
  /** 单批提交行数 */
  batchSize?: number;
  /** 失败重试次数 */
  retry?: number;
}

/**
 * 分页/排序方式。缺陷回归：SQL 没有 ORDER BY 时 LIMIT/OFFSET 的行序由数据库自由决定，
 * 不同批次可能给出不同顺序，导致漏行/重复行且不报任何错。因此每张表都必须有稳定排序，
 * 并把实际采用的方式显式写进报告。
 */
export type TablePagination = 'primary-key' | 'all-columns' | 'single-pass';

/** 单表迁移明细：比 MigrationResult 更细，用于在报告里标注分页方式与跳过原因。 */
export interface TableMigrationReport {
  table: string;
  pagination: TablePagination;
  /** 实际用于稳定排序的列 */
  orderBy: string[];
  status: 'success' | 'failed' | 'skipped' | 'cancelled';
  totalRows: number | null;
  successRows: number;
  skippedRows: number;
  failedRows: number;
  message?: string;
}

/**
 * 引擎返回的迁移结果：在标准 MigrationResult 之上附加逐表明细，
 * 并允许整体状态为 `skipped`（整表被安全跳过时绝不谎报 success）。
 */
export type MigrationOutcome = Omit<MigrationResult, 'status'> & {
  status: MigrationResult['status'] | 'skipped';
  tables: TableMigrationReport[];
};

const DEFAULT_BATCH = 500;
const DEFAULT_RETRY = 2;

export class MigrationEngine {
  private readonly cancelled = new Set<string>();
  private readonly batchSize: number;
  private readonly retry: number;

  constructor(
    private readonly deps: MigrationEngineDeps,
    options: MigrationEngineOptions = {},
  ) {
    this.batchSize = options.batchSize ?? DEFAULT_BATCH;
    this.retry = options.retry ?? DEFAULT_RETRY;
  }

  private async connections(
    request: MigrationRequest,
  ): Promise<{ source: DriverConnection; target: DriverConnection; close: () => Promise<void> }> {
    const sourceConfig = this.deps.resolveConfig(request.sourceConnectionId);
    if (!sourceConfig) throw notFound('源连接', request.sourceConnectionId);
    const targetConfig = this.deps.resolveConfig(request.targetConnectionId);
    if (!targetConfig) throw notFound('目标连接', request.targetConnectionId);

    const source = await this.deps.resolveDriver(sourceConfig.dbType).connect(sourceConfig);
    let target: DriverConnection;
    try {
      target = await this.deps.resolveDriver(targetConfig.dbType).connect(targetConfig);
    } catch (e) {
      await source.close().catch(() => undefined);
      throw e;
    }

    return {
      source,
      target,
      close: async () => {
        await Promise.allSettled([source.close(), target.close()]);
      },
    };
  }

  /**
   * 迁移预检：结构差异、类型映射、有损映射、行数估算、目标端冲突。
   * 不写入任何数据（PRD 4.3「迁移前预检」「迁移预检报告」）。
   */
  async precheck(request: MigrationRequest): Promise<MigrationPrecheckResult> {
    const issues: MigrationIssue[] = [];
    // 与 migrate 保持一致：非 full 模式明确报 error，避免用户以为增量/同步可用。
    if (request.mode !== 'full') {
      issues.push({
        level: 'error',
        message: `当前版本仅支持全量迁移（mode=full），不支持 mode=${request.mode}`,
      });
    }
    const { source, target, close } = await this.connections(request);
    const tableMappings: MigrationPrecheckResult['tableMappings'] = [];
    let estimatedRows = 0;

    try {
      const sourceSchema = request.sourceSchema ?? this.defaultSchemaFor(source.config.dbType);
      const targetSchema = request.targetSchema ?? this.defaultSchemaFor(target.config.dbType);
      const sourceMapper = source.getTypeMapper();
      const targetDbType = target.config.dbType;

      const allTables = await source.getMetadata().listTables(sourceSchema);
      const tableNames =
        request.tables.length > 0 ? request.tables : allTables.filter((t) => t.kind === 'table').map((t) => t.name);

      if (tableNames.length === 0) {
        issues.push({ level: 'warning', message: '源库中没有可迁移的表' });
      }

      // 目标端已有表：默认 skip，避免静默覆盖生产数据
      let existingTargetTables: Set<string>;
      try {
        existingTargetTables = new Set(
          (await target.getMetadata().listTables(targetSchema)).map((t) => t.name),
        );
      } catch {
        existingTargetTables = new Set();
        issues.push({
          level: 'warning',
          message: `无法读取目标 schema「${targetSchema}」的对象列表，将跳过冲突检测`,
        });
      }

      for (const tableName of tableNames) {
        const exists = allTables.some((t) => t.name === tableName);
        if (!exists) {
          issues.push({ level: 'error', table: tableName, message: `源库中不存在表 ${tableName}` });
          continue;
        }

        if (existingTargetTables.has(tableName) && (request.conflictStrategy ?? 'skip') !== 'overwrite') {
          issues.push({
            level: 'warning',
            table: tableName,
            message: `目标库已存在同名表 ${tableName}`,
            suggestion: '如需覆盖，请选择冲突策略「覆盖」，或先重命名/删除目标表',
          });
        }

        const columns = await source.getMetadata().listColumns(sourceSchema, tableName);
        if (columns.length === 0) {
          issues.push({ level: 'warning', table: tableName, message: `表 ${tableName} 没有可迁移的列` });
          continue;
        }

        const columnMappings = columns.map((col) => {
          const mapped = sourceMapper.mapType(col.dataType, targetDbType);
          if (mapped.lossy && mapped.note) {
            issues.push({
              level: 'warning',
              table: tableName,
              column: col.name,
              message: `${col.dataType} → ${mapped.type}：${mapped.note}`,
              suggestion: '如不能接受语义损失，请在字段映射中手工指定目标类型或跳过该列',
            });
          }
          if (!col.nullable) {
            // 非空列在目标端保留约束，提示用户注意历史数据
          }
          return {
            sourceColumn: col.name,
            sourceType: col.dataType,
            targetColumn: col.name,
            targetType: mapped.type,
            lossy: mapped.lossy,
            ...(mapped.note ? { note: mapped.note } : {}),
          };
        });

        const pk = columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
        if (pk.length === 0) {
          issues.push({
            level: 'info',
            table: tableName,
            message: '该表没有主键',
            suggestion: '无主键表在增量同步时无法生成稳定游标，建议全量迁移',
          });
        }

        let rowCount: number | null = null;
        try {
          const countResult = await source
            .getQueryExecutor()
            .execute(`SELECT COUNT(*) AS c FROM ${quoteFor(source, sourceSchema, tableName)}`, {
              maxRows: 1,
            });
          const raw = countResult.rows[0]?.[0];
          rowCount = raw === null || raw === undefined ? null : Number(raw);
          if (rowCount !== null && Number.isFinite(rowCount)) estimatedRows += rowCount;
        } catch {
          issues.push({ level: 'info', table: tableName, message: '无法统计行数，迁移报告中的总行数将为未知' });
        }

        tableMappings.push({ sourceTable: tableName, targetTable: tableName, columnMappings });
      }

      const hasError = issues.some((i) => i.level === 'error');
      return { ok: !hasError, issues, tableMappings, estimatedRows };
    } finally {
      await close();
    }
  }

  /**
   * 执行迁移：建结构（可选）+ 迁移数据（可选）。当前**仅支持全量**（mode=full）。
   */
  async migrate(request: MigrationRequest, onProgress?: ProgressCallback): Promise<MigrationOutcome> {
    // 缺陷回归：mode 曾被静默忽略，incremental/sync 也按全量执行，
    // 若同时选了 overwrite 还会先 DROP 目标表再重灌。宁可显式拒绝，也不静默做错。
    assertFullMode(request.mode);

    const migrationId = request.id ?? `mig-${Date.now().toString(36)}`;
    const startedAt = new Date().toISOString();
    const result: MigrationOutcome = {
      migrationId,
      status: 'running',
      totalRows: 0,
      successRows: 0,
      failedRows: 0,
      skippedRows: 0,
      startedAt,
      finishedAt: null,
      errors: [],
      tables: [],
    };

    const { source, target, close } = await this.connections(request);
    try {
      const sourceSchema = request.sourceSchema ?? this.defaultSchemaFor(source.config.dbType);
      const targetSchema = request.targetSchema ?? this.defaultSchemaFor(target.config.dbType);
      // 默认策略必须是 skip：REST 层用 zod .default('skip') 兜住了，但 CLI /
      // 内部调用会绕过那一层，若这里不兜底就会退化成"裸 INSERT 撞主键"。
      const conflictStrategy = request.conflictStrategy ?? 'skip';

      const precheck = await this.precheck(request);
      if (!precheck.ok && !request.dryRun) {
        const errors = precheck.issues.filter((i) => i.level === 'error');
        throw new PeanutError('MIGRATION_FAILED', `迁移预检未通过（${errors.length} 项错误）`, {
          issues: errors,
        });
      }

      result.totalRows = precheck.estimatedRows;

      for (const mapping of precheck.tableMappings) {
        if (this.cancelled.has(migrationId)) {
          result.status = 'cancelled';
          break;
        }

        const { sourceTable } = mapping;
        const columns = await source.getMetadata().listColumns(sourceSchema, sourceTable);
        const tableReport: TableMigrationReport = {
          table: sourceTable,
          pagination: 'primary-key',
          orderBy: [],
          status: 'success',
          totalRows: null,
          successRows: 0,
          skippedRows: 0,
          failedRows: 0,
        };
        result.tables.push(tableReport);

        onProgress?.({
          migrationId,
          phase: 'structure',
          table: sourceTable,
          processedRows: 0,
          totalRows: null,
          message: `处理表结构 ${sourceTable}`,
        });

        // 目标表是否在本次迁移**之前**就已存在。行级冲突处理与"本次新建的表一定为空"
        // 这两个判断都依赖它，因此无论是否迁移结构都要先拿到。
        let targetTableExisted = false;
        if (!request.dryRun && (request.includeStructure || request.includeData)) {
          const targetTables = await target.getMetadata().listTables(targetSchema);
          targetTableExisted = targetTables.some((t) => t.name === sourceTable);
        }

        if (request.includeStructure && !request.dryRun) {
          // 先显式判断目标表是否已存在，而不是"直接建表再靠错误文案匹配兜住"：
          //  1) 依赖 /exist/ 之类的错误文案在不同数据库上措辞不同，非常脆弱；
          //  2) 有些环境（如 PGlite 的线协议服务端）一条语句报错就会断开连接，
          //     靠捕获异常继续往下走会连锁失败。
          if (targetTableExisted && conflictStrategy !== 'overwrite') {
            // 目标表已存在且不覆盖：保留原结构，数据阶段按冲突策略逐行处理
            onProgress?.({
              migrationId,
              phase: 'structure',
              table: sourceTable,
              processedRows: 0,
              totalRows: null,
              message: `目标表已存在，跳过建表 ${sourceTable}`,
            });
          } else {
            // DDL 必须由**目标**驱动生成，且列类型先经类型映射转换为目标方言类型，
            // 否则异构迁移会生成源库方言的 DDL 而建表失败。
            const mapper = source.getTypeMapper();
            const targetDbType = target.config.dbType;
            const mappedColumns = columns.map((col) => ({
              ...col,
              dataType: mapper.mapType(col.dataType, targetDbType).type,
            }));
            // 索引也要迁：只建表会让目标端丢掉全部二级索引。
            // 主键索引由 createTable 依据 isPrimaryKey 自动生成，这里排除以免重名冲突。
            const sourceIndexes = await source.getMetadata().listIndexes(sourceSchema, sourceTable);
            const secondaryIndexes = sourceIndexes.filter((ix) => !ix.primary && ix.columns.length > 0);
            const ddlGen = target.getDdlGenerator();
            if (targetTableExisted) {
              // overwrite：先删掉旧表，结构才谈得上"覆盖"
              await target.getQueryExecutor().execute(ddlGen.dropTable(targetSchema, sourceTable));
            }
            const ddl = ddlGen.createTable(targetSchema, sourceTable, mappedColumns, secondaryIndexes);
            try {
              // 逐条执行：一条失败不应掩盖其余语句的真实错误
              for (const statement of splitSqlStatements(ddl)) {
                await target.getQueryExecutor().execute(statement);
              }
            } catch (e) {
              const message = e instanceof Error ? e.message : String(e);
              result.errors.push({ table: sourceTable, rowKey: null, message: `建表失败：${message}` });
              result.failedRows += 1;
              tableReport.status = 'failed';
              tableReport.failedRows += 1;
              continue;
            }
            // 本次刚建（或重建）的表必定为空，无需冲突检测
            targetTableExisted = false;
          }
        }

        if (!request.includeData) continue;

        const targetExec = target.getQueryExecutor();
        const sourceExec = source.getQueryExecutor();
        const batchSize = Math.max(1, request.batchSize ?? this.batchSize);
        const insertSql = buildInsert(target, targetSchema, sourceTable, columns.map((c) => c.name));
        const tableTotal = await countRows(source, sourceSchema, sourceTable);
        tableReport.totalRows = tableTotal;

        if (request.dryRun) {
          result.skippedRows += tableTotal;
          tableReport.skippedRows += tableTotal;
          continue;
        }

        const pkColumns = columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
        const pkIndexes = columns.map((c, i) => (c.isPrimaryKey ? i : -1)).filter((i) => i >= 0);
        // 缺陷回归：分页必须有稳定排序，优先主键，没有主键则按全部列排序。
        // 否则 LIMIT/OFFSET 在不同批次可能给出不同顺序，静默漏行/重复行。
        const orderColumns = pkColumns.length > 0 ? pkColumns : columns.map((c) => c.name);
        tableReport.orderBy = [...orderColumns];
        tableReport.pagination = pkColumns.length > 0 ? 'primary-key' : 'all-columns';

        // 目标端现有行数。这里必须 strict：把"统计失败"当成"空表"会直接导致重复写入。
        const targetRowCount = targetTableExisted
          ? await countRows(target, targetSchema, sourceTable, { strict: true })
          : 0;

        // 行级冲突处理只在"目标表本来就有数据、且能定位到行（有主键）"时启用。
        let rowLevelConflict = targetRowCount > 0 && pkColumns.length > 0;

        if (targetRowCount > 0 && pkColumns.length === 0) {
          if (conflictStrategy === 'overwrite') {
            // 无主键无法逐行覆盖，安全降级为"清空目标表后全量重写"（并发由 service 的锁挡住）。
            await targetExec.execute(`DELETE FROM ${quoteFor(target, targetSchema, sourceTable)}`);
            tableReport.message = '目标表无主键：按覆盖策略清空目标表后全量写入';
            rowLevelConflict = false;
          } else if (conflictStrategy === 'skip' || conflictStrategy === 'manual') {
            // 无主键无法做行级去重：整表跳过，并把状态显式标成 skipped（绝不报 success）。
            result.skippedRows += tableTotal;
            tableReport.skippedRows += tableTotal;
            tableReport.status = 'skipped';
            tableReport.message =
              '目标表已有数据且该表没有主键，无法做行级冲突检测：整表跳过以避免重复数据（报告状态为 skipped）';
            onProgress?.({
              migrationId,
              phase: 'data',
              table: sourceTable,
              processedRows: 0,
              totalRows: tableTotal,
              message: `目标表已有数据且无主键，按冲突策略整表跳过 ${sourceTable}`,
            });
            continue;
          }
          // conflictStrategy === 'error'：无主键时无法判重，直接插入，重复交由目标端约束报错
        }

        const baseSelect = `SELECT ${columns
          .map((c) => quoteIdentFor(source, c.name))
          .join(', ')} FROM ${quoteFor(source, sourceSchema, sourceTable)}`;
        const orderedSelect = `${baseSelect} ORDER BY ${orderColumns
          .map((c) => quoteIdentFor(source, c))
          .join(', ')}`;

        let processed = 0;
        let offset = 0;

        // 处理一页数据：逐行按冲突策略 skip / overwrite / error 决定动作。
        const processRows = async (rows: CellValue[][]): Promise<void> => {
          let existingKeys = new Set<string>();
          if (rowLevelConflict) {
            existingKeys = await findExistingKeys(
              target,
              targetSchema,
              sourceTable,
              pkColumns,
              rows.map((row) => pkIndexes.map((i) => row[i] as CellValue)),
            );
          }

          for (const row of rows) {
            const tuple = pkIndexes.map((i) => row[i] as CellValue);
            const key = tuple.map(keyPart).join('\u0001');
            const action: RowAction =
              rowLevelConflict && existingKeys.has(key)
                ? conflictStrategy === 'overwrite'
                  ? 'overwrite'
                  : conflictStrategy === 'skip'
                    ? 'skip'
                    : 'conflict'
                : 'insert';

            if (action === 'skip') {
              result.skippedRows += 1;
              tableReport.skippedRows += 1;
              processed += 1;
              continue;
            }
            if (action === 'conflict') {
              // error / manual：不覆盖目标既有数据，明确记为失败行
              result.failedRows += 1;
              tableReport.failedRows += 1;
              processed += 1;
              if (result.errors.length < 1000) {
                result.errors.push({
                  table: sourceTable,
                  rowKey: rowKeyOf(row),
                  message: '主键冲突：目标表已存在相同主键的行，冲突策略为 error/manual，未覆盖',
                });
              }
              continue;
            }

            try {
              if (action === 'overwrite') {
                await this.withRetry(() => updateRow(target, targetSchema, sourceTable, columns, row));
              } else {
                await this.withRetry(() => targetExec.execute(insertSql, { params: row as CellValue[] }));
              }
              result.successRows += 1;
              tableReport.successRows += 1;
            } catch (e) {
              result.failedRows += 1;
              tableReport.failedRows += 1;
              if (result.errors.length < 1000) {
                result.errors.push({
                  table: sourceTable,
                  rowKey: rowKeyOf(row),
                  message: e instanceof Error ? e.message : String(e),
                });
              }
            }
            processed += 1;
            if (processed % 200 === 0) {
              onProgress?.({
                migrationId,
                phase: 'data',
                table: sourceTable,
                processedRows: processed,
                totalRows: tableTotal,
              });
            }
          }
        };

        // 分批翻页直到取空。此前这里只取了一批就结束，
        // 超过 batchSize 的数据会被静默丢弃——迁移工具最不能犯的错误。
        for (;;) {
          if (this.cancelled.has(migrationId)) {
            result.status = 'cancelled';
            tableReport.status = 'cancelled';
            break;
          }

          let page: QueryResult;
          try {
            page = await sourceExec.execute(`${orderedSelect} LIMIT ${batchSize} OFFSET ${offset}`, {
              maxRows: batchSize,
            });
          } catch (e) {
            if (offset === 0 && pkColumns.length === 0) {
              // 无主键时按全部列排序可能不被支持（如 PostgreSQL 的 json 列没有排序算子）。
              // 安全降级：单次全量读取，不分页 → 不存在跨批次顺序漂移，不会漏行/重复。
              tableReport.pagination = 'single-pass';
              tableReport.message =
                '该表没有主键，且目标库不支持按全部列排序：已降级为单次全量读取（不分页），避免顺序漂移';
              onProgress?.({
                migrationId,
                phase: 'data',
                table: sourceTable,
                processedRows: 0,
                totalRows: tableTotal,
                message: `表 ${sourceTable} 无法按全列排序，改为单次全量读取`,
              });
              // maxRows 取一个足够大的值：SQLite 驱动会把 maxRows 当作硬上限（默认 1 万），
              // 传 0 反而会被夹成 1，因此这里显式给最大值，避免单次读取被静默截断。
              const all = await sourceExec.execute(baseSelect, { maxRows: Number.MAX_SAFE_INTEGER });
              await processRows(all.rows);
              break;
            }
            throw e;
          }

          if (page.rows.length === 0) break;
          await processRows(page.rows);

          if (this.cancelled.has(migrationId)) {
            result.status = 'cancelled';
            tableReport.status = 'cancelled';
            break;
          }

          offset += page.rows.length;
          // 最后一页不足一批，说明已取完
          if (page.rows.length < batchSize) break;
        }

        if (tableReport.status !== 'cancelled') {
          tableReport.status = tableReport.failedRows > 0 ? 'failed' : 'success';
        }

        onProgress?.({
          migrationId,
          phase: 'data',
          table: sourceTable,
          processedRows: processed,
          totalRows: tableTotal,
          message: `表 ${sourceTable} 完成（分页方式：${tableReport.pagination}）`,
        });
      }

      if (result.status !== 'cancelled') {
        const anySkippedTable = result.tables.some((t) => t.status === 'skipped');
        if (result.failedRows > 0) {
          result.status = 'failed';
        } else if (anySkippedTable && result.successRows === 0) {
          // 有表被整表跳过且没有任何数据写入：如实报 skipped，绝不报 success。
          result.status = 'skipped';
        } else {
          result.status = 'success';
        }
      }
    } catch (e) {
      result.status = 'failed';
      result.errorMessage = e instanceof Error ? e.message : String(e);
      throw e instanceof PeanutError ? e : new PeanutError('MIGRATION_FAILED', result.errorMessage);
    } finally {
      result.finishedAt = new Date().toISOString();
      this.cancelled.delete(migrationId);
      await close();
    }

    return result;
  }

  /**
   * 同步/增量入口。当前版本尚未实现，`sync()` 会显式抛 `VALIDATION_FAILED`，
   * 绝不会静默退化成全量复制（cursorColumn/since 目前不被使用）。
   */
  async sync(request: SyncRequest, onProgress?: ProgressCallback): Promise<MigrationOutcome> {
    return this.migrate({ ...request, mode: 'sync' }, onProgress);
  }

  cancel(migrationId: string): void {
    this.cancelled.add(migrationId);
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retry; attempt++) {
      try {
        return await fn();
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  }

  /** 取驱动声明的默认 schema；SQLite 为 main，PostgreSQL 系为 public。 */
  private defaultSchemaFor(dbType: string): string {
    const info = this.deps.resolveDriver(dbType).getInfo();
    if (info.defaultSchema) return info.defaultSchema;
    return dbType === 'sqlite' ? 'main' : '';
  }
}

/** MySQL 系用反引号，其余用标准双引号；两种都带标识符白名单校验。 */
function quoteIdentFor(conn: DriverConnection, name: string): string {
  switch (conn.config.dbType) {
    case 'mysql':
    case 'mariadb':
    case 'tidb':
    case 'oceanbase':
      return quoteIdentBacktick(name);
    default:
      return quoteIdent(name);
  }
}

export function quoteFor(conn: DriverConnection, schema: string | null, table: string): string {
  const tablePart = quoteIdentFor(conn, table);
  return schema ? `${quoteIdentFor(conn, schema)}.${tablePart}` : tablePart;
}

/**
 * 各库的绑定参数占位符风格不同：PostgreSQL 系要 `$1..$n`，SQLite/MySQL 系用 `?`。
 * 曾经这里对所有目标库都写死 `?`，导致跨库迁移到 PostgreSQL 时
 * 生成 `VALUES (?, ?, ?)` 直接语法错误（全表迁移失败）。
 */
export function placeholderFor(conn: DriverConnection, index: number): string {
  switch (conn.config.dbType) {
    case 'postgresql':
    case 'kingbase':
      return `$${index + 1}`;
    default:
      return '?';
  }
}

export function buildInsert(
  conn: DriverConnection,
  schema: string | null,
  table: string,
  columns: string[],
): string {
  const cols = columns.map((c) => quoteIdentFor(conn, c)).join(', ');
  const placeholders = columns.map((_, i) => placeholderFor(conn, i)).join(', ');
  return `INSERT INTO ${quoteFor(conn, schema, table)} (${cols}) VALUES (${placeholders})`;
}

/** 增量/同步尚未实现：显式拒绝，绝不静默按全量执行。 */
function assertFullMode(mode: MigrationMode): void {
  if (mode === 'full') return;
  throw validationFailed(
    `当前版本仅支持全量迁移（mode=full）；${mode} 需要游标增量过滤与 upsert 语义，尚未实现，` +
      '已明确拒绝而不是按全量复制执行',
    { mode, supportedModes: ['full'] },
  );
}

type RowAction = 'insert' | 'skip' | 'overwrite' | 'conflict';

/**
 * 把一组主键/行值归一化成可比较的字符串。刻意**不区分**数字与字符串：
 * 异构迁移时同一逻辑值在源端可能是 number（如 SQLite integer），
 * 在目标端驱动里可能是 string（如 PostgreSQL int8/numeric），不加类型标签才能正确判重。
 */
function keyPart(value: CellValue | undefined): string {
  if (value === null || value === undefined) return '\u0000N';
  if (value instanceof Uint8Array) return `b:${Buffer.from(value).toString('base64')}`;
  return `v:${String(value)}`;
}

function rowKeyOf(row: CellValue[]): string | null {
  const first = row[0];
  return first === null || first === undefined ? null : String(first);
}

/**
 * 在一批源行中找出目标端已存在的键。
 *
 * 单列主键用 `IN (?, ?, ...)`；复合主键用 `(a = ? AND b = ?) OR ...`。
 * 全部使用绑定参数，绝不把值拼进 SQL。分块执行，避免参数个数超过各库上限。
 */
async function findExistingKeys(
  conn: DriverConnection,
  schema: string | null,
  table: string,
  pkColumns: string[],
  tuples: CellValue[][],
): Promise<Set<string>> {
  const found = new Set<string>();
  if (tuples.length === 0 || pkColumns.length === 0) return found;

  const CHUNK = 400;
  const selectCols = pkColumns.map((c) => quoteIdentFor(conn, c)).join(', ');
  const from = quoteFor(conn, schema, table);

  for (let start = 0; start < tuples.length; start += CHUNK) {
    const chunk = tuples.slice(start, start + CHUNK);
    let sql: string;
    let params: CellValue[];

    if (pkColumns.length === 1) {
      const col = quoteIdentFor(conn, pkColumns[0] as string);
      params = chunk.map((tuple) => (tuple[0] === undefined ? null : tuple[0]) as CellValue);
      const placeholders = params.map((_, i) => placeholderFor(conn, i)).join(', ');
      sql = `SELECT ${selectCols} FROM ${from} WHERE ${col} IN (${placeholders})`;
    } else {
      params = [];
      const conds: string[] = [];
      for (const tuple of chunk) {
        const parts: string[] = [];
        for (let i = 0; i < pkColumns.length; i++) {
          const col = quoteIdentFor(conn, pkColumns[i] as string);
          const value = tuple[i];
          if (value === null || value === undefined) {
            parts.push(`${col} IS NULL`);
          } else {
            parts.push(`${col} = ${placeholderFor(conn, params.length)}`);
            params.push(value);
          }
        }
        conds.push(`(${parts.join(' AND ')})`);
      }
      sql = `SELECT ${selectCols} FROM ${from} WHERE ${conds.join(' OR ')}`;
    }

    const res = await conn.getQueryExecutor().execute(sql, { params, maxRows: chunk.length });
    for (const row of res.rows) {
      found.add(row.map(keyPart).join('\u0001'));
    }
  }
  return found;
}

/**
 * overwrite 策略下覆盖一行：按主键 UPDATE 非主键列。
 * 用 UPDATE 而不是 DELETE+INSERT，避免触发外键级联删除子表数据。
 */
async function updateRow(
  conn: DriverConnection,
  schema: string | null,
  table: string,
  columns: ColumnInfo[],
  row: CellValue[],
): Promise<void> {
  const params: CellValue[] = [];
  const sets: string[] = [];
  const wheres: string[] = [];

  // 参数顺序必须与 SQL 词法顺序一致：先 SET 后 WHERE
  columns.forEach((col, i) => {
    if (col.isPrimaryKey) return;
    sets.push(`${quoteIdentFor(conn, col.name)} = ${placeholderFor(conn, params.length)}`);
    params.push(row[i] as CellValue);
  });
  columns.forEach((col, i) => {
    if (!col.isPrimaryKey) return;
    const value = row[i] as CellValue;
    if (value === null || value === undefined) {
      wheres.push(`${quoteIdentFor(conn, col.name)} IS NULL`);
    } else {
      wheres.push(`${quoteIdentFor(conn, col.name)} = ${placeholderFor(conn, params.length)}`);
      params.push(value);
    }
  });

  // 全列主键或没有主键时无处可更新，直接跳过
  if (sets.length === 0 || wheres.length === 0) return;

  await conn.getQueryExecutor().execute(
    `UPDATE ${quoteFor(conn, schema, table)} SET ${sets.join(', ')} WHERE ${wheres.join(' AND ')}`,
    { params, maxRows: 1 },
  );
}

/**
 * 统计行数。
 *
 * `strict` 的语义很重要：默认模式吞掉异常并返回 0（用于进度展示等"算不出来也不致命"
 * 的场景，例如表还不存在）；但**冲突判定**绝不能用这个默认值 —— 把"查询失败"
 * 当成"目标表为空"会直接导致重复写入，所以判空时必须 strict，让错误抛出来。
 */
async function countRows(
  conn: DriverConnection,
  schema: string | null,
  table: string,
  options: { strict?: boolean } = {},
): Promise<number> {
  try {
    const result = await conn
      .getQueryExecutor()
      .execute(`SELECT COUNT(*) AS c FROM ${quoteFor(conn, schema, table)}`, { maxRows: 1 });
    const raw = result.rows[0]?.[0];
    const n = raw === null || raw === undefined ? 0 : Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch (e) {
    if (options.strict) throw e;
    return 0;
  }
}
