import { useEffect } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router";
import { db, getSettings } from "./data/db";
import { loadSession } from "./lib/session";
import { syncFromBank } from "./lib/bank";
import { useLiveQuery } from "dexie-react-hooks";
import DashboardPage from "./pages/DashboardPage";
import CreatePage from "./pages/CreatePage";
import BrowsePage from "./pages/BrowsePage";
import QuestionPage from "./pages/QuestionPage";
import SetPage from "./pages/SetPage";
import SetEditPage from "./pages/SetEditPage";
import PaperPage from "./pages/PaperPage";
import MarkPage from "./pages/MarkPage";
import SessionReviewPage from "./pages/SessionReviewPage";
import BankPage from "./pages/BankPage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  const { pathname } = useLocation();
  const unlocked = useLiveQuery(async () => !!(await getSettings()).bankPasscode, []) ?? false;

  // Drop unsubmitted attempts left behind by abandoned papers.
  useEffect(() => {
    const current = loadSession()?.id;
    void db.attempts.filter((a) => a.submittedAt === undefined && a.sessionId !== current).delete();
    // Pull new sets from the shared bank. Silently does nothing when the bank is unreachable.
    void (async () => {
      const settings = await getSettings();
      if (settings.autoImportBank === false) return;
      try {
        await syncFromBank();
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
        <NavLink to="/" end>Coverage</NavLink>
        <NavLink to="/browse">Browse</NavLink>
        <NavLink to="/bank">Bank</NavLink>
        <NavLink to="/settings">Settings</NavLink>
        <span style={{ flex: 1 }} />
        <NavLink to="/create" title={unlocked ? "Creator tools" : "Creator tools, passcode needed"}>Create</NavLink>
      </nav>
      <main className={full ? "page full" : "page"}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/create" element={<CreatePage />} />
          <Route path="/browse" element={<BrowsePage />} />
          <Route path="/set/:id" element={<SetPage />} />
          <Route path="/set/:id/edit" element={<SetEditPage />} />
          <Route path="/question/:id" element={<QuestionPage />} />
          <Route path="/paper" element={<PaperPage />} />
          <Route path="/mark/:attemptId" element={<MarkPage />} />
          <Route path="/session/:id" element={<SessionReviewPage />} />
          <Route path="/bank" element={<BankPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
