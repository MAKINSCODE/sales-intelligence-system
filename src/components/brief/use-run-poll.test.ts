import { describe, expect, it } from "vitest";
import { nextDelay } from "./use-run-poll";

const mid = () => 0.5;

describe("nextDelay", () => {
  it("checks quickly while a run is young, then eases off to save data on slow links", () => {
    expect(nextDelay(0, 0, false)).toBe(1_500);
    expect(nextDelay(29_000, 0, false)).toBe(1_500);
    expect(nextDelay(31_000, 0, false)).toBe(3_000);
    expect(nextDelay(130_000, 0, false)).toBe(5_000);
  });

  it("slows down in a background tab", () => {
    expect(nextDelay(0, 0, true)).toBe(10_000);
  });

  it("backs off exponentially while the connection is failing, up to a ceiling", () => {
    expect([1, 2, 3, 4, 5, 6, 12].map((f) => nextDelay(0, f, false, mid))).toEqual([2_000, 4_000, 8_000, 15_000, 15_000, 15_000, 15_000]);
  });

  it("spreads retries with jitter so tabs do not return together", () => {
    expect(nextDelay(0, 3, false, () => 0)).toBe(6_400);
    expect(nextDelay(0, 3, false, () => 1)).toBe(9_600);
  });

  it("a failing connection backs off even in a background tab", () => {
    expect(nextDelay(0, 1, true, mid)).toBe(2_000);
  });
});
