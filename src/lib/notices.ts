import { cloudConfigured, communityServices } from "./firebase";

/** Short announcements from the site's owner or an admin, shown behind the bell. */
export interface Notice { id: string; title: string; body: string; at: number; by: string }

const SEEN_KEY = "saq-practice:notices-seen";

export function noticesSeenAt(): number {
  try { return Number(localStorage.getItem(SEEN_KEY) ?? 0) || 0; } catch { return 0; }
}
export function markNoticesSeen(at = Date.now()): void {
  try { localStorage.setItem(SEEN_KEY, String(at)); } catch { /* private mode */ }
}

/** The latest notices, live. Resolves the unsubscribe function; gives nothing when signed out. */
export async function subscribeNotices(cb: (notices: Notice[]) => void): Promise<() => void> {
  if (!cloudConfigured()) { cb([]); return () => undefined; }
  let firestore;
  try { ({ firestore } = await communityServices()); } catch { cb([]); return () => undefined; }
  const { collection, limit, onSnapshot, orderBy, query } = await import("firebase/firestore");
  return onSnapshot(query(collection(firestore, "notices"), orderBy("at", "desc"), limit(20)), (snap) => {
    cb(snap.docs.map((d) => { const v = d.data() as { title?: string; body?: string; by?: string; at?: { toMillis?: () => number } | null }; return { id: d.id, title: v.title ?? "", body: v.body ?? "", by: v.by ?? "", at: v.at?.toMillis?.() ?? Date.now() }; }));
  }, () => cb([]));
}

export async function postNotice(title: string, body: string): Promise<void> {
  const t = title.trim(); const b = body.trim();
  if (!t) throw new Error("Give the notice a title.");
  if (t.length > 120) throw new Error("Keep the title under 120 characters.");
  if (b.length > 2000) throw new Error("Keep the notice under 2000 characters.");
  const { firestore, auth } = await communityServices();
  const { addDoc, collection, serverTimestamp } = await import("firebase/firestore");
  const user = auth.currentUser!;
  await addDoc(collection(firestore, "notices"), { title: t, body: b, by: (user.displayName?.trim() || "Admin").slice(0, 80), byUid: user.uid, at: serverTimestamp() });
}

export async function deleteNotice(id: string): Promise<void> {
  const { firestore } = await communityServices();
  const { deleteDoc, doc } = await import("firebase/firestore");
  await deleteDoc(doc(firestore, "notices", id));
}
