import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { db } from "../data/db";
import { DEFAULT_SETTINGS, type AnswerComment } from "../data/types";
import { GENERAL_ANCHOR, commentSegments, deleteAnswerComment, isGeneralComment, validCommentAnchor, writeAnswerComment } from "./answerComments";
const comment = (id='c'): AnswerComment => ({id,partLabel:'a',start:3,end:9,quote:'answer',text:'Explain this point',createdAt:0,updatedAt:0});
it('anchors exact occurrences and refuses stale or invalid passages',()=>{
 expect(validCommentAnchor('My answer and answer',comment())).toBe(true);
 expect(validCommentAnchor('My other answer',comment())).toBe(false);
 expect(validCommentAnchor('My answer', {...comment(),start:-1})).toBe(false);
 expect(validCommentAnchor('My answer', {...comment(),start:3.5})).toBe(false);
 const second={...comment(),start:14,end:20};
 expect(validCommentAnchor('My answer and answer',second)).toBe(true);
 expect(commentSegments('My answer and answer',[second]).filter((s)=>s.ids.length)).toEqual([{text:'answer',ids:['c']}]);
});
it('splits overlapping comments and text broken by bold markup without changing the answer',()=>{
 const comments=[comment(),{...comment('overlap'),start:6,end:13,quote:'wer and'}];
 const segments=commentSegments('My answer and',comments);
 expect(segments.map((s)=>s.text).join('')).toBe('My answer and');
 expect(segments.find((s)=>s.text==='wer')?.ids).toEqual(['c','overlap']);
 expect(commentSegments('ans',[comment()],3)).toEqual([{text:'ans',ids:['c']}]);
 expect(commentSegments('wer',[comment()],6)).toEqual([{text:'wer',ids:['c']}]);
});
beforeEach(async()=>{
 await Promise.all([db.settings.clear(),db.attempts.clear()]);
 await db.settings.put({...DEFAULT_SETTINGS,cloudUser:{uid:'alice'}});
 await db.attempts.put({id:'a',ownerId:'alice',questionId:'q',startedAt:1,submittedAt:2,elapsedSec:1,mode:'practice',answers:[{label:'a',text:'My answer',doc:null}]});
});
it('saves independent comments without changing answers, and merges edits and removals',async()=>{
 await writeAnswerComment('a',comment());
 await writeAnswerComment('a',comment('second'));
 const saved=(await db.attempts.get('a'))!;
 expect(saved.answerComments).toHaveLength(2);
 expect(saved.answers[0].text).toBe('My answer');
 expect(saved._m).toBeGreaterThan(0);
 const first=saved.answerComments![0];
 await writeAnswerComment('a',{...first,text:'Updated'},first.updatedAt);
 const edited=(await db.attempts.get('a'))!.answerComments!.find((c)=>c.id===first.id)!;
 expect(edited.text).toBe('Updated');
 await expect(writeAnswerComment('a',{...first,text:'Stale'},first.updatedAt)).rejects.toThrow('changed elsewhere');
 await expect(deleteAnswerComment('a',first.id,first.updatedAt)).rejects.toThrow('changed elsewhere');
 await deleteAnswerComment('a',edited.id,edited.updatedAt);
 expect((await db.attempts.get('a'))?.answerComments?.map((c)=>c.id)).toEqual(['second']);
});
it('rejects another account, a missing part, and unsubmitted answers',async()=>{
 await expect(writeAnswerComment('a',{...comment(),partLabel:'missing'})).rejects.toThrow('part');
 await db.settings.update('settings',{cloudUser:{uid:'bob'}});
 await expect(writeAnswerComment('a',comment())).rejects.toThrow('account');
 await db.settings.update('settings',{cloudUser:{uid:'alice'}});
 await db.attempts.update('a',{submittedAt:undefined});
 await expect(writeAnswerComment('a',comment())).rejects.toThrow('saved answer');
 expect((await db.attempts.get('a'))?.answerComments).toBeUndefined();
});
it('accepts a general comment on the whole answer and never highlights it',async()=>{
 const general={...comment('g'),...GENERAL_ANCHOR};
 expect(isGeneralComment(general)).toBe(true);
 expect(validCommentAnchor('anything',general)).toBe(true);
 expect(commentSegments('My answer',[general]).every((s)=>!s.ids.length)).toBe(true);
 await writeAnswerComment('a',general);
 expect((await db.attempts.get('a'))?.answerComments?.[0]).toMatchObject({id:'g',quote:'',start:0,end:0,text:'Explain this point'});
 await expect(writeAnswerComment('a',{...general,id:'empty',text:'  '})).rejects.toThrow('Write a comment');
 await expect(writeAnswerComment('a',{...comment('bad'),quote:''})).rejects.toThrow('Select');
});
