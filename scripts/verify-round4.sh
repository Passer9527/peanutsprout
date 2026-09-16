#!/usr/bin/env bash
# 花生苗数据库管理工具 - 第四轮功能的实机验证（跑在**打包后的产物**上）
# Copyright (C) 2025 飞哥 (微信 6731663)
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 这个脚本刻意用 curl + Node 内置的 node:sqlite 直接读库来核对，而不是调项目自己的代码 ——
# 自己验自己是最容易得到"通过"却什么都没证明的做法。
#
# 三个踩过的坑（记下来免得下次再踩）：
#  1. 本机没有 sqlite3 CLI，所以独立读取走 `node:sqlite`。
#  2. `node:sqlite` **关闭了双引号字符串字面量**（"abc" 被当成列名而报
#     `no such column`）。SQL 字符串字面量必须用单引号，而单引号嵌在 bash 单引号里
#     会打架 —— 所以造数据/查询都写成独立的 .mjs 文件，用 heredoc 生成，彻底避开引号地狱。
#  3. Fastify 的 JSON 输出**不带空格**（{"ok":true}），子串匹配 '"ok": true' 永远匹配不到。
#     所以断言改为 python 解析 JSON 后比字段值。
set -uo pipefail

# 仓库根目录按**脚本自身位置**推导，而不是写死作者的绝对路径 ——
# 否则别人克隆下来一跑就失败。
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNPACKED="$ROOT/release/linux-unpacked"
SERVER="$UNPACKED/resources/server/server.mjs"
PORT=8899
HOME_DIR="$(mktemp -d /tmp/ps-verify-XXXXXX)"
TESTDB="$HOME_DIR/test.db"
LOG="$HOME_DIR/server.log"
PASS=0; FAIL=0

say()  { printf '\n\033[1m── %s\033[0m\n' "$*"; }
ok()   { PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31m✗\033[0m %s\n' "$*"; }
check(){ if [ "$2" = "$3" ]; then ok "$1 = $2"; else bad "$1：期望 [$3] 实际 [$2]"; fi; }

# 从 JSON 取值：jget <json> <python 表达式，用 d 指代解析后的对象>
jget() {
  printf '%s' "$1" | python3 -c "
import json,sys
try: d = json.load(sys.stdin)
except Exception: print('<不是 JSON>'); sys.exit()
try: print($2)
except Exception: print('<取值失败>')
"
}
jis() {
  local got; got=$(jget "$2" "$3")
  if [ "$got" = "$4" ]; then ok "$1 = $got"
  else bad "$1：期望 [$4] 实际 [$got]"; printf '      原始响应: %.220s\n' "$2"; fi
}
# 断言错误响应里的 message 含某段文字。注意：错误体是 {error:{code,message}}，
# 顶层没有 message —— 这个嵌套层次是本脚本自己踩过的坑。
jerr() {
  local got; got=$(jget "$2" 'd["error"]["message"]')
  case "$got" in *"$3"*) ok "$1";; *) bad "$1（message 里没有 [$3]）"; printf '      原始响应: %.220s\n' "$2";; esac
}

