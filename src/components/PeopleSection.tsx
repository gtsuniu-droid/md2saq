import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { getSettings } from "../data/db";
import { cloudConfigured } from "../lib/firebase";
import { isOwnerEmail, listMembers, setMemberRole, type Member } from "../lib/members";
import ConfirmDialog from "./ConfirmDialog";

function when(ts?: number): string {
  if (!ts) return "–";
  const d = new Date(ts);
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

/** Everyone who has signed in with Google, and who among them is an admin. */
export default function PeopleSection() {
  const settings = useLiveQuery(getSettings, []);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true); setError("");
    try { setMembers(await listMembers()); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load the list."); }
    finally { setLoading(false); }
  };

  if (!settings) return null;
  if (!cloudConfigured()) return null;
  const me = settings.cloudUser;
  // The list of accounts is the owner's alone; other admins never see it.
  if (!me || !isOwnerEmail(me.email)) return null;
  const query = search.trim().toLowerCase();
  const shown = (members ?? []).filter((m) => !query || `${m.name ?? ""} ${m.email ?? ""}`.toLowerCase().includes(query));
  const admins = (members ?? []).filter((m) => m.role === "admin" || isOwnerEmail(m.email)).length;

  const change = async () => {
    if (!pending) return;
    setBusy(true); setError("");
    try {
      const grant = pending.role !== "admin";
      await setMemberRole(pending.uid, grant);
      setMembers((list) => (list ?? []).map((m) => (m.uid === pending.uid ? { ...m, role: grant ? "admin" : undefined } : m)));
      setPending(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not change the role."); }
    finally { setBusy(false); }
  };

  return <details className="section" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open && members === null && !loading) void load(); }}>
    <summary><h2>People</h2></summary>
    <p className="muted" style={{ margin: ".2rem 0 .8rem" }}>Everyone who has signed in with Google. Only you can see this list. Admins see the Admin page and, with the passcode, can change the shared library.</p>
    <>
      <div className="row" style={{ marginBottom: ".6rem" }}>
        <input type="search" aria-label="Search people" placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="muted">{members ? `${members.length} ${members.length === 1 ? "person" : "people"}, ${admins} admin${admins === 1 ? "" : "s"}` : loading ? "Loading…" : ""}</span>
        <span style={{ flex: 1 }} />
        <button className="small" disabled={loading} onClick={() => void load()}>{loading ? "Loading…" : "Refresh"}</button>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      {members && <div className="admin-table-scroll"><table className="people-table" aria-label="People who have signed in">
        <thead><tr><th scope="col">Person</th><th scope="col">First seen</th><th scope="col">Last seen</th><th scope="col">Role</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {shown.map((m) => {
            const owner = isOwnerEmail(m.email);
            const admin = owner || m.role === "admin";
            const self = m.uid === me.uid;
            return <tr key={m.uid}>
              <td><span className="account-identity">{m.photo ? <img src={m.photo} alt="" referrerPolicy="no-referrer" /> : <span className="avatar-fallback">{(m.name ?? m.email ?? "?").charAt(0).toUpperCase()}</span>}<span><strong>{m.name || m.email || m.uid}{self ? " (you)" : ""}</strong>{m.name && <span className="muted">{m.email}</span>}</span></span></td>
              <td className="muted admin-date">{when(m.createdAt)}</td>
              <td className="muted admin-date">{when(m.lastSeenAt)}</td>
              <td><span className={`status-pill${admin ? " on" : ""}`}>{owner ? "Owner" : admin ? "Admin" : "Student"}</span></td>
              <td style={{ textAlign: "right" }}>{!owner && !self && <button className="small" disabled={busy} onClick={() => setPending(m)}>{admin ? "Remove admin" : "Make admin"}</button>}</td>
            </tr>;
          })}
          {!shown.length && <tr><td colSpan={5} className="muted">{members.length ? "Nobody matches." : "Nobody has signed in yet."}</td></tr>}
        </tbody>
      </table></div>}
    </>
    <ConfirmDialog open={pending !== null} title={pending?.role === "admin" ? `Remove admin from ${pending?.name || pending?.email}?` : `Make ${pending?.name || pending?.email} an admin?`} confirmLabel={pending?.role === "admin" ? "Remove admin" : "Make admin"} destructive={pending?.role === "admin"} busy={busy} error={error || null} onCancel={() => setPending(null)} onConfirm={() => void change()}>
      <p>{pending?.role === "admin" ? "They keep practising as before but lose the Admin page and the editing controls the next time they sign in." : "They will see the Admin page and editing controls the next time they sign in. Give them the admin passcode separately; it is still required to change the shared library."}</p>
    </ConfirmDialog>
  </details>;
}
