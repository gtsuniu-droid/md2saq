import gsap from "gsap";
import { useLayoutEffect, useState, type RefObject } from "react";
import { cloudConfigured, signInWithGoogle } from "../lib/firebase";
import { score, trend, type LeaderboardPeriod, type LeaderboardRow, type LeaderboardUnit } from "../lib/leaderboard";
import { setProgressAccount } from "../lib/progressAccount";

const MEDAL = ["gold", "silver", "bronze"];

export function Avatar({ name, rank, photo }: { name: string; rank: number; photo?: string }) {
  return <span className={`lb-avatar ${MEDAL[rank - 1] ?? "plain"}`} aria-hidden="true">{photo ? <img src={photo} alt="" referrerPolicy="no-referrer" /> : name.charAt(0).toUpperCase()}</span>;
}

/** Questions or sets, the two ways the week can be counted. */
export function UnitToggle({ unit, onChange, small }: { unit: LeaderboardUnit; onChange: (u: LeaderboardUnit) => void; small?: boolean }) {
  return (
    <div className={`seg lb-seg${small ? " small" : ""}`} role="group" aria-label="What to count">
      <button type="button" className={unit === "questions" ? "on" : ""} aria-pressed={unit === "questions"} onClick={() => onChange("questions")}>Questions</button>
      <button type="button" className={unit === "sets" ? "on" : ""} aria-pressed={unit === "sets"} onClick={() => onChange("sets")}>Sets</button>
    </div>
  );
}

/** This week or all time. */
export function PeriodToggle({ period, onChange, small }: { period: LeaderboardPeriod; onChange: (p: LeaderboardPeriod) => void; small?: boolean }) {
  return (
    <div className={`seg lb-seg${small ? " small" : ""}`} role="group" aria-label="Which period">
      <button type="button" className={period === "week" ? "on" : ""} aria-pressed={period === "week"} onClick={() => onChange("week")}>This week</button>
      <button type="button" className={period === "all" ? "on" : ""} aria-pressed={period === "all"} onClick={() => onChange("all")}>All time</button>
    </div>
  );
}

function Crown() {
  return <svg className="lb-crown" data-crown viewBox="0 0 32 24" role="img" aria-label="First place"><path d="M3 20h26l2-13-8 6-7-10-7 10-8-6z" fill="#e7ab23" /><rect x="3" y="20" width="26" height="3" rx="1" fill="#c98f12" /></svg>;
}

/** The top three, first place raised in the middle. `rows` must already be sorted. */
export function Podium({ rows, unit, me, compact, period = "week" }: { rows: LeaderboardRow[]; unit: LeaderboardUnit; me: string; compact?: boolean; period?: LeaderboardPeriod }) {
  const top = rows.slice(0, 3);
  const slots: { rank: number; row?: LeaderboardRow }[] = [{ rank: 2, row: top[1] }, { rank: 1, row: top[0] }, { rank: 3, row: top[2] }];
  const word = unit === "sets" ? "sets" : "questions";
  return (
    <ol className={`lb-podium${compact ? " compact" : ""}`} aria-label="Top three">
      {slots.map(({ rank, row }) => row ? (
        <li key={row.uid} className={`lb-podium-item rank-${rank}${row.uid === me ? " me" : ""}`} data-podium={rank} value={rank}>
          {rank === 1 && <Crown />}
          <span className="lb-avatar-wrap"><Avatar name={row.name} rank={rank} photo={row.photo} /><span className="lb-rank-badge">{rank}</span></span>
          <strong className="lb-name">{row.name}{row.uid === me && <span className="lb-you">you</span>}</strong>
          <span className={`lb-count ${MEDAL[rank - 1]}`} data-count={score(row, unit, period)}>{score(row, unit, period)}</span>
          {!compact && <small className="muted">{score(row, unit, period) === 1 ? word.slice(0, -1) : word}</small>}
        </li>
      ) : <li key={`empty-${rank}`} className="lb-podium-item empty" aria-hidden="true" />)}
    </ol>
  );
}

