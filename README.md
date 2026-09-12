# 365 Day Box

本地「365 天电子盲盒」：MCP + Web。每个日期最多一个盒子；到解锁日才能看到留言；数据存在本地 SQLite。

## 启动

```bash
npm run install:all
# 或：bash install.sh   /   install.bat
npm run dev
```

默认监听 `0.0.0.0`（可用局域网 IP 连接）：
- Web: http://127.0.0.1:5173
- API / MCP: 启动后终端会打印本机和局域网地址

对面 MCP 一般要填**局域网 IP**（不要用 127.0.0.1），例如本机开发：

```text
http://192.168.3.101:3002/mcp
```

若连 Docker 部署机，用服务器 IP（见下方「Docker 部署」）。

换电脑 / 换 Wi‑Fi 后 IP 会变：看启动日志里的「局域网 MCP」，或改 `mcp-config.example.json` 里的 `url`。

也可分别 `npm run server` / `npm run web`。默认 API/MCP 端口是 **3002**；被占用时换掉占用进程，或设 `PORT=其它端口`。只要本机、不要局域网时：`HOST=127.0.0.1 npm run server`。

首次启动会自动创建 SQLite（`server/data/`，已被 gitignore）。

## 鉴权（推荐开启）

设置环境变量 `AUTH_TOKEN` 后，MCP 与除 `/api/health` 外的 API 都需要令牌：

```bash
export AUTH_TOKEN='你的长随机串'
npm run server
```

请求头任选其一：
- `Authorization: Bearer 你的长随机串`
- `X-Box-Token: 你的长随机串`

Docker：在项目目录建 `.env`（可参考 `.env.example`），写入 `AUTH_TOKEN=...`，再 `docker compose up -d --build`。

网页若检测到已开启鉴权，会提示填写 token（保存在浏览器 localStorage）。MCP 客户端在配置里加 `headers.Authorization`（见 `mcp-config.example.json`）。

## 导出 JSON

- MCP 工具：`export_boxes`（无入参，返回全部盒子含正文）
- HTTP：`GET /api/export`（需鉴权）

## Docker 部署

机器上已装 Docker 时：

```bash
docker compose up -d --build
```

常用命令：

```bash
docker compose logs -f      # 看日志
docker compose restart      # 重启
docker compose down         # 停止并移除容器（数据卷默认保留）
```

- Web / API / MCP 同一端口：`http://服务器IP:3002`
- MCP：`http://服务器IP:3002/mcp`
- 数据卷：`box-data`（SQLite 持久化，`down` 不会删卷）

当前已部署示例机：

```text
网页：http://192.168.3.24:3002/
MCP： http://192.168.3.24:3002/mcp
```

## MCP 怎么接

地址示例（以实际服务所在机器局域网 IP 为准；本机开发看启动日志「局域网 MCP」，Docker 服务器见上）：

```text
http://192.168.3.24:3002/mcp
```

对接方连上后，对面 AI 会看到（操作手册，不是长 API 罗列）：
- 初始化 `instructions`：必须遵守的规则、何时用哪个工具、调用顺序、出错怎么处理
- Resource `box://docs`：与 instructions 同源
- 各 tool 的 description：一句话说明适用场景

改对接说明只改：`server/src/mcp-docs.ts`。换开放起点只改：`server/src/config.ts` 的 `START_DATE`。下面「接口说明」给人对照字段用。

## 接口说明

### 总览

| 约定 | 说明 |
|------|------|
| 日期 / 时间 | 日期必须是真实日历日 `YYYY-MM-DD`；时间戳北京时间 `...+08:00` |
| 开放起点 | 从 **2026-09-15** 起可写，无结束日，可跨年；仍须 ≥ 今天 |
| 增删改查 | `create_box` / `update_box` / `delete_box` / `open_box` 均为**数组**入参 |
| 统一出参 | `{ "results": [ ... ] }`，逐条 `ok`；失败带 `error`（中文）+ `code`（如 `INVALID_DATE`），允许部分成功 |
| 重复日期 | 同一请求里同一天出现多次：第一条成功，后面失败 |
| create vs update | create 只新建、已有则失败；**不能创建过去/非法日/早于起点**；改内容只能 update |
| update | 只能改未打开的盒子；`content` 必传 |
| 解锁 / 日历 | 没打开过的一直是 `locked`；只有真正打开过才是 `opened` |
| 网页 | 按年切换（最早 2026，最晚当年+3）；近 7 天才能打开/查看 |
| HTTP | `GET /api/box/:date` 只读不拆盒；`POST /api/box/:date/open` 才打开 |

推荐流程：`next_empty_dates` → `create_box` → `calendar_status` → 到日再 `today_box` / `open_box`

---

### create_box（增）

