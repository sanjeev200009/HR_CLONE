/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as attendance from "../attendance.js";
import type * as corrections from "../corrections.js";
import type * as crons from "../crons.js";
import type * as directory from "../directory.js";
import type * as employees from "../employees.js";
import type * as feedback from "../feedback.js";
import type * as leave from "../leave.js";
import type * as lib_guard from "../lib/guard.js";
import type * as lib_leave from "../lib/leave.js";
import type * as lib_time from "../lib/time.js";
import type * as members from "../members.js";
import type * as platform from "../platform.js";
import type * as push from "../push.js";
import type * as seed from "../seed.js";
import type * as timesheets from "../timesheets.js";
import type * as workplaces from "../workplaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  attendance: typeof attendance;
  corrections: typeof corrections;
  crons: typeof crons;
  directory: typeof directory;
  employees: typeof employees;
  feedback: typeof feedback;
  leave: typeof leave;
  "lib/guard": typeof lib_guard;
  "lib/leave": typeof lib_leave;
  "lib/time": typeof lib_time;
  members: typeof members;
  platform: typeof platform;
  push: typeof push;
  seed: typeof seed;
  timesheets: typeof timesheets;
  workplaces: typeof workplaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
