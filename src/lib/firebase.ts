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

export async function services() {
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

/** A short-lived proof of sign-in for the site's own functions, or null when signed out. */
export async function idToken(): Promise<string | null> {
  if (!cloudConfigured()) return null;
  const { auth } = await services();
  await auth.authStateReady();
  return auth.currentUser ? auth.currentUser.getIdToken() : null;
}

export async function currentUser(): Promise<CloudUser | null> {
  if (!cloudConfigured()) return null;
  const { auth } = await services();
  return auth.currentUser ? toCloudUser(auth.currentUser) : null;
}


/** Shared question conversations are separate from private progress and notes. */
export async function communityServices() {
  const result = await services();
  await result.auth.authStateReady();
  if (!result.auth.currentUser) throw new Error("Sign in to join the conversation.");
  return result;
}
