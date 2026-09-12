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
  TARGET_YEAR
} from "./box.js";

describe("date validation", () => {
  it("accepts real calendar days", () => {
    assert.equal(isValidDate("2027-02-28"), true);
    assert.equal(isValidDate(`${TARGET_YEAR}-01-01`), true);
  });

  it("rejects impossible days", () => {
    assert.equal(isValidDate("2027-02-30"), false);
    assert.equal(isValidDate("2027-02-29"), false);
    assert.equal(isValidDate("2027-04-31"), false);
  });
});

describe("create rules", () => {
  const date = `${TARGET_YEAR}-05-20`;

  it("rejects wrong year and invalid day", () => {
    assert.throws(() => createBoxSafe("2028-01-01", "x"), /DATE_YEAR_INVALID/);
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
    const date = `${TARGET_YEAR}-11-11`;
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
  it("year stats and range stats are scoped", () => {
    const stats = getStats();
    assert.equal(stats.year, TARGET_YEAR);
    assert.ok(stats.empty >= 0);
    const range = getRangeStats(`${TARGET_YEAR}-01-01`, `${TARGET_YEAR}-01-31`);
    assert.equal(range.start_date, `${TARGET_YEAR}-01-01`);
    assert.ok(range.total >= 0);
  });

  it("rejects reverse date range", () => {
    assert.throws(
      () => getRangeStats(`${TARGET_YEAR}-12-31`, `${TARGET_YEAR}-01-01`),
      /DATE_RANGE_INVALID/
    );
  });

  it("next empty dates are valid target-year days", () => {
    const dates = nextEmptyDates(5);
    assert.equal(dates.length, 5);
    for (const d of dates) {
      assert.ok(d.startsWith(`${TARGET_YEAR}-`));
      assert.equal(isValidDate(d), true);
    }
  });

  it("export includes format and boxes array", () => {
    const payload = exportBoxesJson();
    assert.equal(payload.ok, true);
    assert.equal(payload.format, "365box-export-v1");
    assert.equal(payload.timezone, "Asia/Shanghai");
    assert.ok(Array.isArray(payload.boxes));
    assert.equal(payload.count, payload.boxes.length);
  });
});
