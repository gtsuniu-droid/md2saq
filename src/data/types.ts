export type NoteSection = "overview" | "ddx" | "hx-exam" | "ix" | "mx" | "extras";

/** One collapsible, rich-text note attached to a core presentation. */
export interface PresentationNote {
  id: string;
  presentationId: string;
  kind: string;
  /** Older notes without a section appear in Overview. */
  section?: NoteSection;
  title: string;
  doc: unknown;
  text: string;
  source: string;
  /** Empty until local notes are claimed by the first signed-in account. */
  ownerId: string;
  createdAt: number;
  _m: number;
  revision: string;
  deleted: boolean;
}

/** A question an admin or the AI connector has marked as needing review. Shown to admins on the set page. */
export interface ReviewFlag {
  questionId: string;
  reason: string;
  flaggedAt: number;
  by?: string;
}

export interface QuestionSet {
  /** Questions flagged for review, kept with the set so every admin and chat sees them. */
  reviewFlags?: ReviewFlag[];
  /** The case’s main presenting complaint, independent of secondary question tags. */
  primaryPresentation?: string;
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
  textDoc?: unknown;
  marks?: number;
  /** Model answer for this part, when the pasted answer was sectioned by part. */
  modelAnswer?: string;
  /** Rich model answer; the plain text remains available for marking and search. */
  modelAnswerDoc?: unknown;
}

export interface Question {
  id: string;
  /** Stable question ID in the published bank, even if local IDs collide. */
  bankQuestionId?: string;
  setId: string;
  /** Position within the set. */
  order: number;
  /** Case stems shown before the question, in order. */
  stems?: string[];
  /** Rich documents aligned with stems, when edited with pictures or formatting. */
  stemDocs?: unknown[];
  images?: QuestionImage[];
  text: string;
  textDoc?: unknown;
  marks?: number;
  /** Raw model answer as pasted. Marking points are derived from it. */
  modelAnswer?: string;
  modelAnswerDoc?: unknown;
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
  /** Small history label available before the question bank downloads on a new device. */
  text?: string;
  setName?: string;
  setNumber?: number;
}

export interface AnswerComment {
  id: string;
  partLabel: string;
  start: number;
  end: number;
  quote: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  /** "marker": left with suggested marks, rather than written by the student. */
  by?: "marker";
}

export interface Attempt {
  id: string;
  /** Account that owns this attempt; empty string means device-only guest work. */
  ownerId?: string;
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
  /** Private comments anchored to text in this saved answer. */
  answerComments?: AnswerComment[];
  /** Candidate's own highlights on the stems, as character ranges per stem index. */
  stemHighlights?: { stem: number; start: number; end: number }[];
}

export interface PartMark {
  label: string;
  score: number;
  maxScore: number;
  /** Indices of marking points hit, when a model answer exists for the part. */
  pointsHit: number[];
  /** The answer rewritten for full marks, as suggested by whoever marked the set. */
  rewrite?: string;
}

export type ReviewRating = "again" | "hard" | "good" | "easy";
export interface ReviewSchedule {
  dueAt: number;
  intervalDays: number;
  ease: number;
  repetitions: number;
  lapses: number;
  reviewedAt: number;
  introducedAt: number;
  rating: ReviewRating;
}

export interface Mark {
  id: string;
  ownerId?: string;
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
  /** Personal reminder saved with this account’s marking. */
  reviewLater?: boolean;
  /** Answer was consulted during this attempt; score is assisted. */
  lookedAtAnswer?: boolean;
  reviewSchedule?: ReviewSchedule;
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
  /** Device-only AMBOSS token from the add-on login mutation. */
  ambossToken?: string;
  ambossUser?: { eid: string; firstName?: string };
  /** "platform_article" | "public_article" | "no_article" */
  ambossAccess?: string;
  /** Underline AMBOSS terms on questions and marking. */
  ambossHighlights: boolean;
  /** Also underline while sitting a paper (default off: no AMBOSS in the exam). */
  ambossOnPaper: boolean;
  /** Signed-in cloud account, for display. */
  cloudUser?: { uid: string; email?: string; name?: string; photo?: string; verified?: boolean; provider?: string };
  /** Opt-in social features. Only the chosen username is ever shown to others. */
  social?: SocialSettings;
}

export interface SocialSettings {
  /** The nickname other students see; empty means the account's first name. */
  username: string;
  /** Opted in to the weekly leaderboard; otherwise the row is kept for admins only. */
  leaderboard: boolean;
  /** When this was last saved here, so devices that disagree go with the newer choice. Unset on choices made before it was recorded. */
  chosenAt?: number;
}

/** Device-only credential record. Never included in settings, sync or backups. */
export interface RememberedAmbossLogin {
  id: "amboss";
  revision: string;
  username: string;
  userId: string;
  key: CryptoKey;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
  blocked?: boolean;
  retryAfter?: number;
}

/** A local deletion waiting to reach the cloud. */
export interface SyncDelete {
  id: string;
  ownerId?: string;
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

/** A practice or exam session, kept in localStorage until submitted and reviewed, or discarded. */
export interface Session {
  id: string;
  ownerId?: string;
  mode: "practice" | "exam";
  questionIds: string[];
  /** Whole-set sessions reveal the next bank set as the student advances. */
  studyUnit?: "questions" | "sets";
  openedSetCount?: number;
  index: number;
  /** Last focused answer part, restored when continuing. */
  activePart?: string;
  /** Writing time, excluding any reading period. */
  totalSec?: number;
  /** A fixed six-presentation paper with a continuously running clock. */
  examFormat?: "six-stem";
  readingSec?: number;
  /** Start of the clock; moved forward on resume by the time spent away. */
  startedAt: number;
  attemptIds: string[];
  /** Pauses ordinary papers; fixed-format exams ignore this field. */
  pausedAt?: number;
  /** The six-digit study code this paper was started from, when friends sit the same questions. */
  studyCode?: string;
}

/** Device-local record of one Add/Import action, retained for undo and recovery. */
export interface SetAdditionBatch {
  id: string;
  ownerId: string;
  createdAt: number;
  label: string;
  items: { set: QuestionSet; questions: Question[] }[];
  undoneIds: string[];
  status: "saved" | "undoing" | "undone" | "restored";
}