cleanup() { [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null; }
trap cleanup EXIT

# ---------------------------------------------------------------- 辅助脚本
cat > "$HOME_DIR/q.mjs" <<'EOF'
// 直接读测试库 —— 绕开项目自己的驱动代码，这是本脚本"独立核对"的基础
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[2]);
const rows = db.prepare(process.argv[3]).all();
db.close();
console.log(rows.map((r) => Object.values(r).map((v) => (v === null ? 'NULL' : String(v))).join(',')).join('\n'));
EOF
cat > "$HOME_DIR/appq.mjs" <<'EOF'
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[2]);
const rows = db.prepare(process.argv[3]).all();
db.close();
console.log(Object.values(rows[0] ?? {})[0] ?? '');
EOF
cat > "$HOME_DIR/seed.mjs" <<'EOF'
// 造测试数据。SQL 字符串字面量一律**单引号** —— node:sqlite 关闭了双引号字面量。
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[2]);
db.exec('CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER, note TEXT)');
db.exec("INSERT INTO people VALUES (1,'甲',30,NULL),(2,'乙',NULL,'x'),(3,'丙',40,'y')");
db.exec('CREATE TABLE logs (level TEXT, message TEXT)');
db.exec("INSERT INTO logs VALUES ('info','a'),('warn','b')");
db.exec('CREATE TABLE codes (code TEXT NOT NULL, label TEXT)');
db.exec('CREATE UNIQUE INDEX ux_codes_code ON codes (code)');
db.exec("INSERT INTO codes VALUES ('a','A'),('b','B')");
// 一张"唯一索引里有可空列"的表：它**不能**当定位符（NULL 会让 WHERE col=? 永远不成立）
db.exec('CREATE TABLE nullable_uniq (sku TEXT, region TEXT)');
db.exec('CREATE UNIQUE INDEX ux_nu ON nullable_uniq (sku, region)');
db.exec("INSERT INTO nullable_uniq VALUES ('s1','r1')");
db.close();
EOF
cat > "$HOME_DIR/cols.mjs" <<'EOF'
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[2]);
console.log(db.prepare(`PRAGMA table_info(${process.argv[3]})`).all().map((c) => c.name).join(','));
db.close();
EOF
q()    { node "$HOME_DIR/q.mjs"    "$TESTDB" "$1"; }
appq() { node "$HOME_DIR/appq.mjs" "$HOME_DIR/peanutsprout.db" "$1"; }

# ---------------------------------------------------------------- 起服务
say "启动打包产物里的服务"
[ -f "$SERVER" ] || { echo "找不到 $SERVER"; exit 1; }
PEANUTSPROUT_HOME="$HOME_DIR" PEANUTSPROUT_PORT="$PORT" node "$SERVER" >"$LOG" 2>&1 &
SRV_PID=$!
for _ in $(seq 1 40); do
  curl -sf "http://127.0.0.1:$PORT/api/v1/health" >/dev/null 2>&1 && break; sleep 0.5
done
curl -sf "http://127.0.0.1:$PORT/api/v1/health" >/dev/null || { echo "服务未起来："; tail -20 "$LOG"; exit 1; }
ok "服务已就绪 http://127.0.0.1:$PORT"

# ---------------------------------------------------------------- 首页与深色皮肤
say "Web 界面（含深色皮肤修复）"
CODE=$(curl -s -o "$HOME_DIR/index.html" -w '%{http_code}' "http://127.0.0.1:$PORT/")
check "GET / 状态码" "$CODE" "200"
CSS_PATH=$(grep -o '/assets/[^"]*\.css' "$HOME_DIR/index.html" | head -1)
[ -n "$CSS_PATH" ] && curl -s "http://127.0.0.1:$PORT$CSS_PATH" -o "$HOME_DIR/app.css"
if [ -s "$HOME_DIR/app.css" ]; then
  ok "取到构建后的 CSS ($CSS_PATH)"
  LEGACY=$(grep -o -e '--accent-1' -e '--surface-1' -e '--surface-2' -e '--surface-3' -e '--border-1' -e '--bg-2' -e '--text-1' "$HOME_DIR/app.css" | wc -l)
  check "遗留的未定义变量名出现次数" "$LEGACY" "0"
  # 强调色与两个对照色必须在**浅色和深色两个块里都有定义**，所以各 2 次才对
  check "强调色 --color-accent 定义次数（浅色+深色）" "$(grep -o -- '--color-accent:' "$HOME_DIR/app.css" | wc -l)" "2"
  check "强调色对照色定义次数（浅色+深色）" "$(grep -o -- '--color-accent-contrast:' "$HOME_DIR/app.css" | wc -l)" "2"
  check "危险色对照色定义次数（浅色+深色）" "$(grep -o -- '--color-danger-contrast:' "$HOME_DIR/app.css" | wc -l)" "2"
  if python3 - "$HOME_DIR/app.css" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
