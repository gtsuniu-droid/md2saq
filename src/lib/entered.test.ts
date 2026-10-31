import { expect, it } from "vitest";
import { isLandingPath } from "./entered";

it("knows the front page, where the app's startup work stays off", () => {
  expect(isLandingPath("/")).toBe(true);
  expect(isLandingPath("/welcome")).toBe(true);
  for (const p of ["/home", "/browse", "/welcome/x", "/s/abc", "/paper"]) expect(isLandingPath(p)).toBe(false);
});
