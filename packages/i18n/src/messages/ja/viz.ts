/**
 * 日本語 · 可視化（グラフ / ダッシュボード）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * ここには**グラフとダッシュボード固有の言い回し**だけを置きます：
 *  - グラフの空状態、未対応種別の説明、スキップ集計、生データテーブル；
 *  - グラフ / ダッシュボードのフォーム、一覧、ヒントとエラーの接頭辞。
 *
 * グラフ種別の表示名と説明は**ここにはありません**：サーバーは中国語の label を返しますが、
 * クライアントは安定した `type` で `meta.chartType.*` / `meta.chartTypeDesc.*` を参照します。
 * そうしないと言語を切り替えてもグラフ種別が中国語のままになります。目録にない type のみ
 * サーバーの label にフォールバックします。
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— グラフの空状態：純粋関数は reason だけを返し、文言はここに置きます ——
  'viz.empty.title': '描画できるデータがありません',
  'viz.empty.noColumns': 'クエリが列を返さなかったため、グラフを描画できません。',
  'viz.empty.noRows': '結果セットが空（0 行）のため、描画できるデータ点がありません。',
  'viz.empty.insufficientColumns': 'グラフの描画には少なくとも 2 列（1 つのディメンション + 1 つの指標）が必要です。',
  'viz.empty.noNumericMetric': '指標列に使用できる数値がありません（すべて NULL またはテキストの可能性があります）。グラフを描画できません。',
  'viz.empty.pieNeedsPositive': '円グラフ / ドーナツグラフには 0 より大きい値が少なくとも 1 つ必要です。NULL と負の値はスキップ集計に含まれます。',
  'viz.empty.scatterNeedsNumeric': '散布図は 1 列目を X 軸、残りの数値列を Y 軸として扱います。X / Y はどちらも数値として解釈できる必要があります。',
  'viz.empty.parallelNeedsMetrics': '平行座標グラフは折れ線をつなぐために少なくとも 2 つの数値指標列が必要です。指標を追加して再試行してください。',
  'viz.empty.radarNeedsDimensions': 'レーダーチャートは多角形を描くために少なくとも 3 つのディメンション値が必要です。ディメンションの行を増やして再試行してください。',

  // —— ブラウザー内描画が未実装の種別（正直なプレースホルダー）——
  'viz.unsupported.title': 'このグラフ種別はブラウザー内での描画にまだ対応していません',
  'viz.unsupported.prefix': 'グラフ種別「',
  'viz.unsupported.codePrefix': '」（',
  'viz.unsupported.suffix':
    '）は作成・保存・データ取得を通常どおり行えますが、現在のバージョンでは対応する SVG 描画が未実装です。以下にサーバーが返した生データをそのまま表示するので、取得結果の確認に利用できます。',

  // —— 生データテーブル ——
  'viz.table.summary': '生データ（{count} 行）',
  'viz.table.summaryTruncated': '生データ（{count} 行、先頭 {limit} 行のみ表示）',
  'viz.table.noColumns': 'クエリが列を返しませんでした。',
  'viz.cell.emptyString': '(空文字列)',

  // —— 座標軸と集計のヒント ——
  'viz.axis.value': '値',
  'viz.note.skipped': 'NULL / 非数値のセルを {count} 個スキップし、描画には使用していません。',
  'viz.note.skippedPositive': 'NULL / 非数値または 0 以下のセルを {count} 個スキップし、描画には使用していません。',
  'viz.caption.meta': '{rows} 行 · {columns} 列 · 所要時間 {duration}',
  'viz.aria.chart': '{type}：{category}',

  // —— ツールチップのテンプレート ——
  'viz.tooltip.labelSeriesValue': '{label} · {series}：{value}',
  'viz.tooltip.seriesValue': '{series}：{value}',
  'viz.tooltip.seriesCategoryValue': '{series} · {category}：{value}',
  'viz.tooltip.slice': '{label}：{value}（{percent}%）',
  'viz.legend.sliceValue': '{value}（{percent}%）',
  'viz.donut.totalLabel': '{series} 合計',

  // —— 集計方法 ——
  'viz.aggregation.none': '集計なし',
  'viz.aggregation.sum': '合計 SUM',
  'viz.aggregation.avg': '平均 AVG',
  'viz.aggregation.count': '件数 COUNT',
  'viz.aggregation.countDistinct': '重複を除く件数 COUNT DISTINCT',
  'viz.aggregation.min': '最小値 MIN',
  'viz.aggregation.max': '最大値 MAX',
  'viz.aggregation.median': '中央値 MEDIAN',

  // —— ディメンション / 指標の行エディター ——
  'viz.field.columnPlaceholder': '列名（例：region）',
  'viz.field.aliasPlaceholder': '別名（任意）',
  'viz.field.remove': 'このフィールドを削除',
  'viz.field.add': 'フィールドを追加',

  // —— グラフ作成フォーム ——
  'viz.form.name': 'グラフ名 *',
  'viz.form.namePlaceholder': '例：地域別の受注額分布',
  'viz.form.chartType': 'グラフ種別 *',
  'viz.form.typeOption': '{label}（{code}）',
  'viz.form.typeHint': '{description} · ディメンション {dimensions} 個以上 / 指標 {metrics} 個以上',
  'viz.form.connection': 'データベース接続 *',
  'viz.form.connectionPlaceholder': '接続を選択してください',
  'viz.form.connectionOption': '{name}（{type}）',
  'viz.form.dashboard': '所属ダッシュボード（任意）',
  'viz.form.dashboardNone': 'ダッシュボードに割り当てない',
  'viz.form.schema': 'スキーマを参照（任意）',
  'viz.form.schemaDisabled': '接続を選択すると参照できます',
  'viz.form.schemaPlaceholder': 'スキーマを選択してください',
  'viz.form.schemaHint': 'テーブル名の選択にのみ使用します。データ取得 SQL のスキーマは、サーバーが接続のデフォルト値から生成します。',
  'viz.form.source': 'ソーステーブル / ビュー *',
  'viz.form.sourceHintCount': 'このスキーマには {count} 個のテーブルがあります。テーブル名を直接入力することもできます。',
  'viz.form.sourceHint': 'テーブル名またはビュー名を直接入力できます。',
  'viz.form.dimensions': 'ディメンション（GROUP BY）*',
  'viz.form.dimensionsHint': 'ディメンションは分類軸を決めます。通常は集計方法で「集計なし」を選択します。',
  'viz.form.metrics': '指標（集計列）*',
  'viz.form.metricsHint': '指標は数値軸を決めます。合計 / 平均 / 件数などの集計を含む SQL はサーバーが生成します。',
  'viz.form.submit': 'グラフを作成',
  'viz.form.error.nameRequired': 'グラフ名を入力してください。',
  'viz.form.error.connectionRequired': 'データベース接続を選択してください。選択しないとグラフのデータを取得できません。',
  'viz.form.error.sourceRequired': 'ソーステーブル名またはビュー名を入力してください。',
  'viz.form.error.minDimensions': '{type} には少なくとも {need} 個のディメンションが必要です（現在 {got} 個）。',
  'viz.form.error.minMetrics': '{type} には少なくとも {need} 個の指標が必要です（現在 {got} 個）。',
  'viz.form.error.fieldRequired': 'ディメンションまたは指標を少なくとも 1 つ指定してください。',

  // —— グラフ一覧 / プレビュー ——
  'viz.connection.unbound': '接続が未設定',
  'viz.schemaHint.line': '{type} · デフォルトのスキーマ：{schema}',
  'viz.schemaHint.unknown': 'データベースによって決まります',
  'viz.source.custom': 'カスタム SQL',
  'viz.list.title': '保存済みのグラフ',
  'viz.list.name': 'グラフ名',
  'viz.list.source': 'データソース',
  'viz.list.render': 'このグラフを描画',
  'viz.list.empty': 'グラフがまだありません',
  'viz.list.emptyHint': '右上の「グラフを作成」から、接続・ソーステーブル・グラフ種別を選択してください。',
  'viz.toolbar.count': '{count} 件のグラフ',
  'viz.refreshList': '一覧を更新',
  'viz.create.title': 'グラフを作成',
  'viz.create.description':
    'グラフの設定はサーバーに保存されます。データ取得 SQL はサーバーがディメンション / 指標 / 集計から生成するため、手書きの SQL は受け付けません。',
  'viz.delete.title': 'グラフを削除',
  'viz.delete.message': 'グラフ「{name}」を削除してもよろしいですか？この操作は元に戻せません。',
  'viz.preview.emptyTitle': 'グラフを 1 つ選択すると描画結果を確認できます',
  'viz.preview.emptyHintPrefix': '描画には ',
  'viz.preview.emptyHintSuffix': ' が返す実データを使用し、ローカルの擬似データは使用しません。',
  'viz.preview.reload': 'データを再取得',
  'viz.preview.loading': 'データを取得して描画しています…',
  'viz.preview.sqlSummary': '生成された SQL を表示',
  'viz.preview.sqlMeta': '実行に {duration} かかり、{count} 行を返しました。',
  'viz.preview.sqlMetaTruncated': '実行に {duration} かかり、{count} 行を返しました（結果は切り詰められています）。',
  'viz.error.loadList': 'グラフ一覧の読み込みに失敗しました：{message}',
  'viz.error.loadMeta': '一部のグラフメタデータの読み込みに失敗しました：{message}',
  'viz.error.create': 'グラフの作成に失敗しました：{message}',
  'viz.error.delete': 'グラフの削除に失敗しました：{message}',
  'viz.toast.created': 'グラフ「{name}」を作成しました。',
  'viz.toast.deleted': 'グラフ「{name}」を削除しました。',

  // —— ダッシュボード一覧 / 詳細 ——
  'viz.dashboardList.title': 'ダッシュボード一覧',
  'viz.dashboardList.name': 'ダッシュボード名',
  'viz.dashboardList.shared': '共有',
  'viz.dashboardList.columns': '列数',
  'viz.dashboardList.open': 'ダッシュボードを開く',
  'viz.dashboardList.empty': 'ダッシュボードがまだありません',
  'viz.dashboardList.emptyHint': 'ダッシュボードを作成したら、「データ可視化」でグラフを作成するときにそのダッシュボードを選択すると割り当てられます。',
  'viz.dashboardToolbar.count': '{count} 件のダッシュボード',
  'viz.dashboardToolbar.new': 'ダッシュボードを作成',
  'viz.dashboardPreview.emptyTitle': 'ダッシュボードを 1 つ選択するとグラフを確認できます',
  'viz.dashboardPreview.emptyHint': 'ダッシュボード詳細 API は割り当てられたグラフもまとめて返します。各グラフは個別にデータを取得して描画します。',
  'viz.dashboardPreview.refresh': 'ダッシュボードを更新',
  'viz.dashboardPreview.noDescription': '説明はありません',
  'viz.dashboardPreview.noChartsTitle': 'このダッシュボードにはまだグラフがありません',
  'viz.dashboardPreview.noChartsHint': '「データ可視化」ページでグラフを作成し、「所属ダッシュボード」で「{name}」を選択するとここに割り当てられます。',
  'viz.dashboardMeta': '{description} · {charts} 件のグラフ · {columns} 列グリッド',
  'viz.dashboardChart.refresh': 'このグラフのデータを更新',
  'viz.dashboardChart.loading': 'データを取得中…',
  'viz.dashboardCreate.description': 'ダッシュボードは複数のグラフを 1 画面にまとめるためのものです。グラフの所属は作成時に選択できます。',
  'viz.dashboardDelete.title': 'ダッシュボードを削除',
  'viz.dashboardDelete.message': 'ダッシュボード「{name}」を削除してもよろしいですか？このダッシュボードのグラフもまとめて削除されます（カスケード）。',

  // —— ダッシュボード作成フォーム ——
  'viz.dashboardForm.name': 'ダッシュボード名 *',
  'viz.dashboardForm.namePlaceholder': '例：日次運用レポート',
  'viz.dashboardForm.columns': 'グリッド列数',
  'viz.dashboardForm.columns1': '1 列',
  'viz.dashboardForm.columns2': '2 列（デフォルト）',
  'viz.dashboardForm.columns3': '3 列',
  'viz.dashboardForm.columns4': '4 列',
  'viz.dashboardForm.columnsHint': 'layout.columns に保存され、ダッシュボードはこの列数でグラフを配置します。',
  'viz.dashboardForm.descriptionPlaceholder': '任意：このダッシュボードを誰が何を見るために使うか',
  'viz.dashboardForm.shared': 'ダッシュボードを共有',
  'viz.dashboardForm.sharedHint': '共有すると、他のログインユーザーがこのダッシュボードを読み取り専用で閲覧できます。',
  'viz.dashboardForm.submit': 'ダッシュボードを作成',
  'viz.dashboardForm.error.nameRequired': 'ダッシュボード名を入力してください。',

  // —— ダッシュボードのエラーと通知 ——
  'viz.dashboardError.loadList': 'ダッシュボード一覧の読み込みに失敗しました：{message}',
  'viz.dashboardError.loadDetail': 'ダッシュボード詳細の読み込みに失敗しました：{message}',
  'viz.dashboardError.create': 'ダッシュボードの作成に失敗しました：{message}',
  'viz.dashboardError.delete': 'ダッシュボードの削除に失敗しました：{message}',
  'viz.dashboardToast.created': 'ダッシュボード「{name}」を作成しました。',
  'viz.dashboardToast.deleted': 'ダッシュボード「{name}」を削除しました。',
};

export default messages;