defined = set(re.findall(r'(--[a-z0-9-]+)\s*:', s))
used = set(re.findall(r'var\((--[a-z0-9-]+)', s))
missing = sorted(used - defined)
print(f"    变量：定义 {len(defined)} / 引用 {len(used)} / 未定义 {missing if missing else '无'}")
sys.exit(1 if missing else 0)
PY
  then ok "产物 CSS 没有引用未定义的变量"; else bad "产物 CSS 仍有未定义的变量"; fi
  if python3 - "$HOME_DIR/app.css" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
def block(pat):
    m = re.search(pat + r'\s*\{(.*?)\}', s, re.S)
    return set(re.findall(r'(--[a-z0-9-]+)\s*:', m.group(1))) if m else set()
light = block(r':root')
dark  = block(r"\[data-theme=['\"]?dark['\"]?\]")
colored = lambda st: {v for v in st if v.startswith(('--color-', '--chart-', '--shadow-'))}
lost = colored(light) - dark
print(f"    浅色 {len(colored(light))} 个配色变量，深色 {len(colored(dark))} 个；深色缺失：{sorted(lost) if lost else '无'}")
sys.exit(1 if lost else 0)
PY
  then ok "深色主题没有漏掉任何一个配色变量"; else bad "深色主题漏了配色变量"; fi
else
  bad "没能取到构建后的 CSS"
fi

# ---------------------------------------------------------------- 登录与改密
say "登录（默认口令 admin/123456）"
TOKEN=$(curl -s -X POST "http://127.0.0.1:$PORT/api/v1/auth/login" -H 'content-type: application/json' \
  -d '{"username":"admin","password":"123456"}' | python3 -c 'import json,sys;print(json.load(sys.stdin).get("token",""))')
[ -n "$TOKEN" ] && ok "默认口令能登录" || { bad "登录失败"; tail -20 "$LOG"; exit 1; }
AUTH="authorization: Bearer $TOKEN"

NEWPW='Adm1n-Passw0rd!'
CP=$(curl -s -X POST "http://127.0.0.1:$PORT/api/v1/auth/change-password" -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"oldPassword\":\"123456\",\"newPassword\":\"$NEWPW\"}")
jis "改密接口返回 ok" "$CP" 'd.get("ok")' "True"
TOKEN=$(curl -s -X POST "http://127.0.0.1:$PORT/api/v1/auth/login" -H 'content-type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$NEWPW\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("token",""))')
AUTH="authorization: Bearer $TOKEN"
[ -n "$TOKEN" ] && ok "改密后重新登录成功" || { bad "改密后登录失败"; exit 1; }

# ---------------------------------------------------------------- 测试库
say "准备 SQLite 测试库"
node "$HOME_DIR/seed.mjs" "$TESTDB" && ok "测试库已建好（4 张表）" || { bad "造数据失败"; exit 1; }
check "people 有 3 行" "$(q 'SELECT COUNT(*) FROM people')" "3"

CONN=$(curl -s -X POST "http://127.0.0.1:$PORT/api/v1/connections" -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"name\":\"验证库\",\"dbType\":\"sqlite\",\"databaseName\":\"$TESTDB\"}" \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["item"]["id"])')
[ -n "$CONN" ] && ok "连接已创建 (id=$CONN)" || { bad "创建连接失败"; exit 1; }

API="http://127.0.0.1:$PORT/api/v1"
post()   { curl -s -X POST "$API$1" -H "$AUTH" -H 'content-type: application/json' -d "$2"; }
code_of(){ curl -s -o /dev/null -w '%{http_code}' -X POST "$API$1" -H "$AUTH" -H 'content-type: application/json' -d "$2"; }

