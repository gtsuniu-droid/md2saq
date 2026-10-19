import ContentGate from "./components/ContentGate";
import { setProgressAccount } from "./lib/progressAccount";
import { useEffect } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router";
import { isAdmin } from "./lib/admin";
import { db, getSettings } from "./data/db";
import { loadSession, sessionOwner, subscribeSession } from "./lib/session";
import { useSession } from "./lib/useSession";
import { syncFromBank } from "./lib/bank";
import { numberUnnumberedSets } from "./lib/sets";
import SharedPage from "./pages/SharedPage";
import HomePage from "./pages/HomePage";
import CreatePage from "./pages/CreatePage";
import BrowsePage from "./pages/BrowsePage";
import NotesPage from "./pages/NotesPage";
import NotesPanel from "./components/NotesPanel";
import QuestionPage from "./pages/QuestionPage";
import SetPage from "./pages/SetPage";
import SetEditPage from "./pages/SetEditPage";
import PaperPage from "./pages/PaperPage";
import MarkPage from "./pages/MarkPage";
import SetAttemptPage from "./pages/SetAttemptPage";
import ReviewPage from "./pages/ReviewPage";
import SessionReviewPage from "./pages/SessionReviewPage";
import SettingsPage from "./pages/SettingsPage";
import AdminPage from "./pages/AdminPage";
import LandingPage, { BrandMark } from "./pages/LandingPage";
import AmbossPanel from "./components/AmbossPanel";
import AmbossHover from "./components/AmbossHover";
import { restoreAmbossSession } from "./lib/amboss";
import { cloudConfigured, onCloudUser, signInWithGoogle, signOutCloud, type CloudUser } from "./lib/firebase";
import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState } from "react";
import { recordDeletes, requestSync, resetCursors, startSyncLoop, syncNow } from "./lib/sync";
import { touchMember } from "./lib/members";
import { patchSettings } from "./data/db";

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
              await setProgressAccount(null);
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
        await setProgressAccount(user);
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
  const { pathname, hash } = useLocation();
  const account = useLiveQuery(getSettings, []);
  const session = useSession();
  const [notesOpen, setNotesOpen] = useState(false);
  const studying = /^\/(mark|paper|question|set|session|history)(\/|$)/.test(pathname);
  useEffect(() => { document.querySelector("main")?.scrollTo(0, 0); }, [pathname]);

  useEffect(() => {
    const reconnect = () => { if (navigator.onLine) void restoreAmbossSession().catch(() => undefined); };
    reconnect();
    window.addEventListener("online", reconnect);
    return () => window.removeEventListener("online", reconnect);
  }, []);

  // Cloud sync: follow sign-in state, sync on arrival and in the background.
  useEffect(() => {
    let user: CloudUser | null = null;
    const stopLoop = startSyncLoop(() => user);
    // The paper in progress follows the account: every change to it syncs soon after.
    const stopSession = subscribeSession(() => requestSync());
    let unsub: (() => void) | undefined;
    void onCloudUser(async (u) => {
      await setProgressAccount(u);
      user = u;
      if (u) {
        void syncNow(u).catch(() => undefined);
        // Record the sign-in and pick up any admin role granted from the People list.
        void touchMember(u).then((role) => patchSettings({ cloudRole: role }));
      } else {
        void patchSettings({ cloudRole: undefined });
      }
    }).then((fn) => { unsub = fn; });
    return () => {
      stopLoop();
      stopSession();
      unsub?.();
    };
  }, []);

  // Drop unsubmitted attempts left behind by abandoned papers.
  useEffect(() => {
    if (/^\/(shared|s)\//.test(window.location.pathname)) return;
    const current = loadSession()?.id;
    void (async () => {
      const ownerId = (await getSettings()).cloudUser?.uid ?? "";
      const orphans = (await db.attempts.filter((a) => (a.ownerId ?? "") === ownerId && a.submittedAt === undefined && a.sessionId !== current).primaryKeys()) as string[];
      if (orphans.length === 0) return;
      await db.attempts.bulkDelete(orphans);
      await recordDeletes("attempts", orphans);
    })();
    // Pull the shared bank into the library, for everyone. Silently does nothing when unreachable.
    void (async () => {
      await numberUnnumberedSets();
      const settings = await getSettings();
      if (settings.autoImportBank === false || /^\/(shared|s)\//.test(window.location.pathname)) return;
      try {
        await syncFromBank();
        requestSync(0);
      } catch {
        /* offline or local dev */
      }
    })();
  }, []);

  // The front page is for newcomers; anyone signed in or who has practised before goes straight in.
  if (pathname === "/" || pathname === "/welcome") return <LandingPage autoEnter={pathname === "/"} />;
  if (pathname === "/home") try { localStorage.setItem("saq-practice:entered", "1"); } catch { /* private mode */ }

  const full = /^\/(paper|mark)(\/|$)/.test(pathname);
  const shell = full ? "page full" : pathname === "/home" ? "page home-shell" : pathname === "/browse" ? "page browse-shell" : pathname === "/settings" ? "page settings-shell" : pathname === "/admin" ? "page admin-shell" : "page wide-shell";
  return (
    <div className="app">
      <nav className="nav">
        <NavLink to="/welcome" className="brand"><BrandMark />SAQ Practice</NavLink>
        <NavLink to="/home" end>Home</NavLink>
        <NavLink to="/browse">Browse</NavLink>
        <NavLink to="/notes">Notes</NavLink>
        <NavLink to="/review">Review</NavLink>
        <NavLink to="/settings">Settings</NavLink>
        {isAdmin(account) && <NavLink to="/admin">Admin</NavLink>}
        {session && <NavLink to="/paper" className="nav-paper"><span className="dot" />Continue session</NavLink>}
        <span style={{ flex: 1 }} />
        {studying && !(session?.examFormat && pathname.startsWith("/paper")) && <button className="nav-notes" aria-expanded={notesOpen} onClick={() => setNotesOpen((open) => !open)}>{notesOpen ? "Hide reference notes" : "Reference notes"}</button>}
        <AccountButton />
      </nav>
      <div className="study-workspace">
      <main className={shell}>
        <Routes key={`${account?.cloudUser?.uid ?? ""}:${sessionOwner()}`}>
          <Route path="/home" element={<HomePage />} />
          <Route path="/create" element={<CreatePage />} />
          <Route path="/browse" element={<BrowsePage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/set/:id" element={<ContentGate kind="set"><SetPage /></ContentGate>} />
          <Route path="/set/:id/edit" element={<ContentGate kind="set"><SetEditPage /></ContentGate>} />
          <Route path="/question/:id" element={<ContentGate kind="question"><QuestionPage /></ContentGate>} />
          <Route path="/s/:code" element={<SharedPage />} />
          <Route path="/shared/:bankId" element={<SharedPage />} />
          <Route path="/shared/:bankId/question/:questionId" element={<SharedPage />} />
          <Route path="/paper" element={<PaperPage key={session?.id} />} />
          <Route path="/mark/:attemptId" element={<ContentGate kind="attempt"><MarkPage /></ContentGate>} />
          <Route path="/history/:attemptId" element={<ContentGate kind="attempt"><SetAttemptPage /></ContentGate>} />
          <Route path="/session/:id" element={<ContentGate kind="session"><SessionReviewPage /></ContentGate>} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/master" element={<Navigate to="/admin" replace />} />
          <Route path="/bank" element={<Navigate to="/admin" replace />} />
          <Route path="/settings" element={hash === "#admin" || hash === "#master" ? <Navigate to="/admin" replace /> : <SettingsPage />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </main>
      {notesOpen && studying && !(session?.examFormat && pathname.startsWith("/paper")) && <NotesPanel onClose={() => setNotesOpen(false)} />}
      </div>
      <AmbossPanel />
      <AmbossHover />
    </div>
  );
}
