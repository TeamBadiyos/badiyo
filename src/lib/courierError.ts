/**
 * Turns any parcel-flow failure into a short sentence a customer can act on.
 * Raw zod payloads, Postgres errors and stack traces never reach the UI.
 */
export function courierErrorMessage(error: unknown, fallback: string): string {
  const raw =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "";
  const message = raw.trim();
  if (!message) return fallback;
  if (/DISTANCE_MISMATCH/i.test(message)) return "Route changed, please refresh the price.";
  if (/SERVICE_CLOSED/i.test(message)) return "Parcel service is closed right now.";
  if (/outside our delivery area|not serviceable|OUT_OF_ZONE/i.test(message)) {
    return "One of the stops is outside our delivery area right now.";
  }
  if (/Choose either multiple drops or multiple pickups/i.test(message)) {
    return "Choose either multiple drops or multiple pickups.";
  }
  if (/Maximum \d+ (pickups|drops) allowed/i.test(message)) {
    return message.match(/Maximum \d+ (pickups|drops) allowed/i)![0] + ".";
  }

  // Technical payloads: zod issue arrays, JSON blobs, SQL / stack text.
  const technical =
    message.startsWith("{") ||
    message.startsWith("[") ||
    /"code"\s*:|invalid_|too_big|too_small|\bundefined\b|\bnull\b|SQLSTATE|at .*\(.*:\d+:\d+\)/i.test(
      message,
    );
  if (technical) return fallback;

  if (/failed to fetch|network|offline|timeout/i.test(message)) {
    return "Internet connection looks weak. Please try again.";
  }
  if (/unauthorized|jwt|not authenticated|401/i.test(message)) {
    return "Please sign in again to continue.";
  }
  if (message.length > 160) return fallback;
  return message;
}
