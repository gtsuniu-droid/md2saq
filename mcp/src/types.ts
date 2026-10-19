/** The slice of the site's set format that the tools read and write. Unknown fields pass through untouched. */

export interface SubPart {
  label: string;
  text: string;
  textDoc?: unknown;
  marks?: number;
  modelAnswer?: string;
  modelAnswerDoc?: unknown;
}

export interface Question {
  id: string;
  setId: string;
  order: number;
  stems?: string[];
  stemDocs?: unknown[];
  text: string;
  textDoc?: unknown;
  marks?: number;
  modelAnswer?: string;
  modelAnswerDoc?: unknown;
  parts: SubPart[];
  presentations: string[];
  tags: string[];
  createdAt: number;
  [key: string]: unknown;
}

export interface QuestionSet {
  id: string;
  number?: number;
  name: string;
  source?: string;
  collection?: string;
  tags?: string[];
  primaryPresentation?: string;
  instructions?: string;
  markingNotes?: string;
  debrief?: string;
  suggestedMinutes?: number;
  createdAt: number;
  updatedAt?: number;
  [key: string]: unknown;
}

export interface SetPack {
  format: "saq-practice-set";
  version: 1;
  set: QuestionSet;
  questions: Question[];
}

/** One row of the bank index, as the site's /api/bank returns it. */
export interface BankEntry {
  id: string;
  setId?: string;
  number?: number;
  group?: string;
  name: string;
  source?: string;
  collection?: string;
  tags?: string[];
  questionCount: number;
  presentations: string[];
  uploadedAt: number;
  updatedAt?: number;
}
