import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Everything except the sign-in pages requires a session. The tenant check is
// separate and lives in Convex (convex/lib/guard.ts) — this only decides
// "is anyone signed in", never "may they see this company".
const isPublic = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();
});

export const config = {
  matcher: ["/((?!_next|.*\..*).*)", "/(api|trpc)(.*)"],
};
