import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import { isHourBookable } from "../src/lib/hourSlots.ts";

afterEach(() => setSystemTime());

describe("pre-payment scheduled slot guard", () => {
  it("rejects the reported October 17 10 AM slot at 06:45 UTC", () => {
    setSystemTime(new Date("2026-10-17T06:45:00Z"));
    expect(isHourBookable("2026-10-17", 600)).toBe(false);
  });
  it("requires 45 minutes of same-day notice in India time", () => {
    setSystemTime(new Date("2026-10-17T04:30:00Z"));
    expect(isHourBookable("2026-10-17", 630)).toBe(false);
    expect(isHourBookable("2026-10-17", 645)).toBe(true);
  });
  it("allows tomorrow and rejects yesterday regardless of device timezone", () => {
    setSystemTime(new Date("2026-10-17T06:45:00Z"));
    expect(isHourBookable("2026-10-18", 600)).toBe(true);
    expect(isHourBookable("2026-10-16", 600)).toBe(false);
  });
});