# Admin WhatsApp alert — baaki kaam poora karna

Alert system ka dhaancha ban chuka hai aur abhi **off** hai. Ab sirf finishing steps bache hain: verify, secrets, test, aur phir on karna.

## 1. Code verify

- Alert worker file ka type fix verify karna (typecheck + production build).
- Koi error mile to wahin theek karna. App ke kisi aur hisse ko chhua nahi jaayega.

## 2. Secrets (aapse chahiye)

Teen me se do values aapki taraf se chahiye — secure form me maangunga, chat me paste mat kijiye:

- **ADMIN_ALERT_PHONES** — aapka WhatsApp number (ek se zyada ho to comma se alag, 10-digit).
- **AISENSY_ADMIN_ALERT_CAMPAIGN** — AiSensy me approved admin alert campaign ka exact naam (4 variables wala: Order, Customer, Amount, Time).

Route ka shared secret database me already random bana hua hai — usse bhi worker ke liye set kar dunga. AiSensy ki API key project me pehle se hai.

## 3. Tests (result report karunga)

- Idempotency: ek hi order do baar → sirf ek message.
- Sirf paid par: unpaid/abandoned order → kuch nahi; sirf address/status update par trigger chalta hi nahi.
- Toggle off → kuch bhi queue me nahi jaata.
- AiSensy fail (galat campaign) → order/booking normal bane, row failed + log entry, retry schedule.
- Load: ek minute me 25 orders → 20 jaate hain, 5 pending rehte hain aur agle run me bina duplicate ke chale jaate hain.
- Security: bina secret aur galat secret par 401, queue untouched.
- Access: customer / rider / logged-out ko queue aur log dono nahi dikhte.

## 4. Chaalu karna

Sab test pass hone ke baad hi setting **on** karunga (merchant orders wali alag setting off hi rahegi jab tak aap na bolein), aur ek asli test order par aapke WhatsApp par message aaya ya nahi, ye confirm karunga.

## Rollback

Sab kuch hatane ka SQL pehle se taiyaar hai — ek hi step me triggers, tables, settings aur secret saaf ho jaate hain.

## Technical notes

- Verify: `bunx tsgo --noEmit` + `bun run build` on `src/routes/api/public/admin-alert/process.ts`.
- Secrets: `add_secret` for `ADMIN_ALERT_PHONES`, `AISENSY_ADMIN_ALERT_CAMPAIGN`; `ADMIN_ALERT_JOB_SECRET` env set from the existing vault value so the route header matches `admin_alert_verify_job_secret()`.
- Tests run via `supabase--read_query` / `run_sql` against queue + log, and `curl` against the local route for the 401 cases; AiSensy failure simulated with a bad campaign name on one queued row.
- Toggle flip: `ops_settings.admin_whatsapp_alert_enabled = 1` (guard trigger keeps it super_admin only).
- No changes to booking, payment, courier, or merchant logic.
