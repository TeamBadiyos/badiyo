// Keeps the open Clean booking page (service, option, day, time) alive while
// Checkout is on screen, so back from Checkout reopens the same selection.
export type CleanBookingDraft = { auto: boolean; optionId: string | null; day: string | null; slotMins: number | null };

let current: CleanBookingDraft | null = null;

export const getCleanDraft = () => current;
export const setCleanDraft = (d: CleanBookingDraft | null) => {
  current = d;
};
export const hasCleanDraft = () => current != null;