export function TrendArrow({ row, unit }: { row: LeaderboardRow; unit: LeaderboardUnit }) {
  const t = trend(row, unit);
  const label = t === "up" ? "Up on last week" : t === "down" ? "Down on last week" : "Same as last week";
  return (
    <svg className={`lb-trend ${t}`} data-trend viewBox="0 0 10 8" role="img" aria-label={label}>
      {t === "up" ? <path d="M5 0l5 8H0z" /> : t === "down" ? <path d="M5 8L0 0h10z" /> : <rect x="0" y="3" width="10" height="2" rx="1" />}
    </svg>
  );
}

/** Everyone below the podium. */
export function BoardRows({ rows, unit, me, period = "week" }: { rows: LeaderboardRow[]; unit: LeaderboardUnit; me: string; period?: LeaderboardPeriod }) {
  if (rows.length <= 3) return null;
  return (
    <ol className="lb-list" start={4}>
      {rows.slice(3).map((r, i) => (
        <li key={r.uid} className={r.uid === me ? "me" : undefined} data-row>
          <span className="lb-pos">{i + 4}</span>
          <Avatar name={r.name} rank={99} photo={r.photo} />
          <span className="lb-row-name">{r.name}{r.uid === me && <span className="lb-you">you</span>}</span>
          <span className="lb-score">{score(r, unit, period)}{period === "week" && <TrendArrow row={r} unit={unit} />}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The entrance: second and third rise, then first; the numbers count up; the crown drops
 * onto first place; the rows slide in; each trend arrow pops. Skipped under reduced motion.
 */
export function useBoardEntrance(root: RefObject<HTMLElement | null>, deps: unknown[]): void {
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const podium = [...el.querySelectorAll<HTMLElement>("[data-podium]")];
    const counts = [...el.querySelectorAll<HTMLElement>("[data-count]")];
    const crown = el.querySelector<HTMLElement>("[data-crown]");
    const rows = [...el.querySelectorAll<HTMLElement>("[data-row]")];
    const arrows = [...el.querySelectorAll<HTMLElement>("[data-trend]")];
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!podium.length || reduced) return;
    const order = [2, 3, 1].flatMap((n) => podium.filter((p) => p.dataset.podium === String(n)));
    const tl = gsap.timeline();
    tl.from(order, { y: 42, opacity: 0, scale: 0.94, duration: 0.55, ease: "power3.out", stagger: 0.14 }, 0.1);
    for (const c of counts) {
      const target = Number(c.dataset.count ?? 0);
      const o = { v: 0 };
      c.textContent = "0";
      tl.to(o, { v: target, duration: 1.2, ease: "power3.out", onUpdate: () => { c.textContent = String(Math.round(o.v)); } }, 0.4);
    }
    if (crown) tl.from(crown, { y: -30, opacity: 0, rotation: -14, duration: 0.6, ease: "back.out(2)" }, 0.9);
    if (rows.length) tl.from(rows, { x: -18, opacity: 0, duration: 0.4, ease: "power2.out", stagger: 0.06 }, 0.7);
    if (arrows.length) tl.to(arrows, { scale: 1.4, duration: 0.25, yoyo: true, repeat: 1, ease: "power1.inOut", stagger: 0.06, transformOrigin: "50% 50%" }, 1.5);
    return () => { tl.kill(); gsap.set([...order, ...rows, ...arrows, ...(crown ? [crown] : [])], { clearProps: "all" }); for (const c of counts) c.textContent = c.dataset.count ?? ""; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** One click to sign in with Google and be able to join the board. */
export function SignInToJoin({ small = false }: { small?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const go = async () => {
    setBusy(true); setError("");
    try { await setProgressAccount(await signInWithGoogle()); }
    catch (e) { setError(e instanceof Error && /popup-closed|cancelled/.test(e.message) ? "" : "Sign-in did not go through. Try again."); }
    finally { setBusy(false); }
  };
  return (
    <span className="lb-signin">
      <button type="button" className={`button primary${small ? " small" : ""}`} disabled={busy || !cloudConfigured()} onClick={() => void go()}>{busy ? "Signing in…" : "Sign in with Google"}</button>
      {error && <span className="field-error">{error}</span>}
    </span>
  );
}
