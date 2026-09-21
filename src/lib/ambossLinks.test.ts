import { describe, expect, it } from "vitest";
import { destinationUrl, safeAmbossUrl } from "./amboss";
import { ambossTextFingerprint, noteLookupText } from "./ambossNotes";

describe("AMBOSS note references", () => {
  it("preserves exact article sections with tracking in the query, not the fragment", () => {
    const url = new URL(destinationUrl({ label: "Examination", articleEid: "XL09wg", anchor: "section-id" }, undefined, "abdominal pain")!);
    expect(url.pathname).toBe("/us/article/XL09wg");
    expect(url.hash).toBe("#section-id");
    expect(url.searchParams.get("utm_term")).toBe("abdominal pain");
  });
  it("keeps the public destination and its anchor for public article access", () => {
    const url = new URL(destinationUrl({ label: "Example", articleEid: "member", publicUrl: "https://library.amboss.com/us/knowledge/example?x=1#diagnostics" }, "public_article", "test")!);
    expect(url.hostname).toBe("library.amboss.com");
    expect(url.searchParams.get("x")).toBe("1");
    expect(url.hash).toBe("#diagnostics");
  });
  it("does not turn untrusted URLs into article links", () => {
    for (const url of ["javascript:alert(1)", "https://amboss.com.evil.test/a", "https://amboss.com@evil.test/a", "https://evil.test/a", "http://amboss.com/a", "https://next.amboss.com:8080/a"]) expect(safeAmbossUrl(url)).toBeNull();
    expect(destinationUrl({ label: "Bad", publicUrl: "https://evil.test" }, "public_article", "x")).toBeNull();
  });
  it("reads formatted words together but separates table cells and paragraphs", () => {
    const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
    const doc = { type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "abdominal " }, { type: "text", text: "pain", marks: [{ type: "bold" }] }] },
      { type: "table", content: [{ type: "tableRow", content: [
        { type: "tableCell", content: [paragraph("renal colic"), paragraph("history")] },
        { type: "tableCell", content: [paragraph("examination")] },
      ] }] },
    ] };
    expect(noteLookupText(doc)).toBe("abdominal pain\nrenal colic\nhistory\nexamination");
    expect(ambossTextFingerprint(noteLookupText(doc))).not.toBe(ambossTextFingerprint("edited note"));
    expect(ambossTextFingerprint(noteLookupText(doc))).toBe(ambossTextFingerprint(noteLookupText(doc)));
  });
});
