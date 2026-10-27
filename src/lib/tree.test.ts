import { describe, expect, it } from "vitest";
import type { SetSummary } from "./sets";
import { buildTree, filterTree, fullLabel, searchHits, setPaths, setsInBranch, snippetAround } from "./tree";

const summary = (number: number, presentations: string[], tags: string[] = [], questions = 3): SetSummary => ({
  set: { id: `s${number}`, number, name: `Set ${number}`, tags, createdAt: number },
  questions: Array.from({ length: questions }, (_, i) => ({ id: `q${number}-${i}`, setId: `s${number}`, order: i, text: `Q${i}`, parts: [], presentations, tags: [], createdAt: 1 })),
  marks: 10,
  sittings: [],
  attemptedQuestions: 0,
  markedQuestions: 0,
  presentations,
});

describe("deck tree", () => {
  it("places a set under its presentation by default", () => {
    expect(setPaths(summary(1, ["dizziness"]))).toEqual(["Dizziness"]);
    expect(setPaths(summary(2, []))).toEqual(["Untagged"]);
  });

  it("keeps topic nesting within the primary presentation", () => {
    expect(setPaths(summary(3, ["dizziness"], ["Dizziness::Vestibular", "MD2 :: Neuro", "Vertigo"]))).toEqual(["Dizziness::Vestibular"]);
  });

  it("builds nested nodes with branch totals", () => {
    const tree = buildTree([summary(1, ["dizziness"]), summary(2, ["dizziness"], ["Dizziness::Vestibular"]), summary(3, ["chest-pain"], [], 5)]);
    expect(tree.map((n) => n.name)).toEqual(["Chest pain", "Dizziness"]);
    const dizzy = tree[1];
    expect(dizzy.emoji).toBe("🌀");
    expect(dizzy.sets.map((s) => s.set.number)).toEqual([1]);
    expect(dizzy.children.map((c) => c.path)).toEqual(["Dizziness::Vestibular"]);
    expect(dizzy.questions).toBe(6);
    expect(setsInBranch(dizzy).map((s) => s.set.number)).toEqual([1, 2]);
  });

  it("labels a set with its branch outside the tree", () => {
    expect(fullLabel(summary(4, ["dizziness"]))).toBe("Dizziness Set 04");
    expect(fullLabel(summary(5, ["dizziness"], ["Dizziness::Vestibular_neuritis"]))).toBe("Dizziness / Vestibular neuritis Set 05");
    expect(fullLabel(summary(6, []))).toBe("Untagged Set 06");
    expect(fullLabel(summary(12, ["dizziness"]))).toBe("Dizziness Set 12");
  });

  it("says where a search matched: tags, label or question content", () => {
    const s = summary(7, ["dizziness"], ["Vestibular neuritis", "Dizziness::Vestibular"]);
    s.questions[1].text = "A 42-year-old man has vertigo after a cold. List THREE diagnoses.";
    s.questions[2].modelAnswer = "1. Vestibular neuritis\n2. Labyrinthitis";
    s.questions[2].stems = ["He reports tinnitus in the left ear."];
    const hits = searchHits(s, "vestibular")!;
    expect(hits.tags).toEqual(["Vestibular neuritis", "Dizziness::Vestibular"]);
    expect(hits.label).toBe(false);
    expect(hits.questions).toEqual([{ questionId: "q7-2", number: 3, field: "model answer", snippet: "1. Vestibular neuritis 2. Labyrinthitis" }]);
    expect(searchHits(s, "vertigo")!.questions[0]).toMatchObject({ number: 2, field: "question" });
    expect(searchHits(s, "tinnitus")!.questions[0]).toMatchObject({ number: 3, field: "stem" });
    expect(searchHits(s, "set 07")!.label).toBe(true);
    expect(searchHits(s, "zzz")).toBeNull();
    expect(searchHits(s, "  ")).toBeNull();
  });

  it("cuts a snippet around the first match", () => {
    const long = "a".repeat(100) + " needle " + "b".repeat(100);
    const snip = snippetAround(long, "needle")!;
    expect(snip.startsWith("…")).toBe(true);
    expect(snip.endsWith("…")).toBe(true);
    expect(snip).toContain("needle");
    expect(snip.length).toBeLessThan(160);
    expect(snippetAround("short needle", "needle")).toBe("short needle");
    expect(snippetAround("nothing", "needle")).toBeNull();
  });

  it("filters by set or branch name", () => {
    const tree = buildTree([summary(1, ["dizziness"]), summary(3, ["chest-pain"])]);
    expect(filterTree(tree, "chest").map((n) => n.name)).toEqual(["Chest pain"]);
    expect(filterTree(tree, "set 1")[0].sets[0].set.number).toBe(1);
    expect(filterTree(tree, "zzz")).toEqual([]);
  });
});
