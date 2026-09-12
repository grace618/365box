import { createBox, deleteBox, getBox, listBoxes, markOpened, updateBox, db } from "./database.js";
import { beijingDayStartISO, todayBeijingDate, nowBeijingISO } from "./time.js";
import {
  START_DATE,
  MAX_YEAR_OFFSET,
  NEXT_EMPTY_DEFAULT,
  NEXT_EMPTY_MAX
} from "./config.js";

export {
  START_DATE,
  MAX_YEAR_OFFSET,
  NEXT_EMPTY_DEFAULT,
  NEXT_EMPTY_MAX
};

export function daysInYear(year: number): number {
  let total = 0;
  for (let month = 1; month <= 12; month++) {
    total += new Date(Date.UTC(year, month, 0)).getUTCDate();
  }
  return total;
}

/** 闭区间 [start, end] 的日历天数（YYYY-MM-DD） */
export function daysInclusive(start: string, end: string): number {
  if (start > end) return 0;
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const a = Date.UTC(sy, sm - 1, sd);
  const b = Date.UTC(ey, em - 1, ed);
  return Math.floor((b - a) / 86400000) + 1;
}

export function shiftDate(date: string, deltaDays: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= daysInMonth;
}

export function nowDateString(): string {
  return todayBeijingDate();
}

export function isUnlocked(date: string): boolean {
  return date <= todayBeijingDate();
}

export function startYear(): number {
  return Number(START_DATE.slice(0, 4));
}

/** 默认展示年 = 当年（北京时间） */
export function defaultDisplayYear(today = todayBeijingDate()): number {
  return Number(today.slice(0, 4));
}

export function maxDisplayYear(today = todayBeijingDate()): number {
  return defaultDisplayYear(today) + MAX_YEAR_OFFSET;
}

/** 某年用于「空盒」分母的起止日 */
export function yearStatsRange(year: number): { start: string; end: string } | null {
  const minY = startYear();
  if (year < minY) return null;
  const end = `${year}-12-31`;
  if (year === minY) return { start: START_DATE, end };
  return { start: `${year}-01-01`, end };
}

function assertWritableDate(date: string) {
  if (date < START_DATE) {
    throw new Error("DATE_BEFORE_START");
  }
}

export function createBoxSafe(date: string, content: string, prompt?: string) {
  if (!isValidDate(date)) throw new Error("INVALID_DATE");
  assertWritableDate(date);
  if (date < todayBeijingDate()) throw new Error("DATE_IN_PAST");
  if (!content?.trim()) throw new Error("CONTENT_REQUIRED");

  const run = db.transaction(() => {
    if (getBox(date)) throw new Error("BOX_ALREADY_EXISTS");
    return createBox(date, content, prompt);
  });

  try {
    return run();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("UNIQUE") || msg.includes("unique")) {
      throw new Error("BOX_ALREADY_EXISTS");
    }
    throw error;
  }
}

export function updateBoxSafe(date: string, content: string, prompt?: string) {
  if (!isValidDate(date)) throw new Error("INVALID_DATE");
  if (!content?.trim()) throw new Error("CONTENT_REQUIRED");
  return updateBox(date, content, prompt);
}

export function deleteBoxSafe(date: string) {
  if (!isValidDate(date)) throw new Error("INVALID_DATE");
  deleteBox(date);
}

/** 只读查看：不会标记为已打开 */
export function inspectBox(date: string) {
  if (!isValidDate(date)) throw new Error("INVALID_DATE");

  const box = getBox(date);
  if (!box) return { exists: false as const, date };

  if (!isUnlocked(date)) {
    return {
      exists: true as const,
      locked: true as const,
      opened: false as const,
      date,
      unlock_at: beijingDayStartISO(date)
    };
  }

  if (box.status === "opened") {
    return {
      exists: true as const,
      locked: false as const,
      opened: true as const,
      date,
      content: box.content,
      prompt: box.prompt,
      opened_at: box.opened_at
    };
  }

  return {
    exists: true as const,
    locked: false as const,
    opened: false as const,
    date,
    ready: true as const
  };
}