# ---------------------------------------------------------------- 定位符
say "表数据编辑器 · 定位符判定"
R=$(post /data/table/columns "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"people\"}")
jis "有主键的表 → primary_key" "$R" 'd["locator"]["kind"]' "primary_key"
jis "有主键的表 → editable" "$R" 'd["editable"]' "True"
jis "定位列是 id" "$R" 'd["locator"]["columns"]' "['id']"
R=$(post /data/table/columns "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"codes\"}")
jis "无主键 + 唯一非空索引 → unique_index" "$R" 'd["locator"]["kind"]' "unique_index"
jis "定位列是 code" "$R" 'd["locator"]["columns"]' "['code']"
R=$(post /data/table/columns "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"nullable_uniq\"}")
jis "唯一索引含可空列 → 不算定位符" "$R" 'd["locator"]["kind"]' "none"
jis "→ readOnlyReason" "$R" 'd["readOnlyReason"]' "no_primary_key"
R=$(post /data/table/columns "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"logs\"}")
jis "无主键无唯一索引 → none" "$R" 'd["locator"]["kind"]' "none"
jis "→ editable=false" "$R" 'd["editable"]' "False"

# ---------------------------------------------------------------- 读
say "表数据编辑器 · 分页读取"
R=$(post /data/table/rows "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"people\",\"page\":1,\"pageSize\":2}")
jis "pageSize 生效" "$R" 'len(d["rows"])' "2"
jis "total=3" "$R" 'd["total"]' "3"
R=$(post /data/table/rows "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"people\",\"page\":2,\"pageSize\":2}")
jis "第 2 页拿到剩余 1 行" "$R" 'len(d["rows"])' "1"
jis "第 2 页第一行是 id=3" "$R" 'd["rows"][0][0]' "3"
R=$(post /data/table/rows "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"people\",\"orderBy\":\"id\",\"orderDir\":\"desc\"}")
jis "降序首行 id=3" "$R" 'd["rows"][0][0]' "3"
R=$(post /data/table/rows "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"people\",\"orderBy\":\"name\",\"orderDir\":\"asc\"}")
jis "按 name 升序可用" "$R" 'len(d["rows"])' "3"
check "按不存在的列排序被拒" "$(code_of /data/table/rows "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"people\",\"orderBy\":\"no_such\"}")" "400"
check "pageSize 超上限被拒" "$(code_of /data/table/rows "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"people\",\"pageSize\":99999}")" "400"

# ---------------------------------------------------------------- 增
say "表数据编辑器 · 新增"
R=$(post /data/table/insert "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"people\",\"values\":{\"id\":10,\"name\":\"新来的\",\"age\":25}}")
jis "inserted=1" "$R" 'd["inserted"]' "1"
check "库里真的有 id=10" "$(q 'SELECT name FROM people WHERE id=10')" "新来的"
R=$(post /data/table/insert "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"logs\",\"values\":{\"level\":\"error\",\"message\":\"boom\"}}")
jis "无主键表也能新增" "$R" 'd["inserted"]' "1"
check "无主键表新增已落库" "$(q "SELECT message FROM logs WHERE level='error'")" "boom"
check "非空列漏填被拒" "$(code_of /data/table/insert "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"people\",\"values\":{\"id\":11,\"age\":1}}")" "400"
check "被拒后一行都没插" "$(q 'SELECT COUNT(*) FROM people WHERE id=11')" "0"
check "不存在的列被拒" "$(code_of /data/table/insert "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"people\",\"values\":{\"id\":12,\"name\":\"x\",\"nope\":1}}")" "400"
check "values 为空被拒" "$(code_of /data/table/insert "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"people\",\"values\":{}}")" "400"

# ---------------------------------------------------------------- 改
say "表数据编辑器 · 更新（只改一行，逐行核对）"
R=$(post /data/table/update "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"people\",\"key\":{\"id\":2},\"changes\":{\"name\":\"乙改\"}}")
jis "updated=1" "$R" 'd["updated"]' "1"
check "id=2 已改" "$(q 'SELECT name FROM people WHERE id=2')" "乙改"
check "id=1 未被动" "$(q 'SELECT name FROM people WHERE id=1')" "甲"
check "id=3 未被动" "$(q 'SELECT name FROM people WHERE id=3')" "丙"
check "行数没变" "$(q 'SELECT COUNT(*) FROM people')" "4"

