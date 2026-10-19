import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { db, getSettings } from "../data/db";
import { PRESENTATIONS } from "../data/presentations";
import { loadLibrary } from "../lib/library";
import { loadSession } from "../lib/session";
import "../landing.css";

export function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3 2.5 20h19L12 3zm0 5.2 5.3 9.3H6.7L12 8.2z" /></svg></span>;
}

const LOGOS = [
  { src: "/landing/unimelb.png", alt: "The University of Melbourne" },
  { src: "/landing/ummss.png", alt: "University of Melbourne Medical Students' Society" },
  { src: "/landing/ummss-alt.png", alt: "UMMSS" },
];

/** Institution logos from public/landing. Files that are not there are skipped. */
function LogoStrip() {
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const shown = LOGOS.filter((l) => !missing.has(l.src));
  if (!shown.length) return null;
  return (
    <section className="landing-logos landing-reveal" aria-label="Institutions">
      <p>Made for medical students at</p>
      <ul>{shown.map((l) => <li key={l.src}><img src={l.src} alt={l.alt} loading="lazy" onError={() => setMissing((m) => new Set(m).add(l.src))} /></li>)}</ul>
    </section>
  );
}

/** A real capture of the app, in a light window frame. Files live in public/landing. */
function Screenshot({ name, alt, caption, eager }: { name: string; alt: string; caption: string; eager?: boolean }) {
  return (
    <figure className="landing-shot">
      <div className="landing-shot-bar" aria-hidden="true"><span /><span /><span /><em>{caption}</em></div>
      <img src={`/landing/${name}.png`} alt={alt} width="2880" height="1800" loading={eager ? "eager" : "lazy"} />
    </figure>
  );
}

/**
 * Motion with GSAP: SplitText for the headline, a timeline for the hero, a scrubbed lift on
 * the hero capture, ScrollTrigger reveals further down and counters for the library numbers.
 * Skipped entirely when the visitor prefers reduced motion.
 */
