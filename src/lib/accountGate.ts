import { useLiveQuery } from "dexie-react-hooks";
import { db, getSettings } from "../data/db";
import { cloudConfigured } from "./firebase";

/** How many questions a visitor may submit on a device before an account is required. */
export const GUEST_QUESTION_LIMIT = 2;

/**
 * Guests get a short try, then starting anything new asks for a free account. Submitted
 * guest work is never removed; signing in attaches it to the account.
 */
export function useAccountGate(): { gated: boolean; guestSubmitted: number; limit: number; ready: boolean } {
  const state = useLiveQuery(async () => {
    const settings = await getSettings();
    if (!cloudConfigured() || settings.cloudUser) return { gated: false, guestSubmitted: 0 };
    const guestSubmitted = await db.attempts.filter((a) => !a.ownerId && a.submittedAt !== undefined).count();
    return { gated: guestSubmitted >= GUEST_QUESTION_LIMIT, guestSubmitted };
  }, []);
  return { gated: state?.gated ?? false, guestSubmitted: state?.guestSubmitted ?? 0, limit: GUEST_QUESTION_LIMIT, ready: state !== undefined };
}
