# Fix: parcel tracking map stuck on "Connecting…"

## What is happening

After the road-route change, the tracking map only draws a route when a **live rider location** is available. Until a rider shares location (or if the location is a few minutes old), the map has no line at all and the badge stays on "Connecting…" forever — so the customer sees an empty map and thinks tracking is broken.

Earlier there was always a (straight) line between pickup and drop, so something was always visible.

## What will change

1. **Always show the parcel's road route.** As soon as the screen opens, draw the actual road route from pickup to drop in light green. This does not need a rider and works for every parcel.
2. **Rider route on top.** Once the rider's live location arrives, draw the bright green road route from the rider to the next stop (pickup before pickup, drop after pickup) over the base route, and fit the map to it.
3. **If the route service fails**, fall back to a soft dashed straight line instead of showing nothing, so the two points are always visually connected.
4. **Honest status text instead of endless "Connecting…":**
   - no rider assigned yet → "Finding a rider for your parcel"
   - rider assigned, no location yet → "Rider assigned — waiting for live location"
   - location older than a few minutes → "Live" pill turns grey with "Last seen X mins ago" (marker still shown at the last known spot, slightly faded) instead of disappearing
   - fresh location → "Live"
5. **Stale rider marker stays visible** (currently it is removed entirely when stale, which empties the map).
6. Same treatment for the home-service tracking map (expert → customer address): base route always drawn, dashed fallback, clearer waiting text.

## Technical notes

- `src/components/courier/CourierLiveMap.tsx`: add a second `useQuery` for the pickup→drop route (enabled whenever both coords exist, long `staleTime`), keep the rider→target query; two polyline refs (base + active); dashed `Polyline` fallback with `icons` dash symbol when the route query returns `null`; relax the `!rider.stale` condition so the marker persists with reduced opacity; status text derived from `status` + `rider.available` + freshness.
- `src/components/tracking/ServiceLocationMap.tsx`: same base-route + dashed-fallback + marker-persistence changes for the expert marker.
- No server, schema, or API changes — `fetchTrackingRoadRoute` and its cache stay as they are.
- Verify with `bunx tsgo --noEmit` and a 412×915 Playwright pass on the parcel tracking screen.
