import { describe, expect, it } from "bun:test";
import { courierDropShareText, visibleCourierOtps } from "../src/lib/courierOtpModel.ts";

const pickup = { stop_id: "p", stop_type: "pickup", sequence: 1, contact_name: "Sender", status: "pending", visible: true, pickup_otp: "1234", drop_otp: null };
const drop = { stop_id: "d", stop_type: "drop", sequence: 2, contact_name: "Receiver", status: "pending", visible: true, pickup_otp: null, drop_otp: "4821" };
describe("parcel OTP visibility", () => {
  it("keeps pickup visible before pickup completes", () => {
    expect(visibleCourierOtps({ status: "DRIVER_ASSIGNED", pickup_otp: "1234", stops: [pickup] })).toEqual([pickup]);
  });
  it("never shows a cached pickup after pickup completes", () => {
    expect(visibleCourierOtps({ status: "DRIVER_ASSIGNED", pickup_otp: "1234", stops: [pickup] }, "PICKED_UP")).toEqual([]);
  });
  it("shows each undelivered receiver and hides the completed drop", () => {
    const next = { ...drop, stop_id: "d2", contact_name: "Second receiver", drop_otp: "5678" };
    expect(visibleCourierOtps({ status: "IN_TRANSIT", pickup_otp: null, stops: [{ ...drop, status: "completed" }, next] })).toEqual([next]);
  });
  it("hides every code on terminal orders", () => {
    for (const status of ["DELIVERED", "COMPLETED", "CANCELLED", "FAILED", "EXPIRED", "FAILED_DELIVERY"]) {
      expect(visibleCourierOtps({ status, pickup_otp: null, stops: [drop] })).toEqual([]);
    }
  });
  it("shares the current receiver code rather than a fixed example", () => {
    expect(courierDropShareText("5678")).toContain("Delivery OTP: 5678.");
    expect(courierDropShareText("4821")).toContain("Delivery OTP: 4821.");
  });
});