<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Expert training mode: training-vs-live matching lives in DB functions (booking_expert_mode_ok + broadcast/claim/assign checks); admin writes go through /api/public/training/* server routes calling service_role-only training_* SQL functions — why: new Supabase edge functions are blocked on this stack and the SQL functions keep each action atomic.
- Guest-first: guests browse every tab; protected actions call `ensureSignedIn()` (src/lib/authGate.ts) which opens login and returns to the same screen — why: login is asked only on Book/Enroll/Apply coupon/Wallet/Orders/Pay.
- Guest public reads (parcel price preview, contest info) go through unauthenticated server functions that return only non-personal data — why: customer RPCs require a session.
- Clean tab first frame renders from device cache (hours/book-now/content in localStorage, images via src/lib/imageStore.ts on native) and re-evaluates open/closed locally in IST — why: no guessed 'Open now' or white flash on app open.
- Clean booking page state lives in `src/lib/cleanBookingDraft.ts`; every service entry (search, Store tab service hits) opens the Clean booking page via that draft, and Checkout back returns to Home where CleanTab restores it — why: no old slot/address pages in the back stack. Address changes use `LocationPickerSheet` as an overlay, never a phase.
- `BookingSummaryScreen` (also exported as `CheckoutScreen`) is the shared checkout layout; future Store/Food/Parcel checkouts reuse it — why: one checkout across services.
