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

/** One person's answers to a code's questions, as they shared them. */
export interface SharedAnswer { index: number; text: string; parts?: SharedPart[]; score?: number; maxScore?: number }
/** One part of a shared answer: its text, and the formatted document when it is small enough to carry. */
export interface SharedPart { label: string; text: string; doc?: unknown }
export interface SharedAnswers { uid: string; name: string; photo?: string; answers: SharedAnswer[]; sharedAt: number }
/** A mark one person gave another's answer (or their own) on the marking page. */
export interface PeerMark { index: number; targetUid: string; by: string; score: number; maxScore: number; parts?: PeerPartMark[]; at: number }
/** A mark on one part of someone's answer, with the model answer's points ticked for it. */
export interface PeerPartMark { label: string; score: number; maxScore: number; pointsHit: number[] }
export interface StudyComment { id: string; uid: string; name: string; photo?: string; index: number; targetUid: string; text: string; createdAt: number }
/** Everything said about a code's answers, small enough for one blob. */
export interface StudyRoom { marks: PeerMark[]; comments: StudyComment[]; updatedAt: number }
/** What the marking page shows: the code, everyone's answers, and the room. */
export interface StudyRoomView { study: StudySession; shared: SharedAnswers[]; marks: PeerMark[]; comments: StudyComment[] }
