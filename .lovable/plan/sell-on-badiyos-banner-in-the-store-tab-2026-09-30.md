# "Sell on badiyos" banner in the Store tab

A small card at the very top of the Store tab, above the live store list — shown to
everyone who can see the Store tab, including when no stores are listed.

## What the customer sees

```text
+--------------------------------------------------+
| [icon] Apni dukaan badiyos pe laayein            |
|        Latur ke customers tak apna saman bechiye.|
|        [ Call ]  [ WhatsApp ]                    |
+--------------------------------------------------+
Kirana & Grocery
(then the store rows as today)
```

- Compact card: store (lucide) icon, title, one line, two small buttons.
- Call → `tel:+918007444464` (secondary style: white bg, border).
- WhatsApp → `https://wa.me/918007444464?text=...` with the prefilled message
  "Namaste, mujhe apni dukaan badiyos pe listing karni hai." (primary green button).
- Marathi text when app language is Marathi:
  - Title: "तुमचं दुकान badiyos वर आणा"
  - Line: "लातूरच्या ग्राहकांपर्यंत तुमचा माल विका."
  - Button labels via the normal i18n files.
- Design: bg = green #00B97A at ~8% (`bg-primary/5`), radius 18, 16px padding,
  Nunito Sans (already the app font), semantic tokens only.
- Store rows start right below the card. Also shown above the
  "No stores in your area yet" empty state.
- Only the main Store tab list gets the card — the "See all [category]" full-screen
  list stays as-is.

## Technical details

- `src/lib/store.ts`: add one constant `SELL_ON_BADIYOS = { phone: "+918007444464", whatsappText: "Namaste, mujhe apni dukaan badiyos pe listing karni hai." }` — the single place to change the number later. Helpers `sellCallHref` and `sellWhatsAppHref` build the `tel:` / `wa.me` links.
- New `src/components/store/SellOnBadiyosCard.tsx`: the card component (Store icon, i18n text, two anchor buttons).
- `StoreListView.tsx`: render `<SellOnBadiyosCard />` above the groups list and above the empty state (both loading-done branches).
- i18n: add `store.sell.title`, `store.sell.line`, `store.sell.call`, `store.sell.whatsapp` to `src/i18n/en.ts` and `src/i18n/mr.ts` (Marathi title/line as above; English labels "Call" / "WhatsApp").
- No database changes.
- Checks: typecheck, build log clean, and a phone-size preview check of the Store tab (card above the list and above the empty state).
