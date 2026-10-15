export const LICENSE_TIME_ZONE = "Asia/Tokyo";

type ClockParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

export function getZonedParts(instant: Date, timeZone = LICENSE_TIME_ZONE): ClockParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const mapped: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") mapped[part.type] = part.value;
  }
  let hour = Number(mapped.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(mapped.year),
    month: Number(mapped.month),
    day: Number(mapped.day),
    hour,
    minute: Number(mapped.minute),
    second: Number(mapped.second),
    millisecond: instant.getUTCMilliseconds(),
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function offsetMs(instant: Date, timeZone: string): number {
  const parts = getZonedParts(instant, timeZone);
  const wallClockAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond
  );
  return wallClockAsUtc - instant.getTime();
}

function zonedTimeToUtc(parts: ClockParts, timeZone: string): Date {
  const wallClockAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond
  );
  const firstUtc = wallClockAsUtc - offsetMs(new Date(wallClockAsUtc), timeZone);
  return new Date(wallClockAsUtc - offsetMs(new Date(firstUtc), timeZone));
}

export function addCalendarMonths(
  from: Date,
  months: number,
  timeZone = LICENSE_TIME_ZONE
): Date {
  if (!Number.isInteger(months) || months < 1 || months > 24) {
    throw new Error("months must be an integer from 1 to 24");
  }
  const parts = getZonedParts(from, timeZone);
  const monthIndex = parts.month - 1 + months;
  const year = parts.year + Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  return zonedTimeToUtc(
    {
      ...parts,
      year,
      month,
      day: Math.min(parts.day, daysInMonth(year, month)),
    },
    timeZone
  );
}
