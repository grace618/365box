/** 对接 AI 看到的操作说明（instructions / box://docs 同源） */
export const MCP_INSTRUCTIONS = `你正在使用「365 Day Box」：按日期存放留言的电子盲盒。

## 字段：content 与 prompt
- content（必填）：真正留给「到日打开的人」看的留言正文。
- prompt（可选）：写盒时的创作方向/备注，只存在数据库里，开盒时会一并返回；不参与解锁逻辑，也不替代 content。
- 不传 prompt 完全可以；传了也不影响能不能创建/修改。update 时不传 prompt = 保持原值；要清空需看实现（当前不传则保留）。

## 你必须遵守
1. 日期只用真实存在的 YYYY-MM-DD（不要 2027-02-30 这种）；时间是北京时间 +08:00。
2. 只能写 2027 年。填盒子前先 next_empty_dates，不要猜日期。
3. 每个日期只能有 1 个盒子。
4. 不能创建过去的日期（早于北京时间「今天」）；今天和未来可以。
5. 想新建 → create_box。想改已有内容 → update_box。二者不要混用。
6. create 遇到「已有盒子」会失败，不会覆盖。
7. update 的 content 必填；只能改未打开的盒子。
8. 日历里的 locked / opened：没被成功「打开」过一直是 locked；只有 open_box / today_box 在「已到解锁日」时首次打开，才会变成 opened。
9. 未到解锁日，open_box / today_box 看不到 content，这是正常的。
10. 批量接口看 results 里每一条的 ok；部分失败时成功的条目仍然有效。失败条同时有 error（中文说明）和 code（稳定错误码，如 INVALID_DATE）。缺字段也只会让该条失败。
11. 同一请求里不要对同一日期重复提交；若重复，只有第一条会成功。
12. 写多天：先 next_empty_dates(count=N)，再一次 create_box 传入 N 个不同日期。
13. calendar_status：start_date 不能晚于 end_date；失败时仍是工具成功返回，正文 { ok:false, error, code }（与批量工具一样看正文，不是 Step error）。
14. year_stats 永远是目标年 2027 整年，与 start_date/end_date 无关；stats 才对应当前查询范围。
15. 约定：业务失败都看正文里的 ok/code（批量看 results[]；单次工具看顶层 ok）。传输/协议级故障才是 Step error。
16. 备份用 export_boxes：导出全部盒子 JSON（含正文）。服务若开启 AUTH_TOKEN，客户端必须带 Authorization: Bearer <token>。

## open_box / today_box 会不会改状态
| 情况 | 是否返回 content | 是否把盒子标成 opened |
|---|---|---|
| 该日无盒 | 否（exists=false） | 否 |
| 有盒但未到解锁日 | 否（locked=true） | 否，仅查看 |
| 有盒且已到解锁日，第一次打开 | 是（locked=false） | 是，标记 opened |
| 有盒且已经 opened 过，再调用 | 是 | 否，只是再读 |

today_box = open_box(今天)，规则相同。

## 先选对工具
| 你想做的事 | 用这个 |
|---|---|
| 找还能写的日期 | next_empty_dates |
| 往空日期写入留言 | create_box |
| 改还没打开的留言 | update_box |
| 删掉不要的盒子 | delete_box |
| 打开/查看某些日期（到日首次打开会改状态） | open_box |
| 只看今天 | today_box |
| 看某段日期有没有盒、开没开（不要正文） | calendar_status |
| 导出全部盒子 JSON（备份，含正文） | export_boxes |

## 常见操作顺序
写一批新盒子：
1) next_empty_dates（需要几个就传 count；不传则返回全部可写空位）
2) 用返回的不同日期，一次 create_box 写入
3) 可选 calendar_status 核对

改写错的内容：update_box（先确认那天还没被打开）

读留言：当天用 today_box；指定多天用 open_box。若 locked=true，说明还没到解锁日，且状态未变。

## 调用示例（照抄改字段即可）

### next_empty_dates
入参：
{}
或
{ "count": 3 }

出参示例：
{ "dates": ["2027-01-01", "2027-01-02", "2027-01-03"] }

### create_box
入参示例：
{
  "boxes": [
    { "date": "2027-01-01", "content": "给未来的你：新年快乐。", "prompt": "元旦祝福，温暖一点" },
    { "date": "2027-01-02", "content": "只有正文也可以，不传 prompt。" }
  ]
}

出参示例：
{
  "results": [
    { "date": "2027-01-01", "ok": true, "status": "locked" },
    { "date": "2027-01-02", "ok": true, "status": "locked" }
  ]
}

失败条示例：
{ "date": "2027-01-01", "ok": false, "error": "这个日期已经有盒子了", "code": "BOX_ALREADY_EXISTS" }

### update_box
入参示例：
{
  "boxes": [
    { "date": "2027-01-01", "content": "改后的正文", "prompt": "可选；不传则 prompt 保持原值" },
    { "date": "2027-01-99", "content": "坏日期只会让这一条失败" }
  ]
}

出参示例：
{
  "results": [
    { "date": "2027-01-01", "ok": true, "status": "locked" },
    { "date": "2027-01-99", "ok": false, "error": "日期格式必须是 YYYY-MM-DD，且必须是真实存在的日历日", "code": "INVALID_DATE" }
  ]
}

### delete_box
入参示例：
{ "dates": ["2027-01-02"] }

出参示例：
{
  "results": [
    { "date": "2027-01-02", "ok": true, "deleted": true, "message": "盲盒已删除，该日期现在是空盒。" }
  ]
}

### open_box
入参示例：
{ "dates": ["2027-12-25", "2027-01-01"] }

出参示例（未到日 / 已到日）：
{
  "results": [
    {
      "ok": true,
      "exists": true,
      "locked": true,
      "date": "2027-12-25",
      "unlock_at": "2027-12-25T00:00:00+08:00"
    },
    {
      "ok": true,
      "exists": true,
      "locked": false,
      "date": "2027-01-01",
      "content": "给未来的你：新年快乐。",
      "prompt": "元旦祝福，温暖一点",
      "opened_at": "2027-01-01T08:15:00+08:00"
    }
  ]
}

### today_box
入参：无（传 {} 即可）

出参：与 open_box 单条同一形状，包在 results 里：
{ "results": [{ "ok": true, "exists": false, "date": "2026-09-12" }] }

### calendar_status
入参示例：
{ "start_date": "2027-01-01", "end_date": "2027-01-31" }

出参示例（成功）：
{
  "ok": true,
  "stats": {
    "start_date": "2027-01-01",
    "end_date": "2027-01-31",
    "total": 1,
    "locked": 1,
    "opened": 0
  },
  "year_stats": {
    "year": 2027,
    "total": 1,
    "locked": 1,
    "opened": 0,
    "empty": 364
  },
  "dates": [
    { "date": "2027-01-01", "status": "locked", "has_box": true }
  ]
}

出参示例（start > end，仍是工具成功，看正文 ok）：
{
  "ok": false,
  "error": "开始日期不能晚于结束日期，请交换 start_date / end_date",
  "code": "DATE_RANGE_INVALID"
}

说明：
- stats = 本次 start～end 查询范围
- year_stats = 固定目标年 2027 整年（即使你查的是 2026 某天，year_stats.year 仍是 2027）
- 业务失败统一看正文 ok/code，不要当 Step error

### export_boxes
入参：无（传 {}）

出参示例：
{
  "ok": true,
  "format": "365box-export-v1",
  "exported_at": "2026-09-12T12:00:00+08:00",
  "timezone": "Asia/Shanghai",
  "utc_offset": "+08:00",
  "year": 2027,
  "count": 1,
  "boxes": [
    {
      "date": "2027-01-01",
      "content": "给未来的你：新年快乐。",
      "prompt": "元旦",
      "status": "locked",
      "created_at": "2026-09-11T20:00:00+08:00",
      "updated_at": "2026-09-11T20:00:00+08:00",
      "opened_at": null
    }
  ]
}

## 出错时怎么处理（看 code，文案可能微调）
- INVALID_DATE → 换真实日历日 YYYY-MM-DD
- DATE_YEAR_INVALID → 只能写 2027
- DATE_IN_PAST → 换今天或未来空日期（先 next_empty_dates）
- BOX_ALREADY_EXISTS → 换空日期，或改用 update_box
- BOX_NOT_FOUND → 先 create，或换日期
- BOX_ALREADY_OPENED → 不能再改，只能读
- CONTENT_REQUIRED → content 必须有实质文字
- DATE_RANGE_INVALID → 交换 start_date / end_date
- UNAUTHORIZED → 检查 AUTH_TOKEN / Authorization 头
`;
