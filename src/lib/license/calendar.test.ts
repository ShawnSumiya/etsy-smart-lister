import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addCalendarMonths, getZonedParts, LICENSE_TIME_ZONE } from "./calendar";

function clock(instant: Date, timeZone = LICENSE_TIME_ZONE): string {
  const parts = getZonedParts(instant, timeZone);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return [
    `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}.${pad(parts.millisecond, 3)}`,
  ].join(" ");
}

describe("calendar month licenses", () => {
  test("expires at the same clock time on the same day next month in Japan", () => {
    const start = new Date("2026-10-15T06:49:26.299Z");
    const expires = addCalendarMonths(start, 1);

    assert.equal(clock(start), "2026-10-15 15:49:26.299");
    assert.equal(clock(expires), "2026-11-15 15:49:26.299");
    assert.equal(expires.toISOString(), "2026-11-15T06:49:26.299Z");
  });

  test("uses the last day when the next month does not have the same date", () => {
    const januaryEnd = new Date("2026-01-31T06:15:00.000Z");
    const marchEnd = new Date("2026-03-31T14:45:30.000Z");
    const decemberEnd = new Date("2026-12-31T00:00:00.000Z");

    assert.equal(clock(addCalendarMonths(januaryEnd, 1)), "2026-02-28 15:15:00.000");
    assert.equal(clock(addCalendarMonths(marchEnd, 1)), "2026-04-30 23:45:30.000");
    assert.equal(clock(addCalendarMonths(decemberEnd, 1)), "2027-01-31 09:00:00.000");
  });

  test("keeps February 29 in a leap year", () => {
    const start = new Date("2024-01-31T01:20:00.000Z");
    assert.equal(clock(addCalendarMonths(start, 1)), "2024-02-29 10:20:00.000");
  });

  test("uses the Japan calendar when it differs from UTC", () => {
    const start = new Date("2026-03-30T16:00:00.000Z");
    const expires = addCalendarMonths(start, 1);

    assert.equal(clock(start, "Asia/Tokyo"), "2026-03-31 01:00:00.000");
    assert.equal(clock(start, "UTC"), "2026-03-30 16:00:00.000");
    assert.equal(clock(expires, "Asia/Tokyo"), "2026-04-30 01:00:00.000");
    assert.equal(expires.toISOString(), "2026-04-29T16:00:00.000Z");
  });

  test("uses February 29 for a Japan date that is still January 31 in UTC during a leap year", () => {
    const start = new Date("2024-01-30T16:00:00.000Z");
    const expires = addCalendarMonths(start, 1);

    assert.equal(clock(start, "UTC"), "2024-01-30 16:00:00.000");
    assert.equal(clock(start, "Asia/Tokyo"), "2024-01-31 01:00:00.000");
    assert.equal(clock(expires, "Asia/Tokyo"), "2024-02-29 01:00:00.000");
    assert.equal(expires.toISOString(), "2024-02-28T16:00:00.000Z");
  });
});
