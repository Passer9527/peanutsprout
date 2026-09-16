import type { ReactNode } from 'react';
import { useI18n } from '../state/i18n';
import { classNames } from '../utils/format';

export interface DataGridColumn<T> {
  key: string;
  header: ReactNode;
  /** CSS 宽度，如 '160px' / '20%' */
  width?: string;
  align?: 'left' | 'right' | 'center';
  className?: string;
  render: (row: T, index: number) => ReactNode;
}

export interface DataGridProps<T> {
  columns: Array<DataGridColumn<T>>;
  rows: T[];
  rowKey: (row: T, index: number) => string;
  loading?: boolean;
  emptyText?: string;
  emptyHint?: string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  dense?: boolean;
  /** 表格容器最大高度，超出后表头吸顶滚动 */
  maxHeight?: string;
  /**
   * 单次最多渲染多少行（默认 500）。
   *
   * 结果表没有虚拟滚动，旧实现会把全部行一次性渲染成 DOM：大结果集
   * （几万行 × 多列）会卡死页面甚至撑爆标签页。这里用"渲染上限 + 明确提示"
   * 的低风险方案兜底，而不是引入虚拟滚动的复杂重写。注意：**只影响渲染**，
   * 调用方的数据与导出功能（基于完整 rows）不受影响。
   */
  maxRenderRows?: number;
  footer?: ReactNode;
}

/** 默认渲染上限：500 行 × 常见列数约 1 万个节点，肉眼可读且不会拖垮页面 */
const DEFAULT_MAX_RENDER_ROWS = 500;

export function DataGrid<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  emptyText,
  emptyHint,
  onRowClick,
  selectedKey,
  dense = false,
  maxHeight,
  maxRenderRows = DEFAULT_MAX_RENDER_ROWS,
  footer,
}: DataGridProps<T>) {
  const { t } = useI18n();
  const showInitialLoading = loading && rows.length === 0;
  const showEmpty = !loading && rows.length === 0;
  // 未显式传入空态文案时回退到通用文案，保持组件默认行为不变
  const resolvedEmptyText = emptyText ?? t('common.empty');
  const renderLimit = maxRenderRows > 0 ? maxRenderRows : rows.length;
  const truncated = rows.length > renderLimit;
  const visibleRows = truncated ? rows.slice(0, renderLimit) : rows;

  return (
    <div className="datagrid">
      <div
        className={classNames('datagrid__scroll', dense && 'datagrid__scroll--dense')}
        style={maxHeight ? { maxHeight } : undefined}
      >
        <table className="datagrid__table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={classNames('datagrid__th', column.className)}
                  style={column.width ? { width: column.width } : undefined}
                  data-align={column.align ?? 'left'}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {showInitialLoading ? (
              <tr>
                <td className="datagrid__state" colSpan={columns.length}>
                  <span className="spinner" aria-hidden="true" />
                  <span>{t('common.loading')}</span>
                </td>
              </tr>
            ) : null}
            {showEmpty ? (
              <tr>
                <td className="datagrid__state" colSpan={columns.length}>
                  <span className="datagrid__empty-title">{resolvedEmptyText}</span>
                  {emptyHint ? <span className="datagrid__empty-hint">{emptyHint}</span> : null}
                </td>
              </tr>
            ) : null}
            {visibleRows.map((row, index) => {
              const key = rowKey(row, index);
              return (
                <tr
                  key={key}
                  className={classNames(
                    'datagrid__row',
                    onRowClick && 'datagrid__row--clickable',
                    selectedKey === key && 'datagrid__row--selected',
                  )}
                  onClick={
                    onRowClick
                      ? () => {
                          onRowClick(row);
                        }
                      : undefined
                  }
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={classNames('datagrid__td', column.className)}
                      data-align={column.align ?? 'left'}
                    >
                      {column.render(row, index)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {truncated ? (
        // 明确告知"只渲染了前 N 行"，避免用户以为这就是全部数据；
        // 完整数据仍在调用方手里，可通过导出查看（导出按钮不受渲染上限影响）
        <div className="datagrid__truncation" role="status">
          {t('common.truncatedRows', { values: { shown: visibleRows.length, total: rows.length } })}
        </div>
      ) : null}
      {footer ? <div className="datagrid__footer">{footer}</div> : null}
    </div>
  );
}
