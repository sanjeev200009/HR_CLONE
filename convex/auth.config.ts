// Server-side validation of Clerk access tokens.
// Set CLERK_JWT_ISSUER_DOMAIN on the Convex dashboard (dev + prod separately) to
// your Clerk Frontend API URL: https://<verb>-<noun>-00.clerk.accounts.dev in dev,
// https://clerk.<your-domain>.com in prod.
// Activate the Convex integration in the Clerk dashboard first — it provisions the
// "convex" JWT template this applicationID refers to.
import { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
