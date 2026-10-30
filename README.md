# AttendanceHR

Attendance-only HR SaaS for SMBs: employee GPS clock in/out, geofenced workplaces, company dashboard, multi-tenant super admin.

- Scope: `docs/PRD.md`
- Build order + locked decisions: `docs/PLAN.md`
- Database schema: `convex/schema.ts`
- Tenant boundary (replaces RLS): `convex/lib/guard.ts`

Nothing is implemented yet — this is the prepared plan.

## Next step
```
npm create convex@latest        # pick Next.js + TypeScript
npm i @convex-dev/auth @auth/core
npx convex dev                  # pushes convex/schema.ts
```
Then Phase 1 in `docs/PLAN.md`. Env: `NEXT_PUBLIC_CONVEX_URL` (written by `convex dev`), plus Convex's own `JWT_PRIVATE_KEY`/`SITE_URL` from the auth setup script. No service-role key to leak — all writes go through Convex functions.
