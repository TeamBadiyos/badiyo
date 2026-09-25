# Business order batching engine (backend only)

This groups a business's pending orders into multi-drop courier trips and prices each trip from the business's plan. It then takes the fare from the delivery wallet and sends the trip to riders. Existing courier booking, store orders and customer flows stay untouched.

## How it works

```text
pending orders --(manual / qty / slot trigger)--> group + chunk --> batch "planning"
      --> wake route --> plan stop order + road distance --> finalize:
          fare -> wallet check -> courier order (1 pickup, N drops) -> debit -> find rider
```

1. **Batches:** a new batch record holds the business, pickup point, zone, what triggered it (manual / qty / slot), status (planning / awaiting balance / dispatched / failed / completed), fail reason, distance and its source, a fare snapshot, total, and the linked courier order. The owning business and ops staff can see it. Each business order gets a link to its batch.
2. **One grouping rule** is used by every trigger:
   - Take pending orders and group them by pickup point and by the receiver's zone. The zone uses the same lookup as courier serviceability.
   - Orders for the same receiver become one drop: invoice numbers are listed together and packets are added up.
   - Each group is split into trips of at most "max drops per batch".
   - Those orders become "batched", so no other trigger can pick them again. Row locks with skip-locked make sure the first trigger wins.
3. **Triggers:** nothing happens unless the business has both plans assigned (reply "NO_PLAN") and the courier service is open. When it's closed, orders simply stay pending.
   - **Manual:** a "dispatch now" action for the business (only if manual is on), plus a staff version that needs a reason.
   - **Qty:** after every new business order, if a group reaches the threshold of distinct drops, that group goes.
   - **Slots:** at each slot time (India time), all pending groups go. The last slot run is saved per business so a slot never runs twice.
4. **Distance on the server:** a new background endpoint puts the stops in order (pickup first) and gets the road distance with the same Google road-route code courier booking uses. If Google fails, it uses straight line x 1.3, marked "fallback". Then it finalizes the batch.
5. **Finalize (one step, safe to repeat):**
   - Fare = greatest(min fare, base + extra km x per km) + extra drop fee x (drops - 1), plus GST.
   - If the wallet is short or negative, the batch waits as "awaiting balance" and the owner gets a push: "Low wallet balance, top up to dispatch N orders". It's retried automatically every tick.
   - If the owner has never signed in, the batch fails with OWNER_NOT_SIGNED_IN and its orders go back to pending.
   - Otherwise it creates the courier order (source "business", paid, commission from the plan), creates the stops and parcels, links each business order, debits the wallet ('batch:' + order id), and starts rider search.
   - Rider pay uses the existing settlement unchanged.

## How scheduling and wake-up work

- **Today's scheduler:** the existing "courier-sweeper" background job runs every 30 seconds and calls `courier_sweeper_tick()`.
- **Slots and waiting batches:** the new `business_slot_tick()` is added to that same job rather than creating another one. It runs slots, retries "awaiting balance" batches, and re-wakes any batch stuck in "planning".
- **Waking the distance endpoint:** this copies the admin alert processor. When batches are created, the database immediately sends a background web call to `https://user.badiyos.com/api/public/business/process-batches` with the courier job secret in a header. There's a 15-second guard so it doesn't send repeat calls. The endpoint checks the secret with `courier_verify_job_secret` before doing anything.

## Technical details

- **Migration:**
  - `business_batches` (GRANTs, RLS select for owning merchant with manage_delivery or ops; touch trigger)
  - `business_orders.batch_id`
  - `courier_orders.business_merchant_id`
  - `business_dispatch_state(merchant_id, last_slot_date, last_slot_time)`
  - `business_batch_wake_state` (single-row throttle)
- **Functions:**
  - `business_group_and_batch(_merchant_id, _trigger, _group_filter)` (internal)
  - `business_dispatch_now`, `staff_business_dispatch_now`
  - AFTER INSERT trigger on `business_orders` for the qty check
  - `business_slot_tick`, `business_batches_wake`
  - `business_claim_planning_batches` (service only, returns stops)
  - `business_finalize_batch`
  - `courier_create_business_order` (internal; sets `app.courier_skip_default_stops`)
- **Changed:** `courier_sweeper_tick` only gets `perform business_slot_tick()`, wrapped so errors can't break it. Nothing else is changed: courier_create_order, courier_quote_internal and courier_settle_order are left alone.
- **Server route** `src/routes/api/public/business/process-batches.ts`:
  - checks the secret header
  - uses supabaseAdmin to claim batches
  - calls `courier_plan_stops`
  - gets the multi-point route distance, reusing the shared routing helper moved into a `courierRoute.server.ts` module that the existing courier code also imports, so its behaviour is unchanged
  - calls `business_finalize_batch`
- **Before writing the SQL, I'll check the live schema:** courier_orders' required columns, how `service_effective_state` returns `can_order`, `get_gst_percent`, and the courier_orders guard triggers. That way the new insert passes the existing checks.
- **Not in this phase:** rider skill, return charges from the wallet, status sync back to business orders, and the business OTP view.
