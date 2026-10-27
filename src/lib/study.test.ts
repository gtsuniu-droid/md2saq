import { expect, it } from "vitest";
import { formatCode, newCode, normaliseCode } from "./study";

it("makes six-digit codes and tidies what people type", () => {
  expect(newCode(() => 0)).toBe("100000");
  expect(newCode(() => 0.999999)).toBe("999999");
  expect(newCode()).toMatch(/^[1-9]\d{5}$/);
  expect(normaliseCode(" 482 917 ")).toBe("482917");
  expect(normaliseCode("48-29-17-99")).toBe("482917");
  expect(formatCode("482917")).toBe("482 917");
});
