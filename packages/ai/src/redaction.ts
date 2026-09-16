/**
 * 花生苗数据库管理工具 - 脱敏网关
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * PRD 4.5 安全与可控：敏感字段脱敏后再发给大模型。
 * 这是"出网前最后一道闸门"——任何要送到大模型的数据都应先过这里。
 */

import {
  DEFAULT_REDACTION_RULES,
  redactValue,
  matchColumnPattern,
  type ColumnInfo,
  type ColumnMeta,
  type CellValue,
  type RedactionRule,
} from '@peanutsprout/core';

export interface RedactionReport {
  /** 被替换的单元格数量 */
  redactedCells: number;
  /** 命中的列名（去重） */
  matchedColumns: string[];
  /** 被脱敏的列名 -> 规则 */
  appliedRules: Array<{ column: string; strategy: RedactionRule['strategy'] }>;
}

export class RedactionGateway {
  private readonly rules: RedactionRule[];

  constructor(rules: readonly RedactionRule[] = DEFAULT_REDACTION_RULES, private readonly enabled = true) {
    this.rules = [...rules];
  }

  /**
   * 构造时的默认开关。
   * 仅供需要"按次覆盖"的调用方参考；AiService 每次调用都会读取
   * `ai.redaction_enabled` 设置并通过 `redactRows(..., enabled)` 覆盖它，
   * 因此这个构造参数**不再**是最终生效值，不能作为"当前是否脱敏"的依据。
   */
  get defaultEnabled(): boolean {
    return this.enabled;
  }

  /** 找到某列名命中的第一条规则（按声明顺序，先声明优先）。 */
  ruleFor(column: string): RedactionRule | null {
    if (!this.enabled) return null;
    return this.matchRule(column);
  }

  /** 只做规则匹配，不看开关；开关由调用方（ruleFor / redactRows）决定。 */
  private matchRule(column: string): RedactionRule | null {
    for (const rule of this.rules) {
      if (matchColumnPattern(rule.columnPattern, column)) return rule;
    }
    return null;
  }

  /**
   * 脱敏结果集：按列名匹配规则，逐格替换。返回新数组，不修改入参。
   *
   * `enabled` 允许调用方**按次**决定是否脱敏（缺省时沿用构造开关）。
   * 这是为了修复「开关在服务构造时固化」的缺陷：`ai.redaction_enabled` 是运行时可写的，
   * AiService 必须在每次调用时把当前设置传进来，否则界面报告"已脱敏"而数据仍明文出网。
   */
  redactRows(
    columns: ColumnMeta[],
    rows: CellValue[][],
    enabled: boolean = this.enabled,
  ): { rows: CellValue[][]; report: RedactionReport } {
    const columnRules = columns.map((c) => (enabled ? this.matchRule(c.name) : null));
    const report: RedactionReport = { redactedCells: 0, matchedColumns: [], appliedRules: [] };

    columns.forEach((col, i) => {
      const rule = columnRules[i];
      if (rule) {
        report.matchedColumns.push(col.name);
        report.appliedRules.push({ column: col.name, strategy: rule.strategy });
      }
    });

    if (!enabled || report.matchedColumns.length === 0) {
      return { rows, report };
    }

    const out = rows.map((row) =>
      row.map((cell, i) => {
        const rule = columnRules[i];
        if (!rule) return cell;
        report.redactedCells += 1;
        return redactValue(cell, rule);
      }),
    );
    return { rows: out, report };
  }

  /**
   * 生成 schema 上下文摘要：只发送列名/类型/注释，**不发送任何数据行**。
   * 表名与列名也可能含敏感信息，但对 NL2SQL 是必需的，故保留并在文档中说明。
   */
  describeSchema(
    tables: Array<{ name: string; comment?: string | null }>,
    columns: Record<string, ColumnInfo[]>,
  ): string {
    const lines: string[] = [];
    for (const table of tables) {
      const cols = columns[table.name] ?? [];
      const comment = table.comment ? ` -- ${table.comment}` : '';
      lines.push(`表 ${table.name}${comment}`);
      for (const col of cols) {
        const flags = [col.isPrimaryKey ? 'PK' : null, col.nullable ? '' : 'NOT NULL']
          .filter(Boolean)
          .join(' ');
        const colComment = col.comment ? ` -- ${col.comment}` : '';
        lines.push(`  ${col.name} ${col.dataType}${flags ? ` ${flags}` : ''}${colComment}`);
      }
    }
    return lines.join('\n');
  }

  /** 自定义规则（管理员可在设置中覆盖默认规则）。 */
  withRules(rules: readonly RedactionRule[]): RedactionGateway {
    return new RedactionGateway(rules, this.enabled);
  }
}
