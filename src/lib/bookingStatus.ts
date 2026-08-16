/**
 * Booking statuses that mean "there is a live job to track". Kept in a tiny
 * standalone module so the router shell can read it without pulling the whole
 * MyBookingsScreen chunk into the main bundle.
 */
export const ACTIVE_TRACKING_STATUSES = [
  "confirmed",
  "accepted",
  "expert_assigned",
  "in_progress",
];
