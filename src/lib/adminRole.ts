/**
 * The admin role granted to the signed-in account, as read from Firestore at sign-in.
 * Held in memory only: nothing on the device records it, so editing local storage
 * cannot produce it. It is cleared on sign-out and re-read on every page load.
 */
let current: { uid: string; role: "admin" | undefined } = { uid: "", role: undefined };

export function setAdminRole(uid: string, role: "admin" | undefined): void {
  current = { uid, role };
}

export function adminRoleFor(uid: string | undefined): "admin" | undefined {
  return uid && current.uid === uid ? current.role : undefined;
}
