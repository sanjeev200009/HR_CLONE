# AttendanceHR — scope of record

Attendance-only SaaS for SMBs (Sri Lanka first, 5–50 employees). Competes on simplicity and price, not feature count.

**MVP = Employee login + GPS clock in/out + geofencing + attendance history + company dashboard + super-admin dashboard.**

Three interfaces:
- **Employee** — one screen: status, clock button, today's hours, verification result, history.
- **Company admin** — dashboard counts, employee management, attendance table, workplaces + radius, reports/CSV, corrections.
- **Super admin** — register/suspend orgs, plans, employee limits, usage. Does *not* get employee location by default; admin access is role-gated and audited.

Pricing hypotheses (not final): Starter LKR 1,000 / 10 staff · Business LKR 2,500 / 30 staff · Growth LKR 6,000 / 100 staff.

Honest limits stated to customers: GPS is not proof of presence; readings can be inaccurate or spoofed. Location is captured only on a clock action, never continuously. Admin review exists for flagged attempts.

Validation before selling: interview 5–10 SMBs, demo MVP, get 2–3 paying pilots.

Full roadmap, stack decisions and out-of-scope list: `PLAN.md`. Schema: `../convex/schema.ts`. Tenant boundary: `../convex/lib/guard.ts`.
