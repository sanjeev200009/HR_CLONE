import { useEffect } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";

/**
 * Register this device for the missed-clock-out reminder.
 *
 * Deliberately silent on failure. Push is a convenience; refusing permission must
 * never block clocking in, and an employee who says no should not be nagged.
 */
export function usePush(orgId: Id<"organizations"> | null) {
  const register = useMutation(api.push.register);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;

    (async () => {
      try {
        // Push needs real hardware; a simulator has no token to give.
        if (!Device.isDevice) return;

        const existing = await Notifications.getPermissionsAsync();
        let granted = existing.granted;
        if (!granted && existing.canAskAgain) {
          granted = (await Notifications.requestPermissionsAsync()).granted;
        }
        if (!granted) return;

        const projectId =
          Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
        if (!projectId) return; // not an EAS build yet; nothing to register

        const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
        if (!cancelled && token) {
          await register({
            orgId,
            token,
            platform: Platform.OS === "ios" ? "ios" : "android",
          });
        }
      } catch {
        // Never surfaced: see the note above.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orgId, register]);
}