R=$(post /data/table/update "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"people\",\"key\":{\"id\":1},\"changes\":{\"note\":null}}")
jis "可空列改成 NULL 成功" "$R" 'd["updated"]' "1"
check "note 真的是 NULL（不是空串）" "$(q 'SELECT note IS NULL FROM people WHERE id=1')" "1"

check "非空列改成 NULL 被拒" "$(code_of /data/table/update "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"people\",\"key\":{\"id\":1},\"changes\":{\"name\":null}}")" "400"
check "被拒后 name 未变" "$(q 'SELECT name FROM people WHERE id=1')" "甲"
check "key 命中 0 行 → 404" "$(code_of /data/table/update "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"people\",\"key\":{\"id\":98765},\"changes\":{\"name\":\"x\"}}")" "404"
check "key 列数偏多被拒" "$(code_of /data/table/update "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"codes\",\"key\":{\"code\":\"a\",\"extra\":1},\"changes\":{\"label\":\"X\"}}")" "400"
check "key 列数偏少被拒" "$(code_of /data/table/update "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"people\",\"key\":{},\"changes\":{\"name\":\"X\"}}")" "400"
check "changes 为空被拒" "$(code_of /data/table/update "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"people\",\"key\":{\"id\":1},\"changes\":{}}")" "400"

BEFORE_LOGS=$(q "SELECT group_concat(message) FROM logs WHERE level IN ('info','warn') ORDER BY level")
check "无主键表更新被拒（不退化模糊匹配）" "$(code_of /data/table/update "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"logs\",\"key\":{\"level\":\"info\"},\"changes\":{\"message\":\"hacked\"}}")" "400"
check "无主键表内容一行未变" "$(q "SELECT group_concat(message) FROM logs WHERE level IN ('info','warn') ORDER BY level")" "$BEFORE_LOGS"
check "可空唯一索引表更新被拒" "$(code_of /data/table/update "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"nullable_uniq\",\"key\":{\"sku\":\"s1\",\"region\":\"r1\"},\"changes\":{\"region\":\"r2\"}}")" "400"

R=$(post /data/table/update "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"codes\",\"key\":{\"code\":\"a\"},\"changes\":{\"label\":\"A-new\"}}")
jis "唯一索引定位可以安全更新" "$R" 'd["updated"]' "1"
check "codes 更新落库" "$(q "SELECT label FROM codes WHERE code='a'")" "A-new"
check "codes 另一行未动" "$(q "SELECT label FROM codes WHERE code='b'")" "B"

# ---------------------------------------------------------------- 删
say "表数据编辑器 · 删除"
R=$(post /data/table/delete "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"people\",\"keys\":[{\"id\":10}]}")
jis "deleted=1" "$R" 'd["deleted"]' "1"
check "库里 id=10 已删" "$(q 'SELECT COUNT(*) FROM people WHERE id=10')" "0"
R=$(post /data/table/delete "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"people\",\"keys\":[{\"id\":99999}]}")
jis "删不存在的行 → deleted=0 不报错" "$R" 'd["deleted"]' "0"
R=$(post /data/table/delete "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"people\",\"keys\":[{\"id\":2},{\"id\":3}]}")
jis "一次删两行" "$R" 'd["deleted"]' "2"
check "真的只剩 1 行" "$(q 'SELECT COUNT(*) FROM people')" "1"
LOGN=$(q 'SELECT COUNT(*) FROM logs')
check "无主键表删除被拒" "$(code_of /data/table/delete "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"logs\",\"keys\":[{\"level\":\"info\"}]}")" "400"
check "logs 行数未变" "$(q 'SELECT COUNT(*) FROM logs')" "$LOGN"
check "keys 为空被拒" "$(code_of /data/table/delete "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"people\",\"keys\":[]}")" "400"

