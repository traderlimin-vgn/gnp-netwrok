# NETWORK GMP — Billing Management System RT/RW Net / ISP (SPEC)

Stack: FastAPI + MongoDB (motor) backend, React 19 + Vite + Tailwind v4 + shadcn/ui + TanStack Query frontend. UI language: Bahasa Indonesia.
(User agreed to this stack instead of Next.js/Prisma/Postgres/BullMQ; heavy jobs run in an in-process job queue `backend/lib/jobs.py`.)

## Roles (RBAC, backend/lib/security.py PERMISSIONS)
super_admin, admin, finance, cs, teknisi, supervisor. Frontend hides nav/pages by `me.permissions`; backend enforces with `require(perm)`.
Auth: httpOnly cookie session (JWT), bcrypt hashing, CSRF header `X-Requested-With: gmp`. Credentials: memory/test_credentials.md.

## Modules / pages
- Dashboard (/): stats + charts (revenue, billed vs paid, growth, status pie, MikroTik per router).
- Pelanggan (/customers): CRUD, search/filter/sort/pagination/CSV, detail sheet with MikroTik info and actions enable/disable/disconnect/isolate/activate. Create option "Create PPPoE User on MikroTik" → integration_status SUCCESS / MIKROTIK_SYNC_FAILED / PENDING. Package change → UPDATE_PROFILE.
- Paket (/packages): CRUD with `mikrotik_profile`.
- Tagihan (/invoices): generate monthly (INV-GMP-YYYYMM-000001, idempotent), discount/penalty, cancel, pay dialog, WA reminder, "Jalankan Otomasi Isolir" (/billing/run-automation).
- Pembayaran (/payments): list, confirm pending, receipt print (LUNAS stamp), WA receipt. Payment confirmed → invoice paid → auto activation (if customer isolir & auto_activation ON) — idempotent, fail-safe (router offline → mikrotik_pending queue).
- WhatsApp (/whatsapp): message log + manual send. **Provider = SIMULATOR (mocked)**.
- Network: Routers (/network/routers: CRUD, TEST CONNECTION steps, SYNC MIKROTIK results, health), Monitoring PPPoE (/network/pppoe: polling per settings.polling_interval ≥30s, disconnect, traffic chart), Action Log (/network/actions + pending retry).
- Tiket (/tickets) TKT-GMP-000001, PSB (/psb) PSB-GMP-000001, Teknisi mobile dashboard (/technician), Peta Leaflet (/map), Laporan (/reports + CSV/XLSX export), Audit (/audit), Pengaturan (/settings: MikroTik/billing settings, users, health, backups).

## Integration layer
backend/integrations/mikrotik: IMikroTikProvider (base.py), MikroTikApiProvider (api_provider.py, real RouterOS plain API only, port 8728 — API-SSL removed per user request), simulator.py (**MOCKED routers for preview**), services.py (Connection/Customer/Billing services, retry+exponential backoff, action log). Router mode `api` vs `simulator`. Credentials encrypted (Fernet) and never returned to browser.
backend/integrations/whatsapp: IWhatsAppProvider + WhatsAppService (simulator).

## Data (Mongo collections)
users, customers, packages, invoices, payments, mikrotik_routers, mikrotik_actions, mikrotik_pending, whatsapp_messages, tickets, psb, map_assets, notifications, audit_logs, settings, counters, sim_ppp (simulator state).
