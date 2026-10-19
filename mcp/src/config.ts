/**
 * Configuration from the environment, with CLI flags on top. Nothing is written
 * back to process.env.
 *
 *   SAQ_SITE_URL   The site, e.g. https://md2saq.netlify.app (default) or http://localhost:5173
 *   SAQ_PASSCODE   The bank's admin passcode. Needed for every change; reading works without it.
 *   SAQ_READ_ONLY  "1" or "true" to refuse every change, whatever the passcode.
 */
export interface Config {
  siteUrl: string;
  passcode: string;
  readOnly: boolean;
}

export function loadConfig(argv: string[] = process.argv.slice(2)): Config {
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const site = (flag("--site") ?? process.env.SAQ_SITE_URL ?? "https://md2saq.netlify.app").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(site)) throw new Error(`SAQ_SITE_URL must start with http:// or https:// (got "${site}").`);
  return {
    siteUrl: site,
    passcode: (flag("--passcode") ?? process.env.SAQ_PASSCODE ?? "").trim(),
    readOnly: argv.includes("--read-only") || /^(1|true|yes)$/i.test(process.env.SAQ_READ_ONLY ?? ""),
  };
}