# ---------------------------------------------------------------- 权限
say "权限：只读账号写不动"
curl -s -X POST "$API/users" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"username":"ro-verify","password":"Re@d0nly-Pass!","roles":["readonly"]}' >/dev/null
RO=$(curl -s -X POST "$API/auth/login" -H 'content-type: application/json' \
  -d '{"username":"ro-verify","password":"Re@d0nly-Pass!"}' | python3 -c 'import json,sys;print(json.load(sys.stdin).get("token",""))')
[ -n "$RO" ] && ok "只读账号已登录" || bad "只读账号登录失败"
rocode(){ curl -s -o /dev/null -w '%{http_code}' -X POST "$API$1" -H "authorization: Bearer $RO" -H 'content-type: application/json' -d "$2"; }
BEFORE=$(q 'SELECT name FROM people ORDER BY id LIMIT 1')
check "只读账号更新 → 403" "$(rocode /data/table/update "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"people\",\"key\":{\"id\":1},\"changes\":{\"name\":\"x\"}}")" "403"
check "只读账号没能改到数据" "$(q 'SELECT name FROM people ORDER BY id LIMIT 1')" "$BEFORE"
check "只读账号删除 → 403" "$(rocode /data/table/delete "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"people\",\"keys\":[{\"id\":1}]}")" "403"
check "只读账号新增 → 403" "$(rocode /data/table/insert "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"people\",\"values\":{\"name\":\"x\"}}")" "403"
check "只读账号删表 → 403" "$(rocode /ddl/drop-table "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"people\",\"confirm\":true}")" "403"
check "只读账号 DDL 执行 → 403" "$(rocode /ddl/execute "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"zz\",\"columns\":[{\"name\":\"a\",\"dataType\":\"INTEGER\",\"nullable\":true,\"primaryKey\":false}],\"confirm\":true}")" "403"
check "只读账号读得到数据（只读不是看不见）" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/data/table/rows" -H "authorization: Bearer $RO" -H 'content-type: application/json' -d "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"people\"}")" "200"

# ---------------------------------------------------------------- DDL
say "可视化建库建表 · 预览不执行"
BODY="{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"verify_tbl\",\"columns\":[{\"name\":\"id\",\"dataType\":\"INTEGER\",\"nullable\":false,\"primaryKey\":true},{\"name\":\"label\",\"dataType\":\"varchar\",\"length\":32,\"nullable\":true,\"primaryKey\":false}],\"indexes\":[{\"name\":\"ix_verify_label\",\"columns\":[\"label\"],\"unique\":false}]}"
R=$(post /ddl/preview "$BODY")
jis "预览返回 2 条语句" "$R" 'len(d["statements"])' "2"
jis "第一条是建表" "$R" '"CREATE TABLE" in d["statements"][0]' "True"
jis "第二条是建索引" "$R" '"CREATE INDEX" in d["statements"][1]' "True"
jis "长度拼进类型名" "$R" '"varchar(32)" in d["statements"][0]' "True"
check "预览之后表并不存在" "$(q "SELECT COUNT(*) FROM sqlite_master WHERE name='verify_tbl'")" "0"
check "预览之后索引也不存在" "$(q "SELECT COUNT(*) FROM sqlite_master WHERE name='ix_verify_label'")" "0"

