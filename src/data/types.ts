export interface QuestionSet {
  id: string;
  /** Running number, assigned by the bank when shared so every device agrees; provisional before that. */
  number?: number;
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
  /** True when this device has edits not yet pushed to the bank. */
  dirty?: boolean;
}

export interface QuestionImage {
  id: string;
  /** Resized picture as a data URL. */
  dataUrl: string;
  caption?: string;
  /** Shown with the stem (left column) or with the question (right column). */
  place: "stem" | "question";
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
  /** Case stems shown before the question, in order. */
  stems?: string[];
  images?: QuestionImage[];
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

/** Where a question sits in its set, so a synced record can find it on a device whose question ids differ. */
export interface QuestionRef {
  setId: string;
  bankId?: string;
  order: number;
}

export interface Attempt {
  id: string;
  questionId: string;
  qref?: QuestionRef;
  /** Last local modification, stamped by the database layer; drives cloud sync. */
  _m?: number;
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
  qref?: QuestionRef;
  _m?: number;
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
  _m?: number;
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
  /** Signed-in cloud account, for display. */
  cloudUser?: { uid: string; email?: string; name?: string; photo?: string };
}

/** A local deletion waiting to reach the cloud. */
export interface SyncDelete {
  id: string;
  table: "attempts" | "marks";
  at: number;
}

/** Sync cursors and other per-device bookkeeping that must never sync. */
export interface Meta {
  id: string;
  value: number | string;
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