/** 打开盒子：到日会标记 opened 并返回正文（MCP / POST 使用） */
export function openBox(date: string) {
  if (!isValidDate(date)) throw new Error("INVALID_DATE");

  const box = getBox(date);
  if (!box) return { exists: false as const, date };

  if (!isUnlocked(date)) {
    return {
      exists: true as const,
      locked: true as const,
      date,
      unlock_at: beijingDayStartISO(date)
    };
  }

  if (box.status !== "opened") {
    markOpened(date);
  }

  const opened = getBox(date)!;
  return {
    exists: true as const,
    locked: false as const,
    date,
    content: opened.content,
    prompt: opened.prompt,
    opened_at: opened.opened_at
  };
}

export function calendarStatus(startDate?: string, endDate?: string) {
  const start = startDate ?? todayBeijingDate();
  const end = endDate ?? start;
  if (!isValidDate(start) || !isValidDate(end)) throw new Error("INVALID_DATE");
  if (start > end) throw new Error("DATE_RANGE_INVALID");

  const boxes = listBoxes();
  return boxes
    .filter(b => b.date >= start && b.date <= end)
    .map(b => ({
      date: b.date,
      status: isUnlocked(b.date) && b.status === "opened"
        ? "opened"
        : "locked",
      has_box: true
    }));
}

/** 指定年统计（页头 / year_stats）；默认当年 */
export function getStats(year = defaultDisplayYear()) {
  const range = yearStatsRange(year);
  if (!range) {
    return {
      year,
      total: 0,
      locked: 0,
      opened: 0,
      empty: 0
    };
  }

  const boxes = listBoxes().filter(b => b.date >= range.start && b.date <= range.end);
  const denom = daysInclusive(range.start, range.end);

  return {
    year,
    total: boxes.length,
    locked: boxes.filter(b => b.status === "locked").length,
    opened: boxes.filter(b => b.status === "opened").length,
    empty: Math.max(0, denom - boxes.length)
  };
}

/** 指定日期范围内的统计（给 calendar_status 用，避免和查询范围脱节） */
export function getRangeStats(startDate: string, endDate: string) {
  if (!isValidDate(startDate) || !isValidDate(endDate)) throw new Error("INVALID_DATE");
  if (startDate > endDate) throw new Error("DATE_RANGE_INVALID");
  const boxes = listBoxes().filter(b => b.date >= startDate && b.date <= endDate);
  return {
    start_date: startDate,
    end_date: endDate,
    total: boxes.length,
    locked: boxes.filter(b => !isUnlocked(b.date) || b.status !== "opened").length,
    opened: boxes.filter(b => isUnlocked(b.date) && b.status === "opened").length
  };
}

/**
 * 从 max(今天, 起点) 起往后找空日期。
 * 不传 count → 默认 90；传 count → 限制在 1…366。
 */
export function nextEmptyDates(count?: number) {
  const existing = new Set(listBoxes().map(b => b.date));
  const today = todayBeijingDate();
  let cursor = today > START_DATE ? today : START_DATE;
  const limit =
    count === undefined
      ? NEXT_EMPTY_DEFAULT
      : Math.min(NEXT_EMPTY_MAX, Math.max(1, Math.floor(count)));

  const result: string[] = [];
  // 安全上限：最多扫描约 3 年，避免异常死循环
  const scanCap = 366 * (MAX_YEAR_OFFSET + 1);
  for (let i = 0; i < scanCap && result.length < limit; i++) {
    if (!existing.has(cursor)) result.push(cursor);
    cursor = shiftDate(cursor, 1);
  }
  return result;
}

/** 导出全部盒子为 JSON（含正文，供备份 / MCP） */
export function exportBoxesJson() {
  const boxes = listBoxes().map(b => ({
    date: b.date,
    content: b.content,
    prompt: b.prompt,
    status: b.status,
    created_at: b.created_at,
    updated_at: b.updated_at,
    opened_at: b.opened_at
  }));

  return {
    ok: true as const,
    format: "365box-export-v1" as const,
    exported_at: nowBeijingISO(),
    timezone: "Asia/Shanghai",
    utc_offset: "+08:00",
    start_date: START_DATE,
    count: boxes.length,
    boxes
  };
}
