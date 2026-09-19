export interface QuestionSet {
  id: string;
  name: string;
  source?: string;
  /** Bank or paper the set belongs to, e.g. "Dizziness SAQ Bank". */
  collection?: string;
  /** Free tags such as the conditions the case covers. */
  tags?: string[];
  /** Candidate instructions printed at the top of the paper. */
  instructions?: string;
  /** Marking principles from the answer guide. */
  markingNotes?: string;
  /** Common errors, clinical thinking and references from the answer guide. */
  debrief?: string;
  /** Time suggested by the paper itself, when it said so. */
  suggestedMinutes?: number;
  createdAt: number;
  updatedAt?: number;
  /** Set on sets imported from the shared bank, so re-imports are detected. */
  bankId?: string;
  /** The bank entry's updatedAt at the time of the last import, to detect newer versions. */
  bankUpdatedAt?: number;
}

export interface SubPart {
  label: string;
  text: string;
  marks?: number;
  /** Model answer for this part, when the pasted answer was sectioned by part. */
  modelAnswer?: string;
}

export interface Question {
  id: string;
  setId: string;
  /** Position within the set. */
  order: number;
  /** Case stems shown before the question, in order. Later stems are revealed stage by stage. */
  stems?: string[];
  text: string;
  marks?: number;
  /** Raw model answer as pasted. Marking points are derived from it. */
  modelAnswer?: string;
  parts: SubPart[];
  presentations: string[];
  tags: string[];
  createdAt: number;
}

export type ErrorTag =
  | "missed-red-flag"
  | "no-differential"
  | "didnt-justify"
  | "wrong-priority"
  | "too-vague"
  | "ran-out-of-time"
  | "knowledge-gap";

export const ERROR_TAGS: { id: ErrorTag; label: string }[] = [
  { id: "missed-red-flag", label: "Missed red flag" },
  { id: "no-differential", label: "No differential" },
  { id: "didnt-justify", label: "Didn't justify" },
  { id: "wrong-priority", label: "Wrong priority" },
  { id: "too-vague", label: "Too vague" },
  { id: "ran-out-of-time", label: "Ran out of time" },
  { id: "knowledge-gap", label: "Knowledge gap" },
];

export interface PartAnswer {
  /** Sub-part label, or "" for a question without parts. */
  label: string;
  /** Tiptap document JSON. */
  doc: unknown;
  /** Plain text, for search and hit highlighting. */
  text: string;
  flagged?: boolean;
}

export interface Attempt {
  id: string;
  questionId: string;
  answers: PartAnswer[];
  startedAt: number;
  submittedAt?: number;
  elapsedSec: number;
  timerLimitSec?: number;
  mode: "practice" | "exam";
  /** Session id for exam mode, so a paper's attempts can be marked together. */
  sessionId?: string;
  confidence?: number;
  /** Candidate's own highlights on the stems, as character ranges per stem index. */
  stemHighlights?: { stem: number; start: number; end: number }[];
}

export interface PartMark {
  label: string;
  score: number;
  maxScore: number;
  /** Indices of marking points hit, when a model answer exists for the part. */
  pointsHit: number[];
}

export interface Mark {
  id: string;
  attemptId: string;
  questionId: string;
  score: number;
  maxScore: number;
  parts: PartMark[];
  errorTags: ErrorTag[];
  reflection?: string;
  learningPoint?: string;
  notes?: string;
  markedAt: number;
}

export interface Settings {
  id: "settings";
  minutesPerMark: number;
  lastExportAt?: number;
  bankPasscode?: string;
  /** Pull any bank set not yet in the library whenever the app opens. */
  autoImportBank: boolean;
  /** AMBOSS long-lived token from the add-on login mutation. */
  ambossToken?: string;
  ambossUser?: { eid: string; firstName?: string };
  /** "platform_article" | "public_article" | "no_article" */
  ambossAccess?: string;
  /** Underline AMBOSS terms on questions and marking. */
  ambossHighlights: boolean;
  /** Also underline while sitting a paper (default off: no AMBOSS in the exam). */
  ambossOnPaper: boolean;
}

/** Cached phrase-finder result for one question. */
export interface AmbossPhrases {
  key: string;
  terms: { term: string; pgId: string }[];
  fetchedAt: number;
}

export interface AmbossDestination {
  label: string;
  articleEid?: string | null;
  anchor?: string | null;
  publicUrl?: string | null;
}

export interface AmbossMedia {
  eid: string;
  title?: string | null;
  canonicalUrl?: string | null;
  aspectRatio?: number | null;
  copyright?: { html?: string | null } | null;
}

export interface AmbossPhraseGroup {
  eid: string;
  title: string;
  synonyms: string[];
  abstract?: string | null;
  translation?: string | null;
  destinations: AmbossDestination[];
  media: AmbossMedia[];
  /** True when the abstract was withheld (no valid access). */
  paywalled?: boolean;
  fetchedAt: number;
}

export const DEFAULT_SETTINGS: Settings = { id: "settings", minutesPerMark: 1.5, autoImportBank: true, ambossHighlights: true, ambossOnPaper: false };

/** A practice or exam session, kept in sessionStorage. */
export interface Session {
  id: string;
  mode: "practice" | "exam";
  questionIds: string[];
  index: number;
  /** Total time for exam mode. */
  totalSec?: number;
  startedAt: number;
  attemptIds: string[];
}
