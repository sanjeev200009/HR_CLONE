# AttendanceHR

Attendance-only HR SaaS for small and medium businesses: employee GPS clock in/out,
geofenced workplaces, a company admin dashboard, and a platform owner console.

Multi-tenant from the first commit. Not an HR platform — see
[docs/PRD.md](docs/PRD.md) §14 for what is deliberately absent and why.

## What's in the repo

```
convex/          shared backend — one deployment serves both apps
  lib/guard.ts   THE tenant boundary. Convex has no RLS; this is it
  lib/time.ts    org-timezone work dates, lateness, missed clock-out
  attendance.ts  clockIn / clockOut / today / myHistory
  admin.ts       today board, attendance range (backs the CSV)
  employees.ts   invite by email, seat limits, roles
  workplaces.ts  point + radius CRUD
  corrections.ts two-party attendance edits
  platform.ts    SaaS owner: orgs, plans, counts. No attendance, no coordinates
  push.ts        the one notification: "you never clocked out"
  crons.ts       hourly reminder sweep, daily subscription expiry
App.tsx, src/    Expo employee app (Android-first)
web/             Next.js admin + platform dashboard
tests/           49 tests. tenancy.test.ts IS the isolation guarantee
```

## Stack

React Native (Expo) · Next.js · Convex · Clerk · Tailwind. Decisions and their
reasons are in [docs/PLAN.md](docs/PLAN.md).

## Running it

```bash
npm install
npx convex dev            # pushes schema + functions, writes .env.local
```

`.env` needs `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`. On the Convex dashboard set
`CLERK_JWT_ISSUER_DOMAIN` to your Clerk Frontend API URL, and activate the Convex
integration in the Clerk dashboard — without it Clerk signs you in but Convex
rejects the token, and the app sits on a spinner.

Employee app:

```bash
npm start                 # then scan with Expo Go, or `npm run android`
```

Admin dashboard:

```bash
cd web && npm install && npm run dev
```

`web/.env.local` needs `NEXT_PUBLIC_CONVEX_URL` and
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (see `web/.env.example`).

Tests:

```bash
npm test
```

## First run

There is no self-service signup: an admin creates an employee row keyed on an
email, and the person binds to it by signing in with that address
(`members.claim`). So you need one seeded company to sign in to:

```bash
npx convex run seed:dev '{"email":"you@yourcompany.lk","fullName":"Your Name"}'
```

That makes a company with Colombo attendance rules, one workplace, and an admin
row for that email. Sign in to `web/` with it.

For the platform console at `/platform`, sign in once, then:

```bash
npx convex run seed:platformAdmin '{"clerkUserId":"user_..."}'
```

## Two things worth knowing before you change anything

**Convex has no row-level security.** Every org-scoped function opens with
`requireMember` / `requireOrgAdmin` / `requirePlatformAdmin` from
`convex/lib/guard.ts`. A function that skips one is a cross-company data leak, not
a bug to fix later. `tests/tenancy.test.ts` is where that is held down.

**GPS does not prove presence.** The system records what a device claimed and how
far it can be trusted — `verified`, `out_of_range`, `low_accuracy`, `no_location`,
`suspect_mocked` — and the verdict is always computed server-side inside the
mutation. A clock-in with no location is still recorded, because the employee may
well have turned up; it is flagged, not refused.
