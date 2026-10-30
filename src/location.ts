import * as Location from "expo-location";
import { Platform } from "react-native";
import Constants from "expo-constants";

export type Fix = {
  lat?: number;
  lng?: number;
  accuracyM?: number;
  isMocked?: boolean;
};

/** Why we have no usable fix, in words an employee can act on. */
export type FixProblem = null | "denied" | "services_off" | "timeout";

/**
 * Read one location, once, for a clock action.
 *
 * Foreground permission only, and only when a button is pressed. The product
 * promise (PRD §5) is that nobody is tracked through the day, and the way to keep
 * that promise is to never ask for background permission at all — an app that
 * cannot track in the background cannot be accused of it.
 *
 * Never throws. A clock-in with no location still has to reach the server, which
 * records it as no_location and lets an admin deal with it. Swallowing the action
 * because GPS failed would mean an employee who turned up has no record of it.
 */
export async function readFix(): Promise<{ fix: Fix; problem: FixProblem }> {
  try {
    const enabled = await Location.hasServicesEnabledAsync();
    if (!enabled) return { fix: {}, problem: "services_off" };

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== Location.PermissionStatus.GRANTED) {
      return { fix: {}, problem: "denied" };
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    return {
      fix: {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracyM: position.coords.accuracy ?? undefined,
        // Android only. iOS does not expose this, so undefined means "unknown",
        // not "genuine" — the server treats it as unknown, not as a pass.
        isMocked: position.mocked ?? undefined,
      },
      problem: null,
    };
  } catch {
    return { fix: {}, problem: "timeout" };
  }
}

/** Goes in attendance.device, so a support question has something to stand on. */
export function deviceLabel(): string {
  const version = Constants.expoConfig?.version ?? "dev";
  return `${Platform.OS} ${Platform.Version} / app ${version}`;
}

export const fixProblemMessage: Record<Exclude<FixProblem, null>, string> = {
  denied:
    "Location permission is off, so this will be recorded without a workplace check. Turn it on in Settings to verify you are at work.",
  services_off: "Turn on location (GPS) so your attendance can be verified.",
  timeout: "Could not get a location fix. Move somewhere with a clearer view of the sky.",
};
