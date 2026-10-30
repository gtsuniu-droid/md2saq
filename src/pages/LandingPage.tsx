import { BrandMark } from "../components/BrandMark";
import { useEffect, useRef, useState } from "react";
import { hasEntered, markEntered } from "../lib/entered";
import { useLiveQuery } from "dexie-react-hooks";
import { Link, Navigate } from "react-router";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { db, getSettings } from "../data/db";
import { PRESENTATIONS } from "../data/presentations";
import { loadLibrary } from "../lib/library";
import { loadSession } from "../lib/session";
import "../landing.css";

export { BrandMark };

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
const SHOTS = {
  paper: { width: 2000, height: 1040 },
  amboss: { width: 2000, height: 1040 },
  marking: { width: 2000, height: 1040 },
  home: { width: 682, height: 1060 },
  browse: { width: 2000, height: 1040 },
} as const;

function Screenshot({ name, alt, caption, eager }: { name: keyof typeof SHOTS; alt: string; caption: string; eager?: boolean }) {
  const size = SHOTS[name];
  return (
    <figure className="landing-shot">
      <div className="landing-shot-bar" aria-hidden="true"><span /><span /><span /><em>{caption}</em></div>
      <img src={`/landing/${name}.png`} alt={alt} width={size.width} height={size.height} loading={eager ? "eager" : "lazy"} />
    </figure>
  );
}

/**
 * Motion with GSAP: a timeline for the hero, a scrubbed lift on
 * the hero capture, ScrollTrigger reveals further down and counters for the library numbers.
 * Skipped entirely when the visitor prefers reduced motion.
 */
