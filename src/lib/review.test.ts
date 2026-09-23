import { expect, it } from "vitest";
import type { Attempt, Mark, Question, QuestionSet } from "../data/types";
import { historyEntries } from "./history";
import { reviewTopics, savedReviewNotes } from "./review";
const question: Question = {id:'q',setId:'s',order:0,text:'Question',presentations:['vomiting'],parts:[],tags:[],createdAt:1};
const set: QuestionSet = {id:'s',name:'Case',primaryPresentation:'abdominal-pain',createdAt:1};
const attempt = (id: string, date=1, ownerId='alice'): Attempt => ({id,questionId:'q',ownerId,submittedAt:date,startedAt:1,elapsedSec:1,mode:'practice',answers:[]});
const mark = (id: string, changes: Partial<Mark> = {}): Mark => ({id,attemptId:id,ownerId:'alice',questionId:'q',score:1,maxScore:4,parts:[],errorTags:[],markedAt:1,...changes});
const entries = (attempts: Attempt[], marks: Mark[]) => historyEntries(attempts,marks,[question],[set],'alice');
it('groups weak and assisted attempts by the primary presentation',()=>{
 const topics=reviewTopics(entries([attempt('a')],[mark('a',{lookedAtAnswer:true,score:4})]));
 expect(topics[0].id).toBe('abdominal-pain');
 expect(topics[0].entries[0].reasons).toEqual(['Looked at answer']);
});
it('uses the latest submitted attempt so a successful unaided retry clears old weaknesses',()=>{
 const e=entries([attempt('old'),attempt('new',3)],[mark('old',{reviewLater:true,notes:'Keep this old note'}),mark('new',{score:4})]);
 expect(reviewTopics(e)).toEqual([]);
 expect(savedReviewNotes(e[1])).toBe('Keep this old note');
});
it('keeps manually flagged high scores, ignores zero-maximum scores, and respects the 60% boundary',()=>{
 expect(reviewTopics(entries([attempt('a')],[mark('a',{score:3,maxScore:5})]))).toEqual([]);
 expect(reviewTopics(entries([attempt('a')],[mark('a',{score:0,maxScore:0})]))).toEqual([]);
 expect(reviewTopics(entries([attempt('a')],[mark('a',{score:4,reviewLater:true})]))[0].entries[0].reasons).toEqual(['Flagged']);
 expect(reviewTopics(entries([attempt('a')],[mark('a')]))[0].entries[0].reasons).toEqual(['Below 60%']);
});
it('keeps accounts separate and preserves old written reflections in saved notes',()=>{
 expect(reviewTopics(entries([attempt('bob',1,'bob')],[mark('bob',{ownerId:'bob'})]))).toEqual([]);
 const e=entries([attempt('a')],[mark('a',{notes:'My note',reflection:'Older saved reflection',learningPoint:'Learning point'})]);
 expect(savedReviewNotes(e[0])).toBe('My note\n\nOlder saved reflection\n\nLearning point');
});

it('keeps an earlier weakness visible while a retry is awaiting marking',()=>{
 const e=entries([attempt('old'),attempt('new',3)],[mark('old')]);
 expect(reviewTopics(e)[0].entries[0].entry.attempt.id).toBe('old');
});
