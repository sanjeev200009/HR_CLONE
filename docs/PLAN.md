# AttendanceHR — build plan

Multi-tenant attendance SaaS. Employee clock in/out with GPS geofence, company admin
dashboard, super-admin dashboard. Web dashboard + React Native employee app.

## Decisions (locked before coding)

| Thing | Choice | Why |
|---|---|---|
| Admin web app | Next.js (App Router) + TypeScript | one deploy; admins work at a desk |
| Employee mobile app | **React Native (Expo) + expo-router** | needs the Android mock-location flag, which no browser exposes |
| UI | Tailwind + shadcn/ui (web) · RN primitives (mobile) | no custom design system |
| DB | Convex | reactive queries = no polling for the admin "who is in" board; typed schema, no migrations |
| Auth | **Clerk** (`@clerk/expo`, `@clerk/nextjs`) + `ConvexProviderWithClerk` | hosted identity, email verification and password reset for free; SSO available later without a rewrite |
| Hosting | Vercel (web) + Convex Cloud (backend) + EAS (mobile builds/OTA) | one `npx convex deploy`; Cloudflare Pages revisit after MVP |
| Geofence | Haversine in `convex/lib/guard.ts` | plain TS, no PostGIS, no maps API |
| Time | `Date.now()` inside the mutation only | device clock is untrusted |
| Maps | none in MVP; lat/lng text + link to Google Maps | paid map not needed to show a point |
| Multi-tenancy | **our `organizations` table, NOT Clerk Organizations** | orgs carry attendance rules (timezone, grace, maxAccuracyM, planId) that don't belong in Clerk metadata; employees are admin-created, so Clerk's invite/switcher UI buys nothing |

### What Clerk costs us
Clerk owns identity, so there is **no `users` table and no `authTables`**. The only link
to a human is `clerkUserId` — the Clerk subject from `ctx.auth.getUserIdentity()`.
No webhook, no mirrored user table, no sync job.

The seam that creates is first sign-in: an admin creates a member row with an **email
only**, and `clerkUserId` is null until that person signs in. `claimMembership()` binds
them. It **requires `emailVerified`** — without that check anyone could sign up as
`someone@customer.lk` and claim that company's membership. That is the single most
security-sensitive function in the codebase.

## Tenancy rule
Convex has **no row-level security**. Every table carries `orgId`, and every
query/mutation touching org data opens with `requireMember(ctx, orgId)` or
`requireOrgAdmin(ctx, orgId)` from `convex/lib/guard.ts`. A function that skips the
guard is a tenant leak, so phase 6 tests exactly that.
`requirePlatformAdmin` deliberately grants orgs/plans/usage only — never attendance or
location.

## GPS trust ladder
GPS does not prove presence. Ranked by effort, MVP takes the first four:

| Mitigation | In MVP |
|---|---|
| `expo-location` `mocked` flag → `suspect_mocked` | yes |
| accuracy threshold (`organizations.maxAccuracyM`) | yes |
| distance + status computed server-side in the mutation | yes |
| Play Integrity API (rooted / tampered device) | yes — the one with teeth |
| rotating signed workplace QR (PRD §6) | no — only if a customer asks |

## Status (2026-10-31)

**Scope changed on request**: the user chose a full Gallery HR clone over
attendance-only, reversing the earlier decision. PRD §14/§15 argue against it
(simplicity was the differentiator) — the concern was raised twice and
overruled, which is the user's call. Leave, directory, timesheets and feedback
are now built. Payroll is NOT: Sri Lankan EPF/ETF/PAYE is statutory compliance
and the rates need confirming rather than guessing.


Phases 1-6 and M1-M5 are **built, typechecked and pushed**: shared Convex backend,
Expo employee app, Next.js admin + platform dashboard, 49 passing tests.

Outstanding, in the order it matters:
1. **Activate the Convex integration in the Clerk dashboard** and confirm sign-in
   end to end on a real device. Until then Clerk authenticates but Convex rejects
   the token.
2. **M6 device reality** — permission denied, GPS off, airplane mode mid-clock, a
   mock-location app installed, duplicate clock-in. The unit tests cover the
   server's half of each; none of it has touched real Android.
3. **Play Integrity** — in the GPS trust ladder below but not yet wired.
4. **M0 REA recon** — blocked: no APK, and galleryerp.com serves a Plesk
   placeholder, so there is no web bundle either.
5. Relax the Clerk password rule (min 15 chars, required) — it will not survive
   contact with shop-floor staff.

## Phases — web
1. **Foundation** — `npm create convex`, `convex/schema.ts` pushed, Clerk Convex
   integration activated, `CLERK_JWT_ISSUER_DOMAIN` set on Convex, login redirect by
   role (`members.by_clerk_user` → employee / admin / platform).
2. **Attendance core** — `clockIn` / `clockOut` mutations, today's status, history query.
3. **Geofence** — workplaces CRUD, distance + accuracy checked inside the mutation,
   `verified | out_of_range | low_accuracy | no_location | suspect_mocked`.
4. **Company admin** — today's board (in / not in / late / missing clock-out), employee
   CRUD + invite by email, attendance table, CSV export, correction approve/reject.
5. **Super admin** — create org, suspend org, plan + employee limit, usage counts. No
   location data access.
6. **Harden** — `convex-test`: member of org A cannot read org B, non-admin cannot hit
   admin functions, platform admin cannot read attendance, `claimMembership` rejects an
   unverified email, duplicate clock-in, clock-out without clock-in, timezone (store
   UTC, render Asia/Colombo).

## Phases — mobile (employees only; admins use the web dashboard)
Starts after web phase 3, reusing the same Convex deployment and the same guards.

- **M0** REA recon (½ day) — static teardown of Gallery HR `com.gallery.gallery_erp`.
  Output: their check-in screen, their geofence approach, their manifest permissions.
  Nothing else. Reference for one screen, not a feature list.
- **M1** Expo shell — `@clerk/expo` + `tokenCache` from `@clerk/expo/token-cache`
  (expo-secure-store), `ConvexProviderWithClerk`, `claimMembership` on first sign-in,
  employees only (admins get "use the web dashboard").
- **M2** The one screen — name, date, live clock, status, today's hours, one big
  Clock In/Out button, workplace-verified badge. This screen *is* the product.
- **M3** Location + trust — `expo-location` foreground permission, `mocked` flag,
  accuracy, Play Integrity. All verdicts server-side; the app only reports.
- **M4** History + corrections — month list, late/missing markers, raise a correction.
- **M5** Push — missed clock-out reminder at `expectedEnd + 1h` via a Convex scheduled
  function. The one notification that earns its keep.
- **M6** Device reality — real Android devices: permission denied, location off,
  airplane mode mid-clock, mock-location app installed, timezone, duplicate clock-in.
  Then EAS build + internal track.

## Explicitly out of MVP
Payroll, leave, recruitment, shifts, company directory, timesheets, QR verification,
payment gateway, continuous tracking, Excel export (CSV only), iOS build, offline queue
(Convex retries on reconnect), biometric unlock, in-app maps, Clerk Organizations.

**Scope warning:** Gallery HR's app has leave, directory, timesheet and feedback. PRD
§14 bans all four. Copying their feature list rebuilds the bloated HRIS this product
exists to undercut, and throws away the §15 differentiator.

## Rules engine (MVP = 4 settings per org)
`expectedStart`, `graceMinutes`, `expectedEnd`, `minHours`. Late = clock_in > start + grace.
Missing clock-out = open record past midnight → flagged, not auto-closed.
