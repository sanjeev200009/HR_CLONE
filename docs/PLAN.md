# AttendanceHR — build plan

Multi-tenant attendance SaaS. Employee clock in/out with GPS geofence, company admin dashboard, super-admin dashboard.

## Decisions (locked before coding)

| Thing | Choice | Why |
|---|---|---|
| App | Next.js (App Router) + TypeScript, single app | one deploy, API routes = backend |
| UI | Tailwind + shadcn/ui | no custom design system |
| DB | Convex | reactive queries = no polling for the admin "who is in" board; typed schema, no migrations to run |
| Auth | `@convex-dev/auth` password provider | no third-party service, no extra bill; swap to Clerk only if SSO is ever sold |
| Hosting | Vercel (frontend) + Convex Cloud (backend) | one `npx convex deploy`; Cloudflare Pages revisit after MVP |
| Geofence | Haversine in `convex/lib/guard.ts` | plain TS, no PostGIS, no maps API |
| Time | `Date.now()` inside the mutation only | device clock is untrusted |
| Maps | none in MVP; lat/lng text + link to Google Maps | paid map not needed to show a point |
| Native app | none | PWA; GPS works in mobile browsers |

## Tenancy rule
Convex has **no row-level security** — this is the one real cost of the switch.
Every table carries `orgId`, and every query/mutation touching org data opens with
`requireMember(ctx, orgId)` or `requireOrgAdmin(ctx, orgId)` from `convex/lib/guard.ts`.
A function that skips the guard is a tenant leak, so phase 6 tests exactly that.
`requirePlatformAdmin` deliberately grants orgs/plans/usage only — never attendance or location.

## Phases
1. **Foundation** — `npm create convex`, `convex/schema.ts` pushed, `@convex-dev/auth` password sign-in, login redirect by role (`members.by_user` -> employee / admin / platform).
2. **Attendance** — employee screen: name/date/time/status, one big Clock In/Out button, today's hours, history list.
3. **Geofence** — workplaces CRUD, browser Geolocation on clock action, distance + accuracy checked inside the mutation, `verified | out_of_range | low_accuracy` status.
4. **Company admin** — today's board (in / not in / late / missing clock-out), employee CRUD + invite, attendance table, CSV export, correction approve/reject.
5. **Super admin** — create org, suspend org, plan + employee limit, usage counts. No location data access.
6. **Harden** — `convex-test` cases: member of org A cannot read org B, non-admin cannot hit admin functions, platform admin cannot read attendance, duplicate clock-in, clock-out without clock-in, permission denied, offline, timezone (store UTC, render Asia/Colombo).

## Explicitly out of MVP
Payroll, leave, recruitment, shifts, QR verification, payment gateway, continuous tracking, mock-location detection, Excel export (CSV only), native apps, offline queue (Convex retries on reconnect).

## Rules engine (MVP = 4 settings per org)
`expected_start`, `grace_minutes`, `expected_end`, `min_hours`. Late = clock_in > start + grace.
Missing clock-out = open record past midnight → flagged, not auto-closed.
