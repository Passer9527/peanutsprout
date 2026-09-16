# AI 助手使用指南

> 本文回答三个问题：**在哪里填 API Key / 怎么接本地大模型**、**怎么和它对话**、**它有哪些技能**。

---

## 1. 在哪里配置

**界面入口：登录 → 左侧导航「AI 助手」（或「设置」页顶部的 AI 助手卡片）。**

配置分两步，**两步都做完才能真正调用**：

| 步骤 | 位置 | 说明 |
| --- | --- | --- |
| ① 打开总开关 | 设置 → AI 助手 → 「启用 AI 功能」 | 服务端设置项 `ai.enabled`。**默认关闭**，关闭时所有 AI 调用直接返回 `AI_DISABLED`（403），不会发出任何外部请求 |
| ② 添加模型配置 | 设置 → AI 助手 → 「新增配置」 | 填供应商、模型名、Base URL、API Key |

> ⚠️ **这两步以前在界面上都不存在。** 后端 AI 能力（9 类供应商、6 个技能、脱敏、调用历史、审计）一直是完整的，但既没有配置界面，也没有任何写设置项的接口 —— 于是 `ai.enabled` 永远是种子里的 `false`，AI 功能**等于不存在**。现在已补齐：`PUT /api/v1/meta/settings`（白名单约束）+ 设置页 AI 卡片 + 独立的 AI 助手对话页。

### 配置项说明

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| 配置名称 | ✅ | 任意名字，用于在列表里区分 |
| 供应商 | ✅ | 九选一，见下表 |
| 模型名称 | ✅ | 如 `qwen2.5-coder:7b`、`gpt-4o`。本地模型可点「从服务端拉取」列出已下载的模型 |
| 接口地址 | ⬜ | 留空则用该供应商的默认地址；**接本地模型时通常要填** |
| API Key | ⬜ | 加密（AES-256-GCM）后存入本地库。**本地模型一般不需要** |
| 温度 / 最大 token / 超时 | ⬜ | 有默认值，一般不用改 |
| 设为默认 / 启用 | ⬜ | 默认配置会被所有 AI 场景使用 |

**密钥安全**：后端**从不回传** API Key，接口只给 `hasApiKey` 布尔值。因此编辑配置时密钥框是空的，**留空即表示不修改**已保存的密钥。

---

## 2. 接入本地大模型

本地模型**不需要 API Key、不需要联网**，适合数据敏感或想离线使用的场景。三条常见路线：

### Ollama（最省事）

```bash
# 1) 装好 Ollama 后拉一个代码模型
ollama pull qwen2.5-coder:7b
# 2) 确认它在跑（默认 11434）
curl http://127.0.0.1:11434/api/tags
```

然后在「新增配置」里填：

| 字段 | 值 |
| --- | --- |
| 供应商 | **Ollama（本地）** |
| 模型名称 | 点「从服务端拉取」选，或手填 `qwen2.5-coder:7b` |
| 接口地址 | 留空即用默认 `http://127.0.0.1:11434/v1` |
| API Key | 留空 |

### LM Studio / vLLM / LocalAI / 其他自建服务

这些都提供 OpenAI 兼容接口，用同一个供应商选项：

| 字段 | 值 |
| --- | --- |
| 供应商 | **OpenAI 兼容服务（vLLM / LM Studio / 自建）** |
| 接口地址 | `http://127.0.0.1:1234/v1`（LM Studio 默认）或你的服务地址 |
| API Key | 留空，或按服务要求填 |

### 云端 API

选对应供应商，接口地址留空即可，只填 API Key：

| 供应商 | 默认 Base URL |
| --- | --- |
| OpenAI | `https://api.openai.com/v1` |
| Anthropic | `https://api.anthropic.com/v1` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| 文心一言 | `https://qianfan.baidubce.com/v2` |
| 智谱 AI | `https://open.bigmodel.cn/api/paas/v4` |
| DeepSeek | `https://api.deepseek.com/v1` |

> **保存前先点「测试连通」。** 它会真发一次最小请求（`max_tokens=8`），当场告诉你耗时与模型回执；地址写错、密钥无效、模型名不存在都会立刻暴露，不用等真正用的时候才发现。这一步**不要求总开关已打开**，因为正常的顺序就是"先试通、再启用"。

---

## 3. 怎么和它对话

打开左侧导航 **「AI 助手」**。界面是**左侧选技能 + 右侧对话区**：

1. 左侧点一个**技能**（如「自然语言转 SQL」）；
2. 右侧按技能要求填输入（选连接、写问题、粘 SQL 等）；
3. 点「发送」（或 `Ctrl / ⌘ + Enter`）；
4. 结果按技能结构化展示，可一键复制。

**这不是自由聊天机器人，而是"带技能的助手"。** 每个技能有各自的提示词、需要的上下文和结果结构，所以做成明确的技能入口，而不是一个让你不知道该写什么的万能输入框。

### 还没配置时会怎样

界面不会只丢一行报错，而是给出可点的下一步：

- 总开关没开 → 「AI 功能未启用」+ **前往设置**按钮；
- 没配模型 → 「还没有可用的模型」+ **前往配置**按钮。

这正是之前缺失的那段路：旧版本的报错文案写着「可在『设置 → AI』中启用」，而那个界面并不存在。

---

## 4. 六个技能

