import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isValidDate,
  createBoxSafe,
  deleteBoxSafe,
  inspectBox,
  openBox,
  getStats,
  getRangeStats,
  nextEmptyDates,
  exportBoxesJson,
  daysInclusive,
  START_DATE,
  NEXT_EMPTY_DEFAULT
} from "./box.js";

describe("date validation", () => {
  it("accepts real calendar days", () => {
    assert.equal(isValidDate("2026-09-15"), true);
    assert.equal(isValidDate("2027-02-28"), true);
  });

  it("rejects impossible days", () => {
    assert.equal(isValidDate("2027-02-30"), false);
    assert.equal(isValidDate("2027-02-29"), false);
    assert.equal(isValidDate("2027-04-31"), false);
  });
});

describe("create rules", () => {
  const date = "2027-05-20";

  it("rejects before start and invalid day", () => {
    assert.throws(() => createBoxSafe("2026-09-14", "x"), /DATE_BEFORE_START/);
    assert.throws(() => createBoxSafe("2027-02-30", "x"), /INVALID_DATE/);
  });

  it("creates once and blocks duplicate", () => {
    try { deleteBoxSafe(date); } catch { /* */ }
    createBoxSafe(date, "hello", "p");
    assert.throws(() => createBoxSafe(date, "again"), /BOX_ALREADY_EXISTS/);
    const peeked = inspectBox(date);
    assert.equal(peeked.exists, true);
    assert.equal("content" in peeked, false);
    deleteBoxSafe(date);
  });
});

describe("open vs inspect", () => {
  it("inspect does not mark opened for future locked boxes", () => {
    const date = "2027-11-11";
    try { deleteBoxSafe(date); } catch { /* */ }
    createBoxSafe(date, "secret");
    const a = inspectBox(date);
    assert.equal(a.exists, true);
    assert.equal((a as { locked?: boolean }).locked, true);
    const b = openBox(date);
    assert.equal(b.exists, true);
    assert.equal((b as { locked?: boolean }).locked, true);
    assert.equal("content" in b, false);
    deleteBoxSafe(date);
  });
});

describe("stats and empty dates", () => {
  it("year stats for 2026 use start_date denominator", () => {
    const stats = getStats(2026);
    assert.equal(stats.year, 2026);
    const denom = daysInclusive(START_DATE, "2026-12-31");
    assert.equal(stats.empty, denom - stats.total);
  });

  it("range stats are scoped", () => {
    const range = getRangeStats("2026-09-01", "2026-09-30");
    assert.equal(range.start_date, "2026-09-01");
    assert.ok(range.total >= 0);
  });

  it("rejects reverse date range", () => {
    assert.throws(
      () => getRangeStats("2026-12-31", "2026-01-01"),
      /DATE_RANGE_INVALID/
    );
  });

  it("next empty dates default to 90 from start window", () => {
    const dates = nextEmptyDates();
    assert.equal(dates.length, NEXT_EMPTY_DEFAULT);
    assert.ok(dates[0]! >= START_DATE);
    for (const d of dates) {
      assert.equal(isValidDate(d), true);
    }
    const five = nextEmptyDates(5);
    assert.equal(five.length, 5);
  });

  it("export includes start_date and boxes array", () => {
    const payload = exportBoxesJson();
    assert.equal(payload.ok, true);
    assert.equal(payload.format, "365box-export-v1");
    assert.equal(payload.start_date, START_DATE);
    assert.equal(payload.timezone, "Asia/Shanghai");
    assert.ok(Array.isArray(payload.boxes));
    assert.equal(payload.count, payload.boxes.length);
  });
});
