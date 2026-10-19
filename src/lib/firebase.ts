/**
 * Thin wrapper over the Firebase SDK, loaded on demand so the app bundle stays
 * small when cloud sync is not configured. Configuration comes from Vite env
 * variables (VITE_FIREBASE_*), set in Netlify or a local .env file.
 */
import type { FirebaseApp } from "firebase/app";
import type { Auth, User } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import type { PresentationNote } from "../data/types";
import { noteIsNewer, validateNote } from "./noteModel";

export interface CloudUser {
  uid: string;
  email?: string;
  name?: string;
  /** Google profile picture. */
  photo?: string;
  /** False for an email account whose address has not been confirmed yet. */
  verified?: boolean;
  /** "google.com" or "password". */
  provider?: string;
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
      // On the live site the sign-in handler is proxied from our own domain (see netlify.toml),
      // so the Google window says this site's name rather than the Firebase project's.
      const host = typeof window !== "undefined" ? window.location.host : "";
      const authDomain = /\.netlify\.app$/.test(host) ? host : config.authDomain;
      const app = initializeApp({
        apiKey: config.apiKey,
        authDomain,
        projectId: config.projectId,
        appId: config.appId,
      });
      return { app, auth: getAuth(app), firestore: getFirestore(app) };
    })();
  }
  return ready;
}

function toCloudUser(u: User): CloudUser {
  return { uid: u.uid, email: u.email ?? undefined, name: u.displayName ?? undefined, photo: u.photoURL ?? undefined, verified: u.emailVerified, provider: u.providerData[0]?.providerId ?? undefined };
}

/** Create an email account, name it, and send the verification link. */
export async function signUpWithEmail(email: string, password: string, name: string): Promise<CloudUser> {
  const { auth } = await services();
  const { createUserWithEmailAndPassword, sendEmailVerification, updateProfile } = await import("firebase/auth");
  const { user } = await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (name.trim()) await updateProfile(user, { displayName: name.trim() });
  await sendEmailVerification(user).catch(() => undefined);
  return toCloudUser(user);
}

export async function signInWithEmail(email: string, password: string): Promise<CloudUser> {
  const { auth } = await services();
  const { signInWithEmailAndPassword } = await import("firebase/auth");
  const { user } = await signInWithEmailAndPassword(auth, email.trim(), password);
  return toCloudUser(user);
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { auth } = await services();
  const { sendPasswordResetEmail } = await import("firebase/auth");
  await sendPasswordResetEmail(auth, email.trim());
}

export async function resendVerification(): Promise<void> {
  const { auth } = await services();
  if (!auth.currentUser) throw new Error("Sign in first.");
  const { sendEmailVerification } = await import("firebase/auth");
  await sendEmailVerification(auth.currentUser);
}

/** Ask Firebase again whether the address has been confirmed since the last check. */
export async function refreshVerification(): Promise<CloudUser | null> {
  if (!cloudConfigured()) return null;
  const { auth } = await services();
  if (!auth.currentUser) return null;
  await auth.currentUser.reload();
  return toCloudUser(auth.currentUser);
}

/** A plain sentence for a Firebase Auth error code. */
export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  switch (code) {
    case "auth/email-already-in-use": return "There is already an account with that email. Sign in instead, or reset the password.";
    case "auth/invalid-email": return "That email address doesn't look right.";
    case "auth/weak-password": return "Choose a longer password, at least 8 characters.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential": return "Email or password is incorrect.";
    case "auth/too-many-requests": return "Too many attempts. Wait a few minutes and try again.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request": return "The Google window was closed before signing in.";
    case "auth/network-request-failed": return "No connection. Check your internet and try again.";
    default: return e instanceof Error ? e.message.replace(/^Firebase:\s*/, "").replace(/\s*\(auth\/[a-z-]+\)\.?$/, "") : "Something went wrong. Please try again.";
  }
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

export async function fetchNotes(uid: string): Promise<PresentationNote[]> {
  const { firestore } = await services();
  const { collection, getDocs } = await import("firebase/firestore");
  const snapshot = await getDocs(collection(firestore, "users", uid, "notes"));
  return snapshot.docs.map((d) => ({ ...d.data(), id: d.id, ownerId: uid }) as PresentationNote);
}

export async function reconcileNote(uid: string, note: PresentationNote): Promise<PresentationNote> {
  validateNote(note);
  if (note.ownerId !== uid) throw new Error("This note belongs to another account.");
  const { firestore } = await services();
  const { doc, runTransaction } = await import("firebase/firestore");
  return runTransaction(firestore, async (tx) => {
    const ref = doc(firestore, "users", uid, "notes", note.id);
    const snap = await tx.get(ref);
    const remote = snap.exists() ? { ...snap.data(), id: note.id, ownerId: uid } as PresentationNote : undefined;
    if (remote && !noteIsNewer(note, remote)) return remote;
    tx.set(ref, note);
    return note;
  });
}

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

/** Shared question conversations are separate from private progress and notes. */
export async function communityServices() {
  const result = await services();
  await result.auth.authStateReady();
  if (!result.auth.currentUser) throw new Error("Sign in to join the conversation.");
  return result;
}