check "危险默认值（注入）被白名单拒绝" "$(code_of /ddl/preview "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"x\",\"columns\":[{\"name\":\"id\",\"dataType\":\"INTEGER\",\"nullable\":true,\"primaryKey\":false,\"defaultValue\":\"0; DROP TABLE people --\"}],\"indexes\":[]}")" "400"
check "now() 这类合法但不在白名单的表达式也被拒" "$(code_of /ddl/preview "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"x\",\"columns\":[{\"name\":\"t\",\"dataType\":\"TEXT\",\"nullable\":true,\"primaryKey\":false,\"defaultValue\":\"now()\"}],\"indexes\":[]}")" "400"
check "CURRENT_TIMESTAMP 允许" "$(code_of /ddl/preview "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"x\",\"columns\":[{\"name\":\"t\",\"dataType\":\"TEXT\",\"nullable\":true,\"primaryKey\":false,\"defaultValue\":\"CURRENT_TIMESTAMP\"}],\"indexes\":[]}")" "200"
check "非法表名被拒" "$(code_of /ddl/preview "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"bad name; DROP\",\"columns\":[{\"name\":\"a\",\"dataType\":\"INTEGER\",\"nullable\":true,\"primaryKey\":false}],\"indexes\":[]}")" "400"
check "没有列的建表被拒" "$(code_of /ddl/preview "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"x\",\"columns\":[],\"indexes\":[]}")" "400"
check "索引引用不存在的列被拒" "$(code_of /ddl/preview "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"x\",\"columns\":[{\"name\":\"a\",\"dataType\":\"INTEGER\",\"nullable\":true,\"primaryKey\":false}],\"indexes\":[{\"name\":\"ix\",\"columns\":[\"nope\"],\"unique\":false}]}")" "400"
check "拒绝后 people 还在" "$(q "SELECT COUNT(*) FROM sqlite_master WHERE name='people'")" "1"

say "可视化建库建表 · 执行"
check "不带 confirm → 428" "$(code_of /ddl/execute "$BODY")" "428"
check "428 之后表仍未建" "$(q "SELECT COUNT(*) FROM sqlite_master WHERE name='verify_tbl'")" "0"
R=$(post /ddl/execute "${BODY%\}},\"confirm\":true}")
jis "executed=2" "$R" 'd["executed"]' "2"
jis "返回 ok" "$R" 'd["ok"]' "True"
check "表真的建出来了" "$(q "SELECT COUNT(*) FROM sqlite_master WHERE name='verify_tbl'")" "1"
check "索引真的建出来了（SQLite createIndex 回归）" "$(q "SELECT COUNT(*) FROM sqlite_master WHERE name='ix_verify_label'")" "1"
check "列定义正确" "$(node "$HOME_DIR/cols.mjs" "$TESTDB" verify_tbl)" "id,label"
R=$(post /ddl/execute "${BODY%\}},\"confirm\":true}")
check "重复建同名表如实报错（不是静默成功）→ 400" "$(jget "$R" 'd["error"]["code"]')" "QUERY_FAILED"
jerr "报的是『表已存在』而不是别的错" "$R" "already exists"

# IF NOT EXISTS 只作用于建表。**索引名在同一个库里是全局的**（不是每张表一份），
# 所以幂等用例必须不带索引 —— 顺手把"索引不做幂等"这条边界也钉住：
# MySQL 没有 CREATE INDEX IF NOT EXISTS，只在部分方言上做幂等反而更难预期。
R2=$(printf '%s' "$BODY" | python3 -c 'import json,sys;b=json.load(sys.stdin);b.update(table="verify_tbl2",ifNotExists=True,indexes=[],confirm=True);print(json.dumps(b))')
R=$(post /ddl/execute "$R2")
jis "IF NOT EXISTS 重复建表成功（不带索引）" "$R" 'd["ok"]' "True"
check "表确实建出来了" "$(q "SELECT COUNT(*) FROM sqlite_master WHERE name='verify_tbl2'")" "1"

R3=$(printf '%s' "$BODY" | python3 -c 'import json,sys;b=json.load(sys.stdin);b.update(table="verify_tbl3",indexes=[{"name":"ix_verify_label","columns":["label"],"unique":False}],confirm=True);print(json.dumps(b))')
R=$(post /ddl/execute "$R3")
jerr "同名索引仍如实报错（索引不做幂等）" "$R" "already exists"
# ★ 这条是**刻意的诚实边界**：DDL 逐条执行且**没有事务**，所以索引那一步失败时，
#   前一步建的表**已经留在库里了**。界面靠 executed 的实际条数如实报告，不假装整体失败。
check "★ 建表已生效、索引失败 —— 留下了部分成功（无事务）" "$(q "SELECT COUNT(*) FROM sqlite_master WHERE name='verify_tbl3'")" "1"
check "★ 失败的那条索引确实没建出来" "$(q "SELECT COUNT(*) FROM sqlite_master WHERE name='ix_verify_tbl3'")" "0"

