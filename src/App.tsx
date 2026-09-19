import { useEffect } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router";
import { db, getSettings, patchSettings } from "./data/db";
import { loadSession } from "./lib/session";
import { syncFromBank } from "./lib/bank";
import { numberUnnumberedSets } from "./lib/sets";
import HomePage from "./pages/HomePage";
import CreatePage from "./pages/CreatePage";
import BrowsePage from "./pages/BrowsePage";
import QuestionPage from "./pages/QuestionPage";
import SetPage from "./pages/SetPage";
import SetEditPage from "./pages/SetEditPage";
import PaperPage from "./pages/PaperPage";
import MarkPage from "./pages/MarkPage";
import SessionReviewPage from "./pages/SessionReviewPage";
import SettingsPage from "./pages/SettingsPage";
import AmbossPanel from "./components/AmbossPanel";
import { cloudConfigured, onCloudUser, signInWithGoogle, signOutCloud, type CloudUser } from "./lib/firebase";
import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState } from "react";
import { resetCursors, startSyncLoop, syncNow } from "./lib/sync";

function AccountButton() {
  const settings = useLiveQuery(getSettings, []);
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!settings || !cloudConfigured()) return null;
  const u = settings.cloudUser;
  if (u) {
    return (
      <div className="account-menu" ref={menuRef}>
        <button className="account" onClick={() => setOpen((o) => !o)} title={u.email ?? u.name ?? "Signed in"} aria-haspopup="menu" aria-expanded={open}>
          {u.photo ? <img src={u.photo} alt="" referrerPolicy="no-referrer" /> : <span className="avatar-fallback">{(u.name ?? u.email ?? "?").charAt(0).toUpperCase()}</span>}
        </button>
        {open && (
          <div className="menu" role="menu">
            <div className="menu-head">
              {u.name && <div>{u.name}</div>}
              {u.email && <div className="muted">{u.email}</div>}
            </div>
            <button role="menuitem" onClick={() => { setOpen(false); nav("/settings"); }}>Account settings</button>
            <button role="menuitem" onClick={async () => {
              setOpen(false);
              await signOutCloud();
              await patchSettings({ cloudUser: undefined });
            }}>Sign out</button>
          </div>
        )}
      </div>
    );
  }
  return (
    <button className="small nav-signin" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        const user = await signInWithGoogle();
        await patchSettings({ cloudUser: user });
        await resetCursors();
        void syncNow(user).catch(() => undefined);
      } catch {
        /* the Settings page shows the reason if it keeps failing */
      } finally {
        setBusy(false);
      }
    }}>Sign in</button>
  );
}

export default function App() {
  const { pathname } = useLocation();

  // Cloud sync: follow sign-in state, sync on arrival and in the background.
  useEffect(() => {
    let user: CloudUser | null = null;
    const stopLoop = startSyncLoop(() => user);
    let unsub: (() => void) | undefined;
    void onCloudUser(async (u) => {
      user = u;
      const settings = await getSettings();
      const stored = settings.cloudUser;
      const changed = !stored || stored.uid !== u?.uid || stored.photo !== u?.photo || stored.name !== u?.name || stored.email !== u?.email;
      if (u && changed) await patchSettings({ cloudUser: u });
      if (!u && settings.cloudUser) await patchSettings({ cloudUser: undefined });
      if (u) void syncNow(u).catch(() => undefined);
    }).then((fn) => { unsub = fn; });
    return () => {
      stopLoop();
      unsub?.();
    };
  }, []);

  // Drop unsubmitted attempts left behind by abandoned papers.
  useEffect(() => {
    const current = loadSession()?.id;
    void db.attempts.filter((a) => a.submittedAt === undefined && a.sessionId !== current).delete();
    // Pull the shared bank into the library, for everyone. Silently does nothing when unreachable.
    void (async () => {
      await numberUnnumberedSets();
      const settings = await getSettings();
      if (settings.autoImportBank === false) return;
      try {
        if ((await syncFromBank()) ?? 0) await numberUnnumberedSets();
      } catch {
        /* offline or local dev */
      }
    })();
  }, []);

  const full = pathname.startsWith("/paper");
  return (
    <div className="app">
      <nav className="nav">
        <NavLink to="/" className="brand">SAQ</NavLink>
        <NavLink to="/" end>Home</NavLink>
        <NavLink to="/browse">Browse</NavLink>
        <NavLink to="/settings">Settings</NavLink>
        <span style={{ flex: 1 }} />
        <AccountButton />
      </nav>
      <main className={full ? "page full" : "page"}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/create" element={<CreatePage />} />
          <Route path="/browse" element={<BrowsePage />} />
          <Route path="/set/:id" element={<SetPage />} />
          <Route path="/set/:id/edit" element={<SetEditPage />} />
          <Route path="/question/:id" element={<QuestionPage />} />
          <Route path="/paper" element={<PaperPage />} />
          <Route path="/mark/:attemptId" element={<MarkPage />} />
          <Route path="/session/:id" element={<SessionReviewPage />} />
          <Route path="/admin" element={<Navigate to="/settings#admin" replace />} />
          <Route path="/master" element={<Navigate to="/settings#admin" replace />} />
          <Route path="/bank" element={<Navigate to="/settings#admin" replace />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
      <AmbossPanel />
    </div>
  );
}
