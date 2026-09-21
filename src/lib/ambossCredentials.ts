import { db } from "../data/db";
import type { RememberedAmbossLogin } from "../data/types";

export async function encryptAmbossLogin(username: string, password: string): Promise<RememberedAmbossLogin> {
  if (!crypto.subtle) throw new Error("This browser cannot remember the login securely. Leave Remember unchecked to sign in normally.");
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(password));
  return { id: "amboss", revision: crypto.randomUUID(), username: username.trim(), userId: "", key, iv, ciphertext };
}

export async function decryptAmbossPassword(login: RememberedAmbossLogin): Promise<string> {
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: login.iv }, login.key, login.ciphertext);
  return new TextDecoder().decode(plaintext);
}

/** UI receives availability only; the password is never filled back into a form. */
export async function getRememberedAmbossLogin() {
  const saved = await db.deviceLogins.get("amboss");
  return saved ? { username: saved.username, revision: saved.revision, needsAttention: !!saved.blocked } : null;
}

export async function forgetAmbossLogin(): Promise<void> {
  await db.deviceLogins.delete("amboss");
}
