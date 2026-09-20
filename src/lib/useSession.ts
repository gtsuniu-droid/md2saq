import { useSyncExternalStore } from "react";
import type { Session } from "../data/types";
import { loadSession, subscribeSession } from "./session";

/** The paper in progress, re-rendering when it starts, moves on, pauses or ends. */
export function useSession(): Session | null {
  return useSyncExternalStore(subscribeSession, loadSession, () => null);
}