批量新建。某日已有盒子 → 该条失败，不覆盖。**须 ≥ 2026-09-15 且 ≥ 今天；非法日历日（如 02-30）不能创建。**

**入参**

```json
{
  "boxes": [
    { "date": "2026-09-15", "content": "留言（必填）", "prompt": "可选提示词" }
  ]
}
```

**出参**

```json
{
  "results": [
    { "date": "2026-09-15", "ok": true, "status": "locked" },
    { "date": "2026-09-31", "ok": false, "error": "日期格式必须是 YYYY-MM-DD，且必须是真实存在的日历日", "code": "INVALID_DATE" }
  ]
}
```

---

### update_box（改）

批量改未打开的盒子。不存在 / 已打开 → 失败。`content` 必传；`prompt` 可选（不传保持原值）。

**入参**

```json
{
  "boxes": [
    { "date": "2027-01-01", "content": "新留言（必填）", "prompt": "可选" }
  ]
}
```

**出参**

```json
{
  "results": [
    { "date": "2027-01-01", "ok": true, "status": "locked" },
    { "date": "2027-01-02", "ok": false, "error": "盒子已经打开，不能修改", "code": "BOX_ALREADY_OPENED" }
  ]
}
```

---

### delete_box（删）

批量永久删除；删后该日空盒，内容不可恢复。

**入参**

```json
{ "dates": ["2027-01-01", "2027-01-02"] }
```

**出参**

```json
{
  "results": [
    {
      "date": "2027-01-01",
      "ok": true,
      "deleted": true,
      "message": "盲盒已删除，该日期现在是空盒。"
    },
    { "date": "2027-01-03", "ok": false, "error": "这个日期没有盒子", "code": "BOX_NOT_FOUND" }
  ]
}
```

---

### open_box（查 / 开）

批量打开或查看；可查已开过的盒子。未到解锁日不给 `content`。

**入参**

```json
{ "dates": ["2027-12-25", "2026-09-20"] }
```

**出参**（`results` 里每条一种）

```json
{ "date": "2027-01-01", "ok": true, "exists": false }
```

```json
{
  "date": "2027-12-25",
  "ok": true,
  "exists": true,
  "locked": true,
  "unlock_at": "2027-12-25T00:00:00+08:00"
}
```

```json
{
  "date": "2026-01-01",
  "ok": true,
  "exists": true,
  "locked": false,
  "content": "...",
  "prompt": "...",
  "opened_at": "..."
}
```

```json
{ "date": "坏日期", "ok": false, "error": "日期格式必须是 YYYY-MM-DD，且必须是真实存在的日历日", "code": "INVALID_DATE" }
```

---

### today_box

打开今天的盒子。无入参。出参与 `open_box` 单条一致：

```json
{ "results": [{ "ok": true, "exists": true, "locked": false, "date": "...", "content": "..." }] }
```

---

### calendar_status

看哪些天有盒子、开没开过；**不返回留言正文**。

**入参**（均可选；默认 `start_date=今天`，`end_date=start_date`）

```json
{ "start_date": "2026-09-01", "end_date": "2026-09-30" }
```

**出参**

```json
{
  "ok": true,
  "stats": {
    "start_date": "2026-09-01",
    "end_date": "2026-09-30",
    "total": 1,
    "locked": 1,
    "opened": 0
  },
  "year_stats": { "year": 2026, "total": 1, "locked": 1, "opened": 0, "empty": 107 },
  "dates": [{ "date": "2026-09-15", "status": "locked", "has_box": true }]
}
```

`stats` 对应当前查询范围；`year_stats` 是 `start_date` 所在年（2026 从 9/15 起算）。`start > end` 时返回 `{ "ok": false, "error": "...", "code": "DATE_RANGE_INVALID" }`（工具仍成功，看正文，不是 Step error）。

---

### next_empty_dates

从 `max(今天, 2026-09-15)` 起往后找还能写入的空日期。

**入参**

```json
{ "count": 10 }
```

- 不传 `count` → 默认 **90** 个  
- 传了 → 前 N 个，范围 **1–366**

**出参**

```json
{ "dates": ["2026-09-15", "2026-09-16"] }
```

---

### 常见错误文案

| 文案 |
|------|
| 日期格式必须是 YYYY-MM-DD，且必须是真实存在的日历日 |
| 不能早于开放起点 2026-09-15 |
| 不能创建过去的日期 |
| 盒子内容不能为空 |
| 这个日期已经有盒子了 |
| 这个日期没有盒子 |
| 盒子已经打开，不能修改 |

## 关于安全

本地 MVP：未来盒子在 SQLite 里是明文。防提前读主要靠 MCP 权限和解锁逻辑。若要做「库里也看不到」的时间锁，需另加密与密钥释放。