| 技能 | 需要什么 | 输出什么 |
| --- | --- | --- |
| **自然语言转 SQL** | 目标连接 + 中文需求 | 生成 SQL + 说明 + 置信度 + 涉及表 |
| **解释 SQL** | 一段 SQL | 逐段中文说明 |
| **优化 SQL** | 一段 SQL（+ 可选连接） | 优化建议列表（标题 / 详情 / 改写后的 SQL / 严重级别）。给了连接会先跑 `EXPLAIN` 拿到真实执行计划再交给模型 |
| **生成文档** | 目标连接 | 根据表结构生成字段说明文档（Markdown） |
| **结果集问答** | 结果数据 + 问题 | 针对数据的中文回答。**出网前自动脱敏** |
| **报错诊断** | 报错信息（+ 可选 SQL） | 可能原因 + 修复建议 |

### 安全红线（已实现并有测试守着）

1. **AI 只生成，绝不执行。** 自然语言转 SQL 的结果只在页面上展示、允许复制，`executed` 字段恒为 `false`；要真正运行必须你回到「SQL 开发」页确认。界面顶部有明确提示，避免误以为已经跑过。
2. **生产库默认禁止 AI 写。** 设置项 `ai.production_write_allowed` 默认关闭；即便打开，生成的写语句仍需人工确认。
3. **结果集出网前脱敏。** `ai.redaction_enabled` 默认开启，手机号 / 身份证 / 邮箱 / 银行卡等列自动替换为掩码。
4. **全程留痕。** 每次调用都写 `ai_history`（提示词、响应、token 数、耗时、成功或失败）与 `audit_logs`（含哈希链）。

---

## 5. 服务端开关一览

设置页三个开关，都保存在服务端、对所有用户生效，且**每次变更都写审计**（含旧值 → 新值）：

| 设置键 | 默认 | 作用 |
| --- | --- | --- |
| `ai.enabled` | `false` | AI 总开关 |
| `ai.redaction_enabled` | `true` | 结果集敏感字段脱敏 |
| `ai.production_write_allowed` | `false` | 是否允许 AI 对生产连接生成写语句 |

设置项写入受**白名单**约束（`packages/storage/src/repositories/sessions-settings.ts` 的 `WRITABLE_SETTINGS`）。白名单外的键一律返回 `VALIDATION_FAILED`，不会静默忽略 —— 避免界面上的一个笔误变成谁也读不懂的幽灵配置。当前可用清单也可通过 `GET /api/v1/meta/settings/writable` 查询。

---

## 6. 接口速查

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/ai/status` | `ai.use` | 是否启用、是否已配置、当前默认模型 |
| GET / POST | `/ai/configs` | `settings.manage` | 列出 / 新增模型配置 |
| PUT / DELETE | `/ai/configs/:id` | `settings.manage` | 修改 / 删除配置 |
| POST | `/ai/test` | `settings.manage` | 连通性测试（传 `configId` 或表单临时值） |
| POST | `/ai/models` | `settings.manage` | 列举供应商侧可用模型 |
| GET | `/ai/history` | `ai.use` | 调用历史 |
| POST | `/ai/nl2sql` \| `/ai/explain` \| `/ai/optimize` \| `/ai/document` \| `/ai/ask` \| `/ai/diagnose` | `ai.use` | 六个技能场景 |
| PUT | `/meta/settings` | `settings.manage` | 写设置项（白名单约束） |
| GET | `/meta/settings/writable` | `settings.manage` | 可写设置项清单 |

> `/ai/models` 用 POST 而非 GET：入参可能带 API Key，放进查询串会落到访问日志和浏览器历史里。
>
> Anthropic 与 Google 没有公开的模型列表接口，此时接口**明确返回"不提供模型列表接口，请手动填写模型名称"**，而不是返回空数组 —— 那会把"不支持"误传成"你一个模型都没装"。

### 用命令行验证（无需界面）

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8787/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"123456"}' | jq -r .token)

# 打开总开关
curl -s -X PUT http://127.0.0.1:8787/api/v1/meta/settings \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"items":[{"key":"ai.enabled","value":true}]}'

# 接本地 Ollama
curl -s -X POST http://127.0.0.1:8787/api/v1/ai/configs \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"本地Ollama","provider":"ollama","modelName":"qwen2.5-coder:7b",
       "isDefault":true,"enabled":true}'

# 试连
curl -s -X POST http://127.0.0.1:8787/api/v1/ai/test \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"provider":"ollama","modelName":"qwen2.5-coder:7b"}'
```

CLI 另有 `pnpm cli ai status` / `ai nl2sql` / `ai explain` 三个命令。

---

## 7. 常见问题

**Q：点了「从服务端拉取」，提示不支持？**
A：该供应商没有模型列表接口（Anthropic / Google），手动填模型名即可。

**Q：测试连通报 `AI_PROVIDER_ERROR`，怎么排查？**
A：报错里带 `details.url`，直接看它是哪个地址。常见原因：本地服务没启动、端口不对、Base URL 少写或多写了 `/v1`。

**Q：为什么 `curl http://127.0.0.1:11434` 能通，但配了 Ollama 还是连不上？**
A：Base URL 要指向 **OpenAI 兼容端点**，即 `http://127.0.0.1:11434/v1`（本工具默认已填好）。只写 `http://127.0.0.1:11434` 会请求到错误路径。

**Q：AI 生成的 SQL 会自己跑吗？**
A：**不会。** 这是硬约束，有测试守着（断言 `executed === false`）。

**Q：能把 AI 完全关掉吗？**
A：能。`ai.enabled=false`（默认值）时所有 AI 场景返回 `AI_DISABLED`，**不会发出任何外部请求**，断网环境也完全可用。
