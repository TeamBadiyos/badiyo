export type CourierOtpStop = {
  stop_id: string;
  stop_type: "pickup" | "drop" | "return";
  sequence: number;
  contact_name: string | null;
  status: string;
  visible: boolean;
  pickup_otp: string | null;
  drop_otp: string | null;
};

export type CourierOtps = { status: string; pickup_otp: string | null; stops: CourierOtpStop[] };
export const courierOtpActive = (status: string) =>
  ["REQUESTED", "SEARCHING", "DRIVER_ASSIGNED", "ARRIVED_PICKUP", "PICKED_UP", "IN_TRANSIT"].includes(status);

export function visibleCourierOtps(data: CourierOtps | undefined, status?: string) {
  if (!data || !courierOtpActive(status ?? data.status)) return [];
  // Do not expose a cached pickup after the parcel has moved to delivery.
  const inTransit = ["PICKED_UP", "IN_TRANSIT"].includes(status ?? data.status);
  return data.stops.filter((s) => s.visible && !["completed", "failed", "cancelled"].includes(s.status) && (!inTransit || s.stop_type !== "pickup"));
}

export const courierDropShareText = (code: string) =>
  `badiyos parcel aa raha hai. Delivery OTP: ${code}. Rider ko yeh code batayein.`;