function useLandingMotion(root: React.RefObject<HTMLDivElement | null>, ready: boolean) {
  useEffect(() => {
    if (!ready || !root.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.registerPlugin(ScrollTrigger, SplitText);
    const ctx = gsap.context(() => {
      const headline = new SplitText(".landing-hero h1", { type: "words", wordsClass: "landing-word" });
      gsap.timeline({ defaults: { ease: "power3.out" } })
        .from(".landing-nav > *", { y: -10, opacity: 0, duration: 0.5, stagger: 0.08 })
        .from(headline.words, { yPercent: 100, opacity: 0, duration: 0.8, stagger: 0.07 }, "-=0.2")
        .from(".landing-lede, .landing-cta-row", { y: 18, opacity: 0, duration: 0.6, stagger: 0.12 }, "-=0.4")
        .from(".landing-hero-shot", { y: 60, opacity: 0, rotateX: 5, transformPerspective: 1400, duration: 1.1, ease: "power4.out" }, "-=0.5");

      gsap.to(".landing-hero-shot .landing-shot", { yPercent: -5, ease: "none", scrollTrigger: { trigger: ".landing-hero-shot", start: "top 60%", end: "bottom top", scrub: 0.6 } });

      gsap.utils.toArray<HTMLElement>("[data-count]").forEach((el) => {
        const target = Number(el.dataset.count);
        const proxy = { value: 0 };
        gsap.to(proxy, { value: target, duration: 1.2, ease: "power2.out", snap: { value: 1 }, onUpdate: () => { el.textContent = String(Math.round(proxy.value)); }, scrollTrigger: { trigger: el, start: "top 92%", once: true } });
      });

      ScrollTrigger.batch(".landing-reveal", { start: "top 88%", once: true, onEnter: (els) => gsap.from(els, { y: 24, opacity: 0, duration: 0.7, ease: "power2.out", stagger: 0.08 }) });
      gsap.utils.toArray<HTMLElement>(".landing-feature").forEach((row) => {
        const copy = row.querySelector(".landing-feature-copy");
        const shot = row.querySelector(".landing-shot");
        gsap.timeline({ scrollTrigger: { trigger: row, start: "top 80%", once: true } })
          .from(copy, { y: 24, opacity: 0, duration: 0.7, ease: "power2.out" })
          .from(shot, { y: 40, opacity: 0, rotateX: 6, transformPerspective: 1400, duration: 0.9, ease: "power3.out" }, "-=0.5");
      });
    }, root);
    return () => ctx.revert();
  }, [root, ready]);
}

export default function LandingPage() {
  const root = useRef<HTMLDivElement>(null);
  const info = useLiveQuery(async () => {
    const [{ sets, questions }, settings, attempts] = await Promise.all([loadLibrary(), getSettings(), db.attempts.count()]);
    const presentations = new Set<string>();
    for (const q of questions) for (const p of q.presentations) presentations.add(p);
    return { sets: sets.length, questions: questions.length, presentations: presentations.size, user: settings.cloudUser, attempts };
  }, []);
  useLandingMotion(root, info !== undefined);
  const returning = !!info && (info.attempts > 0 || !!info.user || !!loadSession());
  const corePresentations = PRESENTATIONS.filter((p) => !p.parent).length;
  const cta = returning ? "Continue your practice" : "Begin your practice";

  return (
    <div className="landing" ref={root}>
      <header className="landing-nav">
        <Link to="/" className="landing-brand"><BrandMark />SAQ Practice</Link>
        <Link to="/browse" className="landing-nav-link">Library</Link>
        <Link to="/home" className="landing-login">{info?.user ? "Open practice" : "Student login"} <span aria-hidden="true">↗</span></Link>
      </header>

      <section className="landing-hero">
        <h1>Strengthen your clinical thinking</h1>
        <p className="landing-lede">Timed short-answer cases for medical finals. Sit the paper, mark yourself against the model answer, and watch your coverage grow.</p>
        <div className="landing-cta-row">
          <Link to="/home" className="landing-cta">{cta} <span aria-hidden="true">→</span></Link>
          <Link to="/browse" className="landing-secondary">Browse the library</Link>
        </div>
        <div className="landing-hero-shot">
          <Screenshot name="paper" eager caption="Sitting a paper" alt="The paper screen: question parts listed down the left, the case stem in the middle, and an answer box for each part on the right, with the timer at the top." />
        </div>
        <p className="landing-stats" aria-label="Library size">
          <span><b data-count={corePresentations}>{corePresentations}</b> core presentations</span>
          {info && info.sets > 0 && <><span><b data-count={info.sets}>{info.sets}</b> {info.sets === 1 ? "case" : "cases"}</span><span><b data-count={info.questions}>{info.questions}</b> questions</span></>}
        </p>
      </section>

      <LogoStrip />

      <section className="landing-features" id="features" aria-label="What it does">
        <article className="landing-feature">
          <div className="landing-feature-copy">
            <p className="landing-kicker">Sit</p>
            <h2>A paper that behaves like the real one.</h2>
            <p>Staged case stems, sub-parts and marks, with a timer that keeps running. Leave and come back; your drafts are kept where you left them.</p>
          </div>
          <Screenshot name="paper" caption="Sitting a paper" alt="The paper screen with the case stem beside the answer boxes." />
        </article>
        <article className="landing-feature reverse">
          <div className="landing-feature-copy">
            <p className="landing-kicker">Mark</p>
            <h2>Mark yourself honestly, then move on.</h2>
            <p>Rate your confidence before the reveal, score each part against the model answer, tag the error and keep one learning point. Weak cases come back for review.</p>
          </div>
          <Screenshot name="home" caption="Choosing what to practise" alt="The home screen: progress for the period, then the session builder listing presentations with how many sets are marked in each." />
        </article>
        <article className="landing-feature">
          <div className="landing-feature-copy">
            <p className="landing-kicker">Read</p>
            <h2>Every case in the library, one click away.</h2>
            <p>Published sets reach you automatically. Read any case in full, reveal the model answer when you are ready, and share a set with a short link.</p>
          </div>
          <Screenshot name="browse" caption="Reading the library" alt="The browse screen: a list of sets on the left and the full case with its questions on the right." />
        </article>
      </section>

      <section className="landing-faq landing-reveal" id="faq" aria-labelledby="faq-heading">
        <h2 id="faq-heading">Good to know</h2>
        <details><summary>Where is my work stored?</summary><p>In your browser, on this device. Nothing leaves it unless you sign in to sync between devices or share a set with a link. You can export a backup from Settings at any time.</p></details>
        <details><summary>Do I need an account?</summary><p>No. Sign in with Google only if you want your attempts, marks and settings to follow you between devices.</p></details>
        <details><summary>Where do the questions come from?</summary><p>From a shared bank of cases built around the core presentations. New sets arrive in your library automatically when the app opens.</p></details>
      </section>

      <section className="landing-close landing-reveal">
        <h2>Ready when you are.</h2>
        <Link to="/home" className="landing-cta">{cta} <span aria-hidden="true">→</span></Link>
      </section>

      <footer className="landing-footer">
        <span className="landing-brand"><BrandMark />SAQ Practice</span>
        <nav aria-label="Footer"><Link to="/home">Practice</Link><Link to="/browse">Library</Link><Link to="/notes">Notes</Link><Link to="/settings">Settings</Link></nav>
        <small>Practice questions are teaching material, not clinical advice.</small>
      </footer>
    </div>
  );
}
