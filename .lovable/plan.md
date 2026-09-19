# Courier OTP backend — already built, ab sirf testing

Aapne jo 5 points maange hain, wo pichhle turn me database me bann chuke hain. Maine abhi database se confirm kiya:

| Cheez | Status |
| --- | --- |
| `courier_resend_otp` (owner + stage gate, 60s cooldown, max 3 sends, contact phone return, event log) | Bana hua |
| `courier_refresh_otp` (naya code, purana invalid) | Bana hua |
| `courier_update_contact` (owner, sirf un-verified OTP, max 2 edits, 10-digit check, OTP re-issue, audit log) | Bana hua |
| Sab SECURITY DEFINER + fixed search_path + anon se EXECUTE band | Confirmed |
| WhatsApp sirf button tap par (koi automatic send nahi) | Confirmed |

Cooldown (60s), max sends (3) aur edit cap (2) — teeno Command Center ki settings me hain, code me hardcode nahi.

Jo abhi baaki hai wo sirf **testing** hai: teen alag logins se jaanch ki access rules sach me sahi kaam karte hain.

## Is plan me kya karenge

1. Teen test identities se har RPC chalayenge:
   - **Order ka maalik (customer)** — sahi stage par kaam kare, galat stage par mana kare.
   - **Rider** — customer wale RPC na chala paaye; sirf apne assigned order ka contact number dekh paaye, dusre order ka nahi.
   - **Doosra customer** — kuch bhi na kar paaye.
   - **Bina login** — sab band.
2. Limits ki jaanch: 60 second ke andar dobara bhejna rok de, 3 sends ke baad rok de, 2 number-edit ke baad rok de, galat number (jaise 5 se shuru ya 9 digit) reject ho.
3. Behaviour ki jaanch: number badalne par purana code turant invalid ho aur naya issue ho; expire hone ke baad refresh naya code de; verify ho chuke OTP par resend/edit dono mana ho.
4. Har send aur har edit ka record events aur audit log me dikhe — ye bhi query karke dikhayenge.
5. Aakhir me ek chhota result table dunga: kaunsa test pass, kaunsa fail, aur fail hone par usi turn me fix.

## Technical notes

- Tests `set local role` + `request.jwt.claims` ke saath transaction me chalenge (koi asli data permanent change nahi hoga — rollback ke saath), aur ek temporary test courier order par.
- WhatsApp send is testing me actually nahi bheja jayega; sirf RPC ka return (code + phone + counts) aur event log check honge.
- Koi schema change expected nahi. Agar test me koi gap nikla (jaise kisi role ko galti se access), to ek chhoti migration se theek karenge.
