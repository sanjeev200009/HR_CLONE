# AttendanceHR — build plan

Multi-tenant attendance SaaS. Employee clock in/out with GPS geofence, company admin dashboard, super-admin dashboard.

## Decisions (locked before coding)

| Thing | Choice | Why |
|---|---|---|
| App | Next.js (App Router) + TypeScript, single app | one deploy, API routes = backend |
| UI | Tailwind + shadcn/ui | no custom design system |
| DB/Auth | Supabase Postgres + Supabase Auth | RLS does tenant isolation in the DB, not in app code |
| Hosting | Vercel for MVP | Cloudflare Pages needs the edge-runtime dance; revisit after MVP |
| Geofence | Haversine in a Postgres function | no PostGIS, no maps API |
| Time | server `now()` only | device clock is untrusted |
| Maps | none in MVP; lat/lng text + link to Google Maps | paid map not needed to show a point |
| Native app | none | PWA; GPS works in mobile browsers |

## Tenancy rule
Every table carries `organization_id`. Every policy checks membership via one helper
(`is_member(org)` / `is_admin(org)`). No query ever filters tenants in JS.

## Phases
1. **Foundation** — Next.js + Supabase project, `schema.sql` applied, auth (email/password), login redirect by role.
2. **Attendance** — employee screen: name/date/time/status, one big Clock In/Out button, today's hours, history list.
3. **Geofence** — workplaces CRUD, browser Geolocation on clock action, server-side distance + accuracy check, `verified | out_of_range | low_accuracy` status.
4. **Company admin** — today's board (in / not in / late / missing clock-out), employee CRUD + invite, attendance table, CSV export, correction approve/reject.
5. **Super admin** — create org, suspend org, plan + employee limit, usage counts. No location data access.
6. **Harden** — RLS tests (member of org A cannot read org B), duplicate clock-in, clock-out without clock-in, permission denied, offline, timezone (store UTC, render Asia/Colombo).

## Explicitly out of MVP
Payroll, leave, recruitment, shifts, QR verification, payment gateway, continuous tracking, mock-location detection, Excel export (CSV only), native apps.

## Rules engine (MVP = 4 settings per org)
`expected_start`, `grace_minutes`, `expected_end`, `min_hours`. Late = clock_in > start + grace.
Missing clock-out = open record past midnight → flagged, not auto-closed.
