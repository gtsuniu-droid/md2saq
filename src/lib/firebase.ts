/**
 * Thin wrapper over the Firebase SDK, loaded on demand so the app bundle stays
 * small when cloud sync is not configured. Configuration comes from Vite env
 * variables (VITE_FIREBASE_*), set in Netlify or a local .env file.
 */
import type { FirebaseApp } from "firebase/app";
import type { Auth, User } from "firebase/auth";
import type { Firestore } from "firebase/firestore";

export interface CloudUser {
  uid: string;
  email?: string;
  name?: string;
  /** Google profile picture. */
  photo?: string;
}

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export function cloudConfigured(): boolean {
  return !!(config.apiKey && config.authDomain && config.projectId && config.appId);
}

let ready: Promise<{ app: FirebaseApp; auth: Auth; firestore: Firestore }> | null = null;

async function services() {
  if (!cloudConfigured()) throw new Error("Cloud sync is not configured on this site.");
  if (!ready) {
    ready = (async () => {
      const [{ initializeApp }, { getAuth }, { getFirestore }] = await Promise.all([
        import("firebase/app"),
        import("firebase/auth"),
        import("firebase/firestore"),
      ]);
      const app = initializeApp({
        apiKey: config.apiKey,
        authDomain: config.authDomain,
        projectId: config.projectId,
        appId: config.appId,
      });
      return { app, auth: getAuth(app), firestore: getFirestore(app) };
    })();
  }
  return ready;
}

function toCloudUser(u: User): CloudUser {
  return { uid: u.uid, email: u.email ?? undefined, name: u.displayName ?? undefined, photo: u.photoURL ?? undefined };
}

export async function signInWithGoogle(): Promise<CloudUser> {
  const { auth } = await services();
  const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
  const result = await signInWithPopup(auth, new GoogleAuthProvider());
  return toCloudUser(result.user);
}

export async function signOutCloud(): Promise<void> {
  const { auth } = await services();
  const { signOut } = await import("firebase/auth");
  await signOut(auth);
}

/** Subscribe to sign-in state. Resolves the unsubscribe function; never throws when unconfigured. */
export async function onCloudUser(cb: (u: CloudUser | null) => void): Promise<() => void> {
  if (!cloudConfigured()) {
    cb(null);
    return () => undefined;
  }
  const { auth } = await services();
  const { onAuthStateChanged } = await import("firebase/auth");
  return onAuthStateChanged(auth, (u) => cb(u ? toCloudUser(u) : null));
}

export async function currentUser(): Promise<CloudUser | null> {
  if (!cloudConfigured()) return null;
  const { auth } = await services();
  return auth.currentUser ? toCloudUser(auth.currentUser) : null;
}

export type CloudCollection = "attempts" | "marks" | "settings" | "deleted";

/** Documents in users/{uid}/{collection} with _m greater than `since`. */
export async function fetchSince(uid: string, collection: CloudCollection, since: number): Promise<Record<string, unknown>[]> {
  const { firestore } = await services();
  const { collection: col, getDocs, query, where, orderBy, limit } = await import("firebase/firestore");
  const out: Record<string, unknown>[] = [];
  let cursor = since;
  // Page through in modified order so a large backlog still arrives.
  for (let page = 0; page < 50; page++) {
    const snap = await getDocs(query(col(firestore, "users", uid, collection), where("_m", ">", cursor), orderBy("_m"), limit(400)));
    if (snap.empty) break;
    for (const d of snap.docs) out.push(d.data() as Record<string, unknown>);
    const last = snap.docs[snap.docs.length - 1].data() as { _m?: number };
    if (snap.size < 400 || typeof last._m !== "number") break;
    cursor = last._m;
  }
  return out;
}

/** Write documents in batches; each document must carry its own id. */
export async function writeMany(uid: string, collection: CloudCollection, docs: Record<string, unknown>[]): Promise<void> {
  if (docs.length === 0) return;
  const { firestore } = await services();
  const { doc, writeBatch } = await import("firebase/firestore");
  for (let i = 0; i < docs.length; i += 400) {
    const batch = writeBatch(firestore);
    for (const d of docs.slice(i, i + 400)) batch.set(doc(firestore, "users", uid, collection, String(d.id)), d);
    await batch.commit();
  }
}

export async function deleteMany(uid: string, collection: CloudCollection, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { firestore } = await services();
  const { doc, writeBatch } = await import("firebase/firestore");
  for (let i = 0; i < ids.length; i += 400) {
    const batch = writeBatch(firestore);
    for (const id of ids.slice(i, i + 400)) batch.delete(doc(firestore, "users", uid, collection, id));
    await batch.commit();
  }
}
