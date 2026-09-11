/** 对接 AI 看到的操作说明（instructions / box://docs 同源） */
export const MCP_INSTRUCTIONS = `你正在使用「365 Day Box」：按日期存放留言的电子盲盒。

## 你必须遵守
1. 日期只用真实存在的 YYYY-MM-DD（不要 2027-02-30 这种）；时间是北京时间 +08:00。
2. 只能写 2027 年。填盒子前先 next_empty_dates，不要猜日期。
3. 每个日期只能有 1 个盒子。
4. 不能创建过去的日期（早于北京时间「今天」）；今天和未来可以。
5. 想新建 → create_box。想改已有内容 → update_box。二者不要混用。
6. create 遇到「已有盒子」会失败，不会覆盖。
7. update 的 content 必填；只能改未打开的盒子。
8. 没打开过的盒子，在日历里一直是 locked；只有真正 open 过才变成 opened。
9. 未到解锁日，open_box / today_box 看不到 content，这是正常的。
10. 批量接口看 results 里每一条的 ok；部分失败时成功的条目仍然有效。
11. 同一请求里不要对同一日期重复提交；若重复，只有第一条会成功。
12. 写多天：先 next_empty_dates(count=N)，再一次 create_box 传入 N 个不同日期（也可并行，但日期必须互不相同）。

## 先选对工具
| 你想做的事 | 用这个 |
|---|---|
| 找还能写的日期 | next_empty_dates |
| 往空日期写入留言 | create_box |
| 改还没打开的留言 | update_box |
| 删掉不要的盒子 | delete_box |
| 打开/查看某些日期（含已开过的） | open_box |
| 只看今天 | today_box |
| 看某段日期有没有盒、开没开（不要正文） | calendar_status |

## 常见操作顺序
写一批新盒子：
1) next_empty_dates（需要几个就传 count；不传则返回全部可写空位）
2) 用返回的不同日期，一次 create_box 写入
3) 可选 calendar_status 核对

改写错的内容：update_box（先确认那天还没被打开）

读留言：当天用 today_box；指定多天用 open_box。若 locked=true，说明还没到解锁日。

## 调用格式（照抄改字段即可）

next_empty_dates
- 入参：{} 或 { "count": 10 }（count 范围 1–365）
- 出参：{ "dates": ["2027-01-01", ...] }（已排除过去日期和已有盒子的日期）

create_box
- 入参：{ "boxes": [{ "date": "2027-01-01", "content": "留言正文", "prompt": "可选创作方向" }] }
- 成功条：{ "date", "ok": true, "status": "locked" }
- 失败条：{ "date", "ok": false, "error": "..." }

update_box
- 入参：{ "boxes": [{ "date": "2027-01-01", "content": "新正文", "prompt": "可选" }] }
- 成功条：{ "date", "ok": true, "status": "locked" }

delete_box
- 入参：{ "dates": ["2027-01-01"] }
- 成功条：{ "date", "ok": true, "deleted": true, "message": "..." }

open_box
- 入参：{ "dates": ["2027-12-25", "2026-01-01"] }
- 每条可能是：
  - 无盒：exists=false
  - 未到日：exists=true, locked=true, unlock_at="...T00:00:00+08:00"（无 content）
  - 已到日（含首次打开）：exists=true, locked=false, content, prompt, opened_at

today_box
- 无入参。出参与 open_box 对齐：{ "results": [{ "ok": true, ...打开字段 }] }

calendar_status
- 入参可选：{ "start_date": "2027-01-01", "end_date": "2027-12-31" }
- 默认 start=今天，end=start
- 只返回有盒子的日期；status 只有 locked | opened
- stats：对应当前查询的日期范围
- year_stats：整个目标年（2027）统计

## 出错时怎么处理
- 「日期格式必须是 YYYY-MM-DD，且必须是真实存在的日历日」→ 换真实日期
- 「只能创建 2027 年的盒子」→ 不要写其它年份
- 「不能创建过去的日期」→ 换今天或未来的空日期（先 next_empty_dates）
- 「这个日期已经有盒子了」→ 换空日期，或改用 update_box
- 「这个日期没有盒子」→ 先 create，或换日期
- 「盒子已经打开，不能修改」→ 不能再改，只能读
- 「盒子内容不能为空」→ content 必须有实质文字
`;
