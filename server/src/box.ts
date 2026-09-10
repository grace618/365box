import { createBox, deleteBox, getBox, listBoxes, markOpened, updateBox, type Box } from "./database.js";

export function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`));
}

function todayString(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function nowDateString(): string {
  return todayString();
}

export function isUnlocked(date: string): boolean {
  return date <= todayString();
}

export function createBoxSafe(date: string, content: string, prompt?: string) {
  if (!isValidDate(date)) throw new Error("INVALID_DATE");
  if (!content?.trim()) throw new Error("CONTENT_REQUIRED");
  if (getBox(date)) throw new Error("BOX_ALREADY_EXISTS");
  return createBox(date, content, prompt);
}

export function updateBoxSafe(date: string, content?: string, prompt?: string) {
  if (!isValidDate(date)) throw new Error("INVALID_DATE");
  return updateBox(date, content, prompt);
}

export function deleteBoxSafe(date: string) {
  if (!isValidDate(date)) throw new Error("INVALID_DATE");
  deleteBox(date);
}

export function openBox(date: string) {
  if (!isValidDate(date)) throw new Error("INVALID_DATE");

  const box = getBox(date);
  if (!box) return { exists: false, date };

  if (!isUnlocked(date)) {
    return {
      exists: true,
      locked: true,
      date,
      unlock_at: `${date}T00:00:00+08:00`
    };
  }

  if (box.status !== "opened") {
    markOpened(date);
  }

  const opened = getBox(date)!;
  return {
    exists: true,
    locked: false,
    date,
    content: opened.content,
    prompt: opened.prompt,
    opened_at: opened.opened_at
  };
}

export function calendarStatus(startDate?: string, endDate?: string) {
  const boxes = listBoxes();
  const start = startDate ?? todayString();
  const end = endDate ?? start;

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

export function getStats() {
  const boxes = listBoxes();
  return {
    total: boxes.length,
    locked: boxes.filter(b => b.status === "locked").length,
    opened: boxes.filter(b => b.status === "opened").length,
    empty: Math.max(0, 365 - boxes.length)
  };
}

export function nextEmptyDates(count = 5, from = todayString()) {
  const existing = new Set(listBoxes().map(b => b.date));
  const result: string[] = [];
  const date = new Date(`${from}T12:00:00+08:00`);

  for (let i = 0; result.length < count && i < 1000; i++) {
    const current = new Date(date);
    current.setDate(current.getDate() + i);
    const value = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai"
    }).format(current);
    if (!existing.has(value)) result.push(value);
  }

  return result;
}

export function sanitizeBox(box: Box) {
  return {
    date: box.date,
    status: box.status,
    has_box: true,
    created_at: box.created_at,
    updated_at: box.updated_at,
    opened_at: box.opened_at
  };
}
