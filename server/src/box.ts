import { createBox, deleteBox, getBox, listBoxes, markOpened, updateBox, db } from "./database.js";
import { beijingDayStartISO, todayBeijingDate } from "./time.js";
import { TARGET_YEAR } from "./config.js";

export { TARGET_YEAR };

export function daysInYear(year: number): number {
  let total = 0;
  for (let month = 1; month <= 12; month++) {
    total += new Date(Date.UTC(year, month, 0)).getUTCDate();
  }
  return total;
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

function assertTargetYear(date: string) {
  if (!date.startsWith(`${TARGET_YEAR}-`)) {
    throw new Error("DATE_YEAR_INVALID");
  }
}

export function createBoxSafe(date: string, content: string, prompt?: string) {
  if (!isValidDate(date)) throw new Error("INVALID_DATE");
  assertTargetYear(date);
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

/** 目标年全年统计（给 /api/stats、页头用） */
export function getStats() {
  const prefix = `${TARGET_YEAR}-`;
  const boxes = listBoxes().filter(b => b.date.startsWith(prefix));
  const yearDays = daysInYear(TARGET_YEAR);

  return {
    year: TARGET_YEAR,
    total: boxes.length,
    locked: boxes.filter(b => b.status === "locked").length,
    opened: boxes.filter(b => b.status === "opened").length,
    empty: Math.max(0, yearDays - boxes.length)
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

/** 返回目标年空位（不含过去的日期）；传 count 时取前 N 个 */
export function nextEmptyDates(count?: number) {
  const existing = new Set(listBoxes().map(b => b.date));
  const today = todayBeijingDate();
  const result: string[] = [];

  for (let month = 1; month <= 12; month++) {
    const daysInMonth = new Date(Date.UTC(TARGET_YEAR, month, 0)).getUTCDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const value = `${TARGET_YEAR}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (value < today) continue;
      if (!existing.has(value)) result.push(value);
    }
  }

  if (count === undefined) return result;
  return result.slice(0, count);
}
