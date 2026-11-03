// First-run welcome: shown once, remembered, never stuck when storage is unavailable.
import { describe, expect, it } from "vitest";
import { markOnboarded, ONBOARDING_KEY, ONBOARDING_STEPS, shouldShowOnboarding } from "./Onboarding";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("onboarding", () => {
  it("shows on first launch and not after it is dismissed", () => {
    const s = memory();
    expect(shouldShowOnboarding(s)).toBe(true);
    markOnboarded(s);
    expect(s.getItem(ONBOARDING_KEY)).toBe("1");
    expect(shouldShowOnboarding(s)).toBe(false);
  });
  it("never blocks the app when storage throws or is missing", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(shouldShowOnboarding(broken)).toBe(false);
    expect(() => markOnboarded(broken)).not.toThrow();
    expect(shouldShowOnboarding(null)).toBe(false);
  });
  it("is three short plain-language steps", () => {
    expect(ONBOARDING_STEPS).toHaveLength(3);
    for (const s of ONBOARDING_STEPS) expect(s.body.length).toBeLessThan(140);
  });
});
