export interface QuestionSet {
  id: string;
  name: string;
  source?: string;
  createdAt: number;
  /** Set on sets imported from the shared bank, so re-imports are detected. */
  bankId?: string;
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
}

export const DEFAULT_SETTINGS: Settings = { id: "settings", minutesPerMark: 1.5 };

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
