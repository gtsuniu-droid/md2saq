import type { Config } from "@netlify/functions";
import { firebaseEnv } from "./mcp-token";
import { verifiedUid } from "../lib/idtoken";
import { addComment, createStudy, giveMark, joinStudy, readRoom, readStudy, removeComment, shareAnswers, validPartMarks, validShared, validStudy, validWho } from "../lib/studyStore";

/**
 * Study with friends, for signed-in students (see lib/studyStore.ts).
 *   POST /api/study  { create: study }                 makes a code
 *   GET  /api/study?code=                              looks one up
 *   POST /api/study  { join: code, name, photo? }      adds the caller to it
 *   GET  /api/study/room?code=                         the code, everyone's answers, marks and comments
 *   POST /api/study/share    { code, name, photo?, answers }                the caller's answers
 *   POST /api/study/mark     { code, index, targetUid, score|null, maxScore, parts? } the caller's mark on an answer
 *   POST /api/study/comment  { code, name, photo?, index, targetUid, text }  a comment on an answer
 *   POST /api/study/uncomment { code, id }                                   takes a comment back
 * Every reply after a change carries the fresh room, so the page never shows a stale copy of its own action.
 */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const CODE = /^\d{6}$/;
const UID = /^[A-Za-z0-9_-]{1,128}$/;

export default async (req: Request): Promise<Response> => {
  const { projectId } = firebaseEnv();
  if (!projectId) return json({ error: "Sign-in is not configured on this site." }, 503);
  const uid = await verifiedUid(req, projectId);
  if (!uid) return json({ error: "Sign in first." }, 401);
  const url = new URL(req.url);
  const action = url.pathname.replace(/\/+$/, "").split("/").pop();
  try {
    if (req.method === "GET") {
      const code = url.searchParams.get("code") ?? "";
      if (!CODE.test(code)) return json({ error: "A study code has six digits." }, 400);
      if (action === "room") { const room = await readRoom(code); return room ? json(room) : json({ error: "No such code." }, 404); }
      const study = await readStudy(code);
      return study ? json(study) : json({ error: "No such code." }, 404);
    }
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
    const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    if (action === "study") {
      if (b.create !== undefined) {
        const study = validStudy(b.create);
        if (!study) return json({ error: "That study could not be read." }, 400);
        return json(await createStudy(uid, study), 201);
      }
      const who = validWho(b);
      if (typeof b.join === "string" && CODE.test(b.join) && who) {
        const study = await joinStudy(b.join, { uid, ...who });
        return study ? json(study) : json({ error: "No such code." }, 404);
      }
      return json({ error: "Send create, or join with a name." }, 400);
    }
    const code = typeof b.code === "string" && CODE.test(b.code) ? b.code : null;
    if (!code) return json({ error: "A study code has six digits." }, 400);
    const index = Number.isInteger(b.index) && (b.index as number) >= 0 && (b.index as number) <= 59 ? (b.index as number) : null;
    const targetUid = typeof b.targetUid === "string" && UID.test(b.targetUid) ? b.targetUid : null;
    if (action === "share") {
      const who = validWho(b); const answers = validShared(b.answers);
      if (!who || !answers) return json({ error: "Those answers could not be read." }, 400);
      const shared = await shareAnswers(code, uid, who, answers);
      return shared ? json(await readRoom(code)) : json({ error: "No such code." }, 404);
    }
    if (action === "mark") {
      const score = b.score === null ? null : typeof b.score === "number" && b.score >= 0 && b.score <= 1000 ? b.score : undefined;
      const maxScore = typeof b.maxScore === "number" && b.maxScore >= 0 && b.maxScore <= 1000 ? b.maxScore : undefined;
      const parts = validPartMarks(b.parts);
      if (index === null || !targetUid || score === undefined || maxScore === undefined || (score !== null && score > maxScore) || parts === null) return json({ error: "That mark could not be read." }, 400);
      const room = await giveMark(code, uid, { index, targetUid, score, maxScore, ...(parts ? { parts } : {}) });
      return room ? json(room) : json({ error: "No such code." }, 404);
    }
    if (action === "comment") {
      const who = validWho(b); const text = typeof b.text === "string" ? b.text.trim().slice(0, 1000) : "";
      if (index === null || !targetUid || !who || !text) return json({ error: "That comment could not be read." }, 400);
      const room = await addComment(code, { uid, ...who }, { index, targetUid, text });
      return room ? json(room) : json({ error: "No such code." }, 404);
    }
    if (action === "uncomment") {
      if (typeof b.id !== "string" || !b.id) return json({ error: "Which comment?" }, 400);
      const room = await removeComment(code, uid, b.id);
      return room ? json(room) : json({ error: "No such code." }, 404);
    }
    return json({ error: "Not found." }, 404);
  } catch (e) {
    // Refusals the store words for the student come back as such; anything else is a service fault.
    if (e instanceof Error && /comments it can hold|has expired|not in this session/.test(e.message)) return json({ error: e.message }, /expired/.test(e.message) ? 410 : 400);
    console.error("study:", e);
    return json({ error: "The study service is unavailable right now." }, 503);
  }
};

export const config: Config = { path: ["/api/study", "/api/study/*"] };