R=$(post /ddl/drop-table "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"verify_tbl3\",\"confirm\":true}")
jis "清理 verify_tbl3" "$R" 'd["ok"]' "True"
R=$(post /ddl/drop-table "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"verify_tbl2\",\"confirm\":true}")
jis "清理 verify_tbl2" "$R" 'd["ok"]' "True"

R=$(post /ddl/create-schema "{\"connectionId\":$CONN,\"name\":\"analytics\",\"confirm\":true}")
jerr "SQLite 建 Schema 明确报不支持" "$R" "不支持用 SQL 创建 Schema"
R=$(curl -s "$API/ddl/schema-support/$CONN" -H "$AUTH")
jis "schema-support 如实回答 supported=false" "$R" 'd["supported"]' "False"
jis "keyword 为 null" "$R" 'd["keyword"]' "None"
R=$(curl -s "$API/ddl/column-types/$CONN" -H "$AUTH")
jis "类型清单返回 sqlite 方言" "$R" 'd["dbType"]' "sqlite"
jis "类型清单非空" "$R" 'len(d["types"]) > 5' "True"

check "删表不带 confirm → 428" "$(code_of /ddl/drop-table "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"verify_tbl\"}")" "428"
check "428 之后表还在" "$(q "SELECT COUNT(*) FROM sqlite_master WHERE name='verify_tbl'")" "1"
R=$(post /ddl/drop-table "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"verify_tbl\",\"confirm\":true}")
jis "删表成功" "$R" 'd["ok"]' "True"
check "表真的没了" "$(q "SELECT COUNT(*) FROM sqlite_master WHERE name='verify_tbl'")" "0"
check "删不存在的表 → 404" "$(code_of /ddl/drop-table "{\"connectionId\":$CONN,\"schema\":\"main\",\"table\":\"verify_tbl\",\"confirm\":true}")" "404"

# ---------------------------------------------------------------- 多语句拒绝
say "SQL 开发页：多语句必须报错（本轮驱动修复）"
R=$(post /query/execute "{\"connectionId\":$CONN,\"sql\":\"CREATE TABLE multi_a (a INT);\\nCREATE INDEX ix_multi ON multi_a (a);\",\"confirm\":true}")
jerr "多语句被明确拒绝" "$R" "一次只执行一条语句"
check "多语句里的第一条也没被执行（拒绝在发给库之前）" "$(q "SELECT COUNT(*) FROM sqlite_master WHERE name='multi_a'")" "0"

# ---------------------------------------------------------------- 审计
say "审计留痕"
A=$(appq "SELECT COUNT(*) FROM audit_logs WHERE action='write' AND resource_type='table_row' AND status='success'")
[ "$A" -ge 5 ] && ok "表数据写操作有 $A 条 success 审计" || bad "表数据审计只有 $A 条"
D=$(appq "SELECT COUNT(*) FROM audit_logs WHERE action='write' AND resource_type='table_row' AND status='denied'")
[ "$D" -ge 1 ] && ok "被拒绝的写尝试留痕 $D 条（不留无成本试错空间）" || bad "没有 denied 审计"
DD=$(appq "SELECT COUNT(*) FROM audit_logs WHERE action='ddl'")
[ "$DD" -ge 2 ] && ok "DDL 操作留痕 $DD 条" || bad "DDL 审计只有 $DD 条"
V=$(curl -s "$API/audit/verify" -H "$AUTH")
jis "审计哈希链完整" "$V" 'd["ok"]' "True"

# ---------------------------------------------------------------- 结果
printf '\n\033[1m═══════════════════════════════════════\033[0m\n'
printf '通过 %d 项，失败 %d 项\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] && printf '\033[32m全部通过\033[0m\n' || printf '\033[31m有失败项\033[0m\n'
printf '数据目录（保留以便复查）：%s\n' "$HOME_DIR"
trap - EXIT
[ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null
exit "$FAIL"
