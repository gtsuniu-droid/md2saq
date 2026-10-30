import { useEffect, useState } from "react";
import { fetchLeaderboard, onBoard, publishWeeklyCount, type LeaderboardRow } from "./leaderboard";

/**
 * This week's board for a view that shows it. On showing, and whenever `deps` change (a
 * question submitted, a nickname changed), a signed-in student's count is published and the
 * board comes back with it. After that it stays fresh: every `everyMs` while the tab is in
 * view, at once on coming back to the tab, and whenever another page posts a newer count.
 */
export function useLeaderboard(uid: string | undefined, deps: unknown[], everyMs = 30_000): { rows: LeaderboardRow[] | null; error: string } {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        // Signed in: publish this week's count and get the board back with it, in one request.
        const board = (uid ? await publishWeeklyCount(uid).catch(() => null) : null) ?? await fetchLeaderboard();
        if (live) { setRows(board.rows); setError(""); }
      } catch (e) { if (live) setError(e instanceof Error ? e.message : "Could not load the leaderboard."); }
    })();
    return () => { live = false; };
  }, [uid, ...deps]);

  useEffect(() => {
    let live = true;
    const show = (board: { rows: LeaderboardRow[] }) => { if (live) { setRows(board.rows); setError(""); } };
    const refresh = async (publish: boolean) => {
      if (document.visibilityState !== "visible") return;
      try { show((publish && uid ? await publishWeeklyCount(uid, { ifChanged: true }).catch(() => null) : null) ?? await fetchLeaderboard()); }
      catch { /* keep what is shown */ }
    };
    const timer = setInterval(() => void refresh(false), everyMs);
    // Back to the tab: answers may have been given elsewhere in the meantime.
    const onVisible = () => void refresh(true);
    document.addEventListener("visibilitychange", onVisible);
    const off = onBoard(show);
    return () => { live = false; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); off(); };
  }, [uid, everyMs]);

  return { rows, error };
}
