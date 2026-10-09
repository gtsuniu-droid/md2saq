import type { Question, QuestionSet } from "../data/types";

export interface SetPack {
  format: "saq-practice-set";
  version: 1;
  set: QuestionSet;
  questions: Question[];
}
