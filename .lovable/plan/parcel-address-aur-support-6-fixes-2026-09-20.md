# Parcel, address aur support — 6 fixes

## 1. Weight limit vehicle ke hisaab se

- Selected vehicle ka max weight hi upper limit hoga (Bike = 20 kg to 20 se zyada type hi nahi hoga).
- Field ke saath hint: "Max 20.00 kg for Bike". Zyada daalne par turant seedha message: "Bike 20 kg tak hi le sakti hai."
- Vehicle badalne par agar weight nayi limit se zyada hai to apne aap limit tak set ho jaayega.
- Command center me kisi vehicle ka max weight badla to app me bina code change ke wahi limit lagegi.
- Server par bhi wahi check lagega, taaki koi bypass na kar sake.

## 2. Error code ki jagah saaf message

- Ab neeche technical text (jaise `{"code":"too_big"...}`) kabhi nahi dikhega.
- Har case ka apna simple message, English aur Marathi dono me: weight limit se zyada, weight 0, pickup/drop missing, area serviceable nahi, price abhi nahi mil paa raha, internet issue, server busy.
- Jo message pehchana na jaye uske liye ek friendly default: "Abhi price nahi mil paaya. Thodi der me dobara koshish karein."

## 3. Courier zones (serviceable area)

- Ek zone mapping banegi: courier ke liye kaun se zone chalu hain (multiple zones select ho sakte hain). Iska screen aap command center me banwaayenge; yahan wahi mapping padhi aur enforce hogi.
- Parcel flow me pickup aur drop dono zone ke andar hone chahiye. Bahar hua to uss stop par saaf batayenge: "Ye jagah abhi delivery area ke bahar hai" aur aage nahi badhne denge.
- Map se nayi jagah chunte waqt bhi pin drop hote hi wahi check dikhega.
- Price aur order banane se pehle server bhi dobara check karega — client-side bypass se order nahi banega.

## 4. Address list ke 3 dots — proper overlay

- Screenshot wali problem: menu aadha card ke neeche chala jaata hai aur Delete chhup jaata hai.
- Menu ab ek proper floating overlay hoga: card ke upar, dono options (Edit, Delete) poore dikhenge, list ke kinare par ho to apne aap upar/side adjust hoga.
- Bahar tap ya back press par band; ek waqt me ek hi menu khulega.

## 5. Booking address bhi serviceable hona chahiye

- Maid/home-service booking ki address screen par har saved address ka serviceable check hoga.
- Zone ke bahar wale address greyed out honge, "Not serviceable" tag ke saath, aur select hi nahi honge (Continue disabled).
- Map se naya address add karte waqt bahar ka pin select nahi hoga.
- Booking banate waqt server par bhi last check, taaki bahar ka address kabhi pass na ho.

## 6. Support ticket — WhatsApp jaisi chat

- Poori baat ek hi chat me, time ke hisaab se upar se neeche: customer ke message dayein, badiyos Support ke baayein.
- Staff ka reply aur resolution note ab upar ke box me nahi, chat me apni sahi jagah par aayega.
- Din ka divider (Today / 20 Sept), har message par time, khulte hi neeche latest message par scroll.
- Upar sirf chhota sa ticket status (number, category, status) rahega.
- Resolved ticket par bhi reply bhej sakte hain (pehle jaisa reopen behaviour waisa hi rahega).

## Saath me tech check

Parcel + address + support flow ke chhote failure bhi theek karenge: quote/payment ke beech ka error handling, missing coordinates, offline/slow network par retry, aur double-tap se do order ban jaane wali situation. Type check aur production build dono pass karke hi finish karunga.

## Technical notes

- Weight: `courier_vehicle_types.max_weight_kg` se dynamic `max` + clamp in `CourierBookingScreen.tsx`; `src/lib/courier.functions.ts` me `weight_kg` validation vehicle row se (hard cap 500 rehne dega) aur zod issues ko friendly message me map karke throw.
- Error mapping: ek chhota `courierError(err)` helper (`src/lib/courier.functions.ts` errors + zod issue codes → i18n keys), naye keys `src/i18n/en.ts` / `mr.ts` me.
- Zones: nayi table `courier_zones (zone_id, is_active)` + grants + RLS (public read of active rows, staff write) — command center wahi rows likhega. App: `checkServiceability` ko courier ke liye zone-set filter ke saath use karenge; server par `courier_quote_internal` / order-create path me pickup+drop dono ka zone check.
- Address menu: inline absolute div ki jagah shadcn `DropdownMenu` (portal + collision handling) `AddressSelectionScreen.tsx` me.
- Booking address: `AddressSelectionScreen` me per-address serviceability (segment ke hisaab se, ek hi batch call), disabled state + tag; `AddAddressMapScreen` me confirm se pehle check.
- Support: `SupportTicketDetailScreen.tsx` me merged timeline (ticket.message + support_ticket_messages + resolution note), day separators, auto-scroll; meta card trim.
- Kisi pricing, GST, coupon, payment, dispatch ya OTP rule me koi change nahi.
