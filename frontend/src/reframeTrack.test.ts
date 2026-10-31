// Per-shot framing in the editor preview must match the export (reframe.track_center_at).
import { describe, expect, it } from "vitest";
import { aspectValue, centerAt, objectPositionFor, parseTrack, previewCenter } from "./reframeTrack";

const track = { start: 10, end: 40, shots: [{ start: 10, center: 0.65 }, { start: 15, center: 0.5 }, { start: 26, center: 0.86 }] };

describe("centerAt", () => {
  it("holds each shot's position until the next cut", () => {
    expect(centerAt(track, 10)).toBe(0.65);
    expect(centerAt(track, 14.99)).toBe(0.65);
    expect(centerAt(track, 15)).toBe(0.5);
    expect(centerAt(track, 30)).toBe(0.86);
  });
  it("uses the first shot before the track starts, and a fallback with no track", () => {
    expect(centerAt(track, 2)).toBe(0.65);
    expect(centerAt(null, 2, 0.3)).toBe(0.3);
  });
});

describe("previewCenter", () => {
  it("follows the track while the crop is automatic", () => {
    expect(previewCenter(track, 0.62, 0.62, 27)).toBe(0.86);
  });
  it("uses the hand-placed position once the user moves the crop", () => {
    expect(previewCenter(track, 0.62, 0.4, 27)).toBe(0.4);
  });
});

describe("parseTrack", () => {
  it("accepts a stored track and rejects junk", () => {
    expect(parseTrack(JSON.stringify(track))?.shots).toHaveLength(3);
    expect(parseTrack("not json")).toBeNull();
    expect(parseTrack(JSON.stringify({ shots: [] }))).toBeNull();
    expect(parseTrack(null)).toBeNull();
  });
});

describe("objectPositionFor (preview shows the export's crop window)", () => {
  const src = 16 / 9;   // 1280x720 into 9:16: the crop is 405 px of 1280
  it("is 50% at dead centre", () => {
    expect(objectPositionFor(0.5, src)).toBeCloseTo(50, 5);
  });
  it("matches the export's clamped crop x off-centre", () => {
    // export: x = 0.6476*1280 - 202.5 = 626.4 of a 875 px overflow -> 71.6%
    expect(objectPositionFor(0.6476, src)).toBeCloseTo((0.6476 * 1280 - 202.5) / 875 * 100, 0);
  });
  it("clamps at the edges like the export", () => {
    expect(objectPositionFor(0.95, src)).toBe(100);
    expect(objectPositionFor(0.02, src)).toBe(0);
  });
  it("needs no positioning when the source is already narrower than the target", () => {
    expect(objectPositionFor(0.8, 9 / 16)).toBe(50);
  });
  it("parses aspect strings", () => {
    expect(aspectValue("1:1")).toBe(1);
    expect(aspectValue(undefined)).toBeCloseTo(0.5625);
  });
});
