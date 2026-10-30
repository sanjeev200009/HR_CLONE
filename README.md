# AttendanceHR

Attendance-only HR SaaS for SMBs: employee GPS clock in/out, geofenced workplaces, company dashboard, multi-tenant super admin.

- Scope: `docs/PRD.md`
- Build order + locked decisions: `docs/PLAN.md`
- Database + RLS: `supabase/schema.sql`

Nothing is implemented yet — this is the prepared plan.

## Next step
Create a Supabase project, run `supabase/schema.sql`, then start Phase 1 in `docs/PLAN.md`.
Env needed later: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only, never in the client bundle).
