import { ADMIN_EMAILS } from "./admin";
import { cloudConfigured, communityServices, type CloudUser } from "./firebase";

/** One record per Google account that has signed in, so admins can see who uses the site. */
export interface Member {
  uid: string;
  email?: string;
  name?: string;
  photo?: string;
  createdAt?: number;
  lastSeenAt?: number;
  role?: "admin";
}

const COLLECTION = "members";

function millis(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const ts = value as { toMillis?: () => number };
  return typeof ts.toMillis === "function" ? ts.toMillis() : undefined;
}

function toMember(uid: string, data: Record<string, unknown>): Member {
  return {
    uid,
    email: typeof data.email === "string" ? data.email : undefined,
    name: typeof data.name === "string" ? data.name : undefined,
    photo: typeof data.photo === "string" ? data.photo : undefined,
    createdAt: millis(data.createdAt),
    lastSeenAt: millis(data.lastSeenAt),
    role: data.role === "admin" ? "admin" : undefined,
  };
}

/**
 * Record this sign-in (first seen, last seen, current name and picture) and return the
 * role an admin has given this account, if any. Never throws: a missing rule or a
 * flaky connection must not block signing in.
 */
export async function touchMember(user: CloudUser): Promise<Member["role"]> {
  if (!cloudConfigured()) return undefined;
  try {
    const { firestore } = await communityServices();
    const { doc, getDoc, serverTimestamp, setDoc, updateDoc } = await import("firebase/firestore");
    const ref = doc(firestore, COLLECTION, user.uid);
    const profile = { email: user.email ?? "", name: user.name ?? "", photo: user.photo ?? "" };
    const existing = await getDoc(ref);
    if (existing.exists()) {
      await updateDoc(ref, { ...profile, lastSeenAt: serverTimestamp() });
      return toMember(user.uid, existing.data() as Record<string, unknown>).role;
    }
    await setDoc(ref, { uid: user.uid, ...profile, createdAt: serverTimestamp(), lastSeenAt: serverTimestamp() });
    return undefined;
  } catch {
    return undefined;
  }
}

/** Everyone who has signed in, most recent first. Admins only; the rules enforce it. */
export async function listMembers(): Promise<Member[]> {
  const { firestore } = await communityServices();
  const { collection, getDocs, limit, orderBy, query } = await import("firebase/firestore");
  const snap = await getDocs(query(collection(firestore, COLLECTION), orderBy("lastSeenAt", "desc"), limit(500)));
  return snap.docs.map((d) => toMember(d.id, d.data() as Record<string, unknown>));
}

/** Grant or remove the admin role. The site owner's accounts are always admins. */
export async function setMemberRole(uid: string, admin: boolean): Promise<void> {
  const { firestore } = await communityServices();
  const { deleteField, doc, updateDoc } = await import("firebase/firestore");
  await updateDoc(doc(firestore, COLLECTION, uid), { role: admin ? "admin" : deleteField() });
}

/** Accounts named in the build configuration cannot be demoted from the People list. */
export function isOwnerEmail(email?: string): boolean {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}
