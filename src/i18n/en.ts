/**
 * English dictionary — the source of truth for all keys.
 * Digits are always Latin (0-9); never localise numerals.
 */
export const en = {
  // ── Common ───────────────────────────────────────────────
  "common.continue": "Continue",
  "common.back": "Back",
  "common.close": "Close",
  "common.cancel": "Cancel",
  "common.done": "Done",
  "common.edit": "Edit",
  "common.total": "Total",
  "common.address": "Address",
  "common.when": "When",
  "common.rupees": "Rs {amount}",
  "common.profile": "Profile",
  "common.loading": "Loading…",

  // ── Bottom navigation ────────────────────────────────────
  "nav.home": "Home",
  "nav.orders": "Orders",
  "nav.rewards": "Rewards",

  // ── Home ─────────────────────────────────────────────────
  "home.searchPlaceholder": "Search for cleaning services…",
  "home.voiceSearch": "Voice search",
  "home.seeAll": "See all",
  "home.oneExpert": "One Expert who can do it all",
  "home.tile.houseCleaning": "House Cleaning",
  "home.tile.dusting": "Dusting & Wiping",
  "home.tile.dishes": "Cleaning Dishes",
  "home.bookNow": "Book Now",
  "home.bookSegment": "Book {segment}",
  "home.comingSoon": "{segment} is coming soon",
  "home.comingSoonSub": "We're getting this section ready for you.",
  "home.scheduleHint": "Need it later? Schedule a time inside booking",
  "home.servicesBar": "Services",
  "home.tabAll": "All",

  // ── Slot selection ───────────────────────────────────────
  "slot.bookNow": "Book Now",
  "slot.scheduleLater": "Schedule Later",
  "slot.arriveTitle": "Expert will arrive shortly",
  "slot.arriveSub": "Within 30 – 45 minutes at your location",
  "slot.chooseDay": "Choose a day",
  "slot.chooseTime": "Choose a time",
  "slot.noSlots": "No time slots left for today. Please pick another day.",

  // ── Address ──────────────────────────────────────────────
  "address.title": "Select Address",
  "address.loading": "Loading addresses…",
  "address.emptyTitle": "No saved addresses yet",
  "address.emptySub": "Add one to continue with your booking",
  "address.addNew": "Add New Address",
  "address.addNewPlus": "+ Add New Address",
  "address.fallbackLabel": "Address",

  // ── Booking summary ──────────────────────────────────────
  "summary.title": "Booking Summary",
  "summary.priceDetails": "Price details",
  "summary.servicePrice": "Service price",
  "summary.proceedToPay": "Proceed to Pay",
  "summary.now": "Now",
  "summary.nowSub": "Expert arriving in 30 – 45 mins",
  "summary.between": "Between {range}",

  // ── Payment ──────────────────────────────────────────────
  "payment.title": "Payment",
  "payment.opening": "Opening secure checkout…",
  "payment.confirmed": "Booking Confirmed",
  "payment.success": "Your payment was successful.",
  "payment.paymentId": "Payment ID: {id}",
  "payment.bookingId": "Booking ID: {id}",
  "payment.service": "Service",
  "payment.totalPaid": "Total paid",
  "payment.failed": "Payment Failed",
  "payment.failedSub": "Your payment could not be completed.",
  "payment.tryAgain": "Try Again",
  "payment.backToSummary": "Back to Summary",
  "payment.nowArriving": "Now · arriving in 30–45 mins",

  // ── Tracking: stages ─────────────────────────────────────
  "stage.placed": "Placed",
  "stage.confirming": "Confirming",
  "stage.assigned": "Assigned",
  "stage.started": "Started",
  "stage.completed": "Completed",

  // ── Tracking: searching ──────────────────────────────────
  "track.finding": "Finding your expert…",
  "track.bookingNo": "Booking #{id}",
  "track.searchingTitle": "Searching for the nearest available expert",
  "track.searchingSub": "This usually takes a minute",
  "track.summary": "Booking Summary",
  "track.asap": "As soon as possible",

  // ── Tracking: expert assigned ────────────────────────────
  "track.assigning": "Expert being assigned…",
  "track.assignedTitle": "Expert assigned",
  "track.yourExpert": "Your expert",
  "track.verifiedExpert": "Verified Expert",
  "track.callExpert": "Call expert",
  "track.startCode": "Start Code",
  "track.preparingCode": "Preparing code…",
  "track.showToExpert": "Show this to your expert once they arrive.",
  "track.openFullScreen": "Open full-screen",
  "track.findingExpert": "Finding your expert",
  "track.assigningExpert": "Assigning your expert",
  "track.notifyingNearby": "We're notifying nearby experts. This usually takes just a moment.",
  "track.pickingBest": "Our team has accepted your booking and is picking the best expert for you.",

  // ── Tracking: OTP ────────────────────────────────────────
  "otp.startTitle": "Share this code with your expert to start",
  "otp.endTitle": "Share this code to confirm completion",
  "otp.startSub": "Read this 4-digit code aloud to your expert. They'll enter it to begin the service.",
  "otp.endSub": "Read this 4-digit code aloud to your expert. They'll enter it to mark the service complete.",
  "otp.generating": "Generating code…",
  "otp.doNotShare": "Do not share this code with anyone except your expert",
  "otp.waiting": "Waiting for your expert to enter the code…",

  // ── Tracking: in progress ────────────────────────────────
  "progress.title": "Your home is being cleaned",
  "progress.sub": "Sit back and relax — we'll notify you when it's done.",
  "progress.timeRemaining": "Time remaining",
  "progress.waitingStart": "Waiting for service to start…",
  "progress.serviceLocation": "Service location",
  "progress.liveSoon": "Live expert tracking is coming soon.",
  "progress.extendTime": "Extend time",
  "progress.showEndCode": "Show completion code",
  "progress.endCodeHint": "Your expert will ask for the completion code to end the service.",
  "progress.fiveLeft": "5 minutes left",
  "progress.timesUp": "Time's up",
  "progress.extendNow": "Extend now to keep your expert on the job.",
  "progress.needMore": "Need more time? Extend before your service wraps up.",
  "progress.dismiss": "Dismiss",
  "progress.extendTitle": "Extend service time",
  "progress.extendSub": "Add more time to your ongoing booking.",
  "progress.loadingOptions": "Loading options…",
  "progress.addsMinutes": "Adds {minutes} minutes to your timer",

  // ── Tracking: cancel ─────────────────────────────────────
  "cancel.confirmFree": "Cancel this booking?",
  "cancel.confirmFee": "Cancel with cancellation fee?",
  "cancel.fullRefund": "You'll receive a full refund.",
  "cancel.yes": "Yes, cancel",
  "cancel.cancelled": "Booking cancelled.",

  // ── Rate & review ────────────────────────────────────────
  "review.title": "How was your service?",
  "review.sub": "Your feedback helps us improve.",
  "review.placeholder": "Share your experience (optional)",
  "review.submit": "Submit Review",
  "review.submitting": "Submitting…",

  // ── Settings / language ──────────────────────────────────
  "settings.title": "Settings",
  "settings.language": "Language",
  "settings.notifications": "Notification Preferences",
  "settings.devices": "Active Devices",
  "settings.privacy": "Privacy Policy",
  "language.title": "Language",
  "language.subtitle": "Choose the language you'd like to use in badiyos.",
  "language.english": "English",
  "language.marathi": "मराठी",
  "language.saved": "Language updated",
  "language.saveFailed": "Couldn't save your language. Please try again.",

  // ── Not serviceable / waitlist ───────────────────────────
  "notServiceable.title": "Service Area",
  "notServiceable.heading": "We're not in your area yet",
  "notServiceable.sub": "badiyos hasn't launched here yet — but we're expanding fast.",
  "notServiceable.subSegment": "{segment} hasn't launched in your area yet — but we're expanding fast.",
  "notServiceable.join": "Join Waitlist",
  "notServiceable.joining": "Adding you…",
  "notServiceable.joinFailed": "Couldn't add you to the waitlist. Please try again.",
  "notServiceable.onTheList": "You're on the list!",
  "notServiceable.confirmation": "We'll notify you the moment we launch in your area!",
  "notServiceable.changeAddress": "Try another address",

  // ── Legal ────────────────────────────────────────────────
  "legal.section": "Legal",
  "legal.privacy": "Privacy Policy",
  "legal.privacyDesc": "How we handle your data",
  "legal.terms": "Terms & Conditions",
  "legal.termsDesc": "Rules for using badiyos",
  "legal.refund": "Refund & Cancellation Policy",
  "legal.refundDesc": "Cancellations, fees and refunds",
  "legal.errorTitle": "Couldn't load this page",
  "legal.errorBody": "Check your internet connection and try again.",
  "legal.retry": "Retry",
  "legal.effective": "Effective",
  "legal.updated": "Last updated",
  "legal.agreePrefix": "By continuing, you agree to badiyos' ",
  "legal.agreeAnd": " and ",
  "legal.agreeSuffix": ".",
  "legal.deleteNote": "Refunds for any cancelled bookings follow our Refund & Cancellation Policy.",
} as const;

export type TranslationKey = keyof typeof en;
