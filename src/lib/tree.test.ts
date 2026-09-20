import { describe, expect, it } from "vitest";
import type { SetSummary } from "./sets";
import { buildTree, filterTree, fullLabel, setPaths, setsInBranch } from "./tree";

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

  it("uses :: tags when present, allowing several branches", () => {
    expect(setPaths(summary(3, ["dizziness"], ["Dizziness::Vestibular", "MD2 :: Neuro", "Vertigo"]))).toEqual(["Dizziness::Vestibular", "MD2::Neuro"]);
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
    expect(fullLabel(summary(4, ["dizziness"]))).toBe("Dizziness – Set 04");
    expect(fullLabel(summary(5, ["dizziness"], ["Dizziness::Vestibular_neuritis"]))).toBe("Dizziness / Vestibular neuritis – Set 05");
    expect(fullLabel(summary(6, []))).toBe("Untagged – Set 06");
    expect(fullLabel(summary(12, ["dizziness"]))).toBe("Dizziness – Set 12");
  });

  it("filters by set or branch name", () => {
    const tree = buildTree([summary(1, ["dizziness"]), summary(3, ["chest-pain"])]);
    expect(filterTree(tree, "chest").map((n) => n.name)).toEqual(["Chest pain"]);
    expect(filterTree(tree, "set 1")[0].sets[0].set.number).toBe(1);
    expect(filterTree(tree, "zzz")).toEqual([]);
  });
});
