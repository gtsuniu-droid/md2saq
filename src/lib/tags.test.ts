import { describe, expect, it } from "vitest";
import { knownTags, suggestConditionTags } from "./tags";

describe("tag suggestions", () => {
  it("pulls conditions out of diagnosis-style model answers", () => {
    const tags = suggestConditionTags([
      {
        text: "List THREE plausible diagnoses that could account for this patient's dizziness.",
        modelAnswer: "1. Vestibular neuritis\n   Mechanism: Acute unilateral vestibular dysfunction.\n2. Posterior circulation ischaemic stroke\n   Mechanism: Ischaemia.\n3. Labyrinthitis\nOther acceptable differentials when justified:\n- Vestibular migraine if prior episodes",
        parts: [],
      },
      { text: "Give TWO immediate supportive measures.", modelAnswer: "- [1 marks] Short-term antiemetic", parts: [] },
      { text: "Explain why a unilateral vestibular disturbance can cause both nystagmus and nausea.", modelAnswer: "- [1 marks] Conflicting vestibular, visual and proprioceptive information activates emetic pathways.", parts: [] },
    ]);
    expect(tags).not.toContain("Conflicting vestibular");
    expect(tags).not.toContain("Interpretation");
    expect(tags).toEqual(expect.arrayContaining(["Vestibular neuritis", "Posterior circulation ischaemic stroke", "Labyrinthitis"]));
    expect(tags).not.toContain("Mechanism");
    expect(tags).not.toContain("Short-term antiemetic");
  });

  it("offers existing tags, their branch prefixes and presentation names", () => {
    const k = knownTags(["Dizziness::Vestibular::Set_01", "Aortic dissection"]);
    expect(k).toContain("Dizziness::Vestibular");
    expect(k).toContain("Dizziness");
    expect(k).toContain("Aortic dissection");
    expect(k).toContain("Chest pain");
  });
});
