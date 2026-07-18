// Tests for the derived ticket display-state mapper.
//
// Runs under Node's built-in test runner with native TypeScript type-stripping — no
// vitest/jest/tsx install required:  node --test src/lib/ticketStatus.test.ts
// (Node >= 22.6 with type stripping; enabled by default on Node >= 23.6 / 24.)
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Ticket } from "../api";
import {
  deriveTicketState,
  phaseOfStage,
  isActionable,
  sortByPriority,
  PRIORITY_ORDER,
} from "./ticketStatus.ts";

// Minimal Ticket factory — only the fields the mapper reads matter.
function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 1,
    brand: "NoCrapDiet",
    stage: "scripted",
    angle: "",
    format: "reel",
    capture_mode: "native-short",
    source_ref: "",
    hook_text: "",
    platforms: [],
    created_at: "2026-07-18T00:00:00Z",
    ...over,
  } as Ticket;
}

test("stage → phase bucketing matches the redesign mapping", () => {
  assert.equal(phaseOfStage("outlier"), "plan");
  assert.equal(phaseOfStage("scripted"), "plan");
  assert.equal(phaseOfStage("staged"), "plan");
  assert.equal(phaseOfStage("sourced"), "produce");
  assert.equal(phaseOfStage("assembled"), "produce");
  assert.equal(phaseOfStage("ready"), "review");
  assert.equal(phaseOfStage("scheduled"), "publish");
  assert.equal(phaseOfStage("posted"), "publish");
  assert.equal(phaseOfStage("garbage-unknown"), "plan"); // safe default
});

test("posted ticket → complete, points at results", () => {
  const s = deriveTicketState(ticket({ stage: "posted", posted_at: "2026-07-18T10:00:00Z" }));
  assert.equal(s.priority, "complete");
  assert.equal(s.phase, "publish");
  assert.equal(s.primaryAction.action, "open-results");
  assert.equal(isActionable(s), false);
});

test("parked ticket → issue (highest urgency), surfaces the reason", () => {
  const s = deriveTicketState(ticket({ stage: "sourced", gate: "parked", gate_reason: "Render failed: bad codec" }));
  assert.equal(s.priority, "issue");
  assert.equal(s.label, "Needs attention");
  assert.equal(s.description, "Render failed: bad codec");
  assert.equal(isActionable(s), true);
});

test("footage gate → needs-user, pluralizes missing scene count", () => {
  const one = deriveTicketState(ticket({ gate: "awaiting_footage", n_beats: 3, n_clips: 2 }));
  assert.equal(one.priority, "needs-user");
  assert.equal(one.label, "Needs footage");
  assert.equal(one.primaryAction.action, "add-footage");

  const many = deriveTicketState(ticket({ gate: "awaiting_footage", n_beats: 5, n_clips: 2 }));
  assert.equal(many.label, "Needs footage for 3 scenes");
});

test("approval gate → needs-user with review action", () => {
  const s = deriveTicketState(ticket({ stage: "ready", gate: "awaiting_approval", clip_url: "/x.mp4" }));
  assert.equal(s.priority, "needs-user");
  assert.equal(s.primaryAction.action, "review-approval");
});

test("scheduled ticket → scheduled priority, not actionable", () => {
  const s = deriveTicketState(ticket({ stage: "scheduled", scheduled_at: "2026-07-21T09:00:00Z", clip_url: "/x.mp4" }));
  assert.equal(s.priority, "scheduled");
  assert.equal(s.phase, "publish");
  assert.ok(s.label.startsWith("Scheduled"));
  assert.equal(isActionable(s), false);
});

test("assembled draft with no gate → ready to review", () => {
  const s = deriveTicketState(ticket({ stage: "assembled", clip_url: "/x.mp4", n_beats: 3, n_clips: 3, n_vo: 3 }));
  assert.equal(s.priority, "ready");
  assert.equal(s.label, "Ready to review");
  assert.equal(s.primaryAction.action, "open-review");
});

test("empty ticket needs a script", () => {
  const s = deriveTicketState(ticket({ stage: "scripted", n_beats: 0 }));
  assert.equal(s.priority, "needs-user");
  assert.equal(s.label, "Needs a script");
  assert.equal(s.primaryAction.action, "write-script");
});

test("scenes written but clips missing → needs footage (manual, no gate)", () => {
  const s = deriveTicketState(ticket({ stage: "sourced", n_beats: 4, n_clips: 1 }));
  assert.equal(s.priority, "needs-user");
  assert.equal(s.label, "Needs footage for 3 scenes");
});

test("clips in but no voiceover → needs voiceover (unless auto_voiceover)", () => {
  const manual = deriveTicketState(ticket({ stage: "sourced", n_beats: 2, n_clips: 2, n_vo: 0 }));
  assert.equal(manual.label, "Needs voiceover");

  const ai = deriveTicketState(ticket({ stage: "sourced", n_beats: 2, n_clips: 2, n_vo: 0, auto_voiceover: true }));
  assert.equal(ai.label, "Ready to assemble"); // AI voice covers the voice step
});

test("all scenes ready → ready to assemble", () => {
  const s = deriveTicketState(ticket({ stage: "sourced", n_beats: 2, n_clips: 2, n_vo: 2 }));
  assert.equal(s.priority, "ready");
  assert.equal(s.primaryAction.action, "assemble");
});

test("autopilot running shows live activity instead of a manual prompt", () => {
  const base = { stage: "sourced", autopilot: true, n_beats: 3, n_clips: 3, n_vo: 3 } as Partial<Ticket>;
  const running = deriveTicketState(ticket(base), { autopilotRunning: true });
  assert.equal(running.priority, "running");
  assert.equal(running.label, "Assembling draft");

  // Paused (loop not running) → falls back to the manual next-step view.
  const paused = deriveTicketState(ticket(base), { autopilotRunning: false });
  assert.equal(paused.priority, "ready"); // ready to assemble
});

test("autopilot running still asks the user to write the first script", () => {
  // Nothing to run yet (no beats) — autopilot can't fabricate a running state.
  const s = deriveTicketState(ticket({ stage: "scripted", autopilot: true, n_beats: 0 }), { autopilotRunning: true });
  assert.equal(s.priority, "needs-user");
  assert.equal(s.label, "Needs a script");
});

test("sortByPriority orders issue → needs-user → ready → scheduled → complete", () => {
  const tickets = [
    ticket({ id: 10, stage: "posted", posted_at: "2026-07-18T00:00:00Z" }),          // complete
    ticket({ id: 11, stage: "sourced", gate: "parked", gate_reason: "boom" }),        // issue
    ticket({ id: 12, stage: "scheduled", scheduled_at: "2026-07-21T00:00:00Z", clip_url: "/x" }), // scheduled
    ticket({ id: 13, stage: "scripted", n_beats: 0 }),                                // needs-user
    ticket({ id: 14, stage: "sourced", n_beats: 1, n_clips: 1, n_vo: 1 }),            // ready (assemble)
  ];
  const ordered = sortByPriority(tickets, (t) => deriveTicketState(t)).map((t) => t.id);
  assert.deepEqual(ordered, [11, 13, 14, 12, 10]);
});

test("PRIORITY_ORDER is a strict ranking with issue first and complete last", () => {
  assert.equal(PRIORITY_ORDER.issue, 0);
  assert.equal(PRIORITY_ORDER.complete, 5);
  const values = Object.values(PRIORITY_ORDER);
  assert.equal(new Set(values).size, values.length); // all distinct
});
