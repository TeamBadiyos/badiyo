// Bookable slot window: 10 AM – 6 PM start (last slot 6–7 PM).
// Must stay in sync with ops_settings slot_first_start_hour / slot_last_start_hour.
export const BUSINESS_START_HOUR = 10;
export const BUSINESS_END_HOUR = 18;

/** Minimum notice before a same-day slot can start (minutes). */
export const MIN_LEAD_MINUTES = 45;

export type HourSlot = {
  hour: number; // 24h
  label: string; // "9 AM"
  range: string; // "9 AM – 10 AM"
};

function formatHour(h: number): string {
  const suffix = h >= 12 ? "PM" : "AM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${suffix}`;
}

export function getAllHourSlots(): HourSlot[] {
  const slots: HourSlot[] = [];
  for (let h = BUSINESS_START_HOUR; h <= BUSINESS_END_HOUR; h++) {
    slots.push({
      hour: h,
      label: formatHour(h),
      range: `${formatHour(h)} – ${formatHour(h + 1)}`,
    });
  }
  return slots;
}

export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Current date/time in IST (service timezone), independent of the device clock. */
function istNow(): { key: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const hour = parseInt(get("hour"), 10) % 24;
  return {
    key: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: hour * 60 + parseInt(get("minute"), 10),
  };
}

/** Today's date key in IST, e.g. "2026-09-29". */
export function istTodayKey(): string {
  return istNow().key;
}

export type DayOption = {
  key: string; // YYYY-MM-DD (IST)
  weekday: string; // "Mon"
  dayNum: number; // 29
};

/** Next 7 calendar days starting with today, in IST. */
export function getNext7DayOptions(): DayOption[] {
  const base = new Date(`${istTodayKey()}T00:00:00Z`);
  const out: DayOption[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(base.getTime() + i * 86400000);
    out.push({
      key: d.toISOString().slice(0, 10),
      weekday: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
      dayNum: d.getUTCDate(),
    });
  }
  return out;
}

export function isTodayKey(dateKey: string): boolean {
  return dateKey === istTodayKey();
}

/**
 * For today, a slot is bookable only when it starts at least MIN_LEAD_MINUTES
 * from now (IST). e.g. at 6:20 PM the 7 PM slot is too soon, 8 PM is fine.
 */
export function isHourBookable(dateKey: string, hour: number): boolean {
  const now = istNow();
  if (dateKey > now.key) return true;
  if (dateKey < now.key) return false;
  return hour * 60 >= now.minutes + MIN_LEAD_MINUTES;
}
