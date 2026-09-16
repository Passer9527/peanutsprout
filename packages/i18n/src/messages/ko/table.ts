/**
 * 花生苗数据库管理工具 - 表数据编辑器文案（ko）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 表数据编辑器（Excel 式增删改查）的界面文案。键名以 table. 开头。
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  'table.title': '테이블 데이터',
  'table.subtitle': '스프레드시트처럼 레코드를 보고 편집합니다: 추가·수정·삭제를 SQL 없이',
  'table.selectConnection': '연결',
  'table.selectTable': '테이블',
  'table.pickTable': '테이블을 선택하세요',
  'table.noTableTitle': '테이블을 선택하지 않았습니다',
  'table.noTableHint': '왼쪽에서 테이블을 고르면 여기에 데이터가 표시되고 바로 편집할 수 있습니다.',
  'table.refresh': '새로 고침',
  'table.addRow': '행 추가',
  'table.deleteRows': '선택 삭제({count})',
  'table.save': '변경 저장({count})',
  'table.discard': '변경 버리기',
  'table.pageSize': '페이지당 {size}행',
  'table.prev': '이전',
  'table.next': '다음',
  'table.pageInfo': '{total}페이지 중 {page}페이지',
  'table.totalRows': '총 {count}행',
  'table.totalUnknown': '행 수를 알 수 없습니다(테이블이 너무 크거나 집계할 수 없음)',
  'table.loading': '불러오는 중…',
  'table.empty': '이 테이블에는 아직 데이터가 없습니다',
  'table.emptyHint': '「행 추가」를 눌러 첫 레코드를 넣으세요.',
  'table.rowNew': '추가',
  'table.rowEdited': '수정됨',
  'table.rowDeleted': '삭제 예정',
  'table.selectRow': '{index}행 선택',
  'table.selectAll': '이 페이지 전체 선택',
  'table.cellNull': 'NULL',
  'table.cellEdited': '이 셀은 수정되었습니다',
  'table.locatorPrimary': '식별 방식: 기본 키 {columns}',
  'table.locatorUnique': '식별 방식: 고유 인덱스 {name}({columns})',
  'table.locatorNone': '식별 방식: 없음',
  'table.readonlyNoKey': '이 테이블에는 기본 키도, 쓸 만한 고유 인덱스도 없어 한 행을 안전하게 특정할 수 없습니다. 여러 행을 잘못 수정하지 않도록 여기서는 조회와 추가만 허용합니다.',
  'table.readonlyNoPermission': '현재 계정에 쓰기 권한이 없어 조회만 가능합니다.',
  'table.readonlyConnection': '이 연결은 읽기 전용 보호가 켜져 있어 조회만 가능합니다.',
  'table.readonlyBanner': '읽기 전용: {reason}',
  'table.errLoad': '데이터를 불러오지 못했습니다: {message}',
  'table.errSave': '저장하지 못했습니다: {message}',
  'table.errNoChanges': '저장할 변경이 없습니다',
  'table.errRequired': '{column} 열은 NULL을 허용하지 않습니다',
  'table.errIdentifier': '테이블 또는 열 이름이 올바르지 않습니다',
  'table.confirmDelete': '선택한 {count}개 행을 삭제할까요? 데이터베이스에 즉시 반영되며 되돌릴 수 없습니다.',
  'table.confirmDiscard': '저장하지 않은 변경을 모두 버릴까요?',
  'table.saveDone': '저장했습니다: 추가 {inserted} / 수정 {updated} / 삭제 {deleted}',
  'table.unsaved': '저장하지 않은 변경 {count}건',
  'table.sortHint': '열 머리글을 클릭하면 정렬됩니다',
  'table.newRowHint': '추가한 행은 끝에 붙고 저장한 뒤에야 데이터베이스에 기록됩니다',
  'table.pkMissing': '이 테이블에는 기본 키가 없습니다: 행 추가는 되지만 기존 레코드는 안전하게 수정·삭제할 수 없습니다.',
};

export default messages;
