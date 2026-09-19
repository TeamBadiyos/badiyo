# Roadmap — Courier (Porter-type) backend foundation

Approved plan: `.lovable/plan/courier-porter-type-backend-foundation-v4-2026-09-19.md`

- [ ] Migration 1 — config tables + seeds + ops_settings + Vault OTP secret
- [ ] Migration 2 — courier_orders / secrets / events / offers + RLS + triggers
- [ ] Migration 3 — RPCs (quote, create, cancel, dispatch, offers, status, OTP, staff) + sweeper + cron job
- [ ] Migration 4 (separate) — service_flag check in existing booking create path (fail-open) + rollback SQL
- [ ] Server: `src/lib/courier.functions.ts` (Routes distance, Razorpay order, AiSensy OTP)
- [ ] Server route `/api/public/courier/process-refunds` (shared secret, idempotent Razorpay refunds)
- [ ] Razorpay webhook: purpose `courier` + late-payment auto-refund
- [ ] Verification: typecheck, build, DB linter, RLS/RPC role tests + race tests
