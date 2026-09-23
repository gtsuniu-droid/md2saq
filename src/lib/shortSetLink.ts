/** A stable, URL-safe code derived only from a set's permanent bank ID. */
export async function setLinkCode(bankId: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bankId)));
  return btoa(String.fromCharCode(...digest.slice(0, 6))).replace(/\+/g, "-").replace(/\//g, "_");
}
