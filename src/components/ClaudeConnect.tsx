import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { getSettings } from "../data/db";
import { cloudConfigured, idToken } from "../lib/firebase";
import { formatDate } from "../lib/questions";
import ConfirmDialog from "./ConfirmDialog";

interface Status { connected: boolean; links?: number; createdAt: number | null; role: "owner" | "admin" | "student"; url?: string }

async function api(method: "GET" | "POST" | "DELETE"): Promise<Status> {
  const token = await idToken();
  if (!token) throw new Error("Sign in first.");
  const res = await fetch("/api/mcp-token", { method, headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error((await res.text().catch(() => "")) || `Request failed (${res.status}).`);
  return (await res.json()) as Status;
}

/**
 * Connect Claude to the site: one personal link, shown once, that Claude.ai, Claude
 * Desktop or Claude Code uses to read the bank, and to edit it for admins.
 */
export default function ClaudeConnect() {
  const settings = useLiveQuery(getSettings, []);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [removing, setRemoving] = useState(false);
  const user = settings?.cloudUser;

  useEffect(() => {
    if (!user) { setStatus(null); return; }
    let live = true;
    api("GET").then((s) => { if (live) setStatus(s); }).catch((e) => { if (live) setError(e instanceof Error ? e.message : "Could not check the connection."); });
    return () => { live = false; };
  }, [user?.uid]);

  if (!settings || !cloudConfigured()) return null;
  const run = async (method: "POST" | "DELETE") => {
    setBusy(true); setError(""); setCopied(false);
    try { setStatus(await api(method)); }
    catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); }
    finally { setBusy(false); setRemoving(false); }
  };
  const copy = async () => {
    if (!status?.url) return;
    try { await navigator.clipboard.writeText(status.url); setCopied(true); } catch { setCopied(false); }
  };
  const canEdit = status?.role === "owner" || status?.role === "admin";

  return (
    <div className="card">
      {!user ? (
        <div className="setting-row"><div><strong>Sign in to connect an assistant</strong><p>Your connection link is tied to your account.</p></div></div>
      ) : (
        <>
          <div className="setting-row">
            <div>
              <strong>{status?.connected ? "Your assistant is connected" : "Connect Claude or ChatGPT"}</strong>
              <p>{status ? canEdit ? "As an admin, the assistant can read the whole bank and edit questions, answers and stems on your say-so." : "The assistant can read every set and search the bank. Editing is for admins." : "Checking…"}{status?.connected && status.createdAt ? ` ${(status.links ?? 1) > 1 ? `${status.links} links active, the newest made` : "Link made"} ${formatDate(status.createdAt)}.` : ""}</p>
            </div>
            <div className="setting-control">
              <button className={status?.connected ? "small" : "primary"} disabled={busy || !status} onClick={() => void run("POST")}>{busy ? "Working…" : status?.connected ? "Make another link" : "Create connection link"}</button>
              {status?.connected && <button className="small danger" disabled={busy} onClick={() => setRemoving(true)}>{(status.links ?? 1) > 1 ? "Remove all links" : "Remove link"}</button>}
            </div>
          </div>
          {status?.url && (
            <div className="setting-row stacked connect-link">
              <div><strong>Your connection link</strong><p>Copy it now; it is shown only once. Treat it like a password: anyone with it can act as you here. Your other links keep working, so give each assistant its own; up to five stay active.</p></div>
              <div className="row">
                <input readOnly aria-label="Connection link" className="connect-url" value={status.url} onFocus={(e) => e.target.select()} />
                <button className="small" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
              </div>
            </div>
          )}
          <div className="setting-row stacked">
            <div><strong>Where to paste it</strong></div>
            <ul className="connect-steps">
              <li><strong>claude.ai or Claude Desktop:</strong> Settings, Connectors, Add custom connector. Name it SAQ Practice, paste the link as the URL, leave the OAuth fields empty, Add.</li>
              <li><strong>ChatGPT:</strong> Settings, Connectors, Create (developer mode must be on). Name it SAQ Practice, paste the link as the MCP server URL, authentication None, Create.</li>
              <li><strong>Claude Code:</strong> <code>claude mcp add --transport http saq-practice &lt;link&gt;</code></li>
            </ul>
            <p className="muted">Then ask things like "show me dyspnoea set 3", "find questions about pulmonary embolism"{canEdit ? ", \"review the whole bank for bad questions and flag them\", or \"in chest pain set 2 question 1, add troponin at 0 and 6 hours to the model answer\". Every change is kept in history, so \"undo that\" works too" : ""}.</p>
          </div>
          {error && <p className="settings-message field-error" role="alert">{error}</p>}
        </>
      )}
      <ConfirmDialog open={removing} title={(status?.links ?? 1) > 1 ? "Remove all your connection links?" : "Remove your connection link?"} confirmLabel={(status?.links ?? 1) > 1 ? "Remove all links" : "Remove link"} destructive busy={busy} onCancel={() => setRemoving(false)} onConfirm={() => void run("DELETE")}>
        <p>No assistant will be able to reach the site through {(status?.links ?? 1) > 1 ? "any of them" : "it"} any more. You can make a new one at any time.</p>
      </ConfirmDialog>
    </div>
  );
}
