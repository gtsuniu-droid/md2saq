import { useEffect } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router";
import { db } from "./data/db";
import { loadSession } from "./lib/session";
import DashboardPage from "./pages/DashboardPage";
import ImportPage from "./pages/ImportPage";
import LibraryPage from "./pages/LibraryPage";
import QuestionPage from "./pages/QuestionPage";
import PaperPage from "./pages/PaperPage";
import MarkPage from "./pages/MarkPage";
import SessionReviewPage from "./pages/SessionReviewPage";
import BankPage from "./pages/BankPage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  const { pathname } = useLocation();

  // Drop unsubmitted attempts left behind by abandoned papers.
  useEffect(() => {
    const current = loadSession()?.id;
    void db.attempts.filter((a) => a.submittedAt === undefined && a.sessionId !== current).delete();
  }, []);

  const full = pathname.startsWith("/paper");
  return (
    <div className="app">
      <nav className="nav">
        <NavLink to="/" className="brand">SAQ</NavLink>
        <NavLink to="/" end>Coverage</NavLink>
        <NavLink to="/library">Library</NavLink>
        <NavLink to="/import">Import</NavLink>
        <NavLink to="/bank">Bank</NavLink>
        <NavLink to="/settings">Settings</NavLink>
      </nav>
      <main className={full ? "page full" : "page"}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/library" element={<LibraryPage />} />
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
