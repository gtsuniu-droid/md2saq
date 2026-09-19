import { describe, expect, it } from "vitest";
import type { Question, Settings } from "../data/types";
import { remoteWins, resolveQuestionId, settingsForCloud, stripUndefined } from "./sync";

const q = (id: string, setId: string, order: number): Question => ({ id, setId, order, text: id, parts: [], presentations: [], tags: [], createdAt: 1 });

describe("sync helpers", () => {
  it("strips undefined fields deeply but keeps nulls and arrays", () => {
    expect(stripUndefined({ a: 1, b: undefined, c: { d: undefined, e: null }, f: [{ g: undefined, h: 2 }] })).toEqual({ a: 1, c: { e: null }, f: [{ h: 2 }] });
  });

  it("sends only the settings that should follow the person", () => {
    const s: Settings = { id: "settings", _m: 5, minutesPerMark: 2, autoImportBank: true, ambossHighlights: true, ambossOnPaper: false, bankPasscode: "secret", ambossToken: "tok", lastExportAt: 9 };
    const cloud = settingsForCloud(s) as Record<string, unknown>;
    expect(cloud.minutesPerMark).toBe(2);
    expect(cloud.ambossToken).toBe("tok");
    expect(cloud.bankPasscode).toBeUndefined();
    expect(cloud.lastExportAt).toBeUndefined();
    expect(cloud._m).toBe(5);
  });

  it("resolves a question by id, then by bank set and position", () => {
    const local = q("local-1", "set-a", 2);
    const byId = new Map([[local.id, local]]);
    const byBankAndOrder = new Map([["bank-x#2", local]]);
    expect(resolveQuestionId("local-1", undefined, byId, byBankAndOrder)).toBe("local-1");
    expect(resolveQuestionId("other-device-id", { setId: "s", bankId: "bank-x", order: 2 }, byId, byBankAndOrder)).toBe("local-1");
    expect(resolveQuestionId("other-device-id", { setId: "s", bankId: "bank-y", order: 2 }, byId, byBankAndOrder)).toBeNull();
    expect(resolveQuestionId("other-device-id", undefined, byId, byBankAndOrder)).toBeNull();
  });

  it("lets the newer record win", () => {
    expect(remoteWins(10, 20)).toBe(true);
    expect(remoteWins(20, 10)).toBe(false);
    expect(remoteWins(undefined, 1)).toBe(true);
    expect(remoteWins(5, undefined)).toBe(false);
  });
});
