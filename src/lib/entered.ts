/**
 * Whether this browser has been past the welcome page. A newcomer who opens any app page
 * directly is shown the welcome page first; leaving it through any of its links marks the
 * browser as entered, and from then on the app opens straight away.
 */
const KEY = "saq-practice:entered";

export function hasEntered(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

export function markEntered(): void {
  try { localStorage.setItem(KEY, "1"); } catch { /* private mode */ }
}

/** The public front page, at / or /welcome: the one place the app's startup work does not run. */
export function isLandingPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/welcome";
}
