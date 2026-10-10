// Bookable slot window: 10:00 AM – 6:00 PM start, every 30 minutes.
// Must stay in sync with ops_settings slot_first_start_hour / slot_last_start_hour / slot_step_minutes.
export const BUSINESS_START_HOUR = 10;
export const BUSINESS_END_HOUR = 18;
export const SLOT_STEP_MINUTES = 30;
/** Each slot's displayed window length (minutes). */
const SLOT_WINDOW_MINUTES = 60;

/** Minimum notice before a same-day slot can start (minutes). */
export const MIN_LEAD_MINUTES = 45;

export type HourSlot = {
  /** Minutes since midnight — unique slot key. */
  mins: number;
  hour: number; // 24h
  minute: number;
  label: string; // "10:30 AM"
  range: string; // "10:30 AM – 11:30 AM"
};

export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function getAllHourSlots(): HourSlot[] {
  const slots: HourSlot[] = [];
  for (
    let t = BUSINESS_START_HOUR * 60;
    t <= BUSINESS_END_HOUR * 60;
    t += SLOT_STEP_MINUTES
  ) {
    slots.push({
      mins: t,
      hour: Math.floor(t / 60),
      minute: t % 60,
      label: formatMinutes(t),
      range: `${formatMinutes(t)} – ${formatMinutes(t + SLOT_WINDOW_MINUTES)}`,
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
 * from now (IST). `slotMins` = minutes since midnight.
 */
export function isHourBookable(dateKey: string, slotMins: number): boolean {
  const now = istNow();
  if (dateKey > now.key) return true;
  if (dateKey < now.key) return false;
  return slotMins >= now.minutes + MIN_LEAD_MINUTES;
}
