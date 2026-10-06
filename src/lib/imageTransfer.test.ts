import { expect, it } from "vitest";
import { hasFileTransfer, imageTransferFiles, isImageFile } from "./imageTransfer";
import { hasAnswerContent } from "./answerContent";
const file = { name: "Screenshot.png", type: "image/png", size: 42, lastModified: 1 } as File;
const item = (f: File) => ({ kind: "file", type: f.type, getAsFile: () => f });
const transfer = (files: File[], items: unknown[] = [], types: string[] = []) => ({ files, items, types }) as unknown as DataTransfer;
it("reads files and item-only screenshot clipboard data without inserting duplicates", () => {
  expect(imageTransferFiles(transfer([], [item(file)]))).toEqual([file]);
  expect(imageTransferFiles(transfer([file], [item({ ...file })]))).toEqual([file]);
  expect(imageTransferFiles(null)).toEqual([]);
});
it("recognises screenshot drags with missing or generic MIME types", () => {
  expect(isImageFile({ name: "Screenshot.PNG", type: "" })).toBe(true);
  expect(isImageFile({ name: "Screenshot.png", type: "application/octet-stream" })).toBe(true);
  expect(isImageFile({ name: "document.pdf", type: "application/pdf" })).toBe(false);
  expect(hasFileTransfer(transfer([], [], ["Files"]))).toBe(true);
  expect(hasFileTransfer(transfer([], [item({ ...file, type: "" })]))).toBe(true);
  expect(hasFileTransfer(transfer([], [], ["text/plain"]))).toBe(false);
});
it("counts image-only practice answers while leaving empty documents unanswered", () => {
  expect(hasAnswerContent({ text: "", doc: { type: "doc", content: [{ type: "image", attrs: { src: "data:image/png;base64,abc" } }] } })).toBe(true);
  expect(hasAnswerContent({ text: "", doc: { type: "doc", content: [{ type: "paragraph" }] } })).toBe(false);
  expect(hasAnswerContent({ text: "My answer", doc: null })).toBe(true);
});
