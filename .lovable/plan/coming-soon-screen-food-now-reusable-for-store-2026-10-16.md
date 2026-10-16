# Coming-soon screen (Food now, reusable for Store)

## What the customer sees
Light, airy screen on white with plenty of space. No search bar, no category row.

1. **Centre illustration**: a soft, hand-drawn style hot Indian veg thali (roti, dal, sabzi, rice, sweet) with 2–3 wisps of steam rising and fading in a gentle loop. Built as a lightweight vector drawing in badiyos green and warm tones, so it loads instantly. Motion stops for phones set to "reduce motion".
2. **Title**: "Something tasty is cooking… 🍳" / "काहीतरी चविष्ट शिजतंय… 🍳"
   **Line**: "Your favourite hotel's food, at home, at the same menu price." / "तुमच्या आवडत्या हॉटेलचं जेवण, घरबसल्या, हॉटेलच्याच दरात."
3. **Thin progress bar** with "%" from Command Center's launch progress for this city. Hidden when no value is set.
4. **"Which hotel should we bring first?"** / "सर्वात आधी कोणतं हॉटेल आणू?" — optional field, placeholder "e.g. Hotel Shreyas". Suggestions from names other customers in the city asked for show as the customer types. Tap a suggestion or press Enter to add it as a chip (max 3, × to remove).
5. **"🔔 Ring me when it's ready"** / "🔔 तयार झाल्यावर मला कळवा":
   - Guests are asked to log in first, then come back to the same screen.
   - On success the bell wiggles, a small confetti burst plays, and "🎉 You're in! We'll ring you first." / "🎉 झालं! सर्वात आधी आम्ही तुम्हाला कळवू." appears.
   - The button changes to "✓ You're on the list".
   - The joined state is remembered on the device. Customers who already joined can still add new hotel names. Those names are saved to their existing request.

## Reusable
One component used for any coming-soon service:
- **Food**: hotel wording, service "food", thali illustration
- **Store**: "Which shop should we bring first?" / "सर्वात आधी कोणतं दुकान आणू?", placeholder "e.g. Laxmi Kirana", service "grocery", with a matching light illustration (a steaming thali swapped for a grocery basket), ready for when Store shows Coming soon.

## Technical details
- New `src/components/ComingSoonService.tsx` taking `service: "food" | "store"`; copy/illustration per service in a small config map (EN/MR).
- Data: `app_launch_progress(_service_key, _city_id)` → `percent`; `app_demand_name_suggestions(_city, _service, _q)` debounced 250 ms; `submit_demand_request(_services:[svc], _city, _area, _lat, _lng, _source:'coming-soon', _wanted_names)`; returned request id stored in localStorage `bdy_demand_<svc>_<city>`; later additions via `app_demand_add_names(_request_id, _names)`. If `submit_demand_request` reports an existing request, newly typed names are added with `app_demand_add_names`.
- Login via `ensureSignedIn()`.
- Animations: CSS keyframes in `src/styles.css` (steam rise, bell wiggle, confetti) using design tokens; `prefers-reduced-motion` disables them.
- `HomeScreen.tsx`: the Food `emptyFallback` renders `<ComingSoonService service="food" …/>` instead of the current block, and the search bar is not shown on this screen. The old `customer_notify_me` button there is removed.
- No database changes.