function useLandingMotion(root: React.RefObject<HTMLDivElement | null>, ready: boolean) {
  useEffect(() => {
    if (!ready || !root.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      gsap.timeline({ defaults: { ease: "power3.out" } })
        .from(".landing-nav > *", { y: -10, opacity: 0, duration: 0.5, stagger: 0.08 })
        .from(".landing-hero h1", { y: 28, opacity: 0, duration: 0.9 }, "-=0.2")
        .from(".landing-lede, .landing-cta-row, .landing-stats", { y: 18, opacity: 0, duration: 0.6, stagger: 0.12 }, "-=0.5")
        .from(".landing-hero-shot", { x: 40, opacity: 0, rotateY: -6, transformPerspective: 1400, duration: 1.1, ease: "power4.out" }, "-=0.8");

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

/**
 * The public front page. With autoEnter, visitors who are signed in or have used the app
 * before skip it and land on Home; /welcome always shows it.
 */
export default function LandingPage({ autoEnter = false }: { autoEnter?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const info = useLiveQuery(async () => {
    const [{ sets, questions }, settings, attempts] = await Promise.all([loadLibrary(), getSettings(), db.attempts.count()]);
    const presentations = new Set<string>();
    for (const q of questions) for (const p of q.presentations) presentations.add(p);
    return { sets: sets.length, questions: questions.length, presentations: presentations.size, user: settings.cloudUser, attempts };
  }, []);
  const entered = hasEntered();
  const returning = !!info && (info.attempts > 0 || !!info.user || !!loadSession() || entered);
  const skip = autoEnter && returning;
  useLandingMotion(root, info !== undefined && !skip);
  if (info === undefined && autoEnter) return <div className="landing" aria-busy="true" />;
  if (skip) return <Navigate to="/home" replace />;
  const corePresentations = PRESENTATIONS.filter((p) => !p.parent).length;
  const cta = returning ? "Continue your practice" : "Begin your practice";

  return (
    <div className="landing" ref={root}>
      <header className="landing-nav">
        <Link to="/welcome" className="landing-brand"><BrandMark />SAQ Practice</Link>
        <Link onClick={markEntered} to="/browse" className="landing-nav-link">Library</Link>
        <Link onClick={markEntered} to="/home" className="landing-login">{info?.user ? "Open practice" : "Student login"} <span aria-hidden="true">↗</span></Link>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <h1>Strengthen your clinical thinking</h1>
          <p className="landing-lede">Timed short-answer cases for medical finals that train your differential diagnosis, history taking and clinical reasoning. Writing the answer yourself, then marking it against the model, is how it sticks.</p>
          <div className="landing-cta-row">
            <Link onClick={markEntered} to="/home" className="landing-cta">{cta} <span aria-hidden="true">→</span></Link>
            <Link onClick={markEntered} to="/browse" className="landing-secondary">Browse the library</Link>
          </div>
          <p className="landing-stats" aria-label="Library size">
            <span><b data-count={corePresentations}>{corePresentations}</b> core presentations</span>
            {info && info.sets > 0 && <><span><b data-count={info.sets}>{info.sets}</b> {info.sets === 1 ? "case" : "cases"}</span><span><b data-count={info.questions}>{info.questions}</b> questions</span></>}
          </p>
        </div>
        <div className="landing-hero-shot">
          <Screenshot name="paper" eager caption="Sitting a paper" alt="The paper screen: question parts listed down the left, the case stem in the middle, and an answer box for each part on the right, with the timer at the top." />
        </div>
      </section>

      <LogoStrip />

      <section className="landing-features" id="features" aria-label="What it does">
        <article className="landing-feature wide">
          <div className="landing-feature-copy">
            <p className="landing-kicker">AMBOSS, built in</p>
            <h2>The reference opens beside the question.</h2>
            <p>Connect your AMBOSS account and every clinical term in a stem, question or model answer becomes a link. Hover for the definition, open the article or its images in a side panel, and get back to your answer without leaving the page. It works in notes and while marking too.</p>
            <p className="landing-fineprint">Needs an AMBOSS subscription. Your login stays on your device.</p>
          </div>
          <Screenshot name="amboss" caption="Browse, with AMBOSS open" alt="The browse screen with an AMBOSS reference panel open on the right showing the Abscess article, its picture and definition." />
        </article>
        <article className="landing-feature reverse">
          <div className="landing-feature-copy">
            <p className="landing-kicker">Mark</p>
            <h2>Thorough marked answers that teach.</h2>
            <p>Every question comes with a full model answer: the diagnoses to consider, the history and examination findings that earn the marks, and why. Score yourself line by line, and each marked case adds to your knowledge base and sharpens your clinical thinking.</p>
          </div>
          <Screenshot name="marking" caption="Marking a set" alt="The marking screen: the case stem on the left and a full model answer on the right, listing the marks available for each diagnosis, history finding and examination finding." />
        </article>
        <article className="landing-feature tall">
          <div className="landing-feature-copy">
            <p className="landing-kicker">Practise</p>
            <h2>Pick a presentation. Sit the case.</h2>
            <p>Choose whole cases or single questions from the presentations you want to cover and answer against the clock. Your progress for every presentation is on the same screen, so you always know what to do next.</p>
          </div>
          <Screenshot name="home" caption="Choosing what to practise" alt="The home screen: answered count, score and practice calendar, then the session builder listing presentations with how many sets are marked in each." />
        </article>
        <article className="landing-feature reverse">
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
        <details><summary>Where is my work stored?</summary><p>In your browser on this device, and in your account once you sign in, so it is there on your other devices too. You can export a backup from Settings at any time.</p></details>
        <details><summary>Do I need an account?</summary><p>Yes, after a short try: your first two questions are free without one. A free account, with Google or an email address, keeps your attempts, marks and notes, lets them follow you between devices, and lets you join the discussion on any question.</p></details>
        <details><summary>Where do the questions come from?</summary><p>From a shared bank of cases built around the core presentations. New sets arrive in your library automatically when the app opens.</p></details>
      </section>

      <section className="landing-close landing-reveal">
        <h2>Reading feels productive. Answering is what sticks.</h2>
        <p>Every case makes you commit to a differential, ask the right history questions and justify a plan, then shows you what you missed. That is the learning.</p>
        <Link onClick={markEntered} to="/home" className="landing-cta">{cta} <span aria-hidden="true">→</span></Link>
      </section>

      <footer className="landing-footer">
        <span className="landing-brand"><BrandMark />SAQ Practice</span>
        <nav aria-label="Footer">
          <Link onClick={markEntered} to="/home">Practice</Link><Link onClick={markEntered} to="/browse">Library</Link><Link onClick={markEntered} to="/notes">Notes</Link><Link onClick={markEntered} to="/settings">Settings</Link>
          <a href="https://github.com/gtsuniu-droid/md2saq">Project</a>
          <a href="https://github.com/gtsuniu-droid/md2saq/blob/main/CODE_OF_CONDUCT.md">Code of Conduct</a>
          <a href="https://github.com/gtsuniu-droid/md2saq/blob/main/LICENSE">Apache 2.0 licence</a>
        </nav>
        <small>Practice questions are teaching material, not clinical advice.</small>
      </footer>
    </div>
  );
}
