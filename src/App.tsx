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
import LeaderboardPage from "./pages/LeaderboardPage";
import StudyPage from "./pages/StudyPage";
import NoticesBell from "./components/NoticesBell";
import LandingPage, { BrandMark } from "./pages/LandingPage";
import AmbossPanel from "./components/AmbossPanel";
import AmbossHover from "./components/AmbossHover";
import { restoreAmbossSession } from "./lib/amboss";
import { authErrorMessage, cloudConfigured, onCloudUser, refreshVerification, resendVerification, signOutCloud, type CloudUser } from "./lib/firebase";
import SignInPanel from "./components/SignInPanel";
import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState } from "react";
import { recordDeletes, requestSync, startSyncLoop, syncNow } from "./lib/sync";
import { touchMember } from "./lib/members";
import { setAdminRole } from "./lib/adminRole";
import { hasEntered, markEntered } from "./lib/entered";
import { patchSettings } from "./data/db";

function AccountButton() {
  const settings = useLiveQuery(getSettings, []);
  const nav = useNavigate();
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
    <>
      <button className="small nav-signin" onClick={() => setOpen(true)}>Sign in</button>
      {open && <SignInDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/** The sign-in panel in a modal, from the Sign in button in the bar. */
function SignInDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); return () => { if (d?.open) d.close(); }; }, []);
  return (
    <dialog ref={ref} className="confirm-dialog signin-dialog" aria-labelledby="signin-title" onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="confirm-dialog-body">
        <div className="row spread"><h2 id="signin-title">Sign in</h2><button type="button" className="small link" aria-label="Close" onClick={onClose}>×</button></div>
        <p className="muted signin-why">Your attempts, marks and notes then follow you between devices, and you can join the discussion on any question.</p>
        <SignInPanel onDone={() => onClose()} />
      </div>
    </dialog>
  );
}

/** Shown to email accounts until the address is confirmed. */
function VerifyBar({ user }: { user: CloudUser }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const check = async () => {
    setBusy(true); setNote("");
    try {
      const fresh = await refreshVerification();
      if (fresh?.verified) await setProgressAccount(fresh);
      else setNote("Not confirmed yet. Open the link in the email we sent, then try again.");
    } catch (e) { setNote(authErrorMessage(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="verify-bar" role="status">
      <span>Confirm your email to post comments: we sent a link to <strong>{user.email}</strong>.</span>
      <span className="row">
        <button className="small" disabled={busy} onClick={() => void check()}>I've confirmed it</button>
        <button className="small link" disabled={busy} onClick={() => void (async () => { setBusy(true); setNote(""); try { await resendVerification(); setNote("Sent again."); } catch (e) { setNote(authErrorMessage(e)); } finally { setBusy(false); } })()}>Resend</button>
        {note && <span className="muted">{note}</span>}
      </span>
    </div>
  );
}

export default function App() {
  const { pathname, hash } = useLocation();
  const account = useLiveQuery(getSettings, []);
  const session = useSession();
  const [notesOpen, setNotesOpen] = useState(false);
  const studying = /^\/(mark|paper|question|set|session|history)(\/|$)/.test(pathname);
  useEffect(() => { document.querySelector("main")?.scrollTo(0, 0); }, [pathname]);

  // An email address confirmed in another tab shows as confirmed here on the next return.
  useEffect(() => {
    if (account?.cloudUser?.verified !== false) return;
    const onReturn = () => { if (document.visibilityState === "visible") void refreshVerification().then((fresh) => { if (fresh?.verified) void setProgressAccount(fresh); }); };
    document.addEventListener("visibilitychange", onReturn);
    return () => document.removeEventListener("visibilitychange", onReturn);
  }, [account?.cloudUser?.verified]);

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
        // Record the sign-in and read any admin role granted from the People list. The role
        // stays in memory; touching settings makes the screens that depend on it re-render.
        void touchMember(u).then((role) => { setAdminRole(u.uid, role); return patchSettings({}); });
      } else {
        setAdminRole("", undefined);
      }
    }).then((fn) => { unsub = fn; });
    return () => {
      stopLoop();
      stopSession();
      unsub?.();
    };
  }, []);

  // Sets are published, edited and deleted from several places (Admin, Browse, Create, the
  // AI connector), so an open tab re-reads the catalogue when it comes back into view and
  // every ten minutes, not only when the app opens.
  useEffect(() => {
    if (/^\/(shared|s)\//.test(window.location.pathname)) return;
    let last = Date.now();
    const refresh = async (force = false) => {
      if (document.visibilityState !== "visible" || (!force && Date.now() - last < 2 * 60_000)) return;
      if ((await getSettings()).autoImportBank === false) return;
      last = Date.now();
      try { if (await syncFromBank()) requestSync(0); } catch { /* offline */ }
    };
    const onVisible = () => { void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    const timer = setInterval(() => void refresh(true), 10 * 60_000);
    return () => { document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); window.removeEventListener("online", onVisible); clearInterval(timer); };
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

  // An exam cannot be left: no bar, no other page, until the paper is submitted and reviewed.
  const examLocked = session?.mode === "exam" && !pathname.startsWith("/session/");
  if (examLocked && pathname !== "/paper") return <Navigate to="/paper" replace />;

  // The front page is for newcomers; anyone signed in or who has practised before goes straight in.
  if (pathname === "/" || pathname === "/welcome") return <LandingPage autoEnter={pathname === "/"} />;
  // A newcomer who arrives at any app page sees the welcome page first. Shared links still open directly.
  const sharedLink = /^\/(s|shared)\//.test(pathname);
  if (!hasEntered() && !sharedLink && !session) {
    if (account === undefined) return null;
    if (!account.cloudUser) return <Navigate to="/welcome" replace />;
  }
  if (pathname === "/home") markEntered();

  const full = /^\/(paper|mark)(\/|$)/.test(pathname);
  const shell = full ? "page full" : pathname === "/home" ? "page home-shell" : pathname === "/browse" ? "page browse-shell" : pathname === "/settings" ? "page settings-shell" : pathname === "/admin" ? "page admin-shell" : "page wide-shell";
  return (
    <div className="app">
      {examLocked ? <div className="nav exam-bar" aria-label="Exam in progress"><span className="brand"><BrandMark />SAQ Practice</span><span className="exam-bar-note">Exam in progress. Submit the paper to leave.</span></div> : <nav className="nav">
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
        {account?.cloudUser && <NoticesBell canPost={isAdmin(account)} uid={account.cloudUser.uid} />}
        <AccountButton />
      </nav>}
      {account?.cloudUser && account.cloudUser.verified === false && !full && <VerifyBar user={account.cloudUser} />}
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
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/study/:code" element={<StudyPage />} />
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
