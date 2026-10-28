/** A study code's record, shared by the site and its functions. */
export interface StudyQuestion { bankId: string; order: number; text: string; marks?: number; setLabel: string }
export interface StudyParticipant { uid: string; name: string; photo?: string }
export interface StudySession {
  code: string;
  hostUid: string;
  hostName: string;
  createdAt: number;
  expiresAt: number;
  presentations: string[];
  questions: StudyQuestion[];
  /** Practice with a suggested time, or the fixed six-stem exam under the strict clock. */
  mode: "practice" | "exam";
  /** Practice time; 0 for untimed. */
  minutes: number;
  /** Exam timing, seconds. */
  readingSec?: number;
  totalSec?: number;
  participants: StudyParticipant[];
}
