# Fix empty status on parcel event log entries

The event log needs a status on every entry. Four functions from the latest phase write log entries with an empty status, so those steps fail. The first one hit was marking a return charge as paid.

## Functions found (searched every function definition)
1. `courier_mark_charge_paid`: "return charge paid" entry.
2. `staff_courier_waive_charge`: "return charge waived" entry.
3. `courier_recompute_order_progress`: "stop cancelled" entry.
4. `courier_sweeper_tick`: "return payment escalated" entry.

All other functions from Phases 1B to 1D already write the order's current status: `courier_create_order`, `courier_rider_arrive_stop`, `courier_verify_stop_otp`, `courier_update_stop_contact`, `courier_rider_fail_stop`, `courier_settle_order` and the legacy wrappers.

## Fix (one migration)
- In each of the four functions, read the order's current status and use it as both the "from" and "to" status of the log entry.
- The log details (the event data) and everything else in those functions stay exactly as they are.

## Check
- Re-run the same search; it must return no functions.
