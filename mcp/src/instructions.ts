/**
 * Server-level guidance sent with the initialize result, the context the
 * individual tool descriptions assume.
 */
export const SERVER_INSTRUCTIONS = [
  "This server reads and edits the shared question bank of an SAQ Practice site (short-answer question practice for medical finals).",
  "A set is one clinical case: a case stem, then numbered questions, each with optional parts (a), (b)… carrying marks and a model answer. Students sit a set under a timer, then mark themselves against the model answers.",
  "Start with listSets or findQuestions to locate a set, then getSet to read it with question numbers and ids before editing.",
  "Edits publish immediately to every student's library, so read the current text first and change only what was asked. Quote the new text back to the user in the reply.",
  "Model answers are marking guides: one point per line, each with its mark in square brackets where the set uses that style, e.g. \"- [1 mark] ...\". Keep the existing style of the set.",
  "When a question or model answer was written with pictures or formatting (hasRichText / hasRichModelAnswer is true), replacing its text drops that formatting; say so before doing it.",
  "deleteSet and removeQuestion are permanent and also remove students' attempts on those questions from their devices; they run only with confirmDeletion true, after the user has confirmed.",
].join(" ");
