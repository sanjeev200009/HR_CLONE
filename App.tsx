import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ConvexReactClient } from "convex/react";
import { StatusBar } from "expo-status-bar";
import Gate from "./src/Gate";

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;
const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL!;

if (!publishableKey) throw new Error("Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in .env");
if (!convexUrl) throw new Error("Missing EXPO_PUBLIC_CONVEX_URL — run `npx convex dev`");

// unsavedChangesWarning is a web-only concern; off keeps RN quiet.
const convex = new ConvexReactClient(convexUrl, { unsavedChangesWarning: false });

export default function App() {
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <StatusBar style="auto" />
        <Gate />
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
