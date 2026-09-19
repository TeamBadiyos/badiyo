# Profile compulsory fields, Payment Methods hatana, aur proper Support Tickets

## 1. Profile — naam aur mobile number compulsory, email optional

Abhi "Complete your profile" popup sirf naam maangta hai aur "Skip for now" se band ho jata hai.

Naya behaviour:
- Popup tab tak dikhega jab tak naam **aur** mobile number dono save na ho jaayein.
- Mobile number apne aap login wale number se bhar jayega. Agar kisi account par number nahi hai, to user 10-digit Indian number daal sakega (validation ke saath).
- Email optional hi rahega, par daala jaye to sahi format check hoga.
- "Skip for now" hat jayega — jab tak dono nahi bharte popup band nahi hoga (cross button bhi nahi). Photo aur invite code pehle jaise optional.
- Profile edit screen par bhi wahi rule: naam khaali karke save nahi kar sakte, number khaali nahi ho sakta.

## 2. Payment Methods tab hataana

Profile menu se "Payment Methods" row aur uski screen dono hata denge (payment waise bhi Razorpay ke andar hota hai, yahan kuch save nahi hota). Payment flow me koi badlav nahi.

## 3. Support tickets — proper conversation system

Abhi ticket bhejne ke baad user ko kuch nahi dikhta. Naya system:

**My Tickets (nayi screen, Help & Support ke andar)**
- User ke saare tickets ki list: subject, chhota preview, status badge (Open / In progress / Answered / Resolved), aakhri update ka date-time, aur naye reply ka dot.
- Ticket kholne par poori chat: user ka message, support ka reply, dono par date-time stamp aur "You" / "badiyos Support" label.
- Reply aane ke baad bhi user usi ticket me dobara likh sakta hai (follow-up), chahe ticket resolved ho — resolved par likhne se ticket dobara open ho jayega.
- Nayi ticket banate waqt: category chunna (Booking, Payment/Refund, Expert/Service quality, App issue, Other), chhota subject, aur detail. Chahein to us ticket ko kisi booking se jod sakte hain.
- List har 20 second apne aap refresh hogi aur pull-to-refresh bhi chalega, taaki reply turant dikhe.
- Ticket me status history bhi dikhegi (kab raise hua, kab team ne dekha, kab resolve hua).

**Command Center (aapka staff panel)**
- Staff wahi conversation dekh aur reply kar payega, status badal payega. Uske liye database me support rahega; staff panel ka UI aap jis project me chalate hain wahan se reply karega.

**Notification**
- Reply aane par user ko notification jayega ("Support ne aapke ticket ka jawab diya hai") — existing notification system se.

## Technical notes

- Nayi table `support_ticket_messages` (ticket_id, sender = customer/staff, body, created_at) + `support_tickets` me `subject`, `category`, `booking_id`, `last_message_at`, `unread_for_customer` columns. Grants + RLS: customer sirf apne ticket ke messages padhe/likhe, staff (`is_active_staff` super_admin/ops_manager) sab padhe/likhe. Trigger se `last_message_at`/status update aur notification event.
- Status values: `open`, `in_progress`, `answered`, `resolved` (existing `status` column reuse, default `open`).
- Client: `HelpSupportScreen` me "My tickets" entry + nayi `SupportTicketsScreen` / `SupportTicketDetailScreen` (lazy routes, existing phase pattern), React Query with polling.
- `PaymentMethodsScreen.tsx` delete + ProfileScreen menu row + `payment-methods` phase/lazy import remove.
- `CompleteProfileSheet`: phone field + required validation, skip/close hataana; `EditProfileScreen` me same validation. Naya i18n text sabhi languages me.
