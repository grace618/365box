import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const dataDir = path.resolve(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "boxes.db"));

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS boxes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL,
    prompt TEXT,
    status TEXT NOT NULL DEFAULT 'locked',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    opened_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_boxes_date ON boxes(date);
`);

export type Box = {
  id: number;
  date: string;
  content: string;
  prompt: string | null;
  status: "locked" | "opened";
  created_at: string;
  updated_at: string;
  opened_at: string | null;
};

export function getBox(date: string): Box | undefined {
  return db.prepare("SELECT * FROM boxes WHERE date = ?").get(date) as Box | undefined;
}

export function listBoxes(): Box[] {
  return db.prepare("SELECT * FROM boxes ORDER BY date").all() as Box[];
}

export function createBox(date: string, content: string, prompt?: string) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO boxes (date, content, prompt, status, created_at, updated_at)
    VALUES (?, ?, ?, 'locked', ?, ?)
  `).run(date, content, prompt ?? null, now, now);

  return getBox(date)!;
}

export function updateBox(date: string, content?: string, prompt?: string) {
  const box = getBox(date);
  if (!box) throw new Error("BOX_NOT_FOUND");
  if (box.status === "opened") throw new Error("BOX_ALREADY_OPENED");

  const now = new Date().toISOString();
  const nextContent = content ?? box.content;
  const nextPrompt = prompt !== undefined ? prompt : box.prompt;

  db.prepare(`
    UPDATE boxes
    SET content = ?, prompt = ?, updated_at = ?
    WHERE date = ?
  `).run(nextContent, nextPrompt, now, date);

  return getBox(date)!;
}

export function deleteBox(date: string) {
  const result = db.prepare("DELETE FROM boxes WHERE date = ?").run(date);
  if (result.changes === 0) throw new Error("BOX_NOT_FOUND");
}

export function markOpened(date: string) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE boxes
    SET status = 'opened', opened_at = ?, updated_at = ?
    WHERE date = ?
  `).run(now, now, date);

  return getBox(date)!;
}
